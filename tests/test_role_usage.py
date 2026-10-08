"""Consumo per RUOLO sulle finestre del provider (solo misura).

token-by-agent-series.py attribuisce i token pesati di Codex, Claude e Kimi
all'agente; qui si verifica il passo dopo: raggruppamento per ruolo
(`analista-3` → analista, `critico-S2` → critico, sessioni senza agente →
unattributed), finestre 5h e settimana ricavate dal sample del bridge, il
file role-usage.json scritto dal sentinel-bridge e la riga ROLE-USAGE nel
tick della Sentinella. Tutti i JSONL sono sintetici.

Eseguire:
    pytest tests/test_role_usage.py -v
"""

import importlib.util
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SKILLS_DIR = os.path.join(REPO_ROOT, "shared", "skills")
BRIDGE = os.path.join(REPO_ROOT, ".launcher", "sentinel-bridge.py")
sys.path.insert(0, SKILLS_DIR)


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


series = _load("token_by_agent_series_roles",
               os.path.join(SKILLS_DIR, "token-by-agent-series.py"))
bridge = _load("sentinel_bridge_roles", BRIDGE)
import bridge_message  # noqa: E402

NOW = time.time()
HOUR = 3600.0
DAY = 86400.0


def _iso(ts):
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _write_jsonl(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")


@pytest.fixture
def home(tmp_path, monkeypatch):
    """Una JHT_HOME sintetica con una sessione per provider."""
    codex = tmp_path / ".codex" / "sessions"
    claude = tmp_path / ".claude" / "projects"
    kimi = tmp_path / ".kimi" / "sessions"
    monkeypatch.setattr(series, "CODEX_DIR", codex)
    monkeypatch.setattr(series, "CLAUDE_DIR", claude)
    monkeypatch.setattr(series, "KIMI_DIR", kimi)

    # Codex, scout-1: 1h fa fresh 800 + output 300 + reasoning 100 = 1200;
    # 2 giorni fa 1000 (solo settimana); 10 giorni fa 5000 (fuori da tutto).
    # Il primo token_count ha info=null e va saltato.
    def codex_count(ts, usage):
        return {"timestamp": _iso(ts), "type": "event_msg",
                "payload": {"type": "token_count",
                            "info": {"last_token_usage": usage}}}

    _write_jsonl(codex / "2026" / "10" / "08" / "rollout-a.jsonl", [
        {"timestamp": _iso(NOW - 10 * DAY), "type": "session_meta",
         "payload": {"cwd": "/jht_home/agents/scout-1"}},
        {"timestamp": _iso(NOW - 10 * DAY), "type": "event_msg",
         "payload": {"type": "token_count", "info": None}},
        codex_count(NOW - 10 * DAY, {"input_tokens": 5000}),
        codex_count(NOW - 2 * DAY, {"input_tokens": 1000}),
        codex_count(NOW - HOUR, {"input_tokens": 1000, "cached_input_tokens": 200,
                                 "output_tokens": 300, "reasoning_output_tokens": 100}),
    ])

    # Claude, capitano: 1h fa 500 + 500 (la cache pesa 0) = 1000.
    # Claude, critico-S2: 3 giorni fa 2000 (solo settimana).
    _write_jsonl(claude / "-jht-home-agents-capitano" / "s1.jsonl", [
        {"timestamp": _iso(NOW - HOUR), "type": "assistant",
         "message": {"usage": {"input_tokens": 500, "output_tokens": 500,
                               "cache_read_input_tokens": 9000}}},
    ])
    _write_jsonl(claude / "-jht-home-agents-critico-S2" / "s2.jsonl", [
        {"timestamp": _iso(NOW - 3 * DAY), "type": "assistant",
         "message": {"usage": {"input_tokens": 1500, "output_tokens": 500}}},
    ])

    # Kimi, analista-2 (dal titolo): 1h fa 300 + 200 = 500.
    # Kimi, sessione senza agente riconoscibile: 1h fa 500 → unattributed.
    s1 = kimi / "h1" / "s1"
    s1.mkdir(parents=True)
    (s1 / "state.json").write_text(json.dumps(
        {"custom_title": "[@capitano -> @analista-2] analizza"}), encoding="utf-8")
    _write_jsonl(s1 / "wire.jsonl", [
        {"timestamp": NOW - HOUR, "message": {"payload": {
            "token_usage": {"input_other": 300, "output": 200}}}},
    ])
    _write_jsonl(kimi / "h2" / "s2" / "wire.jsonl", [
        {"timestamp": NOW - HOUR, "message": {"payload": {
            "token_usage": {"input_other": 400, "output": 100}}}},
    ])
    return tmp_path


# 5h: reset fra 1h → finestra dalle -4h. Settimana: reset fra 3gg → dai -4gg.
SAMPLE = {"provider": "openai", "reset_at_unix": NOW + HOUR,
          "weekly_reset_at_unix": NOW + 3 * DAY}


@pytest.mark.parametrize("agent, role", [
    ("scout-1", "scout"), ("analista-3", "analista"), ("critico-S2", "critico"),
    ("critico-s12", "critico"), ("capitano", "capitano"), ("closer-1", "closer"),
    ("?unknown", None), ("resume", None), (None, None),
])
def test_agent_role(agent, role):
    assert series.agent_role(agent) == role


def test_provider_windows_from_bridge_sample():
    w = series.provider_windows(SAMPLE, NOW)
    assert w["5h"] == pytest.approx(NOW - 4 * HOUR)
    assert w["week"] == pytest.approx(NOW - 4 * DAY)
    # Kimi: la «settimana» coincide col reset 5h → nessuna finestra settimana.
    assert set(series.provider_windows(
        {"reset_at_unix": NOW + HOUR, "weekly_reset_at_unix": NOW + HOUR}, NOW)) == {"5h"}
    # Inizio nel futuro o reset assente: nessuna finestra inventata.
    assert series.provider_windows({"reset_at_unix": NOW + 6 * HOUR}, NOW) == {}
    assert series.provider_windows({}, NOW) == {}
    assert series.provider_windows(None, NOW) == {}


def test_role_usage_splits_three_providers_by_role_and_window(home):
    data = series.role_usage(series.provider_windows(SAMPLE, NOW), NOW, provider="openai")
    five, week = data["windows"]["5h"], data["windows"]["week"]

    # 5h: scout 1200, capitano 1000, analista 500, unattributed 500 = 3200.
    assert five["total_kt"] == 3.2
    assert five["unattributed_kt"] == 0.5
    assert {r: v["kt"] for r, v in five["roles"].items()} == {
        "scout": 1.2, "capitano": 1.0, "analista": 0.5}
    assert list(five["roles"]) == ["scout", "capitano", "analista"]
    assert five["roles"]["scout"]["share_pct"] == 37.5
    assert five["roles"]["analista"]["agents"] == ["analista-2"]

    # Settimana: + scout 1000 (2gg fa), + critico 2000 (3gg fa) = 6200;
    # i 5000 di 10 giorni fa restano fuori.
    assert week["total_kt"] == 6.2
    assert {r: v["kt"] for r, v in week["roles"].items()} == {
        "scout": 2.2, "critico": 2.0, "capitano": 1.0, "analista": 0.5}
    assert week["roles"]["critico"]["agents"] == ["critico-s2"]
    assert week["roles"]["scout"]["events"] == 2
    shares = sum(v["share_pct"] for v in week["roles"].values()) + week["unattributed_pct"]
    assert shares == pytest.approx(100.0, abs=0.2)


def test_bridge_writes_role_usage_and_the_tick_carries_it(home, tmp_path, monkeypatch):
    out = tmp_path / "logs" / "role-usage.json"
    out.parent.mkdir()
    monkeypatch.setattr(bridge, "ROLE_USAGE_FILE", out)
    monkeypatch.setattr(bridge, "_TBA_MOD", series)

    written = bridge._write_role_usage(SAMPLE, NOW)
    assert written is not None
    on_disk = json.loads(out.read_text(encoding="utf-8"))
    assert on_disk["provider"] == "openai"
    assert on_disk["windows"]["5h"]["roles"]["scout"]["kt"] == 1.2

    windows = bridge._read_role_usage(NOW)["windows"]
    lines = bridge_message.role_usage_lines(windows)
    assert lines[0] == ("ROLE-USAGE[5h] scout=37.5% capitano=31.2% "
                        "analista=15.6% unattributed=15.6% (3.2 kT)")
    assert lines[1].startswith("ROLE-USAGE[week] scout=35.5% critico=32.3%")

    tick = bridge_message.render({"ts_now": "12:00", "provider": "openai",
                                  "work_phase": "ON", "fivehh": {"usage": 40},
                                  "extras": {"role_usage": windows}})
    assert "ROLE-USAGE[5h] scout=37.5%" in tick
    assert "ROLE-USAGE[week]" in tick

    # Un file vecchio non entra nel tick: meglio niente che un numero stantio.
    assert bridge._read_role_usage(NOW + bridge.ROLE_USAGE_MAX_AGE_SEC + 60) is None


def test_role_usage_never_breaks_the_bridge(tmp_path, monkeypatch):
    monkeypatch.setattr(bridge, "ROLE_USAGE_FILE", tmp_path / "missing" / "role-usage.json")
    monkeypatch.setattr(bridge, "_TBA_MOD", series)
    assert bridge._write_role_usage(SAMPLE, NOW) is None


def test_tick_without_role_usage_has_no_role_line():
    tick = bridge_message.render({"ts_now": "12:00", "provider": "openai",
                                  "work_phase": "ON", "fivehh": {"usage": 40}})
    assert "ROLE-USAGE" not in tick
    assert bridge_message.role_usage_lines({"5h": {"total_kt": 0, "roles": {}}}) == []


_WRITER = r"""
import importlib.util, json, os, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location("bridge_writer", sys.argv[1])
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)
target, who = Path(sys.argv[2]), sys.argv[3]
payload = {"writer": who, "windows": {"5h": {"roles": {f"r{i}": {"kt": i} for i in range(4000)}}}}
for n in range(int(sys.argv[4])):
    payload["n"] = n
    bridge._atomic_write_json(target, payload)
"""


def test_two_bridges_writing_together_never_leave_a_broken_file(tmp_path):
    """Con più sentinel-bridge vivi (visto su ashley: 3 insieme), chi legge
    role-usage.json deve trovare sempre un JSON intero, e nessun temporaneo
    deve restare indietro."""
    target = tmp_path / "role-usage.json"
    env = dict(os.environ, JHT_HOME=str(tmp_path / "home"))
    writers = [subprocess.Popen([sys.executable, "-c", _WRITER, BRIDGE, str(target), who, "150"],
                                env=env) for who in ("a", "b")]
    reads = broken = 0
    while any(w.poll() is None for w in writers):
        try:
            raw = target.read_text(encoding="utf-8")
        except FileNotFoundError:
            continue
        reads += 1
        try:
            assert json.loads(raw)["writer"] in ("a", "b")
        except ValueError:
            broken += 1
    assert [w.wait() for w in writers] == [0, 0]
    assert reads > 0
    assert broken == 0, f"{broken} of {reads} reads saw a broken file"
    assert json.loads(target.read_text(encoding="utf-8"))["n"] == 149
    assert [p.name for p in tmp_path.iterdir() if p.name.endswith(".tmp")] == []
