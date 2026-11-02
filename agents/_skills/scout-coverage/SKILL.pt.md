---
name: scout-coverage
description: "Procura os portais nacionais core das línguas do perfil ANTES de qualquer fonte menor e sabe quanto do plano está feito. `next` indica o portal, o país a registar e o tipo de consulta; um portal está coberto com 3 passagens e 3 consultas diferentes, e «esgotado» exige os portais core cobertos. Corre `next` no início de cada pesquisa."
allowed-tools: Bash(python3 /app/shared/skills/scout_coverage.py *) Bash(python3 /app/shared/skills/scout_pass_log.py *)
---

# scout-coverage — onde procurar primeiro, e quanto está feito

Procura PRIMEIRO onde estão os mercados próprios do perfil e sabe quanto está feito. Uma prova real consultou 105 fontes uma vez cada e nunca abriu os maiores portais nacionais da língua do utilizador: «esgotado» foi declarado com o mercado de casa intacto. Esta skill dá a lista (portais nacionais de cada língua que o perfil fala, primeiro os core, depois os English-first e remote) e o contador sobre o teu próprio registo de passagens.

## 1. Pergunta o que vem a seguir, em cada pesquisa

`next` imprime uma linha JSON: o portal (`source`, `country`, `tier`), o TIPO de consulta (`query_kind`: `role_language` = o título na língua do portal, `role` = o título em inglês, `synonym` = um título próximo, `level` = o título com uma palavra de nível da língua, listadas em `level_terms`, `city` = o título com um lugar, listados em `cities`), o que tens (`have`) contra o necessário (`need`) e a linha `log` a usar depois. Procura exatamente isso e regista a passagem com o mesmo `--query-kind`. `plan_done: true` quer dizer plano feito: passa às outras fontes.

```bash
# the next thing to search: portal, country to log, kind of query, and the line to log it with
python3 /app/shared/skills/scout_coverage.py next

# the whole plan for this profile (once), and how much of it is done (any time)
python3 /app/shared/skills/scout_coverage.py plan
python3 /app/shared/skills/scout_coverage.py status

# after the search: the same portal, country and kind that `next` named
python3 /app/shared/skills/scout_pass_log.py pass --source platsbanken --country se --query-kind role_language --query "<the query you ran>" --returned 12
# a portal that answers 403 / a login wall / a challenge (closed) or 410 (gone): ONE pass closes it
python3 /app/shared/skills/scout_pass_log.py pass --source platsbanken --country se --returned 0 --status closed
```

## Regras

- Primeiro os core, depois os menores: nenhuma fonte menor enquanto `next` nomear um portal core.
- Um portal está COBERTO com 3 passagens e 3 consultas DIFERENTES (uma na língua do portal se não for inglês). A mesma consulta três vezes conta uma: muda o tipo, não as palavras.
- Um portal que responde 403, 410, um muro de login ou um challenge fica FECHADO com UMA passagem registada `--status closed` (ou `gone` para o 410): di-lo e segue, não insistas.
- `exhausted` (`scout_exhaustion.py check`) exige os portais core cobertos além de fontes, consultas e minutos: `core_missing` diz onde ainda tens de ir.
- Do perfil nunca se escreve nada: o registo tem slugs, códigos de país, tipos e contagens.
