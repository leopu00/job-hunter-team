use std::process::Command;

pub struct PrereqInfo {
    pub node_version: String,
    pub npm_version: String,
    pub git_version: String,
}

fn run_version_cmd(program: &str, args: &[&str]) -> Result<String, String> {
    let result = if cfg!(windows) && program == "npm" {
        Command::new("cmd").args(["/C", "npm"]).args(args).output()
    } else {
        Command::new(program).args(args).output()
    };

    match result {
        Ok(output) if output.status.success() => {
            Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
        }
        Ok(output) => Err(format!(
            "{} failed: {}",
            program,
            String::from_utf8_lossy(&output.stderr).trim()
        )),
        Err(e) => Err(format!("{} not found: {}", program, e)),
    }
}

pub fn check_all() -> Result<PrereqInfo, Vec<String>> {
    let mut errors = Vec::new();

    let node = run_version_cmd("node", &["--version"]);
    let npm = run_version_cmd("npm", &["--version"]);
    let git = run_version_cmd("git", &["--version"]);

    let node_version = match node {
        Ok(v) => v,
        Err(e) => {
            errors.push(e);
            String::new()
        }
    };

    let npm_version = match npm {
        Ok(v) => v,
        Err(e) => {
            errors.push(e);
            String::new()
        }
    };

    let git_version = match git {
        Ok(v) => v,
        Err(e) => {
            errors.push(e);
            String::new()
        }
    };

    if errors.is_empty() {
        Ok(PrereqInfo {
            node_version,
            npm_version,
            git_version,
        })
    } else {
        Err(errors)
    }
}
