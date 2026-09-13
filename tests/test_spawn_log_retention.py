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


def _shell_function(source: str, name: str) -> str:
    start = source.index(f"\n{name}() {{") + 1
    end = source.index("\n}\n", start)
    return source[start : end + 3]


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


def test_watchdog_refreshes_bounded_paths_while_the_daemon_is_running():
    watchdog = WATCHDOG.read_text(encoding="utf-8")
    assert "_rotate_watchdog_log" in _shell_function(watchdog, "log")
    assert "_rotate_recovery_log" in _shell_function(watchdog, "record_recovery")
    assert "_rotate_spawn_failure_log" in _shell_function(
        watchdog, "record_spawn_failure"
    )


def test_daily_recovery_count_survives_size_rotation(tmp_path):
    watchdog = WATCHDOG.read_text(encoding="utf-8")
    recovery_count = _shell_function(watchdog, "recovery_today_count")
    live = tmp_path / "agent-recoveries.tsv"
    rotated = tmp_path / "agent-recoveries.tsv.old"
    live.write_text(
        "2026-09-13T12:02:00Z\tSCOUT-1\tzombie\n", encoding="utf-8"
    )
    rotated.write_text(
        "2026-09-13T12:00:00Z\tSCOUT-1\tmissing\n"
        "2026-09-13T12:01:00Z\tSCOUT-1\tzombie\n",
        encoding="utf-8",
    )
    script = tmp_path / "count.sh"
    script.write_text(
        "#!/usr/bin/env bash\nset -eu\n"
        f"RECOVERY_LOG={live!s}\n"
        f"{recovery_count}\n"
        'recovery_today_count "2026-09-13" "SCOUT-1"\n',
        encoding="utf-8",
    )

    result = subprocess.run(["bash", str(script)], capture_output=True, text=True)

    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "3"


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


def test_watchdog_spawn_output_follows_its_timestamped_log_entry(tmp_path):
    archive = _load_archiver(tmp_path)
    path = archive.LOGS / "agent-watchdog.log"
    fresh = "2026-09-13T12:00:00Z"
    path.write_text(
        "[2026-01-05T12:00:00Z] relaunching worker\n"
        "launcher detail without its own timestamp\n"
        f"[{fresh}] next tick\n"
        "fresh launcher detail\n",
        encoding="utf-8",
    )
    cutoff = time.mktime(time.strptime("2026-06-01", "%Y-%m-%d"))

    result = archive.archive_source(
        {"file": "agent-watchdog.log", "kind": "log"},
        cutoff,
        "test-run",
        dry=False,
    )

    assert result["archived"] == 2
    assert path.read_text(encoding="utf-8") == (
        f"[{fresh}] next tick\nfresh launcher detail\n"
    )
