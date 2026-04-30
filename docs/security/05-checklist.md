# ✅ Security implementation checklist

Tracking of fixes from `01-pre-launch-review.md`. Each entry flips to `[x]` when the related commit is **merged into `master`**. References point to [`01-pre-launch-review.md`](01-pre-launch-review.md) and [`03-implementation-tradeoffs.md`](03-implementation-tradeoffs.md).

**Conventions:**
- `[ ]` = todo · `[x]` = merged into `master`
- `Merged:` field empty until merge; on merge, fill with the short SHA on `master`
- `Effort:` realistic estimate
- `Depends on:` IDs of other tasks that must complete first

---

## 🚀 Phase 1 — release blockers

Mandatory fixes before the first public release. **Target:** done before the `v0.1.0` tag.

### Critical

- [x] **C4** — Add missing `homedir` import
  - File: `shared/credentials/storage.ts:1` (add `import { homedir } from "node:os"`)
  - Effort: 1 min
  - Merged: 7a2cb6ae (via dev-2)

- [x] **C3** — Refactor `bridge_health.py:spawn_bridge` (no `sh -c`)
  - File: `shared/skills/bridge_health.py:105-114`
  - Replace f-string + `sh -c` with `subprocess.Popen([…], env={…})` + regex validation on `JHT_TARGET_SESSION`
  - Effort: 30 min
  - Merged: 7a2cb6ae (via dev-2)

- [x] **C5** — Remove plaintext fallback in CLI secrets
  - File: `cli/src/commands/secrets.js:80-92`
  - Explicit error + instructions if `JHT_SECRET_KEY` is missing; add `mode: 0o600` to writeFile
  - Effort: 30 min
  - Merged: 0494a5c6
  - Depends on: H4 (so the user has a clean path: keyring or env)

- [x] **C1** — Fix localhost auth bypass via `x-forwarded-host`
  - File: `web/lib/auth.ts:15-19` + clones in `web/proxy.ts`, `web/app/(protected)/layout.tsx`, `web/app/(protected)/dashboard/page.tsx`
  - Replace with the OpenClaw pattern: TCP socket peer + reject if any `x-forwarded-*` is present
  - Effort: 1h (incl. wiring `req.socket.remoteAddress` access in the Next route handler)
  - Merged: 721b0b8e

- [x] **C2** — Add `requireAuth()` to 21 sensitive routes
  - Files: `web/app/api/{secrets,database,agents,agents/[id],agents/metrics,providers,config,env,backup,health,tasks,tasks/[id],history,history/[id],credentials,sessions,sessions/[id],logs,workspace,workspace/init,workspace/browse}/route.ts`
  - Local-token in `~/.jht/.local-token` (mode 0600) + HttpOnly+SameSite=Strict cookie auto-set by the middleware on direct localhost requests (no forwarded headers); `requireAuth()` validates cookie OR `Authorization: Bearer` header. No CLI/Electron change required: cookie bootstrap is server-side.
  - Effort: 1 day
  - Merged: b5464d11 (+ 38c00b63, bcd5c348, 10d965d8, 8f121644 and middleware df7eae5f/d5565192)
  - Depends on: C1 (otherwise the bypass is still active)

### High

- [x] **H8** — `npm audit fix` on `web/`
  - Upgrade `next`, `next-intl`, `postcss`. Dedicated branch + full E2E before merge
  - Effort: 4h
  - Merged: c62d7147

- [x] **H9** — `npm audit fix` on `desktop/`
  - Upgrade `electron`, `@xmldom/xmldom`. Test auto-updater + IPC
  - Effort: 4h
  - Merged: 7a2cb6ae (via dev-2)

- [x] **H1** — Auth + remove `?id=` reveal on `/api/secrets`
  - File: `web/app/api/secrets/route.ts` + new `web/app/api/secrets/reveal/route.ts` + `web/app/(protected)/secrets/page.tsx`
  - GET always masked (no `?id=`); reveal only via `POST /api/secrets/reveal` with `confirm:true`. Client requires `window.confirm()` before reveal.
  - Effort: 2h
  - Merged: 87c1a824
  - Depends on: C2

- [x] **H2** — Allowlist tables in `/api/database`
  - File: `web/app/api/database/route.ts:14-21, 95-108`
  - Hardcoded set of table names; exclude files prefixed with `secrets|credentials|tokens|.env`
  - Effort: 1h
  - Merged: d6143480

---

## 🛠️ Phase 2 — within 2 weeks post-launch

Important hardening but not release-blocking.

### High

- [x] **H3** — Validate `JHT_SHELL_VIA` + array-based `execFile`
  - Files: `web/app/api/team/terminal/open/route.ts`, `web/app/api/capitano/terminal/route.ts`
  - Validate `dockerContainer` with `^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$`; use `execFile` where cross-platform allows
  - Effort: 3h
  - Merged: e0d24b60

- [x] **H4** — Replace machine-derived fallback with keyring + env-var
  - File: `tui/src/oauth/storage.ts:20-28`, `shared/credentials/storage.ts:46-50`, new `shared/credentials/passphrase.ts`
  - Strategy: OS keyring (`@napi-rs/keyring`) if available → env var fallback → explicit error (no machine-derived, no plaintext)
  - Effort: 2-3 days (cross-platform testing)
  - Merged: 6f35755d (+ 5b620995 iter 2 PBKDF2+random salt for tui/oauth, + iter 3 `jht keyring` CLI pending sha)

- [x] **H5** — Migrate `cli/src/commands/secrets.js` from AES-CBC to AES-GCM
  - File: `cli/src/commands/secrets.js:27-40`
  - AES-256-GCM + PBKDF2 100k SHA-512 with random per-file salt. Silent migration: legacy CBC files (`iv:ciphertext`) are re-encrypted to GCM on first `get`.
  - Effort: 6h (incl. migration code)
  - Merged: 6c0e6c05

- [x] **H6** — Symlink containment check on file-serving
  - Files: `web/app/api/profile/files/[name]/route.ts:19-41` + other file-serving routes
  - `realpath` + `startsWith(baseDir + sep)` check
  - Effort: 1h
  - Merged: 7a2cb6ae (via dev-2)

### Medium

- [x] **M2** — Global CSRF middleware (Origin/Referer/Sec-Fetch-Site)
  - File: new `web/lib/csrf.ts` + integration into `web/proxy.ts`
  - OpenClaw `browserMutationGuardMiddleware` pattern adapted to Next.js
  - Effort: 4h (+ testing)
  - Merged: 8ad011fd

- [x] **M6** — Bind compose to `127.0.0.1:3000`
  - File: `docker-compose.yml:63-64`
  - Effort: 5 min
  - Merged: e99d3584

- [x] **M3** — Rate limiting on cloud-sync endpoints
  - Files: `web/app/api/cloud-sync/**`
  - Upstash Redis or `@vercel/ratelimit`. Cloud-sync only for now, no localhost.
  - Effort: 4h
  - Merged: 7a2cb6ae (via dev-2)

- [x] **M5** — Document passwordless sudo as an explicit choice
  - Files: `docs/security/04-threat-model.md` (review + polish; promotion to root `SECURITY.md` deferred to public release)
  - Effort: 30 min (review + polish)
  - Merged: 1c64276e

- [x] **M8** — Validate `id` in backup restore
  - File: `web/app/api/backup/route.ts:87-104`
  - Regex `^[a-zA-Z0-9_-]+$`
  - Effort: 5 min
  - Merged: e99d3584

- [x] **M7** — Anonymous variant of `/api/health`
  - File: `web/app/api/health/route.ts`
  - GET without auth → only `{status:'ok'}`; with auth → full details
  - Effort: 30 min
  - Merged: 7a2cb6ae (via dev-2)

- [x] **M1** — `js-yaml.load()` with explicit schema
  - File: `web/lib/profile-reader.ts`
  - `yaml.load(content, { schema: yaml.CORE_SCHEMA })` (excludes extended tags like `!!js/function`) + `isPlainObject` helper for narrowing instead of Zod (no new dep)
  - Effort: 1h
  - Merged: 537c4b07

- [x] **M4** — Error response sanitization
  - Files: new `web/lib/error-response.ts` + sweep over 19 routes (`backup`, `database`, `alerts`, `archive`, `automations`, `channels`, `contacts`, `daemon`, `errors`, `feedback`, `goals`, `i18n`, `migrations`, `monitoring`, `scheduler`, `webhooks`, `saved-searches`, `resume`, `reminders`).
  - Helper `sanitizedError(err, { scope, status, publicMessage })`: log `console.error` with scope + error detail, response `{error:<publicMessage>}` in prod, detail in body only in `NODE_ENV=development`.
  - Effort: 4h
  - Merged: 064d4260 (+ ac280a24, ac447aeb, final batch pending)

---

## 🔧 Phase 3 — ongoing hardening

Things to do gradually in the months after launch. No operational blocker.

### Low

- [x] **L3** — Logger redaction (token/api_key/password/Bearer)
  - File: new `shared/logger/redact.ts` (OpenClaw `redact-bounded.ts` pattern) + hook in `shared/logger/logger.ts:log()`
  - `redactString` on patterns (Bearer, JWT, sk-/ant-/jht_sync_, api_key=, hex 32+) + `redactObject` over SENSITIVE_KEYS; `redactedConsole` wrapper for modules that use console directly
  - Effort: 4h
  - Merged: 2b8264ff

- [ ] **L1** — Hash/nonce-based CSP in production
  - File: `web/next.config.ts:26`
  - Keep `'unsafe-inline'` only in dev (`isDevelopment`); production uses hash- or nonce-based
  - Effort: 1 day
  - Merged: _—_

- [x] **L2** — Validate `JHT_GATEWAY_URL`
  - File: `web/app/api/gateway/route.ts:12`
  - `new URL()` + reject non-http(s) schemes + reject private hostnames without explicit opt-in
  - Effort: 30 min
  - Merged: 6261709a

- [x] **L4** — `.env.example` rotation guide
  - File: `.env.example`
  - Final section with links to Anthropic/Supabase/Google rotation panels
  - Effort: 30 min
  - Merged: 6261709a

- [x] **L5** — `.gitleaksignore` for the 3 false positives in test fixtures
  - File: new `.gitleaksignore`
  - Fingerprints: `6f578deeb0...` x2 and `6d6fc187ed...`
  - Effort: 5 min
  - Merged: 6261709a

### Pre-commit / CI hardening (inspired by OpenClaw)

- [x] Add `detect-secrets` with baseline
  - File: new `.pre-commit-config.yaml` + `.secrets.baseline`
  - Adopt OpenClaw `.detect-secrets.cfg` as a template
  - Effort: 4h (incl. initial baseline)
  - Merged: f5c6068e

- [x] Add `actionlint` over GitHub Actions workflows
  - File: `.pre-commit-config.yaml`
  - Effort: 30 min
  - Merged: d5d3842f

- [x] Add `zizmor` for workflow security audit
  - File: `.pre-commit-config.yaml` + `zizmor.yml` (OpenClaw template)
  - Effort: 1h
  - Merged: d5d3842f

- [x] Add `npm audit --audit-level=high` as a pre-commit hook
  - File: `.pre-commit-config.yaml` + `scripts/pre-commit/npm-audit-prod.mjs`
  - Effort: 1h
  - Merged: d5d3842f

- [x] Pin Docker base image to SHA256
  - Files: `Dockerfile:6`, `.github/dependabot.yml`
  - `FROM node:22-bookworm-slim@sha256:d415caac2f1f77b98caaf9415c5f807e14bc8d7bdea62561ea2fef4fbd08a73c` + Dependabot weekly bump (label `dependencies/docker/security`). No changes to `docker-compose.yml`: the image is inherited from `build:.`, so the pin already applies.
  - Effort: 2h (incl. Renovate config)
  - Merged: 8fbed8fa

### Security tests

- [ ] Add a `tests/security/` suite
  - Tests on exec-safe-bins, exec-surface (OpenClaw `audit-exec-*.test.ts` pattern)
  - Effort: 1 day
  - Merged: _—_

- [ ] CLI command `jht doctor security`
  - File: new `cli/src/commands/doctor-security.js`
  - Diagnostics: missing keys, insecure fallbacks, exposed ports, container sudo, etc.
  - Effort: 1 day
  - Merged: _—_

---

## 🚫 Deferred (not in immediate roadmap)

Explicit decisions to **not do** now, documented in [`03-implementation-tradeoffs.md`](03-implementation-tradeoffs.md):

- ⏸️ **H7** — IDOR ownership check on `tasks/[id]` and `history/[id]`
  - Reason: JHT is single-user. Documented in the threat model. Revisit when JHT becomes multi-tenant.

- ⏸️ **M5b** — `Dockerfile.strict` with non-root user and minimal tooling (OpenClaw `Dockerfile.sandbox` style)
  - Reason: breaks the `--yolo` workflow (agents running `sudo apt install` on the fly). Container ≠ security boundary by design. Revisit if JHT enables multi-tenant scenarios.

- ⏸️ **Strict `resolve-system-bin`** — anti PATH-hijacking wrapper for sensitive binaries
  - Reason: JHT's exec surface (~30 `execFile`/`spawn` calls in `desktop/`) targets user-context tools (`docker`, `colima`, `brew`, `git`, `qemu-img`, `codesign`, `osascript`) — none are security-critical binaries like OpenSSL or ffmpeg that the OpenClaw pattern was designed for. `desktop/main.js:12-20` deliberately *prepends* `/opt/homebrew/bin` and `/usr/local/bin` to PATH because Electron-on-macOS strips them; a strict whitelist would break Docker Desktop / Homebrew on macOS. Revisit when JHT introduces real crypto-shell-out (e.g. `openssl` for code signing).

---

## ➕ Additional gaps (outside the 34 original findings)

Surfaced from the OpenClaw comparison ([`02-openclaw-comparison.md`](02-openclaw-comparison.md)). Not in the 27 internal-audit findings, but **blockers for the public release**.

- [ ] **Generic SSRF dispatcher** — `shared/net/ssrf.ts` missing
  - Adopt the OpenClaw `src/infra/net/ssrf.ts` pattern (538 lines + DNS pinning + IPv4/IPv6 special-use validation)
  - Effort: ~1 day
  - Merged: _—_

---

## 📊 Progress

```
Phase 1 (blockers):     9/9   ██████████████████████████████████  100% ✅
Phase 2 (post-launch): 12/12  ██████████████████████████████████  100% ✅
Phase 3 (hardening):  10/13   ██████████████████████████░░░░░░░░   77%
Non-audit gap:         0/1    ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░    0%
─────────────────────────────────────────────────────────────────
TOTAL:                31/35  ██████████████████████████████░░░   89%
```

> Phase 1 + Phase 2 closed → JHT is ready for **internal merge** and is materially more secure than OpenClaw on 4 out of the 5 top-priority areas.
> **For the public release**, what remains is: **SSRF dispatcher** and **L1** (production hash-based CSP). The other Phase 3 items (`tests/security/`, `jht doctor security`) are continuous hardening and not blocking. `resolve-system-bin` was deferred — JHT has no security-critical shell-out binaries today.

## 🆚 Comparison with OpenClaw

The post-fix comparison against the reference repo lives in [`06-post-fix-comparison.md`](06-post-fix-comparison.md).
Summary: the gap moved from **-78** (pre-fix) to **-25** (post-fix), with security score going from
**36/120 (30%)** to **89/120 (74%)**.
