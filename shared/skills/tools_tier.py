#!/usr/bin/env python3
"""tools_tier.py — the tools of the full image arrive in the background; what the team does until they are here.

The installer pulls the CORE image only (Assistente, broker, Pi, CLI). The tools (the browser of the Scout, pandoc and
wkhtmltopdf for the CV, fonts) come in the FULL image, which the host pulls after the welcome and switches to when the
onboarding is closed (JHT-T307, plan A). Until the switch this container runs the core image: `JHT_IMAGE_TIER=core`,
set by the image itself (a file the host writes can narrow nothing here, it only says how far the pull is).

The host writes `$JHT_HOME/state/tools.json`, atomically:
    {"schema": 1, "state": "pending|pulling|ready|failed", "tier": "core|full", "reason": "<short code>", "since": "<ISO UTC>", "updated": "<ISO UTC>"}
  `since` is when the pull began and stays while it lasts; `updated` changes at every write.
  * `pending|pulling`  the full image is on its way;  `ready`  it is here and the host is about to switch to it;
  * `failed`           the pull gave up (`reason`).
No file, an unreadable one or another schema: nothing is known, the team behaves as it always did.

What the Capitano does with it (captain_gate.py, captain_boot.py, start-agent.sh), JHT-T362:
  * before the first run opens, it WAITS for the switch to the full image, however long it takes: the host switches at
    ready.flag as soon as the image is here (jht-tools.sh, the app's round). A Capitano started on the core image opened the
    first run with every Scout refused (exit 75): the window of the first run went by with nobody searching. A ten-minute
    cap did exactly that on a server where the switch came half an hour later;
  * a failed pull holds it too (`tools_failed`): the person is told the command (`jht tools pull`), not a team that searches
    with nobody;
  * a first run already open on the core image (an install from before this rule) is not held: it is `degraded` and the
    Capitano starts only the roles that do not need the tools (ROLES_NEEDING_TOOLS stay down: start-agent.sh exit 75).

  python3 tools_tier.py status             # {"tier": ..., "state": ..., "wait": ..., "degraded": ..., "missing_for": [...]}
  python3 tools_tier.py role-ready <role>  # exit 1 = that role needs the tools and this image does not have them yet
"""
from __future__ import annotations

import json
import re
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

STATES = ("pending", "pulling", "ready", "failed")
REASON_CODE = re.compile(r"[a-z0-9_-]{1,40}")  # what a reason of the notice may be: lowercase code words, nothing else
# The roles whose work needs what only the full image has: the Scout and the Analista render JS pages in the browser,
# the Scrittore and the Closer make the CV PDF (pandoc, wkhtmltopdf) and the Closer drives the browser.
ROLES_NEEDING_TOOLS = ("scout", "analista", "scrittore", "closer")


def image_tier() -> str:
    """`core` or `full`: what THIS image is. Anything but an exact `core` is the full image, as before."""
    return "core" if os.environ.get("JHT_IMAGE_TIER", "").strip().lower() == "core" else "full"


def read_state(home: Path | None = None) -> dict | None:
    """The host's tools.json as a checked dict, or None when it is absent, unreadable, symlinked or not understood."""
    base = home if home is not None else Path(os.environ.get("JHT_HOME", "/jht_home"))
    path = base / "state" / "tools.json"
    try:
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 4096:
            return None
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict) or data.get("schema") != 1 or data.get("state") not in STATES:
        return None
    return {"state": data["state"], "reason": _reason(data.get("reason")), "since": _epoch(data.get("since"))}


def _reason(value: object) -> str:
    """The reason as a short code, or nothing. The container writes this file too: what is not a code (a sentence, a line
    break, a name that is too long) never reaches the Capitano's chat, the app or a log."""
    return value if isinstance(value, str) and REASON_CODE.fullmatch(value) else ""


def _epoch(stamp: object) -> float | None:
    """Epoch seconds of an ISO UTC stamp (`Z` or an offset), None when it is not one."""
    if not isinstance(stamp, str):
        return None
    try:
        when = datetime.fromisoformat(stamp.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return when.timestamp() if when.tzinfo else when.replace(tzinfo=timezone.utc).timestamp()


def verdict(home: Path | None = None, tier: str | None = None) -> dict | None:
    """What the Capitano's start has to know about the tools, or None when there is nothing to say (the full image, or no
    readable notice of the host: the team behaves as it always did).

    On the core image: `wait` True while the full image is on its way or here and not switched to yet (pending, pulling,
    ready: the switch is the host's, at ready.flag), and `degraded` "failed" with the `reason` when the pull gave up.
    """
    if (image_tier() if tier is None else tier) != "core":
        return None
    seen = read_state(home)
    if seen is None:
        return None
    if seen["state"] == "failed":
        return {"state": "failed", "wait": True, "degraded": "failed", "reason": seen["reason"]}
    # `reason` "retrying": the pull fell (the network) and the host tries it again by itself (JHT-T367)
    return {"state": seen["state"], "wait": True, "degraded": None, "reason": seen["reason"]}


def role_ready(role: str, tier: str | None = None) -> bool:
    """False when the role needs the tools and this image does not have them (the core image)."""
    return not ((image_tier() if tier is None else tier) == "core" and role.strip().lower() in ROLES_NEEDING_TOOLS)


def main(argv: list[str]) -> int:
    if argv[:1] == ["role-ready"] and len(argv) == 2:
        return 0 if role_ready(argv[1]) else 1
    if argv == ["status"]:
        seen = read_state()
        print(json.dumps({"tier": image_tier(), "state": seen["state"] if seen else None,
                          "missing_for": list(ROLES_NEEDING_TOOLS) if image_tier() == "core" else []}))
        return 0
    print(__doc__.strip().splitlines()[-2], file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
