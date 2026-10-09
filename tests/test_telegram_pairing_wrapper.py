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
    *"jht-telegram-legacy.py inventory "*) ;;
    *"jht-telegram-legacy.py remove "*) printf 'REMOVED %s\n' "$(printf '%s' "$*" | awk '{print $NF}')" >> "$FAKE_LOG" ;;
    *"jht-telegram-legacy.py remaining")
      [ -z "${FAKE_REMAINING_ROLES:-}" ] || printf '%s\n' "$FAKE_REMAINING_ROLES"
      exit "${FAKE_REMAINING_RC:-0}" ;;
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
  telegram-id:"jht-telegram-admin legacy remember "*)
    value=$(cat)
    [ -z "$value" ] || { printf 'LEGACY_STDIN_MISMATCH\n' >> "$FAKE_LOG"; exit 99; }
    printf '{"ok":true,"state":"remembered"}\n' ;;
  telegram-id:"jht-telegram-admin cutover status")
    [ "$interactive" -eq 0 ] || cat >/dev/null
    printf '{"ok":true,"cutover":{"enabled":false}}\n' ;;
  telegram-id:"jht-telegram-admin bots status")
    [ "$interactive" -eq 0 ] || cat >/dev/null
    bots=""
    for role in ${FAKE_PRESENT:-}; do bots="$bots\"$role\": \"present\", "; done
    printf '{"ok": true, "bots": {%s"x": "absent"}}\n' "$bots" ;;
  telegram-id:"jht-telegram-admin bots pair "*)
    role=$(printf '%s' "$*" | cut -d' ' -f4)
    value=$(cat)
    if [ "$role" = assistente ] && [ -n "${EXPECTED_PAYLOAD:-}" ]; then
      [ "$value" = "$EXPECTED_PAYLOAD" ] || { printf 'TELEGRAM_STDIN_MISMATCH\n' >> "$FAKE_LOG"; exit 98; }
    fi
    case "$value" in '{"bot_token":"'*'"}') ;; *) printf 'TELEGRAM_STDIN_MISMATCH\n' >> "$FAKE_LOG"; exit 98 ;; esac
    case "$value" in *chat_id*) printf 'CHAT_ID_SENT\n' >> "$FAKE_LOG"; exit 98 ;; esac
    if [ "$role" = "${FAKE_PAIR_FAIL_ROLE:-}" ]; then
      printf 'PAIR_FAILED %s\n' "$role" >> "$FAKE_LOG"
      printf '{"ok": false, "reason": "verification_timeout"}\n'
      exit 1
    fi
    printf 'TELEGRAM_STDIN_OK\n' >> "$FAKE_LOG"
    printf 'PAIRED %s\n' "$role" >> "$FAKE_LOG"
    printf '{"ok":true,"bot":"%s","state":"present","rotation":"rotated"}\n' "$role" ;;
  telegram-id:"jht-telegram-admin bots chat-id "*)
    printf 'CHATID %s interactive=%s\n' "$(printf '%s' "$*" | awk '{print $NF}')" "$interactive" >> "$FAKE_LOG"
    printf '{"ok": true, "chat": "verified"}\n' ;;
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


def pair_script(command: str = "telegram_pair assistente", home: str = "/host-home") -> str:
    return (
        'set -u\nerr() { echo "error: $*" >&2; }\nwarn() { echo "warn: $*" >&2; }\n'
        'info() { echo "info: $*" >&2; }\n'
        'read_only_container_id() { echo agent-id; }\n'
        'read_only_service_id() { [ "$1" = jht-telegram ] && echo telegram-id; }\n'
        'compose() { printf "COMPOSE %s\\n" "$*" >> "$FAKE_LOG"; }\n'
        'TELEGRAM_SERVICE=jht-telegram\nCONTAINER_SERVICE=jht\n'
        f'CONTAINER_RUNTIME=docker\nHOME={home}\n'
        + "\n".join(line for line in WRAPPER.read_text(encoding="utf-8").splitlines()
                    if line.startswith(("TELEGRAM_NEW_TOKEN_NOTE=", "TELEGRAM_PAIR_AGENTS_STOPPED=")))
        + "\n"
        + functions(
            "host_data_dir_same", "host_data_dirs_supported", "telegram_admin", "telegram_admin_input",
            "telegram_legacy", "read_hidden_tty", "telegram_pair_other_legacy_roles",
            "telegram_pair_stop_agents", "telegram_pair_start_agents", "telegram_pair_inventory",
            "telegram_pair_submit", "telegram_pair_finish", "telegram_pair_usage", "telegram_pair_all",
            "telegram_pair", "telegram_command",
        )
        + '\ntelegram_image() { printf "fake-image\\n"; }\n'
        + f'\n{command}\n'
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
    payload = f'{{"bot_token":"{SECRET}"}}'
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
    payload = f'{{"bot_token":"{SECRET}"}}'
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
    payload = f'{{"bot_token":"{SECRET}"}}'
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
    payload = f'{{"bot_token":"{SECRET}"}}'
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
        output = _read_pty_until(master, b"Token del bot assistente (input nascosto): ")
        assert NEW_TOKEN_REMINDER.encode() in output
        _wait_pty_no_echo(master)
        os.write(master, (SECRET + "\n").encode())
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
    shell_submit = functions("telegram_pair_submit")
    ps_submit = re.search(r"function Send-TelegramPairToken \{\n.*?\n\}", powershell, re.S)
    assert ps_submit
    assert "read_hidden_tty" in shell_submit
    assert "stty -echo" in functions("read_hidden_tty")
    assert 'Read-Host "Token del bot $Role (input nascosto)" -AsSecureString' in ps_submit.group(0)
    assert "[Console]::IsInputRedirected" in ps_submit.group(0)
    for source in (shell_submit, functions("telegram_pair"), functions("telegram_pair_all")):
        assert "mktemp" not in source
    assert all(word not in ps_submit.group(0) for word in ("Set-Content", "Add-Content", "New-Item"))
    assert "bot.json" not in shell + powershell
    # The chat id is never typed or sent from the host: the service takes it
    # from the message that carries the one-time code (security review, 09/10).
    assert """printf '{"bot_token":"%s"}' "$token\"""" in shell_submit
    assert "@{ bot_token = $token }" in ps_submit.group(0)
    for source in (shell, powershell):
        assert "Chat ID dell" not in source
        assert "chat_id = " not in source
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
    payload = f'{{"bot_token":"{SECRET}"}}'
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
        + powershell_functions("Invoke-TelegramAdmin", "Get-TelegramPairInventory", "Send-TelegramPairToken", "Complete-TelegramPair", "Invoke-TelegramPair")
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


OTHER_ROLES_WARNING = "Restano token legacy per: capitano mentor"


def _pair_env(tmp_path: Path, **extra: str) -> dict[str, str]:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    docker = bin_dir / "docker"
    docker.write_text(FAKE_DOCKER, encoding="utf-8")
    docker.chmod(0o755)
    payload = f'{{"bot_token":"{SECRET}"}}'
    return {
        **os.environ,
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
        "FAKE_LOG": str(tmp_path / "calls.log"),
        "FAKE_DIGEST": DIGEST,
        "EXPECTED_PAYLOAD": payload,
        **extra,
    }


def test_pairing_warns_when_other_roles_still_have_legacy_tokens(tmp_path: Path) -> None:
    env = _pair_env(tmp_path, FAKE_REMAINING_ROLES="assistente capitano mentor", FAKE_REMAINING_RC="1")
    done = subprocess.run(
        ["bash", "-c", pair_script()], input=env["EXPECTED_PAYLOAD"], text=True, capture_output=True, env=env,
    )

    # Automation goes on: the warning is on stderr, the role itself is not listed.
    assert OTHER_ROLES_WARNING + "." in done.stderr
    assert "assistente resta muto" in done.stderr
    assert "TELEGRAM_STDIN_OK" in (tmp_path / "calls.log").read_text(encoding="utf-8")


def test_no_warning_when_only_the_role_being_paired_is_legacy(tmp_path: Path) -> None:
    env = _pair_env(tmp_path, FAKE_REMAINING_ROLES="assistente", FAKE_REMAINING_RC="1")
    done = subprocess.run(
        ["bash", "-c", pair_script()], input=env["EXPECTED_PAYLOAD"], text=True, capture_output=True, env=env,
    )

    assert "Restano token legacy per" not in done.stderr


def _interactive_pair(env: dict[str, str], answer: bytes, wanted: bytes) -> tuple[int, bytes]:
    master, slave = pty.openpty()
    process = subprocess.Popen(
        ["bash", "-c", pair_script()], stdin=slave, stdout=slave, stderr=slave, env=env, close_fds=True,
        preexec_fn=_restore_default_sigint,
    )
    os.close(slave)
    try:
        output = _read_pty_until(master, b"[s/N] ")
        os.write(master, answer)
        output += _read_pty_until(master, wanted)
        if process.poll() is None and wanted.startswith(b"Token"):
            process.kill()
        process.wait(timeout=5)
    finally:
        os.close(master)
        if process.poll() is None:
            process.kill()
    return process.returncode, output


def test_interactive_pairing_can_stop_before_touching_anything(tmp_path: Path) -> None:
    env = _pair_env(tmp_path, FAKE_REMAINING_ROLES="capitano mentor", FAKE_REMAINING_RC="1")

    code, output = _interactive_pair(env, b"n\n", b"nessuna modifica.")

    assert code == 1
    assert OTHER_ROLES_WARNING.encode() in output
    calls = (tmp_path / "calls.log").read_text(encoding="utf-8")
    assert "COMPOSE stop" not in calls
    assert "inventory" not in calls
    assert "bots pair" not in calls


def test_interactive_pairing_goes_on_after_yes(tmp_path: Path) -> None:
    env = _pair_env(tmp_path, FAKE_REMAINING_ROLES="capitano mentor", FAKE_REMAINING_RC="1")

    _code, output = _interactive_pair(env, b"s\n", b"Token del bot assistente (input nascosto): ")

    assert b"Token del bot assistente (input nascosto): " in output
    assert "COMPOSE stop jht" in (tmp_path / "calls.log").read_text(encoding="utf-8")


@pytest.mark.skipif(POWERSHELL is None, reason="PowerShell is not installed")
def test_powershell_pairing_warns_when_other_roles_still_have_legacy_tokens(tmp_path: Path) -> None:
    env = _pair_env(tmp_path)
    script = tmp_path / "pair.ps1"
    script.write_text(
        "$ErrorActionPreference = 'Stop'\n"
        "function Write-Err { param([string]$Message) [Console]::Error.WriteLine($Message) }\n"
        "function Write-Info { param([string]$Message) }\n"
        "function Write-Warn { param([string]$Message) [Console]::Error.WriteLine($Message) }\n"
        "function Get-RunningComposeServiceId { param([string]$Service) if ($Service -eq 'jht-telegram') { 'telegram-id' } }\n"
        "function Test-ContainerUp { return $false }\n"
        "function Invoke-Compose { param([Parameter(ValueFromRemainingArguments)] $Args) }\n"
        "$TelegramContainer = 'jht-telegram'\n$Container = 'jht'\n"
        + powershell_functions("Invoke-TelegramAdmin", "Get-TelegramPairInventory", "Send-TelegramPairToken", "Complete-TelegramPair", "Invoke-TelegramPair")
        + "\nfunction Invoke-TelegramLegacy {\n"
        + "  param([string]$Command, [string]$Role = '')\n"
        + "  if ($Command -eq 'remaining') { Write-Output 'assistente capitano'; Write-Output 'mentor'; $global:LASTEXITCODE = 1; return }\n"
        + "  if ($Command -eq 'inventory') { Write-Output $env:FAKE_DIGEST; $global:LASTEXITCODE = 0; return }\n"
        + "  $global:LASTEXITCODE = 0\n"
        + "}\n"
        + "$code = Invoke-TelegramPair 'assistente'\nexit $code\n",
        encoding="utf-8",
    )
    done = subprocess.run(
        [POWERSHELL, "-NoProfile", "-File", str(script)],
        input=env["EXPECTED_PAYLOAD"], text=True, capture_output=True, env=env,
    )

    assert OTHER_ROLES_WARNING + "." in done.stderr
    assert "TELEGRAM_STDIN_OK" in (tmp_path / "calls.log").read_text(encoding="utf-8")


def test_a_chat_id_planted_in_jht_home_never_reaches_the_service(tmp_path: Path) -> None:
    """An agent can write ~/.jht; the wrapper never reads a chat id from it,
    and the service only ever gets the token."""
    home = tmp_path / "host-home"
    (home / ".jht").mkdir(parents=True)
    (home / ".jht" / "jht.config.json").write_text(
        '{"channels": {"telegram": {"bots": {"assistente": {"bot_token": "1:x", "chat_id": "666"}}}}}',
        encoding="utf-8",
    )
    env = _pair_env(tmp_path)
    done = subprocess.run(
        ["bash", "-c", pair_script(home=str(home))], input=env["EXPECTED_PAYLOAD"], text=True,
        capture_output=True, env=env,
    )

    calls = (tmp_path / "calls.log").read_text(encoding="utf-8")
    assert done.returncode == 0, done.stderr
    assert "TELEGRAM_STDIN_OK" in calls and "CHAT_ID_SENT" not in calls
    assert "666" not in calls + done.stdout + done.stderr


def test_pair_all_is_interactive_only(tmp_path: Path) -> None:
    env = _pair_env(tmp_path, FAKE_REMAINING_ROLES="assistente capitano", FAKE_REMAINING_RC="1")
    done = subprocess.run(
        ["bash", "-c", pair_script("telegram_pair --all")], input="", text=True, capture_output=True, env=env,
    )

    assert done.returncode == 2
    assert "pair --all è interattivo" in done.stderr
    log = tmp_path / "calls.log"
    assert not log.exists() or "bots pair" not in log.read_text(encoding="utf-8")


def _pair_all(env: dict[str, str], tokens: list[str]) -> tuple[int, bytes]:
    master, slave = pty.openpty()
    process = subprocess.Popen(
        ["bash", "-c", pair_script("telegram_pair --all")], stdin=slave, stdout=slave, stderr=slave,
        env=env, close_fds=True, preexec_fn=_restore_default_sigint,
    )
    os.close(slave)
    output = b""
    try:
        for token in tokens:
            output += _read_pty_until(master, b"(input nascosto): ")
            _wait_pty_no_echo(master)
            os.write(master, (token + "\n").encode())
        deadline = time.monotonic() + 10
        while process.poll() is None and time.monotonic() < deadline:
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
    return process.returncode, output


def test_pair_all_removes_legacy_copies_only_after_every_role_is_paired(tmp_path: Path) -> None:
    env = _pair_env(tmp_path, FAKE_REMAINING_ROLES="capitano mentor", FAKE_REMAINING_RC="1", EXPECTED_PAYLOAD="")
    code, output = _pair_all(env, [SECRET, SECRET.replace("987654", "987655")])

    lines = (tmp_path / "calls.log").read_text(encoding="utf-8").splitlines()
    assert b"Token del bot capitano" in output and b"Token del bot mentor" in output
    paired = [i for i, line in enumerate(lines) if line.startswith("PAIRED ")]
    removed = [i for i, line in enumerate(lines) if line.startswith("REMOVED ")]
    assert [lines[i] for i in paired] == ["PAIRED capitano", "PAIRED mentor"]
    assert [lines[i] for i in removed] == ["REMOVED capitano", "REMOVED mentor"]
    assert max(paired) < min(removed)
    assert lines.count("COMPOSE stop jht") == 1  # one inventory pass for every role
    assert SECRET.encode() not in output
    assert code == 0, output.decode(errors="replace")


def test_pair_all_keeps_every_legacy_copy_when_a_role_fails(tmp_path: Path) -> None:
    env = _pair_env(
        tmp_path, FAKE_REMAINING_ROLES="capitano mentor", FAKE_REMAINING_RC="1",
        EXPECTED_PAYLOAD="", FAKE_PAIR_FAIL_ROLE="mentor",
    )
    code, output = _pair_all(env, [SECRET, SECRET.replace("987654", "987655")])

    calls = (tmp_path / "calls.log").read_text(encoding="utf-8")
    assert code != 0
    assert "PAIRED capitano" in calls and "PAIR_FAILED mentor" in calls
    assert "REMOVED" not in calls and "cutover enable" not in calls
    assert b"le copie legacy restano tutte" in output


def test_pair_all_skips_the_token_of_a_role_already_paired(tmp_path: Path) -> None:
    env = _pair_env(
        tmp_path, FAKE_REMAINING_ROLES="capitano mentor", FAKE_REMAINING_RC="1",
        EXPECTED_PAYLOAD="", FAKE_PRESENT="capitano",
    )
    code, output = _pair_all(env, [SECRET])

    calls = (tmp_path / "calls.log").read_text(encoding="utf-8")
    assert code == 0, output.decode(errors="replace")
    assert "PAIRED capitano" not in calls and "PAIRED mentor" in calls
    assert "REMOVED capitano" in calls and "REMOVED mentor" in calls
    assert b"Token del bot capitano" not in output


def test_chat_id_command_goes_to_the_service_without_stdin(tmp_path: Path) -> None:
    env = _pair_env(tmp_path)
    done = subprocess.run(
        ["bash", "-c", pair_script("telegram_command chat-id capitano")],
        input="", text=True, capture_output=True, env=env,
    )
    bad = subprocess.run(
        ["bash", "-c", pair_script("telegram_command chat-id root")],
        input="", text=True, capture_output=True, env=env,
    )

    assert done.returncode == 0, done.stderr
    assert "CHATID capitano interactive=0" in (tmp_path / "calls.log").read_text(encoding="utf-8")
    assert bad.returncode == 2 and "uso: jht telegram chat-id" in bad.stderr


@pytest.mark.skipif(POWERSHELL is None, reason="PowerShell is not installed")
def test_powershell_pair_all_and_chat_id(tmp_path: Path) -> None:
    env = _pair_env(tmp_path)
    script = tmp_path / "commands.ps1"
    script.write_text(
        "$ErrorActionPreference = 'Stop'\n"
        "function Write-Err { param([string]$Message) [Console]::Error.WriteLine($Message) }\n"
        "function Write-Info { param([string]$Message) }\n"
        "function Write-Warn { param([string]$Message) }\n"
        "function Get-RunningComposeServiceId { param([string]$Service) if ($Service -eq 'jht-telegram') { 'telegram-id' } }\n"
        "function Test-ContainerUp { return $false }\n"
        "function Invoke-Compose { param([Parameter(ValueFromRemainingArguments)] $Args) }\n"
        "function Invoke-TelegramLegacy { param([string]$Command, [string]$Role = '') throw 'not reached' }\n"
        "$TelegramContainer = 'jht-telegram'\n$Container = 'jht'\n"
        + powershell_functions(
            "Invoke-TelegramAdmin", "Get-TelegramPairInventory", "Send-TelegramPairToken",
            "Complete-TelegramPair", "Invoke-TelegramPair", "Invoke-TelegramPairAll", "Invoke-TelegramCommand",
        )
        + "\n$all = Invoke-TelegramCommand @('pair', '--all')\n"
        + "$chat = Invoke-TelegramCommand @('chat-id', 'mentor')\n"
        + "$bad = Invoke-TelegramCommand @('chat-id', 'root')\n"
        + "Write-Output \"all=$all chat=$chat bad=$bad\"\n",
        encoding="utf-8",
    )
    done = subprocess.run(
        [POWERSHELL, "-NoProfile", "-File", str(script)], input="", text=True, capture_output=True, env=env,
    )

    assert "all=2 chat=0 bad=2" in done.stdout, done.stderr
    assert "pair --all e' interattivo" in done.stderr
    assert "CHATID mentor interactive=0" in (tmp_path / "calls.log").read_text(encoding="utf-8")


@pytest.mark.skipif(POWERSHELL is None, reason="PowerShell is not installed")
def test_powershell_admin_calls_open_stdin_only_when_given_input(tmp_path: Path) -> None:
    """R2 on Windows: run the calls instead of reading the source. A [string]
    parameter turns $null into "", so a $null check attached -i to every call."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    docker = bin_dir / "docker"
    docker.write_text('#!/bin/sh\nprintf "%s\\n" "$*" >> "$FAKE_LOG"\n', encoding="utf-8")
    docker.chmod(0o755)
    log = tmp_path / "calls.log"
    script = tmp_path / "admin.ps1"
    script.write_text(
        "$ErrorActionPreference = 'Stop'\n"
        "function Write-Err { param([string]$Message) [Console]::Error.WriteLine($Message) }\n"
        "function Get-RunningComposeServiceId { param([string]$Service) 'telegram-id' }\n"
        "$TelegramContainer = 'jht-telegram'\n"
        + powershell_functions("Invoke-TelegramAdmin")
        + "\n$null = Invoke-TelegramAdmin -AdminArgs @('bots', 'status')\n"
        + "$null = Invoke-TelegramAdmin -AdminArgs @('cutover', 'enable')\n"
        + "$null = Invoke-TelegramAdmin -InputText '' -AdminArgs @('legacy', 'remember', 'mentor')\n"
        + "$null = Invoke-TelegramAdmin -InputText '{}' -AdminArgs @('bots', 'pair', 'mentor')\n",
        encoding="utf-8",
    )
    done = subprocess.run(
        [POWERSHELL, "-NoProfile", "-File", str(script)], input="", text=True, capture_output=True,
        env={**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}", "FAKE_LOG": str(log)},
    )

    assert done.returncode == 0, done.stderr
    assert log.read_text(encoding="utf-8").splitlines() == [
        "exec telegram-id jht-telegram-admin bots status",
        "exec telegram-id jht-telegram-admin cutover enable",
        "exec -i telegram-id jht-telegram-admin legacy remember mentor",
        "exec -i telegram-id jht-telegram-admin bots pair mentor",
    ]
