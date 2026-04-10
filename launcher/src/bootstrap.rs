use std::process::Command;
use crate::config::{self, SetupConfig};
use crate::log::log;
use crate::ui;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn wsl_cmd() -> Command {
    let mut cmd = Command::new("wsl");
    #[cfg(windows)]
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
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

pub fn run(cfg: &SetupConfig) -> Result<u16, String> {
    // Step 1: Check WSL
    ui::update_status(1, "Checking WSL + Ubuntu...");
    check_wsl()?;

    // Step 2: Check tmux
    ui::update_status(2, "Checking tmux...");
    ensure_tmux()?;

    // Step 3: Check Node.js
    ui::update_status(3, "Checking Node.js...");
    ensure_node()?;

    // Step 4: Check AI CLI
    ui::update_status(4, &format!("Checking {} CLI...", cfg.provider));
    check_ai_cli(cfg)?;

    // Step 5: Clone/update repo
    ui::update_status(5, "Updating repository...");
    ensure_repo()?;

    // Step 6: Install deps
    ui::update_status(6, "Installing dependencies...");
    ensure_deps()?;

    // Step 7: Create work dir
    ui::update_status(7, "Setting up workspace...");
    setup_workspace(cfg)?;

    // Step 8: Start web server
    ui::update_status(8, "Starting web server...");
    let port = start_web_server()?;

    // Step 9: Start team
    ui::update_status(9, "Starting agent team...");
    start_team(cfg)?;

    // Step 10: Open browser
    ui::update_status(10, "Opening browser...");
    let url = format!("http://localhost:{}", port);
    let _ = open::that(&url);

    Ok(port)
}

fn check_wsl() -> Result<(), String> {
    let output = Command::new("wsl")
        .args(["--list", "--quiet"])
        .output()
        .map_err(|_| "WSL is not installed.\n\nInstall it: wsl --install".to_string())?;

    let list = String::from_utf8_lossy(&output.stdout);
    if !list.contains("Ubuntu") {
        return Err("Ubuntu is not installed in WSL.\n\nRun: wsl --install -d Ubuntu".to_string());
    }
    log("WSL + Ubuntu OK");
    Ok(())
}

fn ensure_tmux() -> Result<(), String> {
    match run_wsl(&["which", "tmux"]) {
        Ok(_) => {
            log("tmux OK");
            Ok(())
        }
        Err(_) => {
            log("Installing tmux...");
            run_wsl(&["sudo", "apt-get", "update", "-qq"])?;
            run_wsl(&["sudo", "apt-get", "install", "-y", "-qq", "tmux"])?;
            log("tmux installed");
            Ok(())
        }
    }
}

fn ensure_node() -> Result<(), String> {
    match run_wsl(&["node", "--version"]) {
        Ok(v) => {
            log(&format!("Node.js {}", v));
            Ok(())
        }
        Err(_) => {
            // Try to install via nvm or apt
            log("Installing Node.js...");
            let install = run_wsl(&["bash", "-c",
                "curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs"
            ]);
            match install {
                Ok(_) => {
                    log("Node.js installed");
                    Ok(())
                }
                Err(e) => Err(format!("Failed to install Node.js: {}\n\nInstall manually in WSL.", e)),
            }
        }
    }
}

fn check_ai_cli(cfg: &SetupConfig) -> Result<(), String> {
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
                "{} CLI not found in WSL.\n\nInstall it first, then restart the launcher.",
                cli
            ))
        }
    }
}

fn ensure_repo() -> Result<(), String> {
    let repo_dir = config::repo_dir();
    let repo_dir_str = repo_dir.display().to_string().replace('\\', "/");
    // Convert Windows path to WSL path
    let wsl_path = windows_to_wsl_path(&repo_dir_str);

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

fn ensure_deps() -> Result<(), String> {
    let web_dir = config::web_dir();
    let wsl_path = windows_to_wsl_path(&web_dir.display().to_string().replace('\\', "/"));

    if !web_dir.join("node_modules").exists() {
        log("Running npm install...");
        run_wsl(&["bash", "-c", &format!("cd '{}' && npm install", wsl_path)])?;
        log("npm install done");
    } else {
        log("Dependencies already installed");
    }
    Ok(())
}

fn setup_workspace(cfg: &SetupConfig) -> Result<(), String> {
    std::fs::create_dir_all(&cfg.work_dir)
        .map_err(|e| format!("Cannot create workspace: {}", e))?;
    log(&format!("Workspace: {:?}", cfg.work_dir));
    Ok(())
}

fn start_web_server() -> Result<u16, String> {
    let web_dir = config::web_dir();
    let wsl_path = windows_to_wsl_path(&web_dir.display().to_string().replace('\\', "/"));

    // Find free port
    let port = crate::server::find_free_port(config::DEFAULT_PORT);

    // Start server in tmux session
    let cmd = format!(
        "tmux new-session -d -s jht-web -c '{}' 'npm run dev -- -p {}'",
        wsl_path, port
    );
    run_wsl(&["bash", "-c", &cmd])?;

    log(&format!("Web server starting on port {}...", port));

    // Wait for port
    if !crate::server::wait_for_port(port) {
        return Err(format!("Web server did not start within {} seconds", config::START_TIMEOUT_SECS));
    }

    log("Web server ready");
    Ok(port)
}

fn start_team(cfg: &SetupConfig) -> Result<(), String> {
    let repo_dir = config::repo_dir();
    let wsl_repo = windows_to_wsl_path(&repo_dir.display().to_string().replace('\\', "/"));
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

    // Set API key env if provided
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
        let agent_dir = format!("{}/agents/{}", wsl_repo, role);
        let cmd = format!(
            "tmux new-session -d -s '{}' -c '{}' && tmux send-keys -t '{}' '{}{} --dangerously-skip-permissions --effort {}' C-m && (sleep 4 && tmux send-keys -t '{}' Enter) &",
            session, agent_dir, session, env_prefix, cli_cmd, effort, session
        );

        match run_wsl(&["bash", "-c", &cmd]) {
            Ok(_) => log(&format!("Started {}", session)),
            Err(e) => log(&format!("Failed to start {}: {}", session, e)),
        }

        // Small delay between agents
        std::thread::sleep(std::time::Duration::from_millis(500));
    }

    log("Team started");
    Ok(())
}

fn windows_to_wsl_path(win_path: &str) -> String {
    // C:/Users/foo -> /mnt/c/Users/foo
    if win_path.len() >= 2 && win_path.as_bytes()[1] == b':' {
        let drive = (win_path.as_bytes()[0] as char).to_lowercase().next().unwrap();
        format!("/mnt/{}{}", drive, win_path[2..].replace('\\', "/"))
    } else {
        win_path.replace('\\', "/")
    }
}
