---
name: apply-flow
description: How the CLOSER runs one authorised application with `apply_flow.py` — the checkpointed state machine (detect, fill, upload_cv, screening, review, submit), the mandatory receipt without which `applied` is never written, and what to do on each result, `blocked_human` first of all. Use it for every position taken from the queue. Owned by the CLOSER.
allowed-tools: Bash(python3 /app/shared/skills/apply_flow.py *), Bash(python3 /app/shared/skills/application_answers.py *), Bash(python3 /app/shared/skills/db_query.py *), Bash(python3 /app/shared/skills/closer_notices.py *)
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
- Three complete recipes today: **Ashby**, **Greenhouse** (only its three public hosts, `job-boards.greenhouse.io`, `job-boards.eu.greenhouse.io`, `boards.greenhouse.io`, over HTTPS; the page is re-checked after every step) and **Lever** (only `jobs.lever.co` and `jobs.eu.lever.co`, over HTTPS, re-checked the same way). LinkedIn: "apply on company website" continues on that site with its recipe; Easy Apply signs in with the user's account (session kept, verification code on Telegram) and walks the dialog. Any other platform blocks for a human.

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
| `retry_later` | 5 | the vacancy page did not answer for now (5xx, timeout); not a stop, nobody notified; the checkpoint holds `retry_after` | next position; the queue gives this one back after `retry_after` by itself — never rerun it before |
| `blocked_human` | 3 | a human is needed; the user has already been notified | next position; never retry |
| `blocked_human` missing answers (`essential_facts_missing` with `missing`, `required_answer_missing` with `pending_question`) | 3 | not a stop and nothing was asked: the flow needs answers it does not have | work each one out from profile, CV and vacancy and save it (`application_answers.py save … --basis …`), then run the flow again; only with no basis `application_answers.py ask --position-id $PID --key K` (CLOSER prompt, CL-08). A question you asked holds the position until the user answers, a day per question at most |
| `email_channel` | 4 | the application control is a `mailto:` link, not a form; the checkpoint holds `channel: email` and the raw `mailto_href` | run `email_application.py send` for this position as the `email-application-flow` skill says: it reads this checkpoint; never fill a web form or write the email by hand |
| `error` | 2 | profile or CV unreadable, bad arguments | stop: `[BLOCKED]` to the Capitano |

## `blocked_human` — what it means and what you do

The flow stops on anything it cannot do with certainty:

| `reason` (examples) | Typical cause |
|---|---|
| `required_answer_missing` / `required_profile_field_missing` / `required_field_unanswered` | a required field has no saved answer; `pending_question` names it (key, label, type, options, scope). Nothing is sent to the user until you run `ask`; a saved answer resumes the flow from the checkpoint |
| `essential_facts_missing` / `essential_facts_unavailable` | before the first run of a position, a fact almost every form asks for is unknown (start date, notice period, work authorisation, sponsorship, salary, relocation, phone); `missing` lists the keys. Nothing was asked and nothing is held |
| `captcha` / `two_factor` | the site wants to verify a human |
| `vacancy_closed` | the vacancy is no longer open: a page with no form, no Apply control and no email channel says so, or the URL redirected to the job list, careers or home page; nothing was filled and nothing was sent. A final stop: a rerun does not reopen the page until the user authorises the position again. A screenshot of the page is saved next to the checkpoint (`stop_screenshot`) |
| `unknown_required_control` / `answer_type_unknown` / `answer_option_unknown` / `answer_not_accepted` | a field the recipe cannot fill with a saved answer |
| `upload_rejected` / `resume_field_missing` / `cv_missing` | the CV cannot be attached |
| `cv_pdf_layout_bad` | the CV PDF failed the visual check (`pdf_layout_check.py`: text squeezed into a narrow column, a nearly empty page, more than 2 pages, fonts not embedded, body font too small): nothing was attached and nothing was sent. The Writer must render it again; never attach it by hand. The preview of page 1 is saved next to the checkpoint: look at it |
| `cv_pdf_check_unavailable` | the CV PDF could not be measured (poppler missing in the container, file unreadable): nothing was attached and nothing was sent — an unmeasured CV is not a pass. The remedy is on the box, not the Writer: report it to the Capitano |
| `ats_unsupported` / `ats_conflict` / `ashby_dom_unrecognised` / `greenhouse_dom_unrecognised` / `ashby_form_missing` / `ashby_apply_ambiguous` / `greenhouse_form_missing` / `greenhouse_form_ambiguous` / `lever_dom_unrecognised` / `lever_form_missing` / `lever_apply_ambiguous` / `lever_form_ambiguous` / `generic_dom_unrecognised` | no recipe for this page yet, or the form is not the one the recipe knows |
| `greenhouse_redirect_untrusted` | the Greenhouse page left its three trusted hosts during the flow |
| `lever_redirect_untrusted` | the Lever page left `jobs.lever.co` / `jobs.eu.lever.co` during the flow |
| `linkedin_dom_unrecognised` / `linkedin_form_missing` / `linkedin_form_ambiguous` / `linkedin_step_unrecognised` / `linkedin_apply_control_missing` / `linkedin_apply_ambiguous` / `linkedin_session_unavailable` / `linkedin_login_unrecognised` | the LinkedIn vacancy or its Easy Apply dialog is not the one the recipe knows |
| `linkedin_credentials_missing` | `$JHT_HOME/credentials/linkedin.json` (`email`, `password`) is missing, not a regular 0600 file of this user, or empty: the user creates it with the credentials script. Never ask for the password in a chat |
| `linkedin_login_failed` | LinkedIn refused the sign-in twice: nothing is tried again until the user writes new credentials |
| `linkedin_login_code_missing` / `linkedin_login_code_undelivered` | the LinkedIn verification code was asked on Telegram and did not arrive in time (or the request did not reach Telegram): a new run asks for a new code |
| `linkedin_challenge` | LinkedIn shows a captcha or security check: the user solves it on the live screen, then authorises the position again |
| `linkedin_redirect_untrusted` / `application_redirect_untrusted` | the LinkedIn page left `www.linkedin.com`, or the company address it gives is not an HTTPS page outside LinkedIn (or a second handoff) |
| `linkedin_follow_not_cleared` | the "follow the company" box could not be cleared before Submit: nothing is sent |
| `linkedin_throttled` / `linkedin_login_retry` / `linkedin_interval_invalid` | **denied, not blocked**: LinkedIn applications are spaced out (`linkedin_min_interval_minutes`, default 20), the sign-in failed once and the next run tries once more, or that setting is not a whole number of minutes. The queue retries by itself |
| `mailto_ambiguous` / `mailto_invalid` / `application_form_ambiguous` / `application_field_outside_form` / `submit_outside_form` | two different mailto application addresses, or the application form, its fields or its submit button cannot be pinned to one single form (newsletter, footer, demo forms are never part of it) |
| `form_error` / `field_invalid` / `submit_unavailable` | the form reports an error, a field format is rejected, or the submit button is missing or disabled |
| `url_refused` / `checkpoint_invalid` | the application URL failed the public-address guard, or the saved checkpoint is unreadable |
| `page_unavailable` / `browser_uncertainty` | the page or the browser failed mid-flow |
| `page_not_found` / `bot_protection` / `page_temporarily_unavailable` | the vacancy page is gone (404/410 with no closed-vacancy evidence), an anti-bot wall stopped the browser (after one try in a visible browser), or the site did not answer three times in a day. A single 5xx or timeout is NOT a stop: the checkpoint says `retry_later`, the queue gives the position back later by itself, and nobody is notified. The checkpoint keeps `http_status` and `final_url` |
| `receipt_missing` / `receipt_incomplete` / `confirmation_ambiguous` | submit was clicked but the confirmation is not certain |
| `receipt_screenshot_failed` | the confirmation was visible but its screenshot could not be saved |
| `submit_outcome_unknown` | a previous run started submit and left no receipt |
| `applied_record_failed` | the receipt exists but the state could not be recorded — the application most likely went out |
| `login_required` / `account_creation` | the site wants a sign-in or a new account before the application: the CLOSER never signs in and never creates accounts |
| `generic_form_missing` / `generic_form_unrecognised` / `application_form_embedded` / `application_redirect_untrusted` | a company site: no application form, a form the generic recipe cannot pin down, a form embedded from another host (the detail names it), or an Apply control that leads to a site with no recipe |
| `cover_letter_required` / `pre_submit_screenshot_failed` | the form requires a cover-letter file · the filled form could not be photographed before the click |

What you do for every other reason (the missing answers are above):

1. **Nothing on that position.** The flow already wrote the checkpoint and
   notified the user through `jht-notify-user`. Do not notify them again.
2. **Do not retry it.** Not now, not "one more time in a few minutes". The queue
   holds it (`checkpoint_blocked_human`) until the user authorises it again.
3. **Move to the next position** of the queue.

Retrying a blocked position is the blind attempt this design exists to prevent:
on a captcha it burns the user's account, on an unknown outcome it sends a
second letter to the same recruiter.

## Company career sites — the generic recipe

When no ATS is recognised and the page is not a `mailto:` channel, the flow uses
`apply_generic.py` on the company's own site: it finds the ONE application form
(a CV upload, or a name and an email with an Apply button — also behind an Apply
button or on a linked page of the same site), fills fields from their labels
(profile for name, email, phone, links; saved answers for the questions), and
never touches a newsletter, contact, search or login form. The filled form is
photographed before the click; without a confirmation it recognises (text or
URL) the result is `submit_outcome_unknown`, never a second click. An Apply
control that leads to a known ATS hands the position to that recipe.

**One summary per round.** Stops that are a property of the site
(`ats_unsupported`, `ats_conflict`, `linkedin_easy_apply`,
`application_form_embedded`, `page_not_found`, `bot_protection`, `page_temporarily_unavailable`) are not notified one by one: they wait for the
summary you send at STEP 6 with `python3 /app/shared/skills/closer_notices.py flush`.
Every notice reaches the user in the language of their profile.

## Checking an application afterwards

```bash
python3 /app/shared/skills/db_query.py application "$PID"
```

`applied_via: agent_closer` and a non-empty `applied_at` = the flow recorded it.
