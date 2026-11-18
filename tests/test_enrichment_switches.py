"""The switches of the Analisti's enrichments (JHT-T324): what they turn off, and what they no longer get wrong.

Three defects of the policy in `enrichment-policy.json`:

1. `geocode_missing.enabled` turned off two things at once, the office geocoding of the pipeline (step 6, the new position) and
   the care queue (the backlog): now the pipeline has its own switch, `geocode_pipeline.enabled`, and a file written before it
   keeps the old meaning (geocoding off stays off).
2. With a score threshold set, the pipeline always said no: a new position has no score yet. `geocode-check` answered NO for
   every new position with `geocode_missing.min_score`, and `logo_fetch.py` POLICY_SCORE_GATE for every new company with
   `logo.min_score`. The thresholds are the care queues' now (their queries apply them).
3. `apply`, the one write the CLI and the desktop use: every key and value checked, all or nothing.

Each case runs the skills as the team runs them, in their own interpreter, on a database and a profile folder of its own.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
SKILLS_DIR = REPO_ROOT / "shared" / "skills"
DB_QUERY = SKILLS_DIR / "db_query.py"
POLICY = SKILLS_DIR / "enrichment_policy.py"
LOGO_FETCH = SKILLS_DIR / "logo_fetch.py"

_SEED = """
import sys
sys.path.insert(0, {skills!r})
from _db import get_db, ensure_schema
conn = get_db()
ensure_schema(conn)
conn.execute("INSERT INTO companies (name, website, logo_fetched) VALUES ('Acme', 'https://acme.example', 0)")
company = conn.execute("SELECT id FROM companies WHERE name = 'Acme'").fetchone()[0]
# 1: a new position, just found, not scored yet (what the Analista sees at step 6)
conn.execute("INSERT INTO positions (title, company, company_id, status, work_mode) VALUES ('Analyst', 'Acme', ?, 'new', 'hybrid')", (company,))
# 2: a remote one
conn.execute("INSERT INTO positions (title, company, company_id, status, work_mode) VALUES ('Remote analyst', 'Acme', ?, 'new', 'remote')", (company,))
conn.commit()
conn.close()
"""


@pytest.fixture()
def home(tmp_path):
    db = tmp_path / "jobs.db"
    seeded = subprocess.run([sys.executable, "-c", _SEED.format(skills=str(SKILLS_DIR))], capture_output=True, text=True,
                            env={**os.environ, "JHT_DB": str(db)})
    assert seeded.returncode == 0, seeded.stderr
    (tmp_path / "profile").mkdir()
    return tmp_path


def _env(home: Path) -> dict:
    env = {key: value for key, value in os.environ.items() if not key.startswith("JHT_")}
    return {**env, "JHT_DB": str(home / "jobs.db"), "PYTHONDONTWRITEBYTECODE": "1"}


def _policy(home: Path, data: dict) -> None:
    (home / "profile" / "enrichment-policy.json").write_text(json.dumps(data), encoding="utf-8")


def _run(home: Path, script: Path, *args: str, stdin: str | None = None) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(script), *args], capture_output=True, text=True, input=stdin, env=_env(home),
                          timeout=60)


def _geocode(home: Path, position: int) -> dict:
    done = _run(home, DB_QUERY, "geocode-check", str(position), "--json")
    assert done.returncode == 0, done.stdout + done.stderr
    return json.loads(done.stdout.strip().splitlines()[-1])


def _shown(home: Path) -> dict:
    done = _run(home, POLICY, "show")
    assert done.returncode == 0, done.stdout + done.stderr
    return json.loads(done.stdout)["policy"]


# ── 1. two switches for geocoding ─────────────────────────────────────────────────────────────────────────────────────
def test_the_care_queue_off_leaves_the_pipeline_geocoding_on(home):
    _policy(home, {"geocode_pipeline": {"enabled": True}, "geocode_missing": {"enabled": False}})
    assert _geocode(home, 1)["geocode"] is True
    queue = _run(home, DB_QUERY, "next-for-geocode-missing")
    assert "OFF" in queue.stdout, queue.stdout


def test_the_pipeline_off_says_no_at_step_6_and_leaves_the_care_queue_on(home):
    _policy(home, {"geocode_pipeline": {"enabled": False}})
    answer = _geocode(home, 1)
    assert answer["geocode"] is False and "geocode_pipeline.enabled=false" in answer["reason"], answer
    queue = _run(home, DB_QUERY, "next-for-geocode-missing")
    assert "OFF" not in queue.stdout, queue.stdout


def test_a_file_written_before_the_two_switches_keeps_geocoding_off(home):
    _policy(home, {"geocode_missing": {"enabled": False}})
    assert _shown(home)["geocode_pipeline"] == {"enabled": False}
    assert _geocode(home, 1)["geocode"] is False


def test_no_file_is_everything_on_and_the_remote_one_still_has_no_office(home):
    assert _shown(home)["geocode_pipeline"] == {"enabled": True}
    assert _geocode(home, 1)["geocode"] is True
    assert _geocode(home, 2)["geocode"] is False


@pytest.mark.parametrize("data", [{"economy": True}], ids=["economy"])
def test_economy_still_turns_the_pipeline_geocoding_off(home, data):
    _policy(home, data)
    assert _geocode(home, 1)["geocode"] is False


# ── 2. a score threshold no longer says no to every new position ─────────────────────────────────────────────────────────
def test_a_geocoding_threshold_does_not_stop_the_new_position_that_has_no_score_yet(home):
    _policy(home, {"geocode_missing": {"min_score": 70}})
    answer = _geocode(home, 1)
    assert answer["geocode"] is True, answer
    assert "score gate" not in answer["reason"]


def test_a_logo_threshold_does_not_stop_the_new_company_that_has_no_score_yet(home):
    _policy(home, {"logo": {"min_score": 70}})
    # an address the guard refuses: the call gets past the policy and stops before any download
    done = _run(home, LOGO_FETCH, "Acme", "--from-url", "http://127.0.0.1/logo.png")
    answer = json.loads(done.stdout.strip().splitlines()[-1])
    assert answer.get("status_code") != "POLICY_SCORE_GATE", answer
    assert answer.get("status_code") == "URL_REFUSED", answer


def test_the_logo_switch_off_still_stops_the_fetch(home):
    _policy(home, {"logo": {"enabled": False}})
    done = _run(home, LOGO_FETCH, "Acme", "--from-url", "http://127.0.0.1/logo.png")
    assert json.loads(done.stdout.strip().splitlines()[-1])["status_code"] == "POLICY_DISABLED"


def test_the_care_queue_still_applies_the_logo_threshold(home):
    _policy(home, {"logo": {"min_score": 70}})
    queue = _run(home, DB_QUERY, "next-for-logo-missing", "--json")
    assert queue.returncode == 0, queue.stderr
    assert "Acme" not in queue.stdout, queue.stdout  # its positions have no score: not in the queue yet


# ── 3. apply: every key and value checked, all or nothing ─────────────────────────────────────────────────────────────────
def test_apply_writes_every_switch_and_answers_with_what_the_file_holds(home):
    request = {"economy": False, "logo.enabled": False, "logo.min_score": 70, "geocode_pipeline.enabled": False,
               "geocode_missing.enabled": True, "geocode_missing.min_score": None, "geocode_missing.non_remote_only": False,
               "recheck_weekly.enabled": False, "recheck_weekly.min_score": 65, "recheck_weekly.older_than_days": 21}
    done = _run(home, POLICY, "apply", stdin=json.dumps(request))
    assert done.returncode == 0, done.stdout + done.stderr
    answer = json.loads(done.stdout)
    assert answer["ok"] is True and answer["exists"] is True
    assert answer["policy"] == {
        "economy": False, "logo": {"enabled": False, "min_score": 70}, "geocode_pipeline": {"enabled": False},
        "geocode_missing": {"enabled": True, "min_score": None, "non_remote_only": False},
        "recheck_weekly": {"enabled": False, "min_score": 65, "older_than_days": 21},
        "web_search": {"analista": {"enabled": False}, "scout": {"enabled": True}, "mentor": {"enabled": True}},
    }
    assert _shown(home) == answer["policy"]


@pytest.mark.parametrize("request_, code", [
    ({"logo.enabled": "false"}, "value_invalid"),
    ({"logo.enabled": 0}, "value_invalid"),
    ({"logo.min_score": 101}, "value_invalid"),
    ({"logo.min_score": True}, "value_invalid"),
    ({"recheck_weekly.min_score": None}, "value_invalid"),
    ({"recheck_weekly.older_than_days": 0}, "value_invalid"),
    ({"recheck_weekly.older_than_days": 2.5}, "value_invalid"),
    ({"economy": True, "logo.size": 3}, "key_unknown"),
    ({}, "request_invalid"),
    (["economy"], "request_invalid"),
], ids=["text-bool", "int-bool", "score-high", "bool-score", "null-recheck", "days-zero", "days-float", "unknown-key",
        "empty", "list"])
def test_apply_refuses_the_whole_request_and_writes_nothing(home, request_, code):
    _policy(home, {"economy": False})
    before = (home / "profile" / "enrichment-policy.json").read_text(encoding="utf-8")
    done = _run(home, POLICY, "apply", stdin=json.dumps(request_))
    assert done.returncode == 1
    assert json.loads(done.stdout) == {"ok": False, "code": code}
    assert (home / "profile" / "enrichment-policy.json").read_text(encoding="utf-8") == before


def test_apply_refuses_what_is_not_json(home):
    done = _run(home, POLICY, "apply", stdin="economy=true")
    assert done.returncode == 1 and json.loads(done.stdout) == {"ok": False, "code": "request_invalid"}
    assert not (home / "profile" / "enrichment-policy.json").exists()


def test_set_takes_the_pipeline_switch_and_refuses_a_threshold_out_of_range(home):
    assert _run(home, POLICY, "set", "geocode_pipeline.enabled", "off").returncode == 0
    assert _shown(home)["geocode_pipeline"] == {"enabled": False}
    refused = _run(home, POLICY, "set", "logo.min_score", "170")
    assert refused.returncode == 1 and json.loads(refused.stdout)["ok"] is False


# ── the Console of the game is gone: nothing tells the team it writes the file ─────────────────────────────────────────────
@pytest.mark.parametrize("path", [
    "shared/skills/enrichment_policy.py", "shared/skills/coordinator_settings.py",
    *[f"agents/capitano/capitano{suffix}.md" for suffix in ("", ".it", ".de", ".es", ".fr", ".hu", ".pt")],
    *[f"agents/_skills/team-modes/SKILL{suffix}.md" for suffix in ("", ".it", ".de", ".es", ".fr", ".hu", ".pt")],
])
def test_no_text_of_the_team_names_the_console_of_the_game(path):
    text = (REPO_ROOT / path).read_text(encoding="utf-8").lower()
    for word in ("console", "consola", "konzol", "konsole"):
        assert word not in text, (path, word)


def test_no_text_of_the_team_names_the_score_gate_of_the_pipeline():
    for path in [*(REPO_ROOT / "agents").rglob("*.md"), LOGO_FETCH]:
        assert "POLICY_SCORE_GATE" not in path.read_text(encoding="utf-8"), path
