"""The texts of scripts/jht-integration.ps1 in the 7 languages, from shared/locales (see tests/ps_script_texts.py).

The same keys as scripts/jht-integration.sh (integration.*). Change a text in the catalogs, then
`python3 tests/integration_ps1_texts.py --write`: the block in the script is made again.
tests/test_integration_ps1_speaks_the_language_chosen.py fails when the two differ.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ps_script_texts import ROOT, PowerShellScriptTexts  # noqa: E402

TEXTS = PowerShellScriptTexts(ROOT / "scripts" / "jht-integration.ps1", function="Get-IntegrationTextTable",
                              calls=("Get-IntegrationText", "Format-IntegrationText"),
                              tool="tests/integration_ps1_texts.py --write")

if __name__ == "__main__":
    if sys.argv[1:] == ["--write"]:
        TEXTS.write()
    else:
        sys.stdout.write(TEXTS.block())
