"""The broker holds the authorisations to apply: the CLOSER sends only what it claims there.

An authorisation is recorded only by the host's admin exec (the desktop app, the person's terminal
on the host), with the destination the person was shown; from the agents' socket it can only be
checked, claimed once right before the send (to that same destination) or withdrawn. It only moves
forward. The request path is exercised through `server.handle`, what the socket calls; the
socket's SO_PEERCRED check runs in the live test.

Run with: pytest tests/test_broker_notary.py -v
"""

import importlib
import io
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest
import tldextract

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared"))
sys.path.insert(0, str(ROOT / "shared" / "skills"))

T0 = "2026-10-23T17:55:00.000Z"
T1 = "2026-10-23T18:00:00.000Z"
T2 = "2026-10-23T18:05:00.000Z"
WEB = "web:example.com"


@pytest.fixture
def broker(tmp_path, monkeypatch):
    for name in ("secrets", "state"):
        (tmp_path / name).mkdir(mode=0o700)
    monkeypatch.setenv("JHT_BROKER_SECRETS", str(tmp_path / "secrets"))
    monkeypatch.setenv("JHT_BROKER_STATE", str(tmp_path / "state"))
    from broker import admin, notary, protocol, server, webauth

    return type("B", (), {"admin": admin, "notary": notary, "protocol": protocol, "server": server, "webauth": webauth})


def admin(broker, *argv):
    out = io.StringIO()
    real = sys.stdout
    sys.stdout = out
    try:
        code = broker.admin.main(list(argv))
    finally:
        sys.stdout = real
    return code, json.loads(out.getvalue())


def ask(broker, op, role="closer", **args):
    return broker.server.handle(json.dumps({"op": op, "args": args, "role": role}).encode())


def claim(broker, pid=42, to=WEB):
    return ask(broker, "apply.claim", position_id=pid, destination=to)


def test_recorded_from_the_host_claimed_once_from_the_socket(broker):
    assert ask(broker, "apply.check", position_id=42) == {"ok": True, "proven": False}
    assert claim(broker) == {"ok": True, "claimed": False, "reason": "not_authorised"}
    assert admin(broker, "apply", "record", "42", T1, WEB) == (0, {"ok": True, "status": "recorded"})
    assert ask(broker, "apply.check", role="", position_id=42) == {
        "ok": True, "proven": True, "destination": WEB, "origin": "user_local", "instant": T1,
    }
    assert claim(broker) == {"ok": True, "claimed": True, "origin": "user_local", "instant": T1}
    # single use: the second claim of the same authorisation is a no
    assert claim(broker) == {"ok": True, "claimed": False, "reason": "not_authorised"}
    assert ask(broker, "apply.check", position_id=42)["proven"] is False


def test_the_destination_binds_the_authorisation(broker):
    admin(broker, "apply", "record", "42", T1, "web:https-is-not-here.example.co.uk")
    shown = admin(broker, "apply", "show", "42")[1]
    assert shown["destination"] == "web:example.co.uk"
    # another site, a lookalike, another company's mailbox, a portal: not where the person saw it go
    for elsewhere in ("web:example.com", "web:example.co.uk.attacker.net", "email:example.com", "portal:linkedin"):
        assert claim(broker, to=elsewhere) == {"ok": True, "claimed": False, "reason": "destination_mismatch"}
    # a mismatch does not spend it; the right destination after the redirects does
    assert claim(broker, to="web:careers.apply.example.co.uk")["claimed"] is True


def test_the_agents_socket_has_no_way_to_record(broker):
    for op in ("apply.record", "apply.authorize", "apply.write", "apply.set", "apply.consume"):
        assert ask(broker, op, position_id=42, instant=T1) == {"ok": False, "reason": "unknown_operation"}
    assert {op for op in broker.protocol.OPERATIONS if op.startswith("apply.")} == {
        "apply.check", "apply.claim", "apply.revoke",
    }
    raw = json.dumps({"op": "apply.claim", "args": {"position_id": 42, "destination": WEB, "origin": "user_local"},
                      "role": "closer"})
    assert broker.server.handle(raw.encode()) == {"ok": False, "reason": "unexpected_field"}


def test_telegram_socket_has_only_the_record_operation(broker):
    record = json.dumps({"op": "apply.record", "args": {
        "position_id": 42, "instant": T1, "destination": WEB,
    }}).encode()
    assert broker.server.handle_telegram(record) == {"ok": True, "status": "recorded"}
    assert claim(broker)["claimed"] is True
    for op in ("apply.check", "apply.claim", "apply.revoke", "mail.status"):
        assert broker.server.handle_telegram(json.dumps({"op": op, "args": {}}).encode()) == {
            "ok": False, "reason": "unknown_operation",
        }
    # The normal socket remains the only one agents can reach, and it still
    # rejects widening the register.
    assert ask(broker, "apply.record", position_id=42, instant=T2, destination=WEB) == {
        "ok": False, "reason": "unknown_operation",
    }


def test_telegram_socket_refuses_a_non_telegram_peer_before_reading(broker, monkeypatch):
    class Connection:
        def __init__(self):
            self.sent = b""
            self.read = False

        def sendall(self, value):
            self.sent += value

        def recv(self, _size):
            self.read = True
            raise AssertionError("the request must not be read")

    connection = Connection()
    monkeypatch.setattr(broker.server, "peer_uid", lambda _conn: 1001)
    broker.server._TelegramHandler(connection, ("local", 0), object())
    assert connection.read is False
    assert json.loads(connection.sent) == {"ok": False, "reason": "peer_not_allowed"}


def test_never_back(broker):
    admin(broker, "apply", "record", "42", T1, WEB)
    assert claim(broker)["claimed"] is True
    # the used instant, or an older one, cannot be recorded again
    assert admin(broker, "apply", "record", "42", T1, WEB) == (1, {"ok": False, "reason": "instant_not_newer"})
    assert admin(broker, "apply", "record", "42", T0, WEB) == (1, {"ok": False, "reason": "instant_not_newer"})
    # a new click is a new authorisation
    assert admin(broker, "apply", "record", "42", T2, WEB)[0] == 0
    assert claim(broker)["claimed"] is True


def test_a_desktop_record_cannot_get_ahead_of_the_broker_clock(broker, monkeypatch):
    now = datetime(2026, 10, 23, 18, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(broker.notary, "_broker_now", lambda: now)
    assert admin(broker, "apply", "record", "42", "2026-10-23T18:05:00.000Z", WEB)[0] == 0
    assert broker.notary.show(42)["instant"] == "2026-10-23T18:00:00.000Z"
    assert admin(broker, "apply", "record", "43", "2026-10-24T18:00:00.000Z", WEB) == (
        1, {"ok": False, "reason": "instant_too_future"},
    )
    # A web withdrawal stamped just after the broker clock is after the stored
    # local authorisation, rather than before the host's future input.
    assert ask(broker, "apply.revoke", role="", position_id=42,
               instant="2026-10-23T18:00:00.001Z") == {"ok": True, "status": "revoked"}
    assert claim(broker, pid=42)["claimed"] is False


def test_a_withdrawal_wins_and_moves_the_floor(broker):
    admin(broker, "apply", "record", "42", T1, WEB)
    assert ask(broker, "apply.revoke", role="", position_id=42, instant=T2) == {"ok": True, "status": "revoked"}
    assert claim(broker)["claimed"] is False
    assert admin(broker, "apply", "record", "42", T1, WEB)[1]["reason"] == "instant_not_newer"
    # a withdrawal of a position never recorded still closes every instant up to it
    assert ask(broker, "apply.revoke", position_id=7, instant=T2)["status"] == "nothing_to_revoke"
    assert admin(broker, "apply", "record", "7", T1, WEB)[1]["reason"] == "instant_not_newer"
    # an older withdrawal does not take a newer authorisation away
    admin(broker, "apply", "record", "8", T2, WEB)
    assert ask(broker, "apply.revoke", position_id=8, instant=T1)["status"] == "nothing_to_revoke"
    assert claim(broker, pid=8)["claimed"] is True


def test_a_newer_record_replaces_the_older_one(broker):
    admin(broker, "apply", "record", "42", T1, WEB)
    admin(broker, "apply", "record", "42", T2, "portal:linkedin")
    assert claim(broker)["reason"] == "destination_mismatch"
    assert claim(broker, to="portal:linkedin")["instant"] == T2
    # the same instant twice is the same record, never a new destination under it
    admin(broker, "apply", "record", "9", T1, WEB)
    assert admin(broker, "apply", "record", "9", T1, WEB) == (0, {"ok": True, "status": "already_recorded"})
    assert admin(broker, "apply", "record", "9", T1, "web:other.org")[1]["reason"] == "instant_not_newer"


@pytest.mark.parametrize("argv,reason", [
    (("record", "0", T1, WEB), "position_invalid"),
    (("record", "-3", T1, WEB), "position_invalid"),
    (("record", "42;rm", T1, WEB), "position_invalid"),
    (("record", " 42", T1, WEB), "position_invalid"),
    (("record", "99999999999", T1, WEB), "position_invalid"),
    (("record", "42", "2026-10-23 18:00:00", WEB), "instant_invalid"),
    (("record", "42", "2026-10-23T18:00:00Z", WEB), "instant_invalid"),
    (("record", "42", "2026-13-23T18:00:00.000Z", WEB), "instant_invalid"),
    (("record", "42", T1 + "\n", WEB), "instant_invalid"),
    (("record", "42", T1, "https://example.com/apply"), "destination_invalid"),
    (("record", "42", T1, "web:localhost"), "destination_invalid"),
    (("record", "42", T1, "web:192.168.1.1"), "destination_invalid"),
    (("record", "42", T1, "portal:myportal"), "destination_invalid"),
    (("record", "42", T1, "web:exa mple.com"), "destination_invalid"),
    (("record", "42", T1, "web:xn--80ak6aa92e.com\n"), "destination_invalid"),
    (("show", "abc"), "position_invalid"),
])
def test_the_hosts_arguments_are_closed(broker, argv, reason):
    assert admin(broker, "apply", *argv) == (1, {"ok": False, "reason": reason})


@pytest.mark.parametrize("op,args,reason", [
    ("apply.claim", {"position_id": True, "destination": WEB}, "field_type"),
    ("apply.claim", {"position_id": "42", "destination": WEB}, "field_type"),
    ("apply.claim", {"position_id": 0, "destination": WEB}, "position_invalid"),
    ("apply.claim", {"position_id": 42, "destination": "example.com"}, "destination_invalid"),
    ("apply.claim", {"position_id": 42}, "missing_field"),
    ("apply.revoke", {"position_id": 42, "instant": "yesterday"}, "instant_invalid"),
])
def test_the_sockets_arguments_are_closed(broker, op, args, reason):
    raw = json.dumps({"op": op, "args": args, "role": "closer"}).encode()
    assert broker.server.handle(raw) == {"ok": False, "reason": reason}


def test_the_registrable_part_of_a_host(broker):
    reg = broker.notary.registrable
    assert reg("jobs.example.com") == "example.com"
    assert reg("Apply.Example.CO.UK.") == "example.co.uk"
    assert reg("example.com.au") == "example.com.au"
    assert reg("a.b.example.de") == "example.de"
    # PSL private suffixes are tenant boundaries: never collapse two unrelated
    # pages merely because the hosting provider has a shared parent domain.
    assert reg("acme.github.io") == "acme.github.io"
    assert reg("other.github.io") == "other.github.io"
    assert reg("acme.pages.dev") == "acme.pages.dev"
    assert reg("acme.gitlab.io") == "acme.gitlab.io"
    assert reg("acme.netlify.app") == "acme.netlify.app"
    assert reg("acme.vercel.app") == "acme.vercel.app"
    # An unknown suffix must refuse instead of guessing from the last labels.
    assert reg("apply.example.unknown-suffix") is None
    for bad in ("localhost", "com", "co.uk", "github.io", "10.0.0.1", "exa_mple.com", "-a.com", ""):
        assert reg(bad) is None, bad


def test_registrable_ignores_an_artificial_tldextract_cache(broker, monkeypatch, tmp_path):
    cache_dir = tmp_path / "poisoned-psl-cache"
    cache = tldextract.cache.DiskCache(str(cache_dir))
    cache.set(
        "publicsuffix.org-tlds",
        {"urls": (), "fallback_to_snapshot": True},
        (["io"], []),
    )
    # This cache would collapse tenants under github.io if a notary read it.
    poisoned = tldextract.TLDExtract(
        cache_dir=str(cache_dir), suffix_list_urls=(), include_psl_private_domains=True,
    )
    assert poisoned("acme.github.io").top_domain_under_public_suffix == "github.io"
    monkeypatch.setenv("TLDEXTRACT_CACHE", str(cache_dir))

    reloaded = importlib.reload(broker.notary)
    assert reloaded._PSL._cache.enabled is False
    assert reloaded.registrable("acme.github.io") == "acme.github.io"


@pytest.mark.parametrize("shown,claimed", [
    ("web:acme.github.io", "web:other.github.io"),
    ("web:acme.pages.dev", "web:other.pages.dev"),
    ("web:acme.gitlab.io", "web:other.gitlab.io"),
    ("web:acme.netlify.app", "web:other.netlify.app"),
    ("web:acme.vercel.app", "web:other.vercel.app"),
    ("email:acme.github.io", "email:other.github.io"),
])
def test_a_private_psl_tenant_can_never_claim_another_tenant(broker, shown, claimed):
    assert admin(broker, "apply", "record", "42", T1, shown) == (0, {"ok": True, "status": "recorded"})
    assert claim(broker, to=claimed) == {"ok": True, "claimed": False, "reason": "destination_mismatch"}


def test_the_origins_are_closed(broker):
    with pytest.raises(broker.notary.NotaryRefusal):
        broker.notary.record(42, T1, "agent_closer", WEB)


def test_where_a_page_or_a_mail_sends_the_application(broker):
    n = broker.notary
    assert n.destination_of_url("https://boards.greenhouse.io/acme/jobs/1") == "portal:greenhouse"
    assert n.destination_of_url("https://acme.wd3.myworkdayjobs.com/en/job/1") == "portal:workday"
    assert n.destination_of_url("https://www.linkedin.com/jobs/view/1") == "portal:linkedin"
    assert n.destination_of_url("http://careers.example.co.uk/apply?x=1") == "web:example.co.uk"
    # the same portal reached by its name or by its domain is the same destination
    assert n.destination("web:jobs.lever.co") == "portal:lever" == n.destination("portal:lever")
    # a lookalike of a portal is its own domain, never the portal
    assert n.destination_of_url("https://indeed.xyz/apply") == "web:indeed.xyz"
    assert n.destination_of_address("hr@" + "mail.example.com") == "email:example.com"
    for url in ("ftp://example.com/", "https://10.0.0.1/", "https://localhost/", "javascript:alert(1)", "", None):
        with pytest.raises(n.NotaryRefusal):
            n.destination_of_url(url)
    for address in ("a@b@example.com", "hr" + "@co.uk", "hr@example.com\n", "hr@", "hr", 7):
        with pytest.raises(n.NotaryRefusal):
            n.destination_of_address(address)


def test_the_company_by_mail_is_the_same_place_as_its_website(broker):
    admin(broker, "apply", "record", "42", T1, "web:careers.example.com")
    assert claim(broker, to="email:other.com")["reason"] == "destination_mismatch"
    assert claim(broker, to="email:hr.example.com")["claimed"] is True
    # a portal is only itself: a recruiter's own mailbox is not the portal
    admin(broker, "apply", "record", "43", T1, "portal:linkedin")
    assert claim(broker, pid=43, to="email:linkedin.com")["reason"] == "destination_mismatch"
    assert claim(broker, pid=43, to="email:gmail.com")["reason"] == "destination_mismatch"


def test_web_receipts_are_bound_to_the_host_account_and_consumed_once(broker, monkeypatch):
    account = "11111111-1111-4111-8111-111111111111"
    assert admin(broker, "apply", "account", account) == (0, {"ok": True, "account_id": account})
    monkeypatch.setattr(sys, "stdin", type("I", (), {"buffer": io.BytesIO(b"jht_sync_abcdefghijklmnopqrstuvwxyz")})())
    assert admin(broker, "apply", "web-token") == (0, {"ok": True, "token": "stored"})

    payload = {
        "ok": True,
        "account_id": account,
        "authorizations": [{
            "id": "22222222-2222-4222-8222-222222222222",
            "legacy_id": 42,
            "created_at": T1,
            "summary": "Synthetic role @ Synthetic company\nDestinazione: example.com",
            "host": "example.com",
            "action": "position.apply_authorize",
            "status": "done",
        }],
        "cursor": T1,
    }

    class Reply:
        status = 200
        def __enter__(self): return self
        def __exit__(self, *_): return False
        def read(self, *_): return json.dumps(payload).encode()

    monkeypatch.setattr(broker.webauth, "urlopen", lambda *_args, **_kwargs: Reply())
    assert admin(broker, "apply", "sync-web") == (0, {"ok": True, "processed": 1, "skipped": {}, "status": "synced"})
    assert claim(broker)["claimed"] is True
    # A replay of the same row id does not widen the register again.
    assert admin(broker, "apply", "sync-web") == (0, {"ok": True, "processed": 0, "skipped": {}, "status": "synced"})
    assert claim(broker)["claimed"] is False


def test_web_status_reports_the_last_result_for_host_diagnosis(broker):
    account = "11111111-1111-4111-8111-111111111111"
    broker.webauth.set_account(account)
    assert admin(broker, "apply", "web-status") == (0, {
        "ok": True, "account_id": account, "token": "absent", "last_result": "account_set",
    })


def test_a_legacy_web_token_requires_repair_and_records_no_authorisation(broker, monkeypatch):
    account = "11111111-1111-4111-8111-111111111111"
    broker.webauth.set_account(account)
    broker.webauth.set_token(b"jht_sync_abcdefghijklmnopqrstuvwxyz")

    def repair_required(*_args):
        raise broker.webauth.WebAuthRefusal("web_repair_required")

    monkeypatch.setattr(broker.webauth, "_fetch", repair_required)
    with pytest.raises(broker.webauth.WebAuthRefusal, match="web_repair_required"):
        broker.webauth.sync()
    assert broker.webauth.show()["last_result"] == "web_repair_required"
    assert ask(broker, "apply.check", position_id=42) == {"ok": True, "proven": False}


def test_web_receipt_for_another_account_records_no_authorisation(broker, monkeypatch):
    account = "11111111-1111-4111-8111-111111111111"
    broker.webauth.set_account(account)
    broker.webauth.set_token(b"jht_sync_abcdefghijklmnopqrstuvwxyz")

    class Reply:
        status = 200
        def __enter__(self): return self
        def __exit__(self, *_): return False
        def read(self, *_): return json.dumps({"ok": True, "account_id": "33333333-3333-4333-8333-333333333333", "authorizations": [], "cursor": T1}).encode()

    monkeypatch.setattr(broker.webauth, "urlopen", lambda *_args, **_kwargs: Reply())
    assert broker.webauth.sync() == {"ok": True, "processed": 0, "status": "account_mismatch"}
    assert ask(broker, "apply.check", position_id=42) == {"ok": True, "proven": False}


def test_a_later_web_withdrawal_wins_over_the_same_position(broker, monkeypatch):
    account = "11111111-1111-4111-8111-111111111111"
    broker.webauth.set_account(account)
    broker.webauth.set_token(b"jht_sync_abcdefghijklmnopqrstuvwxyz")
    rows = [
        {"id": "22222222-2222-4222-8222-222222222222", "legacy_id": 42, "created_at": T1,
         "summary": "Synthetic role @ Synthetic company", "host": "example.com", "action": "position.apply_authorize", "status": "done"},
        {"id": "33333333-3333-4333-8333-333333333333", "legacy_id": 42, "created_at": T2,
         "summary": "Synthetic role @ Synthetic company", "action": "position.apply_revoke", "status": "queued"},
    ]

    class Reply:
        status = 200
        def __enter__(self): return self
        def __exit__(self, *_): return False
        def read(self, *_): return json.dumps({"ok": True, "account_id": account, "authorizations": rows, "cursor": T2}).encode()

    monkeypatch.setattr(broker.webauth, "urlopen", lambda *_args, **_kwargs: Reply())
    assert broker.webauth.sync() == {"ok": True, "processed": 2, "skipped": {}, "status": "synced"}
    assert ask(broker, "apply.check", position_id=42) == {"ok": True, "proven": False}


def test_a_stale_web_row_is_marked_used_and_does_not_block_later_rows(broker, monkeypatch):
    account = "11111111-1111-4111-8111-111111111111"
    broker.webauth.set_account(account)
    broker.webauth.set_token(b"jht_sync_abcdefghijklmnopqrstuvwxyz")
    broker.notary.record(42, T2, "user_local", WEB)
    rows = [
        {"id": "22222222-2222-4222-8222-222222222222", "legacy_id": 42, "created_at": T1,
         "summary": "Synthetic role @ Synthetic company", "host": "example.com", "action": "position.apply_authorize", "status": "done"},
        {"id": "33333333-3333-4333-8333-333333333333", "legacy_id": 7, "created_at": T2,
         "summary": "Synthetic role @ Synthetic company", "host": "example.com", "action": "position.apply_authorize", "status": "done"},
    ]

    class Reply:
        status = 200
        def __enter__(self): return self
        def __exit__(self, *_): return False
        def read(self, *_): return json.dumps({"ok": True, "account_id": account, "authorizations": rows, "cursor": T2}).encode()

    monkeypatch.setattr(broker.webauth, "urlopen", lambda *_args, **_kwargs: Reply())
    assert broker.webauth.sync() == {"ok": True, "processed": 1, "skipped": {"instant_not_newer": 1}, "status": "synced"}
    assert broker.webauth.sync() == {"ok": True, "processed": 0, "skipped": {}, "status": "synced"}
    assert ask(broker, "apply.check", position_id=7)["proven"] is True


def test_a_full_web_page_is_followed_without_waiting_for_the_next_poll(broker, monkeypatch):
    account = "11111111-1111-4111-8111-111111111111"
    broker.webauth.set_account(account)
    broker.webauth.set_token(b"jht_sync_abcdefghijklmnopqrstuvwxyz")
    pages = iter([
        {"ok": True, "account_id": account, "has_more": True, "cursor": T1, "authorizations": [
            {"id": "22222222-2222-4222-8222-222222222222", "legacy_id": 42, "created_at": T1,
             "summary": "Synthetic role @ Synthetic company", "host": "example.com", "action": "position.apply_authorize", "status": "done"},
        ]},
        {"ok": True, "account_id": account, "has_more": False, "cursor": T2, "authorizations": [
            {"id": "33333333-3333-4333-8333-333333333333", "legacy_id": 7, "created_at": T2,
                 "summary": "Synthetic role @ Synthetic company", "host": "example.com", "action": "position.apply_authorize", "status": "done"},
        ]},
    ])
    cursors = []

    def fetch(_token, cursor):
        cursors.append(cursor)
        return next(pages)

    monkeypatch.setattr(broker.webauth, "_fetch", fetch)
    assert broker.webauth.sync() == {"ok": True, "processed": 2, "skipped": {}, "status": "synced"}
    assert cursors == [None, T1]
    assert ask(broker, "apply.check", position_id=42)["proven"] is True
    assert ask(broker, "apply.check", position_id=7)["proven"] is True
