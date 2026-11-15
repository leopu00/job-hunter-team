"""The texts of scripts/jht-wrapper.ps1 in the 7 languages, from shared/locales (keys wrapper.*), the twin of tests/wrapper_texts.py.

The wrapper runs on the host, where the catalogs are not, and reads no file the container can write: its texts are written
inside it, as data, in a block between two marker lines, made from the catalogs (the catalogs are the source). Change a text in
the catalogs, then

    python3 tests/wrapper_ps_texts.py --write

and the block in the wrapper is made again. tests/test_wrapper_ps1_speaks_the_language_chosen.py fails when the two differ.

The wrapper says a text with `(Get-JhtText '<key>')`, or `(Format-JhtText '<key>' value...)` when the text has %s/%d: they are put
in IN ORDER, one catalog serves the bash wrapper and this one, and a { in a translation breaks nothing. The key is the catalog's
without the prefix `wrapper.`. A key said through a variable is named in a comment the generator reads:
`# texts said through a variable: key1 key2`.

The block is one function, `Get-JhtTextTable <lang> <key>`, a `switch -CaseSensitive` on "<lang>:<key>". Every text is a PowerShell
expression of ASCII only: runs of printable ASCII between single quotes ('' for an apostrophe) and every other character as
[char]0x....: Windows PowerShell 5.1 reads a .ps1 without a byte order mark as ANSI, so the file stays ASCII and needs no BOM. A text of
more than one line (a help) is its lines joined with [char]10.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from script_texts import LANGUAGES, PLACEHOLDER, ROOT, catalog  # noqa: E402,F401

WRAPPER = ROOT / "scripts" / "jht-wrapper.ps1"
# First line of a script a test runs, whose output the test reads as UTF-8: Windows PowerShell 5.1 writes to a pipe in the OEM code page, and the
# texts have accents now. A person at a console is not concerned (the console shows them whole); what reads a pipe is.
UTF8_OUTPUT = "try { [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false) } catch { }\n"
PREFIX = "wrapper."
BEGIN = "# >>> texts in the 7 languages, made from shared/locales by `python3 tests/wrapper_ps_texts.py --write`: do not edit by hand"
END = "# <<< texts in the 7 languages"
CALL = re.compile(r"(?<![\w-])(?:Get-JhtText|Format-JhtText) '([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)'")
NAMED = re.compile(r"(?m)^\s*# texts said through a variable: (.+)$")
POSITIONAL = re.compile(r"\{\d+\}|<machine>")


def ps_quote(text: str) -> str:
    """A PowerShell expression of ASCII only that is the one-line `text`."""
    parts: list[str] = []
    run = ""
    for char in text:
        if " " <= char <= "~":
            run += "''" if char == "'" else char
            continue
        if run:
            parts.append(f"'{run}'")
            run = ""
        code = ord(char)
        parts.append(f"[char]0x{code:04X}" if code <= 0xFFFF else f"[char]::ConvertFromUtf32(0x{code:X})")
    if run or not parts:
        parts.append(f"'{run}'")
    if len(parts) == 1 and parts[0].startswith("'"):
        return parts[0]
    if not parts[0].startswith("'"):
        parts.insert(0, "''")  # a string first, so that + joins strings and never adds two chars as numbers
    return "(" + " + ".join(parts) + ")"


def ps_text(text: str) -> str:
    if "\n" not in text:
        return ps_quote(text)
    return "((" + ", ".join(ps_quote(line) for line in text.split("\n")) + ") -join [char]10)"


def source() -> str:
    return WRAPPER.read_bytes().decode("utf-8")


def newline(text: str) -> str:
    return "\r\n" if "\r\n" in text else "\n"


def without_block(text: str) -> str:
    start, end = text.find(BEGIN), text.find(END)
    if start < 0 or end < 0:
        return text
    return text[:start] + text[text.index("\n", end) + 1 :]


def keys(text: str | None = None) -> list[str]:
    """Every key the wrapper says (without the prefix), sorted."""
    body = without_block(source() if text is None else text)
    found = set(CALL.findall(body))
    for named in NAMED.findall(body):
        found.update(named.split())
    return sorted(found)


def block(text: str | None = None) -> str:
    text = source() if text is None else text
    used = keys(text)
    nl = newline(text)
    lines = [BEGIN, "function Get-JhtTextTable {", "  param([string]$Lang, [string]$Key)", '  switch -CaseSensitive ("$Lang`:$Key") {']
    for lang in LANGUAGES:
        texts = catalog(lang)
        lines += [f"    '{lang}:{key}' {{ return {ps_text(texts[PREFIX + key])} }}" for key in used if PREFIX + key in texts]
    lines += ["  }", "  return $null", "}", END]
    return nl.join(lines) + nl


def written_block(text: str | None = None) -> str:
    text = source() if text is None else text
    start, end = text.index(BEGIN), text.index(END)
    return text[start : text.index("\n", end) + 1]


def write() -> None:
    text = source()
    WRAPPER.write_bytes(text.replace(written_block(text), block(text)).encode("utf-8"))


def say_functions(lang: str = "it", text: str | None = None) -> str:
    """The wrapper's texts and the functions that say them, for a test that runs functions taken out of the wrapper.

    A function of the wrapper that speaks (Write-Err (Get-JhtText ...)) needs Get-JhtText, Format-JhtText and the table of texts, and
    Get-JhtTextLanguage: here the language is the one asked for (Italian by default, the language the tests were written in).
    """
    text = source() if text is None else text
    functions = []
    for name in ("Get-JhtText", "Format-JhtText"):
        start = text.index(f"\nfunction {name} {{") + 1
        functions.append(text[start : text.index("\n}\n", start) + 3])
    nl = newline(text)
    return nl.join([written_block(text).rstrip("\r\n"), *functions, f"function Get-JhtTextLanguage {{ return '{lang}' }}", ""])


def problems(lang: str, text: str | None = None) -> list[str]:
    """What is wrong with one catalog for the wrapper: a key missing, other placeholders than the English, a new line."""
    texts, english = catalog(lang), catalog("en")
    out = []
    for key in keys(text):
        name = PREFIX + key
        if name not in texts:
            out.append(f"{lang}: {name} is missing")
            continue
        reference, own = english.get(name, ""), texts[name]
        if PLACEHOLDER.findall(own) != PLACEHOLDER.findall(reference) or own.count("%") != reference.count("%"):
            out.append(f"{lang}: {name} has other placeholders than the English {reference!r}: {own!r}")
        if sorted(POSITIONAL.findall(own)) != sorted(POSITIONAL.findall(reference)):
            out.append(f"{lang}: {name} has other {{n}}/<machine> places than the English {reference!r}: {own!r}")
        if ("\n" in own and ".help." not in f".{key}") or "\x1b" in own:
            out.append(f"{lang}: {name} has a new line or an escape")
    return out


if __name__ == "__main__":
    if sys.argv[1:] == ["--write"]:
        write()
    else:
        sys.stdout.write(block())
