use std::process::Command;
use crate::config::{self, SetupConfig};
use crate::log::log;

fn sh(script: &str) -> Result<String, String> {
    let output = Command::new("/bin/bash")
        .args(["-lc", script])
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

pub fn check_prerequisites() -> Result<(), String> {
    if !has("git") {
        return Err(
            "git is not installed.\n\nInstall Xcode Command Line Tools:\n\nxcode-select --install"
                .to_string(),
        );
    }
    log("git OK");
    Ok(())
}

pub fn ensure_tmux() -> Result<(), String> {
    if has("tmux") {
        log("tmux OK");
        return Ok(());
    }
    if !has("brew") {
        return Err(
            "tmux is not installed and Homebrew is not available.\n\nInstall Homebrew first:\n\n/bin/bash -c \"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"\n\nThen retry."
                .to_string(),
        );
    }
    log("Installing tmux via Homebrew...");
    sh("brew install tmux").map_err(|e| format!("brew install tmux failed:\n{}", e))?;
    log("tmux installed");
    Ok(())
}

pub fn ensure_node() -> Result<(), String> {
    if let Ok(v) = sh("node --version") {
        log(&format!("Node.js {}", v));
        return Ok(());
    }
    if !has("brew") {
        return Err(
            "Node.js is not installed and Homebrew is not available.\n\nInstall Homebrew first, then retry."
                .to_string(),
        );
    }
    log("Installing Node.js via Homebrew...");
    sh("brew install node").map_err(|e| format!("brew install node failed:\n{}", e))?;
    log("Node.js installed");
    Ok(())
}

pub fn check_ai_cli(cfg: &SetupConfig) -> Result<(), String> {
    let cli = match cfg.provider.as_str() {
        "anthropic" => "claude",
        "kimi" => "kimik2",
        "openai" => "codex",
        _ => "claude",
    };
    if has(cli) {
        log(&format!("{} CLI found", cli));
        Ok(())
    } else {
        let install_hint = match cli {
            "claude" => "npm install -g @anthropic-ai/claude-code",
            "codex" => "npm install -g @openai/codex",
            "kimik2" => "npm install -g kimik2-cli",
            _ => "npm install -g @anthropic-ai/claude-code",
        };
        Err(format!(
            "{} CLI not found.\n\nInstall it globally with npm:\n\n{}",
            cli, install_hint
        ))
    }
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
    let env_prefix = if !cfg.api_key.is_empty() {
        format!("export {}='{}' && ", env_var, cfg.api_key)
    } else {
        String::new()
    };

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
