use jni::objects::{GlobalRef, JClass, JObject, JString};
use jni::sys::{jint, jstring};
use jni::JNIEnv;
use jni::JavaVM;

use arti_client::config::TorClientConfigBuilder;
use arti_client::TorClient;
use tor_rtcompat::PreferredRuntime;

use anyhow::Result;
use futures::StreamExt;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, Once};

static ARTI_CLIENT: Mutex<Option<Arc<TorClient<PreferredRuntime>>>> = Mutex::new(None);
static TOKIO_RUNTIME: Mutex<Option<tokio::runtime::Runtime>> = Mutex::new(None);
static JAVA_VM: Mutex<Option<JavaVM>> = Mutex::new(None);
static LOG_CALLBACK: Mutex<Option<GlobalRef>> = Mutex::new(None);
static SOCKS_TASK: Mutex<Option<tokio::task::JoinHandle<()>>> = Mutex::new(None);
// Handler-held client references must be dropped before Arti can release its state lock.
static HANDLER_TASKS: Mutex<Vec<tokio::task::JoinHandle<()>>> = Mutex::new(Vec::new());
static INIT_ONCE: Once = Once::new();

fn send_log_to_java(message: String) {
    let vm_opt = JAVA_VM.lock().unwrap();
    let callback_opt = LOG_CALLBACK.lock().unwrap();

    if let (Some(vm), Some(callback)) = (vm_opt.as_ref(), callback_opt.as_ref()) {
        if let Ok(mut env) = vm.attach_current_thread() {
            if let Ok(jmessage) = env.new_string(&message) {
                let _ = env.call_method(
                    callback.as_obj(),
                    "onLogLine",
                    "(Ljava/lang/String;)V",
                    &[(&jmessage).into()],
                );
            }
        }
    }
}

macro_rules! log_info {
    ($($arg:tt)*) => {{
        let msg = format!($($arg)*);
        send_log_to_java(msg);
    }};
}

macro_rules! log_error {
    ($($arg:tt)*) => {{
        let msg = format!("ERROR: {}", format!($($arg)*));
        send_log_to_java(msg);
    }};
}

#[no_mangle]
pub extern "C" fn Java_com_robosats_tor_ArtiNative_getVersion(
    env: JNIEnv,
    _class: JClass,
) -> jstring {
    if JAVA_VM.lock().unwrap().is_none() {
        if let Ok(vm) = env.get_java_vm() {
            *JAVA_VM.lock().unwrap() = Some(vm);
        }
    }

    let version = format!(
        "Arti {} (custom build with rustls)",
        env!("CARGO_PKG_VERSION")
    );
    let output = env
        .new_string(version)
        .expect("Couldn't create java string!");
    output.into_raw()
}

#[no_mangle]
pub extern "C" fn Java_com_robosats_tor_ArtiNative_setLogCallback(
    env: JNIEnv,
    _class: JClass,
    callback: JObject,
) {
    if JAVA_VM.lock().unwrap().is_none() {
        if let Ok(vm) = env.get_java_vm() {
            *JAVA_VM.lock().unwrap() = Some(vm);
        }
    }

    if let Ok(global_ref) = env.new_global_ref(callback) {
        *LOG_CALLBACK.lock().unwrap() = Some(global_ref);
        log_info!("Log callback registered");
    }
}

#[no_mangle]
pub extern "C" fn Java_com_robosats_tor_ArtiNative_initialize(
    mut env: JNIEnv,
    _class: JClass,
    data_dir: JString,
) -> jint {
    if JAVA_VM.lock().unwrap().is_none() {
        if let Ok(vm) = env.get_java_vm() {
            *JAVA_VM.lock().unwrap() = Some(vm);
        }
    }

    if ARTI_CLIENT.lock().unwrap().is_some() {
        log_info!("Arti already initialized, reusing existing client");
        return 0;
    }

    let data_dir_str: String = match env.get_string(&data_dir) {
        Ok(s) => s.into(),
        Err(e) => {
            log_error!("Failed to convert data_dir: {:?}", e);
            return -1;
        }
    };

    log_info!("Initializing Arti with data directory: {}", data_dir_str);

    INIT_ONCE.call_once(|| {
        // The custom rustls feature set requires an explicit provider.
        let _ = rustls::crypto::ring::default_provider().install_default();

        match tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
        {
            Ok(rt) => {
                log_info!("Tokio runtime created successfully");
                *TOKIO_RUNTIME.lock().unwrap() = Some(rt);
            }
            Err(e) => {
                log_error!("Failed to create Tokio runtime: {:?}", e);
            }
        }
    });

    let runtime_guard = TOKIO_RUNTIME.lock().unwrap();
    let runtime = match runtime_guard.as_ref() {
        Some(rt) => rt,
        None => {
            log_error!("Tokio runtime not initialized");
            return -2;
        }
    };

    let data_path = PathBuf::from(data_dir_str);
    let cache_dir = data_path.join("cache");
    let state_dir = data_path.join("state");

    std::fs::create_dir_all(&cache_dir).ok();
    std::fs::create_dir_all(&state_dir).ok();

    // Mobile bootstrap can take minutes, but the lifecycle lock must remain recoverable.
    const BOOTSTRAP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(600);

    let outcome: jint = runtime.block_on(async {
        log_info!("Creating Arti client...");

        let builder = TorClientConfigBuilder::from_directories(state_dir, cache_dir);

        // Host integration tests use /tmp; Android retains strict filesystem checks.
        #[cfg(not(target_os = "android"))]
        let builder = {
            let mut builder = builder;
            builder.storage().permissions().dangerously_trust_everyone();
            builder
        };

        let config = match builder.build() {
            Ok(c) => c,
            Err(e) => {
                log_error!("Failed to build Tor config: {:?}", e);
                return -3;
            }
        };

        let client = match TorClient::builder()
            .config(config)
            .create_unbootstrapped_async()
            .await
        {
            Ok(client) => client,
            Err(e) => {
                log_error!("Failed to create Tor client: {:?}", e);
                return -3;
            }
        };

        let progress_client = Arc::clone(&client);
        let progress_task = tokio::spawn(async move {
            let mut events = progress_client.bootstrap_events();
            while let Some(status) = events.next().await {
                let percent = (status.as_frac() * 100.0).round().clamp(0.0, 100.0) as u8;
                log_info!("BOOTSTRAP_PROGRESS|{}|{}", percent, status);
            }
        });

        let bootstrap_result = tokio::time::timeout(BOOTSTRAP_TIMEOUT, client.bootstrap()).await;
        progress_task.abort();

        match bootstrap_result {
            Ok(Ok(())) => {
                log_info!("Arti client created and bootstrapped");
                *ARTI_CLIENT.lock().unwrap() = Some(client);
                0
            }
            Ok(Err(e)) => {
                log_error!("Failed to bootstrap Tor client: {:?}", e);
                -3
            }
            Err(_elapsed) => {
                log_error!(
                    "Tor bootstrap timed out after {}s — aborting so the client can be retried",
                    BOOTSTRAP_TIMEOUT.as_secs()
                );
                -4
            }
        }
    });

    if outcome == 0 {
        log_info!("Arti initialized successfully");
    }
    outcome
}

#[no_mangle]
pub extern "C" fn Java_com_robosats_tor_ArtiNative_startSocksProxy(
    _env: JNIEnv,
    _class: JClass,
    port: jint,
) -> jint {
    log_info!("Starting SOCKS proxy on port {}", port);

    if let Some(handle) = SOCKS_TASK.lock().unwrap().take() {
        log_info!("Aborting previous SOCKS server task");
        handle.abort();
    }

    let client_guard = ARTI_CLIENT.lock().unwrap();
    let client = match client_guard.as_ref() {
        Some(c) => Arc::clone(c),
        None => {
            log_error!("Arti client not initialized — call initialize() first");
            return -1;
        }
    };
    drop(client_guard);

    let runtime_guard = TOKIO_RUNTIME.lock().unwrap();
    let runtime = match runtime_guard.as_ref() {
        Some(rt) => rt,
        None => {
            log_error!("Tokio runtime not initialized");
            return -2;
        }
    };

    let addr = format!("127.0.0.1:{}", port);

    let bind_result = runtime.block_on(async { tokio::net::TcpListener::bind(&addr).await });

    let listener = match bind_result {
        Ok(l) => {
            log_info!("SOCKS proxy bound to {}", addr);
            l
        }
        Err(e) => {
            log_error!("Failed to bind SOCKS proxy to {}: {:?}", addr, e);
            return -3;
        }
    };

    let handle = runtime.spawn(async move {
        log_info!("Sufficiently bootstrapped; system SOCKS now functional");

        loop {
            match listener.accept().await {
                Ok((stream, _peer_addr)) => {
                    let client_clone = Arc::clone(&client);
                    let h = tokio::spawn(async move {
                        if let Err(e) = handle_socks_connection(stream, client_clone).await {
                            log_error!("SOCKS connection error: {:?}", e);
                        }
                    });
                    let mut handlers = HANDLER_TASKS.lock().unwrap();
                    handlers.retain(|h| !h.is_finished());
                    handlers.push(h);
                }
                Err(e) => {
                    log_error!("Failed to accept SOCKS connection: {:?}", e);
                    break;
                }
            }
        }
    });

    *SOCKS_TASK.lock().unwrap() = Some(handle);
    log_info!("SOCKS proxy started on port {}", port);
    0
}

async fn handle_socks_connection(
    mut stream: tokio::net::TcpStream,
    client: Arc<TorClient<PreferredRuntime>>,
) -> Result<()> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    // TCP may split a SOCKS frame across packets.
    let mut greeting = [0u8; 2];
    stream.read_exact(&mut greeting).await?;
    if greeting[0] != 0x05 {
        return Err(anyhow::anyhow!(
            "Unsupported SOCKS version: {}",
            greeting[0]
        ));
    }
    let mut methods = vec![0u8; greeting[1] as usize];
    stream.read_exact(&mut methods).await?;
    if !methods.contains(&0x00) {
        stream.write_all(&[0x05, 0xff]).await?;
        return Err(anyhow::anyhow!(
            "SOCKS client does not support no-auth mode"
        ));
    }
    stream.write_all(&[0x05, 0x00]).await?;

    let mut request = [0u8; 4];
    stream.read_exact(&mut request).await?;
    if request[0] != 0x05 {
        return Err(anyhow::anyhow!("Unsupported SOCKS version: {}", request[0]));
    }
    if request[1] != 0x01 {
        stream
            .write_all(&[0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
            .await?;
        return Err(anyhow::anyhow!("Unsupported SOCKS command: {}", request[1]));
    }

    let (target_host, target_port) = match request[3] {
        0x01 => {
            let mut address = [0u8; 6];
            stream.read_exact(&mut address).await?;
            (
                std::net::Ipv4Addr::new(address[0], address[1], address[2], address[3]).to_string(),
                u16::from_be_bytes([address[4], address[5]]),
            )
        }
        0x03 => {
            let len = stream.read_u8().await? as usize;
            let mut address = vec![0u8; len + 2];
            stream.read_exact(&mut address).await?;
            let domain = std::str::from_utf8(&address[..len])?.to_owned();
            let port = u16::from_be_bytes([address[len], address[len + 1]]);
            (domain, port)
        }
        0x04 => {
            let mut address = [0u8; 18];
            stream.read_exact(&mut address).await?;
            let ip = std::net::Ipv6Addr::from(<[u8; 16]>::try_from(&address[..16])?).to_string();
            let port = u16::from_be_bytes([address[16], address[17]]);
            (ip, port)
        }
        _ => {
            stream
                .write_all(&[0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                .await?;
            return Err(anyhow::anyhow!("Unsupported address type: {}", request[3]));
        }
    };

    let mut tor_stream = match client.connect((target_host.as_str(), target_port)).await {
        Ok(s) => s,
        Err(e) => {
            log_error!(
                "Failed to connect through Tor to {}:{}: {:?}",
                target_host,
                target_port,
                e
            );
            stream
                .write_all(&[0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
                .await?;
            return Err(e.into());
        }
    };

    stream
        .write_all(&[0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
        .await?;

    tokio::io::copy_bidirectional(&mut stream, &mut tor_stream).await?;

    Ok(())
}

#[no_mangle]
pub extern "C" fn Java_com_robosats_tor_ArtiNative_stopSocksProxy(
    _env: JNIEnv,
    _class: JClass,
) -> jint {
    log_info!("Stopping SOCKS proxy...");

    if let Some(handle) = SOCKS_TASK.lock().unwrap().take() {
        handle.abort();
    }

    let rt_handle = TOKIO_RUNTIME
        .lock()
        .unwrap()
        .as_ref()
        .map(|rt| rt.handle().clone());
    if let Some(rh) = rt_handle {
        rh.block_on(async {
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        });
    }

    log_info!("SOCKS proxy stopped");
    0
}

#[no_mangle]
pub extern "C" fn Java_com_robosats_tor_ArtiNative_destroy(_env: JNIEnv, _class: JClass) -> jint {
    log_info!("Destroying Arti client");

    let rt_handle = TOKIO_RUNTIME
        .lock()
        .unwrap()
        .as_ref()
        .map(|rt| rt.handle().clone());

    // Await the listener before draining handlers to close the accept/push race.
    let socks_handle = SOCKS_TASK.lock().unwrap().take();
    if let (Some(h), Some(rh)) = (socks_handle, rt_handle.as_ref()) {
        h.abort();
        rh.block_on(async {
            let _ = tokio::time::timeout(tokio::time::Duration::from_secs(1), h).await;
        });
    }

    let handlers = std::mem::take(&mut *HANDLER_TASKS.lock().unwrap());
    for h in &handlers {
        h.abort();
    }
    drop(handlers);

    if let Some(rh) = rt_handle {
        rh.block_on(async {
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        });
    }

    let _ = ARTI_CLIENT.lock().unwrap().take();

    log_info!("Arti client destroyed");
    0
}
