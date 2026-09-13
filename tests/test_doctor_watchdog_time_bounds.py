"""Nessuna chiamata bloccante del loop doctor-watchdog resta senza tetto.

`out=$(bash "$SPAWNER" 2>&1)` non aveva alcun limite di tempo: un figlio
appeso (il caso documentato e' `tmux new-session -c` che non ritorna su un
bind mount stallato) fermava il loop per sempre e in silenzio — niente
Dottore, niente Mantenitore, nessuna riga di log. Qui non c'e' flock, quindi
il guasto e' "loop fermo", non il "lockout permanente" del percorso agenti.

Riferimenti: docs/internal/reviews/2026-09-01-lee-launcher-prs/
214-7-osservabilita-spawn.md §4 (H2) e §6.1, e 214-3-timeout-value.md §2 per
la scala dei valori.

Asserzioni sul SORGENTE, come test_doctor_daily_restart_contract.py: il
comportamento a runtime richiede tmux, python e un provider LLM veri.
"""

import re
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
WATCHDOG = ROOT / ".launcher" / "doctor-watchdog.sh"
SPAWN_LIB = ROOT / ".launcher" / "spawn-lib.sh"


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _default(source: str, name: str) -> int:
    match = re.search(rf'"\$\{{{name}:-(\d+)\}}"', source)
    assert match, f"{name} deve restare un default inline sovrascrivibile"
    return int(match.group(1))


def _code_lines() -> list[str]:
    """Righe logiche: commenti via, continuazioni `\\` unite.

    I commenti di questo file CITANO il codice vecchio (`out=$(bash ...)`), e
    una chiamata limitata sta spesso su due righe: senza normalizzare, sia il
    test positivo sia quello negativo leggerebbero la cosa sbagliata.
    """
    logical: list[str] = []
    buffer = ""
    for raw in _read(WATCHDOG).splitlines():
        line = raw.strip()
        if line.startswith("#"):
            continue
        buffer = f"{buffer} {line}" if buffer else line
        if buffer.endswith("\\"):
            buffer = buffer[:-1].rstrip()
            continue
        logical.append(buffer)
        buffer = ""
    if buffer:
        logical.append(buffer)
    return logical


# ── ogni chiamata bloccante e' limitata ─────────────────────────────────────


def test_every_external_call_goes_through_the_bounded_helper():
    unbounded = [
        line
        for line in _code_lines()
        if re.search(r"(^|[\s(])(python3|bash)\s", line)
        and "jht_doctor_bounded" not in line
    ]
    assert not unbounded, f"chiamate esterne senza tetto di tempo: {unbounded}"


def test_neither_spawner_is_captured_in_a_command_substitution():
    # `out=$(cmd)` non ritorna finché TUTTI i writer della pipe l'hanno chiusa,
    # nipoti compresi: il tmux appeso eredita lo stdout dello spawner, quindi
    # con la pipe il loop resterebbe bloccato anche col tetto scattato.
    code = "\n".join(_code_lines())
    assert '$(bash "$SPAWNER"' not in code
    assert '$(bash "$MAINT_SPAWNER"' not in code
    assert 'jht_timeout "$secs" "$@" >"$outfile" 2>&1' in code


def test_the_capture_buffer_stays_off_the_bind_mount():
    # $JHT_HOME/logs è il mount che si stalla: la redirezione viene aperta
    # PRIMA che il tetto possa intervenire, quindi il buffer va su /tmp.
    source = _read(WATCHDOG)
    match = re.search(r'RUN_PREFIX="([^"]+)"', source)
    assert match, "il prefisso dei file di cattura deve restare esplicito"
    assert "TMPDIR:-/tmp" in match.group(1)
    assert "$JHT_HOME" not in match.group(1)
    assert "$LOGS_DIR" not in match.group(1)


# ── coerenza dei valori con il resto del sistema ────────────────────────────


def test_the_bounds_nest_from_the_poll_down_to_the_tmux_creation():
    source = _read(WATCHDOG)
    poll = _default(source, "DOCTOR_WATCHDOG_POLL")
    spawn = _default(source, "JHT_DOCTOR_SPAWN_TIMEOUT_SEC")
    helper = _default(source, "JHT_DOCTOR_HELPER_TIMEOUT_SEC")
    tmux = _default(_read(SPAWN_LIB), "JHT_SPAWN_TMUX_TIMEOUT_SEC")

    # Un tick scaduto non deve sovrapporsi al poll successivo...
    assert spawn < poll
    # ...e deve stare sopra il caso peggiore SANO di uno spawner: 45 s di
    # tmux new-session + ~26 s di jht_spawn_wait_repl (12+1+12) + la copia
    # delle skill su un bind mount molto più lento.
    assert spawn >= 2 * (tmux + 26)
    # Un helper python è un ordine di grandezza sotto uno spawner.
    assert helper < spawn
    assert helper >= 30


def test_the_wait_repl_budget_used_for_the_ratio_is_still_the_real_one():
    # Se qualcuno allunga il poll interno di jht_spawn_wait_repl, il rapporto
    # del test qui sopra va rifatto: questo lo rende visibile.
    body = _read(SPAWN_LIB)
    body = body[body.index("jht_spawn_wait_repl() {") :]
    body = body[: body.index("\n}\n")]
    assert "seq 1 12" in body
    assert '[ "$attempt" -ge 2 ]' in body


# ── che cosa fa il loop quando il tetto scatta ──────────────────────────────


def _branch(source: str, start: str, end: str = "\n        else") -> str:
    begin = source.index(start)
    return source[begin : source.index(end, begin)]


def test_an_expired_doctor_spawn_keeps_the_claim_and_the_loop_alive():
    source = _read(WATCHDOG)
    branch = _branch(source, 'elif [ "$rc" -eq 124 ]; then')
    # Esito incerto: la sessione può essere nata e l'hang stare a valle. La
    # regola dichiarata nel file è "meglio saltare un rich round che duplicare
    # uno spawn LLM", quindi il claim NON si rilascia.
    assert "release" not in branch
    assert "claim RETAINED" in branch
    assert "loop alive" in branch
    # e il tick si chiude normalmente, cioè il loop riparte
    assert 'finish_tick "$POLL_SEC"' in source[source.index(branch) :]


def test_an_expired_maintainer_spawn_marks_the_day_instead_of_retrying():
    source = _read(WATCHDOG)
    branch = _branch(source, 'elif [ "$mrc" -eq 124 ]; then', "\n      else")
    assert "mark-maintainer" in branch, (
        "un secondo spawn ucciderebbe e ricreerebbe un Mantenitore magari vivo"
    )
    assert "loop alive" in branch


def test_an_expired_config_check_is_told_apart_from_a_missing_provider():
    # Senza una riga propria, un mount stallato è indistinguibile da un
    # provider non ancora autenticato: il loop resterebbe "sospeso" per sempre
    # senza che la causa risulti da nessuna parte.
    source = _read(WATCHDOG)
    branch = _branch(source, 'if [ "$config_rc" -eq 124 ]; then', "\n    elif")
    assert "bound" in branch and "loop alive" in branch
    assert "provider not authenticated yet" not in branch


@pytest.mark.parametrize(
    "expected",
    (
        "schedule check-maintainer hit the",
        "schedule claim hit the",
        "spawn dottore hit the",
        "spawn mantenitore hit the",
        "config check hit the",
    ),
)
def test_every_expired_bound_leaves_its_own_diagnostic_line(expected: str):
    assert expected in _read(WATCHDOG)


def test_every_expired_bound_says_whether_the_child_could_be_closed():
    # "expired" = il tetto ha chiuso il figlio. "abandoned pid=N" = il figlio
    # non e' chiudibile ed e' rimasto orfano sulla macchina: e' l'unica
    # traccia che ne resta, e va distinta.
    source = _read(WATCHDOG)
    for line in source.splitlines():
        if "hit the" in line and "log " in line:
            assert "${BOUND_STATE}" in line, line


# ── il tetto deve bastare anche quando il figlio non e' chiudibile ──────────


def _helper() -> str:
    source = _read(WATCHDOG)
    body = source[source.index("jht_doctor_bounded() {") :]
    return body[: body.index("\n}\n") + 3]


def test_the_helper_does_not_wait_on_the_child_in_the_foreground():
    # `timeout` manda il segnale e poi ASPETTA che il figlio sia raccolto: un
    # processo in stato D non muore ne' con SIGTERM ne' con SIGKILL finche' la
    # syscall non ritorna, quindi il tetto da solo resterebbe appeso quanto lui
    # e il loop con lui. Serve un'attesa a scadenza su un figlio in background.
    helper = _helper()
    assert re.search(r"\}\s*\\?\s*\n?\s*>/dev/null 2>&1 &", helper), (
        "il comando limitato deve girare in background"
    )
    assert 'steps" -ge "$max_steps' in helper
    assert "BOUND_GRACE_SEC" in helper


def test_an_unclosable_child_is_abandoned_with_its_pid_in_the_log():
    helper = _helper()
    assert 'BOUND_STATE="abandoned pid=$child"' in helper
    assert "return 124" in helper


def test_the_wait_keys_off_the_return_code_file_not_kill_zero():
    # Un figlio finito ma non ancora raccolto e' uno zombie, e `kill -0` su uno
    # zombie riesce: l'attesa non finirebbe mai prima della scadenza.
    helper = _helper()
    assert '[ ! -s "$rcfile" ]' in helper
    assert "kill -0" not in helper


def test_the_background_child_cannot_hold_the_stdout_of_the_loop():
    # Sotto pid1 la stdout di questo script e' una pipe: un figlio abbandonato
    # che la eredita la tiene aperta quanto vive (stessa lezione del `9>&-` in
    # start-agent.sh).
    assert ">/dev/null 2>&1 &" in _helper()


def test_the_config_gate_does_not_feed_python_from_stdin():
    # Regressione precisa: una chiamata limitata parte in background e bash
    # redirige lo stdin di un comando asincrono da /dev/null. Con l'heredoc,
    # `python3 -` leggerebbe EOF, non eseguirebbe nulla e uscirebbe 0 — cioe'
    # "provider autenticato" SEMPRE, l'esatto contrario del gate.
    code = "\n".join(_code_lines())
    assert "python3 -" not in code, "nessun helper deve leggere da stdin"
    assert 'python3 "$CONFIG_READY_PY"' in code
    assert re.search(r'CONFIG_READY_PY="\$RUN_PREFIX[^"]*"', code)


def test_the_sub_second_wait_step_stays_consistent_with_its_counter():
    source = _read(WATCHDOG)
    steps = re.findall(r"BOUND_POLL_STEP=([\d.]+)", source)
    per_sec = re.findall(r"BOUND_POLL_PER_SEC=(\d+)", source)
    assert len(steps) == len(per_sec) == 2, "un ramo sub-secondo e un fallback"
    for step, count in zip(steps, per_sec):
        assert abs(float(step) * int(count) - 1.0) < 1e-9, (step, count)


def test_a_known_failure_keeps_its_historical_message_and_release():
    # Regressione: il ramo "fallimento certo" non deve essere assorbito dal
    # nuovo ramo del tetto. Restano il messaggio storico e il release.
    source = _read(WATCHDOG)
    assert 'log "spawn FAILED (slot=$slot) rc=$rc: $out"' in source
    assert 'log "schedule claim FAILED rc=$slot_rc' in source
    assert 'python3 "$SCHED" release "$slot"' in source


# ── dipendenza dichiarata sull'helper portabile ─────────────────────────────


def test_the_loop_declares_where_the_portable_timeout_comes_from():
    source = _read(WATCHDOG)
    assert '. "$JHT_LAUNCHER_DIR/daemon-lib.sh"' in source
    assert "command -v jht_timeout" in source


def test_the_loop_has_no_unbounded_fallback_for_the_time_bound():
    # Un ripiego che gira SENZA tetto ricrea esattamente il guasto che questo
    # file chiude: una protezione che si spegne da sola. L'unico ripiego
    # ammesso e' jht_daemon_log, che costa la sola rotazione del diario e senza
    # il quale il loop non avrebbe dove scrivere che il tetto manca.
    code = "\n".join(_code_lines())
    assert "jht_timeout() {" not in code, "nessuna definizione locale di jht_timeout"
    assert "jht_daemon_log() {" in code


def test_a_missing_time_bound_stops_the_spawns_and_keeps_the_loop_alive():
    source = _read(WATCHDOG)
    gate = _branch(
        source,
        'if ! command -v jht_timeout >/dev/null 2>&1; then',
        '\n  if [ "$bounds_log_tick" -gt 0 ]',
    )
    # Nessuno spawn senza tetto...
    assert "refusing to spawn" in gate
    assert "BROKEN INSTALL" in gate, "la causa va nominata, non dedotta"
    # ...ma il loop non muore: chiude il tick e ricontrolla, cosi' si ripara da
    # solo appena /app e' a posto.
    assert 'finish_tick "$POLL_SEC"' in gate
    assert "continue" in gate
    assert "bounds_log_tick % 8" in gate, "riga throttlata come gli altri gate"
    assert "time bounds restored" in source, "il ritorno alla normalita' va detto"


def test_the_time_bound_gate_runs_before_every_other_bounded_call():
    # Ogni altra chiamata del tick passa da jht_doctor_bounded: se il gate non
    # fosse il primo, il primo a fallire sarebbe il gate del provider e il
    # diario direbbe "provider non autenticato" — una diagnosi falsa.
    source = _read(WATCHDOG)
    loop = source[source.index("\nwhile true; do") :]
    gate = loop.index("command -v jht_timeout")
    first_bounded = loop.index("config_ready")
    assert gate < first_bounded
