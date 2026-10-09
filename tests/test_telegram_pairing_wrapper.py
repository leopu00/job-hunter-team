"""Host pairing keeps the new Telegram token outside the agent container."""

from __future__ import annotations

import errno
import os
import pty
import re
import select
import shutil
import signal
import subprocess
import termios
import time
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
WRAPPER = ROOT / "scripts" / "jht-wrapper.sh"
POWERSHELL_WRAPPER = ROOT / "scripts" / "jht-wrapper.ps1"
POWERSHELL = shutil.which("pwsh") or shutil.which("powershell")
SECRET = "987654:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef"
DIGEST = "a" * 64
# Asked on every pairing, fresh or not: an agent of an earlier release may have
# removed an exposed token from the config before the inventory could see it.
NEW_TOKEN_REMINDER = "Usa sempre un token appena generato in BotFather"
LEGACY_CONFIG_TEXT = '{"channels": {"telegram": {"bots": {"assistente": {"bot_token": "x"}}}}}'
# json.load in legacy.py reads UTF-8, UTF-16 and UTF-32 (with or without BOM),
# so a byte-level check must not take any of them for a config without Telegram.
LEGACY_CONFIG_ENCODINGS = {
    "utf16-le-bom": b"\xff\xfe" + LEGACY_CONFIG_TEXT.encode("utf-16-le"),
    "utf16-be-bom": b"\xfe\xff" + LEGACY_CONFIG_TEXT.encode("utf-16-be"),
    "utf32-le-bom": b"\xff\xfe\x00\x00" + LEGACY_CONFIG_TEXT.encode("utf-32-le"),
    "utf32-be-bom": b"\x00\x00\xfe\xff" + LEGACY_CONFIG_TEXT.encode("utf-32-be"),
    "utf16-le-without-bom": LEGACY_CONFIG_TEXT.encode("utf-16-le"),
    # A BOM alone, with no NUL byte after it, still starts the inventory.
    "utf16-le-bom-without-nul": b"\xff\xfe\x41\x41",
    "utf16-be-bom-without-nul": b"\xfe\xff\x41\x41",
}

FAKE_DOCKER = r"""#!/bin/sh
printf 'ARGV %s\n' "$*" >> "$FAKE_LOG"
[ "$1" = run ] && {
  case "$*" in
    *"jht-telegram-legacy.py inventory assistente") [ -z "$FAKE_DIGEST" ] || printf '%s\n' "$FAKE_DIGEST" ;;
    *"jht-telegram-legacy.py remove assistente") printf 'REMOVED\n' >> "$FAKE_LOG" ;;
    *"jht-telegram-legacy.py remaining") exit "${FAKE_REMAINING_RC:-0}" ;;
    *) exit 96 ;;
  esac
  exit 0
}
[ "$1" = exec ] || exit 0
shift
interactive=0
while [ $# -gt 0 ]; do
  case "$1" in -i|-it) interactive=1; shift ;; -u|--user) shift 2 ;; *) break ;; esac
done
target="$1"; shift
case "$target:$*" in
  telegram-id:"jht-telegram-admin legacy remember assistente")
    value=$(cat)
    [ "$value" = "$FAKE_DIGEST" ] || { printf 'LEGACY_STDIN_MISMATCH\n' >> "$FAKE_LOG"; exit 99; }
    printf '{"ok":true,"legacy":"assistente","state":"remembered"}\n' ;;
  telegram-id:"jht-telegram-admin cutover status")
    [ "$interactive" -eq 0 ] || cat >/dev/null
    printf '{"ok":true,"cutover":{"enabled":false}}\n' ;;
  telegram-id:"jht-telegram-admin bots pair assistente"*)
    value=$(cat)
    [ "$value" = "$EXPECTED_PAYLOAD" ] || { printf 'TELEGRAM_STDIN_MISMATCH\n' >> "$FAKE_LOG"; exit 98; }
    printf 'TELEGRAM_STDIN_OK\n' >> "$FAKE_LOG"
    printf '{"ok":true,"bot":"assistente","state":"present","rotation":"rotated"}\n' ;;
  telegram-id:"jht-telegram-admin cutover enable") printf '{"ok":true,"cutover":"enabled"}\n' ;;
  *) exit 97 ;;
esac
"""


def functions(*names: str) -> str:
    source = WRAPPER.read_text(encoding="utf-8")
    found = []
    for name in names:
        match = re.search(rf"^{name}\(\) \{{\n.*?^\}}\n", source, re.S | re.M)
        assert match, name
        found.append(match.group(0))
    return "\n".join(found)


def powershell_functions(*names: str) -> str:
    source = POWERSHELL_WRAPPER.read_text(encoding="utf-8")
    found = []
    for name in names:
        match = re.search(rf"^function {name} \{{\n.*?^\}}\n", source, re.S | re.M)
        assert match, name
        found.append(match.group(0))
    return "\n".join(found)


def pair_script() -> str:
    return (
        'set -u\nerr() { echo "error: $*" >&2; }\nwarn() { echo "warn: $*" >&2; }\n'
        'info() { echo "info: $*" >&2; }\n'
        'read_only_container_id() { echo agent-id; }\n'
        'read_only_service_id() { [ "$1" = jht-telegram ] && echo telegram-id; }\n'
        'compose() { printf "COMPOSE %s\\n" "$*" >> "$FAKE_LOG"; }\n'
        'TELEGRAM_SERVICE=jht-telegram\nCONTAINER_SERVICE=jht\n'
        'CONTAINER_RUNTIME=docker\nHOME=/host-home\n'
        + functions("telegram_admin", "telegram_admin_input", "telegram_legacy", "read_hidden_tty", "telegram_pair")
        + '\ntelegram_image() { printf "fake-image\\n"; }\n'
        + '\ntelegram_pair assistente\n'
    )


def prepare_inventory_script(*, inventory_fails: bool = False) -> str:
    legacy = "return 42" if inventory_fails else ":"
    return (
        "set -u\n"
        'compose() { printf "COMPOSE %s\\n" "$*" >> "$FAKE_LOG"; }\n'
        'telegram_admin() { return 1; }\n'
        'telegram_admin_input() { value=$(cat); printf "REMEMBER %s bytes=%s\\n" "$*" "${#value}" >> "$FAKE_LOG"; }\n'
        'telegram_legacy() { ' + legacy + '; }\n'
        'read_only_container_id() { return 3; }\n'
        'TELEGRAM_SERVICE=jht-telegram\nCONTAINER_SERVICE=jht\n'
        + functions("telegram_legacy_sources_present", "telegram_prepare_legacy_inventory")
        + "\ntelegram_prepare_legacy_inventory\n"
    )


def legacy_home(tmp_path: Path, config: str | None = '{"channels": {"telegram": {"bots": {}}}}') -> Path:
    home = tmp_path / "jht-home"
    home.mkdir()
    if config is not None:
        (home / "jht.config.json").write_text(config, encoding="utf-8")
    return home


def run_prepare_inventory(home: Path, log: Path, **kwargs: bool) -> subprocess.CompletedProcess[str]:
    log.touch()
    return subprocess.run(
        ["bash", "-c", prepare_inventory_script(**kwargs)],
        capture_output=True,
        text=True,
        env={**os.environ, "FAKE_LOG": str(log), "JHT_HOME_HOST": str(home)},
    )


def test_empty_legacy_inventory_is_persisted_before_agent_start(tmp_path: Path) -> None:
    log = tmp_path / "calls.log"
    done = run_prepare_inventory(legacy_home(tmp_path), log)

    assert done.returncode == 0, done.stderr
    assert log.read_text(encoding="utf-8").splitlines() == [
        "COMPOSE up -d jht-telegram",
        "REMEMBER legacy remember assistente bytes=0",
        "REMEMBER legacy remember capitano bytes=0",
        "REMEMBER legacy remember mentor bytes=0",
    ]


def test_legacy_inventory_read_failure_still_fails_closed(tmp_path: Path) -> None:
    log = tmp_path / "calls.log"
    done = run_prepare_inventory(legacy_home(tmp_path), log, inventory_fails=True)

    assert done.returncode != 0
    assert "REMEMBER" not in log.read_text(encoding="utf-8")


@pytest.mark.parametrize(
    "config",
    [None, '{"model": "x", "channels": {}}'],
    ids=["clean-install", "config-without-telegram"],
)
def test_install_without_telegram_starts_without_the_isolated_service(tmp_path: Path, config: str | None) -> None:
    log = tmp_path / "calls.log"
    done = run_prepare_inventory(legacy_home(tmp_path, config), log, inventory_fails=True)

    assert done.returncode == 0, done.stderr
    assert log.read_text(encoding="utf-8") == ""


def test_missing_jht_home_starts_without_the_isolated_service(tmp_path: Path) -> None:
    log = tmp_path / "calls.log"
    done = run_prepare_inventory(tmp_path / "absent", log, inventory_fails=True)

    assert done.returncode == 0, done.stderr
    assert log.read_text(encoding="utf-8") == ""


@pytest.mark.parametrize(
    "layout",
    ["escaped-key", "model-pin-backup", "credential-file", "unreadable-config", *LEGACY_CONFIG_ENCODINGS],
)
def test_any_possible_legacy_source_still_requires_the_inventory(tmp_path: Path, layout: str) -> None:
    home = legacy_home(tmp_path, '{"model": "x"}')
    if layout == "escaped-key":
        (home / "jht.config.json").write_text('{"channels": {"\\u0074elegram": {}}}', encoding="utf-8")
    elif layout == "model-pin-backup":
        (home / "jht.config.json.bak-model-pin-1").write_text('{"channels": {"telegram": {}}}', encoding="utf-8")
    elif layout == "credential-file":
        (home / "credentials").mkdir()
        (home / "credentials" / "telegram_bot.json").write_text("{}", encoding="utf-8")
    elif layout in LEGACY_CONFIG_ENCODINGS:
        (home / "jht.config.json").write_bytes(LEGACY_CONFIG_ENCODINGS[layout])
    else:
        (home / "jht.config.json").chmod(0)
    log = tmp_path / "calls.log"
    try:
        done = run_prepare_inventory(home, log, inventory_fails=True)
    finally:
        (home / "jht.config.json").chmod(0o600)

    assert done.returncode != 0
    assert log.read_text(encoding="utf-8").splitlines() == ["COMPOSE up -d jht-telegram"]


def test_pairing_sends_new_token_only_to_isolated_admin(tmp_path: Path) -> None:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    docker = bin_dir / "docker"
    docker.write_text(FAKE_DOCKER, encoding="utf-8")
    docker.chmod(0o755)
    log = tmp_path / "calls.log"
    script = pair_script()
    payload = f'{{"bot_token":"{SECRET}","chat_id":"42"}}'
    done = subprocess.run(
        ["bash", "-c", script],
        input=payload,
        text=True,
        capture_output=True,
        env={
            **os.environ,
            "PATH": f"{bin_dir}:{os.environ['PATH']}",
            "FAKE_LOG": str(log),
            "FAKE_DIGEST": DIGEST,
            "EXPECTED_PAYLOAD": payload,
        },
    )
    assert done.returncode == 0, done.stderr
    calls = log.read_text(encoding="utf-8")
    assert "TELEGRAM_STDIN_OK" in calls
    assert SECRET not in calls
    assert "agent-id" not in calls
    assert calls.index("COMPOSE stop jht") < calls.index("jht-telegram-legacy.py inventory assistente")
    assert calls.index("jht-telegram-legacy.py inventory assistente") < calls.index("legacy remember assistente")
    assert "REMOVED" in calls
    assert "COMPOSE restart jht-telegram" in calls
    assert "COMPOSE restart jht" in calls
    status = next(line for line in calls.splitlines() if "cutover status" in line)
    assert " -i " not in f" {status} "
    pair = next(line for line in calls.splitlines() if "bots pair" in line)
    assert " -i " in f" {pair} "


def test_pairing_does_not_cut_over_while_another_legacy_bot_remains(tmp_path: Path) -> None:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    docker = bin_dir / "docker"
    docker.write_text(FAKE_DOCKER, encoding="utf-8")
    docker.chmod(0o755)
    log = tmp_path / "calls.log"
    script = pair_script()
    payload = f'{{"bot_token":"{SECRET}","chat_id":"42"}}'
    done = subprocess.run(
        ["bash", "-c", script],
        input=payload,
        text=True,
        capture_output=True,
        env={
            **os.environ,
            "PATH": f"{bin_dir}:{os.environ['PATH']}",
            "FAKE_LOG": str(log),
            "FAKE_DIGEST": DIGEST,
            "FAKE_REMAINING_RC": "1",
            "EXPECTED_PAYLOAD": payload,
        },
    )
    assert done.returncode == 0
    calls = log.read_text(encoding="utf-8")
    assert "cutover enable" not in calls
    assert "COMPOSE restart" not in calls


def test_pairing_with_empty_inventory_works_under_bash_3_2_and_nounset(tmp_path: Path) -> None:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    docker = bin_dir / "docker"
    docker.write_text(FAKE_DOCKER, encoding="utf-8")
    docker.chmod(0o755)
    log = tmp_path / "calls.log"
    payload = f'{{"bot_token":"{SECRET}","chat_id":"42"}}'
    done = subprocess.run(
        ["/bin/bash", "-c", pair_script()],
        input=payload,
        text=True,
        capture_output=True,
        env={
            **os.environ,
            "PATH": f"{bin_dir}:{os.environ['PATH']}",
            "FAKE_LOG": str(log),
            "FAKE_DIGEST": "",
            "EXPECTED_PAYLOAD": payload,
        },
    )
    assert done.returncode == 0, done.stderr
    pair = next(line for line in log.read_text(encoding="utf-8").splitlines() if "bots pair" in line)
    assert "--legacy-digest" not in pair
    # An empty inventory pairs as «fresh», and the new-token request still shows.
    assert NEW_TOKEN_REMINDER in done.stderr


def _read_pty_until(fd: int, wanted: bytes, timeout: float = 5) -> bytes:
    output = b""
    deadline = time.monotonic() + timeout
    while wanted not in output and time.monotonic() < deadline:
        ready, _, _ = select.select([fd], [], [], max(0, deadline - time.monotonic()))
        if not ready:
            break
        try:
            output += os.read(fd, 4096)
        except OSError as exc:
            if exc.errno == errno.EIO:
                break
            raise
    assert wanted in output, output.decode(errors="replace")
    return output


def _restore_default_sigint() -> None:
    signal.signal(signal.SIGINT, signal.SIG_DFL)


def _wait_pty_no_echo(fd: int, timeout: float = 5) -> None:
    """Wait until the hidden read has disabled echo, not just printed its prompt."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not termios.tcgetattr(fd)[3] & termios.ECHO:
            return
        time.sleep(0.01)
    raise AssertionError("the pairing prompt never disabled terminal echo")


def test_interactive_pairing_never_echoes_or_persists_the_token(tmp_path: Path) -> None:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    docker = bin_dir / "docker"
    docker.write_text(FAKE_DOCKER, encoding="utf-8")
    docker.chmod(0o755)
    log = tmp_path / "calls.log"
    payload = f'{{"bot_token":"{SECRET}","chat_id":"42"}}'
    environment = {
        **os.environ,
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
        "FAKE_LOG": str(log),
        "FAKE_DIGEST": DIGEST,
        "EXPECTED_PAYLOAD": payload,
    }
    master, slave = pty.openpty()
    process = subprocess.Popen(
        ["bash", "-c", pair_script()],
        stdin=slave,
        stdout=slave,
        stderr=slave,
        env=environment,
        close_fds=True,
    )
    os.close(slave)
    try:
        output = _read_pty_until(master, b"Token del bot (input nascosto): ")
        assert NEW_TOKEN_REMINDER.encode() in output
        _wait_pty_no_echo(master)
        os.write(master, (SECRET + "\n").encode())
        output += _read_pty_until(master, b"Chat ID dell'utente: ")
        os.write(master, b"42\n")
        while process.poll() is None:
            ready, _, _ = select.select([master], [], [], 0.2)
            if ready:
                try:
                    output += os.read(master, 4096)
                except OSError as exc:
                    if exc.errno != errno.EIO:
                        raise
        process.wait(timeout=5)
    finally:
        os.close(master)
        if process.poll() is None:
            process.kill()
    assert process.returncode == 0, output.decode(errors="replace")
    assert SECRET.encode() not in output
    calls = log.read_text(encoding="utf-8")
    assert "TELEGRAM_STDIN_OK" in calls and SECRET not in calls
    for path in tmp_path.rglob("*"):
        if path.is_file():
            assert SECRET not in path.read_text(encoding="utf-8", errors="ignore")


def test_interactive_pairing_restores_echo_after_ctrl_c(tmp_path: Path) -> None:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    docker = bin_dir / "docker"
    docker.write_text(FAKE_DOCKER, encoding="utf-8")
    docker.chmod(0o755)
    log = tmp_path / "calls.log"
    environment = {
        **os.environ,
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
        "FAKE_LOG": str(log),
        "FAKE_DIGEST": DIGEST,
    }
    master, slave = pty.openpty()
    process = subprocess.Popen(
        ["bash", "-c", pair_script()],
        stdin=slave,
        stdout=slave,
        stderr=slave,
        env=environment,
        close_fds=True,
        preexec_fn=_restore_default_sigint,
        start_new_session=True,
    )
    try:
        _read_pty_until(master, b"Token del bot")
        assert not termios.tcgetattr(slave)[3] & termios.ECHO
        os.killpg(process.pid, signal.SIGINT)
        process.wait(timeout=5)
        assert termios.tcgetattr(master)[3] & termios.ECHO
    finally:
        os.close(master)
        os.close(slave)
        if process.poll() is None:
            process.kill()


def test_both_wrappers_document_safe_interactive_and_noninteractive_pairing() -> None:
    shell = WRAPPER.read_text(encoding="utf-8")
    powershell = (ROOT / "scripts/jht-wrapper.ps1").read_text(encoding="utf-8")
    shell_pair = functions("telegram_pair")
    ps_pair = re.search(r"function Invoke-TelegramPair \{\n.*?\n\}", powershell, re.S)
    assert ps_pair
    assert "read_hidden_tty" in shell_pair
    assert "stty -echo" in functions("read_hidden_tty")
    assert "Read-Host 'Token del bot (input nascosto)' -AsSecureString" in ps_pair.group(0)
    assert "[Console]::IsInputRedirected" in ps_pair.group(0)
    assert "mktemp" not in shell_pair
    assert all(word not in ps_pair.group(0) for word in ("Set-Content", "Add-Content", "New-Item"))
    assert "bot.json" not in shell + powershell
    for source in (shell, powershell):
        assert "non salvare il token in ~/.jht" in source
        assert "JSON su stdin" in source


def test_only_pairing_admin_calls_keep_interactive_stdin() -> None:
    shell = WRAPPER.read_text(encoding="utf-8")
    powershell = (ROOT / "scripts/jht-wrapper.ps1").read_text(encoding="utf-8")
    assert 'docker exec "$telegram_id" jht-telegram-admin' in shell
    assert 'docker exec -i "$telegram_id" jht-telegram-admin' in shell
    ps_admin = re.search(r"function Invoke-TelegramAdmin \{\n.*?\n\}", powershell, re.S)
    assert ps_admin
    assert "docker exec -i $telegramId" in ps_admin.group(0)
    assert "docker exec $telegramId" in ps_admin.group(0)


@pytest.mark.skipif(POWERSHELL is None, reason="PowerShell is not installed")
def test_powershell_status_query_cannot_drain_automation_json(tmp_path: Path) -> None:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    docker = bin_dir / "docker"
    docker.write_text(FAKE_DOCKER, encoding="utf-8")
    docker.chmod(0o755)
    log = tmp_path / "calls.log"
    payload = f'{{"bot_token":"{SECRET}","chat_id":"42"}}'
    script = tmp_path / "pair.ps1"
    script.write_text(
        "$ErrorActionPreference = 'Stop'\n"
        "function Write-Err { param([string]$Message) [Console]::Error.WriteLine($Message) }\n"
        "function Write-Info { param([string]$Message) [Console]::Error.WriteLine($Message) }\n"
        "function Write-Warn { param([string]$Message) }\n"
        "function Get-RunningComposeServiceId { param([string]$Service) if ($Service -eq 'jht-telegram') { 'telegram-id' } }\n"
        "function Test-ContainerUp { return $false }\n"
        "function Invoke-Compose { param([Parameter(ValueFromRemainingArguments)] $Args) }\n"
        "$TelegramContainer = 'jht-telegram'\n$Container = 'jht'\n"
        + powershell_functions("Invoke-TelegramAdmin", "Invoke-TelegramPair")
        + "\nfunction Invoke-TelegramLegacy {\n"
        + "  param([string]$Command, [string]$Role = '')\n"
        # The real helper ends in `docker run`, which sets $LASTEXITCODE; a
        # fresh pwsh has none, and Invoke-TelegramPair reads it.
        + "  if ($Command -eq 'inventory') { if ($env:FAKE_DIGEST) { Write-Output $env:FAKE_DIGEST }; $global:LASTEXITCODE = 0; return }\n"
        + "  & docker legacy $Command $Role | Out-Null\n"
        + "}\n"
        + "$code = Invoke-TelegramPair 'assistente'\nexit $code\n",
        encoding="utf-8",
    )
    done = subprocess.run(
        [POWERSHELL, "-NoProfile", "-File", str(script)],
        input=payload,
        text=True,
        capture_output=True,
        env={
            **os.environ,
            "PATH": f"{bin_dir}:{os.environ['PATH']}",
            "FAKE_LOG": str(log),
            "FAKE_DIGEST": DIGEST,
            "EXPECTED_PAYLOAD": payload,
        },
    )
    assert done.returncode == 0, done.stderr
    calls = log.read_text(encoding="utf-8")
    assert "TELEGRAM_STDIN_OK" in calls
    status = next(line for line in calls.splitlines() if "cutover status" in line)
    assert " -i " not in f" {status} "
    # Automation on redirected stdin gets the new-token request too.
    assert NEW_TOKEN_REMINDER in done.stderr


@pytest.mark.skipif(POWERSHELL is None, reason="PowerShell is not installed")
@pytest.mark.parametrize(
    ("layout", "inventoried"),
    [
        ("absent", False),
        ("clean-install", False),
        ("config-without-telegram", False),
        ("legacy-config", True),
        ("escaped-key", True),
        *((encoding, True) for encoding in LEGACY_CONFIG_ENCODINGS),
        ("model-pin-backup", True),
        ("credential-file", True),
    ],
)
def test_powershell_start_skips_the_inventory_only_without_legacy_sources(
    tmp_path: Path, layout: str, inventoried: bool
) -> None:
    home = tmp_path / "jht-home"
    if layout != "absent":
        home.mkdir()
    configs = {
        "config-without-telegram": '{"model": "x", "channels": {}}',
        "legacy-config": '{"channels": {"telegram": {"bots": {}}}}',
        "escaped-key": '{"channels": {"\\u0074elegram": {}}}',
    }
    if layout in configs:
        (home / "jht.config.json").write_text(configs[layout], encoding="utf-8")
    elif layout == "model-pin-backup":
        (home / "jht.config.json.bak-model-pin-1").write_text('{"channels": {"telegram": {}}}', encoding="utf-8")
    elif layout == "credential-file":
        (home / "credentials").mkdir()
        (home / "credentials" / "telegram_bot.json").write_text("{}", encoding="utf-8")
    elif layout in LEGACY_CONFIG_ENCODINGS:
        (home / "jht.config.json").write_bytes(LEGACY_CONFIG_ENCODINGS[layout])
    log = tmp_path / "calls.log"
    script = tmp_path / "start.ps1"
    script.write_text(
        "$ErrorActionPreference = 'Stop'\n"
        f"$JhtHome = '{home}'\n"
        "$TelegramContainer = 'jht-telegram'\n$Container = 'jht'\n"
        "function Invoke-Compose { Add-Content -LiteralPath $env:FAKE_LOG -Value ('COMPOSE ' + ($args -join ' ')); $global:LASTEXITCODE = 0 }\n"
        "function Invoke-TelegramAdmin { return 1 }\n"
        "function Test-ContainerUp { return $false }\n"
        "function Invoke-TelegramLegacy { $global:LASTEXITCODE = 42 }\n"
        + powershell_functions("Test-TelegramLegacySource", "Initialize-TelegramLegacyInventory")
        + "\nif (Initialize-TelegramLegacyInventory) { exit 0 } else { exit 1 }\n",
        encoding="utf-8",
    )
    done = subprocess.run(
        [POWERSHELL, "-NoProfile", "-File", str(script)],
        capture_output=True,
        text=True,
        env={**os.environ, "FAKE_LOG": str(log)},
    )

    calls = log.read_text(encoding="utf-8").splitlines() if log.exists() else []
    if inventoried:
        assert done.returncode == 1, done.stderr
        assert calls == ["COMPOSE up -d jht-telegram"]
    else:
        assert done.returncode == 0, done.stderr
        assert calls == []
