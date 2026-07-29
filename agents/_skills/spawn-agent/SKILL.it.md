<!-- @translation: it, ai-translated 2026-06-13 -->
---
name: spawn-agent
description: "Avvia un agente del team JHT (Scout, Analista, Scorer, Scrittore, Critico, Assistente, Capitano-2) tramite il launcher, poi invia il messaggio di kick-off che effettivamente avvia il suo loop principale. Solo Capitano — il Capitano è l'unico proprietario dello scaling del team. Usa SEMPRE questa skill: bypassare `start-agent.sh` con `tmux new-session` + `send-keys \"kimi ...\"` crudo produce sessioni in cui la CLI non parte (`command not found`), il Capitano vede una sessione \"attiva\" che in realtà è morta, e il team sotto-performa silenziosamente."
allowed-tools: Bash(bash /app/.launcher/start-agent.sh *), Bash(tmux *), Bash(jht-tmux-send *), Bash(sleep *), Bash(jht-throttle-check *)
---

# spawn-agent — portare un agente online

Contratto a due fasi: **avviare** la CLI, poi **kick-off** del suo loop. Saltare il kick-off lascia l'agente a un prompt vuoto — il Capitano pensa che stia lavorando, ma non è così.

## Fase 1 — avvio tramite `start-agent.sh`

```bash
bash /app/.launcher/start-agent.sh <role> [instance_number]
```

Esempi:
```bash
bash /app/.launcher/start-agent.sh scout 2       # SCOUT-2
bash /app/.launcher/start-agent.sh analista 1    # ANALISTA-1
bash /app/.launcher/start-agent.sh critico       # CRITICO (singleton, senza numero)
```

**Numero di istanza — tira il dado (worker scalabili, 2026-06-13).** Per `scout` / `analista` / `scorer` / `scrittore`, **NON** scegliere il numero in modo sequenziale: il lavoro si accumulava sempre su `-1`/`-2` mentre `-4` faceva quasi nulla. Tira prima un numero casuale libero, poi passalo:
```bash
N=$(python3 /app/shared/skills/roll_worker_number.py scout) && \
  bash /app/.launcher/start-agent.sh scout "$N"
```
`roll_worker_number.py` tira un **d6 escludendo i numeri già in uso** (le sessioni `SCOUT-N` esistenti) → mai una collisione, e il carico di lavoro si distribuisce tra i numeri di istanza invece di colpire sempre `-1`. Vale **solo per i NUOVI spawn**; i singleton (Critico / Sentinella / Dottore / Assistente / Mentor) restano senza numero, e il session-refresh del Dottore ricrea lo **stesso** numero (non tira il dado).

Il launcher esegue, atomicamente:
- crea la sessione tmux con il nome canonico (`SCOUT-2`, `ANALISTA-1`, …)
- imposta `cwd` a `$JHT_HOME/agents/<role>[-N]/`
- esporta `JHT_HOME · JHT_DB · JHT_AGENT_DIR · PATH · JHT_USER_DIR · JHT_CONFIG`
- rileva il provider attivo da `jht.config.json` (claude / kimi / codex)
- copia `agents/<role>/<role>.md` nel workspace come `CLAUDE.md` / `AGENTS.md`
- avvia la CLI con i flag corretti per quel provider + tier
- ricava lo **sfasamento** iniziale dal gradino di throttle e pre-arma il throttle del nuovo worker

> ⚠️ **MAI** avviare con `tmux new-session ... ; tmux send-keys "kimi ..."`. La CLI non è nel `PATH` al di fuori dell'ambiente del launcher → `command not found` → la sessione è solo bash. Il `jht-tmux-send` del Capitano restituisce `exit 0` scrivendo su quel bash vuoto, il messaggio viene perso silenziosamente, e il team sotto-performa senza causa visibile.

### Sfasamento — lo ricava il launcher, tu non aspetti mai

Due worker sullo stesso gradino di throttle che partono insieme *restano* insieme: ogni loro ciclo cade nello stesso istante, e ogni coincidenza è un picco di richieste simultanee. La distanza che distribuisce `N` worker su un periodo `T` è `T/N` — sul gradino da 5 minuti tre worker si vogliono a **100s** l'uno dall'altro, non a 10 minuti. Un offset più grande di `T` è il caso peggiore (il primo worker ha già ciclato due volte prima che parta il secondo, quindi le fasi finiscono dove capita), e uno esattamente uguale a `T` è lockstep permanente.

Quell'aritmetica la fa il launcher al posto tuo, sul periodo reale in `config/throttle.json` e sui worker che quel gradino lo condividono davvero, e stampa cosa ha deciso:

```
  Stagger:      100s prima del primo ciclo (throttle pre-armato, gradino condiviso)
```

**Tu non aspetti mai.** Il launcher pre-arma il throttle del worker nuovo, così è il worker a fermarsi *da solo* al gate `jht-throttle-check` che il suo prompt gli impone già al primo giro di loop. Manda il kick-off subito, come sempre.

Cosa ne consegue:
- **Il primo worker di un gradino non aspetta niente.** Il percorso anti-idle resta intatto: lo avvii e parte.
- Un worker sfasato sta fermo su `jht-throttle-wait` senza output per al massimo 5 minuti. È un worker **sano** — prima di leggere il silenzio subito dopo uno spawn come uno stallo, verifica con `jht-throttle-check <agente>` (`STILL_THROTTLED remaining=Xs`).
- L'offset fissa solo la fase *iniziale*. La durata dei task varia abbastanza da far derivare le fasi da sole, quindi non c'è niente da ritarare dopo.
- Uno spawn che **non** deve essere ritardato — ricreare un worker che era già in una fase buona — lo disattiva con `JHT_SPAWN_STAGGER=0` nell'ambiente.

## Fase 2 — kick-off (obbligatorio)

Il launcher avvia la CLI ma **non invia alcun primo messaggio**. Senza un kick-off l'agente resta in attesa a un prompt vuoto per sempre.

Sequenza standard:
```bash
bash /app/.launcher/start-agent.sh scout 1
sleep 12   # Boot CLI 8-15s — mai meno di 10
jht-tmux-send SCOUT-1 "[@capitano -> @scout-1] [MSG] <corpo del kick-off>"
```

### Corpo del kick-off per ruolo

| Ruolo       | Corpo del kick-off                                                                                           |
|-------------|--------------------------------------------------------------------------------------------------------------|
| `scout`     | "Avvia il loop principale. Leggi il tuo prompt, il profilo candidato (`$JHT_HOME/profile/candidate_profile.yml`), e inizia dal CERCHIO 1 (preferenza primaria). Notifica gli Analisti dopo batch di 3-5 posizioni." |
| `analista`  | "Avvia il loop principale. Coda: `db_query.py next-for-analista`. Per ogni posizione, compila i 5 campi obbligatori e promuovi a `checked` o `excluded`." |
| `scorer`    | "Avvia il loop principale. Coda: `db_query.py next-for-scorer`. PRE-CHECK prima, poi punteggio 0-100. Gate: <40 escluso, 40-49 parcheggio, ≥50 notifica Scrittori." |
| `scrittore` | "Avvia il loop principale. Coda: `db_query.py next-for-scrittore`. Massimo impegno, 3 round obbligatori con il Critico. Il PDF va sotto `$JHT_USER_DIR/cv/`." |
| `critico`   | "Verrai chiamato dal tuo Scrittore padre con PDF + JD. Una revisione cieca per chiamata, poi stop." |
| `assistente`| "Avvia il loop principale. Attendi `[@utente -> @assistente] [CHAT]` dalla web UI." |

Se il contesto posizione-curriculum non è banale (l'agente aveva lavoro in corso prima di un crash), aggiungilo al kick-off così riprende da dove si era fermato — mai dire solo "riprendi", specifica *cosa* e *dove*:

```bash
jht-tmux-send SCRITTORE-1 "[@capitano -> @scrittore-1] [MSG] Riprendi: posizione #281 (Qargo TMS), il round 2 con il Critico stava per iniziare. Riparti da lì, NON ricominciare da zero."
```

## Fase 3 — verificare che il boot sia riuscito

Circa 5 secondi dopo il kick-off:
```bash
tmux capture-pane -t <SESSION> -p | tail -10
```

Leggi l'output:
- ✅ Banner CLI + spinner + corpo del kick-off visibile nell'area di input → boot OK
- 🟡 `context: 0.0%` e area di input vuota → il kick-off non è arrivato, riprova una volta
- 🔴 Prompt shell `jht@host:~/agents/<role>$` (nessuna CLI) → errore del launcher, vedi fallback sotto

> Nota: i controlli di salute periodici (rilevamento zombie, agenti silenziosi > 10 min) NON sono compito di questa skill — appartengono al **Dottore** tramite la skill `liveness-check`. Questa skill termina una volta che la Fase 3 conferma il boot.

## Fallback — errore del launcher

Se la Fase 3 mostra un prompt shell puro (nessuna CLI avviata), controlla prima:

```bash
tmux capture-pane -t <SESSION> -p -S -50 | grep -iE "command not found|permission denied|no such file"
```

Cause probabili:
1. CLI del provider non nel `PATH` per l'ambiente del launcher → controlla che il provider in `jht.config.json` corrisponda alla CLI installata
2. Il template del ruolo `agents/<role>/<role>.md` manca → il launcher copia un file vuoto → la CLI parte ma non ha istruzioni
3. `$JHT_HOME` non impostato / non esportato nel parent → escalation all'utente, NON provare a impostarlo manualmente

Termina la sessione rotta prima di riprovare:
```bash
tmux kill-session -t <SESSION>
bash /app/.launcher/start-agent.sh <role> <N>
```

## Anti-pattern

- ❌ Avviare più agenti in un loop serrato senza pacing — le regole di scaling stanno in `pipeline-triage` (uno spawn per volta, ri-misurando in mezzo). Quello che non devi mai fare è *inventare un numero fisso di minuti* fra un worker e il successivo: la distanza viene dal gradino (`T/N`) e la applica il launcher per te.
- ❌ Ri-avviare alla cieca dopo un crash senza leggere `db_query.py` per recuperare lo stato dell'ultimo task — il nuovo agente parte da zero e duplica il lavoro.
- ❌ Usare questa skill per "riavviare" un agente funzionante perché sembra lento. Lento ≠ morto. Turni lunghi con output di token visibile non sono un caso di spawn — sono un caso di `liveness-check` (Dottore).
- ❌ Avviare un rimpiazzo perché `jht-tmux-send` non è riuscito a consegnare. **`exit 4` = la TUI target è a metà turno (`Working … esc to interrupt`) → l'agente è VIVO, solo busy.** Il messaggio NON è stato consegnato in modo sincrono: ritenta il send più tardi, mai spawnare un clone. Solo `exit 3` (testo mai apparso E pane non busy → shell nuda / modale bloccato) è un segnale di possibile morte, e anche allora il verdetto spetta al **Dottore** (`liveness-check`), non a uno spawn riflesso. Spawnare su un agente busy è esattamente il bug di overspawn del 2026-06-07 (`docs/internal/postmortems/2026-06-11-overspawn-rootcause.md`): il clone prende il sopravvento mentre l'originale continua a bruciare budget come zombie.
- ❌ Avviare un Critico. Lo Scrittore avvia il proprio `CRITICO-S<N>` autonomamente — il Capitano non tocca mai il Critico direttamente.

## Vedi anche

- `liveness-check` (Dottore) — quando un agente esistente sembra morto.
- `pipeline-triage` (Capitano) — *quale* ruolo avviare in base al backlog.
- `tmux-send` — convenzioni per l'envelope dei messaggi.
- `agents/_team/team-rules.md` T01 — mai terminare la sessione di un altro agente.
