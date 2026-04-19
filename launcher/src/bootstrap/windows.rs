use std::process::Command;
use crate::config::{self, SetupConfig};
use crate::log::log;

use std::os::windows::process::CommandExt;
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn wsl_cmd() -> Command {
    let mut cmd = Command::new("wsl");
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

fn run_wsl(args: &[&str]) -> Result<String, String> {
    let output = wsl_cmd()
        .args(["-d", "Ubuntu"])
        .args(args)
        .output()
        .map_err(|e| format!("WSL command failed: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Err(if stderr.is_empty() { stdout } else { stderr })
    }
}

pub fn check_prerequisites() -> Result<(), String> {
    let output = Command::new("wsl")
        .args(["--list", "--quiet"])
        .output()
        .map_err(|_| "WSL is not installed.\n\nOpen PowerShell as admin and run:\nwsl --install".to_string())?;

    let list = String::from_utf8_lossy(&output.stdout);
    if !list.contains("Ubuntu") {
        let raw = String::from_utf8_lossy(&output.stdout);
        let cleaned: String = raw.chars().filter(|c| !c.is_control() && *c != '\0').collect();
        if !cleaned.contains("Ubuntu") {
            return Err("Ubuntu is not installed in WSL.\n\nRun: wsl --install -d Ubuntu".to_string());
        }
    }
    log("WSL + Ubuntu OK");
    Ok(())
}

pub fn ensure_tmux() -> Result<(), String> {
    match run_wsl(&["which", "tmux"]) {
        Ok(_) => {
            log("tmux OK");
            Ok(())
        }
        Err(_) => {
            log("Installing tmux...");
            let _ = run_wsl(&["sudo", "apt-get", "update", "-qq"]);
            run_wsl(&["sudo", "apt-get", "install", "-y", "-qq", "tmux"])
                .map_err(|e| format!("Failed to install tmux: {}", e))?;
            log("tmux installed");
            Ok(())
        }
    }
}

pub fn ensure_node() -> Result<(), String> {
    match run_wsl(&["node", "--version"]) {
        Ok(v) => {
            log(&format!("Node.js {}", v));
            Ok(())
        }
        Err(_) => {
            log("Node.js not found, installing...");
            let install = run_wsl(&["bash", "-c",
                "curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs"
            ]);
            match install {
                Ok(_) => {
                    log("Node.js installed");
                    Ok(())
                }
                Err(e) => Err(format!("Failed to install Node.js:\n{}\n\nInstall manually in WSL.", e)),
            }
        }
    }
}

pub fn check_ai_cli(cfg: &SetupConfig) -> Result<(), String> {
    let cli = match cfg.provider.as_str() {
        "anthropic" => "claude",
        "kimi" => "kimik2",
        "openai" => "codex",
        _ => "claude",
    };
    match run_wsl(&["which", cli]) {
        Ok(_) => {
            log(&format!("{} CLI found", cli));
            Ok(())
        }
        Err(_) => {
            Err(format!(
                "{} CLI not found in WSL.\n\nInstall it in WSL first, then retry.",
                cli
            ))
        }
    }
}

pub fn ensure_repo() -> Result<(), String> {
    let repo_dir = config::repo_dir();
    let wsl_path = windows_to_wsl_path(&repo_dir.display().to_string());

    if !repo_dir.exists() {
        std::fs::create_dir_all(config::app_dir())
            .map_err(|e| format!("Cannot create app dir: {}", e))?;

        log(&format!("Cloning into {}...", wsl_path));
        run_wsl(&["git", "clone", "--depth", "1", config::REPO_URL, &wsl_path])?;
        log("Clone done");
    } else {
        log("Pulling latest...");
        let _ = run_wsl(&["git", "-C", &wsl_path, "pull", "--ff-only"]);
        log("Pull done");
    }
    Ok(())
}

pub fn ensure_deps() -> Result<(), String> {
    let web_dir = config::web_dir();
    let wsl_path = windows_to_wsl_path(&web_dir.display().to_string());

    if !web_dir.join("node_modules").exists() {
        log("Running npm install...");
        run_wsl(&["bash", "-c", &format!("cd '{}' && npm install", wsl_path)])?;
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
    let wsl_path = windows_to_wsl_path(&web_dir.display().to_string());

    let port = crate::server::find_free_port(config::DEFAULT_PORT);

    let _ = run_wsl(&["tmux", "kill-session", "-t", "jht-web"]);
    std::thread::sleep(std::time::Duration::from_millis(500));

    let cmd = format!(
        "tmux new-session -d -s jht-web -c '{}' && tmux send-keys -t jht-web 'npm run dev -- -p {}' C-m",
        wsl_path, port
    );
    run_wsl(&["bash", "-c", &cmd])?;

    log(&format!("Web server starting on port {}...", port));

    if !crate::server::wait_for_port(port) {
        return Err(format!("Web server did not start within {} seconds.\n\nCheck WSL and try again.", config::START_TIMEOUT_SECS));
    }

    log("Web server ready");
    Ok(port)
}

#[allow(dead_code)]
pub fn start_team(cfg: &SetupConfig) -> Result<(), String> {
    let repo_dir = config::repo_dir();
    let wsl_repo = windows_to_wsl_path(&repo_dir.display().to_string());
    let cli_cmd = match cfg.provider.as_str() {
        "anthropic" => "claude",
        "kimi" => "kimik2",
        "openai" => "codex",
        _ => "claude",
    };

    let agents = [
        ("CAPITANO", "capitano", "high"),
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
        let _ = run_wsl(&["tmux", "kill-session", "-t", session]);

        let agent_dir = format!("{}/agents/{}", wsl_repo, role);
        let cmd = format!(
            "tmux new-session -d -s '{}' -c '{}' && tmux send-keys -t '{}' '{}{} --dangerously-skip-permissions --effort {}' C-m && (sleep 4 && tmux send-keys -t '{}' Enter) &",
            session, agent_dir, session, env_prefix, cli_cmd, effort, session
        );

        match run_wsl(&["bash", "-c", &cmd]) {
            Ok(_) => log(&format!("Started {}", session)),
            Err(e) => log(&format!("Warning: failed to start {}: {}", session, e)),
        }

        std::thread::sleep(std::time::Duration::from_millis(800));
    }

    log("Team started");
    Ok(())
}

fn windows_to_wsl_path(win_path: &str) -> String {
    let normalized = win_path.replace('\\', "/");
    if normalized.len() >= 2 && normalized.as_bytes()[1] == b':' {
        let drive = (normalized.as_bytes()[0] as char).to_lowercase().next().unwrap();
        format!("/mnt/{}{}", drive, &normalized[2..])
    } else {
        normalized
    }
}
