# JHT su VPS — design, providers, install UX

**Doc consolidato il 2026-05-13** unificando:
- `2026-05-04-vps-deployment-design.md` — design UX deployment + lifecycle + login/recovery
- `2026-05-06-host-container-split.md` — refactor host/container CLI (decisione tecnica)
- `2026-05-06-vps-providers-research.md` — research prezzi providers
- `2026-05-12-vps-fresh-install-ux-fixes.md` — punch list UX fresh install

> Quando i 4 doc divergono, vince la decisione più recente. Le date in testa a ogni sezione tracciano la freschezza.

---

## 🎯 TL;DR

VPS è la modalità ⭐ **target setup** della vision JHT (€5–10/mese, sempre on, zero impatto sul PC).
Oggi è un second-class citizen (richiede SSH + comandi Linux), domani deve essere un **wizard nel desktop launcher** con `paste API token Hetzner → wait 90s → done`.

Stato 2026-05-13:
- 🥉 **Tier tech** (SSH manuale + `curl install.sh | bash`) → funziona, P0 fix applicati su `dev1`
- 🥈 **Tier power-user** (CLI `jht vps setup`) → roadmap, dipende da `[JHT-CLOUD-04]`
- 🥇 **Tier non-tech** (desktop wizard full) → target v1 GA, dipende da `[JHT-VPS-FRIENDLY]`

I 3 tier **coesistono**: la VPS provisionata da uno qualsiasi resta identica (stesso `install.sh`, stesso wizard, stesso pairing).

---

## 🏗️ Architettura

### Location-transparent code

**Su VPS la web app gira SULLA VPS**, insieme al container. Il browser dell'utente la raggiunge via Tailscale.

```
Local PC mode                       VPS mode
═════════════                       ════════

USER PC                             USER PC
├── Browser → localhost:3000        ├── Browser → http://jht-vps:3000
└── 🌐 web app + 🐳 container       │              (tailscale magic DNS)
    └── docker exec locale          │
                                    │  ─── tailscale tunnel ───►
                                    │
                                    VPS
                                    └── 🌐 web app + 🐳 container
                                        └── docker exec locale
```

**Cosa cambia nel codice**: niente. Stesso container, stessa logica, solo host diverso. La web app fa sempre `docker exec` sul daemon locale.

**Cosa NON deve mai succedere**: web app sul PC + container sulla VPS. Servirebbe SSH dal Next.js o Docker socket remoto: più codice, più surface attacco, complicazione inutile.

### Host/container split del CLI `jht` (decisione 2026-05-06)

Il binario `jht` aveva due ruoli incompatibili:
- **Lifecycle host** (parlare al Docker daemon: `compose up/down`, `exec`)
- **Operatività in-container** (wizard, agents, db, web, tmux)

Sul VPS via `install.sh` Docker-mode finiva in un container effimero senza accesso al daemon dell'host → `jht setup` ok, `jht team start` rotto.

**Soluzione adottata** (B nell'analisi originale):

```
┌──────────────────── HOST (Linux / Mac / Windows / VPS) ─────────────┐
│  ~/.local/bin/jht          ← wrapper bash (~80 righe)               │
│   ├─ jht up|down|restart|recreate|upgrade                           │
│   │     └─→ docker compose -f ~/.jht/runtime/docker-compose.yml ... │
│   ├─ jht logs|status|shell                                          │
│   │     └─→ docker logs / inspect / exec -it jht bash               │
│   └─ jht <anything else>                                            │
│         └─→ docker exec -it jht node /app/cli/bin/main.js <args>    │
│                                                                     │
│  ~/.jht/runtime/docker-compose.yml  ← scaricato da install.sh       │
│  /var/run/docker.sock               ← parlato dal wrapper, MAI montato dentro │
└──────────────────────────────────┬──────────────────────────────────┘
                                   │ docker exec
                                   ▼
┌──────────── CONTAINER `jht` (long-running, restart: unless-stopped) ┐
│  /app/cli/bin/main.js  ← CLI Node (ex `cli/bin/jht.js`)             │
│   └─ wizard, agents, web :3000, db, tmux, sentinella, bridge        │
│  Bind-mount:                                                        │
│   ~/.jht  ↔  /jht_home   (config, db, profile)                      │
│   ~/Documents/JHT  ↔  /jht_user  (CV, allegati, output)             │
└─────────────────────────────────────────────────────────────────────┘
```

**Cose che NON ci sono:**
- ❌ Node sull'host (a parte path "from source" per dev)
- ❌ Socket Docker dentro al container (vettore "jailbreak prompt = root host")
- ❌ Repo clonato sull'host
- ❌ Vercel/Supabase come intermediari nel pairing VPS

**Mapping comandi:**

| Utente digita    | Wrapper bash esegue                                                |
|------------------|--------------------------------------------------------------------|
| `jht up`         | `docker compose -f ~/.jht/runtime/docker-compose.yml up -d`        |
| `jht down`       | `docker compose -f ... down`                                       |
| `jht restart`    | `docker compose -f ... restart jht`                                |
| `jht recreate`   | `down && up -d` (dopo bump immagine)                               |
| `jht upgrade`    | `pull && up -d`                                                    |
| `jht logs [-f]`  | `docker logs jht`                                                  |
| `jht status`     | `docker inspect jht --format '{{.State.Status}}'`                  |
| `jht shell`      | `docker exec -it jht bash`                                         |
| `jht setup`      | `docker exec -it jht node /app/cli/bin/main.js setup`              |
| `jht team start` | `docker exec -it jht node /app/cli/bin/main.js team start`         |
| `jht doctor`     | `docker exec -it jht node /app/cli/bin/main.js doctor`             |
| ...              | ... (tutto il resto delegato al CLI Node nel container)            |

**Auto-up**: se il container non gira, il wrapper fa `compose up -d` automaticamente prima del `docker exec`. L'utente non incontra mai "container 'jht' non attivo".

### Ruolo del launcher: runtime host vs lifecycle controller

| Funzione                      | Local PC mode      | VPS mode             |
|-------------------------------|--------------------|----------------------|
| Provisioning container        | docker compose    | Hetzner API + cloud-init |
| Start/stop web app            | next dev locale   | gira su VPS, autonoma |
| Start/stop container          | docker compose    | via API team su VPS |
| Apri browser dashboard        | localhost:3000    | jht-vps:3000 (tailscale) |
| Tailscale client              | non serve         | sempre attivo      |
| Snapshot / destroy            | n/a               | Hetzner API        |

In VPS mode il launcher è **lifecycle controller**: dopo il setup iniziale può anche essere chiuso, la VPS continua a lavorare da sola.

---

## ☁️ Provider VPS — research 2026-05-06

### Decisione: **Hetzner CPX22** per primo smoke; **Netcup VPS 500 G12** miglior alternativa prezzo

Primo smoke test gira su Hetzner CPX22 (€9.75/mo con VAT IT + IPv4, 4GB / 2 vCPU AMD EPYC nuovi / 80GB SSD, Norimberga). Scelto per familiarità piattaforma + API ricca, non per essere il più economico.

Per chi ottimizza sul prezzo a parità di stabilità CPU: **Netcup VPS 500 G12** (€5.91/mo, 4GB DDR5 ECC, AMD EPYC 9634, mensile).

Per uso continuativo (1–3 mesi job hunt vero): **8GB** consigliato (Netcup VPS 1000 G12 €10.37 o Hetzner CPX32 €17.07).

### Tabella comparativa

Tutti prezzi includono VAT EU (22% IT, 19% DE), aggiornati 2026-05-06.

| Provider                   | Plan              | vCPU                 | RAM          | Storage     | €/mo  | Contratto | EU? | Note critiche                              |
|----------------------------|-------------------|----------------------|--------------|-------------|-------|-----------|-----|---------------------------------------------|
| 🇩🇪 Hetzner                | CX23              | 2 mix Intel/AMD      | 4 GB         | 40 GB       | €3.99 | mensile   | ✅  | "Limited availability", HW vecchio          |
| 🇩🇪 Contabo                | Cloud VPS 10      | 4 AMD EPYC (oversold)| 8 GB         | 75 GB NVMe  | €4    | 12 mesi   | ✅  | ⚠️ CPU oversold, vincolo annuale            |
| 🇫🇷 V6Node                 | base              | 2                    | 4 GB         | 40 GB NVMe  | €4.49 | mensile   | ✅  | ⚠️ NO IPv4 default, complica SSH            |
| 🇩🇪 **Netcup ⭐**          | **VPS 500 G12**   | **2 AMD EPYC 9634**  | **4 GB DDR5 ECC** | NVMe   | **€5.91** | mensile | ✅  | DDR5 ECC, hardware top tier             |
| 🇫🇷 OVHcloud               | VPS-1             | 4                    | 8 GB         | 75 GB SSD   | ~€6   | mensile   | ✅  | Backup giornalieri inclusi                  |
| 🇩🇪 Hetzner                | **CPX22**         | 2 AMD EPYC nuovi     | 4 GB         | 80 GB SSD   | €7.99 (€9.75 con IPv4 + VAT IT) | mensile | ✅ | Primo smoke 2026-05-06       |
| 🇩🇪 Netcup                 | VPS 1000 G12      | 4 AMD EPYC 9634      | 8 GB DDR5 ECC| 256 GB NVMe | €10.37| mensile   | ✅  | Tier ottimale continuativo                  |

> ⚠️ **Hetzner rincaro 1 aprile 2026**: CPX22 da €5.99 → €7.99/mo. In console il prezzo include IPv4 (€0.61/mo) + VAT, da cui i €9.75/mo.

### Considerazioni JHT-specific

**CPU stabile vs Bridge V6/V7 calibration.** Il Bridge calibra il throughput basandosi sui tempi di risposta degli agenti. Su CPU oversold (Contabo) o mixed (Hetzner CX) il rumore rende la projection oscillante ±20–30% invece del ±5% atteso. Per JHT **CPU prevedibile** vale più di "RAM nominale più grossa": un 4GB AMD EPYC stabile batte un 8GB AMD oversold.

**RAM 4GB sufficiente?** Misurato 2026-05-06: container `jht` idle ~700 MB, 8 agents tmux ~2.5 GB, Sentinella+Bridge ~150 MB, buffer ~600 MB → **~3.9/4 GB = 98%**. Al limite. Per smoke 1–2 settimane OK; per job hunt continuativo 8GB.

**GDPR.** Tutti i provider EU listati sono coperti. Per VPS USA evitare AWS/GCP/DO se i candidati che JHT analizza sono EU residents.

**Network.** Tutti offrono 20+ TB/mese. JHT consuma ~5 GB/mese → non serve cercare "unlimited".

**Backup.** Hetzner Backup €1.10/mo, OVHcloud incluso. Per JHT lo stato persistente sta su `~/.jht/` host-side: **Hetzner snapshot manuale (~€1/mo)** abilita il flow "Snapshot + delete server" per ferie/freeze (vedi lifecycle sotto).

### Provider deep-dive

**🇩🇪 Hetzner Cloud** — scelto. Hardware AMD EPYC nuovo (CPX line), console pulita, API documentata, DC Norimberga/Falkenstein/Helsinki. Riferimento per `[JHT-CLOUD-04]`. Evitare CX line ("Limited availability").

**🇩🇪 Netcup** — best alternative. VPS 500 G12 (€5.91, 4GB DDR5 ECC), VPS 1000 G12 (€10.37, 8GB). DDR5 con ECC server-grade. API meno ricca di Hetzner (un adapter Netcup è più costoso da scrivere).

**🇩🇪 Contabo** — ❌ evitare. Prezzo apparente €4/mo per 8GB+4vCPU sembra deal del secolo ma CPU oversold 4-6x, contratto 12 mesi vincolante. Bridge calibration **non funziona**.

**🇫🇷 OVHcloud** — interessante per backup giornaliero incluso, performance mediocri vs Hetzner/Netcup.

**🇫🇷 V6Node** — ❌ skip. Niente IPv4 dedicato by default, `install.sh` non funziona out-of-the-box.

### Decision matrix utente

```
                                 ┌──────────────────────────────┐
                                 │  Prezzo o stabilità?         │
                                 └──────────────┬───────────────┘
                                                │
                       ┌────────────────────────┴────────────────────────┐
                       │                                                  │
                       ▼                                                  ▼
              "Test 1-2 settimane"                              "Job hunt 1-3 mesi continuativi"
                       │                                                  │
                       ▼                                                  ▼
              Netcup VPS 500 G12  €5.91/mo                       Netcup VPS 1000 G12  €10.37/mo
              o Hetzner CPX22  €9.75/mo (familiarity)            o Hetzner CPX32  €17.07/mo
                                                                  o OVHcloud VPS-2 ~€10 (backup incluso)

              Evitare: Contabo (oversold), V6Node (no IPv4), Hetzner CX (limited avail).
```

---

## 🧰 Install + wizard UX — punch list aperta

> Origine: test "utente nuovo" su VPS Hetzner fresca (Ubuntu 24.04, 2026-05-12). Tutti i 🔴 P0 install/wizard/pairing risolti (vedi git log `scripts/install.sh`, `scripts/jht-wrapper.sh`, `scripts/host-setup.sh`). Resta aperta la punch list sotto.

### 🟠 P1 — `jht` senza argomenti ha doppio comportamento
**Stato**: `jht` nudo fa `jht up` implicito (pull 500 MB) + stampa help. Effetto collaterale invisibile.
**Fix**: separare `jht` (no args) = solo help, no side-effect; `jht up` = pull + start esplicito; `jht setup` = up + wizard con messaggio "avvio container al primo run".
**File**: `scripts/jht-wrapper.sh` dispatcher.

### 🟡 P2 — "Allineo owner di /root/.jht a 1001:1001..."
Messaggio criptico. Fix: silenzioso o contestualizzato "▸ Imposto permessi cartelle host per container non-root (sicurezza)... ✓".
**File**: `scripts/jht-wrapper.sh` chown logic.

### 🟡 P2 — Manca conferma "✓ Tutto pronto" finale
Dopo `jht up` esplicito, stampare blocco verde `✓ Container jht avviato (...) ▸ Prossimo: jht setup`.
**File**: `scripts/jht-wrapper.sh` finale di `up`.

### 🟢 P3 — Disinstall incompleto
Manca cancellazione di `/root/.jht/{config,db,allegati,agents}` e `~/Documents/JHT/`. Fix: due varianti (mantiene dati / wipe completo). Rispetta `feedback_no_user_data_wipe.md`.
**File**: `scripts/install.sh::final_message()`.

### 🟢 P3 — Tipografia minore
`runtime:/root/.jht/runtime` → manca spazio dopo `runtime:` nella banner.

### 🟠 P1 — Wizard step 1, testo opzioni host poco esplicativo
"Server remoto / VPS" + "Computer locale" non spiega perché la scelta conta. Fix: testo lungo che spiega "il tuo PC accessibile in rete locale" vs "server cloud raggiungibile via IP pubblico, servono passi extra".
**File**: `scripts/host-setup.sh:81-89`.

---

## ⏸️ Lifecycle e shutdown UX: 3 livelli

> **Stato implementazione (merge dev1, commit `5a628426` + `d705434f`)**: i 3 endpoint Hetzner sono live in `web/app/api/vps/{pause,snapshot-destroy,terminate}/route.ts` (con `web/lib/hetzner.ts` come client), e il componente `VpsLifecycleCard.tsx` è renderato in cima alla dashboard solo quando `JHT_HOST_TYPE='vps'` (in Local PC mode i 3 bottoni non avrebbero senso). Backup dati locale pre-terminate ancora da cablare lato UI (l'endpoint c'è).

Hetzner ha una **trappola di billing**: server *powered off* **continuano a fatturare** (risorse allocate). Per risparmiare davvero serve `snapshot + delete`. Il launcher deve nascondere questa complessità in 3 bottoni:

```
┌─────────────────────────────────────────────────────────────┐
│  ⏸️  PAUSA TEAM                                              │
│     • Cosa fa:  docker stop jht (container fermo, VPS up)   │
│     • Costo:    €4.50/mese (continui a pagare la VPS)       │
│     • Riprendi: 5 secondi, 1 click                          │
│     • Quando:   "oggi non lavoro, riprendo domani"          │
├─────────────────────────────────────────────────────────────┤
│  📸 SNAPSHOT + ELIMINA VPS                                   │
│     • Cosa fa:  backup snapshot, distrugge il server         │
│     • Costo:    ~€0.10/mese (solo storage snapshot)         │
│     • Riprendi: 90s (ricrea VPS da snapshot)                │
│     • Quando:   "vacanza 2 settimane, ferie, freeze"        │
├─────────────────────────────────────────────────────────────┤
│  💀 TERMINA VPS                                              │
│     • Cosa fa:  backup dati locale + distruggi tutto         │
│     • Costo:    €0                                           │
│     • Riprendi: from scratch (rifai wizard)                 │
│     • Quando:   "ho trovato lavoro, fine job-hunt"          │
└─────────────────────────────────────────────────────────────┘
```

⚠️ Mai usare il termine "Spegni VPS": ambiguo. "Pausa team" = `docker stop` interno; "Snapshot+elimina" = `delete server` che ferma la fattura.

### Quando serve davvero SSH

| Fase                   | Serve SSH?              | Per fare cosa |
|------------------------|-------------------------|---------------|
| Provisioning iniziale  | ✅ sì (chiave effimera) | tail log install, verifica container, setup tailscale |
| Runtime quotidiano     | ❌ no                    | tutto via tailscale (HTTP, API team, Telegram) |
| Update container       | 🟡 forse                | `docker pull` triggerato via team API su tailscale, niente SSH |
| Debug power-user       | 🟢 opzionale            | bottone "Apri terminale" → re-inietta key temp via Hetzner API |

L'utente medio non vede mai il termine "SSH".

---

## 🔐 Login launcher + recovery cross-device

VPS mode richiede **signed-in mode** (Local PC mode resta in guest mode disponibile sempre):

```
┌────────────────────────────────────────────────────────┐
│  🔓 GUEST MODE  (resta sempre disponibile)              │
│     • Setup locale, niente account                     │
│     • PC locale only — niente VPS, niente sync         │
├────────────────────────────────────────────────────────┤
│  🔐 SIGNED-IN MODE  (necessario per VPS)                │
│     • OAuth Google/GitHub via launcher                 │
│     • Apre browser di sistema, callback a localhost    │
│     • Token Supabase salvato in OS keychain            │
│     • Sblocca: cloud sync, VPS recovery, multi-device  │
└────────────────────────────────────────────────────────┘
```

### Cosa va nel cloud, cosa resta locale

Principio: **limitare il blast radius**. Se Supabase viene violato, l'attaccante NON deve poter (1) creare server fatturati sulla carta dell'utente, (2) accedere ai dati locali della VPS direttamente.

```
┌────────────────────────────────────────────────────────────────┐
│  ☁️  CLOUD (Supabase, cifrato user-side con passphrase)         │
│  ✅ profilo + preferenze                                        │
│  ✅ VPS metadata (provider, IP, region, snapshot ID, tailnet)   │
│  ✅ Tailscale auth-key (cifrato con passphrase utente)          │
│  ❌ Hetzner API token                ← NON sincronizzato        │
│  ❌ chiavi SSH                       ← NON sincronizzate (effimere) │
├────────────────────────────────────────────────────────────────┤
│  🖥️  LOCAL  (OS keychain, mai esce dal PC)                      │
│  ✅ Hetzner API token (master key)                              │
│  ✅ token Supabase session                                      │
│  ✅ Tailscale auth-key (decifrato in memoria)                   │
└────────────────────────────────────────────────────────────────┘
```

**Perché Hetzner token NON va nel cloud**: è la master key che permette di creare server e fatturare sulla carta. Se Supabase viene compromesso, attaccante potrebbe spawnare €€€ di server. La filosofia "AI on the side of workers" pretende che le credenziali con potere di spesa restino sempre lato utente.

### Flusso recovery su nuovo PC

```
1. Install launcher su laptop B → Sign in OAuth → session token in keychain
2. Pull config cifrata da Supabase
3. User inserisce passphrase di recovery (mostrata 1 volta al setup iniziale)
4. Config decifrata → "hai una VPS Hetzner @ 5.6.7.8"
5. User re-incolla Hetzner API token
   ├─ in 1Password/Bitwarden? 30 secondi
   └─ perso? 2 min: console.hetzner.cloud → Security → New Token
6. Launcher: lista server (conferma VPS), inietta SSH key effimera, riconfigura Tailscale
7. ✅ Dashboard riconnessa, VPS NON ricreata, niente dato perso
```

Punto critico = passo 5: l'utente DEVE avere accesso al suo account Hetzner. È il "qualcosa che possiedi" della 2FA implicita — non possiamo recuperarlo per lui.

---

## 🔧 Cosa cambia in `install.sh`

### Prima (Docker-mode rotto)
1. detect OS + pkg manager
2. install docker
3. `docker pull <image>`
4. write wrapper: `docker run --rm <image> "$@"`     ← rotto per lifecycle
5. invita a `jht setup`

### Dopo (Docker-mode ridisegnato)
1. detect OS + pkg manager
2. install docker
3. `mkdir -p ~/.jht/runtime`
4. `curl -o ~/.jht/runtime/docker-compose.yml https://raw.githubusercontent.com/leopu00/jht/master/docker-compose.yml`
5. `curl -o ~/.local/bin/jht https://raw.githubusercontent.com/leopu00/jht/master/scripts/jht-wrapper.sh` + `chmod +x`
6. `jht up` (compose pull + start container long-running)
7. `jht setup` (wizard via docker exec)

Niente `docker pull` esplicito (lo fa compose). Niente clone repo. Wrapper e compose versionati nel repo, scaricati raw da GitHub.

### `--no-docker` mode resta intatto
Path "expert" per chi vuole girare nativo: clone repo + Node + tmux + provider CLI manuali. Duplicazione voluta: i due path servono utenti diversi.

---

## 📁 Cosa cambia nel codice del CLI Node

| File                                       | Cambio                                                                  |
|--------------------------------------------|--------------------------------------------------------------------------|
| `cli/bin/jht.js`                           | Rinominato → `cli/bin/main.js`                                          |
| `cli/utils/container-proxy.js`             | **Eliminato** (~152 righe)                                              |
| `cli/src/commands/team.js`                 | `tmux ...` diretto, non più `execInContainer`                          |
| `cli/src/commands/container.js`            | Spostato sul wrapper bash; sotto-comando `status` resta in Node read-only |
| `cli/src/commands/sentinella.js`           | `tmux capture-pane` diretto                                             |
| `Dockerfile`                               | Alias `jht=node /app/cli/bin/main.js` in `/etc/profile.d/jht.sh`        |
| `docker-compose.yml`                       | Rimuovere `build:`; aggiungere `restart: unless-stopped`; risolvere `${HOME}` cross-platform |
| `scripts/install.sh`                       | Vedi sopra                                                              |
| `scripts/jht-wrapper.sh`                   | **Nuovo file**                                                          |

File che NON cambiano: `setup`, `providers`, `sentinella`, `positions`, `shared/skills/`, `agents/`, `web/`, monitoring V6.

---

## 🔐 Setup wizard decisions (lockate 2026-05-13)

5 sub-decisioni del Tema B (open-questions doc) chiuse il 2026-05-13.

### 1. Hetzner API token → **NON USATO**

L'app non automatizza la creazione VPS via Hetzner Cloud API.
Flow lockato:
- Utente apre portale Hetzner manualmente, crea VPS
- App genera SSH keypair (no API token Hetzner necessario)
- Utente paste pubkey JHT su Hetzner durante creazione VPS
- Utente copia IP e lo paste nell'app
- App fa SSH con la sua chiave → `curl install.sh | bash`

**Why**: meno superficie (no token con potere di spendere soldi), UX accettabile (2 click extra), flow universale (vale per qualsiasi provider, non solo Hetzner).

### 2. SSH key → **una sola JHT key**

Una sola chiave per l'utente (non una per VPS).

**Regola fondamentale invariante**: **un solo team JHT per utente alla volta**. Non si supporta multi-VPS contemporanea (rompe coerenza db/sync). Quindi N=1 → una sola chiave basta.

### 3. SSH passphrase → **opzionale, scelta utente**

- Default: no passphrase
- Se utente la setta: app la salva nel keychain OS → utente non la digita più
- Trade-off lo gestisce l'utente in autonomia

### 4. Identità unificata Supabase → **pairing token via app**

Il token Supabase OAuth dell'app desktop = identità unica per **app + dashboard cloud + VPS pairing**.

**Flow lockato**:
1. App ha già la session Supabase dell'utente
2. App genera un "pairing token" derivato dalla session
3. App passa il pairing token a `install.sh` come parametro
4. La VPS usa il pairing token per dichiararsi a Supabase come device dell'utente

**Risultato**: l'utente fa OAuth Supabase **una sola volta** nell'app, niente `jht cloud login` interattivo da rifare dentro la VPS.

**Stato (aggiornato 2026-05-13 sera)**: ✅ tutto cablato.
- `[JHT-DESKTOP-LOGIN]` + `[JHT-DESKTOP-SYNC]` lato app: già fatto in dev1.
- `scripts/install.sh --pairing-token <token>`: implementato (commit `43d94016`, righe 95/105/767/854). Skip wizard interattivo, salva token in `~/.jht/.pairing-token` con perms 0600.
- App desktop genera pairing token dalla session Supabase + SSH keypair + runInstall remoto (commit `b0dfdda9/23a140cb/32a51766`).
- CLI `jht cloud pair --token <t>` + endpoint Supabase `POST /api/cloud-sync/device-register`: implementati (merge dev2, commits `61a544aa/a4112d10/bae27059`).

### 5. Rollout strategy → **B3 desktop diretto anche per beta 0**

Path B1 (Leone-assisted SSH) **scartato**.

| Fase | Path | Note |
|------|------|------|
| Beta 0 (ora) | **B3 — Desktop app full** | Anche i primi beta tester usano la desktop app |
| Beta 1+ | **B2 — CLI assistita** | Path per AI agent (Claude Code, OpenClaw, ecc.) — utente lascia che il suo agente guidi il setup via `jht` CLI |

Path B1 (Leone fa SSH per l'utente) lascia spazio: l'app deve essere già abbastanza buona da bastare ai primi beta tester senza hand-holding 1-a-1.

---

## 🔧 Decisioni tecniche lockate (2026-05-13)

### 1. `docker-compose.yml` location → `raw.githubusercontent`
Scaricato da `https://raw.githubusercontent.com/leopu00/job-hunter-team/master/docker-compose.yml` in `~/.jht/runtime/`. Install.sh resta compatto, compose evolve con master, niente clone repo.

### 2. `build:` nel compose pubblico → due file separati
- `docker-compose.yml` — image-only, per utenti. Niente `build:` (fallirebbe su VPS senza source).
- `docker-compose.dev.yml` — overlay con `build:` per dev: `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build`.

### 3a. `${HOME}` cross-platform nei bind mount → wrapper converte
Il wrapper bash (`scripts/jht-wrapper.sh`) converte `${HOME}` in path host-correct e lo espone come env `JHT_HOST_HOME`. Compose usa `${JHT_HOST_HOME}/.jht`.
Regola: il root `docker-compose.yml` va lanciato da **git-bash/PowerShell Windows, non da WSL** (vedi `feedback_compose_from_windows_shell`). Wrapper enforça la shell corretta.

### 3b. Path utente → `~/Documents/JHT/` ovunque
Niente più `~/Documents/Job Hunter Team/` con spazi (rompe Linux root, brutto in cli). Default `~/Documents/JHT/`; override via `JHT_USER_DIR` env.
Migrazione one-shot al primo `jht up` post-upgrade: se `~/Documents/Job Hunter Team/` esiste, `mv` automatico con backup.

### 4. Update flow `jht upgrade`
- `docker compose pull && up -d` → **sempre**
- Refresh `docker-compose.yml` + wrapper bash → solo con flag `--refresh-config`

L'utente che vuole "tutto fresco" digita `jht upgrade --refresh-config`. Conservative default (no surprise updates).

### 5. `jht setup` first-run → auto-up
Se il container non gira al momento di `jht setup`, il wrapper fa automaticamente `docker compose up -d` prima del `docker exec`. Pattern di `gh`, `kubectl`, ecc. (lazy provisioning). L'utente non incontra mai "container 'jht' non attivo".

### 6. Tunnel app↔VPS per dashboard → SSH tunnel via desktop app
**Scelta lockata**: SSH tunnel gestito dalla desktop app, sopra il canale SSH già aperto per provisioning.

Flow:
- Utente clicca "Open Dashboard" nell'app
- App apre `ssh -L 3000:localhost:3000 root@<vps-ip>` con la sua keypair
- App apre il browser su `http://localhost:3000`

**Why**:
- ✅ Local-first puro: nessuna dipendenza 3rd-party (no Tailscale US, no WireGuard self-managed code)
- ✅ Riusa il canale SSH già aperto per provisioning + provider login
- ✅ Niente account separato da configurare per l'utente
- 🔴 Trade-off: la desktop app deve essere aperta per accedere alla dashboard (per il quotidiano c'è già Telegram = canale principale)

**Tailscale come opt-in advanced mode in v1+** se arriva l'esigenza "dashboard dal telefono mentre sono in giro" da casi reali beta. WireGuard self-managed scartato (costo > beneficio).

### 7. Multi-VPS → **NO**
Locked da `project_team_location_exclusive`: un solo team JHT per utente alla volta, multi-VPS contemporanea rompe coerenza db/sync. Out of scope v1+.

### 8. Auto-shutdown "I got hired" → defer post-beta
UX feature non bloccante. Per il beta basta il bottone **"📸 Snapshot + Elimina VPS"** già nel lifecycle 3-livelli (sezione "Lifecycle e shutdown UX" sopra). In v1+, considera bottone "I got hired, terminate VPS" con conferma + backup locale automatico pre-destroy.

---

## 🚧 Verità scomoda

Anche con la migliore UX, il VPS resta intrinsecamente più complesso del PC locale. L'utente DEVE comunque:
- scegliere un provider
- creare un account
- mettere una carta di credito
- creare la VPS sul portale Hetzner (con tutorial inline nell'app)

Per chi non vuole NIENTE di tutto questo c'è il PC locale (Mode 1) o il PC dedicato in casa (Mode 2). **Il VPS è per "non sono uno smanettone, ma sono motivato e disposto a 30 minuti di setup guidato"** — non per il completo principiante.

Decision tree onesto (`docs/guides/VPS-COMPARISON.md`):

```
Hai un PC vecchio in casa?              → Mode 2 (PC dedicato)
Vuoi pagare €5/mese e dimenticartene?   → Mode 3 (VPS), 30min setup guidato
Vuoi zero pensieri / setup?             → Mode 1 (PC locale, ma deve restare on)
```

---

## 📋 Sequenza implementazione

1. **Spike wrapper bash** (~3-4 ore) — `scripts/jht-wrapper.sh`, test su WSL Ubuntu (`jht up`, `setup`, `team start`, `logs`, `down`)
2. **Refactor CLI Node** (~1 giorno) — rimozione `container-proxy.js`, rinomina `cli/bin/jht.js` → `main.js`
3. **`install.sh` ridisegno** (~2 ore) — Docker-mode senza clone repo, `--no-docker` invariato
4. **Compose dual-file** (~1 ora) — `docker-compose.yml` + `docker-compose.dev.yml`
5. **Smoke test VPS** (~3 ore, copre `[JHT-VPS-VALIDATE]`) — Hetzner CPX21/CPX22, end-to-end fino a web :3000 via SSH tunnel
6. **Wrapper PowerShell + Desktop launcher refit** (Phase 2) — `jht.ps1` per Windows, Electron chiama compose/exec senza Node embedded
7. **`docs/guides/VPS-COMPARISON.md`** — decision tree onesto

### Punch list per il launcher come "strumento primario"
- `[JHT-DESKTOP-LOGIN]` OAuth Google/GitHub via Supabase
- `[JHT-DESKTOP-SYNC]` Cloud sync cifrato user-side di config + VPS metadata
- `[JHT-DESKTOP-RECOVERY]` Recovery passphrase + decryption flow
- ~~`[JHT-DESKTOP-RECLAIM]`~~ — ❌ annullata 2026-05-13: cambio PC = wipe + ricreate via wizard standard, cloud sync re-seeda i dati (vedi `onboarding-flow.md`)
- `[JHT-DESKTOP-ERRORS]` Error handling friendly (no stack trace ai non-tech)
- `[JHT-DESKTOP-HELP]` Help/FAQ embedded
- `[JHT-DESKTOP-05]` auto-update (oggi LOW, promuovere a HIGH pre-launch)
- Tray icon + native notifications

---

## ⚠️ Rischi e mitigazioni

| Rischio                                                      | Mitigazione |
|--------------------------------------------------------------|-------------|
| Refactor `container-proxy.js` rompe path "from source"        | Mantenere proxy come fallback se `IS_CONTAINER` env non settata |
| `docker exec -it` su comandi non-interattivi (`jht status`)  | Detect `tty -s` nel wrapper, droppare `-it` senza terminale |
| Cambio default path utente rompe installs esistenti          | Migrazione one-shot al primo `jht up` post-upgrade |
| Wrapper bash su Windows nativo non gira                      | `jht.ps1` separato, documentare in quickstart |

---

## 🔗 Riferimenti

- `BACKLOG.md` § PHASE 1 `[JHT-VPS-VALIDATE]`, `[JHT-VPS-COMPARISON-DOC]`
- `BACKLOG.md` § PHASE 3 `[JHT-CLOUD-01..06]`, `[JHT-VPS-FRIENDLY]`, `[JHT-DESKTOP-*]`
- `docs/about/VISION.md` — target setup VPS
- `docs/security/04-threat-model.md` — perché socket-mount è inaccettabile
- `docs/internal/2026-05-01-bridge-and-token-monitoring.md` — CPU stabile per calibration
- `scripts/install.sh`, `cli/utils/container-proxy.js`, `docker-compose.yml`

### Sources providers (2026-05-06)
- [Hetzner Cloud pricing](https://www.hetzner.com/cloud/)
- [Netcup VPS plans](https://www.netcup.com/en/server/vps)
- [Contabo Cloud VPS](https://contabo.com/en/vps/)
- [OVHcloud VPS](https://www.ovhcloud.com/en/vps/)
- [VPSBenchmarks Contabo vs Netcup](https://www.vpsbenchmarks.com/compare/contabo_vs_netcup)
