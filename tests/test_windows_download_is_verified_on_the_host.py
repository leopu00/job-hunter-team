"""`jht download` in the Windows wrapper takes the release and checks its SHA-256 on the host, outside the folders shared with the team.

It used to download and verify in the container and copy the verified bytes to the host with docker cp, unchecked. The check of the
source runs everywhere; the rest runs the real functions in Windows PowerShell 5.1 and in PowerShell 7 against a local server, and
the Windows config gate runs this file with `JHT_REQUIRE_WINDOWS_SHELLS=1`.
"""

from __future__ import annotations

import hashlib
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest
from test_windows_host_env_is_not_written_through_a_link import SHELLS, _run, windows_only

ROOT = Path(__file__).resolve().parents[1]
WRAPPER = ROOT / "scripts" / "jht-wrapper.ps1"
ASSET = "job-hunter-team-linux-x64.AppImage"
BYTES = b"the installer the release published"
SUM = hashlib.sha256(BYTES).hexdigest()


def _functions() -> str:
    import re
    text = WRAPPER.read_text(encoding="utf-8")
    out = []
    for name in ("Test-DownloadInsideShared", "Get-DownloadSha256", "Invoke-HostDownload"):
        match = re.search(rf"^function {re.escape(name)} \{{.*?^\}}\n", text, re.S | re.M)
        assert match, name
        out.append(match.group(0))
    return "\n".join(out)


# ── the source, on every machine ───────────────────────────────────────────

def test_the_windows_download_no_longer_goes_through_the_container():
    source = WRAPPER.read_text(encoding="utf-8")
    function = _functions()
    for gone in ("docker cp", "docker exec", "$Container", "NodeEntry"):
        assert gone not in function, gone
    assert "Get-FileHash" not in function, "the hash must not depend on a module that a reduced environment may not find"
    for seam in ("Get-DownloadSha256", "[Security.Cryptography.SHA256]::Create()", "[IO.File]::Move($part, $destination)", "Test-DownloadInsideShared", "'SHA256SUMS'",
                 "https://github.com/leopu00/job-hunter-team/releases/download"):
        assert seam in function, seam
    arm = source[source.index("  'download' {"):]
    arm = arm[:arm.index("  # Tutto il resto")]
    assert "Ensure-Up" not in arm and "Require-Docker" not in arm and "Invoke-HostDownload $Rest" in arm
    assert "exit $script:HostDownloadExitCode" in arm and "$script:HostDownloadExitCode = 1" in function


# ── the real code, in both shells ──────────────────────────────────────────

class _Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


@pytest.fixture()
def site(tmp_path: Path):
    root = tmp_path / "site" / "v0.3.5"
    root.mkdir(parents=True)
    (root / ASSET).write_bytes(BYTES)
    (root / "SHA256SUMS").write_text(f"{SUM}  {ASSET}\n", encoding="utf-8")
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(_Quiet, directory=str(tmp_path / "site")))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield type("Site", (), {"url": f"http://127.0.0.1:{server.server_port}", "root": root})
    server.shutdown()
    server.server_close()


def _download(shell: str, tmp_path: Path, site, *args: str, extra: str = ""):
    home = tmp_path / "profile"
    home.mkdir(exist_ok=True)
    quoted = ", ".join("'" + a.replace("'", "''") + "'" for a in args)
    script = ("function Write-Err { param([string]$Msg) Write-Host \"error: $Msg\" }\n" + _functions() + extra
              + f"\nInvoke-HostDownload -DownloadArgs @({quoted})\nWrite-Host \"RC=$script:HostDownloadExitCode\"\n")
    done = _run(shell, script, tmp_path, USERPROFILE=str(home), JHT_RELEASE_BASE_URL=site.url,
                JHT_HOME_HOST=str(home / ".jht"), JHT_USER_DIR_HOST="", TEMP=str(tmp_path / "temp"), TMP=str(tmp_path / "temp"))
    return done, home


@windows_only
@pytest.mark.parametrize("shell", SHELLS)
def test_the_installer_is_checked_on_the_host_and_saved_where_it_was_asked(shell: str, tmp_path: Path, site):
    (tmp_path / "temp").mkdir()
    out = tmp_path / "chosen" / "client.AppImage"
    done, _ = _download(shell, tmp_path, site, "--os", "linux", "--version", "0.3.5", "--output", str(out))
    assert "RC=0" in done.stdout, done.stdout + done.stderr
    assert out.read_bytes() == BYTES and SUM in done.stdout
    assert list((tmp_path / "temp").iterdir()) == [], "a private download folder was left"
    assert [p.name for p in out.parent.iterdir()] == ["client.AppImage"]


@windows_only
@pytest.mark.parametrize("shell", SHELLS)
def test_by_default_it_goes_to_downloads_not_to_a_shared_folder(shell: str, tmp_path: Path, site):
    (tmp_path / "temp").mkdir()
    done, home = _download(shell, tmp_path, site, "--os", "linux", "--version", "0.3.5")
    assert "RC=0" in done.stdout, done.stdout + done.stderr
    assert (home / "Downloads" / ASSET).read_bytes() == BYTES
    assert not (home / "Documents").exists() and not (home / ".jht").exists()


@windows_only
@pytest.mark.parametrize("shell", SHELLS)
def test_a_wrong_hash_saves_nothing_and_leaves_nothing(shell: str, tmp_path: Path, site):
    (tmp_path / "temp").mkdir()
    (site.root / "SHA256SUMS").write_text(f"{'0' * 64}  {ASSET}\n", encoding="utf-8")
    out = tmp_path / "out" / "client.AppImage"
    done, _ = _download(shell, tmp_path, site, "--os", "linux", "--version", "0.3.5", "--output", str(out))
    assert "RC=1" in done.stdout and "SHA-256 non valido" in done.stdout
    assert not out.exists() and list(out.parent.iterdir()) == [] and list((tmp_path / "temp").iterdir()) == []


@windows_only
@pytest.mark.parametrize("shell", SHELLS)
def test_a_destination_in_a_shared_folder_is_refused_even_through_a_junction(shell: str, tmp_path: Path, site):
    (tmp_path / "temp").mkdir()
    shared = tmp_path / "profile" / ".jht"
    shared.mkdir(parents=True)
    plain = shared / "client.AppImage"
    done, _ = _download(shell, tmp_path, site, "--os", "linux", "--version", "0.3.5", "--output", str(plain))
    assert "RC=1" in done.stdout and "condivisa con il team" in done.stdout and not plain.exists()

    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    link = elsewhere / "inside"
    made = _run(shell, f"New-Item -ItemType Junction -Path '{link}' -Target '{shared}' | Out-Null", tmp_path)
    assert made.returncode == 0, made.stdout + made.stderr
    done, _ = _download(shell, tmp_path, site, "--os", "linux", "--version", "0.3.5", "--output", str(link / "client.AppImage"))
    assert "RC=1" in done.stdout and "condivisa con il team" in done.stdout
    assert list(shared.iterdir()) == []


@windows_only
@pytest.mark.parametrize("shell", SHELLS)
def test_an_existing_different_file_is_kept_and_a_wrong_ask_answers_2(shell: str, tmp_path: Path, site):
    (tmp_path / "temp").mkdir()
    out = tmp_path / "out" / "client.AppImage"
    out.parent.mkdir()
    out.write_bytes(b"keep me")
    done, _ = _download(shell, tmp_path, site, "--os", "linux", "--version", "0.3.5", "--output", str(out))
    assert "RC=1" in done.stdout and out.read_bytes() == b"keep me"
    done, _ = _download(shell, tmp_path, site, "--os", "linux")
    assert "RC=2" in done.stdout
    done, _ = _download(shell, tmp_path, site, "--os", "windows", "--version", "0.4.0")
    assert "RC=1" in done.stdout and "Windows non fa parte" in done.stdout
