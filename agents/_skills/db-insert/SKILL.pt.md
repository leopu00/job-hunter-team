<!-- @translation: pt, ai-translated 2026-06-06 -->
---
name: db-insert
description: Inserir NOVOS registos no DB do JHT (positions / scores / applications / companies / position_highlights). Usar APENAS quando um agente precisa de criar um registo — Scout para positions, Analista para companies e highlights, Scorer para scores, Scrittore para applications. Nunca sobrescrever cegamente — para atualizações use `db-update`.
allowed-tools: Bash(python3 *)
---

# db-insert — criação de registos no DB do JHT

Wrapper em `/app/shared/skills/db_insert.py`. Cria novos registos no DB SQLite do JHT. Os campos obrigatórios diferem por tabela.

## Padrão

```bash
python3 /app/shared/skills/db_insert.py <table> --<field> <value> [--<field> <value>...]
```

Tabelas: `position`, `company`, `score`, `application`, `highlight`.

## Position (Scout)

```bash
python3 /app/shared/skills/db_insert.py position \
  --title "Python Developer" --company "Acme Corp" \
  --location "Remote EU" --remote-type full_remote \
  --url "https://acme.com/jobs/42" --source linkedin --found-by scout-1 \
  --jd-text "<texto completo do JD>" --requirements "Python, Flask, PostgreSQL"
```

`--url` é **obrigatório** (o script falha sem ele). O Scout deve sempre pré-verificar duplicados com `db-query check-url` primeiro.

## Company (Analista)

```bash
python3 /app/shared/skills/db_insert.py company \
  --name "Acme Corp" --hq-country "Italy" --sector "fintech" \
  --verdict GO --analyzed-by analista-1
```

`--verdict` aceita `GO`, `CAUTIOUS`, `NO_GO`.

## Score (Scorer)

```bash
python3 /app/shared/skills/db_insert.py score \
  --position-id 42 --total 85 \
  --stack-match 35 --remote-fit 18 --salary-fit 8 \
  --experience-fit 9 --strategic-fit 15 \
  --scored-by scorer-1
```

As 5 sub-pontuações mapeiam para colunas do DB: `stack_match · remote_fit · salary_fit · experience_fit · strategic_fit`. `--total` é a pontuação canónica 0–100 que o Capitano lê.

## Application (Scrittore)

```bash
python3 /app/shared/skills/db_insert.py application \
  --position-id 42 \
  --cv-path "/jht_user/applications/42/cv.md" \
  --cv-pdf-path "/jht_user/applications/42/cv.pdf" \
  --written-by scrittore-1 --written-at now
```

Carta de apresentação (`--cl-path` / `--cl-pdf-path`) apenas se o JD pediu uma.

## Highlight (Analista / Scorer)

```bash
python3 /app/shared/skills/db_insert.py highlight \
  --position-id 42 --type pro --text "Stack matches candidate primary stack 1:1"
python3 /app/shared/skills/db_insert.py highlight \
  --position-id 42 --type con --text "Salary range below candidate target"
```

`--type` é `pro` ou `con`.

## Regras de segurança

1. **Ler primeiro.** Use `db-query check-url <url>` antes de inserir uma position. Use `db-query position <id>` para verificar que o registo pai existe antes de inserir score/application.
2. **URL obrigatório em positions.** Sem URL → sem insert (o script impõe).
3. **Idempotente em duplicados.** Insert é rejeitado se conflito `(user_id, legacy_id)` ou unique-key — tratar graciosamente e usar `db-update` em vez disso.
4. **Timestamp `now`.** O wrapper converte a string literal `now` no timestamp atual.

## Não usar para

- Atualizações: usar **`db-update`**
- Leituras: usar **`db-query`**
- Alterações de schema: tratadas por `db_migrate.py` — operação do Comandante, não exposta como skill
