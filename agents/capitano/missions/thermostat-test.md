# 🌡️ MISSIONE: TERMOSTATO AUTONOMO (TEST)

**Modalità di test, opt-in.** Questo file viene letto SOLO se
l'utente ti dice esplicitamente "esegui la missione termostato"
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
   Se non sei sicura, chiedi all'utente di farlo lui.

3. **Avvia il team** rispettando l'**OBIETTIVO DI PERFORMANCE** in
   `capitano.md`: proj nel G-spot 90-95% entro 15 min dal boot, e
   stabile lì per almeno 10 min consecutivi. Hai libertà totale su
   COME farlo: quanti agenti spawnare, in che ordine, con che
   intervallo, con che throttle iniziale. Decidi tu basandoti sui
   dati live (`rate_budget`, `token-rate-now`).

   Ruoli disponibili: scout, analista, scorer, scrittore, critico
   (on-demand). Cap tecnico: max ~3 istanze per ruolo come safety
   net (vedi `capitano.md` REGOLE).

   Sessioni preesistenti: se tmux mostra agenti già vivi e freschi
   (capture-pane CLI bootato), NON respawnare. Il reset config del
   passo 1 è già bastato a sbloccarli.

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

**Cadenza adattiva `rate_budget live`**:

| Stato | reset_in | proj | Cadenza check | Aggressività throttle |
|---|---|---|---|---|
| **Cruise** | > 30 min | < 95% | ogni 2-3 min | step-by-step (T1→T2→T3) |
| **Approach** | 10-30 min | qualunque | ogni 2 min | step-by-step ma anticipa di 1 livello |
| **Endgame** | **< 10 min** | qualunque | ogni 30-60 sec | direct jump a T3/T4 se proj > 100%, no step |
| **Critical** | < 5 min | > 100% | ogni 30 sec | T4 (280s, cap tecnico) o kill istanze extra |

Vicino al reset il "tau del sistema" (~2-3 min) è quasi tutta la
finestra residua: un throttle leggero applicato a 5 min dal reset
finisce DOPO il reset, inutile. Devi:

- **Accorciare il loop osserva→agisci** (no più sleep 180s in
  endgame, scendi a 30-60s). Vedi REGOLA #2 in capitano.md: MAI
  `sleep > 30s`, mai. Fare micro-cicli da 30s con check intermedio.
- **Saltare gli step intermedi**: a 5 min dal reset con proj 102%,
  applica direttamente T4 (280s, cap tecnico) sui top, non perdere
  tempo a provare T2 e aspettare.
- **Considerare kill di istanze extra**: scout-3, scrittore-3,
  analista-2, scorer-2 sono "second tier" — se sei in critical e
  reset < 3 min, killali (NON i ruoli unici scout-1/analista-1/ecc).

NON entro 2 minuti dall'ultimo sample (rumore EMA), ma in endgame
critical si può accettare un sample extra ogni 60s, l'EMA si
stabilizza nel breve termine.

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

## Throttle differenziato — il principio

**Mai stesso throttle a tutti.** Un agente che consuma 30 kT/min e
uno che ne consuma 5 NON devono ricevere la stessa T. Misura sempre
con `token-rate-now <minuti>` chi sta dominando ADESSO (NON la media
storica), poi calibra differenziato via `throttle-config.py bulk-set`
in 1 write atomico.

La scala completa dei livelli L0-L10 (durate, multi-call, kill di
istanze, freeze) è in `capitano.md`. Mappare proj corrente e tier
consumer ai livelli giusti è **tuo giudizio, non una ricetta fissa**.
Più sei lontano dal G-spot e meno tempo ti resta nella finestra,
più devi essere aggressivo (durate alte, eventualmente kill istanze
extra in eccesso).

Pattern di calibrazione:
1. **Misura**: `rate_budget live` + `token-rate-now 5`
2. **Decidi**: chi rallentare, di quanto, eventuali kill
3. **Applica**: `throttle-config.py bulk-set` (atomico)
4. **Notifica** l'utente via `jht-send`
5. **Aspetta** τ del sistema (2-3 min cruise, 30-60s endgame, vedi
   tabella cadenza adattiva in `capitano.md`)
6. **Rivaluta**

**Regola**: se dopo 2-3 cicli di calibrazione il proj non converge
verso il G-spot, NON insistere col pattern: stai sbagliando l'analisi.
Ferma, riconsidera (chi consuma davvero, quale livello applicare,
serve kill di istanze extra). Vedi anche **OBIETTIVI DI PERFORMANCE**
in `capitano.md`: hai 15 min per stabilizzare e 10 min di stabilità
sostenuta. Se sei fuori target, **cambia approccio**.

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

## Notifica all'utente

Ogni volta che applichi un nuovo throttle differenziato, manda
all'utente via `jht-send`:

```bash
jht-send "🌡️ proj=<P>% → applicato config: analista-1=<sec>, scrittore-1=<sec>, scout-1=<sec>, scorer-1=<sec>, critico=<sec>. Riosservo tra 3 min."
```

## Cosa NON cambia rispetto al ruolo normale

Tutto il resto di `capitano.md` resta valido: comunicazione tmux,
spawn agenti, flusso operativo, regole DB, ecc. Cambia SOLO la
sezione monitoraggio/throttle, che diventa autonoma invece di
guidata dalla Sentinella.
