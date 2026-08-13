"""O-76: feedback learns forward and never rewrites the voted position."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LOCALES = ("", ".it", ".es", ".fr", ".de", ".hu", ".pt")


def test_scorer_and_feedback_skill_are_future_only_in_all_locales():
    families = (
        "agents/scorer/scorer{locale}.md",
        "agents/_skills/feedback-query/SKILL{locale}.md",
    )
    forbidden = (
        "feedback:like+10%",
        "feedback:star+15%",
        "feedback:dislike-15%",
        "final_score = round(base *",
    )

    for template in families:
        for locale in LOCALES:
            source = (ROOT / template.format(locale=locale)).read_text(
                encoding="utf-8"
            )
            assert "FUTURE_FEEDBACK_ONLY" in source
            assert "--exclude-legacy-id <legacy_id>" in source
            assert "O-70" in source
            for stale in forbidden:
                assert stale not in source


def test_runtime_has_no_current_position_feedback_adjuster():
    source = (ROOT / "shared/skills/local_scorer.py").read_text(encoding="utf-8")
    assert "def apply_feedback(" not in source
    assert "FEEDBACK_MULTIPLIERS" not in source
    assert "feedback:star+15%" not in source
    assert '"--exclude-legacy-id"' in source
