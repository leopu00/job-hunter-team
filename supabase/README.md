# Supabase — multi-tenant PostgreSQL schema

PostgreSQL schema for the Job Hunter Team web platform, designed for Supabase with Row Level Security (RLS).

## 👀 Who is this for?

JHT supports **two ways** to use cloud sync:

1. 🌐 **Official instance** — sign in at [`jobhunterteam.ai`](https://jobhunterteam.ai) and your data lands in the JHT-operated Supabase. **Zero setup**, RLS isolates your rows from everyone else's. Most users want this. → No need to read this file.

2. 🛠️ **Self-host** — clone the repo, create your **own** Supabase project, apply the migrations below, point JHT at your URL/key. You own the data and the infrastructure cost. → **This README is for you.**

> 🔒 **Operational details** for the official `jobhunterteam.ai` instance (project ref, credentials, OAuth setup, region, secrets) live in [`docs/internal/MAINTAINERS.md`](../docs/internal/ops/MAINTAINERS.md) — those are JHT-internal and don't apply to a self-host setup.

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

All tables have **Row Level Security (RLS)** enabled. Each user sees only their own rows via `auth.uid() = user_id`.

Active policies: SELECT · INSERT · UPDATE · DELETE for the owner.

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
├── migrations/
│   ├── 001_schema.sql                  # Initial schema (5 core tables, RLS)
│   ├── 002_add_interview_round.sql     # Interview round tracking
│   ├── 003_align_legacy_schema.sql     # Align with the legacy team schema
│   ├── 004_add_legacy_id.sql           # legacy_id column for cloud-sync mapping
│   ├── 005_feedback_tickets.sql        # Feedback / bug ticket table
│   ├── 006_cloud_sync_tokens.sql       # Cloud-sync auth tokens (RLS, SHA-256)
│   └── 007_positions_legacy_unique.sql # UNIQUE (user_id, legacy_id) for idempotent push
├── seed.sql                            # Demo data
└── README.md
```

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
