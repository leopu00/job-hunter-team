"""Texts of a host shell script in the 7 languages, made from shared/locales.

The shell scripts of the host (host-setup.sh, the wrapper, the installer, the helpers) run where shared/locales is not
there, and they read no file the container can write. So their texts are written inside each script, as data: a block
between two marker lines, made from the catalogs. The catalogs are the source.

A script says a text with `ts <key> '<English>'` (or `tsf <key> '<English with %s/%d>' values...`); the English in the
call is what it says for a key the catalogs do not have. The block is one function, `case "$1:$2" in <lang>:<key>) ...`.

    texts = ScriptTexts(ROOT / "scripts" / "host-setup.sh")
    texts.write()                # makes the block again from the catalogs
    texts.written_block() == texts.block()   # what the test checks
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOCALES = ROOT / "shared" / "locales"
LANGUAGES = ("en", "it", "hu", "es", "de", "fr", "pt")
PLACEHOLDER = re.compile(r"%[sd]")


def _flat(tree: dict, prefix: str = "") -> dict[str, str]:
    out: dict[str, str] = {}
    for key, value in tree.items():
        if isinstance(value, dict):
            out.update(_flat(value, f"{prefix}{key}."))
        else:
            out[f"{prefix}{key}"] = value
    return out


def catalog(lang: str) -> dict[str, str]:
    return _flat(json.loads((LOCALES / f"{lang}.json").read_text(encoding="utf-8")))


def shell_quote(text: str) -> str:
    return "'" + text.replace("'", "'\\''") + "'"


class ScriptTexts:
    def __init__(self, script: Path, *, function: str = "ts_table", calls: tuple[str, ...] = ("ts", "tsf"), tool: str = "") -> None:
        self.script = script
        self.function = function
        names = "|".join(re.escape(name) for name in calls)
        self.call = re.compile(rf"(?<![\w-])(?:{names}) ([a-z_]+(?:\.[a-z0-9_]+)+) '((?:[^'\\]|'\\'')*)'")
        how = f"`python3 {tool}`" if tool else "tests/script_texts.py"
        self.begin = f"# >>> texts in the 7 languages, made from shared/locales by {how}: do not edit by hand"
        self.end = "# <<< texts in the 7 languages"

    def source(self) -> str:
        return self.script.read_text(encoding="utf-8")

    def _without_block(self, source: str) -> str:
        start, end = source.find(self.begin), source.find(self.end)
        if start < 0 or end < 0:
            return source
        return source[:start] + source[source.index("\n", end) + 1 :]

    def calls(self, source: str | None = None) -> dict[str, str]:
        """Every key the script says, with the English of its first call."""
        body = self._without_block(self.source() if source is None else source)
        found: dict[str, str] = {}
        for key, english in self.call.findall(body):
            found.setdefault(key, english.replace("'\\''", "'"))
        return found

    def block(self) -> str:
        keys = sorted(self.calls())
        lines = [self.begin, f"{self.function}() {{", '  case "$1:$2" in']
        for lang in LANGUAGES:
            texts = catalog(lang)
            lines += [f"    {lang}:{key}) printf '%s' {shell_quote(texts[key])} ;;" for key in keys if key in texts]
        lines += ["    *) return 1 ;;", "  esac", "}", self.end]
        return "\n".join(lines) + "\n"

    def written_block(self, source: str | None = None) -> str:
        source = self.source() if source is None else source
        start, end = source.index(self.begin), source.index(self.end)
        return source[start : source.index("\n", end) + 1]

    def write(self) -> None:
        source = self.source()
        self.script.write_text(source.replace(self.written_block(source), self.block()), encoding="utf-8")

    def problems(self, lang: str) -> list[str]:
        """What is wrong with one catalog for this script: a key missing, other placeholders, English not the script's."""
        texts = catalog(lang)
        out = []
        for key, english in self.calls().items():
            if key not in texts:
                out.append(f"{lang}: {key} is missing")
                continue
            text = texts[key]
            # bash printf cannot reorder: the same %s/%d in the same order, and no other %
            if PLACEHOLDER.findall(text) != PLACEHOLDER.findall(english) or text.count("%") != len(PLACEHOLDER.findall(english)):
                out.append(f"{lang}: {key} has other placeholders than {english!r}: {text!r}")
            if "\n" in text or "\x1b" in text:
                out.append(f"{lang}: {key} has a new line or an escape")
            if lang == "en" and text != english:
                out.append(f"en: {key} is {text!r} in the catalog and {english!r} in the script")
        return out
