"""The worker of the jht-media container (shared/media/media_worker.py): closed names and extensions, no shell, limits, one
error code and never the text of an error, and the answers of a request that left the inbox go away.

ffmpeg and tesseract are fakes on the PATH; nothing real is opened."""
from __future__ import annotations

import importlib.util
import os
import stat
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("media_worker", ROOT / "shared" / "media" / "media_worker.py")
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)

FAKE_FFMPEG = """#!/bin/sh
# the last argument is the output; -i names the input
echo "$@" >> "$FAKE/ffmpeg-calls"
[ -e "$FAKE/ffmpeg-fails" ] && { echo "secret text of an error" >&2; exit 1; }
[ -e "$FAKE/ffmpeg-hangs" ] && sleep 30
for last; do :; done
printf 'RIFF' > "$last"
"""
FAKE_TESSERACT = """#!/bin/sh
echo "$@" >> "$FAKE/tesseract-calls"
[ -e "$FAKE/tesseract-fails" ] && exit 1
[ -e "$FAKE/tesseract-long" ] && { head -c 400000 /dev/zero | tr '\\0' 'a'; exit 0; }
echo "text of the photo"
"""


@pytest.fixture()
def box(tmp_path, monkeypatch):
    inbox, outbox, fake = tmp_path / "in", tmp_path / "out", tmp_path / "fake"
    for folder in (inbox, outbox, fake):
        folder.mkdir()
    for name, text in (("ffmpeg", FAKE_FFMPEG), ("tesseract", FAKE_TESSERACT)):
        path = fake / name
        path.write_text(text, encoding="utf-8")
        path.chmod(path.stat().st_mode | stat.S_IXUSR)
    monkeypatch.setenv("PATH", f"{fake}:/usr/bin:/bin")
    monkeypatch.setenv("FAKE", str(fake))
    monkeypatch.setattr(worker, "INBOX", inbox)
    monkeypatch.setattr(worker, "OUTBOX", outbox)
    return type("Box", (), {"inbox": inbox, "outbox": outbox, "fake": fake})


def put(box, name: str, size: int = 10) -> Path:
    path = box.inbox / name
    path.write_bytes(b"x" * size)
    return path


def listing(box) -> list[str]:
    return sorted(entry.name for entry in box.outbox.iterdir())


def test_a_voice_note_becomes_a_wav_and_a_photo_becomes_text(box):
    put(box, "note.ogg")
    put(box, "cv.jpg")
    assert worker.sweep() == 2
    assert listing(box) == ["cv.jpg.txt", "note.ogg.wav"]
    assert (box.outbox / "cv.jpg.txt").read_text() == "text of the photo\n"
    calls = (box.fake / "ffmpeg-calls").read_text()
    assert "-nostdin" in calls and "-t 600" in calls and "-ar 16000" in calls


def test_an_answered_request_is_not_opened_again_but_a_rewritten_one_is(box):
    put(box, "a.mp3")
    assert worker.sweep() == 1 and worker.sweep() == 0
    later = time.time() + 5
    os.utime(box.inbox / "a.mp3", (later, later))
    assert worker.sweep() == 1


@pytest.mark.parametrize("name", [".hidden.ogg", "-rf.ogg", "a b.ogg", "a;b.ogg", "x" * 101 + ".ogg", "résumé.jpg"])
def test_a_name_outside_the_closed_shape_is_not_even_looked_at(box, name):
    put(box, name)
    assert worker.sweep() == 0 and listing(box) == []


def test_a_link_in_the_inbox_is_not_followed(box):
    target = box.fake / "secret.ogg"
    target.write_bytes(b"x")
    (box.inbox / "link.ogg").symlink_to(target)
    assert worker.sweep() == 0 and listing(box) == []


def test_an_extension_outside_the_lists_gets_unsupported(box):
    put(box, "script.sh")
    assert worker.sweep() == 1
    assert (box.outbox / "script.sh.err").read_text() == "unsupported\n"
    assert not (box.fake / "ffmpeg-calls").exists()


def test_a_file_over_the_size_cap_is_not_opened(box, monkeypatch):
    monkeypatch.setitem(worker.MAX_INPUT, "audio", 5)
    put(box, "big.ogg", size=6)
    worker.sweep()
    assert (box.outbox / "big.ogg.err").read_text() == "too_big\n"
    assert not (box.fake / "ffmpeg-calls").exists()


def test_a_failure_publishes_one_code_and_never_the_text_of_the_error(box):
    (box.fake / "ffmpeg-fails").write_text("")
    put(box, "bad.ogg")
    worker.sweep()
    assert (box.outbox / "bad.ogg.err").read_text() == "failed\n"
    assert listing(box) == ["bad.ogg.err"], "no half-written work file is left"
    (box.fake / "tesseract-fails").write_text("")
    put(box, "bad.png")
    worker.sweep()
    assert (box.outbox / "bad.png.err").read_text() == "failed\n"


def test_a_program_that_hangs_is_stopped(box, monkeypatch):
    monkeypatch.setitem(worker.TIMEOUT, "audio", 1)
    (box.fake / "ffmpeg-hangs").write_text("")
    put(box, "slow.ogg")
    started = time.time()
    worker.sweep()
    assert time.time() - started < 10
    assert (box.outbox / "slow.ogg.err").read_text() == "timeout\n" and listing(box) == ["slow.ogg.err"]


def test_the_text_is_capped(box):
    (box.fake / "tesseract-long").write_text("")
    put(box, "long.png")
    worker.sweep()
    assert (box.outbox / "long.png.txt").stat().st_size == worker.MAX_TEXT_BYTES


def test_the_answers_of_a_request_that_left_the_inbox_go_away(box):
    put(box, "a.ogg")
    put(box, "b.png")
    worker.sweep()
    (box.inbox / "a.ogg").unlink()
    worker.sweep()
    assert listing(box) == ["b.png.txt"]


def test_a_leftover_work_file_goes_when_it_is_old(box):
    old = box.outbox / ".x.ogg.wav.work"
    old.write_bytes(b"x")
    past = time.time() - 3600
    os.utime(old, (past, past))
    fresh = box.outbox / ".y.ogg.wav.work"
    fresh.write_bytes(b"x")
    worker.sweep()
    assert listing(box) == [".y.ogg.wav.work"]


def test_the_program_is_run_without_a_shell_and_with_no_stdin():
    source = (ROOT / "shared" / "media" / "media_worker.py").read_text(encoding="utf-8")
    assert "shell=True" not in source and "os.system" not in source and "stdin=subprocess.DEVNULL" in source
