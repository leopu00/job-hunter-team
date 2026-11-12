"""The test files the Windows config ACL gate runs on a real Windows, in one place.

Only the Python standard library: the gate reads it with `python tests/windows_gate_files.py --strict|--open|--host`
(one path or node id per line) before pytest is installed, and `win-gate-acl.sh` reads it the same way. Nothing else
names a test file for that gate: a test file that runs PowerShell is either listed here or it is not run on Windows
and the reason is written here.

Three groups, run by `.github/workflows/windows-config-acl.yml`:

  HOST    the native pieces (shims compiled with Add-Type, ConvertTo-WslPath, the 5.1 JSON, native arguments and stderr,
          the ACL walk, the profile with nothing set up yet): each file goes through both shells inside its own tests.
          A skip fails the step.
  STRICT  the sh-faked tests of the Podman-in-WSL setup, the app's uninstaller and the long phases, once per shell,
          cut in slices. A skip fails the job.
  OPEN    every other file that is meant for Windows: all `tests/test_*windows*.py` that are not above, and the files
          of WINDOWS_GATE_EXTRA (they do not say «windows» in the name), minus PENDING. A test here may skip for what
          Windows is (there is no bash, no Linux container): the job reads the skips it prints.

A file in PENDING is red on Windows today and waits for its correction: each entry says whose it is and why, and the
entry goes away with the correction (a PENDING entry for a file that no longer exists fails the guard test).
"""
from __future__ import annotations

import sys
from pathlib import Path

TESTS = Path(__file__).resolve().parent

# Native pieces, run in the `host` job. The probe's file is named for one case only: its other cases are in OPEN.
HOST = (
    "tests/test_windows_native_runtime_pieces.py",
    "tests/test_podman_windows_probe.py::test_native_shim_compiles_and_propagates_backend_exit_code",
    "tests/test_windows_powershell51_json.py",
    "tests/test_windows_powershell51_native_quotes.py",
    "tests/test_windows_powershell51_native_stderr.py",
    "tests/test_windows_powershell51_wrapper_native_stderr.py",
    "tests/test_windows_host_env_is_not_written_through_a_link.py",
    "tests/test_windows_host_env_values_have_a_domain.py",
    "tests/test_windows_download_is_verified_on_the_host.py",
    "tests/test_windows_acl_skips_links.py",
    "tests/test_windows_pristine_profile.py",
    "tests/test_windows_onboarding_snapshot_reason.py",
    "tests/test_windows_stdin_without_bom.py",
)

# Under both shells, cut in slices, no skip allowed.
STRICT = (
    # the Podman-in-WSL setup
    "tests/test_windows_podman_wsl_branches.py",
    "tests/test_windows_podman_readiness.py",
    "tests/test_podman_windows_setup_retry.py",
    "tests/test_podman_windows_sidecar_idmap.py",
    "tests/test_podman_windows_cgroupfs.py",
    "tests/test_podman_windows_bundle_owner.py",
    "tests/test_windows_pull_progress.py",
    # the app's uninstaller script
    "tests/test_windows_app_uninstall.py",
    # the long phases, the new-window notice and the wrapper's uninstall
    "tests/test_windows_long_phases_show_progress.py",
    "tests/test_windows_install_path_notice.py",
    "tests/test_windows_uninstall_wrapper.py",
    "tests/test_windows_uninstall_files.py",
    "tests/test_windows_machine_per_user.py",
    "tests/test_windows_shim_exit_code.py",
)

# Meant for Windows although the name does not say so (they run PowerShell with the project's shell switch, or are the
# Windows branch of a test that skips the POSIX one): green on Windows PowerShell 5.1 and on pwsh at the scan of 11/11.
WINDOWS_GATE_EXTRA = (
    "tests/test_artifact_links_every_backend.py",
    "tests/test_first_start_messages_powershell.py",
    "tests/test_installer_core_tier.py",
    "tests/test_powershell_native_args_no_double_quotes.py",
    "tests/test_powershell_native_stderr_under_stop.py",
    "tests/test_runtime_volume_migration.py",
    "tests/test_setup_help_names_the_key_options.py",
    "tests/test_telegram_never_configured.py",
    "tests/test_telegram_status_is_read_only.py",
    "tests/test_wrapper_desktop_apply.py",
)

# Red on Windows today, waiting for the correction: file -> whose it is and why. Empty when all is corrected.
PENDING: dict[str, str] = {}

# Not run on Windows: they test the wrappers on Linux and macOS with pwsh and sh fakes, and use what Windows does not
# have. file -> why. A new file that runs PowerShell must be in one of the groups above or here (the guard test).
POSIX_ONLY: dict[str, str] = {
    "tests/test_agent_shell_privileges.py": "imports pty/fcntl: a POSIX terminal",
    "tests/test_apply_host_wrapper.py": "imports pty: a POSIX terminal",
    "tests/test_broker_reset_wrapper.py": "runs the bash wrapper and a Linux container",
    "tests/test_broker_wrapper.py": "runs the bash wrapper against a Linux container (it reaches the real WSL)",
    "tests/test_cli_help_long_form.py": "runs the bash wrapper",
    "tests/test_cli_help_never_starts_docker.py": "runs the bash wrapper with a docker stub",
    "tests/test_disk_guard.py": "os.statvfs and tmux: Linux and macOS",
    "tests/test_host_env_security.py": "os.getuid and POSIX modes",
    "tests/test_integration_screen.py": "runs the bash wrapper and a Linux container",
    "tests/test_monitor_window_powershell.py": "os.mkfifo: a POSIX pipe",
    "tests/test_oauth_login_provider.py": "starts a shell script directly ([WinError 193] on Windows)",
    "tests/test_telegram_lifecycle.py": "os.getuid and the bash wrapper",
    "tests/test_telegram_lifecycle_stdin.py": "runs the bash wrapper",
    "tests/test_telegram_pairing_wrapper.py": "imports pty/termios and os.killpg: a POSIX terminal",
    "tests/test_telegram_service.py": "os.getuid: POSIX",
    "tests/test_upgrade_image_prune.py": "runs the bash wrapper with a docker stub",
    "tests/test_wrapper_agent_control.py": "starts a shell script directly ([WinError 193] on Windows)",
}

# What a test file uses to run PowerShell for real: the project's own helpers. A file that has one is decided above.
POWERSHELL_RUNNERS = ("JHT_TEST_SHELL", "powershell_argv", "windows_native_fakes")


def _file_of(entry: str) -> str:
    return entry.split("::", 1)[0]


def windows_named(tests_dir: Path = TESTS) -> list[str]:
    """Every tests/test_*windows*.py, as repository paths."""
    return sorted(f"tests/{path.name}" for path in tests_dir.glob("test_*windows*.py"))


def host_files() -> list[str]:
    return list(HOST)


def strict_files() -> list[str]:
    return list(STRICT)


def open_files(tests_dir: Path = TESTS) -> list[str]:
    taken = {_file_of(entry) for entry in STRICT} | {_file_of(entry) for entry in HOST if "::" not in entry}
    chosen = set(windows_named(tests_dir)) | set(WINDOWS_GATE_EXTRA)
    return sorted(chosen - taken - set(PENDING))


def runs_powershell(path: Path) -> bool:
    text = path.read_text(encoding="utf-8", errors="replace")
    return any(marker in text for marker in POWERSHELL_RUNNERS)


def decided(tests_dir: Path = TESTS) -> set[str]:
    """Every test file this module says something about."""
    files = {_file_of(entry) for entry in HOST} | {_file_of(entry) for entry in STRICT}
    return files | set(open_files(tests_dir)) | set(PENDING) | set(POSIX_ONLY)


def undecided(tests_dir: Path = TESTS) -> list[str]:
    """The test files that run PowerShell with the project's helpers and are in no group and not in POSIX_ONLY."""
    known = decided(tests_dir)
    return sorted(
        f"tests/{path.name}"
        for path in tests_dir.glob("test_*.py")
        if runs_powershell(path) and f"tests/{path.name}" not in known
    )


def main(argv: list[str]) -> int:
    groups = {"--host": host_files, "--strict": strict_files, "--open": open_files}
    if len(argv) != 2 or argv[1] not in groups:
        print("usage: windows_gate_files.py --host|--strict|--open", file=sys.stderr)
        return 2
    print("\n".join(groups[argv[1]]()))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
