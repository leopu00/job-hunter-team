"""Stops, screenshots, CV layout and pause handling — moved unchanged from apply_flow.py."""
from __future__ import annotations

# Package imports and later recipe imports share one module and exception type.
import sys
if __package__ == "shared.skills":
    sys.modules.setdefault(__name__.rsplit(".", 1)[-1], sys.modules[__name__])

import contextlib
import os
import re
from dataclasses import field, replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping


try:
    from apply_flow_constants import (
        LOG, EMAIL_CHANNEL_STATE, MAX_INFERRED_REFUSALS, _CV_REASON,
        _optional_module, _linkedin_module,
    )
    from apply_flow_errors import (
        BlockedHuman, FlowDeferred,
    )
    from apply_flow_page import (
        mailto_application_href, is_linkedin_job, _secrets_hidden,
    )
    from apply_flow_models import (
        FlowCheckpoint, FlowResult,
    )
    from apply_flow_recipes import (
        _linkedin_module, _optional_module,
    )
except ImportError:  # package-style import outside the CLI
    from shared.skills.apply_flow_constants import (
        LOG, EMAIL_CHANNEL_STATE, MAX_INFERRED_REFUSALS, _CV_REASON,
        _optional_module, _linkedin_module,
    )
    from shared.skills.apply_flow_errors import (
        BlockedHuman, FlowDeferred,
    )
    from shared.skills.apply_flow_page import (
        mailto_application_href, is_linkedin_job, _secrets_hidden,
    )
    from shared.skills.apply_flow_models import (
        FlowCheckpoint, FlowResult,
    )
    from shared.skills.apply_flow_recipes import (
        _linkedin_module, _optional_module,
    )


class FlowStopMixin:
    def _block(
        self,
        checkpoint: FlowCheckpoint,
        blocked: BlockedHuman,
        *,
        page: Any | None = None,
        dry_run: bool = False,
    ) -> FlowResult:
        checkpoint.state = "blocked_human"
        checkpoint.resume_state = blocked.step
        checkpoint.blocked_reason = blocked.reason
        checkpoint.blocked_detail = blocked.detail
        previous_screenshot = self._capture_stop_screenshot(checkpoint, blocked.reason, page)
        if blocked.answer_request:
            # A form question never goes to the user on its own: the CLOSER works
            # the answer out from the profile, the CV and the vacancy, saves it
            # and reruns.  Only its explicit `ask` sends the question
            # (`ask_pending_question`).  In a dry run as in an authorised run.
            candidate = self._answer_request_record(blocked)
            current = checkpoint.answer_request
            stale = getattr(self, "_stale_request", None)
            if not current and stale and self._request_schema(stale) == self._request_schema(candidate):
                # Read again after a new authorisation and still the same field:
                # the same request, asked or not, and its row answerable again.
                checkpoint.answer_request = stale
                self._supersede_request_rows(self._request_schema(stale)[0], restore=str(stale.get("source_id", "")))
            elif not current or self._request_schema(current) != self._request_schema(candidate):
                if current and self._request_schema(current)[0] == self._request_schema(candidate)[0]:
                    # Same question, another shape on the page: the saved
                    # request and its refusals describe a field that is gone.
                    checkpoint.answer_refusals.pop(self._request_schema(current)[0], None)
                self._supersede_request_rows(str(candidate["payload"]["key"]), keep=candidate["source_id"])
                checkpoint.answer_request = candidate
            reason = blocked.reason
            digest = getattr(blocked, "refused_digest", "")
            if digest:
                key = str(candidate["payload"]["key"])
                previous = checkpoint.answer_refusals.get(key) or {}
                count = int(previous.get("count", 0)) + 1 if previous.get("digest") == digest else 1
                checkpoint.answer_refusals[key] = {"digest": digest, "count": count}
                if count >= MAX_INFERRED_REFUSALS:
                    # The CLOSER saved the same refused value again: no more
                    # rounds on it.  The question waits for an explicit ask.
                    reason = "answer_not_accepted"
                    checkpoint.blocked_reason = reason
            self._save_stop(checkpoint, previous_screenshot)
            return FlowResult(
                "blocked_human",
                checkpoint.state,
                reason,
                pending_question=self._pending_question(checkpoint.answer_request),
            )
        message = self._notification_message(blocked)
        self._save_stop(checkpoint, previous_screenshot)
        notices = _optional_module("closer_notices")
        if notices is not None:
            # Every stop joins the round's summary (closer_notices flush at the
            # end of the CLOSER's round): one message, never one per position.
            # Live 14/09: eight positions, eight Telegram alerts, because only
            # the site stops (DIGEST_REASONS) were deferred.  A form question
            # never gets here; it is sent only by the CLOSER's explicit ask.
            try:
                notices.defer(self.position_id, blocked.reason, self.url)
                return FlowResult("blocked_human", checkpoint.state, blocked.reason)
            except Exception as exc:
                LOG.error("stop summary unavailable, notifying now: %s", type(exc).__name__)
        try:
            self.notifier(position_id=self.position_id, message=message)
        except Exception as exc:
            LOG.error("blocked_human notification failed: %s", type(exc).__name__)
        return FlowResult("blocked_human", checkpoint.state, blocked.reason)


    def _email_channel(
        self, checkpoint: FlowCheckpoint, page, *, instructions: bool = False
    ) -> FlowResult | None:
        """The mailbox the application goes to: an apply-labelled mailto link, or
        (`instructions`, only where no application form is on the page) the one
        address the page's text tells applicants to write to (1798)."""
        href = mailto_application_href(page)
        reason = "mailto_application"
        if href is None and instructions:
            module = _optional_module("apply_instructions")
            found = module.email_instruction(module.page_text(page)) if module is not None else None
            if found is not None:
                href, reason = module.mailto_href(found), "email_instruction"
                LOG.info("[apply-flow] email channel from the page's application instructions")
        if href is None:
            return None
        checkpoint.channel = "email"
        checkpoint.mailto_href = href
        checkpoint.state = EMAIL_CHANNEL_STATE
        checkpoint.blocked_reason = ""
        checkpoint.blocked_detail = ""
        checkpoint.resume_state = ""
        checkpoint.save(self.checkpoint_path)
        return FlowResult(EMAIL_CHANNEL_STATE, EMAIL_CHANNEL_STATE, reason)

    def _deny(
        self, checkpoint: FlowCheckpoint, verdict: Any, *, page: Any | None = None
    ) -> FlowResult:
        checkpoint.state = "denied"
        checkpoint.blocked_reason = str(getattr(verdict, "reason", "gate_denied"))
        checkpoint.blocked_detail = str(getattr(verdict, "detail", "authorisation denied"))
        previous_screenshot = self._capture_stop_screenshot(checkpoint, checkpoint.blocked_reason, page)
        self._save_stop(checkpoint, previous_screenshot)
        return FlowResult("denied", checkpoint.state, checkpoint.blocked_reason)

    @staticmethod
    def _reauthorised_since(checkpoint: FlowCheckpoint, verdict: Any) -> bool:
        """Did the user authorise the position again after the checkpoint stopped?

        The same rule the queue uses to lift a checkpoint hold.  An instant
        that cannot be read never counts as a new authorisation.
        """

        def instant(value: Any) -> datetime | None:
            try:
                parsed = datetime.fromisoformat(str(value or "").strip().replace("Z", "+00:00"))
            except ValueError:
                return None
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)

        context = getattr(verdict, "context", None)
        authorised = instant(context.get("at")) if isinstance(context, Mapping) else None
        stopped = instant(checkpoint.updated_at)
        return bool(authorised and stopped and authorised > stopped)

    def _release_cap_slot(self, slot: Any) -> None:
        """Give back a reserved slot whose click certainly did not happen."""
        context = getattr(slot, "context", None)
        token = context.get("token") if isinstance(context, Mapping) else None
        if not token:
            return
        try:
            from apply_gate import release_daily_slot
        except ImportError:  # pragma: no cover - package import
            from shared.skills.apply_gate import release_daily_slot
        try:
            release_daily_slot(str(token), db_path=str(self.db_path) if self.db_path else None)
        except Exception as exc:
            LOG.error("cap slot release failed: %s", type(exc).__name__)

    def _cv_layout_stop(self, checkpoint: FlowCheckpoint) -> FlowResult | None:
        """blocked_human when the CV PDF fails the shared visual check or cannot be checked.

        A missing file is left to the upload step (`cv_missing`).  The remedy is
        a regenerated CV, never a question: the stop notifies like any
        blocked_human, and page 1 is rendered next to the checkpoint.
        """
        if not self.cv_path.is_file():
            return None
        try:
            report = self.cv_checker(self.cv_path)
        except Exception as exc:
            reason = "cv_pdf_check_unavailable"
            detail = f"The CV PDF could not be checked ({type(exc).__name__}); nothing is sent"
        else:
            if isinstance(report, Mapping) and report.get("ok") is True:
                return None
            if isinstance(report, Mapping):
                raw = report.get("reasons") if isinstance(report.get("reasons"), list) else []
                reasons = [str(item) for item in raw if isinstance(item, str) and _CV_REASON.match(item)]
                reason = "cv_pdf_layout_bad"
                detail = "The CV PDF layout failed the visual check: " + (", ".join(reasons) or "unspecified")
            else:
                reason = "cv_pdf_check_unavailable"
                detail = "The CV PDF check returned no report; nothing is sent"
        checkpoint.cv_preview = self._render_cv_preview() if reason == "cv_pdf_layout_bad" else ""
        return self._block(checkpoint, BlockedHuman(reason, detail, "upload_cv"))

    def _render_cv_preview(self) -> str:
        """Best effort: page 1 of the CV next to the checkpoint, 0600, tmp then rename."""
        target = self.checkpoint_path.with_name(f"{self.checkpoint_path.stem}.cv-page1.png")
        temporary = target.with_name(f".{target.stem}.partial.png")
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            self.cv_previewer(self.cv_path, temporary)
            os.chmod(temporary, 0o600)
            os.replace(temporary, target)
            return str(target)
        except Exception as exc:
            LOG.error("CV preview failed: %s", type(exc).__name__)
            with contextlib.suppress(OSError):
                temporary.unlink()
            return ""

    def _stop_screenshot_prefix(self) -> str:
        return f"{self.checkpoint_path.stem}.stop-"

    def _capture_stop_screenshot(
        self, checkpoint: FlowCheckpoint, reason: str, page: Any | None
    ) -> str:
        """Save the page the flow stopped on next to the checkpoint.

        Best effort and never a reason to fail the stop itself.  The file name
        carries only the checkpoint name, a UTC instant and the reason slug —
        nothing from the profile or the page.  Returns the previous screenshot,
        to be removed once the checkpoint naming the new one is saved.
        """
        previous = checkpoint.stop_screenshot
        checkpoint.stop_screenshot = ""
        if page is None:
            return previous
        temporary: Path | None = None
        try:
            if page.is_closed():
                return previous
            directory = self.checkpoint_path.parent
            directory.mkdir(parents=True, exist_ok=True)
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
            slug = re.sub(r"[^a-z0-9_]+", "_", str(reason).casefold()).strip("_")[:60] or "stop"
            target = directory / f"{self._stop_screenshot_prefix()}{stamp}-{slug}.png"
            temporary = directory / f".{target.name}.partial.png"
            with _secrets_hidden(page, required=True):
                page.screenshot(path=str(temporary), full_page=True, timeout=10_000)
            os.chmod(temporary, 0o600)
            os.replace(temporary, target)
            temporary = None
            checkpoint.stop_screenshot = str(target)
        except Exception as exc:
            LOG.error("stop screenshot failed: %s", type(exc).__name__)
        finally:
            if temporary is not None:
                with contextlib.suppress(OSError):
                    temporary.unlink()
        return previous

    def _save_stop(self, checkpoint: FlowCheckpoint, previous_screenshot: str) -> None:
        """Save the stopped checkpoint; the screenshot it does not name never stays behind."""
        try:
            checkpoint.save(self.checkpoint_path)
        except Exception:
            # The new screenshot is named by no checkpoint: remove it, keep the old one.
            orphan, checkpoint.stop_screenshot = checkpoint.stop_screenshot, previous_screenshot
            self._discard_stop_screenshot(checkpoint, orphan)
            raise
        self._discard_stop_screenshot(checkpoint, previous_screenshot)

    def _discard_stop_screenshot(self, checkpoint: FlowCheckpoint, previous: str) -> None:
        """Keep one stop screenshot per checkpoint: the one it names."""
        if not previous or previous == checkpoint.stop_screenshot:
            return
        old = Path(previous)
        # Only a file this flow wrote: a tampered checkpoint cannot delete others.
        if old.parent != self.checkpoint_path.parent or not old.name.startswith(
            self._stop_screenshot_prefix()
        ) or old.suffix != ".png":
            return
        with contextlib.suppress(OSError):
            old.unlink()


    def _essentials_stop(self, checkpoint: FlowCheckpoint, mode: str) -> FlowResult | None:
        """The facts almost every form asks for, before the first fill of a position.

        Each missing one is asked once, on Telegram first, and nothing is saved
        in the checkpoint: the position is not held, it waits until the
        answers exist.
        """
        try:
            if mode == "dry_run":
                # A dry run only looks: it never sends the user a question
                # and never stops on a fact it would have asked.
                self._log_dry_run_essentials()
                missing = []
            else:
                missing = self.essentials_checker(
                    profile=self.profile, position_id=self.position_id, db_path=self.db_path
                )
        except Exception as exc:
            LOG.error("essential facts check failed: %s", type(exc).__name__)
            return FlowResult("blocked_human", checkpoint.state, "essential_facts_unavailable")
        if missing:
            return FlowResult(
                "blocked_human",
                checkpoint.state,
                "essential_facts_missing",
                missing=tuple(str(key) for key in missing),
            )
        return None

    def _linkedin_pause(self, checkpoint: FlowCheckpoint) -> FlowResult | None:
        """The pause between LinkedIn applications, before any browser opens.

        Inside the recipe alone, a throttled run still opened LinkedIn with the
        account at every turn of the queue, only to be told to wait.  The
        checkpoint is not touched: nothing happened to the application.  A run
        after submit_started is recovery, never throttled (its own click just
        started the pause).
        """
        if checkpoint.submit_started or not is_linkedin_job(self.url):
            return None
        module = _linkedin_module()
        if module is None:
            return None
        try:
            module.LinkedInSession(
                jht_home=self._jht_home(), db_path=self.db_path, position_id=self.position_id
            ).assert_interval()
        except FlowDeferred as deferred:
            LOG.warning("[apply-flow] DENY %s", deferred.reason)
            return FlowResult("denied", checkpoint.state, deferred.reason)
        return None

    def _linkedin_profile_stop(self, checkpoint: FlowCheckpoint) -> FlowResult | None:
        """Which browser a LinkedIn vacancy opens in, decided before it opens.

        The user's hand-made sign-in (profile) when there is one.  A profile
        whose session expired stops for the user to sign in by hand again,
        never a sign-in with Google by the CLOSER; the credentials file, when
        the user has one, is still the fallback.  A profile another browser
        holds is a denial the queue retries.
        """
        self._linkedin_profile = None
        if not is_linkedin_job(getattr(self, "_queue_url", "") or self.url):
            return None
        module = _linkedin_module()
        if module is None:
            return None
        home = self._jht_home()
        state = module.profile_state(home)
        if state == "absent":
            return None
        if state == "busy":
            LOG.warning("[apply-flow] DENY linkedin_profile_busy")
            return FlowResult("denied", checkpoint.state, "linkedin_profile_busy")
        if state == "expired" and not module._private_file(module._home_path(home, module.CREDENTIALS_FILE)):
            return self._block(
                checkpoint,
                BlockedHuman(
                    "linkedin_session_expired",
                    "The LinkedIn session the user signed in to by hand has expired: "
                    "sign in again by hand (linkedin_apply.py login --interactive)",
                    "detect",
                ),
            )
        self._linkedin_profile = module.profile_dir(home)
        return None
