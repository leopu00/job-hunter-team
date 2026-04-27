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
  - Merged: _—_ (dev-2)

- [x] **C3** — Refactor `bridge_health.py:spawn_bridge` (no `sh -c`)
  - File: `shared/skills/bridge_health.py:105-114`
  - Sostituire f-string + `sh -c` con `subprocess.Popen([…], env={…})` + validazione regex su `JHT_TARGET_SESSION`
  - Effort: 30 min
  - Merged: _—_ (dev-2)

- [ ] **C5** — Remove plaintext fallback in CLI secrets
  - File: `cli/src/commands/secrets.js:80-92`
  - Errore esplicito + istruzioni se `JHT_SECRET_KEY` manca; aggiungere `mode: 0o600` su writeFile
  - Effort: 30 min
  - Merged: _—_
  - Depends on: H4 (così l'utente ha un percorso netto: keyring o env)

- [ ] **C1** — Fix localhost auth bypass via `x-forwarded-host`
  - File: `web/lib/auth.ts:15-19`
  - Sostituire con pattern OpenClaw: TCP socket peer + reject se `x-forwarded-*` presente
  - Effort: 1h (incluso aggiungere accesso a `req.socket.remoteAddress` in Next route handler)
  - Merged: _—_

- [ ] **C2** — Add `requireAuth()` to ~25 sensitive routes
  - Files: `web/app/api/{secrets,database,agents/[id],providers,config,env,backup,health,tasks/[id],history/[id],credentials,sessions,logs,workspace/init}/route.ts`
  - Implementare local-token system in `~/.jht/.local-token` (mode 0600), modificare CLI + Electron per leggerlo e passarlo in header
  - Effort: 1 giorno
  - Merged: _—_
  - Depends on: C1 (altrimenti il bypass è ancora attivo)

### High

- [ ] **H8** — `npm audit fix` su `web/`
  - Upgrade `next`, `next-intl`, `postcss`. Branch dedicato + E2E full prima del merge
  - Effort: 4h
  - Merged: _—_

- [x] **H9** — `npm audit fix` su `desktop/`
  - Upgrade `electron`, `@xmldom/xmldom`. Test auto-updater + IPC
  - Effort: 4h
  - Merged: _—_ (dev-2)

- [ ] **H1** — Auth + rimuovere `?id=` reveal su `/api/secrets`
  - File: `web/app/api/secrets/route.ts:50-63`
  - Aggiungere `requireAuth()`; cambiare reveal in POST con conferma; refactor del client UI
  - Effort: 2h
  - Merged: _—_
  - Depends on: C2

- [ ] **H2** — Allowlist tabelle in `/api/database`
  - File: `web/app/api/database/route.ts:14-21, 95-108`
  - Hardcoded set di table names; escludere file con prefix `secrets|credentials|tokens|.env`
  - Effort: 1h
  - Merged: _—_

---

## 🛠️ Phase 2 — entro 2 settimane post-launch

Hardening importante ma non bloccante.

### High

- [ ] **H3** — `JHT_SHELL_VIA` validato + `execFile` array-based
  - Files: `web/app/api/team/terminal/open/route.ts`, `web/app/api/capitano/terminal/route.ts`
  - Validate `dockerContainer` con `^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$`; usare `execFile` dove cross-platform consente
  - Effort: 3h
  - Merged: _—_

- [ ] **H4** — Sostituire fallback machine-derived con keyring + env-var
  - File: `tui/src/oauth/storage.ts:20-28`, `shared/credentials/storage.ts:46-50`
  - Strategia: OS keyring (`@napi-rs/keyring`) se disponibile → env var fallback → errore esplicito (no machine-derived, no plaintext)
  - Effort: 2-3 giorni (cross-platform testing)
  - Merged: _—_

- [ ] **H5** — Migrare `cli/src/commands/secrets.js` da AES-CBC a AES-GCM
  - File: `cli/src/commands/secrets.js:27-40`
  - Riusare `shared/credentials/crypto.ts`; migration silenziosa per file esistenti CBC → GCM al primo accesso
  - Effort: 6h (incl. migration code)
  - Merged: _—_

- [ ] **H6** — Symlink containment check su file-serving
  - Files: `web/app/api/profile/files/[name]/route.ts:19-41` + altre route che servono file
  - `realpath` + `startsWith(baseDir + sep)` check
  - Effort: 1h
  - Merged: _—_

### Medium

- [ ] **M2** — CSRF middleware globale (Origin/Referer/Sec-Fetch-Site)
  - File: nuovo `web/middleware.ts`
  - Pattern OpenClaw `browserMutationGuardMiddleware` adattato a Next.js
  - Effort: 4h (+ testing)
  - Merged: _—_

- [ ] **M6** — Bind compose su `127.0.0.1:3000`
  - File: `docker-compose.yml:63-64`
  - Effort: 5 min
  - Merged: _—_

- [ ] **M3** — Rate limiting su cloud-sync endpoint
  - Files: `web/app/api/cloud-sync/**`
  - Upstash Redis o `@vercel/ratelimit`. Solo cloud-sync per ora, no localhost.
  - Effort: 4h
  - Merged: _—_

- [ ] **M5** — Documentare passwordless sudo come scelta esplicita
  - Files: `docs/security/04-threat-model.md` (già fatto, da promuovere a `SECURITY.md` root al public release)
  - Effort: 30 min (review + polish)
  - Merged: _—_

- [ ] **M8** — Validate `id` in backup restore
  - File: `web/app/api/backup/route.ts:87-104`
  - Regex `^[a-zA-Z0-9_-]+$`
  - Effort: 5 min
  - Merged: _—_

- [ ] **M7** — `/api/health` versione anonima
  - File: `web/app/api/health/route.ts`
  - GET senza auth → solo `{status:'ok'}`; con auth → dettagli completi
  - Effort: 30 min
  - Merged: _—_

- [ ] **M1** — `js-yaml.load()` con schema esplicito
  - File: `web/lib/profile-reader.ts:9, 24`
  - `yaml.load(content, { schema: yaml.CORE_SCHEMA })` + Zod validation sul risultato
  - Effort: 1h
  - Merged: _—_

- [ ] **M4** — Error response sanitization
  - Files: pattern globale, `web/app/api/**` routes che ritornano `${err}`
  - Logger interno + risposta generica `{error:'internal'}` in produzione
  - Effort: 4h
  - Merged: _—_

---

## 🔧 Phase 3 — hardening continuo

Cose da fare gradualmente nei mesi post-launch. Nessun blocco operativo.

### Low

- [ ] **L3** — Logger redaction (token/api_key/password/Bearer)
  - File: nuovo `shared/logging/redact.ts` (pattern OpenClaw `redact-bounded.ts`)
  - Wrapper che sostituisce console.log/error nei moduli sensibili
  - Effort: 4h
  - Merged: _—_

- [ ] **L1** — CSP nonce/hash-based in produzione
  - File: `web/next.config.ts:26`
  - Mantenere `'unsafe-inline'` solo in dev (`isDevelopment`); produzione hash-based o nonce-based
  - Effort: 1 giorno
  - Merged: _—_

- [ ] **L2** — Validare `JHT_GATEWAY_URL`
  - File: `web/app/api/gateway/route.ts:12`
  - `new URL()` + reject schemi non-http(s) + reject hostname privati senza opt-in
  - Effort: 30 min
  - Merged: _—_

- [ ] **L4** — `.env.example` rotation guide
  - File: `.env.example`
  - Sezione finale con link a panel rotation Anthropic/Supabase/Google
  - Effort: 30 min
  - Merged: _—_

- [ ] **L5** — `.gitleaksignore` per i 3 false positive in test fixture
  - File: nuovo `.gitleaksignore`
  - Fingerprint: `6f578deeb0...` x2 e `6d6fc187ed...`
  - Effort: 5 min
  - Merged: _—_

### Pre-commit / CI hardening (ispirato a OpenClaw)

- [ ] Aggiungere `detect-secrets` con baseline
  - File: nuovi `.pre-commit-config.yaml` + `.secrets.baseline`
  - Adottare `.detect-secrets.cfg` di OpenClaw come template
  - Effort: 4h (incl. baseline iniziale)
  - Merged: _—_

- [ ] Aggiungere `actionlint` su workflow GitHub Actions
  - File: `.pre-commit-config.yaml`
  - Effort: 30 min
  - Merged: _—_

- [ ] Aggiungere `zizmor` per audit security workflow
  - File: `.pre-commit-config.yaml` + `zizmor.yml` (modello OpenClaw)
  - Effort: 1h
  - Merged: _—_

- [ ] Aggiungere `npm audit --audit-level=high` come pre-commit
  - File: `.pre-commit-config.yaml` + `scripts/pre-commit/npm-audit-prod.mjs`
  - Effort: 1h
  - Merged: _—_

- [ ] Pin Docker base image a SHA256
  - Files: `Dockerfile:6`, `docker-compose.yml`
  - `FROM node:22-bookworm-slim@sha256:…`. Setup Renovate/Dependabot per upgrade controllati
  - Effort: 2h (incl. Renovate config)
  - Merged: _—_

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

## 📊 Avanzamento

```
Phase 1 (bloccanti):    0/9   ████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  0%
Phase 2 (post-launch):  0/12  ████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  0%
Phase 3 (hardening):    0/13  ████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  0%
─────────────────────────────────────────────────────────────────
TOTALE:                 0/34  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  0%
```

> Aggiornare la barra ad ogni merge. Quando Phase 1 = 9/9, JHT è pronto per il public open-source release.
