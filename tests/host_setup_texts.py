"""The texts of scripts/host-setup.sh in the 7 languages, from shared/locales.

host-setup.sh runs on the host, where shared/locales is not there (the installer brings only the script, attested by its
sha256), and it reads no file the container can write. So its texts are written inside the script, as data, in a block
made from the catalogs. The catalogs are the source: change a text there, then

    python3 tests/host_setup_texts.py --write

and the block in the script is made again. tests/test_host_setup_speaks_the_language_chosen.py fails when the two differ.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HOST_SETUP = ROOT / "scripts" / "host-setup.sh"
LOCALES = ROOT / "shared" / "locales"
LANGUAGES = ("en", "it", "hu", "es", "de", "fr", "pt")
BEGIN = "# >>> texts in the 7 languages, made from shared/locales by `python3 tests/host_setup_texts.py --write`: do not edit by hand"
END = "# <<< texts in the 7 languages"
# ts <key> '<English>' and tsf <key> '<English>' args...
CALL = re.compile(r"\bts[f]? ([a-z_]+(?:\.[a-z0-9_]+)+) '((?:[^'\\]|'\\'')*)'")


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


def script_calls(source: str | None = None) -> dict[str, str]:
    """Every key the script says, with its English fallback as written in the call."""
    source = HOST_SETUP.read_text(encoding="utf-8") if source is None else source
    body = _without_block(source)
    calls: dict[str, str] = {}
    for key, english in CALL.findall(body):
        calls.setdefault(key, english.replace("'\\''", "'"))
    return calls


def _quote(text: str) -> str:
    return "'" + text.replace("'", "'\\''") + "'"


def block(keys: list[str] | None = None) -> str:
    keys = sorted(script_calls()) if keys is None else keys
    lines = [BEGIN, "ts_table() {", '  case "$1:$2" in']
    for lang in LANGUAGES:
        texts = catalog(lang)
        for key in keys:
            if key in texts:
                lines.append(f"    {lang}:{key}) printf '%s' {_quote(texts[key])} ;;")
    lines += ["    *) return 1 ;;", "  esac", "}", END]
    return "\n".join(lines) + "\n"


def _without_block(source: str) -> str:
    start, end = source.find(BEGIN), source.find(END)
    if start < 0 or end < 0:
        return source
    return source[:start] + source[source.index("\n", end) + 1 :]


def written_block(source: str | None = None) -> str:
    source = HOST_SETUP.read_text(encoding="utf-8") if source is None else source
    start, end = source.index(BEGIN), source.index(END)
    return source[start : source.index("\n", end) + 1]


def write() -> None:
    source = HOST_SETUP.read_text(encoding="utf-8")
    HOST_SETUP.write_text(source.replace(written_block(source), block()), encoding="utf-8")


if __name__ == "__main__":
    if sys.argv[1:] == ["--write"]:
        write()
    else:
        sys.stdout.write(block())
