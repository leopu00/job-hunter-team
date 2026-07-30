<!-- @translation: pt, ai-translated 2026-06-06 -->
---
name: db-query
description: Consultar o DB SQLite do JHT (positions, applications, stats). Usar sempre que precisar de status de posições, filas por agente, pontuações, taxa de correspondência ou contagens de registos. Caminho do DB de $JHT_DB, fallback /jht_home/jobs.db.
allowed-tools: Bash(python3 *)
---

# db-query — consultas ao DB do JHT

O banco de dados principal é `$JHT_DB` (padrão `/jht_home/jobs.db`). Todos os wrappers de consulta vivem em `/app/shared/skills/db_query.py`. Esta skill expõe as invocações mais comuns.

## Estatísticas e dashboard

```bash
# Contagens agregadas por status + taxa de correspondência (visão do utilizador)
python3 /app/shared/skills/db_query.py dashboard

# Estatísticas numéricas (totais por tabela)
python3 /app/shared/skills/db_query.py stats
```

## Positions

```bash
# Listar por status
python3 /app/shared/skills/db_query.py positions --status new
python3 /app/shared/skills/db_query.py positions --status checked
python3 /app/shared/skills/db_query.py positions --status excluded

# Filtrar por pontuação mínima
python3 /app/shared/skills/db_query.py positions --min-score 70

# Detalhe de uma posição (todos os campos)
python3 /app/shared/skills/db_query.py position 42

# URL/ID duplicado? (útil para o SCOUT antes do INSERT)
python3 /app/shared/skills/db_query.py check-url 4361788825
```

## Atividade da equipa — quem produziu e quem se calou

```bash
# Cada transição de posição dos últimos N minutos + contagens por agente
python3 /app/shared/skills/db_query.py recent-activity --minutes 60
python3 /app/shared/skills/db_query.py recent-activity --minutes 30 --json
```

Saída: `per-agente: analista-1=9, scorer-1=7`, depois uma linha por transição —
`14:22:07 scorer-1 #22 checked→scored`, `14:19:51 analista-1 #27 new→excluded — [DEAD_LINK]`
(horas em UTC). **Substitui** as mensagens `[START]`/`[DONE]` dos workers, removidas a 2026-07-27:
numa equipa de primeiro arranque esses bookends eram 30 das 37 mensagens recebidas pelo Capitano em
~1,5h, para um estado que já estava na DB.

⚠️ **Lista quem PRODUZ.** Um agente que parou não aparece de todo — não salta à vista,
**desaparece**. Para distinguir um stall de um idle legítimo, cruza com `tmux list-sessions`
(está vivo?) e a fila `next-for-*` do papel (tinha alguma coisa para fazer?): **vivo + fila não
vazia + zero transições = stall**; vivo + fila vazia + zero transições = idle, deixa-o em paz.

## Filas por agente (pipeline)

```bash
python3 /app/shared/skills/db_query.py next-for-analista
python3 /app/shared/skills/db_query.py next-for-scorer
python3 /app/shared/skills/db_query.py next-for-scrittore
python3 /app/shared/skills/db_query.py next-for-critico   # ⚠️ legacy — em V5 o Critico é gerado pelo Scrittore por rodada, não puxado de uma fila
```

Cada um retorna o próximo lote pronto para esse papel, seguindo o fluxo de status V5: `new → checked → scored → writing → ready → applied → response` (com `excluded` como saída a partir de qualquer passo).

### O limite é um default, não um teto

Cada fila imprime as **primeiras 20 linhas** e declara sempre **quantas existem no total** —
`Posizioni new pronte per analisi (mostrate 20 di 1375)`. Olha para o segundo número: é o
backlog, e não desaparece só porque as linhas foram cortadas.

```bash
# Quantas ver decides tu
python3 /app/shared/skills/db_query.py next-for-categorize --limit 100
python3 /app/shared/skills/db_query.py next-for-categorize --all     # todas (= --limit 0)
python3 /app/shared/skills/db_query.py next-for-categorize --json    # {"total": 1375, "shown": 20, "rows": [...]}
```

Porque existe o default (medido a 2026-07-30): sem limite, `next-for-geocode-missing`
imprimia **1.375 linhas ≈ 19.500 tokens** com 2.000 posições, e imprimiria **~195.000** com
20.000 — um único comando, mais do que uma janela de contexto inteira. O default protege-te
do que ninguém pediu; **não** decide por ti: escolhe o número conforme o que estás a fazer —
20 para pegar no próximo item, `--all` para uma auditoria, só o total para dimensionar um
backlog.

E não estás confinado a estes comandos: esta skill concede `Bash(python3 *)`, portanto
escrever a tua própria query com o teu próprio `LIMIT` é legítimo sempre que a fila pronta
não for a pergunta que tens de facto.

```bash
python3 -c "
import os, sqlite3
db = sqlite3.connect(os.environ.get('JHT_DB', '/jht_home/jobs.db'))
for row in db.execute('SELECT id, title FROM positions WHERE role_family IS NULL LIMIT 50'):
    print(row)
"
```

## Quando usar

- Antes de decisões de escalonamento (Capitano precisa saber se há ≥ 3 registos `checked` antes de spawnar um SCORER)
- Antes de INSERTs (Scout deve verificar duplicados de URL)
- Em resposta a perguntas do utilizador como "quantos scouts ativos / quantas applications pendentes / maior pontuação"
- Antes de qualquer atualização — ver a skill `db-update`: sempre ler o registo primeiro para evitar pisar na escrita de outra pessoa

## Não usar para

- Escritas: usar **`db-update`** / **`db-insert`** em vez disso
- Alterações de schema: tratadas por `db_migrate.py` — não exposta como skill (operação do utilizador)
