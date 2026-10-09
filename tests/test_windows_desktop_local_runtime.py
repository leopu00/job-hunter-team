"""Static contracts between the Windows desktop and its PowerShell runtime."""

from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
WRAPPER = ROOT / "scripts" / "jht-wrapper.ps1"
INSTALLER = ROOT / "scripts" / "install.ps1"
ENABLER = ROOT / "scripts" / "enable-podman-windows-runtime.ps1"
ACL_SELFTEST = ROOT / "scripts" / "windows-config-acl-selftest.ps1"
PRIVATE_ACL = ROOT / "scripts" / "windows-private-acl.ps1"
PODMAN_COMPOSE = ROOT / "docker-compose.podman.yml"
PODMAN_PROBE = ROOT / "scripts" / "podman-windows-probe.ps1"
PODMAN_NETWORK = ROOT / "scripts" / "configure-podman-windows-network.ps1"
SECURE_CONFIG_IO = ROOT / "cli" / "src" / "lib" / "secure-config-io.js"
ONBOARDING = ROOT / "desktop" / "src-tauri" / "src" / "onboarding.rs"
WINDOWS_RUNTIME = ROOT / "desktop" / "src-tauri" / "src" / "windows_runtime.rs"
RUNTIME_HOST = ROOT / "desktop" / "src-tauri" / "src" / "runtime_host.rs"
ERROR_CATALOG = ROOT / "desktop" / "src" / "lib" / "error-catalog.ts"
ERROR_LOCALES = ROOT / "desktop" / "src" / "lib" / "error-catalog.locales.ts"


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


def test_wsl_preflight_is_hidden_actionable_and_retried_on_the_next_prepare():
    onboarding = ONBOARDING.read_text(encoding="utf-8")
    begin = onboarding.index("fn install_local_windows(")
    install = onboarding[begin : onboarding.index("fn download_verified_bytes", begin)]
    preflight = install.index("wsl_state(run_program(")
    reuse = install.index("if let Some(wrapper) = wrapper_path(app)")
    download = install.index("download_verified_bytes(")
    assert preflight < reuse < download
    assert 'wsl.to_str().ok_or_else(|| failure("wsl_not_ready"))?' in install
    assert '["--status"]' in install
    assert "Duration::from_secs(30)" in install

    runtime = WINDOWS_RUNTIME.read_text(encoding="utf-8")
    assert 'Err("wsl_not_ready")' in runtime[runtime.index("pub(crate) fn wsl_state") :]
    host = RUNTIME_HOST.read_text(encoding="utf-8")
    run_program = host[host.index("pub(crate) fn run_program<I, S>") :]
    assert "hide_console(&mut command);" in run_program
    assert "const CREATE_NO_WINDOW: u32 = 0x0800_0000" in host

    # Rust transports the stable key and its retryability; the localized
    # sentence lives in the desktop catalog. Do not couple this contract to
    # failure()'s internal representation.
    contract = onboarding[
        onboarding.index("fn local_runtime_prepare_errors_preserve_sanitized_contract") :
    ]
    assert '"wsl_not_ready",' in contract
    assert 'assert_eq!(serialized["retryable"], true)' in contract
    prepare = onboarding[onboarding.index("pub(crate) async fn onboarding_prepare(") :]
    assert prepare.index("let result =") < prepare.index("state.preparing.store(false")

    catalog = ERROR_CATALOG.read_text(encoding="utf-8")
    wsl_copy = catalog[catalog.index("wsl_not_ready: copy(") : catalog.index("podman_not_ready: copy(")]
    assert "Microsoft Store" in wsl_copy
    assert "riavvia il computer e premi Riprova" in wsl_copy
    assert "restart the computer and press Try again" in wsl_copy
    locales = ERROR_LOCALES.read_text(encoding="utf-8")
    translated = locales[locales.index('"WSL is not ready:') : locales.index('"The installed team version', locales.index('"WSL is not ready:'))]
    for locale in ("de:", "es:", "fr:", "hu:", "pt:"):
        assert locale in translated


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


def test_windows_onboarding_delegates_restart_to_wrapper_up():
    onboarding = ONBOARDING.read_text(encoding="utf-8")
    begin = onboarding.index("fn start_and_verify_local_container_with")
    start = onboarding[begin : onboarding.index("fn prepare_impl", begin)]
    assert "run(LocalCliOperation::Up, PREPARE_TIMEOUT)" in start
    assert "podman.exe" not in start
    assert "machine start" not in start


def test_windows_logon_starts_machine_then_systemd_restores_the_whole_team():
    enabler = ENABLER.read_text(encoding="utf-8")
    network = PODMAN_NETWORK.read_text(encoding="utf-8")
    install_service = enabler.index("Install-JhtContainerService -PodmanPath")
    install_task = enabler.index("Install-JhtStartupTask -PodmanPath", install_service)
    assert install_service < install_task
    assert "New-ScheduledTaskTrigger -AtLogOn -User $UserId" in enabler
    assert "New-ScheduledTaskPrincipal -UserId $UserId -LogonType Interactive -RunLevel Limited" in enabler
    assert '"machine start --update-connection=false $MachineName"' in enabler
    assert "start --sig-proxy=false jht-broker jht-telegram jht" in enabler
    assert "stop --time 30 jht jht-telegram jht-broker" in enabler
    assert "systemctl enable --no-reload $runtimeServices" in network
    # $runtimeServices is $egressServices plus the rootless API service.
    enabled = network[network.index("$egressServices = ") : network.index("$unitInstall = ")]
    for service in (
        "jht-windows-egress-proxy.service",
        "jht-windows-egress-proxy-broker.service",
        "jht-windows-egress-proxy-telegram.service",
        "jht-rootless-podman.service",
    ):
        assert service in enabled
    assert "Restart=always" in network
    assert '--connector "$connectorWsl"' in network
    assert "Job Hunter Team - Start runtime" in _wrapper()


def test_windows_install_never_needs_an_elevated_token_to_write_acls():
    # A normal user's install.ps1 (the desktop app is never elevated) stopped
    # on ~/.jht with PrivilegeNotHeldException (SeSecurityPrivilege): on a
    # target whose access rules are already protected, Windows PowerShell's
    # Set-Acl writes the SACL too. Only changed sections are persisted now.
    for path in (INSTALLER, PRIVATE_ACL, ENABLER):
        source = path.read_text(encoding="utf-8")
        code = "\n".join(
            line for line in source.splitlines() if not line.lstrip().startswith("#")
        )
        assert not re.search(r"\bSet-Acl\b", code), path.name
    for path in (INSTALLER, PRIVATE_ACL):
        source = path.read_text(encoding="utf-8")
        helper = source[source.index("function Set-JhtAccessControl") :]
        helper = helper[: helper.index("\n}\n")]
        assert "[IO.FileSystemAclExtensions]::SetAccessControl($item, $Acl)" in helper
        assert "$item.SetAccessControl($Acl)" in helper
    enabler = ENABLER.read_text(encoding="utf-8")
    assert enabler.index(". $helperSource") < enabler.index("Protect-OwnerOnlyDirectory -Path $RuntimeDir\n")
    # The installer's own copy keeps SYSTEM and Administrators, like the helper.
    installer = INSTALLER.read_text(encoding="utf-8")
    assert "'NT AUTHORITY\\\\SYSTEM'" not in installer
    assert "'NT AUTHORITY\\SYSTEM'" in installer
    selftest = ACL_SELFTEST.read_text(encoding="utf-8")
    assert "@('Set-JhtAccessControl', 'Protect-JhtHomeAcl', 'Set-JhtNodeOwner')" in selftest


def test_windows_install_never_reloads_systemd_inside_the_machine():
    # On a Windows 10 test PC (09/10/2026) the reload implied by
    # `systemctl enable` never finished inside the Podman WSL machine: systemd
    # stopped answering and the installer hung on `podman machine ssh`.
    enabler = ENABLER.read_text(encoding="utf-8")
    network = PODMAN_NETWORK.read_text(encoding="utf-8")
    for source in (enabler, network):
        code = "\n".join(
            line for line in source.splitlines() if not line.lstrip().startswith("#")
        )
        assert "daemon-reload" not in code
        assert "daemon-reexec" not in code
        for verb in ("enable", "disable"):
            for match in re.finditer(rf"systemctl {verb}\b", code):
                assert code[match.end() :].startswith(" --no-reload"), code[match.start() : match.start() + 80]
        for match in re.finditer(r"sudo (?:timeout \d+ )?systemctl", code):
            assert match.group().startswith("sudo timeout "), code[match.start() : match.start() + 80]
    # A unit systemd already holds and that changed is picked up by a
    # machine restart, and the services are awaited after it.
    restart = network[network.index("JHT_MACHINE_RESTART' }") :]
    assert restart.index("'machine' 'stop' $MachineName") < restart.index("'machine' 'start' '--update-connection=false' $MachineName")
    assert "systemctl is-active --quiet $runtimeServices" in restart
    assert "AddSeconds(120)" in restart


def test_podman_docker_shim_is_private_and_does_not_touch_docker_desktop():
    enabler = ENABLER.read_text(encoding="utf-8")
    wrapper = _wrapper()
    installer = INSTALLER.read_text(encoding="utf-8")
    app_runtime = WINDOWS_RUNTIME.read_text(encoding="utf-8")

    assert "$RuntimeShimDir = Join-Path $RuntimeDir 'bin'" in enabler
    assert "$shim = Join-Path $RuntimeShimDir 'docker.exe'" in enabler
    assert "$RuntimeShimDir = Join-Path $RuntimeDir 'bin'" in wrapper
    assert "$DockerShim = Join-Path $RuntimeShimDir 'docker.exe'" in wrapper
    assert '$env:PATH = "$RuntimeShimDir$([IO.Path]::PathSeparator)$env:PATH"' in wrapper
    assert "(Join-Path $RuntimeDir 'bin\\docker.exe')" in installer
    assert '("docker.exe", Place::Runtime, "bin/docker.exe")' in app_runtime
    assert "(Join-Path $BinDir 'docker.exe')" not in installer

    # A healthy older install is migrated, but an unattested file with that
    # generic name is never deleted.
    assert "Test-AttestedLegacyDockerShim" in enabler
    assert "if ($legacyShimOwned)" in enabler
    assert "Remove-Item -LiteralPath $legacyShim" in enabler

    windows_podman = "\n".join((enabler, installer))
    for forbidden in (
        "Docker.DockerDesktop",
        "docker-desktop",
        "docker context",
        "DOCKER_HOST",
        "wsl --terminate",
        "wsl --unregister",
    ):
        assert forbidden not in windows_podman


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
    assert "'machine' 'init' '--update-connection=false' '--provider' 'wsl'" in machine
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
    assert "start --sig-proxy=false jht-broker jht-telegram jht" in unit
    assert "WantedBy=multi-user.target" in unit
    assert "systemctl enable --no-reload jht-container.service" in enabler


def test_keep_id_closes_the_atomic_jht_config_rename_regression():
    compose = PODMAN_COMPOSE.read_text(encoding="utf-8")
    probe = PODMAN_PROBE.read_text(encoding="utf-8")
    secure_io = SECURE_CONFIG_IO.read_text(encoding="utf-8")
    assert 'userns_mode: "keep-id:uid=1001,gid=1001"' in compose
    assert "fs.renameSync(t,p)" in probe
    assert "stat -c %u /jht_home/jht.config.json" in probe
    assert "test ! -e /jht_home/.jht.config.tmp" in probe
    assert secure_io.index("chmodSync(tmp") < secure_io.index("renameSync(tmp, path)")
