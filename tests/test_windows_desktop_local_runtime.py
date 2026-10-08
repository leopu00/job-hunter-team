"""Static contracts between the Windows desktop and its PowerShell runtime."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WRAPPER = ROOT / "scripts" / "jht-wrapper.ps1"
INSTALLER = ROOT / "scripts" / "install.ps1"


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
    helper = text[text.index('Write-Info "Downloading windows-private-acl.ps1') : text.index('Write-Info "Downloading jht-wrapper.ps1')]
    assert ". $helperDest" in helper
    assert "Test-PrivateJhtHomeAcl -Path $JhtHome" in helper
