# 🖥️ Desktop ↔ Team — scoperte e decisioni (sessione 2026-06-24/25)

Documento delle scoperte fatte testando dal vivo l'app desktop con il team in
container locale (immagine `:latest`). Diverse sono **cause-radice trasversali**:
lo stesso problema si manifestava su funzioni diverse. Tutte le fix di codice
sono su `dev3`.

---

## 0. La causa-radice trasversale: `isLocalRequest()` è FALSO col port-map Docker

Tantissimi problemi avevano la **stessa origine**. Il web (Next dentro al
container) distingue "richiesta locale = desktop" da "browser/cloud" con
`isLocalRequest()` (`web/lib/auth.ts`): richiede host loopback + nessun forwarded
header. **Attraverso il port-map di Docker** (`-p 3000:3000`) la richiesta del
desktop al container **non risulta loopback puro** → `isLocalRequest()` = **false**.

Conseguenza: ogni route gated su `isLocalRequest` tratta il desktop come "cloud":
- **Controllo team** (`/api/team/start-all`, `/api/team/command`): `enqueueIfRemote`
  → 403 `read_only` ("dal browser è sola visualizzazione").
- **Stato agenti** (`/api/agents`): ramo "remote" → NON guarda le tmux, legge da
  Supabase (vuoto) → riporta tutto `stopped` anche col team vivo.
- **Invio chat** (`POST /api/<agent>/chat`): `requireLocalWrite()` → 403 `read_only`
  → il messaggio non arriva mai all'agente.

### ✅ Decisione/architettura: il controllo team dal desktop si fa via `docker exec`
Il canale corretto desktop→team **NON è l'HTTP**, ma **eseguire i comandi DENTRO il
container** (`docker exec jht ...`), come già fa provider-install/provider-auth.
Le route web restano **sola lettura** (GET col local-token funziona: `requireAuth`
accetta il Bearer). Implementato in `desktop/main.js`:
- avvio team: `ensureTeamStarted()` → `docker exec jht node /app/cli/bin/jht.js team start`
- stato agenti: `teamAgentsStatus()` → `docker exec jht tmux list-sessions` (intercetta `/api/agents` in `dashboard:get`)
- chat: `chat:send` → `docker exec jht tmux send-keys -t <SESSION> ...`
- kill/restart agente: `agent:stop`/`agent:restart` → `docker exec tmux kill-session` / `start-agent.sh <role>`

> Nota: per i POST che INVECE sono token-based (azioni-posizione: write/recheck/
> geocode/exclude/ticket, validati con `isLocalTokenAuthenticated`) l'HTTP va bene
> — non passano da `isLocalRequest`.

---

## 1. CSRF: il `fetch` di Electron scarta l'header `Origin`

I POST del desktop verso il web prendevano **403** dalla guardia CSRF
(`web/lib/csrf.ts`): il `fetch` del main process Electron (stack Chromium) presenta
un **Origin opaco (`null`)**, non in allowlist. E **`Origin` è un "forbidden header"**:
impostarlo manualmente nel `fetch` viene **scartato silenziosamente** da Chromium.

### ✅ Fix
`dashboardApiFetch` usa **`node:http`** (non `fetch`) → permette di settare
`Origin: http://127.0.0.1:<port>` (in `STATIC_ALLOWED`) → richiesta legittimamente
same-origin. (Commit `ff4a4fdc3`.) Verificato: `Origin: null`→403, `Origin:
127.0.0.1:3000`→passa.

---

## 2. `localStorage` su origine `file://` NON persiste in Electron → boot-to-wizard

Sintomo: **l'app ripartiva dal setup da capo ad ogni riavvio** (token email, provider…).
Causa: la lingua si salvava in `localStorage`, ma l'HTML è caricato via `file://`
(`mainWindow.loadFile`) e **Chromium non persiste localStorage su file://**. Quindi
`stored` lingua era sempre `null` → il primo gate di `boot()` mandava al wizard.

### ✅ Fix (commit `1e0aef188`)
- `boot()` NON gatekeepa più la Home sulla lingua: se `providers.saved>0` → **Home**.
- Preferenze persistenti nel renderer: usare **`prefsApi`** (`preferences.json` nel
  main), **MAI** localStorage/sessionStorage.

---

## 3. Il container muore al riavvio dell'app (attrito di sviluppo)

`docker run --rm` foreground figlio di Electron + `app.on('before-quit')` →
`stopRuntime()`. Quindi ogni restart di Electron (per caricare una modifica al main
process) **uccide il team** → si deve ricliccare "Start" e attendere ~40s.

### Da valutare (follow-up, NON fatto — rischioso a caldo)
- **Container detached** (`docker run -d`): sopravvive ai restart dell'app. Cambia
  però la semantica "chiudo l'app = fermo il team" (che per il locale è voluta).
- **Auto-start team al boot** quando setup completo: niente più click "Start"
  (consuma token ad ogni apertura → opt-in).

Gotcha collegato: quando `docker run -p 3000:3000` fallisce (es. port-forward
ancora occupato dopo un `docker rm -f` ravvicinato → "port already allocated"),
l'errore va **solo** al pannello log del renderer, NON al log principale → buco di
osservabilità.

---

## 4. Chat nativa con gli agenti — architettura + bug

**Architettura (funziona):** ogni agente ha `chat.jsonl` in `/jht_home/agents/<role>/`.
La UI fa GET `/api/<agent>/chat?after=<ts>` (token → ok) e renderizza. L'agente
risponde via la skill **`chat-web`** (comando `jht-send`, scrive in `chat.jsonl`).
Verificato dal vivo: il Capitano risponde ("Sto facendo girare la pipeline: 9 aziende
verificate, 8 allo scoring…"); l'Assistente legge e riassume il profilo con precisione.

**Bug 1 — i messaggi utente "sparivano":** `appendMessages` filtrava `ts <= lastTs`,
e l'echo ottimistico ha `ts:0` con `lastTs:0` → `0<=0` → saltato. Fix: dedup solo su
`ts>0` (commit `fea65bf87`).

**Bug 2 — invio bloccato:** POST chat gated read-only (vedi §0) → ora via `docker
exec tmux send-keys`.

**Bug 3 — messaggi al Capitano spariscono se cambi tab (IN CORSO):** l'invio desktop
faceva solo `send-keys` senza scrivere il messaggio utente in `chat.jsonl` → era solo
echo temporaneo; al ri-render (cambio tab/navigazione) spariva. Con l'Assistente non
si notava perché risponde subito (le risposte persistono). **Fix da finire:** `chat:send`
scrive anche il messaggio utente in `chat.jsonl` (gestendo `lastTs` per non duplicare).

---

## 5. ⭐ Gli agenti non sanno di parlare con la DESKTOP-APP (importante, da implementare)

Scoperto chiedendo all'Assistente di **inviare una mail**. Risposta:
> *"Per inviare la mail ho bisogno di collegare il tuo account Gmail. Digita `/mcp`
> nella chat di Claude Code (il terminale), seleziona 'claude.ai Gmail' e completa
> l'autorizzazione."*

**Problema reale:** l'utente è sulla **chat desktop**, **non ha accesso al terminale**
e **non è tecnico**. Chiedergli `/mcp` o azioni CLI è un vicolo cieco. L'agente non
ha il **contesto del canale**.

### Cosa devono fare gli agenti (decisione utente, da mettere nei prompt/skill)
1. **Conoscere il canale = desktop-chat, utente non-tech, niente terminale/CLI/MCP.**
   Il messaggio utente arriva col protocollo `[@utente -> @<agente>] [CHAT] …`
   (inviato dall'app desktop) → l'agente deve dedurre il contesto e **non chiedere
   mai** all'utente di fare cose da terminale.
2. **Ingegnarsi invece di delegare all'utente.** Per mandare una mail **non serve MCP**:
   scrivere uno **script Python** (`smtplib`) che usa le **credenziali email del team**
   già configurate (`~/.jht/credentials/email_monitor.json` — Gmail app-password vale
   sia IMAP che SMTP) e inviarla. "Non ci vuole un cazzo." Stesso principio per altri
   bisogni: prima prova a risolvere da solo con codice.
3. **Essere più furbi con slash-command / strumenti che servono a loro stessi:**
   - Uno slash command lo possono **auto-iniettare nella propria sessione** (es. via
     `jht-tmux-send <PROPRIA_SESSIONE> '/mcp'`), senza coinvolgere l'utente.
   - Oppure **chiedere a un altro agente**: es. l'Assistente chiede al **Capitano**
     (via `jht-tmux-send CAPITANO …`) di iniettare lo slash command **nella sessione
     dell'Assistente**, così parte lì.

> Vale per **tutti** gli agenti, non solo l'Assistente. È un capitolo "agent
> awareness del canale + auto-sufficienza".
>
> **IMPLEMENTATO (2026-06-28).** Il principio vive nella skill `chat-web` (sezione
> "⚠️ The user is NON-TECHNICAL — no terminal, no CLI, no slash commands": niente
> azioni da terminale all'utente desktop, risolvi con Python — esempio smtplib con
> `$JHT_HOME/credentials/email_monitor.json` — auto-iniezione slash command
> `jht-tmux-send <PROPRIA_SESSIONE> '/mcp'` o delega a un altro agente). Era già in
> EN + IT; portato anche in es/fr/de/hu/pt (le 5 i18n che mancavano). I 3 agenti
> user-facing (Capitano/Assistente/Mentor) caricano già `chat-web` su ogni `[CHAT]`,
> quindi la regola li raggiunge senza toccare i 77 file dei prompt.

---

## 6. Riepilogo fix applicati questa sessione (dev3)

| Tema | Commit |
|---|---|
| Onboarding snellito (no notice/model-compare, provider semplificato, copy cloud/VPS) | `854f1ebc0` |
| Step orari di lavoro + upload CV obbligatorio | `b1968ca5a` |
| Step email team + validazione round-trip (IMAP+SMTP+rilettura) | `e48be1d29` |
| Host GMX/mail.com/Yandex per validazione email | `f09848dbb` |
| Email Gmail-first + link app-password + rimozione avviso "personal" | `e7b410ca6`, `c15ee7b97` |
| Email OPZIONALE + roadmap OAuth/vault | `1811c7a74` |
| Guida pubblica "Configura la Gmail del team" | `d1d5aa369` |
| Team auto-start via `docker exec` (non HTTP) | `d687df29b` |
| Origin same-origin nel proxy (node:http) | `ff4a4fdc3` |
| Stato agenti via `docker exec tmux` | `99794922f` |
| Boot → Home (lingua via prefsApi) | `1e0aef188` |
| Chat: invio via docker exec + echo non filtrato | `fea65bf87` |
| Kill/restart per-agente dal pannello | `8a4cc069a` |

## 7. TODO aperti
- [x] **GAP wizard VPS salta CV + orari (FIXED 2026-06-28).** Il ramo VPS saltava
      `enterWorkingHours` + upload CV (andava dritto a Telegram dopo provider-login in
      `terminal-login.js`): gli step esistevano (`b1968ca5a`) ma solo nel ramo locale → **in
      VPS mode l'utente non sceglieva MAI gli orari né caricava il CV**. Fix: dopo provider-login
      entrambi i rami passano per working-hours → upload CV; i due step sono ora VPS-aware e
      scrivono sul container REMOTO via SSH (nuovo modulo `desktop/vps/remote-config.js`:
      `saveWorkingHoursToVps` → `team.working_hours` in `/root/.jht/jht.config.json`,
      read→merge→atomic-write + chown 1001; `uploadDocsToVps` → drop-zone allegati remota
      `/root/Documents/Job Hunter Team/allegati` via `SshExec.writeFile` con Buffer = upload
      binario senza scp). Sequenza VPS: provider-login → working-hours → upload → telegram →
      ready(home). L'email resta saltata in VPS (vedi sotto). Smoke test in-memory: PASS.
- [x] **GAP upload documenti VPS mode (FIXED 2026-06-28).** Stesso modulo: il file-picker nativo
      gira sul Mac, i file vengono letti come Buffer e scritti nella drop-zone allegati REMOTA
      (path corretto `…/allegati`, NON `/jht_user/cv` come nel workaround manuale b3). chown -R
      1001 così l'Assistente li legge al boot. *(Resta da fare l'upload **dalla home** in VPS
      mode — qui è coperto solo il wizard.)*
- [ ] **GAP email in VPS mode (NEW 2026-06-28).** Il ramo VPS salta lo step email: le credenziali
      `email_monitor.json` si salvano solo in locale (`~/.jht/credentials`), serve una variante
      remota (write SSH + chown 1001) come per orari/CV. Per ora il team VPS fa web sourcing.
- [x] **Bug 3 chat (FIXED 2026-06-28).** Local mode: già persistito (chat:send scrive
      il msg utente in chat.jsonl, main.js). VPS mode: il fix mancava — chat:send faceva
      `docker exec` locale (container remoto) → falliva. Ora ramo VPS via SSH+docker exec:
      persist (`cat >> chat.jsonl` da stdin) + invio (`tmux load-buffer -`/`paste-buffer`,
      niente quoting del payload). §4.
- [x] **Agent awareness canale + auto-sufficienza (FIXED 2026-06-28).** Nella skill
      `chat-web` (vedi §5): era in EN+IT, portato anche in es/fr/de/hu/pt. I 3 agenti
      user-facing la caricano su ogni `[CHAT]`.
- [ ] Container detached + auto-start team (§3).
- [ ] `pull desired-state: unknown option '--silent'` e `ticket-sync: no such table
      position_tickets` (warning non-fatali nel bootstrap team).
- [ ] OAuth Gmail / vault master-password (BACKLOG `[JHT-EMAIL-OAUTH]`, `[JHT-LOCAL-VAULT]`).
