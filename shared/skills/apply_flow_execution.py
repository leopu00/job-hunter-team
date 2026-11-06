"""Application state-machine execution — moved unchanged from apply_flow.py."""
from __future__ import annotations

# Package imports and later recipe imports share one module and exception type.
import sys
if __package__ == "shared.skills":
    sys.modules.setdefault(__name__.rsplit(".", 1)[-1], sys.modules[__name__])

import contextlib
import time
from dataclasses import field, replace
from pathlib import Path
from typing import Any


try:
    from apply_flow_constants import (
        SUPPORTED_PLATFORMS, STEP_ORDER, EMAIL_CHANNEL_STATE, CONTACT_FORM_CHANNEL,
        _utc_now, _file_sha256, _linkedin_module, detect_ats,
        page_failure,
    )
    from apply_flow_errors import (
        FlowError, _HeadedRetry, BlockedHuman, FlowDeferred,
        PlatformHandoff,
    )
    from apply_flow_page import (
        is_linkedin_job, linkedin_job_url,
    )
    from apply_flow_models import (
        Receipt, FlowCheckpoint, FlowResult, _DeniedVerdict,
    )
    from apply_flow_recipes import (
        _linkedin_module, _recipe_class,
    )
except ImportError:  # package-style import outside the CLI
    from shared.skills.apply_flow_constants import (
        SUPPORTED_PLATFORMS, STEP_ORDER, EMAIL_CHANNEL_STATE, CONTACT_FORM_CHANNEL,
        _utc_now, _file_sha256, _linkedin_module, detect_ats,
        page_failure,
    )
    from shared.skills.apply_flow_errors import (
        FlowError, _HeadedRetry, BlockedHuman, FlowDeferred,
        PlatformHandoff,
    )
    from shared.skills.apply_flow_page import (
        is_linkedin_job, linkedin_job_url,
    )
    from shared.skills.apply_flow_models import (
        Receipt, FlowCheckpoint, FlowResult, _DeniedVerdict,
    )
    from shared.skills.apply_flow_recipes import (
        _linkedin_module, _recipe_class,
    )


class FlowExecutionMixin:
    def run(self, *, page: Any | None = None, navigate: bool = True) -> FlowResult:
        # The queue's address names the checkpoint.  self.url is where the
        # browser goes (www for a LinkedIn country page, the company site after
        # a handoff): a second run of this same flow must not compare that.
        queue_url = getattr(self, "_queue_url", "") or self.url
        self._queue_url = queue_url
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
            # notification.  Only the user authorising the position again after
            # this stop makes the next run look at the page once more.
            return FlowResult("blocked_human", checkpoint.state, "vacancy_closed")

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
            # never asked, or one whose row is still open.  1967 (patch 20): the
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

        managed = self._page_managed = page is None
        manager = contextlib.nullcontext(page) if page is not None else self._managed_page()
        headed_retry = False
        with manager as active_page:
            if checkpoint.submit_started and checkpoint.verification == "code_required":
                # The code screen of this submit: finish it on the same page, or
                # stop.  Opening the vacancy again would be a new application.
                try:
                    recipe = self._recipe(checkpoint.platform) if _recipe_class(checkpoint.platform) else None
                    if navigate or recipe is None or not self._code_screen_open(recipe, active_page):
                        raise BlockedHuman(
                            "greenhouse_verification_lost",
                            "The verification code screen of the submit is gone; it is never submitted again",
                            "submit",
                        )
                    confirmation = self._finish_with_code(checkpoint, recipe, active_page, checkpoint.platform)
                    receipt = replace(
                        self._capture_receipt(active_page, confirmation),
                        answer_sources=dict(checkpoint.answer_sources),
                        cv_sha256=checkpoint.cv_sha256,
                    )
                    checkpoint.receipt = receipt.to_dict()
                    checkpoint.save(self.checkpoint_path)
                    return self._record(checkpoint, receipt)
                except BlockedHuman as blocked:
                    return self._block(checkpoint, blocked, page=active_page)
            if checkpoint.submit_started:
                try:
                    # Production recovery owns a fresh about:blank page.  It
                    # must first observe the real application URL; otherwise
                    # an absent form says nothing about the previous submit.
                    # Reloading will normally show the form again even when
                    # the remote submit succeeded.  Blocking in that case is
                    # intentional: uncertainty cannot authorise a second click.
                    if checkpoint.handoff_url:
                        # The click happened on the site the board handed over to.
                        self.url = checkpoint.handoff_url
                    elif is_linkedin_job(self.url) and self._linkedin_profile is None:
                        # Easy Apply's outcome shows only to the signed-in account.
                        module = _linkedin_module()
                        if module is not None:
                            module.restore_session(active_page.context, self._jht_home())
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
                        receipt = replace(
                            self._capture_receipt(active_page, confirmation),
                            answer_sources=dict(checkpoint.answer_sources),
                            **self._receipt_documents(checkpoint),
                        )
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
                    page=active_page,
                )

            try:
                if is_linkedin_job(self.url) and self._linkedin_profile is None:
                    # The saved session goes in before the first request, so the
                    # vacancy page already shows the signed-in apply controls.
                    # A hand-made profile already holds its own, newer cookies.
                    module = _linkedin_module()
                    if module is not None:
                        module.restore_session(active_page.context, self._jht_home())
                if navigate:
                    self._navigate(active_page)
                waiting = self._check_page_access(
                    checkpoint, active_page, navigated=navigate, managed=managed
                )
                if waiting is not None:
                    return waiting
                self._assert_not_redirected_away(active_page, navigated=navigate)
                handoffs = 0
                while True:
                    try:
                        opened = self._open_application(checkpoint, active_page, navigate=navigate)
                        break
                    except PlatformHandoff as handoff:
                        handoffs += 1
                        waiting = self._follow_handoff(checkpoint, active_page, handoff, handoffs)
                        if waiting is not None:
                            return waiting
                        navigate = True
                if isinstance(opened, FlowResult):
                    return opened
                detection, recipe, injected_blank = opened
                if fresh:
                    # Only now that the page is an application the flow can
                    # really send (a recipe opened its form; not unsupported,
                    # closed or email) are the essential facts worked out.
                    waiting_facts = self._essentials_stop(checkpoint, mode)
                    if waiting_facts is not None:
                        return waiting_facts
                checkpoint.complete_step("detect", "fill")
                # A contact form takes no file: no upload step, no CV hash, and
                # the receipt says no CV went out (1800, 14/09).
                without_cv = getattr(recipe, "application_channel", "") == CONTACT_FORM_CHANNEL
                checkpoint.channel = CONTACT_FORM_CHANNEL if without_cv else ""
                # The bytes the recipe is about to upload (a multi-step form
                # uploads while it fills), for the receipt.
                checkpoint.cv_sha256 = "" if without_cv else _file_sha256(self.cv_path)
                checkpoint.save(self.checkpoint_path)

                recipe.fill_core(active_page)
                checkpoint.answer_sources = dict(recipe.answer_sources)
                self._assert_recipe_page(
                    active_page,
                    detection.platform,
                    "fill",
                    allow_injected_blank=injected_blank,
                    application_url=self.url,
                )
                checkpoint.complete_step("fill", "screening" if without_cv else "upload_cv")
                checkpoint.save(self.checkpoint_path)

                if not without_cv:
                    recipe.upload_cv(active_page)
                    self._assert_recipe_page(
                        active_page,
                        detection.platform,
                        "upload_cv",
                        allow_injected_blank=injected_blank,
                        application_url=self.url,
                    )
                    checkpoint.complete_step("upload_cv", "screening")
                    checkpoint.save(self.checkpoint_path)

                recipe.fill_screening(active_page)
                checkpoint.answer_sources = dict(recipe.answer_sources)
                self._assert_recipe_page(
                    active_page,
                    detection.platform,
                    "screening",
                    allow_injected_blank=injected_blank,
                    application_url=self.url,
                )
                checkpoint.complete_step("screening", "review")
                checkpoint.save(self.checkpoint_path)

                recipe.pre_submit_screenshot_path = str(
                    self.checkpoint_path.parent / f"{self.position_id}-pre-submit-{time.time_ns()}.png"
                )
                recipe.review(active_page)
                if Path(recipe.pre_submit_screenshot_path).is_file():
                    checkpoint.pre_submit_screenshot = recipe.pre_submit_screenshot_path
                self._assert_recipe_page(
                    active_page,
                    detection.platform,
                    "review",
                    allow_injected_blank=injected_blank,
                    application_url=self.url,
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
                    return self._deny(checkpoint, final_gate, page=active_page)
                if getattr(final_gate, "context", {}).get("mode") != "authorised":
                    return self._deny(
                        checkpoint,
                        _DeniedVerdict(
                            "gate_mode_changed",
                            "application mode changed before submit; refusing the click",
                        ),
                        page=active_page,
                    )

                # The cap, atomically, as the last decision before the click:
                # another run with the last slot waits for this commit and is
                # refused.  The slot counts for the day whatever happens next.
                try:
                    slot = self.cap_reserver(position_id=self.position_id, db_path=self.db_path)
                except Exception as exc:
                    slot = _DeniedVerdict("cap_unreadable", f"the daily cap could not be reserved ({type(exc).__name__})")
                if getattr(slot, "allowed", None) is not True:
                    return self._deny(checkpoint, slot, page=active_page)

                # The broker gives the person's authorisation once, for the site the page is on
                # now, after every redirect: the click goes only where the person saw it would go.
                try:
                    claim = self.authorisation_claimer(position_id=self.position_id, url=active_page.url)
                except Exception as exc:
                    claim = _DeniedVerdict(
                        "authorisation_unproven",
                        f"the broker could not give the authorisation ({type(exc).__name__})",
                    )
                if getattr(claim, "allowed", None) is not True:
                    self._release_cap_slot(slot)
                    return self._deny(checkpoint, claim, page=active_page)

                checkpoint.state = "submit"
                checkpoint.submit_started = True
                checkpoint.submit_started_at = _utc_now()
                try:
                    checkpoint.save(self.checkpoint_path)
                except Exception:
                    # No durable submit marker, so no click: the slot goes back.
                    checkpoint.submit_started = False
                    checkpoint.submit_started_at = ""
                    self._release_cap_slot(slot)
                    raise
                recipe.submit(active_page)
                confirmation = self._wait_for_confirmation(active_page, detection.platform)
                if not confirmation and self._code_screen_open(recipe, active_page):
                    confirmation = self._finish_with_code(checkpoint, recipe, active_page, detection.platform)
                if not confirmation and detection.platform == "generic":
                    # A company site has no known confirmation: the outcome is unknown.
                    raise BlockedHuman(
                        "submit_outcome_unknown",
                        "Submit was clicked once on a company site and no confirmation was recognised",
                        "submit",
                    )
                if not confirmation:
                    raise BlockedHuman(
                        "receipt_missing",
                        "Submit was clicked once but no confirmation URL or text appeared",
                        "submit",
                    )
                receipt = replace(
                    self._capture_receipt(active_page, confirmation),
                    answer_sources=dict(checkpoint.answer_sources),
                    **self._receipt_documents(checkpoint),
                )
                checkpoint.receipt = receipt.to_dict()
                checkpoint.save(self.checkpoint_path)
                return self._record(checkpoint, receipt)
            except _HeadedRetry:
                headed_retry = True
            except BlockedHuman as blocked:
                return self._block(checkpoint, blocked, page=active_page, dry_run=mode == "dry_run")
            except FlowDeferred as deferred:
                return self._deny(checkpoint, _DeniedVerdict(deferred.reason, deferred.detail), page=active_page)
            except Exception as exc:
                step = checkpoint.state if checkpoint.state in STEP_ORDER else "review"
                return self._block(
                    checkpoint,
                    BlockedHuman(
                        "browser_uncertainty",
                        f"Browser interaction stopped with {type(exc).__name__}; no blind retry is allowed",
                        step,
                    ),
                    page=active_page,
                )
        if not headed_retry:  # pragma: no cover - every other path returns
            raise FlowError("application flow ended without a result")
        # An anti-bot wall seen before any form work: the headless browser is
        # closed; the page is opened once more, headed.
        self._headed_retry_used = True
        self.url = queue_url
        previous_headless, self.headless = self.headless, False
        try:
            return self.run(page=None, navigate=navigate)
        finally:
            self.headless = previous_headless
