"""O-68: NEW-TICKET wakes the user queue without bypassing its FIFO order.

The runtime prefers localized prompts, so the contract must live in the
governed Assistente and Capitano blocks in English plus all six locales.  The
negative assertions preserve the original counterexample: naming the pushed
ID must never turn into an instruction to assign that ticket immediately.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parent.parent
LOCALES = ("de", "es", "fr", "hu", "it", "pt")
MARKERS = (
    "FIFO-WAKE-ONLY",
    "OLDEST-OPEN-FIRST",
    "USER-OVER-AUTONOMOUS-NOT-USER",
)


def _prompts(role: str) -> list[Path]:
    directory = REPO_ROOT / "agents" / role
    return [directory / f"{role}.md"] + [
        directory / f"{role}.{locale}.md" for locale in LOCALES
    ]


ASSISTANT_PROMPTS = _prompts("assistente")
CAPTAIN_PROMPTS = _prompts("capitano")

# These are the vulnerable instructions O-68 removes.  Keeping the localized
# counterexamples makes this a semantic guard rather than a marker census.
FORBIDDEN_PUSH_ASSIGNMENT = {
    "assistente.md": ("front row", "assign it now"),
    "assistente.de.md": ("erste reihe", "weise sie jetzt zu"),
    "assistente.es.md": ("primera fila", "asígnala ya"),
    "assistente.fr.md": ("première ligne", "assigne-la maintenant"),
    "assistente.hu.md": ("első sorba", "oszd ki most"),
    "assistente.it.md": ("prima fila", "assegnala ora"),
    "assistente.pt.md": ("primeira fila", "atribui-o agora"),
}
FORBIDDEN_TRIGGER_ASSIGNMENT = {
    "capitano.md": "assign now",
    "capitano.de.md": "weise sofort zu",
    "capitano.es.md": "asigna ya",
    "capitano.fr.md": "assigne tout de suite",
    "capitano.hu.md": "oszd ki azonnal",
    "capitano.it.md": "assegna subito",
    "capitano.pt.md": "atribui já",
}
REQUIRED_TRIGGER_FIFO = {
    "capitano.md": "first/oldest open ticket",
    "capitano.de.md": "erste/älteste offene ticket",
    "capitano.es.md": "primer ticket abierto/el más antiguo",
    "capitano.fr.md": "premier/plus ancien ticket ouvert",
    "capitano.hu.md": "első/legrégebbi nyitott ticketet",
    "capitano.it.md": "primo/più vecchio ticket aperto",
    "capitano.pt.md": "primeiro/mais antigo ticket aberto",
}


def _assistant_block(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    headings = list(re.finditer(r"(?m)^## .*$", text))
    start = next(heading for heading in headings if "[NEW-TICKET]" in heading.group())
    end = next(
        (heading.start() for heading in headings if heading.start() > start.start()),
        len(text),
    )
    return text[start.start() : end]


def _captain_block(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    start = text.index("**C-15 ")
    end = text.index("**C-16 ", start)
    return text[start:end]


def _captain_trigger(path: Path) -> str:
    return next(
        line
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.startswith("| **") and "(RULE C-15)" in line
    )


def _assert_fifo_contract(path: Path, block: str) -> None:
    for marker in MARKERS:
        assert block.count(marker) == 1, (
            f"{path.name}: {marker} must occur once in its governed block"
        )
    assert "ticket.py list-open" in block, (
        f"{path.name}: FIFO selection must start from ticket.py list-open"
    )


@pytest.mark.parametrize("path", ASSISTANT_PROMPTS, ids=lambda path: path.name)
def test_new_ticket_relay_only_wakes_fifo_queue(path: Path) -> None:
    block = _assistant_block(path)
    _assert_fifo_contract(path, block)
    lowered = block.casefold()
    for vulnerable_instruction in FORBIDDEN_PUSH_ASSIGNMENT[path.name]:
        assert vulnerable_instruction.casefold() not in lowered, (
            f"{path.name}: pushed ID still selects itself via "
            f"{vulnerable_instruction!r}"
        )


@pytest.mark.parametrize("path", CAPTAIN_PROMPTS, ids=lambda path: path.name)
def test_c15_selects_oldest_open_ticket_not_pushed_id(path: Path) -> None:
    _assert_fifo_contract(path, _captain_block(path))


@pytest.mark.parametrize("path", CAPTAIN_PROMPTS, ids=lambda path: path.name)
def test_captain_trigger_wakes_fifo_instead_of_assigning_arrival(path: Path) -> None:
    trigger = _captain_trigger(path)
    assert "ticket.py list-open" in trigger
    assert REQUIRED_TRIGGER_FIFO[path.name].casefold() in trigger.casefold()
    assert FORBIDDEN_TRIGGER_ASSIGNMENT[path.name].casefold() not in trigger.casefold()


def test_ticket_list_open_query_is_oldest_first() -> None:
    source = (REPO_ROOT / "shared" / "skills" / "ticket.py").read_text(
        encoding="utf-8"
    )
    list_open = source[
        source.index("def list_open(") : source.index("def count_open(")
    ]
    assert "ORDER BY created_at ASC" in list_open
