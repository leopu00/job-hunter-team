# 🗺️ ROADMAP — Job Hunter Team

> Ultimo aggiornamento: 2026-04-04

---

## 🎯 Visione

Job Hunter Team diventa un'**applicazione desktop** scaricabile da chiunque — anche utenti non tecnici.
L'utente scarica un installer, lo installa, e un wizard lo guida nel setup del team.
Da browser, fa login e monitora il team da remoto.

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
| Desktop app | **Electron** | Riusa frontend Next.js, Node.js nativo per agenti |
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
  Web Platform        App Desktop         Cloud Multi-         i18n                Sito Web
  consolidamento      Electron            Provider             Completa            Pubblico
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

### 📦 Fase 2 — App Desktop Electron

> _"Scarichi, installi, usi. Come qualsiasi altra app."_

```
⚪ Stato: ROADMAP
░░░░░░░░░░░░░░░░░░░░ 0%

⬜ Scaffolding Electron (desktop/) con electron-forge
⬜ Setup wizard grafico (lingua, profilo, API key)
⬜ Gestione agenti come child process (no tmux)
⬜ Auto-install dipendenze (Python embedded/rilevato)
⬜ Tray icon + notifiche desktop native
⬜ Installer: .dmg (macOS), .exe (Windows), .AppImage (Linux)
⬜ Code signing (macOS + Windows)
⬜ Auto-update via electron-updater + GitHub Releases
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
⚪ Stato: ROADMAP
░░░░░░░░░░░░░░░░░░░░ 0%

✅ Dominio acquistato: **jobhunterteam.ai** (Cloudflare)
✅ DNS configurato: Record A → Vercel (216.198.79.1), DNS only
✅ Dominio collegato a Vercel, SSL auto-generato
✅ Supabase Auth: Site URL e redirect aggiornati a jobhunterteam.ai
⬜ Configurazione sottodomini (app, docs, api)
⬜ Landing page (hero, features, 3 step, download, FAQ)
⬜ Pagina download con rilevamento OS automatico
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
| 📥 **Installazione** | Scarica installer (.dmg/.exe/.AppImage), doppio click |
| ⚙️ **Setup** | Wizard grafico: lingua → profilo → API key → via |
| 🤖 **Agenti** | Girano come processi background nell'app |
| 💾 **Storage** | SQLite locale + sync opzionale con Supabase |
| 📡 **Monitoring** | Web dashboard da browser (anche da telefono) |

### 💻 2. Computer Dedicato — Per chi ha un PC extra

| | |
|---|---|
| 🎯 **Target** | Chi vuole un PC sempre acceso dedicato al team |
| 🔧 **Setup** | Dall'app desktop, configura il PC remoto via SSH |
| 🤖 **Agenti** | Girano sul PC dedicato, non sul principale |
| 📡 **Monitoring** | Web dashboard + notifiche desktop |

### ☁️ 3. Cloud Remoto — Per chi vuole zero hardware

| | |
|---|---|
| 🎯 **Target** | Power user, chi non vuole tenere un PC acceso |
| ☁️ **Provider** | AWS, GCP, Hetzner (scelta utente) |
| 💰 **Costo** | Pay-per-use: avvii → lavora → spegni |
| 🤖 **Agenti** | Girano sulla VM cloud |
| 📡 **Monitoring** | Web dashboard + app desktop |
