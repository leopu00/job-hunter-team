"""The texts of scripts/jht-wrapper.sh in the 7 languages, from shared/locales (keys wrapper.*; see tests/script_texts.py).

Change a text in the catalogs, then

    python3 tests/wrapper_texts.py --write

and the block in the wrapper is made again. tests/test_wrapper_speaks_the_language_chosen.py fails when the two differ.
"""

from __future__ import annotations

import os
import shlex
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from script_texts import LANGUAGES, ROOT, KeyedScriptTexts, catalog  # noqa: E402,F401

WRAPPER = ROOT / "scripts" / "jht-wrapper.sh"
TEXTS = KeyedScriptTexts(WRAPPER, function="jht_text", calls=("jht_say", "jht_say_sentence"), prefix="wrapper.", tool="tests/wrapper_texts.py --write")

def say_functions(lang: str | None = None) -> str:
    """The wrapper's texts and jht_say, for a test that runs functions taken out of the wrapper.

    The texts are a big block (on Linux one argument of `bash -c` may not pass 128 KiB), so they go in a file of their own,
    loaded with `source`; jht_say comes as it is. With ``lang`` the snippet also says the language (JHT_SAY_LANG); without
    it jht_say reads JHT_LANG, then English.
    """
    import hashlib
    import tempfile

    source = WRAPPER.read_text(encoding="utf-8")
    block = TEXTS.written_block(source)
    texts = Path(tempfile.gettempdir()) / f"jht-wrapper-texts-{hashlib.sha256(block.encode()).hexdigest()[:16]}.sh"
    if not texts.exists():
        partial = texts.with_suffix(f".{os.getpid()}.tmp")
        partial.write_text(block, encoding="utf-8")
        os.replace(partial, texts)
    start = source.index("\njht_say() {") + 1
    say = source[start : source.index("\n}\n", start) + 3]
    head = f"JHT_SAY_LANG={lang}\n" if lang else ""
    return f"{head}source {shlex.quote(str(texts))}\n{say}"


if __name__ == "__main__":
    if sys.argv[1:] == ["--write"]:
        TEXTS.write()
    else:
        sys.stdout.write(TEXTS.block())

