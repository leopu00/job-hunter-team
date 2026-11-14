"""Texts of a host PowerShell script in the 7 languages, made from shared/locales (the twin of tests/script_texts.py).

The .ps1 scripts of the host run where shared/locales is not there, so their texts are written inside each script, as data, in a
block between two marker lines made from the catalogs: the same catalogs, and the same keys, as the bash scripts. The catalogs are
the source.

A script says a text with `(<Say> '<key>' '<English>')`, or `(<SayF> '<key>' '<English with %s/%d>' value...)`, where <Say> and
<SayF> are the script's own function names (a .ps1 dot-sourced into the wrapper shares its scope: names must not collide). The
English in the call is what it says for a key the catalogs do not have. %s/%d are put in IN ORDER by <SayF>, never with -f: one
catalog serves bash (printf cannot reorder) and PowerShell, and a { in a translation breaks nothing.

The block is one function, `switch -CaseSensitive ("$Lang`:$Key")`. Every text is a PowerShell expression of ASCII only: runs of
printable ASCII between single quotes ('' for an apostrophe) and every other character as [char]0x....: Windows PowerShell 5.1
reads a .ps1 without a BOM as ANSI, so the file stays ASCII and needs no BOM (install.ps1 is held to ASCII by a test).

    texts = PowerShellScriptTexts(ROOT / "scripts" / "jht-integration.ps1", function="Get-IntegrationTextTable",
                                  calls=("Get-IntegrationText", "Format-IntegrationText"))
    texts.write()                              # makes the block again from the catalogs
    texts.written_block() == texts.block()     # what the test checks

The two functions a script needs, besides the block (names are the script's):

    function Get-IntegrationText {
      param([string]$Key, [string]$English)
      $text = Get-IntegrationTextTable (Get-JhtTextLanguage) $Key
      if ($null -eq $text) { return $English }
      return $text
    }
    function Format-IntegrationText {
      param([string]$Key, [string]$English, [Parameter(ValueFromRemainingArguments = $true)][object[]]$Values)
      ... replaces each %s/%d of (Get-IntegrationText $Key $English) with the next value, in order
    }
"""

from __future__ import annotations

import re
from pathlib import Path

from script_texts import LANGUAGES, PLACEHOLDER, ROOT, catalog  # noqa: F401  (ROOT for the modules of each script)


def ps_quote(text: str) -> str:
    """A PowerShell expression of ASCII only that is `text`."""
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


class PowerShellScriptTexts:
    def __init__(self, script: Path, *, function: str, calls: tuple[str, ...], tool: str = "") -> None:
        self.script = script
        self.function = function
        names = "|".join(re.escape(name) for name in calls)
        self.call = re.compile(rf"(?<![\w-])(?:{names}) '([a-z_]+(?:\.[a-z0-9_]+)+)' '((?:[^']|'')*)'")
        how = f"`python3 {tool}`" if tool else "tests/ps_script_texts.py"
        self.begin = f"# >>> texts in the 7 languages, made from shared/locales by {how}: do not edit by hand"
        self.end = "# <<< texts in the 7 languages"

    def source(self) -> str:
        return self.script.read_text(encoding="utf-8")

    def _newline(self, source: str) -> str:
        return "\r\n" if "\r\n" in source else "\n"

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
            found.setdefault(key, english.replace("''", "'"))
        return found

    def block(self, source: str | None = None) -> str:
        source = self.source() if source is None else source
        keys = sorted(self.calls(source))
        lines = [self.begin, f"function {self.function} {{", "  param([string]$Lang, [string]$Key)",
                 '  switch -CaseSensitive ("$Lang`:$Key") {']
        for lang in LANGUAGES:
            texts = catalog(lang)
            lines += [f"    '{lang}:{key}' {{ return {ps_quote(texts[key])} }}" for key in keys if key in texts]
        lines += ["  }", "  return $null", "}", self.end]
        newline = self._newline(source)
        return newline.join(lines) + newline

    def written_block(self, source: str | None = None) -> str:
        source = self.source() if source is None else source
        start, end = source.index(self.begin), source.index(self.end)
        return source[start : source.index("\n", end) + 1]

    def write(self) -> None:
        source = self.source()
        self.script.write_bytes(source.replace(self.written_block(source), self.block(source)).encode("utf-8"))

    def problems(self, lang: str) -> list[str]:
        """What is wrong with one catalog for this script: a key missing, other placeholders, English not the script's."""
        texts = catalog(lang)
        out = []
        for key, english in self.calls().items():
            if key not in texts:
                out.append(f"{lang}: {key} is missing")
                continue
            text = texts[key]
            if PLACEHOLDER.findall(text) != PLACEHOLDER.findall(english) or text.count("%") != len(PLACEHOLDER.findall(english)):
                out.append(f"{lang}: {key} has other placeholders than {english!r}: {text!r}")
            if "\n" in text or "\x1b" in text:
                out.append(f"{lang}: {key} has a new line or an escape")
            if lang == "en" and text != english:
                out.append(f"en: {key} is {text!r} in the catalog and {english!r} in the script")
        return out
