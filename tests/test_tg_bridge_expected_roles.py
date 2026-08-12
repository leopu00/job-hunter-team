"""O-58 — un bot NON configurato non deve far riavviare quelli che funzionano.

È l'innesco dell'incidente, e non la race: mancava il token del mentor, quel
bridge moriva FATAL in partenza, e il conteggio dei processi restava sotto la
soglia FISSA di tre. Il watchdog «riparava» chiamando `start-agent.sh
tg-bridge`, che uccideva e ricreava TUTTI E TRE — cioè anche assistente e
capitano, che stavano lavorando. Un componente rotto ne rompeva due sani, tre
volte ogni dieci minuti, e in una di quelle finestre un messaggio
dell'operatore è stato ricevuto e mai consegnato.

Due metà, verificate qui:
  • `process_health.py` deve dire QUALI ruoli mancano fra quelli ATTESI, e
    attesi sono solo quelli con un `bot_token`;
  • `agent-watchdog.sh` deve rispawnare quei ruoli e nessun altro.

La seconda metà esegue la funzione vera dello script (estratta e valutata in
bash con dei finti al posto di process_health e start-agent): non un grep del
sorgente, ma i comandi che il watchdog lancerebbe davvero.

Eseguire:
    pytest tests/test_tg_bridge_expected_roles.py -v
"""

import importlib.util
import json
import os
import re
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
WATCHDOG = REPO_ROOT / ".launcher" / "agent-watchdog.sh"


@pytest.fixture
def health(tmp_path, monkeypatch):
    """process_health.py importato con JHT_HOME su una config di prova."""
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    spec = importlib.util.spec_from_file_location(
        "process_health", REPO_ROOT / "shared" / "skills" / "process_health.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _config(tmp_path, **tokens):
    """jht.config.json con i bot indicati (valore = token, None = senza)."""
    bots = {}
    for role, token in tokens.items():
        bots[role] = {"chat_id": "1"} if token is None else {
            "bot_token": token, "chat_id": "1"
        }
    (tmp_path / "jht.config.json").write_text(
        json.dumps({"channels": {"telegram": {"bots": bots}}}), encoding="utf-8"
    )


def _scan_with(mod, cmdlines):
    """scan() con una lista di cmdline finta al posto di /proc."""
    mod._cmdlines = lambda: cmdlines
    return mod.scan()


def _running(*roles):
    """I cmdline che i bridge hanno davvero, wrapper compresa."""
    out = []
    for role in roles:
        out.append(f"python3 -u /app/.launcher/tg-bridge.py --role {role}")
        out.append(
            f"sh -c JHT_TG_BOT_ROLE='{role}' python3 -u "
            f"/app/.launcher/tg-bridge.py --role {role}"
        )
    return out


class TestExpectedRoles:
    def test_a_bot_without_a_token_is_not_expected(self, health, tmp_path):
        # Il caso dell'incidente: mentor senza token, gli altri due vivi.
        _config(tmp_path, assistente="A", capitano="B", mentor=None)
        res = _scan_with(health, _running("assistente", "capitano"))
        assert res["tg"]["missing_roles"] == [], (
            "il mentor non è un morto da rianimare: è un bot che non esiste"
        )
        assert res["tg"]["expected"] == 2

    def test_a_configured_bot_that_is_down_IS_reported(self, health, tmp_path):
        _config(tmp_path, assistente="A", capitano="B", mentor="C")
        res = _scan_with(health, _running("assistente", "mentor"))
        assert res["tg"]["missing_roles"] == ["capitano"]

    def test_it_says_which_one_not_how_many(self, health, tmp_path):
        # "2 su 3" non basta a rispawnare solo il mancante: serve il nome.
        _config(tmp_path, assistente="A", capitano="B", mentor="C")
        res = _scan_with(health, _running("capitano"))
        assert res["tg"]["missing_roles"] == ["assistente", "mentor"]
        assert res["tg"]["by_role"] == {
            "assistente": 0, "capitano": 2, "mentor": 0
        }

    def test_no_telegram_at_all_expects_nothing(self, health, tmp_path):
        _config(tmp_path)
        res = _scan_with(health, [])
        assert res["tg"]["missing_roles"] == []
        assert res["tg"]["expected"] == 0

    def test_the_shell_output_carries_the_names(self, health, tmp_path):
        _config(tmp_path, assistente="A", capitano="B", mentor="C")
        health._cmdlines = lambda: _running("assistente")
        out = subprocess.run(
            [sys.executable, str(REPO_ROOT / "shared/skills/process_health.py"),
             "summary", "--shell"],
            capture_output=True, text=True,
            env=dict(os.environ, JHT_HOME=str(tmp_path)),
        ).stdout
        # Su questa macchina /proc non c'è, quindi i conteggi sono zero: quello
        # che conta è che la riga esista e sia leggibile dal bash del watchdog.
        assert "PROC_TG_MISSING=" in out
        assert "PROC_TG_EXPECTED=" in out


# ── (E) il watchdog: chi rispawna, e chi NON tocca ──────────────────────
# In Python, non in shell: il watchdog lo invoca come `python3 <tool>`, e un
# finto in /bin/sh verrebbe passato all'interprete sbagliato — uscendo vuoto,
# cioè facendo sembrare "tutto a posto" qualunque cosa si stia testando.
FAKE_HEALTH = """#!/usr/bin/env python3
print(\"\"\"PROC_DEAD_BRIDGE_SUITE=''
PROC_DEAD_DEEP=''
PROC_TG_ALIVE=%(alive)s
PROC_TG_EXPECTED=%(expected)s
PROC_TG_MISSING='%(missing)s'
PROC_ALL_OK=1\"\"\")
"""

FAKE_START_AGENT = """#!/bin/sh
echo "$@" >> "$JHT_SPAWN_LOG"
"""


def _watchdog_function(name):
    """Estrae una funzione dallo script, per eseguirla senza il loop finale."""
    src = WATCHDOG.read_text(encoding="utf-8")
    match = re.search(rf"^{name}\(\) \{{.*?^\}}", src, re.S | re.M)
    assert match, f"funzione {name} non trovata in agent-watchdog.sh"
    return match.group(0)


def _run_respawn(tmp_path, *, alive, expected, missing):
    health = tmp_path / "health.sh"
    health.write_text(
        FAKE_HEALTH % {"alive": alive, "expected": expected, "missing": missing},
        encoding="utf-8",
    )
    health.chmod(0o755)
    start_agent = tmp_path / "start-agent.sh"
    start_agent.write_text(FAKE_START_AGENT, encoding="utf-8")
    start_agent.chmod(0o755)
    spawn_log = tmp_path / "spawned.txt"
    spawn_log.write_text("", encoding="utf-8")

    script = f"""
set -u
JHT_HOME="{tmp_path}"
LOG="{tmp_path}/watchdog.log"
BRIDGE_STATE_DIR="{tmp_path}"
BRIDGE_FLAP_WINDOW_SEC=600
BRIDGE_FLAP_CAP=3
PROCESS_HEALTH_TOOL="{health}"
START_AGENT="{start_agent}"
log() {{ echo "$*" >> "$LOG"; }}
tg_bots_configured() {{ return 0; }}
bridge_escalate() {{ echo "escalate: $*" >> "{tmp_path}/escalated.txt"; }}
{_watchdog_function("bridge_flap_ok")}
{_watchdog_function("bridge_flap_record")}
{_watchdog_function("maybe_respawn_bridges")}
maybe_respawn_bridges
"""
    subprocess.run(
        ["bash", "-c", script],
        env=dict(os.environ, JHT_SPAWN_LOG=str(spawn_log)),
        capture_output=True, text=True, check=False,
    )
    return [line for line in spawn_log.read_text().splitlines() if line.strip()]


class TestWatchdogRespawn:
    def test_a_missing_role_is_respawned_alone(self, tmp_path):
        spawned = _run_respawn(tmp_path, alive=2, expected=3, missing="mentor")
        assert spawned == ["tg-bridge mentor"], (
            "deve rispawnare SOLO il ruolo mancante: rifarli tutti uccide i due "
            "che stanno lavorando, ed è così che si è perso un messaggio"
        )

    def test_an_unconfigured_bot_triggers_nothing(self, tmp_path):
        # Due processi su tre, ma il terzo non è atteso → niente da riparare.
        spawned = _run_respawn(tmp_path, alive=2, expected=2, missing="")
        assert spawned == []

    def test_two_missing_roles_are_respawned_one_by_one(self, tmp_path):
        spawned = _run_respawn(
            tmp_path, alive=1, expected=3, missing="assistente mentor"
        )
        assert spawned == ["tg-bridge assistente", "tg-bridge mentor"]
        assert "tg-bridge" not in [s.strip() for s in spawned], (
            "nessuna chiamata senza ruolo: quella li rifà tutti e tre"
        )

    def test_the_flap_cap_is_per_role(self, tmp_path):
        # Un ruolo che continua a morire non deve consumare il credito degli
        # altri: se lo consumasse, il giorno che ne muore uno sano resterebbe
        # giù. Il cap è 3 per finestra.
        for _ in range(4):
            _run_respawn(tmp_path, alive=2, expected=3, missing="mentor")
        spawned = _run_respawn(tmp_path, alive=2, expected=3, missing="capitano")
        assert spawned == ["tg-bridge capitano"], (
            "il capitano deve poter rinascere anche se il mentor ha bruciato "
            "il suo cap"
        )
