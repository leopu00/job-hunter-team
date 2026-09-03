"""Il fallimento di `tmux new-session` non deve MENTIRE sulla causa.

Il wrapper restituisce 124 solo quando il tetto scade; 125/126/127 per
problemi suoi (binario assente o non eseguibile); altrimenti PROPAGA l'rc di
tmux. Un `if ! timeout ...` nudo collassava i tre casi in uno e etichettava
come "hung spawn" anche un `duplicate session` istantaneo — e, peggio, faceva
partire un `kill-session` che su quell'rc ammazza la sessione di un ALTRO
agente (team-rules T01: mai killare la sessione di un altro agente).

Il messaggio deve anche stare in UNA riga e bastare a se': il chiamante
principale (`cli/src/commands/team/start.js`) conserva solo l'ultima riga non
vuota di stderr, quindi la diagnosi nativa di tmux, se resta una riga a se',
non arriva mai ne' all'utente ne' al campo `error` in dashboard.

Cosa questa suite tiene fermo:
  1. l'rc viene catturato e discriminato, non collassato da un `if !`;
  2. la frase sul timeout compare SOLO nel ramo del tetto scaduto;
  3. il `kill-session` di quel blocco vive SOLO in quel ramo;
  4. i rami non-timeout dicono esplicitamente che la sessione non e' stata
     creata da questo tentativo;
  5. lo stderr di tmux viene rimesso dentro la riga di errore;
  6. la pulizia attende che la sessione si materializzi (il tetto uccide il
     CLIENT tmux, non il server: la sessione puo' nascere qualche secondo
     dopo) ed e' essa stessa limitata nel tempo.

Un test comportamentale non e' praticabile: per arrivare a questo blocco lo
script attraversa provider preflight, `flock`, copia delle skill e il guard di
idempotenza — servirebbe un container. Il contratto e' testuale, ed e'
esattamente cio' che una futura "semplificazione" romperebbe.

Eseguire:
    pytest tests/test_start_agent_spawn_error_diagnostics.py -v
"""

import re
from pathlib import Path

LAUNCHER = Path(__file__).resolve().parent.parent / ".launcher" / "start-agent.sh"
SOURCE = LAUNCHER.read_text(encoding="utf-8")

GUARD = 'jht_timeout "$JHT_SPAWN_TMUX_TIMEOUT_SEC" tmux new-session'
TIMED_OUT_BRANCH = "124|137)"
WRAPPER_BRANCH = "125|126|127)"


def _spawn_block() -> str:
    """Dal comando guardato fino alla prima riga che presuppone il successo."""
    start = SOURCE.index(GUARD)
    end = SOURCE.index("send_env_vars", start)
    return SOURCE[start:end]


def test_rc_is_captured_instead_of_collapsed_by_a_bare_if():
    assert re.search(r"if ! \S*timeout \S+ tmux new-session", SOURCE) is None, (
        "`if ! <timeout> tmux new-session` e' tornato: dentro il `then` di un "
        "`if !` il `$?` vale la negazione logica, non l'rc, quindi il 124 non "
        "e' piu' distinguibile da un fallimento istantaneo di tmux"
    )
    block = _spawn_block()
    assert "|| _ns_rc=$?" in block
    assert 'case "$_ns_rc" in' in block


def test_timeout_wording_lives_only_in_the_timed_out_branch():
    block = _spawn_block()
    timed_out = block.index(TIMED_OUT_BRANCH)
    wrapper = block.index(WRAPPER_BRANCH)
    for phrase in ("hung spawn", "did not return within"):
        assert block.count(phrase) == 1, f"{phrase!r} deve comparire una volta sola"
        assert timed_out < block.index(phrase) < wrapper


def test_the_timeout_message_reports_the_configured_bound():
    """Un numero scritto a mano nel messaggio diverge dal tetto reale appena
    qualcuno usa l'override."""
    block = _spawn_block()
    assert "within ${JHT_SPAWN_TMUX_TIMEOUT_SEC}s" in block
    assert not re.search(r"did not return within \d+s", block)


def test_kill_session_is_confined_to_the_timed_out_branch():
    """Su rc=1 (`duplicate session`) la sessione esiste ma l'ha creata QUALCUN
    ALTRO: un kill incondizionato viola team-rules T01."""
    block = _spawn_block()
    assert block.count("tmux kill-session") == 1
    kill = block.index("tmux kill-session")
    assert block.index(TIMED_OUT_BRANCH) < kill < block.index(WRAPPER_BRANCH)
    # `|| true`: sotto `set -e` un kill fallito (sessione inesistente — il caso
    # normale qui) uscirebbe prima dell'`exit 1`. Stesso allineamento del
    # gemello nel ramo SENTINELLA-WORKER.
    assert "|| true" in block[kill : kill + 120]


def test_the_cleanup_targets_are_anchored_to_the_exact_session():
    """Nel ramo d'errore la sessione tipicamente NON esiste: senza `=` tmux
    passa al prefix matching e il kill atterra su una sessione sorella."""
    block = _spawn_block()
    assert 'tmux kill-session -t "=$SESSION"' in block
    assert 'tmux has-session -t "=$SESSION"' in block
    assert '-t "$SESSION"' not in block


def test_the_cleanup_waits_for_the_session_to_materialise():
    """Il tetto uccide il CLIENT tmux, non il server: se il server era lento ma
    vivo la sessione nasce DOPO il SIGTERM, e un kill immediato la lascerebbe
    come guscio permanente."""
    block = _spawn_block()
    grace = block.index('tmux has-session -t "=$SESSION"')
    kill = block.index("tmux kill-session")
    assert grace < kill, "il kill non aspetta che la sessione si materializzi"
    assert "sleep 1" in block[grace:kill]


def test_the_cleanup_is_itself_time_bounded():
    """E' l'ultimo punto del ramo che potrebbe appendersi per sempre col fd 9
    del lock in mano — cioe' ricreare il lockout che la guardia previene."""
    block = _spawn_block()
    for command in ("tmux has-session", "tmux kill-session"):
        line = next(ln for ln in block.splitlines() if command in ln)
        assert line.strip().startswith("jht_timeout "), line.strip()
        assert "9>&-" in line, f"il client di pulizia non chiude il fd del lock: {line.strip()}"


def test_non_timeout_branches_state_that_no_session_was_created():
    block = _spawn_block()
    tail = block[block.index(WRAPPER_BRANCH) :]
    assert "not a timeout" in tail
    assert tail.count("No session was created") == 2  # wrapper + rc propagato
    assert "No session was created by this attempt" in tail


def test_tmux_stderr_is_folded_into_the_single_error_line():
    block = _spawn_block()
    assert '2>"$_ns_err"' in block
    # Ramo del tetto + ramo dell'rc propagato: entrambi riportano cosa ha detto
    # tmux, perche' e' l'unica riga che sopravvive al troncamento del CLI.
    assert block.count("${_ns_msg:-") >= 2
    assert "tr '\\n' ' '" in block, "lo stderr multiriga va appiattito su una riga"


def test_error_lines_go_to_stderr_in_english_with_the_house_prefix():
    block = _spawn_block()
    errors = [ln.strip() for ln in block.splitlines() if ln.strip().startswith('echo "Error:')]
    assert len(errors) == 3, errors
    assert all(ln.endswith(">&2") for ln in errors), errors
