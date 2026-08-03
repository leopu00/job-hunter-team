# 💬 Feedback Ticketing

Operational runbook for the `/api/feedback` endpoint and the surfaces that post to it.

> 🧪 This is the channel beta testers use to report issues — see [`docs/guides/BETA.md`](./BETA.md).

## 🚪 Where users actually report

There is **no `/feedback` page**: it was removed on 2026-05-12 (`4242dd6dd`). Three surfaces post to `POST /api/feedback`, and they are the only ones:

- **Signed-in web app** — the avatar button at the right end of the navbar opens the account menu; **"Report a problem"**, just above Log out, opens a dialog: [`web/app/components/SupportDialog.tsx`](../../web/app/components/SupportDialog.tsx), mounted by [`UserMenu.tsx`](../../web/app/components/UserMenu.tsx). It asks for **subject and message only** — the account email and the page the user is writing from are attached automatically, and the dialog shows both before sending, because "nothing loads" from `/positions` and from `/dashboard` are two different bugs. Sends `client: "web-dashboard"`.
- **Public contact form** — [`/contact`](../../web/app/contact/ContactForm.tsx), for people who are not signed in (or not installed yet). Sends `client: "web-contact"`. Reports from `web-*` clients never open a GitHub issue: they only go to the inbox.
- **Godot office** — the `FeedbackService` autoload ([`game/scripts/support/feedback_service.gd`](../../game/scripts/support/feedback_service.gd)), behind the sidebar's **System → "Report a problem"** entry (and a second button on the diagnostics screen). It is the only surface that attaches redacted diagnostics, and it always writes a local copy under `user://reports` before trying the network. `JHT_FEEDBACK_URL` overrides the endpoint.

Browser-side coverage of the two web surfaces: [`e2e/tests/82-support-report.spec.ts`](../../e2e/tests/82-support-report.spec.ts).

## 📊 Current state

- In the cloud the API tries Supabase first (`feedback_tickets`).
- If Supabase isn't configured or the table doesn't exist yet, it falls back to `/tmp/jht/feedback.json`.

## 🔀 Modes

### 💾 Persistent mode

Requires:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- migration `supabase/migrations/005_feedback_tickets.sql` applied

In this mode:

- `GET /api/feedback` reads from `feedback_tickets`
- `POST /api/feedback` inserts into `feedback_tickets`
- data survives redeploys

### 🪣 Fallback mode

Kicks in when Supabase isn't configured or doesn't respond.

In this mode:

- the API reads/writes `/tmp/jht/feedback.json`
- the ticketing endpoint doesn't return `500`
- data is not guaranteed long-term

## 🗄️ Required migration

File: [`supabase/migrations/005_feedback_tickets.sql`](../../supabase/migrations/005_feedback_tickets.sql)

Creates:

- `feedback_tickets` table
- indexes on `created_at` and `status`
- RLS `SELECT` and `INSERT` policies for `anon` and `authenticated`

## 🚢 Deploy

Production deploy:

```bash
git checkout production
git pull --ff-only
git merge --ff-only <branch-to-release>
git push origin production
```

Notes:

- the live site must go through a push to `production`, not `vercel deploy --prod` from local branches;
- create the release tag only after Vercel's Git deploy on `production` reports `READY`.

## ✅ Verification

Quick smoke test:

```bash
curl -i https://jobhunterteam.ai/api/feedback
# Harmless probe: the `website` honeypot field makes the endpoint answer as if
# it had accepted the report, without delivering anything. Same trick the e2e
# suite uses to check the channel without burning the 5-per-hour budget.
curl -i -X POST https://jobhunterteam.ai/api/feedback \
  -H 'content-type: application/json' \
  --data '{"client":"probe","happened":"probe report","website":"bot"}'
```

Expected:

- `/api/feedback` must not return `500`
- the probe must return `200` with `{"ok":true,"ticket":"JHT-…"}`

Two things to know before probing by hand: a **real** `POST` (no `website` field) delivers an actual email to the project inbox, and the endpoint accepts **5 submissions per hour per IP** — beyond that it answers `429` with `Retry-After`. A body without `happened` (min 5 chars) is a `400`, not a channel failure.

## 📝 Operational notes

- If Vercel doesn't have the Supabase env vars configured, the system still works but is non-persistent.
- For real persistence, apply the migration and configure the Supabase env vars in the connected Vercel project.

## 📚 Related

- 🧪 [`docs/guides/BETA.md`](./BETA.md) — beta tester program (the user-facing flow that funnels into this endpoint)
- 🔒 [`docs/internal/ops/MAINTAINERS.md`](../internal/ops/MAINTAINERS.md) — Supabase access and Vercel env vars
- 🚢 [`docs/internal/ops/release.md`](../internal/ops/release.md) — full release flow
