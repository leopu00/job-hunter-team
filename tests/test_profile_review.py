"""Causal regression tests for issue #131's CV profile review flow."""

from __future__ import annotations

import json
import os
import stat
import subprocess
import sys
from pathlib import Path

import pytest
import yaml


ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / "shared" / "skills" / "profile_review.py"
STATUS_PAYLOAD = ROOT / "game" / "scripts" / "backend" / "payloads" / "profile_status.py"
SAVE_PAYLOAD = ROOT / "game" / "scripts" / "backend" / "payloads" / "profile_save.py"
PROFILE_SKILLS = sorted((ROOT / "agents" / "_skills" / "profile-yaml").glob("SKILL*.md"))
ONBOARDING_SKILLS = sorted((ROOT / "agents" / "_skills" / "onboarding-flow").glob("SKILL*.md"))
ASSISTANT_PROMPTS = sorted((ROOT / "agents" / "assistente").glob("assistente*.md"))


def _run(home: Path, agent: Path, *args: str, extra_env: dict[str, str] | None = None):
    env = os.environ.copy()
    env.update({"JHT_HOME": str(home), "JHT_AGENT_DIR": str(agent)})
    env.update(extra_env or {})
    result = subprocess.run(
        [sys.executable, str(HELPER), *args],
        check=False,
        capture_output=True,
        text=True,
        env=env,
    )
    return result, json.loads(result.stdout)


def _complete_patch() -> dict:
    return {
        "name": "Ada Test",
        "email": "ada@example.invalid",
        "target_role": "Operations Manager",
        "location": "Example City",
        "experience_years": 6,
        "has_degree": True,
        "seniority_target": "senior",
        "skills": {"primary": ["Planning", "Negotiation"]},
        "languages": [{"language": "English", "level": "C1"}],
    }


def _write_patch(agent: Path, value: dict) -> None:
    agent.mkdir(parents=True, exist_ok=True)
    (agent / "profile-review.yml").write_text(
        yaml.safe_dump(value, allow_unicode=True, sort_keys=False), encoding="utf-8"
    )


def _status(home: Path) -> dict:
    source = STATUS_PAYLOAD.read_text(encoding="utf-8")
    source = source.replace("/jht_home", str(home))
    source = source.replace("/app/shared/skills", str(HELPER.parent))
    result = subprocess.run(
        [sys.executable, "-c", source],
        check=False,
        capture_output=True,
        text=True,
        env={**os.environ, "JHT_HOME": str(home)},
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def _save_from_desktop(home: Path, fields: dict):
    import base64

    encoded = base64.b64encode(json.dumps(fields).encode()).decode()
    source = SAVE_PAYLOAD.read_text(encoding="utf-8") % encoded
    source = source.replace("/app/shared/skills", str(HELPER.parent))
    env = {**os.environ, "JHT_HOME": str(home)}
    return subprocess.run(
        [sys.executable, "-c", source],
        check=False,
        capture_output=True,
        text=True,
        env=env,
    )


def test_empty_profile_stays_empty_until_exact_review_is_confirmed(tmp_path: Path):
    home = tmp_path / "home"
    agent = home / "agents" / "assistente"
    _write_patch(agent, _complete_patch())

    staged, payload = _run(home, agent, "stage")
    assert staged.returncode == 0, staged.stderr
    review = payload["review"]
    assert payload["ok"] is True
    assert {change["field"] for change in review["changes"]} == {
        "name",
        "email",
        "target_role",
        "location",
        "experience_years",
        "has_degree",
        "seniority_target",
        "skills.primary",
        "languages",
    }
    assert review["missing"] == []
    assert not (home / "profile" / "candidate_profile.yml").exists()
    assert not (agent / "profile-review.yml").exists()

    observed, status = _run(home, agent, "status")
    assert observed.returncode == 0
    assert status["review"]["review_id"] == review["review_id"]
    assert status["review"]["stale"] is False
    assert not (home / "profile" / "candidate_profile.yml").exists()

    confirmed, receipt = _run(home, agent, "confirm", review["review_id"])
    assert confirmed.returncode == 0, confirmed.stderr
    assert receipt["ok"] is True
    assert receipt["receipt"]["review_id"] == review["review_id"]
    assert receipt["receipt"]["ready"] is True

    persisted = yaml.safe_load(
        (home / "profile" / "candidate_profile.yml").read_text(encoding="utf-8")
    )
    assert persisted == _complete_patch()
    after, after_payload = _run(home, agent, "status")
    assert after.returncode == 0
    assert after_payload == {"ok": True, "review": None}
    assert stat.S_IMODE((home / "profile").stat().st_mode) == 0o700
    assert stat.S_IMODE((home / "profile" / "candidate_profile.yml").stat().st_mode) == 0o600


def test_desktop_status_badge_changes_only_after_persisted_receipt(tmp_path: Path):
    home = tmp_path / "home"
    agent = home / "agents" / "assistente"
    _write_patch(agent, _complete_patch())
    _, staged = _run(home, agent, "stage")

    before = _status(home)
    assert before["ready"] is False
    assert sum(before["required"].values()) == 0
    assert before["review"]["review_id"] == staged["review"]["review_id"]

    confirmed, receipt = _run(home, agent, "confirm", staged["review"]["review_id"])
    assert confirmed.returncode == 0
    assert receipt["receipt"]["profile_hash"]

    after = _status(home)
    assert after["ready"] is True
    assert all(after["required"].values())
    assert after["review"] is None


def test_all_localized_agent_contracts_stage_cv_review_without_chat_reminder():
    assert len(PROFILE_SKILLS) == 7
    assert len(ONBOARDING_SKILLS) == 7
    assert len(ASSISTANT_PROMPTS) == 7
    for path in PROFILE_SKILLS + ONBOARDING_SKILLS:
        source = path.read_text(encoding="utf-8")
        assert "[FILE ALLEGATI]" in source or "profile-review.yml" in source, path
        assert "$JHT_AGENT_DIR/profile-review.yml" in source, path
        assert "python3 /app/shared/skills/profile_review.py stage" in source, path

    for path in PROFILE_SKILLS:
        source = path.read_text(encoding="utf-8")
        marker = source.index("[FILE ALLEGATI]")
        section = source[marker : marker + 1800]
        assert "candidate_profile.yml" in section, path
        assert "chat" in section.lower(), path

    for path in ASSISTANT_PROMPTS:
        source = path.read_text(encoding="utf-8")
        candidate_route = next(
            line
            for line in source.splitlines()
            if line.startswith("   - `candidate-related`")
            and "candidate_profile.yml" in line
        )
        assert "candidate_profile.yml" in candidate_route, path
        assert "profile-yaml" in candidate_route, path
        assert any(
            prohibition in candidate_route.lower()
            for prohibition in ("never", "mai", "nunca", "jamais", "niemals", "soha")
        ), path


def test_desktop_form_uses_same_atomic_writer_and_fails_closed_on_invalid_base(
    tmp_path: Path,
):
    home = tmp_path / "home"
    profile_dir = home / "profile"
    profile_dir.mkdir(parents=True)
    profile_path = profile_dir / "candidate_profile.yml"
    profile_path.write_text("name: [broken\n", encoding="utf-8")

    failed = _save_from_desktop(home, {"name": "Replacement"})
    assert failed.returncode == 1
    assert json.loads(failed.stdout) == {"ok": False, "error": "profile_invalid"}
    assert profile_path.read_text(encoding="utf-8") == "name: [broken\n"

    profile_path.write_text("name: Initial\n", encoding="utf-8")
    saved = _save_from_desktop(home, {"name": "Replacement"})
    assert saved.returncode == 0, saved.stderr
    payload = json.loads(saved.stdout)
    assert payload["ok"] is True
    assert len(payload["profile_hash"]) == 64
    assert yaml.safe_load(profile_path.read_text(encoding="utf-8")) == {
        "name": "Replacement"
    }


def test_confirm_failure_keeps_canonical_profile_and_review_unchanged(tmp_path: Path):
    home = tmp_path / "home"
    agent = home / "agents" / "assistente"
    _write_patch(agent, _complete_patch())
    _, staged = _run(home, agent, "stage")
    review_id = staged["review"]["review_id"]

    failed, payload = _run(
        home,
        agent,
        "confirm",
        review_id,
        extra_env={"JHT_PROFILE_REVIEW_FAIL_BEFORE_REPLACE": "1"},
    )
    assert failed.returncode == 1
    assert payload == {"ok": False, "error": "write_failed"}
    assert not (home / "profile" / "candidate_profile.yml").exists()
    assert (home / "profile" / "pending-profile-review.json").exists()


def test_concurrent_profile_change_invalidates_review_without_overwrite(tmp_path: Path):
    home = tmp_path / "home"
    agent = home / "agents" / "assistente"
    profile_dir = home / "profile"
    profile_dir.mkdir(parents=True)
    original = {"name": "Original", "experience_years": 1}
    profile_path = profile_dir / "candidate_profile.yml"
    profile_path.write_text(yaml.safe_dump(original), encoding="utf-8")
    _write_patch(agent, {"target_role": "Operations Manager"})
    _, staged = _run(home, agent, "stage")
    review_id = staged["review"]["review_id"]

    concurrent = {"name": "Concurrent", "experience_years": 2}
    profile_path.write_text(yaml.safe_dump(concurrent), encoding="utf-8")
    failed, payload = _run(home, agent, "confirm", review_id)

    assert failed.returncode == 1
    assert payload == {"ok": False, "error": "profile_changed"}
    assert yaml.safe_load(profile_path.read_text(encoding="utf-8")) == concurrent
    _, status = _run(home, agent, "status")
    assert status["review"]["stale"] is True


def test_wrong_or_tampered_receipt_never_persists(tmp_path: Path):
    home = tmp_path / "home"
    agent = home / "agents" / "assistente"
    _write_patch(agent, _complete_patch())
    _, staged = _run(home, agent, "stage")

    wrong, wrong_payload = _run(home, agent, "confirm", "0" * 64)
    assert wrong.returncode == 1
    assert wrong_payload == {"ok": False, "error": "review_mismatch"}
    assert not (home / "profile" / "candidate_profile.yml").exists()

    envelope_path = home / "profile" / "pending-profile-review.json"
    envelope = json.loads(envelope_path.read_text(encoding="utf-8"))
    envelope["profile"]["name"] = "Tampered"
    envelope_path.write_text(json.dumps(envelope), encoding="utf-8")
    tampered, tampered_payload = _run(
        home, agent, "confirm", staged["review"]["review_id"]
    )
    assert tampered.returncode == 1
    assert tampered_payload == {"ok": False, "error": "review_invalid"}
    assert not (home / "profile" / "candidate_profile.yml").exists()


def test_nested_and_boolean_cv_values_are_visible_and_bound_to_confirmation(
    tmp_path: Path,
):
    home = tmp_path / "home"
    agent = home / "agents" / "assistente"
    patch = {
        "has_degree": False,
        "contacts": {"phone": "+00 000 000"},
        "experience": [{"company": "Example", "role": "Operator"}],
        "education": [{"institution": "Example School", "degree": "Diploma"}],
        "preferences": {"work_mode": "remote", "relocation": False},
    }
    _write_patch(agent, patch)

    staged, payload = _run(home, agent, "stage")
    assert staged.returncode == 0, staged.stderr
    changes = {item["field"]: item["value"] for item in payload["review"]["changes"]}
    assert changes == {
        "contacts.phone": "+00 000 000",
        "education": [{"institution": "Example School", "degree": "Diploma"}],
        "experience": [{"company": "Example", "role": "Operator"}],
        "has_degree": False,
        "preferences.relocation": False,
        "preferences.work_mode": "remote",
    }

    envelope_path = home / "profile" / "pending-profile-review.json"
    envelope = json.loads(envelope_path.read_text(encoding="utf-8"))
    envelope["changes"] = [
        item for item in envelope["changes"] if item["field"] != "has_degree"
    ]
    envelope_path.write_text(json.dumps(envelope), encoding="utf-8")
    rejected, rejected_payload = _run(
        home, agent, "confirm", payload["review"]["review_id"]
    )
    assert rejected.returncode == 1
    assert rejected_payload == {"ok": False, "error": "review_invalid"}
    assert not (home / "profile" / "candidate_profile.yml").exists()

    _write_patch(agent, patch)
    _, restaged = _run(home, agent, "stage")
    confirmed, receipt = _run(home, agent, "confirm", restaged["review"]["review_id"])
    assert confirmed.returncode == 0, confirmed.stderr
    assert receipt["ok"] is True
    assert (
        yaml.safe_load(
            (home / "profile" / "candidate_profile.yml").read_text(encoding="utf-8")
        )
        == patch
    )


def test_wizard_accepts_every_bound_review_row_instead_of_eight_field_subset():
    source = (ROOT / "game" / "scripts" / "wizard.gd").read_text(encoding="utf-8")
    review_source = source[
        source.index("func _redraw_review") : source.index("func _review_note")
    ]
    assert "not FIELDS.has(item_field)" not in review_source
    assert 'item.has("value")' in review_source
    assert "seen_fields.has(item_field)" in review_source
    assert '_review_value(item.get("value"))' in review_source


def test_stage_rejects_symlink_patch(tmp_path: Path):
    home = tmp_path / "home"
    agent = home / "agents" / "assistente"
    agent.mkdir(parents=True)
    outside = tmp_path / "outside.yml"
    outside.write_text(yaml.safe_dump(_complete_patch()), encoding="utf-8")
    try:
        (agent / "profile-review.yml").symlink_to(outside)
    except OSError:
        pytest.skip("symlinks unavailable")

    failed, payload = _run(home, agent, "stage")
    assert failed.returncode == 1
    assert payload == {"ok": False, "error": "unreadable"}
    assert outside.exists()
    assert not (home / "profile" / "candidate_profile.yml").exists()
