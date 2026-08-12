<!-- @translation: pt, ai-translated 2026-08-03 -->
---
name: team-modes
description: "O manual dos modos da equipa — uma ficha por modo (search / harvest / care / calibration / saving). Abre-o sempre que o banner horário [MODALITÀ CORRENTE] nomear um modo e não te lembrares do que implica operacionalmente, ao acordar depois de um refresh de contexto, ou quando o utilizador mudar de modo a partir do jogo. O modo é SEMPRE uma escolha do utilizador - esta skill diz-te como CONDUZIR o atual, nunca como o mudar."
allowed-tools: Bash(python3 /app/shared/skills/mode_banner.py *), Bash(python3 /app/shared/skills/db_query.py *), Bash(python3 /app/shared/skills/feedback_query.py *), Bash(python3 /app/shared/skills/team_directives.py *)
---

# team-modes — o que significa o modo atual, em trinta segundos

A equipa tem um só modo persistente de cada vez. Vive em
`$JHT_HOME/profile/capitano-maintenance.json` (nome de ficheiro histórico — NÃO
esperes um ficheiro renomeado) sob a chave `"mode"`, um **enum fechado de cinco
valores**. O banner horário `[MODALITÀ CORRENTE]` traz a especificação
compacta; esta skill é a ficha completa. Se o banner e o teu contexto não
concordarem, **ganha o ficheiro em disco** — o teu contexto pode ter sido
apagado por um refresh.

| valor | significado |
|---|---|
| `search` | por defeito: acumular (scout → análise → score) |
| `harvest` | para o sourcing, converte em CV as melhores posições já encontradas |
| `care` | mantém fresco o portfólio encontrado: recheck cadenciado, descarte das expiradas (C-18) |
| `calibration` | lê o feedback do utilizador e reaponta a **prioridade** da procura |
| `saving` | mínimo vital de sobrevivência, nenhum enriquecimento autónomo |

- **Sem ficheiro → `search`.** Valores legacy: `"normal"` → search,
  `"maintenance"` → care (as instalações live ainda os trazem — respeita-os,
  mesmo modo).
- **Ficheiro presente mas ilegível → modo `sconosciuto`**: trata-o como uma
  ordem ATIVA (o sourcing fica parado), e abre tu mesmo o ficheiro antes de
  decidires seja o que for.
- Um valor fora do enum continua a ser uma ordem do utilizador: reporta-o, não
  o normalizes para o fazer desaparecer.

Cada modo declara **quatro coisas** — as mesmas quatro que o banner comprime:
**(1)** que filas estão ativas, **(2)** o que está suspenso, **(3)** para onde
vai o orçamento, **(4)** quando o seu trabalho está FEITO. O ponto 4 é o que
faltava historicamente: nenhum modo terminava sozinho, e uma equipa chegou a
ficar 18 dias em manutenção sem que ninguém desse por isso. Quando o banner
disser que o trabalho do modo está esgotado, **di-lo ao utilizador** — nunca
mudes de modo por tua iniciativa, mas o silêncio também não é permitido.

O vocabulário `orders` (`stop_search`, `discard_expired_rotating`,
`cv_min_score`, `pre_check_liveness_for_cv`, mais as chaves escritas à mão)
compõe-se com TODOS os modos: uma chave explícita em `orders` passa sempre por
cima do valor por defeito do modo. Um VPS de produção live corre hoje em `care`
com essas ordens ativas.

---

## `search` — ricerca (procura; por defeito: acumular)

1. **Filas ativas**: a pipeline completa — os Scout fazem sourcing,
   `next-for-analista`, `next-for-scorer`; Scrittore/Critico continuam
   on-demand (C-10).
2. **Suspenso**: nada. C-05/C-05c (sourcing anti-idle) estão em vigor.
3. **Prioridade de orçamento**: primeiro o sourcing, depois análise/score;
   equilibra a entrada em direção a posições COM PONTUAÇÃO (a shortlist é o
   produto).
4. **Condição de saída**: nenhuma — modo contínuo. Não acaba; é o utilizador
   que te tira dele (tipicamente para `harvest` ou `care` quando o backlog
   pontuado ultrapassa o tempo que ele tem para o ler).

**O que fazes**: regime normal — calibração faseada C-02, escada de throttle
C-07, consciência weekly C-09. **Com C-25**: `[SCOUT-ESAUSTO]` + filas a
jusante vazias + margem → o trabalho útil por defeito de C-25 já é o trabalho
deste modo; mantém o pace no alvo, nunca parado havendo margem. **NÃO faças**:
tratar "sem ficheiro" como "sem regras" — o quadro (`team_directives`)
continua a aplicar-se.

## `harvest` — raccolto (colheita: para o sourcing, converte as melhores)

1. **Filas ativas**: o portfólio já encontrado, melhores pontuações primeiro.
   Fluxo CV: `next-for-scrittore` (marcadas com flag pelo utilizador) mais as
   posições que o utilizador escolher quando lhe puseres à frente o topo da
   shortlist; o Critico revê como habitualmente.
2. **Suspenso**: o sourcing — **NENHUM Scout** (`stop_search` vale true por
   defeito: C-05/C-05c suspensas, a fila `new` vazia é o estado DESEJADO).
3. **Prioridade de orçamento**: Scrittore/Critico primeiro; o Analista apenas
   para o check de liveness pré-CV (`pre_check_liveness_for_cv` — nunca
   escrevas um CV para uma oferta morta).
4. **Condição de saída**: nenhuma posição viva ≥ o limiar de CV
   (`orders.cv_min_score`, por defeito 75) fica sem CV. O banner avalia-o em
   modo de leitura contra a DB; quando disser HARVEST DONE, reporta-o ao
   utilizador e pergunta para onde ir a seguir.

**O que fazes**: mata / não faças spawn de Scouts; faz spawn do Scrittore
on-demand conforme C-10 à medida que o utilizador vai marcando posições; mantém
em movimento a fila das marcadas; põe à frente do utilizador as melhores
posições ainda não escritas para que ele as possa marcar. **Com C-25**:
colheita esgotada + margem de orçamento → o excedente volta ao sourcing (1
Scout, pacing normal) A MENOS QUE o utilizador tenha proibido explicitamente o
sourcing (quadro, C-26) — nesse caso ficas quieto e dizes ao utilizador que há
orçamento de sobra. **NÃO faças**: escrever CV para posições abaixo do limiar
"para usar o orçamento", nem fazer spawn de Scouts "para não ficar parado"
enquanto restarem candidatas por escrever.

## `care` — cura (cuidado: mantém o portfólio fresco; regra completa: C-18)

1. **Filas ativas**: `next-for-recheck-due` (live, score ≥ 70, >14 dias,
   melhores primeiro, via `recheck-batch`), `next-for-geocode-missing`,
   `next-for-logo-missing`, mais o conjunto das expiradas
   (`discard_expired_rotating`).
2. **Suspenso**: o sourcing com `stop_search: true` (aqui é o seu valor por
   defeito) — C-05/C-05c suspensas.
3. **Prioridade de orçamento**: manutenção do portfólio, distribuída pelas
   horas ativas (lenta, constante — nunca concentrada no início); CV apenas a
   pedido do utilizador e ≥ `cv_min_score` (por defeito 90).
4. **Condição de saída**: AS QUATRO filas de cuidado vazias. A cadência de 14
   dias volta a amadurecer posições, por isso "feito" é feito-por-agora — o
   banner di-lo, e pelo ponto 4 de C-18 + C-25 o excedente volta ao sourcing
   salvo proibição.

**O que fazes**: os Analisti são o motor — uma fila distinta por instância
(C-13), declarada no kick-off. A exclusão de uma posição é SEMPRE juízo do
Analista, nunca de um script. As filas de enriquecimento honram
`enrichment-policy.json` EM CÓDIGO: uma fila que volta vazia com um motivo de
policy é um estado desejado, não um bug. **NÃO faças**: queimar todos os
rechecks de uma vez, repetir uma fila desativada por policy, nem fazer spawn de
Scouts enquanto as filas de cuidado tiverem trabalho.

## `calibration` — calibrazione (calibração: reaponta a prioridade da procura)

1. **Filas ativas**: o feedback do utilizador (`feedback_query.py recent` —
   vive na cloud), o perfil de score, a taxonomia `role_family`.
2. **Suspenso**: o sourcing massivo — enquanto a prioridade não for
   atualizada, as posições novas seriam encontradas com a MIRA ANTIGA (é esse o
   desperdício que este modo previne). `stop_search` vale true por defeito.
3. **Prioridade de orçamento**: ler o feedback + reapontar: ajusta as
   prioridades e os círculos de procura dos Scout, recalcula o score das
   posições afetadas num batch delimitado se os critérios mudaram.
4. **Condição de saída**: o batch de feedback recente foi lido e a prioridade
   atualizada. NÃO verificável por máquina a partir do disco (o feedback vive
   na cloud) — o banner diz "non valutabile" de propósito; és TU que declaras a
   conclusão ao utilizador, com o que mudou (ex. "despriorizado Berlim
   presencial, reforçado o fintech — 12 posições repontuadas").

**O que fazes**: puxa o feedback, extrai o padrão (de que gostou, o que
escondeu, o que marcou como favorito), traduz isso em prioridades para os Scout
e — se se justificar — num re-score delimitado. Depois reporta e espera que o
utilizador mude de modo. **Com C-25**: calibração feita + margem → o excedente
volta ao sourcing (agora com a prioridade NOVA) salvo proibição. **NÃO faças**:
repontuar toda a DB, inventar preferências que o feedback não mostra, nem
continuar o sourcing com a mira antiga.

## `saving` — risparmio (poupança: mínimo de sobrevivência)

1. **Filas ativas**: nenhuma autónoma. Apenas o que o utilizador pede
   explicitamente: respostas de chat, tickets (C-15), flags conduzidos pelo
   utilizador (write/geocode/recheck pedidos — esses nunca passam por uma
   policy).
2. **Suspenso**: o sourcing E todo o enriquecimento autónomo (recheck, geocode,
   logo). Os workers que não sejam necessários para pedidos pendentes do
   utilizador são mortos ou não são spawnados.
3. **Prioridade de orçamento**: quase zero. A única despesa é responder ao
   utilizador.
4. **Condição de saída**: `mode_until`, se o utilizador a deu — nessa data o
   modo expira **sozinho**, ordens incluídas, e a equipa volta a `search` (o
   ficheiro continua a dizer `saving`: ganha o prazo, e o banner declara-o).
   Sem `mode_until` dura até o utilizador o levantar, e vale a pena dizê-lo: o
   budget semanal é uma **janela, não um saldo** — o que não se gasta no reset
   é destruído, portanto uma poupança deixada por inércia não conserva o ciclo,
   deita-o fora. Diz ao utilizador que lhe pode dar um fim, e onde: a Consola tem o campo
   «Até quando» (dias e horas, ao lado do seletor), e a partir de uma shell é
   `jht coordinator set-mode saving --until <iso>`. Escrevem a mesma chave no
   mesmo ficheiro.

**O que fazes**: mantém Capitano/Assistente/Mentor reativos; mais nada se mexe
sem um pedido direto do utilizador. **Com C-25**: poupança É uma proibição
explícita do utilizador sobre a despesa autónoma — aqui C-25 NÃO desbloqueia o
sourcing; se o orçamento está a ser desperdiçado, DIZES isso ao utilizador (é a
outra metade de C-25), não o gastas. **NÃO faças**: reinterpretar "mínimo" como
"um bocadinho de sourcing não faz mal".

---

## Regras transversais aos modos

- **C-25 (nunca desperdiçar o orçamento)** compõe-se com todos os modos:
  trabalho próprio do modo FEITO + margem → o trabalho útil por defeito é o
  sourcing ao pace de 1 Scout — exceto onde o modo ou o utilizador proíbem
  explicitamente a despesa (poupança; uma proibição explícita do quadro), onde
  a jogada correta é reportar o orçamento sobrante. C-25 nunca passa por cima
  de um travão: os caps weekly/diários, `work_phase=OFF`, os gates de C-23 e os
  throttles do utilizador ganham todos.
- **Os gates de pacing são independentes do modo**: nenhum modo autoriza um
  burst nem ignorar o `vel_target`; um modo só muda PARA ONDE vai o orçamento
  doseado.
- **Saída ≠ mudança.** Quando um modo reporta o seu trabalho esgotado, avisa o
  utilizador e continua a respeitar o modo até que seja ELE a mudá-lo. O
  ficheiro é escrito em nome do utilizador — pela Consola do jogo (prazo
  incluído) ou com `jht coordinator` se ele o pedir — e nunca por tua
  iniciativa.

## Ver também

- `mode_banner.py` (`shared/skills/`) — compõe o banner horário a partir do
  disco; `python3 /app/shared/skills/mode_banner.py show` relê-o a pedido.
- **C-18** no teu ficheiro de identidade — a regra completa do modo cuidado.
- `sentinel-orders`, `pipeline-triage`, `scaling-calc` — as alavancas que cada
  modo aponta a filas diferentes.
