# Security Review — Pre-Launch Open Source

**Data audit:** 2026-04-27
**Branch:** dev-1 @ 65f2ec4a
**Scope:** intera repo prima del rilascio open source pubblico
**Tooling:** gitleaks 8.30.1 (full history), npm audit (root/web/desktop), pip-audit, manual code review (3 sub-agent paralleli + verifica diretta)

> 📌 **Stato attuale:** questo documento è la fotografia **pre-fix** dell'audit. La maggior parte dei finding qui sotto è stata risolta nel sprint del 2026-04-27 (sha merge `7a2cb6ae`, 31/34 fix). Per lo stato corrente fix-per-fix vedi [`05-checklist.md`](05-checklist.md); per il bilancio vs OpenClaw post-fix vedi [`06-post-fix-comparison.md`](06-post-fix-comparison.md).

---

## Threat model assunto

JHT è una desktop app local-first: la dashboard Next.js gira su `localhost:3000` dentro un container Docker (o sull'host in dev), aperta dall'app Electron sulla macchina dell'utente. La superficie pubblica è limitata a:
- il sito marketing su Vercel (`web/app/(public)/**` + `web/app/api/install`, `web/app/api/cloud-sync/**`)
- l'endpoint `cloud-sync` per sincronizzazione SQLite ↔ Supabase

Tutto il resto (`/api/agents`, `/api/secrets`, `/api/database`, `/api/terminal`, `/api/providers`, ecc.) è progettato per **localhost only** ma resta esposto se:
1. l'utente espone la porta 3000 su rete (es. tunnel SSH, port forward, server condiviso);
2. un sito malevolo (CSRF / DNS rebinding) raggiunge `http://localhost:3000` dal browser dell'utente;
3. un proxy intermedio passa header `X-Forwarded-Host` non sanitizzati (vedi finding C1).

L'apertura sorgente amplia il rischio (1) e (2): chiunque legge il codice impara a colpo d'occhio quali endpoint sono "trust localhost".

---

## Sommario findings

| Severity | Count |
|----------|-------|
| Critical | **5** |
| High     | **9** |
| Medium   | **8** |
| Low      | **5** |
| **Tot.** | **27** |

| Area                          | Critical | High | Medium | Low |
|-------------------------------|----------|------|--------|-----|
| Auth / authorization API      | 2        | 2    | 1      | -   |
| Command injection / RCE       | 1        | 2    | 1      | -   |
| Crypto / credenziali at-rest  | 1        | 3    | 1      | -   |
| Path traversal / file access  | -        | 1    | 1      | -   |
| Dependency vulnerabilities    | -        | 1    | 1      | -   |
| Config / Dockerfile           | -        | -    | 2      | 2   |
| Information disclosure        | 1        | -    | 1      | 1   |
| CSRF / rate limit             | -        | -    | 1      | 1   |
| Secret in git history         | -        | -    | -      | 1   |

**Gitleaks su full history (3122 commit):** 0 leak veri. Le 3 hit (`tests/js/.vitest-tasks.json`, `tests/js/config/schema.test.ts`) sono fixture di test (`'sk-projkey123'`, label UI) — false positive verificati manualmente.

**pip-audit su `requirements.txt`:** 0 vulnerabilità.

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

**Perché è critical:** `requireAuth()` è la sola gate sui pochi endpoint protetti (terminal, profile-assistant, cloud-sync verify). La funzione bypassa il check Supabase su qualsiasi richiesta dove `x-forwarded-host` o `host` matcha localhost. Header `X-Forwarded-Host` è **client-controlled** in qualunque deployment senza un reverse-proxy che lo strippi/imposti. Conseguenza:

- se l'utente espone la dashboard su rete (anche via tunnel), un attaccante manda `X-Forwarded-Host: localhost` e bypassa l'auth.
- in deployment Vercel della cloud-sync, l'header viene impostato da Vercel ma comunque preferito a `host`. Va verificato che Vercel sostituisca/normalizzi `x-forwarded-host` (di default lo passa).
- DNS rebinding: un sito malevolo che fa rebind a `127.0.0.1` invia `Host: attacker.example`. Non bypassa direttamente perché `attacker.example` non matcha — ma se imposta `x-forwarded-host: localhost` da JS, sì. (Nota: gli header `X-Forwarded-*` sono **forbidden headers** nel browser via fetch, quindi attack via browser è bloccato; resta valido per attaccanti server-to-server.)

**Fix:** rimuovere completamente `x-forwarded-host` dal check, o whitelistare solo se proviene da proxy fidati (env var `TRUSTED_PROXY=true`). Validare anche che l'IP remoto (`req.ip` / `x-forwarded-for[-1]`) sia loopback prima di concedere il bypass.

```ts
// suggerito
function isLocalRequest(req): boolean {
  const remoteAddr = req.ip ?? '' // o headers.get('x-real-ip')
  if (!['127.0.0.1', '::1', 'localhost'].includes(remoteAddr)) return false
  return isLocalhostHost(headers.get('host') ?? '')
}
```

---

### C2 — Endpoint sensibili senza `requireAuth()`

**Files:** ~25 route in `web/app/api/**`. Verificate direttamente:

- `web/app/api/secrets/route.ts` (GET/POST/DELETE) — lista/crea/cancella API key utente
- `web/app/api/database/route.ts` (GET/POST) — query explorer su file JSON in `~/.jht/`
- `web/app/api/agents/[id]/route.ts` (POST) — start/stop/delete agent
- `web/app/api/providers/route.ts` (POST) — `npm install -g`/`uv tool install` con effetti collaterali
- `web/app/api/config/route.ts` (GET/POST) — lettura/scrittura `jht.config.json`
- `web/app/api/env/route.ts` (GET) — enumera env var con prefissi `ANTHROPIC_*`, `SUPABASE_*`, `TELEGRAM_*` (nomi, non valori — ma rivela quali provider sono configurati)
- `web/app/api/backup/route.ts` (POST/PATCH/DELETE) — create/restore/delete backup
- `web/app/api/health/route.ts` (GET) — espone struttura interna, sessioni attive, file system layout
- `web/app/api/tasks/[id]/route.ts`, `web/app/api/history/[id]/route.ts` — IDOR: nessun ownership check
- `web/app/api/sessions/route.ts`, `web/app/api/credentials/route.ts`, `web/app/api/logs/route.ts`

**Perché critical:** combinato con C1, qualunque cosa raggiunga la porta è root-equivalent. Un sito malevolo aperto nel browser dell'utente può:

```js
fetch('http://localhost:3000/api/secrets').then(r => r.json())
// → tutti i secret in chiaro (mascheramento bypassabile via ?id=<uuid>)
fetch('http://localhost:3000/api/agents/scout', { method: 'POST', body: JSON.stringify({action:'start'}) })
// → spawn agent
```

Il browser bloccherà la lettura della response cross-origin (SOP/CORS), ma:
- per side-effects (POST → start agent) la richiesta parte comunque (CSRF classico);
- `secrets` GET con `Content-Type: application/json` triggera preflight OPTIONS, che però manca → browser blocca lettura ma il server già ha eseguito il GET e *potenzialmente* esposto via timing/log;
- `database` POST è triviale via form submission (`enctype=text/plain`) → CSRF.

**Fix:**
1. aggiungere `requireAuth()` a TUTTE le route eccetto: `health` (versione minima senza dettagli), `cloud-sync/*`, route pubbliche marketing.
2. introdurre un `middleware.ts` che applica controllo Origin/Referer su tutte le POST/PATCH/DELETE: `Origin === self` o presente in allowlist, altrimenti 403.
3. sostituire il bypass localhost con un token locale generato all'avvio, scritto in `~/.jht/.local-token` (mode 0600), che la dashboard Electron passa via header `Authorization: Bearer <token>`.

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

`target_session` viene dall'env var `JHT_TARGET_SESSION` (riga 48). Un valore tipo `CAPITANO'; rm -rf $HOME; echo '` produce: `JHT_TARGET_SESSION='CAPITANO'; rm -rf $HOME; echo '' python3 ...`. Esegue il `rm -rf`.

**Threat model:** chi controlla `JHT_TARGET_SESSION`? Se viene da:
- shell utente: l'utente attacca sé stesso, no-op
- file di config letto al runtime (`jht.config.json`): se un endpoint API permette di scrivere quel file (es. `web/app/api/config/route.ts` senza auth, vedi C2), allora attacker → file → env → RCE
- config Sentinella inviata via API: stesso pattern

→ in catena con C2 è full RCE remoto.

**Fix:**
```python
subprocess.Popen(
    ["setsid", "python3", "-u", str(BRIDGE_SCRIPT)],
    env={**os.environ,
         "JHT_TARGET_SESSION": target_session,  # validato a monte
         "JHT_TICK_INTERVAL": str(int(tick_interval))},
    stdin=subprocess.DEVNULL,
    stdout=open(BRIDGE_LOG, "ab"),
    stderr=subprocess.STDOUT,
    start_new_session=True,
)
```
Niente `sh -c`, niente f-string. Validare `target_session` contro `^[A-Z][A-Z0-9_-]{0,31}$`.

---

### C4 — Missing `homedir` import in `shared/credentials/storage.ts`

**File:** `shared/credentials/storage.ts:46-50`

```ts
function resolvePassphrase(): string {
  const envKey = process.env.JHT_CREDENTIALS_KEY?.trim();
  if (envKey) return envKey;
  return `jht-${homedir()}-default`;  // ← homedir non importato
}
```

Verificato: `import { homedir } from "node:os"` è assente da `storage.ts`. Quando `JHT_CREDENTIALS_KEY` non è settato (= la stragrande maggioranza degli utenti), il fallback lancia `ReferenceError: homedir is not defined` → `writeCredential`/`readCredential` falliscono → l'intero credential store AES-GCM è inaccessibile. Le chiamate sono in `try/catch` che ritornano `null` → fallimento silenzioso.

**Implicazione doppia:** non solo crash; siccome `readCredential` ritorna `null` su qualunque errore, l'utente vedrà "nessuna credenziale salvata" e probabilmente fallback su soluzioni meno sicure (env var plaintext, file in chiaro).

**Fix:** aggiungere `import { homedir } from "node:os"` in cima al file. **Plus:** il fallback stesso è insicuro (passphrase derivabile dal nome utente) — vedi H4. Va sostituito.

---

### C5 — Plaintext fallback in `cli/src/commands/secrets.js`

**File:** `cli/src/commands/secrets.js:80-92`

```js
const key = getEncryptionKey()  // null se JHT_SECRET_KEY non set
if (key) {
  const encrypted = encrypt(options.value, key)
  await writeFile(join(CREDS_DIR, `${options.name}.enc`), encrypted, 'utf-8')
} else {
  // FALLBACK: plaintext JSON
  await writeFile(join(CREDS_DIR, `${options.name}.json`),
    JSON.stringify({ value: options.value, ... }))
  console.log('Secret salvato (plaintext).')
}
```

Default UX: l'utente esegue `jht secrets set --name OPENAI --value sk-...` senza aver settato `JHT_SECRET_KEY` → secret scritto in chiaro su `~/.jht/credentials/OPENAI.json` senza permessi restrittivi (no `mode: 0o600`). Su sistemi multi-utente è world-readable se `umask` lo permette.

**Fix:**
1. rimuovere il fallback plaintext. Se `JHT_SECRET_KEY` manca, errore esplicito + suggerire `jht secrets init` che genera una passphrase stocata in OS keyring (Keychain/Credential Manager/SecretService).
2. in ogni caso `writeFile(..., { mode: 0o600 })`.

---

## HIGH

### H1 — `/api/secrets`: enumeration + reveal senza auth

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

GET pubblico (no `requireAuth()`). L'attaccante scarica la lista mascherata, prende ogni `id` (UUID v4 esposto in chiaro), poi rifa GET `?id=<uuid>` per ciascuno → ottiene tutti i valori in chiaro.

**Severity:** HIGH. Non CRITICAL solo perché richiede prima C1+C2 (raggiungere localhost:3000 + browser non blocca lettura JSON cross-origin → necessita CORS misconfigured o tunnel).

**Fix:** `requireAuth()` su GET; rimuovere la query `?id=` (reveal solo via POST con conferma); non esporre `id` nei mascherati.

---

### H2 — `/api/database` arbitrary JSON file read tramite parametro `table`

**File:** `web/app/api/database/route.ts:63-82, 95-108`

POST `{table, query}` non valida `table` contro un'allowlist: chiama `scanJsonFiles()` che enumera `~/.jht/`, `~/.jht/databases/`, `~/.jht/sessions/`, ecc., poi cerca un file il cui basename matcha `table`. Se l'utente ha `~/.jht/secrets.json` (modulo esistente!), un POST `{table: "secrets", query: "SELECT *"}` legge il file dei secret.

Verificato: `secrets.json` è proprio dove `web/app/api/secrets/route.ts` salva gli API key. → bypass del mascheramento.

**Fix:** allowlist hardcoded di tabelle visibili (positions, applications, ecc.); escludere file in DATA_DIRS che matchano `secrets|credentials|tokens|.env`.

---

### H3 — `JHT_SHELL_VIA` interpolato in stringhe shell (terminal routes)

**Files:**
- `web/app/api/team/terminal/open/route.ts:22-28, 60-83`
- `web/app/api/capitano/terminal/route.ts:17-21, 43-68`

```ts
const dockerContainer = shellVia?.startsWith('docker:') ? shellVia.slice(7) : null
const cmd = `docker exec -it ${dockerContainer} tmux attach -t ${session}`
await execAsync(`osascript -e '... do script "${cmd}"' ...`)
```

`session` è validato (regex). `dockerContainer` no. La env var è server-side (operatore-controlled) → l'attacco diretto richiede già RCE → severity HIGH e non CRITICAL.

**Tuttavia:** se in futuro `JHT_SHELL_VIA` venisse mai letto da un file di config modificabile via API (vedi C2 sull'endpoint `config`), diventa critical.

**Fix:** validare `dockerContainer` con `^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$`. Sostituire `exec()` con `execFile()` + array per le invocazioni interne. L'osascript resta string-based su macOS perché la sintassi lo richiede; usare allora un escape rigoroso o uno script `.scpt` esterno.

---

### H4 — KDF debole + fallback prevedibile in `tui/src/oauth/storage.ts`

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

Problemi:
1. **salt hardcoded** (`"jht-salt"`, `"jht-fallback-salt"`) → rainbow table comuni a tutti gli utenti.
2. **scrypt con parametri default Node** (N=16384, r=8, p=1) → ~16ms su laptop; troppo veloce per password user-supplied.
3. **fallback machine-derivable**: chiunque abbia accesso allo stesso filesystem conosce `homedir()` e `$USER` → può derivare la chiave e decifrare `~/.jht/credentials.json` (che contiene refresh_token OAuth Google + altri).

**Fix:** stessa ricetta di `shared/credentials/crypto.ts` (PBKDF2 100k, salt random persistito in `.salt`, AES-256-GCM). Rimuovere il fallback: se `JHT_ENCRYPTION_KEY` manca, errore esplicito o usare OS keyring (`keytar` su Windows/macOS, `libsecret` su Linux).

---

### H5 — AES-256-CBC senza auth tag in `cli/src/commands/secrets.js`

**File:** `cli/src/commands/secrets.js:27-40`

```js
function encrypt(text, key) {
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-256-cbc', key, iv)
  ...
  return iv.toString('hex') + ':' + encrypted.toString('hex')
}
```

CBC senza HMAC/GCM = nessuna integrity. Un attaccante con write access al file può flippare bit nel ciphertext (con padding oracle se il decrypt è espone errori distinti). Inoltre KDF è scrypt con salt hardcoded `'jht-salt'` (riga 24).

**Fix:** sostituire con `aes-256-gcm` (vedi pattern in `shared/credentials/crypto.ts`). Salt random per file. PBKDF2 / argon2 invece di scrypt con default.

---

### H6 — Path traversal potenziale via symlink in `/api/profile/files/[name]`

**File:** `web/app/api/profile/files/[name]/route.ts:19-41`

```ts
const safeName = path.basename(decodeURIComponent(name))
const filePath = path.join(JHT_USER_UPLOADS_DIR, safeName)
const buf = fs.readFileSync(filePath)
```

`path.basename()` rimuove `..`, ok. Ma non c'è controllo `realpath`: se l'attaccante riesce a creare un symlink in `JHT_USER_UPLOADS_DIR` (es. via `/api/profile-assistant/save` se accetta filename arbitrari, o via condivisione FS), il read segue il symlink fuori dalla directory.

**Fix:**
```ts
const real = fs.realpathSync(filePath)
const baseDir = fs.realpathSync(JHT_USER_UPLOADS_DIR)
if (!real.startsWith(baseDir + path.sep)) return 404
```
Aggiungere `requireAuth()` (route attualmente leggibile da qualunque richiesta, vedi C2).

---

### H7 — IDOR su `/api/tasks/[id]` e `/api/history/[id]`

**Files:** `web/app/api/tasks/[id]/route.ts:60-96`, `web/app/api/history/[id]/route.ts:63-98`

GET/PATCH usano `id` da URL senza verificare ownership. In single-user-on-localhost l'impatto è basso, ma con più profili sulla stessa macchina (multi-tenant) o con backup ripristinati da terzi è un IDOR.

**Fix:** se diventa multi-utente, aggiungere `userId` in storage e check `task.userId === currentUser.id`. Per ora la nota va in CHANGELOG come "single-user only".

---

### H8 — Vulnerabilità in dipendenze npm `web/`

**File:** `web/package.json` (via `npm audit`)

| Package         | Severity | CVE / issue                                           | Fix |
|-----------------|----------|------------------------------------------------------|-----|
| `next`          | high     | DoS via Server Components (GHSA-…)                  | upgrade `next` (range `>=9.3.4-canary.0`) — `npm audit fix` |
| `next-intl`     | moderate | open redirect                                        | upgrade `<4.9.1` |
| `postcss`       | moderate | XSS via unescaped `</style>` in CSS Stringify        | upgrade `<8.5.10` |

**Fix:** `npm --prefix web audit fix`. Verificare regressioni su `next-intl` (breaking changes 4.x).

---

### H9 — Vulnerabilità in dipendenze `desktop/`

| Package          | Severity | Issue |
|------------------|----------|-------|
| `electron`       | high     | AppleScript injection in `app.moveToApplicationsFolder` (macOS); service-worker spoof di executeJavaScript IPC reply (`<=39.8.4`) |
| `@xmldom/xmldom` | high     | XML injection via DocumentType serialization; uncontrolled recursion DoS |

**Fix:** upgrade `electron` a >= 39.9 (verificare disponibilità) o pinning a una versione patched. `@xmldom/xmldom` upgrade.

---

## MEDIUM

### M1 — `js-yaml.load()` senza schema esplicito in `profile-reader.ts`

**File:** `web/lib/profile-reader.ts:9, 24`

`yaml.load()` di **js-yaml v4** usa `DEFAULT_SCHEMA` (= `CORE_SCHEMA` esteso, **safe by default** dalla v4 in poi: il tipo `!!js/function` non è più registrato). Quindi RCE classica YAML non si applica. Resta tuttavia esposizione a edge case (`!!str` inattesi, large alias) e l'`as any` sulla destructuring.

**Severity ricalibrata:** MEDIUM (era HIGH nei findings agent). Fix: usare `yaml.load(content, { schema: yaml.CORE_SCHEMA })` per esplicitare, e parser Zod su `mapYamlToProfile()` input.

---

### M2 — CSRF: nessun controllo Origin/Referer su POST/PATCH/DELETE

Tutte le route API mutative (~80+) non verificano l'`Origin` header. Browser blocca lettura cross-origin via SOP, ma POST `text/plain` o form-encoded (con CSRF tradizionale) parte e produce side-effect.

**Fix:** middleware globale che, su metodi non-safe, esige `Origin` ∈ allowlist (`http://localhost:3000`, `http://127.0.0.1:3000`, `app://jht-electron`, dominio prod cloud-sync).

---

### M3 — Rate limit assente

Nessun rate limit su:
- `/api/secrets` (consente brute force `?id=`)
- `/api/cloud-sync/verify` (token brute force)
- `/api/agents/*/start` (resource exhaustion)
- endpoint di chat / assistente (abuso modello → costo)

**Fix:** middleware con `@upstash/ratelimit` o implementazione locale in-memory. Per cloud-sync su Vercel: `@vercel/edge-config` + KV.

---

### M4 — Error leakage in `/api/telegram` e altri

**File:** `web/app/api/telegram/route.ts:115-119`

```ts
} catch (err) {
  return NextResponse.json({ error: `Errore avvio bridge: ${err}` }, { status: 500 })
}
```

`err` può contenere stack trace con env (anche se TELEGRAM_BOT_TOKEN passato via `env: { ... }` a child non finisce direttamente nello stack del padre, una eccezione downstream potrebbe). Pattern presente in più route.

**Fix:** logger interno + risposta generica `{ error: 'internal' }` in produzione.

---

### M5 — Dockerfile: passwordless sudo per user `jht`

**File:** `Dockerfile:96-101`

```dockerfile
RUN echo 'jht ALL=(ALL) NOPASSWD: ALL' > /etc/sudoers.d/jht
```

Per design (container disposable, agenti `--yolo`). Ma in scenari multi-utente sullo stesso host, un agente compromesso ha root nel container → escape kernel possibile (CVE Linux ricorrenti). **Documentare il modello di trust** nel README/SECURITY.md: «il container non è un security boundary, ma una sandbox di convenienza».

---

### M6 — Docker-compose espone Next.js dev senza bind a 127.0.0.1

**File:** `docker-compose.yml:63-64`

```yaml
ports:
  - "3000:3000"
```

Bind a `0.0.0.0` per default. Su laptop in rete pubblica (caffè, conferenze) la dashboard è raggiungibile da chiunque sulla LAN.

**Fix:**
```yaml
ports:
  - "127.0.0.1:3000:3000"
```

---

### M7 — `/api/health` espone struttura interna senza auth

Conta sessioni, agenti attivi, path dei log: utile a un attaccante per reconnaissance prima di tentare C2. Mitigation banale: versione "anonima" che ritorna solo `{ status: 'ok' }`, dettagli solo per richieste autenticate.

---

### M8 — Backup restore con `id` user-controlled in path

**File:** `web/app/api/backup/route.ts:87-104`

```ts
const id = searchParams.get('id')
const targetDir = path.join(JHT_HOME, 'restored', id)
```

`id` non validato → traversal con `../`. Mitigato dal fatto che `restoreBackup` legge un `id` esistente, ma non c'è controllo esplicito.

**Fix:** `if (!/^[a-zA-Z0-9_-]+$/.test(id)) return 400`.

---

## LOW

### L1 — CSP `script-src 'unsafe-inline'`

**File:** `web/next.config.ts:26`

Default Next.js per supportare hydration. Limita ma non annulla protezione XSS. In produzione valutare `nonce`-based CSP (Next 16 lo supporta).

---

### L2 — `/api/gateway` HTTP plaintext default

**File:** `web/app/api/gateway/route.ts:12`

`http://localhost:18789` — accettabile per loopback. Documentare che `JHT_GATEWAY_URL` non deve mai puntare a host esterno senza HTTPS (e validare lo schema con `new URL()` + allowlist hostname).

---

### L3 — Telegram bridge in chiaro nei log

**File:** `shared/telegram/*` — verificato che il bot token è caricato da `process.env.TELEGRAM_BOT_TOKEN` e non loggato. Resta il rischio di echo accidentale in stack trace su crash. Aggiungere filtro logger globale (`pino-redact`).

---

### L4 — `.env.example`: nessun warning su rotazione chiavi / scope

Il file elenca tutti i provider OAuth/API senza note su:
- come revocare un token compromesso (specie OAuth Google)
- minimizzare scope OAuth (Drive: solo `drive.file`, non `drive.readonly`)

**Fix:** sezione "se hai committato per errore una chiave" con link a procedura di rotazione (Anthropic, Supabase, Google).

---

### L5 — Gitleaks: 3 false positive in test fixture

**Files:** `tests/js/.vitest-tasks.json`, `tests/js/config/schema.test.ts`

Verificati: stringa `'sk-projkey123'` (palesemente fake), label UI (`Debole/Scarsa/Buona/Ottima`), nomi colonne metriche. Nessun secret reale in 3122 commit.

**Fix:** opzionale, aggiungere `.gitleaksignore` con i 3 fingerprint per togliere rumore in CI.

---

## Priorità di remediation pre-launch

### Phase 1 — bloccanti per il rilascio (blocca PR di tagging release)

1. **C4** — fix import `homedir` (1 riga) — PRIMA DI TUTTO, è un crash-bug.
2. **C1** — togliere `x-forwarded-host` dal bypass localhost o richiedere remote IP loopback.
3. **C2** — aggiungere `requireAuth()` a `secrets`, `database`, `agents/[id]`, `providers`, `config`, `env`, `backup`, `health` (versione dettagliata), `tasks/[id]`, `history/[id]`, `credentials`, `sessions`, `logs`, `workspace/init`.
4. **C3** — riscrivere `bridge_health.py:spawn_bridge` senza `sh -c`.
5. **C5** — rimuovere fallback plaintext in `cli/src/commands/secrets.js`.
6. **H1** — auth + rimuovere reveal via query param su `/api/secrets`.
7. **H2** — allowlist tabelle in `/api/database`, escludere `secrets.json`.
8. **H8/H9** — `npm audit fix` su `web/` e `desktop/`.

### Phase 2 — entro 2 settimane post-launch

9. **H3** — execFile + validazione `JHT_SHELL_VIA`.
10. **H4** — sostituire fallback machine-derived in `tui/src/oauth/storage.ts` con keyring OS o env-required.
11. **H5** — migrare `cli/src/commands/secrets.js` a AES-256-GCM + PBKDF2.
12. **H6** — `realpath` check nel file download.
13. **M2** — middleware globale Origin/Referer.
14. **M3** — rate limit su endpoint sensibili.
15. **M6** — bind compose su `127.0.0.1:3000`.

### Phase 3 — hardening continuo

16. M1, M4, M5, M7, M8, L1–L5.
17. CI: aggiungere step `gitleaks detect --staged` come pre-commit (esiste `.githooks/`?), e `npm audit --audit-level=high` come CI gate.
18. Documentare il threat model in `docs/security.md` o `SECURITY.md` alla root.

---

## Note operative

- **Stato al momento dell'audit (2026-04-27 mattina):** report only, nessun fix committato. Lo sprint di remediation è partito nel pomeriggio (4 agenti in parallelo su `dev-1`..`dev-4`) e mergiato in `master` la sera (`7a2cb6ae`). Per lo stato fix-per-fix → [`05-checklist.md`](05-checklist.md).
- I findings degli agent sub-agent sono stati verificati a campione direttamente. False positive identificati e ricalibrati: js-yaml RCE (M1, era HIGH); `/api/database` "SQL injection" (era CRITICAL → riformulato come H2 file-read); osascript injection con session validato (era CRITICAL → H3, env-controlled).
- Output tooling raw (locale, non versionato): gitleaks JSON (3 false positive su 3122 commit), `npm audit` per root/web/desktop, `pip-audit` clean.
