"""Confirmation evidence and durable application receipts — moved unchanged from apply_flow.py."""
from __future__ import annotations

# Package imports and later recipe imports share one module and exception type.
import sys
if __package__ == "shared.skills":
    sys.modules.setdefault(__name__.rsplit(".", 1)[-1], sys.modules[__name__])

import contextlib
import hashlib
import time
import urllib.parse
from typing import Any


try:
    from apply_flow_constants import (
        CONTACT_FORM_CHANNEL, detect_ats,
    )
    from apply_flow_errors import (
        BlockedHuman,
    )
    from apply_flow_page import (
        _secrets_hidden,
    )
    from apply_flow_models import (
        Receipt, FlowCheckpoint, FlowResult,
    )
    from apply_flow_recipes import (
        _recipe_class,
    )
except ImportError:  # package-style import outside the CLI
    from shared.skills.apply_flow_constants import (
        CONTACT_FORM_CHANNEL, detect_ats,
    )
    from shared.skills.apply_flow_errors import (
        BlockedHuman,
    )
    from shared.skills.apply_flow_page import (
        _secrets_hidden,
    )
    from shared.skills.apply_flow_models import (
        Receipt, FlowCheckpoint, FlowResult,
    )
    from shared.skills.apply_flow_recipes import (
        _recipe_class,
    )


class FlowReceiptMixin:
    @staticmethod
    def _confirmation(
        page,
        application_url: str,
        platform: str | None = None,
        *,
        pre_submit: bool = False,
    ) -> tuple[str, str] | None:
        try: from apply_flow_engine import ApplicationFlow
        except ImportError: from shared.skills.apply_flow_engine import ApplicationFlow
        platform = platform or detect_ats(application_url).platform
        recipe = _recipe_class(platform)
        if recipe is None:
            return None
        success = page.locator(recipe.SUCCESS) if recipe.SUCCESS else None
        if success is not None and success.count() and success.first.is_visible():
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
        ) + tuple(getattr(recipe, "CONFIRMATION_MARKERS", ()))
        lower = visible.casefold()
        submit_present = page.locator(recipe.SUBMIT).count() > 0
        text_rule = getattr(recipe, "confirmation_text", None)
        if callable(text_rule) and not pre_submit and not text_rule(page):
            # A recipe with its own, stricter reading of a thank-you text (the
            # company form: no form still there, no submit phrase next to it)
            # has the last word on text evidence after the click.
            markers = ()
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
        if platform == "lever":
            # Lever lands a submitted application on <posting>/thanks.
            confirmation_url_markers += ("/thanks",)
        confirmation_url_markers += tuple(getattr(recipe, "CONFIRMATION_URL_MARKERS", ()))
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

    def _wait_for_confirmation(
        self, page, platform: str, *, stop_on_code_screen: bool = True
    ) -> tuple[str, str] | None:
        recipe = _recipe_class(platform)
        deadline = time.monotonic() + self.confirmation_timeout_ms / 1000
        while True:
            found = self._confirmation(page, self.url, platform)
            if found:
                return found
            code_screen = getattr(recipe, "security_code_screen", None)
            on_code_screen = callable(code_screen) and code_screen(page)
            if on_code_screen and stop_on_code_screen:
                return None  # the site wants its one-time code: the flow takes over
            # The code screen's own boxes are not a captcha.
            challenge = "" if on_code_screen else recipe._challenge_reason(page)
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
            with _secrets_hidden(page):
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

    @staticmethod
    def _receipt_documents(checkpoint: FlowCheckpoint) -> dict[str, Any]:
        """What the receipt says was sent: the channel and every document, nothing more."""
        if checkpoint.channel == CONTACT_FORM_CHANNEL:
            return {"cv_sha256": "", "channel": CONTACT_FORM_CHANNEL, "attachments": []}
        documents = [{"role": "cv", "sha256": checkpoint.cv_sha256}] if checkpoint.cv_sha256 else []
        return {"cv_sha256": checkpoint.cv_sha256, "channel": "web_form", "attachments": documents}

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
