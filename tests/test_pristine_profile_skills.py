"""The skills and the stores of the runtime read what a first install does not have yet, and say so without breaking (T319 class).

T319: on a profile that had never configured Telegram, `lifecycle.json` did not exist and `expected-services` answered an
error. The machine the setup was tried on had been installed over dozens of times, so the file was already there and the
defect stayed hidden. These tests start from the pristine state on purpose: an EMPTY home, no database, no state file, no
config, no volume content. Each one fails when "it is not there yet" becomes an error (a Traceback, a raw OSError, a
SQLite error, a wrong exit code).

What is pinned here:
  - the read-only commands of the skills that the agents, the Sentinella and the installer ask on a first start;
  - the stores of Telegram and of the broker: a folder that exists with no file in it is "not configured" (the default),
    a folder that is missing is the typed error `store_missing`, never a raw FileNotFoundError.

Made-up homes only; nothing reads or writes outside the temporary folder.

Run:
    pytest tests/test_pristine_profile_skills.py -v
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "shared" / "skills"
sys.path.insert(0, str(ROOT))

from shared.broker import store as broker_store  # noqa: E402
from shared.telegram_service import store as telegram_store  # noqa: E402


pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="the runtime image is Linux: POSIX owners and modes in the stores")


def run_skill(tmp_path, script, *args, timeout=60):
    """The way the agents run a skill: `python3 <file> <args>`, with a home that has nothing in it."""
    home = tmp_path / "home"
    home.mkdir(exist_ok=True)
    env = {
        "PATH": os.environ.get("PATH", ""),
        "HOME": str(home),
        "JHT_HOME": str(home / ".jht"),
        "TMPDIR": str(tmp_path),
        "PYTHONDONTWRITEBYTECODE": "1",
        "JHT_HOST_ENV_FILE": str(tmp_path / "no-host.env"),
        "JHT_LANG": "en",
    }
    return subprocess.run([sys.executable, str(SKILLS / script), *args], cwd=tmp_path, env=env,
                          capture_output=True, text=True, timeout=timeout, check=False, stdin=subprocess.DEVNULL)


# (the skill, its arguments, the exit codes that are an answer and not a failure)
PRISTINE_READS = [
    ("first_run.py", ["status"], {0}),
    ("first_run.py", ["plan"], {0, 1}),             # no plan declared: a refusal with a hint, not a guess
    ("plan_registry.py", ["get"], {0, 1}),          # PLAN_MISSING
    ("plan_registry.py", ["list"], {0}),
    ("plan_registry.py", ["roster"], {0, 1}),
    ("burst.py", ["status"], {0}),
    ("provider_capacity.py", [], {0}),
    ("host_capacity.py", [], {0}),
    ("team_roster.py", ["roles"], {0}),
    ("team_roster.py", ["next-respawn"], {0, 1}),
    ("team_roster.py", ["contained-live", "--tsv"], {0}),
    ("team_roster.py", ["release-expired", "--tsv"], {0}),
    ("throttle_engine.py", ["status"], {0}),
    ("agent_state.py", [], {0}),
    ("model_pricing.py", [], {0}),
    ("db_query.py", ["stats"], {0}),
    ("db_query.py", ["next-for-analista"], {0}),
    ("db_query.py", ["next-for-scorer"], {0}),
    ("event_wake.py", ["wake", "--role", "analista"], {0}),
]


@pytest.mark.parametrize(("script", "args", "answers"), PRISTINE_READS, ids=[f"{s} {' '.join(a)}".strip() for s, a, _ in PRISTINE_READS])
def test_a_read_on_a_pristine_home_is_an_answer_never_a_crash(tmp_path, script, args, answers):
    done = run_skill(tmp_path, script, *args)
    assert "Traceback" not in done.stderr and "Traceback" not in done.stdout, done.stderr[-800:]
    assert done.returncode in answers, (done.returncode, done.stdout[-300:], done.stderr[-300:])
    for noise in ("FileNotFoundError", "sqlite3.OperationalError", "KeyError", "JSONDecodeError"):
        assert noise not in done.stderr + done.stdout, noise


def test_the_first_run_of_a_pristine_home_is_not_started_yet(tmp_path):
    done = run_skill(tmp_path, "first_run.py", "status")
    state = json.loads(done.stdout)
    assert state["phase"] not in ("burst", "steady"), state


def test_a_pristine_home_has_no_burst_and_no_plan_and_says_so(tmp_path):
    burst = json.loads(run_skill(tmp_path, "burst.py", "status").stdout)
    assert burst == {"ok": True, "burst": {"active": False}}
    plan = run_skill(tmp_path, "plan_registry.py", "get")
    assert plan.returncode == 1 and "PLAN_MISSING" in plan.stdout + plan.stderr


def test_a_pristine_database_is_empty_not_missing(tmp_path):
    stats = run_skill(tmp_path, "db_query.py", "stats").stdout
    assert "positions: 0" in stats and "companies: 0" in stats and "scores: 0" in stats
    assert "none" in run_skill(tmp_path, "db_query.py", "next-for-analista").stdout.lower()
    assert "none" in run_skill(tmp_path, "db_query.py", "next-for-scorer").stdout.lower()


def test_the_wake_with_nothing_in_the_queue_decides_to_do_nothing(tmp_path):
    out = json.loads(run_skill(tmp_path, "event_wake.py", "wake", "--role", "analista").stdout)
    assert out["woken"] is None and out["why"] == "queue_empty"


def test_the_roster_without_a_plan_is_a_refusal_with_a_hint_not_a_default(tmp_path):
    done = run_skill(tmp_path, "plan_registry.py", "roster")
    out = json.loads(done.stdout)
    assert done.returncode == 1 and out["ok"] is False and out["hint"]


# ── the stores: a folder with nothing in it is "not configured", a missing folder is a typed error ───────────────

@pytest.fixture
def stores(tmp_path, monkeypatch):
    dirs = {name: tmp_path / name for name in ("tg-secrets", "tg-state", "br-secrets", "br-state")}
    for path in dirs.values():
        path.mkdir(mode=0o700)
        (path / "bots").mkdir(mode=0o700) if path.name == "tg-secrets" else None
    monkeypatch.setenv("JHT_TELEGRAM_SECRETS", str(dirs["tg-secrets"]))
    monkeypatch.setenv("JHT_TELEGRAM_STATE", str(dirs["tg-state"]))
    monkeypatch.setenv("JHT_BROKER_SECRETS", str(dirs["br-secrets"]))
    monkeypatch.setenv("JHT_BROKER_STATE", str(dirs["br-state"]))
    return dirs


def test_a_telegram_store_with_no_files_is_not_configured(stores):
    assert telegram_store.read_bot("assistente") is None
    assert telegram_store.read_state("pairing", {}) == {}
    assert telegram_store.read_state("anything-new", []) == []


def test_a_broker_store_with_no_files_is_not_configured(stores):
    for name in broker_store.SECRET_NAMES:
        assert broker_store.read_secret(name) is None, name
    assert broker_store.read_state("anything-new", {}) == {}


@pytest.mark.parametrize("which", ["tg-secrets", "tg-state"])
def test_a_telegram_folder_that_is_not_there_is_the_typed_error_store_missing(stores, which):
    stores[which].rename(stores[which].with_name(which + "-gone"))
    with pytest.raises(telegram_store.StoreError) as raised:
        if which == "tg-secrets":
            telegram_store.read_bot("assistente")
        else:
            telegram_store.read_state("pairing", {})
    assert "store_missing" in str(raised.value) or getattr(raised.value, "code", "") == "store_missing"


@pytest.mark.parametrize("which", ["br-secrets", "br-state"])
def test_a_broker_folder_that_is_not_there_is_the_typed_error_store_missing(stores, which):
    stores[which].rename(stores[which].with_name(which + "-gone"))
    with pytest.raises(broker_store.StoreError) as raised:
        if which == "br-secrets":
            broker_store.read_secret(broker_store.SECRET_NAMES[0])
        else:
            broker_store.read_state("anything-new", {})
    assert "store_missing" in str(raised.value) or getattr(raised.value, "code", "") == "store_missing"


def test_a_file_cut_to_zero_bytes_is_a_typed_unreadable_store_not_a_raw_json_error(stores):
    """A crash in the middle of the first write can leave an empty file: the answer is a StoreError the callers know."""
    path = stores["tg-state"] / "pairing.json"
    path.write_text("", encoding="utf-8")
    path.chmod(0o600)
    with pytest.raises(telegram_store.StoreError):
        telegram_store.read_state("pairing", {})
    empty = stores["br-state"] / "anything.json"
    empty.write_text("", encoding="utf-8")
    empty.chmod(0o600)
    with pytest.raises(broker_store.StoreError):
        broker_store.read_state("anything", {})
