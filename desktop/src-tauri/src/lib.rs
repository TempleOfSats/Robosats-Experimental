mod preferences;
mod runtime;
mod secure_storage;

use base64::Engine;
use notify_rust::{Notification, NotificationResponse, Timeout};
use preferences::Preferences;
use runtime::{DesktopRuntime, RuntimeStatus, TransportDiagnostic};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::menu::MenuBuilder;
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WindowEvent};
use tauri_plugin_opener::OpenerExt;

struct PreferenceState(Mutex<Preferences>);
struct PendingNotificationRoute(Mutex<Option<String>>);

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
struct NotificationState {
    supported: bool,
    enabled: bool,
    permission: &'static str,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NotificationRequest {
    title: String,
    body: String,
    route: Option<String>,
    avatar: Option<NotificationAvatar>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NotificationAvatar {
    cache_key: String,
    data_url: String,
}

#[tauri::command]
fn desktop_runtime_status(runtime: State<'_, DesktopRuntime>) -> RuntimeStatus {
    runtime.status()
}

#[tauri::command]
fn desktop_transport_diagnostics(runtime: State<'_, DesktopRuntime>) -> Vec<TransportDiagnostic> {
    runtime.diagnostics()
}

#[tauri::command]
fn desktop_notification_state(state: State<'_, PreferenceState>) -> NotificationState {
    let preferences = *state.0.lock().expect("preference mutex poisoned");
    NotificationState {
        supported: true,
        enabled: preferences.notifications_enabled,
        permission: if preferences.notifications_enabled {
            "granted"
        } else {
            "default"
        },
    }
}

#[tauri::command]
fn desktop_set_notifications_enabled(
    app: AppHandle,
    state: State<'_, PreferenceState>,
    enabled: bool,
) -> Result<NotificationState, String> {
    let preferences = Preferences {
        notifications_enabled: enabled,
    };
    preferences::save(&app, preferences).map_err(|error| error.to_string())?;
    *state.0.lock().expect("preference mutex poisoned") = preferences;
    if enabled {
        if let Err(error) = show_native_notification(
            &app,
            "RoboSats notifications",
            "Trade updates will appear here.",
            None,
            None,
        ) {
            let disabled = Preferences {
                notifications_enabled: false,
            };
            let _ = preferences::save(&app, disabled);
            *state.0.lock().expect("preference mutex poisoned") = disabled;
            return Err(error);
        }
    }
    let notification_state = NotificationState {
        supported: true,
        enabled,
        permission: if enabled { "granted" } else { "default" },
    };
    let _ = app.emit("desktop-notification-state", notification_state);
    Ok(notification_state)
}

#[tauri::command]
fn desktop_show_notification(
    app: AppHandle,
    state: State<'_, PreferenceState>,
    request: NotificationRequest,
) -> Result<bool, String> {
    if !state
        .0
        .lock()
        .expect("preference mutex poisoned")
        .notifications_enabled
    {
        return Ok(false);
    }
    if app
        .get_webview_window("main")
        .and_then(|window| window.is_focused().ok())
        .unwrap_or(false)
    {
        return Ok(false);
    }
    let title = clean_text(&request.title, 80);
    let body = clean_text(&request.body, 240);
    if title.is_empty() || body.is_empty() {
        return Ok(false);
    }
    if request
        .route
        .as_deref()
        .is_some_and(|route| !valid_order_route(route))
    {
        return Err("Invalid notification route".into());
    }
    let avatar_path = request
        .avatar
        .as_ref()
        .and_then(|avatar| cache_notification_avatar(&app, avatar).ok());
    show_native_notification(&app, &title, &body, request.route, avatar_path.as_deref())?;
    Ok(true)
}

#[tauri::command]
fn desktop_take_notification_route(state: State<'_, PendingNotificationRoute>) -> Option<String> {
    state
        .0
        .lock()
        .expect("notification route mutex poisoned")
        .take()
}

#[tauri::command]
fn desktop_retry(app: AppHandle, runtime: State<'_, DesktopRuntime>) {
    runtime.start(app, true);
}

#[tauri::command]
fn desktop_recover_transport(app: AppHandle, runtime: State<'_, DesktopRuntime>) {
    runtime.recover_transport(app);
}

#[tauri::command]
fn desktop_reconnect_transport(app: AppHandle, runtime: State<'_, DesktopRuntime>) {
    runtime.reconnect_transport(app);
}

#[tauri::command]
fn desktop_reset_transport(app: AppHandle, runtime: State<'_, DesktopRuntime>) {
    runtime.reset_transport(app);
}

#[tauri::command]
fn desktop_save_file(app: AppHandle, filename: String, content: String) -> Result<(), String> {
    const MAX_FILE_BYTES: usize = 8 * 1024 * 1024;
    if content.len() > MAX_FILE_BYTES {
        return Err("Export is too large to save".into());
    }
    let filename = sanitize_download_filename(&filename)?;
    let directory = app
        .path()
        .download_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let path = next_download_path(&directory, &filename)?;
    fs::write(path, content).map_err(|error| error.to_string())
}

#[tauri::command]
fn desktop_boot_stage(app: AppHandle, progress: u8, message: String) {
    let status = serde_json::json!({
        "state": "loading",
        "connected": true,
        "progress": progress.clamp(1, 99),
        "message": clean_text(&message, 120),
        "error": null
    });
    let _ = app.emit("desktop-runtime-status", status);
}

#[tauri::command]
fn desktop_app_ready(app: AppHandle, runtime: State<'_, DesktopRuntime>) {
    runtime.mark_app_ready(&app);
}

#[tauri::command]
fn desktop_network_changed(app: AppHandle, runtime: State<'_, DesktopRuntime>, online: bool) {
    runtime.network_changed(app, online);
}

#[tauri::command]
fn desktop_open_external(app: AppHandle, url: String) -> Result<(), String> {
    if !valid_external_url(&url) {
        return Err("Unsupported external URL".into());
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn desktop_quit(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn desktop_secret_get(app: AppHandle, key: String) -> Result<Option<String>, String> {
    secure_storage::get(&app, &key)
}

#[tauri::command]
fn desktop_secret_set(app: AppHandle, key: String, value: String) -> Result<(), String> {
    secure_storage::set(&app, &key, &value)
}

#[tauri::command]
fn desktop_secret_delete(app: AppHandle, key: String) -> Result<(), String> {
    secure_storage::delete(&app, &key)
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let menu = MenuBuilder::new(app)
        .text("show", "Show RoboSats")
        .separator()
        .text("quit", "Quit")
        .build()?;
    let mut builder = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("RoboSats Exp.")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                } else if let Some(window) = app.get_webview_window("splash") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "quit" => app.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    builder.build(app)?;
    Ok(())
}

pub fn run() {
    let runtime = runtime::create_runtime().expect("could not allocate local Arti proxy port");
    let runtime_for_setup = runtime.clone();
    let runtime_for_events = runtime.clone();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .manage(runtime)
        .manage(PendingNotificationRoute(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            desktop_runtime_status,
            desktop_transport_diagnostics,
            desktop_notification_state,
            desktop_set_notifications_enabled,
            desktop_show_notification,
            desktop_take_notification_route,
            desktop_retry,
            desktop_recover_transport,
            desktop_reconnect_transport,
            desktop_reset_transport,
            desktop_save_file,
            desktop_boot_stage,
            desktop_app_ready,
            desktop_network_changed,
            desktop_open_external,
            desktop_quit,
            desktop_secret_get,
            desktop_secret_set,
            desktop_secret_delete
        ])
        .setup(move |app| {
            app.manage(PreferenceState(Mutex::new(preferences::load(app.handle()))));
            setup_tray(app)?;
            runtime::create_splash_window(app.handle(), runtime_for_setup.status().socks_port)
                .map_err(std::io::Error::other)?;
            runtime_for_setup.start(app.handle().clone(), false);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building RoboSats desktop");

    app.run(move |app, event| match event {
        RunEvent::Resumed => runtime_for_events.health_check(app.clone()),
        RunEvent::WindowEvent {
            label,
            event: WindowEvent::CloseRequested { api, .. },
            ..
        } if label == "main" && notifications_enabled(app) => {
            api.prevent_close();
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.hide();
            }
        }
        RunEvent::Exit => runtime_for_events.stop(),
        _ => {}
    });
}

fn sanitize_download_filename(filename: &str) -> Result<String, String> {
    if filename.is_empty()
        || filename.len() > 160
        || filename.contains('/')
        || filename.contains('\\')
    {
        return Err("Invalid export filename".into());
    }
    let sanitized = filename
        .chars()
        .map(|character| {
            if character.is_control()
                || matches!(character, '<' | '>' | ':' | '"' | '|' | '?' | '*')
            {
                '-'
            } else {
                character
            }
        })
        .collect::<String>();
    let sanitized = sanitized
        .trim()
        .trim_end_matches(|character| character == '.' || character == ' ')
        .to_string();
    if sanitized.is_empty() || sanitized == "." || sanitized == ".." {
        return Err("Invalid export filename".into());
    }
    Ok(sanitized)
}

fn next_download_path(directory: &Path, filename: &str) -> Result<PathBuf, String> {
    let source = Path::new(filename);
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(filename);
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    for suffix in 0..1000 {
        let candidate_name = if suffix == 0 {
            filename.to_string()
        } else if extension.is_empty() {
            format!("{stem} ({suffix})")
        } else {
            format!("{stem} ({suffix}).{extension}")
        };
        let candidate = directory.join(candidate_name);
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err("Could not choose a free export filename".into())
}

fn notifications_enabled(app: &AppHandle) -> bool {
    app.state::<PreferenceState>()
        .0
        .lock()
        .expect("preference mutex poisoned")
        .notifications_enabled
}

fn show_native_notification(
    app: &AppHandle,
    title: &str,
    body: &str,
    route: Option<String>,
    avatar_path: Option<&std::path::Path>,
) -> Result<(), String> {
    let mut notification = Notification::new();
    notification
        .summary(title)
        .body(body)
        .appname("RoboSats Exp.")
        .auto_icon()
        .timeout(Timeout::Milliseconds(12_000))
        .action("default", "Open");
    if let Some(path) = avatar_path.and_then(|path| path.to_str()) {
        notification.image_path(path);
    }

    #[cfg(windows)]
    configure_windows_notification(app, &mut notification);

    #[cfg(target_os = "macos")]
    {
        let identifier = if tauri::is_dev() {
            "com.apple.Terminal"
        } else {
            app.config().identifier.as_str()
        };
        let _ = notify_rust::set_application(identifier);
    }

    let handle = notification.show().map_err(|error| error.to_string())?;
    if let Some(route) = route {
        let app = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let _ = handle.wait_for_response(move |response: &NotificationResponse| {
                if matches!(
                    response,
                    NotificationResponse::Default | NotificationResponse::Action(_)
                ) {
                    open_notification_route(&app, &route);
                }
            });
        });
    }
    Ok(())
}

fn cache_notification_avatar(
    app: &AppHandle,
    avatar: &NotificationAvatar,
) -> Result<PathBuf, String> {
    if avatar.cache_key.len() != 64
        || !avatar
            .cache_key
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return Err("Invalid notification avatar key".into());
    }
    let png = decode_notification_avatar(&avatar.data_url)?;
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("notification-avatars");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let path = directory.join(format!("{}.png", avatar.cache_key.to_ascii_lowercase()));
    fs::write(&path, png).map_err(|error| error.to_string())?;
    Ok(path)
}

fn decode_notification_avatar(data_url: &str) -> Result<Vec<u8>, String> {
    const PREFIX: &str = "data:image/png;base64,";
    const MAX_ENCODED_BYTES: usize = 350_000;
    let encoded = data_url
        .strip_prefix(PREFIX)
        .ok_or("Invalid notification avatar format")?;
    if encoded.len() > MAX_ENCODED_BYTES {
        return Err("Notification avatar is too large".into());
    }
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|_| "Invalid notification avatar encoding")?;
    if !decoded.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("Invalid notification avatar image".into());
    }
    Ok(decoded)
}

#[cfg(windows)]
fn configure_windows_notification(app: &AppHandle, notification: &mut Notification) {
    use std::path::MAIN_SEPARATOR;

    let installed = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.display().to_string()))
        .is_some_and(|directory| {
            !directory.ends_with(&format!("{MAIN_SEPARATOR}target{MAIN_SEPARATOR}debug"))
                && !directory.ends_with(&format!("{MAIN_SEPARATOR}target{MAIN_SEPARATOR}release"))
        });
    if installed {
        notification.app_id(&app.config().identifier);
    }
}

fn open_notification_route(app: &AppHandle, route: &str) {
    *app.state::<PendingNotificationRoute>()
        .0
        .lock()
        .expect("notification route mutex poisoned") = Some(route.to_owned());
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    let _ = app.emit("desktop-notification-open", route);
}

fn clean_text(value: &str, maximum: usize) -> String {
    value
        .chars()
        .filter(|character| !character.is_control())
        .take(maximum)
        .collect::<String>()
        .trim()
        .to_owned()
}

fn valid_order_route(route: &str) -> bool {
    let parts: Vec<_> = route.trim_matches('/').split('/').collect();
    parts.len() == 3
        && parts[0] == "order"
        && !parts[1].is_empty()
        && parts[1]
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
        && parts[2].parse::<u64>().is_ok()
}

fn valid_external_url(value: &str) -> bool {
    url::Url::parse(value).ok().is_some_and(|url| {
        matches!(
            url.scheme(),
            "http" | "https" | "mailto" | "bitcoin" | "lightning"
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notification_routes_are_narrowly_validated() {
        assert!(valid_order_route("/order/temple/90828"));
        assert!(!valid_order_route("/settings"));
        assert!(!valid_order_route("/order/../90828"));
    }

    #[test]
    fn notification_avatars_require_bounded_png_data() {
        let png = "data:image/png;base64,iVBORw0KGgo=";
        assert_eq!(
            decode_notification_avatar(png).unwrap(),
            b"\x89PNG\r\n\x1a\n"
        );
        assert!(decode_notification_avatar("data:image/svg+xml;base64,PHN2Zz4=").is_err());
        assert!(decode_notification_avatar("data:image/png;base64,bm90LXBuZw==").is_err());
    }

    #[test]
    fn external_urls_reject_script_schemes() {
        assert!(valid_external_url("https://learn.robosats.com/"));
        assert!(valid_external_url("lightning:lnbc1example"));
        assert!(!valid_external_url("javascript:alert(1)"));
    }

    #[test]
    fn download_names_are_leaf_only_and_safe() {
        assert_eq!(
            sanitize_download_filename("trade.json").unwrap(),
            "trade.json"
        );
        assert!(sanitize_download_filename("../trade.json").is_err());
        assert_eq!(
            sanitize_download_filename("trade<1>.json").unwrap(),
            "trade-1-.json"
        );
    }

    #[test]
    fn download_paths_do_not_overwrite_existing_exports() {
        let directory =
            std::env::temp_dir().join(format!("robosats-download-test-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(directory.join("trade.json"), "existing").unwrap();
        assert_eq!(
            next_download_path(&directory, "trade.json")
                .unwrap()
                .file_name()
                .and_then(|value| value.to_str()),
            Some("trade (1).json")
        );
        let _ = std::fs::remove_dir_all(directory);
    }
}
