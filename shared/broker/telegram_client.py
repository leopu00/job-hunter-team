"""Client used only inside ``jht-telegram`` for its private broker socket."""

from __future__ import annotations

import json
import os
import socket
from pathlib import Path

from .protocol import MAX_RESPONSE_BYTES, SOCKET_NAME

TIMEOUT = 15


def socket_path() -> Path:
    return Path(os.environ.get("JHT_TELEGRAM_BROKER_SOCKET_DIR", "/run/jht-broker-telegram")) / SOCKET_NAME


def record(position_id: int, instant: str, destination: str) -> dict:
    path = socket_path()
    if not path.exists():
        return {"ok": False, "reason": "broker_unavailable"}
    request = {"op": "apply.record", "args": {
        "position_id": position_id, "instant": instant, "destination": destination,
    }}
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as conn:
            conn.settimeout(TIMEOUT)
            conn.connect(str(path))
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
