<!-- @translation: pt, ai-translated 2026-06-06 -->
---
name: throttle
description: Pausa o teu loop por N segundos de forma rastreada. Usa SEMPRE isto em vez de `sleep` sempre que quiseres abrandar a tua taxa de iteracao para respeitar o orcamento de rate da equipa. A duracao e lida a partir de $JHT_HOME/config/throttle.json (o Capitao calibra os valores por agente la); passa --agent <teu-nome> e a skill resolve o resto. Usa um padrao de processo filho destacado que sobrevive a qualquer timeout de tool-call do provider (Kimi 60s, Codex 30s, Claude 120s/600s). Combina sempre com `jht-throttle-check` antes de cada tarefa para recuperar se um pai for terminado prematuramente. Regista cada pausa em $JHT_HOME/logs/throttle-events.jsonl. `sleep` para pausas de throttle e PROIBIDO.
allowed-tools: Bash(jht-throttle *), Bash(jht-throttle-check *), Bash(jht-throttle-wait *), Bash(python3 /app/shared/skills/throttle.py *), Bash(python3 /app/shared/skills/throttle-config.py *)
---

# throttle — pausa rastreada

Wrapper de shell em `/app/agents/_tools/jht-throttle`. Chama
`/app/shared/skills/throttle.py` internamente.

## Porque existe

Ate agora cada agente punha `sleep N` no seu loop "quando lhe parecia certo".
Funciona, mas a equipa nao tem observabilidade sobre isso: o Capitao nao consegue
ver *quem* esta a pausar, *durante quanto tempo*, *com que frequencia*. Com esta skill cada
pausa e adicionada a `$JHT_HOME/logs/throttle-events.jsonl` com o
nome do agente, os segundos pedidos, os segundos aplicados e um motivo opcional.

O dashboard em `/team` le este ficheiro e mostra um grafico de throttle
por agente, para que possamos *ver* o ritmo da equipa e ajusta-lo ao longo do tempo.

## Como funciona a calibracao (le isto com atencao)

O Capitao calibra **a duracao** para cada agente em
`$JHT_HOME/config/throttle.json` atraves de:

```bash
python3 /app/shared/skills/throttle-config.py set <agent> <seconds>
```

Tu (o agente operacional) NAO precisas de saber o valor atual.
Basta chamares:

```bash
jht-throttle --agent <teu-nome> [--reason "..."]
```

e a skill le a configuracao, dorme esses segundos, regista o
evento e retorna. Se o Capitao te configurou para 0 (ou nao estas na
configuracao), a skill retorna imediatamente como no-op — sem log, sem
sleep, o teu loop corre a velocidade maxima.

Isto significa:

- O Capitao muda a calibracao com **uma unica escrita na config**, sem
  orquestracao tmux. A tua proxima chamada apanha o novo valor.
- Nunca armazenas o valor de throttle na tua propria memoria; nao
  hardcodas `jht-throttle 60` no teu loop. O Capitao e dono do valor.
- O Capitao tambem pode dizer-te para chamares a skill **com mais ou menos
  frequencia** no teu loop (ex. "throttle a cada tarefa" vs "throttle
  a cada 3 tarefas") — isso e um eixo separado que tu controlas.

## Utilizacao

```bash
# Recomendado (le a config):
jht-throttle --agent <teu-nome> [--reason "..."]

# Override explicito (contorna a config; apenas quando o Capitao
# te diz com um numero especifico):
jht-throttle <seconds> --agent <teu-nome> [--reason "..."]
```

## Como funciona internamente (padrao destacado)

`jht-throttle` usa um padrao de **filho destacado** que sobrevive a qualquer
timeout de tool-call do provider (Kimi 60s, Codex 30s, Claude 120s/600s):

1. Le a config para obter a duracao.
2. Escreve um ficheiro de estado `$JHT_HOME/state/throttle-<agent>.json` com
   `until = NOW + duration` (usado por `jht-throttle-check` e
   `jht-throttle-wait`).
3. Faz fork de um subprocesso `python3 throttle.py` como filho de init
   (PPID 1) — fora da arvore de subprocessos do tool-call. Este filho escreve
   o evento `start`, dorme, e escreve o evento `end` independentemente
   do que aconteca ao tool-call que o invocou.
4. O pai (o bash que estas a chamar) bloqueia durante toda a duracao
   em blocos de sleep de 15 segundos. O sleep em blocos e mais curto do que qualquer
   timeout de tool-call por defeito do provider, portanto mesmo em Kimi 60s por defeito
   o pai sobrevive. **O agente permanece bloqueado o tempo todo.**
5. Se o provider MATAR o pai (ex. nao passaste timeout suficiente
   no teu tool call): o filho destacado continua a correr e
   escreve `end` corretamente → nenhum orfao no log. Mas o agente (tu)
   esta agora livre e poderia erroneamente iniciar a proxima tarefa. Para prevenir
   isso, ve o **padrao de gate** abaixo.

## Padrao de gate: verifica SEMPRE antes da proxima tarefa

Apos cada `jht-throttle` (e especialmente em iteracoes normais do loop),
**antes de iniciar uma nova tarefa**, executa:

```bash
jht-throttle-check <teu-nome>
# exit 0 → ok, inicia a proxima tarefa
# exit 1 → "STILL_THROTTLED remaining=Xs" em stderr, tens de esperar
```

Se `jht-throttle-check` sair com 1, chama imediatamente:

```bash
jht-throttle-wait <teu-nome>
# Bloqueia (em blocos de 15s) ate until passar, depois sai.
```

Este e o caminho de recuperacao: um `jht-throttle` anterior cujo pai foi
terminado prematuramente pelo timeout do provider. O filho destacado
ainda esta a dormir, o ficheiro de estado ainda e valido, o check diz-te
"nao comeces uma tarefa ainda". O wait re-bloqueia-te em seguranca.

O loop seguro completo no teu role prompt:

```
loop:
    jht-throttle-check <me>          # gate
    if exit 1:
        jht-throttle-wait <me>       # re-bloquear
    do_task()
    jht-throttle --agent <me>        # pai bloqueia + filho destacado
```

## Regras

- **NUNCA** uses `sleep N` para pausas de throttle. Usa `jht-throttle` em vez disso.
  O simples `sleep` so e permitido para esperas muito curtas entre tentativas
  (≤ 5 s) onde o logging seria ruido.
- **DEVE correr em FOREGROUND, bloqueante.** `jht-throttle` e a pausa do
  teu loop — o seu proposito e impedir-te de fazer qualquer outra coisa
  ate retornar. Executa-o atraves da tua ferramenta de shell bloqueante normal (`Shell`
  / `Bash`), espera que saia, e so depois emite o proximo tool
  call. **NAO** o envolvas num `Task`/`TaskOutput`/`bash &`
  / `nohup` / `disown` em background e continues a trabalhar em paralelo — o pai
  bloqueia por ti de proposito. (O *filho* destacado corre em
  background; isso e um detalhe de implementacao interno do
  wrapper, nao algo que tu facas.)
- **Verifica SEMPRE antes da proxima tarefa.** Se o teu tool call retornou mais cedo
  do que os segundos da config (timeout do provider), chama `jht-throttle-check`
  primeiro. Nao adivinhes.
- Passa sempre `--agent <teu-nome>` (ex. `scout-1`, `capitano`,
  `analista-2`) — e a chave pela qual o dashboard agrupa E a chave que o
  Capitao escreve na config.
- `--reason` e opcional mas util: um tag curto como
  `"post-batch"`, `"cooldown after URG"`, `"waiting for analyst"`
  ajuda mais tarde ao reler os eventos.

## Exemplos

```bash
# Gate pre-tarefa (sempre antes de iniciar uma tarefa)
jht-throttle-check scout-1 || jht-throttle-wait scout-1

# Scout: pausa entre lotes, duracao definida pelo Capitao na config.
jht-throttle --agent scout-1 --reason "post-batch cooldown"

# Capitao: override explicito (raro, apenas para emergencias)
jht-throttle 60 --agent capitano --reason "between cycles"

# Escritor: pausa enquanto espera pelo Critico, orientada pela config
jht-throttle --agent scrittore-1 --reason "waiting critic review"
```

## Codigos de saida

- `0` — pausa realizada e registada, OU a config devolveu 0 (caminho rapido no-op)
- `1` — argumentos em falta ou invalidos

## Nota do Capitao

Para abrandar um agente, **edita a config**, nao envies um numero via
tmux:

```bash
# Agente individual
python3 /app/shared/skills/throttle-config.py set scout-1 60

# Multi-agente numa unica escrita atomica
python3 /app/shared/skills/throttle-config.py bulk-set scout-1=60 scrittore-1=120 analista-1=0

# Mostrar o estado atual
python3 /app/shared/skills/throttle-config.py dump
```

Usa tmux apenas para dizer aos agentes para chamarem a skill **com mais ou menos frequencia**
no seu loop, nao para ditar a duracao.
