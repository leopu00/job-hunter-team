"""Small reads of the direct chat on the per-command link (Windows to a VPS), against the real servers.

On that link every read is an ssh connection, and the page used to get the server's whole tail
(the last 128 KiB of chat.jsonl) at every read. The desktop now reads small, without changing the
server (direct_chat.rs, small_read): first the size (a cursor past the end), then the last 32 KiB;
after that from 20 KiB before the page's cursor, because the server drops the line a cursor lands
in, a cursor right at the start of a line included.

This runs that sequence against the two servers the app talks to, the image's agent_chat.py and
the older CHAT_READ_PY the desktop sends itself, and checks that:
- what the session shows is exactly what a whole read would show from where it started: no line
  lost, a line still being written comes back whole once it is done;
- every answer stays small, a 16 KB message included;
- a chat that got shorter is read again from its tail.
"""

from __future__ import annotations

import importlib.util
import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
DIRECT_CHAT = ROOT / "desktop" / "src-tauri" / "src" / "direct_chat.rs"
SOURCE = DIRECT_CHAT.read_text(encoding="utf-8")


def _constant(name: str) -> int:
    found = re.search(rf"const {name}: u64 = (\d+) \* 1024;", SOURCE)
    assert found, name
    return int(found.group(1)) * 1024


TAIL = _constant("SMALL_READ_TAIL")
OVERLAP = _constant("SMALL_READ_OVERLAP")
PROBE = re.search(r'const SMALL_READ_SIZE_PROBE: &str = "(\d+)";', SOURCE).group(1)
CHAT_READ_PY = re.search(r'const CHAT_READ_PY: &str = r#"(.*?)"#;', SOURCE, re.S).group(1)
AGENT = "assistente"


def _load_agent_chat():
    spec = importlib.util.spec_from_file_location("agent_chat_small_reads", ROOT / "shared" / "skills" / "agent_chat.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Server:
    """One of the two readers, over a chat.jsonl in a temporary home. Records every answer's size."""

    def __init__(self, kind: str, home: Path, monkeypatch):
        self.kind, self.home, self.sizes = kind, home, []
        self.path = home / "agents" / AGENT / "chat.jsonl"
        self.path.parent.mkdir(parents=True)
        self.path.write_bytes(b"")
        if kind == "agent_chat":
            monkeypatch.setenv("JHT_HOME", str(home))
            self.module = _load_agent_chat()

    def read(self, cursor: str | None) -> dict:
        if self.kind == "agent_chat":
            page = self.module.read(AGENT, cursor)
            raw = json.dumps(page, ensure_ascii=False)
        else:
            # Forward slashes: the path goes into the script's source, where a Windows "C:\Users"
            # would read as a \U escape and the script would not compile.
            script = CHAT_READ_PY.replace("/jht_home/", self.home.as_posix() + "/")
            # UTF-8 on both pipes, as on the VPS: on Windows they would be cp1252, and a message of 4000
            # emoji could not be printed. -X utf8, because -I ignores the PYTHON* variables.
            done = subprocess.run(
                [sys.executable, "-I", "-X", "utf8", "-c", script], input=json.dumps({"agent": AGENT, "cursor": cursor}) + "\n",
                capture_output=True, encoding="utf-8", timeout=30,
            )
            assert done.returncode == 0, done.stderr
            raw = done.stdout.strip()
            page = json.loads(raw)
        self.sizes.append(len(raw.encode("utf-8")))
        return page


def small_read(server: Server, cursor: str | None) -> dict:
    """direct_chat.rs small_read, step by step."""
    if cursor is not None and cursor.isdigit():
        sent = max(0, int(cursor) - OVERLAP)
        page = server.read(str(sent))
        if int(page["cursor"]) >= sent:
            return page
    size = int(server.read(PROBE)["cursor"])
    return server.read(str(max(0, size - TAIL)))


def _line(index: int, text: str) -> bytes:
    row = {"message_id": f"m{index}", "role": "agent" if index % 2 else "user", "text": text, "ts": float(index)}
    return (json.dumps(row, ensure_ascii=False) + "\n").encode("utf-8")


def _append(server: Server, data: bytes) -> None:
    with open(server.path, "ab") as handle:
        handle.write(data)


@pytest.fixture(params=["agent_chat", "chat_read_py"])
def server(request, tmp_path, monkeypatch):
    return Server(request.param, tmp_path, monkeypatch)


def test_the_constants_are_the_design():
    assert (TAIL, OVERLAP, PROBE) == (32 * 1024, 20 * 1024, "999999999999")


def test_a_session_of_small_reads_shows_every_line_from_where_it_started_and_stays_small(server):
    # more history than the server's own tail of 128 KiB: lines of every size, the largest a message of
    # 4000 characters of 4 bytes
    texts = [("x" * (200 + 37 * i)) for i in range(80)] + ["\U0001F600" * 4000] + ["fine riga " * 30]
    offsets, data = [], b""
    for index, text in enumerate(texts):
        offsets.append(len(data))
        data += _line(index, text)
    _append(server, data)
    size_at_start = len(data)
    assert size_at_start > 128 * 1024
    shown: dict[str, str] = {}

    def take(page):
        for message in page["messages"]:
            shown[message["id"]] = message["text"]
        return page["cursor"]

    cursor = take(small_read(server, None))
    # lines that end up exactly at a cursor, a line being written, then finished
    next_index = len(texts)
    for burst in range(6):
        new = b"".join(_line(next_index + k, f"nuovo {burst}-{k} " * (5 + 40 * k)) for k in range(3))
        next_index += 3
        _append(server, new)
        cursor = take(small_read(server, cursor))
    half = _line(next_index, "scritto a metà " * 50)
    _append(server, half[: len(half) // 2])
    cursor = take(small_read(server, cursor))
    _append(server, half[len(half) // 2 :])
    next_index += 1
    cursor = take(small_read(server, cursor))

    first = next(i for i, at in enumerate(offsets) if at >= size_at_start - TAIL)
    expected = {f"m{i}" for i in range(first + 1, next_index)}  # the line the tail lands in is dropped
    assert expected <= set(shown), sorted(expected - set(shown))
    assert set(shown) <= expected | {f"m{first}"}
    assert shown[f"m{next_index - 1}"] == ("scritto a metà " * 50).strip(), "the line written in two goes came back whole"
    # every answer small: the probe, the tail, and each later read with its overlap and a 16 KB line
    assert max(server.sizes) < 56 * 1024, server.sizes


def test_a_chat_that_got_shorter_is_read_again_from_its_tail(server):
    _append(server, b"".join(_line(i, "vecchio " * 200) for i in range(30)))
    cursor = small_read(server, None)["cursor"]
    server.path.write_bytes(b"".join(_line(100 + i, "nuovo " * 10) for i in range(3)))
    page = small_read(server, cursor)
    assert [m["id"] for m in page["messages"]] == ["m100", "m101", "m102"]
    assert int(page["cursor"]) == server.path.stat().st_size


def test_the_probe_reads_no_line_and_gives_the_size(server):
    _append(server, b"".join(_line(i, "riga " * 300) for i in range(20)))
    page = server.read(PROBE)
    assert page["messages"] == [] and int(page["cursor"]) == server.path.stat().st_size
    assert server.sizes[-1] < 100
