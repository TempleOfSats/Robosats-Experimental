use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{
    webview::PageLoadEvent, AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use url::Url;

const MAX_AUTOMATIC_RESTARTS: u8 = 4;
const MAX_TRANSPORT_DIAGNOSTICS: usize = 64;
const RESET_DELETE_ATTEMPTS: u8 = 50;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum StartPolicy {
    Normal,
    Force,
    AutomaticRecovery,
    FailedGeneration(u64),
}

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum SidecarMessage {
    Progress {
        progress: u8,
        stage: String,
    },
    Ready {
        port: u16,
        version: String,
    },
    Diagnostic {
        phase: String,
        outcome: String,
        duration_ms: u64,
        attempt: u32,
        version: String,
    },
    Error {
        message: String,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TransportDiagnostic {
    phase: String,
    outcome: String,
    duration_ms: u64,
    attempt: u32,
    arti_version: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub state: String,
    pub connected: bool,
    pub progress: u8,
    pub message: String,
    pub error: Option<String>,
    pub socks_port: u16,
    pub arti_version: Option<String>,
    pub restart_count: u8,
}

struct RuntimeInner {
    status: RuntimeStatus,
    child: Option<CommandChild>,
    generation: u64,
    app_ready: bool,
    last_controlled_recovery_at: Option<Instant>,
    diagnostics: VecDeque<TransportDiagnostic>,
}

#[derive(Clone)]
pub struct DesktopRuntime {
    inner: Arc<Mutex<RuntimeInner>>,
}

impl DesktopRuntime {
    pub fn new(socks_port: u16) -> Self {
        Self {
            inner: Arc::new(Mutex::new(RuntimeInner {
                status: RuntimeStatus {
                    state: "starting".into(),
                    connected: false,
                    progress: 2,
                    message: "Starting private connection...".into(),
                    error: None,
                    socks_port,
                    arti_version: None,
                    restart_count: 0,
                },
                child: None,
                generation: 0,
                app_ready: false,
                last_controlled_recovery_at: None,
                diagnostics: VecDeque::with_capacity(MAX_TRANSPORT_DIAGNOSTICS),
            })),
        }
    }

    pub fn status(&self) -> RuntimeStatus {
        self.inner
            .lock()
            .expect("runtime mutex poisoned")
            .status
            .clone()
    }

    pub fn diagnostics(&self) -> Vec<TransportDiagnostic> {
        self.inner
            .lock()
            .expect("runtime mutex poisoned")
            .diagnostics
            .iter()
            .cloned()
            .collect()
    }

    pub fn mark_app_ready(&self, app: &AppHandle) {
        let connected = {
            let mut inner = self.inner.lock().expect("runtime mutex poisoned");
            inner.app_ready = true;
            inner.status.connected
        };
        if connected {
            show_main_window(app);
        }
    }

    pub fn start(&self, app: AppHandle, force: bool) {
        let policy = if force {
            StartPolicy::Force
        } else {
            StartPolicy::Normal
        };
        self.start_with_feedback(app, policy, true);
    }

    pub fn recover_transport(&self, app: AppHandle) {
        let now = Instant::now();
        {
            let inner = self.inner.lock().expect("runtime mutex poisoned");
            if inner
                .last_controlled_recovery_at
                .is_some_and(|previous| now.duration_since(previous) < Duration::from_secs(120))
            {
                return;
            }
        }
        if self.start_with_feedback(app, StartPolicy::AutomaticRecovery, false) {
            self.inner
                .lock()
                .expect("runtime mutex poisoned")
                .last_controlled_recovery_at = Some(now);
        }
    }

    pub fn reconnect_transport(&self, app: AppHandle) {
        self.start_with_feedback(app, StartPolicy::Force, false);
    }

    pub fn reset_transport(&self, app: AppHandle) {
        let (generation, port, old_child) = {
            let mut inner = self.inner.lock().expect("runtime mutex poisoned");
            inner.generation += 1;
            inner.status.state = "connecting".into();
            inner.status.connected = false;
            inner.status.progress = 1;
            inner.status.message = "Resetting private connection...".into();
            inner.status.error = None;
            (
                inner.generation,
                inner.status.socks_port,
                inner.child.take(),
            )
        };
        if let Some(child) = old_child {
            let _ = child.kill();
        }
        self.emit_status(&app);

        let runtime = self.clone();
        tauri::async_runtime::spawn(async move {
            let data_directory = match arti_data_directory(&app) {
                Ok(path) => path,
                Err(error) => {
                    runtime.fail(&app, generation, error, false);
                    return;
                }
            };
            if let Err(error) = reset_arti_data_directory(&data_directory).await {
                runtime.fail(&app, generation, error, false);
                return;
            }
            if let Err(error) = runtime.run_sidecar(app.clone(), generation, port).await {
                runtime.fail(&app, generation, error, true);
            }
        });
    }

    fn start_with_feedback(&self, app: AppHandle, policy: StartPolicy, show_splash: bool) -> bool {
        let (generation, port, old_child) = {
            let mut inner = self.inner.lock().expect("runtime mutex poisoned");
            if !start_allowed(&inner, policy) {
                return false;
            }
            inner.generation += 1;
            inner.status.state = "connecting".into();
            inner.status.connected = false;
            inner.status.progress = 2;
            inner.status.message = "Starting private connection...".into();
            inner.status.error = None;
            (
                inner.generation,
                inner.status.socks_port,
                inner.child.take(),
            )
        };
        if let Some(child) = old_child {
            let _ = child.kill();
        }
        if show_splash {
            show_splash_window(&app);
        }
        self.emit_status(&app);

        let runtime = self.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = runtime.run_sidecar(app.clone(), generation, port).await {
                runtime.fail(&app, generation, error, true);
            }
        });
        true
    }

    pub fn stop(&self) {
        if let Some(child) = self
            .inner
            .lock()
            .expect("runtime mutex poisoned")
            .child
            .take()
        {
            let _ = child.kill();
        }
    }

    pub fn health_check(&self, app: AppHandle) {
        let runtime = self.clone();
        tauri::async_runtime::spawn(async move {
            let status = runtime.status();
            if health_check_deferred(&status) {
                return;
            }
            if status.connected
                && tokio::time::timeout(
                    Duration::from_secs(2),
                    tokio::net::TcpStream::connect(("127.0.0.1", status.socks_port)),
                )
                .await
                .is_ok_and(|result| result.is_ok())
            {
                let _ = app.emit("robosats:native-resume", ());
                return;
            }
            runtime.start_with_feedback(app, StartPolicy::AutomaticRecovery, true);
        });
    }

    async fn run_sidecar(&self, app: AppHandle, generation: u64, port: u16) -> Result<(), String> {
        let data_directory = arti_data_directory(&app)?;
        std::fs::create_dir_all(&data_directory).map_err(|error| error.to_string())?;
        let (mut events, child) = app
            .shell()
            .sidecar("robosats-arti")
            .map_err(|error| error.to_string())?
            .args([
                "--data-dir",
                &data_directory.to_string_lossy(),
                "--socks-port",
                &port.to_string(),
            ])
            .spawn()
            .map_err(|error| error.to_string())?;
        {
            let mut inner = self.inner.lock().expect("runtime mutex poisoned");
            if inner.generation != generation {
                let _ = child.kill();
                return Ok(());
            }
            inner.child = Some(child);
        }

        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    if let Ok(message) = serde_json::from_str::<SidecarMessage>(line.trim()) {
                        self.handle_message(&app, generation, port, message)?;
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    eprintln!("Arti: {}", String::from_utf8_lossy(&bytes));
                }
                CommandEvent::Error(error) => return Err(error),
                CommandEvent::Terminated(payload) => {
                    return Err(format!(
                        "Private connection stopped{}",
                        payload
                            .code
                            .map(|code| format!(" (exit code {code})"))
                            .unwrap_or_default()
                    ));
                }
                _ => {}
            }
        }
        Err("Private connection stopped unexpectedly".into())
    }

    fn handle_message(
        &self,
        app: &AppHandle,
        generation: u64,
        expected_port: u16,
        message: SidecarMessage,
    ) -> Result<(), String> {
        match message {
            SidecarMessage::Progress { progress, stage } => {
                let mut inner = self.inner.lock().expect("runtime mutex poisoned");
                if inner.generation != generation {
                    return Ok(());
                }
                inner.status.progress = progress.min(99);
                inner.status.message = clean_stage(&stage);
                drop(inner);
                self.emit_status(app);
            }
            SidecarMessage::Ready { port, version } => {
                if port != expected_port {
                    return Err("Arti bound an unexpected proxy port".into());
                }
                {
                    let mut inner = self.inner.lock().expect("runtime mutex poisoned");
                    if inner.generation != generation {
                        return Ok(());
                    }
                    inner.status.state = "ready".into();
                    inner.status.connected = true;
                    inner.status.progress = 100;
                    inner.status.message = "Private connection ready".into();
                    inner.status.error = None;
                    inner.status.arti_version = Some(version);
                    inner.status.restart_count = 0;
                }
                ensure_main_window(app, expected_port)?;
                self.emit_status(app);
                let _ = app.emit("robosats:tor-reconnected", self.status());
                if self.inner.lock().expect("runtime mutex poisoned").app_ready {
                    show_main_window(app);
                }
            }
            SidecarMessage::Diagnostic {
                phase,
                outcome,
                duration_ms,
                attempt,
                version,
            } => {
                let mut inner = self.inner.lock().expect("runtime mutex poisoned");
                if inner.generation != generation {
                    return Ok(());
                }
                push_diagnostic(
                    &mut inner.diagnostics,
                    TransportDiagnostic {
                        phase: diagnostic_phase(&phase).into(),
                        outcome: diagnostic_outcome(&outcome).into(),
                        duration_ms: duration_ms.min(10 * 60 * 1000),
                        attempt: attempt.min(9_999),
                        arti_version: clean_version(&version),
                    },
                );
            }
            SidecarMessage::Error { message } => return Err(message),
        }
        Ok(())
    }

    fn fail(&self, app: &AppHandle, generation: u64, error: String, retry: bool) {
        let restart = {
            let mut inner = self.inner.lock().expect("runtime mutex poisoned");
            if inner.generation != generation {
                return;
            }
            inner.child = None;
            inner.status.state = "failed".into();
            inner.status.connected = false;
            inner.status.message = "Private connection unavailable".into();
            inner.status.error = Some(sanitize_error(&error));
            if retry && inner.status.restart_count < MAX_AUTOMATIC_RESTARTS {
                inner.status.restart_count += 1;
                Some(inner.status.restart_count)
            } else {
                None
            }
        };
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.hide();
        }
        show_splash_window(app);
        self.emit_status(app);
        if let Some(attempt) = restart {
            let runtime = self.clone();
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_secs(2_u64.pow(attempt.min(4).into()))).await;
                runtime.start_with_feedback(app, StartPolicy::FailedGeneration(generation), true);
            });
        }
    }

    fn emit_status(&self, app: &AppHandle) {
        let status = self.status();
        let _ = app.emit("desktop-runtime-status", &status);
        let _ = app.emit("robosats:desktop-runtime-state", &status);
    }
}

fn arti_data_directory(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join("arti"))
        .map_err(|error| error.to_string())
}

async fn reset_arti_data_directory(directory: &Path) -> Result<(), String> {
    let mut last_error = None;
    for _ in 0..RESET_DELETE_ATTEMPTS {
        match clear_arti_data_directory(directory) {
            Ok(()) => return Ok(()),
            Err(error) => last_error = Some(error),
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    Err(format!(
        "Could not reset the local Tor data: {}",
        last_error
            .map(|error| error.to_string())
            .unwrap_or_else(|| "unknown filesystem error".into())
    ))
}

fn clear_arti_data_directory(directory: &Path) -> std::io::Result<()> {
    match std::fs::remove_dir_all(directory) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    std::fs::create_dir_all(directory)
}

fn push_diagnostic(
    diagnostics: &mut VecDeque<TransportDiagnostic>,
    diagnostic: TransportDiagnostic,
) {
    if diagnostics.len() == MAX_TRANSPORT_DIAGNOSTICS {
        diagnostics.pop_front();
    }
    diagnostics.push_back(diagnostic);
}

fn diagnostic_phase(value: &str) -> &'static str {
    match value {
        "bootstrap" => "bootstrap",
        "tor-connect" => "tor-connect",
        "stream" => "stream",
        "socks" => "socks",
        _ => "unknown",
    }
}

fn diagnostic_outcome(value: &str) -> &'static str {
    match value {
        "ready" => "ready",
        "completed" => "completed",
        "timeout" => "timeout",
        "circuit-failed" => "circuit-failed",
        "stream-closed" => "stream-closed",
        "rejected" => "rejected",
        "failed" => "failed",
        _ => "unknown",
    }
}

fn clean_version(value: &str) -> String {
    let cleaned: String = value
        .chars()
        .filter(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '+')
        })
        .take(32)
        .collect();
    if cleaned.is_empty() {
        "unknown".into()
    } else {
        cleaned
    }
}

fn health_check_deferred(status: &RuntimeStatus) -> bool {
    matches!(status.state.as_str(), "starting" | "connecting")
}

fn start_allowed(inner: &RuntimeInner, policy: StartPolicy) -> bool {
    match policy {
        StartPolicy::Force => true,
        StartPolicy::AutomaticRecovery => !health_check_deferred(&inner.status),
        StartPolicy::Normal => !matches!(inner.status.state.as_str(), "connecting" | "ready"),
        StartPolicy::FailedGeneration(generation) => {
            inner.generation == generation && inner.status.state == "failed"
        }
    }
}

fn allocate_loopback_port() -> Result<u16, String> {
    std::net::TcpListener::bind(("127.0.0.1", 0))
        .and_then(|listener| listener.local_addr())
        .map(|address| address.port())
        .map_err(|error| error.to_string())
}

pub fn create_runtime() -> Result<DesktopRuntime, String> {
    allocate_loopback_port().map(DesktopRuntime::new)
}

pub fn create_splash_window(app: &AppHandle, port: u16) -> Result<(), String> {
    if app.get_webview_window("splash").is_some() {
        return Ok(());
    }
    let builder =
        WebviewWindowBuilder::new(app, "splash", WebviewUrl::App("desktop/splash.html".into()))
            .title("RoboSats Exp.")
            .inner_size(390.0, 520.0)
            .center()
            .resizable(false)
            .fullscreen(false)
            .decorations(false)
            .visible(true)
            .background_color(tauri::webview::Color(11, 19, 32, 255));
    #[cfg(windows)]
    let builder = builder.proxy_url(proxy_url(port)?);
    #[cfg(not(windows))]
    let _ = port;
    builder.build().map_err(|error| error.to_string())?;
    Ok(())
}

fn ensure_main_window(app: &AppHandle, port: u16) -> Result<(), String> {
    if app.get_webview_window("main").is_some() {
        return Ok(());
    }
    let app_handle = app.clone();
    WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("RoboSats Exp.")
        .inner_size(1180.0, 780.0)
        .min_inner_size(390.0, 620.0)
        .center()
        .decorations(false)
        .visible(false)
        .background_color(tauri::webview::Color(11, 19, 32, 255))
        .proxy_url(proxy_url(port)?)
        .initialization_script("window.RobosatsSettings='desktop-basic';")
        .on_page_load(|window, payload| {
            if payload.event() == PageLoadEvent::Finished {
                show_main_window(window.app_handle());
            }
        })
        .on_navigation(|url| {
            matches!(
                (url.scheme(), url.host_str()),
                ("tauri", Some("localhost")) | ("http", Some("tauri.localhost"))
            )
        })
        .on_new_window(move |url, _| {
            if matches!(url.scheme(), "http" | "https" | "mailto") {
                let _ = tauri_plugin_opener::OpenerExt::opener(&app_handle)
                    .open_url(url.as_str(), None::<&str>);
            }
            tauri::webview::NewWindowResponse::Deny
        })
        .build()
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn proxy_url(port: u16) -> Result<Url, String> {
    Url::parse(&format!("socks5://127.0.0.1:{port}")).map_err(|error| error.to_string())
}

fn show_main_window(app: &AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
    }
    if let Some(splash) = app.get_webview_window("splash") {
        let _ = splash.hide();
    }
}

fn show_splash_window(app: &AppHandle) {
    if let Some(splash) = app.get_webview_window("splash") {
        let _ = splash.show();
        let _ = splash.set_focus();
    }
}

fn clean_stage(stage: &str) -> String {
    let cleaned: String = stage
        .chars()
        .filter(|character| !character.is_control())
        .take(120)
        .collect();
    if cleaned.is_empty() {
        "Establishing private connection...".into()
    } else {
        cleaned
    }
}

fn sanitize_error(error: &str) -> String {
    let lower = error.to_ascii_lowercase();
    if lower.contains("timed out") {
        "Tor took too long to connect. Check the network and try again.".into()
    } else if lower.contains("bind") || lower.contains("address") {
        "The local private connection could not start. Try again.".into()
    } else {
        "Could not establish a private Tor connection.".into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sidecar_message_parses() {
        let message: SidecarMessage =
            serde_json::from_str(r#"{"type":"ready","port":19050,"version":"0.1.0"}"#)
                .expect("message parses");
        assert!(matches!(message, SidecarMessage::Ready { port: 19050, .. }));
    }

    #[test]
    fn diagnostic_messages_parse_without_destination_fields() {
        let message: SidecarMessage = serde_json::from_str(
            r#"{"type":"diagnostic","phase":"tor-connect","outcome":"timeout","duration_ms":1200,"attempt":2,"version":"0.1.0"}"#,
        )
        .expect("message parses");
        assert!(matches!(
            message,
            SidecarMessage::Diagnostic {
                phase,
                outcome,
                duration_ms: 1200,
                attempt: 2,
                ..
            } if phase == "tor-connect" && outcome == "timeout"
        ));
    }

    #[test]
    fn diagnostic_buffer_discards_the_oldest_entry() {
        let mut diagnostics = VecDeque::new();
        for attempt in 1..=(MAX_TRANSPORT_DIAGNOSTICS as u32 + 1) {
            push_diagnostic(
                &mut diagnostics,
                TransportDiagnostic {
                    phase: "tor-connect".into(),
                    outcome: "timeout".into(),
                    duration_ms: 100,
                    attempt,
                    arti_version: "test".into(),
                },
            );
        }
        assert_eq!(diagnostics.len(), MAX_TRANSPORT_DIAGNOSTICS);
        assert_eq!(diagnostics.front().map(|item| item.attempt), Some(2));
        assert_eq!(
            diagnostics.back().map(|item| item.attempt),
            Some(MAX_TRANSPORT_DIAGNOSTICS as u32 + 1)
        );
    }

    #[test]
    fn reset_removes_cache_and_guard_state() {
        let directory =
            std::env::temp_dir().join(format!("robosats-exp-arti-reset-{}", rand::random::<u64>()));
        let guard_file = directory.join("state/state/guards.json");
        let cache_file = directory.join("cache/dir.sqlite3");
        std::fs::create_dir_all(guard_file.parent().expect("guard parent")).unwrap();
        std::fs::create_dir_all(cache_file.parent().expect("cache parent")).unwrap();
        std::fs::write(&guard_file, b"guard state").unwrap();
        std::fs::write(&cache_file, b"directory cache").unwrap();

        clear_arti_data_directory(&directory).expect("Tor data resets");

        assert!(directory.is_dir());
        assert!(!guard_file.exists());
        assert!(!cache_file.exists());
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn errors_are_not_exposed_to_the_interface() {
        assert_eq!(
            sanitize_error("failed to bind 127.0.0.1:1234"),
            "The local private connection could not start. Try again."
        );
    }

    #[test]
    fn health_check_waits_for_bootstrap() {
        let runtime = DesktopRuntime::new(19050);
        let mut inner = runtime.inner.lock().expect("runtime mutex poisoned");
        assert!(health_check_deferred(&inner.status));
        assert!(!start_allowed(&inner, StartPolicy::AutomaticRecovery));
        inner.status.state = "connecting".into();
        assert!(health_check_deferred(&inner.status));
        assert!(!start_allowed(&inner, StartPolicy::AutomaticRecovery));
        inner.status.state = "ready".into();
        assert!(!health_check_deferred(&inner.status));
        assert!(start_allowed(&inner, StartPolicy::AutomaticRecovery));
        assert!(!start_allowed(&inner, StartPolicy::Normal));
        assert!(start_allowed(&inner, StartPolicy::Force));
    }

    #[test]
    fn delayed_retry_only_restarts_the_generation_that_failed() {
        let runtime = DesktopRuntime::new(19050);
        let mut inner = runtime.inner.lock().expect("runtime mutex poisoned");
        inner.generation = 4;
        inner.status.state = "failed".into();
        assert!(start_allowed(&inner, StartPolicy::FailedGeneration(4)));
        assert!(!start_allowed(&inner, StartPolicy::FailedGeneration(3)));
        inner.status.state = "connecting".into();
        assert!(!start_allowed(&inner, StartPolicy::FailedGeneration(4)));
    }

    #[test]
    fn proxy_url_uses_the_runtime_port() {
        assert_eq!(
            proxy_url(19050).expect("proxy URL parses").as_str(),
            "socks5://127.0.0.1:19050"
        );
    }
}
