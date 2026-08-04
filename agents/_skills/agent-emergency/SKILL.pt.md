<!-- @translation: pt, ai-translated 2026-07-30 -->
---
name: agent-emergency
description: "Capitano — trata um agente suspeito de estar PRESO NUM CICLO ATIVO (vivo e a gerar turnos, mas a repetir o mesmo ciclo sem produzir nada: ping-loop de ACK com um par, mesma ação/consulta que não leva a lado nenhum). Cobre a fenda entre C-08 (morto/silencioso → Dottore) e C-12 (a queimar com cadenza 0.00/min → kill). Escada graduada, Dottore-PRIMEIRO → kill + respawn limpo apenas se persistir ou queimar orçamento. Deteção determinística (diff de capture-pane + 0 progresso na DB), decisão de escalada deixada ao LLM."
allowed-tools: Bash(tmux *), Bash(jht-tmux-send *), Bash(/app/.launcher/spawn-doctor.sh *), Bash(bash /app/.launcher/start-agent.sh *), Bash(python3 /app/shared/skills/db_query.py *)
---

# agent-emergency — agente preso num ciclo ativo

## Porque existe (a fenda entre C-08 e C-12)

Os sinais existentes cobrem dois casos:
- **C-08** — um agente **morto / silencioso** (pane = bash, sem turnos) → diagnóstico do **Dottore**.
- **C-12** — um agente **a queimar com `cadenza 0.00/min`, zero checkpoints** → candidato a kill.

Falta o terceiro: **um agente que está VIVO e ATIVO e REPETE o mesmo ciclo sem produzir nada**. Gera
turnos (portanto NÃO está "morto" e NÃO tem `cadenza 0.00`), mas não progride. Exemplos reais:
- duas sessões a atirar **ACK** uma à outra para sempre (ping-loop de coordenação);
- um worker a repetir a **mesma consulta / mesma ação** sem efeito;
- um agente a reprocessar a mesma mensagem não entregue.

Antes isto era invisível → o Capitano nunca intervinha. Esta skill torna-o detetável e gerível.

## Quando usá-la

**Por SUSPEITA**, não de forma generalizada e não a cada tick. Inicia este procedimento quando notares
uma destas pistas (normalmente enquanto fazes outra coisa): um agente que está "a trabalhar" há algum
tempo mas cuja fila não encolhe / nenhuma posição nova muda de estado; ou vês a mesma troca a
repetir-se no chat/pane.

## 1. Deteção DETERMINÍSTICA (nada de olhómetro)

Confirma o ciclo com duas verificações baratas — **nenhuma mensagem ao agente** (não o incomodes,
isto é pull de Tier-2):

```bash
# (a) REPETIÇÃO — o pane mostra a mesma troca/saída N vezes?
#     Duas capturas espaçadas: se o conteúdo "novo" for idêntico → está a repetir-se.
tmux capture-pane -t <SESSION> -p -S -60 > /tmp/ae_1.txt
sleep 20
tmux capture-pane -t <SESSION> -p -S -60 > /tmp/ae_2.txt
diff /tmp/ae_1.txt /tmp/ae_2.txt        # pouca/nenhuma diferença de "trabalho real" = suspeita de ciclo

# (b) 0 PROGRESSO NA DB — o agente está "ativo" mas não mexe nada na DB?
#     Se disponível, o helper de observabilidade por agente (reutiliza
#     position_state_transitions): 0 transições recentes para este agente = sem saída.
python3 /app/shared/skills/db_query.py recent-activity   # by_agent: 0 para a sessão = sem saída
#     Fallback genérico: a fila a montante do agente NÃO encolhe entre duas verificações
#     (ex.: next-for-analista inalterado enquanto ANALISTA-N está "a trabalhar").
```

**Veredicto de CICLO** = (a) repetição **E** (b) 0 progresso, ao longo de ≥ 2-3 observações. Se, pelo
contrário, o pane mostrar `Working… / esc to interrupt` com conteúdo que continua a mudar, é uma
**tarefa longa que está VIVA** (C-08 bis): isso NÃO é um ciclo, deixa-a em paz.

## 2. Escada graduada — Dottore-PRIMEIRO

### Degrau 1 — ronda extraordinária do Dottore (PRIMEIRA intervenção)

Um refresh de contexto quebra muitas vezes o ciclo **sem perder estado**. Usa a skill `spawn-doctor`:

```bash
bash /app/.launcher/spawn-doctor.sh
sleep 10
jht-tmux-send DOTTORE \
  "[@$MY_ID -> @dottore] [REQ] Ronda direcionada: <SESSION> parece presa num CICLO ativo (repete <o quê>, 0 progresso na DB ao longo de N ticks). Diagnostica-a e, se confirmado, faz refresh/repara a sessão. Responde com [RES]."
# Espera pelo [RES] do Dottore — sem polling.
```

### Degrau 2 — Kill (+ respawn) — SÓ se necessário

Kill **só se**: o ciclo **persistir depois do Dottore**, *ou* estiver a **queimar orçamento a sério**
(taxa alta + 0 saída durante ≥ N ticks e não há tempo para um diagnóstico).

⚠️ **SALVAGUARDA contra o duplo spawn com o watchdog.** O `agent-watchdog.sh` faz respawn automático
(≤30s) **apenas dos 3 agentes core**: `ASSISTENTE`, `CAPITANO`, `MENTOR`. NÃO cobre os workers.
Portanto o respawn depende do alvo:

- **Alvo = agente CORE (ASSISTENTE / MENTOR)** → **APENAS kill**. O watchdog deteta-o e **faz respawn
  limpo sozinho** (`jht team start <role>`, idempotente, estado fresco). **NÃO** corras também tu o
  `start-agent.sh` → isso seria um duplo spawn (a race que foi reportada). O "backoff" é na prática o
  intervalo do watchdog (~30s). (O CAPITANO és tu: nunca é o alvo — não te matas a ti próprio.)
  ```bash
  tmux kill-session -t <SESSION>     # PARA aqui: o watchdog faz respawn limpo em 30s
  ```
- **Alvo = WORKER (Scout / Analista / Scorer / Scrittore / Critico)** → o watchdog NÃO os cobre, por
  isso **matas tu + backoff + respawn** (sem race):
  ```bash
  tmux kill-session -t <SESSION>
  sleep 5                                                 # backoff: não voltar logo a cair no ciclo
  bash /app/.launcher/start-agent.sh <role> <N>          # respawn LIMPO (estado fresco)
  ```

O backoff + o respawn com estado fresco impedem que recomece exatamente no mesmo ciclo; não fazer
respawn dos agentes core evita a race com o watchdog.

## Regras

- **Dottore PRIMEIRO, kill DEPOIS.** Nunca mates à primeira suspeita: uma tarefa longa legítima
  parece "presa" mas está viva (C-08 bis). O kill é o último recurso.
- **A deteção e o kill são determinísticos; a escalada é decisão tua (LLM).** Não fiques a olhar
  fixamente para os panes a cada tick: aplica este procedimento quando uma suspeita amadurecer.
- **Não incomodes o par para investigar.** As verificações são pull (capture-pane + DB), nenhuma
  mensagem ao agente suspeito (o que só acrescentaria mais um turno ao ciclo).
- **Nunca mates sessões de serviço `*-WORKER-*`** se não souberes o que são — verifica primeiro o
  papel.
