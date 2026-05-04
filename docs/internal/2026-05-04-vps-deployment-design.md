# 2026-05-04 — Design del deployment VPS: come fa l'utente a usare JHT su una macchina remota

## TL;DR

Il deployment su VPS deve passare dal **desktop launcher** che gestisce
provisioning + lifecycle automaticamente. Le credenziali del provider
(API token Hetzner) e le chiavi SSH stanno **solo sul PC dell'utente**:
mai nei nostri server (Vercel/Supabase), mai nel browser.

Risultato:
- 🥇 **non-tech user** → wizard nel launcher, 1 click + paste API token
- 🥈 **power user** → stessa wizard ma sa cosa sta facendo
- 🥉 **tech user** → SSH manuale + `curl install.sh | bash` (path attuale, per validazione)

I tre tier coesistono: il manuale non sparisce, ma non e' il default per
i non-tech. Il desktop wizard e' il **vero UX win di Phase 3**.

## Il problema

Il VPS (€4.5-5/mese su Hetzner CX22) e' la modalita' ⭐ "target setup"
nella vision di JHT: piu' economica del PC dedicato, niente impatto sul
PC dell'utente, sempre on. Ma oggi e' un second-class citizen: per usarla
serve SSH + comando Linux + tunnel manuale. Il target di JHT e' l'utente
NON tecnico (per quello esiste il desktop launcher) — quindi cosi' com'e'
escludiamo il target del prodotto dalla modalita' migliore.

## Le 3 strade considerate

### A) Manuale: utente fa SSH + lancia one-liner

```
1. user compra VPS, riceve root@1.2.3.4 + chiave SSH
2. user fa ssh root@1.2.3.4
3. user esegue curl https://jobhunterteam.ai/install.sh | bash
4. user apre tunnel ssh -L 3000:localhost:3000
5. user va su http://localhost:3000
```

**Pro:** zero codice nuovo, funziona oggi, JHT non vede nulla
**Contro:** richiede skill SSH + terminale + tunneling — taglia fuori il target

**Verdetto:** ok solo per validare che la pipeline funziona ([JHT-VPS-VALIDATE]).
Non puo' essere il path principale.

### B) Web pairing: token incollato nel browser

```
1. user genera token su jobhunterteam.ai/devices
2. user fa SSH, lancia install con token come arg
3. VPS phone-home a /api/devices/pair
4. browser vede device "online", manda comandi via API web
```

**Pro:** non serve installare il launcher
**Contro:**
- Comunicazione VPS↔browser passa SEMPRE da Vercel/Supabase
  (single point of failure, single point of attack)
- Se `jobhunterteam.ai` viene compromesso → tutte le VPS degli utenti
  potenzialmente accessibili in un colpo
- Pairing protocol da scrivere + manutenere
- User deve comunque fare SSH per il bootstrap (a meno di marketplace image)

**Verdetto:** scartato. Mette JHT come middleman, viola la vision
"AI on the side of workers" (nessuna SaaS centrale che vede i dati).

### C) Desktop launcher provisiona automaticamente ⭐

```
1. user nel launcher: "Dove vuoi che giri il team?"
   [Questo PC] [PC dedicato in casa] [VPS cloud]
2. user clicca VPS → wizard mostra:
   - "Hai un account Hetzner? [No → tutorial 2 min] [Si']"
   - "Crea un API token qui [link diretto al pannello Hetzner]"
   - "Incolla il token: [____]"     (token salvato in OS keychain locale)
3. launcher (locale, non noi) usa Hetzner API:
   - genera SSH keypair effimera (in-memory, mai salvata)
   - crea server CX22 in Helsinki/Falkenstein
   - inietta pubkey via Hetzner API
   - cloud-init: curl install.sh | bash
4. launcher fa SSH alla VPS appena creata (chiave effimera) per:
   - tail dei log dell'install
   - verificare che il container sia up
   - configurare Tailscale tailnet privato
5. launcher salva metadata locali (~/.jht/vps.json: provider, IP, tailnet name)
6. SSH key effimera viene scartata
7. da qui in poi: dashboard locale parla con la VPS via Tailscale
```

**Pro:**
- 🟢 API token Hetzner mai esce dal PC (OS keychain)
- 🟢 SSH key effimera, vita brevissima (provision phase only)
- 🟢 Niente surface attacco lato JHT (`jobhunterteam.ai` non sa
  nemmeno che esiste questa VPS)
- 🟢 UX: "scegli provider → incolla 1 token → aspetta 90s → fatto"
- 🟢 Tailscale tailnet = mesh privato, niente porte SSH/HTTP esposte
  pubblicamente
- 🟢 Stesso trust model del Local PC mode (user gia' si fida del
  launcher per il PC locale)

**Contro:**
- 🟡 Launcher deve girare sul PC durante setup iniziale e management
- 🟡 Cambio macchina utente → serve flusso "claim existing VPS"
  (leggere vps.json se sincronizzato via cloud sync, oppure re-pair
  con token rotation)
- 🟡 Implementazione adapter per provider (Hetzner first, poi DO/AWS/GCP)
- 🟡 Launcher deve embeddare libreria SSH (es. `node-ssh`) e Hetzner
  API client → +qualche MB

**Verdetto:** ⭐ pattern dominante. E' esattamente quello che
[JHT-CLOUD-04] (Hetzner adapter) + [JHT-CLOUD-05] (Cloud UI) gia'
prevedono in Phase 3 — solo che andava esplicitato che e' ANCHE la
soluzione UX-friendly per non-tech, non solo "cloud per tech-power-user".

## Architettura proposta

```
                     ┌──────────────────────────┐
                     │   USER PC                │
                     │                          │
                     │  Desktop Launcher        │
                     │  ┌────────────────────┐  │
                     │  │ OS Keychain        │  │
                     │  │  - Hetzner token   │  │
                     │  │  - Tailscale auth  │  │
                     │  └────────────────────┘  │
                     │                          │
                     │  Tailscale client        │
                     └────────┬─────────────────┘
                              │
                              │ Tailscale tailnet
                              │ (mesh WireGuard,
                              │  zero exposed ports)
                              │
                     ┌────────▼─────────────────┐
                     │   VPS (Hetzner CX22)     │
                     │                          │
                     │  Tailscale client        │
                     │  Docker + container JHT  │
                     │  └─ web :3000            │
                     │     api :3001            │
                     │     telegram bot         │
                     └──────────────────────────┘
```

**Cose che NON ci sono in questo schema:**
- ❌ Vercel / Supabase / `jobhunterteam.ai` come intermediari
- ❌ Porte SSH/HTTP pubbliche sulla VPS
- ❌ Credenziali nel browser
- ❌ Nostre chiavi master "magiche"

## Dove gira la web app: location-transparent code

Domanda critica scoperta durante il brainstorm: il bottone "Avvia team"
nella web `/team` page chiama `docker exec jht tmux send-keys ...`.
Funziona in Local PC mode perche' web app e container sono sullo stesso
host. **Su VPS dove gira la web app?**

Risposta: **la web app gira SULLA VPS, insieme al container**. Il browser
dell'utente la raggiunge via Tailscale.

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

**Cosa cambia nel codice:** ❌ niente. La web app fa sempre
`docker exec` sul daemon locale. Stesso codice, stessa logica, solo
host diverso.

**Cosa NON deve mai succedere:** web app sul PC + container sulla
VPS. Servirebbe SSH dal Next.js verso la VPS o Docker socket remoto:
piu' codice, piu' surface, complicazione inutile.

**Architectural payoff:** l'app e' "location-transparent". Stesso
container, stesso codice. Cambia solo l'host che il browser hitta.

## Ruolo del launcher: runtime host vs lifecycle controller

In Local PC mode il launcher e' anche **runtime host** (avvia il
container e la web app). In VPS mode il container e la web app girano
da soli sulla VPS — il launcher diventa **lifecycle controller**.

| Funzione                      | Local PC mode      | VPS mode             |
|-------------------------------|--------------------|----------------------|
| Provisioning container        | ✅ docker compose   | ✅ Hetzner API + cloud-init |
| Start/stop web app            | ✅ next dev locale  | ❌ gira su VPS, autonoma |
| Start/stop container          | ✅ docker compose   | ✅ via SSH? no — via API team su VPS |
| Apri browser dashboard        | ✅ localhost:3000   | ✅ jht-vps:3000 (tailscale) |
| Tailscale client              | ❌ non serve        | ✅ sempre attivo      |
| Snapshot / destroy            | ❌ non applicabile  | ✅ Hetzner API        |
| Update container              | ✅ docker pull      | ✅ via team API + SSH? |

Il launcher in VPS mode e' "leggero": un VPS controller + Tailscale
connector + bottone "apri browser sulla mia VPS". Dopo il setup
iniziale puo' anche essere chiuso — la VPS continua a lavorare da sola.

## Lifecycle e shutdown UX: tre livelli

Spegnere "il team" non e' un'azione singola. Hetzner ha una **trappola
di billing**: server powered off **continuano a fatturare** (le risorse
restano allocate). Per risparmiare davvero serve `snapshot + delete`.

Il launcher deve nascondere questa complessita' in 3 bottoni semplici:

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

⚠️ **Gotcha Hetzner:** "stop server" via API o pannello → la VPS resta
allocata e fatturata. Solo `delete server` ferma la fattura. Il launcher
deve usare il termine "Pausa team" per `docker stop` interno e
"Snapshot+elimina" per il delete vero, MAI "Spegni VPS" che sarebbe
ambiguo.

## Quando serve davvero SSH: provisioning vs runtime

| Fase                   | Serve SSH?              | Per fare cosa |
|------------------------|-------------------------|---------------|
| Provisioning iniziale  | ✅ si' (chiave effimera) | tail log install, verifica container, setup tailscale |
| Runtime quotidiano     | ❌ no                    | tutto via tailscale (HTTP, API team, Telegram) |
| Update container       | 🟡 forse                | `docker pull` puo' essere triggerato via team API esposta su tailscale, niente SSH |
| Debug power-user       | 🟢 opzionale            | bottone "Apri terminale SSH" → re-inietta chiave temp via Hetzner API → terminale embedded → cancella key a disconnect |

L'utente medio non vede mai il termine "SSH". Il power user ha un
bottone esplicito "🔧 Apri terminale" nel pannello "Gestisci VPS".

## Prerequisiti utente lato Hetzner (one-time, ~5 minuti)

Anche con l'automazione completa il launcher non puo' creare l'account
Hetzner per l'utente. Serve:

```
✅ Account Hetzner             (sign-up con email, gratis)
✅ Carta di credito su Hetzner (Hetzner fattura direttamente l'utente)
✅ API token                   (l'unica cosa che si incolla nel launcher)
```

Tailscale: **non serve account separato**. Il launcher genera un
`auth-key` via API Tailscale e lo inietta nella VPS — l'utente non vede
mai Tailscale come "servizio terzo da configurare". Per la modalita'
self-hosted (v2) si usa WireGuard puro senza Tailscale.

## Login nel launcher e recovery cross-device

In Local PC mode oggi il launcher e' "anonimo": fa setup locale, non sa
chi e' l'utente. In VPS mode questo non basta piu': se l'utente cambia
PC, deve poter ritrovare la sua VPS senza ricominciare da capo (perde
3 settimane di dati, paga la stessa VPS due volte, ecc.).

### Due modalita' di funzionamento del launcher

```
┌────────────────────────────────────────────────────────┐
│  🔓 GUEST MODE  (oggi, resta sempre disponibile)        │
│     • Setup locale, niente account                     │
│     • PC locale only — niente VPS, niente sync         │
│     • Per chi vuole provare senza registrarsi          │
├────────────────────────────────────────────────────────┤
│  🔐 SIGNED-IN MODE  (NEW — necessario per VPS)          │
│     • OAuth Google/GitHub via launcher                 │
│     • Apre browser di sistema, callback a localhost    │
│     • Token Supabase salvato in OS keychain            │
│     • Sblocca: cloud sync, VPS recovery, multi-device  │
└────────────────────────────────────────────────────────┘
```

VPS mode richiede signed-in per forza: senza identita' non si puo'
fare recovery. Local PC mode resta usabile in guest per il path low-friction.

### Cosa va nel cloud, cosa resta locale

Principio guida: **limitare il blast radius**. Se il nostro cloud
Supabase viene violato, l'attaccante NON deve poter:
1. Creare server fatturati sulla carta dell'utente
2. Accedere ai dati locali della VPS direttamente

Quindi:

```
┌────────────────────────────────────────────────────────────────┐
│  ☁️  CLOUD (Supabase, cifrato user-side con passphrase)         │
│  ─────────────────────────────────────                         │
│  ✅ profilo + preferenze                                        │
│  ✅ VPS metadata (provider, IP, region, snapshot ID, tailnet)   │
│  ✅ Tailscale auth-key (cifrato con passphrase utente)          │
│  ❌ Hetzner API token                ← NON sincronizzato        │
│  ❌ chiavi SSH                       ← NON sincronizzate (effimere) │
├────────────────────────────────────────────────────────────────┤
│  🖥️  LOCAL  (OS keychain, mai esce dal PC)                      │
│  ───────────────────────────────                               │
│  ✅ Hetzner API token (master key)                              │
│  ✅ token Supabase session                                      │
│  ✅ Tailscale auth-key (decifrato in memoria)                   │
└────────────────────────────────────────────────────────────────┘
```

**Perche' Hetzner token NON va nel cloud:** e' la master key che
permette di creare server e fatturare sulla carta dell'utente. Se il
nostro cloud viene compromesso, attaccante potrebbe spawnare €€€ di
server prima che l'utente si accorga. La filosofia "AI on the side of
workers" pretende che le credenziali con potere di spendere soldi
restino sempre lato utente.

**Perche' i dati VPS sono safe anche se il cloud cade:** il
metadata (IP, snapshot ID) non basta per accedere alla VPS — serve
sempre il Tailscale auth-key (cifrato user-side, attaccante non
ha la passphrase) o il Hetzner token (mai sul cloud).

### Flusso recovery su nuovo PC

```
1. User installa launcher su laptop B
2. Click "Sign in" → OAuth Google/GitHub via browser
3. Launcher riceve session token Supabase (OS keychain)
4. Launcher pulla config cifrata da Supabase
5. User inserisce passphrase di recovery
   (mostrata 1 volta al setup iniziale, da salvare in password manager)
6. Config decifrata → "hai una VPS Hetzner @ 5.6.7.8"
7. User re-incolla Hetzner API token
   ├─ ce l'ha in 1Password/Bitwarden? 30 secondi
   └─ l'ha perso? 2 min: console.hetzner.cloud → Security → New Token
       (la VPS esistente non si tocca)
8. Launcher usa il token per:
   - listare i server → conferma che c'e' la VPS attesa
   - iniettare nuova SSH key effimera via Hetzner API
   - SSH alla VPS, riconfigurare Tailscale con auth-key dal cloud
9. ✅ Dashboard riconnessa, niente dato perso, VPS NON ricreata
```

Il punto critico e' il **passo 7**: l'utente DEVE avere accesso al suo
account Hetzner. E' il "qualcosa che possiedi" della 2FA implicita —
noi non possiamo recuperarlo per lui.

### Punch list per il launcher come "strumento primario"

Lacune non ancora tracciate in BACKLOG (vedi PHASE 2 expansion):

- `[JHT-DESKTOP-LOGIN]` OAuth Google/GitHub via Supabase
- `[JHT-DESKTOP-SYNC]` Cloud sync cifrato user-side di config + VPS metadata
- `[JHT-DESKTOP-RECOVERY]` Recovery passphrase + decryption flow
- `[JHT-DESKTOP-RECLAIM]` "Ho una VPS esistente, riconnettimi" entry point
- `[JHT-DESKTOP-ERRORS]` Error handling friendly (no stack trace ai non-tech)
- `[JHT-DESKTOP-HELP]` Help/FAQ embedded (no link al web per cose base)

Piu' i task gia' in BACKLOG da promuovere a HIGH priority pre-launch:
- `[JHT-DESKTOP-05]` auto-update (oggi LOW)
- Tray icon + native notifications (oggi nice-to-have)

## Tre tier di utenti, tre path

| Tier | User | Path | Friction | Status |
|---|---|---|---|---|
| 🥉 Tech | sviluppatore, sysadmin | clone repo + ssh manuale + one-liner | alta ma transparente | oggi (validare con [JHT-VPS-VALIDATE]) |
| 🥈 Power | smanettone motivato | desktop wizard + Hetzner API token | media | Phase 3 [JHT-CLOUD-04] |
| 🥇 Non-tech | utente target | desktop wizard + tutorial inline | bassa | Phase 3 [JHT-VPS-FRIENDLY] (NEW) |

I tier non sono mutuamente esclusivi. Il manual path resta documentato
in `docs/VPS-SETUP.md` (output di [JHT-VPS-VALIDATE]) come fallback.
Il wizard e' il default che vede l'utente medio.

## Verita' scomoda da accettare

Anche con la migliore UX possibile, il VPS resta intrinsecamente piu'
complesso del PC locale. L'utente DEVE comunque:
- scegliere un provider
- creare un account
- mettere una carta di credito
- generare un API token (anche se con tutorial)

Per chi non vuole NIENTE di tutto questo c'e' il PC locale (Mode 1)
o il PC dedicato in casa (Mode 2). **Il VPS e' per "non sono uno
smanettone, ma sono motivato e disposto a 30 minuti di setup
guidato"** — non per il completo principiante.

Questo va detto onestamente in `docs/guides/VPS-COMPARISON.md` (nuovo
doc) con un decision tree:

```
Hai un PC vecchio in casa?              → Mode 2 (PC dedicato)
Vuoi pagare €5/mese e dimenticartene?   → Mode 3 (VPS), 30min setup guidato
Vuoi zero pensieri / setup?             → Mode 1 (PC locale, ma deve restare on)
```

## Sequenza di implementazione

1. **[JHT-VPS-VALIDATE]** (Phase 1, BLOCKER) → resta come e', ma
   chiarire nel BACKLOG che e' tech-only/manuale, scopo: validare la
   pipe + scrivere `docs/VPS-SETUP.md` per il tier 🥉.

2. **[JHT-VPS-FRIENDLY]** (Phase 3, NUOVO) → wizard nel launcher
   con tutorial inline (screenshot annotati del pannello Hetzner,
   "clicca qui, copia il token, incollalo qui"). Dipende da
   [JHT-CLOUD-04] (Hetzner adapter) + [JHT-CLOUD-05] (Cloud UI).

3. **[JHT-CLOUD-04] Hetzner adapter** (Phase 3) — implementazione
   tecnica della provisioning automatica. Gia' in BACKLOG.

4. **[JHT-CLOUD-05] Cloud UI** (Phase 3) — il "Choose where the team
   runs" nel launcher. Gia' in BACKLOG.

5. **[JHT-CLOUD-06] Tunnel app↔cloud** (Phase 3) → confermare
   Tailscale come default (vs WireGuard rolled-our-own). Gia' in
   BACKLOG, leaning verso Tailscale.

6. **`docs/guides/VPS-COMPARISON.md`** (Phase 1, MEDIUM) → nuovo doc
   con decision tree onesto. Niente promesse di "VPS facile per
   tutti": chi vuole zero-setup va su PC locale.

## Domande aperte

- **Tailscale vs WireGuard self-managed?** Tailscale e' free fino a
  100 device + zero-config, ma e' un servizio terzo (US company).
  WireGuard self-managed e' piu' aderente al "local-first puro" ma
  costa codice da scrivere e mantenere. Probabilmente Tailscale per
  v1, opzione self-managed in v2.

- **Cosa succede al cambio di PC dell'utente?** Se il launcher ha
  i metadati VPS in `~/.jht/vps.json` e l'utente cambia PC, perde
  l'accesso. Possibili soluzioni: (a) cloud sync di `vps.json`
  cifrato user-side; (b) flusso "claim existing VPS" che ri-fa SSH
  con la chiave Hetzner re-iniettata via API; (c) Tailscale account
  dell'utente che ricorda i nodi.

- **Multi-VPS?** L'utente puo' avere piu' VPS (test + prod)?
  Probabilmente si', ma non per v1. Una VPS sola e' gia' sufficiente
  per il caso d'uso (job hunt da una persona).

- **Auto-shutdown a job-hunt finito?** Quando l'utente ha trovato
  lavoro, la VPS dovrebbe spegnersi automaticamente per non
  continuare a costare €5/mese. Bottone "I got hired, terminate VPS"
  nel launcher? Con conferma e backup dei dati locale prima del
  destroy.

## Riferimenti

- `BACKLOG.md` § PHASE 1 [JHT-VPS-VALIDATE]
- `BACKLOG.md` § PHASE 3 [JHT-CLOUD-01..06]
- `docs/about/VISION.md` (target setup VPS)
- `docs/internal/2026-05-01-bridge-and-token-monitoring.md` (low-profile launch)
