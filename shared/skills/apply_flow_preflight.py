"""Checkpoint and gate checks performed before opening the application browser."""
from __future__ import annotations

import sys
if __package__ == "shared.skills":
    sys.modules.setdefault(__name__.rsplit(".", 1)[-1], sys.modules[__name__])

try:
    from apply_flow_constants import EMAIL_CHANNEL_STATE, page_failure
    from apply_flow_errors import BlockedHuman, FlowError
    from apply_flow_models import FlowCheckpoint, FlowResult, Receipt, _DeniedVerdict
    from apply_flow_page import linkedin_job_url
except ImportError:
    from shared.skills.apply_flow_constants import EMAIL_CHANNEL_STATE, page_failure
    from shared.skills.apply_flow_errors import BlockedHuman, FlowError
    from shared.skills.apply_flow_models import FlowCheckpoint, FlowResult, Receipt, _DeniedVerdict
    from shared.skills.apply_flow_page import linkedin_job_url


class FlowPreflightMixin:
    def _run_checkpoint(self, queue_url):
        try:
            checkpoint = FlowCheckpoint.load(
                self.checkpoint_path, self.position_id, queue_url
            )
            # A multi-step recipe saves its step on the checkpoint of this run.
            self._live_checkpoint = checkpoint
            # A LinkedIn vacancy is opened on www (see linkedin_job_url).
            self.url = linkedin_job_url(queue_url)
        except FlowError as exc:
            checkpoint = FlowCheckpoint.new(self.position_id, queue_url)
            return self._block(
                checkpoint,
                BlockedHuman("checkpoint_invalid", str(exc), "detect"),
            )
        return checkpoint

    def _run_gate(self, checkpoint):
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
        # A recipe that works with the user's account reads it (no sign-in in a dry run).
        self._mode = mode

        if checkpoint.state == EMAIL_CHANNEL_STATE:
            # Detection already handed this position to the email channel; a
            # rerun must not reopen the page and "find" a form again.
            return FlowResult(EMAIL_CHANNEL_STATE, EMAIL_CHANNEL_STATE, "mailto_application")

        if (
            checkpoint.state == "blocked_human"
            and checkpoint.blocked_reason == "vacancy_closed"
            and not self._reauthorised_since(checkpoint, first_gate)
        ):
            # A closed vacancy does not reopen by retrying: no browser, no new
            # notification. Only the user authorising the position again after
            # this stop makes the next run look at the page once more.
            return FlowResult("blocked_human", checkpoint.state, "vacancy_closed")
        return first_gate, mode

    def _run_retry_state(self, checkpoint, first_gate, page, navigate):
        if checkpoint.state == page_failure.RETRY_LATER_STATE:
            if page_failure.retry_pending(
                {"state": checkpoint.state, "retry_after": checkpoint.retry_after}
            ):
                # A temporary page failure: not before retry_after, no browser.
                return FlowResult("retry_later", checkpoint.state, "page_retry_later")
            checkpoint.state = "detect"
        if (
            checkpoint.state == "blocked_human"
            and checkpoint.blocked_reason == "page_temporarily_unavailable"
            and self._reauthorised_since(checkpoint, first_gate)
        ):
            # The user authorised the position again after the third failure:
            # a new series of tries, not a stop at the first 503.
            checkpoint.transient_failures = []

        if (
            checkpoint.answer_request
            and not checkpoint.submit_started
            and self._reauthorised_since(checkpoint, first_gate)
        ):
            # The user authorised the position again after the stop: the page
            # is read again (the field's type and options as they are now),
            # and the old question's rows close without an answer.
            # Kept to come back only while it can still be answered: a question
            # never asked, or one whose row is still open. 1967 (patch 20): the
            # row had been closed (acknowledged) and the same text shape came
            # back as "asked", a question nobody could answer any more.
            stale = checkpoint.answer_request
            self._stale_request = stale if (
                not self._request_asked(stale) or self._request_row_open(stale)
            ) else None
            self._supersede_request_rows(self._request_schema(checkpoint.answer_request)[0])
            self._close_answer_request(checkpoint)

        self._retire_lost_verification(checkpoint, first_gate, new_page=page is None or navigate)

        fresh = (
            checkpoint.state == "detect"
            and not checkpoint.completed_steps
            and not checkpoint.submit_started
            and not checkpoint.answer_request
        )
        return fresh

    def _run_preflight_stop(self, checkpoint):
        waiting = self._resume_dashboard_answer(checkpoint)
        if waiting is not None:
            return waiting

        if not checkpoint.submit_started:
            # The CV that would be attached, checked before the page is touched:
            # a squeezed or unreadable PDF is never sent, and filling a form
            # with it would only have to be undone.
            cv_stop = self._cv_layout_stop(checkpoint)
            if cv_stop is not None:
                return cv_stop

        if checkpoint.submit_started and checkpoint.receipt:
            receipt = Receipt.from_dict(checkpoint.receipt)
            if receipt.is_valid():
                return self._record(checkpoint, receipt)

        # After the answers and the CV, right before the browser: a pending
        # question stays visible to the CLOSER during the pause.
        throttled = self._linkedin_pause(checkpoint)
        if throttled is not None:
            return throttled
        profile_stop = self._linkedin_profile_stop(checkpoint)
        if profile_stop is not None:
            return profile_stop
