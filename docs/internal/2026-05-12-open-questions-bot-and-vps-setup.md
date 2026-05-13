# Open question: setup VPS via Desktop

**Data**: 2026-05-12 (round 1)
**Stato**: ancora aperto. Da rivedere prima del rilascio Desktop installer.

> Tema A (bot Telegram multi-agente) — decisioni del 2026-05-13 sono confluite in `docs/internal/bot-telegram.md`. Questo doc tiene solo il Tema B che resta aperto.

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

- `docs/internal/INFRA.md` — canali utente↔team
- `docs/internal/vps.md` — design VPS consolidato (host/container split, providers, install UX, lifecycle)
- `docs/internal/bot-telegram.md` — design bot Telegram multi-agente + ingest documenti
- `BACKLOG.md` — `[JHT-VPS-FRIENDLY]`, `[JHT-DESKTOP-LOGIN]`, `[JHT-DESKTOP-SYNC]`
