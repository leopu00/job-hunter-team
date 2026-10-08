"""Audit G1: the legacy mailbox files cannot reopen the door after the migration.

- the broker's `mail.status` says, by name only, which legacy files are past
  their migration, and pid1's guard (role `runtime`) may ask it nothing else;
- the guard deletes a reappeared file of a migrated name **without opening
  it**, tells the user to run `jht mail setup`, and leaves alone a name the
  broker has not migrated yet (the host's migration still has to take it);
- no broker, no deletion;
- `verification_code` has no default mailbox reader: without one it fails
  closed, and it never opens the credentials file;
- nothing that runs in the agents' container opens `credentials/email_*`,
  except the host-driven migration reader `shared/broker/legacy.py`.

Canaries stand in for every password.

Run with: pytest tests/test_broker_legacy_guard.py -v
"""

import base64
import builtins
import hashlib
import io
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared"))
sys.path.insert(0, str(ROOT / "shared" / "skills"))

CANARY = "CANARY-legacy-guard-5a17"


@pytest.fixture
def broker(tmp_path, monkeypatch):
    for name in ("secrets", "state"):
        (tmp_path / name).mkdir(mode=0o700)
    monkeypatch.setenv("JHT_BROKER_SECRETS", str(tmp_path / "secrets"))
    monkeypatch.setenv("JHT_BROKER_STATE", str(tmp_path / "state"))
    from broker import admin, server

    def admin_run(argv, stdin=b""):
        out = io.StringIO()
        real_stdout, real_stdin = sys.stdout, sys.stdin
        sys.stdout, sys.stdin = out, io.TextIOWrapper(io.BytesIO(stdin))
        try:
            admin.main(argv)
        finally:
            sys.stdout, sys.stdin = real_stdout, real_stdin
        return json.loads(out.getvalue())

    def ask(op, args=None, role=None):
        return server.handle(json.dumps({"op": op, "args": args or {}, "role": role}).encode())

    return type("B", (), {"admin_run": staticmethod(admin_run), "ask": staticmethod(ask)})


@pytest.fixture
def home(tmp_path, monkeypatch):
    home = tmp_path / "jht_home"
    (home / "credentials").mkdir(parents=True)
    monkeypatch.setenv("JHT_HOME", str(home))
    return home


def mailbox_json(password=CANARY):
    return json.dumps({"imap_host": "imap.example.test", "user": "me@example.com", "password": password}).encode()


def envelope(raw):
    return json.dumps({"sha256": hashlib.sha256(raw).hexdigest(), "b64": base64.b64encode(raw).decode()}).encode()


def plant(home, name="email_monitor"):
    path = home / "credentials" / f"{name}.json"
    path.write_text(json.dumps({"user": "attacker@evil.invalid", "password": CANARY}))
    path.chmod(0o600)
    return path


@pytest.fixture
def no_open_of_legacy_files(monkeypatch):
    """Fails the test if anything opens a legacy file for reading."""
    real_open, real_os_open = builtins.open, os.open

    def guard(path):
        if re.search(r"credentials/email_(monitor|transport)\.json$", str(path)):
            raise AssertionError(f"opened {path}")

    def spy_open(file, *args, **kwargs):
        guard(file)
        return real_open(file, *args, **kwargs)

    def spy_os_open(path, *args, **kwargs):
        guard(path)
        return real_os_open(path, *args, **kwargs)

    monkeypatch.setattr(builtins, "open", spy_open)
    monkeypatch.setattr(os, "open", spy_os_open)


# ── the broker's answer ──────────────────────────────────────────────────


def test_status_names_what_is_migrated_and_never_a_value(broker):
    assert broker.ask("mail.status", role="runtime")["legacy_migrated"] == {
        "email_monitor": False, "email_transport": False,
    }
    assert broker.admin_run(["secrets", "import-legacy", "email_monitor"], envelope(mailbox_json()))["state"] == "imported"
    answer = broker.ask("mail.status", role="runtime")
    assert answer["legacy_migrated"] == {"email_monitor": True, "email_transport": False}
    assert CANARY not in json.dumps(answer)


def test_a_host_setup_counts_as_migrated(broker):
    out = broker.admin_run(["mailbox", "setup", "--user", "name.jht@gmail.com", "--admission", "allowlist"],
                           (CANARY + "\n").encode())
    assert out["ok"]
    assert broker.ask("mail.status", role="runtime")["legacy_migrated"]["email_monitor"] is True


@pytest.mark.parametrize("op,args", [
    ("mail.poll", {}), ("mail.count", {}),
    ("mail.send", {"kind": "chat", "to": ["a@example.com"], "subject": "s", "body": "b"}),
])
def test_the_runtime_role_can_only_ask_the_status(broker, op, args):
    assert broker.ask(op, args, role="runtime") == {"ok": False, "reason": "role_not_allowed"}


# ── the guard ────────────────────────────────────────────────────────────


def test_a_reappeared_file_is_deleted_unread_and_the_user_is_told(broker, home, no_open_of_legacy_files):
    from broker import legacy_guard

    broker.admin_run(["secrets", "import-legacy", "email_monitor"], envelope(mailbox_json()))
    planted = plant(home)
    told = []
    result = legacy_guard.sweep(ask=broker.ask, notify=told.append)
    assert result["ok"] and result["removed"] == ["email_monitor"]
    assert not planted.is_file()
    assert told == [["email_monitor"]]
    assert "jht mail setup" in legacy_guard.NOTICE and CANARY not in json.dumps(result)


def test_a_name_not_yet_migrated_is_left_for_the_host_migration(broker, home):
    from broker import legacy_guard

    waiting = plant(home)
    transport = plant(home, "email_transport")
    told = []
    assert legacy_guard.sweep(ask=broker.ask, notify=told.append) == {"ok": True, "removed": [], "placeholders": []}
    assert waiting.is_file() and transport.is_file() and told == []
    assert sorted(p.name for p in (home / "credentials").iterdir()) == ["email_monitor.json", "email_transport.json"]


def test_without_a_broker_nothing_is_deleted(home):
    from broker import legacy_guard

    planted = plant(home)
    result = legacy_guard.sweep(ask=lambda *a, **k: {"ok": False, "reason": "broker_unavailable"}, notify=print)
    assert result == {"ok": False, "reason": "broker_unavailable", "removed": [], "placeholders": []}
    assert planted.is_file()


def test_a_symlink_goes_and_its_target_stays(broker, home, tmp_path):
    from broker import legacy_guard

    broker.admin_run(["secrets", "import-legacy", "email_monitor"], envelope(mailbox_json()))
    target = tmp_path / "elsewhere.json"
    target.write_text("keep me")
    link = home / "credentials" / "email_monitor.json"
    link.symlink_to(target)
    assert legacy_guard.sweep(ask=broker.ask, notify=lambda names: None)["removed"] == ["email_monitor"]
    assert not os.path.islink(link) and target.read_text() == "keep me"


def test_a_bad_broker_answer_deletes_nothing(home):
    from broker import legacy_guard

    planted = plant(home)
    assert legacy_guard.sweep(ask=lambda *a, **k: {"ok": True}, notify=print)["reason"] == "broker_bad_answer"
    assert planted.is_file()


# ── the placeholder (audit G1-r1) ────────────────────────────────────────

GAME_PASSWORD = "CANARY-typed-into-the-old-game-3e8c"
PAYLOAD = json.dumps({"imap_host": "imap.example.test", "user": "me@example.com", "password": GAME_PASSWORD})


def _desktop_container_write(home):
    """v0.3.9 `JhtFs.write_text` with the container up: base64 to
    `<file>.game-tmp`, then `mv -f` over the file."""
    import subprocess

    rel = f"{home}/credentials/email_monitor.json"
    b64 = base64.b64encode(PAYLOAD.encode()).decode()
    script = f"mkdir -p \"$(dirname '{rel}')\" && echo '{b64}' | base64 -d > '{rel}.game-tmp' && mv -f '{rel}.game-tmp' '{rel}'"
    return subprocess.run(["sh", "-c", script], capture_output=True, text=True).returncode == 0


def _desktop_host_write(home):
    """v0.3.9 `JhtFs.write_text` without the container: `<file>.game-tmp` on
    the host, then a replace."""
    path = home / "credentials" / "email_monitor.json"
    try:
        with open(f"{path}.game-tmp", "w") as handle:
            handle.write(PAYLOAD)
        os.replace(f"{path}.game-tmp", path)
    except OSError:
        return False
    return True


def _vps_write(home):
    """v0.3.9 VPS settings: the python one-liner run in jht."""
    p = str(home / "credentials" / "email_monitor.json")
    try:
        os.makedirs(os.path.dirname(p), exist_ok=True)
        t = p + ".tmp"
        open(t, "w").write(PAYLOAD + "\n")
        os.chmod(t, 0o600)
        os.replace(t, p)
    except OSError:
        return False
    return True


def _on_disk(home):
    return [p for p in home.rglob("*") if p.is_file() and GAME_PASSWORD.encode() in p.read_bytes()]


@pytest.mark.parametrize("writer", [_desktop_container_write, _desktop_host_write, _vps_write])
def test_after_the_migration_the_old_game_cannot_write_the_password(broker, home, writer):
    from broker import legacy_guard

    broker.admin_run(["secrets", "import-legacy", "email_monitor"], envelope(mailbox_json()))
    assert writer(home) is True and _on_disk(home)  # without the placeholder it lands
    result = legacy_guard.sweep(ask=broker.ask, notify=lambda names: None)
    assert result["removed"] == ["email_monitor"] and _on_disk(home) == []
    assert set(result["placeholders"]) >= {"email_monitor.json", "email_monitor.json.tmp", "email_monitor.json.game-tmp"}
    # The old game saves again: it fails, and the password reaches no file.
    assert writer(home) is False
    assert _on_disk(home) == []


def test_the_placeholder_is_read_only_and_says_what_to_do(broker, home):
    from broker import legacy, legacy_guard

    broker.admin_run(["secrets", "import-legacy", "email_monitor"], envelope(mailbox_json()))
    legacy_guard.sweep(ask=broker.ask, notify=lambda names: None)
    spot = home / "credentials" / "email_monitor.json"
    assert spot.is_dir() and legacy.is_placeholder(spot)
    assert spot.stat().st_mode & 0o777 == 0o555
    assert "jht mail setup" in (spot / "README").read_text()
    # Not yet migrated: no placeholder for that name.
    assert not (home / "credentials" / "email_transport.json").exists()
    # A loosened placeholder is tightened again; a second sweep adds nothing.
    spot.chmod(0o755)
    again = legacy_guard.sweep(ask=broker.ask, notify=lambda names: None)
    assert again["placeholders"] == [] and spot.stat().st_mode & 0o777 == 0o555


def test_the_migration_reader_does_not_take_a_placeholder_for_a_file(broker, home, capsys):
    from broker import legacy, legacy_guard

    broker.admin_run(["secrets", "import-legacy", "email_monitor"], envelope(mailbox_json()))
    legacy_guard.sweep(ask=broker.ask, notify=lambda names: None)
    assert legacy.main(["exists", "email_monitor"]) == 1
    assert legacy.main(["remove", "email_monitor"]) == 0
    assert (home / "credentials" / "email_monitor.json").is_dir()


def test_a_removed_placeholder_comes_back_and_a_file_in_its_place_goes(broker, home):
    from broker import legacy_guard

    broker.admin_run(["secrets", "import-legacy", "email_monitor"], envelope(mailbox_json()))
    legacy_guard.sweep(ask=broker.ask, notify=lambda names: None)
    spot = home / "credentials" / "email_monitor.json"
    spot.chmod(0o755)
    (spot / "README").unlink()
    spot.rmdir()
    plant(home)
    told = []
    result = legacy_guard.sweep(ask=broker.ask, notify=told.append)
    assert result["removed"] == ["email_monitor"] and told == [["email_monitor"]]
    assert spot.is_dir() and "email_monitor.json" in result["placeholders"]


def test_pid1_runs_the_guard_before_the_agents_and_then_periodically():
    pid1 = (ROOT / "cli" / "src" / "commands" / "pid1.js").read_text(encoding="utf-8")
    dispatch = pid1[pid1.index("async function dispatch() {"):]
    boot = dispatch.index("await runLegacyCredentialsGuard();")
    assert boot < dispatch.index("startUserFacingAgents(") and boot < dispatch.index("startTgBridge();")
    assert "setInterval(() => { legacyGuardTick(); }, LEGACY_GUARD_INTERVAL_MS)" in dispatch
    assert "clearInterval(legacyGuardTimer)" in dispatch
    assert "'/app/shared/broker/legacy_guard.py'" in pid1


# ── verification_code ────────────────────────────────────────────────────


def test_verification_code_has_no_mailbox_reader_and_fails_closed(home, no_open_of_legacy_files):
    import verification_code

    plant(home)
    assert verification_code.mailbox_configured() is False
    with pytest.raises(verification_code.CodeUnavailable) as caught:
        verification_code.code_from_mailbox(
            sender_domain="greenhouse.io", since=datetime.now(timezone.utc), timeout_s=0,
        )
    assert caught.value.reason == "mailbox_code_needs_broker"
    assert not hasattr(verification_code, "_default_mailbox_messages")


# ── nothing in the agents' container reads the legacy files ─────────────

# What runs in the agents' container: skills, tools, the CLI, the API harness.
RUNTIME_TREES = ("shared", "agents", "cli/src", "cli/bin", "agent-harness/runtime/src", "game/scripts/backend/payloads")
SOURCE_SUFFIXES = {".py", ".js", ".mjs", ".ts", ".sh", ""}
LEGACY_NAME = re.compile(r"email_(?:monitor|transport)\.json|credentials/email_")
# The migration reader, run by the HOST wrapper, prints only a digest envelope.
MIGRATION_READER = "shared/broker/legacy.py"
# Read by the desktop game's settings payload (inside jht), out of this
# ticket's scope by decision: reported, and the guard deletes the file after
# the migration. A new reader anywhere else fails here.
KNOWN_GAME_READER = "game/scripts/backend/payloads/settings.py"


def _code_lines(path: Path):
    for number, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
        stripped = line.strip()
        if stripped.startswith(("#", "//", "*", "/*", "|", ">")) or not stripped:
            continue
        yield number, line


def test_no_skill_or_process_in_jht_names_a_legacy_mailbox_file():
    offenders = []
    for tree in RUNTIME_TREES:
        for path in (ROOT / tree).rglob("*"):
            if not path.is_file() or path.suffix not in SOURCE_SUFFIXES or "node_modules" in path.parts:
                continue
            if path.suffix == "" and not path.read_bytes()[:2] == b"#!":
                continue
            rel = path.relative_to(ROOT).as_posix()
            if rel in (MIGRATION_READER, KNOWN_GAME_READER):
                continue
            in_docstring = False
            for number, line in _code_lines(path):
                # Docstrings explain the rule; they are not readers.
                if line.count('"""') == 1:
                    in_docstring = not in_docstring
                    continue
                if in_docstring or '"""' in line:
                    continue
                if LEGACY_NAME.search(line):
                    offenders.append(f"{rel}:{number}: {line.strip()}")
    assert offenders == []


def test_the_static_gate_sees_a_reader_when_one_is_added(tmp_path, monkeypatch):
    """The gate above must not pass on an empty search."""
    fake = tmp_path / "shared" / "skills"
    fake.mkdir(parents=True)
    (fake / "reader.py").write_text("p = '/jht_home/credentials/email_monitor.json'\nopen(p).read()\n")
    monkeypatch.setattr(sys.modules[__name__], "ROOT", tmp_path)
    with pytest.raises(AssertionError):
        test_no_skill_or_process_in_jht_names_a_legacy_mailbox_file()


def test_the_known_game_reader_is_still_the_only_one_there():
    # When the game stops reading the file, drop KNOWN_GAME_READER.
    text = (ROOT / KNOWN_GAME_READER).read_text(encoding="utf-8")
    assert "credentials/email_monitor.json" in text
