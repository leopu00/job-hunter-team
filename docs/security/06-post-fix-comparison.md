# 🆚 Post-fix comparison — JHT vs OpenClaw (round 2)

**Date:** 2026-04-27 17:00
**OpenClaw reference:** revision `c41126dbbb` (main) — synced before comparison
**JHT reference:** branch `dev-1` @ `6278d7ff` (all 4 dev branches aligned to the same HEAD after forced convergence)
**Previous round:** [`02-openclaw-comparison.md`](02-openclaw-comparison.md) — that report set the gap at **-78 points**.

> Team-work session: ~95 min with 4 Claude agents in parallel (dev-1..dev-4), 31/34 tasks closed (91%).

---

## 0. What changed since round 1

```
                  PRE-FIX                  POST-FIX                OPENCLAW
              (2026-04-27 11:00)      (2026-04-27 16:55)      (live main)
               ──────────────         ──────────────          ──────────────
 Phase 1+2:        0/21                  21/21 ✅
 Phase 3:          0/13                  10/13
 Total fix:        0/34                  31/34 (91%)
```

> Note: the `34` is the total of findings from the **internal audit**. The OpenClaw comparison surfaced 1 additional non-audit gap (generic SSRF dispatcher) which has since landed; `resolve-system-bin` was deferred with rationale. Including the post-session work on SSRF dispatcher (4 commits) and L1 nonce-based CSP, the public-release total is 33/35 (94%).

**New files created in the repo during this session:**

| File | Purpose | OpenClaw reference pattern |
|------|----------|----------------------------------|
| `web/lib/local-token.ts` | Local-token gen + bearer/cookie validate (timing-safe) | `extensions/browser/src/browser/http-auth.ts` |
| `web/lib/csrf.ts` | `shouldRejectBrowserMutation` middleware logic | `extensions/browser/src/browser/csrf.ts` |
| `web/lib/error-response.ts` | `sanitizedError()` to standardize 19+ routes | (original, not in OpenClaw) |
| `web/lib/fs-safety.ts` | `safeResolveUnder()` realpath + containment | `safe-resolve.ts` |
| `shared/credentials/passphrase.ts` | env→keyring→error (no machine-derived) | `cli-credentials.ts` keychain pattern |
| `shared/credentials/manager.ts` | Credentials lookup orchestrator | — |
| `shared/logger/redact.ts` | Pattern-based redaction (Bearer, sk-, hex 32+) | `src/logging/redact-bounded.ts` |
| `.pre-commit-config.yaml` | detect-secrets + actionlint + zizmor + npm-audit-prod | same + shellcheck + ruff |
| `.secrets.baseline` | detect-secrets findings snapshot | same (it's large) |
| `zizmor.yml` | unpinned-uses/excessive-permissions disabled | identical |
| `scripts/pre-commit/npm-audit-prod.mjs` | audit fail on high+ in prod deps | same concept |
| `cli/src/commands/keyring.js` | `jht keyring set/get/delete` for passphrase provisioning | (innovation, not in OpenClaw) |

---

## 1. Auth + localhost bypass (C1) — gap closed ✅

| | OpenClaw | JHT pre-fix | **JHT post-fix** |
|---|---|---|---|
| Source IP | `req.socket.remoteAddress` | `x-forwarded-host` ❌ | `host` + reject if forwarded headers ✅ |
| Trust forwarded headers? | NO | YES (bug C1) | NO ✅ |
| Pattern function | `isLocalDirectRequest` (528 LOC auth.ts) | — | `hasForwardedRequestHeaders` + `isLocalRequestFromHeaders` (95 LOC) |

**JHT `web/lib/auth.ts:22-32`** — exact OpenClaw pattern, cited in a code comment:
```ts
const FORWARDED_REQUEST_HEADERS = [
  'forwarded', 'x-forwarded-for', 'x-forwarded-proto',
  'x-forwarded-host', 'x-real-ip',
] as const

export function hasForwardedRequestHeaders(hdrs: Headers): boolean {
  return FORWARDED_REQUEST_HEADERS.some((name) => hdrs.get(name) !== null)
}
```

**Score:** 4/10 → **9/10** (Δ +5)

---

## 2. CSRF middleware (M2) — gap closed ✅

| | OpenClaw | JHT pre-fix | **JHT post-fix** |
|---|---|---|---|
| File | `extensions/browser/src/browser/csrf.ts` (89 LOC) | ❌ | `web/lib/csrf.ts` (97 LOC) |
| `Sec-Fetch-Site` check | ✅ | ❌ | ✅ |
| Origin allowlist | ✅ | ❌ | ✅ + `JHT_PUBLIC_ORIGIN` env for cloud-sync |
| Referer fallback | ✅ | ❌ | ✅ |
| Pass-through CLI/curl | ✅ | n/a | ✅ |

JHT explicitly cites in `web/lib/csrf.ts:4`: `Pattern: OpenClaw browserMutationGuardMiddleware (extensions/browser/src/browser/csrf.ts)`.

**Score:** 2/10 → **9/10** (Δ +7)

---

## 3. Local-token / auth flow (C2) — gap closed ✅ + innovation

| | OpenClaw | JHT pre-fix | **JHT post-fix** |
|---|---|---|---|
| Auth methods | 7 (token/password/tailscale/device/bootstrap/trusted-proxy/none) | trustless localhost bypass | HttpOnly cookie + Bearer fallback |
| Constant-time compare | `safeEqualSecret` 12 LOC module | `===` ❌ | inline `timingSafeEqual` 4 lines |
| HttpOnly cookie | — | — | ✅ `jht_local_token` SameSite=Strict |

**JHT innovation vs OpenClaw:** dev-3, during the design pair-up, noticed that the browser does not send a Bearer header automatically:
> "CLI/Electron do NOT fetch toward local /api/* (only cloud-sync). The real client is a browser launched via openExternal. Bearer cannot come from CLI/Electron. Proposal: middleware sets HttpOnly cookie if localhost direct, the browser sends it automatically."

→ JHT implemented **dual-channel auth** (HttpOnly cookie + Bearer fallback) that OpenClaw does not have. Plus: a new CLI command `jht keyring set/get/delete` for user-friendly passphrase provisioning (not in OpenClaw).

**Score:** included in Auth gating above.

---

## 4. Path traversal (H6) — gap closed ✅

**JHT `web/lib/fs-safety.ts:14`** cites: `Pattern consistent with OpenClaw safe-resolve.ts`.

```ts
export function safeResolveUnder(baseDir: string, candidate: string): string | null {
  const realBase = fs.realpathSync(baseDir)
  const realCandidate = fs.realpathSync(candidate)
  const baseWithSep = realBase.endsWith(path.sep) ? realBase : realBase + path.sep
  if (realCandidate !== realBase && !realCandidate.startsWith(baseWithSep)) return null
  return realCandidate
}
```

**Score:** 6/10 → **9/10** (Δ +3)

---

## 5. Secret storage / keyring (H4 + H5 + C5) — gap closed ✅

| | OpenClaw | JHT pre-fix | **JHT post-fix** |
|---|---|---|---|
| Encryption-at-rest | Native OS Keychain | AES-256-GCM but predictable fallback | AES-256-GCM + optional `@napi-rs/keyring` |
| Fallback priority | Native Keychain + manual prompt | env → `homedir()` ❌ | env → keyring → `MissingPassphraseError` ✅ |
| Plaintext fallback | NO | ❌ yes in `cli/secrets.js` | ✅ removed, fail-loud |
| AES mode CLI | n/a | CBC without auth tag | GCM with auth tag |

**`shared/credentials/passphrase.ts`** is the new module that orchestrates lookup. **`MissingPassphraseError`** has an educational message that points to `jht keyring set jht-credentials`.

**Score:** 5/10 → **9/10** (Δ +4)

---

## 6. Command injection (C3 + H3) — partially closed 🟡

| | OpenClaw | JHT pre-fix | **JHT post-fix** |
|---|---|---|---|
| `subprocess` array vs shell | always array | f-string + `sh -c` ❌ | array ✅ (C3 done) |
| `JHT_SHELL_VIA` validation | n/a | none | regex validate ✅ (H3 done) |
| `resolve-system-bin` strict trust dirs | ✅ mandatory wrapper (`src/infra/resolve-system-bin.ts`) | ❌ | ❌ **residual gap** |

**Residual gap:** OpenClaw protects against PATH hijacking with `resolveSystemBin("strict")`, which restricts `execFile`/`spawn` resolution to system directories (`/usr/bin`, `/bin`, `/usr/sbin`, `/sbin`). An attacker who plants a binary in a user-writable directory (e.g. `~/.local/bin`) cannot shadow system executables. **JHT does not have this wrapper** → a compromised agent that writes to the user `$PATH` can intercept invocations.

**Score:** 5/10 → **8/10** (Δ +3)

---

## 7. SSRF defense — gap closed ✅

| | OpenClaw | JHT pre-fix | **JHT post-fix** |
|---|---|---|---|
| Dedicated module | `src/infra/net/ssrf.ts` 538 LOC | ❌ | ✅ `shared/net/ssrf.ts` (350 LOC distilled) + `shared/net/ip.ts` (faithful port) |
| DNS pinning anti-rebinding | ✅ resolve once + connect-by-IP | — | 🟡 pre-flight DNS validation + per-IP recheck (no dispatcher-level connect-by-IP — small TOCTOU window remains, documented) |
| Block metadata.google.internal | ✅ | — | ✅ |
| Generic policy for outbound fetch | ✅ `SsrFPolicy` with hooked dispatcher | — | ✅ `SsrFPolicy` with `allowPrivateNetwork`, `allowedHostnames`, `hostnameAllowlist`, `allowRfc2544BenchmarkRange` |
| RFC1918 / IPv6 ULA / CGNAT / multicast | ✅ all of them | — | ✅ all of them, plus IPv4-mapped IPv6, NAT64 / 6to4 / Teredo / ISATAP / RFC6052 embedded sentinels, legacy IPv4 literals |

**Score:** 0/10 → **8/10** (Δ +8). The remaining 2 points are dispatcher-level DNS pinning via undici Agent, deferred — out of JHT's single-user threat model.

**What landed:**
- `shared/net/ssrf.ts` with `validateUrl`, `resolveAndAssertPublicHostname`, `safeFetch` (manual redirect handling, per-hop revalidation, cross-origin sensitive-header stripping, SsrFBlockedError), 80/80 tests pass.
- Integrated at `web/api/webhooks` test-ping (user-controlled URL) and `web/api/gateway` (env-controlled, replaces homemade regex check).

**Follow-ups (non-blocker):**
- Python adapter for `shared/skills/check_links.py`.
- CLI integration (currently JS-only, needs build step).
- Apply to `web/api/{deploy,pipelines,download,cloud-sync}` for defence-in-depth.

---

## 8. CSP / security headers (L1) — gap closed ✅

| | OpenClaw | JHT pre-fix | **JHT post-fix** |
|---|---|---|---|
| `script-src` | dynamic hash-based (`computeInlineScriptHashes`) | `'unsafe-inline'` | ✅ per-request nonce + `'strict-dynamic'` (prod), `'unsafe-inline'` retained only in dev for HMR |
| Per-request nonce delivery | static at build time (hash) | n/a | ✅ `web/middleware.ts` mints fresh base64 nonce per request, propagates via `x-nonce` request header for server components and applied automatically by Next to its own framework scripts |
| `frame-ancestors` | `'none'` | (`X-Frame-Options DENY` header only) | unchanged |
| Other headers | all | all ✅ | unchanged |

**Score:** 6/10 → **9/10** (Δ +3) — production now blocks inline-script XSS without the `'unsafe-inline'` escape hatch. The remaining 1 point is style-src tightening (intentionally deferred — script XSS is the dominant vector).

---

## 9. Sandbox / container — documented ✅

| | OpenClaw | JHT pre-fix | **JHT post-fix** |
|---|---|---|---|
| Strict `Dockerfile.sandbox` | yes (non-root user, no sudo) | single Dockerfile with NOPASSWD sudo | unchanged |
| Pinned base image SHA256 | ✅ | ❌ (`node:22-bookworm-slim` mutable) | ✅ pinned to `sha256:d415caac...` + Dependabot weekly |
| Trust model documented | `SECURITY.md` | ❌ | ✅ `04-threat-model.md` (M5) |

**Score:** 4/10 → **6/10** (Δ +2)

---

## 10. Pre-commit / CI hardening — gap closed ✅

| Tool | OpenClaw | JHT post-fix |
|------|----------|--------------|
| `detect-secrets` + baseline | ✅ | ✅ `.secrets.baseline` from initial scan |
| `actionlint` | ✅ | ✅ |
| `zizmor` | ✅ regular persona, min-severity medium | ✅ identical (`zizmor.yml` file) |
| `npm-audit-prod` | ✅ via script | ✅ `scripts/pre-commit/npm-audit-prod.mjs` |
| `shellcheck` | ✅ | ❌ (not imported — minor gap) |
| Pin Docker base SHA | ✅ | ✅ `sha256:d415caac...` |

**Score:** 3/10 → **9/10** (Δ +6)

---

## 11. Logging redaction (L3) — gap closed ✅

**JHT `shared/logger/redact.ts`**: redact on patterns (Bearer, JWT, sk-/ant-/jht_sync_, api_key=, hex 32+) + redactObject over SENSITIVE_KEYS + `redactedConsole` wrapper.

**Score:** 1/10 → **8/10** (Δ +7)

---

## 12. Threat model + SECURITY.md — gap closed ✅

JHT has **`docs/security/04-threat-model.md`** with:
- Explicit single-user assumption
- Enumerated in-scope / out-of-scope
- Container ≠ security boundary documented
- Reporting policy (interim `leopu00@gmail.com` until `security@jobhunterteam.ai` is set up)
- Crypto / data handling section
- Update / patch policy

When the public release ships, this doc is promoted to `SECURITY.md` at the root of the repo.

**Score:** 0/10 → **9/10** (Δ +9)

---

# 📊 Updated score card

| Area | OpenClaw | JHT pre-fix | **JHT post-fix** | Δ |
|---|---|---|---|---|
| 🔐 Auth gating | 10 | 4 | **9** | +5 |
| 🌐 SSRF defense | 10 | 0 | **8** | +8 |
| 🚫 Cmd injection | 10 | 5 | **8** | +3 |
| 🗝️ Secret storage | 9 | 5 | **9** | +4 |
| 🛡️ CSP / headers | 10 | 6 | **9** | +3 |
| 📦 Sandbox isolation | 9 | 4 | **6** | +2 |
| 🔍 Path traversal | 8 | 6 | **9** | +3 |
| 🚨 CSRF / origin | 9 | 2 | **9** | +7 |
| 📝 Logging redaction | 9 | 1 | **8** | +7 |
| 🤖 Pre-commit / CI | 10 | 3 | **9** | +6 |
| 📜 Threat model | 10 | 0 | **9** | +9 |
| 🔬 Audit infrastructure | 10 | 0 | **3** | +3 |
| **TOTAL / 120** | **114** | **36** | **96** | **+60** |

```
              Pre-fix     ████████░░░░░░░░░░░░░░░░░░░░░░  36/120  (30%)
              Post-fix    ██████████████████████████░░░░  96/120  (80%)
              OpenClaw    ████████████████████████████░░  114/120 (95%)
                                   ↑
                          Residual gap: -18 (was -78)
```

---

# 🎯 What remains after this session

## ✅ Public-release blockers — closed

1. ~~**Generic SSRF dispatcher**~~ — `shared/net/ssrf.ts` landed. 350 LOC distilled from OpenClaw, plus `shared/net/ip.ts` faithfully ported. Integrated at the user-controlled URL surfaces (webhooks test, gateway). 80/80 tests pass.
2. ~~**Strict `resolve-system-bin`**~~ — deferred with rationale (JHT has no security-critical shell-out binaries today; `desktop/main.js` deliberately prepends `/opt/homebrew/bin` to PATH for Docker Desktop / Homebrew, which a strict whitelist would break on macOS).
3. ~~**Nonce-based CSP in production**~~ — `web/middleware.ts` mints a per-request nonce, `script-src 'self' 'nonce-XXX' 'strict-dynamic'` in prod with `'unsafe-inline'` retained only in dev for HMR.

## 🟡 Nice-to-have (Phase 3 long-tail, non-blocker)

4. **`tests/security/`** suite — patterns aligned with OpenClaw `audit-exec-*.test.ts` (today 0 tests, OpenClaw has 43).
5. **`jht doctor security`** CLI command — diagnostics for missing keys, exposed ports, insecure fallbacks.
6. **`Dockerfile.sandbox`** optional — only if JHT enables multi-tenant scenarios in the future.
7. **SSRF coverage extension** — Python adapter for `shared/skills/check_links.py`, CLI integration (currently JS-only), apply to `web/api/{deploy,pipelines,download,cloud-sync}` for defence-in-depth.
8. **Style-src tightening** — replace `'unsafe-inline'` with `'unsafe-hashes'` for inline `style` JSX attributes once the cost/benefit makes sense (script XSS is the dominant vector).

---

# 💡 Architectural insights that emerged

1. **Pair-up works but requires pivot agility.** The dev-3 + dev-4 pair on C2 had **a mid-flight design change** (Bearer→HttpOnly cookie) that the agents handled autonomously via tmux comms. Pattern: the technical lead (dev-3) made the pivot, the follower (dev-4) confirmed and implemented the client side.

2. **Staggered cross-merges avoid merge hell.** The first cross-merges worked (dev-3 merged dev-1+dev-2, fast-forward). When I asked for forced convergence "everyone merges everyone else", a classic **diamond merge problem** emerged (every round generates new divergent SHAs). Resolved with the **"one leader merges all, others pull --ff-only"** strategy.

3. **Commit message style is uniform.** All 4 devs followed the convention `fix(area): what`/`feat(area): what`/`docs(security): what` — no Co-Authored-By Claude trailer left in (per instructions). Output is presentable for an external audit.

4. **JHT innovated on 2 points vs OpenClaw:**
   - **Dual-channel HttpOnly cookie + Bearer fallback** (browser and CLI together)
   - **`jht keyring set/get/delete` CLI** for user-friendly passphrase provisioning

5. **The threat model is the single highest-ROI investment.** Documenting openly "container ≠ security boundary" + "single-user assumption" preempts half of the false-positives that arrive after open-sourcing.
