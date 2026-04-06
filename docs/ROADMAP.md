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
