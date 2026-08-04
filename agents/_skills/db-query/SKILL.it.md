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

### Il limite è un default, non un tetto

Ogni coda stampa le **prime 20 righe** e dichiara sempre **quante ce ne sono in totale** —
`Posizioni new pronte per analisi (mostrate 20 di 1375)`. Guarda il secondo numero: è il
backlog, e non sparisce solo perché le righe sono state tagliate.

```bash
# Quante vederne lo decidi tu
python3 /app/shared/skills/db_query.py next-for-categorize --limit 100
python3 /app/shared/skills/db_query.py next-for-categorize --all     # tutte (= --limit 0)
python3 /app/shared/skills/db_query.py next-for-categorize --json    # {"total": 1375, "shown": 20, "rows": [...]}
```

Perché esiste il default (misurato il 2026-07-30): senza limite `next-for-geocode-missing`
stampava **1.375 righe ≈ 19.500 token** a 2.000 posizioni, e ne stamperebbe **~195.000** a
20.000 — un comando solo, più di un'intera finestra di contesto. Il default ti protegge da
quello che nessuno ha chiesto; **non** decide al posto tuo: scegli il numero in base a cosa
stai facendo — 20 per prendere il prossimo item, `--all` per un audit, il solo totale per
dimensionare un backlog.

E non sei confinato a questi comandi: questa skill concede `Bash(python3 *)`, quindi
scriverti la tua query con il tuo `LIMIT` è lecito ogni volta che la coda pronta non è la
domanda che hai davvero.

```bash
python3 -c "
import os, sqlite3
db = sqlite3.connect(os.environ.get('JHT_DB', '/jht_home/jobs.db'))
for row in db.execute('SELECT id, title FROM positions WHERE role_family IS NULL LIMIT 50'):
    print(row)
"
```

## Quando usarla

- Prima di decisioni di scaling (il Capitano deve sapere se ci sono ≥ 3 record `checked` prima di spawnare uno SCORER)
- Prima degli INSERT (lo Scout deve controllare i duplicati URL)
- In risposta a domande dell'utente come "quanti scout attivi / quante application pendenti / punteggio più alto"
- Prima di qualsiasi update — vedi la skill `db-update`: leggi sempre il record prima per evitare di sovrascrivere la scrittura di qualcun altro

## Non usarla per

- Scritture: usa **`db-update`** / **`db-insert`** invece
- Modifiche schema: gestite da `db_migrate.py` — non esposta come skill (operazione dell'utente)
