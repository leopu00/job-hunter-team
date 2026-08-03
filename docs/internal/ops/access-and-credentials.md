# 🔐 Access & Credentials — guida consolidata

> Last audited against code: 2026-08-03 (`[JHT-ACCESS-CREDENTIALS-GAPS]`).
> Owner: `docs/internal/ops/vps.md` ne è il "padre" architetturale; questo
> file consolida la sezione **accesso alla macchina** (Local PC / Dedicated PC /
> VPS) + **dove vivono le credenziali**.

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

**Realtà del codice** al 2026-08-03 (verificata sui file citati):

| Credenziale | Convention nome | Storage canonico (doc) | **Storage usato dal codice (reale)** | Gap |
|---|---|---|---|---|
| SSH private key | `~/.ssh/jht_hetzner` | filesystem 0600 | filesystem 0600 ✅ | nessuno |
| SSH passphrase | n/a | OS keyring via `jht keyring` | **non collegata**: nessun wizard/keychain SSH nel codice corrente | 🔴 aperto |
| Hetzner API token | `HCLOUD_TOKEN` | secrets/keyring | **nessun client Hetzner attivo** nel codice corrente; la vecchia citazione a `web/lib/hetzner.ts` è fossile | 🟡 serve decisione prima del path B2 |
| Generic secrets CLI | `jht secrets set/get` | file cifrato in `~/.jht/credentials/` | AES-256-GCM + PBKDF2-SHA512, file `0600`; `JHT_CREDENTIALS_KEY` canonica, `JHT_SECRET_KEY` solo fallback legacy | 🟡 store duplicato rispetto a `shared/credentials/` |
| Passphrase store condiviso | `JHT_CREDENTIALS_KEY` | env → OS keyring | `shared/credentials/passphrase.ts` prova env, poi `@napi-rs/keyring`; la dipendenza non è installata dal manifest standard, quindi env è oggi il path affidabile | 🟡 keyring non garantito |
| Email app-password | `credentials/email_monitor.json` | locale `0600` | **JSON in chiaro** scritto da `game/scripts/setup/setup_service.gd`, letto da `email_monitor.py` e chat skills | 🔴 principale target del vault |
| Supabase session | cookie SSR | cookie HttpOnly / token local device | route cloud: sessione Supabase; route locali: `jht_local_token` + `requireAuth`; sync: `jht_sync_*` separato, revocabile/scadibile | ✅ tre lane separate |

Correzioni applicate dall'audit 2026-08-03:

- il CLI `secrets` e il payload desktop ora preferiscono davvero
  `JHT_CREDENTIALS_KEY`, coerente con keyring e shared storage; il vecchio
  `JHT_SECRET_KEY` resta solo in lettura per compatibilità;
- il payload desktop non conserva più la copia storica CBC/plaintext: usa lo
  stesso GCM fail-closed del CLI sorgente;
- le API che toccano SQLite/config/file locali passano dal gate uniforme
  sessione/local-token prima di leggere o scrivere; il device-token cloud-sync
  resta una lane distinta e non è stato indebolito.

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

`JHT_HOME` override-a la root per CLI/shared code. Le copie/payload devono
restare sincronizzate: l'audit ha trovato proprio una copia desktop obsoleta del
secret store e ora un test impedisce che torni al fallback plaintext.

---

## 3. Path B2 — contratto desiderato, **non implementato end-to-end**

Citato come 1-liner in `vps.md` L425; qui ne dettagliamo il contratto.

Non esiste oggi un endpoint `/api/agent/discovery`, un client Hetzner attivo o
un comando `jht setup --autonomous`. Quanto segue è il contratto da
implementare, non una capability da promettere all'utente.

### 3.1 Discovery contract target — che cosa l'LLM cerca, in che ordine

```
1.  $env:HCLOUD_TOKEN             (headless/CI, se esplicitamente iniettata)
2.  jht secrets get HCLOUD_TOKEN  (richiede JHT_CREDENTIALS_KEY disponibile)
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
1. test -n "$HCLOUD_TOKEN"                                  # verifica presenza, NON stamparlo
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

**Decisione operativa corrente:** il path A (utente configura la macchina e
fornisce l'host) resta l'unico path supportato. Il flusso B2 sopra diventa
supportato solo quando esisteranno comando, discovery contract, redaction dei
log, test con token a scope minimo e una conferma utente prima delle operazioni
billing/distruttive. Fino ad allora non va presentato come feature disponibile.

### 3.3 Sicurezza — chi autorizza l'LLM ad usare le credenziali?

Modello attuale (beta 0): **chiunque abbia shell sull'host ha accesso**. Non c'è gate aggiuntivo. Tre conseguenze:
- 🟢 LLM agent locale (Claude Code, Codex, Kimi) può leggere subito le credenziali → setup autonomo immediato
- 🟡 Se l'utente lascia la shell aperta su un PC condiviso, chi è seduto davanti ha accesso → invariante "non condividere shell con sconosciuti"
- 🔴 Un LLM agent **remoto** (es. via SSH tunnel da un servizio esterno) erediterebbe automaticamente le credenziali → out of scope v1, ma da considerare quando arriva il caso d'uso

Futuro v1+: gate esplicito `jht credentials grant <scope> --expiry 1h` che genera token derivati a tempo per gli LLM agent.

---

## 4. Recovery scenarios — stato verificato

Il documento precedente descriveva comandi inesistenti (`jht backup
export/import`) e attribuiva al backup proprietà che non ha. Il codice corrente
offre `jht backup create/list/restore`: copia una piccola allowlist di file di
configurazione sotto `~/.jht/backups/`, **non cifra l'archivio, non include DB,
SSH key o `credentials/`, e non esegue un round-trip su un nuovo PC**.

| Scenario | Cosa funziona oggi | Gap/rischio |
|---|---|---|
| stesso PC, config corrotta | `jht backup restore --name <nome>` per i soli file nell'allowlist | non è disaster recovery |
| nuovo PC, vecchio disponibile | copia manuale controllata di DB/config/key/credenziali + reinstallazione | nessun export cifrato e testato |
| vecchio PC perso | dati cloud sincronizzati recuperabili dopo login; token provider revocabili dal provider | segreti locali e SSH key non sono recuperabili da JHT |
| passphrase vault persa | nessun recupero crittografico, per design | serve export di recovery o reinserimento dei segreti |
| SSH key/passphrase persa | recovery manuale dal provider/console o altra key autorizzata | nessuna automazione JHT verificata |

Finché `[JHT-BACKUP-ROUNDTRIP]` non include DB, inventario dei secret (mai i
valori in chiaro), cifratura autenticata, manifest/versione e test restore su
directory vuota, la UI/docs non devono chiamarlo backup completo.

---

## 5. Passphrase flow — quando, come, dove, fallback

### 5.1 Stato attuale (verificato)

Due passphrase **diverse e indipendenti**:

```
A) SSH key passphrase                B) JHT secrets passphrase
   protegge ~/.ssh/jht_hetzner          protegge ~/.jht/credentials/*.enc
   usata da: ssh, ssh-add               usata da: jht secrets get
   storage: nessun automatismo (!)       storage: OS keyring (jht keyring set)
   default: chiede ogni volta            affidabile oggi: env JHT_CREDENTIALS_KEY
```

`jht keyring` e `shared/credentials/passphrase.ts` contengono l'integrazione
opzionale `@napi-rs/keyring`, ma il pacchetto non è nel manifest standard:
non va descritto come disponibile in ogni installazione. Inoltre un processo
figlio non può esportare una variabile nell'ambiente della shell padre: quando
si usa il comando CLI, il ponte esplicito è
`export JHT_CREDENTIALS_KEY="$(jht keyring get)"`, senza loggare il valore.

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
| 6.1 | SSH passphrase → OS keyring/ssh-agent, con comportamento cross-platform testato | ❌ aperto | `[JHT-SSH-PASSPHRASE-KEYRING]` |
| 6.2 | Scegliere/reintrodurre client Hetzner e leggere token dal secret broker, non da log/prompt | ❌ nessun client corrente | `[JHT-HETZNER-TOKEN-SECRETS]` |
| 6.3 | Eliminare il JSON plaintext `email_monitor.json` a favore del vault/runtime materialization | ❌ aperto, priorità più alta | `[JHT-LOCAL-VAULT]` |
| 6.4 | Installare/supportare davvero keyring oppure dichiarare env-only per platform headless | 🟡 codice opzionale, dep assente | `[JHT-KEYRING-DISTRIBUTION]` |
| 6.5 | Discovery contract per agent locali, senza rivelare valori dei secret | ❌ aperto | `[JHT-LLM-AGENT-CONTRACT]` |
| 6.6 | Credentials grant scope+expiry per agent remoti | ⬜ design futuro | `[JHT-CRED-SCOPED-GRANT]` |
| 6.7 | Backup cifrato completo + restore su directory vuota | ❌ il comando attuale è solo config snapshot | `[JHT-BACKUP-ROUNDTRIP]` |

---

## 7. Doc cross-references

- `docs/internal/ops/vps.md` — architettura completa Mode 3 (VPS), decisioni lockate 2026-05-13
- `cli/src/commands/secrets.js` — implementazione `jht secrets` AES-256-GCM
- `cli/src/commands/keyring.js` — implementazione `jht keyring` per passphrase JHT_CREDENTIALS_KEY
- `shared/credentials/{crypto,storage,passphrase}.ts` — store GCM condiviso
- `game/scripts/setup/setup_service.gd` — writer corrente del JSON email plaintext
- `shared/skills/email_monitor.py` — reader corrente della password email
- `docs/internal/architecture/2026-08-03-local-vault-design.md` — design vault implementabile, senza nuova crittografia ad hoc
- Memory globale: `feedback_ssh_key_passphrase_batchmode`, `feedback_hetzner_token_scope_verify`
