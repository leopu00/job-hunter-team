use std::path::PathBuf;

pub const REPO_URL: &str = "https://github.com/leopu00/job-hunter-team.git";
pub const DEFAULT_PORT: u16 = 3000;
pub const APP_DIR_NAME: &str = "jht-desktop";
pub const START_TIMEOUT_SECS: u64 = 60;
pub const POLL_INTERVAL_MS: u64 = 500;
pub const PORT_FALLBACK_SPAN: u16 = 10;

#[derive(Clone, Debug)]
pub struct SetupConfig {
    pub work_dir: PathBuf,
    pub provider: AiProvider,
    pub api_key: String,
}

#[derive(Clone, Debug, PartialEq)]
pub enum AiProvider {
    ClaudeCode,
    KimiK2,
}

impl AiProvider {
    pub fn label(&self) -> &str {
        match self {
            AiProvider::ClaudeCode => "Claude Code",
            AiProvider::KimiK2 => "Kimi K2",
        }
    }

    pub fn cli_command(&self) -> &str {
        match self {
            AiProvider::ClaudeCode => "claude",
            AiProvider::KimiK2 => "kimik2",
        }
    }

    pub fn env_var_name(&self) -> &str {
        match self {
            AiProvider::ClaudeCode => "ANTHROPIC_API_KEY",
            AiProvider::KimiK2 => "MOONSHOT_API_KEY",
        }
    }
}

pub fn app_dir() -> PathBuf {
    std::env::var("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(APP_DIR_NAME)
}

pub fn repo_dir() -> PathBuf {
    app_dir().join("repo")
}

pub fn web_dir() -> PathBuf {
    repo_dir().join("web")
}

pub fn log_file() -> PathBuf {
    app_dir().join("launcher.log")
}

pub fn hash_file() -> PathBuf {
    app_dir().join(".package-json-hash")
}

pub fn config_file() -> PathBuf {
    app_dir().join("config.json")
}

/// Save config to disk (simple JSON)
pub fn save_config(cfg: &SetupConfig) -> Result<(), String> {
    std::fs::create_dir_all(app_dir()).map_err(|e| e.to_string())?;
    let provider = match cfg.provider {
        AiProvider::ClaudeCode => "claude",
        AiProvider::KimiK2 => "kimik2",
    };
    let json = format!(
        "{{\n  \"work_dir\": \"{}\",\n  \"provider\": \"{}\",\n  \"api_key\": \"{}\"\n}}",
        cfg.work_dir.display().to_string().replace('\\', "\\\\"),
        provider,
        cfg.api_key
    );
    std::fs::write(config_file(), json).map_err(|e| e.to_string())
}

/// Load config from disk
pub fn load_config() -> Option<SetupConfig> {
    let content = std::fs::read_to_string(config_file()).ok()?;
    // Simple manual parse (no serde)
    let work_dir = extract_json_string(&content, "work_dir")?;
    let provider_str = extract_json_string(&content, "provider")?;
    let api_key = extract_json_string(&content, "api_key")?;

    let provider = match provider_str.as_str() {
        "kimik2" => AiProvider::KimiK2,
        _ => AiProvider::ClaudeCode,
    };

    Some(SetupConfig {
        work_dir: PathBuf::from(work_dir),
        provider,
        api_key,
    })
}

fn extract_json_string(json: &str, key: &str) -> Option<String> {
    let pattern = format!("\"{}\"", key);
    let idx = json.find(&pattern)?;
    let rest = &json[idx + pattern.len()..];
    let colon = rest.find(':')?;
    let rest = &rest[colon + 1..];
    let quote_start = rest.find('"')?;
    let rest = &rest[quote_start + 1..];
    let quote_end = rest.find('"')?;
    Some(rest[..quote_end].replace("\\\\", "\\"))
}
