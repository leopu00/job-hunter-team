"""Saved answers and dashboard resume — moved unchanged from apply_flow.py."""
from __future__ import annotations

# Package imports and later recipe imports share one module and exception type.
import sys
if __package__ == "shared.skills":
    sys.modules.setdefault(__name__.rsplit(".", 1)[-1], sys.modules[__name__])

import contextlib
import json
import sqlite3
from dataclasses import field
from typing import Any, Mapping


try:
    from apply_flow_constants import (
        LOG, MAX_INFERRED_REFUSALS, application_answers,
    )
    from apply_flow_errors import (
        FlowError, BlockedHuman,
    )
    from apply_flow_page import (
        _normalise_label,
    )
    from apply_flow_profile import (
        _value_digest, _answer_fits,
    )
    from apply_flow_models import (
        FlowCheckpoint, FlowResult,
    )
    from apply_flow_defaults import (
        _resolve_db_path,
    )
except ImportError:  # package-style import outside the CLI
    from shared.skills.apply_flow_constants import (
        LOG, MAX_INFERRED_REFUSALS, application_answers,
    )
    from shared.skills.apply_flow_errors import (
        FlowError, BlockedHuman,
    )
    from shared.skills.apply_flow_page import (
        _normalise_label,
    )
    from shared.skills.apply_flow_profile import (
        _value_digest, _answer_fits,
    )
    from shared.skills.apply_flow_models import (
        FlowCheckpoint, FlowResult,
    )
    from shared.skills.apply_flow_defaults import (
        _resolve_db_path,
    )


class FlowAnswerMixin:
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

    def _save_application_answer(self, key: str, request: Mapping[str, Any], answer: Any) -> None:
        """Remember the answer in jobs.db, where every later run reads it first.

        The YAML profile is not rewritten any more: an answer kept only there
        was invisible to the email channel and lost whenever the profile was
        regenerated, so a new session asked the same question again.
        """
        payload = request.get("payload") if isinstance(request.get("payload"), Mapping) else {}
        db = _resolve_db_path(self.db_path)
        field_type = str(payload.get("field_type") or "text")
        with contextlib.closing(sqlite3.connect(db, timeout=10)) as conn:
            application_answers.save_answer(
                conn,
                key=key,
                label=str(payload.get("label") or key),
                answer=answer,
                field_type=field_type,
                options=list(payload.get("options") or []),
                channel="reply",
                message_id=int(str(request.get("message_id") or 0)) or None,
                # A contact-form letter names its vacancy: scope position, not company.
                scope=application_answers.answer_scope(
                    conn, field_type, self.position_id, purpose=str(payload.get("purpose") or "")
                ),
            )
            conn.commit()
            stored = application_answers.load_answers(conn, self.position_id)
        if key not in stored or stored[key] != answer:
            raise FlowError("saved application answer could not be verified")

    def _resume_dashboard_answer(
        self, checkpoint: FlowCheckpoint
    ) -> FlowResult | None:
        request = checkpoint.answer_request
        if not request:
            return None
        if not self._request_asked(request):
            if self._answer_saved_for(request) and not self._refused_again(checkpoint, request):
                # The CLOSER worked it out and saved it: the question is closed.
                return self._close_answer_request(checkpoint)
            return FlowResult(
                "blocked_human",
                checkpoint.state,
                checkpoint.blocked_reason or "required_answer_missing",
                pending_question=self._pending_question(request),
            )
        try:
            blocked = BlockedHuman(
                "required_answer_missing",
                checkpoint.blocked_detail,
                checkpoint.resume_state or "screening",
                answer_request=request.get("payload"),
            )
            source_id = str(request.get("source_id", ""))
            message = self._notification_message(blocked, source_id)
            legacy_message = self._notification_message(blocked, source_id, telegram_hint=False)
            self._persist_answer_request(checkpoint, message, legacy_message)
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
                if self._answer_saved_for(request):
                    # Asked, then saved another way (the CLOSER, or a Telegram answer).
                    return self._close_answer_request(checkpoint)
                return FlowResult(
                    "blocked_human",
                    checkpoint.state,
                    checkpoint.blocked_reason,
                    pending_question=self._pending_question(request),
                )
            answer = self._decode_answer_reply(request, str(row[0]))
            payload = request.get("payload")
            key = str(payload.get("key", "")) if isinstance(payload, Mapping) else ""
            if not key or key != _normalise_label(key):
                raise FlowError("answer request key is not canonical")
            self._save_application_answer(key, request, answer)
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
        return self._close_answer_request(checkpoint)

    def _refused_again(self, checkpoint: FlowCheckpoint, request: Mapping[str, Any]) -> bool:
        """The saved value is the one the form already refused too many times."""
        payload = request.get("payload")
        key = str(payload.get("key", "")) if isinstance(payload, Mapping) else ""
        entry = checkpoint.answer_refusals.get(key)
        if not entry:
            return False
        try:
            answers = self._profile_with_saved_answers().get("application_answers") or {}
        except Exception:
            return True
        if getattr(self, "answer_origins", {}).get(key) != "agent_inferred":
            # The user's (or the profile's) answer resets the count of the
            # CLOSER's refused guesses, even when it is the same value.
            checkpoint.answer_refusals.pop(key, None)
            return False
        if int(entry.get("count", 0)) < MAX_INFERRED_REFUSALS:
            return False
        return key in answers and _value_digest(answers[key]) == entry.get("digest")

    def _answer_saved_for(self, request: Mapping[str, Any]) -> bool:
        """A saved answer for this key that fits the question's type and exact options."""
        payload = request.get("payload")
        key = str(payload.get("key", "")) if isinstance(payload, Mapping) else ""
        if not key:
            return False
        try:
            answers = self._profile_with_saved_answers().get("application_answers") or {}
        except Exception as exc:
            LOG.error("saved answers unreadable: %s", type(exc).__name__)
            return False
        return key in answers and _answer_fits(payload, answers[key])

    def _close_answer_request(self, checkpoint: FlowCheckpoint) -> None:
        checkpoint.answer_request = None
        checkpoint.state = checkpoint.resume_state or "screening"
        checkpoint.blocked_reason = ""
        checkpoint.blocked_detail = ""
        checkpoint.resume_state = ""
        checkpoint.save(self.checkpoint_path)
        return None
