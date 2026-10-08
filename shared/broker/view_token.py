"""websockify token plugin for the broker's login view: one connection, once.

websockify loads it with `--token-plugin broker.view_token.OneShot
--token-source <run dir>`. The run dir (tmpfs, 0700, uid 1002) holds
`token.json`: the token's sha256 and its expiry, never the token itself.

lookup() answers the VNC target only for the right token, before expiry, and
only the first time: the first match creates `burned` with O_EXCL, so a
second connection (or a forked websockify child racing the first) loses.

It never returns None. websockify turns None into "Token '<token>' not
found", and that message carries the token into whatever log it reaches. A
refused token gets a target where nothing listens instead: the connection
fails, and nothing about the token is written anywhere.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
from pathlib import Path

VNC_TARGET = ("127.0.0.1", 5901)
# Port 9 (discard) on the broker's loopback: nothing listens there.
DEAD_TARGET = ("127.0.0.1", 9)


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def check_and_burn(run_dir: Path, token: str, now: float | None = None) -> bool:
    """True exactly once, for the issued token before its expiry."""
    try:
        record = json.loads((run_dir / "token.json").read_text(encoding="utf-8"))
        expected = str(record["sha256"])
        expires = float(record["expires_at"])
    except (OSError, ValueError, KeyError, TypeError):
        return False
    if not isinstance(token, str) or not token:
        return False
    if not hmac.compare_digest(token_digest(token), expected):
        return False
    if (time.time() if now is None else now) > expires:
        return False
    try:
        fd = os.open(run_dir / "burned", os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    except FileExistsError:
        return False
    except OSError:
        return False
    os.close(fd)
    return True


try:  # websockify is in the image (python3-websockify), not in every test env
    from websockify.token_plugins import BasePlugin
except ImportError:  # pragma: no cover - exercised only where websockify is absent
    class BasePlugin:  # type: ignore[no-redef]
        def __init__(self, src):
            self.source = src


class OneShot(BasePlugin):
    def lookup(self, token):
        return VNC_TARGET if check_and_burn(Path(self.source), token) else DEAD_TARGET
