#!/usr/bin/env python3
"""Candidate accounts on company ATS portals: one per tenant, created by the CLOSER when the portal requires one.

Why. Workday (backend-3), iCIMS and Oracle Recruiting Cloud (backend-4), 14/09:
the operator decided that when a portal OBLIGES a candidate account, the
CLOSER creates it (piani/closer-workday-decision-master-2-res.txt). One module
for every recipe, so the rules are written once:

- email = the profile's contact email; password generated strong, one per
  tenant (platform + host), saved BEFORE it is typed (a kill between the two
  leaves a known password, never an unknown account);
- the password lives only in $JHT_HOME/credentials/ats-accounts/<tenant>.json
  (file 0600, folder 0700); never in a log, checkpoint, receipt, notice or
  Telegram; a field that holds it is hidden before any screenshot;
- a file with loose permissions, another owner or broken JSON is refused
  (AccountStop account_credentials_unsafe), never silently used or replaced;
- "this email is already registered" without saved credentials stops as
  account_email_in_use: no automatic password reset;
- the consent recorded for the receipt is the terms box of the account step
  only (tenant, terms text/URL, instant).

Verification codes and links are verification_code.py's (mailbox or Telegram).
"""

from __future__ import annotations

import contextlib
import json
import os
import re
import secrets
import stat
import string
import tempfile
import urllib.parse
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

ACCOUNTS_SUBDIR = ("credentials", "ats-accounts")
PENDING = "pending"  # saved, typed or about to be; the portal has not confirmed it yet
ACTIVE = "active"  # the portal accepted the account (signed in or created)

_SYMBOLS = "!@#%*-_+=?"
_TENANT_SAFE = re.compile(r"[^a-z0-9.-]+")

EMAIL_IN_USE = re.compile(
    r"(?:e-?mail|account|user(?:name)?)[^.\n]{0,60}(?:already (?:exists|registered|in use|taken|associated)|is (?:already )?in use)"
    r"|already (?:have|has) an account|an account (?:with|for) this e-?mail (?:already )?exists"
    r"|(?:correo|cuenta)[^.\n]{0,60}ya (?:existe|está registrad[oa]|está en uso)"
    r"|(?:e-?mail|account)[^.\n]{0,60}(?:già (?:registrat[oa]|esistente|in uso)|esiste già)"
    r"|(?:e-?mail|konto)[^.\n]{0,60}(?:bereits (?:registriert|vergeben|verwendet|vorhanden))"
    r"|(?:e-?mail|compte)[^.\n]{0,60}(?:déjà (?:utilisée?|enregistrée?|existant))"
    r"|(?:e-?mail|conta)[^.\n]{0,60}já (?:existe|está registad[oa]|está em uso|cadastrad[oa])"
    r"|(?:e-?mail|fiók)[^.\n]{0,60}már (?:regisztrált|létezik|használatban)",
    re.I,
)


class AccountStop(RuntimeError):
    """A candidate account the CLOSER cannot use or create; `reason` is a stable slug."""

    def __init__(self, reason: str, detail: str):
        super().__init__(detail)
        self.reason = reason
        self.detail = detail


@dataclass(frozen=True)
class Credentials:
    tenant: str
    email: str
    password: str
    state: str = PENDING
    created_at: str = ""

    def __repr__(self) -> str:  # the password never reaches a log through repr()
        return f"Credentials(tenant={self.tenant!r}, email=<set>, password=<hidden>, state={self.state!r})"

    __str__ = __repr__


def tenant_id(platform: str, url_or_host: str) -> str:
    """platform:host, lowercased and file-name safe (careers-es-axa.icims.com → icims_careers-es-axa.icims.com)."""
    raw = str(url_or_host or "").strip()
    host = urllib.parse.urlsplit(raw).hostname if "://" in raw else raw
    host = _TENANT_SAFE.sub("-", str(host or "").casefold().rstrip("."))
    kind = _TENANT_SAFE.sub("-", str(platform or "").casefold())
    if not host or not kind:
        raise ValueError("an account tenant needs a platform and a host")
    return f"{kind}_{host}"


def generate_password(length: int = 20) -> str:
    """Strong and accepted by common portal policies: upper, lower, digit and one plain symbol."""
    if length < 12:
        raise ValueError("password too short")
    pools = (string.ascii_uppercase, string.ascii_lowercase, string.digits, _SYMBOLS)
    chars = [secrets.choice(pool) for pool in pools]
    everything = "".join(pools)
    chars += [secrets.choice(everything) for _ in range(length - len(chars))]
    secrets.SystemRandom().shuffle(chars)
    return "".join(chars)


def _folder(jht_home: Path) -> Path:
    return Path(jht_home).joinpath(*ACCOUNTS_SUBDIR)


def _path(jht_home: Path, tenant: str) -> Path:
    return _folder(jht_home) / f"{tenant}.json"


def load(jht_home: Path, tenant: str) -> Credentials | None:
    """The saved account of this tenant, None when there is none; AccountStop when the file is unsafe."""
    path = _path(jht_home, tenant)
    try:
        info = path.lstat()
    except FileNotFoundError:
        return None
    except OSError as exc:
        raise AccountStop("account_credentials_unsafe", f"credentials file unreadable ({type(exc).__name__})") from exc
    if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or info.st_uid != os.getuid():
        raise AccountStop("account_credentials_unsafe", "credentials file is not a private regular file of this user")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise AccountStop("account_credentials_unsafe", "credentials file is not valid JSON") from exc
    if not (
        isinstance(data, dict)
        and data.get("tenant") == tenant
        and isinstance(data.get("email"), str) and "@" in data["email"]
        and isinstance(data.get("password"), str) and len(data["password"]) >= 12
        and data.get("state") in {PENDING, ACTIVE}
    ):
        raise AccountStop("account_credentials_unsafe", "credentials file has an unexpected shape")
    return Credentials(tenant, data["email"], data["password"], data["state"], str(data.get("created_at", "")))


def _write(jht_home: Path, credentials: Credentials) -> None:
    folder = _folder(jht_home)
    folder.mkdir(parents=True, exist_ok=True)
    os.chmod(folder, 0o700)
    payload = {
        "tenant": credentials.tenant,
        "email": credentials.email,
        "password": credentials.password,
        "state": credentials.state,
        "created_at": credentials.created_at,
    }
    handle = tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=folder, prefix=".acct.", delete=False)
    try:
        os.chmod(handle.name, 0o600)
        json.dump(payload, handle, sort_keys=True)
        handle.flush()
        os.fsync(handle.fileno())
        handle.close()
        os.replace(handle.name, _path(jht_home, credentials.tenant))
    except BaseException:
        handle.close()
        with contextlib.suppress(OSError):
            os.unlink(handle.name)
        raise


def create_pending(jht_home: Path, tenant: str, email: str) -> Credentials:
    """A new password for this tenant, saved (state pending) before the portal sees it.

    Refuses to replace a saved account: an existing file is the account the
    portal may already know, and overwriting it would lock the user out.
    """
    if not isinstance(email, str) or "@" not in email:
        raise AccountStop("account_email_missing", "the profile has no contact email for the account")
    if load(jht_home, tenant) is not None:
        raise AccountStop("account_exists", "an account is already saved for this portal: sign in with it")
    credentials = Credentials(
        tenant, email.strip(), generate_password(), PENDING, datetime.now(timezone.utc).isoformat(timespec="seconds")
    )
    _write(jht_home, credentials)
    return credentials


def mark_active(jht_home: Path, credentials: Credentials) -> Credentials:
    """The portal accepted the account: keep it as active."""
    active = Credentials(credentials.tenant, credentials.email, credentials.password, ACTIVE, credentials.created_at)
    _write(jht_home, active)
    return active


def email_in_use(text: str) -> bool:
    """The portal says this email already has an account."""
    return bool(EMAIL_IN_USE.search(" ".join(str(text or "").split())))


def email_in_use_stop(tenant: str) -> AccountStop:
    return AccountStop(
        "account_email_in_use",
        f"The portal says the profile's email already has an account ({tenant}) and no password is saved for it; "
        "the CLOSER never resets a password",
    )


def consent_record(tenant: str, terms_text: str, terms_url: str = "") -> dict[str, str]:
    """What the receipt keeps about the one consent given: the account step's terms box."""
    return {
        "tenant": tenant,
        "terms_text": " ".join(str(terms_text or "").split())[:500],
        "terms_url": str(terms_url or "")[:500],
        "accepted_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


SECRET_ATTR = "data-jht-secret"
_HIDE_JS = """(attr) => {
  const hidden = [];
  document.querySelectorAll(`input[type=password], [${attr}]`).forEach(el => {
    hidden.push([el, el.style.visibility]);
    el.style.visibility = 'hidden';
  });
  window.__jhtHiddenSecrets = hidden;
  return hidden.length;
}"""
_SHOW_JS = """() => {
  (window.__jhtHiddenSecrets || []).forEach(([el, value]) => { el.style.visibility = value; });
  window.__jhtHiddenSecrets = [];
}"""


def fill_secret(control: Any, password: str) -> None:
    """Type the password and mark the field, so screenshots hide it even if the page shows it as text."""
    control.evaluate(f"el => el.setAttribute('{SECRET_ATTR}', '1')")
    control.fill(password)


@contextlib.contextmanager
def secrets_hidden(page: Any) -> Iterator[None]:
    """Hide every password field (and every field marked by fill_secret) for the duration of a screenshot."""
    try:
        page.evaluate(_HIDE_JS, SECRET_ATTR)
    except Exception as exc:
        raise AccountStop("account_secret_unhidden", "password fields could not be hidden before a screenshot") from exc
    try:
        yield
    finally:
        with contextlib.suppress(Exception):
            page.evaluate(_SHOW_JS)
