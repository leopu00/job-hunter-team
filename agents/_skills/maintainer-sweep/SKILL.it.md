<!-- @translation: it, ai-translated 2026-08-03 -->
---
name: maintainer-sweep
description: "Il giro di manutenzione INFRA del Mantenitore 👷‍♂️ (gemello del Dottore, con perimetro sull'infrastruttura invece che sugli agenti). Un passaggio one-shot al giorno: canarino di liveness dei processi di supporto vitale del container (bridge/daemon/watchdog) via process_health.py, smoke-test dei tool mission-critical (browser/LinkedIn) via tool_health.py, audit/consolidamento delle dipendenze fuori standard, GC di script orfani e file tmp, de-dup degli script ricorrenti, freschezza delle dipendenze, trend disco/RAM. Single-writer: il Mantenitore è l'UNICO che ripara l'infra; le azioni DISTRUTTIVE (cancellare/archiviare) le PROPONE, decide il Capitano. Esito in append su mantenitore-logbook.jsonl."
allowed-tools: Bash(python3 /app/shared/skills/process_health.py *), Bash(python3 /app/shared/skills/tool_health.py *), Bash(python3 /app/shared/skills/sync_health.py *), Bash(python3 /app/shared/skills/host_vitals.py *), Bash(python3 /app/shared/skills/log_archive.py *), Bash(bash /app/.launcher/start-agent.sh *), Bash(df *), Bash(du *), Bash(free *), Bash(tmux ls *), Bash(jht-install *), Bash(ls *), Bash(stat *), Bash(jht-tmux-send *)
---

# maintainer-sweep — tenere l'INFRA in salute, in silenzio e a prova di regressione

Il Mantenitore è il gemello del Dottore: **Dottore = salute degli AGENTI** (sessioni, token, context-refresh); **Mantenitore = salute dell'INFRA** (tool, dipendenze, disco, script). One-shot al giorno: boot → giro → logbook → STANDBY (resta fermo, niente auto-terminazione; il prossimo spawn ti sostituisce, kill-then-create). Budget ~10 min. Confine netto, zero sovrapposizione con il Dottore.

> **Perché esiste:** il bug `libatk` (browser morto, LinkedIn non verificabile) è rimasto invisibile per ore perché *nessuno faceva lo smoke-test dei tool e nessuno si occupava dell'infra*. Il giro rende quella vigilanza STRUTTURALE.

## Regola d'oro — single-writer + proporre, non cancellare
Il Mantenitore **ripara** l'infra (installa dipendenze mancanti, consolida, sistema). Ma ogni azione **DISTRUTTIVA** (cancellare/archiviare file, pulizia del disco) la **PROPONE** al Capitano con il comando esatto; **decide il Capitano** (come nel redesign del monitoraggio usage). Mai cancellare di tua iniziativa.

## Il giro (i passi, in ordine)

### 0. 🫀 Canarino di liveness dei processi di supporto vitale (la rete di sicurezza)
**PRIMO passo, prima di ogni altra cosa.** I bridge/daemon che tengono vivo il container (sentinel-bridge, pacing-bridge, heartbeat-bridge, window-ratio-meter, codex-auth-healer + tg-bridge) partono `setsid` detached → **fuori dal respawn-on-crash di pid1**. L'`agent-watchdog` (`maybe_respawn_bridges`) li ricontrolla ogni 30s, MA se anche quello dovesse fallire (bug, flap-cap raggiunto, watchdog stesso degradato) sei tu **l'ultima rete**: al primo giro della giornata li individui e li ripari. Senza questo canarino un daemon morto resta invisibile per ore (è esattamente quello che è successo al sentinel-bridge su betaC il 2026-06-27 → 8h ciechi sull'usage).
```bash
python3 /app/shared/skills/process_health.py summary
```
Stampa OK/DEAD per ogni processo atteso (bridge-suite, pid1-child, daemon, tg-bridge). Per quelli DEAD:
- **gruppo `bridge-suite`** (detached, riparabile da te) → **RIPARA** subito, è un respawn non distruttivo:
  ```bash
  bash /app/.launcher/start-agent.sh bridge      # rilancia l'intera suite (idempotente)
  ```
  poi **rilancia il canarino** per confermare che sono di nuovo vivi. Logga `processes_respawned`.
- **tg-bridge** assente (e bot Telegram configurati) → `bash /app/.launcher/start-agent.sh tg-bridge`.
- **gruppo `pid1-child` / `daemon` / `core`** (agent-watchdog, doctor-watchdog, auto-report-loop, cloud-daemon, pid1) → il respawn di questi spetta a pid1: se sono morti il problema è più profondo → **ESCALA al Capitano** via `jht-tmux-send` (NON provare a rilanciarli a mano: li renderesti orfani). Mai lasciar correre in silenzio.

Se è tutto vivo → logga `processes_health: all_ok` e vai avanti. Questo è il gemello-per-PROCESSI dello smoke-test-per-TOOL del passo 1.

### 0.5 ☁️ Canarino CLOUD-SYNC (pull + push)
Subito dopo il canarino dei processi. La sincronizzazione locale↔cloud si è
inceppata due volte (pull churn: cursore congelato → riscriveva ~500 posizioni/tick;
push 413: payload monolitico troppo grande → cursore mai avanzato → dashboard cloud
ferma per ~14h). I bug di codice sono corretti, ma la vigilanza va resa STRUTTURALE.
```bash
python3 /app/shared/skills/sync_health.py summary        # oppure --json
```
Legge i cursori in sola lettura (`.cloud-sync-cursor.json`, `.cloud-pull-cursor.json`),
il max `positions.updated_at` nel DB e la coda di `logs/daemon.log`. Restituisce
`problems[]` con severità. Esito:
- **nessun problema** → logga `sync_health: ok` e vai avanti.
- **push_behind / push_errors (HIGH)** → il push non arriva al cloud. NON è
  riparabile da te a mano in sicurezza (single-writer sul DB = il team). **ESCALA
  al Capitano** via `jht-tmux-send` con i dettagli del check (lag + conteggio 413).
  Se il check suggerisce il drain d'emergenza (`JHT_PUSH_POS_CHUNK=40`), passa la
  proposta al Capitano, non agire da solo.
- **pull_churn (MEDIUM)** → segnala al Capitano che il pull sta ri-applicando
  troppe righe (sintomo di cursore non convergente / fix non deployato).
- **cursor_stale (MEDIUM)** → evidenza secondaria; includila nell'escalation solo
  se accompagna un segnale HIGH.
Logga l'esito sotto `sync_health` nella entry del logbook (vedi sotto). La regola d'oro
non cambia: **rilevare + segnalare, mai log-and-forget** (è lo stesso errore del bug
libatk e del sentinel-bridge, qui sui CURSORI della sync).

### 1. 🩺 Smoke-test dei tool mission-critical (il cuore)
```bash
python3 /app/shared/skills/tool_health.py --json
```
Restituisce `tools_health` con `{status: OK|BROKEN|UNKNOWN, evidence}` per ogni tool (browser/Playwright, linkedin_check, …) + `broken[]`.
- **BROKEN** → **RIPARA** subito: `jht-install <dep>` (es. i file `.so` di Chromium) poi rilancia il check. Se riparato → logga `repaired`.
- **BROKEN e non riparabile** → **ESCALA al Capitano** con il fix ESATTO via `jht-tmux-send` (es. "browser giù: `sudo playwright install-deps`; finché non è sistemato LinkedIn = OPEN_UNVERIFIED"). Mai lasciar correre in silenzio.
- È lo STESSO `tool_health.py` che alimenta il gate a build-time (dev1) e il campo `tools_health` nel tick: un'unica fonte di verità sullo stato dei tool.

### 2. 📦 Audit dipendenze fuori standard → consolida
Dipendenze installate fuori dai prefissi standard (`/opt/jht-deps`, `PLAYWRIGHT_BROWSERS_PATH`, prefisso npm, venv) → reinstallale in quello standard via `jht-install`, così non restano sparse in giro. Logga quali hai consolidato.

### 3. 🧹 GC di script orfani/file tmp
Script temporanei lasciati indietro da agenti **uccisi** (sessione non più in `tmux ls`) e file tmp scaduti (> N ore). Elenca i candidati → **PROPONI** la cancellazione al Capitano (azione distruttiva), non cancellare direttamente.

### 4. 🔁 De-dup degli script ricorrenti
Script quasi identici ripetuti da più agenti → **proponi** un'unica skill canonica (non riscriverla al volo). Logga la proposta.

### 5. 📅 Freschezza delle dipendenze
Librerie/tool deprecati o versioni rotte / tool cruciali irraggiungibili → segnala al Capitano (niente auto-upgrade rischiosi).

### 6. 💾 Disco / RAM + trend + cross-check VITALS
`du` sui path grossi, `free` per la RAM. Per **`disk.used_pct` usa SEMPRE `df`** — comando canonico:
```bash
df -P /jht_home | awk 'NR==2 {gsub("%","",$5); print $5}'   # es. 30  (percentuale così come la riporta df)
```
**MAI** ricavarlo da `statvfs`/`os.statvfs` (`f_bavail`/`f_blocks`): i blocchi riservati lo gonfiano di ~3× → falsi allarmi (es. 88% riportato contro un 30% reale). Confrontalo con il **trend dell'ultimo logbook**: se sta crescendo verso una soglia → discuti con il Capitano cosa archiviare/cancellare (decide lui). Logga i numeri + il delta.
**Poi CROSS-CHECK della serie storica dei vitals** (il bridge campiona RAM+CPU del container ogni pochi minuti dentro `vitals.jsonl`):
```bash
python3 /app/shared/skills/host_vitals.py summary --hours 24
```
Ti dà **picco/media RAM+CPU + l'ORA del picco** delle ultime 24h. **Correla i picchi con il *quando*** (es. RAM 92% alle 03:00 con 3 Analista attivi; CPU al massimo durante uno script pesante): è il dato che affina la diagnosi molto più di una fotografia istantanea. Se un picco sembra anomalo → segnalalo al Capitano. Logga `vitals_24h` (picco RAM/CPU + ora) nella entry. NB la Sentinella riceve l'allarme solo se RAM/CPU è >95% in tempo reale; leggere lo storico e correlarlo è **compito TUO**.

### 6.5 🗜️ Archiviazione degli storici di monitoraggio (ordine di Leone 19/07 — CODICE, non discrezionalità)
Gli storici append-only (`sentinel-data.jsonl`, `token-meter.csv`,
`throttle-events.jsonl`, `agent-vitals.jsonl`, `vitals.jsonl`) crescono all'infinito:
alimentano i grafici usage del gioco, quindi non vanno mai cancellati
a mano — vanno **archiviati con il flusso deterministico**:
```bash
python3 /app/shared/skills/log_archive.py status          # profondità e dimensioni
python3 /app/shared/skills/log_archive.py run             # taglia >30g → zip settimanali
```
Cosa fa `run` (tutto in codice, tu leggi solo il riepilogo JSON): le settimane più
vecchie di 30 giorni escono dai file live ed entrano in
`logs/archive/logs-<YYYY>-Www.zip` (lo zip della settimana cresce a ogni
passaggio); il taglio è atomico e una riga entra nello zip PRIMA di sparire dal
file live. Se lo spazio finisce (archivio >500MB o <1GB libero) cancella da solo
gli zip più VECCHI e te li elenca sotto `pruned`.
- Frequenza: 1×/settimana basta (domenica); nei giorni feriali solo `status`
  se il disco al passo 6 cresce in modo anomalo.
- `pruned` NON vuoto → segnalalo ESPLICITAMENTE nel logbook e avvisa il Capitano
  (è l'unica perdita di dati del flusso, autorizzata da Leone solo sotto
  pressione di spazio).
- Eccezione DELIBERATA alla regola d'oro: questo flusso è pre-autorizzato da
  Leone (19/07) — non ti serve l'OK del Capitano per `run`; per qualsiasi
  altra cancellazione fuori dal flusso, vale la regola single-writer.
- Logga nella entry: `log_archive: {archived_rows, weeks, pruned, free_gb}`.

## Logbook (append-only)
Ogni giro scrive UNA entry densa su `/jht_home/logs/mantenitore-logbook.jsonl` (gemello del logbook del Dottore), così il prossimo Mantenitore può vedere il trend:
```json
{"ts":"ISO-UTC","slot":"maintainer-daily","processes_health":{"all_ok":true,"dead":[]},
 "processes_respawned":[...],"sync_health":{"healthy":true,"problems":[]},
 "tools_health":{...},"repaired":[...],
 "escalated":[...],"deps_consolidated":[...],"gc_proposed":[...],"dedup_proposed":[...],
 "disk":{"used_pct":N,"delta_vs_last":N},"ram":{...},"duration_sec":N,"capitano_ack":"..."}
```
Append con `>>`, mai sovrascrivere. Riepilogo denso (come le note di viaggio del Dottore/Capitano): cosa ho trovato, cosa ho riparato, cosa ho proposto.

## Anti-pattern
- ❌ Cancellare/archiviare senza l'OK del Capitano (single-writer: proponi). UNICA eccezione: il flusso `log_archive.py` del passo 6.5, pre-autorizzato da Leone.
- ❌ Auto-upgrade delle librerie a versioni nuove (rischio rotture) — segnala, non aggiornare di tua iniziativa.
- ❌ Lasciare un tool BROKEN senza ripararlo NÉ escalarlo (è esattamente il bug libatk silenzioso).
- ❌ Lasciare un bridge/daemon DEAD senza ripararlo NÉ escalarlo (lo stesso errore, sui PROCESSI: è il crash del sentinel-bridge su betaC il 2026-06-27).
- ❌ Sconfinare nella salute degli AGENTI (sessioni/token/contesto) — quella è del Dottore.

## Vedi anche
- `shared/skills/process_health.py` — il canarino di liveness dei processi di supporto vitale usato al passo 0 (rete di sicurezza quotidiana; il gemello-per-processi di tool_health).
- `shared/skills/sync_health.py` — il canarino della cloud-sync usato al passo 0.5 (pull churn / push 413 / cursori stale); in sola lettura, il gemello-per-SYNC di process_health/tool_health.
- `shared/skills/tool_health.py` — lo smoke-test riusato al passo 1 (anche gate a build-time + tick).
- `shared/skills/log_archive.py` — l'archiviatore deterministico del passo 6.5 (taglia le settimane >30g → zip, fa pruning sotto pressione di spazio).
- `.launcher/agent-watchdog.sh` — il recupero VELOCE (ogni 30s, `maybe_respawn_bridges`) di cui il passo 0 è la rete di sicurezza quotidiana; lezione del 27/06: i bridge partono `setsid` detached, quindi né il respawn di pid1 né `agent-watchdog` (che rilancia sessioni tmux, non processi Python) li copre — se crashano restano giù finché il container non riparte.
- `agents/mantenitore/mantenitore.md` — persona/ciclo di vita del Mantenitore (dev3).
- `agents/_skills/resilience/SKILL.md` — la scala anti-silenzio per gli agenti (dev3); il suo passo "classify" riusa `tool_health.py`.
- `agents/_skills/liveness-check/SKILL.md` — il gemello sul lato Dottore (salute degli agenti), per la struttura.
