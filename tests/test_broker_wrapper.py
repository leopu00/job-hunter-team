"""The host side of the portal-secrets broker in jht-wrapper.sh (phase 1a).

The real wrapper functions run against a fake `docker` on PATH that plays
both containers: `jht` (the agents, where legacy.py reads the old files) and
`jht-broker` (where jht-broker-admin answers). Checked:

- a legacy file is removed from ~/.jht only after the broker said "imported";
- a file that reappears after the migration is removed and never imported;
- a failed import leaves the file where it was, and no marker is written;
- `jht mail setup` hands the password to the broker on stdin, never in argv.

Run with: pytest tests/test_broker_wrapper.py -v
"""

import os
import re
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WRAPPER = ROOT / "scripts" / "jht-wrapper.sh"
SECRET = "CANARY-wrapper-app-password-5e1"

FAKE_DOCKER = r"""#!/bin/sh
log="$FAKE_LOG"
printf 'ARGV %s\n' "$*" >> "$log"
[ "$1" = exec ] || exit 0
shift
[ "$1" = -i ] && shift
target="$1"; shift
for last; do :; done
name="$last"
case "$target:$*" in
  agent-id:"python3 /app/shared/broker/legacy.py exists "*)
    [ -e "$FAKE_LEGACY/$name.json" ] ;;
  agent-id:"python3 /app/shared/broker/legacy.py read "*)
    printf '{"ok": true, "sha256": "x", "b64": "eA=="}\n' ;;
  agent-id:"python3 /app/shared/broker/legacy.py remove "*)
    rm -f "$FAKE_LEGACY/$name.json"; printf 'REMOVE %s\n' "$name" >> "$log" ;;
  broker-id:"jht-broker-admin secrets import-legacy "*)
    cat > /dev/null
    printf '%s\n' "$(cat "$FAKE_ANSWERS/$name" 2>/dev/null || echo '{"ok": false, "reason": "store_missing"}')" ;;
  broker-id:"jht-broker-admin mailbox setup "*)
    printf 'STDIN %s\n' "$(cat)" >> "$log"
    printf '{"ok": true}\n' ;;
  *) exit 97 ;;
esac
"""


def wrapper_functions(*names: str) -> str:
    text = WRAPPER.read_text(encoding="utf-8")
    out = []
    for name in names:
        match = re.search(rf"^{name}\(\) \{{\n.*?^\}}\n", text, re.S | re.M)
        assert match, name
        out.append(match.group(0))
    return "\n".join(out)


@pytest.fixture
def host(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    (bin_dir / "docker").write_text(FAKE_DOCKER)
    (bin_dir / "docker").chmod(0o755)
    legacy = tmp_path / "legacy"
    legacy.mkdir()
    answers = tmp_path / "answers"
    answers.mkdir()
    runtime = tmp_path / "runtime"
    runtime.mkdir()
    (runtime / "docker-compose.yml").write_text("services:\n  jht:\n    image: x\n  jht-broker:\n    image: x\n")
    log = tmp_path / "docker.log"
    env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}", "FAKE_LOG": str(log),
           "FAKE_LEGACY": str(legacy), "FAKE_ANSWERS": str(answers)}
    return type("H", (), {"legacy": legacy, "answers": answers, "runtime": runtime, "log": log, "env": env})


def run(host, body: str, stdin: str = "") -> subprocess.CompletedProcess:
    script = (
        'warn() { echo "warn: $*" >&2; }\nerr() { echo "error: $*" >&2; }\n'
        "read_only_container_id() { echo agent-id; }\n"
        "read_only_service_id() { [ \"$1\" = jht-broker ] && echo broker-id; }\n"
        f'RUNTIME_DIR="{host.runtime}"\nCOMPOSE_FILE="{host.runtime}/docker-compose.yml"\n'
        'BROKER_SERVICE="jht-broker"\nLEGACY_SECRET_NAMES="email_monitor email_transport"\n'
        'BROKER_LEGACY_MARKER="$RUNTIME_DIR/.broker-legacy-migrated"\n'
        + wrapper_functions("broker_admin", "broker_migrate_legacy", "broker_migrate_legacy_once", "mail_setup")
        + "\n" + body
    )
    return subprocess.run(["bash", "-c", script], env=host.env, input=stdin, capture_output=True, text=True, timeout=30)


def test_a_legacy_file_leaves_jht_home_only_after_the_broker_imported_it(host):
    (host.legacy / "email_monitor.json").write_text("{}")
    (host.answers / "email_monitor").write_text('{"ok": true, "secret": "email_monitor", "state": "imported", "rotation_pending": true}')
    result = run(host, "broker_migrate_legacy_once; echo rc=$?")
    assert "rc=0" in result.stdout
    assert not (host.legacy / "email_monitor.json").exists()
    assert "REMOVE email_monitor" in host.log.read_text()
    assert "jht mail setup" in result.stderr  # the rotation is asked for
    assert (host.runtime / ".broker-legacy-migrated").exists()


def test_a_reappeared_file_is_removed_never_imported(host):
    (host.legacy / "email_monitor.json").write_text("{}")
    (host.answers / "email_monitor").write_text('{"ok": true, "secret": "email_monitor", "state": "already_migrated"}')
    result = run(host, "broker_migrate_legacy; echo rc=$?")
    assert "rc=0" in result.stdout
    assert not (host.legacy / "email_monitor.json").exists()
    assert "legacy_secret_reappeared" in result.stderr


def test_a_failed_import_leaves_the_file_and_writes_no_marker(host):
    (host.legacy / "email_monitor.json").write_text("{}")
    result = run(host, "broker_migrate_legacy_once; echo rc=$?")
    assert "rc=0" in result.stdout
    assert (host.legacy / "email_monitor.json").exists()
    assert "REMOVE" not in host.log.read_text()
    assert "legacy_migration_failed" in result.stderr
    assert not (host.runtime / ".broker-legacy-migrated").exists()


def test_after_the_marker_up_makes_no_broker_call(host):
    (host.runtime / ".broker-legacy-migrated").write_text("")
    (host.legacy / "email_monitor.json").write_text("{}")
    run(host, "broker_migrate_legacy_once")
    assert not host.log.exists() or "legacy.py" not in host.log.read_text()


def test_a_compose_without_the_broker_makes_no_broker_call(host):
    (host.runtime / "docker-compose.yml").write_text("services:\n  jht:\n    image: x\n")
    (host.legacy / "email_monitor.json").write_text("{}")
    run(host, "broker_migrate_legacy_once")
    assert not host.log.exists()


def test_mail_setup_hands_the_password_on_stdin_never_in_argv(host):
    result = run(host, "mail_setup --user me@example.com --dedicated; echo rc=$?", stdin=SECRET + "\n")
    assert "rc=0" in result.stdout, result.stderr
    log = host.log.read_text()
    argv_lines = [line for line in log.splitlines() if line.startswith("ARGV ")]
    assert any("mailbox setup --user me@example.com --admission whole_mailbox" in line for line in argv_lines)
    assert all(SECRET not in line for line in argv_lines)
    assert f"STDIN {SECRET}" in log
    assert SECRET not in result.stdout + result.stderr
