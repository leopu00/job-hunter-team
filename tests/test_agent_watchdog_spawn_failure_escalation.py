"""Un agente che NON si riesce ad avviare deve essere misurato ed escalato.

Fino al 2026-09-03 il watchdog misurava soltanto i propri successi
(``agent-recoveries.tsv``): il ramo ``start FAILED`` era una riga di log e
nient'altro. Su una VPS di produzione un agente core ha accumulato 2.677
tentativi di avvio falliti senza che scattasse alcun allarme — non perche' la
soglia fosse alta, ma perche' non esisteva nessun contatore da superare.

Come il gemello ``test_agent_watchdog_recovery_notice.py``: nessuna TUI e
nessun tmux, si eseguono le funzioni VERE di ``agent-watchdog.sh`` con i
confini iniettati via env (liveness, spawner, sender verso il Capitano e —
nuovo — il canale verso l'utente). Lo script viene scritto su file invece di
essere passato a ``bash -c``: il prelude supera i 32 KB e su Windows la riga
di comando non lo regge.
"""

import os
import re
import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parent.parent
WATCHDOG = ROOT / ".launcher" / "agent-watchdog.sh"

# Testo che lo spawner finto scrive su stderr: finisce nel log del watchdog e
# da lì deve arrivare, come "detail", nel registro e nei messaggi.
SPAWNER_SAYS = "fake spawner: no session could be started"


def _source() -> str:
    return WATCHDOG.read_text(encoding="utf-8")


def _prelude() -> str:
    """Variabili e funzioni del watchdog, senza il daemon infinito."""
    source = _source()
    marker = 'log "watchdog start'
    assert marker in source, "il marker prima del loop watchdog è cambiato"
    return source[: source.index(marker)]


def _bash_path(path: Path) -> str:
    """C:/x → /mnt/c/x per il bash WSL; no-op su POSIX."""
    posix = Path(path).resolve().as_posix()
    if len(posix) >= 3 and posix[1:3] == ":/":
        return f"/mnt/{posix[0].lower()}/{posix[3:]}"
    return posix


def _fake(path: Path, body: str) -> Path:
    path.write_text("#!/usr/bin/env bash\n" + body, encoding="utf-8", newline="\n")
    path.chmod(0o755)
    return path


class Harness:
    """Confini iniettati + i file su cui si leggono le conseguenze."""

    def __init__(self, tmp_path: Path):
        self.home = tmp_path / "home"
        self.logs = self.home / "logs"
        self.logs.mkdir(parents=True, exist_ok=True)
        self.bin = tmp_path / "bin"
        self.bin.mkdir(parents=True, exist_ok=True)
        self.tmp = tmp_path

        self.node_calls = tmp_path / "node-calls.txt"
        self.start_calls = tmp_path / "start-calls.txt"
        self.sender_calls = tmp_path / "sender-calls.txt"
        self.notify_calls = tmp_path / "notify-calls.txt"
        self.out = tmp_path / "probe.txt"
        self.state = tmp_path / "session-state.txt"
        self.ok_flag = tmp_path / "spawner-succeeds.flag"
        self.lie_flag = tmp_path / "spawner-lies.flag"

        self.state.write_text("down\n", encoding="utf-8", newline="\n")

        spawner = (
            'printf "%s\\n" "$*" >> "$T_CALLS"\n'
            'if [ -f "$T_OK" ]; then\n'
            '  echo alive > "$T_STATE"\n'
            '  echo "fake spawner: session created"\n'
            "  exit 0\n"
            "fi\n"
            'if [ -f "$T_LIE" ]; then\n'
            '  echo "fake spawner: start returned 0 without a session" >&2\n'
            "  exit 0\n"
            "fi\n"
            f'echo "{SPAWNER_SAYS}" >&2\n'
            "exit 1\n"
        )
        # Due spawner distinti (core via `jht team start`, worker via
        # start-agent.sh) ma con lo stesso comportamento: il registro dei
        # fallimenti non deve dipendere da quale percorso ha fallito.
        self.node = _fake(
            self.bin / "node",
            f'T_CALLS="{_bash_path(self.node_calls)}"\n' + spawner,
        )
        self.start = _fake(
            self.bin / "start-agent",
            f'T_CALLS="{_bash_path(self.start_calls)}"\n' + spawner,
        )
        self.sender = _fake(
            self.bin / "sender",
            f'printf "%s\\n" "$*" >> "{_bash_path(self.sender_calls)}"\n',
        )
        self.notify = _fake(
            self.bin / "notify-user",
            f'printf "%s\\n" "$*" >> "{_bash_path(self.notify_calls)}"\n',
        )

    def header(self, **overrides) -> str:
        """I confini vanno iniettati NELLO script, non nell'ambiente.

        Su Windows il `bash` è un ponte verso WSL e l'ambiente Windows non
        attraversa il confine (solo ciò che è elencato in `WSLENV`): una env
        passata a ``subprocess`` verrebbe silenziosamente ignorata e il
        watchdog userebbe i suoi default di container. Scriverli in testa allo
        script è l'unico modo che vale su entrambi i sistemi.
        """
        exports = {
            "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
            "JHT_HOME": _bash_path(self.home),
            "JHT_NODE_BIN": _bash_path(self.node),
            "JHT_START_AGENT": _bash_path(self.start),
            "JHT_TMUX_SENDER": _bash_path(self.sender),
            "JHT_NOTIFY_USER_BIN": _bash_path(self.notify),
            "JHT_AGENT_RECOVERY_LOG": _bash_path(self.logs / "agent-recoveries.tsv"),
            "JHT_AGENT_SPAWN_FAILURE_LOG": _bash_path(
                self.logs / "agent-spawn-failures.tsv"
            ),
            "JHT_SPAWN_STATE_DIR": _bash_path(self.logs),
            # Confini del caso di prova, letti dai finti e dai body dei test.
            "T_STATE": _bash_path(self.state),
            "T_OK": _bash_path(self.ok_flag),
            "T_LIE": _bash_path(self.lie_flag),
            "T_NODE_CALLS": _bash_path(self.node_calls),
            "T_START_CALLS": _bash_path(self.start_calls),
            "T_SENDER_CALLS": _bash_path(self.sender_calls),
            "T_NOTIFY_CALLS": _bash_path(self.notify_calls),
            "T_OUT": _bash_path(self.out),
        }
        exports.update({k: str(v) for k, v in overrides.items()})
        for value in exports.values():
            assert "'" not in value, value
        return "".join(f"export {k}='{v}'\n" for k, v in exports.items())

    def run(self, body: str, **overrides) -> subprocess.CompletedProcess:
        script = (
            self.header(**overrides) + _prelude() + "\n" + PREAMBLE + "\n" + body + "\n"
        )
        script_path = self.tmp / "case.sh"
        script_path.write_text(script, encoding="utf-8", newline="\n")
        return subprocess.run(
            ["bash", _bash_path(script_path)],
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            env={**os.environ},
        )

    # ── letture ────────────────────────────────────────────────────────────
    def rows(self, name="agent-spawn-failures.tsv"):
        path = self.logs / name
        if not path.exists():
            return []
        return [
            line.split("\t")
            for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]

    def lines(self, path: Path):
        if not path.exists():
            return []
        return [
            line
            for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]

    def streak(self, session: str):
        path = self.logs / f"spawn-streak-{session}"
        if not path.exists():
            return None
        return path.read_text(encoding="utf-8").split()

    def marker(self, session: str, who: str) -> Path:
        return self.logs / f"spawn-escalate-{session}-{who}.ts"


# Confini comuni a tutti i casi: la liveness la decide un file, il containment
# è "non contenuto" per default e il kick-off dei worker non deve partire.
PREAMBLE = (
    'is_session_alive() { [ "$(cat "$T_STATE" 2>/dev/null)" = alive ]; }\n'
    "agent_is_contained() { return 1; }\n"
    "worker_kickoff() { :; }\n"
)


@pytest.fixture
def wd(tmp_path):
    return Harness(tmp_path)


# Soglie: nei casi che devono vedere MOLTI tentativi consecutivi il backoff va
# spento (0 = disattivo), perché il suo lavoro è proprio diradarli.
NO_BACKOFF = {"JHT_SPAWN_FAIL_BACKOFF_TICKS": 0}


def test_repeated_spawn_failures_are_counted_in_a_register_of_their_own(wd):
    """Sei fallimenti = sei righe durevoli, e il TSV dei recuperi resta vuoto."""
    result = wd.run(
        "for i in 1 2 3 4 5 6; do ensure_agent assistente; done",
        **NO_BACKOFF,
    )

    assert result.returncode == 0, result.stderr
    rows = wd.rows()
    assert len(rows) == 6, rows
    assert [row[1] for row in rows] == ["ASSISTENTE"] * 6
    assert all(row[0].endswith("Z") for row in rows)
    # Il "detail" dice cosa ha scritto lo spawner: un allarme che dice solo
    # "non parte" costringe a tornare a mano sul log, che è il punto di
    # partenza del guasto reale.
    assert all(SPAWNER_SAYS in row[2] for row in rows), rows
    assert all("rc=1" in row[2] for row in rows), rows
    # Registro SEPARATO: mescolarlo con i recuperi falsificherebbe il
    # "Recovery #N" che il Capitano riceve ed è già sotto test.
    assert wd.rows("agent-recoveries.tsv") == []
    assert wd.streak("ASSISTENTE")[0] == "6"
    # Sotto soglia nessuno viene disturbato.
    assert wd.lines(wd.sender_calls) == []
    assert wd.lines(wd.notify_calls) == []


def test_the_captain_is_put_in_charge_at_the_first_threshold_and_only_once(wd):
    result = wd.run(
        "for i in 1 2 3 4 5 6 7 8; do ensure_agent assistente; done",
        JHT_SPAWN_FAIL_ESCALATE_AFTER=3,
        JHT_SPAWN_FAIL_ESCALATE_MIN_SEC=0,
        JHT_SPAWN_FAIL_ALERT_AFTER=999,
        **NO_BACKOFF,
    )

    assert result.returncode == 0, result.stderr
    notices = wd.lines(wd.sender_calls)
    assert len(notices) == 1, notices
    notice = notices[0]
    assert notice.startswith("CAPITANO [WATCHDOG] ASSISTENTE cannot be started")
    assert "3 consecutive start attempts failed" in notice
    assert SPAWNER_SAYS in notice
    assert "agent-spawn-failures.tsv" in notice
    assert "KEEPS RETRYING" in notice
    # Disciplina dei messaggi: il watchdog ha osservato tentativi di avvio
    # falliti, non una causa. Dichiararla sarebbe inventarla.
    lowered = notice.lower()
    assert "dead" not in lowered and "morto" not in lowered
    assert "not the reason they fail" in notice
    # Il cooldown per sessione ha lasciato passare un solo messaggio pur
    # avendo continuato a contare fino a 8.
    assert wd.streak("ASSISTENTE")[0] == "8"
    assert wd.marker("ASSISTENTE", "captain").exists()
    assert not wd.marker("ASSISTENTE", "user").exists()
    assert wd.lines(wd.notify_calls) == []


def test_the_first_threshold_holds_both_its_count_and_its_time(wd):
    """Due condizioni NECESSARIE: né il conteggio solo, né il tempo solo."""
    below_count = wd.run(
        "for i in 1 2 3 4; do ensure_agent assistente; done",
        JHT_SPAWN_FAIL_ESCALATE_AFTER=5,
        JHT_SPAWN_FAIL_ESCALATE_MIN_SEC=0,
        **NO_BACKOFF,
    )
    assert below_count.returncode == 0, below_count.stderr
    assert len(wd.rows()) == 4
    assert wd.lines(wd.sender_calls) == [], "ha suonato prima della soglia"


def test_a_slow_cold_start_does_not_ring_before_its_grace(tmp_path):
    """Il conteggio è raggiunto ma il tempo no: un boot lento non è un guasto."""
    wd = Harness(tmp_path)
    result = wd.run(
        "for i in 1 2 3 4 5 6; do ensure_agent assistente; done",
        JHT_SPAWN_FAIL_ESCALATE_AFTER=2,
        JHT_SPAWN_FAIL_ESCALATE_MIN_SEC=3600,
        **NO_BACKOFF,
    )
    assert result.returncode == 0, result.stderr
    assert len(wd.rows()) == 6, "il fallimento va misurato comunque"
    assert wd.lines(wd.sender_calls) == []
    assert wd.lines(wd.notify_calls) == []


def test_a_successful_start_resets_the_streak(wd):
    """4 fallimenti, 1 successo, 4 fallimenti: la soglia 5 non è mai raggiunta."""
    result = wd.run(
        "for i in 1 2 3 4; do ensure_agent assistente; done\n"
        'printf "streak_before=%s\\n" "$(cut -d\' \' -f1 < "$JHT_SPAWN_STATE_DIR/spawn-streak-ASSISTENTE")" >> "$T_OUT"\n'
        # lo spawner riesce: la sessione torna viva e la serie si chiude
        'touch "$T_OK"\n'
        "ensure_agent assistente\n"
        'printf "cleared=%s\\n" "$([ -f "$JHT_SPAWN_STATE_DIR/spawn-streak-ASSISTENTE" ] && echo no || echo yes)" >> "$T_OUT"\n'
        # e riparte da zero: di nuovo giù, di nuovo 4 fallimenti
        'rm -f "$T_OK"\n'
        'echo down > "$T_STATE"\n'
        "for i in 1 2 3 4; do ensure_agent assistente; done",
        JHT_SPAWN_FAIL_ESCALATE_AFTER=5,
        JHT_SPAWN_FAIL_ESCALATE_MIN_SEC=0,
        **NO_BACKOFF,
    )

    assert result.returncode == 0, result.stderr
    probe = dict(
        line.split("=", 1) for line in wd.lines(wd.out) if "=" in line
    )
    assert probe["streak_before"] == "4"
    assert probe["cleared"] == "yes", "il successo non ha azzerato la serie"
    assert wd.streak("ASSISTENTE")[0] == "4", "gli 8 fallimenti si sono sommati"
    assert len(wd.rows()) == 8, "il registro resta append-only"
    escalations = [n for n in wd.lines(wd.sender_calls) if "cannot be started" in n]
    assert escalations == [], escalations
    assert wd.lines(wd.notify_calls) == []


def test_the_user_alert_fires_only_at_its_own_threshold_and_only_once(wd):
    result = wd.run(
        "for i in 1 2 3 4; do ensure_agent assistente; done\n"
        'cp -f "$T_NOTIFY_CALLS" "$T_NOTIFY_CALLS.after4" 2>/dev/null || : > "$T_NOTIFY_CALLS.after4"\n'
        "for i in $(seq 1 20); do ensure_agent assistente; done",
        JHT_SPAWN_FAIL_ESCALATE_AFTER=2,
        JHT_SPAWN_FAIL_ESCALATE_MIN_SEC=0,
        JHT_SPAWN_FAIL_ALERT_AFTER=5,
        JHT_SPAWN_FAIL_ALERT_MIN_SEC=0,
        **NO_BACKOFF,
    )

    assert result.returncode == 0, result.stderr
    assert wd.lines(wd.tmp / "notify-calls.txt.after4") == [], "ha suonato sotto soglia"
    alerts = wd.lines(wd.notify_calls)
    assert len(alerts) == 1, alerts
    # Gradino a costo ZERO: il CLI Python, non un turno LLM.
    assert alerts[0].startswith("--agent capitano --kind alert ")
    assert "The agent session ASSISTENTE is not starting" in alerts[0]
    assert "keeps retrying on its own" in alerts[0]
    assert "NOT observed: why it fails" in alerts[0]
    assert SPAWNER_SAYS in alerts[0]
    assert "dead" not in alerts[0].lower()
    assert wd.streak("ASSISTENTE")[0] == "24"
    assert wd.marker("ASSISTENTE", "user").exists()


def test_recovery_after_an_alert_tells_everyone_who_was_warned(wd):
    result = wd.run(
        "for i in 1 2 3; do ensure_agent assistente; done\n"
        'touch "$T_OK"\n'
        "ensure_agent assistente",
        JHT_SPAWN_FAIL_ESCALATE_AFTER=2,
        JHT_SPAWN_FAIL_ESCALATE_MIN_SEC=0,
        JHT_SPAWN_FAIL_ALERT_AFTER=3,
        JHT_SPAWN_FAIL_ALERT_MIN_SEC=0,
        **NO_BACKOFF,
    )

    assert result.returncode == 0, result.stderr
    # Lo stato su disco è pulito: nessun allarme resta acceso.
    assert wd.streak("ASSISTENTE") is None
    assert not wd.marker("ASSISTENTE", "captain").exists()
    assert not wd.marker("ASSISTENTE", "user").exists()
    resolutions = [n for n in wd.lines(wd.sender_calls) if "Resolved:" in n]
    assert len(resolutions) == 1, wd.lines(wd.sender_calls)
    assert "ASSISTENTE started successfully after 3 consecutive failed start attempts" in resolutions[0]
    assert "alarm for ASSISTENTE is cleared" in resolutions[0]
    closings = [a for a in wd.lines(wd.notify_calls) if "--kind notification" in a]
    assert len(closings) == 1, wd.lines(wd.notify_calls)
    assert "ASSISTENTE is running again" in closings[0]
    assert "the earlier alert about ASSISTENTE is closed" in closings[0]
    # Il rientro non falsifica la misura: il recupero riuscito resta il suo.
    assert [row[1:] for row in wd.rows("agent-recoveries.tsv")] == [
        ["ASSISTENTE", "inactive at the watchdog check"]
    ]


def test_start_ok_but_session_not_alive_counts_as_a_spawn_failure(wd):
    """Il terzo esito silenzioso: rc=0 e sessione comunque assente."""
    result = wd.run(
        'touch "$T_LIE"\n'
        "for i in 1 2 3; do ensure_agent assistente; done",
        **NO_BACKOFF,
    )

    assert result.returncode == 1, result.stderr
    rows = wd.rows()
    assert len(rows) == 3, rows
    assert all("start reported rc=0" in row[2] for row in rows), rows
    assert all("still inactive" in row[2] for row in rows), rows
    assert wd.rows("agent-recoveries.tsv") == []
    assert wd.streak("ASSISTENTE")[0] == "3"


def test_worker_spawn_failures_use_the_same_measure(wd):
    result = wd.run(
        "for i in 1 2 3 4 5 6; do respawn_worker scorer 2 SCORER-2 unexpected; done",
        **NO_BACKOFF,
    )

    assert result.returncode == 1, result.stderr
    assert wd.lines(wd.start_calls) == ["scorer 2"] * 6
    rows = wd.rows()
    assert [row[1] for row in rows] == ["SCORER-2"] * 6
    assert all(SPAWNER_SAYS in row[2] for row in rows), rows
    assert wd.rows("agent-recoveries.tsv") == []
    assert wd.streak("SCORER-2")[0] == "6"


def test_a_failed_intentional_recreation_is_still_a_spawn_failure(wd):
    """Deviazione motivata dal report: `intentional_ttl` classifica i RECUPERI.

    Una ricreazione voluta che NON riesce lascia la sessione uccisa e non
    risalita: escluderla dalla misura riaprirebbe esattamente il buco che
    questa misura chiude.
    """
    result = wd.run(
        "respawn_worker scorer 2 SCORER-2 intentional_ttl",
        **NO_BACKOFF,
    )
    assert result.returncode == 1, result.stderr
    assert [row[1] for row in wd.rows()] == ["SCORER-2"]
    assert wd.rows("agent-recoveries.tsv") == []


def test_a_successful_intentional_recreation_leaves_the_register_untouched(wd):
    result = wd.run(
        'touch "$T_OK"\n'
        "respawn_worker scorer 2 SCORER-2 intentional_ttl",
        **NO_BACKOFF,
    )
    assert result.returncode == 0, result.stderr
    assert wd.rows() == []
    assert wd.rows("agent-recoveries.tsv") == []
    assert wd.streak("SCORER-2") is None


def test_a_contained_session_never_produces_a_spawn_failure(wd):
    """Una sessione tenuta giù di proposito non è un guasto da misurare."""
    result = wd.run(
        "agent_is_contained() { return 0; }\n"
        "for i in 1 2 3 4 5 6; do ensure_agent mentor; done",
        JHT_SPAWN_FAIL_ESCALATE_AFTER=2,
        JHT_SPAWN_FAIL_ESCALATE_MIN_SEC=0,
        **NO_BACKOFF,
    )

    assert result.returncode == 0, result.stderr
    assert wd.rows() == []
    assert wd.streak("MENTOR") is None
    assert wd.lines(wd.node_calls) == []
    assert wd.lines(wd.sender_calls) == []
    assert wd.lines(wd.notify_calls) == []


def test_the_escalation_cooldown_is_per_session(wd):
    """Regressione sul difetto gemello: due sessioni, due messaggi."""
    result = wd.run(
        "ensure_agent assistente\nensure_agent assistente\n"
        "ensure_agent mentor\nensure_agent mentor",
        JHT_SPAWN_FAIL_ESCALATE_AFTER=2,
        JHT_SPAWN_FAIL_ESCALATE_MIN_SEC=0,
        **NO_BACKOFF,
    )

    assert result.returncode == 0, result.stderr
    notices = [n for n in wd.lines(wd.sender_calls) if "cannot be started" in n]
    assert len(notices) == 2, notices
    assert "ASSISTENTE cannot be started" in notices[0]
    assert "MENTOR cannot be started" in notices[1]
    # Il secondo messaggio dice anche che non è un caso isolato: due sessioni
    # in serie insieme è "il team non parte", non "un agente non parte".
    assert "streak right now: 2" in notices[1]
    assert wd.marker("ASSISTENTE", "captain").exists()
    assert wd.marker("MENTOR", "captain").exists()


def test_the_bridge_escalation_cooldown_is_per_key(wd):
    """Regressione sul difetto PREESISTENTE del cooldown globale.

    Prima esisteva un solo `bridge-escalate.ts` per qualunque allarme: la
    suite bridge zittiva per un'ora i process pid1-managed e viceversa.
    """
    result = wd.run(
        'jht-tmux-send() { printf "%s\\n" "$*" >> "$T_SENDER_CALLS"; }\n'
        'bridge_escalate bridge "suite bridge (morti: sentinel-bridge)"\n'
        'bridge_escalate pid1-child "process pid1-managed morti: cloud-daemon"\n'
        # la stessa chiave, subito dopo, deve invece tacere
        'bridge_escalate bridge "suite bridge (morti: sentinel-bridge)"',
    )

    assert result.returncode == 0, result.stderr
    notices = wd.lines(wd.sender_calls)
    assert len(notices) == 2, notices
    assert "suite bridge" in notices[0]
    assert "pid1-managed" in notices[1]
    assert (wd.logs / "bridge-escalate-bridge.ts").exists()
    assert (wd.logs / "bridge-escalate-pid1-child.ts").exists()
    assert not (wd.logs / "bridge-escalate.ts").exists(), (
        "il cooldown globale è tornato: un allarme ne zittirebbe un altro"
    )


def test_the_respawn_slows_down_but_never_stops(wd):
    """Requisito esplicito: solo backoff, nessun cap.

    Il tempo non viene atteso: si invecchia lo stato su disco, così il caso è
    deterministico e non paga secondi di sleep.
    """
    streak = '"$JHT_SPAWN_STATE_DIR/spawn-streak-ASSISTENTE"'
    result = wd.run(
        "ensure_agent assistente\nensure_agent assistente\n"
        # oltre il gradino 1 il tick successivo va saltato, non abbandonato
        "ensure_agent assistente\nensure_agent assistente\n"
        'printf "attempts=%s\\n" "$(wc -l < "$T_NODE_CALLS" | tr -d " ")" >> "$T_OUT"\n'
        'if spawn_backoff_active ASSISTENTE; then echo "backoff=on" >> "$T_OUT"; else echo "backoff=off" >> "$T_OUT"; fi\n'
        # ...e quando la finestra di backoff è passata si ritenta, sempre
        f"read -r c f l < {streak}\n"
        f'printf "%s %s %s\\n" "$c" "$((f - 7200))" "$((l - 7200))" > {streak}\n'
        'if spawn_backoff_active ASSISTENTE; then echo "backoff_after=on" >> "$T_OUT"; else echo "backoff_after=off" >> "$T_OUT"; fi\n'
        "ensure_agent assistente\n"
        'printf "attempts_after=%s\\n" "$(wc -l < "$T_NODE_CALLS" | tr -d " ")" >> "$T_OUT"',
        JHT_SPAWN_FAIL_ESCALATE_AFTER=2,
        JHT_SPAWN_FAIL_ESCALATE_MIN_SEC=0,
        JHT_SPAWN_FAIL_BACKOFF_TICKS=10,
        JHT_AGENT_WATCHDOG_INTERVAL=30,
    )

    assert result.returncode == 0, result.stderr
    probe = dict(line.split("=", 1) for line in wd.lines(wd.out) if "=" in line)
    assert probe["attempts"] == "2", "il backoff non ha diradato i tentativi"
    assert probe["backoff"] == "on"
    assert probe["backoff_after"] == "off", "il backoff non si è mai riaperto"
    assert probe["attempts_after"] == "3", "il respawn si è FERMATO invece di rallentare"


def test_the_source_has_no_cap_that_gives_up_on_an_agent(wd):
    """Il freno dei bridge (`STOPPING respawn`) non deve arrivare agli agenti."""
    source = _source()
    section = source[
        source.index("record_spawn_failure() {") : source.index("ensure_agent() {")
    ]
    for forbidden in ("STOPPING respawn", "bridge_flap_ok", "bridge_flap_record"):
        assert forbidden not in section, (
            f"'{forbidden}' nella misura degli agenti: la semantica dei bridge è "
            "opposta — lì il cap FERMA il respawn"
        )
    # E i due percorsi di spawn non consultano nessun cap.
    for name, end in (("ensure_agent", "session_age_h() {"),
                      ("respawn_worker", "maybe_ttl_refresh() {")):
        body = source[source.index(f"{name}() {{") : source.index(end)]
        assert "bridge_flap_ok" not in body, name


def test_the_streak_cannot_grow_while_the_team_is_stopped(wd):
    """I gate esistenti impediscono il tentativo, quindi anche la misura.

    Asserzione sul SORGENTE perché il ciclo è un `while true`: la garanzia è
    che gli unici due chiamanti della misura stiano dentro il ramo
    `config_ready`, dopo i `continue` di halt e standby.
    """
    source = _source()
    loop = source[source.index("while true; do") :]

    halt = loop.index('if [ -e "$TEAM_HALTED_FLAG" ]')
    halt_continue = loop.index("continue", halt)
    standby = loop.index("if standby_active; then", halt_continue)
    # Il ramo standby contiene un config_ready suo (i bridge restano
    # sorvegliati: in standby sono LORO la sveglia), quindi il gate degli
    # agenti va cercato dopo il `continue` dello standby.
    standby_continue = loop.index("continue", standby)
    ready = loop.index("if config_ready; then", standby_continue)
    cores = loop.index('for role in "${AGENTS[@]}"', ready)
    workers = loop.index("  maybe_respawn_workers\n", cores)
    assert halt < halt_continue < standby < standby_continue < ready < cores < workers, (
        "l'ordine dei gate è cambiato: lo streak potrebbe salire a team fermo"
    )

    # Gli unici chiamanti della misura sono i due percorsi di spawn, che a
    # loro volta girano solo dentro il ramo config_ready.
    callers = {
        m.group(1)
        for m in re.finditer(
            r"^([a-z_]+)\(\) \{|^  +observe_spawn_failure", source, re.M
        )
        if m.group(1)
    }
    assert "ensure_agent" in callers
    owners = []
    for match in re.finditer(r"observe_spawn_failure ", source):
        head = source[: match.start()]
        owners.append(re.findall(r"^([a-z_]+)\(\) \{", head, re.M)[-1])
    assert set(owners) == {"ensure_agent", "respawn_worker"}, owners

    # E l'escalation su config_ready=false persistente resta l'unica su quel
    # caso: non va duplicata da questa.
    assert "config NOT ready for" in loop
    assert loop.count("CONFIG_NOT_READY_GRACE_TICKS") >= 2


def test_the_new_functions_stay_before_the_test_harness_marker(wd):
    """Il prelude si estrae fino a `log \"watchdog start`: se una funzione
    finisce oltre quel marker, i test storici del watchdog smettono di vederla.
    """
    prelude = _prelude()
    for name in (
        "escalate_key",
        "escalate_once",
        "spawn_streak_state",
        "spawn_log_offset",
        "spawn_detail_since",
        "record_spawn_failure",
        "spawn_failure_breadth",
        "spawn_failure_escalate",
        "observe_spawn_failure",
        "spawn_backoff_active",
        "clear_spawn_failures",
    ):
        assert f"{name}() {{" in prelude, name


def test_every_new_threshold_is_env_overridable_with_an_inline_default(wd):
    source = _source()
    for var, default in (
        ("JHT_SPAWN_FAIL_ESCALATE_AFTER", "5"),
        ("JHT_SPAWN_FAIL_ESCALATE_MIN_SEC", "300"),
        ("JHT_SPAWN_FAIL_ALERT_AFTER", "8"),
        ("JHT_SPAWN_FAIL_ALERT_MIN_SEC", "1200"),
        ("JHT_SPAWN_FAIL_COOLDOWN_SEC", "3600"),
        ("JHT_SPAWN_FAIL_ALERT_COOLDOWN_SEC", "21600"),
        ("JHT_SPAWN_FAIL_BACKOFF_TICKS", "10"),
        ("JHT_SPAWN_FAIL_STREAK_TTL_SEC", "1800"),
    ):
        assert "${%s:-%s}" % (var, default) in source, var
    assert '"${JHT_NOTIFY_USER_BIN:-jht-notify-user}"' in source
    assert '"${JHT_AGENT_SPAWN_FAILURE_LOG:-' in source
    # Il canale utente non deve costare un turno LLM: e' il CLI Python.
    assert '"$NOTIFY_USER_BIN" --agent capitano --kind alert' in source


def test_the_register_is_a_file_of_its_own_not_a_column_of_the_recoveries(wd):
    source = _source()
    assert "agent-spawn-failures.tsv" in source
    assert "agent-recoveries.tsv" in source
    # record_recovery non deve scrivere nel registro dei fallimenti e
    # viceversa: recovery_today_count conta le righe per sessione senza
    # filtrare l'osservazione.
    recovery = source[
        source.index("record_recovery() {") : source.index("notify_captain_recovery() {")
    ]
    assert "SPAWN_FAILURE_LOG" not in recovery
    failure = source[
        source.index("record_spawn_failure() {") : source.index("spawn_failure_breadth() {")
    ]
    assert "RECOVERY_LOG" not in failure


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([os.path.abspath(__file__)]))
