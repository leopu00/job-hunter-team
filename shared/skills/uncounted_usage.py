"""Usage the usage bridge does not see: sessions of a harness whose files it does not read.

sentinel-bridge.py measures the 5h and weekly limits from what the provider CLIs write (Claude Code, Codex, Kimi).
An agent started on the pi harness (JHT_AGENT_HARNESS_<ROLE>=pi, see .launcher/spawn-lib.sh) writes its sessions
under `$JHT_HOME/.pi/agent/sessions`, which the bridge does not read. The token meter does (pi_sessions.py counts
tokens and cost per call), so for the per-session numbers there is no gap any more.

With a few pi agents the limits stay right, because they are measured on the account and the provider CLIs of the
other agents keep recording them. With ONLY pi agents there is nothing to read the limits from (see quota_data.py:
the NO-QUOTA mode). This module does not count anything: it declares that pi worked in the window, so a reader of
the bridge state can tell "no usage" from "usage the limits do not come from".
"""

from __future__ import annotations

import os
from pathlib import Path

# Same folder as jht_pi_agent_dir in .launcher/spawn-lib.sh, plus pi's own
# default `sessions` subfolder.
PI_SESSIONS = (".pi", "agent", "sessions")
NOTE = "pi sessions are not read by the usage bridge (the token meter counts them)"


def pi_sessions(jht_home: Path, since_ts: float | None = None) -> int:
    """How many pi session files changed since `since_ts` (all when None)."""
    root = Path(jht_home).joinpath(*PI_SESSIONS)
    count = 0
    # os.walk on a missing or unreadable folder yields nothing: 0, not an error.
    for folder, _dirs, files in os.walk(root):
        for name in files:
            if not name.endswith(".jsonl"):
                continue
            if since_ts is not None:
                try:
                    if os.stat(os.path.join(folder, name)).st_mtime < since_ts:
                        continue
                except OSError:
                    continue
            count += 1
    return count


def declared_gap(jht_home: Path, since_ts: float | None = None) -> dict | None:
    """`{"pi_sessions": N, "note": ...}` when pi worked in the window, else None."""
    count = pi_sessions(jht_home, since_ts)
    if count == 0:
        return None
    return {"pi_sessions": count, "note": NOTE}
