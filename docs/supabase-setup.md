# Supabase Setup — Job Hunter Team Platform

**Date:** March 15, 2026
**Executed by:** COORD (JHT) + automated CLI
**Status:** ✅ Cloud database active, ⚠️ Google OAuth pending

---

## Supabase project

| Field | Value |
|-------|-------|
| **Name** | job-hunter-team |
| **Reference ID** | `[in .env.local]` |
| **URL** | `[in .env.local]` |
| **Region** | `[in .env.local]` |
| **Status** | ACTIVE_HEALTHY |
| **Dashboard** | `[in .env.local — use the project ref to build the URL]` |

---

## API keys

| Key | Usage |
|-----|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | `[in .env.local]` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon JWT (in `web/.env.local`) |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role JWT (in `web/.env.local`) |

> ⚠️ Full keys are in `web/.env.local` (NOT versioned — excluded via .gitignore)

---

## Database — Applied migrations

| File | Status |
|------|--------|
| `supabase/migrations/001_schema.sql` | ✅ Applied |
| `supabase/migrations/002_add_interview_round.sql` | ✅ Applied |

**Full schema:**
- `candidate_profiles` — candidate profile (1 per user, RLS enforced)
- `positions` — positions found by the Scouts
- `companies` — companies
- `scores` — 0–100 scores from the Scorer
- `applications` — applications (CV, CL, status)

**RLS:** Each user sees only their own data (`auth.uid() = user_id`).

---

## Next.js web app

**Structure:** `web/` (Next.js 14, App Router, TypeScript, Tailwind)

```
web/
├── app/
│   ├── page.tsx              # Landing page + Google Login
│   ├── auth/callback/        # OAuth redirect handler
│   └── (protected)/
│       ├── layout.tsx        # SSR auth guard
│       ├── dashboard/        # Pipeline dashboard
│       ├── profile/          # View profile
│       └── profile/edit/     # Edit profile (full form)
├── components/Navbar.tsx     # Avatar + logout
├── lib/
│   ├── supabase/client.ts    # Browser client
│   ├── supabase/server.ts    # Server-side client
│   └── types.ts              # TypeScript types
└── .env.local                # ⚠️ NOT versioned
```

**Build:** ✅ Compiled successfully (`npm run build` — 0 TypeScript errors)

---

## Auth Config (updated)

| Field | Value |
|-------|-------|
| `site_url` | `https://jobhunterteam.ai` |
| `uri_allow_list` | `https://jobhunterteam.ai/**,https://jht-web-deploy.vercel.app/**,https://job-hunter-team.vercel.app/**,http://localhost:3000/**` |
| Google OAuth | ✅ Configured |

---

## ⚠️ Required manual step: Google OAuth

The team can't access Google Cloud Console automatically. The admin needs to:

### Step 1 — Google Cloud Console
1. Go to https://console.cloud.google.com
2. Create a new project (or use "job-hunter-team")
3. Menu: **APIs & Services** → **Credentials**
4. Click **+ CREATE CREDENTIALS** → **OAuth 2.0 Client ID**
5. Type: **Web application**
6. Name: `job-hunter-team`
7. Add **Authorized redirect URI**:
   ```
   https://<PROJECT_REF>.supabase.co/auth/v1/callback
   ```
8. Save → Copy **Client ID** and **Client Secret**

### Step 2 — Enable Google OAuth in Supabase
Go to: https://supabase.com/dashboard/project/<PROJECT_REF>/auth/providers
Or with curl (after obtaining Client ID and Secret):

```bash
curl -X PATCH \
  -H "Authorization: Bearer sbp_..." \
  -H "Content-Type: application/json" \
  -d '{
    "external_google_enabled": true,
    "external_google_client_id": "YOUR_CLIENT_ID.apps.googleusercontent.com",
    "external_google_secret": "YOUR_CLIENT_SECRET"
  }' \
  "https://api.supabase.com/v1/projects/<PROJECT_REF>/config/auth"
```

### Step 3 — Vercel (at deploy time)
Add the env vars to the Vercel project (values in `web/.env.local`):
```
NEXT_PUBLIC_SUPABASE_URL=https://<PROJECT_REF>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
NEXT_PUBLIC_APP_URL=https://jobhunterteam.ai
```

> Canonical Vercel project: `job-hunter-team`

---

## Local test

```bash
cd web/
npm install
npm run dev
# Open http://localhost:3000
```

> The app will run (build OK), but Google login will fail until OAuth is configured.

---

## Supabase MCP Server

The `@supabase/mcp-server-supabase` MCP server has been added to the global Claude config (`~/.claude.json`):

```json
"supabase": {
  "command": "npx",
  "args": ["-y", "@supabase/mcp-server-supabase@latest", "--access-token", "<PAT>"]
}
```

Lets Claude Code (Captain included):
- List/manage Supabase projects
- Run SQL queries against the cloud database
- Manage auth config, API keys, migrations

---

## Platform overall status

| Component | Status | Notes |
|-----------|--------|-------|
| Cloud Supabase project | ✅ ACTIVE | |
| PostgreSQL schema V2 | ✅ Applied | 2 migrations, RLS, 5 tables |
| Next.js web app | ✅ Build OK | 6 routes, TypeScript 0 errors |
| Google OAuth | ✅ Configured | |
| Vercel CI/CD | ✅ Pipeline ready | Deploy on push to `web/**` |
| Supabase MCP | ✅ Configured | In global `~/.claude.json` |

---

## Useful commands

```bash
# Link worktree to the project (already done for main/)
supabase link --project-ref <PROJECT_REF>

# Push new migrations
supabase db push

# Migration status
supabase migration list

# Auth logs
supabase logs --type auth

# Start local dev (Next.js)
cd web/ && npm run dev
```
