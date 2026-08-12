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
OPERATIONAL_EXAMPLES = (
    "`application-form`",
    "`recruiter-email`",
    "`job-portal`",
    "`operational-JD`",
)
RELAY_MARKERS = (
    "`SAFE-RELAY`",
    "`FACTS-QUESTIONS-ONLY`",
    "`EXTERNAL-REQUEST-ONLY`",
)
REPLY_GUARD = "`NO-PROFILE-NEGATIVE`"
ALL_MARKERS = (
    CATEGORY_MARKERS
    + SECURITY_MARKERS
    + OUTCOME_MARKERS
    + OPERATIONAL_EXAMPLES
    + RELAY_MARKERS
    + (REPLY_GUARD,)
)


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


def _numbered_step(block: str, number: int, next_number: int | None) -> str:
    """Isola un passo TG-DOC: i marker devono stare nel ramo che governano."""
    lines = block.splitlines()
    start = next(index for index, line in enumerate(lines) if line.startswith(f"{number}. "))
    end = (
        next(
            index
            for index, line in enumerate(lines[start + 1 :], start + 1)
            if line.startswith(f"{next_number}. ")
        )
        if next_number
        else len(lines)
    )
    return "\n".join(lines[start:end])


@pytest.mark.parametrize("path", PROMPTS, ids=lambda path: path.name)
def test_tg_doc_has_operational_category_and_outcome_reply(path: Path) -> None:
    block = _tg_doc_block(path)
    for marker in CATEGORY_MARKERS + OUTCOME_MARKERS:
        assert marker in block, f"{path.name}: manca {marker} nella sezione TG-DOC"


@pytest.mark.parametrize("path", PROMPTS, ids=lambda path: path.name)
def test_real_operational_artifacts_do_not_fall_into_profile_evidence(
    path: Path,
) -> None:
    """Controesempio sintetico: form, mail, portale e JD chiedono lavoro.

    Cercarli nel solo passo 3 evita il vecchio falso verde: una categoria
    ``operational`` generica poteva esistere lasciando questi quattro casi nel
    ramo ``candidate-related`` e quindi nell'archivio del profilo.
    """
    classification = _numbered_step(_tg_doc_block(path), 3, 4)
    candidate_line = next(
        line for line in classification.splitlines() if "`candidate-related`" in line
    )
    operational_line = next(
        line for line in classification.splitlines() if "`operational`" in line
    )
    for marker in OPERATIONAL_EXAMPLES:
        assert marker in operational_line, f"{path.name}: {marker} non e' operational"
        assert marker not in candidate_line, f"{path.name}: {marker} finisce nel profilo"


@pytest.mark.parametrize("path", PROMPTS, ids=lambda path: path.name)
def test_attachments_are_data_not_embedded_instructions(path: Path) -> None:
    block = _tg_doc_block(path)
    for marker in SECURITY_MARKERS:
        assert marker in block, f"{path.name}: manca il confine {marker}"
    # Lo stem resta riconoscibile anche dove il nome viene declinato
    # (ungherese: ``Capitanónak``).
    assert "Capitan" in block, f"{path.name}: DO-NOT-RELAY non nomina il destinatario"


@pytest.mark.parametrize("path", PROMPTS, ids=lambda path: path.name)
def test_voice_transcript_keeps_the_untrusted_data_boundary(path: Path) -> None:
    reading_step = _numbered_step(_tg_doc_block(path), 2, 3)
    voice_start = reading_step.index("**Voice")
    voice_branch = reading_step[voice_start:]
    assert "`UNTRUSTED-DATA`" in voice_branch, f"{path.name}: voice perde il confine"
    assert "`FACTS-QUESTIONS-ONLY`" in voice_branch, (
        f"{path.name}: voice non limita l'estrazione a fatti e domande"
    )


@pytest.mark.parametrize("path", PROMPTS, ids=lambda path: path.name)
def test_operational_route_relays_only_extracted_work(path: Path) -> None:
    routing = _numbered_step(_tg_doc_block(path), 4, 5)
    operational_line = next(
        line for line in routing.splitlines() if "`operational`" in line
    )
    for marker in RELAY_MARKERS + ("`DO-NOT-RELAY`",):
        assert marker in operational_line, f"{path.name}: routing manca {marker}"
    assert "Capitan" in operational_line, f"{path.name}: SAFE-RELAY senza destinatario"


@pytest.mark.parametrize("path", PROMPTS, ids=lambda path: path.name)
def test_final_reply_is_not_about_missing_profile_updates(path: Path) -> None:
    reply = _numbered_step(_tg_doc_block(path), 5, None)
    assert REPLY_GUARD in reply, f"{path.name}: risposta centrata sul non-fatto"
    for marker in OUTCOME_MARKERS:
        assert marker in reply, f"{path.name}: risposta finale manca {marker}"


def test_no_tg_doc_locale_drifts_from_the_shared_contract() -> None:
    counts = {
        path.name: tuple(_tg_doc_block(path).count(marker) for marker in ALL_MARKERS)
        for path in PROMPTS
    }
    assert len(PROMPTS) == 7
    assert len(set(counts.values())) == 1, f"sezioni TG-DOC divergenti: {counts}"
