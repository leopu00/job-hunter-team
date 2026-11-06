"""Detection checkpoint, core fields, upload, screening and review phases."""
from __future__ import annotations

import sys
if __package__ == "shared.skills":
    sys.modules.setdefault(__name__.rsplit(".", 1)[-1], sys.modules[__name__])

import time
from pathlib import Path

try:
    from apply_flow_constants import CONTACT_FORM_CHANNEL, _file_sha256
except ImportError:
    from shared.skills.apply_flow_constants import CONTACT_FORM_CHANNEL, _file_sha256


class FlowFormMixin:
    def _run_form(self, checkpoint, active_page, opened, fresh, mode):
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

        self._run_fill_and_upload(checkpoint, active_page, detection, recipe, injected_blank, without_cv)
        self._run_screening_and_review(checkpoint, active_page, detection, recipe, injected_blank)
        waiting = self._run_before_submit(checkpoint, active_page, detection, mode)
        if waiting is not None:
            return waiting
        waiting = self._run_submit(checkpoint, active_page, recipe)
        if waiting is not None:
            return waiting
        return self._run_receipt(checkpoint, active_page, detection, recipe)

    def _run_fill_and_upload(self, checkpoint, active_page, detection, recipe, injected_blank, without_cv):
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

    def _run_screening_and_review(self, checkpoint, active_page, detection, recipe, injected_blank):
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
