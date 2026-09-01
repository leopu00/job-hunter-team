# PR #214 — Rischio 3/5: il valore `timeout 20` è troppo basso?

> Analisi sola lettura. Nessun file sorgente modificato, nessun test eseguito.
> Riferimento: commit `1e45cd7d42` — *fix(launcher): bound tmux new-session with a timeout to prevent a permanent spawn lockout*.

---

## 🔴 Verdetto

**Il rischio è REALE ma di severità media, e il numero `20` è arbitrario — non deriva da nessuna misura né da nessun altro valore del sistema.**

Nel file esiste un solo altro `timeout` (`timeout 30 claude`, `.launcher/start-agent.sh:985`), e il messaggio di commit dichiara esplicitamente di seguire *"the same pattern already used for the CLI health check a few lines up"* — ma poi usa **20** invece di **30**. Già solo questo è un'incoerenza interna al patch.

**Valore raccomandato: `45` secondi**, esposto come `JHT_SPAWN_TMUX_TIMEOUT_SEC` (default 45), **più l'innalzamento di `flock -w` da 30 a 75s** (`JHT_SPAWN_LOCK_WAIT_SEC`).

Precisazione importante per il proprietario: l'intuizione *"un agente ci potrebbe mettere anche il doppio a partire correttamente"* è corretta **ma riguarda una fase che questo timeout NON copre** (vedi §1). Il timeout misura solo la creazione della sessione tmux vuota, non l'avvio dell'agente. Per questo il numero giusto non è "il doppio del tempo di boot di un agente" (che sarebbe 2-4 minuti), ma un multiplo generoso del tempo di una manciata di syscall su un filesystem lento.

---

## 1. 🧭 Cosa misura davvero questo timeout — (a) vs (b)

La riga sotto esame:

```
.launcher/start-agent.sh:1120
  if ! timeout 20 tmux new-session -d -x 220 -y 50 -s "$SESSION" -c "$AGENT_DIR"; then
```

### (a) Ciò che il timeout copre — `tmux new-session -d`

`-d` significa **detached**: il comando non attende nulla dell'agente. Il lavoro reale è:

1. **Cold start del server tmux** — solo alla PRIMA `new-session` della vita del container. `tmux` non è preavviato in nessun punto: non c'è `tmux start-server` né un `tmux.conf` nell'immagine (`Dockerfile:78` installa solo il pacchetto; nessun match per `tmux.conf` / `TMUX_TMPDIR` in `.launcher/`). Il client forka il server, che crea il socket in `/tmp/tmux-<uid>/` — **overlay fs del container, non bind mount** → veloce anche su Windows. Il server però fa anche `stat()` su `$HOME/.tmux.conf` e `$XDG_CONFIG_HOME/tmux/tmux.conf`, e `HOME=/jht_home` (`docker-compose.yml:38`) **è il bind mount**.
2. **Risoluzione + `chdir` di `-c "$AGENT_DIR"`**. `AGENT_DIR="$JHT_AGENTS_DIR/$AGENT_NAME"` (`.launcher/start-agent.sh:820`) e `JHT_AGENTS_DIR="$JHT_HOME/agents"` (`.launcher/config.sh:15`) → **`/jht_home/agents/<role>`, dentro il bind mount** `${HOME}/.jht:/jht_home` (`docker-compose.yml:115`).
3. **Fork della shell del pane**, che legge i propri rc file da `$HOME` → di nuovo il bind mount.
4. Registrazione della sessione + ritorno del client.

Quanto può durare, realisticamente? Il repo contiene una misura diretta della lentezza di quel mount (`docker-compose.yml:96-102`):

> *"Su Windows /jht_home e' C:\ visto attraverso WSL2: scrivere li' dentro costa ~158x piu' che sul disco del container (misurato su T440s: 200 file piccoli = 11.209 ms contro 71 ms)"*

Cioè **~56 ms per operazione su file piccolo nel caso peggiore misurato**. `new-session -c` fa nell'ordine di 10-40 operazioni su quel path (config, resolve, chdir, rc della shell):

| Scenario | Stima `tmux new-session -d` |
|---|---|
| Linux / macOS, mount locale | < 100 ms |
| Windows/Docker Desktop, mount tiepido | 0,2 – 2 s |
| Windows, cold start server + mount freddo | 2 – 6 s |
| Windows, host saturo (AV scan, coda disco, altra I/O pesante) | 10 – 25 s |
| Mount 9p/gRPC-FUSE **stallato** | ∞ (il caso dell'incidente) |

**La distribuzione è bimodale, non a coda lunga**: o finisce in pochi secondi, o non finisce mai. Il caso patologico documentato nel commit è *"one 15+ hour orphaned tmux new-session process"*. Questo è il punto decisivo per la scelta del numero: il `timeout` qui è un **rilevatore di hang**, non un budget di latenza. Ma la riga "host saturo" della tabella mostra che **20 s cade dentro la zona grigia**, e la memoria di progetto conferma che questo PC ha già avuto due blocchi I/O totali. L'intuizione del proprietario è quindi legittima.

### (b) Ciò che il timeout NON copre — l'agente operativo

Tutto il resto avviene DOPO la riga 1120 e non è dentro il `timeout`:

- `send_env_vars` + invio del comando CLI (`.launcher/start-agent.sh:1127-1128`);
- il loop di auto-risposta ai prompt TUI: **60 iterazioni × 2 s = 120 s** (`:1144-1176`), commentato *"Il dialog appare 5-30s dopo il CLI start; 120s copre anche partenze lente"*;
- il kickoff, che chiama `tui_wait_ready` con **max_wait 120 s** di default (`.launcher/tui-helpers.sh:19`, invocato a `:1267`);
- il welcome watchdog, **3 retry × 90 s = 270 s** (`:1321-1330`).

**Il tempo (b) è già coperto da budget di 120-270 s, del tutto separati.** Se un agente "ci mette il doppio a partire", quel raddoppio consuma i 120 s del loop TUI e i 120 s di `tui_wait_ready`, **non i 20 s della riga 1120**. Il timeout in discussione non va dimensionato su (b).

---

## 2. 📊 Censimento dei timeout e delle attese legati allo spawn

### `.launcher/start-agent.sh`

| Riga | Meccanismo | Valore | Cosa limita |
|---|---|---|---|
| `:383` | `flock -w 30 9` | **30 s** | Attesa lock spawn tg-bridge |
| `:418` | `9>&-` sul figlio detached | — | Chiude il fd del lock nei figli (**presente solo qui**) |
| `:548` | `flock -w 30 9` | **30 s** | Attesa lock spawn `start-<SESSION>.lock` |
| `:985` | `timeout 30 claude … -p "ok"` | **30 s** | Warmup `.claude.json` (solo primo spawn) |
| `:1082,1084` | `sleep 2`, `sleep 1` | 3 s | Stabilizzazione ramo PowerShell/WSL |
| `:1098` | `sleep 8` | 8 s | Trust dialog, ramo PowerShell/WSL |
| **`:1120`** | **`timeout 20 tmux new-session`** | **20 s** | **oggetto di questa analisi** |
| `:1152-1157` | loop `60 × 2 s` (+`sleep 1`, `sleep 2`) | **120 s** | Auto-risposta prompt TUI (fase b) |
| `:154-168` | loop `6 × 2 s` (ramo worker) | 12 s | Prompt TUI del SENTINELLA-WORKER |
| `:179-185` | `seq 1 12` + `sleep 1` | **12 s** | Verifica che il REPL del worker sia partito |
| `:1322` | `3 × sleep 90` | **270 s** | Welcome watchdog (fase b) |
| `:133` | `tmux new-session` (ramo worker) | **nessun timeout** | ⚠️ asimmetria |
| `:1081` | `tmux new-session … powershell.exe` | **nessun timeout** | ⚠️ asimmetria |

### Altri file `.launcher/`

| File:riga | Meccanismo | Valore |
|---|---|---|
| `tui-helpers.sh:19,70-85` | `tui_wait_ready` `max_wait` / `min_boot` / `window` / `needed_stable` | **120 s** / 5 / 2 / 3 |
| `tui-helpers.sh:113,135-147` | `tui_send_verified` retry | 3 × (~3,4 s) |
| `agent-watchdog.sh:59` | `JHT_AGENT_WATCHDOG_INTERVAL` | **30 s** per tick |
| `agent-watchdog.sh:64` | `JHT_SENTINELLA_MAX_CTX_AGE_H` | 24 h |
| `agent-watchdog.sh:66` | `JHT_AGENT_MAX_SESSION_AGE_H` | 12 h |
| `agent-watchdog.sh:341` | `sleep 12` prima del kickoff post-respawn | 12 s |
| `agent-watchdog.sh:350` | `bash "$START_AGENT" …` | **nessun timeout** (attesa illimitata) |
| `agent-watchdog.sh:641` | `JHT_CONFIG_NOT_READY_GRACE_TICKS` | 10 tick (~5 min) |
| `agent-watchdog.sh` | `JHT_BRIDGE_FLAP_CAP` / `JHT_BRIDGE_FLAP_WINDOW_SEC` | 3 / 600 s |
| `pager-unstick-watchdog.sh:30` | `JHT_PAGER_WATCHDOG_INTERVAL` | 20 s |
| `spawn-lib.sh:365-366` | `seq 1 12` + `sleep 1` | 12 s |
| `spawn-lib.sh:401-406` | catena `sleep 6/3/3/4/1/2` | 19 s |
| `spawn-doctor.sh:47`, `spawn-maintainer.sh:47` | `tmux new-session` | **nessun timeout** ⚠️ |
| `codex-auth-healer.sh:135` | `flock -n 9` (non bloccante) | 0 s |

### `cli/src/commands/` e helper

| File:riga | Meccanismo | Valore |
|---|---|---|
| `cli/src/utils/container-proxy.js:94` | `timeoutMs` di default per ogni `docker exec` | **30 s** |
| `cli/src/commands/team/start.js:295` | `timeoutMs` per `start-agent.sh` | **90 s** |
| `cli/src/commands/team/start.js:67-84` | `preDelayMs` bootstrap (5+3+20+5+3+5) | 41 s |
| `cli/src/commands/team/start.js:173-209` | preflight vari | 15 s ciascuno |
| `cli/src/commands/team/start.js:397` | `sleep 4 … sleep 3` (ramo host) | 7 s |
| `cli/src/commands/container.js:94` | attesa Docker Desktop pronto | 90 s |

**Osservazione chiave**, dal commento a `cli/src/commands/team/start.js:292-295`:

> *"Cold starts can spend close to 30s in provider/config preflight before start-agent.sh confirms the tmux session. The generic container helper default was therefore a race that surfaced as an empty 'unknown error'."*

Cioè: **è già documentato che il tratto di script che precede la riga 1120 può da solo avvicinarsi ai 30 s**.

---

## 3. ⛓️ Il vincolo di coerenza col `flock -w 30`

### La regola

Il lock è preso a `.launcher/start-agent.sh:547-548` e rilasciato solo quando muore l'ultimo processo che tiene aperto il fd 9. La regola di coerenza è:

> `flock -w` (pazienza di chi attende) **deve essere maggiore** del tempo massimo di detenzione del lock. Altrimenti chi attende si arrende PRIMA che il detentore molli, e un ritardo legittimo del detentore si manifesta agli altri come `"timed out waiting for the concurrent spawn"` (`:549`) — un errore che *incolpa la concorrenza* mentre la causa è la lentezza.

### La sezione critica reale è già più lunga di 30 s

Dentro il lock (`:548` → fine script) stanno:

| Tratto | File:riga | Costo peggiore |
|---|---|---|
| preflight provider/config | `:564`-`:800` | ~30 s (per il commento in `start.js:292`) |
| copia skill: `rm -rf` + `cp -R` nel bind mount | `spawn-lib.sh:224-264` via `start-agent.sh:964` | secondi → decine di secondi su Windows (path a 158×) |
| warmup `claude -p "ok"` | `:985` | **30 s** |
| `tmux new-session` | `:1120` | **20 s** (oggi) |
| roster + arming stagger | `:1221`, `:1203` | secondi |

**Somma peggiore: ben oltre 80 s, già oggi, con `timeout 20`.** Il `flock -w 30` è quindi **già sottodimensionato prima di PR #214**: il patch non introduce l'incoerenza, la peggiora di poco.

### 🐛 Aggravante trovata: il fd 9 esce dal processo (bug preesistente)

Il commento a `.launcher/start-agent.sh:403-407` spiega perfettamente il problema… e poi la lezione viene applicata **solo al ramo tg-bridge**:

```
:403  # `9>&-` NON è decorativo: il lock di flock vive nella *open file
:404  # description*, che i figli EREDITANO. I bridge sono detached e restano vivi
:405  # per giorni, quindi senza questa chiusura il fd 9 resta aperto in loro e il
:406  # lock non viene mai rilasciato
...
:418      " >/dev/null 2>&1 < /dev/null 9>&- &      ← chiuso QUI
```

Sul ramo principale, invece, **manca**:

- `:1178` → `' >/dev/null 2>&1 < /dev/null &` — il watcher TUI `setsid` vive fino a **120 s** e eredita il fd 9;
- `:1277` → `' </dev/null &` — il kickoff `setsid` vive fino a **120 s** (`tui_wait_ready`);
- `:1334` → `' </dev/null &` — il welcome watchdog `setsid` vive fino a **270 s**.

Conseguenza: **il lock `start-<SESSION>.lock` resta detenuto fino a ~4,5 minuti dopo l'uscita di `start-agent.sh`**, contro una pazienza di 30 s. Ogni tentativo di respawn della stessa sessione in quella finestra fallisce con `"concurrent spawn"` — la stessa firma d'errore che PR #214 dice di voler eliminare.

### La coppia coerente

Ordinando dal budget più esterno a quello più interno:

```
docker exec (CLI)          90 s   ← start.js:295, fissato
  └─ flock -w              75 s   ← 90 − 15 s di margine per exec/report
       └─ warmup claude    30 s   ← :985
       └─ tmux new-session 45 s   ← :1120  (raccomandato)
```

- `flock -w 75` **> 45** → chi attende resiste oltre il tempo massimo che il detentore può bruciare nel passo più lungo;
- `flock -w 75` **< 90** → la CLI non uccide il `docker exec` prima che l'errore vero sia stampato, quindi l'utente legge `"timed out waiting for the concurrent spawn"` invece dell'`"unknown error"` vuoto che `start.js:292-295` cita come regressione già vista.

⚠️ **Prerequisito**: la coerenza `flock` resta teorica finché non si aggiunge `9>&-` ai tre `setsid` di `:1178`, `:1277`, `:1334`. Senza quella riga, qualunque valore di `flock -w` inferiore a 270 s è aritmeticamente sconfitto dal welcome watchdog.

---

## 4. ✅ Raccomandazione

### Valore: `45` secondi, con override

```
JHT_SPAWN_TMUX_TIMEOUT_SEC   default 45   → sostituisce il 20 letterale a :1120 e :1121
JHT_SPAWN_LOCK_WAIT_SEC      default 75   → sostituisce il 30 letterale a :548 (e :383)
```

Le convenzioni di naming JHT esistenti confermano la forma (suffisso di unità, default inline `${VAR:-N}`): `JHT_AGENT_WATCHDOG_INTERVAL` (30), `JHT_PAGER_WATCHDOG_INTERVAL` (20), `JHT_BRIDGE_FLAP_WINDOW_SEC` (600), `JHT_BRIDGE_ESCALATE_COOLDOWN_SEC` (3600), `JHT_SENTINELLA_MAX_CTX_AGE_H` (24), `JHT_AGENT_MAX_SESSION_AGE_H` (12), `JHT_CONFIG_NOT_READY_GRACE_TICKS` (10), `JHT_DOCTOR_WATCHDOG_MAX_TICKS` (0). Il prefisso `JHT_SPAWN_*` è già in uso in `spawn-lib.sh` (`JHT_SPAWN_SESSION`, `JHT_SPAWN_PROMPT`).

### Perché 45 e non 20

1. **Il caso sano è < 2 s** (§1). 45 s è ~25× il p99 sano: nessun costo sul percorso di successo, esattamente come rivendica il commit (*"a normal spawn still completes immediately, well under the 20s bound"*) — la rivendicazione resta vera a 45.
2. **20 s cade dentro la fascia "host saturo" della tabella §1** (10-25 s). 45 s la scavalca con ~2× di margine, misurato sul solo dato quantitativo che il repo possiede (56 ms/op, `docker-compose.yml:96-102`).
3. **45 > 30**, quindi supera il warmup `claude` (`:985`), che è il passo bloccante paragonabile già accettato nello stesso script. Un numero *inferiore* al vicino di 135 righe sopra è indifendibile: il commit dichiara di seguirne il pattern e poi lo contraddice.
4. **45 s è comunque metà del budget del chiamante** (90 s, `start.js:295`), quindi non introduce un nuovo troncamento a monte.
5. **Non serve arrivare a 120 s** (il valore della fase b): §1 mostra che la distribuzione è bimodale. Oltre i ~45 s la probabilità che il comando ritorni "da solo" crolla, e alzare oltre significherebbe solo ritardare il recupero dell'incidente che il PR è nato per risolvere.

### Il costo di un falso positivo (che limita la severità)

Se il timeout scatta su uno spawn *lento ma sano*:

- `tmux kill-session -t "$SESSION"` (`:1124`) **distrugge una sessione che potrebbe essersi appena creata** — race tra la scadenza del `timeout` e la registrazione lato server tmux;
- `exit 1` (`:1125`) → l'agente non parte;
- ma `agent-watchdog.sh:350` ritenta al tick successivo (**30 s**, `:59`) → **il guasto è auto-riparabile, non permanente**.

Quindi: 20 s non è catastrofico, è **rumoroso e potenzialmente distruttivo di una sessione buona**. Da qui la severità "media" e non "alta". Vale però la pena valutare (fuori dal perimetro di questa analisi) se il `kill-session` a `:1124` non debba essere condizionato a una verifica `tmux has-session`, per non uccidere ciò che è appena nato.

### Nota su `timeout` senza `-k`

`timeout 20 …` invia SIGTERM. Un processo bloccato in I/O **ininterrompibile** (stato D) sul mount stallato — cioè proprio lo scenario dell'incidente — **non muore con SIGTERM**. In quel caso `timeout` ritorna 124 e lo script esce, ma il figlio resta e **continua a tenere il fd 9**, riproducendo il lockout che il PR vuole eliminare. Se si vuole che il fix funzioni nel caso peggiore serve `timeout -k 5 45 …`. Rilevante qui perché indebolisce l'argomento "meglio un valore basso, tanto poi si recupera": il recupero non è garantito a nessun valore senza `-k`.

### Alzare anche `flock -w`?

**Sì.** 30 → 75 s a `:548`. Motivazione in §3: la sezione critica è già oggi documentata come vicina o superiore a 30 s (`start.js:292-295`), quindi il valore attuale produce falsi `"concurrent spawn"` indipendentemente da PR #214. La stessa modifica va replicata a `:383` (tg-bridge) per non lasciare due valori divergenti. E va accompagnata dal `9>&-` sui tre `setsid` (§3), altrimenti è cosmesi.

---

## 5. 📈 Come misurare davvero il tempo di spawn in produzione

**Oggi non esiste alcuna telemetria di durata dello spawn.** In `.launcher/start-agent.sh` non c'è un solo `date +%s`, `SECONDS` o calcolo di elapsed (verificato per grep su tutta `.launcher/`: gli unici `elapsed` sono in `tui-helpers.sh:78-85` e in `sentinel-bridge.py`, per altri scopi). L'unico timestamp legato allo spawn è quello che `team_roster.py record()` scrive a `.launcher/start-agent.sh:1221` — ed è un timestamp di **completamento**, senza un corrispondente di inizio: non se ne ricava alcuna durata. Nessuno può quindi affermare oggi quanto duri uno spawn medio.

Cosa manca, in ordine di rapporto valore/costo:

1. **Timing per fase su JSONL, accanto agli artefatti già esistenti.** Il pattern è già in casa: `agent-vitals.jsonl` (`:303`), `token-meter.csv` (`:430`), `JHT_AGENT_RECOVERY_LOG` → `agent-recoveries.tsv`. Aggiungere `$JHT_LOGS_DIR/spawn-timings.jsonl` con una riga per spawn:
   `{ts, session, role, provider, outcome, lock_wait_ms, preflight_ms, skill_copy_ms, warmup_ms, tmux_new_session_ms, total_ms}`.
   Le fasi corrispondono esattamente ai confini `:548` / `:964` / `:985` / `:1120` / `:1221`.
2. **Misurare l'attesa del `flock` a `:548`.** È il dato che risponde direttamente a "30 s bastano?": la distribuzione di `lock_wait_ms` dice quante volte si è arrivati vicino al muro. Senza, la scelta fra 30 e 75 resta un ragionamento e non una misura.
3. **WARN sui quasi-fallimenti.** Loggare una riga di avviso quando `tmux_new_session_ms` supera una soglia morbida (es. 5 s) **anche quando ha successo**. È l'unico modo di raccogliere la coda della distribuzione senza aspettare che qualcuno fallisca: dopo qualche settimana su Windows, macOS, VPS Hetzner e Linux si avrebbe il p95/p99 reale su cui tarare il numero definitivo.
4. **Spostare i log di fase (b) fuori da `/tmp`.** `/tmp/kickoff-<sess>.log` (`:1261`) e `/tmp/welcome-watchdog-<role>.log` (`:1293`) **contengono già timestamp `%H:%M:%S`** per `waiting for ready` → `ready` → `SENT OK` (`:1264-1275`): la fase (b) è di fatto già misurabile, ma i log stanno su `/tmp` (persi a ogni restart del container) e non sono aggregati. Portandoli in `$JHT_LOGS_DIR` con la rotazione di `daemon-lib.sh` si otterrebbe gratis anche la statistica di "quanto ci mette davvero un agente a diventare operativo" — la domanda che il proprietario stava effettivamente ponendo.
5. **Correlare con l'host.** `host.env` distingue già VPS e PC locale: taggare la riga JSONL con `JHT_HOST_TYPE` permette di dire "su Windows il p95 è X, sul VPS è Y" e, se serve, di differenziare il default per piattaforma invece di cercare un unico numero buono per tutti.

---

## 📌 Riepilogo azioni

| # | Azione | File:riga | Priorità |
|---|---|---|---|
| 1 | `20` → `45`, via `JHT_SPAWN_TMUX_TIMEOUT_SEC` | `start-agent.sh:1120`, `:1121` | 🔴 alta |
| 2 | `flock -w 30` → `75`, via `JHT_SPAWN_LOCK_WAIT_SEC` | `start-agent.sh:548`, `:383` | 🔴 alta |
| 3 | Aggiungere `9>&-` ai `setsid` che ereditano il lock | `start-agent.sh:1178`, `:1277`, `:1334` | 🔴 alta (prerequisito di #2) |
| 4 | `timeout` → `timeout -k 5` | `start-agent.sh:1120` | 🟠 media |
| 5 | Condizionare il `kill-session` a `has-session` | `start-agent.sh:1124` | 🟠 media |
| 6 | Telemetria `spawn-timings.jsonl` + WARN > 5 s | nuovo, `start-agent.sh` | 🟡 successiva |
| 7 | Estendere il timeout ai `tmux new-session` senza guardia | `start-agent.sh:133`, `:1081`, `spawn-doctor.sh:47`, `spawn-maintainer.sh:47` | 🟡 successiva |

Nessun test nel repo fa riferimento al valore corrente (nessun match per `hung spawn` / `did not return within` / `timeout 20` sotto `tests/`): cambiarlo non rompe suite esistenti, ma **una regressione dedicata andrebbe aggiunta** — è esattamente la classe di modifica che CLAUDE.md richiede sia coperta da test focalizzati con casi negativi e di frontiera.
