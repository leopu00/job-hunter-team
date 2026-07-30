<!-- @translation: pt, ai-translated 2026-06-06 -->
# 💬 Regras de comunicação entre agentes

Os agentes JHT coordenam-se principalmente através da **base de dados**, não via tmux. A BD transporta o estado estável do pipeline; tmux é reservado para **sinais em tempo real** que não podem esperar pelo próximo ciclo de polling.

## 🗄️ Coordenação via BD (o padrão)

As passagens de bastão no pipeline fluem naturalmente pela BD — nenhuma notificação tmux necessária:

| Passagem | Mecanismo |
|---|---|
| 🕵️ Scout → 👨‍🔬 Analyst | O Analyst consulta `next-for-analista` continuamente; vê linhas novas com `status = new` imediatamente |
| 👨‍🔬 Analyst → 👨‍💻 Scorer | O Scorer consulta `next-for-scorer`; pega linhas com `status = checked` |
| 👨‍💻 Scorer → 👨‍🏫 Writer | O Writer consulta `next-for-scrittore` ordenado por `score DESC`; pega linhas com `status = scored` ≥ 50 |
| 👨‍🏫 Writer → 👤 Utilizador | A posição chega a `status = ready` + `applications.critic_verdict = PASS`; o dashboard do Captain exibe-a |

**Regra geral**: se o próximo agente no pipeline pode ver o novo estado ao executar a sua query padrão `next-for-X`, **não envie uma mensagem tmux**. Enviar tmux em cada batch cria ruído e arrisca mensagens perdidas em painéis ocupados.

## 📡 tmux é apenas para sinais em tempo real

Envie uma mensagem tmux apenas quando o destinatário precisa de agir *agora* e não pode esperar pelo próximo poll da BD:

| Tipo | Quando usar | Tempo real necessário porque… |
|---|---|---|
| `URG` | Captain → workers (FREEZE / throttle / kill) por sinal do Sentinel | A ultrapassagem do rate-limit é iminente — o polling da BD é demasiado lento |
| `URG` | Sentinel → Captain em mudança de estado real (pico, violação, crash) | Idem |
| `FEEDBACK` | Analyst → Scout sobre padrões de rejeição (`[SENIORITY] · [STACK] · [GEO] · [LINGUA]`) | O Scout deve adaptar a **próxima** query, não após um ciclo de polling |
| `REQ` / `RES` | Pedido interativo entre agentes (raro) | Resposta síncrona esperada |
| `ACK` | Resposta confirmando que um `URG` foi recebido e aplicado | O Captain precisa de saber que o throttle/freeze teve efeito |

## 📨 Envelope da mensagem

Toda mensagem entre agentes usa um envelope etiquetado de uma única linha:

```
[@from -> @to] [TYPE] payload
```

`TYPE` é um de `URG · FEEDBACK · REQ · RES · ACK · INFO · REPORT` — mas na V5 apenas os 5 primeiros são usados rotineiramente (ver tabela acima).

## 🛠️ Envio: `jht-tmux-send`

```bash
jht-tmux-send <PEER_SESSION> "[@me -> @peer] [URG] FREEZE"
```

⚠️ **Nunca use `tmux send-keys` diretamente para mensagens entre agentes.** As TUIs do Codex e Kimi perdem o carácter Enter se este chegar na mesma chamada `send-keys` do corpo do texto, causando deadlocks silenciosos. O wrapper trata texto + Enter de forma atómica com uma pausa de renderização. Skill em `agents/_tools/jht-tmux-send`.

## 🔇 Produzir é silencioso — o estado vai o Capitano buscá-lo

Um worker toca o Capitano **zero vezes** para contar progresso. Nem por item, nem nos extremos: os
bookends `[START]` / `[DONE]` foram **removidos a 2026-07-27**. Medido numa equipa de primeiro
arranque, ~1,5h de histórico: **37 mensagens chegaram ao Capitano, 30 (81%) puro estado** — 12 `DONE`,
8 `START`, 8 `INFO`, 2 `ACK` — contra 3-6 que pediam mesmo uma decisão. Cada uma custa-lhe um turno
inteiro e, com a divisão automática de modelos, ele corre em **Opus** enquanto Scout / Analista /
Scorer correm em **Sonnet**: um "feito" do Scorer acorda o agente mais caro da frota para não fazer
nada.

O lado pull já existia e é melhor:

```bash
python3 /app/shared/skills/db_query.py recent-activity --minutes 60
```

Uma chamada devolve as contagens por agente mais cada transição com timestamp, ator, posição e motivo
— `#22 checked→scored`, `#27 new→excluded — [DEAD_LINK]`. **Um `DONE` leva menos informação do que a
linha que o produziu.**

### ⚠️ O que continua PUSH — a assimetria é o ponto

`recent-activity` mostra **quem produz**, por isso um agente que parou **desaparece da lista** em vez
de saltar à vista: do lado do Capitano o teu silêncio e o teu trabalho são iguais. Estes três têm por
isso de continuar a ser enviados **já**, porque não deixam **rasto na DB**:

| Sinal | Quando |
|---|---|
| **BLOQUEADO** | deixaste de produzir: ferramenta partida depois da escada `resilience`, `403` / `LOCKED`, fontes mesmo secas (`[SCOUT-ESAUSTO]`), um item na fila que não consegues nem trabalhar nem saltar |
| **Conflito** | dois colegas sobre o mesmo registo / território e não conseguem resolvê-lo entre si |
| **Pedido de decisão** | um `REQ` a que só o Capitano pode responder (arbitragem de taxonomia, scaling, uma escolha virada ao utilizador) |

Tudo o resto — início, progresso, fim — é pull. **Se paras e não o dizes, ninguém dá por isso.**

## ⏰ Sinais obrigatórios por função

O que cada função DEVE enviar via tmux (tudo o resto é via BD):

### 🕵️ Scout
- Recebe `FEEDBACK` dos Analysts → adapta as queries; responde `ACK`

### 👨‍🔬 Analyst
- Envia `FEEDBACK` a um Scout quando:
  - 3 exclusões consecutivas da mesma fonte com a mesma tag, OU
  - Taxa de exclusão >60% num único batch de um Scout

### 👨‍💻 Scorer
- *(sem tmux — as passagens do pipeline são via BD; as estatísticas de distribuição de scores aparecem no dashboard do Captain)*

### 👨‍🏫 Writer
- Recebe `URG FREEZE` do Captain → termina o round Critic atual (nunca abandonar uma review a meio), depois `ACK` e suspender até o throttle voltar a T0/T1

### 💂 Sentinel
- Edge-triggered: só fala quando o estado muda efetivamente (pico de utilização, violação de projeção, crash de agente). Envia `URG` ao Captain com a ação proposta (throttle / freeze / kill). Nunca envia diretamente aos workers — o Captain é o gateway.

### 👨‍✈️ Captain
- Envia ordens `URG` aos workers (FREEZE, nível de throttle, kill) por sinal do Sentinel
- Envia `REQ` para coordenação interativa (raro)
- Reencaminha feedback do utilizador da Fase 5 para a função relevante
- Lê o estado do pipeline na BD, não nos painéis dos workers — nunca questiona um agente ao ligar-se ao seu tmux

## 📥 Ler mensagens dos pares

Não precisa de verificar tmux antes de *cada* ação — a maior parte da coordenação flui pela BD. Em vez disso:

- **Entre unidades de trabalho** (depois de terminar uma posição, antes de pegar a próxima), faça um rápido `tmux capture-pane -p -S -20` na sua própria sessão.
- **Priorize `URG` e `FEEDBACK`**: atue sobre eles antes de pegar trabalho novo.
- Uma mensagem a chegar enquanto está no meio de uma tarefa já estará no seu contexto (o wrapper escreve-a no seu painel); não precisa de fazer polling, basta notá-la antes de iniciar a próxima iteração.

## ⏸️ Throttle: pausas rastreadas

Sempre que quiser abrandar o seu loop para respeitar o orçamento de rate
(arrefecimento após um batch, freeze pós-`URG`, "esperar pelo upstream", …),
**use a skill `throttle`, nunca um simples `sleep`**:

```bash
jht-throttle <seconds> --agent <your-name> [--reason "..."]
```

Cada chamada adiciona um evento a `$JHT_HOME/logs/throttle-events.jsonl`,
para que o Captain e o dashboard possam ver quem está em pausa e por quanto
tempo. O simples `sleep` é permitido apenas para esperas muito curtas (≤ 5 s)
entre tentativas, onde o logging seria ruído.

Captain: quando ordenar a um worker para abrandar, nomeie a skill explicitamente,
ex. `[URG] Throttle: jht-throttle 180 --agent scout-1 --reason "rate budget"`.
Não diga "sleep 3 minutes" — isso contorna o logging.

Ver: [`../_skills/throttle/SKILL.md`](../_skills/throttle/SKILL.md).

## 🔗 Relacionado

- 🛡️ [`anti-collision.md`](anti-collision.md) — mecanismos de lock (claim antes de trabalhar)
- 🧭 [`../_team/architettura.md`](../_team/architettura.md) — panorâmica do pipeline (quem alimenta quem)
