"""Security and cutover contract of the isolated Telegram transport."""

from __future__ import annotations

import json
import os
import sqlite3
import stat
import subprocess
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from shared.telegram_service import protocol, relay, runtime, server, store


@pytest.fixture()
def telegram_store(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> dict[str, Path]:
    secrets = tmp_path / "secrets"
    bots = secrets / "bots"
    state = tmp_path / "state"
    inbox = tmp_path / "inbox"
    bots.mkdir(parents=True, mode=0o700)
    state.mkdir(mode=0o700)
    inbox.mkdir(mode=0o750)
    os.chmod(secrets, 0o700)
    os.chmod(bots, 0o700)
    os.chmod(state, 0o700)
    os.chmod(inbox, 0o750)
    monkeypatch.setenv("JHT_TELEGRAM_SECRETS", str(secrets))
    monkeypatch.setenv("JHT_TELEGRAM_STATE", str(state))
    monkeypatch.setenv("JHT_TELEGRAM_INBOX", str(inbox))
    return {"secrets": secrets, "state": state, "inbox": inbox}


def request(operation: str, args: dict, role: str = "assistente") -> bytes:
    return json.dumps({"op": operation, "args": args, "role": role}).encode()


def test_protocol_is_closed_and_reserves_authorization_format() -> None:
    good = protocol.parse_request(
        request(
            "telegram.send",
            {
                "bot_role": "assistente",
                "text": "Aggiornamento normale",
                "source_id": "notify:42",
                "kind": "notification",
            },
        )
    )
    assert good["args"]["kind"] == "notification"

    for extra in ("token", "chat_id", "url", "path", "method", "callback"):
        with pytest.raises(protocol.ProtocolError, match="unexpected_field"):
            protocol.parse_request(
                request(
                    "telegram.send",
                    {
                        "bot_role": "assistente",
                        "text": "ciao",
                        "source_id": "notify:42",
                        extra: "controlled-by-agent",
                    },
                )
            )
    for imitation in (
        "🔐 JHT · Autorizzazione candidatura",
        "[JHT-AUTH] approve",
        "Premi Sì, candidati",
    ):
        with pytest.raises(protocol.ProtocolError, match="challenge_format_reserved"):
            protocol.parse_request(
                request(
                    "telegram.send",
                    {"bot_role": "assistente", "text": imitation, "source_id": "notify:43"},
                )
            )


def test_disabled_service_refuses_agent_operations(telegram_store: dict[str, Path]) -> None:
    transport = runtime.Runtime(enabled=False)
    response = server.handle(
        request(
            "telegram.send",
            {"bot_role": "assistente", "text": "ciao", "source_id": "notify:1"},
        ),
        transport,
    )
    assert response == {"ok": False, "reason": "service_disabled"}
    assert transport.dispatch(protocol.parse_request(request("telegram.status", {})))["enabled"] is False


def test_foreign_peer_is_refused_before_request_bytes_are_read(
    telegram_store: dict[str, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    class FakeConnection:
        def __init__(self) -> None:
            self.sent = b""
            self.read = False

        def sendall(self, value: bytes) -> None:
            self.sent += value

        def recv(self, _size: int) -> bytes:
            self.read = True
            raise AssertionError("foreign peer request was read")

    connection = FakeConnection()
    server._Handler.runtime = runtime.Runtime(enabled=True)
    monkeypatch.setattr(server, "peer_uid", lambda _conn: 2000)
    server._Handler(connection, ("local", 0), object())
    assert connection.read is False
    assert json.loads(connection.sent) == {"ok": False, "reason": "peer_not_allowed"}


class FakeAPI:
    def __init__(self) -> None:
        self.sent: list[tuple[str, str]] = []
        self.next_id = 100

    def send_message(self, chat_id: str, text: str) -> int:
        self.sent.append((chat_id, text))
        self.next_id += 1
        return self.next_id

    def file_meta(self, _file_id: str) -> dict:
        return {"file_path": "documents/file.bin", "file_size": 3}

    def download_chunks(self, _file_path: str):
        yield b"abc"


def configured_runtime(
    telegram_store: dict[str, Path], monkeypatch: pytest.MonkeyPatch
) -> tuple[runtime.Runtime, FakeAPI]:
    store.write_bot("assistente", {"bot_token": "123456:abcdefghijklmnopqrstuvwxyz", "chat_id": "42"})
    api = FakeAPI()
    transport = runtime.Runtime(api_factory=lambda _token: api)
    monkeypatch.setattr(runtime, "_redact", lambda text: text.replace("SECRET", "[REDACTED]"))
    return transport, api


def test_host_admin_reads_secret_from_stdin_and_never_echoes_it(
    telegram_store: dict[str, Path]
) -> None:
    token = "123456:abcdefghijklmnopqrstuvwxyz"
    command = ROOT / "shared/telegram_service/bin/jht-telegram-admin.py"
    environment = {
        **os.environ,
        "JHT_TELEGRAM_SECRETS": str(telegram_store["secrets"]),
        "JHT_TELEGRAM_STATE": str(telegram_store["state"]),
    }
    saved = subprocess.run(
        [str(command), "bots", "set", "assistente"],
        input=json.dumps({"bot_token": token, "chat_id": "42"}),
        env=environment,
        capture_output=True,
        text=True,
    )
    assert saved.returncode == 0
    assert token not in saved.stdout + saved.stderr
    assert json.loads(saved.stdout) == {"ok": True, "bot": "assistente", "state": "present"}
    secret_path = telegram_store["secrets"] / "bots" / "assistente.json"
    assert stat.S_IMODE(secret_path.stat().st_mode) == 0o600
    status = subprocess.run(
        [str(command), "bots", "status"],
        env=environment,
        capture_output=True,
        text=True,
    )
    assert status.returncode == 0 and token not in status.stdout + status.stderr


def test_send_adds_unremovable_prefix_and_is_idempotent(
    telegram_store: dict[str, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    transport, api = configured_runtime(telegram_store, monkeypatch)
    args = {
        "bot_role": "assistente",
        "text": "stato SECRET",
        "source_id": "notify:7",
        "kind": "notification",
    }
    first = transport.dispatch(protocol.parse_request(request("telegram.send", args)))
    second = transport.dispatch(protocol.parse_request(request("telegram.send", args)))

    assert first == second == {"ok": True, "status": "sent", "chunks": 1}
    assert api.sent == [("42", "💬 Agente:\nstato [REDACTED]")]


def test_numeric_reply_to_open_question_is_not_discarded(
    telegram_store: dict[str, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    transport, api = configured_runtime(telegram_store, monkeypatch)
    transport.send(
        {
            "bot_role": "assistente",
            "text": "Qual è la retribuzione desiderata?",
            "source_id": "notify:8",
            "kind": "question",
        }
    )
    question_id = api.next_id
    transport.process_update(
        "assistente",
        {
            "update_id": 10,
            "message": {
                "date": int(time.time()),
                "chat": {"id": 42},
                "text": "45000",
                "reply_to_message": {"message_id": question_id},
            },
        },
        {"bot_token": "unused", "chat_id": "42"},
        api,
    )
    pulled = transport.pull({"bot_role": "assistente", "limit": 10})
    assert [event["body"] for event in pulled["events"]] == ["45000"]


def test_unprompted_otp_is_consumed_without_entering_inbox(
    telegram_store: dict[str, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    transport, api = configured_runtime(telegram_store, monkeypatch)
    transport.process_update(
        "assistente",
        {"update_id": 11, "message": {"chat": {"id": 42}, "text": "123456"}},
        {"bot_token": "unused", "chat_id": "42"},
        api,
    )
    assert transport.pull({"bot_role": "assistente", "limit": 10})["events"] == []
    assert api.sent[-1][1].startswith("I codici non si accettano qui")


def test_attachment_leaf_is_opaque_exclusive_and_not_symlinked(
    telegram_store: dict[str, Path], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(store.secrets, "token_hex", lambda _length: "a" * 40)
    opaque, size = store.create_inbox_file(iter([b"abc"]))
    path = telegram_store["inbox"] / opaque
    assert opaque == "a" * 40 and size == 3 and path.read_bytes() == b"abc"
    assert stat.S_IMODE(path.stat().st_mode) == 0o640
    with pytest.raises(FileExistsError):
        store.create_inbox_file(iter([b"replacement"]))
    assert path.read_bytes() == b"abc"


def test_relay_copies_read_only_attachment_and_inserts_one_chat_turn(
    telegram_store: dict[str, Path], tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(store.secrets, "token_hex", lambda _length: "b" * 40)
    opaque, _size = store.create_inbox_file(iter([b"cv-data"]))
    database_path = tmp_path / "jobs.db"
    with sqlite3.connect(database_path) as database:
        database.execute(
            "CREATE TABLE pending_user_messages ("
            "id INTEGER PRIMARY KEY, agent TEXT, body TEXT, kind TEXT, author TEXT, "
            "chat_ts REAL, delivered_via TEXT, delivered_at TEXT, created_at TEXT, source_id TEXT)"
        )
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("JHT_DB", str(database_path))
    monkeypatch.setenv("JHT_HOME", str(home))
    monkeypatch.setenv("JHT_TELEGRAM_SERVICE_UID", str(os.getuid()))
    event = {
        "event_id": "telegram:assistente:55",
        "agent": "assistente",
        "body": "Ecco il CV",
        "created_at": "2026-10-08 12:00:00",
        "attachment": {
            "opaque": opaque,
            "name": "../../cv.pdf",
            "mime": "application/pdf",
            "size": 7,
        },
    }
    relay.insert_event(event)
    relay.insert_event(event)
    with sqlite3.connect(database_path) as database:
        rows = database.execute("SELECT body, source_id FROM pending_user_messages").fetchall()
    assert len(rows) == 1 and rows[0][1] == event["event_id"]
    assert 'name="cv.pdf"' in rows[0][0]
    copied = list((home / "profile" / "inbox").iterdir())
    assert len(copied) == 1 and copied[0].read_bytes() == b"cv-data"


def test_compose_mounts_agent_socket_and_inbox_read_only() -> None:
    compose = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    assert "jht-telegram-sock:/run/jht-telegram:ro" in compose
    assert "jht-telegram-inbox:/jht_telegram_inbox:ro" in compose
    assert 'user: "1003:1003"' in compose
    assert "read_only: true" in compose
    assert "JHT_TELEGRAM_SERVICE_ENABLED=${JHT_TELEGRAM_SERVICE_ENABLED:-0}" in compose
    assert "network_mode: bridge" in compose
    assert "- /jht_home:size=64k,mode=0555" in compose
    assert "- /jht_user:size=64k,mode=0555" in compose
    service = compose.split("  jht-telegram:", 1)[1].split("\nvolumes:", 1)[0]
    assert "${HOME}/.jht" not in service
    assert "jht-secrets" not in service and "jht-broker-state" not in service


def test_podman_uses_the_same_user_namespace_map_for_socket_peers() -> None:
    override = (ROOT / "docker-compose.podman.yml").read_text(encoding="utf-8")
    jht = override.split("  jht:", 1)[1].split("\n  jht-telegram:", 1)[0]
    assert 'userns_mode: "keep-id:uid=1001,gid=1001"' in jht
    telegram = override.split("  jht-telegram:", 1)[1]
    assert 'userns_mode: "keep-id:uid=1001,gid=1001"' in telegram


def test_legacy_bridge_remains_default_and_cutover_disables_respawn() -> None:
    pid1 = (ROOT / "cli/src/commands/pid1.js").read_text(encoding="utf-8")
    launcher = (ROOT / ".launcher/start-agent.sh").read_text(encoding="utf-8")
    watchdog = (ROOT / ".launcher/agent-watchdog.sh").read_text(encoding="utf-8")
    assert "JHT_TELEGRAM_SERVICE_ENABLED" in pid1
    assert "legacy tg-bridge stays stopped" in pid1
    assert 'JHT_TELEGRAM_SERVICE_ENABLED:-0}" = "1"' in launcher
    assert 'JHT_TELEGRAM_SERVICE_ENABLED:-0}" != "1"' in watchdog


def test_wrapper_uses_socket_client_without_reading_legacy_config(tmp_path: Path) -> None:
    home = tmp_path / "home"
    home.mkdir()
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    captured = tmp_path / "args.json"
    client = bin_dir / "jht-telegram-client"
    client.write_text(
        "#!/usr/bin/env python3\n"
        "import json, os, sys\n"
        "open(os.environ['CAPTURE'], 'w').write(json.dumps(sys.argv[1:]))\n",
        encoding="utf-8",
    )
    client.chmod(0o755)
    done = subprocess.run(
        [str(ROOT / "agents/_tools/jht-telegram-send"), "domanda"],
        env={
            **os.environ,
            "PATH": f"{bin_dir}:{os.environ['PATH']}",
            "HOME": str(home),
            "JHT_HOME": str(home),
            "JHT_TELEGRAM_SERVICE_ENABLED": "1",
            "JHT_MESSAGE_ROW_ID": "91",
            "JHT_MESSAGE_KIND": "question",
            "CAPTURE": str(captured),
        },
        capture_output=True,
        text=True,
    )
    assert done.returncode == 0, done.stderr
    args = json.loads(captured.read_text(encoding="utf-8"))
    assert args == [
        "send", "--bot-role", "assistente", "--kind", "question",
        "--source-id", "notify:91", "--", "domanda",
    ]
