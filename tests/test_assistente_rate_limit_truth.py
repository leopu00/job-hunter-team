"""Regressione: uno stato setup non sincronizzato non e' una quota esaurita."""

from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
PROMPTS = [
    ROOT / "agents" / "assistente" / "assistente.md",
    *(ROOT / "agents" / "assistente" / f"assistente.{lang}.md"
      for lang in ("it", "es", "fr", "de", "pt", "hu")),
]


def test_rate_limit_requires_provider_evidence_in_every_locale():
    for prompt in PROMPTS:
        rule = next(
            paragraph for paragraph in prompt.read_text(encoding="utf-8").split("\n\n")
            if "**A-06" in paragraph
        )
        lowered = rule.lower()
        assert "429" in rule, prompt
        assert "rate limit" in lowered, prompt
        assert any(word in lowered for word in (
            "provider", "fornecedor", "proveedor", "fournisseur", "szolgáltató",
        )), prompt


def test_unsynchronized_setup_has_its_own_cause_in_every_locale():
    for prompt in PROMPTS:
        rule = next(
            paragraph for paragraph in prompt.read_text(encoding="utf-8").split("\n\n")
            if "**A-06" in paragraph
        ).lower()
        assert "setup" in rule and "vps" in rule, prompt
        assert any(word in rule for word in (
            "synchron", "sincron", "szinkron", "unsynchronisiert",
        )), prompt
        assert any(word in rule for word in (
            "never", "mai", "nunca", "jamais", "nie", "soha",
        )), prompt
