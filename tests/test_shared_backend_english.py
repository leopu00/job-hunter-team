"""Release gate for the backend copy shipped inside the container.

Comments, implementation docstrings, SQL identifiers, and compatibility
patterns for Italian input are deliberately outside this test. It follows the
actual user-facing sinks instead: terminal output, CLI help/errors, and message
fields returned to agents or the game.

The scanning rules live in `scripts/analysis/backend_copy_census.py` and are
imported here rather than copied. They used to be duplicated, and the copies
drifted: on 2026-08-10 the census reported zero while `Provider non supportato`
was still being thrown by the credentials manager. One criterion, one regex —
a gate that disagrees with its own census is worse than no gate.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CENSUS_PATH = ROOT / "scripts" / "analysis" / "backend_copy_census.py"


def _load_census():
    spec = importlib.util.spec_from_file_location("backend_copy_census", CENSUS_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


census = _load_census()
SKILLS = ROOT / "shared" / "skills"


## The scan itself lives in the census — see its docstring for why this is not
## a local copy. The gate decides WHAT to hold; the census decides HOW to look.
_scan = census.scan


def test_shared_python_user_visible_copy_has_no_italian_baseline():
    leaks = _scan(("shared/skills",))
    assert not leaks, "Italian user-visible backend copy:\n" + "\n".join(leaks)


## Fronte Godot di O-07, ancora aperto al 2026-08-10. È una soglia, non un
## zero, perché la traduzione procede a lotti e un gate che parte rosso
## verrebbe disattivato entro un giorno. Può solo SCENDERE: si abbassa a ogni
## lotto e arriva a 0 quando il fronte è chiuso. Se sale, qualcuno ha aggiunto
## copy italiana nuova — che è esattamente ciò che va fermato subito.
GAME_COPY_BUDGET = 85


def test_backend_perimeter_user_visible_copy_is_english():
    """The closed half of the O-07 perimeter: CLI, launcher, shared.

    Terminal output from the CLI and the launcher reaches the same user as the
    container's own messages: leaving them out of the gate is what let the
    English pass ship half-done.
    """
    leaks = [leak for area, dirs in census.AREAS.items() if area != "game"
             for leak in _scan(dirs)]
    assert not leaks, (
        f"Italian user-visible backend copy ({len(leaks)}):\n" + "\n".join(leaks)
    )


def test_game_copy_budget_only_goes_down():
    """The open half: the Godot front, held to a budget that only shrinks.

    A count that grows means new Italian copy landed while the translation was
    in progress — the one thing that would make this front endless.
    """
    leaks = _scan(census.AREAS["game"])
    assert len(leaks) <= GAME_COPY_BUDGET, (
        f"Italian copy in the game grew: {len(leaks)} > {GAME_COPY_BUDGET}.\n"
        + "\n".join(leaks[:40])
    )
    assert len(leaks) >= GAME_COPY_BUDGET - 20, (
        f"the budget is stale: {len(leaks)} left but it still says "
        f"{GAME_COPY_BUDGET}. Lower GAME_COPY_BUDGET to {len(leaks)} so the "
        "next regression is caught where the work actually stopped."
    )


def test_directly_rendered_shared_surfaces_default_to_english():
    plan = (SKILLS / "plan_registry.py").read_text(encoding="utf-8")
    dashboard = (SKILLS / "generate_dashboard.py").read_text(encoding="utf-8")
    scraper = (SKILLS / "web_scrape_robust.py").read_text(encoding="utf-8")

    assert '"label": "Adagio (free)"' in plan
    assert "/month" in plan
    assert "gratuito" not in plan
    assert "/mese" not in plan
    assert '<html lang="en">' in dashboard
    for old_copy in ("Posizioni attive", "Valutate", "CV scritti", "Versione salvata"):
        assert old_copy not in dashboard
    assert "playwright non installato" not in scraper.lower()


def test_census_regex_catches_the_words_that_slipped_through():
    """Regression guard on the criterion itself.

    Each of these shipped to users in Italian while the census reported zero.
    """
    for phrase in (
        "Provider non supportato: claude",
        "Formato payload non supportato: v1",
        "  liberati: 12 MB",
        "Job schedulati (3):",
        "Moduli shared/",
        "Bacheca sync: 2 from cloud",
        "Sync now servito: push fresco",
        "Installa Claude CLI",
    ):
        assert census.ITALIAN_COPY.search(phrase), f"not caught: {phrase}"
