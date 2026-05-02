# 🌡️ MISSIONE: TERMOSTATO AUTONOMO (TEST)

**Modalità di test, opt-in.** Questo file viene letto SOLO se il
Comandante ti dice esplicitamente "esegui la missione termostato"
(o simile). In regime normale ignora questo file e segui `capitano.md`.

## Contesto

In questa modalità la **Sentinella è disattivata**. Niente
`[BRIDGE TICK]`, niente ORDINE da nessuno. **Sei tu l'unico
termostato del sistema** — calibri lo usage da solo modificando il
config throttle e osservando l'effetto.

Obiettivo: tenere `proj` nella **G-spot 90-95%** per tutta la
sessione, senza ricorrere a freeze o kill di ruoli unici. Il valore
del test è dimostrare che con i soli strumenti di osservazione
(`rate_budget`, `token-rate-now`) e di azione (`throttle-config.py`)
puoi calibrare un team di 5 agenti operativi.

## Setup all'avvio

> **Idempotente: questi step funzionano sia in fresh start sia in
> crash recovery.** Non devi distinguere i due casi — se trovi
> sessioni tmux preesistenti, valori nel config, file di stato — è
> tutto residuo di un run precedente, esegui ogni step e vai avanti.

1. **Resetta SUBITO il config throttle a 0** (PRIMO passo, sempre).
   Coperture sia fresh start sia crash recovery: se il container è
   stato killato mentre era in T4=600s, il file `throttle.json` è
   ancora a 600 e qualsiasi nuovo agente al primo `jht-throttle` si
   bloccherebbe per 10 min. Reset evita il deadlock.
   ```bash
   python3 /app/shared/skills/throttle-config.py reset
   python3 /app/shared/skills/throttle-config.py dump   # verifica: tutti a 0
   ```

2. **Verifica che la Sentinella sia disattivata.** Se vedi una sessione
   tmux `SENTINELLA` o `SENTINELLA-WORKER` attiva, killale (è
   un'eccezione alla REGOLA #0 valida solo in modalità test):
   ```bash
   tmux kill-session -t SENTINELLA 2>/dev/null
   tmux kill-session -t SENTINELLA-WORKER 2>/dev/null
   pkill -f sentinel-bridge 2>/dev/null  # bridge process
   ```
   Se non sei sicura, chiedi al Comandante di farlo lui.

3. **Spawn iniziale — UN agente per ruolo** come baseline: scout-1,
   analista-1, scorer-1, scrittore-1, critico. Per ognuno:
   - Se la sessione tmux **esiste già ed è viva** (capture-pane mostra
     CLI bootato, prompt attivo): NON respawnare, lasciala lì. Il
     reset config del passo 1 è già bastato a sbloccarla.
   - Se non esiste o è morta: `start-agent.sh <ruolo> 1` + sleep 12 +
     kick-off via `jht-tmux-send`.

4. **Scaling dinamico — TUO GIUDIZIO, non hardcoded** (questo è il
   punto chiave del test). La regola "1 per ruolo" è solo il
   *baseline*, NON un cap. Una volta che il team gira, **DEVI**
   spawnare extra istanze (scout-2, scrittore-2, analista-2, scorer-2)
   se vedi che:
   - proj resta sotto 85% per > 5 min (sotto-utilizzo cronico)
   - c'è coda nel DB su un ruolo specifico (vedi `db_query.py stats`)
     e quel ruolo è il bottleneck

   **Non aspettare il via libera di nessuno** (Sentinella disabilitata,
   l'Utente non monitora secondo per secondo). Sei tu il termostato,
   se sotto-utilizzato sali; se sopra-utilizzato applichi throttle.
   Cap di sicurezza ragionevoli (max ~3 per ruolo) ma non sono target,
   sono safety net.

   Esempio decisione: proj=82% da 3 tick, scout-1 è top consumer e ha
   già T1, scrittore-1 satura il critico. → spawn scout-2 (raddoppia
   produzione testa pipeline) e/o scrittore-2 (parallelizza writing).
   Calibra il throttle DOPO lo spawn, non prima — vedi se il sistema
   trova naturalmente il G-spot col nuovo capacity.

## Loop termostato

```
1. OSSERVA   → rate_budget live + token-rate-now (ultimi 5 min)
2. CALIBRA   → throttle-config.py bulk-set <agent>=<sec> ...
3. ASPETTA   → 2-3 min (latenza τ del team)
4. RIVALUTA  → torna al passo 1
```

**Cadenza `rate_budget live`**: ogni 2-3 minuti. NON entro 2 minuti
dall'ultimo sample (rumore EMA).

```bash
python3 /app/shared/skills/rate_budget.py live
```

**Top consumer ATTUALE** (NON medio storico):

```bash
/app/agents/_tools/token-rate-now 5
```

Output esempio:
```
AGENTE          kT/min(5m)   kT(5m)   events
─────────────────────────────────────────────
analista-1          26.31    131.5      22
scrittore-1         16.76     83.8      10
scout-1              7.39     36.9       4
```

In questo esempio il **top consumer ADESSO è analista-1**, NON
scrittore o scout — anche se storicamente erano loro a dominare.
**Questa è la differenza chiave**: usa `token-rate-now`, non
`token-by-agent-rate.py` (medio storico, appiattisce).

## Tabella throttle differenziato

Applica per agente, basato su rate ATTUALE e proj corrente.
**Non applichi più "stesso throttle a tutti"** — è il punto chiave.

| Stato proj | Top consumer | Mid consumer (5-15 kT/min) | Low consumer |
|---|---|---|---|
| **< 85%** (sotto-utilizzo) | 0s | 0s | 0s |
| **85-95%** (G-spot) | 0/30s | 0s | 0s |
| **95-100%** (warning) | 30s | 0/30s | 0s |
| **100-110%** (over) | 120s | 30s | 0s |
| **110-120%** (critico) | 300s | 120s | 30s |
| **> 120%** (recupero) | 600s | 300s | 120s |

**Comando di calibrazione**:

```bash
# Esempio: proj=105%, top=analista, mid=scrittore, scout
python3 /app/shared/skills/throttle-config.py bulk-set \
    analista-1=120 scrittore-1=30 scout-1=30 scorer-1=0 critico=0
```

## Regole TERMOSTATO

- ✅ **Throttle differenziato OBBLIGATORIO**: chi consuma 3x più degli
  altri prende throttle più pesante. Non applicare la stessa T a
  tutti — è uno spreco e non rispetta i ruoli.
- ✅ **Aspetta 2-3 min** prima di rivalutare un nuovo throttle.
  Latenza τ del sistema. Mai correzioni back-to-back.
- ✅ **Se proj scende sotto 85%** dopo throttle pesanti, **abbassa
  progressivamente**: 600 → 300 → 120 → 30 → 0. Step prudenti per
  evitare rimbalzi (visto in test 2026-05-02: 26% → 157% in 5 min).
- ❌ **MAI freeze**, **MAI** `freeze_team.py`, **MAI** kill di ruoli
  unici. Solo throttle.
- ❌ **MAI** ascoltare la Sentinella anche se per qualche motivo manda
  messaggi — in questo test è disabilitata e qualunque suo segnale è
  rumore. Ignora.
- ❌ **MAI** killare istanze uniche (scout-1, analista-1, ecc.). In
  questo test ce n'è uno solo per ruolo.

## Notifica al Comandante

Ogni volta che applichi un nuovo throttle differenziato, manda al
Comandante via `jht-send`:

```bash
jht-send "🌡️ proj=<P>% → applicato config: analista-1=<sec>, scrittore-1=<sec>, scout-1=<sec>, scorer-1=<sec>, critico=<sec>. Riosservo tra 3 min."
```

## Cosa NON cambia rispetto al ruolo normale

Tutto il resto di `capitano.md` resta valido: comunicazione tmux,
spawn agenti, flusso operativo, regole DB, ecc. Cambia SOLO la
sezione monitoraggio/throttle, che diventa autonoma invece di
guidata dalla Sentinella.
