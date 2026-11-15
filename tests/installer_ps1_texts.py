"""The texts of scripts/install.ps1 in the 7 languages, from shared/locales (see tests/ps_script_texts.py).

Change a text in the catalogs, then `python3 tests/installer_ps1_texts.py --write`: the block in the installer is made again
(web/public/install.ps1 and desktop/src-tauri/installer-windows.sha256 must follow it).
tests/test_installer_ps1_speaks_the_language_chosen.py fails when the two differ.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ps_script_texts import ROOT, PowerShellScriptTexts  # noqa: E402

TEXTS = PowerShellScriptTexts(ROOT / "scripts" / "install.ps1", function="Get-InstallerTextTable", calls=("Ts", "Tsf"),
                              tool="tests/installer_ps1_texts.py --write")

if __name__ == "__main__":
    if sys.argv[1:] == ["--write"]:
        TEXTS.write()
    else:
        sys.stdout.write(TEXTS.block())
