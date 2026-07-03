"""Test estrazione agente dal titolo sessione (attribuzione token pacing).

Regressione per il bug "resume": un titolo che inizia col tag nudo
`[RESUME]` (custom_title auto-generato da Kimi senza il prefisso
`[@dottore -> @x]`) veniva scambiato per un agente fantasma "resume",
gonfiando il top-burn del pacing e accecando le decisioni di throttle.
Fix: il fallback `[TAG]` è validato contro i ruoli canonici.

Vedi docs/internal/postmortems/2026-06-28-betaD-vps-budget-burn-investigation.md.

Eseguire:
    pytest tests/test_session_to_agent.py -v
"""

import importlib.util
import json
import os
import sys

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SKILLS_DIR = os.path.join(REPO_ROOT, "shared", "skills")
sys.path.insert(0, SKILLS_DIR)


def _load_series_module():
    """token-by-agent-series.py ha trattini nel nome → import via importlib."""
    path = os.path.join(SKILLS_DIR, "token-by-agent-series.py")
    spec = importlib.util.spec_from_file_location("token_by_agent_series", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


series = _load_series_module()
import token_metrics_lib as tml  # noqa: E402


# Titolo → agente atteso. Copre i casi reali osservati su VPS betaD.
CASES = [
    # routing normale: ultima @menzione (receiver)
    ("[@dottore -> @scout-2] [RESUME] Contesto pre-refresh: ...", "scout-2"),
    ("[@sentinella -> @capitano] [HARD-COAST] ...", "capitano"),
    ("[@user -> @capitano] avvia", "capitano"),
    ("[@dottore -> @analista] [RESUME] ...", "analista"),
    # broadcast core: tag = ruolo valido
    ("[SENTINELLA] [STATUS] update ...", "sentinella"),
    ("[CAPITANO] coordinamento", "capitano"),
    ("[SCOUT-2] heartbeat", "scout-2"),
    # IL BUG: tag nudo NON-ruolo → None (non "resume"/"status"/...)
    ("[RESUME] Contesto pre-refresh: hai appena chiuso ...", None),
    ("[STATUS] solo broadcast", None),
    ("[MSG] start the sourcing", None),
    ("[WELCOME-USER] benvenuto", None),
    ("[BRIDGE PACING] 12:45 ...", None),
    ("Leggi AGENTS.md ed esegui il giro di heartbeat", None),
    ("", None),
]


@pytest.mark.parametrize("title,expected", CASES)
def test_extract_agent_from_text(title, expected):
    """token-by-agent-series._extract_agent_from_text."""
    assert series._extract_agent_from_text(title) == expected


@pytest.mark.parametrize("title,expected", CASES)
def test_parse_session_to_agent(tmp_path, title, expected):
    """token_metrics_lib.parse_session_to_agent (seconda implementazione)."""
    state = tmp_path / "state.json"
    state.write_text(json.dumps({"custom_title": title}))
    assert tml.parse_session_to_agent(state) == expected


def test_resume_phantom_not_an_agent():
    """Esplicito: 'resume' non deve mai emergere come agente."""
    assert series._extract_agent_from_text("[RESUME] x") is None
    assert not series._is_valid_agent("resume")
    assert not tml._is_valid_agent("resume")


def test_numbered_worker_roles_valid():
    """I worker numerati (scout-2, analista-3) restano validi."""
    for name in ("scout-2", "analista-3", "scorer-10", "scrittore-1"):
        assert series._is_valid_agent(name)
        assert tml._is_valid_agent(name)
