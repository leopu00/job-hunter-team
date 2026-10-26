"""`jht providers limits` con Codex: subito dopo il login non c'e' nessun rollout con `rate_limits` (Codex li scrive
solo dopo la risposta di un turno), e la sonda diceva «unknown». Ora, se i rollout non bastano, chiede a Codex stesso
(`codex app-server`, `account/rateLimits/read`, lo stesso dato di /status). Qui contro un finto `codex` che parla il
protocollo a righe JSON: le due forme di piano (finestra unica settimanale e 5h + settimanale), l'esaurito, e
tutto cio' che deve restare «unknown» senza dettagli.
"""
import importlib.util
import json
import os
import stat
import subprocess
import sys
import time
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
BRIDGE_PATH = REPO_ROOT / ".launcher" / "sentinel-bridge.py"
NOW = 1_800_000_000
SECRET = "sk-fixture-secret-must-never-be-printed"

pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="il bridge gira nel container Linux")

FAKE_CODEX = r"""#!/usr/bin/env python3
import json, os, sys, time
mode = open(os.environ["FAKE_MODE_FILE"]).read().strip()
with open(os.environ["FAKE_CALLS_FILE"], "a") as log:
    log.write(json.dumps({"argv": sys.argv[1:], "codex_home": os.environ.get("CODEX_HOME")}) + "\n")
def window(used, mins, resets):
    return {"usedPercent": used, "windowDurationMins": mins, "resetsAt": resets}
NOW = %(now)d
RATE = {
    "weekly": {"primary": window(16, 10080, NOW + 5 * 86400), "secondary": None},
    "both": {"primary": window(40, 300, NOW + 3600), "secondary": window(60, 10080, NOW + 86400)},
    "swapped": {"primary": window(60, 10080, NOW + 86400), "secondary": window(40, 300, NOW + 3600)},
    "exhausted": {"primary": window(97, 10080, NOW + 2 * 86400), "secondary": None},
    "stale": {"primary": window(16, 10080, NOW - 10), "secondary": None},
}
if mode == "child":
    import subprocess
    child = subprocess.Popen(["sleep", "120"])
    open(os.environ["FAKE_CHILD_FILE"], "w").write(str(child.pid))
    mode = "weekly"
for line in sys.stdin:
    message = json.loads(line)
    if message.get("method") == "initialize":
        print(json.dumps({"id": message["id"], "result": {"userAgent": "fake"}}), flush=True)
    elif message.get("method") == "account/rateLimits/read":
        if mode == "silent":
            time.sleep(60)
        elif mode == "error":
            print(json.dumps({"id": message["id"], "error": {"code": -32600, "message": "codex account authentication required"}}), flush=True)
        elif mode == "garbage":
            print("not json", flush=True)
            print(json.dumps({"id": message["id"], "result": {"rateLimits": "no"}}), flush=True)
        else:
            print(json.dumps({"id": message["id"], "result": {"rateLimits": dict(RATE[mode], planType="x")}}), flush=True)
"""


@pytest.fixture
def world(tmp_path, monkeypatch):
    home = tmp_path / "jht"
    home.mkdir()
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    fake = bin_dir / "codex"
    fake.write_text(FAKE_CODEX % {"now": NOW}, encoding="utf-8")
    fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
    mode_file, calls_file = tmp_path / "mode", tmp_path / "calls"
    mode_file.write_text("weekly", encoding="utf-8")
    monkeypatch.setenv("JHT_HOME", str(home))
    monkeypatch.setenv("PATH", f"{bin_dir}:{os.environ['PATH']}")
    monkeypatch.setenv("FAKE_MODE_FILE", str(mode_file))
    monkeypatch.setenv("FAKE_CALLS_FILE", str(calls_file))
    monkeypatch.setenv("FAKE_CHILD_FILE", str(tmp_path / "child.pid"))
    monkeypatch.setenv("OPENAI_API_KEY", SECRET)
    monkeypatch.setenv("PYTHONDONTWRITEBYTECODE", "1")

    def mode(value):
        mode_file.write_text(value, encoding="utf-8")

    def calls():
        return [json.loads(line) for line in calls_file.read_text(encoding="utf-8").splitlines()] if calls_file.exists() else []

    spec = importlib.util.spec_from_file_location("sentinel_bridge_app_server_test", BRIDGE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return type("World", (), {"home": home, "bin": bin_dir, "bridge": module, "mode": staticmethod(mode),
                              "calls": staticmethod(calls)})


def _rollout(home, resets, used=33):
    folder = home / ".codex" / "sessions" / "2026" / "10" / "26"
    folder.mkdir(parents=True, exist_ok=True)
    rate = {"primary": {"used_percent": used, "window_minutes": 10080, "resets_at": resets}, "secondary": None}
    event = {"timestamp": "2026-10-26T18:00:00.000Z", "type": "event_msg",
             "payload": {"type": "token_count", "rate_limits": rate}}
    (folder / "rollout-2026-10-26T18-00-00-x.jsonl").write_text(
        "\n".join(json.dumps(event) for _ in range(20)) + "\n", encoding="utf-8")


def test_right_after_the_login_a_single_weekly_plan_is_read_from_codex_itself(world):
    verdict = world.bridge.probe_limits("codex", now=NOW)
    assert verdict == {"status": "ok", "resets_at": None, "five_hour": None,
                       "weekly": {"used_pct": 16, "resets_at": NOW + 5 * 86400}}
    assert world.calls() == [{"argv": ["app-server"], "codex_home": str(world.home / ".codex")}]


@pytest.mark.parametrize("mode", ["both", "swapped"])
def test_a_plan_with_a_five_hour_and_a_weekly_window_gives_both_whichever_comes_first(world, mode):
    world.mode(mode)
    verdict = world.bridge.probe_limits("openai", now=NOW)
    assert verdict["status"] == "ok"
    assert verdict["five_hour"] == {"used_pct": 40, "resets_at": NOW + 3600}
    assert verdict["weekly"] == {"used_pct": 60, "resets_at": NOW + 86400}


def test_an_exhausted_window_says_when_it_frees(world):
    world.mode("exhausted")
    verdict = world.bridge.probe_limits("codex", now=NOW)
    assert verdict["status"] == "exhausted" and verdict["resets_at"] == NOW + 2 * 86400


def test_the_rollouts_stay_the_first_source_and_codex_is_not_asked_when_they_are_enough(world):
    _rollout(world.home, NOW + 86400)
    verdict = world.bridge.probe_limits("codex", now=NOW)
    assert verdict["status"] == "ok" and verdict["weekly"] == {"used_pct": 33, "resets_at": NOW + 86400}
    assert world.calls() == []


def test_rollouts_of_a_window_that_already_turned_over_do_not_hide_the_real_figure(world):
    _rollout(world.home, NOW - 100)
    verdict = world.bridge.probe_limits("codex", now=NOW)
    assert verdict["weekly"] == {"used_pct": 16, "resets_at": NOW + 5 * 86400}


@pytest.mark.parametrize("mode", ["error", "garbage", "stale"])
def test_whatever_codex_cannot_say_stays_unknown_without_details(world, mode):
    world.mode(mode)
    verdict = world.bridge.probe_limits("codex", now=NOW)
    assert verdict == {"status": "unknown", "resets_at": None, "five_hour": None, "weekly": None}


def test_a_codex_that_never_answers_gives_up_at_the_time_limit_and_is_killed(world, monkeypatch):
    world.mode("silent")
    monkeypatch.setattr(world.bridge, "CODEX_APP_SERVER_TIMEOUT_S", 1)
    started = time.monotonic()
    verdict = world.bridge.probe_limits("codex", now=NOW)
    assert verdict["status"] == "unknown" and time.monotonic() - started < 10
    time.sleep(0.3)
    stray = subprocess.run(["pgrep", "-f", f"{world.bin}/codex"], capture_output=True, text=True)
    assert stray.stdout.strip() == "", "no app-server left behind"


def test_without_a_codex_executable_it_is_unknown(world, monkeypatch):
    monkeypatch.setenv("PATH", "/usr/bin:/bin")
    assert world.bridge.probe_limits("codex", now=NOW)["status"] == "unknown"


def test_the_other_providers_never_ask_codex(world):
    world.bridge.probe_limits("claude", now=NOW)
    world.bridge.probe_limits("kimi", now=NOW)
    assert world.calls() == []


def test_the_command_line_prints_only_percentages_and_resets_and_no_secret(world):
    env = {**os.environ, "JHT_HOME": str(world.home)}
    done = subprocess.run([sys.executable, str(BRIDGE_PATH), "--probe-limits"], capture_output=True, text=True,
                          timeout=60, env=env)
    assert done.returncode == 0, done.stderr
    printed = json.loads(done.stdout)
    assert set(printed) == {"status", "resets_at", "five_hour", "weekly"} and printed["status"] in {"ok", "unknown"}
    assert SECRET not in done.stdout + done.stderr


def _alive(pid):
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def test_the_native_child_of_the_launcher_does_not_outlive_the_read(world, tmp_path):
    world.mode("child")
    verdict = world.bridge.probe_limits("codex", now=NOW)
    assert verdict["status"] == "ok"
    pid = int((tmp_path / "child.pid").read_text(encoding="utf-8"))
    for _ in range(50):
        if not _alive(pid):
            break
        time.sleep(0.1)
    assert not _alive(pid), "the child of codex app-server was left running"
