---
name: agent-emergency
description: Capitano — gestisce un agente sospettato BLOCCATO IN UN LOOP ATTIVO (vivo e che genera turni, ma ripete lo stesso ciclo senza produrre: ping-loop di ACK con un peer, stessa azione/query a vuoto). Copre la crepa fra C-08 (morto/silenzioso → Dottore) e C-12 (brucia con cadenza 0.00/min → kill). Scala graduata Dottore-FIRST → kill+respawn-pulito solo se persiste o brucia budget. Rilevamento deterministico (capture-pane diff + 0 avanzamento DB), decisione di escalation all'LLM.
allowed-tools: Bash(tmux *), Bash(jht-tmux-send *), Bash(/app/.launcher/spawn-doctor.sh *), Bash(bash /app/.launcher/start-agent.sh *), Bash(python3 /app/shared/skills/db_query.py *)
---

# agent-emergency — agente in loop attivo

## Perché esiste (la crepa fra C-08 e C-12)

I segnali esistenti coprono due casi:
- **C-08** — agente **morto / silenzioso** (pane = bash, nessun turno) → diagnosi del **Dottore**.
- **C-12** — agente che **brucia con `cadenza 0.00/min`, zero checkpoint** → kill candidate.

Manca il terzo: **agente VIVO e ATTIVO che RIPETE lo stesso ciclo senza produrre**. Genera turni
(quindi NON è "dead" e NON ha `cadenza 0.00`), ma non avanza. Esempi reali:
- due sessioni che si rimbalzano **ACK** all'infinito (ping-loop di coordinamento);
- un worker che ripete la **stessa query / stessa azione** a vuoto;
- un agente che ri-elabora lo stesso messaggio non consegnato.

Era invisibile → il Capitano non interveniva. Questa skill lo rende rilevabile e gestibile.

## Quando usarla

**Su SOSPETTO**, non a tappeto e non a ogni tick. Fai partire questa procedura quando noti uno di
questi indizi (di solito mentre fai altro): un agente che da un po' "lavora" ma la sua coda non
cala / nessuna nuova posizione cambia stato; oppure in chat/pane vedi lo stesso scambio ripetersi.

## 1. Rilevamento DETERMINISTICO (niente "a occhio")

Conferma il loop con due check economici — **nessun messaggio all'agente** (non disturbarlo, è Tier-2
pull):

```bash
# (a) RIPETIZIONE — la pane mostra lo stesso scambio/output N volte?
#     Due cattute a distanza: se il contenuto "nuovo" è identico → ripete.
tmux capture-pane -t <SESSION> -p -S -60 > /tmp/ae_1.txt
sleep 20
tmux capture-pane -t <SESSION> -p -S -60 > /tmp/ae_2.txt
diff /tmp/ae_1.txt /tmp/ae_2.txt        # poche/nessuna differenza "di lavoro" = sospetto loop

# (b) 0 AVANZAMENTO DB — l'agente è "attivo" ma non muove nulla nel DB?
#     Se disponibile, l'helper by-agent dell'osservabilità (riusa
#     position_state_transitions): 0 transizioni recenti di questo agente = non produce.
python3 /app/shared/skills/db_query.py recent-activity   # by_agent: 0 per la sessione = nessun output
#     Fallback generico: la coda a monte dell'agente NON cala fra due check
#     (es. next-for-analista invariata mentre ANALISTA-N "lavora").
```

**Verdetto LOOP** = (a) ripetizione **E** (b) 0 avanzamento, su ≥ 2-3 osservazioni. Se invece la pane
mostra `Working… / esc to interrupt` con contenuto che cambia, è un **task lungo VIVO** (C-08 bis):
NON è un loop, lascia stare.

## 2. Scala graduata — Dottore-FIRST

### Rung 1 — Dottore straordinario (PRIMO intervento)

Spesso un refresh del contesto rompe il loop **senza perdere lo stato**. Usa la skill `spawn-doctor`:

```bash
bash /app/.launcher/spawn-doctor.sh
sleep 10
jht-tmux-send DOTTORE \
  "[@$MY_ID -> @dottore] [REQ] Round mirato: <SESSION> sembra in LOOP attivo (ripete <cosa>, 0 avanzamento DB su N tick). Diagnostica e, se confermato, refresh/ripara la sessione. Riporta con [RES]."
# Attendi il [RES] del Dottore — niente polling.
```

### Rung 2 — Kill (+ respawn) — SOLO se serve

Killa **solo se**: il loop **persiste dopo il Dottore**, *oppure* sta **bruciando budget in modo
serio** (rate alto + 0 produzione per ≥ N tick e non c'è tempo per la diagnosi).

⚠️ **SAFEGUARD anti-doppio-spawn col watchdog.** `agent-watchdog.sh` respawna automaticamente (≤30s)
**solo i 3 agenti core**: `ASSISTENTE`, `CAPITANO`, `MENTOR`. NON copre i worker. Quindi il respawn
dipende dal target:

- **Target = agente CORE (ASSISTENTE / MENTOR)** → **SOLO kill**. Il watchdog lo rileva e lo
  **respawna pulito da solo** (`jht team start <role>`, idempotente, stato fresco). **NON** fare anche
  tu `start-agent.sh` → sarebbe doppio-spawn (la race segnalata). Il "backoff" è di fatto l'intervallo
  del watchdog (~30s). (Il CAPITANO sei tu: non è mai il target — non ti killi da solo.)
  ```bash
  tmux kill-session -t <SESSION>     # STOP qui: il watchdog respawna clean in ≤30s
  ```
- **Target = WORKER (Scout / Analista / Scorer / Scrittore / Critico)** → il watchdog NON li copre,
  quindi **kill + backoff + respawn tu** (nessuna race):
  ```bash
  tmux kill-session -t <SESSION>
  sleep 5                                                 # backoff: non rientrare subito nel loop
  bash /app/.launcher/start-agent.sh <role> <N>          # respawn PULITO (stato fresco)
  ```

Il backoff + il respawn a stato fresco evitano che riparta esattamente nello stesso ciclo; il
non-respawn-sui-core evita la corsa col watchdog.

## Regole

- **Dottore PRIMA, kill DOPO.** Mai kill al primo sospetto: un task lungo legittimo sembra "fermo"
  ma è vivo (C-08 bis). Il kill è l'ultima istanza.
- **Rilevamento e kill sono deterministici; l'escalation la decidi tu (LLM).** Non startene a
  fissare le pane ad ogni tick: applica questa procedura quando un sospetto matura.
- **Non disturbare il peer per indagare.** I check sono pull (capture-pane + DB), nessun messaggio
  all'agente sospetto (che aggiungerebbe un altro turno al loop).
- **Mai kill di sessioni `*-WORKER-*` di servizio** se non sai cosa sono — verifica il ruolo prima.
