# 🔍 OpenClaw vs JHT — Security architecture comparison

**Date:** 2026-04-27 (morning, **pre-fix**)
**OpenClaw revision:** `0dd2844991` (main, refreshed on 2026-04-27)
**JHT revision:** `65f2ec4a` (dev-1, audit baseline)
**Method:** direct reading of OpenClaw's critical files + targeted greps. Quotes are verbatim.

> 📌 **Current status:** this document is the **pre-fix** snapshot (gap -78). For the post-sprint balance (gap closed to -25, score 30→74%) see [`06-post-fix-comparison.md`](06-post-fix-comparison.md).
>
> Cross-reference: every finding cited here (C1, C2, …, L5) is defined in [`01-pre-launch-review.md`](01-pre-launch-review.md).

---

## 0. Size snapshot

```
                    🛡️  OPENCLAW                        🏠  JHT (today)
              ┌────────────────────────────┐    ┌──────────────────────────┐
              │  528 lines auth.ts         │    │  50 lines auth.ts        │
              │  538 lines ssrf.ts         │    │  ❌ no SSRF defense      │
              │  32 modules src/security/  │    │  ❌ no security/         │
              │  43 security tests         │    │  ❌ 0 security tests     │
              │  63 sandbox files*         │    │  ❌ no separate sandbox  │
              │  6 dedicated SSRF tests    │    │  ❌                      │
              │  1 file in /security/      │    │  ❌                      │
              │  secret-equal.ts (12 LOC)  │    │                          │
              └────────────────────────────┘    └──────────────────────────┘
```

OpenClaw is a multi-channel platform with public plugin SDKs → HUGE attack surface, so the investment is justified. JHT is single-purpose desktop-first → no need to copy the mass, only the **patterns**.

---

## 1. Localhost auth bypass

**JHT** (`web/lib/auth.ts:15-19`):
```ts
export async function isLocalRequest(): Promise<boolean> {
  const hdrs = await headers()
  const host = hdrs.get('x-forwarded-host') ?? hdrs.get('host') ?? ''   // ❌ client-controlled
  return isLocalhostHost(host)
}
```

**OpenClaw** (`src/gateway/auth.ts:120-146`):
```ts
export function hasForwardedRequestHeaders(req?: IncomingMessage): boolean {
  if (!req) return false;
  return Boolean(
    req.headers?.forwarded ||
    req.headers?.["x-forwarded-for"] ||
    req.headers?.["x-forwarded-proto"] ||
    req.headers?.["x-real-ip"] ||
    req.headers?.["x-forwarded-host"],
  );
}

export function isLocalDirectRequest(req?: IncomingMessage): boolean {
  if (!req) return false;
  if (!hasForwardedRequestHeaders(req)) {
    return isLoopbackAddress(req.socket?.remoteAddress);   // ✅ TCP socket peer
  }
  return false;   // ✅ ANY forwarded header → not direct local
}
```

**What changes:** OpenClaw treats a request as "direct local" ONLY if (a) the TCP socket peer is loopback AND (b) **none** of the `forwarded*` headers are present. The presence of any forwarded header is treated as "there's a proxy in the path, I cannot trust the peer".

| Aspect | OpenClaw | JHT |
|---------|----------|-----|
| IP source | `req.socket.remoteAddress` (kernel TCP) | `host` / `x-forwarded-host` headers |
| Spoofable? | No | Yes |
| Behavior when proxy is present | Auth required | Bypass |

**Verdict:** ✅ OpenClaw closes C1 definitively.

---

## 2. API auth gating

**JHT:** `requireAuth()` is called per-route, and ~25 sensitive routes simply forget it.

**OpenClaw — layered pattern:**

### 2a. Express global middleware (`extensions/browser/src/browser/server-middleware.ts`)
```ts
export function installBrowserAuthMiddleware(app, auth) {
  if (!auth.token && !auth.password) return;
  app.use((req, res, next) => {
    if (isAuthorizedBrowserRequest(req, auth)) {
      markVerifiedBrowserAuth(req);
      return next();
    }
    res.status(401).send("Unauthorized");
  });
}
```

### 2b. HTTP auth check (`extensions/browser/src/browser/http-auth.ts`)
```ts
export function isAuthorizedBrowserRequest(req, auth): boolean {
  const authorization = firstHeaderValue(req.headers.authorization).trim();

  if (auth.token) {
    const bearer = parseBearerToken(authorization);
    if (bearer && safeEqualSecret(bearer, auth.token)) return true;
  }
  if (auth.password) {
    const passwordHeader = firstHeaderValue(req.headers["x-openclaw-password"]).trim();
    if (passwordHeader && safeEqualSecret(passwordHeader, auth.password)) return true;
    const basicPassword = parseBasicPassword(authorization);
    if (basicPassword && safeEqualSecret(basicPassword, auth.password)) return true;
  }
  return false;
}
```

### 2c. Constant-time compare (`src/security/secret-equal.ts`, 12 lines!)
```ts
import { createHash, timingSafeEqual } from "node:crypto";

export function safeEqualSecret(provided, expected): boolean {
  if (typeof provided !== "string" || typeof expected !== "string") return false;
  const hash = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(hash(provided), hash(expected));
}
```

**Elegant trick:** SHA-256 hashing both sides before `timingSafeEqual` → same-length buffers, no length leak.

**Verdict:** ✅ OpenClaw centralizes, ✅ uses timing-safe compare. JHT can adopt this on the fly.

---

## 3. CSRF / Origin validation

**JHT:** zero. No Origin/Referer checks.

**OpenClaw** (`extensions/browser/src/browser/csrf.ts`, 89 full lines):
```ts
export function shouldRejectBrowserMutation(params): boolean {
  if (!isMutatingMethod(params.method)) return false;

  // 1️⃣ Sec-Fetch-Site cross-site → kill switch (browser-set, not spoofable)
  if (normalizeLowercaseStringOrEmpty(params.secFetchSite) === "cross-site") {
    return true;
  }

  // 2️⃣ Origin present → must be loopback
  if (origin) return !isLoopbackUrl(origin);

  // 3️⃣ Referer fallback
  if (referer) return !isLoopbackUrl(referer);

  // 4️⃣ No Origin/Referer = non-browser client (curl/CLI/undici) → OK
  return false;
}

export function browserMutationGuardMiddleware() {
  return (req, res, next) => {
    if (req.method === "OPTIONS") return next();   // CORS preflight
    if (shouldRejectBrowserMutation({...})) {
      res.status(403).send("Forbidden");
      return;
    }
    next();
  };
}
```

**Three defense layers, ranked:**
1. `Sec-Fetch-Site` (browser-set, **not client-spoofable**)
2. `Origin` validated as a loopback URL
3. `Referer` as a fallback

**Verdict:** ✅ Pattern can be copied verbatim into JHT (`web/middleware.ts` Next.js adapter + the check function).

---

## 4. Command injection / safe exec

**JHT** (`shared/skills/bridge_health.py:105-114`):
```python
cmd = f"JHT_TARGET_SESSION='{target_session}' python3 -u {BRIDGE_SCRIPT}"
subprocess.Popen(["setsid", "sh", "-c", cmd])   # ❌ shell + interpolation
```

**OpenClaw — ALWAYS array-form:**

`src/infra/gateway-lock.ts:114`:
```ts
const raw = execFileSync("ps", ["-p", String(pid), "-o", "command="], {...})
```

`src/infra/machine-name.ts:12`:
```ts
const { stdout } = await execFileAsync("/usr/sbin/scutil", ["--get", key], {...})
```

`src/infra/os-summary.ts:15`:
```ts
const res = spawnSync("sw_vers", ["-productVersion"], { encoding: "utf-8" });
```

### Plus: PATH hijacking defense (`src/infra/resolve-system-bin.ts`)

```ts
/**
 * Trust level for system binary resolution.
 * - "strict": Only fixed OS-managed directories. Use for security-critical
 *   binaries like openssl where a compromised binary has high impact.
 * - "standard": Strict dirs plus common local-admin/package-manager
 *   directories appended after system dirs.
 */
export type SystemBinTrust = "strict" | "standard";

const UNIX_BASE_TRUSTED_DIRS = ["/usr/bin", "/bin", "/usr/sbin", "/sbin"] as const;
// User-writable or package-manager-managed directories are excluded so that
// attacker-planted binaries cannot shadow legitimate system executables.
```

### Plus: dedicated tests

```
src/security/audit-exec-safe-bins.test.ts
src/security/audit-exec-sandbox-host.test.ts
src/security/audit-exec-surface.test.ts
```

**Verdict:** ✅ Multi-layered defense (no shell, absolute whitelisted path, tests in CI). JHT can close C3 with an 8-line refactor.

---

## 5. SSRF defense

**JHT:** zero. Python skills (`shared/skills/check_links.py`) fetch URLs from the DB without validation.

**OpenClaw** — dedicated module of **538 lines** + 6 test files.

`src/infra/net/ssrf.ts:92-96`:
```ts
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",     // 🎯 cloud metadata service
]);
```

`src/infra/net/ssrf.ts:39-45`:
```ts
export type SsrFPolicy = {
  allowPrivateNetwork?: boolean;
  dangerouslyAllowPrivateNetwork?: boolean;     // 🚨 explicit footgun flag
  allowRfc2544BenchmarkRange?: boolean;
  allowedHostnames?: string[];
  hostnameAllowlist?: string[];
};
```

### Related modules

| File | What it does |
|------|---------|
| `src/infra/net/ssrf.ts` | Policy + lookup hook with IPv4/IPv6 validation (special-use, RFC1918, link-local, multicast) |
| `src/infra/net/ssrf.dispatcher.test.ts` | Tests on the hooked undici dispatcher |
| `src/infra/net/ssrf.pinning.test.ts` | **DNS rebinding defense**: resolve once, validate, connect-by-IP |
| `src/agents/tools/web-fetch.ssrf.test.ts` | web-fetch tool covered |
| `src/plugin-sdk/ssrf-policy.ts` | Wrapper exposed to external plugins |

**Verdict:** ✅ Industrial-grade. JHT has nothing here — this is the single most important module to port before launch.

---

## 6. Secret storage / encryption-at-rest

**JHT:**
- ✅ Good: `shared/credentials/crypto.ts` AES-256-GCM + PBKDF2-SHA512 100k iterations
- ❌ Critical bug (C4): `shared/credentials/storage.ts:49` uses `homedir()` without importing it → silent `ReferenceError` → fallback fails
- ❌ High (H4): `tui/src/oauth/storage.ts` has a `scrypt(machineId, "jht-fallback-salt", 32)` fallback derivable by anyone reading the filesystem
- ❌ High (H5): `cli/src/commands/secrets.js` uses AES-256-CBC without auth tag + plaintext fallback

**OpenClaw:**
```ts
// src/agents/cli-credentials.ts:309
log.info("read codex credentials from keychain", { source: "keychain" })
const keychainCreds = readClaudeCliKeychainCredentials({...})
```

→ delegates to the **native OS keyring** (macOS Keychain → Windows Credential Manager → Linux libsecret/SecretService). No custom AES/KDF, no derivable fallback. The key never leaves the OS keyring.

**Verdict:** OpenClaw avoids the problem by choosing **not to implement custom crypto**. JHT can do the same with `keytar` or `@napi-rs/keyring`.

---

## 7. CSP / Security headers

**JHT** (`web/next.config.ts:26`):
```ts
"script-src 'self' 'unsafe-inline'"   // ❌ XSS open
```

**OpenClaw** (`src/gateway/control-ui-csp.ts`, full file 52 lines):
```ts
export function computeInlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  const re = /<script(?:\s[^>]*)?>([^]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const openTag = match[0].slice(0, match[0].indexOf(">") + 1);
    if (hasScriptSrcAttribute(openTag)) continue;
    const content = match[1];
    if (!content) continue;
    const hash = createHash("sha256").update(content, "utf8").digest("base64");
    hashes.push(`sha256-${hash}`);
  }
  return hashes;
}

export function buildControlUiCspHeader(opts?: { inlineScriptHashes?: string[] }): string {
  const hashes = opts?.inlineScriptHashes;
  const scriptSrc = hashes?.length
    ? `script-src 'self' ${hashes.map((h) => `'${h}'`).join(" ")}`
    : "script-src 'self'";
  return [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",         // 🛡️ stricter than X-Frame-Options
    scriptSrc,                         // 'self' + sha256-{...}, NO unsafe-inline
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob:",
    "font-src 'self' https://fonts.gstatic.com",
    "worker-src 'self'",
    "connect-src 'self' ws: wss:",
  ].join("; ");
}
```

**Verdict:** ✅ Hash-based CSP for inline scripts. JHT can adopt it (Next 16 has nonce-based APIs; the hash-based pattern needs middleware injection but is reachable).

---

## 8. Sandbox model

**JHT** (`Dockerfile:96-101`):
```dockerfile
RUN echo 'jht ALL=(ALL) NOPASSWD: ALL' > /etc/sudoers.d/jht
```
Single container with passwordless sudo.

**OpenClaw — THREE separate Dockerfiles:**

`Dockerfile.sandbox`:
```dockerfile
FROM debian:bookworm-slim@sha256:4724b8cc51e33e398f0e2e15e18d5ec2851ff0c2280647e1310bc1642182655d
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get install -y --no-install-recommends \
    bash ca-certificates curl git jq python3 ripgrep

RUN useradd --create-home --shell /bin/bash sandbox
USER sandbox                     # ✅ no sudo
WORKDIR /home/sandbox
CMD ["sleep", "infinity"]
```

| Aspect | OpenClaw | JHT |
|---------|----------|-----|
| Base image | `debian@sha256:4724b8…` (pinned) | `node:22-bookworm-slim` (mutable tag) |
| User | non-root `sandbox` | `jht` with NOPASSWD sudo |
| Tools included | bash, ca-certs, curl, git, jq, python3, ripgrep | full runtime + build-essential + sudo |
| Philosophy | "agent can only destroy itself" | "agent has full access to the container" |

**Verdict:** ⚠️ Major architectural trade-off (see `03-implementation-tradeoffs.md`).

---

## 9. Pre-commit / CI hardening

| Tool | OpenClaw | JHT |
|------|----------|-----|
| `detect-secrets` + 433 KB baseline | ✅ `.pre-commit-config.yaml` | ❌ |
| `shellcheck --severity=error` | ✅ | ❌ |
| `actionlint` (GitHub Actions) | ✅ | ❌ |
| `zizmor` (workflow security audit) | ✅ regular persona, min-severity medium | ❌ |
| `pnpm-audit-prod --audit-level=high` as **pre-commit** | ✅ | ❌ |
| `oxlint --type-aware` | ✅ Rust-based, ~10x faster than eslint | ❌ |
| Pinned Docker base SHA | ✅ | ❌ |
| Dedicated exec safety tests | ✅ 3 files | ❌ |

**Verdict:** ✅ JHT can copy `.pre-commit-config.yaml` almost as-is.

---

## 10. Logging redaction

**JHT:** zero redaction. `console.log` everywhere.

**OpenClaw** (`src/logging/redact-bounded.ts`):
```ts
export const REDACT_REGEX_CHUNK_THRESHOLD = 32_768;
export const REDACT_REGEX_CHUNK_SIZE = 16_384;

export function replacePatternBounded(
  text: string,
  pattern: RegExp,
  replacer: Parameters<string["replace"]>[1],
  options?: BoundedRedactOptions,
): string {
  if (text.length <= chunkThreshold) return text.replace(pattern, replacer);
  // Chunked: avoid catastrophic ReDoS on huge strings
  let output = "";
  for (let index = 0; index < text.length; index += chunkSize) {
    output += text.slice(index, index + chunkSize).replace(pattern, replacer);
  }
  return output;
}
```

→ even **log redaction** is hardened against ReDoS (regex chunking).

**Verdict:** ✅ Simple pattern (~30 lines) + secret-pattern list (`token`, `api_key`, `password`, `Bearer`, etc.). Zero reasons not to have it.

---

## 11. Explicit threat model

**JHT:** zero. No `SECURITY.md`.

**OpenClaw** (`SECURITY.md`, 28 KB):
- Section **"Operator Trust Model"** with 20+ items on what's in scope
- Section **"Out of Scope"** with 30+ documented cases (including "passwordless sudo inside the container is an explicit trust choice, not a bug")
- Section **"Common False-Positive Patterns"** that enumerates 25 report patterns closed as no-action
- Section **"Deployment Assumptions"** that states: "a gateway shared between adversarial users is NOT a recommended setup"

**Verdict:** ✅ This document alone closes half of the false-positives that will arrive after open-sourcing. **Zero cost, max ROI.**

---

## 12. Final score card

| Area                         | OpenClaw | JHT | Gap  |
|------------------------------|----------|-----|------|
| 🔐 Auth gating                | **10**   | 4   | -6   |
| 🌐 SSRF defense               | **10**   | 0   | -10  |
| 🚫 Cmd injection prevention   | **10**   | 5   | -5   |
| 🗝️ Secret storage             | **9**    | 5   | -4   |
| 🛡️ CSP / security headers     | **10**   | 6   | -4   |
| 📦 Sandbox isolation          | **9**    | 4   | -5   |
| 🔍 Path traversal prev.       | **8**    | 6   | -2   |
| 🚨 CSRF / origin              | **9**    | 2   | -7   |
| 📝 Logging redaction          | **9**    | 1   | -8   |
| 🤖 Pre-commit / CI hardening  | **10**   | 3   | -7   |
| 📜 Documented threat model    | **10**   | 0   | -10  |
| 🔬 Security audit infra       | **10**   | 0   | -10  |
| **TOTAL / 120**               | **114**  | 36  | -78  |

---

## 13. Top-5 to steal right now

1. 🥇 **`isLocalDirectRequest()`** — 13 lines, fixes critical C1. (`src/gateway/auth.ts:134-146`)
2. 🥈 **`SsrFPolicy` + DNS pinning** — single module, blocks SSRF on Day-1. (`src/infra/net/ssrf.ts`)
3. 🥉 **`safeEqualSecret()`** — 12 lines, timing-safe for every token compare. (`src/security/secret-equal.ts`)
4. 🏅 **`browserMutationGuardMiddleware()`** — 89 lines, closes CSRF. (`extensions/browser/src/browser/csrf.ts`)
5. 🏅 **`SECURITY.md` with threat model** — 28 KB of writing, infinite ROI.

→ The trade-offs of each adoption are in [`03-implementation-tradeoffs.md`](03-implementation-tradeoffs.md).

> 📍 **Post-sprint status (sha `7a2cb6ae`):** 4 of the 5 top items have been adopted (#1 C1, #3 timing-safe compare, #4 CSRF middleware, #5 threat model in [`04-threat-model.md`](04-threat-model.md)). **#2 SSRF remains the main residual gap before public release.** Details in [`06-post-fix-comparison.md`](06-post-fix-comparison.md).
