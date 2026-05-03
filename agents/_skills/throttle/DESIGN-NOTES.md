# throttle — note di design e roadmap

Documento di stato sul lavoro fatto attorno al "blocco hard" del throttle.
Riassume il problema, le soluzioni considerate, la decisione finale e lo
stato attuale del codice in sandbox + JHT proper. **Da rivedere in un
merge collettivo prima del rollout.**

## Contesto del problema

Il design dichiarato in `SKILL.md` riga 81: *"The agent stays blocked the
whole time."* Durante un `jht-throttle <N>` l'agente deve essere fermo per
N secondi reali, come uno `sleep N` nudo.

In pratica, per `N > timeout della tool call shell del CLI` (Kimi 60s,
Codex 30s, Claude 120s), questo non sta succedendo. Il commento del
wrapper `agents/_tools/jht-throttle` recita:

> "15s è sotto qualsiasi default provider → il parent sopravvive al
> timeout su tool call lunghe."

L'affermazione è **sbagliata**: il timeout della tool call è sulla durata
totale, non sul singolo syscall. Un loop di 40 × `sleep 15` cumula a 600s
e viene killato a 60s lo stesso. Conseguenza: dopo `timeout_tool_call`
l'agente è libero, processa nuovi messaggi tmux. Esattamente l'opposto
del comportamento desiderato.

Cronologia del bug:

- Commit `47949eef` (3 mag) introduce il pattern detached **e droppa** la
  guida "pass timeout: 270 alla tool call" definendola "misleading
  workaround". Era invece la chiave per il blocco hard.
- Da quel momento il design garantisce solo il logging corretto (start+end
  accoppiati nel JSONL), non il blocco effettivo.

Dimostrazione empirica del bug nella sessione del 3 mag:

- Scrittore-1 riceve `[URG] FREEZE 600s` dal Capitano, vede `Killed by
  timeout (60s)` come output di `jht-throttle 600`, lo interpreta come
  fallimento e lancia 3 throttle accumulati (config + esplicito + nohup).
- Scout-1 riceve lo stesso ordine, riconosce `Killed by timeout` come
  comportamento atteso (cita AGENTS.md), chiama `jht-throttle-check`,
  conferma `STILL_THROTTLED remaining=581s`, manda ACK pulito.

La differenza è 100% interpretativa. Il pattern detached funziona per il
logging ma non blocca davvero.

## Soluzioni considerate

### Soluzione 1 — Timeout esplicito sulla tool call

L'agente quando chiama `jht-throttle <N>` passa al CLI un `timeout >= N+30`
sulla tool call shell. Così il CLI non killa il parent, il loop di sleep
chunk cumula fino a `until` e l'agente resta hard-bloccato.

- **Pro**: minimo, modifica solo prompt + un echo nel wrapper. Compatibile
  col design corrente.
- **Contro**: richiede disciplina dell'agente. Vincolata al cap massimo
  che il CLI permette (es. wall hard 600s su Claude). Se l'agente non sa
  N a priori (modalità config-driven), deve passare `MAX_SLEEP` (1h).

### Soluzione 3 — Bridge/proxy con coda dei messaggi

Il `jht-tmux-send` controlla lo state file del destinatario; se throttle
attivo, accoda il messaggio in `$JHT_HOME/queue/<agent>.jsonl`. Un daemon
`jht-tmux-drainer` consegna a fine pausa, FIFO.

- **Pro**: blocco hard reale dei messaggi indipendente dal CLI. Anche se
  l'agente è "libero" perché il parent è morto, non riceve nulla che lo
  distragga.
- **Contro**: componente nuovo (drainer) da scrivere e mantenere. Code
  + lock + recovery orfani + race window apertura throttle.

**Stato implementativo**: prototipato e testato in `seriea-sandbox/` con
3 sessioni Kimi reali. Tutti i test verdi:

| Test | Scenario | Esito |
|---|---|---|
| A | best case 1 msg in coda | PASS |
| B | 5 msg in burst FIFO | PASS |
| C | `--bypass-throttle` | PASS |
| D | drainer crash + restart (orfano) | PASS dopo fix `.orphan-<ts>` |
| E | delivery diretta senza throttle | PASS |
| F | 15 msg stress | PASS |
| G | race drain+bypass concorrenti | PASS dopo fix lock per-sessione |
| H | sessione tmux killata | PASS (audit log) |
| D2/G2 | retest post-fix | PASS |

Bug residui non bloccanti:
- Race window apertura throttle (~100-300ms gap tra invocazione
  `jht-throttle` e write dello state file): in quella finestra un send
  concorrente vince e va diretto.
- Nessuna retry queue per `delivery FAILED`: se la session è morta, msg
  perso (loggato + audit).

### Soluzione 4 — Rejection al mittente (proposta più recente)

`jht-tmux-send` controlla lo state file del destinatario; se throttle
attivo **non accoda**, ma **respinge** con exit `5` e stderr informativo:

```
jht-tmux-send: REJECTED dest=redattore-1 throttled
               until=2026-05-03T20:35:41Z remaining=87s
```

Il mittente decide cosa fare: retry dopo `remaining`, switch a
`--bypass-throttle`, fallback DB-driven, skip + log.

- **Pro**: elimina drainer, queue dir, orphan recovery, race drain+bypass,
  API queue. ~150 righe in meno rispetto alla Soluzione 3 implementata in
  sandbox. Coerente con la natura dei messaggi tmux-send (real-time
  signal, devono fallire visibili).
- **Contro**: nessuna garanzia di delivery. Mittente deve gestire l'errore.
  Pattern ridondante per [URG] del Capitano (lui sa già che lo ha
  throttlato e non dovrebbe parlargli — la rejection è un safety net per
  errori di logica).

## Decisione

**Adottata la combinazione Soluzione 1 + Soluzione 4** (rejection):

- **Soluzione 1 = blocco hard dell'agente che chiama `jht-throttle`**.
  Documentare nel SKILL.md e nei prompt agente l'obbligo di passare
  `timeout = N+30` alla tool call shell. Echo informativo a inizio del
  wrapper. Senza questo, il blocco fallisce silenziosamente.
- **Soluzione 4 = rejection del messaggio inbound a un agente
  throttled**. Il `jht-tmux-send` legge lo state file e respinge con exit
  5 + diagnostico. Il flag `--bypass-throttle` resta come kill-switch del
  Capitano per emergenze.

La Soluzione 3 (coda + drainer) è stata costruita e testata, ma viene
**superata** dalla Soluzione 4 perché:
- I mittenti del JHT sono LLM agent intelligenti, sanno gestire un retry.
- Il Capitano (mittente principale) conosce già lo stato dei suoi agenti.
- La policy di comunicazione del JHT preferisce DB-driven per i messaggi
  importanti; tmux-send è canale real-time signal.
- Meno componenti da mantenere = meno superfici di failure.

Il lock per-sessione introdotto per fixare il keystroke interleaving (Test
G della Soluzione 3) **ha senso indipendentemente** ed è da mantenere
anche con la Soluzione 4: protegge da send concorrenti normali (es. due
agenti che parlano al Capitano nello stesso istante).

## Stato del codice

### sandbox `seriea-sandbox/` (gitignored)

Repo separata con master + dev-1 + dev-2 worktrees, 3 sessioni Kimi reali
(CAPITANO, REDATTORE-1, REDATTORE-2). Contiene:

- `master/agents/_tools/jht-tmux-send` — patched: parse
  `--bypass-throttle`, delega throttle check a `jht-throttle-check`, lock
  per-sessione, **append a queue se throttle attivo**.
- `master/agents/_tools/jht-tmux-drainer` — daemon FIFO con orphan
  recovery (singola istanza via PID file).
- `master/agents/_tools/jht-throttle{,-check,-wait}` — copie immutate dal
  JHT, usate come libreria.
- `master/jht_home/{state,queue,logs}/` — runtime state.
- `THROTTLE-FIX-PROPOSAL.md` — versione iniziale della proposta (1+3).

Decisioni operative per il merge:
- Il drainer e la queue dir vanno **rimossi** (Soluzione 3 superata).
- Il `jht-tmux-send` patched va **modificato di nuovo**: invece di
  appendere a queue, exit 5 con diagnostico (Soluzione 4).
- Il lock per-sessione **resta**.
- La sandbox può essere distrutta dopo il merge (è gitignored, niente
  perdita).

### JHT proper — committed

Branch `dev-2`:

- `chore(gitignore): ignora seriea-sandbox/`  (`95030b95`)
- `feat(api): /api/team/queue — stato deviazione messaggi durante
  throttle`  (`0d9371c6`)

L'API `/api/team/queue` è stata committata pensando alla Soluzione 3.
Con la decisione 1+4, va **rinominata e semplificata**: niente queue,
solo `throttleUntil` per ogni agente con throttle attivo.

Proposta: `/api/team/throttled` che ritorna
`{ agents: [{ agent, throttleUntil }] }` letto solo da
`$JHT_HOME/state/throttle-*.json`. La dir `queue/` non sarà più scritta
da nessuno con la Soluzione 4.

### JHT proper — WIP non committato

`web/app/(protected)/team/_components/TeamOrgChart.tsx`:

Modifiche pensate per la Soluzione 3:
- Polling `/api/team/queue` ogni 2.5s, aggregato per role.
- `pushAnim` accetta `destRole`: se in throttle, animation con
  `keyPoints="0;0.85"` + `fill="freeze"` (pallino fermo all'85%).
- Watcher: quando il throttle scade per un role, le anim freezed
  vengono completate con animation `keyPoints="0.85;1"`.
- CSS keyframe `team-msg-queued-pulse` per pulsare il halo del
  pallino fermo.

**Da adattare per la Soluzione 4**:
- Il pallino non si "ferma e poi completa" → **rimbalza** (animation
  `keyPoints="0.85;0"` per tornare al mittente).
- Il watcher "throttle scaduto → completion" sparisce (non c'è msg in
  attesa; se torna a casa, è già finito).
- Il polling diventa `/api/team/throttled` (più semplice).
- Aggiungere badge "in pausa" sul nodo destinatario con countdown
  (al posto del badge "queued: N" che non serve più).

## Roadmap per il merge collettivo

In ordine, separati per scope:

1. **Documentazione**:
   - `agents/_skills/throttle/SKILL.md` — sezione "Hard block requires
     explicit timeout" da inserire come regola obbligatoria. Ripristinare
     la guida "pass `timeout: N+30`" che era stata droppata.
   - `agents/{scrittore,scout,...}/*.md` — sezione FREEZE: aggiungere
     esempio esplicito con timeout della tool call.

2. **Wrapper `jht-throttle`**:
   - Echo informativo a inizio del loop bloccante:
     `[throttle] applied=<N>s. Tool call timeout >= <N>+30s richiesto,
     altrimenti il blocco non avviene.`

3. **Wrapper `jht-tmux-send`**:
   - Aggiungere parse `--bypass-throttle`.
   - Aggiungere check throttle del destinatario via `jht-throttle-check`.
   - Se throttled: `exit 5` con stderr `REJECTED dest=X throttled
     until=... remaining=Ys`.
   - Aggiungere lock per-sessione (mkdir atomic + stale PID recovery).

4. **API web**:
   - Rinominare `web/app/api/team/queue/` → `web/app/api/team/throttled/`
     con schema `{ agents: [{ agent, throttleUntil }] }`.

5. **UI `TeamOrgChart.tsx`**:
   - Cambiare il `keyPoints` della completion da `0.85;1` a `0.85;0`
     (rimbalzo invece di delivery).
   - Polling `/api/team/throttled` invece di `queue`.
   - Badge "in pausa" sul nodo con countdown.

6. **Cleanup sandbox**:
   - Distruggere `seriea-sandbox/` quando il merge è chiuso (è
     gitignored, nessun riferimento condiviso).

## Riferimenti

- Commit `47949eef` — feat(throttle): detached-child pattern
- Commit `885a7ca2` — fix(throttle/test): boot graduale + sleep nudo
- Commit `0d9371c6` — feat(api): /api/team/queue (da rinominare)
- `agents/_skills/throttle/SKILL.md` — design dichiarato
- `agents/_tools/jht-throttle` — wrapper con commento errato sui chunk 15s
- `seriea-sandbox/THROTTLE-FIX-PROPOSAL.md` — versione iniziale proposta
