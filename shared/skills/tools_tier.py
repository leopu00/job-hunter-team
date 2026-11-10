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

What the Capitano does with it (captain_gate.py, captain_boot.py, start-agent.sh):
  * it WAITS for the full image for at most WAIT_SECONDS after the onboarding closed (`ready.flag`), then starts anyway;
  * a failed pull, or the end of the wait, is `degraded`: it starts, tells the user once, and starts only the roles that
    do not need the tools (ROLES_NEEDING_TOOLS stay down: start-agent.sh refuses them with exit 75 while the image is core).

  python3 tools_tier.py status             # {"tier": ..., "state": ..., "wait": ..., "degraded": ..., "missing_for": [...]}
  python3 tools_tier.py role-ready <role>  # exit 1 = that role needs the tools and this image does not have them yet
"""
from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

WAIT_SECONDS = 600  # the Capitano waits at most 10 minutes after the onboarding closed
CLOCK_SLACK = 300  # a flag dated further in the future than this is a wrong clock: no wait
STATES = ("pending", "pulling", "ready", "failed")
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
    reason = data.get("reason")
    return {"state": data["state"], "reason": reason[:60] if isinstance(reason, str) else "", "since": _epoch(data.get("since"))}


def _epoch(stamp: object) -> float | None:
    """Epoch seconds of an ISO UTC stamp (`Z` or an offset), None when it is not one."""
    if not isinstance(stamp, str):
        return None
    try:
        when = datetime.fromisoformat(stamp.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return when.timestamp() if when.tzinfo else when.replace(tzinfo=timezone.utc).timestamp()


def verdict(closed_at: float | None, home: Path | None = None, now: float | None = None,
            tier: str | None = None) -> dict | None:
    """What the Capitano's start has to know about the tools, or None when there is nothing to say.

    `closed_at` is the time (epoch seconds) at which the onboarding closed, None when it is not known: then there is no
    wait (a start with no clock to measure from never holds the Capitano). The wait runs from the later of that and the
    start of the pull (`since`): a pull that began after the onboarding closed has its own ten minutes. The answer carries `wait` (do not start
    yet, `left` seconds to go) or `degraded` (`timeout` or `failed`: start, with the tools missing).
    """
    if (image_tier() if tier is None else tier) != "core":
        return None
    seen = read_state(home)
    if seen is None:
        return None
    out: dict = {"state": seen["state"], "wait": False, "degraded": None}
    if seen["state"] == "failed":
        out.update(degraded="failed", reason=seen["reason"])
        return out
    if closed_at is None:
        return None
    started = max(closed_at, seen["since"]) if seen["since"] else closed_at
    age = (time.time() if now is None else now) - started
    if age < -CLOCK_SLACK or age >= WAIT_SECONDS:
        out["degraded"] = "timeout"
    else:
        out.update(wait=True, left=int(WAIT_SECONDS - max(age, 0)))
    return out


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
