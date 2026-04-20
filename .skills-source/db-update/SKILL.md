---
name: db-update
description: Aggiorna record esistenti nel DB JHT (positions / applications). Usalo per promuovere posizioni a checked/excluded, scrivere score/verdict del critico, marcare applicazioni come inviate, aggiornare salary, last-checked ecc. Sempre dopo una `db-query` che conferma il record attuale.
allowed-tools: Bash(python3 *)
---

# db-update — aggiornamento record DB

Wrapper in `/app/shared/skills/db_update.py`. Aggiorna campi specifici su record esistenti. **Non crea** record: per quello vedi `db-insert`.

## Pattern generale

```bash
python3 /app/shared/skills/db_update.py <tabella> <id> --<campo> <valore> [--<campo> <valore>...]
```

Tabelle: `position`, `application`.

## Posizioni

```bash
# Promuovi a checked / excluded (fatto dall'Analista)
python3 /app/shared/skills/db_update.py position 42 --status checked
python3 /app/shared/skills/db_update.py position 42 --status excluded

# Marker last-checked (link vivo confermato)
python3 /app/shared/skills/db_update.py position 42 --last-checked now

# Salary dichiarato nell'annuncio
python3 /app/shared/skills/db_update.py position 42 --salary-declared-min 40000 --salary-declared-max 55000

# Salary stimato (glassdoor / levels.fyi / stima analista)
python3 /app/shared/skills/db_update.py position 42 --salary-estimated-min 35000 --salary-estimated-max 50000 --salary-estimated-source glassdoor
```

## Applications

```bash
# Verdict del critico (NEEDS_WORK / APPROVE) + score 0-10 + note
python3 /app/shared/skills/db_update.py application 42 --critic-verdict NEEDS_WORK --critic-score 5.0 --critic-notes "servono più dettagli su progetto X"

# Applicazione scritta (dopo commit del scrittore)
python3 /app/shared/skills/db_update.py application 42 --written-at now

# Applicazione inviata
python3 /app/shared/skills/db_update.py application 42 --applied-at "2026-02-28" --applied-via linkedin
python3 /app/shared/skills/db_update.py application 42 --applied true

# Risposta ricevuta (anche rejection)
python3 /app/shared/skills/db_update.py application 42 --response "rejected" --response-at now
```

## Regole di sicurezza

1. **Prima leggi**: usa `db-query position <id>` (o `application`) per vedere lo stato attuale. Sovrascrivere a cieco produce record incoerenti.
2. **Status flow immutabile**: le transizioni legittime sono `new → checked` (o `excluded`), `checked → scored`, `scored → written → sent`. Non tornare indietro.
3. **Timestamp `now`**: il wrapper converte la stringa `now` nel timestamp corrente. Non passare `$(date)`, il parsing è gestito Python-side.
4. **Motivazioni `--critic-notes`/`--exclude-reason`**: quando escludi una posizione, SEMPRE motivare col tag standard (`[LINK_MORTO]`, `[SENIORITY]`, `[LOCATION]`, `[STACK]`, `[SALARY]`, `[LANGUAGE]`).

## NON usare per

- Letture: usa **`db-query`**
- Creazione record: usa **`db-insert`** (solo Scout insertisce positions)
- Schema changes: non fare mai `sqlite3` diretto sulla tabella — rompe le foreign key e la journaling WAL di Next.js
