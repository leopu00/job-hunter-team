"""Recovery of a submission already started, without another submit click."""
from __future__ import annotations

import sys
if __package__ == "shared.skills":
    sys.modules.setdefault(__name__.rsplit(".", 1)[-1], sys.modules[__name__])

from dataclasses import replace

try:
    from apply_flow_constants import SUPPORTED_PLATFORMS, detect_ats, _linkedin_module
    from apply_flow_errors import BlockedHuman
    from apply_flow_page import is_linkedin_job
    from apply_flow_recipes import _recipe_class
except ImportError:
    from shared.skills.apply_flow_constants import SUPPORTED_PLATFORMS, detect_ats, _linkedin_module
    from shared.skills.apply_flow_errors import BlockedHuman
    from shared.skills.apply_flow_page import is_linkedin_job
    from shared.skills.apply_flow_recipes import _recipe_class


class FlowRecoveryMixin:
    def _run_code_recovery(self, checkpoint, active_page, navigate):
        # The code screen of this submit: finish it on the same page, or
        # stop. Opening the vacancy again would be a new application.
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

    def _run_submit_recovery(self, checkpoint, active_page, navigate):
        try:
            # Production recovery owns a fresh about:blank page. It
            # must first observe the real application URL; otherwise
            # an absent form says nothing about the previous submit.
            # Reloading will normally show the form again even when
            # the remote submit succeeded. Blocking in that case is
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
