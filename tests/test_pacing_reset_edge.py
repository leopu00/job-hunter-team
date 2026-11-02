"""Regressioni per il falso freeze da projection al confine del reset."""

from datetime import datetime, timedelta, timezone
from pathlib import Path

from shared.skills.compute_metrics import compute_metrics


def _volatile_sample(minutes_to_reset):
    """Un ritmo alto e REALE (2 punti ogni 5 minuti per un'ora = 24 %/h): proietta oltre il 100% fuori dal guard.

    Prima il test usava un salto di 80 punti in 6 minuti: un artefatto di arrotondamento che oggi non e' piu' un ritmo
    (pace_rate.py: un salto di 3 punti o piu' fra due campioni a meno di 10 minuti non e' consumo del team)."""
    now = datetime.now(timezone.utc)
    session_id = "reset-edge-regression"
    parsed = {
        "provider": "codex",
        "usage": 90,
        "reset_at": (now + timedelta(minutes=minutes_to_reset)).strftime("%H:%M"),
        "reset_at_unix": (now + timedelta(minutes=minutes_to_reset)).timestamp(),
    }
    history = [{
        "ts": (now - timedelta(minutes=65 - 5 * i)).isoformat(),
        "provider": "codex",
        "session_id": session_id,
        "usage": 64 + 2 * i,
        "delta": 2 if i else 0,
    } for i in range(14)]
    last = {
        "ts": (now - timedelta(minutes=1)).isoformat(),
        "provider": "codex",
        "session_id": session_id,
        "usage": 88,
        "velocity_smooth": 24,
    }
    return compute_metrics(parsed, last, history=history)


def test_volatile_projection_is_observable_but_not_actionable_at_reset_edge():
    result = _volatile_sample(minutes_to_reset=15)

    assert result["projection"] > 95
    assert result["reset_edge_guard"] is True
    assert result["phase"] == 3
    assert result["status"] == "OK"
    assert result["throttle"] == 0
    assert result["suggested_throttle_s"] == 0


def test_reset_edge_guard_includes_zero_and_thirty_minutes():
    for minutes_to_reset in (0, 30):
        result = _volatile_sample(minutes_to_reset=minutes_to_reset)

        assert result["reset_edge_guard"] is True
        assert result["phase"] == 3
        assert result["suggested_throttle_s"] == 0


def test_projection_ladder_still_applies_outside_reset_edge():
    result = _volatile_sample(minutes_to_reset=31)

    assert result["projection"] > 100
    assert result["reset_edge_guard"] is False
    assert result["phase"] == 2
    assert result["status"] == "ATTENZIONE"
    assert result["suggested_throttle_s"] >= 60


def test_just_expired_epoch_does_not_roll_to_tomorrow_and_rearm_projection():
    result = _volatile_sample(minutes_to_reset=-1)

    assert result["reset_edge_guard"] is True
    assert result["phase"] == 3
    assert result["suggested_throttle_s"] == 0


def test_just_expired_hhmm_fallback_stays_inside_reset_guard():
    now = datetime.now(timezone.utc)
    parsed = {
        "provider": "codex",
        "usage": 80,
        "reset_at": (now - timedelta(minutes=1)).strftime("%H:%M"),
    }

    result = compute_metrics(parsed, last=None, history=[])

    assert result["reset_edge_guard"] is True
    assert result["phase"] == 3
    assert result["suggested_throttle_s"] == 0


def test_all_sentinel_localizations_enforce_the_same_reset_edge_contract():
    repo = Path(__file__).resolve().parents[1]
    skill_dir = repo / "agents/sentinella/_skills/emergency-handling"
    prompt_dir = repo / "agents/sentinella"
    suffixes = ("", ".it", ".es", ".fr", ".de", ".pt", ".hu")

    for suffix in suffixes:
        skill = (skill_dir / f"SKILL{suffix}.md").read_text(encoding="utf-8")
        prompt = (prompt_dir / f"sentinella{suffix}.md").read_text(encoding="utf-8")
        for text in (skill, prompt):
            assert "reset_edge_guard=true" in text
            assert "suggested_throttle_s=0" in text
        assert "reset_edge_guard != true" in skill
        assert "reset_edge_guard != true" in prompt
