<!-- @translation: pt, ai-translated 2026-06-06 -->
---
name: scout-coord
description: Protocolo de coordenacao no arranque entre multiplos Scouts. Sem esta skill dois scouts rastreiam o mesmo circulo (Remote EU) no mesmo tier (LinkedIn) e produzem 100% de duplicatas que o gate de dedup tem de descartar — orcamento desperdicado e equipa mais lenta. Use-a como a PRIMEIRA acao no seu loop, antes de tudo o resto. Pertence ao papel Scout; SCOUT-1 normalmente arbitra se multiplos scouts arrancam simultaneamente.
allowed-tools: Bash(python3 /app/shared/skills/scout_coord.py *), Bash(tmux *), Bash(jht-tmux-send *)
---

# scout-coord — particionar o territorio

Multiplos Scouts correm em paralelo (maximo 2 instancias pela politica da equipa). A equipa so funciona se concordarem numa **particao sem sobreposicao** de:
- quais **circulos** cada um possui (1 = preferencia primaria, 2 = vizinhos geograficos, 3 = relocacao, 4 = satelite, 5 = fronteira)
- quais **tiers de fontes** cada um possui (LinkedIn / agregadores ATS / nicho / WebSearch)

O estado reside na **base de dados SQLite partilhada** gerida pelo `scout_coord.py`; os scouts negoceiam via tmux no arranque e persistem o acordo la.

**Uma so base de dados, ou nenhuma coordenacao.** Todos os Scouts tem de estar na mesma base — o `jobs.db` da equipa, o mesmo `JHT_DB` de qualquer outra skill (o launcher ja o exporta no teu painel). Ja nao ha um ficheiro de coordenacao separado para resolver; um `scout_coordination.db` antigo, se existir, e importado uma vez no bootstrap e deixado onde esta, so de leitura dai em diante. Se sair com **3**, a base de dados nao e utilizavel: reporta a mensagem impressa e PARA. Nunca cries uma base de dados tua, nunca apontes a ferramenta para outro caminho.

```bash
# Em que base de dados estou realmente?
python3 /app/shared/skills/scout_coord.py doctor
```

## Passo 1 — Descobrir peers

```bash
tmux list-sessions 2>/dev/null | awk -F: '{print $1}' | grep -E '^SCOUT-[0-9]+$'
```

Se es o unico scout listado → nenhuma negociacao necessaria, reivindica tudo o que conseguires gerir. Salta para o Passo 4.

Se outros estiverem listados → tens de negociar (Passos 2-3) antes de fazer scraping de qualquer coisa.

## Passo 2 — Limpar estado obsoleto

Se a equipa de scouts anterior crashou a meio do loop, `scout_coord.py` pode conter atribuicoes obsoletas referindo sessoes mortas. Limpa-as:

```bash
python3 /app/shared/skills/scout_coord.py reset
```

Este e um passo coordenado: o **SCOUT ativo com o numero mais baixo** (normalmente `SCOUT-1`) faz o reset, os outros esperam. Anuncia no tmux:

```bash
jht-tmux-send SCOUT-2 "[@$MY_ID -> @scout-2] [INFO] resetto scout_coord, attendi 5s prima di assign"
```

## Passo 3 — Negociar via tmux

Abre uma conversa curta (3-5 mensagens no maximo) com cada peer. Propoe uma divisao:

```
[@scout-1 -> @scout-2] [REQ] proposta: io prendo cerchi 1+2 + tier 1-2 (LinkedIn, ATS).
Tu cerchi 3+4 + tier 3-4 (niche board + WebSearch). OK?
```

O peer responde com `[ACK]` (aceita) ou `[COUNTER]` (contraproposta). Mantem breve — se nao chegarem a acordo em 3 rondas, escalem para o Capitano.

**Heuristicas para uma boa divisao**:

| Situacao                                        | Divisao sugerida                                                   |
|-------------------------------------------------|--------------------------------------------------------------------|
| 2 Scouts, perfil `work_mode = remote`          | S1: cerchi 1-2 + LinkedIn/ATS · S2: cerchi 1 + board remoto de nicho (RemoteOK, WeWorkRemotely) — ambos no cerchio 1, fontes complementares |
| 2 Scouts, perfil `work_mode = on-site`         | S1: cidade base + cerchio 2 regional · S2: relocacao (cerchio 3) |
| 2 Scouts, misto `work_mode = flessibile`       | S1: cerchi 1-2 (modo completo) · S2: cerchi 3-5 (relocacao + satelite + fronteira) |

Seja qual for a divisao escolhida, a regra e: **nenhum par de scouts na mesma combinacao (circulo, conjunto_de_tiers) ao mesmo tempo.**

**Volume vs. divisao curada — empirico do run VPS1 2026-05-21 (vps1-run-postmortem #14):**

> Scout-1 encontrou 130 posicoes com score medio de 63,1 (40% high-score)
> Scout-2 encontrou 76 posicoes com score medio de 68,4 (54% high-score)
>
> → Scout-2 era 1,4× mais qualitativo que Scout-1 para o mesmo candidato.

Padrao recomendado quando se tem liberdade para escolher o tier para os 2 scouts:

| Scout    | Tier atribuido                                          | Racional                                       |
|----------|---------------------------------------------------------|------------------------------------------------|
| SCOUT-1  | LinkedIn (alto volume, ruidoso)                         | Captura o fluxo, aceita score medio mais baixo |
| SCOUT-2  | Ashby / Greenhouse / Lever / company-careers (curado)   | Poucos mas certos, score medio mais alto       |

O `next-for-analista` recebe entao um mix equilibrado de volume + qualidade, e o filtro de hard-requirements do Analista (RULE-06) concentra-se no stream do Scout-1 (onde ha mais ruido). Nao e uma regra rigida — adaptar ao `work_mode` conforme a tabela acima.

## Passo 4 — Solidificar a atribuicao

Assim que tu e os teus peers concordarem, persiste a particao:

```bash
python3 /app/shared/skills/scout_coord.py assign $MY_ID \
    --cerchi "<circulos atribuidos a ti, ex. 1,2>" \
    --fonti "<slugs das fontes atribuidas, separados por virgula, ex. linkedin,greenhouse,lever>"
```

Cada scout escreve a sua propria linha. O script impoe a nao-sobreposicao nos slugs de fontes, portanto se dois scouts tentarem reivindicar `linkedin` simultaneamente o segundo falha — o perdedor deve renegociar.

## Passo 5 — Verificar

```bash
python3 /app/shared/skills/scout_coord.py show
```

Saida esperada: uma linha por scout ativo com os seus `cerchi` e `fonti`. Se a tua linha estiver em falta, o teu `assign` falhou silenciosamente — repete o Passo 4.

Verificacao cruzada: a uniao de todos os `fonti` deve cobrir os tiers que a equipa realmente quer scrapear hoje. Se um tier tem zero scouts (ex. ninguem em `niche-remote`), notifica o Capitano:

```bash
jht-tmux-send CAPITANO "[@$MY_ID -> @capitano] [INFO] scout-coord: tier 'niche-remote' senza scout, considera spawn aggiuntivo o riassegnamento."
```

## Anti-padroes

- ❌ Saltar o Passo 1 ("so existo eu") sem verificar — um peer pode ter acabado de ser relancado pelo Dottore.
- ❌ Reset executado por cada scout em paralelo — condicao de corrida, a base de dados acaba corrompida. Apenas o scout com numero mais baixo.
- ❌ Negociar e depois esquecer o Passo 4 — a base de dados esta vazia, os peers nao conseguem ver a tua reivindicacao, dois scouts atingem a mesma fonte.
- ❌ Reivindicar tanto `linkedin` COMO `greenhouse` COMO `lever` COMO `remoteok` COMO `weworkremotely` COMO `webresearch` "para estar seguro" — nada para partilhar com o peer, este nao tem nada para fazer.
- ❌ Renegociar a meio do loop sem um gatilho — a particao e feita no arranque. Se um peer morre, o Dottore relanca-o com o mesmo papel; apenas o proprio SCOUT le os seus `cerchi`/`fonti` novamente no arranque.

## Quando renegociar

Apenas nestes gatilhos:
- Um novo SCOUT acabou de arrancar (ves `SCOUT-N+1` em `tmux list-sessions` que nao estava la no teu arranque)
- Um SCOUT morreu e NAO foi relancado (capacidade diminuiu, redistribuir o seu tier)
- Capitano ordena explicitamente uma reparticao (raro, ex. apos um `[FEEDBACK]` do Analista de que um tier esta consistentemente a produzir links mortos)

Nos tres casos: troca curta no tmux, depois re-`assign` com novos parametros. Nao e necessario `reset` a menos que o JSON esteja visivelmente corrompido.

## Ver tambem

- `circles-and-sources` — a definicao real dos 5 cerchi + 4 tiers de fonti (esta skill descreve COMO particionar; aquela descreve O QUE particionar).
- `position-insert` — o que cada Scout faz depois de ter a sua atribuicao.
- `agents/_manual/anti-collision.md` — o contrato anti-colisao mais amplo que esta skill implementa para o papel Scout.
- `tmux-send` — formato de mensagem para a negociacao.
