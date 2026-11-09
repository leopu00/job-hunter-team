"""The browsers already installed under /opt/playwright stay owned by root.

A recursive chown copies every file it touches into a new image layer (copy-on-write): the headless shell cost one
layer of ~114 MB that every first setup downloads for a change of owner. The folder itself stays jht's, so a browser
added later still installs from jht.
"""
import re
from pathlib import Path

DOCKERFILE = Path(__file__).resolve().parent.parent / "Dockerfile"


def _chown_step() -> str:
    text = DOCKERFILE.read_text(encoding="utf-8")
    start = text.index("&& chown jht:jht /opt/playwright")
    return text[start:text.index("\\\n", text.index("-exec chown", start))]


def test_the_installed_browsers_are_left_to_root_and_the_folder_stays_jhts():
    step = _chown_step()
    assert "! -name 'chromium-[0-9]*'" in step
    assert "! -name 'chromium_headless_shell-[0-9]*'" in step
    assert "-mindepth 1 -maxdepth 1" in step


def test_nothing_chowns_all_of_opt_playwright_recursively():
    text = re.sub(r"#[^\n]*", "", DOCKERFILE.read_text(encoding="utf-8"))
    assert not re.search(r"chown\s+-R\s+\S+\s+[^&;]*?/opt/playwright(?:\s|$|\\)", text)
