#!/usr/bin/env python3
"""The worker of the `jht-media` container: voice notes to WAV (ffmpeg) and photos to text (tesseract).

It runs alone, with no network, a read-only root, no capability, and two volumes with opposite modes: the INBOX is
mounted read-only (`jht` writes the files to open there), the OUTBOX is the only place it writes (`jht` reads it
read-only). It opens files nobody has vetted, so everything here is small and closed:

  * a request is a plain file in the inbox whose name is `[A-Za-z0-9][A-Za-z0-9._-]{0,99}` (never a link, never hidden)
    with an extension of the closed lists below; nothing else is looked at;
  * the programs are run without a shell, with a time limit, no stdin, and the size of the input and of the output capped;
  * the answer is a file in the outbox named `<request>.wav` / `<request>.txt` (written whole, then renamed), or
    `<request>.err` holding ONE code from a closed list (`unsupported`, `too_big`, `timeout`, `failed`), never the
    text of an error: what comes out of a hostile file is data, not an instruction;
  * when the request leaves the inbox, its answers go from the outbox.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
import time
from pathlib import Path

INBOX = Path(os.environ.get("JHT_MEDIA_IN", "/jht_media/in"))
OUTBOX = Path(os.environ.get("JHT_MEDIA_OUT", "/jht_media/out"))
POLL_SECONDS = float(os.environ.get("JHT_MEDIA_POLL", "1"))

NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")
AUDIO = {".ogg", ".oga", ".opus", ".mp3", ".m4a", ".aac", ".wav", ".flac", ".webm", ".amr"}
IMAGE = {".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".bmp", ".gif"}
MAX_INPUT = {"audio": 50 * 1024 * 1024, "image": 20 * 1024 * 1024}
MAX_AUDIO_SECONDS = 600
MAX_TEXT_BYTES = 200 * 1024
TIMEOUT = {"audio": 180, "image": 120}
ERRORS = ("unsupported", "too_big", "timeout", "failed")
RESULT_SUFFIXES = (".wav", ".txt", ".err")


def kind_of(name: str) -> str | None:
    suffix = Path(name).suffix.lower()
    return "audio" if suffix in AUDIO else "image" if suffix in IMAGE else None


def _publish(target: Path, data: bytes) -> None:
    temp = target.with_name(f".{target.name}.tmp")
    temp.write_bytes(data)
    os.replace(temp, target)


def _fail(name: str, code: str) -> None:
    assert code in ERRORS
    _publish(OUTBOX / f"{name}.err", f"{code}\n".encode())


def _run(command: list[str], timeout: int) -> subprocess.CompletedProcess:
    return subprocess.run(command, stdin=subprocess.DEVNULL, capture_output=True, timeout=timeout, check=False)


def process(name: str) -> str:
    """One request; the code of what was published: `wav`, `txt` or the error code."""
    source = INBOX / name
    kind = kind_of(name)
    if kind is None:
        _fail(name, "unsupported")
        return "unsupported"
    if source.stat().st_size > MAX_INPUT[kind]:
        _fail(name, "too_big")
        return "too_big"
    try:
        if kind == "audio":
            temp = OUTBOX / f".{name}.wav.work"
            done = _run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-protocol_whitelist", "file,pipe", "-i", str(source), "-t", str(MAX_AUDIO_SECONDS),
                         "-vn", "-ac", "1", "-ar", "16000", "-f", "wav", str(temp)], TIMEOUT[kind])
            if done.returncode != 0 or not temp.is_file():
                temp.unlink(missing_ok=True)
                _fail(name, "failed")
                return "failed"
            os.replace(temp, OUTBOX / f"{name}.wav")
            return "wav"
        done = _run(["tesseract", str(source), "stdout", "-l", os.environ.get("JHT_MEDIA_OCR_LANGS", "eng")], TIMEOUT[kind])
        if done.returncode != 0:
            _fail(name, "failed")
            return "failed"
        _publish(OUTBOX / f"{name}.txt", done.stdout[:MAX_TEXT_BYTES])
        return "txt"
    except subprocess.TimeoutExpired:
        (OUTBOX / f".{name}.wav.work").unlink(missing_ok=True)
        _fail(name, "timeout")
        return "timeout"
    except OSError:
        _fail(name, "failed")
        return "failed"


def requests() -> list[str]:
    """The names in the inbox worth opening: plain files, not links, with a name of the closed shape."""
    names = []
    for entry in sorted(INBOX.iterdir()):
        if NAME_RE.fullmatch(entry.name) and entry.is_file() and not entry.is_symlink():
            names.append(entry.name)
    return names


def answered(name: str) -> bool:
    """An answer at least as new as the request (a request written again under the same name is asked again)."""
    asked = (INBOX / name).stat().st_mtime
    return any((OUTBOX / f"{name}{suffix}").exists() and (OUTBOX / f"{name}{suffix}").stat().st_mtime >= asked for suffix in RESULT_SUFFIXES)


def sweep() -> int:
    """One pass: answer the new requests, drop the answers of the vanished ones. Returns how many were processed."""
    present = set(requests())
    count = 0
    for name in sorted(present):
        if not answered(name):
            process(name)
            count += 1
    for entry in OUTBOX.iterdir():
        stem, dot, suffix = entry.name.rpartition(".")
        if dot and f".{suffix}" in RESULT_SUFFIXES and stem not in present and entry.is_file():
            entry.unlink(missing_ok=True)
        elif entry.name.startswith(".") and entry.name.endswith((".tmp", ".work")) and time.time() - entry.stat().st_mtime > 600:
            entry.unlink(missing_ok=True)  # what a killed worker left behind
    return count


def main() -> int:
    for folder in (INBOX, OUTBOX):
        if not folder.is_dir():
            print(f"jht-media: {folder} is not a folder", file=sys.stderr)
            return 1
    while True:
        try:
            sweep()
        except OSError as exc:  # a folder that went away: say so and keep serving
            print(f"jht-media: {exc.__class__.__name__}", file=sys.stderr)
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    raise SystemExit(main())
