# Supabase — multi-tenant PostgreSQL schema

PostgreSQL schema for the Job Hunter Team web platform, designed for Supabase with Row Level Security (RLS).

## 👀 Who is this for?

JHT supports **two ways** to use cloud sync:

1. 🌐 **Official instance** — sign in at [`jobhunterteam.ai`](https://jobhunterteam.ai) and your data lands in the JHT-operated Supabase. **Zero setup**, RLS isolates your rows from everyone else's. Most users want this. → No need to read this file.

2. 🛠️ **Self-host** — clone the repo, create your **own** Supabase project, apply the migrations below, point JHT at your URL/key. You own the data and the infrastructure cost. → **This README is for you.**

> 🔒 **Operational details** for the official `jobhunterteam.ai` instance (project ref, credentials, OAuth setup, region, secrets) live in [`docs/internal/ops/MAINTAINERS.md`](../docs/internal/ops/MAINTAINERS.md) — those are JHT-internal and don't apply to a self-host setup.

## Tables

| Table | Purpose |
|---|---|
| `candidate_profiles` | Candidate profile (one per user) |
| `positions` | Job postings discovered by the team |
| `position_highlights` | Pros/cons attached to a position |
| `companies` | Companies analysed by the Analyst |
| `scores` | 0-100 scoring breakdown per position |
| `applications` | CVs, cover letters, Critic verdict, response lifecycle |
| `feedback_tickets` | Bug / feature feedback submitted from the in-app `/feedback` page |
| `cloud_sync_tokens` | Cloud-sync auth tokens (RLS-scoped, SHA-256, soft-delete) |

## Security

All tables have **Row Level Security (RLS)** enabled. User-owned tables expose
only rows matching `auth.uid() = user_id`. `feedback_tickets` has no reliable
owner column: browser roles may submit a report but cannot read stored reports;
only the service role can read them.

`file_bridge_requests.storage_path` is generated from `user_id` and the request
UUID. Browser INSERT is column-restricted to `user_id` and `file_name`.

## Setup

```bash
# With Supabase CLI
supabase start
supabase db reset      # apply migrations + seed

# Migrations only (apply pending)
supabase migration up

# Seed only (after migrations)
psql $DATABASE_URL -f supabase/seed.sql
```

## File structure

```
supabase/
├── migrations/     # Full, ordered schema history: core schema + RLS (001),
│                   #   feedback tickets (005), cloud-sync tokens + expiry (006, 036),
│                   #   companies/highlights sync, position tickets, jd_summary,
│                   #   function hardening (031/032), RLS/index tuning (053),
│                   #   feedback/file-bridge authority hardening (062), …
├── seed.sql        # Demo data
└── README.md
```

> Apply migrations **once and in order**. Historical files are immutable, but
> that does not make every old migration safe to replay against an already
> advanced schema. The filename says what it does; the header comment in each
> file says why.

## Migration history gate

Migration identity is immutable once it reaches the integrator: its number,
path and Git blob must not be changed or reused. CI compares every proposed
migration with the exact base and with all freshly fetched remote branches,
then applies the new sequence to a disposable PostgreSQL 16 database.

Maintainers can separately inspect an already-linked project's version ledger
without changing it:

```bash
scripts/check-linked-migration-history.sh
```

The wrapper runs only `supabase migration list --linked`, captures the raw CLI
streams privately, and reports aggregate counts. Any local-only, remote-only or
malformed history fails closed. Reconciliation is intentionally a manual,
reviewed operation: this gate never runs migration repair, database push, link,
dump, or remote SQL.

## Differences from SQLite (schema V2)

The local agent team uses SQLite (`shared/data/jobs.db`); Supabase is the optional multi-tenant cloud mirror.

| SQLite | PostgreSQL |
|---|---|
| `INTEGER PRIMARY KEY` | `UUID PRIMARY KEY DEFAULT gen_random_uuid()` |
| Single-tenant | `user_id` FK on every table |
| No RLS | RLS with per-owner policies |
| `TIMESTAMP DEFAULT CURRENT_TIMESTAMP` | `TIMESTAMPTZ DEFAULT now()` |
| `TEXT` for JSON | `JSONB` native |
| No CHECK constraints | `CHECK` on status, remote_type, score range |

The local SQLite schema is documented in [`agents/_manual/db-schema.md`](../agents/_manual/db-schema.md).
