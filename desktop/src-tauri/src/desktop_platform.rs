use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DesktopPlatform {
    Windows,
    Macos,
    Linux,
    Other,
}

pub(crate) fn normalize_platform(os: &str) -> DesktopPlatform {
    match os {
        "windows" => DesktopPlatform::Windows,
        "macos" => DesktopPlatform::Macos,
        "linux" => DesktopPlatform::Linux,
        _ => DesktopPlatform::Other,
    }
}

#[tauri::command]
pub fn desktop_platform() -> DesktopPlatform {
    normalize_platform(std::env::consts::OS)
}

#[cfg(test)]
mod tests {
    use super::{normalize_platform, DesktopPlatform};

    #[test]
    fn maps_supported_desktop_targets() {
        assert_eq!(normalize_platform("windows"), DesktopPlatform::Windows);
        assert_eq!(normalize_platform("macos"), DesktopPlatform::Macos);
        assert_eq!(normalize_platform("linux"), DesktopPlatform::Linux);
    }

    #[test]
    fn unknown_targets_fail_closed() {
        assert_eq!(normalize_platform("freebsd"), DesktopPlatform::Other);
        assert_eq!(normalize_platform(""), DesktopPlatform::Other);
    }
}
