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
    pub provider: String,      // "anthropic" | "openai" | "kimi"
    pub auth_method: String,   // "api-key" | "oauth"
    pub api_key: String,
}

/// ~/.jht directory
pub fn jht_config_dir() -> PathBuf {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_default();
    PathBuf::from(home).join(".jht")
}

/// ~/.jht/jht.config.json
pub fn global_config_path() -> PathBuf {
    jht_config_dir().join("jht.config.json")
}

/// <workspace>/profile/jht.config.json
pub fn workspace_config_path(workspace: &std::path::Path) -> PathBuf {
    workspace.join("profile").join("jht.config.json")
}

pub fn app_dir() -> PathBuf {
    #[cfg(windows)]
    {
        std::env::var("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(APP_DIR_NAME)
    }
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join(APP_DIR_NAME)
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        PathBuf::from(home).join(".local").join("share").join(APP_DIR_NAME)
    }
}

pub fn default_workspace() -> PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_default();
    PathBuf::from(home).join("JHT")
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

/// Save config in the same format as the TUI:
/// 1. ~/.jht/jht.config.json  → { "workspace": "<path>", "workspacePath": "<path>" }
/// 2. <workspace>/profile/jht.config.json → { "active_provider": "...", "providers": { ... } }
pub fn save_config(cfg: &SetupConfig) -> Result<(), String> {
    let config_dir = jht_config_dir();
    std::fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;

    // 1. Global config
    let workspace_str = cfg.work_dir.display().to_string().replace('\\', "\\\\");
    let global = format!(
        "{{\n  \"workspace\": \"{}\",\n  \"workspacePath\": \"{}\"\n}}\n",
        workspace_str, workspace_str
    );
    std::fs::write(global_config_path(), global).map_err(|e| e.to_string())?;

    // 2. Workspace config
    let profile_dir = cfg.work_dir.join("profile");
    std::fs::create_dir_all(&profile_dir).map_err(|e| e.to_string())?;

    let (model, base_url) = default_provider_settings(&cfg.provider);
    let base_url_line = base_url
        .map(|u| format!(",\n        \"base_url\": \"{}\"", u))
        .unwrap_or_default();

    let ws_config = format!(
        r#"{{
  "active_provider": "{}",
  "providers": {{
    "{}": {{
      "name": "{}",
      "auth_method": "{}",
      "model": "{}",
      "api_key": "{}"{base_url_line}
    }}
  }}
}}
"#,
        cfg.provider, cfg.provider, cfg.provider, cfg.auth_method, model, cfg.api_key,
        base_url_line = base_url_line
    );
    std::fs::write(workspace_config_path(&cfg.work_dir), ws_config)
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Load existing config from ~/.jht/jht.config.json + workspace config
pub fn load_config() -> Option<SetupConfig> {
    let global = std::fs::read_to_string(global_config_path()).ok()?;
    let workspace = extract_json_string(&global, "workspacePath")
        .or_else(|| extract_json_string(&global, "workspace"))?;

    let work_dir = PathBuf::from(&workspace);
    let ws_config = std::fs::read_to_string(workspace_config_path(&work_dir)).ok()?;

    let provider = extract_json_string(&ws_config, "active_provider")?;
    let api_key = extract_nested_provider_key(&ws_config, &provider).unwrap_or_default();
    let auth_method = extract_nested_string(&ws_config, &provider, "auth_method")
        .unwrap_or_else(|| "api-key".to_string());

    Some(SetupConfig {
        work_dir,
        provider,
        auth_method,
        api_key,
    })
}

fn default_provider_settings(provider: &str) -> (&'static str, Option<&'static str>) {
    match provider {
        "anthropic" => ("claude-sonnet-4-20250514", None),
        "openai" => ("gpt-4o-mini", Some("https://api.openai.com/v1")),
        "kimi" => ("kimi-k2-0711-preview", Some("https://api.moonshot.ai/v1")),
        _ => ("claude-sonnet-4-20250514", None),
    }
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

fn extract_nested_provider_key(json: &str, provider: &str) -> Option<String> {
    // Find the provider block, then find api_key within it
    let provider_pattern = format!("\"{}\"", provider);
    let idx = json.find(&provider_pattern)?;
    let rest = &json[idx..];
    extract_json_string(rest, "api_key")
}

fn extract_nested_string(json: &str, provider: &str, key: &str) -> Option<String> {
    let provider_pattern = format!("\"{}\"", provider);
    let idx = json.find(&provider_pattern)?;
    let rest = &json[idx..];
    extract_json_string(rest, key)
}
