# 🗺️ ROADMAP — Job Hunter Team

> Ultimo aggiornamento: 2026-03-28

---

## 🎯 Visione

Job Hunter Team e' un framework multi-agente per automatizzare la ricerca lavoro. L'obiettivo e' renderlo accessibile a **3 tipi di utente** con modalita' diverse di utilizzo.

```
  👤 Utente non tecnico          👨‍💻 Utente tecnico            ☁️ Power user
        │                              │                           │
        ▼                              ▼                           ▼
  ┌───────────┐                 ┌─────────────┐            ┌──────────────┐
  │  🌐 Web   │                 │  💻 Locale  │            │  🖥️ Remote  │
  │   Cloud   │ ◄── sync ──►   │   SQLite    │            │     VM       │
  │ Supabase  │                 │   + PDF     │            │  AWS / GCP   │
  └───────────┘                 └─────────────┘            └──────────────┘
        │                              │                           │
        └──────────────┬───────────────┘                           │
                       ▼                                           │
                 🔄 Migrazione                                     │
               locale <-> cloud ◄──────────────────────────────────┘
```

---

## 📦 Modalita' di utilizzo

### 🌐 1. Web/Cloud — Per tutti

> _"Apri il browser, vedi i tuoi dati, da qualsiasi parte del mondo."_

| | |
|---|---|
| 🎯 **Target** | Utenti non tecnici |
| 🔐 **Auth** | Google OAuth via Supabase |
| 💾 **Storage** | PostgreSQL cloud (Supabase, Frankfurt) |
| 🖥️ **Accesso** | Browser — qualsiasi dispositivo |
| 🤖 **Interazione** | Chat con Assistente |
| ⚙️ **Requisiti** | Nessuno — solo un browser |

**L'utente puo':**
- 📊 Vedere la dashboard con lo stato della pipeline
- 📄 Consultare CV e cover letter generati
- ⭐ Vedere il rating delle posizioni trovate
- 💬 Chattare con l'Assistente per configurazione e supporto
- 📋 Gestire il proprio profilo candidato

```
🟢 Stato: IN SVILUPPO
━━━━━━━━━━━━━━━━░░░░░ ~65%

✅ App Next.js funzionante
✅ Auth Google configurata
✅ Schema DB V2 (5 tabelle + RLS)
✅ Pagina Assistente con chat
⬜ Dashboard con dati reali
⬜ Pagine posizioni e candidature
⬜ Deploy Vercel
```

---

### 💻 2. Locale — Per sviluppatori

> _"Cloni la repo, lanci il team, controlli tutto dal tuo terminale."_

| | |
|---|---|
| 🎯 **Target** | Utenti tecnici / sviluppatori |
| 💾 **Storage** | SQLite locale + PDF su filesystem |
| 🤖 **Agenti** | Claude CLI via tmux |
| 📁 **Workspace** | Separato dal framework (`JHT_WORKSPACE`) |
| ⚙️ **Requisiti** | Python 3.10+, tmux, Claude CLI, Node.js 18+ |

**L'utente puo':**
- 🔧 Controllo completo sulla pipeline e sugli agenti
- 🗄️ Dati locali, nessuna dipendenza cloud
- 🖥️ Dashboard locale su `localhost:3000`
- 📊 Query dirette al DB con `db_query.py`
- ⚡ Personalizzazione totale dei prompt agenti

```
🟢 Stato: COMPLETATO
━━━━━━━━━━━━━━━━━━━━ ~95%

✅ Pipeline e2e validata (5 profili: 2 dev + 3 non-dev)
✅ 33 test green (30 fast + 3 slow)
✅ setup.sh automatizzato (venv, PEP 668)
✅ Cross-platform (macOS, Linux, WSL)
✅ Supporto profili non-dev
⬜ Documentazione candidate_profile.yml
```

---

### 🖥️ 3. Remote VM — Il futuro

> _"Noleggi una macchina, il team lavora per te, lo spegni quando vuoi."_

| | |
|---|---|
| 🎯 **Target** | Power user / team aziendali |
| ☁️ **Infra** | AWS EC2, GCP, o qualsiasi server remoto |
| 🤖 **Agenti** | Girano sulla VM, non sul tuo computer |
| 💰 **Modello** | Pay-per-use: avvii → lavora → spegni |
| 🖥️ **Gestione** | Dalla dashboard web |

**L'utente potra':**
- 🚀 Lanciare il team senza installare nulla
- 📡 Monitorare gli agenti da remoto
- ⏱️ Start/stop del team con un click
- 💸 Pagare solo per il tempo di utilizzo
- 🔄 Scalare il numero di agenti

```
⚪ Stato: ROADMAP
░░░░░░░░░░░░░░░░░░░░ 0%

⬜ Provisioning VM (AWS/GCP)
⬜ Deploy automatico agenti
⬜ Monitoring remoto
⬜ Start/stop da dashboard
⬜ Gestione costi e billing
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

```
⚪ Stato: ROADMAP
░░░░░░░░░░░░░░░░░░░░ 0%

⬜ Tool SQLite → PostgreSQL
⬜ Tool PostgreSQL → SQLite
⬜ Export/import PDF
⬜ UI nella dashboard
```

---

## 📅 Fasi di sviluppo

```
  Fase 1              Fase 2              Fase 3              Fase 4
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ✅ COMPLETATA       🔨 IN CORSO          ⏳ PROSSIMA         🔮 FUTURO
  Pipeline locale     Piattaforma web      Migrazione dati     Remote VM
```

### ✅ Fase 1 — Pipeline locale

- [x] 🤖 Pipeline: scout → analista → scorer → scrittore → critico
- [x] 🗄️ Database SQLite V2
- [x] 🔒 Anti-collisione tra agenti
- [x] 📦 Setup automatizzato (`setup.sh` + `setup.ps1` per Windows)
- [x] 🧪 Test suite (33 test)
- [x] 👥 Supporto profili non-dev
- [x] 🖥️ Cross-platform (macOS, Linux, WSL)

### 🔨 Fase 2 — Piattaforma web

- [x] ⚡ App Next.js con auth Google
- [x] 🗄️ Schema PostgreSQL su Supabase
- [x] 💻 Modalita' locale senza Supabase
- [x] 🤖 Agente Assistente con chat web
- [x] 🖥️ Workspace separato (`JHT_WORKSPACE`)
- [ ] 📊 Dashboard collegata a dati reali Supabase
- [ ] 👤 Pagina profilo con salvataggio cloud
- [ ] 📋 Pagina posizioni (lista + score)
- [ ] 📄 Pagina candidature (CV, CL, stato)
- [ ] 🚀 Deploy Vercel con CI/CD
- [ ] 🔌 API layer agenti → Supabase (multi-tenant)

### ⏳ Fase 3 — Migrazione dati

- [ ] 💻→🌐 Tool migrazione SQLite → PostgreSQL
- [ ] 🌐→💻 Tool migrazione PostgreSQL → SQLite
- [ ] 📄 Export/import PDF
- [ ] 🖥️ UI nella dashboard per avviare la migrazione

### 🔮 Fase 4 — Remote VM

- [ ] ☁️ Provisioning VM (AWS/GCP)
- [ ] 🤖 Deploy automatico agenti su VM
- [ ] 📡 Monitoring remoto dalla dashboard
- [ ] ▶️ Start/stop team da web
- [ ] 💰 Gestione costi e billing
