"""Final gate, cap, one authorisation claim, durable submit marker and receipt."""
from __future__ import annotations

import sys
if __package__ == "shared.skills":
    sys.modules.setdefault(__name__.rsplit(".", 1)[-1], sys.modules[__name__])

from dataclasses import replace

try:
    from apply_flow_constants import _utc_now
    from apply_flow_errors import BlockedHuman
    from apply_flow_models import FlowResult, _DeniedVerdict
except ImportError:
    from shared.skills.apply_flow_constants import _utc_now
    from shared.skills.apply_flow_errors import BlockedHuman
    from shared.skills.apply_flow_models import FlowResult, _DeniedVerdict


class FlowSubmitMixin:
    def _run_before_submit(self, checkpoint, active_page, detection, mode):
        # Confirmation words already visible before the click cannot
        # prove that this click succeeded. Stop instead of reusing a
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

    def _run_submit(self, checkpoint, active_page, recipe):
        # The cap, atomically, as the last decision before the click:
        # another run with the last slot waits for this commit and is
        # refused. The slot counts for the day whatever happens next.
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

    def _run_receipt(self, checkpoint, active_page, detection, recipe):
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
