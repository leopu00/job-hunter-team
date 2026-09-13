#!/usr/bin/env python3
"""Checkpointed, fail-closed application flow for the CLOSER.

The state machine is ``detect -> fill -> upload_cv -> screening -> review ->
submit``.  Every completed step is written atomically to a mode-0600
checkpoint.  Filling steps are replayed idempotently after a browser restart;
submission is different: ``submit_started`` is persisted *before* the click,
and an uncertain outcome is never clicked again.

The complete public-form recipes are Ashby and Greenhouse.  A real submit has
four hard conditions:

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
import fcntl
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
SUPPORTED_PLATFORMS = frozenset({"ashby", "greenhouse"})
GREENHOUSE_HOSTS = frozenset(
    {
        "job-boards.greenhouse.io",
        "job-boards.eu.greenhouse.io",
        "boards.greenhouse.io",
    }
)
STEP_ORDER = ("detect", "fill", "upload_cv", "screening", "review", "submit")


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _resolve_headless(
    override: bool | None,
    *,
    env: Mapping[str, str] | None = None,
    socket_root: str | Path = "/tmp/.X11-unix",
) -> bool:
    """Choose headed mode only for a live, local X display unless overridden."""
    if override is not None:
        return override
    environment = os.environ if env is None else env
    if environment.get("JHT_LIVE_SCREEN", "").strip().casefold() in {
        "0",
        "false",
        "no",
        "off",
    }:
        return True
    display = environment.get("DISPLAY", "").strip()
    match = re.fullmatch(r"(?:(?:unix)?):([0-9]+)(?:\.[0-9]+)?", display)
    if not match:
        return True
    return not (Path(socket_root) / f"X{match.group(1)}").is_socket()


def _normalise_label(value: str) -> str:
    value = value.replace("\u00a0", " ").strip().casefold()
    value = re.sub(r"[\s\W_]+", " ", value, flags=re.UNICODE)
    return value.strip()


def _safe_label(value: str) -> str:
    """Bound external form text before it enters a user notification."""
    clean = " ".join(value.replace("\x00", " ").split())
    return clean[:240] or "unnamed required field"


def _exact_form_text(value: Any, *, maximum: int = 1000) -> str:
    """Return bounded visible form text without changing its words or case."""
    if not isinstance(value, str):
        return ""
    clean = " ".join(value.replace("\x00", " ").replace("\u00a0", " ").split())
    return clean if 0 < len(clean) <= maximum else ""


def _control_option_labels(controls) -> list[str]:
    """Read exact accessible labels; ambiguity is represented by an empty list."""
    values: list[str] = []
    for index in range(controls.count()):
        control = controls.nth(index)
        labels = control.evaluate(
            "element => Array.from(element.labels || []).map(label => label.innerText)"
        )
        exact = [_exact_form_text(value, maximum=500) for value in labels]
        exact = [value for value in exact if value]
        if len(exact) != 1 or exact[0] in values:
            return []
        values.append(exact[0])
    return values


class FlowError(RuntimeError):
    pass


class BlockedHuman(FlowError):
    def __init__(
        self,
        reason: str,
        detail: str,
        step: str,
        *,
        answer_request: Mapping[str, Any] | None = None,
    ):
        super().__init__(detail)
        self.reason = reason
        self.detail = detail
        self.step = step
        self.answer_request = dict(answer_request) if answer_request else None


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
    answer_request: dict[str, Any] | None = None
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
        if raw.get("answer_request") is not None and not isinstance(
            raw.get("answer_request"), dict
        ):
            raise FlowError("checkpoint has an invalid answer request")
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


def _default_notifier(
    *, position_id: int, message: str, answer_request: Mapping[str, Any] | None = None
) -> str:
    candidates = [
        shutil.which("jht-notify-user"),
        "/app/agents/_tools/jht-notify-user",
        str(Path(__file__).resolve().parents[2] / "agents" / "_tools" / "jht-notify-user"),
    ]
    executable = next((value for value in candidates if value and Path(value).is_file()), None)
    if not executable:
        raise FlowError("jht-notify-user is unavailable")
    command = [
        executable,
        "--agent",
        "closer",
        "--kind",
        "question",
        "--position-id",
        str(position_id),
    ]
    if os.environ.get("JHT_APPLY_FLOW_NO_EXTERNAL_NOTIFY") == "1":
        command.append("--no-telegram")
    if answer_request:
        command.extend(
            [
                "--existing-id",
                str(answer_request["message_id"]),
                "--source-id",
                str(answer_request["source_id"]),
                "--source-action",
                "closer_application_answer",
                "--source-payload",
                json.dumps(answer_request["payload"], ensure_ascii=False, sort_keys=True),
            ]
        )
    command.append(message)
    result = subprocess.run(
        command,
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

    @staticmethod
    def _answer_request(entry, label: str) -> dict[str, Any] | None:
        exact_label = _exact_form_text(label)
        key = _normalise_label(exact_label)
        if not exact_label or not key:
            return None
        yes_no = entry.locator(".ashby-application-form-input-yesno-option")
        if yes_no.count():
            return {
                "key": key,
                "label": exact_label,
                "field_type": "radio",
                "options": ["Yes", "No"],
            }
        radios = entry.locator("input[type=radio]")
        if radios.count():
            options = _control_option_labels(radios)
            if not options:
                return None
            return {
                "key": key,
                "label": exact_label,
                "field_type": "radio",
                "options": options,
            }
        select = entry.locator("select")
        if select.count() == 1:
            options = []
            choices = select.first.locator("option")
            for index in range(choices.count()):
                choice = choices.nth(index)
                text = _exact_form_text(choice.inner_text(), maximum=500)
                value = choice.get_attribute("value")
                if text and value not in {None, ""} and text not in options:
                    options.append(text)
            if not options:
                return None
            return {
                "key": key,
                "label": exact_label,
                "field_type": "select",
                "options": options,
            }
        checkboxes = entry.locator("input[type=checkbox]")
        if checkboxes.count() == 1:
            return {
                "key": key,
                "label": exact_label,
                "field_type": "checkbox",
                "options": ["Yes", "No"],
            }
        text = entry.locator("textarea")
        if text.count() == 1:
            return {"key": key, "label": exact_label, "field_type": "textarea", "options": []}
        inputs = entry.locator("input:not([type=hidden]):not([type=file])")
        if inputs.count() == 1:
            input_type = (inputs.first.get_attribute("type") or "text").casefold()
            if input_type in {"text", "email", "tel", "url", "number", "date"}:
                return {"key": key, "label": exact_label, "field_type": input_type, "options": []}
        return None

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
                    request = self._answer_request(entry, label)
                    if request is None:
                        raise BlockedHuman(
                            "unknown_required_control",
                            f"Ashby required question cannot be represented exactly: {_safe_label(label)}",
                            "screening",
                        )
                    raise BlockedHuman(
                        "required_answer_missing",
                        f"Required Ashby question needs an answer: {_safe_label(label)}",
                        "screening",
                        answer_request=request,
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
                match = matches.nth(index)
                if (
                    reason == "captcha"
                    and match.evaluate("element => element.tagName") == "IFRAME"
                    and AshbyRecipe._is_invisible_recaptcha_badge(
                        match.get_attribute("src") or ""
                    )
                ):
                    continue
                if match.is_visible():
                    return reason
        body = page.locator("body")
        text = body.inner_text().casefold() if body.count() else ""
        if any(marker in text for marker in ("verify you are human", "complete the captcha")):
            return "captcha"
        if any(marker in text for marker in ("enter verification code", "two-factor authentication")):
            return "two_factor"
        return ""

    @staticmethod
    def _is_invisible_recaptcha_badge(src: str) -> bool:
        try:
            parsed = urllib.parse.urlsplit(src)
            sizes = urllib.parse.parse_qs(parsed.query).get("size", [])
        except ValueError:
            return False
        return parsed.path.rstrip("/").endswith("/anchor") and any(
            size.casefold() == "invisible" for size in sizes
        )

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


class GreenhouseRecipe:
    """Fail-closed adapter for current and legacy public Greenhouse forms."""

    PLATFORM = "greenhouse"
    FORM = "#application-form.application--form, #application_form"
    FIELD_ENTRY = (
        "#application-form .field-wrapper, "
        "#application-form fieldset.phone-input, "
        "#application_form .field"
    )
    SUBMIT = (
        "#application-form button[type=submit], "
        "#application_form button[type=submit], "
        "#application_form input[type=submit]"
    )
    SUCCESS = (
        ".application--confirmation, .application-confirmation, "
        "#application_confirmation, [data-testid=application-confirmation]"
    )

    _CORE_CONTROLS = {
        "first_name": (("first_name",),),
        "last_name": (("last_name",),),
        "preferred_name": (("preferred_name",),),
        "email": (("contacts", "email"), ("email",)),
        # A telephone country, nationality, and current residence are not
        # interchangeable.  Country therefore needs an exact saved answer.
        "country": (),
        "phone": (("contacts", "phone"),),
        "location": (("location",),),
    }
    _CORE_LABELS = {
        "linkedin": (("contacts", "linkedin"),),
        "linkedin profile": (("contacts", "linkedin"),),
        "website": (("contacts", "website"),),
        "website portfolio": (("contacts", "website"),),
        "portfolio": (("contacts", "website"),),
        "location city": (("location",),),
        "current location": (("location",),),
    }
    _SEMANTIC_ANSWER_KEYS = AshbyRecipe._SEMANTIC_ANSWER_KEYS

    def __init__(self, profile: Mapping[str, Any], cv_path: Path):
        self.profile = profile
        self.cv_path = cv_path
        self.answers = AshbyRecipe._answer_index(profile.get("application_answers"))

    @staticmethod
    def _profile_value(profile: Mapping[str, Any], path: tuple[str, ...]) -> str | None:
        return AshbyRecipe._profile_value(profile, path)

    @staticmethod
    def _entries(page):
        return page.locator(GreenhouseRecipe.FIELD_ENTRY)

    @staticmethod
    def _label(entry) -> str:
        legend = entry.locator("legend")
        if legend.count():
            return legend.first.inner_text().replace("\u00a0", " ").strip()
        controls = entry.locator(
            "input:not([type=hidden]):not([aria-hidden=true]), textarea, select"
        )
        for index in range(controls.count()):
            control = controls.nth(index)
            label = control.get_attribute("aria-label")
            if label:
                return label.replace("\u00a0", " ").strip()
            labelled_by = control.get_attribute("aria-labelledby")
            if labelled_by:
                labelled = entry.locator(f"#{labelled_by}")
                if labelled.count():
                    return labelled.first.inner_text().replace("\u00a0", " ").strip()
            control_id = control.get_attribute("id")
            if control_id:
                associated = entry.locator(f"label[for='{control_id}']")
                if associated.count():
                    return associated.first.inner_text().replace("\u00a0", " ").strip()
        label = entry.locator("label")
        return label.first.inner_text().replace("\u00a0", " ").strip() if label.count() else ""

    @staticmethod
    def _field_key(entry) -> str:
        fieldset = entry.locator("fieldset[id]")
        if fieldset.count():
            return (fieldset.first.get_attribute("id") or "").removesuffix("[]")
        controls = entry.locator(
            "input:not([type=hidden]):not([aria-hidden=true]), textarea, select"
        )
        if not controls.count():
            return ""
        control = controls.first
        return (
            control.get_attribute("name")
            or control.get_attribute("id")
            or ""
        ).removesuffix("[]")

    @staticmethod
    def _required(entry) -> bool:
        if (
            entry.get_attribute("aria-required") == "true"
            or entry.locator("[aria-required=true], input[required], textarea[required], select[required]").count()
            or entry.locator(".required, .asterisk, .field-required").count()
        ):
            return True
        labels = entry.locator("legend, label")
        return any(
            labels.nth(index).inner_text().replace("\u00a0", " ").strip().endswith("*")
            for index in range(labels.count())
        )

    @staticmethod
    def _is_answered(entry) -> bool:
        if entry.locator("input[type=radio]:checked, input[type=checkbox]:checked").count():
            return True
        if entry.locator(".select__single-value, .select__multi-value__label").count():
            return True
        if entry.locator(".file-upload__filename").count():
            return True
        controls = entry.locator(
            "input:not([type=hidden]):not([aria-hidden=true]), textarea, select"
        )
        for index in range(controls.count()):
            control = controls.nth(index)
            control_type = (control.get_attribute("type") or "").casefold()
            if control_type in {"radio", "checkbox"}:
                continue
            if control_type == "file":
                if control.evaluate("element => element.files.length") > 0:
                    return True
            elif control_type != "search" and control.input_value().strip():
                return True
        return False

    def _answer_for(self, label: str, field_key: str) -> tuple[bool, Any]:
        keys = [_normalise_label(field_key), _normalise_label(label)]
        for pattern, semantic in self._SEMANTIC_ANSWER_KEYS:
            if pattern.search(label):
                keys.append(_normalise_label(semantic))
        for key in keys:
            if key in self.answers:
                return True, self.answers[key]
        return False, None

    def _core_value(
        self, control_id: str, label: str, paths: tuple[tuple[str, ...], ...]
    ) -> tuple[bool, Any]:
        present, answer = self._answer_for(label, control_id)
        if present:
            return True, answer
        for path in paths:
            value = self._profile_value(self.profile, path)
            if value is not None:
                return True, value
        return False, None

    @staticmethod
    def _control_label(scope, control) -> str:
        label = control.get_attribute("aria-label")
        if label:
            return label.strip()
        labelled_by = control.get_attribute("aria-labelledby")
        if labelled_by:
            labelled = scope.locator(f"#{labelled_by}")
            if labelled.count():
                return labelled.first.inner_text().replace("\u00a0", " ").strip()
        control_id = control.get_attribute("id") or ""
        associated = scope.locator(f"label[for='{control_id}']") if control_id else None
        if associated is not None and associated.count():
            return associated.first.inner_text().replace("\u00a0", " ").strip()
        return control_id

    @staticmethod
    def _control_required(control) -> bool:
        if (
            control.get_attribute("aria-required") == "true"
            or control.get_attribute("required") is not None
        ):
            return True
        entry = control.locator(
            "xpath=ancestor::*[contains(@class, 'field-wrapper') or "
            "contains(concat(' ', normalize-space(@class), ' '), ' field ') or self::fieldset][1]"
        )
        return bool(entry.count() and GreenhouseRecipe._required(entry.first))

    @staticmethod
    def _fill_scalar(control, label: str, answer: Any, step: str) -> None:
        if not isinstance(answer, (str, int, float)) or isinstance(answer, bool):
            raise BlockedHuman(
                "answer_type_unknown",
                f"Greenhouse text field has no explicit scalar answer: {_safe_label(label)}",
                step,
            )
        rendered = str(answer).strip()
        if not rendered:
            raise BlockedHuman(
                "required_answer_missing",
                f"Saved answer is empty for: {_safe_label(label)}",
                step,
            )
        control.fill(rendered)
        if control.input_value().strip() != rendered:
            raise BlockedHuman(
                "answer_not_accepted",
                f"Greenhouse did not retain the answer for: {_safe_label(label)}",
                step,
            )

    def open_form(self, page) -> None:
        forms = page.locator(self.FORM)
        if forms.count() == 1:
            return
        if forms.count() > 1:
            raise BlockedHuman(
                "greenhouse_form_ambiguous",
                "More than one Greenhouse application form was found",
                "detect",
            )
        candidates = []
        pattern = re.compile(r"^(apply|apply for this job|click to apply|submit an application)$", re.I)
        for role in ("button", "link"):
            matches = page.get_by_role(role, name=pattern)
            for index in range(matches.count()):
                if matches.nth(index).is_visible():
                    candidates.append(matches.nth(index))
        if len(candidates) != 1:
            raise BlockedHuman(
                "greenhouse_form_missing",
                "Greenhouse application form or a single Apply control was not found",
                "detect",
            )
        candidates[0].click()
        try:
            page.locator(self.FORM).first.wait_for(state="attached", timeout=10_000)
        except Exception as exc:
            raise BlockedHuman(
                "greenhouse_form_missing",
                "Greenhouse Apply control did not open an application form",
                "detect",
            ) from exc

    def fill_core(self, page) -> None:
        form = page.locator(self.FORM)
        if form.count() != 1:
            raise BlockedHuman(
                "greenhouse_form_ambiguous",
                "Greenhouse application form is missing or ambiguous",
                "fill",
            )
        scope = form.first
        for control_id, paths in self._CORE_CONTROLS.items():
            matches = scope.locator(f"#{control_id}")
            if not matches.count():
                continue
            if matches.count() != 1:
                raise BlockedHuman(
                    "unknown_required_control",
                    f"Greenhouse core field is ambiguous: {_safe_label(control_id)}",
                    "fill",
                )
            control = matches.first
            label = self._control_label(scope, control)
            present, value = self._core_value(control_id, label, paths)
            required = self._control_required(control)
            if not present:
                if required:
                    raise BlockedHuman(
                        "required_profile_field_missing",
                        f"Required Greenhouse field needs profile data: {_safe_label(label)}",
                        "fill",
                    )
                continue
            if control.get_attribute("role") == "combobox":
                self._fill_answer(page, control.locator("xpath=ancestor::*[contains(@class, 'field-wrapper') or self::fieldset][1]"), label, value)
            else:
                self._fill_scalar(control, label, value, "fill")

        entries = self._entries(page)
        for index in range(entries.count()):
            entry = entries.nth(index)
            label = self._label(entry)
            paths = self._CORE_LABELS.get(_normalise_label(label))
            if not paths or self._is_answered(entry):
                continue
            present, value = self._core_value(self._field_key(entry), label, paths)
            if present:
                self._fill_answer(page, entry, label, value)
            elif self._required(entry):
                raise BlockedHuman(
                    "required_profile_field_missing",
                    f"Required Greenhouse field needs profile data: {_safe_label(label)}",
                    "fill",
                )

    def upload_cv(self, page) -> None:
        if not self.cv_path.is_file() or self.cv_path.stat().st_size <= 0:
            raise BlockedHuman("cv_missing", "The selected CV file is missing or empty", "upload_cv")
        form = page.locator(self.FORM)
        resume = form.locator("#resume, input[name='resume'], input[name='job_application[resume]']")
        if resume.count() != 1 or (resume.first.get_attribute("type") or "").casefold() != "file":
            raise BlockedHuman(
                "resume_field_missing",
                "Greenhouse resume upload field was not found unambiguously",
                "upload_cv",
            )
        resume.first.set_input_files(str(self.cv_path))
        page.wait_for_timeout(100)
        # Current Greenhouse replaces the file input with an exact filename
        # and a Remove file button after accepting the upload.  Older forms
        # retain the input.  Verify either observable effect; the vanished
        # input by itself is not proof of acceptance.
        retained = form.locator(
            "#resume, input[name='resume'], input[name='job_application[resume]']"
        )
        upload_scope = None
        if retained.count() == 1:
            if retained.first.evaluate("element => element.files.length") != 1:
                raise BlockedHuman(
                    "upload_rejected",
                    "Greenhouse did not retain the selected CV",
                    "upload_cv",
                )
            upload_scope = retained.first.locator(
                "xpath=ancestor::*[contains(@class, 'field-wrapper') or contains(@class, 'field')][1]"
            )
        else:
            filename = form.get_by_text(self.cv_path.name, exact=True)
            try:
                filename.first.wait_for(state="visible", timeout=5_000)
            except Exception as exc:
                raise BlockedHuman(
                    "upload_rejected",
                    "Greenhouse did not show the selected CV filename",
                    "upload_cv",
                ) from exc
            if filename.count() != 1:
                raise BlockedHuman(
                    "upload_rejected",
                    "Greenhouse did not show the selected CV filename",
                    "upload_cv",
                )
            upload_scope = filename.first.locator(
                "xpath=ancestor::*[contains(@class, 'field-wrapper') or contains(@class, 'field')][1]"
            )
            if not upload_scope.count() or "resume" not in _normalise_label(
                upload_scope.first.inner_text()
            ):
                raise BlockedHuman(
                    "upload_rejected",
                    "Greenhouse showed the filename outside the resume field",
                    "upload_cv",
                )
        if upload_scope.count() and self._visible_error_text(upload_scope.first):
            raise BlockedHuman("upload_rejected", "Greenhouse reported a CV upload error", "upload_cv")

    @staticmethod
    def _answer_request(page, entry, label: str) -> dict[str, Any] | None:
        exact_label = _exact_form_text(label)
        key = _normalise_label(exact_label)
        if not exact_label or not key:
            return None
        radios = entry.locator("input[type=radio]")
        if radios.count():
            options = _control_option_labels(radios)
            if not options:
                return None
            return {"key": key, "label": exact_label, "field_type": "radio", "options": options}
        checkboxes = entry.locator("input[type=checkbox]")
        if checkboxes.count():
            if checkboxes.count() == 1:
                return {
                    "key": key,
                    "label": exact_label,
                    "field_type": "checkbox",
                    "options": ["Yes", "No"],
                }
            options = _control_option_labels(checkboxes)
            if not options:
                return None
            return {"key": key, "label": exact_label, "field_type": "checkboxes", "options": options}
        select = entry.locator("select")
        if select.count() == 1:
            options: list[str] = []
            choices = select.first.locator("option")
            for index in range(choices.count()):
                choice = choices.nth(index)
                text = _exact_form_text(choice.inner_text(), maximum=500)
                value = choice.get_attribute("value")
                if text and value not in {None, ""} and text not in options:
                    options.append(text)
            if not options:
                return None
            return {"key": key, "label": exact_label, "field_type": "select", "options": options}
        combo = entry.locator("[role=combobox]")
        if combo.count() == 1:
            combo.first.click()
            options = []
            visible = page.locator("[role=option]")
            for index in range(visible.count()):
                option = visible.nth(index)
                if option.is_visible():
                    text = _exact_form_text(option.inner_text(), maximum=500)
                    if text and text not in options:
                        options.append(text)
            if not options:
                return None
            return {"key": key, "label": exact_label, "field_type": "select", "options": options}
        if entry.locator("textarea").count() == 1:
            return {"key": key, "label": exact_label, "field_type": "textarea", "options": []}
        inputs = entry.locator(
            "input:not([type=hidden]):not([aria-hidden=true]):not([type=file])"
        )
        if inputs.count() == 1:
            input_type = (inputs.first.get_attribute("type") or "text").casefold()
            if input_type in {"text", "email", "tel", "url", "number", "date"}:
                return {"key": key, "label": exact_label, "field_type": input_type, "options": []}
        return None

    def fill_screening(self, page) -> None:
        challenge = self._challenge_reason(page)
        if challenge:
            raise BlockedHuman(
                challenge,
                f"Greenhouse requires human intervention ({challenge})",
                "screening",
            )
        entries = self._entries(page)
        core_ids = tuple(self._CORE_CONTROLS) + ("resume",)
        for index in range(entries.count()):
            entry = entries.nth(index)
            if any(entry.locator(f"#{control_id}").count() for control_id in core_ids):
                continue
            label = self._label(entry)
            if _normalise_label(label) in self._CORE_LABELS or self._is_answered(entry):
                continue
            field_key = self._field_key(entry)
            present, answer = self._answer_for(label, field_key)
            if not present:
                if self._required(entry):
                    request = self._answer_request(page, entry, label)
                    if request is None:
                        raise BlockedHuman(
                            "unknown_required_control",
                            f"Greenhouse required question cannot be represented exactly: {_safe_label(label)}",
                            "screening",
                        )
                    raise BlockedHuman(
                        "required_answer_missing",
                        f"Required Greenhouse question needs an answer: {_safe_label(label)}",
                        "screening",
                        answer_request=request,
                    )
                continue
            self._fill_answer(page, entry, label, answer)
            if not self._is_answered(entry):
                raise BlockedHuman(
                    "answer_not_accepted",
                    f"Greenhouse did not retain the answer for: {_safe_label(label)}",
                    "screening",
                )

    def _fill_answer(self, page, entry, label: str, answer: Any) -> None:
        if not entry.count():
            raise BlockedHuman(
                "unknown_required_control",
                f"Greenhouse field has no recognised container: {_safe_label(label)}",
                "screening",
            )
        radios = entry.locator("input[type=radio]")
        if radios.count():
            wanted = _normalise_label(str(answer))
            matches = []
            for index in range(radios.count()):
                radio = radios.nth(index)
                labels = radio.evaluate(
                    "element => Array.from(element.labels || []).map(label => label.innerText)"
                )
                if any(_normalise_label(str(value)) == wanted for value in labels):
                    matches.append(radio)
            if len(matches) != 1:
                raise BlockedHuman(
                    "answer_option_unknown",
                    f"No single Greenhouse option matches the saved answer for: {_safe_label(label)}",
                    "screening",
                )
            matches[0].check()
            return

        checkboxes = entry.locator("input[type=checkbox]")
        if checkboxes.count():
            if checkboxes.count() == 1 and isinstance(answer, bool):
                checkboxes.first.set_checked(answer)
                return
            values = answer if isinstance(answer, list) else [answer]
            if not values or any(not isinstance(value, (str, int, float)) or isinstance(value, bool) for value in values):
                raise BlockedHuman(
                    "answer_type_unknown",
                    f"Greenhouse checkbox question needs explicit option labels: {_safe_label(label)}",
                    "screening",
                )
            wanted = {_normalise_label(str(value)) for value in values}
            matched: dict[str, Any] = {}
            for index in range(checkboxes.count()):
                checkbox = checkboxes.nth(index)
                labels = checkbox.evaluate(
                    "element => Array.from(element.labels || []).map(label => label.innerText)"
                )
                for option_label in labels:
                    normalised = _normalise_label(str(option_label))
                    if normalised in wanted:
                        matched[normalised] = checkbox
            if set(matched) != wanted:
                raise BlockedHuman(
                    "answer_option_unknown",
                    f"Greenhouse checkbox options do not exactly match the saved answer for: {_safe_label(label)}",
                    "screening",
                )
            for checkbox in matched.values():
                checkbox.check()
            return

        select = entry.locator("select")
        if select.count() == 1:
            try:
                select.first.select_option(label=str(answer))
            except Exception as exc:
                raise BlockedHuman(
                    "answer_option_unknown",
                    f"Greenhouse select has no option matching the saved answer for: {_safe_label(label)}",
                    "screening",
                ) from exc
            return

        comboboxes = entry.locator("input[role=combobox]")
        if comboboxes.count() == 1:
            values = answer if isinstance(answer, list) else [answer]
            if not values or any(not isinstance(value, (str, int, float)) or isinstance(value, bool) for value in values):
                raise BlockedHuman(
                    "answer_type_unknown",
                    f"Greenhouse select needs explicit option labels: {_safe_label(label)}",
                    "screening",
                )
            for value in values:
                comboboxes.first.click()
                option = page.get_by_role("option", name=str(value), exact=True)
                try:
                    option.first.wait_for(state="visible", timeout=3_000)
                except Exception as exc:
                    raise BlockedHuman(
                        "answer_option_unknown",
                        f"Greenhouse select has no option matching the saved answer for: {_safe_label(label)}",
                        "screening",
                    ) from exc
                if option.count() != 1:
                    raise BlockedHuman(
                        "answer_option_unknown",
                        f"Greenhouse select option is ambiguous for: {_safe_label(label)}",
                        "screening",
                    )
                option.first.click()
            selected = entry.locator(".select__single-value, .select__multi-value__label")
            observed = {_normalise_label(selected.nth(i).inner_text()) for i in range(selected.count())}
            wanted = {_normalise_label(str(value)) for value in values}
            if not wanted.issubset(observed):
                raise BlockedHuman(
                    "answer_not_accepted",
                    f"Greenhouse did not retain the selected answer for: {_safe_label(label)}",
                    "screening",
                )
            return

        text = entry.locator(
            "textarea, input:not([type=hidden]):not([type=file]):not([type=radio]):not([type=checkbox]):not([role=combobox])"
        )
        if text.count() == 1:
            self._fill_scalar(text.first, label, answer, "screening")
            return
        raise BlockedHuman(
            "unknown_required_control",
            f"Greenhouse field type is not supported safely: {_safe_label(label)}",
            "screening",
        )

    @staticmethod
    def _visible_error_text(scope) -> str:
        selectors = (
            "[role=alert]",
            ".field-error",
            ".error-message",
            "[id$='-error']",
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
        common = AshbyRecipe._challenge_reason(page)
        if common:
            return common
        selectors = (
            "#security_code",
            "input[name='security_code']",
            "input[name*='captcha' i]",
        )
        for selector in selectors:
            matches = page.locator(selector)
            for index in range(matches.count()):
                if matches.nth(index).is_visible():
                    return "captcha"
        body = page.locator("body")
        text = body.inner_text().casefold() if body.count() else ""
        if "verification code" in text and "not a robot" in text:
            return "captcha"
        if "flagged as potential bot traffic" in text:
            return "captcha"
        return ""

    def review(self, page) -> None:
        challenge = self._challenge_reason(page)
        if challenge:
            raise BlockedHuman(
                challenge,
                f"Greenhouse requires human intervention ({challenge})",
                "review",
            )
        if self._visible_error_text(page):
            raise BlockedHuman("form_error", "Greenhouse reports a form validation error", "review")

        entries = self._entries(page)
        for index in range(entries.count()):
            entry = entries.nth(index)
            if not self._required(entry):
                continue
            label = self._label(entry)
            if not self._is_answered(entry):
                raise BlockedHuman(
                    "required_field_unanswered",
                    f"Required Greenhouse field remains unanswered: {_safe_label(label)}",
                    "review",
                )
            controls = entry.locator(
                "input:not([type=hidden]):not([aria-hidden=true]), textarea, select"
            )
            for control_index in range(controls.count()):
                control = controls.nth(control_index)
                control_type = (control.get_attribute("type") or "").casefold()
                if control_type not in {"radio", "checkbox", "file"} and not control.evaluate(
                    "element => element.checkValidity()"
                ):
                    raise BlockedHuman(
                        "field_invalid",
                        f"Greenhouse rejected the format of: {_safe_label(label)}",
                        "review",
                    )

        submit = page.locator(self.SUBMIT)
        if submit.count() != 1 or not submit.first.is_visible() or not submit.first.is_enabled():
            raise BlockedHuman(
                "submit_unavailable",
                "Greenhouse submit button is missing, ambiguous, or disabled",
                "review",
            )

    def submit(self, page) -> None:
        # ApplicationFlow has already persisted submit_started and repeated
        # the authorisation gate before this irreversible click.
        page.locator(self.SUBMIT).click(timeout=10_000)


class ApplicationFlow:
    def __init__(
        self,
        *,
        position_id: int,
        url: str,
        profile: Mapping[str, Any],
        cv_path: str | Path,
        profile_path: str | Path | None = None,
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
        self.profile = dict(profile)
        self.profile_path = Path(profile_path) if profile_path else None
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
        if blocked.answer_request:
            request = blocked.answer_request
            options = request.get("options") or []
            rendered_options = "\n".join(f"- {value}" for value in options)
            options_text = f"\nOptions:\n{rendered_options}" if rendered_options else ""
            return (
                "CLOSER needs one required application answer before it can continue.\n"
                f"Question: {request['label']}\n"
                f"Field type: {request['field_type']}"
                f"{options_text}\n"
                "Reply to this request in the dashboard. The answer is saved under the "
                "question's exact normalized key and reused only for an identical key."
            )
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

    def _answer_request_record(self, blocked: BlockedHuman) -> dict[str, Any]:
        payload = {
            "version": 1,
            "position_id": self.position_id,
            "key": str(blocked.answer_request["key"]),
            "label": str(blocked.answer_request["label"]),
            "field_type": str(blocked.answer_request["field_type"]),
            "options": list(blocked.answer_request.get("options") or []),
        }
        identity = hashlib.sha256(
            f"{self.position_id}\0{self.url}\0{payload['key']}".encode("utf-8")
        ).hexdigest()[:24]
        return {
            "source_id": f"closer-answer:{self.position_id}:{identity}",
            "message_id": "",
            "notification_attempted": False,
            "payload": payload,
        }

    def _persist_answer_request(self, checkpoint: FlowCheckpoint, message: str) -> None:
        request = checkpoint.answer_request
        if not request:
            raise FlowError("answer request checkpoint is missing")
        payload_text = json.dumps(request["payload"], ensure_ascii=False, sort_keys=True)
        db = _resolve_db_path(self.db_path)
        with sqlite3.connect(db) as conn:
            conn.execute(
                "INSERT OR IGNORE INTO pending_user_messages ("
                "agent, body, kind, related_position_id, source_id, source_action, "
                "source_payload, delivered_via, delivered_at) "
                "VALUES ('closer', ?, 'question', ?, ?, 'closer_application_answer', "
                "?, 'web', CURRENT_TIMESTAMP)",
                (message, self.position_id, request["source_id"], payload_text),
            )
            row = conn.execute(
                "SELECT id, agent, body, kind, related_position_id, source_action, source_payload "
                "FROM pending_user_messages WHERE source_id = ?",
                (request["source_id"],),
            ).fetchone()
            conn.commit()
        expected = (
            "closer",
            message,
            "question",
            self.position_id,
            "closer_application_answer",
            payload_text,
        )
        if not row or row[1:] != expected:
            raise FlowError("durable answer request could not be verified")
        request["message_id"] = str(row[0])
        checkpoint.save(self.checkpoint_path)

    def _notify_answer_request_once(
        self, checkpoint: FlowCheckpoint, message: str
    ) -> None:
        request = checkpoint.answer_request
        if not request or request.get("notification_attempted"):
            return
        # At-most-once external notification: persist the marker before the
        # optional channel call. The dashboard row above is the durable ask.
        request["notification_attempted"] = True
        checkpoint.save(self.checkpoint_path)
        self.notifier(
            position_id=self.position_id,
            message=message,
            answer_request=request,
        )

    def _block(self, checkpoint: FlowCheckpoint, blocked: BlockedHuman) -> FlowResult:
        checkpoint.state = "blocked_human"
        checkpoint.resume_state = blocked.step
        checkpoint.blocked_reason = blocked.reason
        checkpoint.blocked_detail = blocked.detail
        message = self._notification_message(blocked)
        if blocked.answer_request:
            candidate = self._answer_request_record(blocked)
            current = checkpoint.answer_request
            if not current or current.get("source_id") != candidate["source_id"]:
                checkpoint.answer_request = candidate
        checkpoint.save(self.checkpoint_path)
        if blocked.answer_request:
            persisted = False
            try:
                # The request itself does not depend on Telegram or on the
                # notifier executable: it is committed and reread first.
                self._persist_answer_request(checkpoint, message)
                persisted = True
            except Exception as exc:
                LOG.error("durable answer request failed: %s", type(exc).__name__)
            try:
                if persisted:
                    self._notify_answer_request_once(checkpoint, message)
                else:
                    # Compatibility for injected notifiers in callers without
                    # a configured jobs.db. Production still fails closed and
                    # cannot claim the dashboard request exists.
                    self.notifier(
                        position_id=self.position_id,
                        message=message,
                        answer_request=checkpoint.answer_request,
                    )
            except Exception as exc:
                LOG.error("blocked_human notification failed: %s", type(exc).__name__)
        else:
            try:
                self.notifier(position_id=self.position_id, message=message)
            except Exception as exc:
                LOG.error("blocked_human notification failed: %s", type(exc).__name__)
        return FlowResult("blocked_human", checkpoint.state, blocked.reason)

    def _deny(self, checkpoint: FlowCheckpoint, verdict: Any) -> FlowResult:
        checkpoint.state = "denied"
        checkpoint.blocked_reason = str(getattr(verdict, "reason", "gate_denied"))
        checkpoint.blocked_detail = str(getattr(verdict, "detail", "authorisation denied"))
        checkpoint.save(self.checkpoint_path)
        return FlowResult("denied", checkpoint.state, checkpoint.blocked_reason)

    def _recipe(self, platform: str):
        recipes = {
            "ashby": AshbyRecipe,
            "greenhouse": GreenhouseRecipe,
        }
        recipe = recipes.get(platform)
        if recipe is None:
            raise BlockedHuman(
                "ats_unsupported",
                "Application platform is unknown, conflicting, or has no safe recipe",
                "detect",
            )
        return recipe(self.profile, self.cv_path)

    @staticmethod
    def _greenhouse_page_url_trusted(url: str) -> bool:
        try:
            parsed = urllib.parse.urlsplit(url)
            port = parsed.port
        except ValueError:
            return False
        return bool(
            parsed.scheme == "https"
            and (parsed.hostname or "").casefold() in GREENHOUSE_HOSTS
            and port in {None, 443}
        )

    @staticmethod
    def _assert_recipe_page(
        page, platform: str, step: str, *, allow_injected_blank: bool = False
    ) -> None:
        if platform != "greenhouse":
            return
        if allow_injected_blank and page.url == "about:blank":
            return
        if not ApplicationFlow._greenhouse_page_url_trusted(page.url):
            raise BlockedHuman(
                "greenhouse_redirect_untrusted",
                "Greenhouse redirected outside its three trusted public hosts",
                step,
            )

    @staticmethod
    def _same_confirmation_origin(
        application_url: str, confirmation_url: str, platform: str
    ) -> bool:
        try:
            original = urllib.parse.urlsplit(application_url)
            final = urllib.parse.urlsplit(confirmation_url)
            original_port = original.port
            final_port = final.port
        except ValueError:
            return False
        if original.scheme not in {"http", "https"} or final.scheme != "https":
            return False
        default_ports = {"http": 80, "https": 443}
        if (
            original_port not in {None, default_ports[original.scheme]}
            or final_port not in {None, default_ports[final.scheme]}
        ):
            return False
        original_host = (original.hostname or "").casefold()
        final_host = (final.hostname or "").casefold()
        if platform == "greenhouse":
            # boards.greenhouse.io currently redirects to job-boards.*.  All
            # three exact hosts are one trusted public ATS boundary; no other
            # greenhouse-looking suffix is accepted.
            return original_host in GREENHOUSE_HOSTS and final_host in GREENHOUSE_HOSTS
        return bool(original_host and final_host == original_host)

    @staticmethod
    def _confirmation(
        page,
        application_url: str,
        platform: str | None = None,
        *,
        pre_submit: bool = False,
    ) -> tuple[str, str] | None:
        platform = platform or detect_ats(application_url).platform
        recipe = {
            "ashby": AshbyRecipe,
            "greenhouse": GreenhouseRecipe,
        }.get(platform)
        if recipe is None:
            return None
        success = page.locator(recipe.SUCCESS)
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
        submit_present = page.locator(recipe.SUBMIT).count() > 0
        for marker in markers:
            offset = lower.find(marker)
            # Before a click this evidence deliberately triggers the
            # confirmation_ambiguous guard.  During crash recovery, employer
            # copy on a reloaded form cannot prove an earlier submission.
            if offset >= 0 and (pre_submit or not submit_present):
                return "", visible[offset : offset + 1000]

        final_url = page.url
        # A changed URL is evidence only when it is an HTTP(S) confirmation
        # URL inside the recipe's trusted origin boundary.  A fresh browser
        # starts at about:blank; accepting any different URL plus an absent
        # form turned a blank page into a valid receipt during crash recovery.
        try:
            final = urllib.parse.urlsplit(final_url)
        except ValueError:
            final = urllib.parse.SplitResult("", "", "", "", "")
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
            ApplicationFlow._same_confirmation_origin(
                application_url, final_url, platform
            )
            and final_url != application_url
            and any(marker in final_route for marker in confirmation_url_markers)
            and page.locator(recipe.SUBMIT).count() == 0
        ):
            return final_url, ""
        return None

    def _wait_for_confirmation(self, page, platform: str) -> tuple[str, str] | None:
        recipe = {
            "ashby": AshbyRecipe,
            "greenhouse": GreenhouseRecipe,
        }[platform]
        deadline = time.monotonic() + self.confirmation_timeout_ms / 1000
        while True:
            found = self._confirmation(page, self.url, platform)
            if found:
                return found
            challenge = recipe._challenge_reason(page)
            if challenge:
                raise BlockedHuman(
                    challenge,
                    f"{platform.title()} requires human intervention after submit ({challenge})",
                    "submit",
                )
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

    @staticmethod
    def _decode_answer_reply(request: Mapping[str, Any], reply: str) -> Any:
        payload = request.get("payload")
        if not isinstance(payload, Mapping):
            raise FlowError("answer request payload is missing")
        field_type = payload.get("field_type")
        options = payload.get("options")
        if not isinstance(options, list) or any(not isinstance(v, str) for v in options):
            raise FlowError("answer request options are invalid")
        exact = reply.strip()
        if not exact:
            raise FlowError("dashboard answer is empty")
        if field_type in {"radio", "select"}:
            if exact not in options:
                raise FlowError("dashboard answer is not an exact offered option")
            return exact
        if field_type == "checkbox":
            if exact == "Yes":
                return True
            if exact == "No":
                return False
            raise FlowError("dashboard answer is not an exact boolean option")
        if field_type == "checkboxes":
            try:
                selected = json.loads(exact)
            except (TypeError, ValueError) as exc:
                raise FlowError("dashboard checkbox answer is not a JSON list") from exc
            if (
                not isinstance(selected, list)
                or not selected
                or any(not isinstance(value, str) or value not in options for value in selected)
                or len(set(selected)) != len(selected)
            ):
                raise FlowError("dashboard checkbox answer has unknown or duplicate options")
            return selected
        if field_type in {"textarea", "text", "email", "tel", "url", "number", "date"}:
            return exact
        raise FlowError("answer request field type is unsupported")

    def _save_application_answer(self, key: str, answer: Any) -> None:
        if self.profile_path is None or not self.profile_path.is_file():
            raise FlowError("candidate profile path is unavailable")
        try:
            import yaml
        except ImportError as exc:
            raise FlowError("pyyaml is not installed") from exc
        lock_path = self.profile_path.with_name(f".{self.profile_path.name}.lock")
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        with lock_path.open("a+", encoding="utf-8") as lock:
            with contextlib.suppress(OSError):
                os.chmod(lock_path, 0o600)
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
            current = _load_profile(self.profile_path)
            saved = current.get("application_answers")
            answers: dict[str, Any] = {}
            if isinstance(saved, Mapping):
                answers.update(saved)
            elif isinstance(saved, list):
                for item in saved:
                    if isinstance(item, Mapping) and item.get("question"):
                        answers[_normalise_label(str(item["question"]))] = item.get("answer")
            for existing in list(answers):
                if _normalise_label(str(existing)) == key:
                    del answers[existing]
            answers[key] = answer
            updated = dict(current)
            updated["application_answers"] = answers
            temporary = ""
            handle = None
            try:
                handle = tempfile.NamedTemporaryFile(
                    mode="w",
                    encoding="utf-8",
                    dir=self.profile_path.parent,
                    prefix=f".{self.profile_path.name}.",
                    delete=False,
                )
                temporary = handle.name
                yaml.safe_dump(updated, handle, allow_unicode=True, sort_keys=False)
                handle.flush()
                os.fsync(handle.fileno())
                handle.close()
                os.chmod(temporary, 0o600)
                os.replace(temporary, self.profile_path)
            except Exception:
                if handle and not handle.closed:
                    handle.close()
                if temporary:
                    with contextlib.suppress(OSError):
                        os.unlink(temporary)
                raise
        observed = _load_profile(self.profile_path)
        indexed = AshbyRecipe._answer_index(observed.get("application_answers"))
        if key not in indexed or indexed[key] != answer:
            raise FlowError("candidate profile write could not be verified")
        self.profile = dict(observed)

    def _resume_dashboard_answer(
        self, checkpoint: FlowCheckpoint
    ) -> FlowResult | None:
        request = checkpoint.answer_request
        if not request:
            return None
        try:
            message = self._notification_message(
                BlockedHuman(
                    "required_answer_missing",
                    checkpoint.blocked_detail,
                    checkpoint.resume_state or "screening",
                    answer_request=request.get("payload"),
                )
            )
            self._persist_answer_request(checkpoint, message)
            message_id = int(str(request.get("message_id", "")))
            db = _resolve_db_path(self.db_path)
            with sqlite3.connect(db) as conn:
                row = conn.execute(
                    "SELECT user_reply, user_reply_at FROM pending_user_messages "
                    "WHERE id = ? AND agent = 'closer' AND related_position_id = ? "
                    "AND source_id = ? AND source_action = 'closer_application_answer'",
                    (message_id, self.position_id, request.get("source_id")),
                ).fetchone()
            if not row or row[0] is None or row[1] is None:
                return FlowResult("blocked_human", checkpoint.state, checkpoint.blocked_reason)
            answer = self._decode_answer_reply(request, str(row[0]))
            payload = request.get("payload")
            key = str(payload.get("key", "")) if isinstance(payload, Mapping) else ""
            if not key or key != _normalise_label(key):
                raise FlowError("answer request key is not canonical")
            self._save_application_answer(key, answer)
            with sqlite3.connect(db) as conn:
                changed = conn.execute(
                    "UPDATE pending_user_messages SET agent_seen_reply_at = CURRENT_TIMESTAMP "
                    "WHERE id = ? AND user_reply_at IS NOT NULL AND agent_seen_reply_at IS NULL",
                    (message_id,),
                ).rowcount
                conn.commit()
                seen = conn.execute(
                    "SELECT agent_seen_reply_at FROM pending_user_messages WHERE id = ?",
                    (message_id,),
                ).fetchone()
            if changed not in {0, 1} or not seen or not seen[0]:
                raise FlowError("dashboard answer acknowledgement could not be verified")
        except Exception as exc:
            return self._block(
                checkpoint,
                BlockedHuman(
                    "required_answer_missing",
                    f"The dashboard answer could not be persisted safely ({type(exc).__name__})",
                    checkpoint.resume_state or "screening",
                ),
            )
        checkpoint.answer_request = None
        checkpoint.state = checkpoint.resume_state or "screening"
        checkpoint.blocked_reason = ""
        checkpoint.blocked_detail = ""
        checkpoint.resume_state = ""
        checkpoint.save(self.checkpoint_path)
        return None

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

        waiting = self._resume_dashboard_answer(checkpoint)
        if waiting is not None:
            return waiting

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
                    recovery_platform = checkpoint.platform or detect_ats(self.url).platform
                    if recovery_platform not in SUPPORTED_PLATFORMS:
                        raise BlockedHuman(
                            "ats_unsupported",
                            "Saved submission has no safe recovery recipe",
                            "submit",
                        )
                    confirmation = self._confirmation(
                        active_page, self.url, recovery_platform
                    )
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

            try:
                if navigate:
                    self._navigate(active_page)
                detection = detect_ats(self.url, active_page.content())
                if detection.platform not in SUPPORTED_PLATFORMS:
                    reason = "ats_conflict" if detection.conflict else "ats_unsupported"
                    raise BlockedHuman(
                        reason,
                        "Application platform is unknown, conflicting, or has no safe recipe",
                        "detect",
                    )
                checkpoint.platform = detection.platform
                recipe = self._recipe(detection.platform)
                injected_blank = not navigate and active_page.url == "about:blank"
                self._assert_recipe_page(
                    active_page,
                    detection.platform,
                    "detect",
                    allow_injected_blank=injected_blank,
                )
                recipe.open_form(active_page)
                self._assert_recipe_page(
                    active_page,
                    detection.platform,
                    "detect",
                    allow_injected_blank=injected_blank,
                )
                # Confirm the rendered form too.  URL-only detection is not
                # enough to interact when a block/error page owns that URL.
                rendered = detect_ats(self.url, active_page.content())
                if rendered.platform != detection.platform or not rendered.dom_match:
                    raise BlockedHuman(
                        f"{detection.platform}_dom_unrecognised",
                        f"URL is {detection.platform} but the rendered application form is not recognised",
                        "detect",
                    )
                checkpoint.complete_step("detect", "fill")
                checkpoint.save(self.checkpoint_path)

                recipe.fill_core(active_page)
                self._assert_recipe_page(
                    active_page,
                    detection.platform,
                    "fill",
                    allow_injected_blank=injected_blank,
                )
                checkpoint.complete_step("fill", "upload_cv")
                checkpoint.save(self.checkpoint_path)

                recipe.upload_cv(active_page)
                self._assert_recipe_page(
                    active_page,
                    detection.platform,
                    "upload_cv",
                    allow_injected_blank=injected_blank,
                )
                checkpoint.complete_step("upload_cv", "screening")
                checkpoint.save(self.checkpoint_path)

                recipe.fill_screening(active_page)
                self._assert_recipe_page(
                    active_page,
                    detection.platform,
                    "screening",
                    allow_injected_blank=injected_blank,
                )
                checkpoint.complete_step("screening", "review")
                checkpoint.save(self.checkpoint_path)

                recipe.review(active_page)
                self._assert_recipe_page(
                    active_page,
                    detection.platform,
                    "review",
                    allow_injected_blank=injected_blank,
                )
                checkpoint.complete_step("review", "submit")
                checkpoint.save(self.checkpoint_path)

                # Confirmation words already visible before the click cannot
                # prove that this click succeeded.  Stop instead of reusing a
                # footer, stale banner, or employer-authored sentence as a
                # receipt after submit.
                if self._confirmation(
                    active_page,
                    self.url,
                    detection.platform,
                    pre_submit=True,
                ):
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
                confirmation = self._wait_for_confirmation(active_page, detection.platform)
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
    browser_mode = parser.add_mutually_exclusive_group()
    browser_mode.add_argument(
        "--headful", dest="headless", action="store_false", help="Force a visible browser."
    )
    browser_mode.add_argument(
        "--headless", dest="headless", action="store_true", help="Force a hidden browser."
    )
    parser.set_defaults(headless=None)
    args = parser.parse_args(argv)

    try:
        flow = ApplicationFlow(
            position_id=args.position_id,
            url=args.url,
            profile=_load_profile(args.profile),
            profile_path=args.profile,
            cv_path=args.cv,
            checkpoint_path=args.checkpoint,
            receipt_dir=args.receipt_dir,
            db_path=args.db,
            headless=_resolve_headless(args.headless),
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
