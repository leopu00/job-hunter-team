"""The broker asks whether the website sync is on before EVERY call to the website.

The broker cannot read cloud.json (its home is an empty tmpfs), so the host tells it one word, `on`
or `off`, kept in its state volume. It starts off, it stays as it was across a restart of the broker
alone, the agents' socket can only turn it off, and while it is not `on` no request leaves: `urlopen`
is replaced by a function that fails the test when it is called while the sync is off. Synthetic data only.
"""
import io
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared"))
sys.path.insert(0, str(ROOT / "shared" / "skills"))

ACCOUNT = "11111111-1111-4111-8111-111111111111"
TOKEN = b"jht_sync_abcdefghijklmnopqrstuvwxyz"


@pytest.fixture
def broker(tmp_path, monkeypatch):
    for name in ("secrets", "state"):
        (tmp_path / name).mkdir(mode=0o700)
    monkeypatch.setenv("JHT_BROKER_SECRETS", str(tmp_path / "secrets"))
    monkeypatch.setenv("JHT_BROKER_STATE", str(tmp_path / "state"))
    from broker import admin, protocol, server, webauth

    webauth.set_account(ACCOUNT)
    webauth.set_token(TOKEN)
    return type("B", (), {"admin": admin, "protocol": protocol, "server": server, "webauth": webauth})


class Reply:
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self, *_):
        return json.dumps({"ok": True, "account_id": ACCOUNT, "authorizations": [], "cursor": None}).encode()


@pytest.fixture
def requests(broker, monkeypatch):
    seen = []

    def urlopen(request, timeout=None):
        seen.append(request.full_url)
        return Reply()

    monkeypatch.setattr(broker.webauth, "urlopen", urlopen)
    return seen


def admin(broker, *argv):
    out = io.StringIO()
    real = sys.stdout
    sys.stdout = out
    try:
        code = broker.admin.main(list(argv))
    finally:
        sys.stdout = real
    return code, json.loads(out.getvalue())


def ask(broker, op, **args):
    return broker.server.handle(json.dumps({"op": op, "args": args, "role": "cli"}).encode())


class Ticks:
    """A stopping event that lets the loop run `n` rounds and records the waits it asked for."""

    def __init__(self, n, between=None):
        self.n, self.waits, self.between = n, [], between or {}

    def wait(self, delay):
        self.waits.append(delay)
        round_ = len(self.waits)
        if round_ in self.between:
            self.between[round_]()
        return round_ > self.n


# ── the state ───────────────────────────────────────────────────────────────
def test_a_new_broker_is_off_and_the_account_and_the_token_do_not_turn_it_on(broker):
    assert broker.webauth.show()["sync"] == "off"
    assert broker.webauth.configured() is True and broker.webauth.sync_enabled() is False


def test_the_host_turns_it_on_and_off_and_only_with_a_known_word(broker):
    assert admin(broker, "apply", "web-sync", "on") == (0, {"ok": True, "sync": "on"})
    assert broker.webauth.sync_enabled() is True and admin(broker, "apply", "web-status")[1]["sync"] == "on"
    assert admin(broker, "apply", "web-sync", "off") == (0, {"ok": True, "sync": "off"})
    with pytest.raises(SystemExit):
        broker.admin.main(["apply", "web-sync", "maybe"])
    with pytest.raises(broker.webauth.WebAuthRefusal, match="sync_mode_invalid"):
        broker.webauth.set_sync("true")


def test_the_word_stays_across_a_restart_of_the_broker_alone(broker, monkeypatch):
    broker.webauth.set_sync("off")
    for name in [m for m in sys.modules if m == "broker" or m.startswith("broker.")]:
        del sys.modules[name]  # a new process: nothing in memory, only the state volume
    from broker import webauth

    assert webauth.sync_enabled() is False and webauth.show()["sync"] == "off"
    webauth.set_sync("on")
    for name in [m for m in sys.modules if m == "broker" or m.startswith("broker.")]:
        del sys.modules[name]
    from broker import webauth as again

    assert again.sync_enabled() is True


# ── no call while it is off ─────────────────────────────────────────────────
def test_sync_makes_no_request_while_the_sync_is_off_whoever_calls_it(broker, requests):
    with pytest.raises(broker.webauth.WebAuthRefusal, match="web_sync_paused"):
        broker.webauth.sync()
    assert broker.admin.main(["apply", "sync-web"]) != 0  # the host's manual sync is stopped too
    assert requests == []


def test_sync_makes_one_request_when_it_is_on_and_none_after_a_pause_and_one_after_a_resume(broker, requests):
    broker.webauth.set_sync("on")
    assert broker.webauth.sync()["status"] == "synced" and len(requests) == 1
    assert ask(broker, "web.pause") == {"ok": True, "sync": "off"}
    with pytest.raises(broker.webauth.WebAuthRefusal, match="web_sync_paused"):
        broker.webauth.sync()
    assert len(requests) == 1
    broker.webauth.set_sync("on")
    broker.webauth.sync()
    assert len(requests) == 2


# ── the loop asks before every call ─────────────────────────────────────────
def test_the_loop_calls_nothing_while_off_and_keeps_its_interval(broker, requests, monkeypatch):
    def never(*_a, **_k):
        raise AssertionError("the loop reached the website step while the sync is off")

    monkeypatch.setattr(broker.webauth, "sync", never)  # the loop's own check, not only the one inside sync()
    ticks = Ticks(3)
    broker.server._web_sync_loop(ticks)
    assert requests == [] and set(ticks.waits) == {broker.server.WEB_SYNC_INTERVAL}


def test_the_loop_follows_a_pause_that_arrives_with_the_team_running(broker, requests):
    broker.webauth.set_sync("on")
    ticks = Ticks(5, between={
        3: lambda: ask(broker, "web.pause"),          # paused after two calls: the rounds that follow call nothing
        5: lambda: broker.webauth.set_sync("on"),     # resumed: the next round calls again
    })
    broker.server._web_sync_loop(ticks)
    assert len(requests) == 3  # rounds 1 and 2, then 6 (after the resume at wait 5)
    assert set(ticks.waits) == {broker.server.WEB_SYNC_INTERVAL}  # no error interval for a pause


def test_a_pause_between_the_check_and_the_call_is_not_an_error(broker, requests, monkeypatch):
    broker.webauth.set_sync("on")
    real = broker.webauth.sync_enabled

    def checked_then_paused():
        answer = real()
        broker.webauth.set_sync("off")  # lands right after the loop's check
        return answer

    monkeypatch.setattr(broker.webauth, "sync_enabled", checked_then_paused)
    ticks = Ticks(1)
    broker.server._web_sync_loop(ticks)
    assert requests == [] and set(ticks.waits) == {broker.server.WEB_SYNC_INTERVAL}


# ── the agents' socket only narrows ─────────────────────────────────────────
def test_the_agents_socket_can_pause_and_cannot_resume(broker):
    broker.webauth.set_sync("on")
    assert ask(broker, "web.pause") == {"ok": True, "sync": "off"}
    assert ask(broker, "web.pause", mode="on") == {"ok": False, "reason": "unexpected_field"}
    for op in ("web.resume", "web.sync", "web.on", "web.sync_on"):
        assert ask(broker, op) == {"ok": False, "reason": "unknown_operation"}
    assert broker.webauth.sync_enabled() is False
