"""Contract tests for the isolated portrait PipeWire launch wrapper.

The recording host exposes the selected PipeWire graph through process
environment.  These tests use a fake proc tree, so they prove the inheritance
and fail-closed behaviour without reading a real session or opening a capture.
"""

import os
from pathlib import Path
import subprocess


REPO_ROOT = Path(__file__).resolve().parent.parent
WRAPPER = REPO_ROOT / "scripts" / "run-portrait-session.sh"
ROUTE_ENV = {
    "DBUS_SESSION_BUS_ADDRESS": "unix:path=/run/jht-portrait/bus",
    "XDG_RUNTIME_DIR": "/run/jht-portrait",
    "WAYLAND_DISPLAY": "rel004-vertical",
    "XDG_CURRENT_DESKTOP": "GNOME",
    "PIPEWIRE_REMOTE": "portrait-pipewire",
}


def _write_fake_proc(tmp_path, environment):
    source_pid = "4242"
    environ = tmp_path / "proc" / source_pid / "environ"
    environ.parent.mkdir(parents=True)
    environ.write_bytes(
        b"".join(f"{key}={value}".encode() + b"\0" for key, value in environment.items())
    )
    return source_pid, environ.parents[1]


def _fake_pw_cli(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    pw_cli = bin_dir / "pw-cli"
    pw_cli.write_text(
        "#!/usr/bin/env bash\n"
        "set -euo pipefail\n"
        "[ \"$1\" = info ] && [ \"$2\" = 0 ]\n"
        "[ \"${XDG_RUNTIME_DIR:-}\" = /run/jht-portrait ]\n"
        "[ \"${PIPEWIRE_REMOTE:-}\" = portrait-pipewire ]\n"
    )
    pw_cli.chmod(0o755)
    return bin_dir


def _run(tmp_path, source_environment, *command, extra_env=None):
    source_pid, proc_root = _write_fake_proc(tmp_path, source_environment)
    bin_dir = _fake_pw_cli(tmp_path)
    env = {
        **os.environ,
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
        "DBUS_SESSION_BUS_ADDRESS": "wrong-bus",
        "XDG_RUNTIME_DIR": "/run/physical",
        "WAYLAND_DISPLAY": "wayland-0",
        "XDG_CURRENT_DESKTOP": "wrong-desktop",
        "PIPEWIRE_REMOTE": "wrong-pipewire",
        "KEEP_CALLER_ENV": "yes",
    }
    if extra_env:
        env.update(extra_env)
    return subprocess.run(
        [
            "bash",
            str(WRAPPER),
            "--source-pid",
            source_pid,
            "--proc-root",
            str(proc_root),
            "--",
            *command,
        ],
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )


def test_wrapper_replaces_all_portrait_selectors_without_logging_values(tmp_path):
    command = [
        "bash",
        "-c",
        "printf '%s\\n' \"$DBUS_SESSION_BUS_ADDRESS|$XDG_RUNTIME_DIR|$WAYLAND_DISPLAY|$XDG_CURRENT_DESKTOP|$PIPEWIRE_REMOTE|$KEEP_CALLER_ENV\"",
    ]
    result = _run(tmp_path, ROUTE_ENV, *command)

    assert result.returncode == 0, result.stderr
    assert result.stdout == "unix:path=/run/jht-portrait/bus|/run/jht-portrait|rel004-vertical|GNOME|portrait-pipewire|yes\n"
    assert "portrait session route verified" in result.stderr
    for value in ROUTE_ENV.values():
        assert value not in result.stderr


def test_wrapper_preserves_a_missing_pipewire_remote_as_the_portrait_default(tmp_path):
    source_environment = dict(ROUTE_ENV)
    del source_environment["PIPEWIRE_REMOTE"]
    source_pid, proc_root = _write_fake_proc(tmp_path, source_environment)
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    (bin_dir / "pw-cli").write_text(
        "#!/usr/bin/env bash\n"
        "set -euo pipefail\n"
        "[ \"$1\" = info ] && [ \"$2\" = 0 ]\n"
        "[ \"${XDG_RUNTIME_DIR:-}\" = /run/jht-portrait ]\n"
        "[ -z \"${PIPEWIRE_REMOTE:-}\" ]\n"
    )
    (bin_dir / "pw-cli").chmod(0o755)
    env = {
        **os.environ,
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
        "PIPEWIRE_REMOTE": "physical-session",
    }
    result = subprocess.run(
        [
            "bash", str(WRAPPER), "--source-pid", source_pid, "--proc-root", str(proc_root),
            "--", "bash", "-c", "test -z \"${PIPEWIRE_REMOTE:-}\"",
        ],
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert "physical-session" not in result.stderr


def test_wrapper_refuses_to_start_when_a_required_portrait_selector_is_missing(tmp_path):
    source_environment = dict(ROUTE_ENV)
    del source_environment["WAYLAND_DISPLAY"]
    marker = tmp_path / "target-ran"
    result = _run(
        tmp_path,
        source_environment,
        "bash",
        "-c",
        f"touch {marker}",
    )

    assert result.returncode == 2
    assert "missing WAYLAND_DISPLAY" in result.stderr
    assert not marker.exists()


def test_browser_mode_discovers_but_never_rewrites_the_existing_launcher(tmp_path):
    source_pid, proc_root = _write_fake_proc(tmp_path, ROUTE_ENV)
    bin_dir = _fake_pw_cli(tmp_path)
    fake_node = bin_dir / "node"
    fake_node.write_text(
        "#!/usr/bin/env bash\n"
        "set -euo pipefail\n"
        "printf '%s|%s|%s|%s\\n' \"$1\" \"$2\" \"$XDG_RUNTIME_DIR\" \"$PIPEWIRE_REMOTE\"\n"
    )
    fake_node.chmod(0o755)
    launcher_root = tmp_path / "rel004-thinkpad"
    entrypoint = launcher_root / "release" / "e2e" / "scripts" / "open-recording-browser.mjs"
    entrypoint.parent.mkdir(parents=True)
    original = "// existing portrait launcher\n"
    entrypoint.write_text(original)

    result = subprocess.run(
        [
            "bash", str(WRAPPER), "--source-pid", source_pid, "--proc-root", str(proc_root),
            "--launcher-root", str(launcher_root), "--browser-entrypoint", "--", "--format", "portrait",
        ],
        capture_output=True,
        text=True,
        env={**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}"},
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert result.stdout == f"{entrypoint}|--format|/run/jht-portrait|portrait-pipewire\n"
    assert entrypoint.read_text() == original
