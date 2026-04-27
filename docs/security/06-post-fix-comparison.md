# 🆚 Post-fix comparison — JHT vs OpenClaw (round 2)

**Data:** 2026-04-27 17:00
**Riferimento OpenClaw:** revisione `c41126dbbb` (main) — sincronizzato pre-comparison
**Riferimento JHT:** branch `dev-1` @ `6278d7ff` (tutti e 4 i dev allineati allo stesso HEAD post-convergenza forzata)
**Round precedente:** [`02-openclaw-comparison.md`](02-openclaw-comparison.md) — quel report stabiliva un gap di **-78 punti**.

> Sessione team-work: ~95 min con 4 agenti Claude in parallelo (dev-1..dev-4), 31/34 task chiusi (91%).

---

## 0. Cosa è cambiato dal round 1

```
                  PRE-FIX                  POST-FIX                OPENCLAW
              (2026-04-27 11:00)      (2026-04-27 16:55)      (live main)
               ──────────────         ──────────────          ──────────────
 Phase 1+2:        0/21                  21/21 ✅
 Phase 3:          0/13                  10/13
 Total fix:        0/34                  31/34 (91%)
```

**Nuovi file creati nel repo durante questa sessione:**

| File | Funzione | Pattern OpenClaw di riferimento |
|------|----------|----------------------------------|
| `web/lib/local-token.ts` | Local-token gen + bearer/cookie validate (timing-safe) | `extensions/browser/src/browser/http-auth.ts` |
| `web/lib/csrf.ts` | `shouldRejectBrowserMutation` middleware logic | `extensions/browser/src/browser/csrf.ts` |
| `web/lib/error-response.ts` | `sanitizedError()` per uniformare le 19+ route | (proprio, non in OpenClaw) |
| `web/lib/fs-safety.ts` | `safeResolveUnder()` realpath + containment | `safe-resolve.ts` |
| `shared/credentials/passphrase.ts` | env→keyring→error (no machine-derived) | `cli-credentials.ts` keychain pattern |
| `shared/credentials/manager.ts` | Orchestratore lookup credentials | — |
| `shared/logger/redact.ts` | Pattern-based redaction (Bearer, sk-, hex 32+) | `src/logging/redact-bounded.ts` |
| `.pre-commit-config.yaml` | detect-secrets + actionlint + zizmor + npm-audit-prod | uguale + shellcheck + ruff |
| `.secrets.baseline` | snapshot detect-secrets findings | uguale (è grosso) |
| `zizmor.yml` | unpinned-uses/excessive-permissions disabled | identico |
| `scripts/pre-commit/npm-audit-prod.mjs` | audit fail su high+ in prod deps | uguale concept |
| `cli/src/commands/keyring.js` | `jht keyring set/get/delete` per provisioning passphrase | (innovativo, non in OpenClaw) |

---

## 1. Auth + localhost bypass (C1) — gap chiuso ✅

| | OpenClaw | JHT pre-fix | **JHT post-fix** |
|---|---|---|---|
| Source IP | `req.socket.remoteAddress` | `x-forwarded-host` ❌ | `host` + reject se forwarded headers ✅ |
| Trust forwarded headers? | NO | YES (bug C1) | NO ✅ |
| Pattern function | `isLocalDirectRequest` (528 LOC auth.ts) | — | `hasForwardedRequestHeaders` + `isLocalRequestFromHeaders` (95 LOC) |

**JHT `web/lib/auth.ts:22-32`** — pattern OpenClaw esatto, citato in commento:
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

## 2. CSRF middleware (M2) — gap chiuso ✅

| | OpenClaw | JHT pre-fix | **JHT post-fix** |
|---|---|---|---|
| File | `extensions/browser/src/browser/csrf.ts` (89 LOC) | ❌ | `web/lib/csrf.ts` (97 LOC) |
| `Sec-Fetch-Site` check | ✅ | ❌ | ✅ |
| Origin allowlist | ✅ | ❌ | ✅ + `JHT_PUBLIC_ORIGIN` env per cloud-sync |
| Referer fallback | ✅ | ❌ | ✅ |
| Pass-through CLI/curl | ✅ | n/a | ✅ |

JHT cita esplicitamente in `web/lib/csrf.ts:4`: `Pattern: OpenClaw browserMutationGuardMiddleware (extensions/browser/src/browser/csrf.ts)`.

**Score:** 2/10 → **9/10** (Δ +7)

---

## 3. Local-token / auth flow (C2) — gap chiuso ✅ + innovazione

| | OpenClaw | JHT pre-fix | **JHT post-fix** |
|---|---|---|---|
| Auth methods | 7 (token/password/tailscale/device/bootstrap/trusted-proxy/none) | bypass localhost trustless | Cookie HttpOnly + Bearer fallback |
| Constant-time compare | `safeEqualSecret` modulo 12 LOC | `===` ❌ | `timingSafeEqual` inline 4 righe |
| Cookie HttpOnly | — | — | ✅ `jht_local_token` SameSite=Strict |

**Innovazione JHT vs OpenClaw:** dev-3 durante il design pair-up ha rilevato che browser non manda Bearer header automaticamente:
> "CLI/Electron NON fanno fetch verso /api/* locale (solo cloud-sync). Il client reale è browser caricato via openExternal. Bearer non può arrivare da CLI/Electron. Proposta: middleware setta cookie HttpOnly se localhost direct, browser lo manda automaticamente."

→ JHT ha implementato **dual-channel auth** (cookie HttpOnly+Bearer fallback) che OpenClaw non ha. Plus: un nuovo CLI command `jht keyring set/get/delete` per provisioning della passphrase (non presente in OpenClaw).

**Score:** parziale di Auth gating sopra.

---

## 4. Path traversal (H6) — gap chiuso ✅

**JHT `web/lib/fs-safety.ts:14`** cita: `Pattern coerente con OpenClaw safe-resolve.ts`.

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

## 5. Secret storage / keyring (H4 + H5 + C5) — gap chiuso ✅

| | OpenClaw | JHT pre-fix | **JHT post-fix** |
|---|---|---|---|
| Encryption-at-rest | OS Keychain native | AES-256-GCM ma fallback predictable | AES-256-GCM + `@napi-rs/keyring` opzionale |
| Fallback priority | Keychain native + manual prompt | env → `homedir()` ❌ | env → keyring → `MissingPassphraseError` ✅ |
| Plaintext fallback | NO | ❌ sì in `cli/secrets.js` | ✅ rimosso, fail-loud |
| AES mode CLI | n/a | CBC senza auth | GCM con auth tag |

**`shared/credentials/passphrase.ts`** è il nuovo modulo che orchestra il lookup. **`MissingPassphraseError`** ha messaggio educativo che istruisce sull'uso di `jht keyring set jht-credentials`.

**Score:** 5/10 → **9/10** (Δ +4)

---

## 6. Command injection (C3 + H3) — parzialmente chiuso 🟡

| | OpenClaw | JHT pre-fix | **JHT post-fix** |
|---|---|---|---|
| `subprocess` array vs shell | sempre array | f-string + `sh -c` ❌ | array ✅ (C3 done) |
| `JHT_SHELL_VIA` validation | n/a | nessuna | regex validate ✅ (H3 done) |
| `resolve-system-bin` strict trust dirs | ✅ wrapper obbligatorio (`src/infra/resolve-system-bin.ts`) | ❌ | ❌ **gap residuo** |

**Gap residuo:** OpenClaw protegge da PATH hijacking con `resolveSystemBin("strict")` che limita la risoluzione di `execFile`/`spawn` a directory di sistema (`/usr/bin`, `/bin`, `/usr/sbin`, `/sbin`). Un attacker che pianta un binary in directory user-writable (es. `~/.local/bin`) non può shadowing degli executable di sistema. **JHT non ha questo wrapper** → un agente compromesso che scrive in `$PATH` user può intercettare invocazioni.

**Score:** 5/10 → **8/10** (Δ +3)

---

## 7. SSRF defense — **gap principale residuo** 🟠

| | OpenClaw | JHT pre-fix | **JHT post-fix** |
|---|---|---|---|
| Modulo dedicato | `src/infra/net/ssrf.ts` 538 LOC | ❌ | 🟡 solo `validateGatewayUrl` su un singolo URL (gateway/route.ts) |
| DNS pinning anti-rebinding | ✅ resolve once + connect-by-IP | — | ❌ |
| Blocked metadata.google.internal | ✅ | — | ❌ |
| Policy generico per fetch outbound | ✅ `SsrFPolicy` con dispatcher hooked | — | ❌ |
| RFC1918 / IPv6 ULA / CGNAT / multicast | ✅ tutti | — | ✅ solo RFC1918 in `validateGatewayUrl` |

**Score:** 0/10 → **3/10** (Δ +3)

**Cosa manca concretamente:** un modulo `shared/net/ssrf.ts` o `web/lib/ssrf.ts` con:
- `SsrFPolicy` type con `allowPrivateNetwork`, `dangerouslyAllowPrivateNetwork`, `allowedHostnames`
- DNS lookup hook che valida l'IP risolto prima di connettersi
- Applicato a `shared/skills/check_links.py`, scout fetch, assistente browse, link previews
- Test SSRF (es. `tests/security/ssrf.test.ts`)

**Effort stimato:** ~1 giorno (port di `src/infra/net/ssrf.ts` di OpenClaw + adapter Python per skills).

---

## 8. CSP / security headers (L1) — parzialmente aperto 🟡

| | OpenClaw | JHT pre-fix | **JHT post-fix** |
|---|---|---|---|
| `script-src` | hash-based dinamico (`computeInlineScriptHashes`) | `'unsafe-inline'` | invariato (L1 ancora aperto) |
| `frame-ancestors` | `'none'` | (header `X-Frame-Options DENY` solo) | invariato |
| Other headers | tutti | tutti ✅ | invariato |

**Score:** 6/10 → **7/10** (Δ +1) — la suite di header è già forte, manca solo CSP hash-based prod.

---

## 9. Sandbox / container — documentato ✅

| | OpenClaw | JHT pre-fix | **JHT post-fix** |
|---|---|---|---|
| `Dockerfile.sandbox` strict | sì (user non-root, no sudo) | unico Dockerfile con sudo NOPASSWD | invariato |
| Pinned base image SHA256 | ✅ | ❌ (`node:22-bookworm-slim` mutable) | ✅ pin a `sha256:d415caac...` + Dependabot weekly |
| Trust model documentato | `SECURITY.md` | ❌ | ✅ `04-threat-model.md` (M5) |

**Score:** 4/10 → **6/10** (Δ +2)

---

## 10. Pre-commit / CI hardening — gap chiuso ✅

| Tool | OpenClaw | JHT post-fix |
|------|----------|--------------|
| `detect-secrets` + baseline | ✅ | ✅ `.secrets.baseline` da scan iniziale |
| `actionlint` | ✅ | ✅ |
| `zizmor` | ✅ persona regular, min-severity medium | ✅ identico (file `zizmor.yml`) |
| `npm-audit-prod` | ✅ via script | ✅ `scripts/pre-commit/npm-audit-prod.mjs` |
| `shellcheck` | ✅ | ❌ (non importato — gap minore) |
| Pin Docker base SHA | ✅ | ✅ `sha256:d415caac...` |

**Score:** 3/10 → **9/10** (Δ +6)

---

## 11. Logging redaction (L3) — gap chiuso ✅

**JHT `shared/logger/redact.ts`**: redact su pattern (Bearer, JWT, sk-/ant-/jht_sync_, api_key=, hex 32+) + redactObject su SENSITIVE_KEYS + `redactedConsole` wrapper.

**Score:** 1/10 → **8/10** (Δ +7)

---

## 12. Threat model + SECURITY.md — gap chiuso ✅

JHT ha **`docs/security/04-threat-model.md`** con:
- Single-user assumption esplicita
- In-scope / out-of-scope enumerati
- Container ≠ security boundary documentato
- Reporting policy (TODO `security@jobhunterteam.ai`)
- Crypto / data handling section
- Update / patch policy

Quando il public release sarà fatto, va promosso a `SECURITY.md` alla root del repo.

**Score:** 0/10 → **9/10** (Δ +9)

---

# 📊 Score card aggiornata

| Area | OpenClaw | JHT pre-fix | **JHT post-fix** | Δ |
|---|---|---|---|---|
| 🔐 Auth gating | 10 | 4 | **9** | +5 |
| 🌐 SSRF defense | 10 | 0 | **3** | +3 |
| 🚫 Cmd injection | 10 | 5 | **8** | +3 |
| 🗝️ Secret storage | 9 | 5 | **9** | +4 |
| 🛡️ CSP / headers | 10 | 6 | **7** | +1 |
| 📦 Sandbox isolation | 9 | 4 | **6** | +2 |
| 🔍 Path traversal | 8 | 6 | **9** | +3 |
| 🚨 CSRF / origin | 9 | 2 | **9** | +7 |
| 📝 Logging redaction | 9 | 1 | **8** | +7 |
| 🤖 Pre-commit / CI | 10 | 3 | **9** | +6 |
| 📜 Threat model | 10 | 0 | **9** | +9 |
| 🔬 Audit infrastructure | 10 | 0 | **3** | +3 |
| **TOTALE / 120** | **114** | **36** | **89** | **+53** |

```
              Pre-fix     ████████░░░░░░░░░░░░░░░░░░░░░░  36/120  (30%)
              Post-fix    ████████████████████████░░░░░░  89/120  (74%)
              OpenClaw    ████████████████████████████░░  114/120 (95%)
                                   ↑
                          Gap residuo: -25 (era -78)
```

---

# 🎯 Cosa resta dopo questa sessione

## 🔴 Gap critici (blocco al public release)

1. **SSRF dispatcher generico** — `shared/net/ssrf.ts` mancante.
   - File da scrivere: ~250-400 LOC port di `src/infra/net/ssrf.ts` di OpenClaw
   - Adapter Python per `shared/skills/check_links.py` (può usare `requests` con custom adapter)
   - Test in `tests/security/ssrf.test.ts`
   - Effort: 1 giorno

2. **`resolve-system-bin` strict trust dirs** — wrapper per `execFile`/`spawn`.
   - File da scrivere: ~100 LOC port di `src/infra/resolve-system-bin.ts` di OpenClaw
   - Refactor di `cli/src/utils/` per usare il wrapper su tutte le invocazioni esterne
   - Effort: 4h

3. **CSP hash-based in produzione** (L1).
   - Modifica `web/next.config.ts` per generare hash al build time
   - Effort: 4h

## 🟡 Nice-to-have (Phase 3 long-tail)

4. **`tests/security/`** suite — pattern coerenti con OpenClaw `audit-exec-*.test.ts` (oggi 0 test, OpenClaw ha 43).
5. **`jht doctor security`** CLI command — diagnostica chiavi mancanti, port esposti, fallback insicuri.
6. **`Dockerfile.sandbox`** opzionale — solo se JHT abilita scenari multi-tenant in futuro.

---

# 💡 Insight architetturali emersi

1. **Pair-up funziona ma richiede pivot agility.** Il pair dev-3+dev-4 su C2 ha avuto **un cambio di design a metà** (Bearer→Cookie HttpOnly) che gli agenti hanno gestito autonomamente via tmux comm. Pattern: il leader tecnico (dev-3) ha fatto la pivot, il follower (dev-4) ha confermato e implementato il client side.

2. **Cross-merge scaglionato evita merge hell.** I primi cross-merge funzionavano (dev-3 merged dev-1+dev-2, fast-forward). Quando ho richiesto convergenza forzata "ognuno mergia tutti gli altri", è emerso un classico **diamond merge problem** (ogni round genera nuovi SHA divergenti). Risolto con strategia **"un leader merges all, gli altri pull --ff-only"**.

3. **Il commit message style è uniforme.** Tutti i 4 dev hanno seguito convenzione `fix(area): cosa`/`feat(area): cosa`/`docs(security): cosa` — no Co-Authored-By Claude lasciato (come da istruzioni). Output presentabile ad audit esterno.

4. **JHT ha innovato su 2 punti vs OpenClaw:**
   - **Cookie HttpOnly + Bearer fallback dual-channel** (browser e CLI insieme)
   - **`jht keyring set/get/delete` CLI** per provisioning user-friendly della passphrase

5. **Threat model è il singolo investimento con ROI più alto.** Documentare apertamente "container ≠ security boundary" + "single-user assumption" preempts metà delle false-positive che arriveranno post open-source.
