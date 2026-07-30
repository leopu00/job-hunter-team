<!-- @translation: pt, ai-translated 2026-07-30 -->
# 💬 Regras de comunicação entre agentes — lean, pull por omissão

Os agentes JHT coordenam-se **pull-first**. Por omissão, *descobre-se* o estado de que precisas, não se
*pede*. Uma mensagem tmux é a **exceção**, reservada ao que um colega realmente não consegue encontrar
sozinho.

> **Porquê lean.** Um protocolo push-heavy (broadcasts de estado, ACK de rotina, pings "estás vivo?")
> queima tokens dos dois lados — quem envia escreve um turno, quem recebe acorda um turno para
> responder — e distrai os agentes do trabalho a sério. Quase todo esse tráfego não transporta nenhuma
> ação. Corta-o.

## 🪜 A hierarquia de coordenação — BD → capture-pane → mensagem

Usa sempre o **tier mais barato que responde à tua pergunta**. Sobe de tier só quando o de baixo
realmente não consegue.

| Tier | Ferramenta | Serve para | Custo |
|---|---|---|---|
| **1. BD** | `db_query.py` (`next-for-*`, status, `last_checked`, flags) | **estado partilhado** — o que está em fila, o que está tomado, o que está feito, scores, ciclo de vida | o mais barato, determinístico, sem races |
| **2. capture-pane** | `tmux capture-pane -p -S -N` na sessão do colega | **"o que está o X a fazer agora?"** — está a trabalhar, bloqueado num fetch, idle, encravado | barato (nenhum turno no colega), mas é um **snapshot racy** — nunca confiar nele como estado duradouro |
| **3. mensagem tmux** | `jht-tmux-send` | **ação que o colega não consegue descobrir** + **eventos de segurança** (ver a fasquia abaixo) | caro — um turno de cada lado; é a exceção |

**Regra geral:** se a resposta está na BD, consulta a BD. Se precisas de saber o que um colega está a
fazer *neste momento*, olha para o pane dele — **não lhe mandes mensagem a perguntar**. Só manda
mensagem quando nenhum dos dois serve.

## 🚧 A fasquia para uma mensagem tmux (push)

Manda uma mensagem **só** quando uma destas for verdadeira:

1. **Hand-off real** — o colega tem de *fazer* algo que não consegue descobrir a partir do seu próprio
   loop `next-for-X` nem da BD. Exemplos: Writer → Critico para arrancar o loop de review do CV;
   Capitano → worker para spawn / throttle / kill; Analista → Scout `FEEDBACK` que tem de moldar a
   *próxima* query.
2. **Evento de segurança** — `LOCKED` / `403`, halt, kill, crash, uma violação de rate iminente que o
   polling da BD é demasiado lento para apanhar. Apenas Sentinel → Capitano.
3. **Virado ao utilizador** — um pedido do humano ou uma resposta ao humano (canal separado; ver os
   manuais de função).

### ✂️ O que é CORTADO (não enviar)

- **ACK a vazio** — "recebido, contexto atualizado", "ok, a aguardar". Se a mensagem não exigia nenhuma
  ação e quem a enviou não *precisa* da confirmação para avançar, **não digas nada**. (Ver `ACK` abaixo
  para o caso raro.)
- **Broadcasts de estado** — "@all check 10:14, filas vazias, todos em standby". Isto é observável: as
  filas estão na BD, a atividade nos panes. Não o narres a toda a gente. (Para observabilidade legível
  por humanos, escreve no event-log estruturado, não nos panes dos colegas.)
- **"Estás vivo? / em que ponto vais?"** — usa capture-pane (Tier 2). Nunca queimes o turno de um colega
  para lhe pedir um estado que ele teria de parar para escrever.
- **Reconfirmações / ordens repetidas** — se já enviaste uma ordem, não a reenvies a cada tick. O
  bridge / a mailbox entrega uma só vez.

## 🔇 Produzir é silencioso — o estado vai o Capitano buscá-lo

Um worker toca o Capitano **zero vezes** para contar progresso. Nem por item, nem nos extremos: os
bookends `[START]` / `[DONE]` foram **removidos a 2026-07-27**. Medido numa equipa de primeiro
arranque, ~1,5h de histórico: **37 mensagens chegaram ao Capitano, 30 (81%) puro estado** — 12 `DONE`,
8 `START`, 8 `INFO`, 2 `ACK` — contra 3-6 que pediam mesmo uma decisão. Cada uma custa-lhe um turno
inteiro e, com a divisão automática de modelos, ele corre em **Opus** enquanto Scout / Analista /
Scorer correm em **Sonnet**: um "feito" do Scorer acorda o agente mais caro da frota para não fazer
nada.

O lado pull já existia e é claramente melhor:

```bash
python3 /app/shared/skills/db_query.py recent-activity --minutes 60
```

Uma chamada devolve as contagens por agente mais cada transição com timestamp, ator, posição e motivo
— `#22 checked→scored`, `#27 new→excluded — [DEAD_LINK]`. **Um `DONE` leva menos informação do que a
linha que o produziu.** (O mesmo protocolo já tinha matado a enxurrada por item: um Analista acordou o
Capitano **25 vezes numa noite**, um ping por posição. Agora desapareceram também os dois bookends
"educados".)

### ⚠️ O que continua PUSH — a assimetria é o ponto

`recent-activity` mostra **quem produz**, por isso um agente que parou **desaparece da lista** em vez
de saltar à vista: do lado do Capitano o teu silêncio e o teu trabalho são iguais. Estes três têm por
isso de continuar a ser enviados **já**, porque não deixam **rasto na DB**:

| Sinal | Quando |
|---|---|
| **BLOCKED** | deixaste de produzir: ferramenta partida depois da escada `resilience`, `403` / `LOCKED`, fontes mesmo secas (`[SCOUT-ESAUSTO]`), um item na fila que não consegues nem trabalhar nem saltar |
| **Conflito** | dois colegas sobre o mesmo registo / território e não conseguem resolvê-lo entre si |
| **Pedido de decisão** | um `REQ` a que só o Capitano pode responder (arbitragem de taxonomia, scaling, uma escolha virada ao utilizador) |

Tudo o resto — início, progresso, fim — é pull. Continuam permitidos como antes, porque são *decisões*
e não narração: um `FEEDBACK` a um Scout, um `URG` de segurança. **Se paras e não o dizes, ninguém dá
por isso.**

## 🗄️ Tier 1 — coordenação via BD (o padrão)

As passagens de bastão do pipeline fluem pela BD — **nenhum tmux necessário**:

| Passagem | Mecanismo |
|---|---|
| 🕵️ Scout → 👨‍🔬 Analista | O Analista consulta `next-for-analista`; vê as linhas frescas com `status = new` |
| 👨‍🔬 Analista → 👨‍💻 Scorer | O Scorer consulta `next-for-scorer`; pega nas linhas com `status = checked` |
| 👨‍💻 Scorer → 👨‍🏫 Writer | O Writer consulta `next-for-scrittore` (`score DESC`); pega nas linhas com `status = scored` ≥ 50 |
| 👨‍🏫 Writer → 👤 Utilizador | A posição chega a `status = ready` + `applications.critic_verdict = PASS`; aparece no dashboard |

**Tomar um registo sem mandar mensagens** — os colegas evitam a mesma linha através dos locks em
[`anti-collision.md`](anti-collision.md): dedup pré-INSERT + partição circles/sources para o Scout;
watermark `last_checked` para Analista/Scorer; flip para `status = writing` para o Writer. **Ganha a
primeira escrita.** Não anuncias "vou levar o ID 42" — o claim *é* o lock; o colega lê-o da BD.

## 👀 Tier 2 — capture-pane (observa, não perguntes)

Para perceber o que um colega está a fazer **sem o incomodar**:

```bash
tmux capture-pane -t <PEER_SESSION> -p -S -40
```

Procura: o spinner / `esc to interrupt` (vivo, a meio de um turno), uma prompt de shell nua (idle /
possivelmente encravado), um fetch bloqueado. Isto substitui por completo as mensagens "estás vivo? /
qual é o teu estado?".

⚠️ **É um snapshot, não o estado.** Podes apanhar um turno a meio da renderização. Usa-o para *liveness
/ atividade*, **nunca** como fonte de verdade do estado partilhado — essa é sempre a BD (Tier 1). O
veredicto sobre um colega *possivelmente morto* pertence ao Dottore (`liveness-check`), não a uma
leitura reflexa.

## 📨 Tier 3 — envelope da mensagem e tipos

Envelope etiquetado de uma única linha:

```
[@from -> @to] [TYPE] payload
```

Conjunto de tipos reduzido (usa o mais estreito que servir):

| Tipo | Quando |
|---|---|
| `URG` | Segurança / age já: Capitano → worker (throttle / freeze / kill); Sentinel → Capitano (violação, crash, LOCKED) |
| `FEEDBACK` | Analista → Scout, padrões de rejeição (`[SENIORITY] · [STACK] · [GEO] · [LINGUA]`) que têm de moldar a próxima query |
| `REQ` / `RES` | Um pedido síncrono genuíno que espera resposta (raro) — um hand-off real, não uma pergunta de estado |
| `BLOCKED` | Worker → Capitano: **deixaste de produzir** e isso não deixa rasto na BD (ferramenta partida, `403`/`LOCKED`, fontes secas, um item que não consegues nem trabalhar nem saltar). Desde 2026-07-27 é o único sinal que separa um bloqueio de trabalho silencioso — `recent-activity` não o consegue mostrar, porque um agente parado desaparece dessa lista |

`ACK` — **só** quando quem envia precisa mesmo de saber que a ação surtiu efeito para prosseguir em
segurança (ex. o Capitano tem de confirmar que um `FREEZE` foi aplicado antes de escalar). **Não** é uma
resposta de rotina. Se uma ordem não precisa de confirmação para ser segura, quem a recebe aplica-a em
silêncio. `INFO` / `REPORT` estão depreciados para o tráfego entre pares: manda a narração para o
event-log, não para os panes.

## 🛠️ Envio: `jht-tmux-send`

```bash
jht-tmux-send <PEER_SESSION> "[@me -> @peer] [URG] FREEZE"
```

⚠️ **Nunca `tmux send-keys` cru para mensagens entre agentes.** As TUIs do Codex/Kimi perdem o carácter
Enter quando este chega junto com o corpo, causando deadlocks silenciosos. O wrapper trata texto + Enter
de forma atómica. É **busy-aware**: espera que o turno do colega termine e depois entrega (`exit 0`);
`exit 4` = colega vivo mas ainda ocupado para além do budget → **tenta mais tarde, não faças spawn / não
te ponhas a raciocinar de novo**; `exit 3` = possivelmente morto → veredicto do Dottore, não um reflexo.
Skill: `agents/_skills/tmux-send/jht-tmux-send`.

**Num envio falhado / ocupado:** mete-o em fila (a `bridge_mailbox` que o Capitano drena), **não** abras
um turno de raciocínio novo para "pensar" na falha. O retry é mecânico, não cognitivo.

## ⏰ Sinais obrigatórios por função (tudo o resto é pull)

### 🕵️ Scout
- **Nunca te anuncies** ao Capitano — nada de `[START]`, nada de `[DONE]`, nada por resultado. Os INSERT
  são o relatório; ele lê-os do `recent-activity`. Push só quando estás **BLOCKED e já não produzes**
  (incl. `[SCOUT-ESAUSTO]`) ou em conflito com outro Scout.
- Recebe `FEEDBACK` dos Analistas → adapta a próxima query. **Sem ACK** a menos que o Analista tenha
  feito um `REQ`.

### 👨‍🔬 Analista
- **Nunca te anuncies** ao Capitano — nada de `[START]`, nada de `[DONE]`, nada por posição. O flip para
  `checked` é o relatório. Push só quando estás **BLOCKED e já não produzes**, ou para um `REQ` de
  arbitragem de taxonomia.
- Envia `FEEDBACK` a um Scout só perante um padrão real: 3 exclusões consecutivas com a mesma tag a
  partir da mesma fonte, OU > 60 % de taxa de exclusão num batch de um Scout. Caso contrário, silêncio
  (a BD leva a passagem).

### 👨‍💻 Scorer
- **Nunca te anuncies** ao Capitano — nada de `[START]`, nada de `[DONE]`, nada por score. Cada score é
  uma linha na BD que ele vai buscar ao `recent-activity`. Push só quando estás **BLOCKED e já não
  produzes**. A passagem do pipeline é via BD; os insights aparecem no dashboard / event-log.

### 👨‍🏫 Writer
- **Nunca te anuncies** ao Capitano — nada de `[START]` quando pegas num trabalho de CV, nada de
  `[DONE]` quando ele chega a `ready`: a transição `writing → ready` está na BD. Push só quando estás
  **BLOCKED e já não produzes** (loop do Critico encravado, dados de perfil em falta).
- Perante `URG FREEZE` do Capitano: termina o round Critic atual (nunca abandonar uma review a meio),
  depois abranda. É só aqui que o `ACK` entra — é o caso raro de confirmar-para-prosseguir.

### 💂 Sentinel
- Edge-triggered, **apenas dentro do horário de trabalho**. Fala **só** perante uma mudança de estado
  real (pico, violação, crash, `LOCKED`). Uma mensagem por edge — nunca reemitir. Nunca faz broadcast
  aos workers (o Capitano é o gateway). Estado estacionário → silêncio.

### 👨‍✈️ Capitano
- `URG` aos workers (throttle / freeze / kill / spawn) por sinal do Sentinel ou por necessidade
  observada do pipeline.
- Lê o estado do pipeline na **BD**, a atividade dos agentes no **capture-pane** — nunca narra estado
  aos colegas, nunca reenvia ordens já dadas.

## 📥 Ler mensagens dos pares

Não fazes scan ao tmux antes de cada ação — a maior parte da coordenação está na BD.
- **Entre unidades de trabalho** (depois de uma posição, antes de pegar na seguinte): um rápido
  `tmux capture-pane -p -S -20` na **tua própria** sessão para notares um `URG` / `FEEDBACK` a chegar.
- Prioriza `URG` / `FEEDBACK`; age antes de pegar em trabalho novo.
- Uma mensagem que chega a meio de uma tarefa já está no teu contexto (o wrapper escreveu-a no teu
  pane) — basta notá-la antes da iteração seguinte.

## ⏸️ Throttle: pausas rastreadas

Para abrandar o teu loop (cooldown, pós-`URG`, esperar pelo upstream), usa a skill `throttle`, **nunca
um simples `sleep`**:

```bash
jht-throttle <seconds> --agent <your-name> [--reason "..."]
```

Cada chamada regista em `$JHT_HOME/logs/throttle-events.jsonl`, para que o Capitano e o dashboard vejam
quem está em pausa e por quanto tempo. `sleep` simples só para intervalos de retry ≤ 5 s. Capitano:
nomeia a skill explicitamente na ordem (`[URG] jht-throttle 180 --agent scout-1 --reason "rate
budget"`), nunca "sleep 3 minutos".

Ver: [`../_skills/throttle/SKILL.md`](../_skills/throttle/SKILL.md).

## 🔗 Relacionado

- 🛡️ [`anti-collision.md`](anti-collision.md) — locks claim-before-work (como coordenar via BD)
- 🧭 [`../_team/architettura.md`](../_team/architettura.md) — panorâmica do pipeline (quem alimenta quem)
