"""token-meter: i file di sessione scritti prima della finestra non si aprono.

I jsonl di Claude Code e i rollout di Codex crescono solo in coda, quindi un file
con mtime prima dell'inizio della finestra non ha eventi della finestra. Prima
il meter li apriva e decodificava tutti a ogni tick. Tutti i file qui sono
inventati.
"""

from datetime import datetime, timedelta, timezone
from pathlib import Path
import importlib.util
import json
import os

import pytest


ROOT = Path(__file__).resolve().parents[1]
NOW = datetime.now(timezone.utc)
WINDOW_START = (NOW - timedelta(hours=5)).timestamp()


def _load():
    spec = importlib.util.spec_from_file_location(
        "token_meter_skip_test", ROOT / "shared" / "skills" / "token-meter.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _stamp(hours_ago: float) -> str:
    return (NOW - timedelta(hours=hours_ago)).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def _write(path: Path, events: list[dict], mtime_hours_ago: float) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(e) + "\n" for e in events), encoding="utf-8")
    t = (NOW - timedelta(hours=mtime_hours_ago)).timestamp()
    os.utime(path, (t, t))
    return path


def _claude(hours_ago: float, inp: int, out: int) -> dict:
    return {
        "timestamp": _stamp(hours_ago),
        "message": {"usage": {
            "input_tokens": inp, "output_tokens": out,
            "cache_creation_input_tokens": 3, "cache_read_input_tokens": 7,
        }},
    }


def _codex(hours_ago: float, total: int) -> dict:
    return {
        "timestamp": _stamp(hours_ago),
        "payload": {"type": "token_count", "info": {"last_token_usage": {
            "input_tokens": total - 10, "output_tokens": 10, "cached_input_tokens": 4,
            "reasoning_output_tokens": 2, "total_tokens": total,
        }}},
    }


@pytest.fixture
def meter(tmp_path: Path, monkeypatch):
    m = _load()
    claude = tmp_path / ".claude" / "projects"
    codex = tmp_path / ".codex" / "sessions"
    monkeypatch.setattr(m, "CLAUDE_PROJECTS", claude)
    monkeypatch.setattr(m, "CODEX_SESSIONS", codex)

    old_claude = _write(claude / "p1" / "vecchia.jsonl", [_claude(9, 1000, 1000)], 8)
    new_claude = _write(
        claude / "p2" / "attiva.jsonl",
        [_claude(7, 500, 500), _claude(2, 10, 20), _claude(1, 30, 40)],
        0.1,
    )
    old_codex = _write(codex / "2026" / "11" / "01" / "rollout-vecchio.jsonl", [_codex(30, 9000)], 29)
    new_codex = _write(
        codex / "2026" / "11" / "23" / "rollout-attivo.jsonl",
        [_codex(6, 800), _codex(3, 100), _codex(0.5, 250)],
        0.2,
    )

    opened: list[Path] = []
    real_open = Path.open

    def spy(self, *args, **kwargs):
        opened.append(Path(self))
        return real_open(self, *args, **kwargs)

    monkeypatch.setattr(Path, "open", spy)
    return m, opened, {"old": [old_claude, old_codex], "new": [new_claude, new_codex]}


def test_old_files_are_not_opened_and_files_in_the_window_are(meter) -> None:
    m, opened, files = meter
    m.read_claude_tokens(WINDOW_START)
    m.read_codex_tokens(WINDOW_START)
    for path in files["old"]:
        assert path not in opened
    for path in files["new"]:
        assert path in opened


def test_totals_are_the_same_as_reading_every_file(meter, monkeypatch) -> None:
    m, _opened, _files = meter
    claude_now = m.read_claude_tokens(WINDOW_START)
    codex_now = m.read_codex_tokens(WINDOW_START)

    # Il comportamento di prima: ogni file aperto, filtro solo sui timestamp.
    monkeypatch.setattr(m, "_touched_since", lambda _path, _ts: True)
    assert m.read_claude_tokens(WINDOW_START) == claude_now
    assert m.read_codex_tokens(WINDOW_START) == codex_now

    totals, by_session = claude_now
    assert totals["input_tokens"] == 40 and totals["output_tokens"] == 60
    assert totals["events"] == 2 and by_session == {"attiva": 100}
    totals, by_session = codex_now
    assert totals["total_tokens"] == 350 and totals["events"] == 2
    assert by_session == {"rollout-attivo": 350}


def test_a_file_that_cannot_be_read_is_skipped(meter, monkeypatch) -> None:
    m, _opened, files = meter
    assert m._touched_since(files["new"][0].parent / "sparito.jsonl", WINDOW_START) is False
