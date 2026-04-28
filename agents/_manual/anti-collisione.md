# Protocollo Anti-Collisione

Quando piu agenti dello stesso ruolo pescano dalla stessa coda, DEVONO seguire questo protocollo per evitare di lavorare sulla stessa posizione.

## Procedura (3 step obbligatori)

### STEP 1 — CHECK
Leggi il DB PRIMA di prendere una posizione:
```bash
python3 shared/skills/db_query.py position <ID>
```
Verifica che lo `status` sia quello atteso (es. `new` per analisti, `checked` per scorer, `scored` per scrittori).

Se lo status e' gia avanzato (es. `checked` quando doveva essere `new`), un collega ci sta gia lavorando. **SKIP e prendi la prossima.**

### STEP 2 — CLAIM
Aggiorna lo status nel DB PRIMA di iniziare il lavoro:
```bash
# Analista: marca come "in lavorazione" via notes
python3 shared/skills/db_update.py position <ID> --notes "IN_ANALISI da analista-X"

# Scrittore: marca come writing
python3 shared/skills/db_update.py position <ID> --status writing
```

### STEP 3 — COMUNICA
Avvisa i colleghi dello stesso ruolo via tmux:
```bash
tmux send-keys -t "SESSIONE_COLLEGA" "[@me -> @collega] [INFO] prendo ID <N> - <Azienda>"
tmux send-keys -t "SESSIONE_COLLEGA" Enter
```

## Regole

- Se trovi una posizione con notes che contiene `IN_ANALISI` o status `writing`, **SKIP**
- Se due agenti prendono lo stesso ID per errore, il PRIMO che ha aggiornato il DB vince. L'altro si ferma e passa alla prossima.
- Dopo aver finito, aggiorna lo status finale (es. `checked`, `scored`, `review`)
