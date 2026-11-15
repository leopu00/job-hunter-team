"""The texts of scripts/install.sh in the 7 languages, from shared/locales (see tests/script_texts.py).

Change a text in the catalogs, then `python3 tests/installer_texts.py --write`: the block in the installer is made again (and
web/public/install.sh with desktop/src-tauri/installer.sha256 must follow it). tests/test_installer_speaks_the_language_chosen.py
fails when the two differ.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from script_texts import ROOT, ScriptTexts  # noqa: E402

TEXTS = ScriptTexts(ROOT / "scripts" / "install.sh", tool="tests/installer_texts.py --write")

if __name__ == "__main__":
    if sys.argv[1:] == ["--write"]:
        TEXTS.write()
    else:
        sys.stdout.write(TEXTS.block())
