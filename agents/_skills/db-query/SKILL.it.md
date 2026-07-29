<!-- @translation: it, ai-translated 2026-06-06 -->
---
name: db-query
description: Interroga il DB SQLite JHT (positions, applications, statistiche). Usala ogni volta che ti servono stato posizioni, code per agente, punteggi, match rate o conteggi record. Path DB da $JHT_DB, fallback /jht_home/jobs.db.
allowed-tools: Bash(python3 *)
---

# db-query — lookup nel DB JHT

Il database principale è `$JHT_DB` (default `/jht_home/jobs.db`). Tutti i wrapper di query vivono in `/app/shared/skills/db_query.py`. Questa skill espone le invocazioni più comuni.

## Statistiche e dashboard

```bash
# Conteggi aggregati per status + match rate (panoramica utente)
python3 /app/shared/skills/db_query.py dashboard

# Statistiche numeriche (totali per tabella)
python3 /app/shared/skills/db_query.py stats
```

## Positions

```bash
# Lista per status
python3 /app/shared/skills/db_query.py positions --status new
python3 /app/shared/skills/db_query.py positions --status checked
python3 /app/shared/skills/db_query.py positions --status excluded

# Filtra per punteggio minimo
python3 /app/shared/skills/db_query.py positions --min-score 70

# Dettaglio singola posizione (tutti i campi)
python3 /app/shared/skills/db_query.py position 42

# URL/ID duplicato? (utile allo SCOUT prima dell'INSERT)
python3 /app/shared/skills/db_query.py check-url 4361788825
```

## Attività del team — chi ha prodotto e chi è ammutolito

```bash
# Ogni transizione di posizione degli ultimi N minuti + conteggi per agente
python3 /app/shared/skills/db_query.py recent-activity --minutes 60
python3 /app/shared/skills/db_query.py recent-activity --minutes 30 --json
```

Output: `per-agente: analista-1=9, scorer-1=7`, poi una riga per transizione —
`14:22:07 scorer-1 #22 checked→scored`, `14:19:51 analista-1 #27 new→excluded — [DEAD_LINK]`
(orari in UTC). **Sostituisce** i messaggi `[START]`/`[DONE]` dei worker, rimossi il 2026-07-27:
su un team di primo avvio quei bookend erano 30 dei 37 messaggi ricevuti dal Capitano in ~1,5h, per
uno stato che era già nel DB.

⚠️ **Elenca chi PRODUCE.** Un agente che si è fermato non compare affatto — non risalta,
**sparisce**. Per distinguere uno stallo da un idle legittimo, incrocia con `tmux list-sessions`
(è vivo?) e la coda `next-for-*` del ruolo (aveva qualcosa da fare?): **vivo + coda non vuota + zero
transizioni = stallo**; vivo + coda vuota + zero transizioni = idle, lascialo stare.

## Code per agente (pipeline)

```bash
python3 /app/shared/skills/db_query.py next-for-analista
python3 /app/shared/skills/db_query.py next-for-scorer
python3 /app/shared/skills/db_query.py next-for-scrittore
python3 /app/shared/skills/db_query.py next-for-critico   # ⚠️ legacy — in V5 il Critico è spawnato dallo Scrittore per round, non preso da una coda
```

Ciascuno restituisce il prossimo batch pronto per quel ruolo, seguendo il flusso di status V5: `new → checked → scored → writing → ready → applied → response` (con `excluded` come uscita laterale da qualsiasi step).

## Quando usarla

- Prima di decisioni di scaling (il Capitano deve sapere se ci sono ≥ 3 record `checked` prima di spawnare uno SCORER)
- Prima degli INSERT (lo Scout deve controllare i duplicati URL)
- In risposta a domande dell'utente come "quanti scout attivi / quante application pendenti / punteggio più alto"
- Prima di qualsiasi update — vedi la skill `db-update`: leggi sempre il record prima per evitare di sovrascrivere la scrittura di qualcun altro

## Non usarla per

- Scritture: usa **`db-update`** / **`db-insert`** invece
- Modifiche schema: gestite da `db_migrate.py` — non esposta come skill (operazione dell'utente)
