"""The user's manual LinkedIn sign-in, and the flow reusing that profile.

14/09: the operator signs in to LinkedIn with Google and has no LinkedIn
password; Google refuses automated browsers.  `linkedin_apply.py login
--interactive` opens a plain Chromium once, the user signs in by hand, and the
flow reuses the profile.

Synthetic only: a fake Chromium binary that writes a cookie database, made-up
cookie values, Playwright routes.  Nothing reaches LinkedIn or Google.
"""

from __future__ import annotations

import json
import os
import sqlite3
import stat
import sys
import textwrap
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "skills"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import apply_flow  # noqa: E402
import linkedin_apply  # noqa: E402
from apply_flow import ApplicationFlow  # noqa: E402

from test_linkedin_apply_flow import (  # noqa: E402
    JOB,
    Site,
    build_flow,
    checkpoint,
    home,  # noqa: F401 — fixture
    cv_path,  # noqa: F401 — fixture
    page,  # noqa: F401 — fixture
    no_dns_guard,  # noqa: F401 — fixture
    write_credentials,
)

SECRET = "synthetic-li-at-value-never-printed"
_EPOCH_OFFSET_S = 11_644_473_600


def chromium_time(unix_seconds: float) -> int:
    return int((unix_seconds + _EPOCH_OFFSET_S) * 1_000_000)


def write_cookie_db(profile: Path, *, expires: float, host: str = ".www.linkedin.com", name: str = "li_at") -> None:
    database = profile / "Default" / "Network" / "Cookies"
    database.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(database) as conn:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS cookies (host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, expires_utc INTEGER)"
        )
        conn.execute(
            "INSERT INTO cookies VALUES (?, ?, '', ?, ?)", (host, name, SECRET.encode(), chromium_time(expires))
        )


FAKE_CHROMIUM = textwrap.dedent(
    """\
    #!{python}
    import json, os, signal, sqlite3, sys, time
    from pathlib import Path
    record = Path(os.environ["FAKE_CHROMIUM_RECORD"])
    record.write_text(json.dumps({{"argv": sys.argv[1:], "display": os.environ.get("DISPLAY"), "pid": os.getpid()}}))
    signal.signal(signal.SIGTERM, lambda *_: (record.with_suffix(".stopped").write_text("1"), sys.exit(0)))
    profile = Path(next(a.split("=", 1)[1] for a in sys.argv if a.startswith("--user-data-dir=")))
    if os.environ.get("FAKE_CHROMIUM_MODE") == "login":
        time.sleep(0.3)
        db = profile / "Default" / "Network" / "Cookies"
        db.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(db) as conn:
            conn.execute("CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, expires_utc INTEGER)")
            conn.execute("INSERT INTO cookies VALUES ('.www.linkedin.com', 'li_at', '', ?, ?)",
                         ({secret!r}.encode(), int((time.time() + 86400 + {offset}) * 1_000_000)))
    while True:
        time.sleep(0.1)
    """
)


@pytest.fixture
def fake_chromium(tmp_path: Path, monkeypatch):
    binary = tmp_path / "fake-chromium"
    binary.write_text(FAKE_CHROMIUM.format(python=sys.executable, secret=SECRET, offset=_EPOCH_OFFSET_S))
    binary.chmod(0o755)
    record = tmp_path / "fake-chromium.json"
    monkeypatch.setenv("FAKE_CHROMIUM_RECORD", str(record))
    monkeypatch.delenv("DISPLAY", raising=False)
    return binary, record


# ── the command ───────────────────────────────────────────────────────────────


def test_interactive_login_waits_for_the_session_then_closes_a_plain_chromium(tmp_path: Path, fake_chromium, monkeypatch, capsys):
    binary, record = fake_chromium
    monkeypatch.setenv("FAKE_CHROMIUM_MODE", "login")
    monkeypatch.setenv("JHT_CHROMIUM_BIN", str(binary))
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.setattr(linkedin_apply, "interactive_login", _fast(linkedin_apply.interactive_login))

    code = linkedin_apply.main(["login", "--interactive", "--timeout-minutes", "0.5"])

    out = capsys.readouterr()
    assert code == 0 and json.loads(out.out) == {"status": "logged_in"}
    assert SECRET not in out.out + out.err
    launched = json.loads(record.read_text())
    profile = tmp_path / ".cache" / "linkedin" / "profile"
    assert f"--user-data-dir={profile}" in launched["argv"]
    assert launched["argv"][-1] == linkedin_apply.LOGIN_URL
    assert not any(a.startswith(("--enable-automation", "--remote-debugging", "--headless")) for a in launched["argv"])
    assert launched["display"] == ":99"
    assert stat.S_IMODE(profile.stat().st_mode) == 0o700
    assert record.with_suffix(".stopped").exists(), "Chromium is closed once the session exists"
    assert linkedin_apply.profile_state(tmp_path) == "valid"


def _fast(function):
    def wrapper(*args, **kwargs):
        kwargs.setdefault("poll_s", 0.1)
        return function(*args, **kwargs)

    return wrapper


def test_interactive_login_times_out_and_closes_the_browser(tmp_path: Path, fake_chromium, monkeypatch):
    binary, record = fake_chromium
    monkeypatch.setenv("FAKE_CHROMIUM_MODE", "never")

    result = linkedin_apply.interactive_login(tmp_path, binary=str(binary), timeout_s=1.0, poll_s=0.1)

    assert result == {"status": "timeout"}
    assert record.with_suffix(".stopped").exists()
    assert linkedin_apply.profile_state(tmp_path) == "expired"


def test_interactive_login_never_opens_a_second_browser_on_a_held_profile(tmp_path: Path, fake_chromium):
    binary, record = fake_chromium

    with linkedin_apply.profile_lock(tmp_path):
        result = linkedin_apply.interactive_login(tmp_path, binary=str(binary), timeout_s=1.0, poll_s=0.1)

    assert result == {"status": "busy"}
    assert not record.exists()


@pytest.mark.parametrize(
    "expires, host, name, state",
    (
        (time.time() + 3600, ".www.linkedin.com", "li_at", "valid"),
        (time.time() - 3600, ".www.linkedin.com", "li_at", "expired"),
        (time.time() + 3600, ".linkedin.com.example.invalid", "li_at", "absent"),
        (time.time() + 3600, ".www.linkedin.com", "JSESSIONID", "absent"),
    ),
)
def test_the_session_cookie_is_judged_by_host_name_and_expiry_only(tmp_path: Path, expires, host, name, state):
    write_cookie_db(tmp_path, expires=expires, host=host, name=name)
    assert linkedin_apply.session_cookie_state(tmp_path) == state


# ── the flow reusing the profile ─────────────────────────────────────────────


def make_profile(home: Path, *, expires: float) -> Path:
    profile = home / ".cache" / "linkedin" / "profile"
    profile.mkdir(parents=True, exist_ok=True)
    profile.chmod(0o700)
    write_cookie_db(profile, expires=expires)
    return profile


def never_open_a_browser(monkeypatch):
    def refuse(self):
        raise AssertionError("no browser may open")

    monkeypatch.setattr(ApplicationFlow, "_managed_page", refuse)


def test_an_expired_hand_made_session_stops_for_the_user_before_any_browser(home: Path, cv_path: Path, monkeypatch):
    make_profile(home, expires=time.time() - 60)
    never_open_a_browser(monkeypatch)
    notices: list = []

    flow = build_flow(home, cv_path)
    flow.notifier = lambda **kwargs: notices.append(kwargs) or "1"
    result = flow.run()

    assert (result.status, result.reason) == ("blocked_human", "linkedin_session_expired")
    assert notices == []  # one line in the round's summary, not a message of its own
    pending = json.loads((home / ".cache" / "apply-flow" / "notices.json").read_text())["pending"]
    assert [entry["reason"] for entry in pending] == ["linkedin_session_expired"]


def test_a_profile_another_browser_holds_is_denied_without_opening_one(home: Path, cv_path: Path, monkeypatch):
    make_profile(home, expires=time.time() + 3600)
    never_open_a_browser(monkeypatch)

    with linkedin_apply.profile_lock(home):
        result = build_flow(home, cv_path).run()

    assert (result.status, result.reason) == ("denied", "linkedin_profile_busy")
    assert not (home / ".cache" / "apply-flow" / "71.json").exists()


def test_a_session_linkedin_rejects_stops_and_never_signs_in_with_anything_else(page, home: Path, cv_path: Path):
    make_profile(home, expires=time.time() + 3600)  # the cookie looks valid; LinkedIn shows signed out
    site = Site()

    site.install(page)
    result = build_flow(home, cv_path).run(page=page, navigate=True)

    assert (result.status, result.reason) == ("blocked_human", "linkedin_session_expired")
    assert site.logins() == 0


def test_with_a_credentials_file_the_password_sign_in_is_still_the_fallback(page, home: Path, cv_path: Path):
    make_profile(home, expires=time.time() - 60)
    write_credentials(home)
    site = Site()

    site.install(page)
    result = build_flow(home, cv_path).run(page=page, navigate=True)

    assert result.status == "applied", result
    assert site.logins() == 1


def test_the_flow_opens_the_real_profile_with_its_cookie_and_holds_it(home: Path, cv_path: Path):
    playwright = pytest.importorskip("playwright.sync_api")
    profile = home / ".cache" / "linkedin" / "profile"
    profile.mkdir(parents=True)
    profile.chmod(0o700)
    # A real Chromium profile, written by Playwright's own browser (no network).
    with playwright.sync_playwright() as runtime:
        context = runtime.chromium.launch_persistent_context(str(profile), headless=True)
        context.add_cookies([{
            "name": "li_at", "value": SECRET, "domain": ".www.linkedin.com", "path": "/",
            "expires": time.time() + 3600, "secure": True, "httpOnly": True, "sameSite": "None",
        }])
        context.close()
    assert linkedin_apply.profile_state(home) == "valid"

    flow = build_flow(home, cv_path)
    flow._linkedin_profile = profile
    with flow._managed_page() as opened:
        names = {cookie["name"] for cookie in opened.context.cookies("https://www.linkedin.com/")}
        assert "li_at" in names
        assert linkedin_apply.profile_busy(home)
    assert not linkedin_apply.profile_busy(home)
