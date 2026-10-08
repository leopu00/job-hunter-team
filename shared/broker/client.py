"""The agents' client of the portal-secrets broker, and `jht-broker serve`.

Agents never hold the mailbox account: they send one request over the socket
in the `jht-broker-sock` volume and print what comes back. When the broker is
not there the answer is a fixed code (`broker_unavailable`): there is no
fallback to a file, by design.
"""

from __future__ import annotations

import json
import os
import socket
import sys
from pathlib import Path

from .protocol import MAX_RESPONSE_BYTES, SOCKET_NAME

TIMEOUT = 180


def socket_path() -> Path:
    return Path(os.environ.get("JHT_BROKER_SOCKET_DIR", "/run/jht-broker")) / SOCKET_NAME


def agent_role() -> str:
    return os.environ.get("JHT_AGENT_NAME", "")


def call(op: str, args: dict | None = None, role: str | None = None) -> dict:
    request = {"op": op, "args": args or {}, "role": agent_role() if role is None else role}
    if not socket_path().exists():
        return {"ok": False, "reason": "broker_unavailable"}
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as conn:
            conn.settimeout(TIMEOUT)
            conn.connect(str(socket_path()))
            conn.sendall((json.dumps(request) + "\n").encode("utf-8"))
            data = b""
            while b"\n" not in data and len(data) <= MAX_RESPONSE_BYTES:
                chunk = conn.recv(65536)
                if not chunk:
                    break
                data += chunk
    except (FileNotFoundError, ConnectionRefusedError):
        return {"ok": False, "reason": "broker_unavailable"}
    except (socket.timeout, OSError):
        return {"ok": False, "reason": "broker_unreachable"}
    try:
        answer = json.loads(data.split(b"\n", 1)[0].decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return {"ok": False, "reason": "broker_bad_answer"}
    return answer if isinstance(answer, dict) else {"ok": False, "reason": "broker_bad_answer"}


def main(argv: list[str]) -> int:
    if argv[:1] == ["serve"]:
        from .server import serve

        return serve()
    if len(argv) < 1:
        print("usage: jht-broker <op> [json-args] | jht-broker serve", file=sys.stderr)
        return 2
    try:
        args = json.loads(argv[1]) if len(argv) > 1 else {}
    except json.JSONDecodeError:
        print(json.dumps({"ok": False, "reason": "args_not_json"}))
        return 2
    answer = call(argv[0], args)
    print(json.dumps(answer, ensure_ascii=False))
    return 0 if answer.get("ok") else 1
