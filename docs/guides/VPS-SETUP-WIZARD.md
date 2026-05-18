# VPS setup via wizard desktop — Path 2 (non-tech)

Guida user-facing per installare Job Hunter Team su una VPS Hetzner usando
**l'app desktop Electron** (no terminale, no SSH manuale). Validato end-to-end
il **2026-05-16** in modalità "fresh wipe" con 0 patch manuali necessarie
post-wizard.

> ℹ️ **Path 2** = "Desktop sul tuo Mac/PC + team che gira su VPS Hetzner remota".
> Vuoi solo CLI manuale via SSH? → [`VPS-SETUP.md`](VPS-SETUP.md) (path tech).
> Vuoi tutto in locale sul tuo PC, senza cloud? → [`quickstart.md`](quickstart.md).

## TL;DR

Apri l'app JHT Desktop → segui il wizard. A fine wizard ricevi **3 messaggi
di benvenuto su Telegram** (Assistente, Capitano, Mentor). Carichi il CV in
chat all'Assistente → entro ~30 min il team scrive i primi CV personalizzati
per posizioni reali.

Nessun comando da terminale lato utente.

## 🧰 Prerequisiti

Ti servono già pronti (5 minuti di preparazione):

| Cosa | Dove ottenerlo | Quanto ci vuole |
|---|---|---|
| **Account Supabase OAuth Google** | si crea col wizard al primo login | istantaneo |
| **3 token bot Telegram** | [@BotFather](https://t.me/BotFather) → `/newbot` × 3 (Assistente, Capitano, Mentor) | ~3 min |
| **Account Hetzner Cloud** | [console.hetzner.com](https://console.hetzner.com) — serve carta di credito | ~5 min |
| **Account provider AI** | Kimi (Moonshot, gratuito) oppure Claude/Codex subscription | dipende |
| **App JHT Desktop installata** | DMG da [jobhunterteam.ai/download](https://jobhunterteam.ai/download) | ~1 min |

> 💡 **Tip Telegram**: BotFather chiede a ogni `/newbot` un nome (visibile in
> chat, es. "Il mio Assistente JHT") e uno username (deve finire in `_bot`,
> es. `mio_assistente_jht_bot`). Salva i 3 token in un posto sicuro — il wizard
> te li chiederà copia-incolla.

## 🎬 Sequenza del wizard

Apri **JHT Desktop**. Il wizard ti porta attraverso questi step in ordine.

> 📸 **Screenshot mancanti**: questa guida non ha ancora screenshot dei 6 step.
> Vedi [§Materiali grafici](#-screenshot-todo) in fondo per i placeholder da
> riempire e contribuire.

### 1️⃣ Lingua + location

- Lingua: Italiano / English
- Location: scegli **"VPS"** (≠ Local / ≠ PC dedicato)

### 2️⃣ Login Supabase

- Click "Accedi con Google" → si apre il browser → autorizzi
- Torna nell'app, sei loggato

### 3️⃣ Token Telegram (3)

Incolla i 3 token che hai ottenuto da BotFather:
- **Bot Assistente** → ti aiuta a configurare il profilo, riceve il CV
- **Bot Capitano** → ti aggiorna sulle decisioni operative del team
- **Bot Mentor** → ti scrive una volta a settimana con analisi strategiche

> ⚠️ Il wizard verifica ogni token chiamando l'API Telegram. Se uno è invalido
> te lo segnala subito.

### 4️⃣ Provisioning VPS Hetzner

Due opzioni:

- **VPS esistente**: incolla l'IP pubblico di una VPS Hetzner che hai già
- **Nuova VPS**: crea sul portale Hetzner una `CPX22` (€9.75/mese, 4 GB RAM,
  Helsinki) con la SSH key che il wizard ti mostrerà, poi incolla l'IP

Il wizard fa SSH e gira `install.sh` automaticamente sulla VPS:
- scrive `host.env` (mode VPS)
- salva pairing-token in `/root/.jht/`
- allinea ownership UID 1001 (il container gira come `jht`)
- pull dell'image Docker GHCR `ghcr.io/leopu00/jht:latest`
- avvia il container con `docker compose up`

**Tempo**: 2-3 minuti la prima volta (pull image), 30s sulle successive.

### 5️⃣ Provider AI (OAuth)

Scegli il provider (Kimi consigliato, gratuito):
- Si apre un **terminale embedded** nell'app desktop con `kimi --yolo`
- Ti dà un codice device + link → apri nel browser → autorizzi
- Torna nell'app: vedi `OAuth completato ✅`

> ⚠️ **Importante**: aspetta che vedi "OAuth completato" prima di chiudere
> il terminale embedded. Se chiudi prima, il file `kimi.json` non viene
> scritto e il primo boot del container salta gli agenti
> (il watchdog ti recupera dopo 30s, ma è meglio aspettare).

### 6️⃣ Continue → bypass-to-home

Il wizard finisce. **Non devi cliccare niente sulla dashboard cloud.**

## 🎉 Cosa succede automaticamente (zero-touch)

Subito dopo che il wizard chiude:

```
T+0s    Container Docker già in esecuzione sulla VPS
T+15s   pid1: vede bot Telegram + active_provider + credentials OAuth
T+18s   tmux ASSISTENTE + CAPITANO + MENTOR partono in sequenza (kimi loaded)
T+19s   Telegram: 3 messaggi di benvenuto arrivano nei rispettivi bot
```

**Controlla Telegram entro 30 secondi**: devono arrivare 3 messaggi:
- da `@TuoAssistente`: «Ciao 👋 Sono l'Assistente… mandami il CV»
- da `@TuoCapitano`: «Sono il Capitano. Coordino il team che si occuperà di te…»
- da `@TuoMentor`: «Sono il Mentor 🧙‍♂️. Mi occupo del quadro generale…»

## 📄 Il workflow: dal CV ai primi 5 candidati

1. **Tu** → mandi il CV all'@Assistente via Telegram (PDF, DOC, anche foto)
2. **Assistente** (5-10 min) → estrae dati, scrive `candidate_profile.yml`,
   ti chiede dettagli mancanti (ruolo, città, stipendio target)
3. **Tu** → rispondi "ok procedi"
4. **Assistente** → passa la palla al Capitano
5. **Capitano** → spawna Scout, Analista, Scorer, Scrittore, Critico
6. **Pipeline** (~25-30 min per CV) → trova posizioni, le analizza, le scora,
   scrive CV personalizzato, Critico fa review iterativa (v1/v2/v3 finché
   non passa)
7. **CV PDF** generati in `/jht_user/cv/` sulla VPS, visibili anche su
   `jobhunterteam.ai/positions`

> ⏱️ **Tempi reali misurati** (sessione 2026-05-16): primo CV scritto dopo
> ~35 min dall'upload CV. 5° CV dopo ~2 h 16 min. Kimi è il collo di
> bottiglia (~2-5 min per LLM call), Claude/Codex sono più veloci ma a pagamento.

## 🖥️ Cosa vedi sulla dashboard web

Apri [jobhunterteam.ai](https://jobhunterteam.ai) (sei già loggato):

| Pagina | Cosa mostra |
|---|---|
| `/team` | Stato 9 agenti (running/stopped) — bottone Avvia/Ferma team |
| `/team/assistente` | Chat con l'Assistente (mirrored da Telegram) |
| `/team/capitano` | Chat con il Capitano |
| `/team/sentinella` | Grafico real-time usage Kimi + budget finestra |
| `/positions` | Posizioni trovate, scored, written, applied |
| `/candidate` | Tuo profilo estratto dal CV |

## 🛟 Troubleshooting comune

### ❌ "Scarica l'app desktop" sulla dashboard cloud invece del team

Il pair VPS↔Supabase non è andato a buon fine. Sintomo: dashboard vede
`user_onboarding_state.vps_setup_completed_at = NULL`.

**Cause possibili**:
- Hai fatto login Supabase con un account diverso da quello del browser
- L'install.sh sulla VPS è uscito con errore → controlla il log nell'app

**Fix**: SSH alla VPS e resetta la configurazione cloud, poi rilancia
il wizard dall'app desktop:
```bash
ssh root@<VPS_IP> 'jht reset creds'   # cancella cloud.json + token, preserva config
# poi nell'app desktop riapri il wizard
```
Vedi anche [§Manutenzione](#-manutenzione-operazioni-comuni-post-setup) per le opzioni `jht reset config|creds|full`.

### ❌ I 3 welcome Telegram non arrivano

Aspetta 60 secondi (il watchdog ritenta ogni 30s). Se ancora niente:
- Verifica di aver fatto `/start` ad ognuno dei 3 bot prima del setup
  (Telegram droppa silenziosamente messaggi a chi non ha mai iniziato la chat)
- Controlla che i token nei prerequisiti siano corretti

### ❌ Bottone "Avvia Assistente" resta in "In coda sulla VPS…" per > 60s

Il subscriber realtime sulla VPS non riceve eventi. Verifica:
- Container `jht` è UP sulla VPS (`ssh root@<IP> docker ps`)
- Network del bot Telegram funziona (Hetzner Helsinki ha buon throughput)

### ❌ Capitano risponde ma dice "LLM not set"

Bug noto kimi-cli (vedi
[bug strategici](../internal/2026-05-17-team-strategy-bugs.md) #1).
Già fixato con `KIMI_SHARE_DIR` export in `start-agent.sh`. Se vedi questo
errore, l'image GHCR è stale: ricreala con `docker compose pull && docker
compose up -d` via SSH.

## 🔐 Sicurezza e privacy

- **SSH key**: generata dal wizard, salvata in
  `~/Library/Application Support/jht-desktop/ssh/jht_ed25519` (Mac) o
  `%APPDATA%/jht-desktop/ssh/jht_ed25519` (Win). Non condividerla.
- **Token Telegram**: salvati cifrati in Supabase + replicati su VPS in
  `/root/.jht/jht.config.json` (mode 0644, leggibile solo da chi ha SSH alla VPS).
- **CV PDF**: persistiti su `/jht_user/cv/` sulla VPS + sincronizzati su
  Supabase Storage (RLS attiva, solo tu vedi i tuoi).
- **OAuth provider AI**: token in `/jht_home/.kimi/credentials/kimi-code.json`
  (o equivalente Claude/Codex). Mai pushati su Supabase, restano sulla VPS.

## 💰 Costi mensili

| Voce | Costo |
|---|---|
| Hetzner CPX22 | €9.75/mese |
| Supabase Free tier | €0 (sotto soglia 500 MB DB + 1 GB Storage) |
| Vercel Hobby | €0 (jobhunterteam.ai) |
| Telegram Bot API | €0 |
| Kimi (Moonshot) | €0 (con limiti finestra 5h) |
| Claude / Codex (opzionale) | €17-20/mese subscription |

**Totale tipico**: €9.75/mese con Kimi gratuito.

## 🔜 Cosa succede se chiudi l'app desktop

Niente di grave. L'app desktop è solo:
- Il wizard (lo usi una volta)
- Una shell per la chat locale (opzionale)
- Un monitor stato VPS

**Il team continua a girare sulla VPS Hetzner 24/7**. Tu interagisci col team
via Telegram (sempre) o via dashboard web jobhunterteam.ai (sempre).
L'app desktop ti serve solo per il primo setup e per manutenzione occasionale.

## 🛠️ Manutenzione (operazioni comuni post-setup)

> ⚠️ Tutte le operazioni di seguito si fanno via **SSH alla VPS**. La SSH key
> è in `~/Library/Application Support/jht-desktop/ssh/jht_ed25519` (Mac) o
> `%APPDATA%\jht-desktop\ssh\jht_ed25519` (Win). Usa:
> ```bash
> ssh -i "<path/jht_ed25519>" root@<VPS_IP>
> ```

### 📦 Aggiornare l'image del team (release nuove)

L'image GHCR `ghcr.io/leopu00/jht:latest` viene rebuildata ad ogni push su
master. Per pullare l'update sulla tua VPS:

```bash
ssh root@<VPS_IP> 'cd /root && docker compose pull && jht recreate'
```

Nota: `jht recreate` ricrea il container e perde le sessioni tmux attive
(saranno respawnate da pid1 + watchdog in ~30s). I dati su `/jht_home` e
`/jht_user` (CV, profilo, configurazioni) sono **bind-mountati e preservati**.

### 💾 Backup dei dati (CV, profilo, candidature)

Tutto è dentro `/jht_home` + `/jht_user` sulla VPS, già montati come bind mount.
Comandi `jht backup`:

```bash
ssh root@<VPS_IP> 'jht backup create'   # crea tarball in /jht_home/backups/
ssh root@<VPS_IP> 'jht backup list'     # lista backup esistenti
ssh root@<VPS_IP> 'jht backup restore <id>'

# Scarica un backup sul tuo Mac
scp -i <ssh-key> root@<VPS_IP>:/jht_home/backups/<file>.tar.gz ~/Downloads/
```

I CV PDF stanno in `/jht_user/cv/`, scaricabili anche singolarmente con `scp`.
Una copia sincronizzata vive anche su Supabase Storage (RLS attiva).

### 🔄 Cambiare provider AI (es. Kimi → Claude)

```bash
ssh root@<VPS_IP>
jht providers list             # vedi i provider supportati
jht providers use claude       # cambia active_provider in jht.config.json
jht providers update claude    # installa il CLI del nuovo provider
docker exec -it jht claude     # OAuth interattivo nel container
jht recreate                   # restart per ricaricare config
```

Dopo `jht providers use`, i 3 agenti user-facing (assistente/capitano/mentor)
ripartiranno col nuovo provider al prossimo respawn (max 30s, oppure subito
con `jht team restart`).

### 🤖 Ruotare i token Telegram

Se ti rubano un token o vuoi cambiare bot:
1. Vai su [@BotFather](https://t.me/BotFather) → seleziona il bot → `/revoke`
2. Crea il nuovo token con `/newbot` o `/token` su un bot esistente
3. Aggiorna `jht.config.json` sulla VPS:
   ```bash
   ssh root@<VPS_IP> 'nano /jht_home/jht.config.json'
   # modifica channels.telegram.bots.<role>.bot_token
   ```
4. Restart tg-bridge: `ssh root@<VPS_IP> 'jht recreate'`

### 🧹 Reset / destroy completo

`jht reset` ha 3 modalità (granularità crescente):

| Modalità | Cosa cancella | Quando usarla |
|---|---|---|
| `jht reset config` | jht.config.json (provider, bot, settings) | cambio setup completo |
| `jht reset creds` | cloud.json + token Supabase + OAuth provider | re-pair con altro account |
| `jht reset full` | tutto: config + creds + agents + sessions kimi | tabula rasa, "wizard nuovo" |

```bash
ssh root@<VPS_IP> 'jht reset full'   # conferma interattiva richiesta
```

Per il **destroy totale** della VPS:
1. `jht reset full` sulla VPS (per igiene, opzionale)
2. Dal portale Hetzner → seleziona server → **Delete**
3. Sul Mac: cancella `~/Library/Application Support/jht-desktop/`
4. Su Supabase: il tuo `user_id` resta, ma `user_onboarding_state` può essere
   azzerato dalla dashboard `/settings` web (TODO: feature non ancora esposta)

### 📋 Leggere i log (debug)

| Layer | Comando |
|---|---|
| Container completo (pid1 + agenti + daemon) | `ssh root@<VPS_IP> 'jht logs'` |
| Solo daemon push cloud | `ssh root@<VPS_IP> 'docker exec jht tail -50 /jht_home/logs/cloud-daemon.log'` |
| Solo tg-bridge (Telegram inbound) | `ssh root@<VPS_IP> 'docker exec jht tail -50 /tmp/tg-bridge-assistente.log'` |
| App desktop (Mac) | `~/Library/Application Support/jht-desktop/logs/jht-desktop-<ts>.log` |
| Sessioni Kimi (storico chat) | `ssh root@<VPS_IP> 'docker exec jht ls /jht_home/.kimi/user-history/'` |

### 🌍 Migrare a un'altra VPS / cambio region

Non c'è ancora un comando one-shot. Procedura manuale:
1. `jht backup create` sulla VPS vecchia
2. `scp` del tarball sul Mac
3. Provisioning nuova VPS (rilancia wizard, paste IP nuova)
4. `scp` del tarball sulla nuova VPS in `/jht_home/backups/`
5. `jht backup restore <id>` sulla nuova VPS
6. Cancella vecchia VPS dal portale Hetzner

## 📚 Approfondimenti

- [`docs/sessions/2026-05-17-vps-path2-e2e/`](../sessions/2026-05-17-vps-path2-e2e/README.md)
  — session report del test end-to-end con 27 fix tracciati
- [`docs/internal/2026-05-17-team-strategy-bugs.md`](../internal/2026-05-17-team-strategy-bugs.md)
  — bug strategici noti (Whisper/Vision, Sentinella throttle, gerarchia)
- [`docs/sessions/2026-05-17-budget-windows/`](../sessions/2026-05-17-budget-windows/README.md)
  — come il team gestisce le finestre budget Kimi (con grafici matplotlib)
- [`VPS-SETUP.md`](VPS-SETUP.md) — versione tech (CLI manuale via SSH)
- [`quickstart.md`](quickstart.md) — installazione tutto-in-locale

## 🐛 Bug noti (non bloccanti, validati 2026-05-17)

| Bug | Impatto | Workaround |
|---|---|---|
| Voice messages Telegram non trascritti | Capitano dice "non posso processare audio" | Scrivi a parole |
| Photo/screenshot Telegram non interpretati | Capitano dice "non ho OCR" | Descrivi a parole o link a `/positions` |
| Sentinella freeza team a 30% se proj > 100% (raro) | Pipeline ferma 30-60 min | Scrivi "riparti" al Capitano |
| Chat history non sincronizzata su web | Risposte agenti visibili solo su Telegram | Apri Telegram direttamente |

Vedi [bug strategici](../internal/2026-05-17-team-strategy-bugs.md) per dettagli e priorità fix.

## 📸 Screenshot TODO

Questa guida è user-facing ma **non ha ancora screenshot**. Placeholder per
contribuzioni future (PR benvenute):

| # | Screenshot atteso | Path target |
|---|---|---|
| 1 | Splash app + selezione lingua + location VPS | `docs/guides/assets/vps-wizard-01-splash.png` |
| 2 | Pulsante login Supabase + popup OAuth Google | `docs/guides/assets/vps-wizard-02-supabase.png` |
| 3 | Form 3 token Telegram con stato verifica | `docs/guides/assets/vps-wizard-03-telegram.png` |
| 4 | Step provisioning Hetzner (paste IP + SSH key da copiare) | `docs/guides/assets/vps-wizard-04-hetzner.png` |
| 5 | Terminal embedded con `kimi --yolo` + device code | `docs/guides/assets/vps-wizard-05-oauth.png` |
| 6 | Schermata "Setup completato" → bypass home | `docs/guides/assets/vps-wizard-06-done.png` |
| 7 | Dashboard `/team` con 9 agenti running | `docs/guides/assets/vps-dashboard-team.png` |
| 8 | Grafico `/team/sentinella` (UsageChart Kimi) | `docs/guides/assets/vps-dashboard-sentinella.png` |

Quando aggiungi le immagini, sostituisci i `> 📸 Screenshot mancanti` con
embed markdown: `![Step 1](assets/vps-wizard-01-splash.png)`.
