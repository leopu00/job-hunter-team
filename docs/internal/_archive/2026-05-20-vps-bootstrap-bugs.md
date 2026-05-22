# 2026-05-19/20 — VPS bootstrap bugs (sessione setup VPS1)

> **🟢 STATUS 2026-05-21:** bug #1, #2, #3 **FIXED & VALIDATED** end-to-end su VPS fresh Hetzner
> CPX22 con provider Codex. Vedi `docs/internal/2026-05-21-vps-bootstrap-fixes-validated.md` per
> la validation report (commit `79f63324`, image GHCR `:latest` aggiornata).
> Bug #4/#5/#6 (debug-only/cosmetici) deferred.

## Context

Sessione di pairing di una nuova VPS Hetzner (`203.0.113.20`, `ubuntu-4gb-fsn1-2`)
in data 2026-05-19 dopo il rilascio v0.1.17. Il container `ghcr.io/leopu00/jht:latest`
(image `0.1.17` confermata da package.json interno) è partito ma il **team di agenti
LLM non è mai diventato operativo finché non sono stati applicati workaround manuali**.

Bisogna intervenire perché la promise del flow di pairing è "wizard → tutto parte":
ogni step manuale che ho dovuto fare io è una falla del wizard rispetto ai beta tester
([[feedback_setup_wizard_all_inclusive]]).

Backup pre-fix preservati su VPS1:
- `/root/.jht/jht.config.json.bak` — config originale con `active_provider: "codex"`
- `/root/.jht/cloud.json.bak` — cloud config pre-disable (per investigation 504-storm)

---

## Bug #1 — `start-agent.sh` non riconosce provider `"codex"`

### Sintomo

Tutti gli agenti LLM falliscono al boot via watchdog:

```
[watchdog] [2026-05-19T20:06:49Z] agent assistente: start FAIL (rc=1) — riprovo al prossimo tick
[watchdog] [2026-05-19T20:06:49Z] agent capitano:   start FAIL (rc=1) — riprovo al prossimo tick
[watchdog] [2026-05-19T20:06:49Z] agent mentor:     start FAIL (rc=1) — riprovo al prossimo tick
```

`jht team start` lanciato manualmente mostra il messaggio truncato:

```
✗ ASSISTENTE — In alternativa, modifica ~/.jht/jht.config.json per usare un altro provider.
```

Eseguendo `start-agent.sh` direttamente l'errore completo è:

```
Warning: provider 'codex' non riconosciuto in jht.config.json, fallback a claude.
Errore: comando 'claude' non trovato (provider configurato: codex).
Installa Claude CLI: https://claude.ai/download
In alternativa, modifica ~/.jht/jht.config.json per usare un altro provider.
```

### Causa

Il file `/app/.launcher/start-agent.sh:354-405` ha un `case` statement che NON elenca
`codex` come alias di `openai`:

```bash
case "$PROVIDER" in
  ""|anthropic|claude)
    CLI_BIN="claude"
    ...
    ;;
  openai)                # ← solo "openai" mappa a codex CLI
    CLI_BIN="codex"
    CLI_ARGS="--yolo -c model_reasoning_effort=$effort"
    ...
    ;;
  kimi|moonshot)
    CLI_BIN="kimi"
    ...
    ;;
  *)
    echo "Warning: provider '$PROVIDER' non riconosciuto in jht.config.json, fallback a claude."
    ;;
esac
```

Ma il wizard desktop scrive in `jht.config.json`:

```json
{
  "active_provider": "codex",
  "providers": {
    "codex": { "auth_method": "oauth" }
  }
}
```

(Verificato in `/root/.jht/jht.config.json.bak` — backup pre-patch.)

Risultato: `PROVIDER="codex"` → cade nel `*` (warning fallback claude) → `CLI_BIN="claude"` → `command -v claude` fallisce dentro al container (claude non è installato, è solo `codex` e `kimi`) → exit 1.

### Evidence

- `docker exec jht codex --version` → `codex-cli 0.131.0` ✅ presente
- `docker exec jht command -v claude` → not found
- `/root/.jht/jht.config.json.bak` (preservato) → `"active_provider": "codex"`
- `/app/.launcher/start-agent.sh:354` → case statement immutato

### Workaround applicato (in sessione)

Editato `jht.config.json` host + container:

```bash
sed -i 's/"active_provider": "codex"/"active_provider": "openai"/' /root/.jht/jht.config.json
docker exec jht sh -c 'sed -i "s/\"active_provider\": \"codex\"/\"active_provider\": \"openai\"/" /jht_home/jht.config.json'
```

Stato attuale verificato: `"active_provider": "openai"`. Backup `jht.config.json.bak` mantiene il valore originale `"codex"`.

### Fix scalabile (TODO)

**Opzione A — patch `start-agent.sh`** (1 riga, minimal):

```diff
-  openai)
+  openai|codex)
     CLI_BIN="codex"
```

Stessa logica per `anthropic|claude` già esiste (alias), e `kimi|moonshot` (alias). Solo `openai` mancava il suo alias `codex`. Coerente col pattern già nel codice.

**Opzione B — normalizzare nel writer del config** (più invasivo): modificare il wizard desktop e il CLI `jht setup`/`jht migrate` in modo che mappino `"codex"` → `"openai"` prima della scrittura. Richiede touch in più punti (desktop + cli) ma rende il config "fonte di verità" su un singolo vocabolario.

**Consigliata: A** (più piccola, più rapida, retro-compatibile). Includere un test che spawna container fresh con `active_provider: "codex"` e verifica che `jht team start` non dia warning fallback.

---

## Bug #2 — Codex CLI blocca al "trust prompt" al primo avvio per ogni nuova dir agente

### Sintomo

Dopo aver applicato il workaround del bug #1, `jht team start` riporta `7 avviati / 0 errori`. Ma:
- Solo MENTOR funziona davvero (CLI codex live, status bar `gpt-5.5 high · ~/agents/mentor`)
- ASSISTENTE, SENTINELLA, CAPITANO, DOTTORE: sessione tmux esiste ma è una **bash shell vuota**
- I messaggi sistema inviati ai tmux pane (`[@utente -> @assistente] [TG] ciao`) vengono **eseguiti come comandi bash**, restituendo `command not found`

Esempio raccolto durante la sessione:

```
jht@d4d0433c1c9d:~/agents/assistente$ [@utente -> @assistente] [TG] tizio
-bash: [@utente: command not found
jht@d4d0433c1c9d:~/agents/assistente$ [@utente -> @assistente] [TG] letsgo
-bash: [@utente: command not found
```

### Causa

Codex CLI mostra al primo avvio in una nuova working directory:

```
> You are in /jht_home/agents/<agente>

  Do you trust the contents of this directory? Working with untrusted contents
  comes with higher risk of prompt injection. Trusting the directory allows
  project-local config, hooks, and exec policies to load.

› 1. Yes, continue
  2. No, quit

  Press enter to continue
```

`start-agent.sh` lancia codex dentro `tmux new -s NAME 'codex ...'`. Il prompt
attende input interattivo, dopo qualche secondo codex esce silenziosamente
(o l'utente non risponde → la sessione tmux torna a bash). Il pane resta
attivo come shell e i messaggi successivi finiscono come comandi.

**MENTOR è funzionante** perché qualcuno (probabilmente in una sessione di test
precedente sul VPS, o durante il primo run quando ho fatto io attach al pane)
ha premuto Enter su quel prompt, e codex ha persistito la trust in
`~/.codex/config.toml`:

```toml
[projects."/jht_home/agents/mentor"]
trust_level = "trusted"
```

Gli altri agenti non avevano la stanza trustata e quindi sono caduti tutti.

### Evidence

Stato `/jht_home/.codex/config.toml` PRE-fix (ricostruito dalla session):

```toml
[projects."/jht_home/agents/mentor"]
trust_level = "trusted"

[tui.model_availability_nux]
"gpt-5.5" = 1
```

Stato POST-fix (verificato adesso):

```toml
[projects."/jht_home/agents/mentor"]
[projects."/jht_home/agents/assistente"]
[projects."/jht_home/agents/capitano"]
[projects."/jht_home/agents/sentinella"]
[projects."/jht_home/agents/dottore"]
[projects."/jht_home/agents/scout-1"]
[projects."/jht_home/agents/scout-2"]
[projects."/jht_home/agents/analista-1"]
[projects."/jht_home/agents/analista-2"]
[projects."/jht_home/agents/scorer-1"]
[projects."/jht_home/agents/scrittore-1"]
[projects."/jht_home/agents/scrittore-2"]
[projects."/jht_home/agents/scrittore-3"]
[projects."/jht_home/agents/critico-s1"]
[projects."/jht_home/agents/critico-s2"]
[projects."/app"]
```

→ 16 trust entries. Quelli oltre la mia patch iniziale (scout-2, analista-2, scrittore-3, critico-s1/s2, /app) si sono auto-aggiunti man mano che il Capitano spawnava nuovi agenti — significa che dopo la mia patch iniziale per i 4 core, **ogni nuovo agente spawnato ha probabilmente sbattuto contro lo stesso prompt e qualcuno (Capitano via tmux send-keys? watchdog?) ha automaticamente confermato**.

Da investigare: chi ha aggiunto gli altri entries? Se è il flusso normale post-fix, allora il problema è solo al PRIMO BOOT (quando config.toml non esiste).

### Workaround applicato (in sessione)

Inserito manualmente in `/jht_home/.codex/config.toml`:

```bash
docker exec jht sh -c 'cat >> /jht_home/.codex/config.toml << EOF

[projects."/jht_home/agents/assistente"]
trust_level = "trusted"

[projects."/jht_home/agents/capitano"]
trust_level = "trusted"

[projects."/jht_home/agents/sentinella"]
trust_level = "trusted"

[projects."/jht_home/agents/dottore"]
trust_level = "trusted"
EOF'
```

Poi killate le sessioni tmux ROTTE e rilanciato `jht team start`. Da quel momento Codex CLI è partito correttamente in ogni pane (verificato dalla status bar `gpt-5.5 ...`).

### Fix scalabile (TODO)

**Opzione A — pre-popolare `config.toml` all'init container** (consigliata):

In `desktop/pid1.js` (o equivalente che gira al boot del container vps), generare `~/.codex/config.toml` con trust di TUTTE le dir agente attese, prima del primo `jht team start`:

```javascript
const AGENT_DIRS = readAgentDirsFromTeamConfig(); // legge agents/_team/*
const trustEntries = AGENT_DIRS.map(d =>
  `[projects."/jht_home/agents/${d}"]\ntrust_level = "trusted"\n`
).join('\n');
appendIfMissing('/jht_home/.codex/config.toml', trustEntries);
```

**Opzione B — passare `--cwd-trusted` (o equivalente) come flag a codex CLI**:

Verificare in `codex --help` se esiste una flag per skippare il trust prompt. Se sì, aggiungerla in `start-agent.sh:362` (`CLI_ARGS` per il branch `openai`):

```bash
CLI_ARGS="--yolo -c projects.\"$workdir\".trust_level=trusted -c model_reasoning_effort=$effort"
```

Codex supporta `-c key=value` override (vedi config.toml format), quindi probabilmente possibile.

**Opzione C — `expect` script che risponde "1\n"** al prompt nel wrapper tmux:
Funziona ma è fragile (rompe se la UI di Codex cambia). Sconsigliata.

**Consigliata: A** (config.toml pre-popolato al boot). Reso permanente nell'immagine via `start-agent.sh` o `pid1.js`.

---

## Bug #3 — `jht migrate` necessario al boot ma non automatico

### Sintomo

`jht doctor` segnala:

```
▲  Config v1 — aggiornamento disponibile
│    ↳ Esegui: jht migrate
```

Senza migrazione, alcuni step downstream (es. quelli che leggono `config.providers.codex.auth_method`) potrebbero non funzionare. Nel mio caso ho lanciato manualmente:

```
Versione attuale: 1
Migrazioni disponibili: 3
  → v2: Aggiunge campo version e providers strutturati
  → v3: Aggiunge campo agents.list e channels
  → v4: Aggiunge campo notifications e analytics
  ✓ v2 applicata
  ✓ v3 applicata
  ✓ v4 applicata
Config aggiornata a versione 4
```

### Causa

Il container `ghcr.io/leopu00/jht:latest` parte con il `jht.config.json` scritto dal wizard desktop, ma il wizard usa il format v1 (vecchio). `pid1` non lancia automaticamente `jht migrate`.

### Evidence

- `jht.config.json.bak` (pre-patch): no `version` field → v1
- `jht.config.json` (post-migrate): `"version": 4`

### Workaround applicato

`jht migrate` manuale. v4 ha aggiunto `agents.list: []`, `notifications`, `analytics`, `providers.codex.auth_method` strutturato.

### Fix scalabile (TODO)

In `pid1.js` (o `dispatch` del container start), aggiungere step idempotente:

```javascript
// prima di startare watchdog/daemons
runCmd('jht', ['migrate', '--non-interactive']);
```

Idempotente perché se la config è già al massimo, lo script termina con `Versione attuale: N | Migrazioni disponibili: 0 | (no changes)`.

---

## Bug #4 — Container minimo manca `ps`, `pkill`, `sqlite3`

### Sintomo

Durante debug interno (es. trovare processo daemon push, ispezionare DB SQLite, killare processi specifici), comandi standard non disponibili:

```
$ docker exec jht ps -ef
OCI runtime exec failed: exec failed: ... exec: "ps": executable file not found in $PATH

$ docker exec jht pkill -SIGSTOP -f 'cloud daemon'
OCI runtime exec failed: ... exec: "pkill": executable file not found in $PATH

$ docker exec jht sqlite3 /jht_home/jobs.db "SELECT ..."
OCI runtime exec failed: ... exec: "sqlite3": executable file not found in $PATH
```

### Causa

Immagine base minimal — `coreutils` non include `ps`/`pkill`/`sqlite3-cli`.
Codex CLI usa `node:sqlite` (experimental) o `better-sqlite3` interno; gli operatori non hanno bisogno di sqlite3 CLI esterno. Quindi è stato scelto di non includerli per ridurre image size.

### Evidence

Verificato sul container `ghcr.io/leopu00/jht:latest` (digest `5fb485259fc0`):

```
sqlite3: MISSING       ps: MISSING        pkill: MISSING
lsof:    MISSING       strace: MISSING    top:   MISSING
htop:    MISSING       tree: MISSING      procps: MISSING (package)
```

Tutta la famiglia `procps` (ps/pgrep/pkill/top), `psmisc` (killall/fuser),
`sqlite3` CLI, `lsof`/`strace`/`htop`/`tree` mancano.

- Image size attuale: ~5.18 GB (vedi `docker images ghcr.io/leopu00/jht --digests`)
- Già grande, ma è dominata da node_modules + codex/kimi binari

### Workaround applicato (in sessione)

Per ogni operazione di debug ho usato sostituti già presenti:

- `ps` → loop su `/proc/[0-9]*/cmdline`:
  ```bash
  for pid in /proc/[0-9]*; do
    printf "%s " "${pid##*/}"
    cat "$pid/cmdline" 2>/dev/null | tr "\0" " "; echo
  done
  ```

- `sqlite3 file.db "QUERY"` → `node -e` con `node:sqlite`:
  ```bash
  docker exec jht node -e "
    const {DatabaseSync} = require('node:sqlite');
    const db = new DatabaseSync('/path/to.db', {readOnly: true});
    console.log(db.prepare('SELECT ...').all());
  "
  ```

- `pkill` → modifica file di config (es. `cloud.json: enabled: false`) per innescare graceful stop via watcher

### Fix scalabile (TODO)

**Opzione A — aggiungere `procps` + `sqlite3` al Dockerfile** (~5 MB di overhead totale):

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends \
  procps \
  sqlite3 \
  && rm -rf /var/lib/apt/lists/*
```

Trade-off: +5 MB image, ma debugging molto più rapido. Vale la pena.

**Opzione B — includere `procps` solo nella variante `:dev`** (e tenere `:latest` minimal):

```dockerfile
ARG INCLUDE_DEBUG_TOOLS=0
RUN if [ "$INCLUDE_DEBUG_TOOLS" = "1" ]; then \
      apt-get update && apt-get install -y procps sqlite3 strace lsof; \
    fi
```

Build `:latest` con `INCLUDE_DEBUG_TOOLS=0`, `:debug` con `=1`. Trade-off: due build target.

**Consigliata: A** se la image è già 5.18 GB, 5 MB in più sono trascurabili. Se invece c'è un effort attivo per scendere sotto 2 GB, allora B.

---

## Bug #5 — Container manca `procps` per troubleshooting daemon

Già coperto da #4. Annoto separatamente solo per visibilità che `procps` (`ps`, `pgrep`, `pkill`, `kill -l`, `top`) sono **una famiglia singola** mancante. Aggiungere `apt-get install procps` risolve in un colpo.

---

## Bug #6 — Database `/jht_home/jobs.db` non creato al boot, daemon spam log

### Sintomo

Subito dopo il pairing, `jht.config.json.version=4`, ma:

```
[daemon] Database non trovato: /jht_home/jobs.db
[daemon] Avvia il team almeno una volta o passa --db <path>
[realtime] [team-subscriber] heartbeat.alive
[daemon] Database non trovato: /jht_home/jobs.db
[daemon] Avvia il team almeno una volta o passa --db <path>
```

Il messaggio si ripete ogni ciclo del daemon push (60s). Pre-pollution dei log.

### Causa

`jobs.db` viene creato lazy alla prima volta che un operatore esegue una INSERT (es. Scout inserisce la prima posizione). Il daemon push parte indipendentemente e logga "non trovato" finché il DB non esiste.

### Evidence

- `/jht_home/jobs.db` non esisteva al boot iniziale
- Comparso dopo le 20:25 quando Scout-1 ha inserito i primi posti

### Workaround applicato

Nessuno — il messaggio si autosilenzia quando il DB nasce naturalmente.

### Fix scalabile (TODO)

Due opzioni:

**A — creare DB vuoto al primo boot**, con schema applicato (no row). Aggiunge un `jht db init` step in `pid1.js` post-migrate. Il daemon push troverebbe DB vuoto e logga `Payload: 0 positions, 0 scores, 0 applications` invece di un errore.

**B — silenziare il log fino a primo INSERT noto**. Più hack-ish.

**Consigliata: A** — coerente col pattern di pre-setup completo del wizard.

---

## Riassunto tabellare

| # | Bug | Severità | Workaround applicato | Fix scalabile consigliato |
|---|---|---|---|---|
| 1 | `start-agent.sh` non accetta `codex` come provider | 🔴 Bloccante (team non parte) | Patch `jht.config.json`: `codex` → `openai` | Aggiungere `openai\|codex)` nel case statement |
| 2 | Codex trust prompt blocca ogni nuova dir agente al primo run | 🔴 Bloccante (agenti escono in bash) | Inserito manualmente `[projects."X"] trust_level = "trusted"` per ogni agente | Pre-popolare `config.toml` in pid1.js al boot, oppure `--cwd-trusted` flag |
| 3 | `jht migrate` necessario ma non auto-eseguito | 🟡 Funzionale (config v1 con campi mancanti) | `jht migrate` manuale | Step idempotente in pid1.js pre-watchdog |
| 4 | `ps`/`pkill`/`sqlite3` mancanti | 🟢 Debug-only | `/proc/*/cmdline`, `node -e` con `node:sqlite`, file-watcher flag | `apt-get install procps sqlite3` nel Dockerfile (+5 MB) |
| 5 | Cf. #4 (`procps` family) | - | - | - |
| 6 | `jobs.db` non creato al boot, log spam | 🟢 Cosmetico | Auto-risolve al primo INSERT | `jht db init` in pid1.js post-migrate |

## Priorità di rollout

Per la prossima release:

1. **P0** (#1 + #2): blockers — un beta tester con VPS fresh OGGI non riesce ad avviare il team senza intervento manuale. Sono i due fix più piccoli (1 riga shell + ~20 righe node) ma con impatto totale.
2. **P1** (#3): pulizia setup — automatizza `jht migrate`.
3. **P2** (#6): pulizia log + #4/#5 (qualità developer experience).

Tutti i fix sono indipendenti tra loro, possono essere mergiati in qualsiasi ordine.

## Memory rilevante

- [[feedback_setup_wizard_all_inclusive]] — l'utente vuole "SOLO comandi jht, mai fallocate/docker exec/chmod a mano". Tutti e 6 i bug hanno richiesto in qualche modo un intervento `docker exec` o file editing diretto. La promise non è mantenuta.
- [[project_release_workflow]] — i fix andrebbero in v0.1.18 (bump patch).
- [[project_two_install_paths]] — CLI one-liner e DMG GUI dovrebbero entrambi finire con team funzionante senza intervento manuale.
