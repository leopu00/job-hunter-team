"""Durable checkpoints, receipts and flow outcomes — moved unchanged from apply_flow.py."""
from __future__ import annotations

# Package imports and later recipe imports share one module and exception type.
import sys
if __package__ == "shared.skills":
    sys.modules.setdefault(__name__.rsplit(".", 1)[-1], sys.modules[__name__])

import contextlib
import json
import os
import re
import tempfile
import time
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any, Mapping


try:
    from apply_flow_constants import (
        CHECKPOINT_VERSION, STEP_ORDER, EMAIL_CHANNEL_STATE, CONTACT_FORM_CHANNEL,
        RECEIPT_CHANNELS, _utc_now, page_failure,
    )
    from apply_flow_errors import (
        FlowError,
    )
    from apply_flow_profile import (
        _answer_sources,
    )
except ImportError:  # package-style import outside the CLI
    from shared.skills.apply_flow_constants import (
        CHECKPOINT_VERSION, STEP_ORDER, EMAIL_CHANNEL_STATE, CONTACT_FORM_CHANNEL,
        RECEIPT_CHANNELS, _utc_now, page_failure,
    )
    from shared.skills.apply_flow_errors import (
        FlowError,
    )
    from shared.skills.apply_flow_profile import (
        _answer_sources,
    )


@dataclass(frozen=True)
class Receipt:
    screenshot_path: Path
    confirmation_url: str = ""
    confirmation_text: str = ""
    captured_at: str = field(default_factory=_utc_now)
    # Where each saved answer used in the form came from: key → user / profile /
    # agent_inferred.  Keys and origins only, never a value.
    answer_sources: dict[str, str] = field(default_factory=dict)
    # sha256 of the CV file handed to the form, as the email receipt records
    # its attachment: which document the employer received.
    cv_sha256: str = ""
    # How the application went: an application form (web_form), or a company
    # contact form that takes no file (contact_form, 1800).  `attachments` names
    # every document sent, by role and sha256: empty means no CV went out.
    channel: str = "web_form"
    attachments: list[dict[str, str]] = field(default_factory=list)

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
            "answer_sources": dict(self.answer_sources),
            "cv_sha256": self.cv_sha256,
            "channel": self.channel,
            "attachments": [dict(item) for item in self.attachments],
        }

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> "Receipt":
        sha = str(value.get("cv_sha256", ""))
        sha = sha if re.fullmatch(r"[0-9a-f]{64}", sha) else ""
        channel = value.get("channel")
        channel = channel if channel in RECEIPT_CHANNELS else "web_form"
        raw_attachments = value.get("attachments")
        if isinstance(raw_attachments, list):
            attachments = [
                {"role": str(item["role"]), "sha256": str(item["sha256"])}
                for item in raw_attachments
                if isinstance(item, Mapping)
                and isinstance(item.get("role"), str)
                and re.fullmatch(r"[0-9a-f]{64}", str(item.get("sha256", "")))
            ]
        else:
            # A receipt written before the field: the CV hash was the attachment.
            attachments = [{"role": "cv", "sha256": sha}] if sha else []
        return cls(
            Path(str(value.get("screenshot_path", ""))),
            str(value.get("confirmation_url", "")),
            str(value.get("confirmation_text", "")),
            str(value.get("captured_at", "")) or _utc_now(),
            _answer_sources(value.get("answer_sources")),
            sha,
            channel,
            attachments,
        )


def _checkpoint_data(path: Path, position_id: int, url: str) -> dict[str, Any] | None:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except (OSError, ValueError, TypeError) as exc:
        raise FlowError(f"checkpoint cannot be read: {exc}") from exc
    if not isinstance(raw, dict) or raw.get("version") != CHECKPOINT_VERSION:
        raise FlowError("checkpoint has an unknown format")
    if raw.get("position_id") != int(position_id) or raw.get("url") != url:
        raise FlowError("checkpoint belongs to a different application")
    return raw


def _check_checkpoint_state(raw: dict[str, Any]) -> None:
    valid_states = set(STEP_ORDER) | {
        "blocked_human",
        "denied",
        "dry_run",
        "complete",
        EMAIL_CHANNEL_STATE,
        page_failure.RETRY_LATER_STATE,
    }
    if raw.get("state") not in valid_states:
        raise FlowError("checkpoint has an unknown state")


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
    # Set only when the application control is a mailto: link.  The browser
    # flow stops there; the email channel reads these two fields.
    channel: str = ""
    mailto_href: str = ""
    # The page as it looked when the flow last stopped (blocked, denied or an
    # error), saved next to the checkpoint.  Empty when no page was open.
    stop_screenshot: str = ""
    # Key → user / profile / agent_inferred for every saved answer the form used.
    answer_sources: dict[str, str] = field(default_factory=dict)
    # Question key → {digest, count} of the worked-out value the form refused.
    answer_refusals: dict[str, dict[str, Any]] = field(default_factory=dict)
    # Page 1 of the CV PDF as rendered when the layout check stopped the flow.
    cv_preview: str = ""
    # The application address a board handed the flow to (LinkedIn → company
    # ATS).  `url` stays the address the queue asked for.
    handoff_url: str = ""
    # The form as it was right before the submit click, when a recipe saves it.
    pre_submit_screenshot: str = ""
    # The last step a multi-step form (LinkedIn Easy Apply) reached.
    modal_step: int = 0
    # sha256 of the CV file as the flow handed it to the form (see Receipt).
    cv_sha256: str = ""
    # A site's one-time code after Submit: "" · code_required (the code screen
    # is open, no code typed) · code_entered (typed and confirmed once).  The
    # code itself is never saved.
    verification: str = ""
    # When and on what the flow saw that code screen: the proof, written as it
    # happens, that the submit stopped before the site took the application.
    verification_seen_at: str = ""
    verification_evidence: str = ""
    # Submits retired because their code screen was lost before any code was
    # typed, each after a newer authorisation of the user.
    retired_submits: list[dict[str, str]] = field(default_factory=list)
    # The vacancy page as the browser last opened it: HTTP status and
    # scheme://host/path (no query).  None / "" before any navigation.
    http_status: int | None = None
    final_url: str = ""
    # Temporary page failures (5xx, timeout) in the last 24 hours, and the
    # instant before which a retry_later checkpoint is not opened again.
    transient_failures: list[str] = field(default_factory=list)
    retry_after: str = ""
    version: int = CHECKPOINT_VERSION
    updated_at: str = field(default_factory=_utc_now)

    @classmethod
    def new(cls, position_id: int, url: str) -> "FlowCheckpoint":
        return cls(position_id=int(position_id), url=url)

    @classmethod
    def load(cls, path: Path, position_id: int, url: str) -> "FlowCheckpoint":
        raw = _checkpoint_data(path, position_id, url)
        if raw is None:
            return cls.new(position_id, url)
        _check_checkpoint_state(raw)
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
        if raw.get("channel", "") not in {"", "email", CONTACT_FORM_CHANNEL} or not isinstance(
            raw.get("mailto_href", ""), str
        ):
            raise FlowError("checkpoint has an invalid application channel")
        if raw.get("state") == EMAIL_CHANNEL_STATE and not (
            raw.get("channel") == "email" and str(raw.get("mailto_href", "")).lower().startswith("mailto:")
        ):
            raise FlowError("checkpoint email channel has no mailto target")
        if not isinstance(raw.get("stop_screenshot", ""), str):
            raise FlowError("checkpoint has an invalid stop screenshot")
        if not isinstance(raw.get("answer_sources", {}), dict):
            raise FlowError("checkpoint has invalid answer sources")
        raw = {**raw, "answer_sources": _answer_sources(raw.get("answer_sources", {}))}
        refusals = raw.get("answer_refusals", {})
        if not isinstance(refusals, dict) or any(
            not isinstance(entry, dict)
            or not isinstance(entry.get("digest"), str)
            or isinstance(entry.get("count"), bool)
            or not isinstance(entry.get("count"), int)
            for entry in refusals.values()
        ):
            raise FlowError("checkpoint has invalid answer refusals")
        if not isinstance(raw.get("cv_preview", ""), str):
            raise FlowError("checkpoint has an invalid CV preview")
        if not isinstance(raw.get("handoff_url", ""), str) or not isinstance(
            raw.get("pre_submit_screenshot", ""), str
        ):
            raise FlowError("checkpoint has an invalid handoff or pre-submit screenshot")
        if not isinstance(raw.get("cv_sha256", ""), str):
            raise FlowError("checkpoint has an invalid CV digest")
        if raw.get("verification", "") not in {"", "code_required", "code_entered"}:
            raise FlowError("checkpoint has an invalid verification state")
        if not isinstance(raw.get("verification_seen_at", ""), str) or not isinstance(
            raw.get("verification_evidence", ""), str
        ):
            raise FlowError("checkpoint has an invalid verification record")
        retired = raw.get("retired_submits", [])
        if not isinstance(retired, list) or any(
            not isinstance(item, dict) or any(not isinstance(value, str) for value in item.values())
            for item in retired
        ):
            raise FlowError("checkpoint has invalid retired submits")
        step = raw.get("modal_step", 0)
        if isinstance(step, bool) or not isinstance(step, int) or step < 0:
            raise FlowError("checkpoint has an invalid form step")
        status = raw.get("http_status")
        if status is not None and (isinstance(status, bool) or not isinstance(status, int)):
            raise FlowError("checkpoint has an invalid HTTP status")
        if not isinstance(raw.get("final_url", ""), str) or not isinstance(raw.get("retry_after", ""), str):
            raise FlowError("checkpoint has an invalid page access record")
        failures = raw.get("transient_failures", [])
        if not isinstance(failures, list) or any(not isinstance(item, str) for item in failures):
            raise FlowError("checkpoint has invalid transient failures")
        if raw.get("state") == page_failure.RETRY_LATER_STATE and not raw.get("retry_after"):
            raise FlowError("checkpoint waits for a retry with no retry time")
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
    # What the CLOSER has to work out before a rerun: the essential facts
    # still unknown, or the one form question the flow stopped on.
    missing: tuple[str, ...] = ()
    pending_question: Mapping[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "status": self.status,
            "state": self.state,
            "reason": self.reason,
            "receipt": self.receipt.to_dict() if self.receipt else None,
        }
        if self.missing:
            out["missing"] = list(self.missing)
        if self.pending_question:
            out["pending_question"] = dict(self.pending_question)
        return out


@dataclass(frozen=True)
class _DeniedVerdict:
    reason: str
    detail: str
    context: dict[str, Any] = field(default_factory=dict)
    allowed: bool = False

    def log_line(self) -> str:
        return f"[apply-gate] DENY {self.reason} — {self.detail}"
