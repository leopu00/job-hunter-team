#!/usr/bin/env python3
"""Checkpointed, fail-closed application flow for the CLOSER.

The state machine is ``detect -> fill -> upload_cv -> screening -> review ->
submit``.  Every completed step is written atomically to a mode-0600
checkpoint.  Filling steps are replayed idempotently after a browser restart;
submission is different: ``submit_started`` is persisted *before* the click,
and an uncertain outcome is never clicked again.

The first complete recipe is Ashby.  A real submit has four hard conditions:

* the phase-A gate allows this position at start and immediately before click;
* every required value comes from the candidate profile (nothing is guessed);
* captcha, 2FA, unknown controls, and upload errors block for a human;
* a screenshot plus a confirmation URL or text exists before ``applied`` is
  recorded.

The module imports Playwright lazily so deterministic checkpoint/detection
tests can still run without starting a browser.
"""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import logging
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.parse
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterator, Mapping

try:
    from ats_detect import detect_ats
except ImportError:  # pragma: no cover - package-style import outside the CLI
    from shared.skills.ats_detect import detect_ats


LOG = logging.getLogger("jht.apply_flow")
CHECKPOINT_VERSION = 1
SUPPORTED_PLATFORM = "ashby"
STEP_ORDER = ("detect", "fill", "upload_cv", "screening", "review", "submit")


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _normalise_label(value: str) -> str:
    value = value.replace("\u00a0", " ").strip().casefold()
    value = re.sub(r"[\s\W_]+", " ", value, flags=re.UNICODE)
    return value.strip()


def _safe_label(value: str) -> str:
    """Bound external form text before it enters a user notification."""
    clean = " ".join(value.replace("\x00", " ").split())
    return clean[:240] or "unnamed required field"


class FlowError(RuntimeError):
    pass


class BlockedHuman(FlowError):
    def __init__(self, reason: str, detail: str, step: str):
        super().__init__(detail)
        self.reason = reason
        self.detail = detail
        self.step = step


@dataclass(frozen=True)
class Receipt:
    screenshot_path: Path
    confirmation_url: str = ""
    confirmation_text: str = ""
    captured_at: str = field(default_factory=_utc_now)

    def is_valid(self) -> bool:
        try:
            screenshot_ok = self.screenshot_path.is_file() and self.screenshot_path.stat().st_size > 0
        except OSError:
            screenshot_ok = False
        return screenshot_ok and bool(
            self.confirmation_url.strip() or self.confirmation_text.strip()
        )

    def to_dict(self) -> dict[str, str]:
        return {
            "screenshot_path": str(self.screenshot_path),
            "confirmation_url": self.confirmation_url,
            "confirmation_text": self.confirmation_text,
            "captured_at": self.captured_at,
        }

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "Receipt":
        return cls(
            Path(str(value.get("screenshot_path", ""))),
            str(value.get("confirmation_url", "")),
            str(value.get("confirmation_text", "")),
            str(value.get("captured_at", "")) or _utc_now(),
        )


@dataclass
class FlowCheckpoint:
    position_id: int
    url: str
    state: str = "detect"
    platform: str = ""
    completed_steps: list[str] = field(default_factory=list)
    submit_started: bool = False
    submit_started_at: str = ""
    blocked_reason: str = ""
    blocked_detail: str = ""
    resume_state: str = ""
    receipt: dict[str, Any] | None = None
    version: int = CHECKPOINT_VERSION
    updated_at: str = field(default_factory=_utc_now)

    @classmethod
    def new(cls, position_id: int, url: str) -> "FlowCheckpoint":
        return cls(position_id=int(position_id), url=url)

    @classmethod
    def load(cls, path: Path, position_id: int, url: str) -> "FlowCheckpoint":
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return cls.new(position_id, url)
        except (OSError, ValueError, TypeError) as exc:
            raise FlowError(f"checkpoint cannot be read: {exc}") from exc
        if not isinstance(raw, dict) or raw.get("version") != CHECKPOINT_VERSION:
            raise FlowError("checkpoint has an unknown format")
        if raw.get("position_id") != int(position_id) or raw.get("url") != url:
            raise FlowError("checkpoint belongs to a different application")
        valid_states = set(STEP_ORDER) | {"blocked_human", "denied", "dry_run", "complete"}
        if raw.get("state") not in valid_states:
            raise FlowError("checkpoint has an unknown state")
        completed = raw.get("completed_steps")
        if not isinstance(completed, list) or any(step not in STEP_ORDER for step in completed):
            raise FlowError("checkpoint has invalid completed steps")
        if not isinstance(raw.get("submit_started"), bool):
            raise FlowError("checkpoint has an invalid submit marker")
        if raw.get("receipt") is not None and not isinstance(raw.get("receipt"), dict):
            raise FlowError("checkpoint has an invalid receipt")
        known = {name for name in cls.__dataclass_fields__}
        return cls(**{name: value for name, value in raw.items() if name in known})

    def complete_step(self, step: str, next_state: str) -> None:
        if step not in self.completed_steps:
            self.completed_steps.append(step)
        self.state = next_state
        self.blocked_reason = ""
        self.blocked_detail = ""
        self.resume_state = ""

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            path.parent.chmod(0o700)
        except OSError:
            pass
        self.updated_at = _utc_now()
        payload = {
            name: getattr(self, name)
            for name in self.__dataclass_fields__
        }
        handle = None
        temporary = ""
        try:
            handle = tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                dir=path.parent,
                prefix=f".{path.name}.",
                delete=False,
            )
            temporary = handle.name
            json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
            handle.close()
            os.chmod(temporary, 0o600)
            os.replace(temporary, path)
        except Exception:
            if handle and not handle.closed:
                handle.close()
            if temporary:
                with contextlib.suppress(OSError):
                    os.unlink(temporary)
            raise


@dataclass(frozen=True)
class FlowResult:
    status: str
    state: str
    reason: str = ""
    receipt: Receipt | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "state": self.state,
            "reason": self.reason,
            "receipt": self.receipt.to_dict() if self.receipt else None,
        }


@dataclass(frozen=True)
class _DeniedVerdict:
    reason: str
    detail: str
    context: dict[str, Any] = field(default_factory=dict)
    allowed: bool = False

    def log_line(self) -> str:
        return f"[apply-gate] DENY {self.reason} — {self.detail}"


def _default_gate_checker(**kwargs):
    try:
        from apply_gate import apply_verdict
    except ImportError:
        try:
            from shared.skills.apply_gate import apply_verdict
        except ImportError:
            return _DeniedVerdict(
                "gate_missing",
                "shared/skills/apply_gate.py is unavailable; submission is closed",
            )
    try:
        return apply_verdict(**kwargs)
    except Exception as exc:
        return _DeniedVerdict(
            "gate_error",
            f"the authorisation gate could not decide ({type(exc).__name__})",
        )


def _default_notifier(*, position_id: int, message: str) -> str:
    candidates = [
        shutil.which("jht-notify-user"),
        "/app/agents/_tools/jht-notify-user",
        str(Path(__file__).resolve().parents[2] / "agents" / "_tools" / "jht-notify-user"),
    ]
    executable = next((value for value in candidates if value and Path(value).is_file()), None)
    if not executable:
        raise FlowError("jht-notify-user is unavailable")
    result = subprocess.run(
        [
            executable,
            "--agent",
            "closer",
            "--kind",
            "question",
            "--position-id",
            str(position_id),
            message,
        ],
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
    )
    if result.returncode != 0:
        raise FlowError(f"jht-notify-user failed with exit {result.returncode}")
    notification_id = result.stdout.strip().split(maxsplit=1)[0]
    if not notification_id.isdigit():
        raise FlowError("jht-notify-user returned no durable message id")
    return notification_id


def _resolve_db_path(db_path: str | Path | None) -> Path:
    if db_path:
        return Path(db_path)
    if os.environ.get("JHT_DB"):
        return Path(os.environ["JHT_DB"])
    if os.environ.get("JHT_HOME"):
        return Path(os.environ["JHT_HOME"]) / "jobs.db"
    raise FlowError("no database configured: set JHT_DB or JHT_HOME")


def _default_applied_recorder(
    *, position_id: int, receipt: Receipt, db_path: str | Path | None
) -> None:
    if not receipt.is_valid():
        raise FlowError("refusing to record applied without a complete receipt")
    resolved_db = _resolve_db_path(db_path)
    if not resolved_db.is_file():
        raise FlowError("configured jobs database does not exist")

    # A replay after a process crash is harmless only when the effect is read
    # first.  Do not replace a previous channel or timestamp with a new one.
    with sqlite3.connect(resolved_db) as conn:
        existing = conn.execute(
            "SELECT applied, applied_at, applied_via FROM applications WHERE position_id = ?",
            (position_id,),
        ).fetchone()
        position = conn.execute(
            "SELECT status FROM positions WHERE id = ?", (position_id,)
        ).fetchone()
    if (
        existing
        and existing[0] == 1
        and existing[1]
        and existing[2] == "agent_closer"
        and position
        and position[0] == "applied"
    ):
        return
    if existing and existing[0] == 1:
        raise FlowError("application is already applied through a different channel")

    updater = Path(__file__).with_name("db_update.py")
    env = {**os.environ, "JHT_DB": str(resolved_db), "JHT_AGENT_NAME": "closer"}
    result = subprocess.run(
        [
            sys.executable,
            str(updater),
            "application",
            str(position_id),
            "--applied-at",
            "now",
            "--applied-via",
            "agent_closer",
        ],
        check=False,
        capture_output=True,
        text=True,
        env=env,
        timeout=30,
    )
    if result.returncode != 0:
        raise FlowError(f"db_update rejected the applied transition (exit {result.returncode})")

    # Exit zero is not the effect.  The command must have atomically changed
    # both sides of the funnel before this function returns success.
    with sqlite3.connect(resolved_db) as conn:
        observed = conn.execute(
            "SELECT applied, applied_at, applied_via FROM applications WHERE position_id = ?",
            (position_id,),
        ).fetchone()
        observed_position = conn.execute(
            "SELECT status FROM positions WHERE id = ?", (position_id,)
        ).fetchone()
    if not (
        observed
        and observed[0] == 1
        and observed[1]
        and observed[2] == "agent_closer"
        and observed_position
        and observed_position[0] == "applied"
    ):
        raise FlowError("db_update returned success but the applied transition is absent")


class AshbyRecipe:
    FIELD_ENTRY = ".ashby-application-form-field-entry"
    QUESTION = ".ashby-application-form-question-title"
    SUBMIT = ".ashby-application-form-submit-button"
    SUCCESS = ".ashby-application-form-success-container"

    _CORE_LABELS = {
        "name": ("name",),
        "full name": ("name",),
        "email": ("contacts", "email"),
        "email address": ("contacts", "email"),
        "phone": ("contacts", "phone"),
        "phone number": ("contacts", "phone"),
        "linkedin": ("contacts", "linkedin"),
        "linkedin profile": ("contacts", "linkedin"),
        "github": ("contacts", "github"),
        "github profile": ("contacts", "github"),
        "website": ("contacts", "website"),
        "personal website": ("contacts", "website"),
        "personal web": ("contacts", "website"),
        "portfolio url": ("contacts", "website"),
        "address": ("contacts", "address"),
        "location": ("location",),
        "current location": ("location",),
        "where do you currently live": ("location",),
        "where are you currently located": ("location",),
    }

    _SEMANTIC_ANSWER_KEYS = (
        (re.compile(r"sponsor|sponsorship", re.I), "sponsorship"),
        (re.compile(r"relocat", re.I), "relocation"),
        (re.compile(r"authorized to work|authorised to work|work authorization", re.I), "work_authorization"),
        (re.compile(r"how did you hear|how you heard", re.I), "how_heard"),
        (re.compile(r"notice period", re.I), "notice_period"),
        (re.compile(r"available to start|start date|availability", re.I), "availability"),
        (re.compile(r"salary expectation|desired salary", re.I), "salary_expectations"),
    )

    def __init__(self, profile: Mapping[str, Any], cv_path: Path):
        self.profile = profile
        self.cv_path = cv_path
        self.answers = self._answer_index(profile.get("application_answers"))

    @staticmethod
    def _answer_index(value: Any) -> dict[str, Any]:
        result: dict[str, Any] = {}
        if isinstance(value, Mapping):
            for key, answer in value.items():
                result[_normalise_label(str(key))] = answer
        elif isinstance(value, list):
            for item in value:
                if isinstance(item, Mapping) and item.get("question"):
                    result[_normalise_label(str(item["question"]))] = item.get("answer")
        return result

    @staticmethod
    def _label(entry) -> str:
        label = entry.locator(AshbyRecipe.QUESTION)
        if label.count():
            return label.first.inner_text().replace("\u00a0", " ").strip()
        controls = entry.locator("input, textarea, select")
        if controls.count():
            return controls.first.get_attribute("id") or ""
        return ""

    @staticmethod
    def _field_path(entry) -> str:
        return entry.get_attribute("data-field-path") or ""

    @staticmethod
    def _required(entry) -> bool:
        if entry.locator("input[required], textarea[required], select[required]").count():
            return True
        label = entry.locator(AshbyRecipe.QUESTION)
        if not label.count():
            return False
        classes = label.first.get_attribute("class") or ""
        return "required" in classes.casefold() or label.first.get_attribute("aria-required") == "true"

    @staticmethod
    def _profile_value(profile: Mapping[str, Any], path: tuple[str, ...]) -> Any:
        value: Any = profile
        for part in path:
            if not isinstance(value, Mapping):
                return None
            value = value.get(part)
        # Core Ashby identity/contact controls are textual.  Coercing a
        # malformed boolean or object to a plausible-looking string would
        # bypass the profile schema instead of failing closed.
        if not isinstance(value, str):
            return None
        return value.strip() or None

    @staticmethod
    def _first_control(entry):
        controls = entry.locator("input:not([type=hidden]), textarea, select")
        return controls.first if controls.count() else None

    @staticmethod
    def _is_answered(entry) -> bool:
        if entry.locator("button[aria-pressed=true]").count():
            return True
        if entry.locator("input[type=radio]:checked, input[type=checkbox]:checked").count():
            return True
        controls = entry.locator("input:not([type=hidden]), textarea, select")
        for index in range(controls.count()):
            control = controls.nth(index)
            control_type = (control.get_attribute("type") or "").casefold()
            if control_type in {"radio", "checkbox"}:
                continue
            if control_type == "file":
                if control.evaluate("element => element.files.length") > 0:
                    return True
            elif control.input_value().strip():
                return True
        return False

    def open_form(self, page) -> None:
        if page.locator(self.FIELD_ENTRY).count():
            return
        apply_link = page.get_by_text("Apply for this Job", exact=False)
        if not apply_link.count():
            raise BlockedHuman(
                "ashby_form_missing",
                "Ashby application form or Apply button was not found",
                "detect",
            )
        if apply_link.count() != 1:
            raise BlockedHuman(
                "ashby_apply_ambiguous",
                "more than one Ashby Apply button was found",
                "detect",
            )
        apply_link.click()
        try:
            page.locator(self.FIELD_ENTRY).first.wait_for(state="attached", timeout=10_000)
        except Exception as exc:
            raise BlockedHuman(
                "ashby_form_missing",
                "Ashby Apply button did not open an application form",
                "detect",
            ) from exc

    def fill_core(self, page) -> None:
        entries = page.locator(self.FIELD_ENTRY)
        for index in range(entries.count()):
            entry = entries.nth(index)
            label = self._label(entry)
            field_path = self._field_path(entry)
            key = _normalise_label(label)
            profile_path = None
            if field_path == "_systemfield_name":
                profile_path = ("name",)
            elif field_path == "_systemfield_email":
                profile_path = ("contacts", "email")
            elif key in self._CORE_LABELS:
                profile_path = self._CORE_LABELS[key]
            if not profile_path:
                continue
            value = self._profile_value(self.profile, profile_path)
            if value is None and profile_path == ("contacts", "email"):
                value = self._profile_value(self.profile, ("email",))
            if value is None:
                if self._required(entry):
                    raise BlockedHuman(
                        "required_profile_field_missing",
                        f"Required Ashby field needs profile data: {_safe_label(label)}",
                        "fill",
                    )
                continue
            control = self._first_control(entry)
            if control is None:
                raise BlockedHuman(
                    "unknown_required_control",
                    f"Required Ashby field has no recognised control: {_safe_label(label)}",
                    "fill",
                )
            control_type = (control.get_attribute("type") or "").casefold()
            if control_type in {"file", "radio", "checkbox"}:
                continue
            control.fill(str(value))

    def upload_cv(self, page) -> None:
        if not self.cv_path.is_file() or self.cv_path.stat().st_size <= 0:
            raise BlockedHuman("cv_missing", "The selected CV file is missing or empty", "upload_cv")
        resume = page.locator("#_systemfield_resume")
        if resume.count() != 1 or (resume.first.get_attribute("type") or "") != "file":
            raise BlockedHuman(
                "resume_field_missing",
                "Ashby resume upload field was not found unambiguously",
                "upload_cv",
            )
        resume.first.set_input_files(str(self.cv_path))
        page.wait_for_timeout(100)
        if resume.first.evaluate("element => element.files.length") != 1:
            raise BlockedHuman("upload_rejected", "Ashby did not retain the selected CV", "upload_cv")
        group = resume.first.locator("xpath=ancestor::*[contains(@class, 'ashby-application-form-field-entry')][1]")
        if group.count() and self._visible_error_text(group.first):
            raise BlockedHuman("upload_rejected", "Ashby reported a CV upload error", "upload_cv")

    def _answer_for(self, label: str, field_path: str) -> tuple[bool, Any]:
        keys = [_normalise_label(field_path), _normalise_label(label)]
        for pattern, semantic in self._SEMANTIC_ANSWER_KEYS:
            if pattern.search(label):
                keys.append(_normalise_label(semantic))
        for key in keys:
            if key in self.answers:
                return True, self.answers[key]
        return False, None

    def fill_screening(self, page) -> None:
        entries = page.locator(self.FIELD_ENTRY)
        for index in range(entries.count()):
            entry = entries.nth(index)
            field_path = self._field_path(entry)
            if field_path in {"_systemfield_name", "_systemfield_email", "_systemfield_resume"}:
                continue
            label = self._label(entry)
            key = _normalise_label(label)
            if key in self._CORE_LABELS or self._is_answered(entry):
                continue
            present, answer = self._answer_for(label, field_path)
            if not present:
                if self._required(entry):
                    raise BlockedHuman(
                        "required_answer_missing",
                        f"Required Ashby question needs an answer: {_safe_label(label)}",
                        "screening",
                    )
                continue
            self._fill_answer(entry, label, answer)
            if not self._is_answered(entry):
                raise BlockedHuman(
                    "answer_not_accepted",
                    f"Ashby did not retain the answer for: {_safe_label(label)}",
                    "screening",
                )

    def _fill_answer(self, entry, label: str, answer: Any) -> None:
        yes_no = entry.locator(".ashby-application-form-input-yesno-option")
        if yes_no.count():
            if isinstance(answer, bool):
                wanted = "yes" if answer else "no"
            elif isinstance(answer, str) and _normalise_label(answer) in {"yes", "no"}:
                wanted = _normalise_label(answer)
            else:
                raise BlockedHuman(
                    "answer_type_unknown",
                    f"Yes/no question has no explicit boolean answer: {_safe_label(label)}",
                    "screening",
                )
            option = entry.locator(f"button[data-option={wanted}]")
            if option.count() != 1:
                raise BlockedHuman(
                    "unknown_required_control",
                    f"Ashby yes/no options are ambiguous for: {_safe_label(label)}",
                    "screening",
                )
            option.click()
            return

        radios = entry.locator("input[type=radio]")
        if radios.count():
            wanted = _normalise_label(str(answer))
            matches = []
            for index in range(radios.count()):
                radio = radios.nth(index)
                labels = radio.evaluate("element => Array.from(element.labels || []).map(label => label.innerText)")
                if any(_normalise_label(str(value)) == wanted for value in labels):
                    matches.append(radio)
            if len(matches) != 1:
                raise BlockedHuman(
                    "answer_option_unknown",
                    f"No single Ashby option matches the saved answer for: {_safe_label(label)}",
                    "screening",
                )
            matches[0].check()
            return

        select = entry.locator("select")
        if select.count() == 1:
            try:
                select.select_option(label=str(answer))
            except Exception as exc:
                raise BlockedHuman(
                    "answer_option_unknown",
                    f"Ashby select has no option matching the saved answer for: {_safe_label(label)}",
                    "screening",
                ) from exc
            return

        checkboxes = entry.locator("input[type=checkbox]")
        if checkboxes.count() == 1 and isinstance(answer, bool):
            checkboxes.first.set_checked(answer)
            return

        text = entry.locator("textarea, input:not([type=hidden]):not([type=file])")
        if text.count() == 1 and isinstance(answer, (str, int, float)) and not isinstance(answer, bool):
            rendered = str(answer).strip()
            if not rendered:
                raise BlockedHuman(
                    "required_answer_missing",
                    f"Saved answer is empty for: {_safe_label(label)}",
                    "screening",
                )
            text.first.fill(rendered)
            return

        raise BlockedHuman(
            "unknown_required_control",
            f"Ashby field type is not supported safely: {_safe_label(label)}",
            "screening",
        )

    @staticmethod
    def _visible_error_text(scope) -> str:
        selectors = (
            ".ashby-application-form-error",
            "[role=alert]",
            "[aria-invalid=true]",
        )
        for selector in selectors:
            matches = scope.locator(selector)
            for index in range(matches.count()):
                match = matches.nth(index)
                if match.is_visible():
                    return (match.inner_text() or match.get_attribute("aria-label") or selector).strip()
        return ""

    @staticmethod
    def _challenge_reason(page) -> str:
        selectors = (
            ("iframe[title*='captcha' i]", "captcha"),
            ("iframe[src*='recaptcha' i]", "captcha"),
            ("iframe[src*='hcaptcha' i]", "captcha"),
            ("input[autocomplete='one-time-code']", "two_factor"),
            ("input[name*='otp' i]", "two_factor"),
        )
        for selector, reason in selectors:
            matches = page.locator(selector)
            for index in range(matches.count()):
                if matches.nth(index).is_visible():
                    return reason
        body = page.locator("body")
        text = body.inner_text().casefold() if body.count() else ""
        if any(marker in text for marker in ("verify you are human", "complete the captcha")):
            return "captcha"
        if any(marker in text for marker in ("enter verification code", "two-factor authentication")):
            return "two_factor"
        return ""

    def review(self, page) -> None:
        challenge = self._challenge_reason(page)
        if challenge:
            raise BlockedHuman(challenge, f"Ashby requires human intervention ({challenge})", "review")
        error = self._visible_error_text(page)
        if error:
            raise BlockedHuman("form_error", "Ashby reports a form validation error", "review")

        entries = page.locator(self.FIELD_ENTRY)
        for index in range(entries.count()):
            entry = entries.nth(index)
            if not self._required(entry):
                continue
            label = self._label(entry)
            if not self._is_answered(entry):
                raise BlockedHuman(
                    "required_field_unanswered",
                    f"Required Ashby field remains unanswered: {_safe_label(label)}",
                    "review",
                )
            controls = entry.locator("input:not([type=hidden]), textarea, select")
            for control_index in range(controls.count()):
                control = controls.nth(control_index)
                control_type = (control.get_attribute("type") or "").casefold()
                if control_type not in {"radio", "checkbox", "file"} and not control.evaluate(
                    "element => element.checkValidity()"
                ):
                    raise BlockedHuman(
                        "field_invalid",
                        f"Ashby rejected the format of: {_safe_label(label)}",
                        "review",
                    )

        submit = page.locator(self.SUBMIT)
        if submit.count() != 1 or not submit.first.is_visible() or not submit.first.is_enabled():
            raise BlockedHuman(
                "submit_unavailable",
                "Ashby submit button is missing, ambiguous, or disabled",
                "review",
            )

    def submit(self, page) -> None:
        # Called once only.  The checkpoint that makes retries impossible is
        # persisted by ApplicationFlow before entering this method.
        page.locator(self.SUBMIT).click(timeout=10_000)


class ApplicationFlow:
    def __init__(
        self,
        *,
        position_id: int,
        url: str,
        profile: Mapping[str, Any],
        cv_path: str | Path,
        checkpoint_path: str | Path | None = None,
        receipt_dir: str | Path | None = None,
        db_path: str | Path | None = None,
        gate_checker: Callable[..., Any] | None = None,
        notifier: Callable[..., str] | None = None,
        applied_recorder: Callable[..., None] | None = None,
        confirmation_timeout_ms: int = 20_000,
        headless: bool = True,
    ):
        if isinstance(position_id, bool) or int(position_id) <= 0:
            raise ValueError("position_id must be a positive integer")
        self.position_id = int(position_id)
        self.url = url.strip()
        self.profile = profile
        self.cv_path = Path(cv_path)
        jht_home = Path(os.environ.get("JHT_HOME") or (Path.home() / ".jht"))
        self.checkpoint_path = Path(checkpoint_path) if checkpoint_path else (
            jht_home / ".cache" / "apply-flow" / f"{self.position_id}.json"
        )
        self.receipt_dir = Path(receipt_dir) if receipt_dir else (
            jht_home / "application-receipts"
        )
        self.db_path = db_path
        self.gate_checker = gate_checker or _default_gate_checker
        self.notifier = notifier or _default_notifier
        self.applied_recorder = applied_recorder or _default_applied_recorder
        self.confirmation_timeout_ms = max(0, int(confirmation_timeout_ms))
        self.headless = headless

    def _gate(self):
        try:
            verdict = self.gate_checker(position_id=self.position_id, db_path=self.db_path)
        except Exception as exc:
            verdict = _DeniedVerdict(
                "gate_error",
                f"the authorisation gate could not decide ({type(exc).__name__})",
            )
        if getattr(verdict, "allowed", None) is not True:
            LOG.warning(getattr(verdict, "log_line", lambda: "[apply-gate] DENY invalid_verdict")())
        return verdict

    @contextlib.contextmanager
    def _managed_page(self) -> Iterator[Any]:
        try:
            from playwright.sync_api import sync_playwright
        except ImportError as exc:
            raise FlowError("playwright is not installed") from exc
        with sync_playwright() as runtime:
            browser = runtime.chromium.launch(
                headless=self.headless,
                args=["--no-sandbox", "--disable-dev-shm-usage"],
            )
            try:
                context = browser.new_context(locale="en-US", viewport={"width": 1280, "height": 900})
                yield context.new_page()
            finally:
                browser.close()

    def _navigate(self, page) -> None:
        try:
            from safe_fetch import resolve_public_address
            from url_guard import check_url
        except ImportError:  # pragma: no cover - package import
            from shared.skills.safe_fetch import resolve_public_address
            from shared.skills.url_guard import check_url
        try:
            checked = check_url(self.url)
            parts = urllib.parse.urlsplit(checked)
            resolve_public_address(parts.hostname, parts.port or (443 if parts.scheme == "https" else 80))
        except Exception as exc:
            raise BlockedHuman("url_refused", "Application URL failed the public-address guard", "detect") from exc
        response = page.goto(checked, wait_until="domcontentloaded", timeout=30_000)
        if response is None or response.status >= 400:
            raise BlockedHuman("page_unavailable", "Application page did not return a successful response", "detect")
        page.wait_for_timeout(500)

    def _notification_message(self, blocked: BlockedHuman) -> str:
        if blocked.reason in {"required_answer_missing", "required_profile_field_missing"}:
            return (
                "CLOSER stopped before submission because a required application field "
                f"has no saved answer. {blocked.detail} Please add the exact answer to "
                "application_answers and resume this application."
            )
        return (
            "CLOSER stopped before any blind retry. "
            f"Reason: {blocked.reason}. {blocked.detail} Human review is required."
        )

    def _block(self, checkpoint: FlowCheckpoint, blocked: BlockedHuman) -> FlowResult:
        checkpoint.state = "blocked_human"
        checkpoint.resume_state = blocked.step
        checkpoint.blocked_reason = blocked.reason
        checkpoint.blocked_detail = blocked.detail
        checkpoint.save(self.checkpoint_path)
        try:
            self.notifier(
                position_id=self.position_id,
                message=self._notification_message(blocked),
            )
        except Exception as exc:
            LOG.error("blocked_human notification failed: %s", type(exc).__name__)
        return FlowResult("blocked_human", checkpoint.state, blocked.reason)

    def _deny(self, checkpoint: FlowCheckpoint, verdict: Any) -> FlowResult:
        checkpoint.state = "denied"
        checkpoint.blocked_reason = str(getattr(verdict, "reason", "gate_denied"))
        checkpoint.blocked_detail = str(getattr(verdict, "detail", "authorisation denied"))
        checkpoint.save(self.checkpoint_path)
        return FlowResult("denied", checkpoint.state, checkpoint.blocked_reason)

    @staticmethod
    def _confirmation(page, application_url: str) -> tuple[str, str] | None:
        success = page.locator(AshbyRecipe.SUCCESS)
        if success.count() and success.first.is_visible():
            text = " ".join(success.first.inner_text().split())[:1000]
            if text:
                return "", text

        body = page.locator("body")
        visible = " ".join(body.inner_text().split()) if body.count() else ""
        markers = (
            "thank you for applying",
            "thanks for applying",
            "application submitted",
            "application received",
            "we have received your application",
            "your application has been submitted",
            "your application is on its way",
        )
        lower = visible.casefold()
        for marker in markers:
            offset = lower.find(marker)
            if offset >= 0:
                return "", visible[offset : offset + 1000]

        final_url = page.url
        # A changed URL is evidence only when it is an HTTP(S) confirmation
        # URL on the same Ashby origin.  A fresh browser starts at about:blank;
        # accepting any different URL plus an absent form turned a blank page
        # into a valid receipt during crash recovery.
        try:
            final = urllib.parse.urlsplit(final_url)
            original = urllib.parse.urlsplit(application_url)
        except ValueError:
            final = original = urllib.parse.SplitResult("", "", "", "", "")
        confirmation_url_markers = (
            "confirmation",
            "confirmed",
            "success",
            "submitted",
            "thank-you",
            "thank_you",
        )
        final_route = f"{final.path}?{final.query}".casefold()
        if (
            final.scheme in {"http", "https"}
            and final.netloc.casefold() == original.netloc.casefold()
            and final_url != application_url
            and any(marker in final_route for marker in confirmation_url_markers)
            and page.locator(AshbyRecipe.SUBMIT).count() == 0
        ):
            return final_url, ""
        return None

    def _wait_for_confirmation(self, page) -> tuple[str, str] | None:
        deadline = time.monotonic() + self.confirmation_timeout_ms / 1000
        while True:
            found = self._confirmation(page, self.url)
            if found:
                return found
            if time.monotonic() >= deadline:
                return None
            page.wait_for_timeout(min(250, max(1, self.confirmation_timeout_ms)))

    def _capture_receipt(self, page, confirmation: tuple[str, str]) -> Receipt:
        self.receipt_dir.mkdir(parents=True, exist_ok=True)
        try:
            self.receipt_dir.chmod(0o700)
        except OSError:
            pass
        slug = hashlib.sha256(self.url.encode("utf-8")).hexdigest()[:12]
        screenshot = self.receipt_dir / f"{self.position_id}-{slug}-{time.time_ns()}.png"
        try:
            page.screenshot(path=str(screenshot), full_page=True)
            screenshot.chmod(0o600)
        except Exception as exc:
            with contextlib.suppress(OSError):
                screenshot.unlink()
            raise BlockedHuman(
                "receipt_screenshot_failed",
                "Submission confirmation was visible but its screenshot could not be saved",
                "submit",
            ) from exc
        receipt = Receipt(
            screenshot_path=screenshot,
            confirmation_url=confirmation[0],
            confirmation_text=confirmation[1],
        )
        if not receipt.is_valid():
            raise BlockedHuman(
                "receipt_incomplete",
                "Submission confirmation did not produce a complete receipt",
                "submit",
            )
        return receipt

    def _record(self, checkpoint: FlowCheckpoint, receipt: Receipt) -> FlowResult:
        if not receipt.is_valid():
            return self._block(
                checkpoint,
                BlockedHuman("receipt_incomplete", "Saved submission receipt is incomplete", "submit"),
            )
        try:
            self.applied_recorder(
                position_id=self.position_id,
                receipt=receipt,
                db_path=self.db_path,
            )
        except Exception as exc:
            return self._block(
                checkpoint,
                BlockedHuman(
                    "applied_record_failed",
                    f"Submission has a receipt but applied state could not be verified ({type(exc).__name__})",
                    "submit",
                ),
            )
        checkpoint.state = "complete"
        checkpoint.complete_step("submit", "complete")
        checkpoint.receipt = receipt.to_dict()
        checkpoint.save(self.checkpoint_path)
        return FlowResult("applied", checkpoint.state, receipt=receipt)

    def run(self, *, page: Any | None = None, navigate: bool = True) -> FlowResult:
        try:
            checkpoint = FlowCheckpoint.load(
                self.checkpoint_path, self.position_id, self.url
            )
        except FlowError as exc:
            checkpoint = FlowCheckpoint.new(self.position_id, self.url)
            return self._block(
                checkpoint,
                BlockedHuman("checkpoint_invalid", str(exc), "detect"),
            )

        if checkpoint.state == "complete" and checkpoint.receipt:
            receipt = Receipt.from_dict(checkpoint.receipt)
            if receipt.is_valid():
                return FlowResult("applied", "complete", receipt=receipt)

        first_gate = self._gate()
        if getattr(first_gate, "allowed", None) is not True:
            return self._deny(checkpoint, first_gate)
        mode = getattr(first_gate, "context", {}).get("mode")
        if mode not in {"authorised", "dry_run"}:
            return self._deny(
                checkpoint,
                _DeniedVerdict("gate_mode_unknown", "gate returned no recognised application mode"),
            )

        if checkpoint.submit_started and checkpoint.receipt:
            receipt = Receipt.from_dict(checkpoint.receipt)
            if receipt.is_valid():
                return self._record(checkpoint, receipt)

        manager = contextlib.nullcontext(page) if page is not None else self._managed_page()
        with manager as active_page:
            if checkpoint.submit_started:
                try:
                    # Production recovery owns a fresh about:blank page.  It
                    # must first observe the real application URL; otherwise
                    # an absent form says nothing about the previous submit.
                    # Reloading will normally show the form again even when
                    # the remote submit succeeded.  Blocking in that case is
                    # intentional: uncertainty cannot authorise a second click.
                    if navigate:
                        self._navigate(active_page)
                    confirmation = self._confirmation(active_page, self.url)
                    if confirmation:
                        receipt = self._capture_receipt(active_page, confirmation)
                        checkpoint.receipt = receipt.to_dict()
                        checkpoint.save(self.checkpoint_path)
                        return self._record(checkpoint, receipt)
                except Exception:
                    # Navigation failure is still an unknown external outcome,
                    # never permission to retry the irreversible click.
                    pass
                return self._block(
                    checkpoint,
                    BlockedHuman(
                        "submit_outcome_unknown",
                        "A previous process started submit but left no receipt; it will not be clicked again",
                        "submit",
                    ),
                )

            recipe = AshbyRecipe(self.profile, self.cv_path)
            try:
                if navigate:
                    self._navigate(active_page)
                detection = detect_ats(self.url, active_page.content())
                if detection.platform != SUPPORTED_PLATFORM:
                    reason = "ats_conflict" if detection.conflict else "ats_unsupported"
                    raise BlockedHuman(
                        reason,
                        "Application platform is unknown, conflicting, or has no safe recipe",
                        "detect",
                    )
                checkpoint.platform = detection.platform
                recipe.open_form(active_page)
                # Confirm the rendered form too.  URL-only detection is not
                # enough to interact when a block/error page owns that URL.
                rendered = detect_ats(self.url, active_page.content())
                if rendered.platform != SUPPORTED_PLATFORM or not rendered.dom_match:
                    raise BlockedHuman(
                        "ashby_dom_unrecognised",
                        "URL is Ashby but the rendered application form is not recognised",
                        "detect",
                    )
                checkpoint.complete_step("detect", "fill")
                checkpoint.save(self.checkpoint_path)

                recipe.fill_core(active_page)
                checkpoint.complete_step("fill", "upload_cv")
                checkpoint.save(self.checkpoint_path)

                recipe.upload_cv(active_page)
                checkpoint.complete_step("upload_cv", "screening")
                checkpoint.save(self.checkpoint_path)

                recipe.fill_screening(active_page)
                checkpoint.complete_step("screening", "review")
                checkpoint.save(self.checkpoint_path)

                recipe.review(active_page)
                checkpoint.complete_step("review", "submit")
                checkpoint.save(self.checkpoint_path)

                # Confirmation words already visible before the click cannot
                # prove that this click succeeded.  Stop instead of reusing a
                # footer, stale banner, or employer-authored sentence as a
                # receipt after submit.
                if self._confirmation(active_page, self.url):
                    raise BlockedHuman(
                        "confirmation_ambiguous",
                        "Confirmation evidence is already visible before submit",
                        "review",
                    )

                if mode == "dry_run":
                    checkpoint.state = "dry_run"
                    checkpoint.save(self.checkpoint_path)
                    return FlowResult("dry_run", checkpoint.state)

                final_gate = self._gate()
                if getattr(final_gate, "allowed", None) is not True:
                    return self._deny(checkpoint, final_gate)
                if getattr(final_gate, "context", {}).get("mode") != "authorised":
                    return self._deny(
                        checkpoint,
                        _DeniedVerdict(
                            "gate_mode_changed",
                            "application mode changed before submit; refusing the click",
                        ),
                    )

                checkpoint.state = "submit"
                checkpoint.submit_started = True
                checkpoint.submit_started_at = _utc_now()
                checkpoint.save(self.checkpoint_path)
                recipe.submit(active_page)
                confirmation = self._wait_for_confirmation(active_page)
                if not confirmation:
                    raise BlockedHuman(
                        "receipt_missing",
                        "Submit was clicked once but no confirmation URL or text appeared",
                        "submit",
                    )
                receipt = self._capture_receipt(active_page, confirmation)
                checkpoint.receipt = receipt.to_dict()
                checkpoint.save(self.checkpoint_path)
                return self._record(checkpoint, receipt)
            except BlockedHuman as blocked:
                return self._block(checkpoint, blocked)
            except Exception as exc:
                step = checkpoint.state if checkpoint.state in STEP_ORDER else "review"
                return self._block(
                    checkpoint,
                    BlockedHuman(
                        "browser_uncertainty",
                        f"Browser interaction stopped with {type(exc).__name__}; no blind retry is allowed",
                        step,
                    ),
                )


def _load_profile(path: Path) -> Mapping[str, Any]:
    try:
        import yaml
    except ImportError as exc:
        raise FlowError("pyyaml is not installed") from exc
    try:
        value = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise FlowError(f"candidate profile cannot be read: {exc}") from exc
    if not isinstance(value, Mapping):
        raise FlowError("candidate profile is not a mapping")
    return value


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--position-id", type=int, required=True)
    parser.add_argument("--url", required=True)
    parser.add_argument("--profile", type=Path, required=True)
    parser.add_argument("--cv", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path)
    parser.add_argument("--receipt-dir", type=Path)
    parser.add_argument("--db", type=Path)
    parser.add_argument("--headful", action="store_true")
    args = parser.parse_args(argv)

    try:
        flow = ApplicationFlow(
            position_id=args.position_id,
            url=args.url,
            profile=_load_profile(args.profile),
            cv_path=args.cv,
            checkpoint_path=args.checkpoint,
            receipt_dir=args.receipt_dir,
            db_path=args.db,
            headless=not args.headful,
        )
        result = flow.run()
    except (FlowError, ValueError) as exc:
        print(json.dumps({"status": "error", "reason": str(exc)}))
        return 2
    print(json.dumps(result.to_dict(), ensure_ascii=False, sort_keys=True))
    if result.status in {"applied", "dry_run"}:
        return 0
    if result.status == "denied":
        return 1
    return 3


if __name__ == "__main__":
    sys.exit(main())
