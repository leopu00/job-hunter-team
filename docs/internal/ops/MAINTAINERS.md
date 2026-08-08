# 👥 Maintainers Reference

> 🔒 **Internal information for project maintainers.** This file tracks secrets coordination, deployment access, and other operational details that don't belong in public-facing docs but are useful for anyone working on the project's infrastructure.

## 🗄️ Supabase

### Project access

```
Project ref:  in web/.env.local
URL:          in web/.env.local
Region:       in web/.env.local (see compliance doc — DO NOT mention in public docs)
Credentials:  in web/.env.local (NOT in git)
```

> Keys and project ref live only in `web/.env.local` (not versioned). Workers who need access must ask the project coordinator (owner@example.com).

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

Tables: `candidate_profiles`, `positions`, `companies`, `scores`, `applications`, `cloud_sync_tokens`, `feedback_tickets`. **RLS** enforces `auth.uid() = user_id` on user-owned tables. `feedback_tickets` has no owner column and is write-only for browser roles; reads require service-role authority.

### Fleet health — is the product working in the field

Two views (migration `065_fleet_health_views.sql`), **service_role only** —
no browser role can reach them, and they hold aggregates and timestamps
only: never message bodies, position content or profile fields.

```sql
-- Teams burning quota into a mailbox nobody reads: the box is alive, the
-- person is not. This is the pattern that hand-written SQL kept missing.
SELECT user_id, client_version, machine_sync_last_used_at,
       human_last_session_at, human_positions_opened, positions_total,
       undelivered_user_turns
FROM fleet_account_health
WHERE machine_sync_last_used_at > now() - interval '1 day'
  AND (human_last_session_at IS NULL
       OR human_last_session_at < now() - interval '7 days')
ORDER BY positions_total DESC;

-- Who is affected by this bug (install base), now that a box declares
-- its build on every cloud-sync call (migration 064).
SELECT * FROM fleet_version_distribution ORDER BY accounts DESC;

-- A repeat of the silent chat drop, as a number instead of an excavation.
SELECT user_id, undelivered_user_turns, oldest_undelivered_user_turn_at
FROM fleet_account_health
WHERE undelivered_user_turns > 0;
```

**`machine_*` and `human_*` are never to be summed.**
`cloud_sync_tokens.last_used_at` is written by the box's own sync loop, so
an unattended team reads as maximally *active* while nobody has opened a
browser in weeks — that column is machine liveness, and reading it as
engagement is the mistake the split exists to prevent.

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

See [`release.md`](release.md) for the active release flow (bump four version fields → merge to `production` → tag → CI → GitHub Release).

### 🍎 macOS code signing & notarization

> ✅ **Required, not optional.** Since the native migration the release job **fails fast** when any of the five Apple secrets is missing (`macOS game releases require signing and notarization credentials`) — there is no unsigned fallback. An unsigned Godot `.app` is blocked by Gatekeeper with "Apple could not verify this app", which is where non-technical users abandon the install.

Two independent steps: **code signing** (Developer ID Application certificate) and **notarization** (submit to Apple's notary service + staple the ticket). CI performs both on every tagged release.

#### One-time maintainer setup

1. **Apple Developer Program** — paid membership at https://developer.apple.com/programs/ (~99 USD/year). Free accounts cannot issue Developer ID certificates.
2. **Create the Developer ID Application certificate**:
   - Keychain Access → Certificate Assistant → Request a Certificate From a CA → fill in email/name → **Saved to disk** → produces a `.certSigningRequest` (CSR)
   - https://developer.apple.com/account/resources/certificates/list → **+** → **Developer ID Application** → upload CSR → download `.cer`
   - Double-click `.cer` to import into login keychain (private key from CSR merges with cert)
3. **Export as `.p12`**:
   - Keychain Access → locate `Developer ID Application: <Name> (<TEAM_ID>)`, expand to select cert + private key → right-click → **Export 2 items…** → `.p12` format → set strong password (this is `MACOS_CERTIFICATE_PWD`)
4. **Base64-encode the `.p12`**: `base64 -i developer-id.p12 | pbcopy` (Linux: `base64 -w0`). Output is the `MACOS_CERTIFICATE` secret.
5. **App-Specific Password for notarytool**: https://appleid.apple.com/account/manage → Sign-In and Security → App-Specific Passwords → generate one labeled `notarytool-jht`. Copy the 4×4 string → `APPLE_APP_SPECIFIC_PASSWORD`.
6. **Team ID**: https://developer.apple.com/account → Membership details → 10-character alphanumeric → `APPLE_TEAM_ID`.

#### Required GitHub secrets

| Secret | Value |
|---|---|
| `MACOS_CERTIFICATE` | Base64 of the `.p12` |
| `MACOS_CERTIFICATE_PWD` | Password chosen when exporting |
| `APPLE_ID` | Apple ID email of the developer account |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password |
| `APPLE_TEAM_ID` | 10-character Team ID |

All five must be present. If any is missing, the `macos-14` matrix entry stops immediately with an `::error::` annotation — the Windows and Linux builds still run, but no release is published (the `release` job needs all three artifacts).

#### What the workflow does

`.github/workflows/release.yml` job `build-game`, matrix entry `macos-14`, on tag push:

1. `HAS_MAC_SIGNING` checks that all five secrets are configured; if not, the job fails with an explicit error.
2. `apple-actions/import-codesign-certs` imports the `.p12` into a temporary keychain.
3. The Godot `macOS` preset is exported to `builds/macos/job-hunter-team.zip`; the step unpacks it, resolves the `Developer ID Application` identity from the keychain and runs `codesign --deep --force --options runtime --timestamp`, then `codesign --verify --deep --strict`.
4. The signed `.app` is re-zipped with `ditto -c -k --sequesterRsrc --keepParent` and submitted to `xcrun notarytool submit --wait`, then `xcrun stapler staple` + `stapler validate` + `spctl --assess --type execute`. Any non-zero exit fails the job.
5. The stapled `.app` is zipped one last time — that final `.zip` is the published asset.

Hardened runtime comes from `--options runtime` at signing time; there is no entitlements plist (the Godot binary needs none of the Electron exceptions).

#### Verifying a build locally

```bash
ditto -x -k job-hunter-team.zip /tmp/jht-check
APP="$(find /tmp/jht-check -maxdepth 2 -type d -name '*.app' | head -n 1)"

codesign -dv --verbose=4 "$APP"
# expect: Authority=Developer ID Application: ...

spctl --assess --type execute --verbose=4 "$APP"
# expect: accepted + source=Notarized Developer ID

xcrun stapler validate "$APP"
# expect: The validate action worked!
```

#### Rotating the certificate

Developer ID certs expire after 5 years. To rotate: repeat steps 2–4 with a fresh CSR, replace `MACOS_CERTIFICATE` + `MACOS_CERTIFICATE_PWD`. Old artifacts remain valid as long as the old cert isn't revoked. **Revoke the old cert only after confirming new builds work** — revocation invalidates all artifacts signed with it.

## 🌍 Compliance / GDPR

- Supabase region selected for EU GDPR compliance — see `web/.env.local` for the actual region
- **Do NOT mention the specific region** (city/AWS-region code) in any public-facing doc — it goes only in the dedicated compliance document for legal review
- User data residency policy: documented in the GDPR compliance doc (separate, internal)

## 🛡️ Security review

- **Last full review:** 2026-04-27 (sprint dev-1..dev-4 in parallelo, mergiato in `master` con `7a2cb6ae`) — 31/34 fix, security score 30% → 74%
- **Output:** [`docs/security/`](../../security/) — pre-launch review, OpenClaw comparison, threat model, checklist, post-fix snapshot
- **Phase status:** Phase 1 (bloccanti pre-launch) 9/9 ✅ · Phase 2 (post-launch) 12/12 ✅ · Phase 3 (hardening) 10/13 🟡
- **Gap residui:** `resolve-system-bin` strict (deferred by design). SSRF dispatcher generico e CSP hash-based prod L1 → shipped, vedi [`docs/security/05-checklist.md`](../../security/05-checklist.md)
- **Tooling pre-commit:** gitleaks, detect-secrets, actionlint, zizmor, npm-audit-prod · Dependabot Docker weekly · Docker base image pin SHA256
- **Cadence target:** every major release

## 🔧 Infrastructure repos

- **leopu00/job-hunter-team** — main monorepo (this one)
- **leopu00/job-hunter-team-config** — legacy implementation (reference for regression checks — see memory `reference_jht_dev_team_config_repo`)

## 📞 Contact

For anything that needs maintainer-level access:

- **Mario R.** — `owner@example.com`
- GitHub: [@owner](https://github.com/leopu00)
