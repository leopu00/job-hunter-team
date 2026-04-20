---
name: db-query
description: Interroga il DB SQLite di JHT (positions, applications, stats). Usalo ogni volta che devi sapere stato delle posizioni, code per ogni agente, score, match rate o contare record. Default DB path da $JHT_DB, fallback /jht_home/jobs.db.
allowed-tools: Bash(python3 *)
---

# db-query — interrogazioni sul DB JHT

Il database principale è `$JHT_DB` (default `/jht_home/jobs.db`). Tutti i wrapper di query sono in `/app/shared/skills/db_query.py`. Questa skill espone le invocazioni più comuni.

## Statistiche e dashboard

```bash
# Conteggi aggregati per status + match rate (overview per il Comandante)
python3 /app/shared/skills/db_query.py dashboard

# Stats numerici (totali per tabella)
python3 /app/shared/skills/db_query.py stats
```

## Posizioni

```bash
# Lista per status
python3 /app/shared/skills/db_query.py positions --status new
python3 /app/shared/skills/db_query.py positions --status checked
python3 /app/shared/skills/db_query.py positions --status excluded

# Filtro per score minimo
python3 /app/shared/skills/db_query.py positions --min-score 70

# Dettaglio singolo (tutti i campi)
python3 /app/shared/skills/db_query.py position 42

# Duplicato URL/ID? (utile a SCOUT prima di insertare)
python3 /app/shared/skills/db_query.py check-url 4361788825
```

## Code per agente (pipeline)

```bash
python3 /app/shared/skills/db_query.py next-for-analista
python3 /app/shared/skills/db_query.py next-for-scorer
python3 /app/shared/skills/db_query.py next-for-scrittore
python3 /app/shared/skills/db_query.py next-for-critico
```

Ciascuno restituisce il prossimo batch pronto per quel role, secondo il workflow standard (new → checked → scored → written → approved).

## Quando usarla

- Prima di decisioni di scaling (Capitano deve sapere se ci sono >= 3 checked prima di spawnare SCORER)
- Prima di insert (Scout deve controllare duplicati)
- In risposta a domande del Comandante tipo "quanti scout attivi / quante app pending / score più alto"
- Prima di aggiornare (vedi skill `db-update` — leggi sempre il record prima di sovrascrivere)

## NON usare per

- Scritture: usa **`db-update`** / **`db-insert`**
- Modifiche schema: `db_migrate.py` (non esposta come skill — serve Comandante)
