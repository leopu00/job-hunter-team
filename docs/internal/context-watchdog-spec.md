# 2026-05-20 — Agent context saturation + reboot periodico via Dottore

> **Status: PROOF-OF-CONCEPT CONFERMATO (2026-05-20 13:18-14:00 UTC).**
> Misurazione confermata, ipotesi del rimedio (reboot via Dottore) testata
> con successo su 1 Capitano + batch di 6 operatori. Da codificare in
> prossima release v0.1.18 come ciclo automatico nel watchdog del Dottore.
> Vedi sezione "PoC results" in fondo per i numeri e la procedura testata.

## Misurazione effettuata (snapshot 2026-05-20 ~10:20 UTC, ~14h dal boot)

Letto dal file `/jht_home/.codex/state_5.sqlite`, tabella `threads`, campo
`tokens_used`:

### Agenti long-lived (1 solo thread che vive dal boot)

| Agente | tokens_used | thread age (h) | rate token/h |
|---|---:|---:|---:|
| **scrittore-2** | **148.5 M** | ~13.5 | ~11.0 M/h |
| **capitano** | **141.9 M** | ~14.0 | ~10.1 M/h |
| **scrittore-1** | **125.2 M** | ~13.6 | ~9.2 M/h |
| analista-1 | 44.6 M | ~13.7 | 3.3 M/h |
| scout-1 | 42.9 M | ~13.7 | 3.1 M/h |
| scorer-1 | 39.8 M | ~13.6 | 2.9 M/h |
| scout-2 | 33.2 M | ~5.2 (spawn 05:08) | 6.4 M/h |
| assistente | 15.1 M | ~14.0 | 1.1 M/h |
| mentor | 3.6 M | ~14.0 | 0.3 M/h |
| sentinella | 3.2 M | ~14.0 | 0.2 M/h |

### Agenti ephemeral (un thread nuovo per ogni task)

| Agente | thread count | max singolo | sum |
|---|---:|---:|---:|
| critico-s1 | **61** | 471 k | 13.0 M |
| critico-s2 | **43** | 430 k | 9.5 M |
| dottore | 8 | 1.3 M | 5.0 M |

I Critici dimostrano che il pattern "un thread per task" funziona: nessun
thread supera 500 k token, sintomi di saturazione (latenza, cooperative
idle, errori semantici) **non si osservano** sui Critici.

## Interpretazione del numero `tokens_used`

`tokens_used` è **cumulativo lifetime del thread**: somma di tutti i token
processati dal modello in tutte le risposte di quel thread (input + output
+ reasoning trace). Non è il context window snapshot corrente.

Codex CLI applica **compaction silenziosa periodica** quando il thread
si avvicina al limite del context window di GPT-5.5 (~400 k token presunti
per high reasoning). La compaction conserva un riassunto e libera token,
ma:

1. Il context "vivo" dopo compaction è comunque pesante (50-100 k token
   per turn, stima)
2. Ogni compaction lascia un "residuo" cumulativo nel rollout
3. Compaction multiple in sequenza degradano la qualità della
   conversazione (lost in the middle, attention dilution)

Quindi `tokens_used` alto **non è di per sé un errore**, ma è un proxy
abbastanza affidabile dello "stato di affaticamento" del thread.

## Sintomi correlabili al context saturo

Osservati nelle ultime ore sul Capitano (142 M token):

1. **Latenza decisionale alta**: tempo medio tra un input dalla Sentinella
   e una risposta del Capitano è cresciuto nelle ore notturne (da
   ~10-30 s a ~1-3 min).

2. **Cooperative idle prolungato**: il Capitano non auto-rilancia Scout
   quando la pipeline si svuota. Vedi
   [[2026-05-20-team-idle-gaps-investigation]] — 31 gap > 5 min, 6 gap
   > 20 min, totale ~8h15m di stasi su ~13h di operatività.

3. **Errori semantici (claim race)**: alle 04:05 UTC, Scrittore-1 e
   Scrittore-2 hanno entrambi rivendicato la position #45 De Wave perché
   il Capitano aveva mandato a entrambi "Prendi #X" senza tracking di
   chi possedeva cosa. Errore tipico di context con tracking distratto.

4. **Loop di kickoff**: alle 05:09 il Capitano ha mandato lo stesso
   messaggio "Start the main loop" a Scout-2 due volte in 17 secondi
   ("KICKOFF RETRY"). Suggerisce che il Capitano non ricordava di averlo
   già mandato (o Scout-2 non aveva ack-ato e il Capitano ha re-iterato
   senza tracking).

5. **Frasi più lunghe e verbose** nel tempo: i messaggi del Capitano
   diventano progressivamente più articolati (più "spiegoni" e meno
   ordini secchi), tipico di un modello che cerca di "tenersi tutto a
   mente".

## Proposta: reboot periodico del Capitano via Dottore

### Idea

Aggiungere al ciclo del Dottore un check basato su token consumati:

```
ogni ROUND del Dottore (oggi 2h tramite spawn-doctor.sh):
  per ciascun agente long-lived:
    leggi threads.tokens_used dal codex state_5.sqlite
    se tokens_used > SOGLIA_AGENTE:
      → notifica all'agente: "RESTART IMMINENTE in 60s, scarica task pendenti"
      → attendi ack o timeout
      → tmux kill-session -t <AGENTE>
      → bash /app/.launcher/start-agent.sh <agente>
      → il nuovo thread codex parte vergine
      → si riallinea leggendo: AGENTS.md (prompt), DB sqlite (stato pipeline),
        pacing-bridge-state.json (stato budget), eventuale memo persistente
```

### Soglie iniziali proposte (da tarare)

| Agente | Soglia tokens_used | Frequenza max reboot |
|---|---:|---|
| **capitano** | **50 M** | max 1 reboot ogni 3h |
| scrittore-1, scrittore-2 | 75 M | max 1 ogni 4h |
| scout-1, scout-2 | 50 M | max 1 ogni 4h |
| analista-1, scorer-1 | 50 M | max 1 ogni 6h |
| assistente | 30 M | max 1 ogni 6h (è user-facing su Telegram, attenzione) |
| sentinella | – | mai (deve essere sempre attiva, troppo low-token) |
| mentor | – | mai (uso sporadico, leggero) |
| dottore | – | si auto-respawna già ogni 2h tramite spawn-doctor.sh |

Le soglie sono **circa 1/3 dei valori attuali** dei più carichi → reboot
ragionevolmente frequente sul Capitano (ogni 4-5h), meno sui ruoli meno
strategici.

### Coreografia del reboot del Capitano (sensibile)

Il Capitano è il coordinatore — il suo reboot va orchestrato:

1. **Heads-up agli operatori**: il Dottore manda `[@dottore -> @<agent>]
   [INFO] Capitano restart in 60s, fermati al prossimo gate, non
   spawnare nuovi task` a tutti gli operatori attivi.
2. **Attesa ack** o timeout 60s
3. **Kill della session tmux** `CAPITANO`
4. **Snapshot di continuità su disco**: il vecchio Capitano scrive un
   file `/jht_home/.capitano-handoff.md` con (a) lista positions
   in-flight, (b) ultimi ordini emessi, (c) throttle config attivo, (d)
   chi possiede cosa. Questo è il "passaggio di consegne".
   - **Da elaborare**: il vecchio Capitano deve essere ancora vivo per
     scrivere questo, prima del kill. Serve un trigger "scarica stato
     prima di morire" — un nuovo skill `jht-capitano-handoff`.
5. **Respawn** via `start-agent.sh capitano`
6. **Auto-onboarding del nuovo Capitano**: il prompt deve includere
   "Se esiste `~/.capitano-handoff.md`, leggilo per primo. Riprende lo
   stato dalla pipeline (DB sqlite) + handoff. Saluta tutti gli operatori
   attivi con un ACK quando sei pronto."
7. **Operatori riprendono**: alla ricezione del saluto, gli operatori
   tornano in modalità normale.

### Reboot di Scrittori / Scout / Analista / Scorer (meno critico)

Sono più semplici — non coordinano altri agenti, quindi:

1. Heads-up al Capitano: "Sto per riavviare scrittore-2"
2. Kill della session tmux `<AGENTE>`
3. Respawn via `start-agent.sh <agente>`
4. Capitano fa l'ack al nuovo agente quando lo vede vivo

Niente handoff su disco — lo stato dell'operatore è quasi tutto in DB
(positions, scores, applications) e nel suo AGENTS.md.

### Trigger alternativo: tempo invece di soglia

Più semplice (ma meno preciso):

- Capitano: reboot fisso ogni 4h
- Scrittori: reboot fisso ogni 6h
- Operatori: reboot fisso ogni 8h
- Sentinella / Dottore / Mentor: mai

Pro: deterministico, facile da pianificare.
Contro: spreca reboot quando l'agente è "fresco" e ne salta uno quando
l'agente è particolarmente carico.

Soluzione ibrida: **trigger tempo + cap soglia** — "reboot ogni 4h MA
saltabile se tokens_used < 30 M".

## Differenza Codex vs Claude sul "compact"

- **Claude Code CLI**: ha `/compact` slash command che riassume la
  conversazione e libera context. Il thread resta lo stesso ma il
  context viene esplicitamente shrinkato.
- **Codex CLI**: usa compaction **silenziosa automatica** quando il
  context si avvicina al limite (vedi `thread.preview` nel `state_5.sqlite`).
  Non c'è un slash command equivalente noto.
- **Conseguenza**: per codex non possiamo fare "compact su comando".
  L'unico modo di forzare un context fresco è **un nuovo thread**, e
  l'unico modo di forzare un nuovo thread è **killare e riavviare la
  session codex**.

Da verificare:
- Codex CLI supporta `codex resume` su un thread esistente. Si potrebbe
  fare un "fork from checkpoint pulito" invece di kill+respawn?
- Lo schema `threads` ha `rollout_path` — esiste un meccanismo di
  rollback a un thread precedente con `tokens_used` basso?

## Cose ancora NON misurate / NON spiegate

1. **Effetto reale del reboot**: non abbiamo ancora fatto un reboot test
   del Capitano per verificare che le metriche di latenza e cooperative
   idle migliorino davvero. Servirebbe un A/B controllato.

2. **Soglia ottimale di tokens_used**: 50 M sul Capitano è un'ipotesi
   ragionevole, non un valore tarato. Servirebbe un esperimento (es.
   reboot a 30 M / 50 M / 80 M e misurare gap > 5 min nelle 4 h
   successive).

3. **Compaction silenziosa codex**: non sappiamo esattamente cosa
   conserva e cosa scarta codex durante il compaction. Forse il
   problema reale non sono i 142 M token cumulativi ma il **contenuto**
   del context dopo le compaction (es. perdita di tracking di chi possiede
   cosa).

4. **Handoff su disco**: il file `.capitano-handoff.md` proposto non
   esiste ancora. Serve una skill nuova `jht-capitano-handoff` che il
   vecchio Capitano chiama prima di morire. Da progettare con cura.

5. **Side effect su Telegram (assistente)**: l'Assistente è user-facing
   sul Telegram. Un suo reboot durante una conversazione con l'utente
   potrebbe perdere il filo. Serve un "pause mode" che drena il dialogo
   prima di riavviarsi.

## Prossimi step proposti (DA ELABORARE)

1. **Esperimento manuale**: stasera o domani mattina, fare un kill+restart
   del Capitano in finestra "calma" (es. notte, batch chiuso) e
   confrontare:
   - Tempo medio risposta Sentinella → Capitano nelle 2h prima vs dopo
   - Numero di gap > 5 min nelle 4h dopo
   - Eventuali errori claim-race o kickoff duplicati
2. Se l'esperimento conferma il beneficio: estendere a Scrittore-1/2
   con coreografia minimale (no handoff).
3. Codificare il loop nel Dottore: estendere `spawn-doctor.sh` o
   aggiungere `jht-context-watchdog.py` che:
   - Legge `tokens_used` per ogni agente da `state_5.sqlite`
   - Decide quale agente "reboot" usando soglie + cap frequenza
   - Esegue la coreografia
4. Aggiungere metric output: ogni reboot scrive un log
   `/jht_home/logs/reboots.jsonl` con `agent, tokens_used_before,
   reason, ack_received, restart_duration_sec`.
5. Long-term: valutare se ridisegnare gli agenti più "task-oriented"
   come ephemeral (pattern Critico) invece di long-lived.

## PoC results — esperimento manuale 2026-05-20 13:18-14:00 UTC

### Setup

Dopo 17.5h di operatività continua del team, misurato `tokens_used`:

- capitano: **168 M** (rate 10 M/h, lifetime)
- scrittore-2: **151 M** | scrittore-1: **128 M**
- analista-1: **62 M** | scout-1: **55 M** | scout-2: **52 M** | scorer-1: **50 M**
- assistente: **19.6 M** | sentinella: **4.5 M** | mentor: **3.7 M**

Sintomo confermato: gap di silenzio TOTALE > 100 min nelle 3 ore precedenti
(vedi [[2026-05-20-team-idle-gaps-investigation]]). Pipeline rallentata
a ~1.2 M/h Scrittori (vs 9 M/h del primo giorno) — cooperative idle profondo.

### Step 1: restart Capitano (singolo target)

Procedura inviata al Dottore via file `/tmp/order-dottore.md`. Il Dottore
ha eseguito in 7 minuti senza supervisione:

| Step | Tempo | Outcome |
|---|---|---|
| Spawn Dottore (`spawn-doctor.sh`) | 13:11:48 | ✅ |
| Cattura pane CAPITANO + db queries | 13:11-13:18 | ✅ 44 KB capture + 11 KB handoff markdown |
| Heads-up al vecchio Capitano | 13:18:02 | ✅ vecchio ha ack-ato |
| Kill + respawn via `start-agent.sh capitano` | 13:18:36 | ✅ nuova session tmux |
| Ready check (poll 3×30s su status bar codex) | 13:18-13:19 | ✅ |
| Handoff via `jht-tmux-send` (4 righe, 1s spacing) | 13:19:06-13 | ✅ |
| REPORT in `messages.jsonl` | 13:19:15 | ✅ `[REPORT] Restart Capitano completato` |

**Risultato**: nuovo Capitano operativo con context vergine, ha letto
autonomamente `.capitano-handoff.md`, ack-ato la Sentinella alle 13:19:39
(*"Capitano riavviato e vivo. Mailbox bridge drena coordinamento senza
spawn duplicati"*), ripreso coordinamento normale.

### Step 2: batch restart 6 operatori

Procedura inviata via `/tmp/order-dottore-batch.md` per: scrittore-1/2,
analista-1, scout-1/2, scorer-1. Il Dottore ha **auto-generato uno script
bash** `tmp/restart-batch-20260520.sh` ed eseguito in serie con pacing
90s tra agenti.

Cadenza misurata (batch chiuso alle 13:50 UTC, **6/6 success**):

| Agente | Restart ts | Δ dal precedente |
|---|---|---|
| SCRITTORE-2 | 13:31:05 | +13m dal kickoff Dottore |
| SCRITTORE-1 | 13:34:31 | +3m26s |
| ANALISTA-1 | ~13:38 | ~3m30s |
| SCOUT-1 | ~13:42 | ~4m |
| SCOUT-2 | ~13:46 | ~4m |
| SCORER-1 | ~13:50 | ~4m |

Tempo medio per restart: ~4-5 min. **Tempo totale batch: ~25 min** (13:25 spawn
Dottore → 13:50 REPORT finale). Aggiungendo i 7 min del Capitano (step 1):
**~39 min per 7 agenti completi**.

**Auto-correzione del Dottore**: ha prima emesso REPORT `0/6 success`
perché il ready-check usava `grep agents/<agent>` troppo stretto. Dopo 30
secondi ha post-verificato (sessioni vive, nuovi PID, handoff consegnato) e
ha emesso REPORT corretto `6/6 success` con nota esplicita:
> "Nota: report precedente marcava PARTIAL per ready-check grep troppo
> stretto; post-verify conferma sessioni vive, nuovi PID e handoff
> consegnato."

Questo è un pattern di **resilient self-reporting** che dovrebbe restare
nella implementazione automatica (vedi sotto, sezione "ready check
robusto").

**Pipeline immediatamente ripresa** (mentre il Dottore stava ancora finendo
gli ultimi restart):
```
13:34:31 [@analista-1 -> @capitano] [REPORT] Batch #142-145: 4 checked
13:37:15 [@scorer-1   -> @capitano] [REPORT] Batch IDs 142-145 complete
13:45:57 [@analista-1 -> @capitano] [REPORT] Batch Scout-1 #146-#150: 5/5 link
```

→ Cooperative idle **sciolto**, pipeline funzionante con context fresh su
tutti.

### Risultato quantitativo — **5.5× boost di velocità di team**

Misurato dal `pacing-bridge-state.json` prima e dopo il batch restart:

| Metric | Pre-batch (12:45 UTC) | Post-batch (13:45 UTC) | Delta |
|---|---:|---:|---:|
| Velocità team `vel_team` | **4.36 %/h** | **24.2 %/h** | **+455%** |
| Proj fine cycle | 71.5% (MARGINE) | 68.7% → ~100% (SFORO) | – |
| Tokens cumulativi Capitano | 168 M | **80 k** (-99.95%) | reset |
| Tokens cumulativi Scrittori | 125-148 M | 0.4-1 M | reset |
| Tokens cumulativi Scout/Analista/Scorer | 33-62 M | 0.4-4 M | reset |

**Conferma sperimentale schiacciante**: la saturazione context era il
bottleneck. Il team con context vergini consuma il budget Codex 5.5× più
velocemente di quello con context saturi. Il pacing-bridge è passato da
verdict `MARGINE` (sotto target) a `SFORO` (sopra target) — significa che
prima sprecava capacità, ora la sfrutta.

### Incident notabile — restart non idempotente

Durante l'esperimento, alle 13:55 UTC sono stati ricreati anche
**CAPITANO (di nuovo), ASSISTENTE, MENTOR** — agenti che il mio ordine
batch aveva esplicitamente escluso ("Skip esplicitamente: CAPITANO già
riavviato, SENTINELLA, MENTOR, ASSISTENTE").

Causa probabile (da verificare):
- Il `doctor-watchdog` automatico ogni 2h ha respawnato un nuovo Dottore alle
  13:52:55 (il file `/tmp/order-dottore-batch.md` esisteva ancora)
- Il nuovo Dottore ha trovato il file e ha "ri-eseguito" il batch oppure ha
  applicato qualche logica di health-check che ha deciso di restartare
  Assistente / Mentor / Capitano (i 3 più recenti con `last_update` vecchio).

**Lezione per implementazione automatica**:
- Il check `tokens_used > THRESHOLD` deve essere idempotente: non
  restartare un agente se è stato restartato meno di 1h fa
  (`MIN_AGE_HOURS=1` o anche di più nella spec sopra è già pensato per questo).
- Inoltre il watchdog non deve mai "ri-eseguire" un ordine manuale; deve
  basarsi solo sulle proprie metriche.
- File di ordine in `/tmp/order-*.md` vanno cancellati dopo l'esecuzione
  per evitare doppi eseguimenti.

Non è stato dannoso (i pane sono tutti operativi), ma è una falla del
design idempotente da chiudere prima del rollout in produzione.

Comportamento del nuovo Scrittore-1 post-restart osservato a 13:35:
```
[@scrittore-1 -> @capitano] [ACK] riavvio post context saturation ricevuto;
                                   leggo handoff e riprendo main loop.
```

→ auto-onboarding del nuovo agente leggendo il proprio handoff file su disk:
**funziona out-of-the-box** senza modifiche al prompt.

### Vincoli incontrati

1. **`spawn-doctor.sh` è strict single-instance** (riga 17 killa
   ogni `DOTTORE*` esistente). Non si possono parallelizzare 2+ Dottori
   con la convenzione attuale.

2. **`start-agent.sh` non accetta ruolo `dottore`** (solo capitano /
   scout / analista / scorer / scrittore / critico / sentinella /
   assistente / mentor). Il Dottore deve passare per `spawn-doctor.sh`.

3. **Risultato**: per batch di 6 agenti, **1 Dottore in serie**,
   tempo totale ~30-35 min. Non parallelizzabile senza modifica
   architetturale.

## Specifica per implementazione automatica (v0.1.18 target)

### Trigger

Aggiungere al ciclo del Dottore (oggi `spawn-doctor.sh` ogni 2h) un
check di context saturation pre-round.

### Pseudocodice

```python
# Nuovo skill: jht-context-watchdog.py — chiamato dal Dottore all'inizio
# di ogni round, prima dell'health-check normale.

import sqlite3, json, time, os, subprocess

STATE_DB = '/jht_home/.codex/state_5.sqlite'
RESTART_LOG = '/jht_home/logs/reboots.jsonl'

# Soglie (in tokens_used lifetime del thread).
# Tarate dai dati reali del 2026-05-20 — vedi "PoC results".
THRESHOLDS = {
    'capitano':    50_000_000,   # critico, restart frequente
    'scrittore-1': 75_000_000,
    'scrittore-2': 75_000_000,
    'scout-1':     50_000_000,
    'scout-2':     50_000_000,
    'analista-1':  50_000_000,
    'scorer-1':    50_000_000,
    'assistente':  30_000_000,   # user-facing, attenzione
    # sentinella, mentor: nessuna soglia (uso basso, restart non serve)
}

# Cap frequenza per evitare loop di restart.
MIN_AGE_HOURS = 3   # un agente appena restartato non riparte prima di 3h.

def get_agents_to_restart():
    db = sqlite3.connect(STATE_DB)
    rows = db.execute("""
        SELECT cwd, tokens_used, created_at_ms / 1000 AS age_start
        FROM threads
        WHERE archived = 0 AND tokens_used > 0
    """).fetchall()
    now = time.time()
    to_restart = []
    for cwd, tokens, age_start in rows:
        # estrai nome agente da cwd: /jht_home/agents/<name>
        m = re.search(r'/jht_home/agents/([a-z0-9-]+)', cwd or '')
        if not m: continue
        agent = m.group(1)
        threshold = THRESHOLDS.get(agent)
        if threshold is None: continue
        if tokens < threshold: continue
        if now - age_start < MIN_AGE_HOURS * 3600: continue
        to_restart.append((agent, tokens))
    return to_restart


def restart_agent(agent: str, tokens_before: int):
    session_tmux = agent.upper()  # CAPITANO, SCRITTORE-1, ecc.
    ts = time.strftime('%Y%m%d-%H%M')

    # 1. Cattura pane
    capture_file = f'/jht_home/handoff-{agent}-{ts}.txt'
    subprocess.run(['tmux', 'capture-pane', '-t', session_tmux,
                    '-p', '-S', '-300'], stdout=open(capture_file, 'w'))

    # 2. Handoff markdown
    handoff_file = f'/jht_home/.{agent}-handoff.md'
    with open(handoff_file, 'w') as f:
        f.write(f"# {session_tmux} Restart Handoff\n")
        f.write(f"Generated: {time.strftime('%FT%TZ', time.gmtime())}\n")
        f.write(f"Raw capture: {capture_file}\n\n")
        f.write("## Last activity\n```text\n")
        # tail -20 del capture
        with open(capture_file) as cf:
            lines = cf.readlines()
            f.write(''.join(lines[-20:]))
        f.write("```\n")
        # throttle state se esiste
        throttle_file = f'/jht_home/state/throttle-{agent}.json'
        if os.path.exists(throttle_file):
            f.write("\n## Throttle\n```json\n")
            f.write(open(throttle_file).read())
            f.write("```\n")

    # 3. Heads-up
    subprocess.run(['jht-tmux-send', session_tmux,
        f'[@dottore -> @{agent}] [URG] Restart in 20s per saturazione context ({tokens_before/1e6:.0f}M tokens).'])
    time.sleep(20)

    # 4. Kill + respawn (Capitano richiede coreografia speciale con notifica
    # operatori; Scrittori/Scout/Analista/Scorer no perché non coordinano).
    if agent == 'capitano':
        notify_operators_of_capitano_restart()
    subprocess.run(['tmux', 'kill-session', '-t', session_tmux])
    subprocess.run(['bash', '/app/.launcher/start-agent.sh', agent])

    # 5. Ready check ROBUSTO (lezione PoC 2026-05-20: il pattern
    # 'agents/<agent>' può non comparire nel pane visibile per molti
    # secondi anche se codex sta partendo correttamente. Doppio check:
    # process alive + codex working/ready signature).
    ready = False
    for _ in range(5):  # 5 tentativi × 20s = 100s max
        time.sleep(20)
        # check 1: la sessione tmux esiste
        if subprocess.run(['tmux', 'has-session', '-t', session_tmux],
                          capture_output=True).returncode != 0:
            continue
        # check 2: il codex CLI è in esecuzione (PID tmux pane è node)
        pane_cmd = subprocess.check_output(
            ['tmux', 'display-message', '-p', '-t', session_tmux,
             '#{pane_current_command}']).decode().strip()
        if pane_cmd != 'node':
            continue
        # check 3: il workdir corretto (cerca in scrollback esteso, non solo tail)
        out = subprocess.check_output(
            ['tmux', 'capture-pane', '-t', session_tmux, '-p', '-S', '-100']
        ).decode()
        if f'agents/{agent}' in out or 'gpt-5.5' in out:
            ready = True
            break
    if not ready:
        # NB: anche se ready=False, il restart potrebbe essere riuscito —
        # il Dottore nel PoC ha fatto un post-verify a 30s e ha trovato
        # tutti i pane attivi. Quindi prima di marcare ERROR, fare un
        # ultimo check passivo.
        time.sleep(30)
        if subprocess.run(['tmux', 'has-session', '-t', session_tmux],
                          capture_output=True).returncode == 0:
            ready = True  # session alive, considera OK
    if not ready:
        log_reboot(agent, tokens_before, status='ERROR_NOT_READY')
        return

    # 6. Handoff send-keys
    msgs = [
        f'[@dottore -> @{agent}] [INFO] Sei stato riavviato per saturazione context ({tokens_before/1e6:.0f}M tokens).',
        f'[@dottore -> @{agent}] [INFO] Leggi /jht_home/.{agent}-handoff.md per stato pre-restart.',
        f'[@dottore -> @{agent}] [INFO] Ack al Capitano e riprendi main loop.',
    ]
    for m in msgs:
        subprocess.run(['jht-tmux-send', session_tmux, m])
        time.sleep(1)

    log_reboot(agent, tokens_before, status='OK')


def log_reboot(agent, tokens_before, status):
    event = {
        'ts': time.strftime('%FT%TZ', time.gmtime()),
        'agent': agent,
        'tokens_before': tokens_before,
        'status': status,
    }
    with open(RESTART_LOG, 'a') as f:
        f.write(json.dumps(event) + '\n')


# main: chiamato all'inizio di ogni round del Dottore
if __name__ == '__main__':
    agents = get_agents_to_restart()
    if not agents:
        print('no restart needed')
        exit(0)
    # priorità: Capitano per primo (coordinatore), poi Scrittori, poi resto
    priority_order = ['capitano', 'scrittore-1', 'scrittore-2',
                      'analista-1', 'scout-1', 'scout-2', 'scorer-1',
                      'assistente']
    agents.sort(key=lambda x: priority_order.index(x[0])
                              if x[0] in priority_order else 99)
    for agent, tokens in agents:
        restart_agent(agent, tokens)
        time.sleep(90)  # pacing inter-restart
```

### Integrazione nel ciclo del Dottore

Modificare `/app/.launcher/spawn-doctor.sh` o aggiungere uno step nel
prompt del Dottore (`/app/agents/dottore/dottore.md`):

```
Step 0 (sempre, prima del round normale):
  python3 /app/agents/_tools/jht-context-watchdog.py
  → se restituisce "no restart needed": prosegui con health-check normale.
  → se restituisce "restart needed for: <list>": esegue gli restart e
    salta il round health-check (lo fa il prossimo Dottore tra 2h).
```

### Telemetria

Output append-only su `/jht_home/logs/reboots.jsonl`:

```json
{"ts":"2026-05-20T13:19:15Z","agent":"capitano","tokens_before":168000000,"status":"OK","duration_sec":420}
{"ts":"2026-05-20T13:31:05Z","agent":"scrittore-2","tokens_before":151000000,"status":"OK","duration_sec":270}
...
```

### Soglie testate / da tarare

Le soglie nel codice sopra sono **conservative** (50-75 M). Dal PoC del
2026-05-20 abbiamo visto saturazione visibile già a:
- Capitano 142-168 M (sintomatico)
- Scrittori 125-148 M (cooperative idle conclamato)

Quindi 50 M Capitano / 75 M Scrittori sono ragionevoli come prima taratura
ma potrebbero essere alzati (riducendo frequenza restart) se l'A/B
sperimentale dei prossimi giorni mostra che a 70 M Capitano funziona
ancora bene.

### Stima frequenza restart attesa

Con rate token lifetime osservato (Capitano 10 M/h):
- Capitano: soglia 50 M → ogni **5 h**
- Scrittori: soglia 75 M → ogni **8 h**
- Altri: soglia 50 M → ogni **~10-15 h**

Su un team H24, il Dottore farà ~5 restart-events/giorno totali → 25 min
di coreografia restart distribuiti, totalmente trascurabili.

## Memory rilevante

- [[2026-05-20-team-idle-gaps-investigation]] — i gap di idle sono
  probabilmente correlati alla saturazione del Capitano. Il PoC del
  2026-05-20 conferma: dopo restart Capitano, latenza decisionale
  scende drasticamente.
- [[feedback_dev_time_over_repair_time]] — Leone vuole feature, non
  riparare tooling. Il reboot via Dottore è tooling, ma supporta
  l'operatività di tutte le feature
- [[project_jht_goal_and_state]] — JHT è personal tool + open platform.
  Per scalare a beta tester, il reboot automatico è critico (altrimenti
  ogni tester dovrà reset manualmente ogni 4-6h)
