"""After `jht uninstall` on Windows `vmmem`, `wslservice` and `wslrelay` are still running, and the last one has no port open.

They are parts of Windows (WSL itself), shared with every other WSL machine the person has: ending them would stop those too, which is
what `wsl --shutdown` does and what the uninstall never does. So they are not ended; the uninstall says why they stay and how to stop them
by hand, in the language of the person. The source is read as text (the printing is checked on Windows in test_windows_uninstall_wrapper.py).
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PS = (ROOT / "scripts" / "jht-wrapper.ps1").read_text(encoding="utf-8").replace("\r\n", "\n")


def _texts() -> list[str]:
    line = re.search(r"^    'done\.wsl'\s+= @\((.*)\)$", PS, re.M).group(1)
    return re.findall(r"'((?:[^']|'')*)'", line)


def test_the_note_is_in_italian_and_in_english_and_names_the_three_processes_and_the_manual_command():
    italian, english = _texts()
    for text in (italian, english):
        for name in ("vmmem", "wslservice", "wslrelay"):
            assert name in text
        assert "wsl --shutdown" in text
    assert "non li ha installati Job Hunter Team" in italian and "did not install them" in english


def test_the_uninstall_prints_the_note_after_the_done_line_and_never_ends_a_wsl_process():
    body = re.search(r"^function Invoke-JhtWindowsUninstall \{\n(.*?)^\}\n", PS, re.S | re.M).group(1)
    assert body.index("Get-JhtUninstallText 'done'") < body.index("Get-JhtUninstallText 'done.wsl'")
    for forbidden in ("Stop-Process", "taskkill", "'--shutdown'", "wsl --shutdown'"):
        assert forbidden not in body
