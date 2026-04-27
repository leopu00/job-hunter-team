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

See [`docs/release.md`](release.md) for the active release flow (tag → CI → GitHub Release).

### 🍎 macOS code signing & notarization (deferred post-beta)

> ⏸️ **Currently disabled** — JHT ships unsigned `.dmg` files during beta. The trust signal in beta is open-source transparency + community review, not a paid certificate (see memory `project_open_source_as_trust_signal`). When the project graduates from beta, follow this playbook to enable signing + notarization.

**Why**: without signing + Apple notarization, first launch of `JHT Desktop.app` triggers Gatekeeper's "Apple could not verify this app" block. Non-tech users typically close the app at that point. A signed + notarized DMG opens with the standard "downloaded from the Internet" confirmation only.

Two independent steps required: **code signing** (Developer ID Application certificate) and **notarization** (submit to Apple's notary service + staple ticket). The release workflow performs both automatically when the required secrets are configured.

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

All five must be present. If any is missing, the release workflow falls back to producing an **unsigned** DMG and emits a warning (build doesn't fail, other platforms still publish).

#### What the workflow does

`.github/workflows/release.yml` job `build-desktop` matrix entry `macos-14`, on tag push:

1. Detects whether all five secrets are configured (`HAS_MAC_SIGNING`).
2. If yes: decodes `MACOS_CERTIFICATE` to a temporary `.p12`, points `CSC_LINK` at it and passes `CSC_KEY_PASSWORD` to electron-builder.
3. Passes `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` so `@electron/notarize` (invoked by electron-builder when `build.mac.notarize: true`) can submit to Apple's notary.
4. Post-build, runs `codesign -dv --verbose=4` and `spctl --assess --type open --context context:primary-signature --verbose` on the `.dmg`. Non-zero exit fails the job.

Signing config in `desktop/package.json` → `build.mac`: `hardenedRuntime: true`, `entitlements` → `desktop/build/entitlements.mac.plist` (JIT, unsigned-executable-memory, network.client), `notarize: true`.

#### Verifying a build locally

```bash
codesign -dv --verbose=4 /path/to/JHT\ Desktop.app
# expect: Authority=Developer ID Application: ...

spctl --assess --type execute --verbose=4 /path/to/JHT\ Desktop.app
# expect: accepted + source=Notarized Developer ID

spctl --assess --type open --context context:primary-signature --verbose /path/to/job-hunter-team-<version>-mac.dmg
# expect: source=Notarized Developer ID
```

#### Rotating the certificate

Developer ID certs expire after 5 years. To rotate: repeat steps 2–4 with a fresh CSR, replace `MACOS_CERTIFICATE` + `MACOS_CERTIFICATE_PWD`. Old artifacts remain valid as long as the old cert isn't revoked. **Revoke the old cert only after confirming new builds work** — revocation invalidates all artifacts signed with it.

## 🌍 Compliance / GDPR

- Supabase region selected for EU GDPR compliance — see `web/.env.local` for the actual region
- **Do NOT mention the specific region** (city/AWS-region code) in any public-facing doc — it goes only in the dedicated compliance document for legal review
- User data residency policy: documented in the GDPR compliance doc (separate, internal)

## 🛡️ Security review

- **Last full review:** 2026-04-27 (sprint dev-1..dev-4 in parallelo, mergiato in `master` con `7a2cb6ae`) — 31/34 fix, security score 30% → 74%
- **Output:** [`docs/security/`](security/) — pre-launch review, OpenClaw comparison, threat model, checklist, post-fix snapshot
- **Phase status:** Phase 1 (bloccanti pre-launch) 9/9 ✅ · Phase 2 (post-launch) 12/12 ✅ · Phase 3 (hardening) 10/13 🟡
- **Gap residui (blockers per public release):** SSRF dispatcher generico, `resolve-system-bin` strict, CSP hash-based prod L1
- **Tooling pre-commit:** gitleaks, detect-secrets, actionlint, zizmor, npm-audit-prod · Dependabot Docker weekly · Docker base image pin SHA256
- **Cadence target:** every major release

## 🔧 Infrastructure repos

- **leopu00/job-hunter-team** — main monorepo (this one)
- **leopu00/job-hunter-team-config** — legacy implementation (reference for regression checks — see memory `reference_jht_dev_team_config_repo`)

## 📞 Contact

For anything that needs maintainer-level access:

- **Leone Emanuele Puglisi** — `leone.puglisi@gmail.com`
- GitHub: [@leopu00](https://github.com/leopu00)
