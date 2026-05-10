# ⚖️ Implementation trade-offs

For each fix proposed in [`01-pre-launch-review.md`](01-pre-launch-review.md), this document lists:

- **Dev cost** (implementation effort + maintenance)
- **UX impact** (how the user experience changes)
- **Perf impact** (measurable overhead)
- **Lost or complicated functionality**
- **Verdict**: 🟢 do it / 🟡 do it with opt-out / 🟠 evaluate / 🔴 avoid for now

> Convention: findings are ordered by severity. Labels `[C1]`, `[H4]`, etc. point to `01-pre-launch-review.md`.

> 📌 **Current status:** **pre-implementation** decision document. Almost all 🟢/🟡 verdicts were implemented in the 2026-04-27 sprint (merge sha `7a2cb6ae`). Estimated Phase 1 effort was `3-5 days`; actual execution was ~95 min with 4 parallel agents. For fix-by-fix status see [`05-checklist.md`](05-checklist.md). Decisions explicitly deferred (`H7` multi-user IDOR, `M5b` Dockerfile.strict) remain valid.

---

## 🔴 CRITICAL

### `[C1]` Remove `x-forwarded-host` from the localhost bypass

**What:** replace `web/lib/auth.ts:isLocalRequest` with the OpenClaw pattern `isLocalDirectRequest` (TCP socket peer + reject any forwarded header).

**Dev cost:** 🟢 **Low** (~30 lines). Add `req.socket?.remoteAddress` reading + `hasForwardedRequestHeaders()` helper.

**UX impact:** 🟡 **Medium.**
- The Electron app opens the browser at `http://localhost:3000` → `Host: localhost:3000`, no `x-forwarded-*`, peer 127.0.0.1 → ✅ keeps working.
- Users tunneling via `ngrok`, Cloudflare Tunnel, or an external reverse proxy → all those setups inject `x-forwarded-host` → ❌ no more auth bypass → the user MUST configure Supabase login. For JHT this is desired (today it's the actual bug), but it breaks anyone currently running JHT through a public tunnel without auth.

**Perf:** negligible.

**Functionality lost:** none — the "expose JHT on the public network without auth" case was always wrong.

**Migration plan:**
1. Implement the fix
2. Add a warning log when forwarded headers are detected but Supabase isn't configured
3. Document in `SECURITY.md` the deployment assumption "single host, no proxy"

**Verdict:** 🟢 **Do immediately.** Security bug; no legitimate use case is broken.

---

### `[C2]` Add `requireAuth()` to all sensitive routes

**What:** ~25 endpoints in `web/app/api/**` (secrets, database, agents, providers, config, env, backup, health, tasks, history, credentials, sessions, logs, workspace/init).

**Dev cost:** 🟡 **Medium.** Add one line per route, but we need an auth alternative for the "Electron desktop without Supabase" case.

**UX impact:** 🔴 **High if mishandled.**
- The jht CLI talks via `localhost:3000` → it must pass a token.
- The Electron dashboard must pass the same token.
- Standard solution: file `~/.jht/.local-token` (mode 0600) generated when the server starts, which CLI/Electron read and pass via `Authorization: Bearer <token>`.
- Manual curl during dev → `curl -H "Authorization: Bearer $(cat ~/.jht/.local-token)" ...` → some friction.

**Perf:** negligible (file lookup once + in-memory compare).

**Functionality lost:** none, but the "open a tab and it works" convenience becomes "open an authenticated tab via cookie/header".

**3-step migration plan:**
1. Implement the local-token system (generate at startup if missing)
2. Update CLI + dashboard to read it
3. Add `requireAuth()` with local-token tolerance on the critical routes
4. Document the manual-curl workflow for dev users

**Verdict:** 🟢 **Do**, but it's ~1 day of work for the local-token + CLI/dashboard refactor.

---

### `[C3]` Rewrite `bridge_health.py:spawn_bridge` without `sh -c`

**What:** replace the interpolated string + `sh -c` with `subprocess.Popen([…], env={...})`.

**Dev cost:** 🟢 **Very low** (~10 lines).

**UX impact:** 🟢 **Zero.** Pure internal refactor.

**Perf:** marginally better (no shell fork).

**Functionality lost:** none.

**Verdict:** 🟢 **Do immediately.** No trade-off.

---

### `[C4]` Add `homedir` import in `shared/credentials/storage.ts`

**What:** add `import { homedir } from "node:os"`.

**Dev cost:** 🟢 **1 line.**

**UX impact:** 🟢 **Positive** — unblocks the credential store that today crashes silently in the fallback.

**Functionality lost:** none (it actually restores a broken one).

**Verdict:** 🟢 **Do immediately.** Pure bug fix.

> Note: this "fix" exposes the H4 problem (predictable fallback). Don't leave the machine-derivable fallback: replace it (see below).

---

### `[C5]` Remove plaintext fallback in `cli/src/commands/secrets.js`

**What:** if `JHT_SECRET_KEY` isn't set, raise an explicit error instead of writing plaintext JSON.

**Dev cost:** 🟢 **Low** (~5 lines + an error message with instructions).

**UX impact:** 🟡 **Medium.**
- A user running `jht secrets set` without `JHT_SECRET_KEY` (probably the majority today) gets an error instead of a working command.
- Solution: add `jht secrets init` that generates a passphrase, stores it in the OS keyring, and exposes it as an env var for the current session. See `[H4]` below.

**Functionality lost:** "save a secret with zero setup" — replaced by "save with a one-time setup step at the start".

**Verdict:** 🟢 **Do**, but combine with `[H4]` so the user is not stuck.

---

## 🟠 HIGH

### `[H1]` Auth + remove `?id=` reveal on `/api/secrets`

**What:** call `requireAuth()` (requires `[C2]`); turn the GET into a masked list, add a POST `/reveal` with explicit confirmation to obtain the cleartext value.

**Dev cost:** 🟢 Low. Refactor the client UI to use the new flow.

**UX impact:** 🟡 Medium. The user clicks "reveal" → UX preference + future scaling to "requires password" if we decide so.

**Verdict:** 🟢 **Do** along with `[C2]`.

---

### `[H2]` Allowlist tables in `/api/database`

**What:** match `table` against a hardcoded set of allowed names; exclude files with prefix `secrets|credentials|tokens|.env` from `scanJsonFiles()`.

**Dev cost:** 🟢 Low (~20 lines).

**UX impact:** 🟢 Zero for normal usage (visible tables remain positions/applications/etc.).

**Functionality lost:** a debug tool that allowed "look at any JSON file in the home directory". Removing it is a win.

**Verdict:** 🟢 **Do.**

---

### `[H3]` `JHT_SHELL_VIA` validated + `execFile` instead of `exec`

**What:** regex `^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$` on `dockerContainer`. Replace string-based `exec()` with array-based `execFile()` where possible (cross-platform is tricky because macOS `osascript` requires a string).

**Dev cost:** 🟡 **Medium.** On Windows + Linux it's easy (array). On macOS `osascript` still needs a string → keep `exec()` but escape strictly or move to a separate `.scpt` script.

**UX impact:** 🟢 Zero.

**Verdict:** 🟢 **Do**, with tolerance for the residual macOS string-based bit.

---

### `[H4]` Replace machine-derived fallback in `tui/src/oauth/storage.ts`

**What:** decide between:
- **A)** Native OS keyring (`keytar` or `@napi-rs/keyring`) — the OpenClaw pattern.
- **B)** Required env var + explicit error if missing.
- **C)** Generate a random passphrase the first time, write it to `~/.jht/.passphrase` (mode 0600).

**Dev cost:**
- A) 🟠 **High** — cross-platform native dependency, prebuilt binaries (Win/Mac/Linux), multi-arch CI.
- B) 🟢 Very low.
- C) 🟢 Low, but it's "security theater": if the attacker has filesystem read, they have the passphrase.

**UX impact:**
- A) 🟡 Medium — on headless Linux it needs DBus/SecretService, doesn't work in containers, doesn't work in CI either → fallback B is needed anyway.
- B) 🔴 High — the user must manage the passphrase outside the app.
- C) 🟢 Zero — nobody has to do anything.

**Suggested compromise:** **A if available, fallback to B.**
- Desktop GUI with DBus/Keychain → keyring (perfect security).
- Headless / container / CI → require `JHT_CREDENTIALS_KEY` env var, fail-loud if missing.
- C is not happening: it gives a false sense of security.

**Verdict:** 🟡 **Do with keyring + env-var fallback.** Effort ~3 days for cross-platform testing.

---

### `[H5]` Migrate `cli/src/commands/secrets.js` from AES-CBC to AES-GCM

**What:** replace `aes-256-cbc` with `aes-256-gcm`, add an auth tag, random per-file salt (not hardcoded).

**Dev cost:** 🟢 Low — `shared/credentials/crypto.ts` already implements the pattern, just reuse it.

**UX impact:** 🟠 **High: backwards compatibility.** Anyone with existing CBC-encrypted `.enc` files can no longer decrypt them.

**Migration plan:**
1. Detect: files in the old format (no auth-tag separator) → try CBC decode, re-encrypt as GCM
2. Keep CBC decode for N versions as a migration path
3. UI notice: "migration in progress, take a backup"

**Functionality lost:** none.

**Verdict:** 🟢 **Do** but with an explicit migration path (~4 extra hours of migration code).

---

### `[H6]` Symlink containment check on `/api/profile/files/[name]`

**What:**
```ts
const real = fs.realpathSync(filePath)
const baseDir = fs.realpathSync(JHT_USER_UPLOADS_DIR)
if (!real.startsWith(baseDir + path.sep)) return 404
```

**Dev cost:** 🟢 Very low (~5 lines per route).

**UX impact:** 🟢 Zero.

**Perf:** negligible (`realpath` is one syscall).

**Verdict:** 🟢 **Do.** Pattern to replicate on the other file-serving routes.

---

### `[H7]` IDOR check on `/api/tasks/[id]` and `/api/history/[id]`

**What:** add `userId` to tasks/history, verify ownership.

**Dev cost:** 🟠 **High** — requires a schema migration + refactor of code that today assumes single-user.

**UX impact:** 🟢 Zero for single-user, enabling for multi-user.

**Verdict:** 🟡 **Defer until JHT becomes multi-user.** For now, document in `SECURITY.md` as a "single-user assumption".

---

### `[H8/H9]` `npm audit fix` on web/ and desktop/

**What:** upgrade `next`, `next-intl`, `postcss`, `electron`, `@xmldom/xmldom`.

**Dev cost:** 🟡 Medium — `next-intl` 4.x has breaking changes; the `electron` major upgrade can break IPC.

**UX impact:**
- `next` upgrade → may require refactoring some route handler signatures
- `electron` upgrade → test auto-updater, IPC, native modules
- `next-intl` 4.x → test all locale switching

**Perf:** generally an improvement.

**Functionality lost:** none if breaking changes are managed.

**Migration plan:**
1. Run `npm audit fix` in a dedicated branch
2. Run E2E suite
3. Manual test of the full desktop flow
4. Merge

**Verdict:** 🟢 **Do**, but in a dedicated branch with extensive testing.

---

## 🟡 MEDIUM

### `[M1]` `js-yaml.load()` with explicit schema

**What:** `yaml.load(content, { schema: yaml.CORE_SCHEMA })`.

**Dev cost:** 🟢 Very low. js-yaml v4 is already safe by default; this is defense-in-depth.

**Verdict:** 🟢 **Do** (1-line refactor + Zod schema on the result).

---

### `[M2]` Global Origin/Referer middleware for POST/PATCH/DELETE

**What:** copy OpenClaw's `browserMutationGuardMiddleware` into `web/middleware.ts`.

**Dev cost:** 🟢 Low (~100 lines).

**UX impact:** 🟡 **Medium.**
- Legitimate browser → sends correct `Origin` → ✅ passes
- CLI/curl → no Origin → ✅ passes (intentional, see point 4 of the OpenClaw pattern)
- **Caveat:** some internal Next.js client fetches might not have `Origin` if called from Server Components (server-rendered) → needs testing.

**Functionality lost:** a malicious site can no longer CSRF localhost:3000.

**Verdict:** 🟢 **Do.** Well-tested OpenClaw pattern.

---

### `[M3]` Rate limiting

**What:** in-memory middleware that limits requests per IP/user.

**Dev cost:** 🟡 Medium.
- In-memory: 🟢 easy, but doesn't survive a container restart.
- Persistent (Redis/SQLite): 🟠 requires infrastructure.

**UX impact:**
- Good: blocks brute-force on `/api/secrets?id=`, abuse of `/api/agents/start`, cost abuse on LLM endpoints.
- Bad: power users developing with `npm run dev:host` and making many calls can trip the limit.

**Suggested compromise:**
- Rate limit **only on cloud-sync** (Vercel deployment) with Upstash Redis: critical there.
- Localhost: skip or set very high (e.g. 1000/min) → anti-abuse only, not a security boundary.

**Verdict:** 🟡 **Do on cloud-sync, optional on localhost.**

---

### `[M4]` Error leakage sanitization

**What:** internal logger + generic `{error:'internal'}` response in production.

**Dev cost:** 🟢 Low (~50 lines for a centralized wrapper).

**UX impact:**
- Dev mode: useful stack traces → keep
- Prod: generic message → user sees no detail, but the internal logger has it

**Verdict:** 🟢 **Do** with an env-flag for dev/prod.

---

### `[M5]` Document `Dockerfile` passwordless sudo as an explicit decision

**What:** section in `SECURITY.md` declaring: "the container is not a security boundary, it's a convenience sandbox for `--yolo` agents. The trust separation is host vs container, not agent vs agent inside the container."

**Dev cost:** 🟢 30 minutes.

**Verdict:** 🟢 **Do.** Plus: optionally offer a separate `Dockerfile.strict` for users who want JHT in multi-tenant scenarios (see below).

#### Optional: separate `Dockerfile.sandbox` (OpenClaw style)

**What:** a second Dockerfile with a non-root user, no sudo, minimal tooling.

**Dev cost:** 🟠 **High** — requires rethinking how `--yolo` agents install tools on the fly.
- Today: `sudo apt install pdftotext` when needed
- With sandbox: tools pre-installed at build time → must know upfront what agents need

**UX impact:** 🔴 **High.** An agent that needs a new tool has to wait for a rebuild → huge friction.

**Functionality lost:** the flexibility of "smart agents that auto-install what they need".

**Verdict:** 🔴 **Don't do.** Document the trust model instead. Keep the current `Dockerfile` as default; if JHT later moves toward multi-tenant, then `Dockerfile.strict` as opt-in.

---

### `[M6]` Bind compose to `127.0.0.1:3000`

**What:** `ports: ["127.0.0.1:3000:3000"]` in `docker-compose.yml`.

**Dev cost:** 🟢 1 line.

**UX impact:** 🟡 **Low but real.** Users wanting to reach JHT from another LAN machine (e.g. tablet) must change it manually. Document.

**Functionality lost:** "expose to the whole LAN by default" — that's a minus, not a plus.

**Verdict:** 🟢 **Do.** Safe default; whoever wants to expose, does so explicitly.

---

### `[M7]` Anonymous `/api/health` variant

**What:** GET without auth returns `{status:'ok'}`; with auth returns details.

**Dev cost:** 🟢 Low.

**Verdict:** 🟢 **Do.**

---

### `[M8]` Validate `id` on backup restore

**What:** `if (!/^[a-zA-Z0-9_-]+$/.test(id)) return 400`.

**Dev cost:** 🟢 1 line.

**Verdict:** 🟢 **Do.**

---

## 🟢 LOW

### `[L1]` Nonce/hash-based CSP instead of `'unsafe-inline'`

**What:** Next 16 supports nonce-based CSP natively; the alternative is hash-based, OpenClaw-style `computeInlineScriptHashes`.

**Dev cost:** 🟠 Medium.
- Nonce: Next config + middleware to inject nonces
- Hash: build-time hash injection (more stable but requires knowledge of present inline scripts)

**UX impact:** 🟢 Zero in production. In dev, keep `'unsafe-inline'` for Next.js fast refresh.

**Perf:** negligible at runtime.

**Verdict:** 🟢 **Do for production**, keep `'unsafe-inline'` only in dev.

---

### `[L2]` Validate `JHT_GATEWAY_URL`

**What:** `new URL()` + reject non-http(s) schemes + reject private hostnames without explicit opt-in.

**Dev cost:** 🟢 Very low.

**Verdict:** 🟢 **Do** (it's 5 lines).

---

### `[L3]` Logger redaction (pino-redact-style)

**What:** wrapper that redacts `token`/`api_key`/`password`/`Bearer ...` across all logs.

**Dev cost:** 🟢 Low (~30 lines + a list of patterns).

**Perf:** negligible (chunked redact-bounded, OpenClaw-style).

**Verdict:** 🟢 **Do.** High ROI, low cost.

---

### `[L4]` `.env.example`: "rotation guide" section

**What:** 1 final section with links to Anthropic/Supabase/Google rotation panels.

**Dev cost:** 🟢 30 minutes.

**Verdict:** 🟢 **Do.**

---

### `[L5]` `.gitleaksignore` with the 3 test-fixture fingerprints

**What:** remove the noise in CI.

**Dev cost:** 🟢 5 minutes.

**Verdict:** 🟢 **Do** (almost cosmetic, but free).

---

## 📊 Trade-off summary table

| Finding | Dev cost | UX impact | Lost func. | Verdict |
|---------|-----------|-----------|-------------|---------|
| C1 — no x-forwarded-host | 🟢 | 🟡 | none | 🟢 do |
| C2 — auth on all routes | 🟡 | 🔴 without fix | none | 🟢 do with local-token |
| C3 — bridge_health no shell | 🟢 | 🟢 | none | 🟢 immediately |
| C4 — import homedir | 🟢 | 🟢 | none | 🟢 immediately |
| C5 — no plaintext fallback | 🟢 | 🟡 | UX "1-click set" | 🟢 with C2/H4 |
| H1 — auth secrets | 🟢 | 🟡 | none | 🟢 |
| H2 — database allowlist | 🟢 | 🟢 | debug tool | 🟢 |
| H3 — execFile | 🟡 macOS | 🟢 | none | 🟢 partial |
| H4 — keyring fallback | 🟠 | 🟡 headless | none | 🟡 keyring+env |
| H5 — AES-GCM CLI | 🟢 | 🟠 backcompat | none | 🟢 with migration |
| H6 — realpath | 🟢 | 🟢 | none | 🟢 |
| H7 — IDOR tasks/history | 🟠 | 🟢 | none | 🟡 when multi-user |
| H8/H9 — npm audit fix | 🟡 | 🟢 | none | 🟢 with E2E |
| M1 — yaml schema | 🟢 | 🟢 | none | 🟢 |
| M2 — CSRF middleware | 🟢 | 🟡 | none | 🟢 |
| M3 — rate limit | 🟡 | 🟡 dev | none | 🟡 cloud-sync only |
| M4 — error sanitize | 🟢 | 🟢 | dev stack trace prod-only | 🟢 |
| M5 — document sudo | 🟢 | 🟢 | none | 🟢 |
| M5b — Dockerfile.strict | 🟠 | 🔴 | --yolo flexibility | 🔴 not now |
| M6 — bind 127.0.0.1 | 🟢 | 🟡 LAN | LAN access default | 🟢 |
| M7 — anonymous health | 🟢 | 🟢 | none | 🟢 |
| M8 — validate backup id | 🟢 | 🟢 | none | 🟢 |
| L1 — CSP no inline | 🟠 prod | 🟢 | none | 🟢 prod only |
| L2 — gateway URL | 🟢 | 🟢 | none | 🟢 |
| L3 — log redaction | 🟢 | 🟢 | none | 🟢 |
| L4 — rotation guide | 🟢 | 🟢 | none | 🟢 |
| L5 — gitleaksignore | 🟢 | 🟢 | none | 🟢 |

---

## 🎯 Recurring trade-off patterns

### Trade-off #1: "Who pays the cost of auth?"

Adding auth to today-anonymous routes shifts work from server to client (CLI/dashboard).

- ✅ Clean solution: **local-token in `~/.jht/.local-token`** generated at startup. CLI and Electron read it and pass it via header. No change for the end user.
- ❌ Bad solution: ask the user to manage the token by hand.

### Trade-off #2: "Who manages the secrets?"

Three options for the env-var fallback:
- **OS keyring**: very secure but headless-incompatible, costly to port
- **Required env var**: user friction
- **Random passphrase on disk**: useless as security but convenient

→ **Combine**: keyring when available, env var otherwise, never plaintext.

### Trade-off #3: "Container as a security boundary?"

OpenClaw openly states: "the container is not a multi-tenant boundary". JHT same. The choice is:
- **A)** Document and stop (M5) — zero cost, honest
- **B)** Build a strict `Dockerfile.sandbox` — high cost, breaks `--yolo` agents

→ Sensible choice: **A** now, **B** if we ever go multi-tenant.

### Trade-off #4: "Strictness in dev vs prod?"

CSP, error messages, rate limit — in dev they need to be more permissive (debugging), in prod stricter.

→ Next.js pattern: `if (process.env.NODE_ENV === 'development')` for differing choices. Already used in `next.config.ts`.

### Trade-off #5: "Backwards compatibility?"

H5 (AES-CBC → GCM) and H8/H9 (`npm audit fix`) carry regression risk.

→ **Always** in a dedicated branch with E2E suite + explicit migration path. Never in the same PR as the architectural refactor.

---

## 🚦 Decision matrix at a glance

```
                       ┌────────────────────────────────┐
                       │   Dev cost            UX impact │
                       │   ────────            ───────── │
   🟢 do immediately   │    low                zero/+    │  → C3, C4, M5, M6, M8, L2-L5
   🟢 do with setup    │    medium             manageable│  → C1, C2, C5, H1, H2, H6, M1, M2, M4, M7
   🟡 do with care     │    medium             high      │  → H3, H4, H5, H8, H9, L1, M3
   🔴 defer            │    high               high      │  → H7 (multi-user), M5b (Dockerfile.strict)
                       └────────────────────────────────┘
```

→ **Total Phase 1 effort (green):** ~3-5 days of focused work.
→ **Total Phase 2 effort (yellow):** ~2 additional weeks.
→ **Phase 3 (deferred):** when the use case calls for it.

See also: the full ordering is in [`01-pre-launch-review.md` § Pre-launch remediation priority](01-pre-launch-review.md#pre-launch-remediation-priority).
