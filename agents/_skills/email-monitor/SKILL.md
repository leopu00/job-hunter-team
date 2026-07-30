---
name: email-monitor
description: "Day-start sourcing from the team's DEDICATED mailbox (the user forwards their own job alerts to it). Highest-accuracy source: the alert is already pre-filtered on the user's intent. IMAP poll of ANY platform (LinkedIn/Glassdoor/Indeed + national/city/niche boards), creates positions with the source tag, idempotent by Message-ID. VOLUME is balanced by the Captain (C-16): at day start read the email BEFORE web scraping; on a flood ingest only the salient ones, so the funnel reaches the SCORE."
allowed-tools: Bash(python3 /app/shared/skills/email_monitor.py *), Bash(python3 /app/shared/skills/scout_dedup.py *), Bash(python3 /app/shared/skills/db_insert.py *), Bash(python3 /app/shared/skills/db_query.py *)
---

# email-monitor — reading forwarded job alerts, at day start

The user creates a **dedicated** email address (e.g. `name.jht@gmail.com`) and
sets up **forwarding rules** in their own client that send us the job alerts
(LinkedIn, Glassdoor, Indeed **and any other platform** that notifies by mail).
You read that mailbox and turn the alerts into positions. It is the most
**accurate** source (the alert is already filtered on the target by the user) and
the most **token-cheap** one (no blind scraping).

> 📍 **Optional but recommended.** If it is not configured, the team works as
> before (web sourcing). Nothing is blocked.

## When

- **At the start of the work window** (day-start): read the email **BEFORE** web
  scraping. Overnight alerts are already there.
- Then at most every ~30 min (the IMAP server rate-limits beyond that, and new
  alerts do not arrive more often). Do not poll more frequently.
- Claim the source in STEP 0 (`scout-coord`): `scout_workspace.py claim
  <agent> email:<box>` — one Scout only per mailbox, no collisions.

## Procedure

### 1. Is it configured?
```bash
python3 /app/shared/skills/email_monitor.py status
```
`configured=false` → the mailbox is not there: skip, do normal web sourcing.
`any_platform=true` means we process the **entire** dedicated inbox (no narrow
`from_filters`) → every sender the user forwards gets read.

### 2. Estimate the VOLUME (cheap, no body fetch)
```bash
python3 /app/shared/skills/email_monitor.py count
```
Returns `new_total` + `by_sender`. It tells **you and the Captain** whether this
is a manageable volume or a **flood**. On a flood, **the Captain (C-16) tells you
how many / which ones** to ingest: the goal is that positions reach a **score**,
not to pile up 200 that are never evaluated.

### 3. Poll → leads
```bash
python3 /app/shared/skills/email_monitor.py poll --since-days 1
```
Every JSONL line is a lead: `{"url","source","subject","sender","received_at"}`.
- `source` = `linkedin-email` / `glassdoor-email` / `indeed-email` for the known
  providers, `email:<domain>` for any other platform (generic extraction).
- Idempotency (Message-ID in `state/email_monitor_seen.json`) guarantees that a
  re-run does **not** reprocess the same alerts.

### 4. For every lead → the 5 gates of `position-insert`
Treat each `url` **exactly like a web hit**: dedup (`scout_dedup.py`) → check the
link is live → fetch the JD → 4 Scout filters → INSERT into `positions`
(`status=new`). **Keep the lead's `--source` tag** (`linkedin-email`,
`email:<domain>`): it is what makes **per-source accuracy measurable** on the
dashboard. JD is mandatory (SC-02): if you cannot retrieve it, do not invent it.

## Balancing (Captain's judgement, C-16)

Reading is free (`poll`/`count`), **processing** up to the score costs. The
decision-maker is the Captain, not a formula:
- Reasonable volume → process them all (more signal is better).
- Flood → carry forward only the **salient** ones, with two criteria taken from
  metadata alone (free): **(1) match with the user's profile/target** (role or
  keyword in the `subject`/title) and **(2) freshness** (most recent
  `received_at`). The rest are picked up in the following windows.
- Goal: positions **reach a score**, they do not pile up unevaluated. No fixed
  thresholds — the Captain decides how many based on the budget.

## Anti-patterns

- ❌ Polling more often than ~30 min (IMAP rate-limit, no new alerts anyway).
- ❌ INSERT without the full JD (SC-02) or without the `source` tag.
- ❌ Creating in bulk on a flood, ignoring the Captain's judgement (C-16): it
  inflates the queue with positions that will never reach a score.
- ❌ Bypassing the dedup (SC-05): the same alerts repeat every day.

## See also

- `position-insert` — the 5 INSERT gates (your standard flow).
- `scout-coord` — claim of the `email:*` source at boot (anti-collision).
- `circles-and-sources` — web sourcing, to be done AFTER the email at day start.
