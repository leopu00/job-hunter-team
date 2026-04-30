# Security Review — Pre-Launch Open Source

**Audit date:** 2026-04-27
**Branch:** dev-1 @ 65f2ec4a
**Scope:** entire repo before the public open-source release
**Tooling:** gitleaks 8.30.1 (full history), npm audit (root/web/desktop), pip-audit, manual code review (3 parallel sub-agents + direct verification)

> 📌 **Current status:** this document is the **pre-fix** snapshot of the audit. Most findings below were resolved in the 2026-04-27 sprint (merge sha `7a2cb6ae`, 31/34 fixes). For the current fix-by-fix status see [`05-checklist.md`](05-checklist.md); for the post-fix balance vs OpenClaw see [`06-post-fix-comparison.md`](06-post-fix-comparison.md).

---

## Threat model assumed

JHT is a local-first desktop app: the Next.js dashboard runs on `localhost:3000` inside a Docker container (or on the host in dev), opened by the Electron app on the user's machine. The public surface is limited to:
- the marketing site on Vercel (`web/app/(public)/**` + `web/app/api/install`, `web/app/api/cloud-sync/**`)
- the `cloud-sync` endpoint for SQLite ↔ Supabase sync

Everything else (`/api/agents`, `/api/secrets`, `/api/database`, `/api/terminal`, `/api/providers`, etc.) is designed for **localhost only** but remains exposed if:
1. the user exposes port 3000 on the network (e.g. SSH tunnel, port forward, shared server);
2. a malicious site (CSRF / DNS rebinding) reaches `http://localhost:3000` from the user's browser;
3. an intermediate proxy passes unsanitized `X-Forwarded-Host` headers (see C1).

Open-sourcing widens risks (1) and (2): anyone reading the code learns at a glance which endpoints "trust localhost".

---

## Findings summary

| Severity | Count |
|----------|-------|
| Critical | **5** |
| High     | **9** |
| Medium   | **8** |
| Low      | **5** |
| **Tot.** | **27** |

| Area                          | Critical | High | Medium | Low |
|-------------------------------|----------|------|--------|-----|
| Auth / API authorization      | 2        | 2    | 1      | -   |
| Command injection / RCE       | 1        | 2    | 1      | -   |
| Crypto / credentials at-rest  | 1        | 3    | 1      | -   |
| Path traversal / file access  | -        | 1    | 1      | -   |
| Dependency vulnerabilities    | -        | 1    | 1      | -   |
| Config / Dockerfile           | -        | -    | 2      | 2   |
| Information disclosure        | 1        | -    | 1      | 1   |
| CSRF / rate limit             | -        | -    | 1      | 1   |
| Secret in git history         | -        | -    | -      | 1   |

**Gitleaks on full history (3122 commits):** 0 real leaks. The 3 hits (`tests/js/.vitest-tasks.json`, `tests/js/config/schema.test.ts`) are test fixtures (`'sk-projkey123'`, UI labels) — false positives manually verified.

**pip-audit on `requirements.txt`:** 0 vulnerabilities.

---

## CRITICAL

### C1 — Localhost auth bypass via `X-Forwarded-Host` header

**File:** `web/lib/auth.ts:15-19, 28-39`

```ts
export async function isLocalRequest(): Promise<boolean> {
  const hdrs = await headers()
  const host = hdrs.get('x-forwarded-host') ?? hdrs.get('host') ?? ''
  return isLocalhostHost(host)
}

export async function requireAuth(): Promise<NextResponse | null> {
  if (!isSupabaseConfigured) return null
  if (await isLocalRequest()) return null
  // ... Supabase check
}
```

**Why critical:** `requireAuth()` is the only gate on the few protected endpoints (terminal, profile-assistant, cloud-sync verify). The function bypasses the Supabase check on any request whose `x-forwarded-host` or `host` matches localhost. The `X-Forwarded-Host` header is **client-controlled** in any deployment without a reverse-proxy that strips/sets it. Consequence:

- if the user exposes the dashboard on the network (even via tunnel), an attacker sends `X-Forwarded-Host: localhost` and bypasses auth.
- in the cloud-sync Vercel deployment, the header is set by Vercel but still preferred over `host`. We need to verify whether Vercel substitutes/normalizes `x-forwarded-host` (by default it forwards it).
- DNS rebinding: a malicious site rebinding to `127.0.0.1` sends `Host: attacker.example`. Doesn't directly bypass because `attacker.example` doesn't match — but if it sets `x-forwarded-host: localhost` from JS, yes. (Note: `X-Forwarded-*` headers are **forbidden headers** in the browser fetch API, so a browser-based attack is blocked; still valid for server-to-server attackers.)

**Fix:** completely remove `x-forwarded-host` from the check, or whitelist it only when coming from a trusted proxy (env var `TRUSTED_PROXY=true`). Also validate that the remote IP (`req.ip` / `x-forwarded-for[-1]`) is loopback before granting the bypass.

```ts
// suggested
function isLocalRequest(req): boolean {
  const remoteAddr = req.ip ?? '' // or headers.get('x-real-ip')
  if (!['127.0.0.1', '::1', 'localhost'].includes(remoteAddr)) return false
  return isLocalhostHost(headers.get('host') ?? '')
}
```

---

### C2 — Sensitive endpoints without `requireAuth()`

**Files:** ~25 routes in `web/app/api/**`. Verified directly:

- `web/app/api/secrets/route.ts` (GET/POST/DELETE) — list/create/delete user API keys
- `web/app/api/database/route.ts` (GET/POST) — query explorer over JSON files in `~/.jht/`
- `web/app/api/agents/[id]/route.ts` (POST) — start/stop/delete agent
- `web/app/api/providers/route.ts` (POST) — `npm install -g`/`uv tool install` with side effects
- `web/app/api/config/route.ts` (GET/POST) — read/write `jht.config.json`
- `web/app/api/env/route.ts` (GET) — enumerates env vars with prefixes `ANTHROPIC_*`, `SUPABASE_*`, `TELEGRAM_*` (names, not values — but reveals which providers are configured)
- `web/app/api/backup/route.ts` (POST/PATCH/DELETE) — create/restore/delete backup
- `web/app/api/health/route.ts` (GET) — exposes internal structure, active sessions, filesystem layout
- `web/app/api/tasks/[id]/route.ts`, `web/app/api/history/[id]/route.ts` — IDOR: no ownership check
- `web/app/api/sessions/route.ts`, `web/app/api/credentials/route.ts`, `web/app/api/logs/route.ts`

**Why critical:** combined with C1, anything that reaches the port is root-equivalent. A malicious site open in the user's browser can:

```js
fetch('http://localhost:3000/api/secrets').then(r => r.json())
// → all secrets in cleartext (mask bypassable via ?id=<uuid>)
fetch('http://localhost:3000/api/agents/scout', { method: 'POST', body: JSON.stringify({action:'start'}) })
// → spawn agent
```

The browser will block reading the cross-origin response (SOP/CORS), but:
- for side-effects (POST → start agent) the request still goes out (classic CSRF);
- `secrets` GET with `Content-Type: application/json` triggers an OPTIONS preflight, which is missing → browser blocks the read but the server already executed the GET and *potentially* leaked via timing/log;
- `database` POST is trivial via form submission (`enctype=text/plain`) → CSRF.

**Fix:**
1. add `requireAuth()` to ALL routes except: `health` (minimal version without details), `cloud-sync/*`, public marketing routes.
2. introduce a `middleware.ts` that applies an Origin/Referer check on all POST/PATCH/DELETE: `Origin === self` or in allowlist, otherwise 403.
3. replace the localhost bypass with a local token generated at startup, written to `~/.jht/.local-token` (mode 0600), passed by the Electron dashboard via `Authorization: Bearer <token>`.

---

### C3 — Command injection in `bridge_health.py` via env var → shell

**File:** `shared/skills/bridge_health.py:105-114`

```python
cmd = (
    f"JHT_TARGET_SESSION='{target_session}' "
    f"JHT_TICK_INTERVAL='{tick_interval}' "
    f"python3 -u {BRIDGE_SCRIPT} >> {BRIDGE_LOG} 2>&1"
)
subprocess.Popen(["setsid", "sh", "-c", cmd], ...)
```

`target_session` comes from env var `JHT_TARGET_SESSION` (line 48). A value like `CAPITANO'; rm -rf $HOME; echo '` produces: `JHT_TARGET_SESSION='CAPITANO'; rm -rf $HOME; echo '' python3 ...`. The `rm -rf` runs.

**Threat model:** who controls `JHT_TARGET_SESSION`? If it comes from:
- user shell: the user attacks themselves, no-op
- runtime config file (`jht.config.json`): if an API endpoint allows writing that file (e.g. `web/app/api/config/route.ts` without auth, see C2), then attacker → file → env → RCE
- Sentinel config sent via API: same pattern

→ chained with C2 it's full remote RCE.

**Fix:**
```python
subprocess.Popen(
    ["setsid", "python3", "-u", str(BRIDGE_SCRIPT)],
    env={**os.environ,
         "JHT_TARGET_SESSION": target_session,  # validated upstream
         "JHT_TICK_INTERVAL": str(int(tick_interval))},
    stdin=subprocess.DEVNULL,
    stdout=open(BRIDGE_LOG, "ab"),
    stderr=subprocess.STDOUT,
    start_new_session=True,
)
```
No `sh -c`, no f-string. Validate `target_session` against `^[A-Z][A-Z0-9_-]{0,31}$`.

---

### C4 — Missing `homedir` import in `shared/credentials/storage.ts`

**File:** `shared/credentials/storage.ts:46-50`

```ts
function resolvePassphrase(): string {
  const envKey = process.env.JHT_CREDENTIALS_KEY?.trim();
  if (envKey) return envKey;
  return `jht-${homedir()}-default`;  // ← homedir not imported
}
```

Verified: `import { homedir } from "node:os"` is missing from `storage.ts`. When `JHT_CREDENTIALS_KEY` is not set (= the vast majority of users), the fallback throws `ReferenceError: homedir is not defined` → `writeCredential`/`readCredential` fail → the entire AES-GCM credential store is inaccessible. The calls are inside `try/catch` returning `null` → silent failure.

**Double impact:** not only a crash; since `readCredential` returns `null` on any error, the user sees "no credentials saved" and likely falls back on less secure solutions (plaintext env var, plaintext file).

**Fix:** add `import { homedir } from "node:os"` at the top of the file. **Plus:** the fallback itself is insecure (passphrase derivable from username) — see H4. Replace it.

---

### C5 — Plaintext fallback in `cli/src/commands/secrets.js`

**File:** `cli/src/commands/secrets.js:80-92`

```js
const key = getEncryptionKey()  // null if JHT_SECRET_KEY not set
if (key) {
  const encrypted = encrypt(options.value, key)
  await writeFile(join(CREDS_DIR, `${options.name}.enc`), encrypted, 'utf-8')
} else {
  // FALLBACK: plaintext JSON
  await writeFile(join(CREDS_DIR, `${options.name}.json`),
    JSON.stringify({ value: options.value, ... }))
  console.log('Secret saved (plaintext).')
}
```

Default UX: the user runs `jht secrets set --name OPENAI --value sk-...` without setting `JHT_SECRET_KEY` → secret written in cleartext to `~/.jht/credentials/OPENAI.json` with no restrictive permissions (no `mode: 0o600`). On multi-user systems it's world-readable if the `umask` permits.

**Fix:**
1. remove the plaintext fallback. If `JHT_SECRET_KEY` is missing, raise an explicit error + suggest `jht secrets init` which generates a passphrase stored in the OS keyring (Keychain/Credential Manager/SecretService).
2. in any case `writeFile(..., { mode: 0o600 })`.

---

## HIGH

### H1 — `/api/secrets`: enumeration + reveal without auth

**File:** `web/app/api/secrets/route.ts:50-63`

```ts
export async function GET(req: NextRequest) {
  const reveal = req.nextUrl.searchParams.get('id')
  const secrets = store.secrets.map(s => ({
    ...
    value: s.id === reveal ? s.value : mask(s.value),
  }))
  return NextResponse.json({ secrets, total: ... })
}
```

Public GET (no `requireAuth()`). The attacker downloads the masked list, takes each `id` (UUID v4 exposed in cleartext), then re-GETs `?id=<uuid>` for each → obtains all values in cleartext.

**Severity:** HIGH. Not CRITICAL only because it requires C1+C2 first (reach localhost:3000 + browser must not block cross-origin JSON read → needs CORS misconfig or tunnel).

**Fix:** `requireAuth()` on GET; remove the `?id=` query (reveal only via POST with confirmation); don't expose `id` in the masked response.

---

### H2 — `/api/database` arbitrary JSON file read via `table` parameter

**File:** `web/app/api/database/route.ts:63-82, 95-108`

POST `{table, query}` does not validate `table` against an allowlist: it calls `scanJsonFiles()` which enumerates `~/.jht/`, `~/.jht/databases/`, `~/.jht/sessions/`, etc., then looks for a file whose basename matches `table`. If the user has `~/.jht/secrets.json` (an existing module!), a POST `{table: "secrets", query: "SELECT *"}` reads the secrets file.

Verified: `secrets.json` is exactly where `web/app/api/secrets/route.ts` saves the API keys. → bypass of the masking.

**Fix:** hardcoded allowlist of visible tables (positions, applications, etc.); exclude files in DATA_DIRS that match `secrets|credentials|tokens|.env`.

---

### H3 — `JHT_SHELL_VIA` interpolated in shell strings (terminal routes)

**Files:**
- `web/app/api/team/terminal/open/route.ts:22-28, 60-83`
- `web/app/api/capitano/terminal/route.ts:17-21, 43-68`

```ts
const dockerContainer = shellVia?.startsWith('docker:') ? shellVia.slice(7) : null
const cmd = `docker exec -it ${dockerContainer} tmux attach -t ${session}`
await execAsync(`osascript -e '... do script "${cmd}"' ...`)
```

`session` is validated (regex). `dockerContainer` is not. The env var is server-side (operator-controlled) → direct attack already requires RCE → severity HIGH not CRITICAL.

**However:** if in the future `JHT_SHELL_VIA` is ever read from a config file modifiable via API (see C2 on the `config` endpoint), it becomes critical.

**Fix:** validate `dockerContainer` with `^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$`. Replace `exec()` with `execFile()` + array for internal invocations. The osascript stays string-based on macOS because the syntax requires it; in that case use rigorous escaping or an external `.scpt` script.

---

### H4 — Weak KDF + predictable fallback in `tui/src/oauth/storage.ts`

**File:** `tui/src/oauth/storage.ts:20-28`

```ts
function getEncryptionKey(): Buffer {
  const envKey = process.env.JHT_ENCRYPTION_KEY
  if (envKey) return scryptSync(envKey, "jht-salt", 32)
  // Fallback: machine-derivable
  const machineId = `${homedir()}-${process.env.USER || "unknown"}`
  return scryptSync(machineId, "jht-fallback-salt", 32)
}
```

Problems:
1. **hardcoded salt** (`"jht-salt"`, `"jht-fallback-salt"`) → rainbow tables shared across all users.
2. **scrypt with Node defaults** (N=16384, r=8, p=1) → ~16ms on a laptop; too fast for a user-supplied password.
3. **machine-derivable fallback**: anyone with read access to the same filesystem knows `homedir()` and `$USER` → can derive the key and decrypt `~/.jht/credentials.json` (which contains Google OAuth refresh_token + others).

**Fix:** same recipe as `shared/credentials/crypto.ts` (PBKDF2 100k, random salt persisted in `.salt`, AES-256-GCM). Remove the fallback: if `JHT_ENCRYPTION_KEY` is missing, raise an explicit error or use the OS keyring (`keytar` on Windows/macOS, `libsecret` on Linux).

---

### H5 — AES-256-CBC without auth tag in `cli/src/commands/secrets.js`

**File:** `cli/src/commands/secrets.js:27-40`

```js
function encrypt(text, key) {
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-256-cbc', key, iv)
  ...
  return iv.toString('hex') + ':' + encrypted.toString('hex')
}
```

CBC without HMAC/GCM = no integrity. An attacker with write access to the file can flip bits in the ciphertext (with a padding oracle if the decrypt exposes distinct errors). Also, the KDF is scrypt with hardcoded salt `'jht-salt'` (line 24).

**Fix:** replace with `aes-256-gcm` (see pattern in `shared/credentials/crypto.ts`). Random salt per file. PBKDF2 / argon2 instead of scrypt-with-defaults.

---

### H6 — Path traversal potential via symlink in `/api/profile/files/[name]`

**File:** `web/app/api/profile/files/[name]/route.ts:19-41`

```ts
const safeName = path.basename(decodeURIComponent(name))
const filePath = path.join(JHT_USER_UPLOADS_DIR, safeName)
const buf = fs.readFileSync(filePath)
```

`path.basename()` strips `..`, ok. But there is no `realpath` check: if the attacker manages to plant a symlink in `JHT_USER_UPLOADS_DIR` (e.g. via `/api/profile-assistant/save` if it accepts arbitrary filenames, or through FS sharing), the read follows the symlink outside the directory.

**Fix:**
```ts
const real = fs.realpathSync(filePath)
const baseDir = fs.realpathSync(JHT_USER_UPLOADS_DIR)
if (!real.startsWith(baseDir + path.sep)) return 404
```
Add `requireAuth()` (route currently readable from any request, see C2).

---

### H7 — IDOR on `/api/tasks/[id]` and `/api/history/[id]`

**Files:** `web/app/api/tasks/[id]/route.ts:60-96`, `web/app/api/history/[id]/route.ts:63-98`

GET/PATCH use the URL `id` without verifying ownership. In a single-user-on-localhost scenario the impact is low, but with multiple profiles on the same machine (multi-tenant) or with backups restored from third parties this is IDOR.

**Fix:** if it becomes multi-user, add `userId` to storage and check `task.userId === currentUser.id`. For now, the note goes in CHANGELOG as "single-user only".

---

### H8 — npm dependency vulnerabilities `web/`

**File:** `web/package.json` (via `npm audit`)

| Package         | Severity | CVE / issue                                           | Fix |
|-----------------|----------|------------------------------------------------------|-----|
| `next`          | high     | DoS via Server Components (GHSA-…)                  | upgrade `next` (range `>=9.3.4-canary.0`) — `npm audit fix` |
| `next-intl`     | moderate | open redirect                                        | upgrade `<4.9.1` |
| `postcss`       | moderate | XSS via unescaped `</style>` in CSS Stringify        | upgrade `<8.5.10` |

**Fix:** `npm --prefix web audit fix`. Verify regressions on `next-intl` (4.x breaking changes).

---

### H9 — `desktop/` dependency vulnerabilities

| Package          | Severity | Issue |
|------------------|----------|-------|
| `electron`       | high     | AppleScript injection in `app.moveToApplicationsFolder` (macOS); service-worker spoof of executeJavaScript IPC reply (`<=39.8.4`) |
| `@xmldom/xmldom` | high     | XML injection via DocumentType serialization; uncontrolled-recursion DoS |

**Fix:** upgrade `electron` to >= 39.9 (verify availability) or pin to a patched version. Upgrade `@xmldom/xmldom`.

---

## MEDIUM

### M1 — `js-yaml.load()` without explicit schema in `profile-reader.ts`

**File:** `web/lib/profile-reader.ts:9, 24`

`yaml.load()` from **js-yaml v4** uses `DEFAULT_SCHEMA` (= `CORE_SCHEMA` extended, **safe by default** from v4 onward: the `!!js/function` type is no longer registered). So the classic YAML RCE doesn't apply. Still some exposure to edge cases (`!!str` surprises, large aliases) and the `as any` on the destructuring.

**Severity recalibrated:** MEDIUM (was HIGH in the agent findings). Fix: use `yaml.load(content, { schema: yaml.CORE_SCHEMA })` to be explicit, and Zod-parse the input to `mapYamlToProfile()`.

---

### M2 — CSRF: no Origin/Referer check on POST/PATCH/DELETE

All mutating API routes (~80+) don't verify the `Origin` header. Browser blocks cross-origin reads via SOP, but a POST `text/plain` or form-encoded (with classic CSRF) goes through and produces side-effects.

**Fix:** global middleware that, on non-safe methods, requires `Origin` ∈ allowlist (`http://localhost:3000`, `http://127.0.0.1:3000`, `app://jht-electron`, prod cloud-sync domain).

---

### M3 — Rate limit absent

No rate limit on:
- `/api/secrets` (allows brute-forcing `?id=`)
- `/api/cloud-sync/verify` (token brute force)
- `/api/agents/*/start` (resource exhaustion)
- chat / assistant endpoints (model abuse → cost)

**Fix:** middleware with `@upstash/ratelimit` or local in-memory implementation. For cloud-sync on Vercel: `@vercel/edge-config` + KV.

---

### M4 — Error leakage in `/api/telegram` and others

**File:** `web/app/api/telegram/route.ts:115-119`

```ts
} catch (err) {
  return NextResponse.json({ error: `Bridge start error: ${err}` }, { status: 500 })
}
```

`err` may contain a stack trace with env vars (even if `TELEGRAM_BOT_TOKEN` is passed via `env: { ... }` to the child and doesn't end up directly in the parent's stack, a downstream exception could). Pattern present in multiple routes.

**Fix:** internal logger + generic response `{ error: 'internal' }` in production.

---

### M5 — Dockerfile: passwordless sudo for user `jht`

**File:** `Dockerfile:96-101`

```dockerfile
RUN echo 'jht ALL=(ALL) NOPASSWD: ALL' > /etc/sudoers.d/jht
```

By design (disposable container, `--yolo` agents). But in multi-user-on-host scenarios, a compromised agent has root inside the container → kernel escape possible (recurring Linux CVEs). **Document the trust model** in README/SECURITY.md: «the container is not a security boundary, just a convenience sandbox».

---

### M6 — Docker-compose exposes Next.js dev without binding to 127.0.0.1

**File:** `docker-compose.yml:63-64`

```yaml
ports:
  - "3000:3000"
```

Defaults to binding `0.0.0.0`. On a laptop on a public network (cafe, conference) the dashboard is reachable by anyone on the LAN.

**Fix:**
```yaml
ports:
  - "127.0.0.1:3000:3000"
```

---

### M7 — `/api/health` exposes internal structure without auth

Counts sessions, active agents, log paths: useful to an attacker for reconnaissance before attempting C2. Trivial mitigation: an "anonymous" version that returns only `{ status: 'ok' }`, details only for authenticated requests.

---

### M8 — Backup restore with user-controlled `id` in path

**File:** `web/app/api/backup/route.ts:87-104`

```ts
const id = searchParams.get('id')
const targetDir = path.join(JHT_HOME, 'restored', id)
```

`id` not validated → traversal with `../`. Mitigated by the fact that `restoreBackup` reads an existing `id`, but no explicit check.

**Fix:** `if (!/^[a-zA-Z0-9_-]+$/.test(id)) return 400`.

---

## LOW

### L1 — CSP `script-src 'unsafe-inline'`

**File:** `web/next.config.ts:26`

Next.js default to support hydration. Limits but does not eliminate XSS protection. In production, evaluate `nonce`-based CSP (Next 16 supports it).

---

### L2 — `/api/gateway` HTTP plaintext default

**File:** `web/app/api/gateway/route.ts:12`

`http://localhost:18789` — acceptable for loopback. Document that `JHT_GATEWAY_URL` must never point to an external host without HTTPS (and validate the schema with `new URL()` + hostname allowlist).

---

### L3 — Telegram bridge in cleartext in logs

**File:** `shared/telegram/*` — verified that the bot token is loaded from `process.env.TELEGRAM_BOT_TOKEN` and not logged. Risk remains of accidental echo in stack trace on crash. Add a global logger filter (`pino-redact`).

---

### L4 — `.env.example`: no warning about key rotation / scope

The file lists all OAuth/API providers without notes on:
- how to revoke a compromised token (especially Google OAuth)
- minimizing OAuth scope (Drive: only `drive.file`, not `drive.readonly`)

**Fix:** "if you accidentally committed a key" section with links to the rotation procedures (Anthropic, Supabase, Google).

---

### L5 — Gitleaks: 3 false positives in test fixtures

**Files:** `tests/js/.vitest-tasks.json`, `tests/js/config/schema.test.ts`

Verified: string `'sk-projkey123'` (clearly fake), UI labels (`Weak/Poor/Good/Excellent`), metric column names. No real secret in 3122 commits.

**Fix:** optional, add `.gitleaksignore` with the 3 fingerprints to remove the noise from CI.

---

## Pre-launch remediation priority

### Phase 1 — release blockers (block tagging release PR)

1. **C4** — fix `homedir` import (1 line) — FIRST, it's a crash-bug.
2. **C1** — strip `x-forwarded-host` from the localhost bypass or require loopback remote IP.
3. **C2** — add `requireAuth()` to `secrets`, `database`, `agents/[id]`, `providers`, `config`, `env`, `backup`, `health` (detailed version), `tasks/[id]`, `history/[id]`, `credentials`, `sessions`, `logs`, `workspace/init`.
4. **C3** — rewrite `bridge_health.py:spawn_bridge` without `sh -c`.
5. **C5** — remove plaintext fallback in `cli/src/commands/secrets.js`.
6. **H1** — auth + remove reveal via query param on `/api/secrets`.
7. **H2** — table allowlist in `/api/database`, exclude `secrets.json`.
8. **H8/H9** — `npm audit fix` on `web/` and `desktop/`.

### Phase 2 — within 2 weeks post-launch

9. **H3** — execFile + `JHT_SHELL_VIA` validation.
10. **H4** — replace machine-derived fallback in `tui/src/oauth/storage.ts` with OS keyring or required env var.
11. **H5** — migrate `cli/src/commands/secrets.js` to AES-256-GCM + PBKDF2.
12. **H6** — `realpath` check in file download.
13. **M2** — global Origin/Referer middleware.
14. **M3** — rate limit on sensitive endpoints.
15. **M6** — bind compose to `127.0.0.1:3000`.

### Phase 3 — ongoing hardening

16. M1, M4, M5, M7, M8, L1–L5.
17. CI: add a `gitleaks detect --staged` step as a pre-commit hook (does `.githooks/` exist?), and `npm audit --audit-level=high` as a CI gate.
18. Document the threat model in `docs/security.md` or `SECURITY.md` at the root.

---

## Operational notes

- **State at the time of the audit (2026-04-27 morning):** report only, no fixes committed. The remediation sprint started in the afternoon (4 parallel agents on `dev-1`..`dev-4`) and was merged into `master` in the evening (`7a2cb6ae`). For fix-by-fix status → [`05-checklist.md`](05-checklist.md).
- The sub-agent findings were spot-checked directly. False positives identified and recalibrated: js-yaml RCE (M1, was HIGH); `/api/database` "SQL injection" (was CRITICAL → restated as H2 file-read); osascript injection with validated session (was CRITICAL → H3, env-controlled).
- Raw tooling output (local, not versioned): gitleaks JSON (3 false positives over 3122 commits), `npm audit` for root/web/desktop, `pip-audit` clean.
