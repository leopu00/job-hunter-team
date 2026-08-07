"""Release gate for the Python backend copy shipped inside the container.

Comments, implementation docstrings, SQL identifiers, and compatibility
patterns for Italian input are deliberately outside this test. It follows the
actual user-facing sinks instead: terminal output, CLI help/errors, and message
fields returned to agents or the game.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "shared" / "skills"

VISIBLE_CALLS = {
    "print",
    "add_argument",
    "add_parser",
    "ArgumentParser",
    "ValueError",
    "RuntimeError",
    "SystemExit",
    "error",
    "warn",
    "warning",
    "_log",
}
VISIBLE_FIELDS = {
    "message",
    "reason",
    "hint",
    "note",
    "error",
    "evidence",
    "detail",
    "suggest",
    "label",
}

# High-signal Italian prose. Role ids such as `capitano` and `analista`, enum
# values, and words commonly present in international job data are excluded.
ITALIAN_COPY = re.compile(
    r"[àèìòùÀÈÌÒÙ]|"
    r"\b(?:nessun\w*|errore|attenzione|impossibile|sconosciut\w*|"
    r"non\s+trovat\w*|già|aggiornat\w*|inserit\w*|completat\w*|"
    r"posizion\w*|aziend\w*|candidatur\w*|profilo|lavoro|pausa|"
    r"settimanal\w*|giorni?|righe?|soglia|durata|scrittura|"
    r"caricat\w*|salvat\w*|fallit\w*|uso|prima|dopo|fuori|dentro|"
    r"finestr\w*|velocità|agent[ei]|squadra|utente|messaggi?o?|"
    r"avvis\w*|gratuit\w*|mesi?|ore|selezion\w*|scegli\w*|"
    r"avvi\w*|ferm\w*|disattiv\w*|consum(?:o|i|at[oaie]|are)|"
    r"scadut\w*|rilevat\w*|legg(?:i|ere)|scriv(?:i|ere)|chius\w*|"
    r"rimos\w*|attiv(?:o|a|i|e)|disponibil\w*)\b",
    re.IGNORECASE,
)


def _call_name(node: ast.Call) -> str:
    return getattr(node.func, "id", None) or getattr(node.func, "attr", "")


def _strings(node: ast.AST):
    for child in ast.walk(node):
        if isinstance(child, ast.Constant) and isinstance(child.value, str):
            yield child.lineno, child.value


def _visible_literals(path: Path):
    source = path.read_text(encoding="utf-8")
    tree = ast.parse(source, filename=str(path))
    module_doc = ast.get_docstring(tree, clean=False)
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and _call_name(node) in VISIBLE_CALLS:
            for arg in node.args:
                yield from _strings(arg)
            for kw in node.keywords:
                if kw.arg in {None, "help", "description", "message"}:
                    if (module_doc and any(
                            isinstance(child, ast.Name) and child.id == "__doc__"
                            for child in ast.walk(kw.value))):
                        yield 1, module_doc
                    yield from _strings(kw.value)
        elif isinstance(node, ast.Dict):
            for key, value in zip(node.keys, node.values):
                if isinstance(key, ast.Constant) and key.value in VISIBLE_FIELDS:
                    yield from _strings(value)


def test_shared_python_user_visible_copy_has_no_italian_baseline():
    leaks: list[str] = []
    for path in sorted(SKILLS.glob("*.py")):
        for line, value in _visible_literals(path):
            if ITALIAN_COPY.search(value):
                compact = " ".join(value.split())[:180]
                leaks.append(f"{path.relative_to(ROOT)}:{line}: {compact}")
    assert not leaks, "Italian user-visible backend copy:\n" + "\n".join(leaks)


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
