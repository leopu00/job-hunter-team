use std::{env, fs};

fn main() {
    println!("cargo:rerun-if-env-changed=VITE_SUPABASE_URL");
    println!("cargo:rerun-if-changed=../.env.local");
    let supabase_url = env::var("VITE_SUPABASE_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            let env_file = fs::read_to_string("../.env.local").ok()?;
            env_file.lines().find_map(|line| {
                let (name, value) = line.trim().split_once('=')?;
                (name.trim() == "VITE_SUPABASE_URL").then(|| {
                    value
                        .trim()
                        .trim_matches(|character| character == '\'' || character == '"')
                        .to_string()
                })
            })
        })
        .unwrap_or_default();
    // Public project URL only. The anon key stays with Vite and secrets must
    // never cross into Cargo output or the backend binary.
    println!("cargo:rustc-env=JHT_SUPABASE_URL={supabase_url}");
    tauri_build::build()
}
