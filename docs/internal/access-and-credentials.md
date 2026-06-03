# 🔐 Access & Credentials — guida consolidata

> Last updated: 2026-05-26. Owner: `docs/internal/vps.md` ne è il "padre" architetturale; questo file consolida solo la sezione **accesso alla macchina** (Local PC / Dedicated PC / VPS) + **dove vivono le credenziali**.

## 0. Perché esiste questo doc

La storia "dove sta il token? dove sta la chiave? l'LLM agent come accede?" era sparpagliata in `vps.md`, `cli/src/commands/{secrets,keyring}.js`, `web/lib/hetzner.ts`, `desktop/vps/ssh-exec.js`. Le risposte erano corrette ma 4 doc dicevano cose leggermente diverse e l'utente doveva ricostruirle a domande. Questo file le mette in un solo posto, con la **realtà del codice** quando diverge dall'**ideale documentato altrove**.

---

## 1. Access matrix — 3 modi × cosa serve per accedere

```
                          Local PC        Dedicated PC          VPS Hetzner
─────────────────────────────────────────────────────────────────────────────
SSH key di accesso        ❌ no           ✅ desktop → home     ✅ desktop → VPS
                                          (key pre-condivisa)   (o generata al volo
                                                                 da LLM agent in B2)
Hetzner API token         ❌ no           ❌ no                  🟡 path A opt-in
                                                                  🟢 path B2 raccomandato
Tunnel app↔team           ❌ stessa host  🟡 LAN o Tailscale     ✅ ssh -L via app
Storage credenziali       n/a             filesystem 0600        filesystem 0600
                                                                  + env $HCLOUD_TOKEN
Cosa può un LLM agent     tutto (è in-host) leggere SSH key      **autonomous full**
                                          + accedere a home PC   (solo token basta:
                                                                  genera key, crea
                                                                  VPS, SSH in, install)
```

**Chiave di lettura della tabella:**
- **Local PC** non ha problemi di "accesso macchina" — l'app e il team girano sullo stesso host, non c'è SSH in mezzo.
- **Dedicated PC** (PC vecchio in casa usato come server) richiede SSH dal device dell'utente (laptop con desktop app) al PC stesso. La chiave SSH è esattamente la stessa convenzione del VPS.
- **VPS Hetzner** aggiunge il livello "provisioning/destroy via API" — opzionale: senza token l'utente fa il setup VPS dal portale a mano (path A, lockato 2026-05-13), col token l'LLM agent può fare tutto autonomamente (path B2, descritto sotto).

---

## 2. Storage convention — dove vivono davvero le credenziali

**Realtà del codice** al 2026-05-26 (verificata su `master`):

| Credenziale | Convention nome | Storage canonico (doc) | **Storage usato dal codice (reale)** | Gap |
|---|---|---|---|---|
| SSH private key | `~/.ssh/jht_hetzner` | filesystem 0600 | filesystem 0600 ✅ | nessuno |
| SSH passphrase | n/a | OS keyring via `jht keyring` | **scollegato** — `jht keyring` salva solo `JHT_CREDENTIALS_KEY`, non la passphrase SSH | 🔴 vedi #6 |
| Hetzner API token | `HCLOUD_TOKEN` | OS keyring (vps.md §289) | `process.env.HCLOUD_TOKEN` + fallback `JHT_HETZNER_API_TOKEN` (`web/lib/hetzner.ts:49`) | 🟡 doc dice keyring, codice legge env |
| Generic secrets | `jht secrets set/get` | file cifrato AES-256-GCM in `~/.jht/credentials/` | implementato ✅ (`cli/src/commands/secrets.js`) | nessuno ma vedi #5 |
| Passphrase di `jht secrets` | `JHT_CREDENTIALS_KEY` | OS keyring via `@napi-rs/keyring` | implementato ✅ (`cli/src/commands/keyring.js`) — service `jht-credentials` | nessuno |
| Supabase session token | n/a | OS keychain via OAuth desktop | (in dev1) cookie + keychain mediato dalla desktop app | per beta 0 ok |

**Path canonici per platform:**

```
Windows
  SSH keys      C:\Users\<user>\.ssh\jht_hetzner{,.pub}
  Secrets file  C:\Users\<user>\.jht\credentials\<name>.enc
  Keyring       Windows Credential Manager — service="jht-credentials"
  Config        C:\Users\<user>\.jht\jht.config.json

macOS
  SSH keys      /Users/<user>/.ssh/jht_hetzner{,.pub}
  Secrets file  /Users/<user>/.jht/credentials/<name>.enc
  Keyring       Keychain (default keychain) — service="jht-credentials"
  Config        /Users/<user>/.jht/jht.config.json

Linux
  SSH keys      /home/<user>/.ssh/jht_hetzner{,.pub}
  Secrets file  /home/<user>/.jht/credentials/<name>.enc
  Keyring       Secret Service (libsecret) — collection="default", attrs={service: jht-credentials}
  Config        /home/<user>/.jht/jht.config.json
```

`JHT_HOME` env var override-a la root su tutte e tre (testato in CI).

---

## 3. Path B2 — LLM agent autonomous setup

Citato come 1-liner in `vps.md` L425; qui ne dettagliamo il contratto.

### 3.1 Discovery contract — che cosa l'LLM cerca, in che ordine

```
1.  $env:HCLOUD_TOKEN            (preferred — env var, immediate)
2.  jht secrets get HCLOUD_TOKEN  (se keyring sbloccato → AES decrypt)
3.  $env:JHT_HETZNER_API_TOKEN    (fallback legacy)
4.  prompt all'utente             (ultima spiaggia: chiedi & salva via `jht secrets set`)
```

```
SSH key discovery:
1.  ssh-add -l                                            (in agent? usala)
2.  ~/.ssh/jht_hetzner (preferred — JHT-specific)
3.  ~/.ssh/id_ed25519 / id_rsa                            (last resort)
4.  generate new effimera: ssh-keygen -t ed25519 -N '' \
       -f ~/.ssh/jht_ephemeral_<ts>                       (passphraseless, vedi #5)
```

### 3.2 Capability matrix — cosa può un LLM agent con quali credenziali

| Has | Can do | Cannot do |
|---|---|---|
| Solo SSH key (no passphrase) | `ssh root@<IP>` se conosce l'IP, exec, capture pane, restart container | scoprire IP a priori, lifecycle (create/destroy server) |
| **Solo `HCLOUD_TOKEN`** | **full autonomous bootstrap** (vedi 3.3 sotto), lifecycle (list/create/destroy/snapshot), iniettare SSH key in fase di create | — |
| Entrambi | full + riusa la SSH key JHT esistente invece di generarne una temporanea | — |

### 3.3 Autonomous bootstrap dell'LLM con solo `HCLOUD_TOKEN`

Verificato empiricamente: dare a un LLM agent (Claude Code, Codex, Kimi) **solo** la variabile `HCLOUD_TOKEN` è sufficiente per il setup VPS end-to-end. Il flow è:

```
1. echo $env:HCLOUD_TOKEN                                    # discovery
2. ssh-keygen -t ed25519 -N "" -f ~/.ssh/jht_bootstrap       # keypair locale
3. POST  /v1/ssh_keys      { name, public_key }              # upload pubkey
4. POST  /v1/servers       { server_type, image,             # create con key
                             ssh_keys: ["jht_bootstrap"] }   # injection at boot
5. GET   /v1/servers/{id}  poll until status=running         # ~30-60s
6. ssh -i ~/.ssh/jht_bootstrap root@<public_ipv4>            # entra ✅
7. curl https://raw.githubusercontent.com/.../install.sh | bash
8. jht setup --pairing-token <derived>                       # post-install
```

**Punto chiave**: al passo 4 la pubkey viene iniettata da Hetzner in `/root/.ssh/authorized_keys` **prima del primo boot**. Non serve "rescue mode" né `POST /servers/{id}/actions/add_ssh_key` su server esistenti — è la happy path normale dell'API per macchine nuove. La SSH key locale può essere effimera (passphraseless, generata al volo) — il path B2 non richiede la presenza preventiva di una chiave nel keychain.

**Rispondere alla domanda "ma il token mi dà accesso alla macchina?"**: **sì, indirettamente ma in pratica subito** — l'API token consente di creare un server includendo nella create request una SSH key (anche appena generata dall'agent localmente), e ti permette inoltre lifecycle, snapshot, destroy, rescue mode, web console. Non c'è shell interattiva *senza* SSH, ma SSH + key fresh è uno step automatizzabile da chiunque abbia il token.

**Decisione operativa per beta 0** (riallinea `vps.md` L376-386): il path A (utente paste IP a mano) resta **default per il wizard desktop** — non vogliamo che la desktop app crei VPS automaticamente con la carta dell'utente. Il path B2 (token-only autonomous) è il flow **raccomandato per LLM agent** che l'utente avvia esplicitamente con `jht setup --autonomous` (o equivalente) o quando un AI coding assistant locale (Claude Code/Codex/Kimi) viene incaricato di "tirare su la VPS". Doc esplicita 6.4 del punch list.

### 3.3 Sicurezza — chi autorizza l'LLM ad usare le credenziali?

Modello attuale (beta 0): **chiunque abbia shell sull'host ha accesso**. Non c'è gate aggiuntivo. Tre conseguenze:
- 🟢 LLM agent locale (Claude Code, Codex, Kimi) può leggere subito le credenziali → setup autonomo immediato
- 🟡 Se l'utente lascia la shell aperta su un PC condiviso, chi è seduto davanti ha accesso → invariante "non condividere shell con sconosciuti"
- 🔴 Un LLM agent **remoto** (es. via SSH tunnel da un servizio esterno) erediterebbe automaticamente le credenziali → out of scope v1, ma da considerare quando arriva il caso d'uso

Futuro v1+: gate esplicito `jht credentials grant <scope> --expiry 1h` che genera token derivati a tempo per gli LLM agent.

---

## 4. Recovery scenarios — 5 casi concreti

### S1. Nuovo PC, ho ancora accesso al vecchio
1. Vecchio PC: `jht backup export ~/Desktop/jht-backup.tar.gz.enc`
2. Nuovo PC: install desktop app + OAuth Supabase
3. `jht backup import ~/Desktop/jht-backup.tar.gz.enc` (chiede passphrase)
4. SSH key + secrets pull-ati, VPS riconosciuta

### S2. Nuovo PC, vecchio PC perso/distrutto
1. Install desktop app + OAuth Supabase (stesso account)
2. App pulla config cifrato da Supabase
3. User incolla passphrase (mostrata 1 volta al setup originale)
4. ⚠️ Hetzner API token: ricreabile da portale (`console.hetzner.cloud → Security → API tokens → Generate`)
5. ⚠️ SSH key: l'app genera nuova keypair effimera passphraseless
6. App usa Hetzner API token per iniettare la nuova pubkey nella VPS
7. ✅ Dashboard riconnessa, dati nella VPS intatti

### S3. PC stesso, ho perso la passphrase SSH key
1. La key è "morta" — non puoi sbloccarla
2. Path A (con token): genera key effimera, inietta via Hetzner API (vedi S2 punto 5-6), poi cancella la vecchia
3. Path B (senza token): rescue mode dal portale, monta disk, sostituisci `authorized_keys` a mano
4. Aggiorna `jht.config.json` per puntare alla nuova key

### S4. PC stesso, Hetzner API token revocato / scaduto
- Ricreabile sempre: `console.hetzner.cloud → Security → API tokens`
- Aggiorna `$env:HCLOUD_TOKEN` (Windows) o `~/.jht/credentials/HCLOUD_TOKEN.enc` via `jht secrets set HCLOUD_TOKEN`
- Niente impatto sull'SSH (key è separata)

### S5. Dedicated PC (Phase 2) — IP locale è cambiato
- Se LAN statico: nessun problema, IP invariato
- Se DHCP: aggiorna `jht.config.json` campo `dedicated_pc.host` con nuovo IP
- Se tunnel Tailscale: l'hostname Tailscale non cambia → niente da fare ✅ (motivo per cui Tailscale è opt-in raccomandato anche su Mode 2)

---

## 5. Passphrase flow — quando, come, dove, fallback

### 5.1 Stato attuale (verificato)

Due passphrase **diverse e indipendenti**:

```
A) SSH key passphrase                B) JHT secrets passphrase
   protegge ~/.ssh/jht_hetzner          protegge ~/.jht/credentials/*.enc
   usata da: ssh, ssh-add               usata da: jht secrets get
   storage: nessun automatismo (!)       storage: OS keyring (jht keyring set)
   default: chiede ogni volta            default: chiede 1x poi cached
```

### 5.2 Gap noto (🔴 punch list)

Il doc `vps.md` L394-398 promette: "SSH passphrase opzionale, scelta utente; se settata → keychain OS". **Non implementato**. Oggi se setti una passphrase sulla SSH key, ti viene chiesta ad ogni `ssh-add`. Non c'è glue code che la salvi su keyring.

Conseguenza pratica: la SSH key `jht_hetzner` che hai sul tuo Windows ha passphrase, ma non è in keyring → ogni `ssh-add` richiede input interattivo → blocca automation/LLM-agent path.

### 5.3 Fallback consigliato finché 5.2 non è implementato

**A) Generate key effimera passphraseless per automation:**
```pwsh
ssh-keygen -t ed25519 -N "" -f ~/.ssh/jht_ephemeral -C "jht-auto"
# poi inietta la pubkey sul server (manuale o via Hetzner API)
```
Pattern raccomandato da `feedback_ssh_key_passphrase_batchmode` (memory globale).

**B) Caricare la key vera in ssh-agent una volta per sessione:**
```pwsh
# Start-Service ssh-agent (richiede admin la prima volta)
ssh-add ~/.ssh/jht_hetzner
# poi tutta la sessione pwsh può usare la key senza re-prompt
```

---

## 6. Punch list implementazione

Cosa nella doc non è ancora codice — ticket da aprire (o referenziati esistenti):

| # | Item | Stato | Ticket |
|---|---|---|---|
| 6.1 | SSH passphrase → salvataggio automatico in OS keyring quando settata in wizard | ❌ doc lo promette, codice no | nuovo: `[JHT-SSH-PASSPHRASE-KEYRING]` |
| 6.2 | `web/lib/hetzner.ts` legge anche da `jht secrets get HCLOUD_TOKEN` come fallback | ❌ legge solo env | nuovo: `[JHT-HETZNER-TOKEN-SECRETS]` |
| 6.3 | Dedicated PC mode (Phase 2) — doc accesso completa | ⬜ Phase 2 roadmap | esistente: `[JHT-DEDICATED-PC]` (vedi BACKLOG) |
| 6.4 | LLM agent path B2 — convention scritta dentro un README discoverable | ❌ solo qui | nuovo: `[JHT-LLM-AGENT-CONTRACT]` — esporre `/api/agent/discovery` |
| 6.5 | Credentials grant scope+expiry per LLM remoti | ⬜ v1+ | nuovo: `[JHT-CRED-SCOPED-GRANT]` |
| 6.6 | `jht backup export/import` end-to-end test su scenario S1 | 🟡 partial | esistente: `[JHT-BACKUP-ROUNDTRIP]` |

---

## 7. Doc cross-references

- `docs/internal/vps.md` — architettura completa Mode 3 (VPS), decisioni lockate 2026-05-13
- `cli/src/commands/secrets.js` — implementazione `jht secrets` AES-256-GCM
- `cli/src/commands/keyring.js` — implementazione `jht keyring` per passphrase JHT_CREDENTIALS_KEY
- `web/lib/hetzner.ts` — client API Hetzner (read-only oggi, opt-in lifecycle)
- `desktop/vps/ssh-exec.js` — wrapper SSH per desktop app
- Memory globale: `feedback_ssh_key_passphrase_batchmode`, `feedback_hetzner_token_scope_verify`
