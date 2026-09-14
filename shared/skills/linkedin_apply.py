#!/usr/bin/env python3
"""linkedin_apply.py — the CLOSER on LinkedIn: company-site links and Easy Apply. [JHT-CLOSER-LINKEDIN]

A LinkedIn vacancy is applied to in one of two ways, and the flow never
guesses which:

- **Apply on the company website**: the vacancy page names the real
  application address.  The recipe hands it to the flow (`PlatformHandoff`),
  which goes on with the recipe of the destination (Ashby, Greenhouse, Lever,
  a company form).
- **Easy Apply**: the application happens on LinkedIn with the user's own
  account.  The recipe signs in only when the saved session is gone, walks the
  multi-step dialog (contacts, the CV of this application, screening
  questions, review) and clicks Submit once, after the flow's gate.

The account is the user's, so the recipe is careful with it:

- the credentials come only from `$JHT_HOME/credentials/linkedin.json`
  (`{"email", "password"}`), a regular file with mode 0600 owned by this user
  — never from argv, the environment, a log, the checkpoint or a receipt;
- the browser session is kept in `$JHT_HOME/.cache/linkedin/` (0700/0600) and
  reused; a sign-in that fails twice stops as `linkedin_login_failed` and is
  not tried again until the credentials file changes;
- a verification code is asked on Telegram (`closer_login_code`, see
  `application_answers`): the code reaches this process through a local 0600
  file, is typed, and deleted; it is never an application answer;
- a captcha or security check stops as `linkedin_challenge`;
- one LinkedIn application at most every `linkedin_min_interval_minutes`
  (default 20) — a run that comes sooner is denied, not blocked;
- nothing outside the application: no messages, no connections, and the
  "follow the company" box is cleared before Submit.
"""
from __future__ import annotations

import argparse
import contextlib
import fcntl
import json
import os
import re
import shutil
import signal
import sqlite3
import stat
import subprocess
import sys
import tempfile
import time
import urllib.parse
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Mapping

sys.path.insert(0, str(Path(__file__).resolve().parent))

from apply_flow import (  # noqa: E402
    LINKEDIN_HOSTS,
    BlockedHuman,
    FlowDeferred,
    GreenhouseRecipe,
    LeverRecipe,
    PlatformHandoff,
    _core_fact_missing,
    _normalise_label,
    _resolve_db_path,
    _safe_label,
)
from profile_facts import profile_value  # noqa: E402

LOGIN_URL = "https://www.linkedin.com/login"
CREDENTIALS_FILE = ("credentials", "linkedin.json")
SESSION_DIR = (".cache", "linkedin")
MAX_LOGIN_FAILURES = 2
DEFAULT_MIN_INTERVAL_MINUTES = 20
LOGIN_CODE_SOURCE_ACTION = "closer_login_code"
MAX_MODAL_STEPS = 12
# The browser profile the user signs in to by hand (`login --interactive`).
PROFILE_DIR = (".cache", "linkedin", "profile")
PROFILE_LOCK = (".cache", "linkedin", "profile.lock")
SESSION_COOKIE = "li_at"
INTERACTIVE_TIMEOUT_S = 15 * 60
PROFILE_WAIT_S = 60.0
# Seconds between 1601-01-01 (Chromium's cookie epoch) and 1970-01-01.
_CHROMIUM_EPOCH_OFFSET_S = 11_644_473_600

_SIGNED_IN = "#global-nav, nav.global-nav"
# On the public page, signed out, this tracking name is also carried by the
# "Join now" and "Dismiss" controls of the sign-in dialog the Apply button
# opens: the company address is not on that page at all.  Only a link whose
# address, unwrapped, leaves LinkedIn is a company application link.
_OFFSITE_LINK = "a[data-tracking-control-name*='apply-link-offsite']"
# The signed-out Apply controls: Easy Apply ("onsite") and the button that
# opens the sign-in dialog of an offsite vacancy.  Neither says "Easy Apply".
_GUEST_APPLY = (
    "[data-tracking-control-name='public_jobs_apply-link-onsite'], "
    "[data-modal='job-details-topcard-apply-modal']"
)
_OFFSITE_LABEL = re.compile(r"(apply|candidat\w*|bewerb\w*|postul\w*|solicit\w*).{0,40}(company|website|sito|site|web)", re.I)
_EASY_APPLY_LABEL = re.compile(r"easy apply|candidatura semplificata|einfach bewerben|candidature simplifiée|solicitud sencilla|candidatura simplificada", re.I)
_CHALLENGE_TEXT = ("security verification", "quick security check", "let's do a quick security check", "verify you are human")
_CODE_INPUT = "input[name=pin], input#input__email_verification_pin, input#input__phone_verification_pin"


def _home_path(jht_home: Path, parts: tuple[str, ...]) -> Path:
    return Path(jht_home).joinpath(*parts)


def _private_file(path: Path) -> bool:
    """A regular file (not a symlink), mode 0600 or stricter, owned by this user."""
    try:
        info = path.lstat()
    except OSError:
        return False
    return stat.S_ISREG(info.st_mode) and not info.st_mode & 0o077 and info.st_uid == os.getuid()


def _write_private_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with contextlib.suppress(OSError):
        path.parent.chmod(0o700)
    handle = tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, prefix=f".{path.name}.", delete=False)
    try:
        json.dump(value, handle)
        handle.flush()
        os.fsync(handle.fileno())
        handle.close()
        os.chmod(handle.name, 0o600)
        os.replace(handle.name, path)
    except BaseException:
        handle.close()
        with contextlib.suppress(OSError):
            os.unlink(handle.name)
        raise


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def read_credentials(jht_home: Path) -> tuple[str, str]:
    """(email, password) from the user's private file, or a stop that names no value."""
    path = _home_path(jht_home, CREDENTIALS_FILE)
    if not _private_file(path):
        raise BlockedHuman(
            "linkedin_credentials_missing",
            "The LinkedIn credentials file is missing, not a regular file, not 0600, or not owned by this user",
            "detect",
        )
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        email, password = data["email"], data["password"]
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise BlockedHuman("linkedin_credentials_missing", "The LinkedIn credentials file cannot be read", "detect") from exc
    if not isinstance(email, str) or not email.strip() or not isinstance(password, str) or not password:
        raise BlockedHuman("linkedin_credentials_missing", "The LinkedIn credentials file has an empty value", "detect")
    return email.strip(), password


def restore_session(context, jht_home: Path) -> bool:
    """Put the saved LinkedIn cookies into the browser context. False when there is none usable."""
    path = _home_path(jht_home, SESSION_DIR) / "storage-state.json"
    if not _private_file(path):
        return False
    try:
        cookies = json.loads(path.read_text(encoding="utf-8")).get("cookies")
        if not isinstance(cookies, list) or not cookies:
            return False
        context.add_cookies(cookies)
    except Exception:  # noqa: BLE001 — a damaged session is a new sign-in, never a crash
        return False
    return True


def save_session(context, jht_home: Path) -> None:
    state = context.storage_state()
    _write_private_json(_home_path(jht_home, SESSION_DIR) / "storage-state.json", {"cookies": state.get("cookies", [])})


def linkedin_host(url: str) -> bool:
    """linkedin.com or one of its subdomains (www, the country pages such as es.linkedin.com)."""
    try:
        host = (urllib.parse.urlsplit(str(url or "").strip()).hostname or "").casefold().rstrip(".")
    except ValueError:
        return False
    return host in LINKEDIN_HOSTS or host.endswith(".linkedin.com")


def offsite_target(href: str, base: str) -> str:
    """The company address behind an "apply on company website" link (LinkedIn's redirect unwrapped)."""
    absolute = urllib.parse.urljoin(base, str(href or "").strip())
    parsed = urllib.parse.urlsplit(absolute)
    if linkedin_host(absolute):
        wrapped = urllib.parse.parse_qs(parsed.query).get("url", [])
        if len(wrapped) == 1:
            return wrapped[0].strip()
    return absolute


def min_interval_minutes(config_path: Path) -> int:
    """`applications.auto_apply.linkedin_min_interval_minutes`, default 20; an invalid value denies."""
    try:
        data = json.loads(config_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return DEFAULT_MIN_INTERVAL_MINUTES
    except (OSError, ValueError) as exc:
        raise FlowDeferred("linkedin_interval_invalid", "jht.config.json cannot be read for the LinkedIn pause") from exc
    auto = ((data.get("applications") or {}).get("auto_apply") or {}) if isinstance(data, dict) else {}
    value = auto.get("linkedin_min_interval_minutes", DEFAULT_MIN_INTERVAL_MINUTES) if isinstance(auto, dict) else None
    if value is None:
        return DEFAULT_MIN_INTERVAL_MINUTES
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise FlowDeferred(
            "linkedin_interval_invalid",
            "`applications.auto_apply.linkedin_min_interval_minutes` is not a whole number of minutes",
        )
    return value


# ── the profile the user signs in to by hand ────────────────────────────────
#
# 14/09: the operator signs in to LinkedIn with "Continue with Google" and has
# no LinkedIn password.  Google refuses automated browsers, so the CLOSER cannot
# do that sign-in: the user does it once, by hand, in a plain Chromium on the
# box's display, and the recipe reuses that profile.


class ProfileBusy(FlowDeferred):
    """Another Chromium holds the LinkedIn profile (a manual sign-in, another run)."""

    def __init__(self, detail: str = "Another browser is using the LinkedIn profile; the queue retries later"):
        super().__init__("linkedin_profile_busy", detail)


def profile_dir(jht_home: Path) -> Path:
    return _home_path(jht_home, PROFILE_DIR)


def _private_dir(path: Path) -> bool:
    try:
        info = path.lstat()
    except OSError:
        return False
    return stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid()


@contextlib.contextmanager
def profile_lock(jht_home: Path, *, wait_s: float = 0.0, poll_s: float = 0.5):
    """Hold the profile for one browser.  Raises ProfileBusy after `wait_s`.

    An flock, so a killed holder releases it with its process: nothing to
    unstick at boot.  The lock file sits next to the profile, never inside it.
    """
    path = _home_path(jht_home, PROFILE_LOCK)
    path.parent.mkdir(parents=True, exist_ok=True)
    with contextlib.suppress(OSError):
        path.parent.chmod(0o700)
    handle = os.open(path, os.O_RDWR | os.O_CREAT, 0o600)
    try:
        deadline = time.monotonic() + max(0.0, wait_s)
        while True:
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise ProfileBusy() from None
                time.sleep(poll_s)
        try:
            yield path
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)
    finally:
        os.close(handle)


def profile_busy(jht_home: Path) -> bool:
    try:
        with profile_lock(jht_home):
            return False
    except ProfileBusy:
        return True


def _cookie_databases(profile: Path) -> list[Path]:
    return [path for path in (profile / "Default" / "Network" / "Cookies", profile / "Default" / "Cookies") if path.is_file()]


def session_cookie_state(profile: Path, *, now: float | None = None) -> str:
    """valid · expired · absent: LinkedIn's session cookie in a Chromium profile.

    Reads only the cookie's name, host and expiry, never its value.  Chromium
    keeps the database locked while it runs, so a copy is read.
    """
    now = time.time() if now is None else now
    found = "absent"
    for database in _cookie_databases(profile):
        with tempfile.TemporaryDirectory() as scratch:
            copy = Path(scratch) / "Cookies"
            try:
                shutil.copyfile(database, copy)
                for suffix in ("-wal", "-journal"):
                    side = database.with_name(database.name + suffix)
                    if side.is_file():
                        shutil.copyfile(side, copy.with_name(copy.name + suffix))
                with contextlib.closing(sqlite3.connect(copy)) as conn:
                    rows = conn.execute(
                        "SELECT host_key, expires_utc FROM cookies WHERE name = ?", (SESSION_COOKIE,)
                    ).fetchall()
            except (OSError, sqlite3.Error):
                continue
        for host, expires in rows:
            if not linkedin_host(f"https://{str(host).lstrip('.')}/"):
                continue
            expiry = int(expires or 0)
            if expiry == 0 or expiry / 1_000_000 - _CHROMIUM_EPOCH_OFFSET_S > now:
                return "valid"
            found = "expired"
    return found


def profile_state(jht_home: Path) -> str:
    """absent (no manual sign-in yet) · busy · valid · expired."""
    profile = profile_dir(jht_home)
    if not _private_dir(profile):
        return "absent"
    if profile_busy(jht_home):
        return "busy"
    state = session_cookie_state(profile)
    return "valid" if state == "valid" else "expired"


def chromium_binary() -> str | None:
    """The full Chromium the flow already uses (Playwright's build), else a system one."""
    configured = os.environ.get("JHT_CHROMIUM_BIN", "").strip()
    if configured:
        return configured if Path(configured).is_file() else None
    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as runtime:
            path = runtime.chromium.executable_path
        if path and Path(path).is_file():
            return path
    except Exception:  # noqa: BLE001 — a missing driver falls back to the system browser
        pass
    for name in ("chromium", "chromium-browser", "google-chrome"):
        found = shutil.which(name)
        if found:
            return found
    return None


def interactive_command(binary: str, profile: Path) -> list[str]:
    """A plain Chromium: no --enable-automation, no remote debugging, nothing that marks a robot.

    --password-store=basic is what Playwright passes too, so the cookies the
    user's sign-in writes are readable by the flow's browser afterwards.
    """
    return [
        binary,
        f"--user-data-dir={profile}",
        "--password-store=basic",
        "--no-first-run",
        "--no-default-browser-check",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--window-size=1280,900",
        LOGIN_URL,
    ]


def _stop_browser(process: subprocess.Popen, grace_s: float = 10.0) -> None:
    if process.poll() is not None:
        return
    with contextlib.suppress(ProcessLookupError):
        process.send_signal(signal.SIGTERM)  # Chromium flushes its cookies on a clean exit
    try:
        process.wait(timeout=grace_s)
    except subprocess.TimeoutExpired:
        with contextlib.suppress(ProcessLookupError):
            process.kill()
        process.wait(timeout=grace_s)


def interactive_login(
    jht_home: Path,
    *,
    binary: str | None = None,
    display: str | None = None,
    timeout_s: float = INTERACTIVE_TIMEOUT_S,
    poll_s: float = 2.0,
    popen: Callable[..., subprocess.Popen] = subprocess.Popen,
) -> dict[str, str]:
    """Open LinkedIn's sign-in in a plain Chromium and wait for the user's session.

    Returns {"status": logged_in | timeout | busy | browser_missing | browser_exited}.
    Nothing from the cookies or the page is returned or logged.
    """
    binary = binary or chromium_binary()
    if not binary:
        return {"status": "browser_missing"}
    profile = profile_dir(jht_home)
    try:
        with profile_lock(jht_home):
            profile.mkdir(parents=True, exist_ok=True)
            profile.chmod(0o700)
            environment = dict(os.environ)
            environment["DISPLAY"] = display or environment.get("DISPLAY") or ":99"
            process = popen(
                interactive_command(binary, profile),
                env=environment,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            deadline = time.monotonic() + timeout_s
            status = "timeout"
            try:
                while time.monotonic() < deadline:
                    if session_cookie_state(profile) == "valid":
                        status = "logged_in"
                        break
                    if process.poll() is not None:
                        status = "browser_exited"
                        break
                    time.sleep(poll_s)
            finally:
                _stop_browser(process)
            if status == "browser_exited" and session_cookie_state(profile) == "valid":
                status = "logged_in"  # the user closed the window after signing in
            return {"status": status}
    except ProfileBusy:
        return {"status": "busy"}


class LinkedInSession:
    """Sign-in, the verification code, and the pause between applications."""

    def __init__(
        self,
        *,
        jht_home: Path,
        db_path: Any,
        position_id: int,
        code_notifier: Callable[..., str] | None = None,
        code_timeout_s: float = 300.0,
        poll_s: float = 2.0,
    ):
        self.jht_home = Path(jht_home)
        self.db_path = db_path
        self.position_id = int(position_id)
        self.code_notifier = code_notifier or _default_code_notifier
        self.code_timeout_s = float(code_timeout_s)
        self.poll_s = float(poll_s)

    # ── the pause between LinkedIn applications ──────────────────────────────

    def _last_apply_path(self) -> Path:
        return _home_path(self.jht_home, SESSION_DIR) / "last-apply.json"

    def assert_interval(self) -> None:
        minutes = min_interval_minutes(self.jht_home / "jht.config.json")
        path = self._last_apply_path()
        if minutes == 0 or not path.exists():
            return
        try:
            last = datetime.fromisoformat(json.loads(path.read_text(encoding="utf-8"))["at"])
            if last.tzinfo is None:
                raise ValueError("naive instant")
        except (OSError, ValueError, KeyError, TypeError):
            # Unreadable: the file's own write time, never "long ago".  Not
            # "now" either: re-read at every run, that denied LinkedIn forever.
            try:
                last = datetime.fromtimestamp(path.lstat().st_mtime, timezone.utc)
            except OSError:
                last = _utc_now()
        due = last + timedelta(minutes=minutes)
        if _utc_now() < due:
            raise FlowDeferred(
                "linkedin_throttled",
                f"LinkedIn applications are spaced {minutes} minutes apart; next one after {due.isoformat(timespec='seconds')}",
            )

    def record_apply(self) -> None:
        _write_private_json(self._last_apply_path(), {"at": _utc_now().isoformat()})

    # ── sign-in failures ──────────────────────────────────────────────────────

    def _failures_path(self) -> Path:
        return _home_path(self.jht_home, SESSION_DIR) / "login-failures.json"

    def _failures(self) -> int:
        path = self._failures_path()
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            count, at = int(data["count"]), float(data["at"])
        except FileNotFoundError:
            return 0
        except (OSError, ValueError, KeyError, TypeError):
            return MAX_LOGIN_FAILURES
        credentials = _home_path(self.jht_home, CREDENTIALS_FILE)
        with contextlib.suppress(OSError):
            if credentials.lstat().st_mtime > at:
                return 0  # the user wrote new credentials after the last failure
        return count

    def _record_failure(self) -> int:
        count = self._failures() + 1
        _write_private_json(self._failures_path(), {"count": count, "at": time.time()})
        return count

    def _reset_failures(self) -> None:
        with contextlib.suppress(FileNotFoundError):
            self._failures_path().unlink()

    def _failed(self, page, detail: str) -> None:
        with contextlib.suppress(Exception):
            page.locator("#password").fill("")
        if self._record_failure() >= MAX_LOGIN_FAILURES:
            raise BlockedHuman("linkedin_login_failed", f"LinkedIn sign-in failed twice: {detail}", "detect")
        raise FlowDeferred("linkedin_login_retry", f"LinkedIn sign-in failed once ({detail}); the next run tries once more")

    # ── sign-in ───────────────────────────────────────────────────────────────

    @staticmethod
    def signed_in(page) -> bool:
        return page.locator(_SIGNED_IN).count() > 0

    @staticmethod
    def challenge(page) -> bool:
        if GreenhouseRecipe._challenge_reason(page):
            return True
        body = page.locator("body")
        text = body.inner_text().casefold() if body.count() else ""
        return any(marker in text for marker in _CHALLENGE_TEXT)

    def login(self, page) -> None:
        if self._failures() >= MAX_LOGIN_FAILURES:
            raise BlockedHuman(
                "linkedin_login_failed",
                "LinkedIn sign-in already failed twice; waiting for new credentials",
                "detect",
            )
        email, password = read_credentials(self.jht_home)
        page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=30_000)
        if self.challenge(page):
            raise BlockedHuman("linkedin_challenge", "LinkedIn shows a security check before sign-in", "detect")
        user, secret = page.locator("#username"), page.locator("#password")
        submit = page.locator("form button[type=submit]")
        if user.count() != 1 or secret.count() != 1 or submit.count() != 1:
            raise BlockedHuman("linkedin_login_unrecognised", "The LinkedIn sign-in form is not the one the recipe knows", "detect")
        user.fill(email)
        secret.fill(password)
        submit.click(timeout=10_000)
        self._settle(page)
        if page.locator(_CODE_INPUT).count():
            self._enter_code(page)
            self._settle(page)
        if self.challenge(page):
            with contextlib.suppress(Exception):
                page.locator("#password").fill("")
            raise BlockedHuman("linkedin_challenge", "LinkedIn asks for a security check during sign-in", "detect")
        if page.locator(_CODE_INPUT).count():
            # A mistyped or stale code says nothing about the credentials: it
            # never counts towards linkedin_login_failed, and the next run
            # asks for a new code.
            with contextlib.suppress(Exception):
                page.locator("#password").fill("")
            raise BlockedHuman(
                "linkedin_login_code_missing",
                "LinkedIn did not accept the verification code; a new run asks for a new one",
                "detect",
            )
        if not self.signed_in(page):
            self._failed(page, "LinkedIn did not accept the sign-in")
        self._reset_failures()
        save_session(page.context, self.jht_home)

    @staticmethod
    def _settle(page) -> None:
        with contextlib.suppress(Exception):
            page.wait_for_load_state("domcontentloaded", timeout=15_000)
        page.wait_for_timeout(500)

    # ── the verification code ─────────────────────────────────────────────────

    def _code_file(self, source_id: str) -> Path:
        # The one path the Telegram bridge writes the code to.
        import application_answers

        return application_answers.login_code_path(source_id, self.jht_home)

    def _close_open_requests(self, conn: sqlite3.Connection, reply: str) -> None:
        conn.execute(
            "UPDATE pending_user_messages SET user_reply = ?, user_reply_at = CURRENT_TIMESTAMP "
            "WHERE agent = 'closer' AND source_action = ? AND user_reply IS NULL",
            (reply, LOGIN_CODE_SOURCE_ACTION),
        )

    def _enter_code(self, page) -> None:
        code = self.ask_code()
        field = page.locator(_CODE_INPUT)
        submit = page.locator("form button[type=submit]")
        if field.count() != 1 or submit.count() != 1:
            raise BlockedHuman("linkedin_login_unrecognised", "The LinkedIn verification form is not the one the recipe knows", "detect")
        field.first.fill(code)
        submit.first.click(timeout=10_000)

    def ask_code(self) -> str:
        """Ask the user for LinkedIn's code on Telegram and wait for it; the code is never stored."""
        db = _resolve_db_path(self.db_path)
        source_id = f"closer-login-code:linkedin:{time.time_ns()}"
        expires = _utc_now() + timedelta(seconds=self.code_timeout_s)
        payload = {
            "version": 1,
            "service": "linkedin",
            "position_id": self.position_id,
            "expires_at": expires.strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
        with contextlib.closing(sqlite3.connect(db, timeout=10)) as conn:
            self._close_open_requests(conn, "[expired]")
            conn.commit()
        import application_answers

        message = (
            "CLOSER is signing in to LinkedIn to send an Easy Apply application and LinkedIn asked for a "
            "verification code. Reply to this message with the code LinkedIn just sent you, within "
            f"{max(1, round(self.code_timeout_s / 60))} minutes.\n"
            f"Code request: {application_answers.answer_code(source_id)}"
        )
        try:
            delivered = self.code_notifier(
                position_id=self.position_id, message=message, source_id=source_id, payload=payload
            )
        except Exception as exc:  # noqa: BLE001
            raise BlockedHuman(
                "linkedin_login_code_undelivered",
                f"The verification code request could not be sent ({type(exc).__name__})",
                "detect",
            ) from exc
        if delivered != "telegram":
            self._finish(source_id, "[expired]")
            raise BlockedHuman(
                "linkedin_login_code_undelivered",
                "The verification code request did not reach Telegram; LinkedIn's code would expire unseen",
                "detect",
            )
        deadline = time.monotonic() + self.code_timeout_s
        while True:
            with contextlib.closing(sqlite3.connect(db, timeout=10)) as conn:
                row = conn.execute(
                    "SELECT user_reply FROM pending_user_messages WHERE source_id = ?", (source_id,)
                ).fetchone()
            if row and row[0] == "[received]":
                return self._take_code(source_id)
            if row is None or row[0] is not None or time.monotonic() >= deadline:
                self._finish(source_id, "[expired]")
                raise BlockedHuman(
                    "linkedin_login_code_missing",
                    "No verification code arrived before it expired",
                    "detect",
                )
            time.sleep(self.poll_s)

    def _take_code(self, source_id: str) -> str:
        path = self._code_file(source_id)
        code = ""
        try:
            if _private_file(path):
                data = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(data, dict) and data.get("source_id") == source_id:
                    candidate = str(data.get("code") or "")
                    code = candidate if re.fullmatch(r"\d{4,8}", candidate) else ""
        except (OSError, ValueError):
            code = ""
        finally:
            with contextlib.suppress(OSError):
                path.unlink()
            self._finish(source_id, "[used]")
        if not code:
            raise BlockedHuman("linkedin_login_code_missing", "The verification code file was not valid", "detect")
        return code

    def _finish(self, source_id: str, reply: str) -> None:
        db = _resolve_db_path(self.db_path)
        with contextlib.closing(sqlite3.connect(db, timeout=10)) as conn:
            if reply == "[used]":
                conn.execute(
                    "UPDATE pending_user_messages SET user_reply = '[used]', agent_seen_reply_at = CURRENT_TIMESTAMP "
                    "WHERE source_id = ?",
                    (source_id,),
                )
            else:
                conn.execute(
                    "UPDATE pending_user_messages SET user_reply = ?, user_reply_at = CURRENT_TIMESTAMP "
                    "WHERE source_id = ? AND user_reply IS NULL",
                    (reply, source_id),
                )
            conn.commit()
        with contextlib.suppress(OSError):
            self._code_file(source_id).unlink()


def _default_code_notifier(*, position_id: int, message: str, source_id: str, payload: Mapping[str, Any]) -> str:
    """Create the request row and send it on Telegram; returns how it was delivered."""
    import shutil

    candidates = [
        shutil.which("jht-notify-user"),
        "/app/agents/_tools/jht-notify-user",
        str(Path(__file__).resolve().parents[2] / "agents" / "_tools" / "jht-notify-user"),
    ]
    executable = next((value for value in candidates if value and Path(value).is_file()), None)
    if not executable:
        raise RuntimeError("jht-notify-user is unavailable")
    result = subprocess.run(
        [
            executable,
            "--agent", "closer",
            "--kind", "alert",
            "--position-id", str(position_id),
            "--source-id", source_id,
            "--source-action", LOGIN_CODE_SOURCE_ACTION,
            "--source-payload", json.dumps(dict(payload), sort_keys=True),
            message,
        ],
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError(f"jht-notify-user failed with exit {result.returncode}")
    return "telegram" if "via=telegram" in result.stdout else "web"


class LinkedInEasyApplyRecipe(LeverRecipe):
    """Easy Apply in LinkedIn's dialog, or a handoff to the company's own site."""

    PLATFORM = "linkedin"
    VENDOR = "LinkedIn"
    MODAL = "[role=dialog].jobs-easy-apply-modal"
    FORM = MODAL
    FIELD_ENTRY = ".jobs-easy-apply-form-section__grouping"
    SUBMIT = "[role=dialog].jobs-easy-apply-modal button[aria-label='Submit application']"
    SUCCESS = ""
    CONFIRMATION_MARKERS = ("application sent", "your application was sent")
    _NEXT = "button[aria-label='Continue to next step']"
    _REVIEW = "button[aria-label='Review your application']"
    _SUBMIT_BUTTON = "button[aria-label='Submit application']"
    _FOLLOW = "input[type=checkbox][id*='follow-company']"
    _ERRORS = (".artdeco-inline-feedback--error", "[role=alert]")
    # Contact fields of the dialog by their label, to the profile_facts fact
    # they hold; the email and the phone country arrive filled from the
    # account and are kept as they are.
    _CORE_LABELS = {
        "first name": "first name",
        "last name": "last name",
        "mobile phone number": "phone",
        "phone": "phone",
        "email address": "email",
        "email": "email",
        "city": "location",
    }

    def __init__(self, profile: Mapping[str, Any], cv_path: Path):
        super().__init__(profile, cv_path)
        self.session: LinkedInSession | None = None
        self.step_saved: Callable[[int], None] | None = None
        self.cv_attached = False
        self.job_url = ""
        self.dry_run = False
        self.profile_session = False

    def attach(self, flow) -> None:
        self.session = LinkedInSession(
            jht_home=flow._jht_home(),
            db_path=flow.db_path,
            position_id=flow.position_id,
            code_notifier=flow.code_notifier,
            code_timeout_s=flow.login_code_timeout_s,
        )
        self.job_url = flow.url
        self.dry_run = getattr(flow, "_mode", "") == "dry_run"
        self.profile_session = getattr(flow, "_linkedin_profile", None) is not None

        def saved(step: int, _flow=flow) -> None:
            checkpoint = getattr(_flow, "_live_checkpoint", None)
            if checkpoint is not None:
                checkpoint.modal_step = step
                checkpoint.save(_flow.checkpoint_path)

        self.step_saved = saved

    # ── the vacancy page ─────────────────────────────────────────────────────

    def form_present(self, page) -> bool:
        return page.locator(self.MODAL).count() > 0

    @staticmethod
    def _company_addresses(page, links) -> set[str]:
        """The addresses of these links that, LinkedIn's redirect unwrapped, leave LinkedIn."""
        targets = set()
        for index in range(links.count()):
            href = links.nth(index).get_attribute("href") or ""
            if href.strip():
                targets.add(offsite_target(href, page.url))
        return {target for target in targets if not linkedin_host(target)}

    def _offsite(self, page) -> str | None:
        targets = self._company_addresses(page, page.locator(_OFFSITE_LINK))
        if not targets:
            targets = self._company_addresses(page, page.get_by_role("link", name=_OFFSITE_LABEL))
        if len(targets) > 1:
            raise BlockedHuman("linkedin_apply_ambiguous", "The vacancy names more than one company application address", "detect")
        if targets:
            return targets.pop()
        buttons = page.get_by_role("button", name=_OFFSITE_LABEL)
        visible = [buttons.nth(i) for i in range(buttons.count()) if buttons.nth(i).is_visible()]
        if len(visible) == 1:
            # Signed in, the company link is a button opening a new tab: read
            # its address and close the tab without using it.
            with page.context.expect_page(timeout=15_000) as opened:
                visible[0].click()
            tab = opened.value
            with contextlib.suppress(Exception):
                tab.wait_for_load_state("commit", timeout=15_000)
            target = tab.url
            tab.close()
            return offsite_target(target, page.url)
        return None

    def _easy_apply(self, page) -> list:
        found = []
        for role in ("button", "link"):
            matches = page.get_by_role(role, name=_EASY_APPLY_LABEL)
            found.extend(matches.nth(i) for i in range(matches.count()) if matches.nth(i).is_visible())
        return found

    def apply_control_present(self, page) -> bool:
        return (
            bool(self._easy_apply(page))
            or page.locator(_OFFSITE_LINK).count() > 0
            or page.locator(_GUEST_APPLY).count() > 0
            or bool(page.get_by_role("button", name=_OFFSITE_LABEL).count())
        )

    def open_form(self, page) -> None:
        if self.session is None:
            raise BlockedHuman("linkedin_session_unavailable", "The LinkedIn recipe was not attached to the flow", "detect")
        job_url = self.job_url or page.url
        for attempt in range(2):
            target = self._offsite(page)
            if target:
                raise PlatformHandoff(target, "LinkedIn vacancy applies on the company website")
            controls = self._easy_apply(page)
            signed_in = self.session.signed_in(page)
            if controls and signed_in:
                break
            if attempt == 1:
                raise BlockedHuman(
                    "linkedin_apply_control_missing",
                    "Neither Easy Apply nor a company application link was found on the vacancy",
                    "detect",
                )
            page.goto(job_url, wait_until="domcontentloaded", timeout=30_000)
            page.wait_for_timeout(500)
            if signed_in or self.session.signed_in(page):
                continue  # a reload with the saved session is enough
            if self.session.challenge(page):
                raise BlockedHuman("linkedin_challenge", "LinkedIn shows a security check on the vacancy", "detect")
            if self.dry_run:
                # A dry run only looks: no sign-in with the user's account, and
                # never a verification code asked on Telegram.
                raise FlowDeferred(
                    "linkedin_dry_run_signed_out",
                    "A dry run does not sign in to LinkedIn; without a saved session it stops here",
                )
            if self.profile_session and not _private_file(_home_path(self.session.jht_home, CREDENTIALS_FILE)):
                # The hand-made session's cookie is there but LinkedIn no longer
                # accepts it: only the user can sign in again (Google refuses robots).
                raise BlockedHuman(
                    "linkedin_session_expired",
                    "LinkedIn no longer accepts the session the user signed in to by hand: "
                    "sign in again by hand (linkedin_apply.py login --interactive)",
                    "detect",
                )
            # Before the account does anything: the pause between applications.
            self.session.assert_interval()
            self.session.login(page)
            page.goto(job_url, wait_until="domcontentloaded", timeout=30_000)
            page.wait_for_timeout(500)
        if len(controls) != 1:
            raise BlockedHuman("linkedin_apply_ambiguous", "More than one Easy Apply control was found", "detect")
        self.session.assert_interval()
        controls[0].click()
        try:
            page.locator(self.MODAL).first.wait_for(state="visible", timeout=10_000)
        except Exception as exc:
            raise BlockedHuman("linkedin_form_missing", "Easy Apply did not open its dialog", "detect") from exc
        self._form(page, "detect")

    def _form(self, page, step: str):
        dialogs = page.locator(self.MODAL)
        if dialogs.count() != 1:
            raise BlockedHuman("linkedin_form_ambiguous", "The Easy Apply dialog is not exactly one dialog", step)
        dialog = dialogs.first
        if dialog.locator(self.FIELD_ENTRY).count() != page.locator(self.FIELD_ENTRY).count():
            raise BlockedHuman("application_field_outside_form", "An Easy Apply field sits outside the dialog", step)
        return dialog

    def dom_match(self, page) -> bool:
        dialogs = page.locator(self.MODAL)
        if dialogs.count() != 1:
            return False
        dialog = dialogs.first
        return bool(
            dialog.locator(f"{self._NEXT}, {self._REVIEW}, {self._SUBMIT_BUTTON}").count()
        )

    # ── the dialog, step by step ─────────────────────────────────────────────

    @staticmethod
    def _label(entry) -> str:
        for selector in ("legend", "label"):
            found = entry.locator(selector)
            if found.count():
                text = " ".join(found.first.inner_text().replace("\u00a0", " ").split())
                return re.sub(r"\s*(\*|required)\s*$", "", text, flags=re.I).strip()
        return ""

    @staticmethod
    def _field_key(entry) -> str:
        controls = entry.locator(LeverRecipe._CONTROLS)
        if not controls.count():
            return ""
        return controls.first.get_attribute("name") or controls.first.get_attribute("id") or ""

    def _visible_error_text(self, scope) -> str:
        for selector in self._ERRORS:
            matches = scope.locator(selector)
            for index in range(matches.count()):
                if matches.nth(index).is_visible():
                    return (matches.nth(index).inner_text() or selector).strip()
        return ""

    def _work_step(self, page, dialog) -> None:
        entries = dialog.locator(self.FIELD_ENTRY)
        for index in range(entries.count()):
            entry = entries.nth(index)
            files = entry.locator("input[type=file]")
            if files.count():
                self._attach_cv(page, entry, files)
                continue
            if self._is_answered(entry):
                continue
            label = self._label(entry)
            key = self._field_key(entry)
            fact = self._CORE_LABELS.get(label.casefold())
            if fact:
                self._core_entry(page, entry, label, key, fact)
                continue
            self._answer_entry(page, entry, label, key)

    @staticmethod
    def _core_choice(entry) -> bool:
        """A select, a choice or a typeahead: its value is one of the page's options, never profile text."""
        return bool(entry.locator("select, input[type=radio], input[type=checkbox], [role=combobox]").count())

    def _core_request(self, page, entry, label: str) -> BlockedHuman:
        if self._core_choice(entry):
            request = GreenhouseRecipe._answer_request(page, entry, label)
            if request is None:
                return _core_fact_missing("Easy Apply", label, "fill")
            return BlockedHuman(
                "required_answer_missing",
                f"Required Easy Apply choice needs one of the page's options: {_safe_label(label)}",
                "fill",
                answer_request=request,
            )
        control_type = entry.locator(LeverRecipe._CONTROLS).first.get_attribute("type") or "text"
        return _core_fact_missing("Easy Apply", label, "fill", control_type)

    def _core_entry(self, page, entry, label: str, key: str, fact: str) -> None:
        """The profile_facts rule: the profile under its aliases, a saved answer, then a question.

        Never a hard stop for a fact the CLOSER can work out (CL-08), and never
        a name split or joined in code: the CLOSER saves "first name" from
        `name`, with its basis.  A choice (a city picked from the page's list)
        takes only a saved exact option: profile text is not an option.
        """
        value = None if self._core_choice(entry) else profile_value(self.profile, fact)
        present = value is not None
        if present:
            self.answer_sources[_normalise_label(label) or fact] = "profile"
        else:
            present, value = self._answer_for(label, key)
        if not present:
            if not self._required(entry):
                return
            raise self._core_request(page, entry, label)
        from apply_flow import _inferred_answer_refused

        try:
            self._fill_answer(entry, label, value, "fill")
        except BlockedHuman as refused:
            raise _inferred_answer_refused(
                self, refused, lambda: self._core_request(page, entry, label).answer_request
            ) from None

    def _answer_entry(self, page, entry, label: str, key: str) -> None:
        present, answer = self._answer_for(label, key)
        if not present:
            if not self._required(entry):
                return
            request = GreenhouseRecipe._answer_request(page, entry, label)
            if request is None:
                raise BlockedHuman(
                    "unknown_required_control",
                    f"Easy Apply required question cannot be represented exactly: {_safe_label(label)}",
                    "screening",
                )
            raise BlockedHuman(
                "required_answer_missing",
                f"Required Easy Apply question needs an answer: {_safe_label(label)}",
                "screening",
                answer_request=request,
            )
        from apply_flow import _inferred_answer_refused

        try:
            self._fill_answer(entry, label, answer, "screening")
            if not self._is_answered(entry):
                raise BlockedHuman(
                    "answer_not_accepted", f"LinkedIn did not retain the answer for: {_safe_label(label)}", "screening"
                )
        except BlockedHuman as refused:
            raise _inferred_answer_refused(
                self, refused, lambda: GreenhouseRecipe._answer_request(page, entry, label)
            ) from None

    def _attach_cv(self, page, entry, files) -> None:
        if not self.cv_path.is_file() or self.cv_path.stat().st_size <= 0:
            raise BlockedHuman("cv_missing", "The selected CV file is missing or empty", "upload_cv")
        if files.count() != 1:
            raise BlockedHuman("resume_field_missing", "The Easy Apply CV upload is ambiguous", "upload_cv")
        # Always this application's CV: a CV uploaded to LinkedIn earlier is
        # another document, even when it is selected by default.
        files.first.set_input_files(str(self.cv_path))
        page.wait_for_timeout(300)
        shown = entry.get_by_text(self.cv_path.name, exact=False)
        if not shown.count() or self._visible_error_text(entry):
            raise BlockedHuman("upload_rejected", "LinkedIn did not show this application's CV as attached", "upload_cv")
        self.cv_attached = True

    def fill_core(self, page) -> None:
        """Walk the dialog to its review: every step's contacts, CV and questions, then Next."""
        for step in range(1, MAX_MODAL_STEPS + 1):
            dialog = self._form(page, "fill")
            if self.session is not None and self.session.challenge(page):
                raise BlockedHuman("linkedin_challenge", "LinkedIn asks for a security check in Easy Apply", "fill")
            self._work_step(page, dialog)
            if self.step_saved is not None:
                self.step_saved(step)
            if dialog.locator(self._SUBMIT_BUTTON).count():
                return
            advance = dialog.locator(f"{self._REVIEW}, {self._NEXT}")
            if advance.count() != 1 or not advance.first.is_visible() or not advance.first.is_enabled():
                raise BlockedHuman("linkedin_step_unrecognised", "The Easy Apply step has no single Next or Review button", "fill")
            advance.first.click(timeout=10_000)
            page.wait_for_timeout(300)
            if self._visible_error_text(self._form(page, "fill")):
                raise BlockedHuman("form_error", "LinkedIn refused a step of the application", "fill")
        raise BlockedHuman("linkedin_step_unrecognised", "The Easy Apply dialog did not reach its review", "fill")

    def upload_cv(self, page) -> None:
        if not self.cv_attached:
            raise BlockedHuman("resume_field_missing", "No Easy Apply step accepted this application's CV", "upload_cv")

    def fill_screening(self, page) -> None:
        if self.session is not None and self.session.challenge(page):
            raise BlockedHuman("linkedin_challenge", "LinkedIn asks for a security check in Easy Apply", "screening")

    def review(self, page) -> None:
        if self.session is not None and self.session.challenge(page):
            raise BlockedHuman("linkedin_challenge", "LinkedIn asks for a security check before Submit", "review")
        dialog = self._form(page, "review")
        if self._visible_error_text(dialog):
            raise BlockedHuman("form_error", "LinkedIn reports a form validation error", "review")
        follow = dialog.locator(self._FOLLOW)
        for index in range(follow.count()):
            box = follow.nth(index)
            if box.is_checked():
                box.set_checked(False)
            if box.is_checked():
                raise BlockedHuman("linkedin_follow_not_cleared", "The follow-the-company box could not be cleared", "review")
        submit = dialog.locator(self._SUBMIT_BUTTON)
        if submit.count() != 1 or not submit.first.is_visible() or not submit.first.is_enabled():
            raise BlockedHuman("submit_unavailable", "Easy Apply Submit is missing, ambiguous, or disabled", "review")

    def submit(self, page) -> None:
        # The flow has saved submit_started and asked the gate again.  The
        # pause starts at the click, whatever LinkedIn answers.
        if self.session is not None:
            self.session.record_apply()
        self._form(page, "submit").locator(self._SUBMIT_BUTTON).click(timeout=10_000)

    @staticmethod
    def _challenge_reason(page) -> str:
        body = page.locator("body")
        text = body.inner_text().casefold() if body.count() else ""
        if any(marker in text for marker in _CHALLENGE_TEXT):
            return "linkedin_challenge"
        return GreenhouseRecipe._challenge_reason(page)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="LinkedIn for the CLOSER: the user's manual sign-in")
    sub = parser.add_subparsers(dest="command", required=True)
    login = sub.add_parser("login", help="sign in to LinkedIn by hand, once, in the CLOSER's browser profile")
    login.add_argument("--interactive", action="store_true", required=True)
    login.add_argument("--timeout-minutes", type=float, default=INTERACTIVE_TIMEOUT_S / 60)
    login.add_argument("--display", default=None)
    sub.add_parser("status", help="print the state of the LinkedIn profile session")
    args = parser.parse_args(argv)
    jht_home = Path(os.environ.get("JHT_HOME") or (Path.home() / ".jht"))
    if args.command == "status":
        print(json.dumps({"status": profile_state(jht_home)}))
        return 0
    result = interactive_login(jht_home, display=args.display, timeout_s=max(1.0, args.timeout_minutes * 60))
    print(json.dumps(result))
    return {"logged_in": 0, "timeout": 3, "busy": 4}.get(result["status"], 2)


if __name__ == "__main__":
    sys.exit(main())
