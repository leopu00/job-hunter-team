"""The format characters removed from a text of third parties: one list, three copies that must not diverge.

The list is INVISIBLE_COMMANDS of shared/skills/external_content.py, and it says it is the only one of
the repo. Two other languages cannot import it, so they carry a copy:
- SQL: web_door.one_line of migration 101 (the summaries of the website's log, from 104 also the one of an
  application);
- TypeScript: INVISIBLE_COMMANDS of web/lib/feedback-reasons.ts (the note of an exclusion).

This test reads the character class of each copy from its source and compares it with the Python set,
character by character. The behaviour of the SQL copy in a real PostgreSQL is checked by
tests/test_web_action_position_summary_postgres.py; the log's screen (web-action-log.ts) has its own test
tied to the same Python list.

Counter-check: the same parser, on a copy with one character taken away or added, finds the difference.
"""

from __future__ import annotations

import importlib.util
import os
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
PYTHON_LIST = ROOT / "shared" / "skills" / "external_content.py"
SQL_COPY = ROOT / "supabase" / "migrations" / "101_web_action_exclusions_directives.sql"
TS_COPY = ROOT / "web" / "lib" / "feedback-reasons.ts"

BSL = chr(92)


def _python_list() -> frozenset[str]:
    os.environ.setdefault("JHT_EXTERNAL_CONTENT_NONCE", "0123abcd")
    spec = importlib.util.spec_from_file_location("external_content_copies", PYTHON_LIST)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return frozenset(module.INVISIBLE_COMMANDS)


def _class_members(body: str) -> frozenset[str]:
    """The characters of a regex character class body: literal characters, ranges, and the escapes
    BSL-u-XXXX, BSL-U-XXXXXXXX (SQL) and BSL-u-{X...} (JavaScript with the u flag)."""
    escape = re.compile(re.escape(BSL) + r"(?:u\{([0-9A-Fa-f]{1,6})\}|u([0-9A-Fa-f]{4})|U([0-9A-Fa-f]{8}))")
    atoms: list[str] = []
    i = 0
    while i < len(body):
        if body[i] == BSL:
            match = escape.match(body, i)
            if not match:
                raise AssertionError(f"an escape the parser does not know at {i}: {body[i:i + 12]!r}")
            atoms.append(chr(int(next(group for group in match.groups() if group), 16)))
            i = match.end()
        else:
            atoms.append(body[i])
            i += 1
    members: set[str] = set()
    j = 0
    while j < len(atoms):
        if j + 2 < len(atoms) and atoms[j + 1] == "-":
            members.update(chr(code) for code in range(ord(atoms[j]), ord(atoms[j + 2]) + 1))
            j += 3
        else:
            members.add(atoms[j])
            j += 1
    return frozenset(members)


def _sql_copy(source: str) -> frozenset[str]:
    function = source.split("FUNCTION web_door.one_line(", 1)[1].split("$$;", 1)[0]
    classes = re.findall(r"'\[([^\]']*)\]', '', 'g'", function)
    assert len(classes) == 1, "web_door.one_line removes the format characters with one class"
    return _class_members(classes[0])


def _ts_copy(source: str) -> frozenset[str]:
    found = re.findall(r"const INVISIBLE_COMMANDS = /\[([^\]]*)\]/gu;", source)
    assert len(found) == 1, "feedback-reasons.ts has its copy as one regex with the u flag"
    return _class_members(found[0])


def _names(chars) -> list[str]:
    return [f"U+{ord(c):04X}" for c in sorted(chars)]


@pytest.mark.parametrize(
    ("label", "read", "path"),
    [("SQL web_door.one_line", _sql_copy, SQL_COPY), ("TS feedback-reasons.ts", _ts_copy, TS_COPY)],
)
def test_each_copy_removes_exactly_the_python_list(label, read, path):
    python = _python_list()
    copy = read(path.read_text(encoding="utf-8"))
    assert copy == python, (f"{label} diverges from external_content.INVISIBLE_COMMANDS: "
                            f"missing {_names(python - copy)}, extra {_names(copy - python)}")


def test_the_letters_a_name_is_written_with_are_in_no_copy():
    writing = {chr(0x200C), chr(0x200D), chr(0x200E), chr(0x200F), chr(0x061C)}
    for read, path in ((_sql_copy, SQL_COPY), (_ts_copy, TS_COPY)):
        assert not writing & read(path.read_text(encoding="utf-8")), path.name
    assert not writing & _python_list()


@pytest.mark.parametrize(
    ("read", "path", "remove", "add"),
    [
        (_sql_copy, SQL_COPY, BSL + "u00AD", BSL + "u200B" + BSL + "u200C"),
        (_ts_copy, TS_COPY, chr(0x00AD), chr(0x200B) + chr(0x200C)),
    ],
)
def test_counter_check_one_character_changed_in_one_copy_is_seen(read, path, remove, add):
    source = path.read_text(encoding="utf-8")
    python = _python_list()
    assert remove in source, "the counter-check must change the copy for real"
    dropped = read(source.replace(remove, "", 1))
    assert dropped != python and python - dropped == {chr(0x00AD)}
    zero_width = BSL + "u200B" if path == SQL_COPY else chr(0x200B)
    widened = read(source.replace(zero_width, add, 1))
    assert widened != python and widened - python == {chr(0x200C)}
