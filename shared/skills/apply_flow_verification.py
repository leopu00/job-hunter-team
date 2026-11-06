"""Company form wait and site verification code — moved unchanged from apply_flow.py."""
from __future__ import annotations

# Package imports and later recipe imports share one module and exception type.
import sys
if __package__ == "shared.skills":
    sys.modules.setdefault(__name__.rsplit(".", 1)[-1], sys.modules[__name__])

import time
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from typing import Any


try:
    from apply_flow_constants import (
        LOG, _utc_now, _parse_utc,
    )
    from apply_flow_errors import (
        BlockedHuman,
    )
    from apply_flow_models import (
        FlowCheckpoint,
    )
    from apply_flow_defaults import (
        _resolve_db_path,
    )
except ImportError:  # package-style import outside the CLI
    from shared.skills.apply_flow_constants import (
        LOG, _utc_now, _parse_utc,
    )
    from shared.skills.apply_flow_errors import (
        BlockedHuman,
    )
    from shared.skills.apply_flow_models import (
        FlowCheckpoint,
    )
    from shared.skills.apply_flow_defaults import (
        _resolve_db_path,
    )


class FlowVerificationMixin:
    GENERIC_RENDER_WAIT_MS = 10_000

    def _wait_for_company_form(self, page, recipe) -> None:
        """A company page may build its form or its Apply control after load: give it time.

        Bounded, and nothing is clicked while waiting.  The recipe's own checks
        decide afterwards, exactly as on a page that rendered at once.
        """
        deadline = time.monotonic() + self.GENERIC_RENDER_WAIT_MS / 1000
        while True:
            try:
                if recipe.form_present(page) or recipe.apply_control_present(page):
                    return
            except Exception:
                return  # an unreadable page: the recipe's checks say why
            if time.monotonic() >= deadline:
                return
            page.wait_for_timeout(500)

    VERIFICATION_CODE_TIMEOUT_S = 300.0

    @staticmethod
    def _code_screen_open(recipe, page) -> bool:
        check = getattr(recipe, "security_code_screen", None)
        try:
            return bool(callable(check) and check(page))
        except Exception:
            return False

    def _verification_code(self, checkpoint: FlowCheckpoint, recipe) -> str:
        """The code the site asks for after Submit."""
        return self.site_verification_code(
            recipe,
            shape=getattr(recipe, "CODE_SHAPE", "alnum8"),
            since=_parse_utc(checkpoint.submit_started_at),
        )

    def site_verification_code(
        self, recipe, *, shape: str = "alnum8", stage: str = "submit", since: datetime | None = None
    ) -> str:
        """The site's one-time code: from the user's mailbox when it is configured, otherwise on Telegram.

        Also used before the application, by a site that identifies the
        candidate by email first (Oracle Recruiting Cloud, 1944).
        """
        import verification_code

        since = since or datetime.now(timezone.utc) - timedelta(seconds=60)
        reader = getattr(self, "mailbox_reader", None)
        if reader is not None or verification_code.mailbox_configured():
            return verification_code.code_from_mailbox(
                sender_domain=recipe.SECURITY_CODE_SENDERS,
                since=since,
                timeout_s=self.VERIFICATION_CODE_TIMEOUT_S,
                shape=shape,
                reader=reader,
                poll_s=getattr(self, "mailbox_poll_s", 10.0),
            )
        return verification_code.code_from_telegram(
            service=recipe.PLATFORM,
            site=recipe.PLATFORM.replace("_", " ").title(),
            position_id=self.position_id,
            db_path=_resolve_db_path(self.db_path),
            jht_home=self._jht_home(),
            timeout_s=self.VERIFICATION_CODE_TIMEOUT_S,
            shape=shape,
            stage=stage,
            notifier=self.code_notifier,
        )

    def _retire_lost_verification(self, checkpoint: FlowCheckpoint, gate: Any, *, new_page: bool) -> bool:
        """One new, complete submit for an application the site never took.

        1967 (patch 26): Submit stopped on Greenhouse's code screen, the browser
        was gone, and every later run stopped on submit_outcome_unknown, though
        Greenhouse registers nothing without the code.  Retired only when all
        hold: the code screen was recorded when it was seen (code_required,
        with when and how), no code was typed, there is no receipt, this run
        opens a new page (the screen cannot be there), and the user authorised
        the position again after the stop.  The run then starts over and
        submits at most once, like any run.  A checkpoint without the record
        (a stop before it existed) keeps its stop: a screenshot proves nothing
        the flow can read.
        """
        if not (
            checkpoint.submit_started
            and checkpoint.verification == "code_required"
            and checkpoint.verification_seen_at
            and not checkpoint.receipt
            and new_page
            and self._reauthorised_since(checkpoint, gate)
        ):
            return False
        checkpoint.retired_submits.append(
            {
                "submit_started_at": checkpoint.submit_started_at,
                "verification_seen_at": checkpoint.verification_seen_at,
                "verification_evidence": checkpoint.verification_evidence,
                "retired_at": _utc_now(),
            }
        )
        checkpoint.submit_started = False
        checkpoint.submit_started_at = ""
        checkpoint.verification = ""
        checkpoint.verification_seen_at = ""
        checkpoint.verification_evidence = ""
        checkpoint.completed_steps = []
        checkpoint.modal_step = 0
        checkpoint.pre_submit_screenshot = ""
        checkpoint.state = "detect"
        checkpoint.blocked_reason = ""
        checkpoint.blocked_detail = ""
        checkpoint.resume_state = ""
        checkpoint.save(self.checkpoint_path)
        LOG.warning("[apply-flow] submit retired: its verification code screen was lost before any code was typed")
        return True

    def _finish_with_code(self, checkpoint: FlowCheckpoint, recipe, page, platform: str) -> tuple[str, str]:
        """Type the site's one-time code and confirm ONCE: the last step of the same submit.

        The code is held in this frame only.  A wrong, expired or missing code
        stops as greenhouse_verification_failed, never with another submit.
        """
        import verification_code

        checkpoint.verification = "code_required"
        if not checkpoint.verification_seen_at:
            checkpoint.verification_seen_at = _utc_now()
            checkpoint.verification_evidence = f"{platform} security code screen after submit"
        checkpoint.save(self.checkpoint_path)
        try:
            code = self._verification_code(checkpoint, recipe)
        except verification_code.CodeUnavailable as missing:
            raise BlockedHuman(
                "greenhouse_verification_failed",
                f"No usable verification code ({missing.reason}): {missing.detail}",
                "submit",
            ) from None
        try:
            recipe.enter_security_code(page, code)
        finally:
            del code
        checkpoint.verification = "code_entered"
        try:
            checkpoint.save(self.checkpoint_path)
            recipe.submit(page)
            # The code screen stays up while the site checks the code: wait for
            # the confirmation, do not stop on the screen itself.
            confirmation = self._wait_for_confirmation(page, platform, stop_on_code_screen=False)
        except BaseException:
            recipe.clear_security_code(page)
            raise
        if not confirmation:
            recipe.clear_security_code(page)
            if self._code_screen_open(recipe, page):
                raise BlockedHuman(
                    "greenhouse_verification_failed",
                    "Greenhouse did not accept the verification code (wrong or expired)",
                    "submit",
                )
            raise BlockedHuman(
                "receipt_missing",
                "The verification code was confirmed once but no confirmation appeared",
                "submit",
            )
        return confirmation
