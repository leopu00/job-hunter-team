# ☁️ JHT su VPS — design, providers, install UX

**Doc consolidato il 2026-05-13** unificando:
- `2026-05-04-vps-deployment-design.md` — design UX deployment + lifecycle + login/recovery
- `2026-05-06-host-container-split.md` — refactor host/container CLI (decisione tecnica)
- `2026-05-06-vps-providers-research.md` — research prezzi providers
- `2026-05-12-vps-fresh-install-ux-fixes.md` — punch list UX fresh install

(I 4 file sono stati assorbiti qui e rimossi dal repo: sono provenienza storica, non percorsi da aprire.)

> Quando i 4 doc divergono, vince la decisione più recente. Le date in testa a ogni sezione tracciano la freschezza.
>
> **Revisione 2026-07-30**: «Architettura» (con «Host/container split» e «Ruolo del launcher») è stata riscritta sulla topologia del **2026-07-23**; le note di stato falsificate dal codice sono state corrette e datate. Tutto il resto conserva la data originale — la regola sopra vale **sezione per sezione**: una sezione datata 2026-05-13 va letta come la decisione di allora, non come lo stato di oggi.

---

## 🎯 TL;DR

VPS è la modalità ⭐ **target setup** della vision JHT (€5–10/mese, sempre on, zero impatto sul PC).
Oggi è un second-class citizen (richiede SSH + comandi Linux), domani deve essere un **wizard nel desktop launcher** con `paste API token Hetzner → wait 90s → done`.

Stato 2026-05-13:
- 🥉 **Tier tech** (SSH manuale + `curl install.sh | bash`) → funziona, P0 fix applicati su `dev1`
- 🥈 **Tier power-user** (CLI `jht vps setup`) → roadmap, dipende da `[JHT-CLOUD-04]`
- 🥇 **Tier non-tech** (desktop wizard full) → target v1 GA, dipende da `[JHT-VPS-FRIENDLY]`

I 3 tier **coesistono**: la VPS provisionata da uno qualsiasi resta identica (stesso `install.sh`, stesso wizard, stesso pairing).

### T-002 endpoint controller — preflight 2026-08-05

Esito read-only: **NO-GO**. Il motore Docker del controller risponde, ma al
momento della sonda non erano attivi né il listener SSH standard né il
container `jht`. Non sono stati letti o scritti endpoint, chiavi, file di
configurazione o host key.

Per il canale desktop → controller usato dal backend SSH servono tutti questi
prerequisiti prima del canary: listener SSH limitato alla rete privata sulla
porta standard, chiave dedicata leggibile dal client, fingerprint ed25519
pinning con `StrictHostKeyChecking=yes`, e container `jht` in stato `running`.
Un endpoint controller non-VPS è supportato dal contratto di trasporto; non
richiede una patch al gioco. La verifica ThinkPad → controller va rieseguita
solo dopo il provisioning riservato da ops e non può esporre coordinate o
materiale crittografico.

---

## 🏗️ Architettura

> **Sezione riscritta il 2026-07-30** sulla topologia in vigore dal **2026-07-23** (ritiro della dashboard web locale; `[JHT-DESKTOP-07]` chiuso per superamento).
> La versione precedente — «su VPS la web app gira SULLA VPS», browser su `jht-vps:3000` via Tailscale magic DNS — è **superata e falsa**: nessun componente si comporta più così, e Tailscale non compare in nessun file di codice.

### Il container non serve HTTP

Il container `jht` esegue `pid1` (`command: ["pid1"]` in `docker-compose.yml`) che, in base a `JHT_HOST_TYPE`, avvia:

| `JHT_HOST_TYPE`      | Cosa gira dentro il container |
|----------------------|--------------------------------|
| `vps` + cloud paired | cloud daemon (push verso `jobhunterteam.ai` ogni ~30s) + bridges |
| `vps` senza cloud    | solo bridges; un watcher su `$JHT_HOME/cloud.json` accende il daemon appena il pairing è completo, senza `jht down && jht up` |
| `local`              | bridges + watchdog |

**Niente Next.js, in nessuna modalità.** Riscontro riproducibile (verificato 2026-07-30):

- `grep -n "next start\|next dev" Dockerfile cli/src/commands/pid1.js` → **zero righe**
- nessuna `EXPOSE` nel `Dockerfile`, nessuna chiave `ports:` né in `docker-compose.yml` né in `docker-compose.dev.yml`
- `web/` **non è installato nell'immagine** (commento in `Dockerfile`, sezione build)

Il container non ha porte in ascolto: è un **client uscente** in entrambe le direzioni (HTTPS push + WebSocket Supabase Realtime). Da qui la proprietà che conta per l'ops: **una VPS JHT non richiede nessuna porta inbound aperta oltre a SSH.**

### I due piani di interazione

L'interazione operativa vive nell'**app desktop nativa** (il gioco Godot in `game/`), che parla al container per **argv `docker`**, mai attraverso una shell dell'host e mai via HTTP. Il browser serve **solo il piano cloud**, in sola lettura.

```
LOCAL PC MODE                              VPS MODE
═════════════                              ════════

USER PC                                    USER PC
├── 🎮 app desktop Godot                   ├── 🎮 app desktop Godot
│     └─ LocalBackend                      │     └─ VpsBackend
│        docker exec jht ...               │        ssh -i <key> <user>@<ip>
│        (argv diretti, mai shell host)    │           docker exec jht ...
└── 🐳 container jht                       │
      └─ pid1: bridges + watchdog          │ ── SSH (chiave, StrictHostKeyChecking=yes,
                                           │         known_hosts per-host) ──►
                                           │
                                           VPS
                                           └── 🐳 container jht
                                                 └─ pid1: cloud daemon + bridges

─── identico nei due modi ─────────────────────────────────────────────

🌐 Browser ───► jobhunterteam.ai (Vercel + Supabase) — SOLA LETTURA, con login
                        ▲
                        └── push USCENTE dal container (HTTPS + Supabase Realtime WS)
```

**Il browser non raggiunge mai il container**, né in locale né su VPS: legge Supabase, che il container alimenta da fuori. Nessuna route web compone verso una VPS.

**Cosa cambia nel codice fra i due modi**: solo il trasporto. `LocalBackend` estende `VpsBackend` e ne riusa comandi e parser, sostituendo `ssh … docker exec` con `docker` locale. La logica di dominio è una sola.

**Cosa NON deve mai succedere** (invariante confermata dalla migrazione, non superata da essa):

- ❌ un server HTTP dentro al container, o una porta pubblicata dal compose
- ❌ una porta inbound sulla VPS oltre a SSH
- ❌ una route del sito cloud che dialoga con una VPS: la direzione è sempre container → cloud

`jht dashboard` resta registrato ma è **deprecato dal 2026-07-23**: non apre nessuna URL, stampa dove sono finite le cose ed esce 0.

### Host/container split del CLI `jht` (decisione 2026-05-06, verificata 2026-07-30)

**La decisione regge**: wrapper bash sull'host + container long-running, socket Docker mai montato dentro. Quello che segue è aggiornato ai path reali; le parti del piano originale che non sono mai atterrate sono tracciate nella tabella «Cosa cambia nel codice del CLI Node».

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
│         └─→ docker exec -it jht node /app/cli/bin/jht.js <args>     │
│                                                                     │
│  ~/.jht/runtime/docker-compose.yml  ← scaricato da install.sh       │
│  /var/run/docker.sock               ← parlato dal wrapper, MAI montato dentro │
└──────────────────────────────────┬──────────────────────────────────┘
                                   │ docker exec
                                   ▼
┌──────────── CONTAINER `jht` (long-running, restart: unless-stopped) ┐
│  /app/cli/bin/jht.js  ← CLI Node (entry `pid1` come CMD del compose)│
│   └─ wizard, agents, db, tmux, sentinella, bridges, cloud daemon    │
│      (nessun server HTTP: vedi "Il container non serve HTTP")       │
│  Bind-mount:                                                        │
│   ~/.jht  ↔  /jht_home   (config, db, profile)                      │
│   ~/Documents/Job Hunter Team  ↔  /jht_user  (CV, allegati, output) │
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
| `jht setup`      | `docker exec -it jht node /app/cli/bin/jht.js setup`               |
| `jht team start` | `docker exec -it jht node /app/cli/bin/jht.js team start`          |
| `jht doctor`     | `docker exec -it jht node /app/cli/bin/jht.js doctor`              |
| ...              | ... (tutto il resto delegato al CLI Node nel container)            |

**Auto-up**: se il container non gira, il wrapper fa `compose up -d` automaticamente prima del `docker exec`. L'utente non incontra mai "container 'jht' non attivo".

### Ruolo del launcher: runtime host vs lifecycle controller

> Tabella riscritta il **2026-07-30**. Il «launcher» oggi è l'app desktop Godot (`game/`); le righe su web app, dashboard `:3000` e Tailscale descrivevano la topologia ritirata il 23/07.

| Funzione                    | Local PC mode                      | VPS mode                                              |
|-----------------------------|------------------------------------|-------------------------------------------------------|
| Provisioning VPS            | n/a                                | l'utente crea la VPS sul portale; l'app fa SSH + `install.sh` (**nessuna API provider**, vedi «Setup wizard decisions» § 1) |
| Provisioning container      | `docker compose` via wrapper       | `install.sh` sulla VPS → wrapper + compose            |
| Start/stop container        | `docker compose` via wrapper       | `ssh … jht up/down`                                   |
| Interazione operativa       | app desktop → argv `docker`        | app desktop → `ssh … docker exec jht …`               |
| Terminale integrato         | `docker exec -it jht …`            | `ssh -tt … docker exec -it jht …`                     |
| Vista da browser / telefono | `jobhunterteam.ai` (cloud, sola lettura, con login) | idem — **mai** la VPS direttamente         |
| Snapshot / destroy          | n/a                                | console Hetzner, a mano (vedi «Lifecycle e shutdown UX») |

In VPS mode il launcher è **lifecycle controller**: dopo il setup iniziale può anche essere chiuso, la VPS continua a lavorare da sola e a pushare verso il cloud. È esattamente il motivo per cui il piano cloud esiste: è l'unica vista disponibile quando l'app desktop è chiusa.

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

### 🟠 P1 — Help post-install troppo lunga
**Stato**: ✅ risolto. Su una VPS fresca `jht --help` mostrava 30+ sotto-comandi, nascondendo i pochi che servono subito.
**Fix applicato**: `jht`, `jht --help` e `jht -h` stampano un `ESSENTIAL_HELP` di 5 comandi; la lista completa resta su `jht help`.
**File**: `cli/src/program.js` (costante `ESSENTIAL_HELP`) — ⚠️ il commento sopra la costante **punta a questa sezione**: rinominandola o spostandola, aggiornare anche lì.

### 🟠 P1 — Wizard step 1, testo opzioni host poco esplicativo
"Server remoto / VPS" + "Computer locale" non spiega perché la scelta conta. Fix: testo lungo che spiega "il tuo PC accessibile in rete locale" vs "server cloud raggiungibile via IP pubblico, servono passi extra".
**File**: `scripts/host-setup.sh:197-201` (il testo delle due opzioni; il range `81-89` citato nel 2026-05-12 oggi è il picker della lingua — riferimento aggiornato il 2026-07-30, senza ri-triage della voce).

---

## ⏸️ Lifecycle e shutdown UX: 3 livelli

> **Stato implementazione — aggiornato 2026-07-30: i 3 bottoni oggi NON esistono.**
> Erano stati cablati nel web (`web/app/api/vps/{pause,snapshot-destroy,terminate}/route.ts` + client `web/lib/hetzner.ts` + `VpsLifecycleCard.tsx`, merge dev1 `5a628426`/`d705434f`) e sono stati **rimossi** con il passaggio del web a sola lettura: `d8fd3088f` (2026-07-25, «remove the VPS lifecycle card with its routes»), `0d89a3d30` e `9bf6369a1` (2026-07-26). Quei quattro percorsi **non esistono più**: non cercarli.
> Oggi **nessun componente chiama l'API Hetzner** — coerente con «Setup wizard decisions § 1: Hetzner API token → NON USATO», che è la decisione più recente fra le due. Il design a 3 livelli qui sotto resta valido come design; l'esecuzione è manuale dalla console Hetzner. Ricablare i 3 bottoni oggi significherebbe metterli **nell'app desktop**, non nel web.

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

> Tabella riscritta il **2026-07-30**. La versione precedente dava Tailscale come trasporto del runtime quotidiano e SSH come eccezione: è l'opposto dello stato attuale. Tailscale non è mai stato implementato (zero occorrenze nel codice) e SSH è **il** canale.

| Fase                  | Serve SSH?           | Per fare cosa |
|-----------------------|----------------------|---------------|
| Provisioning iniziale | ✅ sì                 | `install.sh` sulla VPS, tail del log, verifica container |
| Runtime quotidiano    | ✅ sì, ma invisibile  | ogni azione dell'app desktop è `ssh -i <key> <user>@<ip> docker exec jht …` |
| Vista senza app aperta| ❌ no                 | con sync opt-in, `jobhunterteam.ai` mostra i dati supportati copiati dal container |
| Update container      | ✅ sì                 | `ssh … jht upgrade` (nessuna porta inbound su cui triggerare un update) |
| Debug power-user      | 🟢 opzionale         | terminale integrato nell'app: `ssh -tt … docker exec -it jht …` |

**Chiave, non password**: `BatchMode=yes`, `IdentitiesOnly=yes`, `StrictHostKeyChecking=yes` con un `known_hosts` per-host popolato una volta via `ssh-keyscan`. L'utente medio continua a non digitare mai il termine "SSH" — ma è SSH che regge tutto, non un overlay di rete.

---

> 🔗 **Per la vista consolidata "accesso macchina + dove vivono le credenziali" (3 modi × storage × LLM agent path)** → [`docs/internal/ops/access-and-credentials.md`](access-and-credentials.md). Questo file resta la fonte di verità architetturale; quello consolida la sezione credenziali con confronto doc vs codice e punch list.

## 🔐 Account web opzionale + recovery cross-device

> **Revisione 2026-08-12:** il principio (blast radius, credenziali di spesa
> sempre lato utente) resta valido. Tailscale e token API Hetzner citati dal
> design 2026-05 non fanno parte del flusso corrente: l'accesso alla VPS usa
> una chiave SSH. Anche l'account web è separato dal runtime e abilita solo le
> superfici cloud supportate.

Il runtime VPS funziona senza login web: l'app lo controlla via SSH e il wizard
CLI prosegue quando il pairing viene saltato o fallisce. Il login web resta un
opt-in separato, disponibile sia per PC locale sia per VPS:

```
┌────────────────────────────────────────────────────────┐
│  🔓 NON COLLEGATO (resta sempre disponibile)            │
│     • Setup locale oppure VPS via SSH, niente account  │
│     • Runtime completo, niente copia dati cloud        │
├────────────────────────────────────────────────────────┤
│  🔐 ACCOUNT WEB (facoltativo su ogni host)              │
│     • OAuth Google/GitHub via launcher                 │
│     • Apre browser di sistema, callback a localhost    │
│     • Token Supabase salvato in OS keychain            │
│     • Abilita: copia cloud, restore dei dati copiati,   │
│       vista multi-device                               │
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

Piano del **2026-05-06**, con l'esito reale a fianco (colonna verificata il **2026-07-30** sull'albero corrente). Due voci del piano non sono mai atterrate: leggere la colonna «Esito» prima di cercare un file.

| File (piano)                     | Cambio previsto                                                          | Esito verificato 2026-07-30 |
|----------------------------------|---------------------------------------------------------------------------|------------------------------|
| `cli/bin/jht.js`                 | Rinominato → `cli/bin/main.js`                                            | ❌ **mai fatto** — l'entry è tuttora `cli/bin/jht.js` (`/app/cli/bin/jht.js` nel container). `cli/bin/main.js` non esiste. |
| `cli/utils/container-proxy.js`   | **Eliminato** (~152 righe)                                                | ❌ **non eliminato, spostato** → `cli/src/utils/container-proxy.js` (141 righe). È il fallback previsto in «Rischi»: decide fra `docker exec` e esecuzione locale in base a `IS_CONTAINER`. |
| `cli/src/commands/team.js`        | `tmux ...` diretto, non più `execInContainer`                             | ✅ fatto; il comando è ora una **cartella**, `cli/src/commands/team/` (`index.js`, `start.js`, `stop.js`, `list.js`, `agents.js`, `chat.js`). |
| `cli/src/commands/container.js`   | Spostato sul wrapper bash; sotto-comando `status` resta in Node read-only | ✅ file presente al path indicato |
| `cli/src/commands/sentinella.js`  | `tmux capture-pane` diretto                                               | ✅ file presente al path indicato |
| `Dockerfile`                      | Alias `jht=node /app/cli/bin/main.js` in `/etc/profile.d/jht.sh`          | ❌ **mai fatto** — nessun `/etc/profile.d/jht.sh` nell'immagine; l'`ENTRYPOINT` è `/app/.launcher/entrypoint.sh` e il `CMD` del compose è `pid1`. |
| `docker-compose.yml`              | Rimuovere `build:`; aggiungere `restart: unless-stopped`; risolvere `${HOME}` cross-platform | ✅ fatto (`build:` vive nell'overlay `docker-compose.dev.yml`) |
| `scripts/install.sh`              | Vedi sopra                                                                | ✅ |
| `scripts/jht-wrapper.sh`          | **Nuovo file**                                                            | ✅ (+ `scripts/jht-wrapper.ps1` per Windows) |

File che NON cambiano: `setup`, `providers`, `sentinella`, `positions`, `shared/skills/`, `agents/`, monitoring V6. ⚠️ `web/` era in questa lista nel 2026-05-06: dal 2026-07-23 **non è più parte del runtime** (non installato nell'immagine, nessuna porta) ed è solo il piano cloud.

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

Path B1 (maintainer-assisted SSH) **scartato**.

| Fase | Path | Note |
|------|------|------|
| Beta 0 (ora) | **B3 — Desktop app full** | Anche i primi beta tester usano la desktop app |
| Beta 1+ | **B2 — CLI assistita** | Path per AI agent (Claude Code, OpenClaw, ecc.) — utente lascia che il suo agente guidi il setup via `jht` CLI |

Path B1 (maintainer fa SSH per l'utente) lascia spazio: l'app deve essere già abbastanza buona da bastare ai primi beta tester senza hand-holding 1-a-1.

---

## 🔧 Decisioni tecniche lockate (2026-05-13)

### 1. `docker-compose.yml` location → `raw.githubusercontent`
Scaricato da `https://raw.githubusercontent.com/leopu00/job-hunter-team/master/docker-compose.yml` in `~/.jht/runtime/`. Install.sh resta compatto, compose evolve con master, niente clone repo.

### 2. `build:` nel compose pubblico → due file separati
- `docker-compose.yml` — image-only, per utenti. Niente `build:` (fallirebbe su VPS senza source).
- `docker-compose.dev.yml` — overlay con `build:` per dev: `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build`.

### 3a. `${HOME}` cross-platform nei bind mount → wrapper converte
Il wrapper bash (`scripts/jht-wrapper.sh`) lancia compose con `--project-directory ~/.jht/runtime` e `MSYS_NO_PATHCONV=1`; il compose risolve **`${HOME}` direttamente** (`docker-compose.yml`, sezione `volumes:` → `${HOME}/.jht:/jht_home`).
Regola: il root `docker-compose.yml` va lanciato da **git-bash/PowerShell Windows, non da WSL** (vedi `feedback_compose_from_windows_shell`). Wrapper enforça la shell corretta.
> ⚠️ *Corretto il 2026-07-30*: la versione precedente parlava di una env `JHT_HOST_HOME` esposta dal wrapper e usata dal compose. **Non esiste in nessun file del repo** — mai implementata. Le override reali sono `JHT_HOME_HOST` / `JHT_USER_DIR_HOST` (usate dal wrapper per il chown dei bind mount) e `JHT_RUNTIME_DIR`.

### 3b. Path utente → ~~`~/Documents/JHT/` ovunque~~ → **`~/Documents/Job Hunter Team/`**
> ⚠️ *Corretto il 2026-07-30*: la decisione del 2026-05-13 (togliere gli spazi) **non è stata applicata e non è più lo stato del codice**. Il path reale, con gli spazi, è `~/Documents/Job Hunter Team/`: `docker-compose.yml` lo bind-monta su `/jht_user`, `cli/src/jht-paths.js` lo usa come default di `JHT_USER_DIR`, `scripts/jht-wrapper.sh` come default di `JHT_USER_DIR_HOST` e `scripts/install.sh` lo stampa all'utente. Override via env `JHT_USER_DIR`.
> Il razionale originale (gli spazi sono scomodi in CLI) resta valido, ma cambiarlo oggi è una migrazione di dati, non una decisione di naming: se si riapre, va riaperta come ticket.

### 4. Update flow `jht upgrade`
- `docker compose pull && up -d` → **sempre**
- Refresh `docker-compose.yml` + wrapper bash → solo con flag `--refresh-config`

L'utente che vuole "tutto fresco" digita `jht upgrade --refresh-config`. Conservative default (no surprise updates).

### 5. `jht setup` first-run → auto-up
Se il container non gira al momento di `jht setup`, il wrapper fa automaticamente `docker compose up -d` prima del `docker exec`. Pattern di `gh`, `kubectl`, ecc. (lazy provisioning). L'utente non incontra mai "container 'jht' non attivo".

### 6. Tunnel app↔VPS per dashboard → SSH tunnel via desktop app
> ⚠️ **Superata dal 2026-07-23** (verificato 2026-07-30): non essendoci più una dashboard su `:3000`, non c'è niente da tunnelare. Il port-forward non è mai stato implementato — `ssh -L` / `LocalForward` non compaiono in nessun file. Quello che è rimasto è la **premessa** della decisione, tuttora valida: l'app desktop riusa il canale SSH del provisioning, ma per eseguire `ssh … docker exec jht …`, non per inoltrare una porta. Il trade-off e il razionale sotto si leggono così.

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

Decision tree onesto (⚠️ `docs/guides/VPS-COMPARISON.md` non è mai stato scritto — vedi «Sequenza implementazione» § 7; questo blocco resta l'unica versione esistente):

```
Hai un PC vecchio in casa?              → Mode 2 (PC dedicato)
Vuoi pagare €5/mese e dimenticartene?   → Mode 3 (VPS), 30min setup guidato
Vuoi zero pensieri / setup?             → Mode 1 (PC locale, ma deve restare on)
```

---

## 📋 Sequenza implementazione

Piano del 2026-05-13; esito verificato il 2026-07-30.

1. ✅ **Spike wrapper bash** — `scripts/jht-wrapper.sh`, test su WSL Ubuntu (`jht up`, `setup`, `team start`, `logs`, `down`)
2. 🟡 **Refactor CLI Node** — fatto per `team`/`sentinella`; **non** la rimozione di `container-proxy.js` (vive in `cli/src/utils/`) né la rinomina di `cli/bin/jht.js`, entrambe abbandonate
3. ✅ **`install.sh` ridisegno** — Docker-mode senza clone repo, `--no-docker` invariato
4. ✅ **Compose dual-file** — `docker-compose.yml` + `docker-compose.dev.yml`
5. ✅ **Smoke test VPS** (copre `[JHT-VPS-VALIDATE]`) — Hetzner CPX21/CPX22. ⚠️ il criterio di allora («end-to-end fino a web :3000 via SSH tunnel») è **decaduto** dal 2026-07-23: oggi l'end-to-end è app desktop → `ssh … docker exec` → team attivo, più il push verso il cloud
6. ✅ **Wrapper PowerShell** — `scripts/jht-wrapper.ps1` (non `jht.ps1`). Il «Desktop launcher refit» Electron è decaduto: la desktop app è il gioco Godot
7. ❌ **`docs/guides/VPS-COMPARISON.md`** — mai creato. Le guide utente esistenti sono `docs/guides/VPS-SETUP.md` (path tech manuale) e `docs/guides/VPS-SETUP-WIZARD.md` (path dall'ufficio Godot); il decision tree onesto resta da scrivere

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
| Refactor `container-proxy.js` rompe path "from source"        | Mantenere proxy come fallback se `IS_CONTAINER` env non settata — ✅ è la mitigazione adottata: `cli/src/utils/container-proxy.js` è vivo e sceglie il trasporto in base a `IS_CONTAINER` |
| `docker exec -it` su comandi non-interattivi (`jht status`)  | Detect `tty -s` nel wrapper, droppare `-it` senza terminale |
| Cambio default path utente rompe installs esistenti          | Migrazione one-shot al primo `jht up` post-upgrade |
| Wrapper bash su Windows nativo non gira                      | wrapper separato, documentare in quickstart — ✅ adottata: `scripts/jht-wrapper.ps1` |

---

## 🔗 Riferimenti

- `BACKLOG.md` § PHASE 1 `[JHT-VPS-VALIDATE]`, `[JHT-VPS-COMPARISON-DOC]`
- `BACKLOG.md` § PHASE 3 `[JHT-CLOUD-01..06]`, `[JHT-VPS-FRIENDLY]`, `[JHT-DESKTOP-*]`
- `docs/about/VISION.md` — target setup VPS
- `docs/security/04-threat-model.md` — perché socket-mount è inaccettabile
- `docs/internal/_archive/2026-05-01-bridge-and-token-monitoring.md` — CPU stabile per calibration
- `scripts/install.sh`, `scripts/jht-wrapper.sh`, `cli/src/utils/container-proxy.js`, `docker-compose.yml`
- `cli/src/commands/pid1.js` — dispatcher PID 1 del container: la fonte di verità su **cosa gira davvero dentro** in ogni `JHT_HOST_TYPE`
- `game/scripts/backend/{backend_bus,vps_backend,local_backend}.gd` — trasporto app desktop → container (scelta adapter, `ssh … docker exec`, argv `docker`)

### Sources providers (2026-05-06)
- [Hetzner Cloud pricing](https://www.hetzner.com/cloud/)
- [Netcup VPS plans](https://www.netcup.com/en/server/vps)
- [Contabo Cloud VPS](https://contabo.com/en/vps/)
- [OVHcloud VPS](https://www.ovhcloud.com/en/vps/)
- [VPSBenchmarks Contabo vs Netcup](https://www.vpsbenchmarks.com/compare/contabo_vs_netcup)
