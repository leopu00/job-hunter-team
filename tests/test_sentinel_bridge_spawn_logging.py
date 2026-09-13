"""The Sentinel bridge must not discard worker-spawn diagnostics."""

import importlib.util
from pathlib import Path
from types import SimpleNamespace


ROOT = Path(__file__).resolve().parent.parent
BRIDGE = ROOT / ".launcher" / "sentinel-bridge.py"


def _load_bridge(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    spec = importlib.util.spec_from_file_location("sentinel_bridge_spawn_log", BRIDGE)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader
    spec.loader.exec_module(module)
    return module


def test_worker_spawn_result_keeps_bounded_meaningful_stdout_and_stderr(
    tmp_path, monkeypatch, capsys
):
    bridge = _load_bridge(tmp_path, monkeypatch)
    stdout = "\n".join(["", *[f"progress-{i}" for i in range(25)], ""])
    result = SimpleNamespace(
        returncode=7,
        stdout=stdout,
        stderr=b"\nprovider preflight failed\n",
    )

    bridge._log_worker_spawn_result(result)

    logged = capsys.readouterr().err
    assert "worker spawn rc=7" in logged
    assert "stdout: progress-24" in logged
    assert "stderr: provider preflight failed" in logged
    assert "progress-0" not in logged


def test_worker_spawn_timeout_keeps_captured_output(tmp_path, monkeypatch, capsys):
    bridge = _load_bridge(tmp_path, monkeypatch)
    timeout = SimpleNamespace(stdout=b"started\n", stderr="still waiting\n")

    bridge._log_worker_spawn_result(timeout, status="timeout")

    logged = capsys.readouterr().err
    assert "worker spawn rc=timeout" in logged
    assert "stdout: started" in logged
    assert "stderr: still waiting" in logged


def test_worker_fallback_logs_the_actual_launcher_result(
    tmp_path, monkeypatch, capsys
):
    bridge = _load_bridge(tmp_path, monkeypatch)
    session_checks = iter((False, True))
    fake_usage = SimpleNamespace(
        WORKER_BOOT_WAIT_S=0,
        tmux_has_session=lambda _session: next(session_checks),
        query_claude_worker=lambda: "usage buffer",
        parse_claude_usage=lambda _buf: {
            "usage": 12,
            "reset_hhmm_utc": "18:00",
            "weekly": 34,
        },
    )
    fake_spec = SimpleNamespace(loader=SimpleNamespace(exec_module=lambda _module: None))
    monkeypatch.setattr(
        bridge.importlib.util, "spec_from_file_location", lambda *_args: fake_spec
    )
    monkeypatch.setattr(bridge.importlib.util, "module_from_spec", lambda _spec: fake_usage)
    launches = []

    def fake_run(argv, **kwargs):
        launches.append((argv, kwargs))
        return SimpleNamespace(returncode=3, stdout="launcher out", stderr="launcher err")

    monkeypatch.setattr(bridge.subprocess, "run", fake_run)
    monkeypatch.setattr(bridge.time, "sleep", lambda _seconds: None)

    parsed = bridge._try_claude_tui_parser()

    assert parsed == {"usage": 12, "reset_at": "18:00", "weekly_usage": 34}
    assert launches[0][1]["env"]["JHT_SPAWN_SRC"] == "sentinel-bridge"
    logged = capsys.readouterr().err
    assert "worker spawn rc=3" in logged
    assert "worker spawn stdout: launcher out" in logged
    assert "worker spawn stderr: launcher err" in logged
