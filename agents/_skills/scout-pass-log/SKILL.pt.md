---
name: scout-pass-log
description: "Mede as tuas pesquisas para a equipa perceber se uma fonte está esgotada ou se a pesquisa está mal feita. Depois de cada pesquisa numa fonte regista quantos candidatos voltaram; quando um candidato sai dos gates regista onde acabou. Dois comandos curtos, vocabulário fechado, nunca texto livre."
allowed-tools: Bash(python3 /app/shared/skills/scout_pass_log.py *)
---
<!-- @translation: pt, ai-translated 2026-11-02 -->

# scout-pass-log — mede o que as tuas pesquisas devolvem

De fora ninguém consegue dizer se as fontes de um perfil estão esgotadas ou se o Scout pesquisa mal: um candidato descartado antes do INSERT (link morto, um filtro, uma língua vista no anúncio) não deixava rasto. Estes dois comandos deixam cada um uma linha curta. Não custam nada e nunca param o teu trabalho.

## Quando

- **Depois de cada pesquisa numa fonte** (voltou uma lista de candidatos): o comando `pass`.
- **Quando cada candidato sai dos gates** (inserido, ou descartado e porquê): o comando `candidate`. Acrescenta `--opened` se descarregaste a JD completa (o passo caro).

## Comandos

```bash
python3 /app/shared/skills/scout_pass_log.py pass --source greenhouse --country nl --returned 25 \
    --query-kind role --query "<the query you searched>"
python3 /app/shared/skills/scout_pass_log.py candidate --source greenhouse --country nl --outcome language --opened
python3 /app/shared/skills/scout_pass_log.py candidate --source greenhouse --country nl --outcome inserted --opened
```

## Vocabulário fechado

`--source`: o mesmo slug que dás a `--source` do INSERT (`linkedin`, `greenhouse`, ...). `--country`: duas letras (`nl`), ou `multi` / `remote`. `--query-kind`: `role` · `role_language` · `company` · `generic` · `other`. `--outcome`: `inserted` · `duplicate` · `dead_link` · `closed_ad` · `seniority` · `work_auth` · `domain` · `experience` · `language` · `other`.

## Regras

- O texto livre é recusado (saída 2, nada escrito): nunca ponhas um título, uma empresa, um nome nem nada do perfil num campo. A pesquisa que fizeste vai em `--query` só para ser reduzida a um hash; o seu texto nunca é guardado.
- Se for recusado, corrige o valor e chama de novo. Nunca saltes a pesquisa ou o candidato por causa disso.
- `language` é o resultado de um candidato que descartas porque o anúncio exige uma língua que o utilizador não fala, vista na lista ou na JD.
- Uma chamada por pesquisa e uma por candidato, na mesma chamada de shell do gate que decidiu, quando puderes.
