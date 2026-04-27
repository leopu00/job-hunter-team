# Maintainers Reference

> 🔒 **Internal information for project maintainers.** This file tracks secrets coordination, deployment access, and other operational details that don't belong in public-facing docs but are useful for anyone working on the project's infrastructure.

## 🗄️ Supabase

### Project access

```
Project ref:  in web/.env.local
URL:          in web/.env.local
Region:       in web/.env.local (see compliance doc — DO NOT mention in public docs)
Credentials:  in web/.env.local (NOT in git)
```

> Keys and project ref live only in `web/.env.local` (not versioned). Workers who need access must ask the project coordinator (Leone — leone.puglisi@gmail.com).

### Database — applied migrations

| File | Purpose |
|---|---|
| `001_schema.sql` | Initial schema (5 core tables, RLS) |
| `002_add_interview_round.sql` | Interview round tracking |
| `003_align_legacy_schema.sql` | Align with legacy team schema |
| `004_add_legacy_id.sql` | `legacy_id` column for cloud-sync mapping |
| `005_feedback_tickets.sql` | Feedback / bug ticket table |
| `006_cloud_sync_tokens.sql` | Cloud-sync auth tokens (RLS, SHA-256, soft-delete) |
| `007_positions_legacy_unique.sql` | `UNIQUE (user_id, legacy_id)` for idempotent push |

Tables: `candidate_profiles`, `positions`, `companies`, `scores`, `applications`, `cloud_sync_tokens`, `feedback_tickets`. **RLS** enforces `auth.uid() = user_id` on every row.

### Auth config

- `site_url` → `https://jobhunterteam.ai`
- `uri_allow_list` → `https://jobhunterteam.ai/**`, `https://jht-web-deploy.vercel.app/**`, `https://job-hunter-team.vercel.app/**`, `http://localhost:3000/**`

### Setting up a fresh Supabase project (rare — only for a new fork or self-hosted deploy)

1. **Google OAuth — Google Cloud Console**
   - Create a project at https://console.cloud.google.com
   - **APIs & Services → Credentials → Create OAuth 2.0 Client ID** (Web application)
   - Authorized redirect URI: `https://<PROJECT_REF>.supabase.co/auth/v1/callback`
   - Copy Client ID + Secret
2. **Enable Google OAuth in Supabase** — UI: `dashboard/project/<PROJECT_REF>/auth/providers`. Or:
   ```bash
   curl -X PATCH \
     -H "Authorization: Bearer sbp_..." \
     -H "Content-Type: application/json" \
     -d '{"external_google_enabled":true,"external_google_client_id":"...","external_google_secret":"..."}' \
     "https://api.supabase.com/v1/projects/<PROJECT_REF>/config/auth"
   ```
3. **GitHub OAuth** — same flow as Google, configure in Supabase Auth Providers (used as second login option for developers/contributors)
4. **Apply migrations** — from the repo root:
   ```bash
   supabase link --project-ref <PROJECT_REF>
   supabase db push
   ```

### Useful Supabase CLI commands

```bash
supabase migration list            # show migration status
supabase db push                   # apply pending migrations
supabase logs --type auth          # tail auth logs
```

### Optional — Supabase MCP server

For maintainers who use Claude Code: add the official Supabase MCP server to `~/.claude.json` so the assistant can list projects, run SQL, manage auth config:

```json
"supabase": {
  "command": "npx",
  "args": ["-y", "@supabase/mcp-server-supabase@latest", "--access-token", "<PAT>"]
}
```

## 🌐 Domain & DNS

- **Domain**: `jobhunterteam.ai` (Cloudflare, ~$80/year)
- **DNS**: A record → Vercel IP (DNS only, no proxy)
- **SSL**: auto-managed by Vercel
- **Subdomains** (planned, not yet active): `app.`, `docs.`, `api.`

## ☁️ Vercel

- **Project**: `leopu00/job-hunter-team`
- **Env vars** required: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`
- **Secrets in GitHub Actions**: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`

## 🔐 OAuth providers

- **Google OAuth**: configured in Supabase Auth — Site URL `https://jobhunterteam.ai`
- **GitHub OAuth**: configured in Supabase Auth — same Site URL + redirect URLs

## 📦 Release process

See [`docs/release.md`](release.md) for the full release procedure.

## 🌍 Compliance / GDPR

- Supabase region selected for EU GDPR compliance — see `web/.env.local` for the actual region
- **Do NOT mention the specific region** (city/AWS-region code) in any public-facing doc — it goes only in the dedicated compliance document for legal review
- User data residency policy: documented in the GDPR compliance doc (separate, internal)

## 🛡️ Security review

- Last full security review: in progress on `dev-1` worktree (gitleaks + dependency audit + route auth + command-injection scan + credential handling)
- Output: `docs/security-review-pre-launch.md` (will be created when review completes)
- Cadence target: every major release

## 🔧 Infrastructure repos

- **leopu00/job-hunter-team** — main monorepo (this one)
- **leopu00/job-hunter-team-config** — legacy implementation (reference for regression checks — see memory `reference_jht_dev_team_config_repo`)

## 📞 Contact

For anything that needs maintainer-level access:

- **Leone Emanuele Puglisi** — `leone.puglisi@gmail.com`
- GitHub: [@leopu00](https://github.com/leopu00)
