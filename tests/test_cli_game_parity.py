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

Come funziona: ogni funzione pubblica del `BackendBus` del gioco — il contratto
fra la UI Godot e il backend — deve comparire nella tabella qui sotto, con la
sua controparte CLI o con il motivo per cui non ne ha una. Un verbo nuovo che
nessuno ha classificato fa fallire il test: è l'unico modo perché la domanda
"e da CLI come si fa?" venga posta *quando* la feature nasce, non tre mesi dopo.

Eseguire con: pytest tests/test_cli_game_parity.py -v
"""

import os
import re
import subprocess
import sys

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
BACKEND_BUS = os.path.join(REPO_ROOT, 'game', 'scripts', 'backend', 'backend_bus.gd')
JHT = os.path.join(REPO_ROOT, 'cli', 'bin', 'jht.js')

# Verbo del gioco → comando `jht` che fa la stessa cosa.
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

# Verbi che NON hanno (e non devono avere) un equivalente CLI, col perché.
# Tenerli qui, invece che filtrarli con un pattern, costringe a decidere caso
# per caso: un `publish_*` nuovo che in realtà è un'azione non passa inosservato.
NOT_APPLICABLE = {
    # Stato della UI Godot: pannelli che si aprono e si chiudono. Non sono
    # azioni sui dati, non hanno senso fuori da una finestra.
    'close_agent_chat': 'UI', 'close_agent_terminal': 'UI',
    'open_profile_watch': 'UI', 'close_profile_watch': 'UI',
    'show_demo_positions': 'UI', 'clear_demo_positions': 'UI',
    'mark_chat_read': 'UI', 'clear_chat_unread': 'UI',
    'chat_unread_count': 'UI', 'total_chat_unread': 'UI',
    'can_chat_with': 'UI', 'chat_replies': 'UI', 'is_live': 'UI',
    'to_eur': 'UI',
    # Conferma esplicita dell'utente su una proposta CV visibile. Esporla al
    # CLI permetterebbe proprio all'agente che l'ha preparata di auto-approvarla.
    'confirm_profile_review': 'UI user consent',
    # `is_remote`: dice se il bus parla con la VPS o col container locale, e la
    # leggono il badge della simulazione e il pannello di setup. Da CLI non ha
    # senso chiederlo — il CLI gira DENTRO il container di cui è la risposta.
    'is_remote': 'UI',
    # Persistono e applicano la macchina selezionata nel solo client Godot
    # (`user://vps.cfg`). Il CLI gira già dentro l'host scelto e non possiede
    # un backend grafico da commutare.
    'clear_vps_config': 'UI', 'switch_to_local_backend': 'UI',
    # `publish_*`: il bus che consegna dati alla scena. Direzione opposta —
    # backend → UI — quindi non c'è niente da invocare da CLI.
    'publish_agent_terminal': 'bus', 'publish_coordinator_state': 'bus',
    'publish_coordinator_action': 'bus', 'publish_agent_chat': 'bus',
    'publish_chat_sent': 'bus', 'publish_profile_status': 'bus',
    'publish_usage_history': 'bus', 'publish_agent_history': 'bus',
    'publish_artifact': 'bus', 'publish_state': 'bus',
    'publish_document_upload': 'bus',
    'publish_state_key': 'bus',
    'publish_burn_intent': 'bus', 'publish_burn_intent_action': 'bus',
    'publish_agents': 'bus', 'publish_telemetry': 'bus',
    'publish_chat': 'bus', 'publish_positions': 'bus',
    'publish_settings': 'bus',
}

# Verbi scoperti e ancora senza controparte: ognuno con il tag che li traccia.
# Svuotare questo dizionario è il lavoro; finché non è vuoto, almeno è scritto.
KNOWN_GAPS = {
    # Il desktop propaga la preferenza canonica al runtime con questo verbo,
    # ma `jht` non espone ancora un comando lingua equivalente. Classificarlo
    # come UI nasconderebbe una vera scrittura di stato condiviso.
    'save_ui_language':
        "preferenza lingua canonica: manca il comando CLI equivalente "
        "— [WIN-TWO-SOURCES-OF-TRUTH-FOR-LANGUAGE]",
    # Stavano in COVERED, mappati su `stats`. Ma `jht stats` legge
    # `tasks.json`, `analytics.json` e `sessions.json`, che nessuno scrive più
    # da quando la TUI è stata rimossa (2026-07-25): rispondeva zeri, e il
    # test certificava come coperto un verbo che non risponde niente. Un test
    # che mente è peggio di un test che manca. Tornano in COVERED quando
    # `stats` leggerà una fonte viva — `jobs.db`, come `positions`.
    'request_usage_history':
        "storico dei consumi: `jht stats` non ha più una fonte "
        "— [CLI-PHANTOM-DATA-COMMANDS]",
    'kpi_summary':
        "riepilogo KPI: `jht stats` non ha più una fonte "
        "— [CLI-PHANTOM-DATA-COMMANDS]",
}


def game_verbs():
    """Funzioni pubbliche del BackendBus (le `_private` non fanno parte del
    contratto con la scena)."""
    src = open(BACKEND_BUS, encoding='utf-8').read()
    return {m for m in re.findall(r'^func ([a-z][a-z0-9_]*)', src, re.M)}


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


@pytest.fixture(scope='module')
def verbs():
    if not os.path.exists(BACKEND_BUS):
        pytest.skip('game/ non presente in questo checkout')
    return game_verbs()


def test_ogni_verbo_del_gioco_e_classificato(verbs):
    """L'allarme vero: un verbo nuovo nel BackendBus che nessuno ha deciso se
    debba esistere anche da CLI. Se questo test fallisce sul TUO commit, non
    sei obbligato a implementare il comando — sei obbligato a scegliere:
    COVERED (esiste già), KNOWN_GAPS (serve, con il tag) o NOT_APPLICABLE
    (è UI/bus, col motivo)."""
    classificati = set(COVERED) | set(NOT_APPLICABLE) | set(KNOWN_GAPS)
    nuovi = verbs - classificati
    assert not nuovi, (
        "verbi del gioco non classificati: " + ", ".join(sorted(nuovi)) +
        "\n→ aggiungili a COVERED / KNOWN_GAPS / NOT_APPLICABLE in questo file."
    )


def test_la_tabella_non_cita_verbi_scomparsi(verbs):
    """L'altro verso: se un verbo viene rinominato o rimosso, la riga qui
    diventa una bugia che nessuno rilegge."""
    citati = set(COVERED) | set(NOT_APPLICABLE) | set(KNOWN_GAPS)
    fantasmi = citati - verbs
    assert not fantasmi, (
        "questi verbi non esistono più nel BackendBus: " + ", ".join(sorted(fantasmi))
    )


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
