"""The texts of scripts/podman-machine-bridge.ps1 in the 7 languages, from shared/locales (see tests/ps_script_texts.py).

The keys are podman_machine.*. The bridge is dot-sourced into scripts/enable-podman-windows-runtime.ps1, whose calls are read
too: their keys go in the same block. Change a text in the catalogs, then `python3 tests/bridge_ps1_texts.py --write`.
tests/test_bridge_ps1_speaks_the_language_chosen.py fails when the two differ.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ps_script_texts import ROOT, PowerShellScriptTexts  # noqa: E402

ENABLER = ROOT / "scripts" / "enable-podman-windows-runtime.ps1"


class BridgeTexts(PowerShellScriptTexts):
    """The bridge's block holds the keys of the bridge and of the enabler that dot-sources it."""

    def calls(self, source: str | None = None) -> dict[str, str]:
        found = super().calls(source)
        for key, english in super().calls(ENABLER.read_text(encoding="utf-8")).items():
            found.setdefault(key, english)
        return found


TEXTS = BridgeTexts(ROOT / "scripts" / "podman-machine-bridge.ps1", function="Get-BridgeTextTable",
                    calls=("Get-BridgeText", "Format-BridgeText"), tool="tests/bridge_ps1_texts.py --write")

if __name__ == "__main__":
    if sys.argv[1:] == ["--write"]:
        TEXTS.write()
    else:
        sys.stdout.write(TEXTS.block())
