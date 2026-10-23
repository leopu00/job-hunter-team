"""The desktop, not install.ps1, owns the non-admin Windows logon task."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RUNTIME = (ROOT / "desktop/src-tauri/src/windows_runtime.rs").read_text(encoding="utf-8")
ONBOARDING = (ROOT / "desktop/src-tauri/src/onboarding.rs").read_text(encoding="utf-8")
ENABLER = (ROOT / "scripts/enable-podman-windows-runtime.ps1").read_text(encoding="utf-8")


def test_desktop_creates_a_limited_current_user_logon_task():
    assert 'AUTOSTART_TASK_NAME: &str = "Job Hunter Team - Start runtime"' in RUNTIME
    assert '"/SC", "ONLOGON"' in RUNTIME
    assert '"/RL", "LIMITED"' in RUNTIME
    create = RUNTIME[RUNTIME.index("pub(crate) fn autostart_create_args"):RUNTIME.index("fn autostart_query_args")]
    assert '"/RU"' not in create


def test_install_keeps_running_when_the_desktop_cannot_register_autostart():
    assert 'if !crate::windows_runtime::register_autostart(&wrapper)' in ONBOARDING
    assert 'phase("ui_notice_autostart_inactive")' in ONBOARDING
    assert "Install-JhtStartupTask" not in ENABLER
    assert "Register-ScheduledTask" not in ENABLER
