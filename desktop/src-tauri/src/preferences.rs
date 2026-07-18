use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::Path;
use tauri::{AppHandle, Manager};

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    pub notifications_enabled: bool,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            notifications_enabled: false,
        }
    }
}

pub fn load(app: &AppHandle) -> Preferences {
    let Ok(path) = path(app) else {
        return Preferences::default();
    };
    fs::read(path)
        .ok()
        .and_then(|contents| serde_json::from_slice(&contents).ok())
        .unwrap_or_default()
}

pub fn save(app: &AppHandle, preferences: Preferences) -> io::Result<()> {
    let path = path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, serde_json::to_vec(&preferences)?)?;
    restrict_permissions(&temporary)?;
    fs::rename(temporary, path)
}

fn path(app: &AppHandle) -> io::Result<std::path::PathBuf> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join("desktop-preferences.json"))
        .map_err(io::Error::other)
}

#[cfg(unix)]
fn restrict_permissions(path: &Path) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
}

#[cfg(not(unix))]
fn restrict_permissions(_path: &Path) -> io::Result<()> {
    Ok(())
}
