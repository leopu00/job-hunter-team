#!/usr/bin/env python3
"""The box's website sync token, looked at and renewed from the desktop app, for a team on a VPS.

A sync token with an expiry, once it has expired, cuts the box off the website without a word: every
push answers 401 and nothing reaches the website again. The app connected to the team says so and
renews the token, so the user never has to open a terminal on the box.

The app reaches this one file through its pinned SSH connection (host key and container fixed):
never a free command, never a generic Python runner. The arguments are closed (argparse choices);
the new token, a secret, travels on stdin as ONE JSON line ({"token": "..."}), never in an argument,
so it is in no process list and in no SSH command line. It is never printed, nor logged.

  check    asks the website how long the box's CURRENT token lasts (GET /api/cloud-sync/ping)
           -> {"ok": true, "op": "check", "state": "none|active|expiring|expired|unknown",
               "expires_at": <ISO text or null>, "days_left": <int or null>}
  apply    verifies the token on stdin against the website, and only if the website accepts it AND
           it belongs to the account this box is paired with, writes it into cloud.json (every
           other key kept, mode 0600, atomic) -> {"ok": true, "op": "apply", "expires_at": ...}

Refusals are {"ok": false, "op": ..., "code": <closed code>}; exit 0 done, 1 refused, 2 usage:
  cloud_not_configured   the box has no cloud.json, or it has no base URL / no account
  cloud_unreachable      the website did not answer (network, timeout, 5xx)
  token_malformed        what came on stdin is not a sync token
  token_rejected         the website refuses that token (expired, revoked, unknown)
  token_other_account    the token is valid but belongs to another account than the box's
  cloud_write_failed     cloud.json could not be rewritten
"""

import argparse
import json
import math
import os
import re
import stat
import sys
import tempfile
import urllib.error
import urllib.request
from datetime import datetime, timezone
from urllib.parse import urlsplit

JHT_HOME = os.environ.get("JHT_HOME") or "/jht_home"
CLOUD_FILE = os.path.join(JHT_HOME, "cloud.json")

TOKEN = re.compile(r"^jht_sync_[A-Za-z0-9_-]{16,128}$")
# One line of stdin, at most this many bytes: nothing more is ever read.
STDIN_MAX_BYTES = 1024
CLOUD_FILE_MAX_BYTES = 262144
PING_TIMEOUT_S = 8
# The same threshold as the website's token list and banner (web/lib/cloud-sync/token-expiry.ts).
WARNING_DAYS = 14
DAY_S = 86400


class Refused(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def read_cloud() -> dict:
    """cloud.json as a dict; a missing, odd or unreadable file is `cloud_not_configured`."""
    try:
        fd = os.open(CLOUD_FILE, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except OSError:
        raise Refused("cloud_not_configured")
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise Refused("cloud_not_configured")
        raw = os.read(fd, CLOUD_FILE_MAX_BYTES + 1)
    except OSError:
        raise Refused("cloud_not_configured")
    finally:
        os.close(fd)
    if len(raw) > CLOUD_FILE_MAX_BYTES:
        raise Refused("cloud_not_configured")
    try:
        config = json.loads(raw)
    except ValueError:
        raise Refused("cloud_not_configured")
    if not isinstance(config, dict):
        raise Refused("cloud_not_configured")
    return config


def base_url_of(config: dict) -> str:
    """The website the box is paired with: https only, the token never goes out in clear."""
    url = config.get("base_url")
    if not isinstance(url, str):
        raise Refused("cloud_not_configured")
    parts = urlsplit(url.strip())
    if parts.scheme != "https" or not parts.netloc or parts.username or parts.password:
        raise Refused("cloud_not_configured")
    return url.strip().rstrip("/")


def ping(base_url: str, token: str, opener=urllib.request.urlopen) -> dict:
    """The website's answer to the token: its body when accepted. 401/403 is `token_rejected`."""
    request = urllib.request.Request(
        f"{base_url}/api/cloud-sync/ping",
        headers={"Authorization": f"Bearer {token}", "User-Agent": "jht-desktop-token"},
    )
    try:
        with opener(request, timeout=PING_TIMEOUT_S) as response:
            body = json.loads(response.read(65536) or b"{}")
    except urllib.error.HTTPError as error:
        if error.code in (401, 403):
            raise Refused("token_rejected")
        raise Refused("cloud_unreachable")
    except (urllib.error.URLError, OSError, ValueError):
        raise Refused("cloud_unreachable")
    if not isinstance(body, dict):
        raise Refused("cloud_unreachable")
    return body


def expiry_of(body: dict) -> tuple[str | None, bool]:
    """(expires_at text or None, whether the website reported it at all)."""
    token = body.get("token")
    if not isinstance(token, dict) or "expires_at" not in token:
        return None, False
    at = token["expires_at"]
    if at is None:
        return None, True
    if isinstance(at, str) and len(at) <= 40 and parse_time(at) is not None:
        return at, True
    return None, False


def parse_time(value: str) -> float | None:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc).timestamp()
    except ValueError:
        return None


def describe(body: dict, now: float) -> dict:
    """The closed state of a token the website accepted."""
    expires_at, reported = expiry_of(body)
    if not reported:
        return {"state": "unknown", "expires_at": None, "days_left": None}
    if expires_at is None:
        return {"state": "none", "expires_at": None, "days_left": None}
    at = parse_time(expires_at)
    days = max(1, math.ceil((at - now) / DAY_S))
    return {"state": "expiring" if days <= WARNING_DAYS else "active", "expires_at": expires_at, "days_left": days}


def check(now: float, opener=urllib.request.urlopen) -> dict:
    config = read_cloud()
    token = config.get("token")
    if not isinstance(token, str) or not TOKEN.match(token):
        raise Refused("cloud_not_configured")
    try:
        body = ping(base_url_of(config), token, opener)
    except Refused as refused:
        if refused.code == "token_rejected":
            return {"ok": True, "op": "check", "state": "expired", "expires_at": None, "days_left": None}
        raise
    return {"ok": True, "op": "check", **describe(body, now)}


def read_token_line(stream) -> str:
    try:
        raw = stream.readline(STDIN_MAX_BYTES + 1)
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8")
        payload = json.loads(raw) if len(raw) <= STDIN_MAX_BYTES else None
    except (ValueError, UnicodeDecodeError, OSError):
        payload = None
    token = payload.get("token") if isinstance(payload, dict) and set(payload) == {"token"} else None
    if not isinstance(token, str) or not TOKEN.match(token.strip()):
        raise Refused("token_malformed")
    return token.strip()


def write_cloud(config: dict) -> None:
    """Atomic rewrite, private: a temp file in the same folder, then a rename over cloud.json."""
    folder = os.path.dirname(CLOUD_FILE)
    temp = None
    try:
        fd, temp = tempfile.mkstemp(prefix=".cloud.json.", dir=folder)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(config, handle, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temp, 0o600)
        os.replace(temp, CLOUD_FILE)
        temp = None
    except OSError:
        raise Refused("cloud_write_failed")
    finally:
        if temp is not None:
            try:
                os.unlink(temp)
            except OSError:
                pass


def apply(token: str, now: float, opener=urllib.request.urlopen) -> dict:
    config = read_cloud()
    owner = config.get("user_id")
    if not isinstance(owner, str) or not owner:
        raise Refused("cloud_not_configured")
    body = ping(base_url_of(config), token, opener)
    if body.get("user_id") != owner:
        raise Refused("token_other_account")
    named = body.get("token")
    name = named.get("name") if isinstance(named, dict) and isinstance(named.get("name"), str) else None
    config["token"] = token
    config["enabled"] = True
    if name is not None:
        config["token_name"] = name[:120]
    write_cloud(config)
    state = describe(body, now)
    return {"ok": True, "op": "apply", "expires_at": state["expires_at"], "days_left": state["days_left"]}


def main(argv=None, stdin=None, opener=urllib.request.urlopen, now=None) -> int:
    parser = argparse.ArgumentParser(prog="cloud_token", description="Check or renew the box's website sync token.")
    parser.add_argument("op", choices=("check", "apply"))
    args = parser.parse_args(argv)
    moment = now if now is not None else datetime.now(timezone.utc).timestamp()
    try:
        if args.op == "check":
            result = check(moment, opener)
        else:
            result = apply(read_token_line(stdin if stdin is not None else sys.stdin.buffer), moment, opener)
    except Refused as refused:
        print(json.dumps({"ok": False, "op": args.op, "code": refused.code}))
        return 1
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
