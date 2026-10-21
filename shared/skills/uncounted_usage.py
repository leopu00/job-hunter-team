"""Usage the meters do not count: sessions of a harness they cannot read.

token-meter.py and sentinel-bridge.py read the session files of the provider
CLIs (Claude Code, Codex, Kimi). An agent started on the pi harness
(JHT_AGENT_HARNESS_<ROLE>=pi, see .launcher/spawn-lib.sh) writes its sessions
under `$JHT_HOME/.pi/agent/sessions`, which neither of them reads.

With a few pi agents the 5h and weekly limits stay right, because they are
measured on the account and the provider CLIs of the other agents keep
recording them. The per-session token counts, though, miss whatever pi
spent. This module does not count those tokens: it declares that they are
missing, so a reader of the meters can tell "no usage" from "usage we do not
see".
"""

from __future__ import annotations

import os
from pathlib import Path

# Same folder as jht_pi_agent_dir in .launcher/spawn-lib.sh, plus pi's own
# default `sessions` subfolder.
PI_SESSIONS = (".pi", "agent", "sessions")
NOTE = "pi sessions are not counted by the token meter or the usage bridge"


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
