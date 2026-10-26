"""Windows is not part of the 0.4.0 download: the page says "coming soon" and links nothing.

The Tauri NSIS installer is not built or attached by the release (D13); the
download page keeps Windows as a card that is not a link, and the funnel has no
slug for it. When Windows comes back, this file is what has to change first.
"""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DOWNLOAD_CLIENT = ROOT / "web" / "app" / "download" / "DownloadClient.tsx"
DOWNLOAD_FUNNEL = ROOT / "web" / "lib" / "download-funnel.ts"


def test_download_page_links_no_windows_installer() -> None:
    client = DOWNLOAD_CLIENT.read_text()
    funnel = DOWNLOAD_FUNNEL.read_text()

    assert "win-setup" not in client and "win-setup" not in funnel
    assert "win-portable" not in funnel
    assert "windows-x64-setup" not in funnel and ".exe" not in funnel
    # Windows stays in the list of cards, as "coming soon", and is not an anchor
    assert '{ id: "windows", label: "Windows" }' in client
    assert "data-windows-coming-soon" in client
    assert 't("dl_windows_coming_soon")' in client
    assert 'mac: "mac"' in client and 'linux: "linux"' in client
    assert 'windows: "' not in client.split("const DOWNLOAD_SLUG", 1)[1].split("};", 1)[0]
    # Linux says it is experimental where the button is
    assert "data-linux-experimental" in client
    assert 't("dl_linux_experimental")' in client


SENTENCE = "Windows is not supported in 0.4: these steps are untested and may not work."


def test_every_windows_install_instruction_says_it_is_unsupported_in_04() -> None:
    # the steps stay (the CLI of someone on Windows must not break), with one sentence above each
    guides = ROOT / "docs" / "guides"
    assert (guides / "QUICKSTART.md").read_text().count(SENTENCE) == 1
    assert (guides / "CLI-INSTALL.md").read_text().count(SENTENCE) == 2
    assert (guides / "AI-AGENT-INTEGRATION.md").read_text().count(SENTENCE) == 1
    page = (ROOT / "web/app/docs/guides/getting-started/page.i18n.ts").read_text()
    intros = [chunk for chunk in page.split("path3WinIntro:")[2:]]
    assert len(intros) == 7  # seven languages
    assert SENTENCE in intros[0]
    for chunk in intros:
        assert chunk.lstrip().startswith('"') and "0.4" in chunk.split('",', 1)[0]
        assert "WSL" in chunk.split('",', 1)[0]  # the old line is still there after the sentence
