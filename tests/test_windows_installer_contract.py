"""The Windows installer users download is the Tauri NSIS one.

Until 08/10 four more tests guarded the Godot installer (game/installer/
windows.nsi, scripts/build-windows-installer.ps1 and the Windows installer
smoke workflow, which build and probe the Godot export). Godot is abandoned and
they went with it; the builder and the workflow are decided with game/.
"""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DOWNLOAD_CLIENT = ROOT / "web" / "app" / "download" / "DownloadClient.tsx"
DOWNLOAD_FUNNEL = ROOT / "web" / "lib" / "download-funnel.ts"


def test_download_page_points_to_the_tauri_installer() -> None:
    client = DOWNLOAD_CLIENT.read_text()
    funnel = DOWNLOAD_FUNNEL.read_text()

    # The client owns stable local slugs; only the server-side allowlist owns
    # release destinations, so a query parameter can never choose an asset.
    assert 'windows: "win-setup"' in client
    assert (
        '"win-setup": `${RELEASE_BASE}/job-hunter-team-windows-x64-setup.exe`'
        in funnel
    )
    assert 'win-portable' not in funnel
