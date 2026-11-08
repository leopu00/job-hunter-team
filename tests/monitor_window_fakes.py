"""Owned terminal processes: argv, execution and release events, never real GUIs."""
import json
import os
import select
import shutil
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SH = ROOT / "scripts/jht-wrapper.sh"
PS = ROOT / "scripts/jht-wrapper.ps1"

TERMINAL = r'''
import json, os, signal, sys
from pathlib import Path
signal.alarm(10)  # Owned-fake safety net, never a successful-release event.
name = Path(sys.argv[0]).name
args = sys.argv[1:]
if name == 'uname':
    print(os.environ.get('FAKE_KERNEL', 'Linux'))
    sys.exit(0)
record = {'tool': name, 'argv': args, 'pid': os.getpid()}
if name == 'osascript':
    record['program'] = sys.stdin.read()
with open(os.environ['FAKE_TERMINAL_LOG'], 'a') as handle:
    handle.write(json.dumps(record) + '\n')
if os.environ.get('FAKE_TERMINAL_FAIL') == name:
    sys.exit(17)
if os.environ.get('FAKE_TERMINAL_HOLD') == name:
    with open(os.environ['FAKE_TERMINAL_FIFO'], 'rb', buffering=0) as handle:
        handle.read(1)
if os.environ.get('FAKE_TERMINAL_EXECUTE') == '1':
    if name == 'tmux':
        argv = args[4:]
    elif name == 'x-terminal-emulator':
        argv = args[1:]
    elif name == 'osascript':
        argv = [args[1], 'monitor']
    elif name == 'wt.exe':
        argv = args[5:]
    else:
        argv = [os.environ['REAL_PWSH'], *args]
    signal.alarm(0)
    os.execv(argv[0], argv)
'''


def executable(path, text):
    path.write_text(text, encoding="utf-8")
    path.chmod(0o755)
    return path


def environment(root):
    home = root / "home"
    home.mkdir()
    bin_dir = root / "fake-bin"
    bin_dir.mkdir()
    env = {**os.environ, "HOME": str(home), "USERPROFILE": str(home),
           "LOCALAPPDATA": str(root / "local"), "APPDATA": str(root / "app"),
           "JHT_RUNTIME_DIR": str(root / "runtime"), "JHT_HOME": str(home / ".jht"),
           "PATH": f"{bin_dir}:/usr/bin:/bin:/usr/sbin:/sbin", "FAKE_TERMINAL_LOG": str(root / "terminals.jsonl"),
           "JHT_LANG": "en", "FAKE_KERNEL": "Linux"}
    for key in ("TMUX", "TMUX_PANE", "DISPLAY", "WAYLAND_DISPLAY", "JHT_WRAPPER_PATH",
                "JHT_TEST_CONTAINER_RUNTIME", "JHT_CONTAINER_RUNTIME"):
        env.pop(key, None)
    for name in ("docker", "podman", "docker.exe", "podman.exe"):
        executable(bin_dir / name, f'#!{sys.executable}\nimport os\n'
                   'with open(os.environ["FAKE_FORBIDDEN_LOG"], "a") as f: f.write("engine called\\n")\n'
                   'raise SystemExit(99)\n')
    env["FAKE_FORBIDDEN_LOG"] = str(root / "forbidden.log")
    terminal(bin_dir, "uname")  # Never discover/open the real Mac desktop in these tests.
    return bin_dir, env


def terminal(bin_dir, name):
    return executable(bin_dir / name, f"#!{sys.executable}\n" + TERMINAL)


def calls(env):
    path = Path(env["FAKE_TERMINAL_LOG"])
    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


def require_pwsh():
    result = shutil.which("pwsh")
    assert result, "This behavior gate requires pwsh on Linux; no native Windows session is needed."
    return result


def read_until(process, text, timeout=10):
    deadline = time.monotonic() + timeout
    captured = bytearray()
    while time.monotonic() < deadline:
        ready, _, _ = select.select([process.stdout], [], [], max(0, deadline-time.monotonic()))
        if not ready:
            break
        chunk = os.read(process.stdout.fileno(), 65536)
        if not chunk:
            break
        captured.extend(chunk)
        if text.encode() in captured:
            return bytes(captured)
    raise AssertionError(f"missing event {text!r}: {captured.decode(errors='replace')}")


def release(env):
    fd = os.open(env["FAKE_TERMINAL_FIFO"], os.O_WRONLY | os.O_NONBLOCK)
    try:
        os.write(fd, b"x")
    finally:
        os.close(fd)
