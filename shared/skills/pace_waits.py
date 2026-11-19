#!/usr/bin/env python3
"""pace_waits.py ROLE... — prints `yes` when one of the roles still waits for its stage of the spending pace, `no` otherwise.

The watchdog of the Dottore asks it before starting the Dottore or the Mantenitore: started before their stage they spend while the
team should wait. Anything that cannot be read is `no` (the start of always)."""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))


def main(argv) -> int:
    try:
        import os
        import pi_spend_cap
        home = os.environ.get("JHT_HOME") or "/jht_home"
        waits = bool({a.upper() for a in argv} & set(pi_spend_cap.waiting(home, time.time())))
    except Exception:  # noqa: BLE001
        waits = False
    print("yes" if waits else "no")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
