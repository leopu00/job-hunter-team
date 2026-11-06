"""Managed browser, navigation and platform handoff — moved unchanged from apply_flow.py."""
from __future__ import annotations

# Package imports and later recipe imports share one module and exception type.
import sys
if __package__ == "shared.skills":
    sys.modules.setdefault(__name__.rsplit(".", 1)[-1], sys.modules[__name__])

import contextlib
import os
import time
import urllib.parse
from dataclasses import replace
from pathlib import Path
from typing import Any, Iterator


try:
    from apply_flow_constants import (
        LOG, SUPPORTED_PLATFORMS, _OPTIONAL_IMPORT_ERRORS, _linkedin_module,
        detect_ats, page_failure,
    )
    from apply_flow_errors import (
        FlowError, _HeadedRetry, BlockedHuman, PlatformHandoff,
    )
    from apply_flow_page import (
        vacancy_closed_evidence, vacancy_redirected_away, _any_linkedin_host, is_linkedin_job,
    )
    from apply_flow_models import (
        FlowCheckpoint, FlowResult, _DeniedVerdict,
    )
    from apply_flow_recipes import (
        _linkedin_module, _recipe_class,
    )
except ImportError:  # package-style import outside the CLI
    from shared.skills.apply_flow_constants import (
        LOG, SUPPORTED_PLATFORMS, _OPTIONAL_IMPORT_ERRORS, _linkedin_module,
        detect_ats, page_failure,
    )
    from shared.skills.apply_flow_errors import (
        FlowError, _HeadedRetry, BlockedHuman, PlatformHandoff,
    )
    from shared.skills.apply_flow_page import (
        vacancy_closed_evidence, vacancy_redirected_away, _any_linkedin_host, is_linkedin_job,
    )
    from shared.skills.apply_flow_models import (
        FlowCheckpoint, FlowResult, _DeniedVerdict,
    )
    from shared.skills.apply_flow_recipes import (
        _linkedin_module, _recipe_class,
    )


class FlowBrowserMixin:
    def _gate(self):
        try:
            verdict = self.gate_checker(position_id=self.position_id, db_path=self.db_path)
        except Exception as exc:
            verdict = _DeniedVerdict(
                "gate_error",
                f"the authorisation gate could not decide ({type(exc).__name__})",
            )
        if getattr(verdict, "allowed", None) is not True:
            LOG.warning(getattr(verdict, "log_line", lambda: "[apply-gate] DENY invalid_verdict")())
        return verdict

    @contextlib.contextmanager
    def _managed_page(self) -> Iterator[Any]:
        try:
            from playwright.sync_api import sync_playwright
        except ImportError as exc:
            raise FlowError("playwright is not installed") from exc
        profile = getattr(self, "_linkedin_profile", None)
        with sync_playwright() as runtime:
            if profile is not None:
                # The profile the user signed in to by hand (linkedin_apply.py
                # login --interactive): one browser at a time on it.
                module = _linkedin_module()
                with module.profile_lock(self._jht_home(), wait_s=module.PROFILE_WAIT_S):
                    context = runtime.chromium.launch_persistent_context(
                        str(profile),
                        headless=self.headless,
                        args=["--no-sandbox", "--disable-dev-shm-usage"],
                        locale="en-US",
                        viewport={"width": 1280, "height": 900},
                    )
                    try:
                        yield context.pages[0] if context.pages else context.new_page()
                    finally:
                        context.close()
                return
            browser = runtime.chromium.launch(
                headless=self.headless,
                args=["--no-sandbox", "--disable-dev-shm-usage"],
            )
            try:
                context = browser.new_context(locale="en-US", viewport={"width": 1280, "height": 900})
                yield context.new_page()
            finally:
                browser.close()

    def _navigate(self, page) -> None:
        try:
            from safe_fetch import resolve_public_address
            from url_guard import check_url
        except ImportError:  # pragma: no cover - package import
            from shared.skills.safe_fetch import resolve_public_address
            from shared.skills.url_guard import check_url
        try:
            checked = check_url(self.url)
            parts = urllib.parse.urlsplit(checked)
            resolve_public_address(parts.hostname, parts.port or (443 if parts.scheme == "https" else 80))
        except Exception as exc:
            raise BlockedHuman("url_refused", "Application URL failed the public-address guard", "detect") from exc
        # A page that does not open is not decided here: _check_page_access
        # reads this record, and classifies the page itself when a caller
        # replaced this method.
        self._page_access = page_failure.visit(page, checked)
        page.wait_for_timeout(500)

    def _check_page_access(
        self, checkpoint: FlowCheckpoint, page, *, navigated: bool, managed: bool
    ) -> FlowResult | None:
        """What the vacancy page answered, before anything reads it.

        None when the page opened.  A gone page or an anti-bot wall raises
        BlockedHuman; a wall in a headless browser first raises _HeadedRetry
        once; a temporary failure returns retry_later without a stop and
        without a notification.  Never called after submit_started.
        """
        access, self._page_access = self._page_access, None
        if not navigated:
            return None
        if access is None:
            access = page_failure.observe(page)
        access = page_failure.settle(page, access)
        checkpoint.http_status = access.status
        checkpoint.final_url = access.final_url
        closed = ""
        if access.kind == page_failure.NOT_FOUND:
            try:
                language = vacancy_closed_evidence(page.locator("body").inner_text(timeout=5_000))
            except Exception:
                language = None
            if language:
                closed = f"notice language: {language}"
            elif vacancy_redirected_away(self.url, page.url):
                closed = "redirected away from the vacancy"
        decision, history, retry_after = page_failure.decide(
            access,
            headless=self.headless,
            headed_available=managed and self.headed_available(),
            headed_retry_used=self._headed_retry_used,
            closed_evidence=closed,
            transient_history=checkpoint.transient_failures,
        )
        checkpoint.transient_failures = history
        if decision.action == page_failure.PROCEED:
            checkpoint.retry_after = ""
            return None
        if decision.action == page_failure.BLOCK:
            checkpoint.retry_after = ""
            raise BlockedHuman(decision.reason, decision.detail, "detect")
        if decision.action == page_failure.RETRY_HEADED:
            raise _HeadedRetry(access.verdict.evidence)
        checkpoint.state = page_failure.RETRY_LATER_STATE
        checkpoint.retry_after = retry_after
        checkpoint.save(self.checkpoint_path)
        LOG.info(
            "application page temporarily unavailable (%s); retry after %s",
            decision.detail,
            retry_after,
        )
        return FlowResult("retry_later", checkpoint.state, "page_retry_later")


    def _jht_home(self) -> Path:
        return Path(self.jht_home) if self.jht_home else Path(os.environ.get("JHT_HOME") or (Path.home() / ".jht"))

    def _open_application(self, checkpoint: FlowCheckpoint, page, *, navigate: bool):
        """Detect the platform and open its form: (detection, recipe, injected_blank) or a FlowResult."""
        if is_linkedin_job(self.url):
            detection = replace(detect_ats(self.url), platform="linkedin")
        else:
            detection = detect_ats(self.url, page.content())
        if detection.platform not in SUPPORTED_PLATFORMS:
            company_page = not detection.url_match and not detection.conflict
            # A known ATS host without a recipe has no form the flow can read:
            # the page's own instructions may still name the mailbox.  A company
            # page waits for its form first (below).
            email = self._email_channel(checkpoint, page, instructions=not company_page)
            if email is not None:
                return email
            if company_page:
                # The host is no known ATS (a vendor name in the markup is not
                # the host): the company-form recipe always gets its turn and
                # says why when it cannot apply.  2071 (14/09): a quick look
                # right after load saw no form on a page that renders it later,
                # and the recipe was never tried.  A known ATS host without a
                # recipe (Workday, SmartRecruiters…) stays unsupported.
                if _recipe_class("generic") is not None:
                    detection = replace(detection, platform="generic")
                else:
                    LOG.error("[apply-flow] company-form recipe unavailable: %s", _OPTIONAL_IMPORT_ERRORS.get("apply_generic", "absent"))
        if detection.platform not in SUPPORTED_PLATFORMS:
            if not self._generic_application_controls(page):
                self._assert_no_closed_notice(page)
            reason = "ats_conflict" if detection.conflict else "ats_unsupported"
            raise BlockedHuman(
                reason,
                "Application platform is unknown, conflicting, or has no safe recipe",
                "detect",
            )
        checkpoint.platform = detection.platform
        recipe = self._recipe(detection.platform)
        if detection.platform == "generic":
            self._wait_for_company_form(page, recipe)
        # Before any click: an Apply control that opens a mail client is
        # the application channel.  Clicking it would open nothing in
        # the browser and read as a missing form.  A recognised form on
        # the page still wins over an "email us" link next to it.
        if not recipe.form_present(page):
            # No application form: an apply mailto, then an address the page's
            # text names ("Send your CV to careers@…"), before any Apply control.
            email = self._email_channel(checkpoint, page, instructions=True)
            if email is not None:
                return email
            if not recipe.apply_control_present(page) and not (
                # On a company page any form or apply-labelled control keeps a
                # notice from counting (a newsletter under "applications closed
                # for this round" proves nothing), as before the recipe existed.
                detection.platform == "generic" and self._generic_application_controls(page)
            ):
                # No Apply control found is not a closed vacancy (a
                # localised board, a slow render): only a notice is.
                self._assert_no_closed_notice(page)
        injected_blank = not navigate and page.url == "about:blank"
        self._assert_recipe_page(page, detection.platform, "detect", allow_injected_blank=injected_blank, application_url=self.url)
        # A company page the recipe finds nothing to apply with stops with the
        # recipe's own reason (generic_form_missing), never a wrapped one.
        recipe.open_form(page)
        self._assert_recipe_page(page, detection.platform, "detect", allow_injected_blank=injected_blank, application_url=self.url)
        # Confirm the rendered form too.  URL-only detection is not
        # enough to interact when a block/error page owns that URL.
        if callable(getattr(recipe, "dom_match", None)):
            recognised = bool(recipe.dom_match(page))
        else:
            rendered = detect_ats(self.url, page.content())
            recognised = rendered.platform == detection.platform and rendered.dom_match
        if not recognised:
            raise BlockedHuman(
                f"{detection.platform}_dom_unrecognised",
                f"URL is {detection.platform} but the rendered application form is not recognised",
                "detect",
            )
        return detection, recipe, injected_blank

    def _follow_handoff(
        self, checkpoint: FlowCheckpoint, page, handoff: PlatformHandoff, count: int
    ) -> FlowResult | None:
        """Go on to the site a recipe handed over to, once, or stop."""
        target = handoff.url.strip()
        try:
            parsed = urllib.parse.urlsplit(target)
        except ValueError:
            parsed = urllib.parse.SplitResult("", "", "", "", "")
        host = (parsed.hostname or "").casefold()
        destination = detect_ats(target) if host else None
        # A known ATS host: its recipe applies, or the stop names it (ats_unsupported).
        known_ats = bool(
            destination and destination.url_match and destination.platform not in {"unknown", "generic", "linkedin"}
        )
        if count > 2 or (count == 2 and not (checkpoint.platform == "generic" and known_ats)):
            # One handoff, or the chain board → company site → that company's ATS
            # (1843, 1944, 14/09: LinkedIn → careers.axa.com → iCIMS).
            allowed, why = False, "a further handoff in one run (handoff_loop)"
        elif parsed.scheme != "https" or not host or _any_linkedin_host(host):
            allowed, why = False, "the handed-over address is not an HTTPS page outside the board"
        elif checkpoint.platform == "linkedin":
            # A board's "apply on company website": any public site, whose
            # recipe detection picks (a known ATS or the company form).
            allowed, why = True, ""
        else:
            allowed = known_ats
            why = "" if allowed else "the handed-over address is not a known application platform"
        if not allowed:
            raise BlockedHuman("application_redirect_untrusted", f"Handoff refused: {why}", "detect")
        checkpoint.handoff_url = target
        checkpoint.platform = ""
        checkpoint.save(self.checkpoint_path)
        self.url = target
        self._navigate(page)
        # The site handed over to is a page like any other: gone, walled or down.
        waiting = self._check_page_access(
            checkpoint, page, navigated=True, managed=self._page_managed
        )
        if waiting is not None:
            return waiting
        self._assert_not_redirected_away(page, navigated=True)
        return None
