---
name: apply-flow
description: How the CLOSER runs one authorised application with `apply_flow.py` — the checkpointed state machine (detect, fill, upload_cv, screening, review, submit), the mandatory receipt without which `applied` is never written, and what to do on each result, `blocked_human` first of all. Use it for every position taken from the queue. Owned by the CLOSER.
allowed-tools: Bash(python3 /app/shared/skills/apply_flow.py *), Bash(python3 /app/shared/skills/db_query.py *)
---

# apply-flow — one application, one receipt, no blind retry

```bash
python3 /app/shared/skills/apply_flow.py \
  --position-id "$PID" \
  --url "$URL" \
  --profile "$JHT_HOME/profile/candidate_profile.yml" \
  --cv "$CV"
```

`PID`, `URL` and `CV` come from the latest `apply_gate.py queue` read (skill
`apply-authorization`), never from memory.

## The state machine

```
detect → fill → upload_cv → screening → review → submit → applied
                                                        ↘ blocked_human
```

- Every completed step is saved to a checkpoint (`$JHT_HOME/.cache/apply-flow/<id>.json`).
  After a crash the flow resumes where it was: filling is replayed, the click is not.
- `submit_started` is saved **before** the click. If a process dies after that
  line, the outcome is unknown, and an unknown outcome is never clicked again:
  the flow checks the page for a confirmation and, without one, blocks with
  `submit_outcome_unknown`.
- The gate is checked at start **and** immediately before the click. A flag
  revoked while the form was being filled stops the submission.
- Today the only complete recipe is **Ashby**. Any other platform blocks for a human.

## The receipt

`applied` is written only when the flow holds **both**:

1. a screenshot of the confirmation page, and
2. a confirmation URL or confirmation text.

Then the flow itself records the application with `applied_via = agent_closer`,
and reads the row back to check the write happened. Nobody else writes that
state: not you, not the Capitano.

## Reading the result

One JSON line on stdout: `status`, `state`, `reason`, `receipt`.

| `status` | Exit | Meaning | What you do |
|---|---|---|---|
| `applied` | 0 | sent, receipt stored, state recorded | next position |
| `dry_run` | 0 | `mode: dry_run`: filled, stopped before the button, nothing sent | next position |
| `denied` | 1 | the gate refused (consent off, flag revoked, already sent) | next position; never retry |
| `blocked_human` | 3 | a human is needed; the user has already been notified | next position; never retry |
| `error` | 2 | profile or CV unreadable, bad arguments | stop: `[BLOCKED]` to the Capitano |

## `blocked_human` — what it means and what you do

The flow stops on anything it cannot do with certainty:

| `reason` (examples) | Typical cause |
|---|---|
| `required_answer_missing` / `required_profile_field_missing` / `required_field_unanswered` | a required field has no saved answer — the user must add it to `application_answers` |
| `captcha` / `two_factor` | the site wants to verify a human |
| `unknown_required_control` / `answer_type_unknown` / `answer_option_unknown` / `answer_not_accepted` | a field the recipe cannot fill with a saved answer |
| `upload_rejected` / `resume_field_missing` / `cv_missing` | the CV cannot be attached |
| `ats_unsupported` / `ats_conflict` / `ashby_dom_unrecognised` | no recipe for this page yet |
| `page_unavailable` / `browser_uncertainty` | the page or the browser failed mid-flow |
| `receipt_missing` / `receipt_incomplete` / `confirmation_ambiguous` | submit was clicked but the confirmation is not certain |
| `submit_outcome_unknown` | a previous run started submit and left no receipt |
| `applied_record_failed` | the receipt exists but the state could not be recorded — the application most likely went out |

What you do, always the same:

1. **Nothing on that position.** The flow already wrote the checkpoint and
   notified the user through `jht-notify-user`. Do not notify them again.
2. **Do not retry it.** Not now, not "one more time in a few minutes". The queue
   holds it (`checkpoint_blocked_human`) until the user authorises it again.
3. **Move to the next position** of the queue.

Retrying a blocked position is the blind attempt this design exists to prevent:
on a captcha it burns the user's account, on an unknown outcome it sends a
second letter to the same recruiter.

## Checking an application afterwards

```bash
python3 /app/shared/skills/db_query.py application "$PID"
```

`applied_via: agent_closer` and a non-empty `applied_at` = the flow recorded it.
