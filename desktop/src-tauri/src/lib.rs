mod preferences;
mod runtime;

use preferences::Preferences;
use runtime::{DesktopRuntime, RuntimeStatus};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::menu::MenuBuilder;
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;

struct PreferenceState(Mutex<Preferences>);

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
}

#[tauri::command]
fn desktop_runtime_status(runtime: State<'_, DesktopRuntime>) -> RuntimeStatus {
    runtime.status()
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
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|error| error.to_string())?;
    Ok(true)
}

#[tauri::command]
fn desktop_retry(app: AppHandle, runtime: State<'_, DesktopRuntime>) {
    runtime.start(app, true);
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
    if online {
        runtime.health_check(app);
    }
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
        .invoke_handler(tauri::generate_handler![
            desktop_runtime_status,
            desktop_notification_state,
            desktop_set_notifications_enabled,
            desktop_show_notification,
            desktop_retry,
            desktop_boot_stage,
            desktop_app_ready,
            desktop_network_changed,
            desktop_open_external,
            desktop_quit
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
        RunEvent::Exit => runtime_for_events.stop(),
        _ => {}
    });
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
    fn external_urls_reject_script_schemes() {
        assert!(valid_external_url("https://learn.robosats.com/"));
        assert!(valid_external_url("lightning:lnbc1example"));
        assert!(!valid_external_url("javascript:alert(1)"));
    }
}
