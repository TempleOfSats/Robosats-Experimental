use anyhow::{Context, Result};
use arti_client::config::TorClientConfigBuilder;
use arti_client::TorClient;
use futures::StreamExt;
use serde::Serialize;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tor_rtcompat::PreferredRuntime;

const BOOTSTRAP_TIMEOUT: Duration = Duration::from_secs(600);

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum HostMessage<'a> {
    Progress { progress: u8, stage: &'a str },
    Ready { port: u16, version: &'a str },
    Error { message: &'a str },
}

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        let message = error.to_string();
        emit(&HostMessage::Error { message: &message });
        eprintln!("Arti sidecar failed: {message}");
        std::process::exit(1);
    }
}

async fn run() -> Result<()> {
    rustls::crypto::ring::default_provider()
        .install_default()
        .map_err(|_| anyhow::anyhow!("Could not install the Rustls crypto provider"))?;

    let data_directory = data_directory_from_args()?;
    let state_directory = data_directory.join("state");
    let cache_directory = data_directory.join("cache");
    std::fs::create_dir_all(&state_directory)
        .context("Could not create the Arti state directory")?;
    std::fs::create_dir_all(&cache_directory)
        .context("Could not create the Arti cache directory")?;

    emit(&HostMessage::Progress {
        progress: 1,
        stage: "Creating Tor client",
    });

    let config = TorClientConfigBuilder::from_directories(state_directory, cache_directory)
        .build()
        .context("Could not create the Arti configuration")?;
    let client = TorClient::builder()
        .config(config)
        .create_unbootstrapped_async()
        .await
        .context("Could not create the Tor client")?;

    let progress_client = Arc::clone(&client);
    let progress_task = tokio::spawn(async move {
        let mut events = progress_client.bootstrap_events();
        while let Some(status) = events.next().await {
            let progress = (status.as_frac() * 100.0).round().clamp(0.0, 100.0) as u8;
            let stage = status.to_string();
            emit(&HostMessage::Progress {
                progress,
                stage: &stage,
            });
        }
    });

    let bootstrap = tokio::time::timeout(BOOTSTRAP_TIMEOUT, client.bootstrap()).await;
    progress_task.abort();
    match bootstrap {
        Ok(Ok(())) => {}
        Ok(Err(error)) => return Err(error).context("Tor bootstrap failed"),
        Err(_) => return Err(anyhow::anyhow!("Tor bootstrap timed out")),
    }

    let listener = TcpListener::bind(("127.0.0.1", 0))
        .await
        .context("Could not bind the local SOCKS proxy")?;
    let port = listener.local_addr()?.port();
    emit(&HostMessage::Ready {
        port,
        version: env!("CARGO_PKG_VERSION"),
    });

    loop {
        let (stream, _) = listener.accept().await?;
        let client = Arc::clone(&client);
        tokio::spawn(async move {
            if let Err(error) = handle_socks_connection(stream, client).await {
                eprintln!("SOCKS connection failed: {error}");
            }
        });
    }
}

fn data_directory_from_args() -> Result<PathBuf> {
    let mut arguments = std::env::args_os().skip(1);
    let mut data_directory = None;

    while let Some(argument) = arguments.next() {
        if argument == "--data-dir" {
            data_directory = arguments.next().map(PathBuf::from);
        } else {
            return Err(anyhow::anyhow!(
                "Unsupported argument: {}",
                argument.to_string_lossy()
            ));
        }
    }

    data_directory.ok_or_else(|| anyhow::anyhow!("--data-dir is required"))
}

fn emit(message: &HostMessage<'_>) {
    if let Ok(line) = serde_json::to_string(message) {
        let mut stdout = std::io::stdout().lock();
        let _ = writeln!(stdout, "{line}");
        let _ = stdout.flush();
    }
}

async fn handle_socks_connection(
    mut stream: TcpStream,
    client: Arc<TorClient<PreferredRuntime>>,
) -> Result<()> {
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
        reply(&mut stream, 0x07).await?;
        return Err(anyhow::anyhow!("Only SOCKS5 CONNECT is supported"));
    }

    let (host, port) = read_destination(&mut stream, request[3]).await?;
    let mut tor_stream = match client.connect((host.as_str(), port)).await {
        Ok(value) => value,
        Err(error) => {
            reply(&mut stream, 0x05).await?;
            return Err(error.into());
        }
    };

    reply(&mut stream, 0x00).await?;
    tokio::io::copy_bidirectional(&mut stream, &mut tor_stream).await?;
    Ok(())
}

async fn read_destination(stream: &mut TcpStream, address_type: u8) -> Result<(String, u16)> {
    match address_type {
        0x01 => {
            let mut address = [0_u8; 6];
            stream.read_exact(&mut address).await?;
            Ok((
                std::net::Ipv4Addr::new(address[0], address[1], address[2], address[3]).to_string(),
                u16::from_be_bytes([address[4], address[5]]),
            ))
        }
        0x03 => {
            let length = stream.read_u8().await? as usize;
            let mut address = vec![0_u8; length + 2];
            stream.read_exact(&mut address).await?;
            Ok((
                std::str::from_utf8(&address[..length])?.to_owned(),
                u16::from_be_bytes([address[length], address[length + 1]]),
            ))
        }
        0x04 => {
            let mut address = [0_u8; 18];
            stream.read_exact(&mut address).await?;
            Ok((
                std::net::Ipv6Addr::from(<[u8; 16]>::try_from(&address[..16])?).to_string(),
                u16::from_be_bytes([address[16], address[17]]),
            ))
        }
        _ => {
            reply(stream, 0x08).await?;
            Err(anyhow::anyhow!("Unsupported SOCKS address type"))
        }
    }
}

async fn reply(stream: &mut TcpStream, status: u8) -> Result<()> {
    stream
        .write_all(&[0x05, status, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_messages_are_line_safe_json() {
        let value = serde_json::to_string(&HostMessage::Ready {
            port: 19050,
            version: "test",
        })
        .expect("message serializes");
        assert_eq!(value, r#"{"type":"ready","port":19050,"version":"test"}"#);
    }
}
