#!/usr/bin/env python3
"""Report factual deadlines only after an explicit user request.

Market observation is a complete use of JHT. This helper has no scheduled or
push-notification mode: an agent may run it only while answering a user's
explicit question about a position or an application deadline.

CLI:
    python3 /app/shared/skills/expiration_alerts.py --user-requested
    python3 /app/shared/skills/expiration_alerts.py --user-requested --quiet
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import date, datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _db import get_db, ensure_schema  # type: ignore


HORIZON_DAYS = 3


def _parse_deadline(deadline_str: str | None) -> date | None:
    if not deadline_str:
        return None
    try:
        return date.fromisoformat(deadline_str[:10])
    except (ValueError, TypeError):
        return None


def find_deadlines(quiet: bool = False) -> int:
    today = datetime.now(timezone.utc).date()
    conn = get_db()
    ensure_schema(conn)

    rows = conn.execute("""
        SELECT a.id AS app_id, p.id AS pos_id, p.company, p.title,
               p.deadline, a.critic_score, a.cv_pdf_path
          FROM applications a
          JOIN positions p ON p.id = a.position_id
         WHERE a.status = 'ready'
           AND p.deadline IS NOT NULL
           AND TRIM(p.deadline) != ''
    """).fetchall()

    output_lines = []

    for r in rows:
        deadline = _parse_deadline(r["deadline"])
        if not deadline:
            continue
        days_left = deadline.toordinal() - today.toordinal()
        if days_left < 0 or days_left > HORIZON_DAYS:
            continue
        score = r["critic_score"]
        score_str = f"(PASS {score:.1f})" if score is not None else "(PASS)"
        when = (
            "TODAY" if days_left == 0
            else "TOMORROW" if days_left == 1
            else f"in {days_left} days"
        )
        line = (
            f"[DEADLINE] {r['company']} {r['title']} {score_str} — "
            f"expires {deadline.isoformat()} ({when})."
        )
        output_lines.append(line)

    if not quiet or output_lines:
        for line in output_lines:
            print(line)

    return 0 if output_lines else (0 if not quiet else 1)


def main(argv):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--user-requested", action="store_true",
                   help="Required: confirms an explicit user request for deadline information.")
    p.add_argument("--quiet", action="store_true",
                   help="No stdout if there are no matching deadlines (exit 1).")
    args = p.parse_args(argv)

    if not args.user_requested:
        p.error("--user-requested is required; deadline information is only shown on request")

    return find_deadlines(quiet=args.quiet)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
