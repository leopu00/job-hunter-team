# Maintainers Reference

> 🔒 **Internal information for project maintainers.** This file tracks secrets coordination, deployment access, and other operational details that don't belong in public-facing docs but are useful for anyone working on the project's infrastructure.

## 🗄️ Supabase

```
Project ref:  in web/.env.local
URL:          in web/.env.local
Region:       in web/.env.local (see compliance doc — DO NOT mention in public docs)
Credentials:  in web/.env.local (NOT in git)
```

> Keys and project ref live only in `web/.env.local` (not versioned). Workers who need access must ask the project coordinator (Leone — leone.puglisi@gmail.com).

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
