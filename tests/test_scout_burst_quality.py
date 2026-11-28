"""Scout writes require one checked candidate; imports and distinct territories retain their contracts."""
import json
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

SKILLS = Path(__file__).resolve().parents[1] / "shared" / "skills"


@pytest.fixture
def home(tmp_path):
    return {**os.environ, "JHT_HOME": str(tmp_path), "JHT_DB": str(tmp_path / "jobs.db"), "JHT_AGENT_NAME": "scout-1"}


def command(n=1, location="Remote, Spain", found_by="scout-1"):
    return ["position", "--title", "Software Engineer", "--company", "Synthetic Company",
            "--location", location, "--remote-type", "full_remote", "--url", f"https://jobs.example/{n}",
            "--source", "remoteok", "--found-by", found_by, "--jd-text", "Complete synthetic description.",
            "--requirements", "Python and SQL."]


def run(home, args):
    return subprocess.run([sys.executable, str(SKILLS / "db_insert.py"), *args], env=home,
                          capture_output=True, text=True, timeout=30)


def receipt(home, args):
    result = run(home, args + ["--check-only", "--link-verified", "--filters-checked"])
    assert result.returncode == 0, result.stdout + result.stderr
    return json.loads(result.stdout)["scout_check"]


def test_a_mass_insert_without_per_candidate_checks_writes_nothing(home):
    for n in range(13):
        result = run(home, command(n))
        assert result.returncode == 5 and "SC09_REFUSED" in result.stderr
    with sqlite3.connect(home["JHT_DB"]) as conn:
        assert conn.execute("SELECT count(*) FROM positions").fetchone()[0] == 0


def test_receipt_binds_data_and_agent_and_is_consumed_by_the_insert(home):
    args = command()
    token = receipt(home, args)
    changed = command(location="Remote, Portugal")
    assert run(home, changed + ["--scout-check", token]).returncode == 5
    assert run({**home, "JHT_AGENT_NAME": "scout-2"}, args + ["--scout-check", token]).returncode == 5
    assert run(home, args + ["--scout-check", token]).returncode == 0
    with sqlite3.connect(home["JHT_DB"]) as conn:
        assert conn.execute("SELECT count(*) FROM scout_position_checks").fetchone()[0] == 0
    assert run(home, command(2) + ["--scout-check", token]).returncode != 0


def test_checking_a_second_candidate_invalidates_the_first_and_receipts_expire(home):
    first = receipt(home, command())
    second = receipt(home, command(2, "Remote, Portugal"))
    assert run(home, command() + ["--scout-check", first]).returncode == 5
    with sqlite3.connect(home["JHT_DB"]) as conn:
        conn.execute("UPDATE scout_position_checks SET expires = 0")
    assert run(home, command(2, "Remote, Portugal") + ["--scout-check", second]).returncode == 5


def test_check_requires_both_confirmations_and_nonempty_jd(home):
    args = command()
    assert run(home, args + ["--check-only", "--link-verified"]).returncode == 5
    args[args.index("--jd-text") + 1] = " "
    assert run(home, args + ["--check-only", "--link-verified", "--filters-checked"]).returncode == 5


@pytest.mark.parametrize("location", ["<location>", "N/A", "TBD", "sede segnaposto", "{{city}}", "Location here"])
def test_placeholder_locations_are_refused_even_for_imports(home, location):
    result = run({**home, "JHT_AGENT_NAME": "import-synthetic"}, command(location=location, found_by="import-synthetic"))
    assert result.returncode == 5 and "LOCATION_PLACEHOLDER" in result.stderr
    assert not Path(home["JHT_DB"]).exists()


@pytest.mark.parametrize("actor", ["import-synthetic", ""])
def test_imports_do_not_need_a_scout_receipt(home, actor):
    assert run({**home, "JHT_AGENT_NAME": actor}, command(found_by="import-synthetic")).returncode == 0


def test_a_scout_cannot_bypass_checks_by_claiming_an_import_identity(home):
    assert run(home, command(found_by="import-synthetic")).returncode == 5


def test_distinct_remote_territories_are_inserted_but_same_territory_is_duplicate(home):
    for n, place in enumerate(("Remote, Spain", "Remote, Portugal")):
        args = command(n, place)
        assert run(home, args + ["--scout-check", receipt(home, args)]).returncode == 0
    assert run(home, command(3, "Remote, Spain") + ["--check-only", "--link-verified", "--filters-checked"]).returncode == 1


@pytest.mark.parametrize("suffix", ["", ".it", ".de", ".es", ".fr", ".pt", ".hu"])
def test_all_scout_prompts_explain_the_enforced_check_and_source_log(suffix):
    text = (SKILLS.parents[1] / "agents" / "scout" / f"scout{suffix}.md").read_text()
    for contract in ("--check-only", "--scout-check", "LOCATION_PLACEHOLDER", "pass_id", "concorsipubblici-it"):
        assert contract in text


def test_identical_full_jds_do_not_merge_different_remote_territories(home):
    for n, place in enumerate(("Remote, Spain", "Remote, Portugal")):
        args = command(n, place)
        args[args.index("--jd-text") + 1] = " ".join(f"syntheticword{i}" for i in range(60))
        assert run(home, args + ["--scout-check", receipt(home, args)]).returncode == 0
    with sqlite3.connect(home["JHT_DB"]) as conn:
        assert conn.execute("SELECT count(*) FROM positions").fetchone()[0] == 2


def test_unknown_location_is_null_instead_of_a_placeholder(home):
    args = command(found_by="import-synthetic")
    i = args.index("--location")
    del args[i:i + 2]
    assert run({**home, "JHT_AGENT_NAME": ""}, args).returncode == 0
    with sqlite3.connect(home["JHT_DB"]) as conn:
        assert conn.execute("SELECT location FROM positions").fetchone()[0] is None
