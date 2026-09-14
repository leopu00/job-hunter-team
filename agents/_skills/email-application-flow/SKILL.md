---
name: email-application-flow
description: How the CLOSER sends one authorised application by email with `email_application.py` when `apply_flow.py` answers `email_channel` (the Apply control is a `mailto:` link) — inspect, preflight, draft, send, status; the gate checked again right before the transport; `send_started` before the irreversible command; the receipt without which `applied` is never written. Use it for every position whose flow ends in `email_channel`. Owned by the CLOSER.
allowed-tools: Bash(python3 /app/shared/skills/email_application.py *)
---

# email-application-flow — one email, one receipt, no blind retry

Use it **only** for a position of the latest queue whose `apply_flow.py` run
answered `email_channel` (exit 4). The browser flow left the raw `mailto_href`
in its checkpoint; this skill reads it. You never open a mail client, never
write an email by hand, never copy the address anywhere else.

```bash
python3 /app/shared/skills/email_application.py send --position-id "$PID" --json
```

`send` runs everything in order and stops at the first problem. The other
commands are for reading, not for working around a stop:

| Command | What it does |
|---|---|
| `inspect` | reads and parses the mailto link (To, CC, subject, body) |
| `preflight` | inspect + gate + daily cap + transport + CV + cover letter + required facts |
| `draft` | preflight + the deterministic draft; nothing is sent |
| `send` | draft + gate again + `send_started` + transport + receipt + `applied` |
| `status` | the last attempt and its state, read only |

`--dry-run` stops before the transport and changes nothing on the application.

## What the command guarantees

- **The flag is the authorisation.** The gate decides in preflight and again
  immediately before the transport. A flag revoked or a cap reached in between
  means nothing is sent (`denied`).
- **Nothing is invented.** Recipients come only from the link. Name, contact
  email and any fact the vacancy asks for (availability, salary expectation)
  come only from the candidate profile; a missing one is `required_fact_missing`.
- **The CV is always attached**, after size, PDF and hash checks. A cover letter
  is attached only when the vacancy asks for one; if none exists, the Scrittore
  is asked through the normal writer request and the flow stops.
- **One letter at most.** `send_started` is recorded before the server receives
  the message. After it, a timeout or an unclear answer is
  `send_outcome_unknown`: never retried, not even by a new run.
- **`applied` only after acceptance**, with `applied_via = agent_closer_email`,
  written by the command itself after the receipt is stored.

## Reading the result

One JSON line: `state`, `reason`, `detail`, plus data.

| `state` | Exit | Meaning | What you do |
|---|---|---|---|
| `sent` | 0 | accepted by the server, receipt stored, application recorded | next position |
| `draft_ready` | 0 | dry run: draft and attachments valid, nothing sent | next position |
| `denied` | 1 | the gate refused (`flag_revoked`, `gate_mode_changed`, `daily_cap_reached`, `duplicate_attempt`) | next position; never retry |
| `blocked_human` | 1 | a human is needed; the stop is in the round's summary | next position; never retry |
| `send_outcome_unknown` | 3 | the email may have gone out | next position; never retry |
| `receipt_incomplete` | 3 | accepted, but the receipt or the record is incomplete; with some recipients refused the letter has probably arrived | next position; never retry |
| `error` | 2 | database, profile or checkpoint unreadable | stop: `[BLOCKED]` to the Capitano |

⚠️ These exit codes are **not** those of `apply_flow.py` (there `denied` is 1 and
`blocked_human` is 3). Decide on `state`, never on the number.

## `blocked_human` reasons

| `reason` | Typical cause |
|---|---|
| `transport_missing` | no email transport configured, or its secret file is missing or not 0600 |
| `auth_failed` | the mail server refused the credentials |
| `sender_unverified` | the sender address is not the authenticated account or a verified sender |
| `mailto_missing` | no browser checkpoint in `email_channel` for this position: run `apply_flow.py` first; the page is never read for an address |
| `recipient_ambiguous` / `mailto_invalid` | zero or several recipients, a forbidden header, CR/LF in a header; also quoted local parts and international (IDN) addresses, which are not supported |
| `recipient_refused` | the server refused the recipients before anything was sent: a new attempt, after the user acts, is not a duplicate |
| `required_fact_missing` | the vacancy asks for a fact the profile does not state |
| `cv_missing` | no readable PDF CV for this application |
| `cover_letter_required` | the vacancy asks for a cover letter; the Scrittore has been asked |

What you do, always the same:

1. **Nothing on that position.** The command put the stop in the round's summary (`closer_notices.py flush` at STEP 6).
2. **Do not retry it.** The queue holds it (`email_blocked_human`,
   `email_send_outcome_unknown`, ...) until the user acts.
3. **Move to the next position** of the queue.

## Never

- send an email any other way than this command;
- run `send` on a position that is not in the latest queue read;
- retry after `send_started`, `send_outcome_unknown` or `receipt_incomplete`;
- write `applied`, `applied_via` or `apply_requested` yourself;
- paste the SMTP password, or ask the user for it in chat.

## Checking afterwards

```bash
python3 /app/shared/skills/email_application.py status --position-id "$PID" --json
```

`state: sent` with a `message_id` = the command recorded the email send.
