use std::sync::Mutex;
use std::io::Write;

static LOG_BUFFER: Mutex<Vec<String>> = Mutex::new(Vec::new());

pub fn log(message: &str) {
    let timestamp = chrono_lite_now();
    let line = format!("[{}] {}", timestamp, message);
    eprintln!("{}", line);

    if let Ok(mut buf) = LOG_BUFFER.lock() {
        buf.push(line);
    }
}

pub fn flush_to_file(path: &std::path::Path) {
    if let Ok(mut buf) = LOG_BUFFER.lock() {
        if buf.is_empty() {
            return;
        }
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
        {
            for line in buf.drain(..) {
                let _ = writeln!(f, "{}", line);
            }
        }
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
