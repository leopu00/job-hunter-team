# 💰 2026-05-06 — Analisi costi infrastruttura per lancio pubblico

## 🎯 TL;DR

Modello JHT: **🆓 piattaforma OSS gratuita**, l'utente paga solo il provider LLM
(Kimi 🌙, Claude 🤖, Codex 🧠…) o usa AI locale (totalmente gratis). Lato lancio,
**💸 zero pagamenti incassati** → niente Stripe, niente compliance PCI, niente
fatturazione utenti.

📊 Setup target a regime: **~€5/mese + ~€12/anno dominio** (~€72/anno totali)
con self-host completo. Free-tier puro fattibile in beta interna ma rompe in
fretta su Vercel/Supabase quando si scala.

## 💼 Il modello di monetizzazione (per chiarezza)

- 🆓 JHT software → **gratis e open source**
- 🔑 Utente porta la propria API key (BYOK): paga Anthropic / Moonshot / OpenAI
  direttamente
- 🏠 Alternativa: AI locale (Ollama, OpenCode pianificato) → **costo zero per
  l'utente**
- 🔐 Il sito web ha login solo per salvare preferenze / sync dati utente, non
  per vendere nulla

> ⚡ **Conseguenza diretta**: nessuna transazione passa per noi. Tutti i costi
> infra sono "nostri" (mantenimento), non scalano col numero di utenti
> paganti perché non ci sono utenti paganti.

## ❌ Cosa NON serve

| Servizio | Perché non serve |
|---|---|
| 💳 **Stripe / processore pagamenti** | Nessuna transazione incassata |
| 🚀 **Vercel Pro** | Login per salvare dati su tool OSS gratuito = personal/hobby project, Hobby plan OK |
| 🔏 **Code signing cert** | Già differito (memoria progetto); trust signal in beta = trasparenza OSS |
| 🐳 **Docker Team/Business** | Immagine pubblica su Docker Hub + GHCR → 0 limiti |

## ✅ I servizi che servono davvero

### 1️⃣ Repo + immagini container

📦 **GitHub** (repo pubblici illimitati) + **GHCR** (`ghcr.io/leopu00/jht`,
illimitato per repo pubblici) + **Docker Hub** come mirror.

> 💚 Costo: **€0** sempre.

### 2️⃣ Web app (sito + dashboard cloud)

Tre opzioni, in ordine di lock-in crescente:

#### 🅰️ Cloudflare Pages — ⭐ raccomandato
- ✅ Free tier illimitato bandwidth, niente clausola non-commercial
- ✅ Supporta Next.js nativamente
- ⏱️ Swap da Vercel: ~1 ora di lavoro (build command + env vars)
- 💚 **€0/mese**

#### 🅱️ Vercel Hobby
- 🟢 Status quo, già funzionante
- ⚠️ Free 100GB banda/mese, ma clausola "non-commercial" interpretabile
- 🚨 Rischio: policy change futura → forced upgrade a Pro €20/mese
- 💛 **€0/mese oggi, rischio policy change**

#### 🅲️ Self-host su VPS
- 🛠️ Next.js build → Docker + Caddy reverse proxy (SSL auto via Let's Encrypt)
- 🔁 Stesso VPS di Supabase self-host → costo marginale zero
- 🧰 Più lavoro: deploy via GitHub Actions, monitoring uptime
- 💚 **€0 marginale (condivide VPS)**

### 3️⃣ DB + Auth + Storage

🗄️ **Supabase self-host** su VPS.

Stack identico al cloud Supabase: Postgres 🐘 + GoTrue (auth) 🔐 + Storage 📂 +
Realtime ⚡ + Studio 🎨. Tutto in `docker-compose`.

- 🖥️ VPS Hetzner CX22: **~€4.5/mese** (lo stesso "target setup" del progetto —
  vedi [`INFRA.md`](INFRA.md))
- 💾 Backup: cron + rclone su Backblaze B2 (~€0.005/GB/mese, trascurabile)
- 🔒 SSL: gratis con Caddy

#### 🧑‍🔧 Cosa ci si prende in carico
- 🩹 Patch security Postgres / GoTrue (ogni 1-2 mesi)
- ✅ Backup verificati (restore test periodico)
- 📈 Monitoring uptime (UptimeRobot free)

#### 🎁 Vantaggi nel contesto JHT
- 🎯 Coerente con filosofia VPS-first (vedi [`INFRA.md`](INFRA.md), modalità "target setup")
- 🛡️ Pieno controllo dati utenti → allineato a OSS-as-trust-signal
- 🔓 Zero lock-in su provider managed
- 🚫 Zero rischio policy change improvviso (es. limite MAU abbassato da 50k a 10k)

### 4️⃣ Email transazionali (magic-link, password reset)

📧 **Resend** free tier: 3000 email/mese, 100/giorno.
Sufficiente per beta + alpha pubblica iniziale.

> 🚨 Soglia upgrade: **$20/mese** se >3k email/mese.

### 5️⃣ Dominio

🌐 Già su GoDaddy (jobhunterteam.ai) — **~€12-15/anno**.

### 6️⃣ Telegram bot

💬 API ufficiale gratuita illimitata. **€0**.

## 📊 Stima costi per fase

| Fase | Setup | 💶 €/mese | 💶 €/anno (incl. dominio) |
|---|---|---|---|
| 🧪 Beta interna (10-50 utenti) | Free tier ovunque | **€0** | ~€12 |
| 🚀 Alpha pubblica (50-500 utenti) | Cloudflare Pages + Supabase self-host | **~€5** | ~€72 |
| 📈 Crescita (500-5000 utenti) | Idem + VPS più grosso | **~€10-15** | ~€132-192 |
| 🌍 Mass-market (5k+ utenti) | Multi-VPS + CDN paid | **~€30-50** | ~€372-612 |

> 🔑 **Punto chiave**: i costi crescono lentamente perché non c'è inferenza LLM
> lato server (BYOK utente). I bottleneck reali sono storage Postgres +
> banda dashboard, entrambi economici.

## 🏗️ Setup raccomandato per il lancio

```
┌─────────────────────────────────────────────────────┐
│  📦 GitHub (repo pubblico)                  → €0    │
│  📦 GHCR (immagini)                         → €0    │
│  🌐 Cloudflare Pages (sito + dashboard)     → €0    │
│              ↓                                      │
│  🖥️  VPS Hetzner CX22                  → €4.5/mese  │
│      ├── 🗄️  Supabase self-host (Postgres, Auth)    │
│      └── 🔒 Caddy reverse proxy (SSL auto)          │
│              ↓                                      │
│  💾 Backblaze B2 (backup DB)            → ~€0.10    │
│  📧 Resend (email, free <3k/mese)           → €0    │
│  🌐 GoDaddy (dominio)                    → €12/anno │
└─────────────────────────────────────────────────────┘

🎯 Totale: ~€5/mese + €12/anno = ~€72/anno
```

## ❓ Open questions

1. ⚖️ **Cloudflare Pages vs self-host Next.js**: scelta da rimandare a quando
   il sito web esce da MVP. Per ora Vercel Hobby va bene; switch è
   reversibile.
2. 🤔 **Supabase managed vs self-host nel deploy "VPS dell'utente"**: se ogni
   utente self-hosta tutto sul proprio VPS (memoria
   `project_team_location_exclusive`), il "nostro" Supabase serve solo per
   il sito vetrina + accounts marketing. Ridimensiona il piano qui sopra.

## ⏳ Decisioni differite

- 🔏 **Code signing**: differito post-beta (memoria
  `project_open_source_as_trust_signal`). Quando attivato: ~€200-500/anno.
- 🚀 **CDN dedicato** (Cloudflare paid, Bunny CDN): solo se traffico dashboard
  esplode oltre i limiti free Cloudflare Pages.
- 📊 **Telemetry/observability** (PostHog, Sentry): se serve, free tier
  generoso copre fase alpha.

## 🟢 Azione immediata richiesta

**Nessuna.** Il progetto oggi gira su Vercel Hobby + (eventualmente) Supabase
free, sufficienti per la beta interna in corso. Il piano qui sopra entra in
gioco al momento del lancio pubblico (Phase 3, target setup VPS — vedi
[`ROADMAP.md`](../about/ROADMAP.md)).
