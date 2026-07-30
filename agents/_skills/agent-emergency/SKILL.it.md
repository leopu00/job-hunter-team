<!-- @translation: it, ai-translated 2026-07-30 -->
---
name: agent-emergency
description: "Capitano — gestisce un agente sospettato di essere BLOCCATO IN UN LOOP ATTIVO (vivo e genera turni, ma ripete lo stesso ciclo senza produrre nulla: ping-loop di ACK con un altro agente, stessa azione/query che non porta da nessuna parte). Copre la crepa fra C-08 (morto/silenzioso → Dottore) e C-12 (che brucia a cadenza 0.00/min → kill). Scala graduata, prima il Dottore → kill+respawn pulito solo se persiste o brucia budget. Rilevamento deterministico (diff di capture-pane + 0 progresso nel DB), decisione di escalation lasciata all'LLM."
allowed-tools: Bash(tmux *), Bash(jht-tmux-send *), Bash(/app/.launcher/spawn-doctor.sh *), Bash(bash /app/.launcher/start-agent.sh *), Bash(python3 /app/shared/skills/db_query.py *)
---

# agent-emergency — agente bloccato in un loop attivo

## Perché esiste (la crepa fra C-08 e C-12)

I segnali esistenti coprono due casi:
- **C-08** — un agente **morto / silenzioso** (pane = bash, nessun turno) → diagnosi del **Dottore**.
- **C-12** — un agente che **brucia con `cadenza 0.00/min`, zero checkpoint** → candidato al kill.

Manca il terzo: **un agente VIVO e ATTIVO che RIPETE lo stesso ciclo senza produrre nulla**. Genera
turni (quindi NON è "morto" e NON ha `cadenza 0.00`), ma non avanza di un passo. Esempi reali:
- due sessioni che si rimbalzano **ACK** all'infinito (ping-loop di coordinamento);
- un worker che ripete la **stessa query / stessa azione** senza alcun effetto;
- un agente che rielabora in continuazione lo stesso messaggio non consegnato.

Prima era invisibile → il Capitano non interveniva mai. Questa skill lo rende rilevabile e
gestibile.

## Quando usarla

**Su SOSPETTO**, non a tappeto e non a ogni tick. Avvia questa procedura quando noti uno di questi
indizi (di solito mentre stai facendo altro): un agente che "lavora" da un po' ma la cui coda non si
accorcia / nessuna nuova posizione cambia stato; oppure vedi lo stesso scambio ripetersi nella
chat/nel pane.

## 1. Rilevamento DETERMINISTICO (niente stime a occhio)

Conferma il loop con due controlli economici — **nessun messaggio all'agente** (non disturbarlo,
questo è pull Tier-2):

```bash
# (a) RIPETIZIONE — il pane mostra lo stesso scambio/output N volte?
#     Due catture distanziate: se il contenuto "nuovo" è identico → si sta ripetendo.
tmux capture-pane -t <SESSION> -p -S -60 > /tmp/ae_1.txt
sleep 20
tmux capture-pane -t <SESSION> -p -S -60 > /tmp/ae_2.txt
diff /tmp/ae_1.txt /tmp/ae_2.txt        # differenza di "lavoro vero" scarsa o nulla = loop sospetto

# (b) 0 PROGRESSO NEL DB — l'agente è "attivo" ma non muove nulla nel DB?
#     Se disponibile, l'helper di osservabilità per agente (riusa
#     position_state_transitions): 0 transizioni recenti per questo agente = nessun output.
python3 /app/shared/skills/db_query.py recent-activity   # by_agent: 0 per la sessione = nessun output
#     Fallback generico: la coda a monte dell'agente NON si accorcia fra due controlli
#     (es. next-for-analista invariata mentre ANALISTA-N "sta lavorando").
```

**Verdetto LOOP** = (a) ripetizione **E** (b) 0 progresso, su ≥ 2-3 osservazioni. Se invece il pane
mostra `Working… / esc to interrupt` con contenuto che continua a cambiare, è un **task lungo che è
VIVO** (C-08 bis): quello NON è un loop, lascialo stare.

## 2. Scala graduata — prima il Dottore

### Gradino 1 — giro straordinario del Dottore (PRIMO intervento)

Un refresh del contesto spesso rompe il loop **senza perdere lo stato**. Usa la skill `spawn-doctor`:

```bash
bash /app/.launcher/spawn-doctor.sh
sleep 10
jht-tmux-send DOTTORE \
  "[@$MY_ID -> @dottore] [REQ] Giro mirato: <SESSION> sembra bloccata in un LOOP attivo (ripete <cosa>, 0 progresso nel DB su N tick). Diagnosticala e, se confermato, fai refresh/riparazione della sessione. Rispondi con [RES]."
# Attendi il [RES] del Dottore — niente polling.
```

### Gradino 2 — Kill (+ respawn) — SOLO se serve

Killa **solo se**: il loop **persiste dopo il Dottore**, *oppure* sta **bruciando budget
seriamente** (rate alto + 0 output per ≥ N tick e non c'è tempo per una diagnosi).

⚠️ **SALVAGUARDIA contro il doppio spawn con il watchdog.** `agent-watchdog.sh` fa respawn
automatico (≤30s) **solo dei 3 agenti core**: `ASSISTENTE`, `CAPITANO`, `MENTOR`. NON copre i
worker. Quindi il respawn dipende dal target:

- **Target = agente CORE (ASSISTENTE / MENTOR)** → **SOLO kill**. Il watchdog lo rileva e **lo fa
  ripartire pulito da solo** (`jht team start <role>`, idempotente, stato fresco). **NON** eseguire
  anche tu `start-agent.sh` → sarebbe un doppio spawn (la race che è stata segnalata). Il "backoff"
  è di fatto l'intervallo del watchdog (~30s). (Il CAPITANO sei tu: non è mai il target — non killi
  te stesso.)
  ```bash
  tmux kill-session -t <SESSION>     # FERMATI qui: il watchdog fa respawn pulito entro 30s
  ```
- **Target = WORKER (Scout / Analista / Scorer / Scrittore / Critico)** → il watchdog NON li copre,
  quindi **kill + backoff + respawn li fai tu** (nessuna race):
  ```bash
  tmux kill-session -t <SESSION>
  sleep 5                                                 # backoff: non ricadere subito nel loop
  bash /app/.launcher/start-agent.sh <role> <N>          # respawn PULITO (stato fresco)
  ```

Il backoff + il respawn a stato fresco evitano che riparta esattamente nello stesso ciclo; non fare
il respawn degli agenti core evita la race con il watchdog.

## Regole

- **Prima il Dottore, il kill DOPO.** Non killare mai al primo sospetto: un task lungo legittimo
  sembra "bloccato" ma è vivo (C-08 bis). Il kill è l'ultima risorsa.
- **Rilevamento e kill sono deterministici; l'escalation è una tua scelta (LLM).** Non startene a
  fissare i pane a ogni tick: applica questa procedura quando un sospetto matura.
- **Non disturbare l'altro agente per indagare.** I controlli sono pull (capture-pane + DB), nessun
  messaggio all'agente sospetto (che aggiungerebbe solo un altro turno al loop).
- **Non killare mai le sessioni di servizio `*-WORKER-*`** se non sai cosa sono — controlla prima il
  ruolo.
