# Open questions: Telegram bot multi-agente + setup VPS via Desktop

**Data**: 2026-05-12
**Stato**: documento di memoria, NIENTE decisione finale presa. Da rivedere prima dell'onboarding multi-agente e del rilascio Desktop installer.

> Decisione finale rimandata. Questo doc serve a non perderci la memoria del ragionamento.

---

# 🤖 Tema A — Quanti bot Telegram?

## Agenti utente-facing identificati

- 👨‍💼 **Assistente** — onboarding profilo, tech support, drop-zone documenti
- 👨‍✈️ **Capitano** — direzione team, fine-tuning ricerca/scoring, priorità candidature
- 🧙‍♂️ **Maestro** — mentore di crescita, posizionamento strategico

Il resto del team (Scout, Analista, Scorer, Scrittore, Critico, Sentinella) non parla direttamente con l'utente: ricevono ordini dal Capitano.

## Opzioni valutate

### Opzione 1 — Un bot solo, l'Assistente è router (status quo)

```
                ┌─────────────────────────┐
   👤 utente ───▶│  @jht_<user>_bot        │───▶ ASSISTENTE (router)
                └─────────────────────────┘            │
                                                       ├──▶ Capitano (forward)
                                                       └──▶ Maestro  (forward)
```

✅ 1 token, 1 wizard step
✅ Già implementato
🔴 Tutte le notifiche in una chat → mute selettivo impossibile
🔴 Routing manuale via prefix `/cap` `/maestro` o linguaggio naturale → ambiguità
🔴 Contesto mescolato (l'Assistente legge anche le richieste di mentoring)

### Opzione 2 — N bot dedicati per agente

```
   👤 utente ──▶ @jht_<user>_assistente_bot ──▶ ASSISTENTE
            └─▶ @jht_<user>_capitano_bot ───▶ CAPITANO
            └─▶ @jht_<user>_maestro_bot ────▶ MAESTRO
```

✅ Notifiche separate per agente (Telegram nativo)
✅ Contesto pulito
✅ "Tag" implicito dal canale che usi
🔴 Wizard chiede 3× `/newbot` a `@BotFather` → UX faticosa
🟡 3× token da gestire nel config (`channels.telegram.bots.{assistente,capitano,maestro}`)
🟡 3× `/start` sul bot prima del setup

### Opzione 3 — Gruppo Telegram con topic (Forum mode) ⭐

```
   👤 utente ┌─ #📥 Assistente  ─▶ ASSISTENTE
       in    ├─ #🎯 Capitano    ─▶ CAPITANO
   gruppo ──┤ #🧭 Maestro      ─▶ MAESTRO
    JHT     └─ #📣 Team-log    ─▶ broadcast (read-only)
              (1 bot, 1 chat_id, N topic)
```

✅ 1 solo bot da configurare
✅ Topic = sub-canale Telegram nativo
✅ Notifiche per topic configurabili separatamente
✅ Il "team-log" diventa il forum citato in `docs/internal/INFRA.md` come planned upgrade
🟡 Bot API: `message_thread_id` + `is_topic_message` da gestire nel `tg-bridge.py`
🟡 Telegram client deve supportare topic (Telegram Premium per creare gruppi con topic, ma free user può scrivere/leggere)
🟡 Setup wizard: creare gruppo + abilitare topic + invitare bot + dare admin per gestire topic

### Opzione 4 — Un bot, routing via @-tag

```
   👤 utente: "@capitano alza score posizioni Roma"
                  │
         ┌────────┴────────┐
         ▼                 ▼
   parse @<role>       default
         │                 │
         ▼                 ▼
       CAPITANO        ASSISTENTE
```

✅ 1 bot
🟡 Routing dipende dall'utente che ricorda i tag
🔴 Mix conversazionale rumoroso (notifiche tutte insieme)
🟡 Fallback dell'Opzione 1 con minimo overhead

## Matrice decisione

| Opz | Setup utente | UX quotidiana | Effort dev | Scala |
|-----|--------------|---------------|------------|-------|
| 1 — un bot router | 🟢 1 step | 🟡 rumoroso | 🟢 zero | 🟢 |
| 2 — N bot dedicati | 🔴 3 step BotFather | 🟢 pulita | 🟡 wizard + multi-token config | 🟢 |
| 3 — Topic mode ⭐ | 🟡 1 step + gruppo | 🟢🟢 ottimo | 🟡 bridge topic-aware | 🟢 |
| 4 — @-tag in chat | 🟢 1 step | 🟡 abitudine | 🟢 piccolo router | 🟢 |

## Decisione provvisoria

- **Beta now** → Opzione 1 (status quo) per non bloccare i test attuali
- **Onboarding multi-agente** → **Opzione 3 (topic)** raccomandata. Verifica wizard fattibile prima del lock.
- **Opzione 4** come fallback se topic UX non convince

Da decidere prima di pre-cablare Capitano e Maestro nel `tg-bridge.py`.

---

# 🖥️ Tema B — Setup VPS: oggi e domani

## Stato attuale: 🥉 SSH manuale (tech-only)

```
   👤 Leone su Mac        🌐 Hetzner               🖥️ VPS
   ┌──────────────┐  1.   ┌──────────┐   2. SSH   ┌────────────┐
   │ Manual login │ ────▶ │ console  │ ────────▶  │ curl       │
   │ Genera key   │       │ Create   │            │ install.sh │
   │ Paste pubkey │       │ VPS      │            │ wizard     │
   └──────────────┘       └──────────┘            └────────────┘
```

✅ Funziona oggi
🔴 Tech-only (SSH, key, console Hetzner)
🔴 Ogni utente = sessione manuale di Leone

## Path B1 — 🤝 Beta tester: Leone-assisted

Leone fa SSH alla VPS dell'utente insieme a lui (screen share o chiamata), configura tutto, poi l'utente interagisce solo dalla dashboard web + Telegram. **Zero codice nuovo**, fattibile da subito.

```
   👤 Leone ──SSH──▶ 🖥️ VPS-utente ──setup tutto──▶ utente: dashboard + Telegram
```

✅ Validation con utenti reali senza investimento dev
✅ Debug interattivo
🔴 Non scala oltre primi N beta
🟡 Trust: "Leone ha accesso al mio server"

## Path B2 — 🟡 CLI assistita (`jht vps setup`)

```
   👤 utente terminal:    jht vps setup
                           │
                           ├─ chiede Hetzner API token (form CLI)
                           ├─ genera SSH key locale
                           ├─ hcloud REST → crea CPX22
                           ├─ poll → ssh root@<ip> "curl install.sh | bash"
                           └─ wizard non-interactive del provider AI
```

✅ Power-user friendly
🔴 Utente deve aprire terminale + installare CLI
🟡 SSH passphrase = friction (skippiamo)
🟡 hcloud via REST: niente nuove dep, fetch nativo Node

## Path B3 — 🟢 Desktop app (target lungo termine)

```
   👤 utente apre JHT.app
        │
        ├─ Login Supabase (Google/GitHub)  ◀── già implementato in dev1
        │   token salvato in keychain OS
        │
        ├─ Wizard "Crea VPS Hetzner"
        │   ├─ paste Hetzner API token → keychain
        │   ├─ genera SSH keypair → keychain (NO passphrase)
        │   ├─ POST /servers (CPX22, Helsinki, Ubuntu 24.04, ssh_key)
        │   ├─ poll status until running
        │   ├─ ssh-via-libssh: curl install.sh | bash
        │   └─ ssh: jht setup --non-interactive --provider claude ...
        │
        └─ Status: "VPS pronta. Apri jobhunterteam.ai/profile"
              (mai più toccare il terminale)
```

✅ ✅ UX target finale, niente CLI per utente
✅ Riusa token Supabase OAuth come identità unica (app + dashboard + VPS pairing)
✅ Encrypted user blobs (dev1) → la config VPS sincronizza cross-device dell'utente
🔴 Più codice: hcloud REST client + SSH automation (`node-ssh` o `simple-ssh`)
🟡 Hetzner API token sta SOLO nel keychain locale, mai sul server

## Decisioni aperte

### 1. Hetzner API token: chi lo crea?

| Opzione | Pro | Contro |
|---------|-----|--------|
| 🟢 Utente lo crea sul portale + paste | Zero infra Leone-side, utente proprietario | Step manuale (apri portal, naviga a Security → API tokens, click Generate) |
| 🔴 OAuth Hetzner | UX perfetta | NON esiste OAuth pubblico Hetzner |
| 🟡 Reseller (Leone provisiona, utente paga sub) | UX top, billing semplice | Complessità contabile, anti-pattern per beta |

**Decisione provvisoria**: 🟢 user-provided API token, salvato in keychain.

### 2. SSH key: globale o per-VPS?

| Opzione | Pro | Contro |
|---------|-----|--------|
| 🟢 Una per VPS (rotabile) | Blast radius minimo se key compromessa | N key da gestire |
| 🟡 Una globale JHT | Setup più semplice | Compromise → tutte le VPS |

**Decisione provvisoria**: 🟢 una per VPS. La keychain OS le tiene tutte.

### 3. SSH passphrase

- 🟢 **Niente passphrase**. La key vive in keychain OS già protetta (Touch ID/Face ID/password OS)
- 🔴 Passphrase = ogni invocazione SSH richiede prompt utente → automation rotta

### 4. Identità unificata

- 🟢 **Token Supabase OAuth = identità unica** per:
  - App desktop (login)
  - Dashboard cloud (login)
  - VPS pairing token (generato dall'app post-login)
- Già parzialmente fatto: `[JHT-DESKTOP-LOGIN]` + `[JHT-DESKTOP-SYNC]` in dev1
- Manca cablare: il flusso "crea VPS da app" deve usare il pairing token già esistente invece di rifare un `jht cloud login` interattivo dentro la VPS

### 5. Rollout strategy

| Fase | Path | Audience |
|------|------|----------|
| Ora (beta 0) | B1 (Leone-assisted SSH) | Primi 5-10 beta tester reali |
| Beta 1 | B2 (CLI assistita) | Power-user che vogliono autonomia |
| v1 GA | B3 (Desktop full) | Utenti non-tech |

I 3 path **co-esistono**: la VPS provisionata da uno di essi rimane identica (stesso `install.sh`, stesso wizard, stesso pairing).

## Path NON valutati / scartati

- ❌ **Containers serverless Leone-hosted** (es. Fly.io / Railway con Leone come account holder): bello per UX ma billing centralizzato, GDPR sensitive (dati utente su account Leone), e legale-complicato.
- ❌ **Auto-provision via Stripe + webhook**: troppo complicato per beta, magari per v1+.

## Cosa NON viene mai chiesto all'utente

Indipendentemente dal path scelto:

- ❌ Mai password SSH root
- ❌ Mai chiavi private (passphrased o no)
- ❌ Mai dati sensibili in chiaro dentro file di config remoti
- ✅ Tutte le credenziali (Claude/OpenAI subscription, Telegram, Hetzner API) restano nel keychain locale o sul server bind-mounted con perms 0600

---

## Riferimenti

- `docs/internal/INFRA.md` — canali utente↔team, planned upgrade Telegram
- `docs/internal/2026-05-04-vps-deployment-design.md` — design 3 tier VPS
- `docs/internal/2026-05-12-document-channels-decision.md` — scelta canali documenti
- `docs/internal/2026-05-12-telegram-document-ingest-design.md` — design ingest TG
- `docs/internal/2026-05-12-vps-fresh-install-ux-fixes.md` — punch list UX install
- `BACKLOG.md` — `[JHT-VPS-FRIENDLY]`, `[JHT-DESKTOP-LOGIN]`, `[JHT-DESKTOP-SYNC]`
