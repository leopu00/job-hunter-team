"""Contracts for the opt-in Windows Podman compatibility probe."""

from pathlib import Path
import shutil
import subprocess

import pytest


ROOT = Path(__file__).resolve().parents[1]
PROBE = ROOT / "scripts" / "podman-windows-probe.ps1"
NETWORK = ROOT / "scripts" / "configure-podman-windows-network.ps1"
ENABLE = ROOT / "scripts" / "enable-podman-windows-runtime.ps1"
PROXY = ROOT / "scripts" / "wsl-interop-connect-proxy.py"
PODMAN_COMPOSE = ROOT / "docker-compose.podman.yml"
SECURE_CONFIG_IO = ROOT / "cli" / "src" / "lib" / "secure-config-io.js"


def test_probe_uses_a_native_path_shim_and_leaves_product_call_sites_untouched():
    source = PROBE.read_text(encoding="utf-8")

    assert "-OutputType ConsoleApplication" in source
    assert "Join-Path $shimDir 'docker.exe'" in source
    assert 'FileName = PodmanPath' in source
    assert '$env:PATH = "$shimDir$([IO.Path]::PathSeparator)$script:OriginalPath"' in source
    assert "Get-Command docker -CommandType Application" in source
    assert "Select-Object -First 1).Source" in source
    assert "$probeJhtHome = Join-Path $probeHome '.jht'" in source


def test_probe_keeps_system_mutation_explicit_and_scoped():
    source = PROBE.read_text(encoding="utf-8")

    assert "if ($InstallDependencies) { Install-ProbeDependencies }" in source
    assert source.index("Update-ProcessPath", source.index("try {")) < source.index(
        "Get-RequiredCommandPath -Name 'podman'"
    )
    assert "if (-not $InitializeMachine)" in source
    assert "'Podman.CLI'" in source
    assert "'Docker.DockerCompose'" in source
    assert "Docker.DockerDesktop" not in source
    assert "'--scope', 'user'" not in source
    assert "machine reset" not in source
    assert "machine rm" not in source
    assert "$env:COMPOSE_PROJECT_NAME = 'jht-podman-probe-'" in source


def test_probe_exercises_the_documented_compatibility_seams():
    source = PROBE.read_text(encoding="utf-8")

    for seam in (
        "'compose' 'version'",
        "'config' '--quiet'",
        "'up' '-d'",
        "host-to-container.txt",
        "container-to-host.txt",
        "host.docker.internal",
        "https://ghcr.io/v2/",
        "'/opt/jht-deps'",
        "'/jht_home/runtime'",
        "'volume' 'inspect'",
        "'restart'",
        "down --volumes",
    ):
        assert seam in source

    assert source.index("docker inspect jht") < source.index("'up' '-d'")
    assert "refusing to replace it" in source


@pytest.mark.skipif(shutil.which("pwsh") is None, reason="PowerShell is unavailable")
def test_probe_is_valid_powershell():
    command = (
        "$errors=$null; "
        "[void][System.Management.Automation.Language.Parser]::ParseFile("
        f"'{PROBE.as_posix()}', [ref]$null, [ref]$errors); "
        "if ($errors.Count) { $errors | ForEach-Object { Write-Error $_ }; exit 1 }"
    )
    result = subprocess.run(
        [shutil.which("pwsh"), "-NoProfile", "-Command", command],
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stderr


def test_persistent_network_config_uses_native_connector_and_localhost_proxy():
    source = NETWORK.read_text(encoding="utf-8")
    proxy = PROXY.read_text(encoding="utf-8")

    assert "function Invoke-Checked" in source
    assert "Invoke-Checked $Podman '--connection' $MachineName 'info'" in source
    assert "JhtWindowsConnect" in source
    assert "repeated configuration run" in source
    assert "-OutputType ConsoleApplication" in source
    assert "--bind 127.0.0.1" in source
    assert "WantedBy=multi-user.target" in source
    assert "jht-rootless-podman.service" in source
    assert "system service --time=0 unix:///run/user/1000/podman/podman.sock" in source
    assert "Requires=user-runtime-dir@1000.service" in source
    assert "CONTAINERS_CGROUP_MANAGER=cgroupfs" in source
    assert "sudo systemctl restart jht-windows-egress-proxy.service" in source
    assert "https://ghcr.io/v2/" in source
    assert "--node" not in proxy
    assert "[self.server.connector, host, str(port)]" in proxy


def test_podman_compose_preserves_private_bind_mount_ownership():
    source = PODMAN_COMPOSE.read_text(encoding="utf-8")

    assert 'userns_mode: "keep-id:uid=1001,gid=1001"' in source
    assert "network_mode: host" in source


def test_private_config_atomic_rename_tolerates_host_acl_filesystems():
    source = SECURE_CONFIG_IO.read_text(encoding="utf-8")

    assert "v9fs/DrvFS" in source
    assert "try { chmodSync(tmp, PRIVATE_FILE_MODE); } catch" in source
    assert source.index("try { chmodSync(tmp") < source.index("renameSync(tmp, path)")


@pytest.mark.skipif(shutil.which("pwsh") is None, reason="PowerShell is unavailable")
def test_network_config_is_valid_powershell():
    command = (
        "$errors=$null; "
        "[void][System.Management.Automation.Language.Parser]::ParseFile("
        f"'{NETWORK.as_posix()}', [ref]$null, [ref]$errors); "
        "if ($errors.Count) { $errors | ForEach-Object { Write-Error $_ }; exit 1 }"
    )
    result = subprocess.run(
        [shutil.which("pwsh"), "-NoProfile", "-Command", command],
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stderr


def test_runtime_enabler_attests_shim_override_and_persists_selection():
    source = ENABLE.read_text(encoding="utf-8")
    wrapper = (ROOT / "scripts" / "jht-wrapper.ps1").read_text(encoding="utf-8")

    assert "JhtPodmanDockerShim" in source
    assert "docker-compose.podman.yml=$podmanHash" in source
    assert "docker.exe=$shimHash" in source
    assert "container-runtime=$selectionHash" in source
    assert "podman-machine=$machineHash" in source
    assert "jht-container.service=$containerUnitHash" in source
    assert "SetEnvironmentVariable('JHT_CONTAINER_RUNTIME', 'podman', 'User')" in source
    assert "Repair-LegacyBindMetadata" in source
    assert "$ContainerRuntime" in wrapper
    assert "& docker compose @files" in wrapper
    assert "docker-compose.podman.yml" in wrapper
    assert "$RuntimeSelectionFile" in wrapper
    assert "$ContainerUnitFile" in wrapper
    assert "if (-not $env:HOME) { $env:HOME = $env:USERPROFILE }" in wrapper
    assert "$env:COMPOSE_PROJECT_NAME = 'jht'" in wrapper
    assert "HostConfig.CgroupManager" in source
    assert "$existingCgroupManager -ne 'cgroupfs'" in source
    assert "Migrated existing JHT container" in source
    assert "'rm' 'jht'" in source
    assert "[string[]]$Rest" in wrapper


def test_runtime_enabler_installs_persistent_container_lifecycle():
    source = ENABLE.read_text(encoding="utf-8")

    assert "Description=Job Hunter Team container" in source
    assert "Requires=jht-windows-egress-proxy.service" in source
    assert "After=jht-windows-egress-proxy.service" in source
    assert "Requires=jht-rootless-podman.service" in source
    assert "ExecStart=/usr/bin/podman --remote --url unix:///run/user/1000/podman/podman.sock start jht" in source
    assert "ExecStop=-/usr/bin/podman --remote --url unix:///run/user/1000/podman/podman.sock stop --time 30 jht" in source
    assert "WantedBy=multi-user.target" in source
    assert "sudo systemctl enable jht-container.service" in source
    assert "sudo systemctl start jht-container.service" in source


@pytest.mark.skipif(shutil.which("pwsh") is None, reason="PowerShell is unavailable")
def test_runtime_enabler_is_valid_powershell():
    command = (
        "$errors=$null; "
        "[void][System.Management.Automation.Language.Parser]::ParseFile("
        f"'{ENABLE.as_posix()}', [ref]$null, [ref]$errors); "
        "if ($errors.Count) { $errors | ForEach-Object { Write-Error $_ }; exit 1 }"
    )
    result = subprocess.run(
        [shutil.which("pwsh"), "-NoProfile", "-Command", command],
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize(
    "shell",
    [candidate for candidate in (shutil.which("powershell"), shutil.which("pwsh")) if candidate],
)
def test_native_shim_compiles_and_propagates_backend_exit_code(shell, tmp_path):
    shim = tmp_path / "docker.exe"
    command = (
        "$tokens=$null; $errors=$null; "
        f"$ast=[System.Management.Automation.Language.Parser]::ParseFile('{PROBE.as_posix()}',"
        "[ref]$tokens,[ref]$errors); "
        "$fn=$ast.Find({param($node) $node -is "
        "[System.Management.Automation.Language.FunctionDefinitionAst] -and "
        "$node.Name -eq 'New-DockerShim'}, $true); "
        "Invoke-Expression $fn.Extent.Text; "
        f"New-DockerShim -Destination '{shim.as_posix()}' -PodmanPath $env:ComSpec; "
        f"& '{shim.as_posix()}' /d /c exit 23; "
        "$code=$LASTEXITCODE; "
        "if ($code -ne 23) { throw \"shim returned $code instead of 23\" }"
    )
    result = subprocess.run(
        [shell, "-NoProfile", "-Command", command],
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stderr
