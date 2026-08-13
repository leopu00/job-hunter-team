from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "agents" / "_skills" / "cloud-push-quarantine"
VARIANTS = [
    SKILL / "SKILL.md",
    *(SKILL / f"SKILL.{locale}.md" for locale in ("it", "hu", "es", "de", "fr", "pt")),
]


def test_cloud_push_quarantine_skill_is_distributed_in_all_languages():
    assert all(path.exists() for path in VARIANTS)
    assert len(VARIANTS) == 7
    for path in VARIANTS:
        text = path.read_text(encoding="utf-8")
        assert "jht cloud quarantine list" in text
        assert "jht cloud quarantine retry <opaque-id>" in text
        assert "jht cloud quarantine resolve <opaque-id> --confirm" in text
        assert "allowed-tools: Bash(jht cloud quarantine *)" in text
    assert "cloud-push-quarantine" in (
        ROOT / "agents" / "mantenitore" / "skills.list"
    ).read_text(encoding="utf-8").splitlines()


def test_skill_never_prescribes_table_specific_bypass():
    for path in VARIANTS:
        text = path.read_text(encoding="utf-8").lower()
        assert "applications_upsert_failed" not in text
        assert "user_id=" not in text
