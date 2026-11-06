"""Application state-machine orchestration with the original effect order."""
from __future__ import annotations

import sys
if __package__ == "shared.skills":
    sys.modules.setdefault(__name__.rsplit(".", 1)[-1], sys.modules[__name__])

import contextlib
from typing import Any

try:
    from apply_flow_constants import STEP_ORDER, _linkedin_module
    from apply_flow_errors import FlowError, _HeadedRetry, BlockedHuman, FlowDeferred, PlatformHandoff
    from apply_flow_models import FlowResult, _DeniedVerdict
    from apply_flow_page import is_linkedin_job
    from apply_flow_preflight import FlowPreflightMixin
    from apply_flow_recovery import FlowRecoveryMixin
    from apply_flow_form import FlowFormMixin
    from apply_flow_submit import FlowSubmitMixin
except ImportError:
    from shared.skills.apply_flow_constants import STEP_ORDER, _linkedin_module
    from shared.skills.apply_flow_errors import FlowError, _HeadedRetry, BlockedHuman, FlowDeferred, PlatformHandoff
    from shared.skills.apply_flow_models import FlowResult, _DeniedVerdict
    from shared.skills.apply_flow_page import is_linkedin_job
    from shared.skills.apply_flow_preflight import FlowPreflightMixin
    from shared.skills.apply_flow_recovery import FlowRecoveryMixin
    from shared.skills.apply_flow_form import FlowFormMixin
    from shared.skills.apply_flow_submit import FlowSubmitMixin


class FlowExecutionMixin(FlowPreflightMixin, FlowRecoveryMixin, FlowFormMixin, FlowSubmitMixin):
    def run(self, *, page: Any | None = None, navigate: bool = True) -> FlowResult:
        # The queue's address names the checkpoint. self.url is where the
        # browser goes (www for a LinkedIn country page, the company site after
        # a handoff): a second run of this same flow must not compare that.
        queue_url = getattr(self, "_queue_url", "") or self.url
        self._queue_url = queue_url
        checkpoint = self._run_checkpoint(queue_url)
        if isinstance(checkpoint, FlowResult):
            return checkpoint
        gate = self._run_gate(checkpoint)
        if isinstance(gate, FlowResult):
            return gate
        first_gate, mode = gate
        fresh = self._run_retry_state(checkpoint, first_gate, page, navigate)
        if isinstance(fresh, FlowResult):
            return fresh
        waiting = self._run_preflight_stop(checkpoint)
        if waiting is not None:
            return waiting
        return self._run_browser(checkpoint, page, navigate, fresh, mode, queue_url)

    def _run_browser(self, checkpoint, page, navigate, fresh, mode, queue_url):
        managed = self._page_managed = page is None
        manager = contextlib.nullcontext(page) if page is not None else self._managed_page()
        headed_retry = False
        with manager as active_page:
            if checkpoint.submit_started and checkpoint.verification == "code_required":
                return self._run_code_recovery(checkpoint, active_page, navigate)
            if checkpoint.submit_started:
                return self._run_submit_recovery(checkpoint, active_page, navigate)
            try:
                self._run_restore_and_navigate(active_page, navigate)
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
                return self._run_form(checkpoint, active_page, opened, fresh, mode)
            except _HeadedRetry:
                headed_retry = True
            except BlockedHuman as blocked:
                return self._block(checkpoint, blocked, page=active_page, dry_run=mode == "dry_run")
            except FlowDeferred as deferred:
                return self._deny(checkpoint, _DeniedVerdict(deferred.reason, deferred.detail), page=active_page)
            except Exception as exc:
                return self._run_browser_error(checkpoint, active_page, exc)
        if not headed_retry:  # pragma: no cover - every other path returns
            raise FlowError("application flow ended without a result")
        return self._run_headed_retry(queue_url, navigate)

    def _run_restore_and_navigate(self, active_page, navigate):
        if is_linkedin_job(self.url) and self._linkedin_profile is None:
            # The saved session goes in before the first request, so the
            # vacancy page already shows the signed-in apply controls.
            # A hand-made profile already holds its own, newer cookies.
            module = _linkedin_module()
            if module is not None:
                module.restore_session(active_page.context, self._jht_home())
        if navigate:
            self._navigate(active_page)

    def _run_browser_error(self, checkpoint, active_page, exc):
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

    def _run_headed_retry(self, queue_url, navigate):
        # An anti-bot wall seen before any form work: the headless browser is
        # closed; the page is opened once more, headed.
        self._headed_retry_used = True
        self.url = queue_url
        previous_headless, self.headless = self.headless, False
        try:
            return self.run(page=None, navigate=navigate)
        finally:
            self.headless = previous_headless
