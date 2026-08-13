#!/usr/bin/env python3
"""Prompt boundary for provider/model/CLI instructions.

Provider selection is user configuration, not natural-language instruction.
The original directive remains in SQLite for audit and editing, but prompt
renderers must replace it with a deterministic ignored marker.  This prevents
an old standing order from bypassing the current ``active_provider`` or a
role-scoped exception implemented by the launcher.
"""

from __future__ import annotations

import re


# These are the provider aliases, CLIs and model families supported by JHT.
# A new provider is a code/config change and must extend this list in the same
# commit.  Boundaries deliberately match absolute paths such as /usr/bin/claude
# while avoiding substrings inside unrelated words.
_PROVIDER_INSTRUCTION = re.compile(
    r"(?<![\w])(?:"
    r"anthropic|claude|openai|codex|moonshot|kimi|"
    r"opus|sonnet|haiku|gpt(?:-[\w.]+)?"
    r")(?![\w])",
    re.IGNORECASE,
)

_PROVIDER_LAUNCH_FLAG = re.compile(
    r"(?:^|\s)--(?:"
    r"yolo|dangerously-skip-permissions|full-auto|"
    r"model(?:[=\s]+\S+)?|effort(?:[=\s]+\S+)?|"
    r"approval-mode(?:[=\s]+\S+)?|sandbox(?:[=\s]+\S+)?"
    r")(?![\w-])",
    re.IGNORECASE,
)

IGNORED_PROVIDER_SELECTION = "[IGNORED CONFIG SELECTION]"
PROVIDER_POLICY_NOTICE = (
    "[provider/model/CLI selection ignored: jht.config.json and the "
    "canonical launcher win]"
)


def is_provider_instruction(text: object) -> bool:
    """True when a prompt-bound instruction names provider/CLI/model state."""
    return bool(_PROVIDER_INSTRUCTION.search(str(text or "")))


def for_prompt(text: object) -> tuple[str, bool]:
    """Return prompt-safe text while preserving the underlying work intent.

    Replacing the whole directive would also discard requests such as "review
    this CV".  Replace only configuration tokens and append a deterministic
    policy notice.  RULE-T19 makes adjacent path/flag fragments non-actionable;
    without a provider/model/CLI token they cannot select a runtime.
    """
    body = str(text or "").strip().replace("\n", " ")
    if is_provider_instruction(body):
        sanitized = _PROVIDER_INSTRUCTION.sub(IGNORED_PROVIDER_SELECTION, body)
        sanitized = re.sub(
            rf"(?:[A-Za-z]:)?(?:[/\\][^\s/\\]+)*[/\\]"
            rf"{re.escape(IGNORED_PROVIDER_SELECTION)}",
            IGNORED_PROVIDER_SELECTION,
            sanitized,
        )
        sanitized = _PROVIDER_LAUNCH_FLAG.sub("", sanitized)
        sanitized = re.sub(r"\s{2,}", " ", sanitized).strip()
        return f"{sanitized} {PROVIDER_POLICY_NOTICE}", True
    return body, False
