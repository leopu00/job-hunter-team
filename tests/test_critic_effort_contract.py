"""O-20/O-21 — il Critico gira davvero come il launcher dichiara?

Il Critico NON passa dal launcher: lo lancia lo Scrittore con la skill
`agents/_skills/critic-loop/`. Quindi l'effort vive in due posti — la tabella
di `.launcher/start-agent.sh` e sette SKILL tradotte — e per mesi hanno detto
cose diverse: `high` nella tabella, `medium` nella skill. Chi leggeva il
launcher credeva il contrario di ciò che girava, e il gate di qualità sui CV
degli utenti era più superficiale di quanto chiunque pensasse.

Il difetto non è stato il valore sbagliato: è che la coerenza fra le due fonti
era affidata alla memoria di chi le toccava. Qui diventa verificabile (D11).
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
LAUNCHER = ROOT / ".launcher" / "start-agent.sh"
SKILLS = sorted((ROOT / "agents" / "_skills" / "critic-loop").glob("SKILL*.md"))

## Le sette lingue in cui la skill esiste. In sviluppo si legge sempre
## l'inglese: un fix applicato al solo SKILL.md lascia il difetto vivo per gli
## utenti delle altre sei, e nessuno se ne accorge.
EXPECTED_LOCALES = {"", ".it", ".es", ".de", ".fr", ".pt", ".hu"}


def _launcher_effort(role: str) -> str:
    """L'effort che la tabella `get_agent_info` dichiara per un ruolo."""
    src = LAUNCHER.read_text(encoding="utf-8")
    match = re.search(rf'^\s*{role}\)\s*echo\s*"([^"]+)"', src, re.MULTILINE | re.IGNORECASE)
    if not match:
        match = re.search(rf'{role}\|([a-z]+)\|', src, re.IGNORECASE)
        assert match, f"la tabella del launcher non dichiara più {role}"
        return match.group(1)
    return match.group(1).split("|")[1]


def test_all_seven_locales_are_present() -> None:
    found = {p.name.replace("SKILL", "").replace(".md", "") for p in SKILLS}
    assert found == EXPECTED_LOCALES, f"lingue mancanti o inattese: {found}"


@pytest.mark.parametrize("skill", SKILLS, ids=lambda p: p.name)
def test_skill_spawns_the_critic_at_the_declared_effort(skill: Path) -> None:
    """Ogni lingua, non solo l'inglese, e confrontata con la FONTE."""
    declared = _launcher_effort("critico")
    text = skill.read_text(encoding="utf-8")
    efforts = re.findall(r"--effort\s+(\w+)", text)
    assert efforts, f"{skill.name}: nessun --effort nel comando di spawn"
    assert all(e == declared for e in efforts), (
        f"{skill.name} lancia il Critico a {set(efforts)} mentre il launcher "
        f"dichiara '{declared}'. Le due fonti devono dire la stessa cosa: è "
        "il gate di qualità sui CV che l'utente manda davvero."
    )


@pytest.mark.parametrize("skill", SKILLS, ids=lambda p: p.name)
def test_spawn_resolves_the_cli_and_fails_loudly(skill: Path) -> None:
    """O-21: percorso risolto, e un fallimento che si vede.

    Il primo tentativo reale è morto con `claude: command not found` perché la
    shell della skill non aveva le directory delle dipendenze sul PATH.
    L'agente si è autocorretto, quindi è finita bene — ma costa un giro ogni
    volta, e con un modello meno capace il Critico non parte e il gate salta
    in silenzio.
    """
    text = skill.read_text(encoding="utf-8")
    assert "/opt/jht-deps/npm-global/bin" in text, (
        f"{skill.name}: il PATH dello spawn non contiene le dipendenze reali "
        "(da quando vivono in /opt/jht-deps, `claude` nudo non si risolve)"
    )
    assert "command -v" in text, f"{skill.name}: il CLI non viene risolto"
    assert "CRITIC-SPAWN-FAILED" in text, (
        f"{skill.name}: un fallimento dello spawn resta silenzioso — è la "
        "condizione in cui il gate di qualità salta senza che nessuno lo sappia"
    )
