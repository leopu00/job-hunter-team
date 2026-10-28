"""Le skill tedesche parlano all'agente con «du», come tutti gli altri prompt tedeschi.

`profile-yaml/SKILL.de.md` dava del «Sie» all'agente per una quarantina di righe mentre
il resto dei prompt dice «du»: nessun test lo vedeva. Questo test legge ogni
`SKILL.de.md` e fallisce sulle forme di cortesia.

Le uniche righe ammesse sono quelle sotto: una citazione di una mail del candidato,
un «Ihr» che e' «il loro» e un «ihr» di seconda persona plurale (informale). Se una
sparisce dal file, il test lo dice, cosi' l'elenco non resta a coprire righe che non ci sono.
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

FORMAL = re.compile(
    r"\bIhr(?:e|en|em|er|es)?\b"
    r"|\bIhnen\b"
    r"|\b[A-ZÄÖÜ][a-zäöüß]+en Sie\b"
    r"|\b[a-zäöüß]+(?:en|et|st) Sie\b"
)

# (file, pezzo di riga ammesso)
ALLOWED = [
    ("agents/_skills/cv-structure/SKILL.de.md", "Bitte finden Sie anbei meinen Lebenslauf"),
    ("agents/_skills/onboarding-flow/SKILL.de.md", "Ihr besprecht Arbeitsmodus"),
    ("agents/_skills/pipeline-triage/SKILL.de.md", "Ihr Fortschritt wird von hier gezogen"),
]


def _skills():
    return sorted(ROOT.glob("agents/**/SKILL.de.md"))


def test_german_skills_never_use_the_formal_address():
    found = []
    for path in _skills():
        rel = path.relative_to(ROOT).as_posix()
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if not FORMAL.search(line):
                continue
            if any(rel == file and piece in line for file, piece in ALLOWED):
                continue
            found.append(f"{rel}:{number}: {line.strip()[:100]}")
    assert found == []


def test_every_allowed_line_is_still_in_its_file():
    for file, piece in ALLOWED:
        text = (ROOT / file).read_text(encoding="utf-8")
        assert piece in text, f"{file}: la riga ammessa «{piece}» non c'e' piu': toglila dall'elenco"


def test_there_are_german_skills_to_read():
    assert len(_skills()) > 50
