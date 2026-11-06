"""Question creation and explicit ask — moved unchanged from apply_flow.py."""
from __future__ import annotations

# Package imports and later recipe imports share one module and exception type.
import sys
if __package__ == "shared.skills":
    sys.modules.setdefault(__name__.rsplit(".", 1)[-1], sys.modules[__name__])

import contextlib
import hashlib
import json
import sqlite3
from dataclasses import field
from typing import Any, Mapping


try:
    from apply_flow_constants import (
        LOG, _optional_module, application_answers,
    )
    from apply_flow_errors import (
        FlowError, BlockedHuman,
    )
    from apply_flow_models import (
        FlowCheckpoint,
    )
    from apply_flow_defaults import (
        _resolve_db_path,
    )
    from apply_flow_recipes import (
        _optional_module,
    )
except ImportError:  # package-style import outside the CLI
    from shared.skills.apply_flow_constants import (
        LOG, _optional_module, application_answers,
    )
    from shared.skills.apply_flow_errors import (
        FlowError, BlockedHuman,
    )
    from shared.skills.apply_flow_models import (
        FlowCheckpoint,
    )
    from shared.skills.apply_flow_defaults import (
        _resolve_db_path,
    )
    from shared.skills.apply_flow_recipes import (
        _optional_module,
    )


class FlowRequestMixin:
    def _notification_message(
        self, blocked: BlockedHuman, source_id: str = "", *, telegram_hint: bool = True
    ) -> str:
        if blocked.answer_request:
            request = blocked.answer_request
            options = request.get("options") or []
            rendered_options = "\n".join(f"- {value}" for value in options)
            options_text = f"\nOptions:\n{rendered_options}" if rendered_options else ""
            return (
                "CLOSER needs one required application answer before it can continue.\n"
                f"Question: {request['label']}\n"
                f"Field type: {request['field_type']}"
                f"{options_text}\n\n"
                "Reply to this request in the dashboard. The answer is saved under the "
                "question's exact normalized key and reused only for an identical key."
                + (
                    "\n" + application_answers.telegram_hint(source_id)
                    if telegram_hint and source_id
                    else ""
                )
            )
        if blocked.reason in {"required_answer_missing", "required_profile_field_missing"}:
            return (
                "CLOSER stopped before submission because a required application field "
                f"has no saved answer. {blocked.detail} Please add the exact answer to "
                "application_answers and resume this application."
            )
        default = (
            "CLOSER stopped before any blind retry. "
            f"Reason: {blocked.reason}. {blocked.detail} Human review is required."
        )
        notices = _optional_module("closer_notices")
        if notices is None:
            return default
        try:
            # In the user's language; the technical detail stays in brackets.
            return notices.stop_message(blocked.reason, blocked.detail, self.position_id, default=default) or default
        except Exception:
            return default

    def _answer_request_record(self, blocked: BlockedHuman) -> dict[str, Any]:
        payload = {
            "version": 1,
            "position_id": self.position_id,
            "key": str(blocked.answer_request["key"]),
            "label": str(blocked.answer_request["label"]),
            "field_type": str(blocked.answer_request["field_type"]),
            "options": list(blocked.answer_request.get("options") or []),
        }
        purpose = blocked.answer_request.get("purpose")
        if isinstance(purpose, str) and purpose:
            # What the answer is for when the label alone does not say it
            # (a contact form's Message that is the application letter).
            payload["purpose"] = purpose
        # The question as the page asks it now: a field that changed type or
        # options is a new request, never the old one's row (1967, 14/09).
        schema = json.dumps([payload["field_type"], payload["options"]], ensure_ascii=False)
        identity = hashlib.sha256(
            f"{self.position_id}\0{self.url}\0{payload['key']}\0{schema}".encode("utf-8")
        ).hexdigest()[:24]
        return {
            "source_id": f"closer-answer:{self.position_id}:{identity}",
            "message_id": "",
            "notification_attempted": False,
            "asked": False,
            "payload": payload,
        }

    def _persist_answer_request(
        self, checkpoint: FlowCheckpoint, message: str, legacy_message: str = ""
    ) -> None:
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
        # A request persisted before the Telegram hint existed keeps its body.
        legacy = expected[:1] + (legacy_message,) + expected[2:] if legacy_message else None
        if not row or (row[1:] != expected and row[1:] != legacy):
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


    @staticmethod
    def _request_schema(request: Mapping[str, Any]) -> tuple[str, str, tuple[str, ...]]:
        payload = request.get("payload") if isinstance(request.get("payload"), Mapping) else {}
        return (
            str(payload.get("key", "")),
            str(payload.get("field_type", "")),
            tuple(str(option) for option in payload.get("options") or []),
        )

    def _request_row_open(self, request: Mapping[str, Any]) -> bool:
        """Is the dashboard/Telegram row of this asked request still waiting for the user?"""
        source_id = str(request.get("source_id") or "")
        if not source_id:
            return False
        try:
            db = _resolve_db_path(self.db_path)
            if not db.is_file():
                return False
            with contextlib.closing(sqlite3.connect(db, timeout=10)) as conn:
                row = conn.execute(
                    "SELECT 1 FROM pending_user_messages WHERE source_id = ? "
                    "AND source_action = 'closer_application_answer' AND user_reply IS NULL "
                    "AND acknowledged_at IS NULL",
                    (source_id,),
                ).fetchone()
        except Exception as exc:  # noqa: BLE001 — unknown counts as closed: ask again, never wait on it
            LOG.error("reading an answer request row failed: %s", type(exc).__name__)
            return False
        return row is not None

    def _supersede_request_rows(self, key: str, *, keep: str = "", restore: str = "") -> None:
        """Close the open dashboard/Telegram rows of an older shape of this question.

        No user_reply is written: the row leaves the answerable requests
        (`closer_application_answer`), so neither the bridge nor the dashboard
        takes an answer for a field the page no longer has.
        """
        try:
            db = _resolve_db_path(self.db_path)
            if not db.is_file():
                return
            with contextlib.closing(sqlite3.connect(db, timeout=10)) as conn:
                if restore:
                    conn.execute(
                        "UPDATE pending_user_messages SET source_action = 'closer_application_answer', acknowledged_at = NULL "
                        "WHERE source_id = ? AND source_action = 'closer_application_answer_superseded' "
                        "AND user_reply IS NULL",
                        (restore,),
                    )
                    conn.commit()
                    return
                conn.execute(
                    "UPDATE pending_user_messages SET source_action = 'closer_application_answer_superseded', "
                    "acknowledged_at = COALESCE(acknowledged_at, CURRENT_TIMESTAMP) "
                    "WHERE agent = 'closer' AND related_position_id = ? AND source_action = 'closer_application_answer' "
                    "AND user_reply IS NULL AND source_id != ? AND json_extract(source_payload, '$.key') = ?",
                    (self.position_id, keep, key),
                )
                conn.commit()
        except Exception as exc:  # noqa: BLE001 — the stale row is a nuisance, never a reason to stop
            LOG.error("superseding an old answer request failed: %s", type(exc).__name__)

    @staticmethod
    def _request_asked(request: Mapping[str, Any]) -> bool:
        # A checkpoint written before `asked` existed was asked when it has a row.
        return bool(request.get("asked")) or bool(str(request.get("message_id") or "").strip())

    @classmethod
    def _pending_question(cls, request: Mapping[str, Any] | None) -> dict[str, Any] | None:
        """The form question for the CLOSER: what to work out, and how to save it."""
        payload = request.get("payload") if isinstance(request, Mapping) else None
        if not isinstance(payload, Mapping):
            return None
        key = str(payload.get("key", ""))
        field_type = str(payload.get("field_type", ""))
        return {
            "key": key,
            "label": str(payload.get("label", "")),
            "field_type": field_type,
            "options": [str(option) for option in payload.get("options") or []],
            "scope": "company" if field_type == "textarea" or key == "salary expectations" else "global",
            "asked": cls._request_asked(request),
        } | ({"purpose": str(payload["purpose"])} if payload.get("purpose") else {})

    def ask_pending(self, checkpoint: FlowCheckpoint) -> dict[str, str]:
        """Send the stopped form question to the user: a durable row, then one notification."""
        request = checkpoint.answer_request
        if not request or not isinstance(request.get("payload"), Mapping):
            return {"status": "not_pending", "source_id": ""}
        source_id = str(request.get("source_id", ""))
        if self._request_asked(request):
            return {"status": "already_asked", "source_id": source_id}
        blocked = BlockedHuman(
            "required_answer_missing",
            checkpoint.blocked_detail,
            checkpoint.resume_state or "screening",
            answer_request=request["payload"],
        )
        message = self._notification_message(blocked, source_id)
        legacy_message = self._notification_message(blocked, source_id, telegram_hint=False)
        # The request itself does not depend on Telegram or on the notifier
        # executable: it is committed and reread first, then marked asked.
        self._persist_answer_request(checkpoint, message, legacy_message)
        request["asked"] = True
        checkpoint.save(self.checkpoint_path)
        try:
            self._notify_answer_request_once(checkpoint, message)
        except Exception as exc:
            LOG.error("answer request notification failed: %s", type(exc).__name__)
        return {"status": "asked", "source_id": source_id}
