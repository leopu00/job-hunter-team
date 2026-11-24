"""What the Assistente writes into the profile and what `jht profile validate` accepts are the same thing (collaudo Linux 23/11).

A profile the Assistente had written did not pass validate/import on the same runtime: «preferences: unknown field». The schema was
right (skill profile-schema: `preferences` has four keys, the places and the permits stay at the root, every other wish is a block),
the skill profile-yaml was not: it said that other names under `preferences` «stay written but are invisible». These tests read the
skills in their seven languages and the validator, and prove they say the same; with invented data only.

They also hold the rule of the Assistente after the onboarding (a change of the search goes through validate and
`jht profile import --replace`, so the workers restart on it; anything else is written directly and validated at once), and the
line of the queues that tells the Analista and the Scorer to read the profile again when it changed.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "shared" / "skills"
sys.path.insert(0, str(SKILLS))

import profile_version  # noqa: E402
import validate_profile  # noqa: E402

LANGS = ("", ".it", ".de", ".es", ".fr", ".hu", ".pt")
YAML_SKILL = ROOT / "agents" / "_skills" / "profile-yaml"
SCHEMA_SKILL = ROOT / "agents" / "_skills" / "profile-schema"


def _preference_keys_of(text: str) -> list:
    """The keys the skill writes under `preferences:` in its YAML templates (every template that has the key)."""
    found = []
    for block in re.findall(r"```yaml\n(.*?)```", text, re.S):
        lines = block.split("\n")
        for n, line in enumerate(lines):
            if re.match(r"^preferences:\s*(#.*)?$", line):
                keys = []
                for child in lines[n + 1:]:
                    m = re.match(r"^  ([a-z_]+):", child)
                    if m:
                        keys.append(m.group(1))
                    elif child.strip() and not child.startswith("  "):
                        break
                found.append(keys)
    return found


@pytest.mark.parametrize("folder", [YAML_SKILL, SCHEMA_SKILL], ids=["profile-yaml", "profile-schema"])
@pytest.mark.parametrize("lang", LANGS)
def test_the_preferences_the_skills_write_are_the_ones_the_validator_accepts(folder, lang):
    templates = _preference_keys_of((folder / f"SKILL{lang}.md").read_text(encoding="utf-8"))
    assert templates, "the skill shows how `preferences` is written"
    for keys in templates:
        assert keys == list(validate_profile.PREFERENCE_KEYS), keys


@pytest.mark.parametrize("lang", LANGS)
def test_the_skill_no_longer_says_that_other_names_under_preferences_are_kept(lang):
    text = (YAML_SKILL / f"SKILL{lang}.md").read_text(encoding="utf-8")
    assert "`work_location`" not in text
    assert "preferences: unknown field" in text, "it says what the validator answers to another key"
    assert "location_preferences" in text and "work_authorization" in text and "`kind: key_points`" in text


def _validate(tmp_path: Path, profile: dict) -> dict:
    path = tmp_path / "candidate_profile.yml"
    path.write_text(yaml.safe_dump(profile, allow_unicode=True, sort_keys=False), encoding="utf-8")
    done = subprocess.run([sys.executable, "-I", str(SKILLS / "validate_profile.py"), str(path), "--json"],
                          capture_output=True, text=True, timeout=30, check=False)
    return json.loads(done.stdout)


def _base() -> dict:
    return {
        "name": "Example Person", "email": "candidate@example.invalid", "target_role": "Lighthouse Keeper",
        "location": "Exampletown", "experience_years": 3, "seniority_target": "mid",
        "skills": {"primary": ["Lamp care", "Logbooks"]},
        "languages": [{"language": "Italian", "level": "native"}],
    }


def test_the_wishes_written_where_the_skill_says_validate_and_under_preferences_they_do_not(tmp_path):
    """The kinds of wish of the profile of 23/11 (places, permits, roles to avoid, the scope of the role), invented values."""
    written_as_told = dict(_base(), **{
        "location_preferences": ["Exampletown", "Sampleville"],
        "work_authorization": [{"region": "eu", "status": "citizen"}],
        "preferences": {"work_mode": "hybrid", "work_mode_flexibility": "two days on site", "relocation": False,
                        "salary_annual_eur": None},
        "blocks": [{"key": "preferences", "kind": "key_points", "title": "Preferences",
                    "content": [{"heading": "Roles to avoid", "text": "Night shifts on ferries"},
                                {"heading": "Scope", "text": "One lighthouse, not a whole coast"}]}],
    })
    verdict = _validate(tmp_path, written_as_told)
    assert verdict["ok"] is True, verdict
    invented = dict(_base(), preferences={"work_mode": "hybrid", "coastline": "north", "shift_avoidance": "nights"})
    verdict = _validate(tmp_path, invented)
    assert verdict["ok"] is False and "preferences: unknown field" in verdict["errors"], verdict


# ── the rule of the Assistente after the onboarding ─────────────────────────────────────────────────────────────────────────

def test_the_groups_the_rule_names_are_the_ones_of_profile_version():
    """The skill says «the role, the places, the languages, the work mode»: the four groups of the search (profile_version)."""
    assert tuple(profile_version.GROUPS) == ("roles", "places", "languages", "mode")


@pytest.mark.parametrize("lang", LANGS)
def test_after_the_onboarding_a_change_of_the_search_goes_through_validate_and_the_import(lang):
    text = (YAML_SKILL / f"SKILL{lang}.md").read_text(encoding="utf-8")
    assert re.search(r"^allowed-tools: .*Bash\(jht profile import \*\)", text, re.M), "the Assistente may run the import"
    section = text[text.index("$JHT_HOME/profile/ready.flag` "):]
    validate = section.index('jht profile validate "$JHT_AGENT_DIR/profile-next.yml"')
    imported = section.index('jht profile import "$JHT_AGENT_DIR/profile-next.yml" --replace')
    assert validate < imported, "validated before it is imported"
    assert "VALID_PROFILE" in section[:imported]


# ── the Analista and the Scorer read the profile again when it changed ──────────────────────────────────────────────────────

@pytest.mark.parametrize("role", ["analista", "scorer"])
@pytest.mark.parametrize("lang", LANGS)
def test_the_prompts_of_the_analista_and_the_scorer_act_on_the_line_of_their_queue(role, lang):
    text = (ROOT / "agents" / role / f"{role}{lang}.md").read_text(encoding="utf-8")
    assert f"`db_query.py next-for-{role}` " in text and "`[PROFILE CHANGED]`" in text and "`ack`" in text


def _profile(home: Path, **extra) -> None:
    (home / "profile").mkdir(parents=True, exist_ok=True)
    (home / "profile" / "candidate_profile.yml").write_text(yaml.safe_dump(dict(_base(), **extra)), encoding="utf-8")


def test_any_change_of_the_profile_is_news_to_the_analista_and_the_scorer_and_not_to_the_scout(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    _profile(tmp_path)
    assert profile_version.check_whole("scorer-2")["first"] is True, "the first look: it read the profile at its start"
    assert profile_version.check("scout-6")["first"] is True
    _profile(tmp_path, preferences={"salary_annual_eur": "40k"})            # a «small» change: the salary target
    assert profile_version.check_whole("scorer-2")["changed"] is True
    assert profile_version.check("scout-6")["changed"] is False, "the search does not change for a salary target"
    assert profile_version.ack("scorer-2")["ok"] is True
    assert profile_version.check_whole("scorer-2")["changed"] is False


def test_the_queue_prints_the_line_for_the_agent_of_its_shell_only(tmp_path, monkeypatch):
    import db_query
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    _profile(tmp_path)
    monkeypatch.setenv("JHT_AGENT_NAME", "scorer-2")
    assert db_query.profile_news_line("scorer") == "", "the first look is no news"
    _profile(tmp_path, blocks=[{"key": "goals", "kind": "narrative", "title": "Goals", "content": "A lighthouse by the sea."}])
    line = db_query.profile_news_line("scorer")
    assert line.startswith("[PROFILE CHANGED]") and "profile_version.py ack --agent scorer-2 --all" in line
    monkeypatch.setenv("JHT_AGENT_NAME", "capitano")
    assert db_query.profile_news_line("scorer") == "", "not a Scorer: the queue says nothing"
    monkeypatch.delenv("JHT_AGENT_NAME")
    assert db_query.profile_news_line("analista") == ""
    source = (SKILLS / "db_query.py").read_text(encoding="utf-8")
    assert "profile_news_line(role) if role in ('analista', 'scorer') and rows and not as_json" in source
