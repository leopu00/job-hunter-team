"""Contratto prodotto: osservare il mercato e' un uso completo di JHT.

L'utente decide se e quando candidarsi. Questo gate protegge le superfici che
in passato trasformavano l'assenza di candidature in un invito ad agire:
prompt dei ruoli, stati vuoti dell'interfaccia e avvisi di scadenza.
"""

import re
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
AGENTS_DIR = REPO_ROOT / "agents"
LOCALES = ("it", "es", "fr", "de", "pt", "hu")
ROLES = (
    "capitano", "scout", "analista", "scorer", "scrittore", "critico",
    "sentinella", "assistente", "dottore", "mantenitore", "mentor",
)


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _prompt_paths(role: str):
    base = AGENTS_DIR / role
    yield base / f"{role}.md"
    for locale in LOCALES:
        yield base / f"{role}.{locale}.md"


def test_all_role_prompts_inherit_the_user_initiated_application_rule():
    """T18 deve arrivare a tutti gli 11 ruoli e alle loro sei traduzioni."""
    team_rules = [
        AGENTS_DIR / "_team" / "team-rules.md",
        *(AGENTS_DIR / "_team" / f"team-rules.{locale}.md" for locale in LOCALES),
    ]
    for path in team_rules:
        assert "RULE-T18" in _read(path), f"regola autonomia candidature assente: {path}"

    inherited_range = re.compile(r"\bT01\.\.T(\d{2})\b")
    for role in ROLES:
        for path in _prompt_paths(role):
            match = inherited_range.search(_read(path))
            assert match, f"range team-wide assente: {path}"
            assert int(match.group(1)) >= 18, (
                f"{path} non eredita RULE-T18 sull'autonomia delle candidature"
            )


def test_empty_application_states_are_neutral_in_every_game_locale():
    """Nessun registro vuoto deve chiamare lo Scout o suggerire che manca qualcosa."""
    paths = [
        REPO_ROOT / "game" / "scripts" / "ui_strings.gd",
        *(REPO_ROOT / "game" / "scripts" / "i18n" / f"ui_{locale}.gd"
          for locale in ("en", "es", "fr", "de", "pt", "hu")),
    ]
    forbidden = (
        "talk to the Scout", "parla col reparto Ricerca", "habla con el Scout",
        "parle au Scout", "sprich mit dem Scout", "fale com o Scout",
        "beszélj a Scouttal", "no applications yet", "nessuna candidatura ancora",
        "aún no hay candidaturas", "aucune candidature pour l'instant",
        "noch keine Bewerbungen", "nenhuma candidatura ainda", "még nincs jelentkezés",
    )
    for path in paths:
        text = _read(path)
        assert '"registry.streak"' not in text, f"streak candidature ancora esposto: {path}"
        assert '"kpi.streak"' not in text, f"KPI streak candidature ancora esposto: {path}"
        assert all(term not in text for term in forbidden), f"stato vuoto pressante: {path}"

    kpi_panel = _read(REPO_ROOT / "game" / "scripts" / "ui" / "section_panel.gd")
    registry_panel = _read(REPO_ROOT / "game" / "scripts" / "ui" / "registry_panel.gd")
    assert "TeamData.streak(" not in kpi_panel
    assert "TeamData.streak(" not in registry_panel


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
