"""install.ps1 on a Windows without winget: it says what to do, writes nothing, and keeps its machine lines for the app.

Origin: collaudo 03/11, Windows 10 without «App Installer»: the installer stopped at [3/5] with
`podman_not_installable: winget is required to install Podman dependencies.` and exit 21, said nothing about
what to do, and left an empty `host-runtime` folder. The lines `JHT_PHASE ...` (for the desktop app) were on the
screen of a person too, and the error was one line without colour or next step.

Decision for 0.4.0: winget stayed a requirement; JHT-T184 (05/11) makes it a way, not a requirement: without a usable
winget the enabler installs Podman for the user from the official release (checked by its SHA-256), so the installer no
longer stops for it. The guide still lists winget (it is the usual way); the folders a stopped run created and left
empty are removed again. JHT_PHASE goes to the app (output through
a pipe) or to whoever asks with JHT_MACHINE_OUTPUT=1, never to a person at a terminal.

The desktop reads the exit codes (windows_runtime.rs exit_failure) and the `code:` prefix of stderr: both stay.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
INSTALLER = ROOT / "scripts" / "install.ps1"
PUBLIC_INSTALLER = ROOT / "web" / "public" / "install.ps1"
ENABLER = ROOT / "scripts" / "enable-podman-windows-runtime.ps1"
GUIDES = (ROOT / "docs" / "guides" / "QUICKSTART.md", ROOT / "docs" / "guides" / "AI-AGENT-INTEGRATION.md")
APP_INSTALLER_URLS = ("https://apps.microsoft.com/detail/9nblggh4nns1", "https://aka.ms/getwinget")


def _runtime_files(text: str) -> str:
    start = text.index("function Get-RuntimeFiles")
    return text[start : text.index("# ── Step 4:", start)]


# ---------------------------------------------------------------------------
# What the script says and does, read from the real file
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("installer", [INSTALLER, PUBLIC_INSTALLER], ids=["scripts", "web"])
def test_a_missing_winget_is_no_stop_of_the_installer_the_enabler_has_a_way_out(installer):
    # JHT-T184 / JHT-T144: winget is no longer a requirement. The installer does not stop before the first folder for it,
    # and the one place that decides is the enabler (winget, or Podman for this user from the official release).
    runtime = _runtime_files(installer.read_text(encoding="utf-8"))
    assert "Get-Command winget" not in runtime
    assert "winget is required to install Podman dependencies" not in installer.read_text(encoding="utf-8")
    # the next step for a Podman that could not be installed still names both ways, and is the one the app reads
    text = installer.read_text(encoding="utf-8")
    problem = text[text.index("function Show-PodmanSetupProblem") :]
    problem = problem[problem.index("21 {") : problem.index("22 {")]
    assert "winget" in problem and "github.com" in problem and "$again" in problem


def test_the_folders_a_stopped_run_created_are_removed_again_but_never_recursively():
    text = INSTALLER.read_text(encoding="utf-8")
    runtime = _runtime_files(text)
    assert runtime.index("$script:JhtCreatedDirs =") < runtime.index("New-Item -ItemType Directory -Force -Path $RuntimeDir")
    helper = text[text.index("function Remove-JhtCreatedEmptyDirs") : text.index("function Write-Fail")]
    assert "[IO.Directory]::Delete($dir)" in helper and "-Recurse" not in helper
    # Write-Fail and a failed enabler both clean up before they leave
    assert "Remove-JhtCreatedEmptyDirs" in text[text.index("function Write-Fail") : text.index("function Write-Step")]
    assert runtime.index("Show-PodmanSetupProblem") < runtime.index("Remove-JhtCreatedEmptyDirs") < runtime.index("exit $script:EnablerExitCode")


def test_the_enabler_exit_code_still_reaches_the_app_after_the_staging_folder_is_gone():
    runtime = _runtime_files(INSTALLER.read_text(encoding="utf-8"))
    assert runtime.index("Remove-Item -LiteralPath $stage -Recurse -Force") < runtime.index("exit $script:EnablerExitCode")
    function = INSTALLER.read_text(encoding="utf-8")
    function = function[function.index("function Invoke-PodmanRuntimeEnabler") : function.index("function Show-PodmanSetupProblem")]
    assert "$script:EnablerExitCode = if ($null -eq $code)" in function and "exit" not in function


@pytest.mark.parametrize("installer", [INSTALLER, PUBLIC_INSTALLER], ids=["scripts", "web"])
def test_an_enabler_that_left_without_an_exit_code_is_a_failure_not_a_go_on(installer):
    text = installer.read_text(encoding="utf-8")
    function = text[text.index("function Invoke-PodmanRuntimeEnabler") : text.index("function Show-PodmanSetupProblem")]
    assert "$script:EnablerExitCode = if ($null -eq $code) { 1 } else { $code }" in function
    assert "$script:EnablerExitCode = $code\n" not in function


@pytest.mark.parametrize(("code", "kept"), [("$null", "1"), ("0", "0"), ("21", "21"), ("25", "25")])
def test_the_exit_code_the_installer_leaves_with_follows_the_enabler_s(tmp_path, code, kept):
    text = INSTALLER.read_text(encoding="utf-8")
    line = next(candidate for candidate in text.splitlines() if candidate.strip().startswith("$script:EnablerExitCode = if ($null -eq $code)"))
    body = f"$code = {code}\n{line.strip()}\n[Console]::Out.WriteLine('KEPT=' + $script:EnablerExitCode)\n"
    result = _run(tmp_path, INSTALLER, [], body)
    assert result.returncode == 0, result.stderr
    assert f"KEPT={kept}" in result.stdout.splitlines(), result.stdout


def test_every_enabler_exit_code_has_a_next_step():
    text = INSTALLER.read_text(encoding="utf-8")
    block = text[text.index("function Show-PodmanSetupProblem") : text.index("# ── Step 3")] if "# ── Step 3" in text else ""
    block = block or text[text.index("function Show-PodmanSetupProblem") :]
    for code in (21, 22, 23, 24, 25):
        assert re.search(rf"(?m)^\s+{code} \{{", block), code
    assert "default {" in block
    assert block.count("Write-JhtProblem") >= 6
    assert "run the same install command again" in block.lower() or "Run the same install command again" in block


def test_the_enabler_tells_the_same_in_its_own_message():
    text = ENABLER.read_text(encoding="utf-8")
    # no winget at all is no stop any more: Podman for this user from the official release (JHT-T184)
    assert "winget is required to install Podman dependencies" not in text
    assert "$viaZip = -not (Use-Winget)" in text
    # still the line the app and the other tests read
    assert 'podman_not_installable: $($_.Exception.Message)")\n  exit 21' in text


@pytest.mark.parametrize("guide", GUIDES, ids=lambda path: path.name)
def test_the_guides_list_winget_among_the_windows_requirements(guide):
    text = guide.read_text(encoding="utf-8")
    start = text.index("iwr -useb https://jobhunterteam.ai/install.ps1")
    window = text[max(0, start - 900) : start + 2600]
    assert "winget" in window and "App Installer" in window
    assert any(url in window for url in APP_INSTALLER_URLS)


# ---------------------------------------------------------------------------
# What it prints and removes, run by pwsh on the real functions
# ---------------------------------------------------------------------------

PRELUDE = r"""
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($env:JHT_UNDER_TEST, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "parse: $($errors[0])" }
# the sentences are said in the person's language: T and Get-JhtTextLanguage come with any function, when the script has them
foreach ($name in @('Get-JhtTextLanguage', 'T')) {
  $fn = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name }, $true)
  if ($fn) { . ([scriptblock]::Create($fn.Extent.Text)) }
}
foreach ($name in ($env:JHT_IMPORT -split ',')) {
  if (-not $name) { continue }
  $fn = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name }, $true)
  if (-not $fn) { throw "function $name missing" }
  . ([scriptblock]::Create($fn.Extent.Text))
}
. ([scriptblock]::Create($env:JHT_CASE_BODY))
exit 0
"""


def _pwsh() -> str:
    found = os.environ.get("JHT_TEST_PWSH") or shutil.which("pwsh")
    if found:
        return found
    if os.environ.get("CI"):
        pytest.fail("pwsh is missing on the CI runner: the installer's messages would go untested")
    pytest.skip("pwsh not installed")


def _run(tmp_path: Path, under_test: Path, imports: list[str], body: str, extra_env: dict[str, str] | None = None):
    prelude = tmp_path / "prelude.ps1"
    prelude.write_text(PRELUDE, encoding="utf-8")
    env = {
        "PATH": f"/usr/bin{os.pathsep}/bin",
        "HOME": str(tmp_path),
        "JHT_UNDER_TEST": str(under_test),
        "JHT_IMPORT": ",".join(imports),
        "JHT_CASE_BODY": body,
        **(extra_env or {}),
    }
    for key in ("SystemRoot", "SYSTEMROOT", "TEMP", "TMP"):
        if key in os.environ:
            env[key] = os.environ[key]
    return subprocess.run(
        [_pwsh(), "-NoLogo", "-NoProfile", "-NonInteractive", "-File", str(prelude)],
        env=env, capture_output=True, text=True, timeout=120,
    )


@pytest.mark.parametrize("script", [INSTALLER, ENABLER], ids=["install", "enabler"])
@pytest.mark.parametrize(
    ("machine_output", "shown"),
    [("1", True), ("0", False), (None, True)],
    ids=["asked-for", "refused", "unset-and-piped-is-the-app"],
)
def test_phase_lines_follow_who_is_reading(tmp_path, script, machine_output, shown):
    # The subprocess' output is a pipe, as the desktop's is: unset, the line comes out.
    body = "Write-JhtPhase wsl_check\n[Console]::Out.WriteLine('AFTER')\n"
    extra = {} if machine_output is None else {"JHT_MACHINE_OUTPUT": machine_output}
    result = _run(tmp_path, script, ["Write-JhtPhase"], body, extra)
    assert result.returncode == 0, result.stderr
    lines = result.stdout.splitlines()
    assert ("JHT_PHASE wsl_check" in lines) is shown, result.stdout
    assert "AFTER" in lines


@pytest.mark.parametrize("script", [INSTALLER, ENABLER], ids=["install", "enabler"])
def test_phase_time_line_only_when_asked_and_after_the_phase_line(tmp_path, script):
    body = "Write-JhtPhase wsl_check\n[Console]::Out.WriteLine('AFTER')\n"
    plain = _run(tmp_path, script, ["Write-JhtPhase"], body, {"JHT_MACHINE_OUTPUT": "1"})
    assert plain.returncode == 0, plain.stderr
    assert "JHT_TIME" not in plain.stdout
    timed = _run(tmp_path, script, ["Write-JhtPhase"], body, {"JHT_MACHINE_OUTPUT": "1", "JHT_PHASE_TIMES": "1"})
    lines = timed.stdout.splitlines()
    assert lines[0] == "JHT_PHASE wsl_check" and lines[-1] == "AFTER", timed.stdout
    assert re.fullmatch(r"JHT_TIME \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ wsl_check", lines[1]), lines
    refused = _run(tmp_path, script, ["Write-JhtPhase"], body, {"JHT_MACHINE_OUTPUT": "0", "JHT_PHASE_TIMES": "1"})
    assert "JHT_TIME" not in refused.stdout


def test_a_problem_says_what_went_wrong_and_what_to_do_now(tmp_path):
    body = "Write-JhtProblem -What 'It broke.' -Todo @('Do this first.', 'Then run it again.')\n"
    result = _run(tmp_path, INSTALLER, ["Write-JhtProblem"], body, {"JHT_LANG": "en"})
    assert result.returncode == 0, result.stderr
    out = result.stdout
    assert "x It broke." in out
    assert out.index("x It broke.") < out.index("What to do now:") < out.index("Do this first.") < out.index("Then run it again.")


def test_a_problem_without_a_next_step_does_not_invent_one(tmp_path):
    result = _run(tmp_path, INSTALLER, ["Write-JhtProblem"], "Write-JhtProblem -What 'Only the cause.'\n", {"JHT_LANG": "en"})
    assert result.returncode == 0, result.stderr
    assert "x Only the cause." in result.stdout and "What to do now:" not in result.stdout


def test_the_empty_folders_of_the_run_go_and_nothing_else(tmp_path):
    made = tmp_path / "Job Hunter Team"
    runtime = made / "host-runtime"
    kept = tmp_path / "kept"
    nonempty = tmp_path / "nonempty" / "inner"
    for folder in (runtime, kept, nonempty):
        folder.mkdir(parents=True)
    (tmp_path / "nonempty" / "file.txt").write_text("mine", encoding="utf-8")
    created = [made, runtime, nonempty, tmp_path / "nonempty", tmp_path / "never-made"]
    body = (
        "$script:JhtCreatedDirs = @(" + ",".join(f"'{path}'" for path in created) + ")\n"
        "Remove-JhtCreatedEmptyDirs\n"
        "'LEFT=' + @($script:JhtCreatedDirs).Count\n"
    )
    result = _run(tmp_path, INSTALLER, ["Remove-JhtCreatedEmptyDirs"], body)
    assert result.returncode == 0, result.stderr
    assert not runtime.exists() and not made.exists(), "the empty ones, deepest first, are gone"
    assert kept.exists(), "a folder the run did not create is untouched"
    assert (tmp_path / "nonempty" / "file.txt").read_text(encoding="utf-8") == "mine"
    assert not nonempty.exists() and (tmp_path / "nonempty").exists(), "a folder holding a file stays"
