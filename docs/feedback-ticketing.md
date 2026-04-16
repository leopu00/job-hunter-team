# Feedback Ticketing

Operational runbook for the [`/feedback`](/feedback) page and the [`/api/feedback`](/api/feedback) API.

## Current state

- The feedback UI is exposed in the side menu.
- The API no longer uses `~/.jht` in the serverless runtime.
- In the cloud it tries Supabase first (`feedback_tickets`).
- If Supabase isn't configured or the table doesn't exist yet, it falls back to `/tmp/jht/feedback.json`.

## Modes

### Persistent mode

Requires:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- migration `supabase/migrations/005_feedback_tickets.sql` applied

In this mode:

- `GET /api/feedback` reads from `feedback_tickets`
- `POST /api/feedback` inserts into `feedback_tickets`
- data survives redeploys

### Fallback mode

Kicks in when Supabase isn't configured or doesn't respond.

In this mode:

- the API reads/writes `/tmp/jht/feedback.json`
- the ticketing endpoint doesn't return `500`
- data is not guaranteed long-term

## Required migration

File: [`supabase/migrations/005_feedback_tickets.sql`](/Users/leoneemanuelpuglisi/Repos/job-hunter-team/fullstack-3/supabase/migrations/005_feedback_tickets.sql)

Creates:

- `feedback_tickets` table
- indexes on `created_at` and `status`
- RLS `SELECT` and `INSERT` policies for `anon` and `authenticated`

## Deploy

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

## Verification

Quick smoke test:

```bash
curl -i https://jobhunterteam.ai/api/feedback
curl -i -X POST https://jobhunterteam.ai/api/feedback \
  -H 'content-type: application/json' \
  --data '{"rating":4,"category":"feature","description":"probe"}'
curl -I https://jobhunterteam.ai/feedback
```

Expected:

- `/api/feedback` must not return `500`
- `POST /api/feedback` must return `200`
- `/feedback` must respond `200`

## Operational notes

- If Vercel doesn't have the Supabase env vars configured, the system still works but is non-persistent.
- For real persistence, apply the migration and configure the Supabase env vars in the connected Vercel project.
