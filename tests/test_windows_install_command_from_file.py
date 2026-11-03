"""The public Windows install command downloads a file, checks its SHA-256 and runs it with -File.

Origin: collaudo 03/11, Windows: Microsoft Defender (AMSI, VirTool:PowerShell/MaleficAms.W)
blocked `[scriptblock]::Create((irm <url>))` and `iwr | iex` with ANY script, even a 441-byte one:
what it flags is the scheme "download and compile in memory", not a line of install.ps1. The
documented command is therefore: save the file, compare its SHA-256 with the published one, run
it with `powershell -File`. No Defender exclusion and no AMSI trick belongs here.
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INSTALLER = ROOT / "scripts" / "install.ps1"
PUBLIC_INSTALLER = ROOT / "web" / "public" / "install.ps1"
DIGEST = ROOT / "desktop" / "src-tauri" / "installer-windows.sha256"
DOCS = (ROOT / "docs" / "guides" / "QUICKSTART.md", ROOT / "docs" / "guides" / "AI-AGENT-INTEGRATION.md")
SURFACES = (INSTALLER, PUBLIC_INSTALLER, *DOCS)

DIGEST_URL = (
    "https://raw.githubusercontent.com/leopu00/job-hunter-team/master/"
    "desktop/src-tauri/installer-windows.sha256"
)
INSTALLER_URL = "https://jobhunterteam.ai/install.ps1"

# The two schemes Defender blocked: a pipe into Invoke-Expression, and a scriptblock
# compiled straight from a download.
IN_MEMORY = (
    re.compile(r"\|\s*(?:iex|Invoke-Expression)\b", re.IGNORECASE),
    re.compile(r"ScriptBlock\]::Create\(\s*\(\s*(?:iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b", re.IGNORECASE),
)


def _text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_no_public_surface_teaches_the_in_memory_scheme():
    for path in SURFACES:
        text = _text(path)
        for pattern in IN_MEMORY:
            assert not pattern.search(text), f"{path.relative_to(ROOT)} shows the scheme Defender blocks: {pattern.pattern}"


def test_every_surface_gives_the_command_from_a_file_with_the_sha_check():
    for path in SURFACES:
        text = _text(path)
        rel = path.relative_to(ROOT)
        assert f"iwr -useb {INSTALLER_URL} -OutFile $f" in text, f"{rel}: the download goes to a file"
        assert DIGEST_URL in text, f"{rel}: says where the published SHA-256 is read"
        assert "Get-FileHash $f -Algorithm SHA256" in text, f"{rel}: compares the SHA-256"
        assert "-NoProfile -ExecutionPolicy Bypass -File $f" in text, f"{rel}: runs the file with -File"
        assert "stop" in text.lower() and "do not run" in text.lower(), f"{rel}: says to stop when the SHA-256 differs"


def test_the_command_runs_the_file_only_when_the_sha_matches():
    for path in SURFACES:
        text = _text(path)
        line = next(
            (candidate for candidate in text.splitlines() if "Get-FileHash $f -Algorithm SHA256" in candidate and "-File $f" in candidate),
            None,
        )
        assert line is not None, f"{path.relative_to(ROOT)}: the check and the run are one statement"
        compare, _, rest = line.partition("-eq $published")
        assert "-File $f" in rest.split("} else {")[0], "the run is the then-branch"
        assert "Remove-Item $f" in rest.split("} else {")[1], "the file is deleted when the SHA differs"
        assert "Write-Error" in rest.split("} else {")[1], "and the command says to stop"


def test_the_published_sha_is_the_one_of_the_installer_the_site_serves():
    import hashlib

    published = _text(DIGEST).strip()
    assert re.fullmatch(r"[0-9a-f]{64}", published)
    assert hashlib.sha256(INSTALLER.read_bytes()).hexdigest() == published
    assert hashlib.sha256(PUBLIC_INSTALLER.read_bytes()).hexdigest() == published


def test_the_flag_is_the_policy_of_the_process_not_a_defender_switch():
    forbidden = ("Set-MpPreference", "Add-MpPreference", "ExclusionPath", "DisableRealtimeMonitoring", "amsiInitFailed")
    for path in SURFACES:
        text = _text(path)
        for word in forbidden:
            assert word not in text, f"{path.relative_to(ROOT)} touches Defender: {word}"
