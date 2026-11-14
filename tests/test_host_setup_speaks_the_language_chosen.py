"""The host preflight speaks the language the person chose, in all 7.

A person chose «3) Magyar» and the next screen, «Setup host (preflight)», was in English: host-setup.sh had its texts
only in Italian and English. Its texts are now a block made from shared/locales (tests/host_setup_texts.py), written in
the script because the script runs on the host, where the catalogs are not, and reads no file the container can write.
"""

from __future__ import annotations

import os
import re
import select
import subprocess
import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from host_setup_texts import HOST_SETUP, LANGUAGES, TEXTS, catalog, shell_quote  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
ANSI = re.compile(r"\x1b\[[0-9;]*m")
PLACEHOLDER = re.compile(r"%[sd]")
# a call of ts/tsf with its English and its values: what it says comes from the table
TS_CALL = re.compile(r"\$\(tsf? [a-z_.0-9]+ '(?:[^'\\]|'\\'')*'[^)]*\)")


def test_the_block_in_the_script_is_the_one_made_from_the_catalogs():
    assert TEXTS.written_block() == TEXTS.block(), "run: python3 tests/host_setup_texts.py --write"


@pytest.mark.parametrize("lang", LANGUAGES)
def test_every_sentence_of_the_script_is_in_the_catalog_of_each_language(lang):
    assert TEXTS.problems(lang) == []


def test_no_sentence_after_the_picker_is_written_in_one_language_only():
    source = HOST_SETUP.read_text(encoding="utf-8")
    after = source[source.index('ok "Language / Lingua'):]
    after = after.split("\n", 1)[1]
    for number, line in enumerate(after.splitlines(), 1):
        if re.match(r"\s*(ok|warn|info|fail)\s+\"", line) or re.match(r"\s*printf\s+\"", line):
            words = TS_CALL.sub("", line.split(None, 1)[1])
            words = re.sub(r"\$\{?[A-Za-z_]+\}?|%[sdb]|\\n|\[Y/n\]|\"|'", "", words)
            # what is left is a separator, a colour or the name of a file, never a sentence
            assert not re.search(r"[A-Za-z]{3,} [A-Za-z]{3,}", words), (number, line)


def _functions() -> str:
    source = HOST_SETUP.read_text(encoding="utf-8")
    start = source.index(TEXTS.begin)
    end = source.index("\n}\n", source.index("tsf() {")) + 3
    return source[start:end]


@pytest.mark.parametrize("lang", LANGUAGES)
def test_the_sentences_with_values_put_them_in_every_language(lang, tmp_path):
    calls = {key: english for key, english in TEXTS.calls().items() if PLACEHOLDER.search(english)}
    lines = [_functions(), f"JHT_LANG={lang}"]
    for key, english in calls.items():
        args = " ".join("ZZVALUE" if p == "%s" else "4242" for p in PLACEHOLDER.findall(english))
        lines.append(f"printf '%s\\n' \"$(tsf {key} {shell_quote(english)} {args})\"")
    result = subprocess.run(["bash", "-c", "\n".join(lines)], capture_output=True, text=True, timeout=30)
    assert result.returncode == 0 and not result.stderr, result.stderr
    said = result.stdout.splitlines()
    assert len(said) == len(calls)
    for line, (key, english) in zip(said, calls.items()):
        assert line.count("ZZVALUE") == english.count("%s") and line.count("4242") == english.count("%d"), (key, line)


def _run_in_a_terminal(home: Path, lang: str) -> str:
    pty = pytest.importorskip("pty")
    env = {k: v for k, v in os.environ.items() if k not in {"LANG", "LC_ALL", "LC_MESSAGES", "JHT_LANG", "DISPLAY", "WAYLAND_DISPLAY"}}
    env.update({"HOME": str(home), "PATH": "/usr/bin:/bin", "LANG": "C", "TERM": "dumb"})
    pid, fd = pty.fork()
    if pid == 0:  # the child: the script at a terminal, as a person runs it
        os.execve("/bin/bash", ["bash", str(HOST_SETUP)], env)
    out = b""
    # the picker: the number of the language, as the person types it; «Where are you running JHT?»: 1, the local PC (no swap
    # is ever touched); the timezone: its default
    answers = [f"{LANGUAGES.index(lang) + 1}\n".encode(), b"1\n", b"\n"]
    deadline = time.time() + 60
    while time.time() < deadline:
        ready, _, _ = select.select([fd], [], [], 1)
        if not ready:
            continue
        try:
            chunk = os.read(fd, 4096)
        except OSError:  # the child closed the terminal
            break
        if not chunk:
            break
        out += chunk
        if out.endswith(b": ") and answers:
            os.write(fd, answers.pop(0))
    _, status = os.waitpid(pid, 0)
    text = ANSI.sub("", out.decode("utf-8", "replace"))
    assert os.waitstatus_to_exitcode(status) == 0, text
    return text


SCREEN = (
    "host_setup.section_header",
    "host_setup.detected",
    "host_setup.where_running",
    "host_setup.option.local.title",
    "host_setup.option.local.line1",
    "host_setup.option.local.line2",
    "host_setup.option.vps.title",
    "host_setup.option.vps.line1",
    "host_setup.option.vps.line2",
    "host_setup.choice",
    "host_setup.timezone_header",
    "host_setup.timezone_explain",
    "host_setup.swap_not_needed",
)


@pytest.mark.skipif(sys.platform == "win32", reason="the host preflight runs on Linux and macOS")
@pytest.mark.parametrize("lang", LANGUAGES)
def test_the_preflight_screen_is_in_the_language_chosen(tmp_path, lang):
    out = _run_in_a_terminal(tmp_path, lang)
    catalog = catalog(lang)
    english = catalog("en")
    for key in SCREEN:
        assert catalog[key] in out, (lang, key, out)
        if lang != "en" and english[key] != catalog[key]:
            assert english[key] not in out, (lang, key, out)
