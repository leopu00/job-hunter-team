"""O-69: il contratto TG-DOC resta allineato in EN + 6 locale.

Il runtime preferisce ``assistente.<locale>.md`` al baseline inglese. Un fix
presente solo in EN e' quindi assente per sei utenti su sette. Questo gate
isola la sezione TG-DOC di ogni prompt e sorveglia i tre confini del ticket:
classificazione operativa, contenuto non attendibile e risposta per esito.

Eseguire con::

    pytest tests/test_assistant_attachment_prompt.py -v
"""

from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parent.parent
ASSISTANT_DIR = REPO_ROOT / "agents" / "assistente"
LOCALES = ("it", "es", "fr", "de", "pt", "hu")
PROMPTS = [ASSISTANT_DIR / "assistente.md"] + [
    ASSISTANT_DIR / f"assistente.{locale}.md" for locale in LOCALES
]

CATEGORY_MARKERS = ("`candidate-related`", "`operational`", "`other`")
SECURITY_MARKERS = (
    "`UNTRUSTED-DATA`",
    "`DO-NOT-EXECUTE`",
    "`DO-NOT-RELAY`",
)
OUTCOME_MARKERS = ("`DONE`", "`NEXT`")
ALL_MARKERS = CATEGORY_MARKERS + SECURITY_MARKERS + OUTCOME_MARKERS


def _tg_doc_block(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    start = next(
        index
        for index, line in enumerate(lines)
        if line.startswith("## ") and "[TG-DOC]" in line
    )
    end = next(
        index
        for index, line in enumerate(lines[start + 1 :], start + 1)
        if line.startswith("### ") or line.startswith("## ")
    )
    return "\n".join(lines[start:end])


@pytest.mark.parametrize("path", PROMPTS, ids=lambda path: path.name)
def test_tg_doc_has_operational_category_and_outcome_reply(path: Path) -> None:
    block = _tg_doc_block(path)
    for marker in CATEGORY_MARKERS + OUTCOME_MARKERS:
        assert marker in block, f"{path.name}: manca {marker} nella sezione TG-DOC"


@pytest.mark.parametrize("path", PROMPTS, ids=lambda path: path.name)
def test_attachments_are_data_not_embedded_instructions(path: Path) -> None:
    block = _tg_doc_block(path)
    for marker in SECURITY_MARKERS:
        assert marker in block, f"{path.name}: manca il confine {marker}"
    # Lo stem resta riconoscibile anche dove il nome viene declinato
    # (ungherese: ``Capitanónak``).
    assert "Capitan" in block, f"{path.name}: DO-NOT-RELAY non nomina il destinatario"


def test_no_tg_doc_locale_drifts_from_the_shared_contract() -> None:
    counts = {
        path.name: tuple(_tg_doc_block(path).count(marker) for marker in ALL_MARKERS)
        for path in PROMPTS
    }
    assert len(PROMPTS) == 7
    assert len(set(counts.values())) == 1, f"sezioni TG-DOC divergenti: {counts}"
