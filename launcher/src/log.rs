use std::io::Write;
use std::sync::Mutex;

use crate::config;

static LOG_FILE: Mutex<()> = Mutex::new(());

pub fn log(message: &str) {
    let line = format!("[{}] {}", chrono_lite_now(), message);
    eprintln!("{}", line);
    append_to_file(&line);
}

fn append_to_file(line: &str) {
    let _guard = match LOG_FILE.lock() {
        Ok(g) => g,
        Err(_) => return,
    };

    let path = config::log_file();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let _ = writeln!(f, "{}", line);
    }
}

fn chrono_lite_now() -> String {
    use std::time::SystemTime;
    let duration = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = duration.as_secs();
    let hours = (secs / 3600) % 24;
    let minutes = (secs / 60) % 60;
    let seconds = secs % 60;
    format!("{:02}:{:02}:{:02}", hours, minutes, seconds)
}
