"""The 0.4.0 download page starts from the CLI and links no app: the desktop app is not in 0.4.0.

The Tauri NSIS installer is not built or attached by the release (D13) and the funnel has no slug for it. The page has
no platform cards any more: it gives the one-liner and the assistant prompt, and says Windows as the README does, a
preview of the CLI. When the app comes back, this file is what has to change first.
"""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DOWNLOAD_CLIENT = ROOT / "web" / "app" / "download" / "DownloadClient.tsx"
DOWNLOAD_FUNNEL = ROOT / "web" / "lib" / "download-funnel.ts"


def test_download_page_links_no_windows_installer() -> None:
    client = DOWNLOAD_CLIENT.read_text(encoding="utf-8")
    funnel = DOWNLOAD_FUNNEL.read_text(encoding="utf-8")

    assert "win-setup" not in client and "win-setup" not in funnel
    assert "win-portable" not in funnel
    assert "windows-x64-setup" not in funnel and ".exe" not in funnel
    # no app in 0.4.0: no card, no slug, no link to a file; the page opens on the CLI
    assert "DOWNLOAD_SLUG" not in client and "downloadHref" not in client and "PLATFORMS" not in client
    assert 'id: "desktop"' not in client and 'useState<InstallMode>("terminal")' in client
    # Windows is said as in the README: a preview of the CLI
    assert "data-windows-cli-preview" in client and 't("dl_windows_cli_preview")' in client
    assert '{ id: "linux"' not in client and "data-linux" not in client and "dl_linux" not in client
    assert "linux" not in funnel.split("DOWNLOAD_TARGETS", 1)[1].split("} as const", 1)[0].lower()


SENTENCE = "Windows is a preview in 0.4.0, CLI only: tested on Windows 10, not on Windows 11."


def test_every_windows_install_instruction_says_windows_is_a_cli_preview_as_the_readme() -> None:
    # Windows is said the same way everywhere, as in the README: a preview of the CLI, tested on 10 and not on 11
    guides = ROOT / "docs" / "guides"
    # the quickstart says it in its requirements and above the Windows steps
    assert (guides / "QUICKSTART.md").read_text(encoding="utf-8").count(SENTENCE) == 2
    # the CLI install reference describes install.sh: for Windows it says the preview and points to the Quickstart
    cli_install = (guides / "CLI-INSTALL.md").read_text(encoding="utf-8")
    assert cli_install.count(SENTENCE) == 2 and "install.ps1" not in cli_install and "wsl_not_ready" not in cli_install
    assert "Windows is not in this version" not in cli_install
    assert (guides / "AI-AGENT-INTEGRATION.md").read_text(encoding="utf-8").count(SENTENCE) == 1
    # the website's getting-started page has no Windows block: it says the CLI preview in every language (path 2)
    page = (ROOT / "web/app/docs/guides/getting-started/page.i18n.ts").read_text(encoding="utf-8")
    assert "path3WinIntro" not in page and "install.ps1" not in (ROOT / "web/app/docs/guides/getting-started/page.tsx").read_text(encoding="utf-8")
    assert "Windows is not supported in 0.4" not in page
    assert page.count("Windows is a preview in 0.4.0, CLI only: tested on Windows 10, not on Windows 11") == 2
