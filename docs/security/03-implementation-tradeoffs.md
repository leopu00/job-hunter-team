# ⚖️ Implementation trade-offs

Per ogni fix proposto in [`01-pre-launch-review.md`](01-pre-launch-review.md), questo documento elenca:

- **Costo dev** (effort di implementazione + maintenance)
- **UX impact** (come cambia per l'utente finale)
- **Perf impact** (overhead misurabile)
- **Funzionalità persa o complicata**
- **Verdict**: 🟢 fare / 🟡 fare con opt-out / 🟠 valutare / 🔴 evitare per ora

> Convenzione: i finding sono ordinati per severity. Le label `[C1]`, `[H4]`, ecc. rimandano a `01-pre-launch-review.md`.

> 📌 **Stato attuale:** documento di decisione **pre-implementation**. La quasi totalità dei verdict 🟢/🟡 è stata implementata nello sprint del 2026-04-27 (sha merge `7a2cb6ae`). Effort stimato Phase 1 era `3-5 giorni`, esecuzione reale ~95 min con 4 agenti in parallelo. Per lo stato fix-per-fix vedi [`05-checklist.md`](05-checklist.md). Decisioni esplicitamente rinviate (`H7` multi-user IDOR, `M5b` Dockerfile.strict) restano valide.

---

## 🔴 CRITICAL

### `[C1]` Rimuovere `x-forwarded-host` dal bypass localhost

**Cosa:** sostituire `web/lib/auth.ts:isLocalRequest` con il pattern OpenClaw `isLocalDirectRequest` (TCP socket peer + reject any forwarded header).

**Costo dev:** 🟢 **Basso** (~30 righe). Aggiungere `req.socket?.remoteAddress` reading + helper `hasForwardedRequestHeaders()`.

**UX impact:** 🟡 **Medio.**
- L'app Electron apre il browser su `http://localhost:3000` → `Host: localhost:3000`, niente `x-forwarded-*`, peer 127.0.0.1 → ✅ continuano a funzionare.
- Chi tunnella via `ngrok`, Cloudflare Tunnel, o reverse proxy esterno → tutti questi setup mettono `x-forwarded-host` → ❌ niente più bypass auth → l'utente DEVE configurare Supabase login. Per JHT questo è desiderato (oggi è proprio il bug), ma rompe chi oggi sta usando JHT con un tunnel pubblico senza auth.

**Perf:** trascurabile.

**Funzionalità persa:** zero — il caso "esponi JHT su rete pubblica senza auth" è sempre stato sbagliato.

**Migration plan:**
1. Implementare il fix
2. Aggiungere log warning quando si rileva un setup con forwarded headers ma Supabase non configurato
3. Documentare in `SECURITY.md` la deployment assumption "host singolo, niente proxy"

**Verdict:** 🟢 **Fare subito.** Bug security; nessun caso d'uso legittimo viene rotto.

---

### `[C2]` Aggiungere `requireAuth()` a tutte le route sensibili

**Cosa:** ~25 endpoint in `web/app/api/**` (secrets, database, agents, providers, config, env, backup, health, tasks, history, credentials, sessions, logs, workspace/init).

**Costo dev:** 🟡 **Medio.** Aggiungere una riga per route, ma serve un meccanismo di auth alternativo per il caso "Electron desktop senza Supabase".

**UX impact:** 🔴 **Alto se mal gestito.**
- Il jht CLI parla via `localhost:3000` → deve passare un token.
- Il dashboard Electron deve passare lo stesso token.
- Soluzione standard: file `~/.jht/.local-token` (mode 0600) generato all'avvio del server, che CLI/Electron leggono e passano in `Authorization: Bearer <token>`.
- Curl manuale durante dev → `curl -H "Authorization: Bearer $(cat ~/.jht/.local-token)" ...` → un po' di attrito.

**Perf:** trascurabile (lookup file una volta + compare in-memory).

**Funzionalità persa:** zero, ma la comodità "apri tab e funziona" diventa "apri tab autenticata via cookie/header".

**Migration plan a 3 step:**
1. Implementare il local-token system (genera all'avvio se non esiste)
2. Aggiornare CLI + dashboard per leggerlo
3. Aggiungere `requireAuth()` con tolleranza al local-token sulle route critiche
4. Documentare workflow per dev che vogliono curl manuale

**Verdict:** 🟢 **Fare**, ma serve ~1 giorno di lavoro per il local-token + refactor CLI/dashboard.

---

### `[C3]` Riscrivere `bridge_health.py:spawn_bridge` senza `sh -c`

**Cosa:** sostituire la stringa interpolata + `sh -c` con `subprocess.Popen([…], env={...})`.

**Costo dev:** 🟢 **Bassissimo** (~10 righe).

**UX impact:** 🟢 **Zero.** È puro refactor interno.

**Perf:** marginalmente migliore (no shell fork).

**Funzionalità persa:** zero.

**Verdict:** 🟢 **Fare immediatamente.** Niente trade-off.

---

### `[C4]` Aggiungere import `homedir` in `shared/credentials/storage.ts`

**Cosa:** aggiungere `import { homedir } from "node:os"`.

**Costo dev:** 🟢 **1 riga.**

**UX impact:** 🟢 **Positivo** — sblocca il credential store che oggi crasha silenziosamente nel fallback.

**Funzionalità persa:** zero (anzi, ne ripristina una rotta).

**Verdict:** 🟢 **Fare subito.** Bug fix puro.

> Nota: questo "fix" rivela il problema H4 (fallback predictable). Non lasciare il fallback machine-derivable: sostituirlo (vedi sotto).

---

### `[C5]` Rimuovere fallback plaintext in `cli/src/commands/secrets.js`

**Cosa:** se `JHT_SECRET_KEY` non è settato, errore esplicito invece di scrivere plaintext JSON.

**Costo dev:** 🟢 **Basso** (~5 righe + un messaggio d'errore con istruzioni).

**UX impact:** 🟡 **Medio.**
- Chi usa `jht secrets set` senza aver settato `JHT_SECRET_KEY` (probabilmente la maggior parte oggi) si trova un errore al posto di un comando che funziona.
- Soluzione: aggiungere `jht secrets init` che genera una passphrase, la salva in OS keyring, e la espone come env var per la sessione corrente. Vedi `[H4]` sotto.

**Funzionalità persa:** "salvare un secret senza fare nulla" — sostituita da "salva con 1 step di setup all'inizio".

**Verdict:** 🟢 **Fare**, ma combinare con il fix `[H4]` per non lasciare l'utente bloccato.

---

## 🟠 HIGH

### `[H1]` Auth + rimuovere `?id=` reveal su `/api/secrets`

**Cosa:** chiamare `requireAuth()` (richiede `[C2]`); cambiare il GET in lista mascherata, aggiungere POST `/reveal` con conferma esplicita per ottenere il valore in chiaro.

**Costo dev:** 🟢 Basso. Refactor del client UI per usare il nuovo flusso.

**UX impact:** 🟡 Medio. L'utente clicca "reveal" → preferenza UX + scaling future a "richiede password" se si decidesse.

**Verdict:** 🟢 **Fare** insieme a `[C2]`.

---

### `[H2]` Allowlist tabelle in `/api/database`

**Cosa:** matchare `table` contro un set hardcoded di nomi consentiti; escludere file con prefisso `secrets|credentials|tokens|.env` da `scanJsonFiles()`.

**Costo dev:** 🟢 Basso (~20 righe).

**UX impact:** 🟢 Zero per uso normale (le tabelle visibili sono comunque positions/applications/ecc.).

**Funzionalità persa:** un debug tool che permetteva di "guardare qualunque file JSON nella home". È un vantaggio rimuoverlo.

**Verdict:** 🟢 **Fare.**

---

### `[H3]` `JHT_SHELL_VIA` validato + `execFile` invece di `exec`

**Cosa:** regex `^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$` su `dockerContainer`. Sostituire `exec()` string-based con `execFile()` array-based dove possibile (cross-platform è complicato perché `osascript` su mac richiede script string).

**Costo dev:** 🟡 **Medio.** Su Windows + Linux è facile (array). Su macOS `osascript` richiede string-based comunque → mantenere `exec()` ma escapare rigorosamente o spostare in script `.scpt` separato.

**UX impact:** 🟢 Zero.

**Verdict:** 🟢 **Fare**, ma con tolleranza al residuo string-based macOS.

---

### `[H4]` Sostituire fallback machine-derived in `tui/src/oauth/storage.ts`

**Cosa:** decidere tra:
- **A)** OS keyring nativo (`keytar` o `@napi-rs/keyring`) — il pattern OpenClaw.
- **B)** Env var richiesta + errore esplicito se manca.
- **C)** Generare una passphrase random la prima volta, scriverla in `~/.jht/.passphrase` (mode 0600).

**Costo dev:**
- A) 🟠 **Alto** — dipendenza nativa cross-platform, prebuilt binaries (Win/Mac/Linux), CI multi-arch.
- B) 🟢 Bassissimo.
- C) 🟢 Basso, ma è "security theater": se l'attaccante ha read del filesystem, ha la passphrase.

**UX impact:**
- A) 🟡 Medio — su Linux headless serve DBus/SecretService, in container non funziona, in CI nemmeno → serve fallback B comunque.
- B) 🔴 Alto — l'utente deve gestire la passphrase fuori dall'app.
- C) 🟢 Zero — nessuno deve fare nulla.

**Compromesso suggerito:** **A se possibile, fallback a B.**
- Su desktop GUI con DBus/Keychain → keyring (perfetta sicurezza).
- Headless / container / CI → richiede `JHT_CREDENTIALS_KEY` env var, fail-loud se manca.
- C non lo facciamo: dà un falso senso di sicurezza.

**Verdict:** 🟡 **Fare con keyring + env var fallback.** Effort ~3 giorni per testare cross-platform.

---

### `[H5]` Migrare `cli/src/commands/secrets.js` da AES-CBC a AES-GCM

**Cosa:** rimpiazzare `aes-256-cbc` con `aes-256-gcm`, aggiungere auth tag, salt random per file (non hardcoded).

**Costo dev:** 🟢 Basso — `shared/credentials/crypto.ts` già implementa il pattern, basta riusarlo.

**UX impact:** 🟠 **Alto: backwards compatibility.** Chi ha già file `.enc` cifrati in CBC non riesce più a decifrarli.

**Migration plan:**
1. Detect: file con il vecchio formato (no auth tag separator) → tentare CBC decode, ricifrare in GCM
2. Mantenere CBC decode per N versioni come migration path
3. Avviso a UI: "migration in corso, fai un backup"

**Funzionalità persa:** zero.

**Verdict:** 🟢 **Fare** ma con migration path esplicito (~4 ore extra per migration code).

---

### `[H6]` Symlink containment check su `/api/profile/files/[name]`

**Cosa:**
```ts
const real = fs.realpathSync(filePath)
const baseDir = fs.realpathSync(JHT_USER_UPLOADS_DIR)
if (!real.startsWith(baseDir + path.sep)) return 404
```

**Costo dev:** 🟢 Bassissimo (~5 righe per route).

**UX impact:** 🟢 Zero.

**Perf:** trascurabile (`realpath` è una syscall).

**Verdict:** 🟢 **Fare.** Pattern da copiare anche nelle altre route che servono file.

---

### `[H7]` IDOR check su `/api/tasks/[id]` e `/api/history/[id]`

**Cosa:** aggiungere `userId` ai task/history, verificare ownership.

**Costo dev:** 🟠 **Alto** — richiede schema migration + refactor del codice che oggi assume single-user.

**UX impact:** 🟢 Zero per single-user, abilitante per multi-user.

**Verdict:** 🟡 **Rinviare a quando JHT diventa multi-utente.** Per ora documentare in `SECURITY.md` come "single-user assumption".

---

### `[H8/H9]` `npm audit fix` su web/ e desktop/

**Cosa:** upgrade `next`, `next-intl`, `postcss`, `electron`, `@xmldom/xmldom`.

**Costo dev:** 🟡 Medio — `next-intl` 4.x ha breaking changes; `electron` major upgrade può rompere IPC.

**UX impact:**
- `next` upgrade → potrebbe richiedere refactor di alcune route handler signature
- `electron` upgrade → testare auto-updater, IPC, native modules
- `next-intl` 4.x → testare tutti i locale switching

**Perf:** generalmente migliorativo.

**Funzionalità persa:** zero se i breaking change sono gestiti.

**Migration plan:**
1. Eseguire `npm audit fix` in branch separato
2. Run E2E suite
3. Test manuale di tutto il flusso desktop
4. Merge

**Verdict:** 🟢 **Fare**, ma in branch dedicato con test estesi.

---

## 🟡 MEDIUM

### `[M1]` `js-yaml.load()` con schema esplicito

**Cosa:** `yaml.load(content, { schema: yaml.CORE_SCHEMA })`.

**Costo dev:** 🟢 Bassissimo. js-yaml v4 è già safe by default; questo è defense-in-depth.

**Verdict:** 🟢 **Fare** (1 riga di refactor + Zod schema sul risultato).

---

### `[M2]` Middleware globale Origin/Referer per POST/PATCH/DELETE

**Cosa:** copiare `browserMutationGuardMiddleware` di OpenClaw in `web/middleware.ts`.

**Costo dev:** 🟢 Basso (~100 righe).

**UX impact:** 🟡 **Medio.**
- Browser legitimo → invia `Origin` corretto → ✅ passa
- CLI/curl → no Origin → ✅ passa (intentional, vedi punto 4 del pattern OpenClaw)
- **Allerta:** alcune chiamate fetch interne dal client Next.js potrebbero non avere `Origin` se chiamate da Server Components (rendono lato server) → testare.

**Funzionalità persa:** un sito malevolo non può più CSRF-are localhost:3000.

**Verdict:** 🟢 **Fare.** Pattern OpenClaw ben rodato.

---

### `[M3]` Rate limiting

**Cosa:** middleware in-memory che limita richieste per IP/user.

**Costo dev:** 🟡 Medio.
- In-memory: 🟢 facile, ma non sopravvive a restart del container.
- Persistente (Redis/SQLite): 🟠 richiede infrastruttura.

**UX impact:**
- Bene: chiude brute-force su `/api/secrets?id=`, abuse di `/api/agents/start`, abuse cost su LLM endpoint.
- Male: power user che sviluppano con `npm run dev:host` e fanno tante chiamate possono triggerare limit.

**Compromesso suggerito:**
- Rate limit **solo su cloud-sync** (deployment Vercel) con Upstash Redis: lì è critico.
- Localhost: skip o limit altissimo (es. 1000/min) → solo difesa anti-abuse, non security boundary.

**Verdict:** 🟡 **Fare in cloud-sync, opzionale localhost.**

---

### `[M4]` Error leakage sanitization

**Cosa:** logger interno + risposta generica `{error:'internal'}` in produzione.

**Costo dev:** 🟢 Basso (~50 righe per un wrapper centralizzato).

**UX impact:**
- Dev mode: stack trace utili → mantenere
- Prod: messaggio generico → utente non vede dettagli, ma il logger interno li ha

**Verdict:** 🟢 **Fare** con env-flag per dev/prod.

---

### `[M5]` Documentare `Dockerfile` passwordless sudo come decisione esplicita

**Cosa:** sezione in `SECURITY.md` che dichiara: "il container non è un security boundary, è una sandbox di convenienza per agenti --yolo. La separazione di trust è host vs container, non agent vs agent dentro al container."

**Costo dev:** 🟢 30 minuti.

**Verdict:** 🟢 **Fare.** Plus: opzionalmente offrire un `Dockerfile.strict` separato per chi vuole usare JHT in scenari multi-tenant (vedi sotto).

#### Opzionale: `Dockerfile.sandbox` separato (stile OpenClaw)

**Cosa:** secondo Dockerfile con user non-root, niente sudo, tool minimali.

**Costo dev:** 🟠 **Alto** — richiede ripensare come gli agenti --yolo installano tool al volo.
- Oggi: `sudo apt install pdftotext` quando serve
- Con sandbox: tool pre-installati a build time → serve sapere a priori cosa serve agli agenti

**UX impact:** 🔴 **Alto.** Agente che ha bisogno di un tool nuovo deve aspettare un rebuild → friction enorme.

**Funzionalità persa:** la flessibilità "agente intelligente che si auto-installa quello che gli serve".

**Verdict:** 🔴 **Non fare.** Documentare il trust model invece. Lasciare il `Dockerfile` corrente come default; se in futuro JHT cresce verso multi-tenant, allora `Dockerfile.strict` come opt-in.

---

### `[M6]` Bind compose su `127.0.0.1:3000`

**Cosa:** `ports: ["127.0.0.1:3000:3000"]` in `docker-compose.yml`.

**Costo dev:** 🟢 1 riga.

**UX impact:** 🟡 **Bassa ma esistente.** Chi vuole accedere a JHT da un'altra macchina della LAN (es. tablet) deve cambiare manualmente. Documentare.

**Funzionalità persa:** "espongo a tutta la LAN per default" — è un minus, non un plus.

**Verdict:** 🟢 **Fare.** Default sicuro; chi vuole esporre, lo fa esplicitamente.

---

### `[M7]` `/api/health` versione anonima

**Cosa:** GET senza auth restituisce `{status:'ok'}`; con auth restituisce dettagli.

**Costo dev:** 🟢 Basso.

**Verdict:** 🟢 **Fare.**

---

### `[M8]` Validate `id` in backup restore

**Cosa:** `if (!/^[a-zA-Z0-9_-]+$/.test(id)) return 400`.

**Costo dev:** 🟢 1 riga.

**Verdict:** 🟢 **Fare.**

---

## 🟢 LOW

### `[L1]` CSP nonce/hash-based invece di `'unsafe-inline'`

**Cosa:** Next 16 supporta nonce-based CSP nativamente; alternativa è hash-based stile OpenClaw `computeInlineScriptHashes`.

**Costo dev:** 🟠 Medio.
- Nonce: setup di Next config + middleware che inietta nonce
- Hash: build-time hash injection (più stabile ma richiede knowledge degli inline script presenti)

**UX impact:** 🟢 Zero in produzione. In dev mantenere `'unsafe-inline'` per Next.js fast refresh.

**Perf:** trascurabile a runtime.

**Verdict:** 🟢 **Fare per produzione**, mantenere `'unsafe-inline'` solo in dev.

---

### `[L2]` Validare `JHT_GATEWAY_URL`

**Cosa:** `new URL()` + reject schemi non-http(s) + reject hostname privati senza opt-in esplicito.

**Costo dev:** 🟢 Bassissimo.

**Verdict:** 🟢 **Fare** (è 5 righe).

---

### `[L3]` Logger redaction (pino-redact-style)

**Cosa:** wrapper che redatta `token`/`api_key`/`password`/`Bearer ...` in tutti i log.

**Costo dev:** 🟢 Basso (~30 righe + lista pattern).

**Perf:** trascurabile (redact-bounded chunked stile OpenClaw).

**Verdict:** 🟢 **Fare.** ROI alto, costo basso.

---

### `[L4]` `.env.example`: sezione "rotation guide"

**Cosa:** 1 sezione in fondo al file con link ai pannelli di rotazione di Anthropic/Supabase/Google.

**Costo dev:** 🟢 30 minuti.

**Verdict:** 🟢 **Fare.**

---

### `[L5]` `.gitleaksignore` con i 3 fingerprint dei test fixture

**Cosa:** rimuovere il rumore in CI.

**Costo dev:** 🟢 5 minuti.

**Verdict:** 🟢 **Fare** (ma quasi cosmetico).

---

## 📊 Tabella riassuntiva trade-off

| Finding | Costo dev | UX impact | Funz. persa | Verdict |
|---------|-----------|-----------|-------------|---------|
| C1 — no x-forwarded-host | 🟢 | 🟡 | nessuna | 🟢 fare |
| C2 — auth tutte le route | 🟡 | 🔴 senza fix | nessuna | 🟢 fare con local-token |
| C3 — bridge_health no shell | 🟢 | 🟢 | nessuna | 🟢 subito |
| C4 — import homedir | 🟢 | 🟢 | nessuna | 🟢 subito |
| C5 — no plaintext fallback | 🟢 | 🟡 | UX "1-click set" | 🟢 con C2/H4 |
| H1 — auth secrets | 🟢 | 🟡 | nessuna | 🟢 |
| H2 — allowlist database | 🟢 | 🟢 | debug-tool | 🟢 |
| H3 — execFile | 🟡 macOS | 🟢 | nessuna | 🟢 parziale |
| H4 — keyring fallback | 🟠 | 🟡 headless | nessuna | 🟡 keyring+env |
| H5 — AES-GCM CLI | 🟢 | 🟠 backcompat | nessuna | 🟢 con migration |
| H6 — realpath | 🟢 | 🟢 | nessuna | 🟢 |
| H7 — IDOR tasks/history | 🟠 | 🟢 | nessuna | 🟡 quando multi-user |
| H8/H9 — npm audit fix | 🟡 | 🟢 | nessuna | 🟢 con E2E |
| M1 — yaml schema | 🟢 | 🟢 | nessuna | 🟢 |
| M2 — CSRF middleware | 🟢 | 🟡 | nessuna | 🟢 |
| M3 — rate limit | 🟡 | 🟡 dev | nessuna | 🟡 solo cloud-sync |
| M4 — error sanitize | 🟢 | 🟢 | dev stack trace solo prod | 🟢 |
| M5 — documenta sudo | 🟢 | 🟢 | nessuna | 🟢 |
| M5b — Dockerfile.strict | 🟠 | 🔴 | flessibilità --yolo | 🔴 non ora |
| M6 — bind 127.0.0.1 | 🟢 | 🟡 LAN | LAN access default | 🟢 |
| M7 — health anonimo | 🟢 | 🟢 | nessuna | 🟢 |
| M8 — backup id valido | 🟢 | 🟢 | nessuna | 🟢 |
| L1 — CSP no inline | 🟠 prod | 🟢 | nessuna | 🟢 prod only |
| L2 — gateway URL | 🟢 | 🟢 | nessuna | 🟢 |
| L3 — log redaction | 🟢 | 🟢 | nessuna | 🟢 |
| L4 — rotation guide | 🟢 | 🟢 | nessuna | 🟢 |
| L5 — gitleaksignore | 🟢 | 🟢 | nessuna | 🟢 |

---

## 🎯 Pattern di trade-off ricorrenti

### Trade-off #1: "Chi paga il costo dell'auth?"

Aggiungere auth a route oggi anonime sposta lavoro dal lato server al lato client (CLI/dashboard).

- ✅ Soluzione netta: **local-token in `~/.jht/.local-token`** generato all'avvio. CLI e Electron lo leggono e passano in header. Nessun cambio per l'utente finale.
- ❌ Soluzione cattiva: chiedere all'utente di gestire il token a mano.

### Trade-off #2: "Chi gestisce i secret?"

Tre opzioni per fallback quando manca env var:
- **OS keyring**: sicurissimo ma headless-incompatibile, costoso da portare
- **Env var richiesta**: friction utente
- **Random passphrase su disco**: inutile come security ma comoda

→ **Combinare**: keyring quando disponibile, env var altrimenti, niente plaintext mai.

### Trade-off #3: "Container come security boundary?"

OpenClaw dichiara apertamente: "il container non è un boundary multi-tenant". JHT idem. La scelta è:
- **A)** Documentare e basta (M5) — costo zero, onesto
- **B)** Costruire `Dockerfile.sandbox` strict — costo alto, rompe agent --yolo

→ Scelta sensata: **A** ora, **B** se mai si va multi-tenant.

### Trade-off #4: "Strictness in dev vs prod?"

CSP, error messages, rate limit — in dev servono più permissivi (debugging), in prod stretti.

→ Pattern Next.js: `if (process.env.NODE_ENV === 'development')` per scelte differenti. Già usato in `next.config.ts`.

### Trade-off #5: "Backwards compatibility?"

H5 (AES-CBC → GCM) e H8/H9 (`npm audit fix`) hanno rischio regressione.

→ **Sempre** in branch dedicato con E2E suite + migration path esplicito. Mai in stessa PR del refactor architetturale.

---

## 🚦 Decision matrix sintetica

```
                       ┌────────────────────────────────┐
                       │   Costo dev          UX impact │
                       │   ────────           ───────── │
   🟢 fare subito      │    basso             zero/+    │  → C3, C4, M5, M6, M8, L2-L5
   🟢 fare con setup   │    medio             gestibile │  → C1, C2, C5, H1, H2, H6, M1, M2, M4, M7
   🟡 fare con cura    │    medio             alto      │  → H3, H4, H5, H8, H9, L1, M3
   🔴 rinviare         │    alto              alto      │  → H7 (multi-user), M5b (Dockerfile.strict)
                       └────────────────────────────────┘
```

→ **Effort totale Phase 1 (verde):** ~3-5 giorni di lavoro mirato.
→ **Effort totale Phase 2 (gialli):** ~2 settimane addizionali.
→ **Phase 3 (rinviati):** quando il use case lo richiede.

Vedi anche: l'ordering completo è in [`01-pre-launch-review.md` § Priorità di remediation](01-pre-launch-review.md#priorità-di-remediation-pre-launch).
