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

`--source`: o mesmo slug que dás a `--source` do INSERT (`linkedin`, `greenhouse`, ...). `--country`: duas letras (`nl`), ou `multi` / `remote`. `--query-kind`: `role` · `role_language` · `broad` · `synonym` · `level` · `city` · `company` · `generic` · `other`. `--outcome`: `inserted` · `duplicate` · `dead_link` · `closed_ad` · `seniority` · `work_auth` · `domain` · `experience` · `language` · `role` · `area` · `other`.

## Regras

- O texto livre é recusado (saída 2, nada escrito): nunca ponhas um título, uma empresa, um nome nem nada do perfil num campo. A pesquisa que fizeste vai em `--query` só para ser reduzida a um hash; o seu texto nunca é guardado.
- Se for recusado, corrige o valor e chama de novo. Nunca saltes a pesquisa ou o candidato por causa disso.
- `language` é o resultado de um candidato que descartas porque o anúncio exige uma língua que o utilizador não fala, vista na lista ou na JD.
- Uma chamada por pesquisa e uma por candidato, na mesma chamada de shell do gate que decidiu, quando puderes.
- Cada anúncio que descartas em local depois de ler uma lista tem o seu motivo no registo, nunca silêncio: título fora dos papéis do perfil → `role`, lugar fora das suas áreas → `area`, e os outros (`seniority`, `language`, `experience`, `domain`, `work_auth`). Para muitos anúncios com o mesmo motivo NÃO faças uma chamada por anúncio: `candidate --source S --country CC --outcome role --count 640` é UMA linha que vale 640 (de 1 a 100000; nunca com `inserted` nem com `--opened`, que é uma linha cada). Um portal que responde 403, um muro de login ou 410: `pass ... --returned 0 --status closed` (`gone` para o 410, `empty` para uma lista vazia). A coluna `unexpl` do relatório é o que o portal devolveu e ninguém explicou: tem de chegar a 0.
- Uma fonte que responde com um ERRO (429, um 5xx, um timeout, um erro de rede) não é uma lista vazia: regista `pass ... --returned 0 --status blocked`. Não diz nada do mercado: o portal descansa cerca de 3 horas (`JHT_SCOUT_BLOCKED_PAUSE_H`) e é consultado de novo, três passagens bloqueadas sem uma boa fecham-no, e nunca conta como «seco». Três passagens tuas com `--returned 0` seguidas na mesma fonte fazem a ferramenta imprimir `ALERT` (e avisam o utilizador e o Doutor): não voltes a perguntar a essa fonte, corre `scout_coverage.py next`.
