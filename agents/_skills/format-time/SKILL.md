---
name: format-time
description: Convert UTC timestamps to the user's timezone before showing them in chat, charts, Telegram, or any user-facing output. Use this helper whenever you would otherwise write a raw `strftime("%H:%M")` of a UTC datetime in something the user reads.
allowed-tools: Bash(python3 *)
---

# format-time — UTC → user timezone in user-facing output

Bug #15: the container runs in UTC, the user lives in CEST/CET. Without
conversion every "reset at 03:11" in chat or charts forces the user to
do `+2` in their head — and sometimes the user says *"qui sono le
3:21"* and the Capitano has to scramble for the conversion.

## When to use

Apply it whenever you produce a timestamp the **user** will read:

- Telegram messages from any agent (Capitano, Assistente, Mentor)
- Matplotlib chart subtitles, x-tick labels, legends
- Dashboard widgets that show time
- Log lines or summaries returned to the user

**Skip** when:
- Writing internal log files (`messages.jsonl`, `sentinel-data.jsonl`,
  `dottore-actions.jsonl`) — they stay UTC ISO for cross-agent parsing.
- Writing DB columns — keep UTC ISO so the dashboard can format on
  render.
- Computing intervals / deltas — work in UTC, format only at the edges.

## How to use

```python
from shared.skills.format_time import fmt_user, fmt_user_with_utc
from datetime import datetime, timezone

now = datetime.now(timezone.utc)
print(fmt_user(now))            # "03:21 CEST"
print(fmt_user_with_utc(now))   # "03:21 CEST (01:21 UTC)"
```

Or, from bash:

```bash
python3 /app/shared/skills/format_time.py --now
python3 /app/shared/skills/format_time.py --iso 2026-05-17T01:14:00Z --with-utc
```

## When to show both user-time and UTC

In **operational charts** that an oncall engineer (or you, debugging)
might read alongside the team's UTC logs, prefer `fmt_user_with_utc`
so both are visible:

> *"Now 03:21 CEST (01:21 UTC) — usage 63% — proj 92.2%"*

In **plain Telegram chat** to the user, `fmt_user` alone is usually
enough:

> *"📅 Reset finestra 5h alle 05:11 CEST (~1h 50m)."*

## Where the user timezone comes from

`candidate_profile.yml::timezone` (IANA name, e.g. `Europe/Rome`).
Default `Europe/Rome` if missing — covers ~95% of beta users. To
override per session: `JHT_USER_TZ` env var (read by the helper).

## Anti-patterns

- ❌ `datetime.now().strftime("%H:%M")` in a user-facing string —
  produces the **container** time (UTC) without suffix → user
  confusion.
- ❌ Hand-rolled `+2` math anywhere. Use the helper; DST flips
  Europe/Rome to CET (+1) at the end of October and you will forget.
- ❌ Hard-coding `"CEST"` as suffix — wrong for half the year and
  wrong for non-Italian users.

## See also

- `shared/skills/format_time.py` — implementation.
- `candidate_profile.yml.example` — `timezone:` field docs.
- `docs/internal/2026-05-17-team-strategy-bugs.md` §15 — incident
  reference.
