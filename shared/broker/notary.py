"""The authorisations to apply, held by the broker: the CLOSER sends only what is recorded here.

An application goes out only for a position the person authorised, and only to where the person
saw it would go. The flag in the agents' database says so, but the agents' container can write
that database: the broker, which runs as its own uid with its own state, is where an
authorisation is proven. It records one only from a channel the agents do not hold (the host's
admin exec here; the website's door and the Telegram bridge each from their own channel), and the
CLOSER claims it, once, right before it sends.

One authorisation per position: the instant of the person's click (the box's fixed format) and the
destination the person was shown (`destination()`), single use, and only moving forward:

- `record` takes an instant strictly newer than any the position has already used or withdrawn;
- `claim` (right before the send) is yes once, for a valid authorisation whose destination is the
  one the CLOSER is about to send to, and spends it in the same step;
- `revoke` (the person withdrew) only narrows; `check` only reads.

From the agents' socket only `claim`, `revoke` and `check` exist: none of them widens.
A failure is a fixed code; the state never holds a text that came from a request.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from urllib.parse import urlsplit

import tldextract

from . import store

STATE = "authorisations"
# The box's own instant: `2026-10-23T18:04:05.123Z`.
INSTANT = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
# The channels that record: the host's admin exec (desktop app, the person's terminal on the host),
# the website's door, the Telegram bridge.
ORIGINS = ("user_local", "user_web", "user_telegram")
# The portals an application goes through by name, not by its own website.
PORTALS = ("linkedin", "indeed", "infojobs", "glassdoor", "greenhouse", "lever", "workday",
           "smartrecruiters", "ashby", "personio", "recruitee", "teamtailor")
LABEL = r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
DOMAIN = re.compile(rf"^(?:{LABEL}\.)+[a-z]{{2,63}}$")
# The bundled Public Suffix List is the only authority for reducing a host to a
# registrable domain. Network refresh is deliberately disabled: an unavailable
# or altered remote list must never decide an authorisation boundary at claim
# time. The private PSL section is essential here: `acme.github.io` and
# `other.github.io` are distinct registrable domains, as are similar tenant
# hosts maintained in the list.
_PSL = tldextract.TLDExtract(suffix_list_urls=(), include_psl_private_domains=True)
MAX_POSITION_ID = 2_147_483_647
MAX_POSITIONS = 20_000


class NotaryRefusal(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _now() -> str:
    now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"


def registrable(host: str) -> str | None:
    """The PSL registrable part of a host, or None when the PSL cannot prove one."""
    host = host.lower()
    host = host[:-1] if host.endswith(".") else host
    if len(host) > 253 or not DOMAIN.fullmatch(host):
        return None
    parsed = _PSL(host)
    # tldextract leaves `suffix` empty for an unknown final label. Never fall
    # back to splitting dots: an unknown public suffix may be multi-tenant.
    if not parsed.suffix or not parsed.domain:
        return None
    return f"{parsed.domain}.{parsed.suffix}".lower()


def destination(value: object) -> str:
    """The closed form of a destination: `web:<registrable domain>`, `email:<domain>`,
    `portal:<name>`. The same function makes the recorded one and the claimed one, and a portal's
    own domain is the portal (`web:jobs.lever.co` is `portal:lever`)."""
    if not isinstance(value, str) or len(value) > 300:
        raise NotaryRefusal("destination_invalid")
    kind, _, rest = value.partition(":")
    if kind == "portal" and rest in PORTALS:
        return value
    if kind == "web":
        return destination_of_host(rest)
    if kind == "email":
        domain = registrable(rest)
        if domain:
            return f"email:{domain}"
    raise NotaryRefusal("destination_invalid")


# The portals' own domains: an application on one of them is bound to the portal, not to the
# company. Exact registrable domains only: `indeed.xyz` is somebody else's.
PORTAL_DOMAINS = {
    "linkedin.com": "linkedin",
    "indeed.com": "indeed", "indeed.it": "indeed", "indeed.co.uk": "indeed", "indeed.de": "indeed",
    "indeed.fr": "indeed", "indeed.es": "indeed",
    "infojobs.it": "infojobs", "infojobs.net": "infojobs",
    "glassdoor.com": "glassdoor", "glassdoor.it": "glassdoor", "glassdoor.co.uk": "glassdoor",
    "glassdoor.de": "glassdoor",
    "greenhouse.io": "greenhouse",
    "lever.co": "lever",
    "myworkdayjobs.com": "workday", "workday.com": "workday",
    "smartrecruiters.com": "smartrecruiters",
    "ashbyhq.com": "ashby",
    "personio.de": "personio", "personio.com": "personio",
    "recruitee.com": "recruitee",
    "teamtailor.com": "teamtailor",
}
assert set(PORTAL_DOMAINS.values()) <= set(PORTALS)


def destination_of_host(host: object) -> str:
    """Where a page on `host` sends the application: its portal, or the company's own domain."""
    domain = registrable(host) if isinstance(host, str) else None
    if domain is None:
        raise NotaryRefusal("destination_invalid")
    portal = PORTAL_DOMAINS.get(domain)
    return f"portal:{portal}" if portal else f"web:{domain}"


def destination_of_url(url: object) -> str:
    """The destination of an http(s) page, by its host (after the redirects, for the CLOSER)."""
    if not isinstance(url, str) or len(url) > 4096:
        raise NotaryRefusal("destination_invalid")
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise NotaryRefusal("destination_invalid")
    return destination_of_host(parts.hostname)


def destination_of_address(address: object) -> str:
    """The destination of a mail: the domain of the address it goes to."""
    if not isinstance(address, str) or len(address) > 320 or address.count("@") != 1:
        raise NotaryRefusal("destination_invalid")
    domain = address.rsplit("@", 1)[1].lower()
    domain = domain[:-1] if domain.endswith(".") else domain
    if len(domain) > 253 or not DOMAIN.fullmatch(domain):
        raise NotaryRefusal("destination_invalid")
    registered = registrable(domain)
    if registered is None:
        raise NotaryRefusal("destination_invalid")
    return f"email:{registered}"


def same_place(recorded: object, claimed: str) -> bool:
    """The send goes where the person saw it would go: the same destination, or the company's own
    domain by mail instead of by its website (`web:example.com` and `email:example.com`). A portal is
    only itself."""
    if recorded == claimed:
        return True
    if not isinstance(recorded, str):
        return False
    kinds = {recorded.partition(":")[0], claimed.partition(":")[0]}
    return kinds == {"web", "email"} and recorded.partition(":")[2] == claimed.partition(":")[2]


def valid_position(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= MAX_POSITION_ID:
        raise NotaryRefusal("position_invalid")
    return value


def valid_instant(value: object) -> str:
    if not isinstance(value, str) or not INSTANT.fullmatch(value):
        raise NotaryRefusal("instant_invalid")
    try:
        datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%fZ")
    except ValueError:
        raise NotaryRefusal("instant_invalid") from None
    return value


def _load() -> dict:
    data = store.read_state(STATE, {})
    positions = data.get("positions")
    return {"positions": positions if isinstance(positions, dict) else {}}


def _entry(data: dict, pid: int) -> dict:
    entry = data["positions"].get(str(pid))
    return entry if isinstance(entry, dict) else {}


def _store(data: dict, pid: int, entry: dict) -> None:
    if str(pid) not in data["positions"] and len(data["positions"]) >= MAX_POSITIONS:
        raise NotaryRefusal("register_full")
    data["positions"][str(pid)] = entry
    store.write_state(STATE, data)


def record(position_id: object, instant: object, origin: object, to: object) -> dict:
    """The person authorised `position_id` at `instant`, on the channel `origin`, to `to`."""
    pid = valid_position(position_id)
    at = valid_instant(instant)
    if origin not in ORIGINS:
        raise NotaryRefusal("origin_invalid")
    where = destination(to)
    with store.locked(STATE):
        data = _load()
        entry = _entry(data, pid)
        # Never back: an instant already used, withdrawn or recorded is not a new authorisation.
        floor = entry.get("floor") or ""
        current = entry.get("instant") or ""
        if at <= floor or at < current:
            raise NotaryRefusal("instant_not_newer")
        if at == current and entry.get("state") == "valid":
            if entry.get("destination") != where:
                raise NotaryRefusal("instant_not_newer")
            return {"ok": True, "status": "already_recorded"}
        _store(data, pid, {"instant": at, "origin": origin, "destination": where, "state": "valid",
                           "recorded_at": _now(), "floor": floor})
    return {"ok": True, "status": "recorded"}


def claim(position_id: object, to: object) -> dict:
    """Right before the send: yes once, for a valid authorisation to that destination."""
    pid = valid_position(position_id)
    where = destination(to)
    with store.locked(STATE):
        data = _load()
        entry = _entry(data, pid)
        if entry.get("state") != "valid":
            return {"ok": True, "claimed": False, "reason": "not_authorised"}
        if not same_place(entry.get("destination"), where):
            return {"ok": True, "claimed": False, "reason": "destination_mismatch"}
        _store(data, pid, {**entry, "state": "claimed", "claimed_at": _now(),
                           "floor": max(entry.get("floor") or "", entry["instant"])})
    return {"ok": True, "claimed": True, "origin": entry["origin"], "instant": entry["instant"]}


def revoke(position_id: object, instant: object) -> dict:
    """The person withdrew at `instant`: every authorisation up to it is gone, and stays gone."""
    pid = valid_position(position_id)
    at = valid_instant(instant)
    with store.locked(STATE):
        data = _load()
        entry = _entry(data, pid)
        floor = max(entry.get("floor") or "", at)
        if entry.get("state") == "valid" and (entry.get("instant") or "") <= at:
            entry, status = {**entry, "state": "revoked", "floor": floor}, "revoked"
        else:
            # Nothing valid up to that instant: the floor still moves, so that instant (and any
            # older one) can never be recorded afterwards.
            entry, status = ({**entry, "floor": floor} if entry else {"floor": floor}), "nothing_to_revoke"
        _store(data, pid, entry)
    return {"ok": True, "status": status}


def check(position_id: object) -> dict:
    """What the CLOSER may expect, read only: whether a valid authorisation is there, and to where."""
    pid = valid_position(position_id)
    entry = _entry(_load(), pid)
    if entry.get("state") != "valid":
        return {"ok": True, "proven": False}
    return {"ok": True, "proven": True, "destination": entry["destination"], "origin": entry["origin"],
            "instant": entry["instant"]}


def show(position_id: object) -> dict:
    """What the register holds for one position, for the host."""
    pid = valid_position(position_id)
    entry = _entry(_load(), pid)
    keys = ("instant", "origin", "destination", "state", "recorded_at", "claimed_at", "floor")
    return {"ok": True, "position_id": pid, **{key: entry.get(key) for key in keys}}
