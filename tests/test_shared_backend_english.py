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


def _scan(dirs) -> list[str]:
    """User-visible literals matching Italian prose, as `path:line: text`."""
    leaks: list[str] = []

    def record(path: Path, line: int, text: str) -> None:
        if census.ITALIAN_COPY.search(text):
            leaks.append(f"{path.relative_to(ROOT)}:{line}: {' '.join(text.split())[:180]}")

    for path in census._iter_files(dirs, {".py"}):
        for line, value in census.python_visible_literals(path):
            record(path, line, value)
    for path in census._iter_files(dirs, {".sh"}):
        for line, text in census.shell_visible_lines(path):
            record(path, line, text)
    for path in census._iter_files(dirs, {".js", ".mjs", ".ts"}):
        if path.name.endswith(".test.ts"):
            continue
        for line, value in census.js_visible_literals(path):
            record(path, line, value)
    return leaks


def test_shared_python_user_visible_copy_has_no_italian_baseline():
    leaks = _scan(("shared/skills",))
    assert not leaks, "Italian user-visible backend copy:\n" + "\n".join(leaks)


def test_backend_perimeter_user_visible_copy_is_english():
    """The whole O-07 perimeter, not just the Python skills.

    Terminal output from the CLI and the launcher reaches the same user as the
    container's own messages: leaving them out of the gate is what let the
    English pass ship half-done.
    """
    leaks = [leak for dirs in census.AREAS.values() for leak in _scan(dirs)]
    assert not leaks, (
        f"Italian user-visible backend copy ({len(leaks)}):\n" + "\n".join(leaks)
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
