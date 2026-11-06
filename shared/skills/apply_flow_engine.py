"""Composed application flow — moved unchanged from apply_flow.py."""
from __future__ import annotations

# Package imports and later recipe imports share one module and exception type.
import sys
if __package__ == "shared.skills":
    sys.modules.setdefault(__name__.rsplit(".", 1)[-1], sys.modules[__name__])

import json
import os
from pathlib import Path
from typing import Any, Callable, Mapping


try:
    from apply_flow_constants import (
        page_failure,
    )
    from apply_flow_page import (
        _resolve_headless,
    )
    from apply_flow_defaults import (
        _default_gate_checker, _default_notifier, _default_essentials_checker, _default_cv_checker,
        _default_cv_previewer, _default_cap_reserver, _default_authorisation_claimer, _default_applied_recorder,
    )
    from apply_flow_browser import (
        FlowBrowserMixin,
    )
    from apply_flow_requests import (
        FlowRequestMixin,
    )
    from apply_flow_answers import (
        FlowAnswerMixin,
    )
    from apply_flow_stops import (
        FlowStopMixin,
    )
    from apply_flow_boundaries import (
        FlowPageMixin,
    )
    from apply_flow_receipts import (
        FlowReceiptMixin,
    )
    from apply_flow_verification import (
        FlowVerificationMixin,
    )
    from apply_flow_execution import (
        FlowExecutionMixin,
    )
except ImportError:  # package-style import outside the CLI
    from shared.skills.apply_flow_constants import (
        page_failure,
    )
    from shared.skills.apply_flow_page import (
        _resolve_headless,
    )
    from shared.skills.apply_flow_defaults import (
        _default_gate_checker, _default_notifier, _default_essentials_checker, _default_cv_checker,
        _default_cv_previewer, _default_cap_reserver, _default_authorisation_claimer, _default_applied_recorder,
    )
    from shared.skills.apply_flow_browser import (
        FlowBrowserMixin,
    )
    from shared.skills.apply_flow_requests import (
        FlowRequestMixin,
    )
    from shared.skills.apply_flow_answers import (
        FlowAnswerMixin,
    )
    from shared.skills.apply_flow_stops import (
        FlowStopMixin,
    )
    from shared.skills.apply_flow_boundaries import (
        FlowPageMixin,
    )
    from shared.skills.apply_flow_receipts import (
        FlowReceiptMixin,
    )
    from shared.skills.apply_flow_verification import (
        FlowVerificationMixin,
    )
    from shared.skills.apply_flow_execution import (
        FlowExecutionMixin,
    )


class ApplicationFlow(FlowBrowserMixin, FlowRequestMixin, FlowAnswerMixin, FlowStopMixin, FlowPageMixin, FlowReceiptMixin, FlowVerificationMixin, FlowExecutionMixin):
    def __init__(
        self,
        *,
        position_id: int,
        url: str,
        profile: Mapping[str, Any],
        cv_path: str | Path,
        profile_path: str | Path | None = None,
        checkpoint_path: str | Path | None = None,
        receipt_dir: str | Path | None = None,
        db_path: str | Path | None = None,
        gate_checker: Callable[..., Any] | None = None,
        notifier: Callable[..., str] | None = None,
        applied_recorder: Callable[..., None] | None = None,
        essentials_checker: Callable[..., list[str]] | None = None,
        cap_reserver: Callable[..., Any] | None = None,
        authorisation_claimer: Callable[..., Any] | None = None,
        cv_checker: Callable[[Path], Mapping[str, Any]] | None = None,
        cv_previewer: Callable[[Path, Path], None] | None = None,
        code_notifier: Callable[..., str] | None = None,
        login_code_timeout_s: float = 300.0,
        confirmation_timeout_ms: int = 20_000,
        headless: bool = True,
        headed_available: Callable[[], bool] | None = None,
    ):
        if isinstance(position_id, bool) or int(position_id) <= 0:
            raise ValueError("position_id must be a positive integer")
        self.position_id = int(position_id)
        self.url = url.strip()
        self.profile = dict(profile)
        self.profile_path = Path(profile_path) if profile_path else None
        self.cv_path = Path(cv_path)
        jht_home = Path(os.environ.get("JHT_HOME") or (Path.home() / ".jht"))
        self.checkpoint_path = Path(checkpoint_path) if checkpoint_path else (
            jht_home / ".cache" / "apply-flow" / f"{self.position_id}.json"
        )
        self.receipt_dir = Path(receipt_dir) if receipt_dir else (
            jht_home / "application-receipts"
        )
        self.db_path = db_path
        self.gate_checker = gate_checker or _default_gate_checker
        self.notifier = notifier or _default_notifier
        self.applied_recorder = applied_recorder or _default_applied_recorder
        self.essentials_checker = essentials_checker or _default_essentials_checker
        self.cap_reserver = cap_reserver or _default_cap_reserver
        self.authorisation_claimer = authorisation_claimer or _default_authorisation_claimer
        self.cv_checker = cv_checker or _default_cv_checker
        self.cv_previewer = cv_previewer or _default_cv_previewer
        # LinkedIn's login code request; None = the module's own jht-notify-user call.
        self.code_notifier = code_notifier
        self.login_code_timeout_s = float(login_code_timeout_s)
        self.jht_home = jht_home
        self.confirmation_timeout_ms = max(0, int(confirmation_timeout_ms))
        self.headless = headless
        self.headed_available = headed_available or (
            lambda: page_failure.headed_screen_available(_resolve_headless)
        )
        self._headed_retry_used = False
        self._page_managed = False
        # What _navigate saw; read (and cleared) by _check_page_access.
        self._page_access: page_failure.Access | None = None
        # The LinkedIn profile the user signed in to by hand, when this run uses it.
        self._linkedin_profile: Path | None = None
