use std::process::Command;
use crate::config::{self, SetupConfig};
use crate::log::log;

/// Paths where Homebrew and common user-installed CLIs live on macOS.
/// Apps launched from Finder don't inherit the user's shell PATH, so we
/// prepend them explicitly to every shell invocation.
const EXTRA_PATHS: &str =
    "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";

fn sh(script: &str) -> Result<String, String> {
    let wrapped = format!("export PATH={}:$PATH; {}", EXTRA_PATHS, script);
    let output = Command::new("/bin/bash")
        .args(["-c", &wrapped])
        .output()
        .map_err(|e| format!("Shell command failed: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Err(if stderr.is_empty() { stdout } else { stderr })
    }
}

fn has(cmd: &str) -> bool {
    sh(&format!("command -v {}", cmd)).is_ok()
}

/// Show a native AppleScript info dialog.
fn notify(title: &str, message: &str) {
    let script = format!(
        r#"display dialog "{}" with icon note with title "{}" buttons {{"OK"}} default button 1"#,
        escape_applescript(message),
        escape_applescript(title)
    );
    let _ = Command::new("osascript").args(["-e", &script]).output();
}

fn escape_applescript(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

/// Install Homebrew non-interactively. Asks the user for the macOS password
/// via a native AppleScript dialog, caches sudo credentials, then runs the
/// official install script with NONINTERACTIVE=1 so it never stops for
/// keyboard input.
fn install_homebrew() -> Result<(), String> {
    log("Installing Homebrew...");

    let install_script = r#"
set -e
pw=$(osascript <<'APPLESCRIPT' 2>/dev/null
try
  set dlg to display dialog "Per installare Homebrew (il gestore pacchetti usato per tmux e Node.js) serve la password del tuo Mac." default answer "" with hidden answer with icon note with title "JHT Desktop - Installazione dipendenze"
  return text returned of dlg
on error
  return ""
end try
APPLESCRIPT
)

if [ -z "$pw" ]; then
  echo "__JHT_CANCELLED__" >&2
  exit 2
fi

if ! echo "$pw" | sudo -S -v 2>/dev/null; then
  echo "__JHT_BAD_PASSWORD__" >&2
  exit 3
fi

# Keep sudo credentials alive during install
( while true; do sudo -n true; sleep 50; kill -0 "$$" || exit; done ) 2>/dev/null &
SUDO_KEEPALIVE=$!
trap 'kill $SUDO_KEEPALIVE 2>/dev/null' EXIT

NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
"#;

    let output = Command::new("/bin/bash")
        .args(["-c", install_script])
        .output()
        .map_err(|e| format!("Cannot run Homebrew installer: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let code = output.status.code().unwrap_or(-1);
        log(&format!(
            "Homebrew install failed (exit {}): {}",
            code, stderr
        ));
        let msg = if stderr.contains("__JHT_CANCELLED__") {
            "Installazione annullata."
        } else if stderr.contains("__JHT_BAD_PASSWORD__") {
            "Password errata. Riprova."
        } else {
            "Installazione di Homebrew fallita. Controlla la connessione internet e riprova."
        };
        return Err(msg.to_string());
    }

    log("Homebrew installed");
    Ok(())
}

/// Auto-install the Xcode Command Line Tools (which brings git) if missing.
/// `xcode-select --install` triggers the native macOS installer dialog; we
/// then poll until the install finishes.
fn install_xcode_clt() -> Result<(), String> {
    log("Requesting Xcode Command Line Tools install...");
    notify(
        "JHT Desktop - Installazione dipendenze",
        "Serve installare gli Xcode Command Line Tools (include git).\n\nSi aprira' la finestra ufficiale di Apple: clicca \"Installa\" e attendi il completamento, poi torna qui.",
    );

    let _ = Command::new("xcode-select")
        .arg("--install")
        .output();

    // Poll up to 10 minutes for the install to finish
    for _ in 0..120 {
        std::thread::sleep(std::time::Duration::from_secs(5));
        if has("git") {
            log("Xcode Command Line Tools installed");
            return Ok(());
        }
    }
    Err("Installazione dei Command Line Tools non completata in tempo. Riapri JHT Desktop una volta installati.".to_string())
}

pub fn check_prerequisites() -> Result<(), String> {
    if has("git") {
        log("git OK");
        return Ok(());
    }
    install_xcode_clt()
}

pub fn ensure_tmux() -> Result<(), String> {
    if has("tmux") {
        log("tmux OK");
        return Ok(());
    }
    if !has("brew") {
        install_homebrew()?;
    }
    log("Installing tmux via Homebrew...");
    sh("brew install tmux").map_err(|e| format!("Installazione di tmux fallita:\n{}", e))?;
    log("tmux installed");
    Ok(())
}

pub fn ensure_node() -> Result<(), String> {
    if let Ok(v) = sh("node --version") {
        log(&format!("Node.js {}", v));
        return Ok(());
    }
    if !has("brew") {
        install_homebrew()?;
    }
    log("Installing Node.js via Homebrew...");
    sh("brew install node").map_err(|e| format!("Installazione di Node.js fallita:\n{}", e))?;
    log("Node.js installed");
    Ok(())
}

pub fn check_ai_cli(cfg: &SetupConfig) -> Result<(), String> {
    let (cli, npm_pkg) = match cfg.provider.as_str() {
        "anthropic" => ("claude", "@anthropic-ai/claude-code"),
        "kimi" => ("kimik2", "kimik2-cli"),
        "openai" => ("codex", "@openai/codex"),
        _ => ("claude", "@anthropic-ai/claude-code"),
    };
    if has(cli) {
        log(&format!("{} CLI found", cli));
        return Ok(());
    }
    if !has("npm") {
        return Err(format!(
            "Il CLI {} non e' installato e npm non e' disponibile. Riprova dopo che Node.js sara' stato installato.",
            cli
        ));
    }
    log(&format!("Installing {} CLI via npm...", cli));
    sh(&format!("npm install -g {}", npm_pkg))
        .map_err(|e| format!("Installazione di {} non riuscita:\n{}", cli, e))?;
    log(&format!("{} CLI installed", cli));
    Ok(())
}

pub fn ensure_repo() -> Result<(), String> {
    let repo_dir = config::repo_dir();
    let repo_str = repo_dir.display().to_string();

    if !repo_dir.exists() {
        std::fs::create_dir_all(config::app_dir())
            .map_err(|e| format!("Cannot create app dir: {}", e))?;

        log(&format!("Cloning into {}...", repo_str));
        sh(&format!(
            "git clone --depth 1 {} '{}'",
            config::REPO_URL,
            repo_str
        ))?;
        log("Clone done");
    } else {
        log("Pulling latest...");
        let _ = sh(&format!("git -C '{}' pull --ff-only", repo_str));
        log("Pull done");
    }
    Ok(())
}

pub fn ensure_deps() -> Result<(), String> {
    let web_dir = config::web_dir();
    let web_str = web_dir.display().to_string();

    if !web_dir.join("node_modules").exists() {
        log("Running npm install...");
        sh(&format!("cd '{}' && npm install", web_str))?;
        log("npm install done");
    } else {
        log("Dependencies already installed");
    }
    Ok(())
}

pub fn setup_workspace(cfg: &SetupConfig) -> Result<(), String> {
    std::fs::create_dir_all(&cfg.work_dir)
        .map_err(|e| format!("Cannot create workspace: {}", e))?;
    std::fs::create_dir_all(cfg.work_dir.join("profile")).ok();
    log(&format!("Workspace ready: {:?}", cfg.work_dir));
    Ok(())
}

pub fn start_web_server() -> Result<u16, String> {
    let web_dir = config::web_dir();
    let web_str = web_dir.display().to_string();

    let port = crate::server::find_free_port(config::DEFAULT_PORT);

    let _ = sh("tmux kill-session -t jht-web 2>/dev/null");
    std::thread::sleep(std::time::Duration::from_millis(500));

    let cmd = format!(
        "tmux new-session -d -s jht-web -c '{}' && tmux send-keys -t jht-web 'npm run dev -- -p {}' C-m",
        web_str, port
    );
    sh(&cmd)?;

    log(&format!("Web server starting on port {}...", port));

    if !crate::server::wait_for_port(port) {
        return Err(format!(
            "Web server did not start within {} seconds.\n\nCheck logs and try again.",
            config::START_TIMEOUT_SECS
        ));
    }

    log("Web server ready");
    Ok(port)
}

#[allow(dead_code)]
pub fn start_team(cfg: &SetupConfig) -> Result<(), String> {
    let repo_dir = config::repo_dir();
    let repo_str = repo_dir.display().to_string();
    let cli_cmd = match cfg.provider.as_str() {
        "anthropic" => "claude",
        "kimi" => "kimik2",
        "openai" => "codex",
        _ => "claude",
    };

    let agents = [
        ("ALFA", "alfa", "high"),
        ("SCOUT-1", "scout", "high"),
        ("ANALISTA-1", "analista", "high"),
        ("SCORER-1", "scorer", "medium"),
        ("SCRITTORE-1", "scrittore", "high"),
        ("CRITICO", "critico", "high"),
        ("SENTINELLA", "sentinella", "low"),
    ];

    let env_var = match cfg.provider.as_str() {
        "anthropic" => "ANTHROPIC_API_KEY",
        "kimi" => "MOONSHOT_API_KEY",
        "openai" => "OPENAI_API_KEY",
        _ => "ANTHROPIC_API_KEY",
    };
    let use_subscription = cfg.auth_method == "subscription";
    let env_prefix = if use_subscription || cfg.api_key.is_empty() {
        String::new()
    } else {
        format!("export {}='{}' && ", env_var, cfg.api_key)
    };
    if use_subscription {
        log(&format!("Subscription mode: relying on {} CLI login", cli_cmd));
    }

    for (session, role, effort) in &agents {
        let _ = sh(&format!("tmux kill-session -t '{}' 2>/dev/null", session));

        let agent_dir = format!("{}/agents/{}", repo_str, role);
        let cmd = format!(
            "tmux new-session -d -s '{}' -c '{}' && tmux send-keys -t '{}' \"{}{} --dangerously-skip-permissions --effort {}\" C-m && (sleep 4 && tmux send-keys -t '{}' Enter) &",
            session, agent_dir, session, env_prefix, cli_cmd, effort, session
        );

        match sh(&cmd) {
            Ok(_) => log(&format!("Started {}", session)),
            Err(e) => log(&format!("Warning: failed to start {}: {}", session, e)),
        }

        std::thread::sleep(std::time::Duration::from_millis(800));
    }

    log("Team started");
    Ok(())
}
