<!-- @translation: pt, ai-translated 2026-06-06 -->
---
name: db-update
description: Atualizar registos existentes no DB do JHT (positions / applications). Usar para promover positions a checked/excluded, escrever pontuação/veredito do Critico, marcar applications como enviadas, atualizar salário, last-checked, etc. Sempre após um `db-query` que confirma o estado atual do registo.
allowed-tools: Bash(python3 *)
---

# db-update — atualizações de registos no DB do JHT

Wrapper em `/app/shared/skills/db_update.py`. Atualiza campos específicos em registos existentes. **Não cria** registos — para isso, ver `db-insert`.

## Padrão geral

```bash
python3 /app/shared/skills/db_update.py <table> <id> --<field> <value> [--<field> <value>...]
```

Tabelas: `position`, `application`.

## Positions

```bash
# Promover a checked / excluded (trabalho do Analista)
python3 /app/shared/skills/db_update.py position 42 --status checked
python3 /app/shared/skills/db_update.py position 42 --status excluded

# Marcador last-checked (link confirmado vivo — também usado como reivindicação anti-colisão)
python3 /app/shared/skills/db_update.py position 42 --last-checked now

# Liveness: --is-open / --last-open-check fazem avançar sozinhos também o
# last_checked, por isso uma posição reverificada sai da fila de cuidado (que
# filtra pela mais recente das duas datas). --last-checked só para forçar.
python3 /app/shared/skills/db_update.py position 42 --is-open false --last-open-check now

# Salário conforme declarado no JD
python3 /app/shared/skills/db_update.py position 42 --salary-declared-min 40000 --salary-declared-max 55000

# Salário estimado (glassdoor / levels.fyi / estimativa do analista)
python3 /app/shared/skills/db_update.py position 42 --salary-estimated-min 35000 --salary-estimated-max 50000 --salary-estimated-source glassdoor

# Família de papel (categoria semântica).
python3 /app/shared/skills/db_update.py position 42 --role-family "Technical Writing"

# Localização estruturada (Analista). Exemplo completo para "Dublin, Ireland" hybrid:
python3 /app/shared/skills/db_update.py position 42 \
  --loc-city "Dublin" --loc-region "Leinster" \
  --loc-country "Ireland" --loc-country-code "IE" \
  --loc-continent "Europe" \
  --work-mode "hybrid" \
  --work-country "Ireland" --work-country-code "IE" \
  --is-multi-location false

# Exemplos de casos especiais:
# A) "Europe Remote" → country=NULL, continent=EU, work_country do HQ da empresa
python3 /app/shared/skills/db_update.py position 42 \
  --loc-continent "Europe" --work-mode "remote" \
  --work-country "United States" --work-country-code "US" \
  --location-notes "Remote within EU, US-based company"

# B) "Italy" + full_remote
python3 /app/shared/skills/db_update.py position 42 \
  --loc-country "Italy" --loc-country-code "IT" --loc-continent "Europe" \
  --work-mode "remote" --work-country "Italy" --work-country-code "IT"

# E) Multi-location mesmo país ("Barcelona / Malaga")
python3 /app/shared/skills/db_update.py position 42 \
  --loc-country "Spain" --loc-country-code "ES" --loc-continent "Europe" \
  --work-mode "hybrid" --work-country "Spain" --work-country-code "ES" \
  --is-multi-location true --location-notes "Barcelona or Málaga (candidato sceglie)"

# Para "limpar" um campo (definir NULL) passe string vazia:
python3 /app/shared/skills/db_update.py position 42 --loc-city ""
```

## Applications

```bash
# Veredito do Critico (por rodada: NEEDS_WORK / PASS / REJECT) + pontuação 0-10 + notas
python3 /app/shared/skills/db_update.py application 42 --critic-verdict NEEDS_WORK --critic-score 5.0 --critic-notes "needs more detail on project X"

# CV/carta de apresentação escrito (Scrittore marca como escrito)
python3 /app/shared/skills/db_update.py application 42 --written-at now

# Promover a ready após PASS do Critico — apenas Scrittore, no application-flow Passo 7
python3 /app/shared/skills/db_update.py application 42 --status ready

# Utilizador confirmou que a candidatura foi enviada
python3 /app/shared/skills/db_update.py application 42 --applied-at "2026-02-28" --applied-via linkedin
python3 /app/shared/skills/db_update.py application 42 --applied true

# Resposta recebida (entrevista / rejeição / ghosted)
python3 /app/shared/skills/db_update.py application 42 --response "rejected" --response-at now
```

### Transições de estado de position são auto-registadas (bug #14)

Cada chamada a `db_update.py position <id> --status <s>` que realmente
altera `positions.status` insere uma linha em `position_state_transitions`
com `from_state`, `to_state`, `ts`, `by_agent` (de `JHT_AGENT_NAME`),
e as `--notes` que passou (se alguma). O mesmo para o
`db_insert.py position` inicial (registado como `NULL → 'new'`).

Não precisa de fazer nada — o wrapper trata disso. Não o contorne
com SQL direto: um `python3 -c "import sqlite3; UPDATE positions SET
status=..."` contorna o log de transição e faz gráficos de throughput /
funil sub-contar.

### Porta de escritor único em `applications.status='ready'` (bug #21)

`applications.status='ready'` é **definido exclusivamente pelo Scrittore** no
`application-flow` Passo 7, **apenas após** PASS do Critico na 3ª rodada.
Esta é a porta que torna o CV visível no dashboard `/ready` do utilizador.
Outros agentes:

- **Critico**: escreve `critic_verdict` + `critic_score` apenas. Nunca `status`.
- **Capitano**: nunca escreve `applications.status`. Pode ler.
- **Mentor / Assistente**: read-only em `applications`.

Sem esta porta, o Capitano pode reportar "12 ready" verbalmente enquanto o
DB ainda mostra 0 — exatamente a divergência que o bug #21 corrigiu.

## Regras de segurança

1. **Ler primeiro.** Execute `db-query position <id>` (ou `application`) para ver o estado atual antes de escrever. Sobrescritas cegas produzem registos inconsistentes.
2. **Fluxo de status é apenas para frente.** Transições legítimas: `new → checked → scored → writing → ready → applied → response`. `excluded` é alcançável a partir de qualquer passo mas nenhum passo volta para trás. Não reverter.
3. **Timestamp `now`.** O wrapper converte a string literal `now` no timestamp atual. Não passe `$(date)` — o parsing é tratado no lado Python.
4. **Tags de exclusão em `--notes`.** Ao marcar uma posição `excluded`, prefixe as notas com uma das tags canónicas: `[LINK_MORTO]` · `[SCAM]` · `[GEO]` · `[LINGUA]` · `[SENIORITY]` · `[STACK]`. Mesma taxonomia usada pelo Analista (ver `agents/analista/analista.md` REGOLA-06).

## Não usar para

- Leituras: usar **`db-query`**
- Criação de registos: usar **`db-insert`** (apenas o Scout faz INSERT de positions)
- Alterações de schema: nunca executar `sqlite3` direto contra as tabelas — contorna foreign keys e o WAL journaling do Next.js
