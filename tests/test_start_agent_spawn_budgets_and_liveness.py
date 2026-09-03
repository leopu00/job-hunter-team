"""I budget di tempo dello spawn, i target tmux ancorati, e il REPL verificato.

Tre contratti che vivono nella stessa zona di `start-agent.sh` e si tengono a
vicenda:

1. **Budget.** `flock -w` deve superare il tempo che il detentore del lock puo'
   bruciare, altrimenti un ritardo legittimo del detentore arriva agli altri
   come "concurrent spawn" — un errore che incolpa la concorrenza mentre la
   causa e' la lentezza; e deve restare sotto il budget del chiamante
   (`cli/src/commands/team/start.js`), altrimenti la CLI tronca il `docker
   exec` prima che l'errore vero sia stampato e l'utente legge un "unknown
   error" vuoto (regressione gia' osservata, vedi il commento in start.js).

2. **Target ancorati.** La risoluzione dei target tmux e' esatta -> prefisso ->
   fnmatch. Su un `has-session` il prefix matching e' peggio di un kill
   sbagliato: dichiara "already active" una sessione che non esiste, il guard
   di idempotenza esce 0 e l'agente non nasce MAI (registrato in produzione:
   prefix-match SENTINELLA vs SENTINELLA-WORKER che ha bloccato un relaunch).
   Su un `kill-session` colpisce una sessione sorella (`-t SCOUT-1` uccide
   SCOUT-10, `-t CRITICO` uccide un CRITICO-S<N> in mezzo a una review).

3. **REPL verificato.** Il ramo principale era l'unico dei tre percorsi di
   spawn a non verificare che il CLI fosse partito: un pane rimasto bash
   diventa definitivo, perche' il guard di idempotenza lo dichiara "already
   active" per sempre e il roster lo considera vivo (guarda solo
   `tmux list-sessions`). Per i worker numerati e per i CRITICO effimeri non
   c'e' nessun'altra sonda: l'unica rete e' il TTL di 12h.

Eseguire:
    pytest tests/test_start_agent_spawn_budgets_and_liveness.py -v
"""

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
LAUNCHER = REPO_ROOT / ".launcher" / "start-agent.sh"
CLI_START = REPO_ROOT / "cli" / "src" / "commands" / "team" / "start.js"

SOURCE = LAUNCHER.read_text(encoding="utf-8")
LINES = SOURCE.splitlines()

TMUX_BOUND = "JHT_SPAWN_TMUX_TIMEOUT_SEC"
LOCK_WAIT = "JHT_SPAWN_LOCK_WAIT_SEC"


def _default_of(name: str) -> int:
    match = re.search(rf'{name}="\$\{{{name}:-(\d+)\}}"', SOURCE)
    assert match, f"{name} non e' piu' un default con override via env"
    return int(match.group(1))


def _code_lines():
    return [ln for ln in LINES if not ln.lstrip().startswith("#")]


# ── 1. Budget ───────────────────────────────────────────────────────────────


def test_both_bounds_are_env_overridable_with_the_documented_defaults():
    assert _default_of(TMUX_BOUND) == 45
    assert _default_of(LOCK_WAIT) == 75


def test_a_non_numeric_override_falls_back_to_the_default():
    """Un `flock -w abc` fallirebbe subito e un tetto vuoto non e' un tetto:
    stessa sanificazione dello stagger piu' sotto nello script."""
    for name in (TMUX_BOUND, LOCK_WAIT):
        guard = f"case \"${name}\" in ''|*[!0-9]*) {name}="
        assert guard in SOURCE, f"{name} accetta un override non numerico"


def test_the_lock_wait_covers_the_bounded_steps_of_the_critical_section():
    """`flock -w` >= i due soli passi della sezione critica che hanno un tetto
    esplicito: il warmup di claude e la new-session."""
    warmup = re.search(r"timeout (\d+) claude", SOURCE)
    assert warmup, "il warmup claude non ha piu' un tetto esplicito"
    assert _default_of(LOCK_WAIT) >= _default_of(TMUX_BOUND) + int(warmup.group(1))


def test_the_lock_wait_stays_under_the_caller_budget():
    # Il budget che conta e' quello della chiamata a start-agent.sh, non i
    # timeout dei preflight che stanno nello stesso file.
    caller = re.search(
        r"execScriptInContainer\('/app/\.launcher/start-agent\.sh'.*?timeoutMs:\s*([\d_]+)",
        CLI_START.read_text(encoding="utf-8"),
        re.S,
    )
    assert caller, "il budget del chiamante non e' piu' leggibile da start.js"
    budget_sec = int(caller.group(1).replace("_", "")) / 1000
    assert _default_of(LOCK_WAIT) < budget_sec
    # E il tetto della new-session non deve da solo mangiare tutto il budget.
    assert _default_of(TMUX_BOUND) <= budget_sec / 2


def test_every_flock_wait_in_the_file_uses_the_same_knob():
    """Due valori divergenti sui due lock erano l'incoerenza originale."""
    waits = re.findall(r"flock -w (\S+) 9", SOURCE)
    assert waits, "nessun `flock -w`: il lock di spawn e' sparito"
    assert set(waits) == {f'"${LOCK_WAIT}"'}, waits


def test_the_lock_timeout_message_names_the_bound():
    """Il chiamante conserva solo l'ultima riga di stderr: la riga deve bastare
    a se' anche per capire quanto si e' atteso."""
    messages = [ln for ln in LINES if "timed out after" in ln and "concurrent spawn" in ln]
    assert len(messages) == 2, messages
    assert all(f"${{{LOCK_WAIT}}}s" in ln for ln in messages), messages


# ── 2. Target ancorati ──────────────────────────────────────────────────────


def test_the_idempotence_guard_matches_the_exact_session():
    assert 'if tmux has-session -t "=$SESSION" 2>/dev/null; then' in SOURCE


def test_no_has_session_or_kill_session_resolves_by_prefix():
    """Le due operazioni che decidono (esiste?) o distruggono (killa!) non
    devono mai poter atterrare su una sessione sorella."""
    offenders = [
        ln.strip()
        for ln in _code_lines()
        if ("has-session" in ln or "kill-session" in ln) and re.search(r'-t "\$', ln)
    ]
    assert not offenders, f"target tmux non ancorato con `=`: {offenders}"


def test_send_keys_targets_are_left_alone_on_purpose():
    """Contro-prova della scelta: i `send-keys` restano non ancorati perche'
    puntano a una sessione creata da questo stesso processo poche righe sopra,
    dove l'exact match vince comunque. Se un giorno si decidesse di ancorarli
    anche li', questo test va aggiornato — non e' un divieto, e' la memoria di
    una decisione presa."""
    send_keys = [ln for ln in _code_lines() if "tmux send-keys" in ln]
    assert send_keys, "nessun send-keys: struttura cambiata"
    assert all('-t "=$' not in ln for ln in send_keys)


# ── 3. REPL verificato ─────────────────────────────────────────────────────


def test_the_main_branch_verifies_that_the_repl_started():
    assert 'jht_spawn_wait_repl "$SESSION" "$FULL_CMD" "start-agent" "$ROLE"' in SOURCE


def test_the_repl_check_runs_after_the_auto_enter_watcher():
    """Il watcher che risponde ai dialog TUI gira in background: se l'attesa
    del REPL lo precedesse, un boot fermo su un dialog non avrebbe nessuno che
    lo sblocca mentre lo si aspetta."""
    watcher = SOURCE.index('setsid sh -c \'\n    _sess=')
    check = SOURCE.index("jht_spawn_wait_repl")
    assert watcher < check


def test_the_repl_check_gates_the_success_report_and_the_roster():
    """`✓ started` e il record del roster non devono poter certificare un
    guscio vuoto."""
    check = SOURCE.index("jht_spawn_wait_repl")
    started = SOURCE.index('echo "✓ $SESSION started', check)
    roster = SOURCE.index("team_roster.py \\", check)
    assert check < started < roster
    # Il fallimento deve interrompere lo spawn, non essere annotato e ignorato.
    assert '"start-agent.sh" || exit 1' in SOURCE


def test_the_repl_check_skips_the_non_tui_provider():
    """Stessa esclusione del watcher auto-Enter: python3 non e' una TUI."""
    check = SOURCE.index("jht_spawn_wait_repl")
    guard = SOURCE.rindex('if [ "$CLI_BIN" != "python3" ]; then', 0, check)
    between = SOURCE[guard:check]
    assert between.count("\nfi\n") == 0, "l'attesa del REPL e' fuori dal guard su CLI_BIN"


def test_the_helper_is_the_one_already_used_by_the_other_spawn_paths():
    """Nessuna variante nuova: la funzione e' la stessa di spawn-doctor.sh e
    spawn-maintainer.sh, con retry `C-c` + reinvio e l'evento spawn_failed."""
    spawn_lib = (REPO_ROOT / ".launcher" / "spawn-lib.sh").read_text(encoding="utf-8")
    assert "jht_spawn_wait_repl() {" in spawn_lib
    assert '"event":"spawn_failed"' in spawn_lib
    assert 'source "$DEV_TEAM_DIR/spawn-lib.sh"' in SOURCE
