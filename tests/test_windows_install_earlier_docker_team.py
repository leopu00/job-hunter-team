"""install.ps1 stops before anything changes when an earlier JHT still has its team on Docker Desktop.

Up to 0.3.9 JHT on Windows ran on Docker Desktop: the container `jht` of the Compose project of the runtime folder, with
`restart: unless-stopped`. Since 0.4 the team runs in a Podman machine; installed next to a 0.3.9 container there would be two
teams on the same ~/.jht and Documents. The installer recognises the old container (named jht or jht-..., with the working_dir
label of this runtime folder, when Docker answers), says which commands stop and remove it and what stays, and leaves with 85
(runtime_change_requires_migration, as install.sh on the Mac). It never runs docker stop or rm itself. No Docker, a Docker that
does not answer, or a container of someone else: the installation goes on.

The functions are taken from the REAL script through the PowerShell AST, with a fake docker.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from windows_native_fakes import WINDOWS, install_fake, powershell_argv, windows_env

ROOT = Path(__file__).resolve().parent.parent
INSTALLER = ROOT / "scripts" / "install.ps1"
PUBLIC_INSTALLER = ROOT / "web" / "public" / "install.ps1"
IMAGE = "registry.example/old-team:0.3.9"

PRELUDE = r"""
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($env:JHT_UNDER_TEST, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "parse: $($errors[0])" }
foreach ($name in ($env:JHT_IMPORT -split ',')) {
  $fn = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name }, $true)
  if (-not $fn) { throw "function $name missing" }
  . ([scriptblock]::Create($fn.Extent.Text))
}
$RuntimeDir = $env:JHT_CASE_RUNTIME
$BinDir = $env:JHT_CASE_BIN
$JhtHome = $env:JHT_CASE_HOME
$RuntimeChangeRequiresMigrationExit = 85
$LegacyDockerTimeoutSeconds = 3
$script:JhtCreatedDirs = @()
Assert-NoLegacyDockerTeam
[Console]::Out.WriteLine('INSTALL_GOES_ON')
exit 0
"""

FUNCTIONS = ["Get-JhtLegacyDockerCli", "Invoke-JhtLegacyDocker", "Test-JhtDockerOwnEngine", "Get-JhtLegacyDockerTeam", "Assert-NoLegacyDockerTeam",
             "Test-JhtMachineOutput", "Write-JhtProblem", "Remove-JhtCreatedEmptyDirs", "T", "Get-JhtTextLanguage"]


DOCKER_DESKTOP = "Docker Desktop 4.50.0 (209931)|Engine;containerd;runc;docker-init;"
PODMAN = "linux/amd64/fedora-42|Podman Engine;Conmon;OCI Runtime (crun);"


def _fake_docker(directory: Path, log: Path, *, ps: str = "", ps_code: int = 0, hang: bool = False, server: str = DOCKER_DESKTOP) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "ps.txt").write_text(ps, encoding="utf-8")
    (directory / "server.txt").write_text(server + "\n", encoding="utf-8")
    script = (
        "#!/bin/sh\n"
        f"printf '%s\\n' \"$*\" >> '{log.as_posix()}'\n"
        + ("sleep 30\n" if hang else "")
        + 'case "$1" in\n'
        f"  version) cat '{(directory / 'server.txt').as_posix()}' ;;\n"
        f"  ps) [ {ps_code} = 0 ] || {{ echo 'Cannot connect to the Docker daemon' >&2; exit {ps_code}; }}; cat '{(directory / 'ps.txt').as_posix()}' ;;\n"
        "  volume) printf 'host-runtime_jht-deps\\nhost-runtime_jht-runtime-mask\\n' ;;\n"
        "  *) exit 9 ;;\n"
        "esac\n"
    )
    install_fake(directory, "docker", script)


def _run(tmp_path: Path, *, lang: str = "it", machine: str = "0", docker_dir: Path | None = None):
    runtime = tmp_path / "user" / "AppData" / "Local" / "Job Hunter Team" / "host-runtime"
    runtime.mkdir(parents=True, exist_ok=True)
    prelude = tmp_path / "prelude.ps1"
    prelude.write_text(PRELUDE, encoding="utf-8")
    paths = [str(docker_dir)] if docker_dir else []
    if WINDOWS:
        env = windows_env(tmp_path)
        env["PATH"] = os.pathsep.join(paths + [str(Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32")])
    else:
        env = {"PATH": os.pathsep.join(paths + ["/usr/bin", "/bin"]), "HOME": str(tmp_path)}
    env.update({
        "JHT_UNDER_TEST": str(INSTALLER), "JHT_IMPORT": ",".join(FUNCTIONS), "JHT_LANG": lang, "JHT_MACHINE_OUTPUT": machine,
        "JHT_CASE_RUNTIME": str(runtime), "JHT_CASE_BIN": str(tmp_path / "user" / ".local" / "bin"),
        "JHT_CASE_HOME": str(tmp_path / "user" / ".jht"),
    })
    env.pop("ProgramFiles", None)
    import subprocess
    done = subprocess.run([*powershell_argv(), "-File", str(prelude)], env=env, capture_output=True, text=True, timeout=120)
    return done, runtime


def _line(name: str, state: str, workdir: str, project: str = "host-runtime") -> str:
    labels = f"com.docker.compose.config-hash=abc,com.docker.compose.project={project},com.docker.compose.project.working_dir={workdir},com.docker.compose.service=jht"
    return f"{name}|{state}|{IMAGE}|{labels}\n"


def _ours(tmp_path: Path, state: str) -> str:
    runtime = tmp_path / "user" / "AppData" / "Local" / "Job Hunter Team" / "host-runtime"
    return _line("jht", state, str(runtime))


@pytest.mark.parametrize("state", ["running", "exited"])
def test_an_old_team_on_docker_stops_the_installer_with_the_commands_and_what_stays(tmp_path, state):
    log = tmp_path / "docker-calls"
    _fake_docker(tmp_path / "fake", log, ps=_ours(tmp_path, state))
    done, _ = _run(tmp_path, docker_dir=tmp_path / "fake")
    out = done.stdout
    assert done.returncode == 85, done.stdout + done.stderr
    assert "INSTALL_GOES_ON" not in out
    assert ("gira ancora" in out) == (state == "running") and ("fermo; ripartirebbe con Docker Desktop" in out) == (state != "running"), out
    assert "ci sarebbero due team sugli stessi dati. Non e' stato cambiato niente." in out
    for line in ("docker stop jht", "docker rm jht", "docker volume rm host-runtime_jht-deps host-runtime_jht-runtime-mask",
                 f"docker image rm {IMAGE}", "Poi rilancia questo installer.", "I tuoi dati restano: ~/.jht",
                 "la chiave API salvata dal setup, la password della posta e i token di Telegram", "vanno ridati con jht setup"):
        assert line in out, line
    # the installer only asks: it never stops or removes anything
    calls = log.read_text(encoding="utf-8").splitlines()
    assert [c.split()[0] for c in calls] == ["version", "ps", "volume"], calls
    assert calls[2].startswith("volume ls --filter label=com.docker.compose.project=host-runtime"), calls


def test_in_english_and_for_the_app(tmp_path):
    _fake_docker(tmp_path / "fake", tmp_path / "log", ps=_ours(tmp_path, "running"))
    done, _ = _run(tmp_path, lang="en", docker_dir=tmp_path / "fake")
    assert done.returncode == 85
    assert "an earlier Job Hunter Team is still running on Docker Desktop (container jht)" in done.stdout
    assert "Then run this installer again." in done.stdout
    app, _ = _run(tmp_path, lang="en", machine="1", docker_dir=tmp_path / "fake")
    assert app.returncode == 85
    assert app.stderr.startswith("runtime_change_requires_migration: an earlier JHT container on Docker Desktop (jht)"), app.stderr


@pytest.mark.parametrize("case", ["no docker", "docker does not answer", "docker hangs", "container of another folder",
                                  "another name", "no compose labels", "podman answers the docker api", "engine not told"])
def test_otherwise_the_installation_goes_on(tmp_path, case):
    fake = tmp_path / "fake"
    other = str(tmp_path / "elsewhere" / "host-runtime")
    if case == "no docker":
        fake = None
    elif case == "docker does not answer":
        _fake_docker(fake, tmp_path / "log", ps=_ours(tmp_path, "running"), ps_code=1)
    elif case == "docker hangs":
        _fake_docker(fake, tmp_path / "log", ps=_ours(tmp_path, "running"), hang=True)
    elif case == "container of another folder":
        _fake_docker(fake, tmp_path / "log", ps=_line("jht", "running", other))
    elif case == "another name":
        runtime = tmp_path / "user" / "AppData" / "Local" / "Job Hunter Team" / "host-runtime"
        _fake_docker(fake, tmp_path / "log", ps=_line("myjht", "running", str(runtime)) + _line("jhtx y", "running", str(runtime)))
    elif case == "podman answers the docker api":
        # Podman on the docker_engine pipe: the team it sees is this JHT 0.4's own, in the same runtime folder
        _fake_docker(fake, tmp_path / "log", ps=_ours(tmp_path, "running"), server=PODMAN)
    elif case == "engine not told":
        _fake_docker(fake, tmp_path / "log", ps=_ours(tmp_path, "running"), server="")
    else:
        _fake_docker(fake, tmp_path / "log", ps=f"jht|running|{IMAGE}|maintainer=someone\n")
    done, _ = _run(tmp_path, docker_dir=fake)
    assert done.returncode == 0, done.stdout + done.stderr
    assert "INSTALL_GOES_ON" in done.stdout


def test_the_docker_of_jht_itself_is_not_docker_desktop(tmp_path):
    runtime = tmp_path / "user" / "AppData" / "Local" / "Job Hunter Team" / "host-runtime"
    shim = runtime / "bin"
    _fake_docker(shim, tmp_path / "log", ps=_ours(tmp_path, "running"))
    done, _ = _run(tmp_path, docker_dir=shim)
    assert done.returncode == 0, done.stdout + done.stderr
    assert not (tmp_path / "log").exists()


def test_the_check_runs_before_anything_changes_and_the_public_copy_is_the_same():
    source = INSTALLER.read_text(encoding="utf-8")
    main = source[source.index("Show-Header\nTest-System\n"):]
    assert main.index("Assert-NoLegacyDockerTeam") < main.index("Test-WindowsSubsystem") < main.index("Get-RuntimeFiles")
    check = source[source.index("function Assert-NoLegacyDockerTeam"):source.index("function Test-JhtMachineOutput")]
    for verb in ("'stop'", "'rm'", "'kill'", "'down'", "'remove'"):
        assert verb not in check, verb
    assert PUBLIC_INSTALLER.read_bytes() == INSTALLER.read_bytes()
