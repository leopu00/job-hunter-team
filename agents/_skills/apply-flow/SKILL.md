---
name: apply-flow
description: How the CLOSER runs one authorised application with `apply_flow.py` — the checkpointed state machine (detect, fill, upload_cv, screening, review, submit), the mandatory receipt without which `applied` is never written, and what to do on each result, `blocked_human` first of all. Use it for every position taken from the queue. Owned by the CLOSER.
allowed-tools: Bash(python3 /app/shared/skills/apply_flow.py *), Bash(python3 /app/shared/skills/application_answers.py *), Bash(python3 /app/shared/skills/db_query.py *)
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
- Two complete recipes today: **Ashby** and **Greenhouse** (only its three public hosts, `job-boards.greenhouse.io`, `job-boards.eu.greenhouse.io`, `boards.greenhouse.io`, over HTTPS; the page is re-checked after every step). Any other platform blocks for a human.

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
| `blocked_human` waiting for answers (`essential_facts_missing`, `required_answer_missing`, `required_profile_field_missing`, `required_field_unanswered`) | 3 | not a final stop: the user was asked once, the queue holds the position (`essential_answers_pending` / `checkpoint_blocked_human`) until the answers are in `jobs.db`, a day per question at most (asked twice at most, then the flow goes on) | next position; on the `[BRIDGE INFO]` that says the user answered, re-read the queue: the position is back in `positions` |
| `email_channel` | 4 | the application control is a `mailto:` link, not a form; the checkpoint holds `channel: email` and the raw `mailto_href` | run `email_application.py send` for this position as the `email-application-flow` skill says: it reads this checkpoint; never fill a web form or write the email by hand |
| `error` | 2 | profile or CV unreadable, bad arguments | stop: `[BLOCKED]` to the Capitano |

## `blocked_human` — what it means and what you do

The flow stops on anything it cannot do with certainty:

| `reason` (examples) | Typical cause |
|---|---|
| `required_answer_missing` / `required_profile_field_missing` / `required_field_unanswered` | a required field has no saved answer — the user was asked once (Telegram first, dashboard too); the reply is saved in `jobs.db` and the flow resumes from the checkpoint |
| `essential_facts_missing` / `essential_facts_unavailable` | before the first run of a position, a fact almost every form asks for is unknown (start date, notice period, work authorisation, sponsorship, salary, relocation, phone); each one was asked once and nothing is held: the position runs again once the answers exist |
| `captcha` / `two_factor` | the site wants to verify a human |
| `unknown_required_control` / `answer_type_unknown` / `answer_option_unknown` / `answer_not_accepted` | a field the recipe cannot fill with a saved answer |
| `upload_rejected` / `resume_field_missing` / `cv_missing` | the CV cannot be attached |
| `ats_unsupported` / `ats_conflict` / `ashby_dom_unrecognised` / `greenhouse_dom_unrecognised` / `ashby_form_missing` / `ashby_apply_ambiguous` / `greenhouse_form_missing` / `greenhouse_form_ambiguous` | no recipe for this page yet, or the form is not the one the recipe knows |
| `greenhouse_redirect_untrusted` | the Greenhouse page left its three trusted hosts during the flow |
| `mailto_ambiguous` / `mailto_invalid` / `application_form_ambiguous` / `application_field_outside_form` / `submit_outside_form` | two different mailto application addresses, or the application form, its fields or its submit button cannot be pinned to one single form (newsletter, footer, demo forms are never part of it) |
| `form_error` / `field_invalid` / `submit_unavailable` | the form reports an error, a field format is rejected, or the submit button is missing or disabled |
| `url_refused` / `checkpoint_invalid` | the application URL failed the public-address guard, or the saved checkpoint is unreadable |
| `page_unavailable` / `browser_uncertainty` | the page or the browser failed mid-flow |
| `receipt_missing` / `receipt_incomplete` / `confirmation_ambiguous` | submit was clicked but the confirmation is not certain |
| `receipt_screenshot_failed` | the confirmation was visible but its screenshot could not be saved |
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
