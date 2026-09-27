"""ats_account: one candidate account per ATS tenant, its password kept private and never shown.

Decision of the operator (14/09, Workday; valid for iCIMS and Oracle): when a
portal obliges an account, the CLOSER creates it under these rules.
"""

from __future__ import annotations

import json
import os
import stat
import string
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "skills"))

import ats_account as acct  # noqa: E402

EMAIL = "jane@example.invalid"


def test_tenant_is_platform_and_host():
    assert acct.tenant_id("icims", "https://careers-es-example.icims.com/jobs/1/login") == "icims_careers-es-example.icims.com"
    assert acct.tenant_id("Workday", "Example.WD3.myworkdayjobs.com.") == "workday_example.wd3.myworkdayjobs.com"
    with pytest.raises(ValueError):
        acct.tenant_id("icims", "")


def test_generated_passwords_are_strong_and_different():
    first, second = acct.generate_password(), acct.generate_password()
    assert first != second and len(first) == 20
    for pool in (string.ascii_uppercase, string.ascii_lowercase, string.digits, acct._SYMBOLS):
        assert any(ch in pool for ch in first)
    with pytest.raises(ValueError):
        acct.generate_password(8)


def test_the_password_is_saved_private_before_it_is_used(tmp_path):
    tenant = acct.tenant_id("icims", "careers.example.icims.com")

    created = acct.create_pending(tmp_path, tenant, EMAIL)

    path = tmp_path / "credentials" / "ats-accounts" / f"{tenant}.json"
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert stat.S_IMODE(path.parent.stat().st_mode) == 0o700
    assert json.loads(path.read_text())["state"] == "pending"
    assert acct.load(tmp_path, tenant) == created
    active = acct.mark_active(tmp_path, created)
    assert acct.load(tmp_path, tenant).state == "active" and active.password == created.password


def test_the_password_never_leaks_through_repr(tmp_path):
    created = acct.create_pending(tmp_path, "oracle_ce_example", EMAIL)
    assert created.password not in repr(created) and created.password not in str(created)
    assert created.password not in f"{created}"


def test_a_saved_account_is_never_replaced(tmp_path):
    acct.create_pending(tmp_path, "icims_example", EMAIL)
    with pytest.raises(acct.AccountStop) as stop:
        acct.create_pending(tmp_path, "icims_example", EMAIL)
    assert stop.value.reason == "account_exists"


def test_no_email_no_account(tmp_path):
    with pytest.raises(acct.AccountStop) as stop:
        acct.create_pending(tmp_path, "icims_example", "")
    assert stop.value.reason == "account_email_missing"


@pytest.mark.parametrize(
    "damage",
    [
        lambda p: os.chmod(p, 0o644),
        lambda p: p.write_text("not json"),
        lambda p: p.write_text(json.dumps({"tenant": "icims_example", "email": EMAIL, "password": "short", "state": "pending"})),
        lambda p: p.write_text(json.dumps({"tenant": "someone_else", "email": EMAIL, "password": "x" * 20, "state": "active"})),
    ],
    ids=["loose-permissions", "broken-json", "short-password", "other-tenant"],
)
def test_an_unsafe_credentials_file_is_refused_never_used(tmp_path, damage):
    acct.create_pending(tmp_path, "icims_example", EMAIL)
    path = tmp_path / "credentials" / "ats-accounts" / "icims_example.json"
    damage(path)

    with pytest.raises(acct.AccountStop) as stop:
        acct.load(tmp_path, "icims_example")

    assert stop.value.reason == "account_credentials_unsafe"


def test_no_file_is_no_account(tmp_path):
    assert acct.load(tmp_path, "icims_example") is None


@pytest.mark.parametrize(
    ("text", "in_use"),
    [
        ("An account with this email already exists.", True),
        ("This email address is already registered. Please sign in.", True),
        ("El correo electrónico ya está registrado", True),
        ("L'indirizzo email è già registrato", True),
        ("Diese E-Mail ist bereits registriert", True),
        ("Cette adresse e-mail est déjà utilisée", True),
        ("Este e-mail já está registado", True),
        ("Ez az e-mail cím már regisztrált", True),
        ("Create your account with your email address", False),
        ("We sent a code to your email", False),
    ],
)
def test_email_in_use(text, in_use):
    assert acct.email_in_use(text) is in_use


def test_email_in_use_stop_never_resets():
    stop = acct.email_in_use_stop("icims_example")
    assert stop.reason == "account_email_in_use" and "never resets" in stop.detail


def test_consent_record_keeps_only_the_terms():
    record = acct.consent_record("icims_example", "  I agree   with the terms ", "https://example.com/terms")
    assert (record["tenant"], record["terms_text"], record["terms_url"]) == (
        "icims_example", "I agree with the terms", "https://example.com/terms")
    assert record["accepted_at"]


# ── screenshots never show a password ────────────────────────────────────────


@pytest.fixture
def page():
    playwright = pytest.importorskip("playwright.sync_api")
    with playwright.sync_playwright() as runtime:
        browser = runtime.chromium.launch(headless=True)
        yield browser.new_page()
        browser.close()


def test_password_fields_are_hidden_during_a_screenshot_and_shown_after(page):
    page.set_content('<input id="p" type="password"><input id="shown" type="text"><input id="plain" type="text">')
    acct.fill_secret(page.locator("#shown"), "Synthetic-Password-1!")  # a portal that shows the password as text

    with acct.secrets_hidden(page):
        hidden = page.evaluate("() => ['p','shown','plain'].map(id => getComputedStyle(document.getElementById(id)).visibility)")
    shown = page.evaluate("() => ['p','shown','plain'].map(id => getComputedStyle(document.getElementById(id)).visibility)")

    assert hidden == ["hidden", "hidden", "visible"]
    assert shown == ["visible", "visible", "visible"]


def test_a_page_that_never_committed_stops_instead_of_waiting_forever(page):
    """page.evaluate has no timeout: on a navigation that never committed it
    waits for a document that never comes (the CLOSER stuck on a hung portal,
    pytest without a verdict from 20/09). The hiding gives up and stops."""
    import time

    page.route("https://portal.example.test/**", lambda route: None)  # never answers
    with pytest.raises(Exception):
        page.goto("https://portal.example.test/apply", timeout=1_000)

    started = time.monotonic()
    with pytest.raises(acct.AccountStop) as stop:
        with acct.secrets_hidden(page):
            pytest.fail("a page whose fields could not be hidden must not reach the screenshot")
    assert stop.value.reason == "account_secret_unhidden"
    assert time.monotonic() - started < acct._SECRET_SCRIPT_TIMEOUT_MS / 1000 + 5


def test_a_page_without_passwords_says_so_across_its_frames(page):
    page.set_content('<input type="text"><iframe srcdoc="<input type=email>"></iframe>')
    page.wait_for_load_state()
    assert len(page.frames) == 2
    assert acct.no_secret_fields(page) is True


def test_a_password_in_an_iframe_or_a_marked_field_is_not_no_secret_fields(page):
    page.set_content('<input type="text"><iframe srcdoc="<input type=password>"></iframe>')
    page.wait_for_load_state()
    assert acct.no_secret_fields(page) is False

    page.set_content('<input id="code" type="text">')
    acct.fill_secret(page.locator("#code"), "123456")
    assert acct.no_secret_fields(page) is False


def test_a_page_that_never_committed_cannot_prove_it_has_no_password(page):
    import time

    page.route("https://portal.example.test/**", lambda route: None)  # never answers
    with pytest.raises(Exception):
        page.goto("https://portal.example.test/done", timeout=1_000)

    started = time.monotonic()
    assert acct.no_secret_fields(page) is False
    assert time.monotonic() - started < acct._SECRET_PROBE_TIMEOUT_MS / 1000 + 3


def test_a_page_that_cannot_hide_its_secrets_stops():
    class Broken:
        def wait_for_function(self, *_args, **_kwargs):
            raise RuntimeError("target closed")

    with pytest.raises(acct.AccountStop) as stop:
        with acct.secrets_hidden(Broken()):
            pass
    assert stop.value.reason == "account_secret_unhidden"
