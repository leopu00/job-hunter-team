<!-- @translation: it, ai-translated 2026-06-06 -->
---
name: daily-restart-wave
description: "Riavvio di massa preventivo di tutti gli agenti del team una volta ogni 24h per freschezza del contesto. Responsabilità del Dottore. Viene eseguito solo dentro una finestra giornaliera stretta (default 03:00 UTC ± 30 min) e solo se nessun wave è partito nelle ultime 23h. Ogni agente viene killato + respawnato tramite la stessa sequenza atomica di `liveness-check` Step 3, ordinato tier 3 → tier 2 → tier 1 così i worker vengono ciclati per primi e i coordinatori (Capitano/Sentinella/Mentor/Assistente) per ultimi. Background: le sessioni Codex/Kimi long-lived accumulano \"rumore\" — vecchie decisioni, fatti obsoleti, drift del prompt — e diventano misurabilmente meno lucide dopo ore. Evidenza empirica dal Case Study #1 (run Codex 2026-05-19/21): il riavvio di massa manuale ha ripristinato la qualità decisionale. Questa skill chiude quel gap senza intervento manuale."
allowed-tools: Bash(tmux *), Bash(jht-tmux-send *), Bash(bash /app/.launcher/start-agent.sh *), Bash(python3 /app/shared/skills/db_query.py *), Bash(sleep *), Bash(cat *), Bash(mkdir *), Bash(date *)
---

# daily-restart-wave — riavvio preventivo per freschezza del contesto

Il lavoro normale del Dottore (`liveness-check`) è **conservativo**: riavvia solo i silenziosamente morti. Questa skill è l'opposto: **riavvia tutti, di proposito, una volta al giorno**, perché le sessioni agente long-running driftano anche quando non muoiono. Stessa primitiva atomica di respawn (`liveness-check` Step 3), diverso trigger e diverso ordinamento.

## Perché esiste

Empirico: nel Case Study #1 (run Codex 2026-05-19/21, vedi `docs/about/RESULTS.md`) il manutentore ha notato un degrado della qualità decisionale dopo ~12-24h di uptime continuo degli agenti — errori ripetuti, riferimenti a fatti obsoleti, occasionale ignoramento di ordini espliciti dell'utente. Un'istruzione manuale "riavvia tutti" all'ora ~30 ha visibilmente ripristinato la lucidità. Codex non espone una finestra di contesto come Claude/Kimi, quindi il drift è invisibile finché non confronti prima/dopo.

Teorico: ogni sessione LLM è una lunga conversazione. Man mano che i token si accumulano il modello:
- Si ancora su decisioni prese presto che potrebbero essere state sbagliate
- Ragiona su fatti obsoleti (un annuncio chiuso, una strategia rivista)
- Diventa più lento per turno (più KV-cache da attendere)
- Si allontana dal system prompt sotto la pressione dell'utente ("lo sweep delle team rules")

Un boot fresco rilegge il prompt + lo stato recente del DB + gli snapshot di handoff e decide da terra pulita. Costo: ~2 min/agente di "mi sto aggiornando". Beneficio: ore di output di bassa qualità evitate.

## Quando lanciarlo — le 3 condizioni di gate

TUTTE E TRE devono essere vere. Salta con `status=skipped` e un campo `reason` nel log altrimenti.

1. **Dentro la finestra giornaliera**. Default: 03:00 UTC ± 30 min (cioè 02:30–03:30 UTC). Motivazione: finestra di bassa attività utente reale per utenti diurni europei/USA; se l'utente dorme, la parata di ~10 min di riavvio è invisibile. Leggi l'ora corrente:

   ```bash
   now_h=$(date -u +%H)
   now_m=$(date -u +%M)
   # 02:30 ≤ now ≤ 03:30
   in_window=$([ "$now_h" = "02" -a "$now_m" -ge "30" ] || [ "$now_h" = "03" -a "$now_m" -le "30" ] && echo yes || echo no)
   ```

2. **Nessun wave nelle ultime 23h** (anti-thrash). Leggi `/jht_home/logs/daily-restart-wave-state.json`:

   ```json
   { "last_wave_at": "2026-05-30T03:11:42Z", "agents_restarted": 9, "duration_sec": 612 }
   ```

   Se il file non esiste → tratta come "mai eseguito" → condizione vera.
   Se `now - last_wave_at < 23h` → salta con `reason=anti_thrash`.

3. **Il team non è in `.team-halted.flag` o `.weekly-halt.flag`**. Se uno dei due flag esiste, l'utente ha esplicitamente messo in pausa il team — riavviare ora sarebbe ostile.

   ```bash
   [ -f /jht_home/.jht/.team-halted.flag ] && skip
   [ -f /jht_home/.jht/.weekly-halt.flag ] && skip
   ```

Se tutte e 3 passano → procedi. L'intero blocco dei 3 check dura `<2s`, gira a ogni risveglio del Dottore, non costa nulla quando fuori finestra.

## Ordine di riavvio — tier 3 → tier 2 → tier 1

Inverso di `liveness-check` (che controlla prima quelli user-facing così non muoiono inosservati). Per un wave preventivo vogliamo l'opposto: **worker per primi, coordinatori per ultimi**, così il Capitano è l'ultimo a perdere il suo thread e può osservare (nel suo pannello) che tutti i suoi worker sono tornati freschi, poi lui stesso viene riciclato e inizia la nuova giornata con una lavagna pulita.

```
TIER 3 (worker, riavvia PER PRIMI):
  SCOUT-*, SCRITTORE-*, CRITICO-*, ANALISTA-*, SCORER-*

TIER 2 (semi-coordinatori):
  (nessuno oggi — riservato per futuri "coordinatori subordinati")

TIER 1 (user-facing long-lived, riavvia PER ULTIMI):
  ASSISTENTE, MENTOR, SENTINELLA, CAPITANO   (Capitano ultimo degli ultimi)
```

Sessioni vuote del tier 3 (es. `SCRITTORE-*` quando nessun CV è in volo per Writer-on-demand V6) → salta silenziosamente, niente kill, niente respawn. Il prossimo spawn-on-demand dal Capitano sarà fresco comunque.

## Notifica al Capitano — 10 minuti prima

Il Capitano coordina spawn/scaling. Se sta per spawnare una raffica di Scrittori e lo killiamo 30s dopo, lo spawn muore a metà volo. Quindi:

1. **A t=0 del wave** (decisione di lanciare presa), PRIMA di toccare qualsiasi agente, manda al Capitano un heads-up via `tmux-send`:

   ```
   [HEADS-UP DOTTORE → CAPITANO] Daily restart wave parte fra 10 min.
   Non spawnare nuovi worker fino a NEW DAY. Termina task <5min in corso.
   Quando arriva il tuo turno (ultimo), ti riavvio io.
   ```

2. **Sleep 10 min**. Dai al Capitano tempo di drenare lo stato short-lived.

3. **Poi inizia la parata** nell'ordine tier 3 → tier 1.

Se il Capitano è già uno zombie (bash nuda), salta l'heads-up e vai direttamente alla parata — non c'è nulla da coordinare.

## La primitiva di respawn — riusa lo Step 3 di liveness-check

Per ogni sessione target, indipendentemente dallo stato di liveness:

```
a. tmux capture-pane -t <SESSION> -S -200 -p > /tmp/$session-pre-restart.log
b. python3 /app/shared/skills/db_query.py <agent-role> --recent-context   (opzionale)
c. tmux kill-session -t <SESSION>
d. bash /app/.launcher/start-agent.sh <agent-role> [<instance-num>]
e. sleep 8s   (lascia la CLI fare il boot)
f. tmux send-keys -t <SESSION> "RESUME: daily restart wave. Riprendi dai recenti log DB (db-query) + tuo prompt di identità. Nessuna task short-lived persa: il Capitano ha drenato la coda 10 min fa." Enter
g. log event=agent_restarted, agent=<role-N>, duration_ms=<X>
```

Note:
- La cattura del pannello va in `/tmp/` così la nuova istanza può leggerla se vuole ispezionare "cosa stavo facendo".
- NON scriviamo `~/.jht/<agent>-pre-respawn-snapshot.txt` qui (quello è un handoff strutturato richiesto nel follow-up del BACKLOG ma richiede che il prompt di ogni agente sappia come scriverlo+leggerlo — fuori scope per l'MVP, tracciato separatamente).
- Il messaggio di kick-off `RESUME:` è generico; dice all'agente di guardare le sue tracce DB piuttosto che affidarsi a uno snapshot interno.

## Pacing inter-riavvio

Aspetta **15-20s tra agenti** dello stesso tier. Perché:
- Chiamate `start-agent.sh` rapide back-to-back possono fare race su scritture condivise in `~/.jht/.local/` (RULE-T13 magazzino python).
- Dà alla CLI di ogni nuovo agente ~10s per stabilizzarsi (handshake, listing tool, eval system prompt) prima che il prossimo inondi il server tmux.

Tempo totale per un team sano (8-10 sessioni):
- 1 min heads-up + 10 min sleep Capitano
- 7 agenti tier-3 × ~20s = ~2.5 min (la maggior parte assenti in stato stazionario)
- 4 agenti tier-1 × ~30s (prompt più pesanti) = ~2 min
- **Budget totale: ~15 min**, comodamente sotto il worst-case di 30 min che il Dottore potrebbe essere vivo per il wave.

## Log di fine wave

Appendi a `/jht_home/logs/dottore-actions.jsonl`:

```json
{"ts":"2026-05-31T03:08:11Z","event":"daily_restart_wave_done","agents_restarted":9,"agents_skipped_empty":3,"duration_sec":612,"capitano_ack":"yes"}
```

Aggiorna il file di stato `/jht_home/logs/daily-restart-wave-state.json`:

```json
{ "last_wave_at": "2026-05-31T03:08:11Z", "agents_restarted": 9, "duration_sec": 612 }
```

Notifica il Capitano (ora fresco) con una riga:

```
[DA DOTTORE A CAPITANO] Daily restart wave completato alle 03:08 UTC.
9 agenti riavviati, 0 errori. Team di nuovo online — riprendi la pipeline.
```

## Modalità di fallimento — cosa fare

| Fallimento | Azione |
|---|---|
| `start-agent.sh` exit ≠ 0 per qualche agente | Log `event=agent_restart_failed`, salta al prossimo, NON abortire il wave. Il prossimo giro routinario `liveness-check` noterà l'assenza e riproverà. |
| Server `tmux` non risponde (raro) | Aborta il wave, log `event=tmux_dead`, NON aggiornare `last_wave_at` (così il prossimo Dottore riprova). |
| Wave abortito a metà (timeout budget Dottore 10 min) | Log `event=daily_restart_wave_partial`, NON aggiornare `last_wave_at`. Il prossimo Dottore dentro la finestra riprenderà (ri-check anti-thrash fallirà fino a 23h, ma è lo stesso wave — accetta il raro double-tap). |
| Il Capitano non fa mai ACK dell'heads-up | Aspetta i 10 min comunque. Se è silenzioso a t=10 la parata lo killa anche — il nuovo Capitano partirà pulito. |

## Cosa questa skill NON fa

- ❌ **Riavvio su richiesta** fuori dalla finestra giornaliera. Se l'utente vuole "riavvia tutti ora", messaggia l'Assistente / Capitano, e uno di loro chiama `spawn-agent` per target o chiede al Dottore di saltare il gate (un parametro esplicito futuro, non nell'MVP).
- ❌ **Snapshot del task in volo** di ogni agente. Oggi il respawn si basa sull'agente che rilegge DB + capture-pane in `/tmp/`. Un handoff appropriato (ogni agente scrive "cosa stavo facendo + prossimo step" prima di uscire) richiede modifiche ai prompt di tutti i 10 agenti — tracciato come follow-up BACKLOG separato.
- ❌ **Lettura di `~/.jht/preferences.json`** per tuning per-utente di ora/finestra. L'MVP hardcoda 03:00 UTC ± 30 min, 23h anti-thrash. Se l'utente è in un fuso orario non-EU e vuole una finestra diversa, modifica questo file skill (o aspetta il follow-up hook preferences.json).
- ❌ **Override di `.team-halted.flag`**. Se l'utente ha fermato il team, niente wave. Punto.
