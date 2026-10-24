"""The box's website sync token, checked and renewed from the desktop app (shared/skills/cloud_token.py).

A token that expired cut a box off the website for 16 days on 23/10 without anyone knowing. The app
renews it for the user through this one script, so nobody opens a terminal on the box. The new token
is a secret: it comes on stdin, it is verified with the website before anything is written, it must
belong to the account the box is paired with, and it is never printed. Synthetic tokens and a fake
website only.
"""
from __future__ import annotations

import io
import json
import os
import stat
import sys
import urllib.error
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "shared" / "skills"))

import cloud_token as ct  # noqa: E402

OLD = "jht_sync_OLDOLDOLDOLDOLDOLDOLDOLD0001"
NEW = "jht_sync_NEWNEWNEWNEWNEWNEWNEWNEW0002"
OWNER = "00000000-0000-4000-8000-000000000001"
NOW = 1_800_000_000.0  # a fixed instant
DAY = 86400


def iso(seconds_from_now: float) -> str:
    from datetime import datetime, timezone

    return datetime.fromtimestamp(NOW + seconds_from_now, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


class Reply:
    def __init__(self, body):
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self, _limit=-1):
        return json.dumps(self.body).encode()


class Website:
    """A fake website: `accepts` maps a token to the body it answers; any other token is a 401."""

    def __init__(self, accepts=None, status=None, boom=None):
        self.accepts, self.status, self.boom, self.calls = accepts or {}, status, boom, []

    def __call__(self, request, timeout=None):
        token = request.get_header("Authorization").removeprefix("Bearer ")
        self.calls.append((request.full_url, token, timeout))
        if self.boom:
            raise self.boom
        if self.status:
            raise urllib.error.HTTPError(request.full_url, self.status, "x", {}, None)
        if token not in self.accepts:
            raise urllib.error.HTTPError(request.full_url, 401, "token scaduto", {}, None)
        return Reply(self.accepts[token])


def body(owner=OWNER, expires_at="absent", name="vps"):
    token = {"id": "t1", "name": name}
    if expires_at != "absent":
        token["expires_at"] = expires_at
    return {"ok": True, "user_id": owner, "token": token}


@pytest.fixture
def box(tmp_path, monkeypatch):
    file = tmp_path / "cloud.json"
    file.write_text(json.dumps({
        "enabled": True, "base_url": "https://cloud.example", "token": OLD, "user_id": OWNER,
        "token_name": "old", "supabase_refresh_token": "KEEP-ME",
    }))
    monkeypatch.setattr(ct, "CLOUD_FILE", str(file))
    return file


def run(op, *, stdin=b"", website=None, capsys=None):
    code = ct.main([op], stdin=io.BytesIO(stdin), opener=website or Website(), now=NOW)
    out = capsys.readouterr().out
    return code, json.loads(out.strip().splitlines()[-1]), out


def line(token):
    return (json.dumps({"token": token}) + "\n").encode()


# ---- check ----------------------------------------------------------------------------------


def test_a_token_the_website_refuses_is_said_expired(box, capsys):
    code, out, _ = run("check", website=Website(), capsys=capsys)
    assert (code, out) == (0, {"ok": True, "op": "check", "state": "expired", "expires_at": None, "days_left": None})


@pytest.mark.parametrize("seconds,state,days", [
    (60 * DAY, "active", 60),
    (14 * DAY, "expiring", 14),
    (DAY // 2, "expiring", 1),
])
def test_a_token_that_expires_soon_is_said_expiring(box, capsys, seconds, state, days):
    site = Website({OLD: body(expires_at=iso(seconds))})
    code, out, _ = run("check", website=site, capsys=capsys)
    assert (code, out["state"], out["days_left"]) == (0, state, days)
    assert out["expires_at"] == iso(seconds)


def test_no_expiry_and_an_unreported_expiry_are_not_the_same_thing(box, capsys):
    _, none, _ = run("check", website=Website({OLD: body(expires_at=None)}), capsys=capsys)
    _, unknown, _ = run("check", website=Website({OLD: body()}), capsys=capsys)
    assert none["state"] == "none" and unknown["state"] == "unknown"


@pytest.mark.parametrize("site", [Website(status=500), Website(boom=urllib.error.URLError("down")), Website(boom=TimeoutError())])
def test_an_unreachable_website_is_not_an_expired_token(box, capsys, site):
    code, out, _ = run("check", website=site, capsys=capsys)
    assert (code, out) == (1, {"ok": False, "op": "check", "code": "cloud_unreachable"})


def test_the_token_goes_only_to_the_https_website_of_the_box(box, capsys):
    config = json.loads(box.read_text())
    config["base_url"] = "http://cloud.example"
    box.write_text(json.dumps(config))
    site = Website({OLD: body()})
    code, out, _ = run("check", website=site, capsys=capsys)
    assert (code, out["code"], site.calls) == (1, "cloud_not_configured", [])


def test_a_box_without_cloud_config_says_so(box, capsys):
    box.unlink()
    code, out, _ = run("check", capsys=capsys)
    assert (code, out["code"]) == (1, "cloud_not_configured")


# ---- apply ----------------------------------------------------------------------------------


def test_apply_writes_the_verified_token_and_keeps_every_other_key(box, capsys):
    site = Website({NEW: body(expires_at=iso(90 * DAY), name="renewed")})
    code, out, raw = run("apply", stdin=line(NEW), website=site, capsys=capsys)
    assert code == 0
    assert out == {"ok": True, "op": "apply", "expires_at": iso(90 * DAY), "days_left": 90}
    written = json.loads(box.read_text())
    assert written["token"] == NEW and written["token_name"] == "renewed" and written["enabled"] is True
    assert written["supabase_refresh_token"] == "KEEP-ME" and written["user_id"] == OWNER
    assert stat.S_IMODE(box.stat().st_mode) == 0o600
    assert NEW not in raw and OLD not in raw  # the secret is never printed
    assert [call[:2] for call in site.calls] == [("https://cloud.example/api/cloud-sync/ping", NEW)]
    assert sorted(p.name for p in box.parent.iterdir()) == ["cloud.json"]  # no temp file left


def test_a_sync_the_user_turned_off_stays_off(box, capsys):
    config = json.loads(box.read_text())
    config["enabled"] = False
    box.write_text(json.dumps(config))
    code, out, _ = run("apply", stdin=line(NEW), website=Website({NEW: body()}), capsys=capsys)
    assert code == 0
    written = json.loads(box.read_text())
    assert written["token"] == NEW and written["enabled"] is False


def test_a_token_the_website_refuses_is_not_written(box, capsys):
    before = box.read_text()
    code, out, _ = run("apply", stdin=line(NEW), website=Website({OLD: body()}), capsys=capsys)
    assert (code, out) == (1, {"ok": False, "op": "apply", "code": "token_rejected"})
    assert box.read_text() == before


def test_a_token_of_another_account_is_not_written(box, capsys):
    before = box.read_text()
    site = Website({NEW: body(owner="00000000-0000-4000-8000-0000000000ff")})
    code, out, _ = run("apply", stdin=line(NEW), website=site, capsys=capsys)
    assert (code, out["code"]) == (1, "token_other_account")
    assert box.read_text() == before


def test_an_unreachable_website_writes_nothing(box, capsys):
    before = box.read_text()
    code, out, _ = run("apply", stdin=line(NEW), website=Website(status=503), capsys=capsys)
    assert (code, out["code"]) == (1, "cloud_unreachable")
    assert box.read_text() == before


@pytest.mark.parametrize("stdin", [
    b"", b"\n", b"not json\n", line("jht_sync_short"), line("other_AbCdEfGhIjKlMnOpQrSt"), line(NEW + " ; rm -rf /"),
    json.dumps({"token": NEW, "extra": 1}).encode() + b"\n", json.dumps({"token": 5}).encode() + b"\n",
    b'{"token": "' + b"a" * 2000 + b'"}\n',
])
def test_what_is_not_a_sync_token_is_refused_before_any_call(box, capsys, stdin):
    site = Website({NEW: body()})
    code, out, _ = run("apply", stdin=stdin, website=site, capsys=capsys)
    assert (code, out["code"], site.calls) == (1, "token_malformed", [])


def test_a_token_in_the_arguments_is_not_a_way_in(box):
    with pytest.raises(SystemExit) as raised:
        ct.main(["apply", NEW], stdin=io.BytesIO(line(NEW)), opener=Website({NEW: body()}), now=NOW)
    assert raised.value.code == 2


def test_a_cloud_file_that_cannot_be_rewritten_is_said_and_leaves_no_temp_file(box, capsys, monkeypatch):
    before = box.read_text()

    def refuse(*_a, **_k):
        raise PermissionError("no")

    monkeypatch.setattr(ct.os, "replace", refuse)
    code, out, _ = run("apply", stdin=line(NEW), website=Website({NEW: body()}), capsys=capsys)
    assert (code, out["code"]) == (1, "cloud_write_failed")
    assert box.read_text() == before
    assert [p.name for p in box.parent.iterdir()] == ["cloud.json"]


def test_the_script_never_names_the_secret_in_a_log_or_an_environment():
    source = (REPO / "shared" / "skills" / "cloud_token.py").read_text(encoding="utf-8")
    assert "logging" not in source and "os.environ[" not in source
    assert "print(" in source and source.count("print(") == 2  # the two JSON lines of main()


# ---- redirects ------------------------------------------------------------------------------


@pytest.fixture
def two_servers():
    """A first server that redirects to a second one, which keeps what it is sent. Local, synthetic."""
    import http.server
    import threading

    seen = []

    class Second(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            seen.append(self.headers.get("Authorization"))
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"{}")

        def log_message(self, *args):
            pass

    second = http.server.HTTPServer(("127.0.0.1", 0), Second)

    class First(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(302)
            self.send_header("Location", f"http://127.0.0.1:{second.server_port}/elsewhere")
            self.end_headers()

        def log_message(self, *args):
            pass

    first = http.server.HTTPServer(("127.0.0.1", 0), First)
    threads = [threading.Thread(target=server.serve_forever, daemon=True) for server in (first, second)]
    for thread in threads:
        thread.start()
    try:
        yield f"http://127.0.0.1:{first.server_port}", seen
    finally:
        for server in (first, second):
            server.shutdown()
            server.server_close()


def test_a_redirect_never_carries_the_token_anywhere(two_servers):
    first, seen = two_servers
    with pytest.raises(ct.Refused) as refused:
        ct.ping(first, NEW)  # the real opener, against a real redirect
    assert refused.value.code == "cloud_unreachable"
    assert seen == []  # the second server was never asked, so it never saw the Bearer token
