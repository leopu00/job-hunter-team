<!-- @translation: fr, ai-translated 2026-06-06 -->
---
name: db-insert
description: Insérer de NOUVEAUX enregistrements dans la DB JHT (positions / scores / applications / companies / position_highlights). À utiliser UNIQUEMENT quand un agent doit créer un enregistrement — Scout pour les positions, Analista pour les entreprises et les highlights, Scorer pour les scores, Scrittore pour les applications. Ne jamais écraser à l'aveugle — pour les mises à jour, utiliser `db-update`.
allowed-tools: Bash(python3 *)
---

# db-insert — création d'enregistrements dans la DB JHT

Wrapper dans `/app/shared/skills/db_insert.py`. Crée de nouveaux enregistrements dans la DB SQLite JHT. Les champs requis diffèrent selon la table.

## Pattern

```bash
python3 /app/shared/skills/db_insert.py <table> --<field> <value> [--<field> <value>...]
```

Tables : `position`, `company`, `score`, `application`, `highlight`.

## Position (Scout)

```bash
python3 /app/shared/skills/db_insert.py position \
  --title "Python Developer" --company "Acme Corp" \
  --location "Remote EU" --remote-type full_remote \
  --url "https://acme.com/jobs/42" --source linkedin --found-by scout-1 \
  --jd-text "<texte complet du JD>" --requirements "Python, Flask, PostgreSQL"
```

`--url` est **obligatoire** (le script échoue sans). Le Scout doit toujours pré-vérifier les doublons avec `db-query check-url` d'abord.

## Company (Analista)

```bash
python3 /app/shared/skills/db_insert.py company \
  --name "Acme Corp" --hq-country "Italy" --sector "fintech" \
  --verdict GO --analyzed-by analista-1
```

`--verdict` accepte `GO`, `CAUTIOUS`, `NO_GO`.

## Score (Scorer)

```bash
python3 /app/shared/skills/db_insert.py score \
  --position-id 42 --total 85 \
  --stack-match 35 --remote-fit 18 --salary-fit 8 \
  --experience-fit 9 --strategic-fit 15 \
  --scored-by scorer-1
```

Les 5 sous-scores correspondent aux colonnes DB : `stack_match · remote_fit · salary_fit · experience_fit · strategic_fit`. `--total` est le score canonique 0-100 que le Capitano lit.

**Un score par appel — écris-le tout de suite.** Le Scorer écrit le score juste après avoir évalué UNE position, puis passe à la suivante. **Jamais** évaluer plusieurs positions et lancer tous les insert `score` ensemble en fin de tour : ils partageraient la même seconde `scored_at` et paraîtraient précipités. Une position → une évaluation → un insert immédiat → la suivante (Scorer RULE-08).

## Application (Scrittore)

```bash
python3 /app/shared/skills/db_insert.py application \
  --position-id 42 \
  --cv-path "/jht_user/applications/42/cv.md" \
  --cv-pdf-path "/jht_user/applications/42/cv.pdf" \
  --written-by scrittore-1 --written-at now
```

Lettre de motivation (`--cl-path` / `--cl-pdf-path`) uniquement si le JD en a demandé une.

## Highlight (Analista / Scorer)

```bash
python3 /app/shared/skills/db_insert.py highlight \
  --position-id 42 --type pro --text "Stack matches candidate primary stack 1:1"
python3 /app/shared/skills/db_insert.py highlight \
  --position-id 42 --type con --text "Salary range below candidate target"
```

`--type` est `pro` ou `con`.

## Règles de sécurité

1. **Lire d'abord.** Utiliser `db-query check-url <url>` avant d'insérer une position. Utiliser `db-query position <id>` pour vérifier que l'enregistrement parent existe avant d'insérer un score/application.
2. **URL obligatoire sur les positions.** Pas d'URL → pas d'insert (le script l'impose).
3. **Idempotent sur les doublons.** L'insert est rejeté si conflit `(user_id, legacy_id)` ou clé unique — gérer gracieusement et utiliser `db-update` à la place.
4. **Timestamp `now`.** Le wrapper convertit la chaîne littérale `now` en timestamp actuel.

## Ne pas l'utiliser pour

- Mises à jour : utiliser **`db-update`**
- Lectures : utiliser **`db-query`**
- Changements de schéma : géré par `db_migrate.py` — opération du Commander, non exposé comme skill
