"""A wake rereads the last notes of the diary within a size, not the whole day, however long the day was."""

from __future__ import annotations

import importlib.util
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "shared" / "skills" / "captain_diary.py"
spec = importlib.util.spec_from_file_location("captain_diary", SCRIPT)
diary = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diary)

TODAY = "2026-10-27"


@pytest.fixture()
def logs(tmp_path: Path, monkeypatch) -> Path:
    monkeypatch.setattr(diary, "DIARY_DIR", tmp_path)
    monkeypatch.setattr(diary, "_now_local", lambda: datetime(2026, 10, 27, 12, 0, tzinfo=timezone.utc))
    return tmp_path


def _day(logs: Path, day: str, count: int, width: int = 60) -> list[str]:
    notes = [f"- **{i // 60:02d}:{i % 60:02d}** — note {i:04d} " + "x" * width for i in range(count)]
    (logs / f"captain-diary-{day}.md").write_text(f"# 🧭 Captain diary — {day}\n\n" + "\n".join(notes) + "\n", encoding="utf-8")
    return notes


def _handoff(capsys) -> str:
    assert diary.handoff() == 0
    return capsys.readouterr().out


def test_a_short_diary_is_printed_whole_as_before(logs: Path, capsys):
    _day(logs, "2026-10-26", 5)
    _day(logs, TODAY, 3)
    out = _handoff(capsys)
    assert "# 🧭 Captain diary — 2026-10-26" in out and "note 0000" in out and "note 0004" in out
    assert "older notes not shown" not in out and "note 0002" in out


def test_a_long_day_gives_the_last_notes_and_says_how_many_it_left_out(logs: Path, capsys):
    notes = _day(logs, "2026-10-26", 400)
    out = _handoff(capsys)
    assert f"({400 - diary.HANDOFF_NOTES} older notes not shown)" in out
    assert notes[-1] in out and notes[-diary.HANDOFF_NOTES] in out and notes[-diary.HANDOFF_NOTES - 1] not in out
    assert "note 0000" not in out


def test_the_bytes_bound_cuts_before_the_notes_bound_when_the_notes_are_long(logs: Path, capsys):
    notes = _day(logs, "2026-10-26", 100, width=700)  # ~750 bytes each: 30 of them are over 8 KiB
    out = _handoff(capsys)
    shown = [n for n in notes if n in out]
    assert 1 <= len(shown) < diary.HANDOFF_NOTES and shown[-1] == notes[-1]
    assert len("\n".join(shown).encode("utf-8")) <= diary.HANDOFF_BYTES
    assert f"({100 - len(shown)} older notes not shown)" in out


def test_today_is_bounded_the_same_way_and_the_two_days_stay_apart(logs: Path, capsys):
    _day(logs, "2026-10-26", 4)
    today = _day(logs, TODAY, 200)
    out = _handoff(capsys)
    yesterday_part, _, todays_part = out.partition("Already recorded TODAY")
    assert "older notes not shown" not in yesterday_part
    assert f"({200 - diary.HANDOFF_NOTES} older notes not shown)" in todays_part and today[-1] in todays_part


def test_one_note_larger_than_the_whole_bound_is_cut_not_dropped(logs: Path, capsys):
    (logs / "captain-diary-2026-10-26.md").write_text("- **10:00** — " + "é" * 20000 + "\n", encoding="utf-8")
    out = _handoff(capsys)
    assert out.count("é") * 2 <= diary.HANDOFF_BYTES and "…" in out


def test_the_command_line_does_the_same(logs: Path, capsys, monkeypatch):
    _day(logs, "2026-10-26", 300)
    assert diary.main(["handoff"]) == 0
    assert "older notes not shown" in capsys.readouterr().out
    assert diary.main(["today"]) == 0
    assert "No notes today yet" in capsys.readouterr().out


@pytest.mark.parametrize("suffix, marker", [
    ("", "last 30 notes"), (".it", "ultime 30 note"), (".es", "últimas 30 notas"), (".fr", "30 dernières notes"),
    (".de", "letzten 30 Notizen"), (".hu", "utolsó 30 jegyzetet"), (".pt", "últimas 30 notas"),
])
def test_the_skill_says_the_wake_reads_only_the_last_notes_in_the_seven_languages(suffix: str, marker: str):
    text = (SCRIPT.parents[2] / "agents" / "_skills" / "captain-diary" / f"SKILL{suffix}.md").read_text(encoding="utf-8")
    assert marker in text and ("8 KiB" in text or "8 Kio" in text)
    # it is said in the part about the wake, before the notes of the day are explained
    assert text.index(marker) < text.index("captain_diary.py add")
