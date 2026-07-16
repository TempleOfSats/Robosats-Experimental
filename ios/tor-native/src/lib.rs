use anyhow::Result;
use arti_client::config::TorClientConfigBuilder;
use arti_client::TorClient;
use futures::StreamExt;
use std::ffi::{c_char, CStr, CString};
use std::path::PathBuf;
use std::ptr;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Arc, Mutex, Once, OnceLock};
use tor_rtcompat::PreferredRuntime;

static ARTI_CLIENT: Mutex<Option<Arc<TorClient<PreferredRuntime>>>> = Mutex::new(None);
static TOKIO_RUNTIME: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
static SOCKS_TASK: Mutex<Option<tokio::task::JoinHandle<()>>> = Mutex::new(None);
static HANDLER_TASKS: Mutex<Vec<tokio::task::JoinHandle<()>>> = Mutex::new(Vec::new());
static LAST_ERROR: Mutex<Option<String>> = Mutex::new(None);
static BOOTSTRAP_STATUS: Mutex<String> = Mutex::new(String::new());
static BOOTSTRAP_PROGRESS: AtomicU8 = AtomicU8::new(0);
static CRYPTO_PROVIDER: Once = Once::new();

const BOOTSTRAP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(600);

#[no_mangle]
pub extern "C" fn arti_mobile_version() -> *mut c_char {
    into_c_string(format!(
        "Arti {} (iOS static build with rustls)",
        env!("CARGO_PKG_VERSION")
    ))
}

#[no_mangle]
pub unsafe extern "C" fn arti_mobile_string_free(value: *mut c_char) {
    if !value.is_null() {
        drop(CString::from_raw(value));
    }
}

#[no_mangle]
pub unsafe extern "C" fn arti_mobile_initialize(data_directory: *const c_char) -> i32 {
    clear_error();
    BOOTSTRAP_PROGRESS.store(0, Ordering::Relaxed);
    set_status("Creating Tor client");

    if ARTI_CLIENT
        .lock()
        .expect("Arti client lock poisoned")
        .is_some()
    {
        BOOTSTRAP_PROGRESS.store(100, Ordering::Relaxed);
        return 0;
    }

    let data_directory = match c_string(data_directory) {
        Ok(value) => value,
        Err(error) => return fail(-1, error),
    };
    let runtime = match runtime() {
        Ok(value) => value,
        Err(error) => return fail(-2, error),
    };

    let base = PathBuf::from(data_directory);
    let state_dir = base.join("state");
    let cache_dir = base.join("cache");
    if let Err(error) = std::fs::create_dir_all(&state_dir) {
        return fail(-3, error);
    }
    if let Err(error) = std::fs::create_dir_all(&cache_dir) {
        return fail(-3, error);
    }

    runtime.block_on(async {
        let config = match TorClientConfigBuilder::from_directories(state_dir, cache_dir).build() {
            Ok(value) => value,
            Err(error) => return fail(-3, error),
        };
        let client = match TorClient::builder()
            .config(config)
            .create_unbootstrapped_async()
            .await
        {
            Ok(value) => value,
            Err(error) => return fail(-3, error),
        };

        let progress_client = Arc::clone(&client);
        let progress_task = tokio::spawn(async move {
            let mut events = progress_client.bootstrap_events();
            while let Some(status) = events.next().await {
                let progress = (status.as_frac() * 100.0).round().clamp(0.0, 100.0) as u8;
                BOOTSTRAP_PROGRESS.store(progress, Ordering::Relaxed);
                set_status(status.to_string());
            }
        });

        let result = tokio::time::timeout(BOOTSTRAP_TIMEOUT, client.bootstrap()).await;
        progress_task.abort();
        match result {
            Ok(Ok(())) => {
                *ARTI_CLIENT.lock().expect("Arti client lock poisoned") = Some(client);
                BOOTSTRAP_PROGRESS.store(100, Ordering::Relaxed);
                set_status("Tor bootstrap complete");
                0
            }
            Ok(Err(error)) => fail(-3, error),
            Err(_) => fail_message(-4, "Tor bootstrap timed out"),
        }
    })
}

#[no_mangle]
pub extern "C" fn arti_mobile_bootstrap_progress() -> u8 {
    BOOTSTRAP_PROGRESS.load(Ordering::Relaxed)
}

#[no_mangle]
pub extern "C" fn arti_mobile_bootstrap_status() -> *mut c_char {
    into_c_string(
        BOOTSTRAP_STATUS
            .lock()
            .expect("Bootstrap status lock poisoned")
            .clone(),
    )
}

#[no_mangle]
pub extern "C" fn arti_mobile_start_socks_proxy(requested_port: u16) -> i32 {
    clear_error();
    if let Some(task) = SOCKS_TASK.lock().expect("SOCKS task lock poisoned").take() {
        task.abort();
    }

    let client = match ARTI_CLIENT
        .lock()
        .expect("Arti client lock poisoned")
        .as_ref()
        .map(Arc::clone)
    {
        Some(value) => value,
        None => return fail_message(-1, "Arti is not initialized"),
    };
    let runtime = match runtime() {
        Ok(value) => value,
        Err(error) => return fail(-2, error),
    };

    let listener =
        match runtime.block_on(tokio::net::TcpListener::bind(("127.0.0.1", requested_port))) {
            Ok(value) => value,
            Err(error) => return fail(-3, error),
        };
    let port = match listener.local_addr() {
        Ok(address) => address.port(),
        Err(error) => return fail(-3, error),
    };

    let task = runtime.spawn(async move {
        loop {
            match listener.accept().await {
                Ok((stream, _)) => {
                    let client = Arc::clone(&client);
                    let handler = tokio::spawn(async move {
                        let _ = handle_socks_connection(stream, client).await;
                    });
                    let mut handlers = HANDLER_TASKS.lock().expect("Handler task lock poisoned");
                    handlers.retain(|task| !task.is_finished());
                    handlers.push(handler);
                }
                Err(error) => {
                    set_error(error.to_string());
                    break;
                }
            }
        }
    });
    *SOCKS_TASK.lock().expect("SOCKS task lock poisoned") = Some(task);
    i32::from(port)
}

#[no_mangle]
pub extern "C" fn arti_mobile_stop_socks_proxy() -> i32 {
    if let Some(task) = SOCKS_TASK.lock().expect("SOCKS task lock poisoned").take() {
        task.abort();
    }
    0
}

#[no_mangle]
pub extern "C" fn arti_mobile_destroy() -> i32 {
    arti_mobile_stop_socks_proxy();
    let handlers = std::mem::take(&mut *HANDLER_TASKS.lock().expect("Handler task lock poisoned"));
    for task in handlers {
        task.abort();
    }
    *ARTI_CLIENT.lock().expect("Arti client lock poisoned") = None;
    BOOTSTRAP_PROGRESS.store(0, Ordering::Relaxed);
    set_status("Tor stopped");
    0
}

#[no_mangle]
pub extern "C" fn arti_mobile_last_error() -> *mut c_char {
    LAST_ERROR
        .lock()
        .expect("Error lock poisoned")
        .as_ref()
        .map(|value| into_c_string(value.clone()))
        .unwrap_or(ptr::null_mut())
}

fn runtime() -> Result<&'static tokio::runtime::Runtime> {
    CRYPTO_PROVIDER.call_once(|| {
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
    if let Some(runtime) = TOKIO_RUNTIME.get() {
        return Ok(runtime);
    }
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?;
    let _ = TOKIO_RUNTIME.set(runtime);
    TOKIO_RUNTIME
        .get()
        .ok_or_else(|| anyhow::anyhow!("Tokio runtime is unavailable"))
}

unsafe fn c_string(value: *const c_char) -> Result<String> {
    if value.is_null() {
        return Err(anyhow::anyhow!("Missing data directory"));
    }
    Ok(CStr::from_ptr(value).to_str()?.to_owned())
}

fn into_c_string(value: String) -> *mut c_char {
    CString::new(value.replace('\0', " "))
        .expect("CString conversion failed")
        .into_raw()
}

fn clear_error() {
    *LAST_ERROR.lock().expect("Error lock poisoned") = None;
}

fn set_error(message: String) {
    set_status(format!("Failed: {message}"));
    *LAST_ERROR.lock().expect("Error lock poisoned") = Some(message);
}

fn set_status(message: impl Into<String>) {
    let message = message.into();
    eprintln!("[RoboSatsExp][Arti] {message}");
    *BOOTSTRAP_STATUS
        .lock()
        .expect("Bootstrap status lock poisoned") = message;
}

fn fail(code: i32, error: impl std::fmt::Display) -> i32 {
    fail_message(code, error.to_string())
}

fn fail_message(code: i32, message: impl Into<String>) -> i32 {
    set_error(message.into());
    code
}

async fn handle_socks_connection(
    mut stream: tokio::net::TcpStream,
    client: Arc<TorClient<PreferredRuntime>>,
) -> Result<()> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let mut greeting = [0_u8; 2];
    stream.read_exact(&mut greeting).await?;
    if greeting[0] != 0x05 {
        return Err(anyhow::anyhow!("Unsupported SOCKS version"));
    }
    let mut methods = vec![0_u8; greeting[1] as usize];
    stream.read_exact(&mut methods).await?;
    if !methods.contains(&0x00) {
        stream.write_all(&[0x05, 0xff]).await?;
        return Err(anyhow::anyhow!("SOCKS no-auth mode is required"));
    }
    stream.write_all(&[0x05, 0x00]).await?;

    let mut request = [0_u8; 4];
    stream.read_exact(&mut request).await?;
    if request[0] != 0x05 || request[1] != 0x01 {
        stream
            .write_all(&[0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
            .await?;
        return Err(anyhow::anyhow!("Only SOCKS5 CONNECT is supported"));
    }

    let (host, port) = match request[3] {
        0x01 => {
            let mut address = [0_u8; 6];
            stream.read_exact(&mut address).await?;
            (
                std::net::Ipv4Addr::new(address[0], address[1], address[2], address[3]).to_string(),
                u16::from_be_bytes([address[4], address[5]]),
            )
        }
        0x03 => {
            let length = stream.read_u8().await? as usize;
            let mut address = vec![0_u8; length + 2];
            stream.read_exact(&mut address).await?;
            (
                std::str::from_utf8(&address[..length])?.to_owned(),
                u16::from_be_bytes([address[length], address[length + 1]]),
            )
        }
        0x04 => {
            let mut address = [0_u8; 18];
            stream.read_exact(&mut address).await?;
            (
                std::net::Ipv6Addr::from(<[u8; 16]>::try_from(&address[..16])?).to_string(),
                u16::from_be_bytes([address[16], address[17]]),
            )
        }
        _ => {
            stream
                .write_all(&[0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                .await?;
            return Err(anyhow::anyhow!("Unsupported SOCKS address type"));
        }
    };

    let mut tor_stream = match client.connect((host.as_str(), port)).await {
        Ok(value) => value,
        Err(error) => {
            stream
                .write_all(&[0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                .await?;
            return Err(error.into());
        }
    };
    stream
        .write_all(&[0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
        .await?;
    tokio::io::copy_bidirectional(&mut stream, &mut tor_stream).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_missing_data_directory() {
        let result = unsafe { arti_mobile_initialize(ptr::null()) };
        assert_eq!(result, -1);
    }

    #[test]
    fn refuses_proxy_before_initialization() {
        assert_eq!(arti_mobile_start_socks_proxy(0), -1);
    }
}
