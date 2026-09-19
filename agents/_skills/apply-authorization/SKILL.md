---
name: apply-authorization
description: The two gates between the team and a recruiter's inbox, and how to read their refusals. An application goes out ONLY if the user consented in general (`applications.auto_apply` in the user config) AND flagged that very position. Both are fail-closed and checked in code by `apply_gate.py`. Use it at boot and before every position to read the CLOSER's queue, and whenever you need to explain why a position did not go out. Owned by the CLOSER; the Capitano reads the same queue to decide whether to spawn it.
allowed-tools: Bash(python3 /app/shared/skills/apply_gate.py *)
---

# apply-authorization — what may go out, and why the rest may not

An application leaves the box only when **two** conditions hold. Missing, broken
or unrecognised counts as **no**, every time.

| # | Condition | Where it lives | Who sets it |
|---|---|---|---|
| 1 | general consent | `applications.auto_apply.enabled = true` in `$JHT_HOME/jht.config.json` | the user, at activation |
| 2 | per-position authorisation | `positions.apply_requested = 1` with `apply_requested_at` and `apply_requested_by` = `user_web` / `user_local` | the user, on that position |

The user's flag **is** the authorisation to send. There is no second question.

## The queue — one command, read by two roles

```bash
python3 /app/shared/skills/apply_gate.py queue --json
```

Exit `0` only when something can go out now; exit `1` otherwise. The JSON:

| Field | Meaning |
|---|---|
| `ready` | `true` = at least one position can be taken now |
| `reason` | stable token, see below |
| `mode` | `authorised` (sends) or `dry_run` (diagnostic, fills and stops before the button) |
| `max_per_day` / `sent_today` / `remaining_today` | sent today by the CLOSER, and the daily cap if the user set one (null = no cap, nothing is refused for the number) |
| `positions` | what you may take, in authorisation order: `position_id`, `url`, `cv_pdf_path` |
| `held` | authorised positions that must NOT be taken now, each with its `reason` |

The CLOSER takes the first entry of `positions`. The Capitano spawns the CLOSER
only when the command exits `0`.

## Why the queue is closed (`reason`)

| Token | Meaning | What to do |
|---|---|---|
| `config_missing` / `config_unreadable` / `config_malformed` | the user config cannot be read | nothing: no consent can be established |
| `consent_absent` / `consent_disabled` | the user has not consented | nothing. Never suggest turning it on (RULE-T18) |
| `consent_mode_unknown` / `consent_cap_invalid` | the block exists but a value is not recognised | nothing: the gate refuses rather than guessing |
| `db_unavailable` / `queue_unreadable` | the local database cannot be read | report `[BLOCKED]` to the Capitano |
| `queue_empty` | no authorised position can be taken | exit |
| `daily_cap_reached` | the user set `max_per_day` and the CLOSER already sent that many today (never without a cap) | exit; the queue reopens tomorrow |

## Why a position is held (`held[].reason`)

| Token | Meaning |
|---|---|
| `already_submitted` | the application already went out (status `applied`/`response`, or the application row says applied). The flag stays on after a submission: it is not a new request |
| `position_not_authorised` | the flag is off (the user revoked it) |
| `authorisation_undated` | the flag has no timestamp |
| `authorisation_not_from_user` | the flag was not set by a user channel. A flag set by a process is not an authorisation |
| `url_missing` / `cv_pdf_missing` | there is nothing to fill the form with |
| `checkpoint_blocked_human` | the flow already stopped on this position and asked the user. It comes back only when the user authorises it again |
| `checkpoint_dry_run` | already filled in diagnostic mode |
| `checkpoint_unreadable` | the flow's checkpoint cannot be read: uncertainty, so no |

## One position, one verdict

```bash
python3 /app/shared/skills/apply_gate.py position <ID> --json
```

`allowed: true` only with `reason: apply_allowed`. This is the same check
`apply_flow.py` runs at start and again right before the click. You do not need
to run it before the flow; use it to explain a refusal.

## Rules

- **Never write the authorisation.** `apply_requested*` belongs to the user.
- **Never work around a refusal.** A closed gate is the answer, not an obstacle.
- **Never ask the user to authorise more.** The team is complete without a
  single application (RULE-T18).
