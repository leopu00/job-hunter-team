<!-- @translation: pt, ai-translated 2026-06-06 -->
---
name: tmux-send
description: Entrega uma mensagem a sessao tmux de outro agente de forma atomica. Use SEMPRE este skill para comunicar com SCOUT/ANALISTA/SCORER/SCRITTORE/CRITICO/SENTINELLA/CAPITANO. NUNCA chame `tmux send-keys` manualmente — TUIs baseadas em Ink (Codex, Kimi) perdem o caractere Enter.
allowed-tools: Bash(jht-tmux-send *)
---

# tmux-send — mensagens inter-agente

Wrapper shell localizado em `/app/agents/_skills/tmux-send/jht-tmux-send` (tambem no `PATH` via symlink em `/usr/local/bin`, criado durante o build da imagem).

## Por que existe

TUIs baseadas em Ink (Codex, Kimi Code) **perdem o Enter** se este chegar na mesma chamada `tmux send-keys` junto com o corpo da mensagem. O texto e enviado caractere por caractere; o Ink precisa terminar a renderizacao antes de aceitar outra tecla. Se voce chamar `tmux send-keys "msg" Enter`, a mensagem fica no buffer de entrada do peer sem ser enviada → deadlock silencioso entre agentes.

O wrapper trata isso atomicamente: digita o texto, **rele o painel para confirmar que apareceu**, envia Enter, e **rele o painel novamente para confirmar que o turno realmente arrancou**. A entrega nao e "ter escrito": e "ter visto o turno arrancar".

> ⚠️ Existe um segundo estado, mais insidioso: a TUI **aceita o texto e ignora o Enter**, deixando a linha pendurada no composer enquanto o agente fica parado durante horas. Visto 4 vezes em 3 dias numa unica VPS, Capitao incluido, quando uma mensagem chega enquanto o peer esta a fechar um turno longo. O wrapper agora repete o Enter e, se o turno continuar sem arrancar, devolve **`5`** em vez de declarar falsamente sucesso.

## Uso

```bash
jht-tmux-send <SESSION> "<message>"
```

## Exemplos (V5)

```bash
# Captain → Scout (INFO, mensagem operacional generica)
jht-tmux-send SCOUT-1 "[@capitano -> @scout-1] [INFO] Start the main loop. Begin from CIRCLE 1 (Remote EU); ping after each batch of 3-5 positions."

# Captain → Writer (URG, ordem em tempo real)
jht-tmux-send SCRITTORE-1 "[@capitano -> @scrittore-1] [URG] FREEZE — finish the current Critic round, then sleep until throttle returns to T0/T1."

# Analyst → Scout (FEEDBACK, coaching sobre padroes de rejeicao)
jht-tmux-send SCOUT-2 "[@analista-1 -> @scout-2] [FEEDBACK] [SENIORITY] 4 of last 5 inserts from greenhouse.io require senior+ — switch source or query for the next batch."

# Sentinel → Captain (URG, mudanca de estado)
jht-tmux-send CAPITANO "[@sentinella -> @capitano] [URG] Usage 94%, projection 102% — recommend throttle T2 + freeze Writers."

# Writer → Captain (REPORT, resultado final)
jht-tmux-send CAPITANO "[@scrittore-1 -> @capitano] [REPORT] Position 42 — verdict PASS, score 7.5/10. PDF: /jht_user/.../CV.pdf"

# Worker → Captain (ACK, confirmacao de URG)
jht-tmux-send CAPITANO "[@scrittore-1 -> @capitano] [ACK] freeze applied, sleeping."
```

## Envelope da mensagem

Mantenha sempre o prefixo estruturado:

```
[@<from> -> @<to>] [<TYPE>] <text>
```

Tipos padrao (veja `agents/_manual/communication-rules.md` para a taxonomia completa e expectativas por funcao):

- `BLOCKED` — worker → Capitano: **PARASTE de produzir** e não deixa rasto na DB (ferramenta partida, `403`/`LOCKED`, fontes secas, um item que não consegues nem trabalhar nem saltar). Desde 2026-07-27 é a ÚNICA coisa que distingue um stall do trabalho silencioso
- `URG` — ordem em tempo real que requer acao imediata (FREEZE, throttle, kill)
- `FEEDBACK` — coaching ao agente anterior com uma tag de rejeicao (`[SENIORITY] · [STACK] · [GEO] · [LINGUA]`)
- `REQ` / `RES` — requisicao/resposta sincrona entre agentes
- `ACK` — confirmacao de recebimento de um `URG` ou `REQ` que ainda nao pode atender
- ~~`INFO` / `REPORT`~~ — **retirados para o tráfego entre colegas** (2026-07-27): eram 8 das 30 mensagens de puro estado que acordavam o Capitano em ~1,5h. O progresso puxa-se de `db_query.py recent-activity`, não se narra

> 💬 `[CHAT]` e reservado para mensagens **usuario → agente** a partir da web UI (veja o protocolo no prompt do Capitao). Nao o use para trafego inter-agente.

## Codigos de saida

- `0` — mensagem entregue **e submetida** (verificado: o turno arrancou)
- `1` — argumentos ausentes
- `2` — sessao de destino nao existe (verifique o nome com `tmux ls`)
- `3` — texto nunca apareceu e o painel nao esta ocupado → TUI nao receptiva. **O unico codigo que sugere morta/encravada.**
- `4` — peer ocupado num turno longo alem do orcamento de espera → **vivo**. Tente mais tarde, nunca respawnar.
- `5` — texto aceite mas nunca submetido ("vivo mas mudo") → **vivo**. Tente mais tarde, nunca respawnar.

> So `3` pode levar a um liveness-check e a um respawn. `4` e `5` significam ambos que o peer esta vivo: trata-los como morte e exatamente como comecam os over-spawn.

## Regras

- **NUNCA** use `tmux send-keys` diretamente para comunicar com outro agente. Passe sempre por `jht-tmux-send`.
- **NUNCA** encerre a sessao tmux de outro agente (regra #0 do Capitao).
- Se `tmux ls` mostrar que a sessao de destino nao existe, **nao a crie** — pergunte ao Capitao (ou use `start-agent.sh` se voce *for* o Capitao).
- Por padrao, use a **coordenacao via DB** para as transferencias de pipeline (Scout→Analyst→Scorer→Writer); use este skill apenas para os sinais em tempo real listados acima. Veja `agents/_manual/communication-rules.md`.
