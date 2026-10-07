"""
Parità CLI ↔ ufficio Godot: il CLI non deve restare indietro in silenzio.

Il progetto dichiara una regola in `docs/guides/AI-AGENT-INTEGRATION.md`:

    "If a feature requires opening the web dashboard or the Desktop app to be
     configured after install, that's a bug. One CLI surface for humans, AI
     agents and the Desktop launcher."

Il 2026-07-25 quella regola era violata e nessuno se ne era accorto per mesi,
perché niente la controllava: il gioco aveva guadagnato i verbi di decisione
(escludere una posizione, aprire un ticket, dare una direttiva) e il CLI era
rimasto una superficie di sola lettura. Questo file è l'allarme che mancava.

Fino all'08/10 ogni funzione pubblica del `BackendBus` del gioco Godot
(game/) doveva comparire in una tabella, con la sua controparte CLI o il motivo
per cui non ne aveva una. Godot è abbandonato: quei due test (verbo nuovo non
classificato, verbo citato e scomparso) sono stati tolti con lui. Resta la
promessa che regge senza il gioco: i comandi `jht` che COVERED elenca, e i verbi
di decisione, esistono davvero.

Eseguire con: pytest tests/test_cli_game_parity.py -v
"""

import os
import re
import subprocess
import sys

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
JHT = os.path.join(REPO_ROOT, 'cli', 'bin', 'jht.js')

# Verbo del gioco (il BackendBus di Godot, tolto) → comando `jht` che fa la
# stessa cosa. Le chiavi restano come promemoria di cosa copriva ogni comando.
COVERED = {
    'add_team_directive':     'directives',
    'archive_team_directive': 'directives',
    'create_position_ticket': 'ticket',
    'save_working_hours':     'working-hours',
    'send_user_chat':         'team',       # jht team send / chat
    'open_agent_chat':        'team',
    'open_agent_terminal':    'logs',
    'request_agent_history':  'agents',
    'load_vps_config':        'cloud',
    'save_vps_config':        'cloud',
    'set_backend':            'container',
    'connect_local_backend':  'container',
    'disconnect_backend':     'container',
    'pipeline_counts':        'positions',  # jht positions dashboard
    'save_user_profile':      'profile',
    # Le impostazioni del Capitano — modalità di lavoro e ordini della cura.
    # Il contratto del file sta in `coordinator_settings.py` (single-writer),
    # il CLI è un proxy: `jht coordinator show` / `set-mode`.
    'request_coordinator_state': 'coordinator',
    'save_coordinator_settings': 'coordinator',
    'ensure_assistant':       'team',
    # I documenti che attraversano il confine utente↔team. Le regole (aree
    # dati, no traversal, tipo coerente, attestazione PDF) vivono in
    # `shared/skills/artifact.py`; `tests/test_artifact_skill.py` le confronta
    # col payload del client desktop e vieta alla skill di essere più
    # permissiva.
    'fetch_artifact':         'artifact',   # jht artifact fetch
    'upload_user_document':   'artifact',   # jht artifact upload
    # La deroga alla spesa: il gioco pilota la stessa `burn_intent.grant/revoke`
    # che sta dietro `jht burn on|off|status`, non una sua copia.
    'request_burn_intent':    'burn',       # jht burn status
    'set_burn_intent':        'burn',       # jht burn on / off
}

def cli_commands():
    r = subprocess.run(
        [_node(), JHT, 'help'], capture_output=True, text=True, cwd=REPO_ROOT,
        env={**os.environ, 'JHT_HOME': os.environ.get('JHT_HOME', '')},
    )
    assert r.returncode == 0, f"`jht help` è uscito {r.returncode}:\n{r.stderr}"
    return {m for m in re.findall(r'^\s{2}([a-z][a-z0-9-]*)', r.stdout, re.M)}


def _node():
    from shutil import which
    node = which('node')
    if not node:
        pytest.skip('node non disponibile')
    return node


def test_i_comandi_cli_dichiarati_esistono_davvero():
    """Una mappatura vale solo se il comando che promette è invocabile."""
    disponibili = cli_commands()
    mancanti = {v: c for v, c in COVERED.items() if c not in disponibili}
    assert not mancanti, (
        "COVERED promette comandi che `jht help` non elenca: " + repr(mancanti)
    )


def test_i_verbi_di_decisione_sono_coperti():
    """Il cuore di [JHT-CLI-AGENT-PARITY]: le azioni che esprimono un giudizio
    dell'utente devono essere raggiungibili da CLI, altrimenti un agente può
    guardare e comandare ma non decidere."""
    disponibili = cli_commands()
    for comando in ('positions', 'ticket', 'directives', 'artifact'):
        assert comando in disponibili, f"`jht {comando}` non è registrato"


@pytest.mark.parametrize('sub', ['fetch', 'upload'])
def test_artifact_espone_i_due_versi_del_confine(sub):
    """Leggere un documento prodotto dal team e consegnargliene uno sono due
    azioni diverse: coprirne una sola lascia l'agente a metà del giro."""
    r = subprocess.run(
        [_node(), JHT, 'artifact', '--help'],
        capture_output=True, text=True, cwd=REPO_ROOT,
    )
    assert sub in r.stdout, f"`jht artifact {sub}` non compare nell'help"


@pytest.mark.parametrize('sub', ['exclude', 'restore', 'request-cv'])
def test_positions_espone_i_verbi_di_decisione(sub):
    r = subprocess.run(
        [_node(), JHT, 'positions', '--help'],
        capture_output=True, text=True, cwd=REPO_ROOT,
    )
    assert sub in r.stdout, f"`jht positions {sub}` non compare nell'help"
