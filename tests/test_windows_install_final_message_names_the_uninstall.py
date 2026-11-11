"""The last text of the Windows install tells the person how to uninstall with `jht uninstall`, not by hand.

It used to print `Remove-Item …` lines and `podman image rm …`: those leave the Podman machine, its images, the start-up units and the
`jht` command's traces behind, and name paths a person should not have to type. `jht uninstall --confirm` takes the machine, the
runtime and the command away and keeps `~/.jht` and `Documents\\Job Hunter Team`; with `--purge` it removes those too. The source is
read as text (the function prints to the host, and the test does not need Windows).
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCES = {name: (ROOT / name).read_text(encoding="utf-8").replace("\r\n", "\n") for name in ("scripts/install.ps1", "web/public/install.ps1")}


def _final(text: str) -> str:
    return re.search(r"^function Show-Final \{\n(.*?)^\}\n", text, re.S | re.M).group(1)


def test_the_final_message_names_jht_uninstall_with_and_without_the_data():
    for name, text in SOURCES.items():
        final = _final(text)
        assert 'Write-Host "    jht uninstall --confirm" ' in final, name
        assert 'Write-Host "    jht uninstall --confirm --purge" ' in final, name
        assert "keeps the data in ~/.jht" in final and "To delete the data as well" in final, name


def test_the_final_message_no_longer_tells_the_person_to_remove_things_by_hand():
    for name, text in SOURCES.items():
        final = _final(text)
        assert "Remove-Item" not in final, name
        assert "podman image rm" not in final, name
        assert "jht down" not in final, name
