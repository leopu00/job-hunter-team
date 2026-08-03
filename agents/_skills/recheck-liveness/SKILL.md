---
name: recheck-liveness
description: Check whether a job posting is STILL OPEN without producing false-opens. Replaces the ad-hoc curl (HTTP 200 = "open") that does NOT see the expiry rendered in JavaScript (Ashby/Workday/Greenhouse) nor the LinkedIn authwall (200 for closed ones too). ALWAYS use it in the recheck; never set is_open by hand off a single HTTP 200.
allowed-tools: Bash(python3 /app/shared/skills/recheck_liveness.py *), Bash(python3 /app/shared/skills/db_update.py *)
---

# recheck-liveness — "is the job still open?", done properly

## Why it exists
The old recheck was an improvised curl (`code=200 marker=none → open`). curl only
sees the RAW HTML, so on many ATS (Ashby/Workday/Greenhouse) and on LinkedIn the
"expired/closed" status is rendered in JS or sits behind an authwall → curl does
not see it → `is_open=1` on jobs that are already CLOSED. Dirty data downstream
(score, map).

## How to use it
```sh
python3 /app/shared/skills/recheck_liveness.py "<url>" "[optional title]"
```
JSON output + exit code:
| state | exit | meaning |
|---|---|---|
| `OPEN` | 0 | verified open |
| `CLOSED` | 1 | closed/expired (404/410 or closed-marker) |
| `OPEN_UNVERIFIED` | 2 | impossible to verify (JS/authwall host + browser down) |

## What it does (tiered)
1. fast **curl**: HTTP code + scan for closed-markers (EN+IT) + 404/410.
2. **ATS-JS / LinkedIn** host or ambiguous code → **escalate to the BROWSER**
   (Playwright render) and re-scan the markers on the RENDERED HTML.
3. still uncertain → **`OPEN_UNVERIFIED`** — NEVER a false-open (`resilience` pattern).

## Golden rule
- `is_open=1` **ONLY** if `state == OPEN`.
- `state == CLOSED` → `status='expired'` + a note carrying the `evidence`.
- `state == OPEN_UNVERIFIED` → **leave `is_open` unchanged** + an `[OPEN_UNVERIFIED]` note;
  do NOT pass it off as open.
- The ad-hoc "200 = open" curl is **forbidden** as a way to decide liveness.

## How to record the outcome
Record every check in the history, **even when it changes nothing**.
`last_checked` only retains the latest date and overwrites the previous one;
without an event, nobody can tell how many times a position was checked or how
many attempts ended without a conclusion.

Map the probe `state` one-to-one to `--outcome`:

| state | command |
|---|---|
| `OPEN` | `--action liveness_check --outcome confirmed_open --is-open true` |
| `CLOSED` | `--action liveness_check --outcome confirmed_closed --is-open false --status expired` |
| `OPEN_UNVERIFIED` | `--action liveness_check --outcome inconclusive` (**no `--is-open`**) |

```sh
python3 /app/shared/skills/db_update.py position 412 --last-checked now \
  --action liveness_check --outcome confirmed_open --is-open true \
  --evidence-url "<url>" --evidence-code 200
```

`--evidence-url` and `--evidence-code` are optional but useful: repeated 403s
describe an authwall—a source problem—not a dead posting.

> ⛔ With `--outcome inconclusive`, the DB **rejects** `--is-open false` and
> `--status excluded|expired`. Do not work around this: not knowing is not the
> same as knowing that a posting expired, and closing on doubt silently loses an
> opportunity. Leave it alive; the attempt remains in history and can be retried.

To inspect a position's history, including its streak of inconclusive checks
(a problematic-source signal, **not** a reason to discard the posting):
```sh
python3 /app/shared/skills/db_query.py check-history 412
```
