"""Flow exception types — moved unchanged from apply_flow.py."""
from __future__ import annotations

# Package imports and later recipe imports share one module and exception type.
import sys
if __package__ == "shared.skills":
    sys.modules.setdefault(__name__.rsplit(".", 1)[-1], sys.modules[__name__])

from typing import Any, Mapping


class FlowError(RuntimeError):
    pass


class _HeadedRetry(FlowError):
    """An anti-bot wall in a headless browser: open the page once more, headed."""


class BlockedHuman(FlowError):
    def __init__(
        self,
        reason: str,
        detail: str,
        step: str,
        *,
        answer_request: Mapping[str, Any] | None = None,
    ):
        super().__init__(detail)
        self.reason = reason
        self.detail = detail
        self.step = step
        self.answer_request = dict(answer_request) if answer_request else None


class FlowDeferred(FlowError):
    """Not now, and not a person's problem: the run is denied and the queue retries later."""

    def __init__(self, reason: str, detail: str):
        super().__init__(detail)
        self.reason = reason
        self.detail = detail


class PlatformHandoff(FlowError):
    """The application continues on another site (a company ATS behind a board).

    Raised by a recipe that found the real application address.  The flow
    follows it once, with the recipe of the destination, after the same
    public-address guard as any application URL.
    """

    def __init__(self, url: str, detail: str = ""):
        super().__init__(detail or "the application continues on another site")
        self.url = str(url)
        self.detail = detail


class CvCheckUnavailable(FlowError):
    """The CV PDF could not be measured: not a pass."""
