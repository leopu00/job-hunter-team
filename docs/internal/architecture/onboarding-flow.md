# 🚪 Onboarding flow JHT

**Data**: 2026-05-13 · aggiornato 2026-08-12
**Stato**: record storico del design originario. Per il comportamento corrente
di host e cloud vale
[`2026-08-12-execution-host-vocabulary-contract.md`](../2026-08-12-execution-host-vocabulary-contract.md):
PC locale e VPS sono host del runtime, mentre la sincronizzazione cloud è
separata e facoltativa su entrambi.

> Cross-cutting tra `bot-telegram.md` (tutti 3 obbligatori), `vps.md` (path VPS), e `[JHT-DESKTOP-LOGIN]`/`[JHT-DESKTOP-SYNC]` (sync Supabase). Doc dedicato perché tocca tutti e tre.

---

## 🛤️ Tre path di onboarding

### Path 1 — Desktop app + Local PC

Per utente non-tech che vuole tutto sul proprio PC.

### Path 2 — Desktop app + VPS Hetzner

Per chi vuole il team sempre on, indipendente dal PC personale.

### Path 3 — CLI guidato da AI agent (no desktop)

Per chi usa già Claude Code/OpenClaw/Codex. L'AI agent dell'utente guida il setup via `jht` CLI. **Desktop app non serve** in questo path.

---

## 📋 Sequenza originaria (desktop app)

La sequenza seguente conserva il contesto del design 2026-05-13. Non è un
runbook corrente: in particolare JHT non provisiona più una VPS e account
cloud e Telegram non sono prerequisiti del runtime.

```
1. 🏁  Splash + privacy notice

2. 🌍  Scelta location               ←── prima cosa, prima dei token
       ├─ Local PC
       └─ VPS Hetzner

3. ☁️  Login Supabase
       ├─ Local PC: opt-in (toggle anytime da settings)
       └─ VPS:      opt-in separato dal collegamento SSH
                    → abilita copia dati supportati + vista cloud

4. 🤖  Telegram bot — 3 token BotFather
       (Assistente + Capitano + Mentor, tutti obbligatori)

5. 🐳  Docker/Colima check
       ├─ Local PC: install Docker Desktop → eventuale riavvio PC
       └─ VPS:      skip (Docker arriva via install.sh sulla VPS)

6. 🖥️  VPS provisioning              ←── solo path VPS
       ├─ Wizard mostra step Hetzner inline (tutorial)
       ├─ App genera SSH keypair locale (passphrase opzionale)
       │  └─ se utente la setta, app la salva in keychain OS
       ├─ Utente: copia pubkey → Hetzner → crea VPS → paste IP nell'app
       ├─ App: ssh → install.sh sulla VPS
       │  ├─ con sync opt-in: pairing token dalla sessione Supabase
       │  └─ senza sync: nessun token cloud; il controllo resta via SSH
       └─ Reclaim "ho già la VPS": paste IP, app verifica match SSH key

7. 🔑  Provider AI login              ←── ULTIMO, sul host finale
       ├─ Container parte sul host scelto (locale o VPS)
       ├─ App apre terminal embedded → docker exec sul container
       │  └─ Local: `docker compose run --rm jht <binary> <loginArgs>`
       │  └─ VPS:   `ssh -tt root@ip docker exec -it jht <binary> <loginArgs>`
       │     (T1 SshExec.openPty + T3 renderer host/vpsIp routing,
       │      merge `187dbefb`)
       ├─ Provider install: `npm install -g <pkg>` su container scelto
       │  └─ VPS: pre-flight container up + chown npm dirs (T2 fix EACCES,
       │     merge `3500f8b8`)
       ├─ Utente fa login interattivo (Claude/Codex/Kimi)
       └─ Token salvato direttamente sul host scelto
       (`[JHT-DESKTOP-LOGIN]` chiuso 2026-05-13 dal protocol-vps-refactor)

8. ✅  First team start
```

> **Stato implementazione 2026-05-13** (protocol-vps-refactor, master = `fd1f7e6d`):
> - T1: `desktop/vps/ssh-exec.js` helper centralizzato (`run`/`runStream`/`openPty`/`writeFile`/`forIp`)
> - T2: `installProvidersViaSsh` con pre-flight container up + chown npm dirs
> - T3: `terminal:start` location-aware → PTY remoto per OAuth provider
> - T4: step `STEP_TELEGRAM_TOKENS` con `verifyBot` + `saveBotsToVps` (writeFile su `/root/.jht/jht.config.json`)
>

---

## 🤔 Perché questa sequenza

### Location PRIMA dei token (non viceversa)

Il provider AI login richiede il container già acceso → richiede location già scelta. Se generassimo il token in container locale "per poi spostarlo" su VPS, sarebbe **anti-pattern**:
- Refresh token e OS keychain binding sono fragili al trasferimento
- A volte invalidano la sessione e l'utente deve rifare il login
- Genera complessità di stato (token "in transit")

Generare il token direttamente sul host finale = zero migrazione, zero stato intermedio.

**Costo accettato**: l'utente che cambia idea dopo (es. da Local a VPS) deve rifare il setup. È un'azione consapevole, non un click accidentale.

### Sync separato dal path

Il runtime non dipende dal cloud: il PC locale gira direttamente e la VPS è
controllata via SSH. Su entrambi gli host il sync è **puramente UX** (vuoi
copiare i dati supportati nella dashboard accessibile da altri device?), quindi:
- Opt-in durante onboarding (mostra il valore reale: copia dati supportati e vista cloud)
- Toggle accessibile **sempre** da settings, non solo in onboarding
- L'utente può abilitarlo/disabilitarlo senza cambiare l'host o riconfigurare il team

### AI-agent path solo CLI

Doppio canale di guida (AI agent + desktop app) confonde. Chi usa un AI agent personale sta già operando da terminale: aggiungere una GUI è dissonante. Path 3 = il classico `jht` CLI driven da AI agent senza nessuna integrazione desktop.

---

## 🔄 Toggle sync post-onboarding

L'utente che dopo X giorni vuole abilitare sync, su PC locale o VPS:

```
Settings → Cloud sync → "Abilita sync con il cloud"
                       └─ Login Supabase Google/GitHub
                       └─ App pulisce dati locali sensibili (config solo) → push cifrato
                       └─ Dashboard ora raggiungibile anche da web
```

Funziona anche al contrario (disable sync, dati restano solo locali).

---

## 🌐 Path 3: AI-agent CLI flow (no desktop)

L'utente:
1. Installa Docker/Colima sulla sua macchina
2. Lancia il suo AI agent (Claude Code, OpenClaw, Codex, ecc.) sul progetto
3. Chiede "setup JHT for me"
4. L'AI agent usa `jht` CLI per:
   - Scegliere location (chiede all'utente)
   - Configurare Telegram bot (chiede i 3 token; spiega come crearli su BotFather)
   - Eventualmente provvedere VPS Hetzner (chiede API token, gestisce SSH)
   - Lanciare wizard `jht setup` per provider login (interattivo)
5. Team avviato

**Garanzia di equivalenza**: stesso identico backend del Path 1/2. Il `jht` CLI è la "verità", la desktop app è una GUI sopra.

> ✅ **Runbook eseguibile** in `docs/guides/AI-AGENT-INTEGRATION.md` § "Setup runbook" (merge dev2, commit `bae27059`): contiene i passi esatti che un AI agent deve eseguire (Docker check, install CLI, location, sync opt-in, 3 token Telegram, `jht setup`, `jht team start`, `jht doctor`).

---

## 🔒 Decisioni lockate (2026-05-13 sera)

### Sync nel Path 2 (VPS) — decisione superata il 2026-08-12

Il vecchio design usava Supabase come prerequisito del Path 2. Il contratto
corrente separa i piani: la VPS ospita il runtime ed è controllata via SSH;
il pairing cloud copia soltanto i dati supportati ed è opt-in, disabilitabile
e ripetibile in seguito con `jht cloud login`. Saltarlo o fallirlo non blocca
la configurazione del provider né l'avvio del team.

### Reclaim VPS da nuovo PC — decisione storica, superata il 2026-07-26

> Questa sezione descriveva il comportamento del vecchio onboarding. La native
> app ora supporta il trasporto esplicito e transazionale **locale → VPS, VPS →
> VPS e VPS → locale** dalle Impostazioni. Il flusso corrente, comprese garanzie
> e limiti, è documentato in `docs/guides/VPS-SETUP-WIZARD.md`.

Il fallback storico, utile quando la chiave SSH originale è stata persa, resta:

```
nuovo PC → desktop app → login Supabase (stesso account)
  → cloud sync ha già: profilo + jobs.db + config team
  → l'utente cancella la vecchia VPS dal portale Hetzner
  → wizard "Crea VPS Hetzner" genera VPS nuova
  → app re-seedare i dati dal cloud sulla VPS nuova
```

Perché funzionava nel vecchio design:
- Presupponeva che i dati fossero già sincronizzati su Supabase. Oggi questa
  assunzione vale solo se l'utente ha attivato il sync; il recupero senza sync
  dipende dai backup verificati e dal trasporto SSH documentato nel runbook corrente.
- Costo accettato: 24h-48h di ridondanza Hetzner (vecchia VPS attiva finché l'utente non la cancella manualmente). È pulizia utente, non automation app.
- Niente codice "reclaim VPS esistente via Hetzner API + re-iniezione SSH key" — superato dal wipe+ricreate.

Il vecchio ticket `[JHT-DESKTOP-RECLAIM]` resta annullato: non serve un reclaim
via API Hetzner, perché la migrazione usa SSH quando la chiave è disponibile e
il wipe+ricreate resta il recupero quando non lo è.

---

## 🔗 Riferimenti

- `docs/internal/architecture/bot-telegram.md` — decisione Telegram 3 bot obbligatori (2026-05-13 rev2)
- `docs/internal/ops/vps.md` — design VPS (provisioning, providers, install UX)
- `docs/guides/AI-AGENT-INTEGRATION.md` § "Setup runbook" — Path 3 eseguibile per AI agent
- `BACKLOG.md` — `[JHT-DESKTOP-LOGIN]`, `[JHT-DESKTOP-SYNC]`, `[JHT-VPS-FRIENDLY]` (`[JHT-DESKTOP-RECLAIM]` annullato 2026-05-13)
