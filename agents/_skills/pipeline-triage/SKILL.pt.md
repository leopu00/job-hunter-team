<!-- @translation: pt, ai-translated 2026-06-06 -->
---
name: pipeline-triage
description: "Decidir QUE papel spawnar / pausar / eliminar com base no estado do backlog, não por intuição. Abrir esta skill SEMPRE QUE observar — vel team < 50% alvo, OU fila de qualquer papel = 0, OU fontes do Scout esgotadas, OU [SCALA UP] da Sentinella, OU `PIPELINE VUOTA + UNDERSHOOT`, OU `MARGINE` do bridge-pacing, OU cold start, OU sempre que estiver tentado a \"simplesmente spawnar outro Scout\". NÃO esperar por um [SCALA UP] explícito da Sentinella quando as condições já são visíveis nas métricas. O objetivo: ler 4 números, escolher o papel que quebra o bottleneck, passar a `spawn-agent`."
allowed-tools: Bash(python3 /app/shared/skills/db_query.py *), Bash(tmux *)
---

# pipeline-triage — escalonamento baseado em dados

O pipeline é um sistema dinâmico. Cada papel consome de forma muito diferente por tarefa — adicionar um 2º Scrittore custa muito mais que adicionar um 2º Scout. Escalar na cabeça quando o bottleneck está na cauda produz *mais* backlog, não mais output. Sempre começar pelos dados.

## Quando abrir esta skill (bug #17)

Abrir com base em **condições observadas**, não apenas em ordens explícitas da Sentinella. Triggers:

- Velocidade da equipa abaixo de 50% do alvo
- Fila de qualquer papel a 0 (Scout esgotado, Scorer/Scrittore ociosos)
- Fontes do Scout reportadas esgotadas ("bebee, indeed, glassdoor — nada novo")
- `[SCALA UP]` da Sentinella
- `MARGINE` / `PIPELINE VUOTA + UNDERSHOOT` do bridge-pacing
- Cold start de uma janela

O anti-padrão histórico: Capitano vê `SCRITTORE_QUEUE=0` +
`PROMOTABLE_40_49=6`, **descreve** a situação perfeitamente ao
utilizador, **não** executa a promoção. Esta skill é *ativa*, não
*consultiva* — quando as condições coincidem, executa.

## Passo 1 — ler o backlog (sempre, antes de qualquer spawn)

```bash
python3 /app/shared/skills/db_query.py stats
```

De `positions` (P), `scores` (S), `applications` (A), computar:

| Métrica             | Fórmula                                                       | O que significa                                     |
|---------------------|---------------------------------------------------------------|-----------------------------------------------------|
| **UNSCORED**        | P − S                                                         | posições que o Scorer ainda tem de avaliar           |
| **DRAFT_BLOCKED**   | applications com `status = draft`                              | loop Scrittore ↔ Critico estagnado                  |
| **SCRITTORE_QUEUE** | posições com `score ≥ 50` E sem application                    | fila do Scrittore (demanda real para novos CVs)     |
| **PROMOTABLE_40_49**| posições com `score 40-49` E sem application                    | banda de estacionamento — promovíveis sob demanda   |

Também útil: `python3 /app/shared/skills/db_query.py dashboard` para visão rápida de status + instâncias ativas por papel.

## Passo 1 bis — quem produz e quem se calou (2026-07-27)

Os workers já não enviam `[START]` / `[DONE]` (esses bookends eram 30 das 37 mensagens recebidas pelo
Capitano em ~1,5h numa equipa de primeiro arranque). O progresso deles puxa-se daqui:

```bash
python3 /app/shared/skills/db_query.py recent-activity --minutes 30
```

⚠️ **Lista quem PRODUZ, por isso um agente em stall desaparece dela em vez de saltar à vista.** Um
backlog que não esvazia não é automaticamente um worker em falta: pode ser um worker vivo e encravado,
e fazer spawn de um segundo deixa o primeiro a queimar. Antes de decidir, cruza três fontes:

| Vivo (`tmux list-sessions`) | Fila (`next-for-*`) | Transições (`recent-activity`) | Veredicto |
|---|---|---|---|
| sim | não vazia | 0 | **STALL** — confirma com `capture-pane`, depois `agent-emergency` (Dottore-first → kill). **Não** faças spawn de um segundo por cima |
| sim | não vazia | > 0 | está a trabalhar — é um problema de capacidade, vai ao Passo 2 |
| sim | vazia | 0 | idle legítimo — deixa-o em paz (depois de um `[SCOUT-ESAUSTO]` a quiescência é deliberada) |
| não | não vazia | 0 | falta mesmo — faz spawn (Passo 2) |

## Passo 2 — escolher prioridade (bottleneck primeiro, nunca trabalho novo)

Aplicar a tabela de cima para baixo. Parar na primeira condição que corresponde.

| Condição                                                  | Ação (nesta ordem)                                                                                                              |
|-----------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------|
| `DRAFT_BLOCKED ≥ 50`                                      | **Primeiro**: desbloquear o loop do Critico. Spawnar `CRITICO-S2/S3/S4` se não estiverem vivos (3 paralelos). Cada `CRITICO-S` processa 1 draft de cada vez. |
| `UNSCORED ≥ 20`                                           | **Depois**: spawnar `SCORER-2` (e `SCORER-3` se `UNSCORED ≥ 50`). Um Scorer é insuficiente com 20+ na fila.                      |
| `SCRITTORE_QUEUE ≥ 5`                                     | spawnar 1 `SCRITTORE-N` se não tiver já 3 vivos (máximo).                                                                        |
| `PROMOTABLE_40_49 ≥ 5`                                    | promover os melhores 5 elevando a pontuação (`db_query.py` + `UPDATE` direto), depois tratar como `SCRITTORE_QUEUE`.              |
| `SCRITTORE_QUEUE < 5 AND PROMOTABLE_40_49 < 5`            | **Só agora** spawnar 1 `SCOUT-N` para novas posições.                                                                            |

Uma vez escolhido o papel, passar a `spawn-agent` para o lançamento real + kick-off.

## Passo 3 — anti-padrões a evitar

- ❌ Spawnar um Scout como primeira ação quando `UNSCORED > 20` — produz mais backlog sem output extra.
- ❌ Resetar throttle globalmente (`throttle-config.py reset`) ao escalar — aplicar throttle apenas ao papel que spawnou.
- ❌ Spawnar múltiplos papéis no mesmo tick "por segurança" — esperar pelo próximo tick da Sentinella (~5 min) e reler os números.
- ❌ Eliminar agentes ociosos para "arrumar" — ocioso custa quase zero. Eliminar apenas se explicitamente pedido pelo utilizador, ou se um agente está a queimar tokens num loop confuso.

## Racionalização empírica (porquê esta ordem, não outra)

Observado nas janelas W3-W6 (pico mediano proj 57-61%): Scouts produzem ~3 posições/h consistentemente, mas Scorer/Critico NÃO drenam o backlog → 88 sem pontuação e 217 drafts acumularam = 12+ pontos de rate-budget não usados. **A cura é a jusante, não a montante.** Sempre que está sub-ritmo (`vel_team` abaixo de `vel_target`) com backlog não-vazio, a causa é quase sempre Scorer ou Critico, nunca Scout. *(Ignorar `proj`: é INFO volátil, não um trigger.)*

## Consumo por papel — escolher com custo em mente

| Papel         | Consumo por tarefa       | Notas                                                                                                  |
|---------------|--------------------------|--------------------------------------------------------------------------------------------------------|
| **Scout**     | baixo-médio, longo+cumulativo | scraping + filtragem em múltiplas fontes; 2 scouts a ritmo pleno podem saturar sozinhos             |
| **Analista**  | médio, rajadas curtas    | 1 tarefa = ler 1 JD + escrever avaliação. Atualiza ~a cada 2 min quando há fila                       |
| **Scorer**    | baixo, rajadas curtas    | pontuação de correspondência com perfil, quase-determinístico. O papel mais barato.                    |
| **Scrittore** | **ALTO**                 | loop interno com Critico 3-4 rodadas, cada rodada escreve um CV/carta completo. Um Scrittore ativo pode superar todos os outros combinados. |
| **Critico**   | médio                    | ativado apenas na chamada do Scrittore; custo soma-se ao do Scrittore.                                 |
| **Assistente**| baixo, sob demanda       | fala com o utilizador; não está no pipeline de dados.                                                  |

**Corolário**: o custo marginal do 2º Scrittore é muito maior que o do 2º Scout. Escalar de cima para baixo ("mais trabalho → mais de tudo") ultrapassa.

## Bottleneck → ação (qualitativo, fallback quando stats são ambíguos)

| Estado do pipeline                                      | Bottleneck                  | Ação                                                                                       |
|---------------------------------------------------------|-----------------------------|----------------------------------------------------------------------------------------------|
| `0 new, 0 checked, 0 scored` (vazio)                    | cabeça: sem material        | iniciar **apenas Scouts**, mesmo 2 em paralelo. Sem Analista/Scorer/Scrittore (sem input).   |
| muitos `new`, poucos `checked`                          | Analista subdimensionado    | spawnar `analista 2`. **Não** adicionar Scouts (já há material; abrande-os se necessário).   |
| muitos `checked`, poucos `scored`                       | Scorer lento                | spawnar `scorer 1` se ausente; se já ativo + fila `checked` > 20 durante ≥2 ticks → spawnar `scorer 2` |
| muitos `scored ≥ 50`                                    | precisa de capacidade de escrita | Scrittore. Ressalva: 1 Scrittore ativo + Critico podem saturar o orçamento sozinhos. Spawnar 1, observar 2-3 ticks, depois decidir. |
| Scrittori saturados, fila `score ≥ 50` não drena        | limite de capacidade do plano | NÃO spawnar Scrittori extra — risco de `RALLENTA` instantâneo. Abrandar Scouts para parar de alimentar a fila. |
| fila `scored` baixa MAS muitos `writing` em progresso   | Scrittori ocupados e a produzir | não fazer nada. Esperar `writing → ready`.                                                  |

**Princípio orientador**: ligar agentes **upstream** quando falta input, **downstream** quando falta output. Nunca "em todos os níveis" sem pensar.

## Portas de escalonamento (regras de pacing)

- **1 spawn por tick da Sentinella (~5 min).** Spawn → kick-off → esperar próximo `[BRIDGE TICK]` → próxima decisão. Nunca 5 seguidos.
- **Máximo por papel**: 2 Scout, 2 Analista, **2 Scorer**, 3 Scrittore, 1 Critico (o Critico é spawned pelo Scrittore, não toque nele).
- **Pré-spawn check**: `tmux has-session -t <SESSION> 2>/dev/null && echo ATTIVO` — nunca spawnar cegamente sobre uma sessão existente.
- **Ordem de boot**: Scouts + Analista *primeiro*, Scorer + Scrittori *depois*. Nunca em paralelo.

## Checklist pré-spawn (executar mentalmente antes de cada spawn)

1. `db_query.py stats` — onde está o backlog?
2. `db_query.py dashboard` — quantas instâncias por papel já vivas?
3. O papel que está prestes a spawnar — dissolve o bottleneck **real**, ou está a "preencher a equipa"? Se o segundo: **não spawnar** (orçamento não usado ganha a overshoot).

## Triagem de sessões pré-existentes

Antes de qualquer `start-agent.sh`, listar o que já existe:

```bash
tmux list-sessions 2>/dev/null | awk -F: '{print $1}'
tmux capture-pane -t <SESSION> -p -S -40 2>/dev/null | tail -20
```

| Estado no capture-pane                                                       | Ação                                           |
|------------------------------------------------------------------------------|-------------------------------------------------|
| 🟢 CLI ativo, contexto < 40%, loop recente                                   | manter, não regenerar                           |
| 🟡 CLI ativo, contexto > 80% ou idle > 10 min                                | julgar: trabalho precioso → deixar; loop confuso → eliminar + regenerar |
| 🔴 `command not found` / shell puro / painel vazio > 5 min                    | `tmux kill-session` + regenerar (usar `spawn-agent`) |

Para diagnóstico de liveness mais profundo (procedimentos zombie, sintomas de morte do CLI), isso é trabalho do **Dottore** via a skill `liveness-check` — não duplicar aqui.

## Ver também

- `spawn-agent` — lançamento real + kick-off após a decisão do papel.
- `sentinel-orders` — o que disparou esta triagem (`SCALA UP`, `PIPELINE VUOTA`).
- `bridge-pacing` — quando MARGINE significa "spawnar mais um no bottleneck".
- `liveness-check` (Dottore) — diagnósticos de saúde de agente mais profundos.
- `agents/_team/architettura.md` — diagrama completo do pipeline e notas de coordenação por fase.
