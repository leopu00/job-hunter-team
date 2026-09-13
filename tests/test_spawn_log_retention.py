"""Spawn and watchdog evidence is bounded and archiveable."""

import importlib.util
import json
import subprocess
import time
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
WATCHDOG = ROOT / ".launcher" / "agent-watchdog.sh"
START_AGENT = ROOT / ".launcher" / "start-agent.sh"
DAEMON_LIB = ROOT / ".launcher" / "daemon-lib.sh"
ARCHIVER = ROOT / "shared" / "skills" / "log_archive.py"

EXPECTED = {
    "agent-watchdog.log": "log",
    "agent-recoveries.tsv": "tsv",
    "agent-spawn-failures.tsv": "tsv",
    "spawn-attempts.jsonl": "jsonl",
}


def _load_archiver(tmp_path: Path):
    spec = importlib.util.spec_from_file_location("log_archive_under_test", ARCHIVER)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(module)
    module.LOGS = tmp_path / "logs"
    module.ARCHIVE_DIR = module.LOGS / "archive"
    module.LOCK = module.LOGS / "log-archive.lock"
    module.LOGS.mkdir()
    return module


def test_watchdog_and_spawn_trace_use_the_shared_size_rotation():
    watchdog = WATCHDOG.read_text(encoding="utf-8")
    launcher = START_AGENT.read_text(encoding="utf-8")
    for name, variable in (
        ("agent-watchdog.log", "LOG"),
        ("agent-recoveries.tsv", "RECOVERY_LOG"),
        ("agent-spawn-failures.tsv", "SPAWN_FAILURE_LOG"),
    ):
        assert f"{variable}=\"${{" in watchdog
        assert f"jht_daemon_log {name}" in watchdog
    assert "jht_daemon_log spawn-attempts.jsonl" in launcher


def test_shared_rotation_moves_an_oversized_log(tmp_path):
    result = subprocess.run(
        [
            "bash",
            "-c",
            f'''
              set -eu
              export JHT_HOME="$1"
              export JHT_DAEMON_LOG_MAX_BYTES=10
              . "{DAEMON_LIB}"
              p="$(jht_daemon_log bounded.log)"
              printf '%s' 12345678901 > "$p"
              jht_daemon_log bounded.log >/dev/null
              test -f "$p.old"
              test ! -s "$p"
            ''',
            "rotation-test",
            str(tmp_path),
        ],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr


def test_archiver_registers_and_parses_every_spawn_log_format(tmp_path):
    archive = _load_archiver(tmp_path)
    registered = {item["file"]: item["kind"] for item in archive.SOURCES}
    assert EXPECTED.items() <= registered.items()

    old = "2026-01-05T12:00:00Z"
    fresh = "2026-09-13T12:00:00Z"
    samples = {
        "agent-watchdog.log": (f"[{old}] old\n", f"[{fresh}] fresh\n"),
        "agent-recoveries.tsv": (f"{old}\tSCOUT-1\told\n", f"{fresh}\tSCOUT-1\tfresh\n"),
        "agent-spawn-failures.tsv": (f"{old}\tSCOUT-1\told\n", f"{fresh}\tSCOUT-1\tfresh\n"),
        "spawn-attempts.jsonl": (
            json.dumps({"timestamp": old, "rc": 1}) + "\n",
            json.dumps({"timestamp": fresh, "rc": 0}) + "\n",
        ),
    }
    cutoff = time.mktime(time.strptime("2026-06-01", "%Y-%m-%d"))
    for name, kind in EXPECTED.items():
        stale, current = samples[name]
        path = archive.LOGS / name
        path.write_text(stale + current, encoding="utf-8")
        result = archive.archive_source(
            {"file": name, "kind": kind}, cutoff, "test-run", dry=False
        )
        assert result["archived"] == 1, (name, result)
        assert path.read_text(encoding="utf-8") == current

    members = []
    for path in archive.ARCHIVE_DIR.glob("*.zip"):
        with zipfile.ZipFile(path) as bundle:
            members.extend(bundle.namelist())
    assert {name for name in EXPECTED if any(m.startswith(name) for m in members)} == set(EXPECTED)
