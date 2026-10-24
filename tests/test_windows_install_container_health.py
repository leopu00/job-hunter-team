"""install.ps1 does not say «Installation complete!» over containers that are not up (T130).

A real run on a standard Windows account (24/10) ended with exit 0 while the broker restarted in a loop
("exec /usr/local/bin/jht-broker failed") and the Telegram service had exited 127: `jht up` reports that
the containers were created, not that they stay up. The enabler, right after `jht up`, now reads each
container of the compose file and waits until it has run under one single start for a few seconds; what
is not so is the failure of the setup, named per container.

The function ran on Windows PowerShell 5.1 (standard account) with a native fake of podman.exe: all up =
nothing returned; broker in a loop + Telegram exit 127 = both named after the deadline; a container that
is not there = named. Here the contract is read from the sources.

The runtime-image pin is written only by a test install (-PersistImagePin, with the test channel): a
production install has no such file, the wrapper and the app accept the runtime without it, and the
image is the one in the compose file.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENABLER = (ROOT / "scripts/enable-podman-windows-runtime.ps1").read_text(encoding="utf-8")
INSTALL = (ROOT / "scripts/install.ps1").read_text(encoding="utf-8")
WRAPPER = (ROOT / "scripts/jht-wrapper.ps1").read_text(encoding="utf-8")


def _function() -> str:
    begin = ENABLER.index("function Get-UnsettledJhtContainers {")
    return ENABLER[begin : ENABLER.index("function Install-PrivateComposeProvider {", begin)]


def test_the_setup_checks_the_containers_after_up_and_before_the_boot_service():
    up = ENABLER.index("& (Join-Path $BinDir 'jht.ps1') up")
    check = ENABLER.index("Get-UnsettledJhtContainers -Podman $Podman -MachineName $MachineName")
    service = ENABLER.index("Install-JhtContainerService -PodmanPath")
    assert up < check < service
    call = ENABLER[check:service]
    assert 'if ($unsettledContainers.Count -gt 0) { throw "runtime_containers_unhealthy: ' in call
    # the containers are the ones the compose file declares, the three of them in the repo's file
    wanted = ENABLER[up:check]
    for name in ("'jht'", "'jht-broker'", "'jht-telegram'"):
        assert name in wanted
    assert "docker-compose.yml" in wanted
    compose = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    for name in ("jht", "jht-broker", "jht-telegram"):
        assert f"\n  {name}:\n" in compose


def test_a_container_counts_only_after_it_ran_under_one_start():
    body = _function()
    assert "'{{.State.Status}}|{{.State.ExitCode}}|{{.State.StartedAt}}'" in body
    # a new StartedAt (a restart) starts the count again, a state other than running drops it
    assert "$runningSince[$name].Start -ne $parts[2]" in body
    assert "$runningSince.Remove($name)" in body
    assert "-lt $SettleSeconds" in body
    assert "-ge $TimeoutSeconds" in body
    # the native call runs in its own Continue block, stderr dropped (PowerShell 5.1 under Stop, T82)
    assert "& { $ErrorActionPreference = 'Continue'; & $Podman --connection $MachineName inspect" in body
    assert "2>$null })" in body


def test_the_runtime_image_pin_is_a_test_install_file_only():
    assert "if ($TestChannel) { $enablerArgs += '-PersistImagePin' }" in INSTALL
    assert INSTALL.count("-PersistImagePin") == 1
    persist = ENABLER[ENABLER.index("if ($PersistImagePin) {") :]
    persist = persist[: persist.index("$manifest = ")]
    assert "WriteAllText($runtimeImageFile" in persist
    assert "Remove-Item -LiteralPath $runtimeImageFile" in persist.split("} else {")[1]
    # without the file the wrapper expects no `runtime-image` key and runs the compose file's image
    assert "if ($pinPresent) { $expectedKeys += 'runtime-image' }" in WRAPPER
    assert "if ($pinDeclared -ne $pinPresent) { return $false }" in WRAPPER
