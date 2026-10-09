"""Static contracts between the Windows desktop and its PowerShell runtime."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WRAPPER = ROOT / "scripts" / "jht-wrapper.ps1"
INSTALLER = ROOT / "scripts" / "install.ps1"
ENABLER = ROOT / "scripts" / "enable-podman-windows-runtime.ps1"
ACL_SELFTEST = ROOT / "scripts" / "windows-config-acl-selftest.ps1"
PODMAN_COMPOSE = ROOT / "docker-compose.podman.yml"
PODMAN_PROBE = ROOT / "scripts" / "podman-windows-probe.ps1"
SECURE_CONFIG_IO = ROOT / "cli" / "src" / "lib" / "secure-config-io.js"


def _wrapper() -> str:
    return WRAPPER.read_text(encoding="utf-8")


def test_desktop_protocol_markers_and_dispatch_are_published():
    text = _wrapper()
    for marker in (
        "$JHT_HOST_RUNTIME_PROTOCOL = 1",
        "$JHT_DESKTOP_CHAT_PROTOCOL = 1",
        "$JHT_ONBOARDING_SNAPSHOT_PROTOCOL = 1",
    ):
        assert marker in text
    assert "'onboarding-snapshot' {\n    Write-OnboardingSnapshot\n    exit 0" in text
    assert "'desktop-chat' {\n    Invoke-DesktopChat $Rest\n    exit $script:DesktopChatExitCode" in text


def test_onboarding_snapshot_is_read_only_and_has_the_exact_ordered_schema():
    text = _wrapper()
    start = text.index("function Write-OnboardingSnapshot")
    end = text.index("$script:DesktopChatExitCode", start)
    snapshot = text[start:end]
    keys = (
        "runtimeInstalled",
        "containerRunning",
        "providerConfigured",
        "providerAuthenticated",
        "assistantWelcomed",
        "assistantRunning",
        "captainRunning",
        "profileReady",
    )
    output = snapshot[snapshot.rindex("foreach ($line in @(") :]
    positions = [output.index(key) for key in keys]
    assert positions == sorted(positions)
    assert "Test-RuntimeBundleTrusted" in snapshot
    assert "Get-RunningComposeServiceId $Container" in snapshot
    for forbidden in ("Ensure-Up", "Invoke-Compose 'up'", "Repair-MountOwnership"):
        assert forbidden not in snapshot


def test_desktop_chat_uses_stdin_and_a_closed_session_allowlist():
    text = _wrapper()
    start = text.index("function Invoke-DesktopChat")
    end = text.index("function Test-BrokerUp", start)
    chat = text[start:end]
    assert "& docker exec -i $containerId python3 -c" in chat
    assert "sys.stdin.buffer.readline()" in chat
    assert "& docker exec -i $containerId sh -c" in chat
    assert "msg=$(cat); exec jht-tmux-send" in chat
    for session in ("CAPITANO", "ASSISTENTE", "MENTOR", "SCOUT-1", "ANALISTA-1", "SCORER-1", "SCRITTORE-1", "CRITICO"):
        assert f"'{session}'" in chat
    assert "$script:DesktopChatExitCode = 2" in chat


def test_redirected_oauth_never_requests_a_tty():
    text = _wrapper()
    flags = text[text.index("if ([Console]::IsInputRedirected") : text.index("# ── Dispatcher")]
    assert "$ExecFlags = @('-i')" in flags
    assert "$ExecFlags = @('-it')" in flags
    oauth = text[text.index("# OAuth login:") : text.index("# Setup:", text.index("# OAuth login:"))]
    assert oauth.count("docker exec @ExecFlags") == 3
    assert "docker exec -it" not in oauth


def test_installer_has_an_explicit_noninteractive_desktop_mode_and_acl_gate():
    text = INSTALLER.read_text(encoding="utf-8")
    assert "[switch]$SkipOnboard" in text
    assert "if ($SkipOnboard)   { return $false }" in text
    runtime = text[text.index("function Get-RuntimeFiles") : text.index("# ── Step 4:")]
    assert "'scripts/windows-private-acl.ps1'" in runtime
    assert ". $helperDest" in runtime
    assert "Test-PrivateJhtHomeAcl -Path $JhtHome" in runtime


def test_test_channel_is_all_or_nothing_and_precedes_every_io():
    text = INSTALLER.read_text(encoding="utf-8")
    for parameter in ("$SourceSha", "$Image", "$ExpectedImageDigest"):
        assert parameter in text
    validation = text.index("$channelValues =")
    assert validation < text.index("$LocalAppData =")
    assert "exit 2" in text[validation : text.index("# ── Config")]
    runtime = text[text.index("function Get-RuntimeFiles") : text.index("# ── Step 4:")]
    assert 'https://raw.githubusercontent.com/leopu00/job-hunter-team/$SourceSha' in runtime
    assert runtime.index("if ($TestChannel)") < runtime.index("elseif ($RawBaseOverride)")


def test_windows_installer_exposes_stable_podman_phases_and_exit_codes():
    installer = INSTALLER.read_text(encoding="utf-8")
    enabler = (ROOT / "scripts" / "enable-podman-windows-runtime.ps1").read_text(encoding="utf-8")
    for phase in (
        "wsl_check",
        "podman_install",
        "podman_machine_init",
        "podman_machine_start",
        "runtime_download",
        "image_pull",
    ):
        assert f"'{phase}'" in installer or f"{phase}" in enabler
    assert "exit 20" in installer
    assert "exit 21" in enabler
    assert "exit 22" in enabler
    assert "'--provider' 'wsl'" in enabler
    assert "'--cpus' '2' '--memory' '3072' '--disk-size' '30'" in enabler
    assert "machine' 'start' '--update-connection=false'" in enabler


def test_existing_game_data_is_deliberately_reused_with_a_mail_rotation_warning():
    enabler = (ROOT / "scripts" / "enable-podman-windows-runtime.ps1").read_text(encoding="utf-8")
    assert "Join-Path $JhtHome 'jht.config.json'" in enabler
    assert "Join-Path $JhtHome 'profile'" in enabler
    assert "Join-Path $JhtHome '.codex'" in enabler
    assert "Existing JHT config, profile and Codex login will be reused" in enabler
    assert "rotate that app password" in enabler


def test_pinned_test_image_is_attested_and_wins_over_environment():
    wrapper = _wrapper()
    enabler = (ROOT / "scripts" / "enable-podman-windows-runtime.ps1").read_text(encoding="utf-8")
    assert "runtime-image=$runtimeImageHash" in enabler
    assert "Pulled runtime image does not expose the expected repository digest" in enabler
    assert "$values.ContainsKey('runtime-image')" in wrapper
    assert "$values.'runtime-image' -ne $pinHash" in wrapper
    assert "$env:JHT_IMAGE = $script:TrustedRuntimeImage" in wrapper
    assert "Canale di test: si aggiorna reinstallando dalla build di test" in wrapper


def test_installer_and_wrapper_publish_the_same_podman_manifest_contract():
    wrapper = _wrapper()
    enabler = (ROOT / "scripts" / "enable-podman-windows-runtime.ps1").read_text(encoding="utf-8")
    required = (
        "docker-compose.yml",
        "jht-wrapper.ps1",
        "windows-private-acl.ps1",
        "docker-compose.podman.yml",
        "docker.exe",
        "container-runtime",
        "podman-machine",
        "jht-container.service",
    )
    writer = wrapper[
        wrapper.index("function Write-RuntimeManifest") : wrapper.index(
            "function Test-RuntimeBundleTrusted"
        )
    ]
    for key in required:
        assert f"{key}=" in writer
        assert f"{key}=" in enabler
    assert "runtime-image=$runtimeImageHash" in writer
    assert "runtime-image=$runtimeImageHash" in enabler
    assert "Test-Path -LiteralPath $RuntimeImageFile -PathType Leaf" in writer
    trust = wrapper[
        wrapper.index("function Test-RuntimeBundleTrusted") : wrapper.index(
            "function Install-ProtectedRuntimeFromRelease"
        )
    ]
    assert "$values.Count -ne $expectedKeys.Count" in trust
    assert "$_ -notin $expectedKeys" in trust


def test_only_explicit_up_wakes_the_podman_machine():
    wrapper = _wrapper()
    wake = wrapper[wrapper.index("function Start-PodmanMachineForUp") : wrapper.index("function Require-ComposeFile")]
    assert "machine start --update-connection=false" in wake
    dispatcher = wrapper[wrapper.index("switch ($Sub)") :]
    assert dispatcher.count("Start-PodmanMachineForUp") == 1
    up = dispatcher[dispatcher.index("@('up', 'start-container')") : dispatcher.index("@('down', 'stop-container')")]
    assert up.index("Start-PodmanMachineForUp") < up.index("Require-Docker")


def test_declining_dependency_installation_cannot_run_winget():
    """The desktop owns consent; without its opt-in flag scripts install nothing."""
    enabler = ENABLER.read_text(encoding="utf-8")
    guarded = enabler[
        enabler.index("if ($InstallDependencies) {") : enabler.index(
            "Update-ProcessPath", enabler.index("if ($InstallDependencies) {")
        )
    ]
    assert enabler.count("Invoke-Checked 'winget' 'install'") == 2
    assert guarded.count("Invoke-Checked 'winget' 'install'") == 2
    assert "'--source' 'winget' '--version' $PodmanCliVersion" in guarded
    assert "'--source' 'winget' '--version' $ComposeProviderVersion" in guarded
    assert "$PodmanCliVersion = '6.0.2'" in enabler
    assert "$ComposeProviderVersion = '5.1.2'" in enabler


def test_podman_failures_reach_the_documented_exit_codes():
    enabler = ENABLER.read_text(encoding="utf-8")
    dependency_failure = enabler[
        enabler.index("if ($InstallDependencies) {") : enabler.index(
            "$machines =", enabler.index("if ($InstallDependencies) {")
        )
    ]
    machine_failure = enabler[
        enabler.index("$machines =") : enabler.index(
            "configure-podman-windows-network.ps1", enabler.index("$machines =")
        )
    ]
    assert "[Console]::Error.WriteLine" in dependency_failure
    assert "exit 21" in dependency_failure
    assert "Write-Error" not in dependency_failure
    assert "[Console]::Error.WriteLine" in machine_failure
    assert "exit 22" in machine_failure
    assert "Write-Error" not in machine_failure


def test_an_unrelated_podman_machine_does_not_replace_the_jht_machine():
    enabler = ENABLER.read_text(encoding="utf-8")
    machine = enabler[enabler.index("$machines =") : enabler.index("} catch {", enabler.index("$machines ="))]
    assert "$machines | Where-Object Name -eq $MachineName" in machine
    assert "'machine' 'init' '--provider' 'wsl'" in machine
    assert "'--disk-size' '30' $MachineName" in machine
    assert "machine reset" not in machine
    assert "'machine' 'rm'" not in machine


def test_a_stopped_docker_desktop_distro_is_never_selected_or_started():
    installer = INSTALLER.read_text(encoding="utf-8")
    enabler = ENABLER.read_text(encoding="utf-8")
    runtime_path = installer + enabler
    assert "docker-desktop" not in runtime_path.lower()
    assert "Docker.DockerDesktop" not in runtime_path
    assert "'-MachineName', 'jht-podman'" in installer
    assert "'--provider' 'wsl'" in enabler


def test_the_dedicated_machine_budget_fits_the_low_memory_test_host():
    enabler = ENABLER.read_text(encoding="utf-8")
    assert "'--cpus' '2' '--memory' '3072' '--disk-size' '30'" in enabler
    assert 3072 < int(4.9 * 1024)


def test_mount_repair_accepts_a_quoted_windows_path_with_spaces():
    selftest = ACL_SELFTEST.read_text(encoding="utf-8")
    assert "Documents\\Job Hunter Team" in selftest
    assert ':/jht_home"?' in selftest
    assert ':/jht_user"?' in selftest


def test_container_lifecycle_is_detached_from_the_desktop_process():
    enabler = ENABLER.read_text(encoding="utf-8")
    unit = enabler[enabler.index("$containerUnit = @'") : enabler.index("'@", enabler.index("$containerUnit = @'") + 20)]
    assert "Type=oneshot" in unit
    assert "RemainAfterExit=yes" in unit
    assert "ExecStart=/usr/bin/podman --remote" in unit
    assert "start --sig-proxy=false jht" in unit
    assert "WantedBy=multi-user.target" in unit
    assert "sudo systemctl enable jht-container.service" in enabler


def test_keep_id_closes_the_atomic_jht_config_rename_regression():
    compose = PODMAN_COMPOSE.read_text(encoding="utf-8")
    probe = PODMAN_PROBE.read_text(encoding="utf-8")
    secure_io = SECURE_CONFIG_IO.read_text(encoding="utf-8")
    assert 'userns_mode: "keep-id:uid=1001,gid=1001"' in compose
    assert "fs.renameSync(t,p)" in probe
    assert "stat -c %u /jht_home/jht.config.json" in probe
    assert "test ! -e /jht_home/.jht.config.tmp" in probe
    assert secure_io.index("chmodSync(tmp") < secure_io.index("renameSync(tmp, path)")
