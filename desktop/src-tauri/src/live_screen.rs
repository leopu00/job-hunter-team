//! Finestra staccata che mostra lo schermo del CLOSER.
//!
//! Il container `jht` tiene un display X virtuale su cui il browser del CLOSER
//! gira headed (`.launcher/live-screen.sh`) e ne pubblica uno stream VNC in sola
//! visione, via websockify, su `127.0.0.1`. Qui l'app apre una seconda finestra
//! — spostabile e ridimensionabile per conto suo — che si collega a quello
//! stream con il client noVNC incluso nel frontend.
//!
//! Lo schermo mostra CV e form di candidatura, quindi:
//! - l'host dello stream è fisso su loopback: nessuna configurazione può
//!   puntare la finestra a un'altra macchina;
//! - la password VNC cambia a ogni avvio dello schermo e vive in
//!   `~/.jht/live-screen/viewer-password` (0600, bind-mount del container):
//!   si legge solo se è un file regolare, piccolo e con la forma attesa.

use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use zeroize::Zeroizing;

pub(crate) const WINDOW_LABEL: &str = "live-screen";
const DEFAULT_PORT: u16 = 6080;
const PASSWORD_RELATIVE_PATH: [&str; 2] = ["live-screen", "viewer-password"];
const PASSWORD_LEN: usize = 8;
const MAX_PASSWORD_FILE_BYTES: u64 = 64;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LiveScreenError {
    code: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LiveScreenSession {
    url: String,
    password: String,
}

/// Apre la finestra dello schermo live, o la riporta in primo piano se c'è già.
/// `async` è obbligatorio: su Windows creare una finestra da un comando
/// sincrono blocca il thread che dovrebbe disegnarla.
#[tauri::command]
pub(crate) async fn open_live_screen(app: tauri::AppHandle) -> Result<(), LiveScreenError> {
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        return window.set_focus().map_err(|_| failure("window_failed"));
    }
    WebviewWindowBuilder::new(
        &app,
        WINDOW_LABEL,
        WebviewUrl::App("live-screen.html".into()),
    )
    .title("CLOSER · schermo live")
    .inner_size(1180.0, 860.0)
    .min_inner_size(480.0, 360.0)
    .resizable(true)
    .build()
    .map(|_| ())
    .map_err(|_| failure("window_failed"))
}

/// Dati di connessione per la finestra: URL WebSocket su loopback e password
/// del giro corrente. Riletti a ogni tentativo, perché un riavvio del
/// container ruota la password.
#[tauri::command]
pub(crate) fn live_screen_session(
    app: tauri::AppHandle,
) -> Result<LiveScreenSession, LiveScreenError> {
    let port = parse_port(std::env::var("JHT_LIVE_SCREEN_PORT").ok().as_deref())?;
    let jht_home = jht_home_dir(
        std::env::var_os("JHT_HOME").map(PathBuf::from),
        app.path().home_dir().ok(),
    )
    .ok_or_else(|| failure("home_missing"))?;
    let password = read_password(&password_path(&jht_home))?;
    Ok(LiveScreenSession {
        url: stream_url(port),
        password: password.to_string(),
    })
}

fn parse_port(value: Option<&str>) -> Result<u16, LiveScreenError> {
    match value.map(str::trim) {
        None | Some("") => Ok(DEFAULT_PORT),
        Some(raw) => match raw.parse::<u16>() {
            Ok(port) if port >= 1024 => Ok(port),
            _ => Err(failure("invalid_port")),
        },
    }
}

fn stream_url(port: u16) -> String {
    format!("ws://127.0.0.1:{port}/websockify")
}

fn jht_home_dir(env_home: Option<PathBuf>, user_home: Option<PathBuf>) -> Option<PathBuf> {
    env_home
        .filter(|path| path.is_absolute())
        .or_else(|| user_home.map(|home| home.join(".jht")))
}

fn password_path(jht_home: &Path) -> PathBuf {
    PASSWORD_RELATIVE_PATH
        .iter()
        .fold(jht_home.to_path_buf(), |path, part| path.join(part))
}

fn read_password(path: &Path) -> Result<Zeroizing<String>, LiveScreenError> {
    // symlink_metadata, non metadata: un link verso un altro file non deve
    // trasformare la finestra in un lettore di file arbitrari.
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(_) => return Err(failure("screen_not_running")),
    };
    if !metadata.file_type().is_file() || metadata.len() > MAX_PASSWORD_FILE_BYTES {
        return Err(failure("invalid_password"));
    }
    let raw = Zeroizing::new(fs::read_to_string(path).map_err(|_| failure("screen_not_running"))?);
    let password = raw.trim();
    if password.len() != PASSWORD_LEN || !password.bytes().all(|byte| byte.is_ascii_alphanumeric())
    {
        return Err(failure("invalid_password"));
    }
    Ok(Zeroizing::new(password.to_string()))
}

fn failure(code: &'static str) -> LiveScreenError {
    LiveScreenError { code }
}

#[cfg(test)]
mod tests {
    use super::{jht_home_dir, parse_port, password_path, read_password, stream_url};
    use std::{
        fs,
        path::{Path, PathBuf},
        time::{SystemTime, UNIX_EPOCH},
    };

    fn scratch_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("jht-live-screen-{name}-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn stream_url_is_always_loopback() {
        assert_eq!(stream_url(6080), "ws://127.0.0.1:6080/websockify");
        assert_eq!(parse_port(None).unwrap(), 6080);
        assert_eq!(parse_port(Some(" 7090 ")).unwrap(), 7090);
    }

    #[test]
    fn rejects_privileged_or_malformed_ports() {
        for value in ["80", "0", "65536", "6080; rm", "example.org:6080", "-1"] {
            assert_eq!(
                parse_port(Some(value)).unwrap_err().code,
                "invalid_port",
                "{value}"
            );
        }
    }

    #[test]
    fn resolves_the_password_under_the_jht_home() {
        let home = jht_home_dir(None, Some(PathBuf::from("/Users/synthetic"))).unwrap();
        assert_eq!(
            password_path(&home),
            Path::new("/Users/synthetic/.jht/live-screen/viewer-password")
        );
        let custom = jht_home_dir(
            Some(PathBuf::from("/srv/jht")),
            Some(PathBuf::from("/Users/synthetic")),
        );
        assert_eq!(custom.unwrap(), Path::new("/srv/jht"));
        // Un JHT_HOME relativo dipenderebbe dalla cartella da cui parte l'app.
        let relative = jht_home_dir(
            Some(PathBuf::from("jht")),
            Some(PathBuf::from("/Users/synthetic")),
        );
        assert_eq!(relative.unwrap(), Path::new("/Users/synthetic/.jht"));
    }

    #[test]
    fn reads_only_a_well_formed_password() {
        let dir = scratch_dir("password");
        let path = dir.join("viewer-password");

        assert_eq!(read_password(&path).unwrap_err().code, "screen_not_running");

        fs::write(&path, "Ab3dE6gH\n").unwrap();
        assert_eq!(read_password(&path).unwrap().as_str(), "Ab3dE6gH");

        for bad in ["short", "Ab3dE6gH9", "Ab3d E6g", "Ab3dE6g!", ""] {
            fs::write(&path, bad).unwrap();
            assert_eq!(
                read_password(&path).unwrap_err().code,
                "invalid_password",
                "{bad:?}"
            );
        }

        fs::write(&path, "A".repeat(4096)).unwrap();
        assert_eq!(read_password(&path).unwrap_err().code, "invalid_password");
        fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_symlinked_password_file() {
        let dir = scratch_dir("symlink");
        let target = dir.join("elsewhere");
        fs::write(&target, "Ab3dE6gH").unwrap();
        let link = dir.join("viewer-password");
        // Target relativo e corto: la dimensione di un symlink è la lunghezza
        // del percorso a cui punta, e un percorso assoluto lungo verrebbe
        // rifiutato dal limite di dimensione — il test passerebbe senza
        // provare il controllo sul tipo di file.
        std::os::unix::fs::symlink("elsewhere", &link).unwrap();
        assert_eq!(read_password(&link).unwrap_err().code, "invalid_password");
        fs::remove_dir_all(dir).unwrap();
    }
}
