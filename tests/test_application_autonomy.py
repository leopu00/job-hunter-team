"""Contratto prodotto: osservare il mercato e' un uso completo di JHT.

L'utente decide se e quando candidarsi. Questo gate protegge le superfici che
in passato trasformavano l'assenza di candidature in un invito ad agire:
prompt dei ruoli, stati vuoti dell'interfaccia e avvisi di scadenza.

Fino all'08/10 un test guardava anche gli stati vuoti del gioco Godot (game/):
Godot e' abbandonato, e quel test e' stato tolto con lui.
"""

import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
AGENTS_DIR = REPO_ROOT / "agents"
LOCALES = ("it", "es", "fr", "de", "pt", "hu")


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_the_user_initiated_application_rule_exists_in_every_team_rules_locale():
    """RULE-T18 is the rule this file guards. That every role prompt inherits up
    to the LAST team rule (T18 included) is
    test_agent_prompt_localization_sync.py::test_inherited_rule_range_reaches_last_team_rule."""
    team_rules = [
        AGENTS_DIR / "_team" / "team-rules.md",
        *(AGENTS_DIR / "_team" / f"team-rules.{locale}.md" for locale in LOCALES),
    ]
    for path in team_rules:
        assert "RULE-T18" in _read(path), f"regola autonomia candidature assente: {path}"


def test_web_copy_does_not_frame_zero_applications_as_a_deficit():
    profile = _read(REPO_ROOT / "web" / "app" / "components" / "SettingsProfile.i18n.ts")
    landing = _read(REPO_ROOT / "web" / "app" / "components" / "landing" / "LandingI18n.tsx")
    overlays = [
        _read(REPO_ROOT / "web" / "app" / "components" / "landing" / "i18n" / f"{locale}.ts")
        for locale in ("de", "es", "fr", "pt")
    ]
    assert "No applications yet" not in profile
    assert "Application tracking is optional" in profile
    for text in (landing, *overlays):
        assert "applications you've sent aren't enough" not in text
        assert "candidaturas enviadas no bastan" not in text
        assert "candidatures envoyées ne suffisent pas" not in text
        assert "versendeten Bewerbungen nicht ausreichen" not in text
        assert "candidaturas enviadas não bastam" not in text


def test_deadline_helper_requires_an_explicit_user_request():
    source = _read(REPO_ROOT / "shared" / "skills" / "expiration_alerts.py")
    assert "--user-requested" in source
    assert "if not args.user_requested:" in source
    assert "Spedisci candidatura" not in source
    assert "jht-telegram-send" not in source

    result = subprocess.run(
        [sys.executable, str(REPO_ROOT / "shared" / "skills" / "expiration_alerts.py")],
        cwd=REPO_ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 2
    assert "--user-requested is required" in result.stderr


def test_notification_examples_never_open_an_unsolicited_application_question():
    skill_paths = [
        AGENTS_DIR / "_skills" / "notify-user" / "SKILL.md",
        *(AGENTS_DIR / "_skills" / "notify-user" / f"SKILL.{locale}.md"
          for locale in LOCALES),
    ]
    old_prompts = (
        "Vuoi che procedo con apply", "¿Quieres que proceda con el apply",
        "Soll ich mit der Bewerbung", "Queres que avance com a candidatura",
    )
    for path in skill_paths:
        text = _read(path)
        assert all(prompt not in text for prompt in old_prompts), (
            f"domanda proattiva a candidarsi rimasta in {path}"
        )
