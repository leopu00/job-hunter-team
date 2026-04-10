use std::path::Path;
use std::process::Command;

use crate::config;
use crate::log::log;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn git_cmd() -> Command {
    let mut cmd = Command::new("git");
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

pub enum RepoStatus {
    Cloned,
    Updated,
    AlreadyUpToDate,
}

pub fn ensure_repo() -> Result<RepoStatus, String> {
    let repo_dir = config::repo_dir();

    if !repo_dir.exists() {
        std::fs::create_dir_all(config::app_dir())
            .map_err(|e| format!("Cannot create app directory: {}", e))?;

        log(&format!("Cloning {} into {:?}...", config::REPO_URL, repo_dir));

        let output = git_cmd()
            .args(["clone", "--depth", "1", config::REPO_URL])
            .arg(&repo_dir)
            .output()
            .map_err(|e| format!("git clone failed: {}", e))?;

        if !output.status.success() {
            return Err(format!(
                "git clone failed:\n{}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }

        log("Clone completed.");
        return Ok(RepoStatus::Cloned);
    }

    if !repo_dir.join(".git").exists() {
        return Err(format!("{:?} exists but is not a git repository", repo_dir));
    }

    update_repo(&repo_dir)
}

pub fn update_repo(repo_dir: &Path) -> Result<RepoStatus, String> {
    log("Pulling latest changes...");

    let output = git_cmd()
        .args(["-C"])
        .arg(repo_dir)
        .args(["pull", "--ff-only"])
        .output()
        .map_err(|e| format!("git pull failed: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "git pull failed:\n{}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    log(&format!("git pull: {}", stdout.trim()));

    if stdout.contains("Already up to date") {
        Ok(RepoStatus::AlreadyUpToDate)
    } else {
        Ok(RepoStatus::Updated)
    }
}
