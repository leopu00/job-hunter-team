"""The texts of scripts/host-setup.sh in the 7 languages, from shared/locales (see tests/script_texts.py).

Change a text in the catalogs, then

    python3 tests/host_setup_texts.py --write

and the block in the script is made again. tests/test_host_setup_speaks_the_language_chosen.py fails when the two differ.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from script_texts import LANGUAGES, ROOT, ScriptTexts, catalog, shell_quote  # noqa: E402,F401

HOST_SETUP = ROOT / "scripts" / "host-setup.sh"
TEXTS = ScriptTexts(HOST_SETUP, tool="tests/host_setup_texts.py --write")

if __name__ == "__main__":
    if sys.argv[1:] == ["--write"]:
        TEXTS.write()
    else:
        sys.stdout.write(TEXTS.block())
