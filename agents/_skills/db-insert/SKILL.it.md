<!-- @translation: it, ai-translated 2026-06-06 -->
---
name: db-insert
description: Inserisci NUOVI record nel DB JHT (positions / scores / applications / companies / position_highlights). Usala SOLO quando un agente deve creare un record — Scout per positions, Analista per companies e highlights, Scorer per scores, Scrittore per applications. Mai sovrascrivere alla cieca — per aggiornamenti usa `db-update`.
allowed-tools: Bash(python3 *)
---

# db-insert — creazione record nel DB JHT

Wrapper in `/app/shared/skills/db_insert.py`. Crea nuovi record nel DB SQLite JHT. I campi obbligatori differiscono per tabella.

## Pattern

```bash
python3 /app/shared/skills/db_insert.py <table> --<field> <value> [--<field> <value>...]
```

Tabelle: `position`, `company`, `score`, `application`, `highlight`.

## Position (Scout)

```bash
python3 /app/shared/skills/db_insert.py position \
  --title "Python Developer" --company "Acme Corp" \
  --location "Remote EU" --remote-type full_remote \
  --url "https://acme.com/jobs/42" --source linkedin --found-by scout-1 \
  --jd-text "<testo completo JD>" --requirements "Python, Flask, PostgreSQL"
```

`--url` è **obbligatorio** (lo script fallisce senza). Lo Scout deve sempre controllare prima i duplicati con `db-query check-url`.

## Company (Analista)

```bash
python3 /app/shared/skills/db_insert.py company \
  --name "Acme Corp" --hq-country "Italy" --sector "fintech" \
  --verdict GO --analyzed-by analista-1
```

`--verdict` accetta `GO`, `CAUTIOUS`, `NO_GO`.

## Score (Scorer)

```bash
python3 /app/shared/skills/db_insert.py score \
  --position-id 42 --total 85 \
  --stack-match 35 --remote-fit 18 --salary-fit 8 \
  --experience-fit 9 --strategic-fit 15 \
  --scored-by scorer-1
```

I 5 sotto-punteggi mappano alle colonne del DB: `stack_match · remote_fit · salary_fit · experience_fit · strategic_fit`. `--total` è il punteggio canonico 0–100 che il Capitano legge.

**Uno score per chiamata — scrivilo subito.** Lo Scorer scrive lo score appena valutata UNA posizione, poi passa alla prossima. **Mai** valutare più posizioni e lanciare tutti gli insert `score` insieme a fine giro: condividerebbero lo stesso secondo `scored_at` e sembrerebbe frettoloso. Una posizione → una valutazione → un insert immediato → la prossima (Scorer RULE-08).

## Application (Scrittore)

```bash
python3 /app/shared/skills/db_insert.py application \
  --position-id 42 \
  --cv-path "/jht_user/applications/42/cv.md" \
  --cv-pdf-path "/jht_user/applications/42/cv.pdf" \
  --written-by scrittore-1 --written-at now
```

Cover letter (`--cl-path` / `--cl-pdf-path`) solo se il JD ne ha richiesta una.

## Highlight (Analista / Scorer)

```bash
python3 /app/shared/skills/db_insert.py highlight \
  --position-id 42 --type pro --text "Lo stack corrisponde allo stack primario del candidato 1:1"
python3 /app/shared/skills/db_insert.py highlight \
  --position-id 42 --type con --text "Range salariale sotto il target del candidato"
```

`--type` è `pro` o `con`.

## Regole di sicurezza

1. **Leggi prima.** Usa `db-query check-url <url>` prima di inserire una position. Usa `db-query position <id>` per verificare che il record padre esista prima di inserire score/application.
2. **URL obbligatorio sulle positions.** Nessun URL → nessun insert (lo script lo impone).
3. **Idempotente sui duplicati.** L'insert viene rifiutato se c'è conflitto `(user_id, legacy_id)` o unique-key — gestisci con grazia e fai `db-update` invece.
4. **Timestamp `now`.** Il wrapper converte la stringa letterale `now` nel timestamp corrente.

## Non usarla per

- Aggiornamenti: usa **`db-update`**
- Letture: usa **`db-query`**
- Modifiche schema: gestite da `db_migrate.py` — operazione del Comandante, non esposta come skill
