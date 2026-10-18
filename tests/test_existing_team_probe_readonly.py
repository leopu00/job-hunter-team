"""The probe of an existing team only READS, and the team id travels only on stdin.

`team_probe_command` (desktop/src-tauri/src/existing_team_runtime.rs) is the
script the app runs over SSH on the VPS, inside `command()`'s prefix that first
verifies the pinned container, image, platform and digest. It answers whether
the team is there and alive; it must never start, stop or write anything.

The team id is the account's user id: it reaches the VPS on stdin (never in the
SSH command line) and must stay off every argument list there too, because an
argv is visible to anyone who lists the processes of the host.

The script is taken from the Rust source as it is, rendered the way `format!`
renders it, and run by `sh` against a fake `docker` that records every call,
its arguments and its stdin. No cargo, no real engine.
"""

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parent.parent
SOURCE = (ROOT / "desktop" / "src-tauri" / "src" / "existing_team_runtime.rs").read_text(encoding="utf-8")

TEAM_ID = "00000000-0000-4000-8000-0000000000aa"  # synthetic
TARGET = {
    "cid": "a" * 64,
    "image": "sha256:" + "b" * 64,
    "platform": "sha256:" + "c" * 64,
    "revision": "d" * 40,
    "digest": "sha256:" + "e" * 64,
    "os": "linux",
    "architecture": "amd64",
}
OTHER = {
    "cid": "1" * 64,
    "image": "sha256:" + "2" * 64,
    "platform": "sha256:" + "3" * 64,
    "revision": "4" * 40,
    "digest": "sha256:" + "5" * 64,
    "os": "linux",
    "architecture": "arm64",
}


def _raw_string(after: str) -> str:
    start = SOURCE.index('r#"', SOURCE.index(after)) + len('r#"')
    return SOURCE[start : SOURCE.index('"#', start)]


def _function(name: str) -> str:
    start = SOURCE.index(f"pub(crate) fn {name}(")
    return SOURCE[start : SOURCE.index("\n}\n", start) + 3]


TEMPLATE = _raw_string("pub(crate) fn command(")
PROBE = _raw_string("pub(crate) fn team_probe_command(")


def render(target: dict) -> str:
    """`command(target, PROBE)` as format! builds it: named fields replaced,
    `{{`/`}}` unescaped, the operation inserted verbatim."""
    text = TEMPLATE.replace("{{", "\0").replace("}}", "\1")
    for name, value in target.items():
        text = text.replace("{" + name + "}", value)
    text = text.replace("{operation}", "\2")
    assert "{" not in text and "}" not in text, "a placeholder the test does not know"
    return text.replace("\0", "{").replace("\1", "}").replace("\2", PROBE)


FAKE_DOCKER = r"""#!/bin/sh
# Records every call: its arguments separated by \037, the call closed by \036
# (an argument can hold line breaks: the node script does), and the stdin of
# `exec -i` in its own file. Answers like an engine holding the pinned target.
log="$FAKE_DIR/calls"
n=$(( $(cat "$FAKE_DIR/n" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$FAKE_DIR/n"
for a in "$@"; do printf '%s\037' "$a"; done >> "$log"; printf '\036' >> "$log"
case "$1 $2" in
  "inspect --type")
    printf '%s|%s|true|%s|%s\n' "$T_CID" "$T_IMAGE" "$T_REVISION" "$T_PLATFORM_IMAGE" ;;
  "image inspect")
    case "$*" in
      *--platform*) printf '%s|%s|%s|ghcr.io/x/jht@%s,\n' "$T_PLATFORM_IMAGE" "$T_PLATFORM" "$T_REVISION" "$T_DIGEST" ;;
      *) printf '%s|%s|%s|ghcr.io/x/jht@%s,\n' "$T_IMAGE" "$T_PLATFORM" "$T_REVISION" "$T_DIGEST" ;;
    esac ;;
  "exec -i")
    cat > "$FAKE_DIR/stdin-$n"
    printf 'runtimeInstalled=1\ncontainerRunning=1\nproviderConfigured=1\nproviderAuthenticated=1\nprofileReady=0\nassistantWelcomed=1\n' ;;
  "exec "*) exit 0 ;;
  *) exit 99 ;;
esac
"""


def _shells():
    return [path for path in (shutil.which("dash"), shutil.which("sh")) if path]


@pytest.fixture(params=_shells() or [None], ids=lambda p: Path(p).name if p else "none")
def shell(request):
    if sys.platform == "win32":
        pytest.skip("the probe runs in the VPS shell")
    if request.param is None:
        pytest.skip("no POSIX shell")
    return request.param


def run_probe(shell, tmp_path, team_id=TEAM_ID):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    (bin_dir / "docker").write_text(FAKE_DOCKER, encoding="utf-8", newline="\n")
    (bin_dir / "docker").chmod(0o755)
    fake = tmp_path / "fake"
    fake.mkdir()
    env = {
        **os.environ,
        "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}",
        "FAKE_DIR": str(fake),
        "T_CID": TARGET["cid"],
        "T_IMAGE": TARGET["image"],
        "T_PLATFORM_IMAGE": TARGET["platform"],
        "T_REVISION": TARGET["revision"],
        "T_DIGEST": TARGET["digest"],
        "T_PLATFORM": f"{TARGET['os']}/{TARGET['architecture']}",
    }
    result = subprocess.run(
        [shell, "-c", render(TARGET)],
        input=f"{team_id}\n", capture_output=True, text=True, env=env, timeout=30,
    )
    calls_file = fake / "calls"
    raw = calls_file.read_text(encoding="utf-8") if calls_file.exists() else ""
    calls = [record.split("\037")[:-1] for record in raw.split("\036")[:-1]]
    stdins = {int(p.name.split("-")[1]): p.read_text(encoding="utf-8") for p in fake.glob("stdin-*")}
    return result, calls, stdins


def test_the_probe_answers_through_the_fake_engine(shell, tmp_path):
    """Counter-check: the harness runs the real script to its end."""
    result, calls, _ = run_probe(shell, tmp_path)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "captainRunning=1" in result.stdout and "assistantRunning=1" in result.stdout
    assert len(calls) == 6, calls


def test_the_team_id_travels_only_on_stdin(shell, tmp_path):
    result, calls, stdins = run_probe(shell, tmp_path)
    assert result.returncode == 0, result.stdout + result.stderr
    assert TEAM_ID not in render(TARGET), "the id is in the SSH command line"
    for call in calls:
        assert not any(TEAM_ID in arg for arg in call), f"the team id is an argument on the VPS: {call}"
    assert any(TEAM_ID in text for text in stdins.values()), "the id never reaches the probe on stdin"


def test_a_malformed_team_id_never_reaches_the_container(shell, tmp_path):
    for bad in ("short", "x" * 129, "00000000-0000-4000-8000-0000000000aa;rm -rf /", "a b c d e f g h i j"):
        case = tmp_path / f"case{len(bad)}"
        case.mkdir()
        result, calls, _ = run_probe(shell, case, bad)
        assert result.returncode == 64, (bad, result.stderr)
        assert not [call for call in calls if call[:1] == ["exec"]], (bad, calls)


def test_the_probe_only_inspects_and_reads(shell, tmp_path):
    _, calls, _ = run_probe(shell, tmp_path)
    for call in calls:
        verb = call[0]
        assert verb in ("inspect", "image", "exec"), call
        if verb == "image":
            assert call[1] == "inspect", call
        if verb == "exec":
            flags = call[1 : call.index(TARGET["cid"])]
            assert set(flags) <= {"-i"}, f"exec with options: {call}"
            program = call[call.index(TARGET["cid"]) + 1 :]
            assert program[:2] == ["node", "-e"] or program[:2] == ["tmux", "has-session"], call
    # and in the text, nothing that starts, stops, writes or sends
    for forbidden in (
        "docker start", "docker stop", "docker restart", "docker rm", "docker kill", "docker run",
        "docker cp", "docker pull", "docker compose", "docker update", "-u ", "--user", "--privileged",
        "send-keys", "jht-tmux-send", "start-agent", "new-session", "kill-session", "kill-server",
        "jht up", "team start", "curl ", "wget ", "writeFileSync", "appendFileSync", "unlink",
        "mkdir", "rmSync", "renameSync", "child_process", "> /", ">> /",
    ):
        assert forbidden not in PROBE, forbidden


def test_the_only_interpolation_is_the_validated_target():
    # The operation is a fixed raw string handed to command(), never built.
    probe_fn = _function("team_probe_command")
    assert "format!" not in probe_fn and probe_fn.count('r#"') == 1
    # command() names exactly the target's fields and the operation.
    names = set(re.findall(r"\{(\w+)\}", TEMPLATE.replace("{{", "").replace("}}", "")))
    assert names == set(TARGET) | {"operation"}, names
    # Two valid targets render the same script once their values are masked.
    def masked(target):
        text = render(target)
        for name, value in target.items():
            text = text.replace(value, f"<{name}>")
        return text
    assert masked(TARGET) == masked(OTHER)
    # and every field is one valid_target checks to a closed shape
    valid = _function("valid_target")
    for check in ("hex(&target.container_id, 64)", "hex(&target.oci_revision, 40)", 'target.os == "linux"', '"amd64" | "arm64"'):
        assert check in valid, check
