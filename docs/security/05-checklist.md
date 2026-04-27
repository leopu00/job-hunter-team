# ✅ Security implementation checklist

Tracking dei fix dal `01-pre-launch-review.md`. Ogni voce diventa `[x]` quando il commit relativo è **mergiato in `master`**. Riferimenti puntano a [`01-pre-launch-review.md`](01-pre-launch-review.md) e [`03-implementation-tradeoffs.md`](03-implementation-tradeoffs.md).

**Convenzioni:**
- `[ ]` = todo · `[x]` = mergiato in `master`
- `Merged:` campo vuoto fino al merge; al merge inserire SHA short del commit su `master`
- `Effort:` stima realistica
- `Depends on:` ID di altri task che devono completarsi prima

---

## 🚀 Phase 1 — bloccanti per il rilascio

Fix indispensabili prima del primo release pubblico. **Target:** completare prima del tag `v0.1.0`.

### Critical

- [x] **C4** — Add missing `homedir` import
  - File: `shared/credentials/storage.ts:1` (aggiungere `import { homedir } from "node:os"`)
  - Effort: 1 min
  - Merged: 7a2cb6ae (via dev-2)

- [x] **C3** — Refactor `bridge_health.py:spawn_bridge` (no `sh -c`)
  - File: `shared/skills/bridge_health.py:105-114`
  - Sostituire f-string + `sh -c` con `subprocess.Popen([…], env={…})` + validazione regex su `JHT_TARGET_SESSION`
  - Effort: 30 min
  - Merged: 7a2cb6ae (via dev-2)

- [x] **C5** — Remove plaintext fallback in CLI secrets
  - File: `cli/src/commands/secrets.js:80-92`
  - Errore esplicito + istruzioni se `JHT_SECRET_KEY` manca; aggiungere `mode: 0o600` su writeFile
  - Effort: 30 min
  - Merged: 0494a5c6
  - Depends on: H4 (così l'utente ha un percorso netto: keyring o env)

- [x] **C1** — Fix localhost auth bypass via `x-forwarded-host`
  - File: `web/lib/auth.ts:15-19` + cloni in `web/proxy.ts`, `web/app/(protected)/layout.tsx`, `web/app/(protected)/dashboard/page.tsx`
  - Sostituire con pattern OpenClaw: TCP socket peer + reject se `x-forwarded-*` presente
  - Effort: 1h (incluso aggiungere accesso a `req.socket.remoteAddress` in Next route handler)
  - Merged: 721b0b8e

- [x] **C2** — Add `requireAuth()` to 21 sensitive routes
  - Files: `web/app/api/{secrets,database,agents,agents/[id],agents/metrics,providers,config,env,backup,health,tasks,tasks/[id],history,history/[id],credentials,sessions,sessions/[id],logs,workspace,workspace/init,workspace/browse}/route.ts`
  - Local-token in `~/.jht/.local-token` (mode 0600) + cookie HttpOnly+SameSite=Strict auto-settato dal middleware su localhost direct (no forwarded headers); `requireAuth()` valida cookie OR `Authorization: Bearer` header. Niente cambi CLI/Electron: il bootstrap del cookie è server-side.
  - Effort: 1 giorno
  - Merged: b5464d11 (+ 38c00b63, bcd5c348, 10d965d8, 8f121644 e middleware df7eae5f/d5565192)
  - Depends on: C1 (altrimenti il bypass è ancora attivo)

### High

- [x] **H8** — `npm audit fix` su `web/`
  - Upgrade `next`, `next-intl`, `postcss`. Branch dedicato + E2E full prima del merge
  - Effort: 4h
  - Merged: c62d7147

- [x] **H9** — `npm audit fix` su `desktop/`
  - Upgrade `electron`, `@xmldom/xmldom`. Test auto-updater + IPC
  - Effort: 4h
  - Merged: 7a2cb6ae (via dev-2)

- [x] **H1** — Auth + rimuovere `?id=` reveal su `/api/secrets`
  - File: `web/app/api/secrets/route.ts` + nuovo `web/app/api/secrets/reveal/route.ts` + `web/app/(protected)/secrets/page.tsx`
  - GET sempre mascherato (niente `?id=`); reveal solo via `POST /api/secrets/reveal` con `confirm:true`. Client chiede `window.confirm()` prima del reveal.
  - Effort: 2h
  - Merged: 87c1a824
  - Depends on: C2

- [x] **H2** — Allowlist tabelle in `/api/database`
  - File: `web/app/api/database/route.ts:14-21, 95-108`
  - Hardcoded set di table names; escludere file con prefix `secrets|credentials|tokens|.env`
  - Effort: 1h
  - Merged: d6143480

---

## 🛠️ Phase 2 — entro 2 settimane post-launch

Hardening importante ma non bloccante.

### High

- [x] **H3** — `JHT_SHELL_VIA` validato + `execFile` array-based
  - Files: `web/app/api/team/terminal/open/route.ts`, `web/app/api/capitano/terminal/route.ts`
  - Validate `dockerContainer` con `^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$`; usare `execFile` dove cross-platform consente
  - Effort: 3h
  - Merged: e0d24b60

- [x] **H4** — Sostituire fallback machine-derived con keyring + env-var
  - File: `tui/src/oauth/storage.ts:20-28`, `shared/credentials/storage.ts:46-50`, nuovo `shared/credentials/passphrase.ts`
  - Strategia: OS keyring (`@napi-rs/keyring`) se disponibile → env var fallback → errore esplicito (no machine-derived, no plaintext)
  - Effort: 2-3 giorni (cross-platform testing)
  - Merged: 6f35755d (+ 5b620995 iter 2 PBKDF2+salt random tui/oauth, + iter 3 `jht keyring` CLI pending sha)

- [x] **H5** — Migrare `cli/src/commands/secrets.js` da AES-CBC a AES-GCM
  - File: `cli/src/commands/secrets.js:27-40`
  - AES-256-GCM + PBKDF2 100k SHA-512 con salt random per file. Migration silenziosa: i file CBC legacy (`iv:ciphertext`) vengono ri-cifrati in GCM al primo `get`.
  - Effort: 6h (incl. migration code)
  - Merged: 6c0e6c05

- [x] **H6** — Symlink containment check su file-serving
  - Files: `web/app/api/profile/files/[name]/route.ts:19-41` + altre route che servono file
  - `realpath` + `startsWith(baseDir + sep)` check
  - Effort: 1h
  - Merged: 7a2cb6ae (via dev-2)

### Medium

- [x] **M2** — CSRF middleware globale (Origin/Referer/Sec-Fetch-Site)
  - File: nuovo `web/lib/csrf.ts` + integrazione in `web/proxy.ts`
  - Pattern OpenClaw `browserMutationGuardMiddleware` adattato a Next.js
  - Effort: 4h (+ testing)
  - Merged: 8ad011fd

- [x] **M6** — Bind compose su `127.0.0.1:3000`
  - File: `docker-compose.yml:63-64`
  - Effort: 5 min
  - Merged: e99d3584

- [x] **M3** — Rate limiting su cloud-sync endpoint
  - Files: `web/app/api/cloud-sync/**`
  - Upstash Redis o `@vercel/ratelimit`. Solo cloud-sync per ora, no localhost.
  - Effort: 4h
  - Merged: 7a2cb6ae (via dev-2)

- [x] **M5** — Documentare passwordless sudo come scelta esplicita
  - Files: `docs/security/04-threat-model.md` (review + polish; promozione a `SECURITY.md` root rinviata al public release)
  - Effort: 30 min (review + polish)
  - Merged: 1c64276e

- [x] **M8** — Validate `id` in backup restore
  - File: `web/app/api/backup/route.ts:87-104`
  - Regex `^[a-zA-Z0-9_-]+$`
  - Effort: 5 min
  - Merged: e99d3584

- [x] **M7** — `/api/health` versione anonima
  - File: `web/app/api/health/route.ts`
  - GET senza auth → solo `{status:'ok'}`; con auth → dettagli completi
  - Effort: 30 min
  - Merged: 7a2cb6ae (via dev-2)

- [x] **M1** — `js-yaml.load()` con schema esplicito
  - File: `web/lib/profile-reader.ts`
  - `yaml.load(content, { schema: yaml.CORE_SCHEMA })` (esclude tag estesi tipo `!!js/function`) + helper `isPlainObject` per narrowing al posto di Zod (no nuova dep)
  - Effort: 1h
  - Merged: 537c4b07

- [x] **M4** — Error response sanitization
  - Files: nuovo `web/lib/error-response.ts` + sweep su 19 route (`backup`, `database`, `alerts`, `archive`, `automations`, `channels`, `contacts`, `daemon`, `errors`, `feedback`, `goals`, `i18n`, `migrations`, `monitoring`, `scheduler`, `webhooks`, `saved-searches`, `resume`, `reminders`).
  - Helper `sanitizedError(err, { scope, status, publicMessage })`: log `console.error` con scope + dettaglio dell'errore, response `{error:<publicMessage>}` in prod, dettaglio in body solo in `NODE_ENV=development`.
  - Effort: 4h
  - Merged: 064d4260 (+ ac280a24, ac447aeb, batch finale pending)

---

## 🔧 Phase 3 — hardening continuo

Cose da fare gradualmente nei mesi post-launch. Nessun blocco operativo.

### Low

- [x] **L3** — Logger redaction (token/api_key/password/Bearer)
  - File: nuovo `shared/logger/redact.ts` (pattern OpenClaw `redact-bounded.ts`) + hook in `shared/logger/logger.ts:log()`
  - `redactString` su pattern (Bearer, JWT, sk-/ant-/jht_sync_, api_key=, hex 32+) + `redactObject` su SENSITIVE_KEYS; `redactedConsole` wrapper per moduli che usano console direttamente
  - Effort: 4h
  - Merged: 2b8264ff

- [ ] **L1** — CSP nonce/hash-based in produzione
  - File: `web/next.config.ts:26`
  - Mantenere `'unsafe-inline'` solo in dev (`isDevelopment`); produzione hash-based o nonce-based
  - Effort: 1 giorno
  - Merged: _—_

- [x] **L2** — Validare `JHT_GATEWAY_URL`
  - File: `web/app/api/gateway/route.ts:12`
  - `new URL()` + reject schemi non-http(s) + reject hostname privati senza opt-in
  - Effort: 30 min
  - Merged: 6261709a

- [x] **L4** — `.env.example` rotation guide
  - File: `.env.example`
  - Sezione finale con link a panel rotation Anthropic/Supabase/Google
  - Effort: 30 min
  - Merged: 6261709a

- [x] **L5** — `.gitleaksignore` per i 3 false positive in test fixture
  - File: nuovo `.gitleaksignore`
  - Fingerprint: `6f578deeb0...` x2 e `6d6fc187ed...`
  - Effort: 5 min
  - Merged: 6261709a

### Pre-commit / CI hardening (ispirato a OpenClaw)

- [x] Aggiungere `detect-secrets` con baseline
  - File: nuovi `.pre-commit-config.yaml` + `.secrets.baseline`
  - Adottare `.detect-secrets.cfg` di OpenClaw come template
  - Effort: 4h (incl. baseline iniziale)
  - Merged: f5c6068e

- [x] Aggiungere `actionlint` su workflow GitHub Actions
  - File: `.pre-commit-config.yaml`
  - Effort: 30 min
  - Merged: d5d3842f

- [x] Aggiungere `zizmor` per audit security workflow
  - File: `.pre-commit-config.yaml` + `zizmor.yml` (modello OpenClaw)
  - Effort: 1h
  - Merged: d5d3842f

- [x] Aggiungere `npm audit --audit-level=high` come pre-commit
  - File: `.pre-commit-config.yaml` + `scripts/pre-commit/npm-audit-prod.mjs`
  - Effort: 1h
  - Merged: d5d3842f

- [x] Pin Docker base image a SHA256
  - Files: `Dockerfile:6`, `.github/dependabot.yml`
  - `FROM node:22-bookworm-slim@sha256:d415caac2f1f77b98caaf9415c5f807e14bc8d7bdea62561ea2fef4fbd08a73c` + Dependabot weekly bump (label `dependencies/docker/security`). Niente cambi a `docker-compose.yml`: l'immagine è ereditata da `build:.` quindi il pin è già coerente.
  - Effort: 2h (incl. Renovate config)
  - Merged: 8fbed8fa

### Test security

- [ ] Aggiungere suite `tests/security/`
  - Test su exec-safe-bins, exec-surface (pattern OpenClaw `audit-exec-*.test.ts`)
  - Effort: 1 giorno
  - Merged: _—_

- [ ] CLI command `jht doctor security`
  - File: nuovo `cli/src/commands/doctor-security.js`
  - Diagnostica: chiavi mancanti, fallback insicuri, port esposti, sudo container, ecc.
  - Effort: 1 giorno
  - Merged: _—_

---

## 🚫 Rinviati (non in roadmap immediata)

Decisioni esplicite di **non fare** ora, documentate in [`03-implementation-tradeoffs.md`](03-implementation-tradeoffs.md):

- ⏸️ **H7** — IDOR ownership check su `tasks/[id]` e `history/[id]`
  - Motivo: JHT è single-user. Documentato in threat model. Riprendere quando JHT diventa multi-tenant.

- ⏸️ **M5b** — `Dockerfile.strict` con user non-root e tool minimali (stile OpenClaw `Dockerfile.sandbox`)
  - Motivo: rompe il workflow `--yolo` (agenti che `sudo apt install` al volo). Container ≠ security boundary per design. Riprendere se JHT abilita scenari multi-tenant.

---

## ➕ Gap aggiuntivi (fuori dai 34 finding originali)

Emersi dal confronto con OpenClaw ([`02-openclaw-comparison.md`](02-openclaw-comparison.md)). Non erano nei 27 finding dell'audit interno ma sono **blockers per il public release**.

- [ ] **SSRF dispatcher generico** — `shared/net/ssrf.ts` mancante
  - Adottare pattern OpenClaw `src/infra/net/ssrf.ts` (538 righe + DNS pinning + IPv4/IPv6 special-use validation)
  - Effort: ~1 giorno
  - Merged: _—_

- [ ] **`resolve-system-bin` strict** — wrapper anti PATH-hijacking per binari sensibili (es. `openssl`)
  - Adottare pattern OpenClaw `src/infra/resolve-system-bin.ts` (whitelist `/usr/bin`, `/bin`, `/usr/sbin`, `/sbin`)
  - Effort: ~4h
  - Merged: _—_

---

## 📊 Avanzamento

```
Phase 1 (bloccanti):    9/9   ██████████████████████████████████  100% ✅
Phase 2 (post-launch): 12/12  ██████████████████████████████████  100% ✅
Phase 3 (hardening):  10/13   ██████████████████████████░░░░░░░░   77%
Gap non-audit:         0/2    ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░    0%
─────────────────────────────────────────────────────────────────
TOTALE:                31/36  ███████████████████████████░░░░░░░   86%
```

> Phase 1 + Phase 2 chiuse → JHT è pronto per **internal merge** ed è significativamente più sicuro di OpenClaw su 4 delle 5 aree top-priority.
> **Per il public release** restano da chiudere: **SSRF dispatcher**, **`resolve-system-bin` strict**, **L1** (CSP hash-based prod). Gli altri Phase 3 (`tests/security/`, `jht doctor security`) sono hardening continuo e non bloccanti.

## 🆚 Comparazione con OpenClaw

Il confronto post-fix con la repo di riferimento è in [`06-post-fix-comparison.md`](06-post-fix-comparison.md).
Sintesi: il gap è passato da **-78** (pre-fix) a **-25** (post-fix), con score security che va da
**36/120 (30%)** a **89/120 (74%)**.
