"""Il `tmux new-session` di Dottore e Mantenitore deve avere un tetto di tempo.

`-c <workdir>` fa chdir() in una directory sotto $JHT_HOME, che su Docker
Desktop e' un bind mount virtuale: una chdir()/stat() che non ritorna mette il
client tmux in stato D e il comando non crea la sessione, non esce e non
fallisce (in produzione: 15+ ore appeso). start-agent.sh ha il suo tetto sulla
stessa riga; il percorso Dottore/Mantenitore non ne aveva nessuno.

Asserzioni sul SORGENTE, come test_spawn_stagger.py e
test_doctor_daily_restart_contract.py: qui il comportamento a runtime
richiederebbe tmux e un provider LLM veri.
"""

import re
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
SPAWN_LIB = ROOT / ".launcher" / "spawn-lib.sh"
SPAWNERS = {
    "spawn-doctor.sh": "$DOTTORE_DIR",
    "spawn-maintainer.sh": "$MANT_DIR",
}


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _helper_body() -> str:
    source = _read(SPAWN_LIB)
    body = source[source.index("jht_spawn_new_session()") :]
    return body[: body.index("\n}\n") + 3]


@pytest.mark.parametrize("name", sorted(SPAWNERS))
def test_no_spawner_creates_a_session_without_a_time_bound(name: str):
    source = _read(ROOT / ".launcher" / name)
    bare = [
        line
        for line in source.splitlines()
        if re.match(r"^\s*tmux new-session", line)
    ]
    assert not bare, f"{name}: `tmux new-session` senza tetto di tempo: {bare}"


@pytest.mark.parametrize(("name", "workdir"), sorted(SPAWNERS.items()))
def test_both_spawners_go_through_the_shared_bounded_helper(name: str, workdir: str):
    source = _read(ROOT / ".launcher" / name)
    # Un tetto scaduto deve fermare lo spawn, non proseguire su una sessione
    # che non esiste: il REPL verrebbe iniettato nel vuoto.
    assert (
        f'jht_spawn_new_session "$SESSION" "{workdir}" "$LABEL" || exit 1' in source
    ), name


def test_helper_bounds_the_session_creation_with_the_portable_timeout():
    body = _helper_body()
    assert 'jht_timeout "$secs"' in body
    assert "tmux new-session -d -x 220 -y 50" in body
    assert 'secs="${JHT_SPAWN_TMUX_TIMEOUT_SEC:-45}"' in body


def test_default_bound_is_the_value_the_timeout_census_settled_on():
    # 214-3-timeout-value.md: 45 s = ~25x il caso sano (< 2 s), sopra la fascia
    # "host saturo" (10-25 s) e sopra i 30 s del warmup, che e' il passo
    # bloccante paragonabile gia' accettato nello stesso sistema.
    match = re.search(
        r'secs="\$\{JHT_SPAWN_TMUX_TIMEOUT_SEC:-(\d+)\}"', _helper_body()
    )
    assert match, "il default del tetto deve restare leggibile e sovrascrivibile"
    assert 30 < int(match.group(1)) <= 60


def test_a_real_tmux_failure_is_not_disguised_as_a_timeout():
    # Caso negativo: se tmux fallisce subito con un rc suo (server morto,
    # sessione duplicata), il messaggio deve dire QUEL rc. Affermare "did not
    # return within Ns" su un errore immediato manda la diagnosi fuori strada.
    body = _helper_body()
    assert '[ "$rc" -eq 124 ]' in body, "il ramo hang deve essere distinto"
    assert "did not return within" in body
    assert "tmux new-session failed (rc=$rc)" in body


def test_the_bounded_helper_declares_where_the_portable_timeout_lives():
    source = _read(SPAWN_LIB)
    assert '. "$JHT_SPAWN_LIB_DIR/daemon-lib.sh"' in source
    assert "command -v jht_timeout" in source


def test_there_is_no_local_unbounded_fallback_for_the_time_bound():
    # Un ripiego che crea la sessione SENZA tetto e' la riga rimasta appesa
    # 15+ ore in produzione: una protezione che si spegne da sola.
    assert "jht_timeout() {" not in _read(SPAWN_LIB)


def test_without_the_time_bound_the_session_is_refused_not_created_unbounded():
    body = _helper_body()
    precondition = body[: body.index("secs=")]
    assert "command -v jht_timeout" in precondition, (
        "la verifica deve stare PRIMA di toccare tmux"
    )
    assert "refusing to create" in precondition
    assert "jht_timeout unavailable" in precondition, "nomina l'helper mancante"
    assert "return 1" in precondition


def test_the_expired_bound_does_not_kill_a_session_that_may_have_just_started():
    # 214-3 §"costo di un falso positivo": un kill immediato distrugge una
    # sessione appena nata quando il tetto scatta per lentezza, non per hang.
    # La pulizia spetta al kill-then-create del tentativo successivo.
    assert "kill-session" not in _helper_body()
    for name in SPAWNERS:
        source = _read(ROOT / ".launcher" / name)
        assert "jht_spawn_kill_sessions" in source, name
