---
name: team-pause
description: "PAUSE the team (or one agent) without shutting anything down, and resume it. Open it the moment the user says «take a break», «pause», «hold on», «stop for now», «wait until I tell you», «freeze» — or «resume», «carry on», «you can start again». A pause keeps every session ON with its context; nobody works and nothing new starts until the user says to resume. It is NOT the stop: shutting the team down (`jht team stop`, `.team-halted.flag`, killing sessions) throws every agent's context away and is only for an explicit «turn the team off»."
allowed-tools: Bash(python3 /app/shared/skills/agent_control.py *), Bash(python3 /app/shared/skills/standby.py status *), Bash(python3 /app/shared/skills/agent_pause.py status *)
---

# team-pause — uma pausa não é um desligamento

Em 05/11 o utilizador disse ao Assistente *«façam uma pausa, eu digo quando recomeçar»*. O Assistente pediu um «controlled freeze» ao Capitano; o Capitano, sem nenhuma skill para a pausa, escreveu o flag de paragem e **fechou todas as sessões** — cada agente perdeu o seu contexto — e ao utilizador foi dito *«Paused ✅»*. Esta skill existe para que isso não volte a acontecer: a pausa pedida pelo utilizador mantém as sessões ligadas e o contexto intacto, e **o que dizes ao utilizador é o que diz a resposta do comando**.

## 1. Que palavra significa o quê

| O utilizador diz (em qualquer língua) | Significa | O que fazes |
|---|---|---|
| «pausa», «parem», «esperem, eu digo quando recomeçar», «congelem», «todos quietos por agora» | **PAUSA** | §2 |
| «retomem», «continuem», «podem recomeçar», «vão» (depois de uma pausa) | **RETOMAR** | §4 |
| «põe o Scout em pausa» / «pára o Analista-1 um pouco» | **PAUSA de um agente** | §5 |
| «desliga a equipa», «desliguem tudo», «pára a equipa» *dito como desligamento* | **STOP** — não é esta skill | diz ao utilizador que fecha as sessões e faz cada agente perder o que tinha em mente; só o faças se confirmar que é isso que quer |
| ambíguo («pára», «pára tudo») | trata como **PAUSA** | pode ser desfeita e mantém o contexto; di-lo e oferece o desligamento se era isso que queria |

**Nunca** `jht team stop`, `.team-halted.flag`, `tmux kill-session` nem o «freeze» do Capitano para uma pausa: isso é a paragem.

## 2. Pôr a equipa em pausa

O **Assistente** executa o comando ele próprio (não peças ao Capitano que improvise um freeze):

```bash
python3 /app/shared/skills/agent_control.py pause --until-resumed --from-assistant
```

O **Capitano**, se a ordem lhe chegar (um `[REQ]` que diz pausa, ou o utilizador a escrever-lhe), executa a mesma linha **sem** `--from-assistant`. Volta uma linha JSON. Lê-a:

```json
{"ok": true, "op": "pause", "result": "paused",
 "detail": {"reached": ["CAPITANO","SCOUT-1", ...], "not_reached": ["SCORER-1"], "until_resumed": true}}
```

- `result: "paused"` — feito. `"already_paused"` — já estava; di-lo.
- `detail.reached` — as sessões que receberam a mensagem *«fecha o teu passo, anota onde estás, espera»*. `detail.not_reached` — sessões vivas que não responderam ao transporte: **diz ao utilizador quais**.
- `ok: false` / `error` — **não** aconteceu. Di-lo. Nunca «em pausa» depois de um erro.

As sessões ficam ligadas. Bridges e watchdogs calam-se sozinhos (sem heartbeat, sem ticks de pacing, sem refresh, sem nudges). O Assistente **não** está em pausa: continua contactável.

A pausa não tem hora de fim: acaba quando o utilizador o disser, com um **limite de 7 dias** depois do qual a equipa retoma sozinha (assim uma pausa esquecida não a silencia para sempre). Di-lo uma vez.

## 3. Enquanto a equipa está em pausa

- **Não** acordes o Capitano nem ninguém por pedidos, tickets ou respostas novas: diz ao utilizador que *serão tratados assim que retomar*. Um ticket fica aberto, nada se perde.
- **Não** inicies, pares, reinicies nem crias agentes. Não mexas nos throttles.
- Se perguntarem como estão as coisas: `python3 /app/shared/skills/standby.py status` (e, para um agente, `python3 /app/shared/skills/agent_pause.py status SCOUT-1`). As sessões estão ligadas; ninguém trabalha.
- O Capitano, se estiver acordado: fecha o passo, sem ordens novas, espera em silêncio.

## 4. Retomar

```bash
python3 /app/shared/skills/agent_control.py resume
```

`result: "resumed"` — cada sessão recebeu *«continua exatamente onde estavas»* e a automação voltou a estar ativa. `"not_paused"` — não havia pausa. `error: "team_halted"` — o utilizador tinha **parado** a equipa: retomar uma pausa não a liga; di-lo e oferece arrancá-la.

Um agente que o utilizador pôs em pausa **sozinho** (§5) não é acordado pela retoma da equipa: fica em pausa até ser retomado por si.

## 5. Um agente só

```bash
python3 /app/shared/skills/agent_control.py pause-agent SCOUT-1
python3 /app/shared/skills/agent_control.py resume-agent SCOUT-1
```

O resto da equipa continua a trabalhar. `error: "agent_not_running"` — essa sessão não está ligada; `"agent_contained"` — alguém a parou de propósito: di-lo, não a forces. Parar ou reiniciar um agente apaga a sua pausa.

## 6. O que dizes ao utilizador — só o que aconteceu

Depois da pausa (adapta as palavras, mantém os factos):

> A equipa está em pausa. Os N agentes continuam ligados e cada um tem presente o que estava a fazer; ninguém trabalha até me dizeres para retomar, e nada foi desligado. Fico aqui. (Se `not_reached`: «X não respondeu, não consegui avisá-lo.»)

Depois de retomar: *«Feito: cada um continua onde estava.»* Depois de um erro: *o que falhou* e em que estado está a equipa (`standby.py status`).

## Anti-padrões

- ❌ «Paused ✅» sem a resposta do comando. A palavra vem de `result`, os números de `detail`.
- ❌ Pedir ao Capitano que «aplique um controlled freeze» e dar a resposta dele como a pausa. O Capitano sem skill escreveu o flag de paragem.
- ❌ `jht team stop`, `.team-halted.flag`, `kill-session`, `freeze_team.py` (Esc a cada painel) para uma pausa.
- ❌ Acordar a equipa por um ticket durante uma pausa.
- ❌ Fazer do desligamento o comportamento por omissão de «pára tudo»: cada agente perde o contexto.

## Ver também

- `graceful-shutdown` — fechar o dia quando o utilizador sai da aplicação (outra coisa: os agentes são fechados).
- `throttle-distribution` — travar agentes ao ritmo do orçamento (uma pausa não é um throttle).
