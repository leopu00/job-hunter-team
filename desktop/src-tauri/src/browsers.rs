//! I browser installati, per scegliere dove aprire il login.
//!
//! Il frontend riceve solo `id` e nome; per aprire rimanda l'`id`, e il
//! percorso lo si ricava di nuovo qui dalla tabella: dal frontend non arriva
//! mai un eseguibile da lanciare. Il lancio passa argomenti separati a
//! `Command`, senza shell in mezzo, e l'URL è già stato controllato da
//! `auth_login`.

use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Browser {
    pub(crate) id: &'static str,
    pub(crate) name: &'static str,
    #[serde(skip)]
    pub(crate) path: PathBuf,
}

/// (id, nome, bundle `.app` in /Applications o ~/Applications)
#[cfg(target_os = "macos")]
const MACOS_BROWSERS: &[(&str, &str, &str)] = &[
    ("chrome", "Google Chrome", "Google Chrome.app"),
    (
        "chrome-canary",
        "Google Chrome Canary",
        "Google Chrome Canary.app",
    ),
    (
        "chrome-beta",
        "Google Chrome Beta",
        "Google Chrome Beta.app",
    ),
    ("chrome-dev", "Google Chrome Dev", "Google Chrome Dev.app"),
    ("chromium", "Chromium", "Chromium.app"),
    ("safari", "Safari", "Safari.app"),
    ("firefox", "Firefox", "Firefox.app"),
    (
        "firefox-dev",
        "Firefox Developer Edition",
        "Firefox Developer Edition.app",
    ),
    ("firefox-nightly", "Firefox Nightly", "Firefox Nightly.app"),
    ("edge", "Microsoft Edge", "Microsoft Edge.app"),
    ("brave", "Brave", "Brave Browser.app"),
    ("arc", "Arc", "Arc.app"),
    ("vivaldi", "Vivaldi", "Vivaldi.app"),
    ("opera", "Opera", "Opera.app"),
    ("zen", "Zen", "Zen.app"),
];

/// (id, nome, base, percorso relativo): base 0 = %ProgramFiles%,
/// 1 = %ProgramFiles(x86)%, 2 = %LOCALAPPDATA%. Si prova in tutte e tre.
#[cfg(target_os = "windows")]
const WINDOWS_BROWSERS: &[(&str, &str, &str)] = &[
    (
        "chrome",
        "Google Chrome",
        r"Google\Chrome\Application\chrome.exe",
    ),
    (
        "chrome-canary",
        "Google Chrome Canary",
        r"Google\Chrome SxS\Application\chrome.exe",
    ),
    (
        "chrome-beta",
        "Google Chrome Beta",
        r"Google\Chrome Beta\Application\chrome.exe",
    ),
    (
        "chrome-dev",
        "Google Chrome Dev",
        r"Google\Chrome Dev\Application\chrome.exe",
    ),
    (
        "edge",
        "Microsoft Edge",
        r"Microsoft\Edge\Application\msedge.exe",
    ),
    ("firefox", "Firefox", r"Mozilla Firefox\firefox.exe"),
    (
        "firefox-dev",
        "Firefox Developer Edition",
        r"Firefox Developer Edition\firefox.exe",
    ),
    (
        "brave",
        "Brave",
        r"BraveSoftware\Brave-Browser\Application\brave.exe",
    ),
    ("vivaldi", "Vivaldi", r"Vivaldi\Application\vivaldi.exe"),
    ("opera", "Opera", r"Programs\Opera\opera.exe"),
];

/// (id, nome, eseguibili da cercare nel PATH, il primo trovato vince)
#[cfg(all(unix, not(target_os = "macos")))]
const LINUX_BROWSERS: &[(&str, &str, &[&str])] = &[
    (
        "chrome",
        "Google Chrome",
        &["google-chrome-stable", "google-chrome"],
    ),
    ("chrome-beta", "Google Chrome Beta", &["google-chrome-beta"]),
    (
        "chrome-dev",
        "Google Chrome Dev",
        &["google-chrome-unstable"],
    ),
    ("chromium", "Chromium", &["chromium", "chromium-browser"]),
    ("firefox", "Firefox", &["firefox"]),
    (
        "firefox-dev",
        "Firefox Developer Edition",
        &["firefox-developer-edition"],
    ),
    (
        "edge",
        "Microsoft Edge",
        &["microsoft-edge-stable", "microsoft-edge"],
    ),
    ("brave", "Brave", &["brave-browser", "brave"]),
    ("vivaldi", "Vivaldi", &["vivaldi-stable", "vivaldi"]),
    ("opera", "Opera", &["opera"]),
];

/// L'elenco per la schermata di login.
#[tauri::command]
pub(crate) fn auth_browsers() -> Vec<Browser> {
    installed()
}

pub(crate) fn installed() -> Vec<Browser> {
    detect(&search_roots())
}

#[cfg(target_os = "macos")]
fn search_roots() -> Vec<PathBuf> {
    let mut roots = vec![PathBuf::from("/Applications")];
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        if home.is_absolute() {
            roots.push(home.join("Applications"));
        }
    }
    roots
}

#[cfg(target_os = "windows")]
fn search_roots() -> Vec<PathBuf> {
    ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"]
        .iter()
        .filter_map(std::env::var_os)
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .collect()
}

#[cfg(all(unix, not(target_os = "macos")))]
fn search_roots() -> Vec<PathBuf> {
    std::env::var_os("PATH")
        .map(|path| std::env::split_paths(&path).collect::<Vec<_>>())
        .unwrap_or_default()
        .into_iter()
        .filter(|path| path.is_absolute())
        .collect()
}

#[cfg(target_os = "macos")]
fn detect(roots: &[PathBuf]) -> Vec<Browser> {
    MACOS_BROWSERS
        .iter()
        .filter_map(|(id, name, bundle)| {
            roots
                .iter()
                .map(|root| root.join(bundle))
                .find(|path| path.is_dir())
                .map(|path| Browser { id, name, path })
        })
        .collect()
}

#[cfg(target_os = "windows")]
fn detect(roots: &[PathBuf]) -> Vec<Browser> {
    WINDOWS_BROWSERS
        .iter()
        .filter_map(|(id, name, relative)| {
            roots
                .iter()
                .map(|root| root.join(relative))
                .find(|path| path.is_file())
                .map(|path| Browser { id, name, path })
        })
        .collect()
}

#[cfg(all(unix, not(target_os = "macos")))]
fn detect(roots: &[PathBuf]) -> Vec<Browser> {
    use std::os::unix::fs::PermissionsExt;
    LINUX_BROWSERS
        .iter()
        .filter_map(|(id, name, binaries)| {
            binaries
                .iter()
                .flat_map(|binary| roots.iter().map(move |root| root.join(binary)))
                .find(|path| {
                    std::fs::metadata(path)
                        .map(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
                        .unwrap_or(false)
                })
                .map(|path| Browser { id, name, path })
        })
        .collect()
}

/// Apre `url` nel browser scelto. Il processo non si aspetta: un thread lo
/// raccoglie quando esce, così non restano zombie.
pub(crate) fn open_in(browser: &Browser, url: &str) -> std::io::Result<()> {
    let mut child = launch_command(&browser.path, url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

#[cfg(target_os = "macos")]
fn launch_command(app: &Path, url: &str) -> Command {
    let mut command = Command::new("/usr/bin/open");
    command.arg("-a").arg(app).arg(url);
    command
}

#[cfg(not(target_os = "macos"))]
fn launch_command(executable: &Path, url: &str) -> Command {
    let mut command = Command::new(executable);
    command.arg(url);
    command
}

#[cfg(test)]
mod tests {
    // `detect` ha test solo su macOS e Linux: su Windows l'import resterebbe inutilizzato.
    #[cfg(not(target_os = "windows"))]
    use super::detect;
    use super::launch_command;
    use std::{
        fs,
        path::{Path, PathBuf},
        time::{SystemTime, UNIX_EPOCH},
    };

    #[allow(dead_code)]
    fn scratch_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("jht-browsers-{name}-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn finds_bundles_in_either_applications_folder_in_table_order() {
        let system = scratch_dir("system");
        let user = scratch_dir("user");
        fs::create_dir_all(system.join("Google Chrome.app")).unwrap();
        fs::create_dir_all(user.join("Google Chrome Canary.app")).unwrap();
        // Un file con il nome giusto non è un'app.
        fs::write(system.join("Firefox.app"), "").unwrap();
        let found = detect(&[system.clone(), user.clone()]);
        let ids: Vec<_> = found.iter().map(|browser| browser.id).collect();
        assert_eq!(ids, ["chrome", "chrome-canary"]);
        assert_eq!(found[1].path, user.join("Google Chrome Canary.app"));
        fs::remove_dir_all(system).unwrap();
        fs::remove_dir_all(user).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn the_url_is_its_own_argument_to_open() {
        let url = "https://example.supabase.co/auth/v1/authorize?a=1&b=$(x) `y`";
        let command = launch_command(Path::new("/Applications/Google Chrome Canary.app"), url);
        assert_eq!(command.get_program(), "/usr/bin/open");
        let args: Vec<_> = command.get_args().collect();
        assert_eq!(args, ["-a", "/Applications/Google Chrome Canary.app", url]);
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    #[test]
    fn finds_only_executables_on_the_path() {
        use std::os::unix::fs::PermissionsExt;
        let bin = scratch_dir("bin");
        let chrome = bin.join("google-chrome");
        fs::write(&chrome, "").unwrap();
        fs::set_permissions(&chrome, fs::Permissions::from_mode(0o755)).unwrap();
        fs::write(bin.join("firefox"), "").unwrap();
        let found = detect(&[bin.clone()]);
        assert_eq!(found.iter().map(|b| b.id).collect::<Vec<_>>(), ["chrome"]);
        fs::remove_dir_all(bin).unwrap();
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn the_url_is_its_own_argument_to_the_browser() {
        let url = "https://example.supabase.co/auth/v1/authorize?a=1&b=2";
        let command = launch_command(Path::new("/opt/browser"), url);
        assert_eq!(command.get_args().collect::<Vec<_>>(), [url]);
    }
}
