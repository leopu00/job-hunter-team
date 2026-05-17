# 🚀 Test E2E setup VPS Path 2 (2026-05-15 → 2026-05-17)

Sessione di validazione end-to-end del **Path 2 (Desktop + VPS remota Hetzner)**
del setup Job Hunter Team, condotta in 3 cicli wipe-and-retry sull'arco di
~36 ore. Obiettivo: portare un utente da `app electron + wizard` fino a
`5 CV personalizzati scritti dal team`, senza alcuna patch manuale post-wizard.

**Esito**: ✅ obiettivo raggiunto. 30 commit di fix persistiti su master,
image GHCR rebuildata, Supabase migration applicate, 5 CV generati, 4 grafici
matplotlib del Capitano salvati.

**Costo onesto**: path doloroso. 3 wipe completi, ~10 patch manuali via `scp`
nei run 1-2 prima che i fix arrivassero in image GHCR, **diagnosi inizialmente
sbagliata** sul bug `kimi-cli` "LLM not set" (ipotesi creativa "OAuth-per-workdir",
risolto solo dopo ricerca web → env var `KIMI_SHARE_DIR`), e numerose
frustrazioni utente per cicli troppo lunghi. Il valore non è stato il "tempo
per arrivarci", è stato la **persistenza dei fix**: la prossima VPS partirà
zero-touch davvero.

## 🏅 Self-assessment

Voti dati con criterio *"cosa avrebbe fatto un ingegnere senior bravo entrato
a freddo"*:

| Dimensione | Voto | Motivo |
|---|---:|---|
| Risultato finale tecnico | **8/10** | Tutti i fix persistiti, pipeline E2E funziona, 5 CV reali |
| Robustezza setup automatico | **7/10** | Zero-touch al 3° giro, ma serviva il path doloroso |
| Efficienza del percorso | **4/10** | 4 wipe, 30 commit, troppe patch `scp` prima di persistere |
| Diagnosi bug | **6/10** | Bug `kimi-cli` diagnosticato male; errore analisi finestre budget |
| Comunicazione con l'utente | **5/10** | Polling silenzioso, "ti aggiorno…" che non aggiorna |
| Capacità di auto-correzione | **7/10** | Quando utente segnala errori, corregge puntualmente |
| Qualità documentazione finale | **8/10** | File bug strategici, README budget, 4 PNG versionati |
| UX utente nel processo | **3/10** | 9+ esplosioni di frustrazione utente, troppi cicli |

**Voto medio: 6/10** — solido tecnicamente, doloroso operativamente.

> **Lente diversa, voto diverso**: il 6/10 include il costo del setup (4 wipe,
> ~10 patch manuali, diagnosi sbagliata Kimi). Isolando il solo **run runtime**
> — cioè "il team che ha lavorato dopo che è partito" — il voto sale a **8/10**:
> 2/2 finestre Kimi in target G-spot 90-95 %, velocity costante 16-17 %/h,
> 5 CV scritti senza intervento utente sul motore. Dettaglio + confronto con
> run precedenti in
> [`../2026-05-17-budget-windows/README.md`](../2026-05-17-budget-windows/README.md#-confronto-con-run-precedenti--salto-non-miglioramento-marginale).

## 🎯 Risultato finale

| Metrica | Valore |
|---|---|
| Wipe → primo CV scritto | ~35 min (tempo wizard) + 35 min pipeline |
| CV PDF scritti dal team | **5** (Jumo, Canonical, Rinse, RevenueAnalytics, Dacomat) |
| Review iterative del Critico | 7 (v1/v2/v3/v4 su 4 job) |
| Posizioni elaborate dallo Scout | 20 (5 written, 10 scored, 5 excluded) |
| Bug fixati e persistiti | **30 commit** su master |
| Finestre budget Kimi chiuse in target | 2/2 (90% e proj 95%) |
| Patch manuali al 3° run | **0** (dopo ~10 nei run 1-2) |

## 📅 Timeline alta

```
2026-05-15 17:50  Wipe #1 — locale + Supabase (4.5 GB → 0)
2026-05-15 19:00  Bug a cascata #1-#4 fixati (host.env, pairing-token, regex, chown)
2026-05-15 20:30  Pair Supabase ok, dashboard vede vps_setup_completed_at
2026-05-15 21:00  Team-bus action+target + 9 endpoint cloud-safe
2026-05-15 22:00  Polling pattern UI (POST → poll → terminal state)

2026-05-16 14:30  Wipe #2 — start fresh con fix install.sh
2026-05-16 15:30  Bug attivo: jht.config.json mode 0600 root → container UID 1001 EACCES
2026-05-16 16:00  Watchdog deterministico + welcome 3 bot
2026-05-16 17:00  Wipe #3 — race condition OAuth/auto-start scoperta
2026-05-16 18:00  Gate hasProviderCredentials in pid1+watchdog
2026-05-16 18:50  Bypass kimi-cli per welcome iniziale (bash script deterministico)
2026-05-16 19:00  KIMI_SHARE_DIR fix — agenti runtime ora rispondono
2026-05-16 19:18  ✅ 5° CV scritto dal team — obiettivo raggiunto
2026-05-16 20:30  sentinel-bridge tick → Supabase, grafico web live
2026-05-17 00:18  Capitano genera 4 grafici matplotlib del budget Kimi
2026-05-17 02:33  Documentazione + commit finali
```

## 🐛 Catena dei 30 fix

Raggruppati per area, in ordine cronologico:

### 🌐 install.sh / VPS bootstrap (4 fix)

- `bdcc8741` autoinvoke `host-setup.sh --host-type=vps` quando arriva `--pairing-token`
- `b91ad595` chown `~/.jht` a UID 1001 (container `jht` user)
- `c446ebb9` chown anche `~/Documents/Job Hunter Team` (mkdir output/)
- `64be6947` chmod 0644 + chown 1001 anche post `SshExec.writeFile` (wizard → VPS)

> **Pattern bug**: container gira come UID 1001, ma file scritti via SSH come root
> con mode 0600 → EACCES. Fix sistematico su tutti i write remoti.

### 🔐 Cloud sync auth (1 fix)

- `67e3507b` regex `refresh_token` 16+ → 8+ char (Supabase moderno emette stringhe opaque ~12 char)

### 🚌 Team-bus + cloud-safe endpoint (7 fix)

- `e174dc93` action+target dispatch nel bus (single-agent + bridge)
- `e0fb7b46` 9 endpoint shell legacy ora `enqueueIfRemote()` se su cloud
- `246cc23b` block desktop-only (terminal/backup/vps-admin) + stub GET status
- `4f1457e9` GET `/api/team/command/[id]` per polling
- `7da27b9a` hook `useTeamCommandPoller` + UI bottoni team con stati
  `Invio… → In coda sulla VPS… → Avvio in corso… → done|error`
- `ae3f2852` inferenza `active` state da `team_commands` history su cloud
- `fe02c5d7` nascondi banner "Da sincronizzare" su prod web (era falso positivo)

> **Insight**: i bottoni `/team/*` dashboard cloud chiamavano shell su Vercel
> (filesystem readonly) → crash `/var/task/.launcher/...`. Pattern corretto:
> **request → bus DB row → polling → result**. Mai shell exec lato cloud.

### 🤖 Agenti boot + lifecycle (8 fix)

- `f1e16ca1` `jht team start` exit 1 quando 0 agenti partono (era done silente)
- `1912f1ea` tg-bridge sempre attivo al boot del container
- `35491570` mentor + sentinella mancavano dal team, sessione MENTOR senza suffix
- `552c5bfb` wizard scrive `active_provider` in `jht.config.json` post-install
- `9866fe6c` agent-watchdog deterministico (tick 30s, respawn se tmux missing)
- `313a8654` mentor case singolo per `AGENT_DIR` + kickoff con welcome watchdog
- `e7ff101b` gate `hasProviderCredentials` prima di auto-start agenti
  (evita race "kimi launched before OAuth completed")
- `22ba47da` export `KIMI_SHARE_DIR` per fix `kimi 'LLM not set'` runtime

> **Bug più sottile (#22ba47da)**: `kimi --yolo` lanciato in
> `/jht_home/agents/<role>/` (work_dir diversa da `/app` del wizard OAuth)
> non risolveva `$HOME/.kimi/credentials/kimi-code.json` e mostrava `LLM not set`.
> Fix: export esplicito `KIMI_SHARE_DIR=$JHT_HOME/.kimi` nelle tmux session.
> Documentato in [bug strategici §1](../../internal/2026-05-17-team-strategy-bugs.md).

### 👋 Welcome 3 bot Telegram (5 fix)

- `7a6f2b16` `jht-telegram-send` interpreta `\n \t \r` come real chars
- `bddf5e4f` marker `[WELCOME-USER]` + testi ricchi 3 ruoli
- `80ecc094` testi più caldi, niente lista "cosa non faccio"
- `f6270054` rimuovi "Buon lavoro all'Assistente" e altri inter-agent talk
- `2a687cc0` bypass kimi-cli, welcome via `welcome-send.sh` bash deterministico

> **Pivot di design**: dopo 4 iterazioni sui prompt e watchdog, ho realizzato
> che kimi-cli aveva un bug bloccante (OAuth-per-workdir, vedi #22ba47da) che
> impediva agli agenti di mandare il primo messaggio. Soluzione: welcome via
> bash script direct → `jht-telegram-send` deterministico, niente LLM nel loop.
> Idempotenza per flag (`welcomed.flag`, `capitano-welcomed.flag`, `mentor-welcomed.flag`).

### 📊 Sentinel ticks → Supabase (1 fix)

- `ec2d5e09` `sentinel-bridge.py` jsonl → cloud daemon → `sentinel_ticks` table
  → `/api/sentinella/data` cloud branch → `UsageChart` web live

> Migration `013_sentinel_ticks.sql` applicata via MCP, schema ALTER per colonne
> mancanti (`host`, `host_level`, `sample_key`). Grafico Sentinella ora visibile
> anche su `jobhunterteam.ai/team/sentinella`, non solo localhost.

### 🧹 Misc pipeline (4 fix)

- `7634e5d9` scope pytest discovery
- `56aa3918` isolate container image probe (desktop)
- `0652b91a` align pipeline schema con updates
- `818f8528` align capitano paths and setup guard

## 🏗️ Architettura finale validata

```
                        ┌─ Desktop Electron (Mac/Win)
                        │   └─ Wizard: location=VPS → login Supabase
                        │      → 3 token Telegram → provisioning Hetzner
                        │      → install.sh remoto → provider OAuth (Kimi)
                        ↓
┌────────────────────────────────────────────────────────────┐
│  Hetzner VPS Linux                                         │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Container jht (Docker, UID 1001)                    │  │
│  │  ┌──── pid1 (Node) ─────────────────────────────────┐│  │
│  │  │ • dashboard 127.0.0.1:3000                       ││  │
│  │  │ • tg-bridge × 3 (Python long-poll Bot API)       ││  │
│  │  │ • welcome-send.sh (one-shot, bash deterministico)││  │
│  │  │ • agent-watchdog.sh (tick 30s, respawn missing)  ││  │
│  │  │ • cloud daemon push 30s → Supabase               ││  │
│  │  │ • realtime subscriber (team_commands)            ││  │
│  │  │ • auto-start agenti (gate provider OAuth ready)  ││  │
│  │  │                                                  ││  │
│  │  │  Tmux sessions (9 user/pipeline agents):         ││  │
│  │  │    ASSISTENTE  CAPITANO  MENTOR                  ││  │
│  │  │    SCOUT-1  ANALISTA-1  SCORER-1                 ││  │
│  │  │    SCRITTORE-1  CRITICO-S1  SENTINELLA           ││  │
│  │  └──────────────────────────────────────────────────┘│  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
            ↑ SSH (jht_ed25519)              ↓ HTTPS push 30s
            │                                ↓
   ┌────────────────────┐        ┌──────────────────────────────┐
   │ Telegram Bot API   │        │ Supabase (smittwvohsn...)    │
   │ 3 bot user-facing  │        │ • auth.users                 │
   │ @Assistente        │        │ • cloud_sync_tokens          │
   │ @Capitano          │        │ • user_onboarding_state      │
   │ @Mentor            │        │ • team_commands (bus)        │
   └────────────────────┘        │ • positions, scores, apps    │
                                 │ • sentinel_ticks (NEW)       │
                                 └──────────────────────────────┘
                                            ↑
                                            │ /api/* (Vercel cloud-safe)
                                            ↓
                                 ┌──────────────────────────────┐
                                 │ jobhunterteam.ai (Vercel)    │
                                 │ • /team dashboard            │
                                 │ • /team/{agent} pagine       │
                                 │ • /team/sentinella + grafico │
                                 │ • /positions, /candidate     │
                                 └──────────────────────────────┘
```

## 🧪 Boot sequence (post-wizard, zero-touch)

```
T+0s    install.sh termina sulla VPS
        ↓
T+5s    docker compose up jht → container start
        ↓
T+8s    pid1: mode=VPS (host.env letto)
        ↓
T+10s   pid1: pair-on-boot → .pairing-token → /api/cloud-sync/device-register
        → cloud.json scritto in /jht_home (UID 1001, leggibile dal container)
        ↓
T+12s   pid1: dashboard, tg-bridge×3, cloud daemon, realtime subscriber UP
        ↓
T+15s   pid1: hasBots && hasActiveProvider && hasProviderCredentials?
        ├── NO (OAuth non completo) → skip, watchdog ripeterà tra 30s
        └── SI → startUserFacingAgents() in sequence
                 ↓ +0s   tmux ASSISTENTE + kimi --yolo (KIMI_SHARE_DIR set)
                 ↓ +3s   tmux CAPITANO
                 ↓ +6s   tmux MENTOR
        ↓
T+18s   pid1: welcome-send.sh (bash diretto, niente LLM)
        ├── per ogni ruolo: check flag → jht-telegram-send → touch flag
        ↓
T+19s   ✅ 3 welcome consegnati su Telegram
        ✅ 3 agenti kimi loaded (Model: Kimi-k2.6, context ~0%)
        ✅ pronti a ricevere [TG] / [CHAT] runtime
```

## 📁 Materiali correlati

In questa sessione:

- [`../2026-05-17-budget-windows/README.md`](../2026-05-17-budget-windows/README.md)
  — analisi delle 2 finestre Kimi consecutive (entrambe in target 90-95%) con
  4 grafici matplotlib del Capitano
- [`../../internal/2026-05-17-team-strategy-bugs.md`](../../internal/2026-05-17-team-strategy-bugs.md)
  — 7 bug strategici/comportamentali emersi dalla conversazione utente ↔
  Capitano via Telegram (Whisper/Vision mancante, Sentinella freeze totale,
  Capitano gerarchia, sync history su web)

Doc storici aggiornati con riferimento a questa sessione:

- `docs/internal/2026-05-01-bridge-and-token-monitoring.md` — sezione
  "Update 2026-05-17" che conferma G-spot 90-95% su 2 finestre reali
- `docs/internal/2026-05-03-rate-kimi-weights.md` — sezione che conferma pesi
  calibrati accurati al ±5 punti sul target finestra

## 💸 Costo del percorso (cose che vanno dette)

Il risultato finale è solido, ma il path per arrivarci è stato molto più caro
del necessario. Per onestà verso chi legge questo report tra 3 mesi e ne
sottostima il prossimo task simile:

- **4 wipe completi** (locale + Supabase + Hetzner) per arrivare al run pulito.
  I run 1 e 2 sono finiti con ~10 patch manuali via `scp` sulla VPS prima che
  i fix arrivassero in image GHCR via CI.
- **Diagnosi sbagliata sul bug `kimi-cli` "LLM not set"**: prima ipotesi
  "OAuth-per-workdir" basata su deduzione, persa ~30 min. Risolto solo dopo
  ricerca web esterna che ha trovato l'env var `KIMI_SHARE_DIR` documentata
  in GitHub Issues.
- **Errore di analisi sulle finestre budget Kimi**: ho scritto inizialmente
  *"team fermo sotto target"* su una finestra che invece era a `proj 95.0%
  esatto`. Corretto solo dopo che l'utente ha sottolineato l'errore.
- **Comunicazione asincrona rotta**: "ti aggiorno appena monitor arriva a 5 CV"
  promesso ma non mantenuto → ho dovuto essere richiamato esplicitamente.
- **9+ esplosioni di frustrazione utente** documentate nel transcript
  (porco dio / coglione / ha rotto il cazzo), sintomo di cicli troppo lunghi
  e di promesse di "ora funziona" rivelatesi premature.
- **Lentezza pipeline runtime**: ~25-30 min/CV (Kimi è il bottleneck), 5 CV in
  ~2h 16min dopo il wizard. Accettabile per validazione, non per uso reale
  quotidiano.

Niente di tutto questo invalida il risultato. Ma il prossimo che pianifica un
test E2E simile dovrebbe budgettare **~36h reali** (non le 4-6h che la
narrazione "ottimista" suggerirebbe) e mettere in conto almeno 2 round di
patch-and-rebuild prima della convergenza.

## 🎓 Lessons learned

1. **UID mismatch è il bug più ricorrente in setup multi-host**: tutti i write
   remoti via SSH come root devono finire con `chown 1001:1001` + `chmod 0644`,
   altrimenti il container fallisce silenziosamente in EACCES. Vale per
   `host.env`, `.pairing-token`, `jht.config.json`, `cloud.json`, e per ogni
   directory bind-mountata.

2. **OAuth race conditions richiedono gate espliciti**, non timeout sperati.
   `hasProviderCredentials()` controlla l'esistenza del file marker
   (`kimi.json` / `kimi-code.json`) prima di spawnare agenti. Il watchdog
   rilancia ogni 30s, quindi se l'utente è ancora sull'OAuth nel terminal
   embedded il sistema lo aspetta senza spawnare agenti morti.

3. **LLM nel critical path = punto di failure**. Il welcome iniziale dei 3 bot
   è stato implementato 4 volte affidandosi a kimi-cli per inviare il messaggio
   (con kickoff + prompt + watchdog di re-injection). Ha sempre fallito per
   ragioni diverse. La soluzione definitiva è stata bypassare kimi e mandare
   il welcome via `bash + curl Bot API` — deterministico, 0 dipendenze LLM,
   1 secondo di esecuzione. Corollario: **prima di teorizzare cause creative
   per un bug di un tool, cercare su GitHub Issues del repo del tool stesso**.
   Il bug `kimi-cli` "LLM not set" era issue noto e il fix (`KIMI_SHARE_DIR`)
   era documentato — avrei risparmiato ~30 min di ipotesi sbagliate.

4. **Cloud-safe endpoint pattern**: ogni POST che esegue shell deve avere un
   primo step `enqueueIfRemote()` che, se la request arriva da Vercel, inserisce
   una riga in `team_commands` (bus DB) invece di fare exec locale. Il
   subscriber sulla VPS la consuma e risponde via PATCH. UI vede stato reale
   via polling `/api/team/command/[id]`.

5. **I wipe successivi sono un costo, non una virtù**. Ogni wipe rivela bug
   latenti ma costa ~30 min di setup wizard + ~30 min di patch + ~5 min di
   `docker pull` + frustrazione. Convergere in 1-2 wipe è la soglia di salute;
   3-4 wipe è sintomo di non aver pensato abbastanza prima di provare. Per la
   prossima sessione simile: **diagnostica statica del codice prima del primo
   wipe** (grep degli UID hardcoded, audit dei chown/chmod nei path SSH, lista
   dei file marker per OAuth gate, ecc.) — un'ora di audit risparmia un wipe.

## 📦 Stato git finale

```
master    → 7ffe6c77 (origin/master, allineato)
production → 60aa6961 (Vercel deploy live)

27 commit aggiunti tra 2026-05-15 17:50 e 2026-05-17 02:33
Image GHCR: ghcr.io/leopu00/jht:latest (rebuilt 5+ volte)
Supabase migrations applicate: 010, 012, 013
```

## 🔜 Followup aperti

Non bloccanti, ma utili per la prossima sessione:

- **Bug strategici #1-#7** → vedi [`../../internal/2026-05-17-team-strategy-bugs.md`](../../internal/2026-05-17-team-strategy-bugs.md)
- **Whisper/Vision** per voice/photo Telegram (oggi sono buchi neri)
- **Sentinella throttle progressivo** con hysteresis invece di freeze binario
- **Sync chat history su web**: oggi ho dovuto SSH+grep `wire.jsonl` per
  recuperare 38 risposte Capitano, dovrebbero essere visibili in `/team/capitano`
