"""Il wrapper PowerShell scarica sull'host (vedi anche test_download_is_verified_on_the_host.py) e il resto del suo contratto."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BASH_WRAPPER = ROOT / "scripts" / "jht-wrapper.sh"
POWERSHELL_WRAPPER = ROOT / "scripts" / "jht-wrapper.ps1"
WINDOWS_INSTALLER = ROOT / "scripts" / "install.ps1"
WINDOWS_ACL_SELFTEST = ROOT / "scripts" / "windows-config-acl-selftest.ps1"
WINDOWS_ACL_WORKFLOW = ROOT / ".github" / "workflows" / "windows-config-acl.yml"


def test_powershell_wrapper_downloads_on_the_host_and_publishes_without_clobbering():
    source = POWERSHELL_WRAPPER.read_text()
    for seam in (
        "function Invoke-HostDownload",
        "[IO.File]::Move($part, $destination)",
        "Get-FileHash",
        "'download' {",
        "$env:JHT_RELEASE_BASE_URL",
    ):
        assert seam in source


def test_powershell_wrapper_forwards_detached_compose_flag_as_a_literal():
    source = POWERSHELL_WRAPPER.read_text(encoding="utf-8")
    assert "Invoke-Compose up -d" not in source
    # the three whole ups, and on Podman the up of each service in turn before them (T85)
    assert source.count("Invoke-Compose 'up' '-d'") == 4
    assert source.count("Invoke-Compose 'up' '-d' $service") == 1


def test_powershell_download_exit_code_cannot_degrade_to_zero():
    source = POWERSHELL_WRAPPER.read_text()
    function = source[source.index("function Invoke-HostDownload") : source.index(
        "# ── Upgrade runtime", source.index("function Invoke-HostDownload")
    )]
    dispatcher = source[source.index("# ── Dispatcher") :]

    # Function stdout and numeric return share one PowerShell stream. The
    # dispatcher therefore consumes a dedicated scalar, initialized nonzero,
    # instead of assigning the output plus the return value to `$code`.
    assert "$script:HostDownloadExitCode = 1" in function
    assert "$script:HostDownloadExitCode = 0" in function
    assert "Invoke-HostDownload $Rest\n    exit $script:HostDownloadExitCode" in dispatcher
    assert "$code = Invoke-HostDownload" not in dispatcher
    # the progress of the download cannot become an error either: it is switched off for the call
    assert "$ProgressPreference = 'SilentlyContinue'" in function and "$ProgressPreference = $previousProgress" in function


def test_windows_cmd_shim_propagates_powershell_exit_code_on_both_paths():
    source = WINDOWS_INSTALLER.read_text()
    shim = source[source.index('$shimContent = @"') : source.index('"@', source.index('$shimContent = @"'))]
    assert "if errorlevel 1 goto jht_windows_powershell" in shim
    assert ":jht_windows_powershell" in shim
    assert shim.count("exit /b %errorlevel%") == 2


def test_windows_clean_install_publishes_acl_helper_and_attests_exact_bytes_before_up():
    source = WINDOWS_INSTALLER.read_text(encoding="utf-8")
    runtime_files = source[source.index("function Get-RuntimeFiles") : source.index(
        "# ── Step 4:", source.index("function Get-RuntimeFiles")
    )]
    # Every executable/config input is staged from one immutable release. The
    # enabler verifies the image before publishing the attested Podman bundle.
    for seam in (
        "'docker-compose.podman.yml' = (Join-Path $stage 'docker-compose.podman.yml')",
        "'scripts/windows-private-acl.ps1' = (Join-Path $stageScripts 'windows-private-acl.ps1')",
        "'scripts/enable-podman-windows-runtime.ps1' = (Join-Path $stageScripts 'enable-podman-windows-runtime.ps1')",
        'Get-File -Url "$releaseBase/$relative"',
        "[scriptblock]::Create((Get-Content -LiteralPath (Join-Path $stageScripts $ps1) -Raw))",
        "Invoke-PodmanRuntimeEnabler -ScriptPath",
        ". $helperDest",
        "Test-PrivateJhtHomeAcl -Path $JhtHome",
        "Podman runtime artifact missing",
    ):
        assert seam in runtime_files

    assert runtime_files.index('Get-File -Url "$releaseBase/$relative"') < runtime_files.index(
        "Invoke-PodmanRuntimeEnabler -ScriptPath"
    )
    assert "Remove-Item -LiteralPath $stage -Recurse -Force" in runtime_files
    assert "Set-JhtNodeOwner -Path $RuntimeDir" in runtime_files
    for protected_node in (
        "docker-compose.yml",
        "docker-compose.podman.yml",
        "container-runtime",
        "podman-machine",
        "jht-container.service",
        ".runtime-integrity",
        "$wrapperDest",
        "$helperDest",
        "docker.exe",
        "runtime-image",
    ):
        assert protected_node in runtime_files
    assert "Set-JhtNodeOwner -Path $published" in runtime_files
    assert runtime_files.index("Set-JhtNodeOwner -Path $published") < runtime_files.index(
        ". $helperDest"
    )
    assert "Set-JhtNodeOwner -Path $shimDest" in runtime_files


def test_windows_acl_gate_smokes_e03_clean_start_through_docker_dispatch():
    smoke = WINDOWS_ACL_SELFTEST.read_text(encoding="utf-8")
    workflow = WINDOWS_ACL_WORKFLOW.read_text(encoding="utf-8")

    for seam in (
        "Get-RuntimeFiles",
        "$installedHelperHash -ne $sourceHelperHash",
        "$manifestValues.'windows-private-acl.ps1' -ne $installedHelperHash",
        "$podmanManifestBytes = [IO.File]::ReadAllBytes($manifest)",
        "$dockerManifestText = \"version=1`ndocker-compose.yml=",
        "Set-JhtNodeOwner -Path $manifest",
        "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $installedWrapper up",
        "mount_repaired /jht_home",
        "mount_repaired /jht_user",
        "empty mount-repair output was accepted",
        "empty mount-repair output reached compose up",
        "empty mount-repair failed before reaching Docker",
        "--security-opt no-new-privileges",
        "-File $installedWrapper onboarding-snapshot",
        "desktop onboarding snapshot schema changed",
        "E03 CLEAN_START installer-helper-smoke PASS",
    ):
        assert seam in smoke
    assert smoke.index("$dockerManifestText =") < smoke.index("$env:JHT_CONTAINER_RUNTIME = 'docker'")
    assert smoke.index("[IO.File]::WriteAllBytes($manifest, $podmanManifestBytes)") < smoke.index(
        "# E04 MANIFEST"
    )
    assert "./scripts/windows-config-acl-selftest.ps1" in workflow
    for watched in (
        "scripts/install.ps1",
        "scripts/windows-private-acl.ps1",
        "web/public/install.ps1",
    ):
        assert watched in workflow
