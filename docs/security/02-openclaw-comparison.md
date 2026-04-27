# 🔍 OpenClaw vs JHT — Security architecture comparison

**Data:** 2026-04-27
**OpenClaw revision:** `0dd2844991` (main, aggiornato il 2026-04-27)
**JHT revision:** `65f2ec4a` (dev-1)
**Metodo:** lettura diretta dei file critici di OpenClaw + grep mirati. Le quote sono testuali.

> Riferimento crociato: ogni finding citato qui (C1, C2, …, L5) è definito in [`01-pre-launch-review.md`](01-pre-launch-review.md).

---

## 0. Snapshot dimensionale

```
                    🛡️  OPENCLAW                        🏠  JHT (oggi)
              ┌────────────────────────────┐    ┌──────────────────────────┐
              │  528 righe auth.ts         │    │  50 righe auth.ts        │
              │  538 righe ssrf.ts         │    │  ❌ no SSRF defense      │
              │  32 moduli src/security/   │    │  ❌ no security/         │
              │  43 test security          │    │  ❌ 0 test security      │
              │  63 file sandbox*          │    │  ❌ no sandbox separato  │
              │  6 test SSRF dedicati      │    │  ❌                      │
              │  1 file /security/         │    │  ❌                      │
              │  secret-equal.ts (12 LOC)  │    │                          │
              └────────────────────────────┘    └──────────────────────────┘
```

OpenClaw è una piattaforma multi-channel con plugin SDK pubblici → superficie ENORME, quindi gli investimenti sono giustificati. JHT è single-purpose desktop-first → non serve copiare la massa, serve copiare i **pattern**.

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

**Cosa cambia:** OpenClaw considera la richiesta "local diretta" SOLO se (a) la TCP socket peer è loopback E (b) **nessuno** degli header `forwarded*` è presente. La presenza di un header forwarded è treated come "c'è un proxy in mezzo, non posso fidarmi del peer".

| Aspetto | OpenClaw | JHT |
|---------|----------|-----|
| Source dell'IP | `req.socket.remoteAddress` (kernel TCP) | `host`/`x-forwarded-host` headers |
| Spoofable? | No | Sì |
| Comportamento se proxy presente | Auth obbligatoria | Bypass |

**Verdict:** ✅ OpenClaw chiude C1 in modo definitivo.

---

## 2. API auth gating

**JHT:** `requireAuth()` chiamata per-route, e ~25 route sensibili la dimenticano.

**OpenClaw — pattern stratificato:**

### 2a. Express middleware globale (`extensions/browser/src/browser/server-middleware.ts`)
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

### 2c. Constant-time compare (`src/security/secret-equal.ts`, 12 righe!)
```ts
import { createHash, timingSafeEqual } from "node:crypto";

export function safeEqualSecret(provided, expected): boolean {
  if (typeof provided !== "string" || typeof expected !== "string") return false;
  const hash = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(hash(provided), hash(expected));
}
```

**Trick elegante:** hash SHA-256 entrambi i lati prima di `timingSafeEqual` → buffer same-length, niente leak di lunghezza.

**Verdict:** ✅ OpenClaw centralizza, ✅ usa timing-safe compare. JHT può adottare al volo.

---

## 3. CSRF / Origin validation

**JHT:** zero. Nessun controllo Origin/Referer.

**OpenClaw** (`extensions/browser/src/browser/csrf.ts`, 89 righe complete):
```ts
export function shouldRejectBrowserMutation(params): boolean {
  if (!isMutatingMethod(params.method)) return false;

  // 1️⃣ Sec-Fetch-Site cross-site → kill switch (browser-set, non spoofable)
  if (normalizeLowercaseStringOrEmpty(params.secFetchSite) === "cross-site") {
    return true;
  }

  // 2️⃣ Origin presente → deve essere loopback
  if (origin) return !isLoopbackUrl(origin);

  // 3️⃣ Referer fallback
  if (referer) return !isLoopbackUrl(referer);

  // 4️⃣ No Origin/Referer = client non-browser (curl/CLI/undici) → OK
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

**Tre layer di defense con priorità:**
1. `Sec-Fetch-Site` (impostato dal browser, **non spoofable** lato client)
2. `Origin` validato come loopback URL
3. `Referer` come fallback

**Verdict:** ✅ Pattern copiabile letteralmente in JHT (`web/middleware.ts` Next.js adapter + il check function).

---

## 4. Command injection / safe exec

**JHT** (`shared/skills/bridge_health.py:105-114`):
```python
cmd = f"JHT_TARGET_SESSION='{target_session}' python3 -u {BRIDGE_SCRIPT}"
subprocess.Popen(["setsid", "sh", "-c", cmd])   # ❌ shell + interpolation
```

**OpenClaw — SEMPRE array-form:**

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

### Plus: test dedicati

```
src/security/audit-exec-safe-bins.test.ts
src/security/audit-exec-sandbox-host.test.ts
src/security/audit-exec-surface.test.ts
```

**Verdict:** ✅ Difesa multi-layer (no shell, path absoluto whitelisted, test in CI). JHT può chiudere C3 con un refactor di 8 righe.

---

## 5. SSRF defense

**JHT:** zero. Le skill Python (`shared/skills/check_links.py`) fetchano URL dal DB senza validazione.

**OpenClaw** — modulo dedicato di **538 righe** + 6 test files.

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

### Moduli correlati

| File | Cosa fa |
|------|---------|
| `src/infra/net/ssrf.ts` | Policy + lookup hook con validazione IPv4/IPv6 (special-use, RFC1918, link-local, multicast) |
| `src/infra/net/ssrf.dispatcher.test.ts` | Test sull'undici dispatcher hooked |
| `src/infra/net/ssrf.pinning.test.ts` | **DNS rebinding defense**: resolve once, validate, connect-by-IP |
| `src/agents/tools/web-fetch.ssrf.test.ts` | Tool web-fetch coperto |
| `src/plugin-sdk/ssrf-policy.ts` | Wrapper esposto ai plugin esterni |

**Verdict:** ✅ Industriale. JHT non ha nulla — questo è il singolo modulo più importante da portare prima del launch.

---

## 6. Secret storage / encryption-at-rest

**JHT:**
- ✅ Buono: `shared/credentials/crypto.ts` AES-256-GCM + PBKDF2-SHA512 100k iterazioni
- ❌ Bug critico (C4): `shared/credentials/storage.ts:49` usa `homedir()` senza importarlo → `ReferenceError` silenzioso → fallback fallisce
- ❌ High (H4): `tui/src/oauth/storage.ts` ha fallback `scrypt(machineId, "jht-fallback-salt", 32)` derivabile da chiunque legga il filesystem
- ❌ High (H5): `cli/src/commands/secrets.js` usa AES-256-CBC senza auth tag + plaintext fallback

**OpenClaw:**
```ts
// src/agents/cli-credentials.ts:309
log.info("read codex credentials from keychain", { source: "keychain" })
const keychainCreds = readClaudeCliKeychainCredentials({...})
```

→ delega all'**OS keyring nativo** (macOS Keychain → Win Credential Manager → Linux libsecret/SecretService). Niente custom AES/KDF, niente fallback derivable. La chiave non lascia mai l'OS keyring.

**Verdict:** OpenClaw evita il problema scegliendo di **non implementare crypto custom**. JHT può fare lo stesso con `keytar` o `@napi-rs/keyring`.

---

## 7. CSP / Security headers

**JHT** (`web/next.config.ts:26`):
```ts
"script-src 'self' 'unsafe-inline'"   // ❌ XSS aperto
```

**OpenClaw** (`src/gateway/control-ui-csp.ts`, intero file 52 righe):
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
    "frame-ancestors 'none'",         // 🛡️ stricter di X-Frame-Options
    scriptSrc,                         // 'self' + sha256-{...}, NO unsafe-inline
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob:",
    "font-src 'self' https://fonts.gstatic.com",
    "worker-src 'self'",
    "connect-src 'self' ws: wss:",
  ].join("; ");
}
```

**Verdict:** ✅ Hash-based CSP per inline script. JHT può adottarlo (Next 16 ha API per nonce-based; il pattern hash-based richiede injection middleware ma è accessibile).

---

## 8. Sandbox model

**JHT** (`Dockerfile:96-101`):
```dockerfile
RUN echo 'jht ALL=(ALL) NOPASSWD: ALL' > /etc/sudoers.d/jht
```
Singolo container con sudo passwordless.

**OpenClaw — TRE Dockerfile separati:**

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

| Aspetto | OpenClaw | JHT |
|---------|----------|-----|
| Base image | `debian@sha256:4724b8…` (pinned) | `node:22-bookworm-slim` (mutable tag) |
| User | `sandbox` non-root | `jht` con sudo NOPASSWD |
| Tool inclusi | bash, ca-certs, curl, git, jq, python3, ripgrep | runtime completo + build-essential + sudo |
| Filosofia | "agent può solo distruggere se stesso" | "agent ha pieno accesso al container" |

**Verdict:** ⚠️ Trade-off architetturale grosso (vedi `03-implementation-tradeoffs.md`).

---

## 9. Pre-commit / CI hardening

| Tool | OpenClaw | JHT |
|------|----------|-----|
| `detect-secrets` + baseline 433 KB | ✅ `.pre-commit-config.yaml` | ❌ |
| `shellcheck --severity=error` | ✅ | ❌ |
| `actionlint` (GitHub Actions) | ✅ | ❌ |
| `zizmor` (workflow security audit) | ✅ persona regular, min-severity medium | ❌ |
| `pnpm-audit-prod --audit-level=high` come **pre-commit** | ✅ | ❌ |
| `oxlint --type-aware` | ✅ Rust-based, ~10x più veloce di eslint | ❌ |
| Pinned Docker base SHA | ✅ | ❌ |
| Test dedicati exec safety | ✅ 3 file | ❌ |

**Verdict:** ✅ JHT può copiare `.pre-commit-config.yaml` quasi as-is.

---

## 10. Logging redaction

**JHT:** zero redaction. `console.log` libero ovunque.

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

→ persino la **redazione** dei log è hardened contro ReDoS (chunking della regex).

**Verdict:** ✅ Pattern semplice (~30 righe) + lista pattern segretari (`token`, `api_key`, `password`, `Bearer`, ecc.). Zero ragioni per non averlo.

---

## 11. Threat model esplicito

**JHT:** zero. Niente `SECURITY.md`.

**OpenClaw** (`SECURITY.md`, 28 KB):
- Sezione **"Operator Trust Model"** con 20+ punti su cosa è in scope
- Sezione **"Out of Scope"** con 30+ casi documentati (incluso "passwordless sudo nel container è una scelta esplicita di trust, non un bug")
- Sezione **"Common False-Positive Patterns"** che enumera 25 pattern di report che vengono chiusi come no-action
- Sezione **"Deployment Assumptions"** che dichiara: "una gateway condivisa tra utenti adversarial NON è un setup raccomandato"

**Verdict:** ✅ Questo documento da SOLO chiude metà delle false positive che arriveranno dopo l'open-source. **Costo zero, ROI massimo.**

---

## 12. Score card finale

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
| 📜 Threat model documentato   | **10**   | 0   | -10  |
| 🔬 Security audit infrastr.   | **10**   | 0   | -10  |
| **TOTALE / 120**              | **114**  | 36  | -78  |

---

## 13. Top-5 da rubare subito

1. 🥇 **`isLocalDirectRequest()`** — 13 righe, fissa C1 critical. (`src/gateway/auth.ts:134-146`)
2. 🥈 **`SsrFPolicy` + DNS pinning** — modulo singolo, blocca SSRF Day-1. (`src/infra/net/ssrf.ts`)
3. 🥉 **`safeEqualSecret()`** — 12 righe, timing-safe per ogni token compare. (`src/security/secret-equal.ts`)
4. 🏅 **`browserMutationGuardMiddleware()`** — 89 righe, chiude CSRF. (`extensions/browser/src/browser/csrf.ts`)
5. 🏅 **`SECURITY.md` con threat model** — 28 KB di scrittura, ROI infinito.

→ I trade-off di ogni adozione sono in [`03-implementation-tradeoffs.md`](03-implementation-tradeoffs.md).
