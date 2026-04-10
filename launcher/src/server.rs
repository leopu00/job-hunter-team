use std::fs;
use std::io::Write;
use std::net::TcpStream;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};
use shared_child::SharedChild;

use crate::config;
use crate::log::log;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

pub fn ensure_deps() -> Result<(), String> {
    let web_dir = config::web_dir();
    let node_modules = web_dir.join("node_modules");
    let package_json = web_dir.join("package.json");

    if !package_json.exists() {
        return Err(format!("package.json not found in {:?}", web_dir));
    }

    let current_hash = hash_file(&package_json)?;
    let cached_hash = fs::read_to_string(config::hash_file()).unwrap_or_default();

    if node_modules.exists() && current_hash == cached_hash.trim() {
        log("Dependencies up to date, skipping npm install.");
        return Ok(());
    }

    log("Running npm install...");

    let mut cmd = Command::new("cmd");
    cmd.args(["/C", "npm", "install"]);
    cmd.current_dir(&web_dir);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = cmd.output().map_err(|e| format!("npm install failed: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "npm install failed:\n{}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    // Cache the hash
    if let Ok(mut f) = fs::File::create(config::hash_file()) {
        let _ = f.write_all(current_hash.as_bytes());
    }

    log("npm install completed.");
    Ok(())
}

fn hash_file(path: &Path) -> Result<String, String> {
    let contents = fs::read(path).map_err(|e| format!("Cannot read {:?}: {}", path, e))?;
    let mut hasher = Sha256::new();
    hasher.update(&contents);
    Ok(format!("{:x}", hasher.finalize()))
}

pub fn detect_mode() -> &'static str {
    let web_dir = config::web_dir();
    let has_build =
        web_dir.join(".next").join("BUILD_ID").exists() || web_dir.join("server.js").exists();
    let has_modules = web_dir.join("node_modules").exists();

    if has_build {
        "production"
    } else if has_modules {
        "development"
    } else {
        "development"
    }
}

pub fn start(port: u16) -> Result<std::sync::Arc<SharedChild>, String> {
    let web_dir = config::web_dir();
    let mode = detect_mode();

    let args = if mode == "production" {
        vec!["/C", "npm", "run", "start", "--", "-p"]
    } else {
        vec!["/C", "npm", "run", "dev", "--", "-p"]
    };

    log(&format!(
        "Starting server in {} mode on port {}...",
        mode, port
    ));

    let log_path = config::log_file();
    let log_out = fs::File::create(&log_path)
        .map_err(|e| format!("Cannot create log file: {}", e))?;
    let log_err = log_out
        .try_clone()
        .map_err(|e| format!("Cannot clone log handle: {}", e))?;

    let mut cmd = Command::new("cmd");
    cmd.args(&args)
        .arg(port.to_string())
        .current_dir(&web_dir)
        .env("PORT", port.to_string())
        .stdin(Stdio::null())
        .stdout(log_out)
        .stderr(log_err);

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let child =
        SharedChild::spawn(&mut cmd).map_err(|e| format!("Failed to start server: {}", e))?;

    let child = std::sync::Arc::new(child);
    log(&format!("Server process started (PID: {})", child.id()));

    Ok(child)
}

pub fn wait_for_port(port: u16) -> bool {
    let timeout = Duration::from_secs(config::START_TIMEOUT_SECS);
    let poll = Duration::from_millis(config::POLL_INTERVAL_MS);
    let start = Instant::now();

    while start.elapsed() < timeout {
        if TcpStream::connect_timeout(
            &format!("127.0.0.1:{}", port).parse().unwrap(),
            Duration::from_secs(1),
        )
        .is_ok()
        {
            return true;
        }
        std::thread::sleep(poll);
    }

    false
}

pub fn find_free_port(start_port: u16) -> u16 {
    for offset in 0..=config::PORT_FALLBACK_SPAN {
        let port = start_port + offset;
        if TcpStream::connect_timeout(
            &format!("127.0.0.1:{}", port).parse().unwrap(),
            Duration::from_millis(200),
        )
        .is_err()
        {
            return port;
        }
    }
    start_port
}

pub fn stop(child: &SharedChild) {
    log("Stopping server...");
    let _ = child.kill();
    let _ = child.wait();
    log("Server stopped.");
}
