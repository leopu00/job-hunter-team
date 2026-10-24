"""The desktop, not install.ps1, owns the non-admin Windows logon task."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RUNTIME = (ROOT / "desktop/src-tauri/src/windows_runtime.rs").read_text(encoding="utf-8")
ONBOARDING = (ROOT / "desktop/src-tauri/src/onboarding.rs").read_text(encoding="utf-8")
ENABLER = (ROOT / "scripts/enable-podman-windows-runtime.ps1").read_text(encoding="utf-8")


def test_desktop_creates_a_limited_current_user_logon_task():
    assert 'AUTOSTART_TASK_LABEL: &str = "Job Hunter Team - Start runtime"' in RUNTIME
    # A standard user is refused `schtasks /Create /SC ONLOGON` (with or without /RU /IT): the task
    # comes from an XML whose logon trigger names the user, read from a private folder.
    create = RUNTIME[RUNTIME.index("pub(crate) fn autostart_create_args"):RUNTIME.index("/// The characters XML text must not carry bare.")]
    assert '"/XML"' in create and '"/F"' in create
    assert '"ONLOGON"' not in create and '"/RU"' not in create and '"/SC"' not in create
    assert "autostart_task_name(sid)" in create
    xml = RUNTIME[RUNTIME.index("fn autostart_task_xml"):RUNTIME.index("fn utf16_with_bom")]
    assert "<LogonTrigger><Enabled>true</Enabled><UserId>{user}</UserId></LogonTrigger>" in xml
    assert "<LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel>" in xml
    assert "HighestAvailable" not in xml
    assert 'format!("{AUTOSTART_TASK_LABEL} [{sid}]")' in RUNTIME
    assert '"/Query", "/TN", &task, "/XML"' in RUNTIME
    assert '["/user", "/fo", "csv", "/nh"]' in RUNTIME
    assert 'autostart_query_args(&sid)' in RUNTIME
    assert "crate::private_acl::protect_dir(&dir)" in RUNTIME


def test_p0_never_targets_the_legacy_global_task():
    uninstall = (ROOT / "scripts/jht-uninstall-windows.ps1").read_text(encoding="utf-8")
    wrapper = (ROOT / "scripts/jht-wrapper.ps1").read_text(encoding="utf-8")
    assert "$JhtStartupTaskName = Get-JhtScopedStartupTaskName" in uninstall
    assert "Job Hunter Team - Start runtime [$sid]" in wrapper
    assert "param([string]$TaskName = 'Job Hunter Team - Start runtime')" not in wrapper


def test_install_keeps_running_when_the_desktop_cannot_register_autostart():
    # Both the reuse and the post-install branch go through the one helper, which logs the step
    # and tells the person when the registration did not hold.
    assert ONBOARDING.count("register_autostart_noted(&wrapper, log, phase);") == 2
    assert "crate::windows_runtime::register_autostart(wrapper)" in ONBOARDING
    assert 'phase("ui_notice_autostart_inactive")' in ONBOARDING
    assert "Install-JhtStartupTask" not in ENABLER
    assert "Register-ScheduledTask" not in ENABLER


def test_the_runtime_attestation_checks_the_wrappers_folder_as_a_node():
    # whoever may create or rename a file in the folder the wrapper and its helper sit in may swap
    # them after the check: the folder follows the same account rule as the files (its ACL is the
    # profile's, so it does not have to cut its inheritance, unlike the runtime directory)
    attest = RUNTIME[RUNTIME.index("fn attest_paths"):RUNTIME.index("/// `%SystemRoot%")]
    assert 'fail("bin-dir", node_rule(bin, true, false))?;' in attest
    assert 'fail("runtime-dir", node_rule(runtime_dir, true, true))?;' in attest
