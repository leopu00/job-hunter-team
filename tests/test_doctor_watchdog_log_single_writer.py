"""Un path di log, un solo scrittore — invariante per i daemon bash di pid1.

`doctor-watchdog.sh` scriveva con `tee -a` su logs/doctor-watchdog.log, e pid1
cattura la stdout dello stesso processo sullo stesso path
(`spawnLabeled('doctor-watchdog')`); `auto-report-loop.sh` aveva la stessa
collisione con la label `auto-report`. Due scrittori significavano ogni riga
scritta due volte nello stesso file — byte doppi su un bind mount — e, appena
qualcuno ruota il file mentre il daemon gira, un fd persistente che continua a
scrivere su un inode scollegato: da quel momento meta' del diario e'
invisibile.

Il pattern vigente nel repo e' un path per scrittore, col `tee` mantenuto
perche' e' cosi' che la rotazione arriva gratis da pid1 (vedi
docs/internal/reviews/2026-09-01-lee-launcher-prs/223-4-igiene-log.md §2.1 e
214-7-osservabilita-spawn.md §6.4).
"""

import re
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
LAUNCHER = ROOT / ".launcher"
PID1 = ROOT / "cli" / "src" / "commands" / "pid1.js"

def _pid1_bash_daemons() -> tuple[tuple[str, str], ...]:
    """(script bash, label) di TUTTI i daemon bash figli di pid1, letti da pid1.js.

    Derivata invece che scritta a mano di proposito. Una tupla letterale ha due
    modi di mentire: un daemon aggiunto domani non viene coperto e nessuno se ne
    accorge, e un daemon rimosso rende rossa la suite per un file che non esiste
    piu' (accaduto: il revert del pager-unstick-watchdog). Leggendo la fonte di
    verita' l'invariante segue la famiglia da sola, che e' cio' che il docstring
    di questo file promette.
    """
    source = PID1.read_text(encoding="utf-8")
    consts = dict(
        re.findall(r"const\s+(\w+)\s*=\s*'/app/\.launcher/([A-Za-z0-9_.-]+\.sh)'", source)
    )
    found = []
    for label, ident in re.findall(
        r"spawnLabeled\(\s*'([^']+)'\s*,\s*'/bin/bash'\s*,\s*\[\s*(\w+)\s*\]", source
    ):
        script = consts.get(ident)
        if script and (LAUNCHER / script).is_file():
            found.append((script, label))
    return tuple(found)


PID1_BASH_DAEMONS = _pid1_bash_daemons()


def test_the_daemon_list_is_not_empty():
    """Anti-vacuita': se la regex smette di matchare, le suite parametrizzate
    qui sotto passerebbero a zero casi — verdi senza aver verificato niente."""
    assert len(PID1_BASH_DAEMONS) >= 3, PID1_BASH_DAEMONS
    scripts = {s for s, _ in PID1_BASH_DAEMONS}
    for expected in ("agent-watchdog.sh", "doctor-watchdog.sh", "auto-report-loop.sh"):
        assert expected in scripts, (expected, PID1_BASH_DAEMONS)


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _log_paths(source: str) -> set[str]:
    """I nomi di file .log a cui lo script scrive (tee/redirect/jht_daemon_log)."""
    names: set[str] = set()
    for line in source.splitlines():
        if line.strip().startswith("#"):
            continue
        for match in re.finditer(r"([A-Za-z0-9_.-]+\.log)", line):
            if "tee " in line or ">>" in line or "jht_daemon_log" in line or "LOG" in line:
                names.add(match.group(1))
    return names


@pytest.mark.parametrize(("script", "label"), PID1_BASH_DAEMONS)
def test_no_pid1_child_writes_on_the_path_pid1_already_owns(script: str, label: str):
    # pid1 apre $JHT_HOME/logs/<label>.log con un fd persistente e lo ruota con
    # renameSync: quel path deve avere lui come unico scrittore.
    written = _log_paths(_read(LAUNCHER / script))
    assert f"{label}.log" not in written, (
        f"{script} scrive sul path di pid1 ({label}.log): due scrittori"
    )
    assert written, f"{script} deve avere un proprio diario"


@pytest.mark.parametrize(("script", "label"), PID1_BASH_DAEMONS)
def test_pid1_still_owns_the_historical_log_path(script: str, label: str):
    # La continuita' storica sta qui: <label>.log continua a esistere e a
    # ricevere le stesse righe, via la cattura della stdout da parte di pid1.
    # Se una label cambia, il path storico smette di essere alimentato.
    assert f"spawnLabeled('{label}'" in _read(PID1), script


# (script, nome del proprio diario) — i due loop portati sul pattern in questo
# batch. agent-watchdog.sh non passa da jht_daemon_log e non e' in perimetro
# qui.
OWN_DIARIES = (
    ("doctor-watchdog.sh", "doctor-watchdog-loop.log"),
    ("auto-report-loop.sh", "auto-report-loop.log"),
)


@pytest.mark.parametrize(("script", "diary"), OWN_DIARIES)
def test_the_loop_keeps_teeing_so_pid1_still_sees_and_rotates_the_lines(
    script: str, diary: str
):
    # Il `tee` non e' cosmesi: e' il meccanismo con cui la famiglia dei daemon
    # bash di pid1 ottiene una copia ruotata (223-4 §2.4).
    source = _read(LAUNCHER / script)
    body = source[source.index("\nlog() {") :]
    body = body[: body.index("\n}\n")]
    assert 'tee -a "$LOG_FILE"' in body, script


@pytest.mark.parametrize(("script", "diary"), OWN_DIARIES)
def test_the_loop_diary_has_a_name_of_its_own_and_a_rotation(
    script: str, diary: str
):
    source = _read(LAUNCHER / script)
    assert f'LOG_FILE="$(jht_daemon_log {diary})"' in source, script
    # jht_daemon_log ruota solo quando viene chiamata: un loop che vive mesi la
    # deve richiamare a ogni giro, altrimenti il diario cresce senza limite.
    assert source.count(f"jht_daemon_log {diary}") >= 2, (
        f"{script}: la rotazione va ricontrollata a ogni tick, non solo all'avvio"
    )
    per_tick = source[source.index("\nwhile true; do") :]
    if f"jht_daemon_log {diary}" not in per_tick:
        # doctor-watchdog centralizza la chiusura del tick in finish_tick()
        tick = source[source.index("finish_tick() {") :]
        per_tick = tick[: tick.index("\n}\n")]
    assert f"jht_daemon_log {diary}" in per_tick, script


@pytest.mark.parametrize(("script", "diary"), OWN_DIARIES)
def test_the_diary_still_lives_under_the_persistent_logs_directory(
    script: str, diary: str
):
    # jht_daemon_log risolve sotto $JHT_LOGS_DIR/$JHT_HOME/logs, che e'
    # bind-mountata: /tmp e' il layer effimero e i log ci sparivano a ogni
    # recreate del container.
    daemon_lib = _read(LAUNCHER / "daemon-lib.sh")
    assert 'JHT_LOGS_DIR:-${JHT_HOME:-/jht_home}/logs' in daemon_lib
    source = _read(LAUNCHER / script)
    assert 'jht_daemon_log() { printf ' in source, (
        f"{script}: ripiego se daemon-lib manca (costa solo la rotazione)"
    )
