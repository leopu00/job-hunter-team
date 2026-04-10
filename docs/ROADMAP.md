# 🗺️ ROADMAP — Job Hunter Team

> Ultimo aggiornamento: 2026-04-06

---

## 🎯 Visione

Job Hunter Team diventa un'**applicazione desktop** scaricabile da chiunque — anche utenti non tecnici.
L'utente scarica un installer, lo installa, e un launcher desktop prepara l'ambiente, avvia JHT in background e apre la GUI web locale nel browser.
La UI principale resta la dashboard web su `localhost`; l'app desktop e' il tramite zero-terminale.

**Tre modalita' di esecuzione (scelta utente):**

```
  👤 Utente qualsiasi              👨‍💻 Power user                ☁️ Cloud user
        │                              │                           │
        ▼                              ▼                           ▼
  ┌───────────┐                 ┌─────────────┐            ┌──────────────┐
  │ 🖥️ App   │                 │  💻 PC      │            │  ☁️ Remote  │
  │  Desktop  │                 │  Dedicato   │            │     VM       │
  │ (locale)  │                 │ (rete LAN)  │            │ AWS/GCP/     │
  │           │                 │             │            │ Hetzner      │
  └───────────┘                 └─────────────┘            └──────────────┘
        │                              │                           │
        └──────────────────────────────┴───────────────────────────┘
                                       │
                                       ▼
                              🌐 Web Dashboard
                           (monitoring da remoto)
                            Vercel + Supabase
```

**Stack decisioni:**

| Componente | Tecnologia | Motivazione |
|-----------|------------|-------------|
| Desktop app | **Launcher Electron leggero** | Installer, tray, lifecycle manager; la GUI operativa resta nel browser |
| Web dashboard | **Next.js su Vercel** | Pipeline CI/CD gia' scritta |
| Backend dati | **Supabase** (Frankfurt) | Gia' attivo, PostgreSQL, auth Google |
| Cloud provisioning | **Multi-provider** | AWS + GCP + Hetzner con layer di astrazione |
| Lingua principale | **Inglese** | Target internazionale, italiano come seconda lingua |

---

## 📅 Fasi di sviluppo

```
  Fase 1              Fase 2              Fase 3              Fase 4              Fase 5
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  🔨 IN CORSO          ⏳ PROSSIMA         ⏳ PROSSIMA          ⏳ PROSSIMA         🔮 FUTURO
  Web Platform        Desktop Launcher    Cloud Multi-         i18n                Sito Web
  consolidamento      + localhost GUI     Provider             Completa            Pubblico
```

---

### 🔨 Fase 1 — Consolidamento Web Platform (sprint corrente)

> _"La web app funziona end-to-end con dati reali."_

```
🟢 Stato: IN CORSO
━━━━━━━━━━━━━━━━░░░░░ ~65%

✅ App Next.js funzionante con 56 pagine
✅ Auth Google configurata
✅ Schema DB V2 (5 tabelle + RLS)
✅ CI/CD Vercel pipeline scritta
⬜ Dashboard con dati reali Supabase
⬜ Profilo utente con salvataggio cloud
⬜ Pagine posizioni e candidature
⬜ Deploy Vercel (mancano secrets GitHub)
⬜ API layer agenti → Supabase (multi-tenant)
⬜ Test E2E piattaforma web
```

---

### 📦 Fase 2 — Desktop Launcher

> _"Scarichi, installi, parte tutto in background, poi lavori dal browser."_

```
🟡 Stato: IN CORSO
━━━━━━━━━━━░░░░░░░░░ ~45%

✅ Scaffolding `desktop/` + electron-builder
✅ Launcher/orchestratore locale con browser opener e runtime manager
✅ Payload prebuildato: GUI web gia' compilata, niente rebuild lato utente
✅ Installer: .dmg (macOS), .exe NSIS (Windows), .AppImage + .deb (Linux)
✅ Release workflow con GitHub Releases e runner nativi per OS
⬜ Setup wizard grafico (lingua, profilo, provider AI, credenziali)
⬜ Bootstrap silenzioso dipendenze in base al provider scelto
⬜ Tray icon + notifiche desktop native
⬜ Code signing completo (macOS + Windows)
⬜ Auto-update via electron-updater
⬜ Modalita' "computer dedicato" (SSH + mDNS discovery)
```

---

### ☁️ Fase 3 — Cloud Provisioning Multi-Provider

> _"Clicca un bottone, il team gira su un server cloud."_

```
⚪ Stato: ROADMAP
░░░░░░░░░░░░░░░░░░░░ 0%

⬜ Layer di astrazione shared/cloud/ (interfaccia CloudProvider)
⬜ Adapter AWS EC2 (provisioning, security group, lifecycle)
⬜ Adapter Google Cloud GCE (firewall, startup script)
⬜ Adapter Hetzner Cloud (EU-only, costi bassi)
⬜ UI Cloud nel wizard desktop (scelta provider, stima costi)
⬜ One-click deploy + monitoring + teardown
⬜ Tunnel sicuro app ↔ cloud (WireGuard / SSH tunnel)
⬜ Billing alert (notifica soglia costi)
```

---

### 🌍 Fase 4 — Internazionalizzazione Completa

> _"La piattaforma parla la lingua dell'utente."_

```
⚪ Stato: ROADMAP (base it/en gia' presente in shared/i18n/)
━━━░░░░░░░░░░░░░░░░░ ~15%

✅ Modulo i18n con supporto it/en e fallback
✅ Chiavi traduzione per nav, common, status, time, notifications
⬜ Inglese come lingua principale (default) per UI e docs
⬜ Refactor traduzioni in file separati per lingua (locales/*.json)
⬜ Language switcher in app desktop e web dashboard
⬜ Copertura i18n per tutte le nuove pagine (wizard, cloud, ecc.)
⬜ Espansione: spagnolo, tedesco, francese, portoghese
⬜ Guida per traduttori community
```

---

### 🌐 Fase 5 — Sito Web Pubblico e Distribuzione

> _"Landing page, download, onboarding per utenti non tecnici."_

```
🟡 Stato: IN CORSO
━━━━━━━━━━━━░░░░░░░░ ~55%

✅ Dominio acquistato: **jobhunterteam.ai** (Cloudflare)
✅ DNS configurato: Record A → Vercel (216.198.79.1), DNS only
✅ Dominio collegato a Vercel, SSL auto-generato
✅ Supabase Auth: Site URL e redirect aggiornati a jobhunterteam.ai
✅ Landing page pubblica
✅ Pagina download con rilevamento OS automatico
⬜ Configurazione sottodomini (app, docs, api)
⬜ Documentazione utente visuale (guide, screenshot, FAQ)
⬜ Video tutorial (opzionale)
```

---

## 🔄 Migrazione locale <-> cloud

```
 💻 Locale                          🌐 Cloud
┌─────────────┐    ──export──►   ┌───────────┐
│   SQLite    │                  │ Supabase  │
│   + PDF     │    ◄──import──   │ PostgreSQL│
└─────────────┘                  └───────────┘
```

| Direzione | Cosa migra |
|-----------|-----------|
| 💻 → 🌐 | Profilo, posizioni, score, candidature, PDF |
| 🌐 → 💻 | Stessi dati, scaricati in SQLite + cartelle locali |

> Questa feature e' trasversale e verra' implementata progressivamente tra Fase 1 e Fase 3.

---

## 📦 Modalita' di utilizzo (dettaglio)

### 🖥️ 1. App Desktop — Per tutti

| | |
|---|---|
| 🎯 **Target** | Chiunque — utenti non tecnici inclusi |
| 📥 **Installazione** | Scarica il launcher (.dmg/.exe/.AppImage/.deb), installa e avvia |
| ⚙️ **Setup** | Wizard grafico: lingua → profilo → provider AI → credenziali |
| 🤖 **Runtime** | JHT gira in background; il launcher controlla start/stop/status |
| 💾 **Storage** | SQLite locale + sync opzionale con Supabase |
| 🌐 **GUI** | Browser su `http://localhost:3000` aperto automaticamente |
| 📡 **Monitoring** | Web dashboard da browser (anche da telefono) |

### 💻 2. Computer Dedicato — Per chi ha un PC extra

| | |
|---|---|
| 🎯 **Target** | Chi vuole un PC sempre acceso dedicato al team |
| 🔧 **Setup** | Dal launcher desktop, configura il PC remoto via SSH |
| 🤖 **Agenti** | Girano sul PC dedicato, non sul principale |
| 📡 **Monitoring** | GUI web + notifiche desktop |

### ☁️ 3. Cloud Remoto — Per chi vuole zero hardware

| | |
|---|---|
| 🎯 **Target** | Power user, chi non vuole tenere un PC acceso |
| ☁️ **Provider** | AWS, GCP, Hetzner (scelta utente) |
| 💰 **Costo** | Pay-per-use: avvii → lavora → spegni |
| 🤖 **Agenti** | Girano sulla VM cloud |
| 📡 **Monitoring** | GUI web + launcher desktop |

---

## 🐳 Docker — Roadmap future (non in Fase 1)

> _Isolamento degli agenti dal filesystem host. Non urgente, ma il progetto e' gia' costruito per supportarlo senza refactor invasivi._

### Motivazione

Oggi gli agenti girano nativi sul sistema operativo dell'utente con `--dangerously-skip-permissions`. Funziona per Leone e per chiunque si fidi del tool, ma non e' accettabile per una distribuzione pubblica dove l'utente non puo' (e non vuole) verificare cosa fanno gli agenti sul suo filesystem.

Docker risolve isolando i processi agente in un container, che vede **solo** due cartelle bind-mounted: `~/.jht` (nascosta, DB/config/agenti) e `~/Documents/Job Hunter Team` (visibile, CV e output). Tutto il resto del filesystem host e' invisibile.

### 📋 Requisiti gia' soddisfatti

La centralizzazione path del refactor `dev-4` ha gia' preparato il terreno:

```
✅ Stato persistente in due cartelle sole (JHT_HOME + JHT_USER_DIR)
✅ Path configurabili via env var (override per bind-mount)
✅ Nessun side-effect sul sistema host (no scrittura in ~/.bashrc ecc.)
⚠️ TUI usa `open`/`explorer`/`xdg-open` per aprire Finder — va gated
   dietro un check "are we inside a container?" (env var IS_CONTAINER o
   presenza di /.dockerenv)
```

### 🗺️ Fasi implementazione Docker

```
Step 1: Dockerfile minimale
━━━━━━━━━━━━━━━━━━━━━━━━━━
FROM node:20-alpine
RUN apk add tmux git bash
RUN npm install -g @anthropic-ai/claude-cli
COPY . /app
WORKDIR /app
ENV JHT_HOME=/jht_home
ENV JHT_USER_DIR=/jht_user
ENTRYPOINT ["node", "cli/bin/jht.js"]

Step 2: docker-compose.yml
━━━━━━━━━━━━━━━━━━━━━━━━━━
services:
  jht:
    build: .
    volumes:
      - ~/.jht:/jht_home
      - ~/Documents/Job Hunter Team:/jht_user
    environment:
      - ANTHROPIC_API_KEY
    ports:
      - "3000:3000"  # web dashboard
    stdin_open: true
    tty: true        # per la TUI

Step 3: Wrapper `jht-docker`
━━━━━━━━━━━━━━━━━━━━━━━━━━━
Script bash che fa:
  docker run --rm -it \
    -v ~/.jht:/jht_home \
    -v "$HOME/Documents/Job Hunter Team:/jht_user" \
    -e ANTHROPIC_API_KEY \
    ghcr.io/leopu00/jht:latest

Step 4: Image pre-buildata su GitHub Container Registry
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CI che su tag git:
  - docker build
  - docker push ghcr.io/leopu00/jht:v0.x.y
L'utente: `docker pull ghcr.io/leopu00/jht:latest`

Step 5: Integrazione nel DMG installer
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Il DMG (percorso non-tech) rileva se Docker Desktop e' installato e,
se si', avvia JHT in container; altrimenti fallback modalita' nativa.
L'utente non-tech ottiene isolamento automaticamente, senza sapere
cosa sia Docker.
```

### 🎯 Quando farlo

**Non prima** di:
- Prima release stabile della piattaforma (Fase 2 completa: DMG installer funzionante)
- Feedback da utenti early-adopter sulla modalita' nativa
- Dimostrazione che almeno 10 utenti usano JHT senza problemi di isolamento

**Trigger per prioritizzare:**
- Primo report di agente che fa qualcosa di indesiderato sul filesystem host
- Richiesta esplicita da utenti "enterprise" o che lo vogliono provare senza installare Node/tmux
- Domanda da parte di security reviewer per un audit pubblico

### ⚠️ Cose da NON fare finche' non si implementa Docker

Per mantenere il progetto "Docker-ready" senza bloccare lo sviluppo:

1. **Non aggiungere side-effects sul sistema host** (installazione globale di tool, scrittura in `~/.bashrc`, modifica di `~/Library`, ecc.)
2. **Non hardcodare comandi OS-specific senza fallback** (es. `open ...` su macOS → gated behind platform check)
3. **Non usare path assoluti fuori da `JHT_HOME`/`JHT_USER_DIR`** (es. `/usr/local/...`, `/etc/...`)
4. **Non aprire porte di rete diverse da 3000** (web dashboard), altrimenti il port-forwarding Docker si complica
5. **Non scrivere dentro `node_modules` a runtime** (sarebbe read-only nel container)
