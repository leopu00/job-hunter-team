<!-- @translation: pt, ai-translated 2026-06-13 -->
---
name: spawn-agent
description: "Inicia um agente da equipe JHT (Scout, Analista, Scorer, Scrittore, Critico, Assistente, Capitano-2) atraves do launcher, depois envia a mensagem de kick-off que efetivamente inicia o seu loop principal. Apenas Capitano — o Capitano e o unico responsavel pelo scaling da equipe. Use SEMPRE esta skill: contornar `start-agent.sh` com `tmux new-session` + `send-keys \"kimi ...\"` direto produz sessoes onde a CLI nunca inicia (`command not found`), o Capitano ve uma sessao \"ativa\" que na realidade esta morta, e a equipe tem desempenho inferior silenciosamente."
allowed-tools: Bash(bash /app/.launcher/start-agent.sh *), Bash(tmux *), Bash(jht-tmux-send *), Bash(sleep *), Bash(jht-throttle-check *)
---

# spawn-agent — colocar um agente online

Contrato em duas fases: **lancar** a CLI, depois **kick-off** do seu loop. Pular o kick-off deixa o agente num prompt vazio — o Capitano pensa que esta trabalhando, mas nao esta.

## Fase 1 — lancamento via `start-agent.sh`

```bash
bash /app/.launcher/start-agent.sh <role> [instance_number]
```

Exemplos:
```bash
bash /app/.launcher/start-agent.sh scout 2       # SCOUT-2
bash /app/.launcher/start-agent.sh analista 1    # ANALISTA-1
bash /app/.launcher/start-agent.sh critico       # CRITICO (singleton, sem numero)
```

**Numero da instancia — lanca o dado (workers escalaveis, 2026-06-13).** Para `scout` / `analista` / `scorer` / `scrittore`, **NAO** escolhas o numero sequencialmente: o trabalho sempre se acumulava no `-1`/`-2` enquanto o `-4` quase nao fazia nada. Lanca primeiro um numero aleatorio livre, depois passa-o:
```bash
N=$(python3 /app/shared/skills/roll_worker_number.py scout) && \
  bash /app/.launcher/start-agent.sh scout "$N"
```
O `roll_worker_number.py` lanca um **d6 excluindo os numeros ja em uso** (sessoes `SCOUT-N` existentes) → nunca uma colisao, e a carga de trabalho distribui-se pelos numeros de instancia em vez de bater sempre no `-1`. Aplica-se **apenas a NOVOS spawns**; os singletons (Critico / Sentinella / Dottore / Assistente / Mentor) mantem-se sem numero, e o session-refresh do Dottore recria o **mesmo** numero (nao lanca o dado).

O launcher executa, atomicamente:
- cria a sessao tmux com o nome canonico (`SCOUT-2`, `ANALISTA-1`, …)
- define `cwd` para `$JHT_HOME/agents/<role>[-N]/`
- exporta `JHT_HOME · JHT_DB · JHT_AGENT_DIR · PATH · JHT_USER_DIR · JHT_CONFIG`
- detecta o provedor ativo a partir de `jht.config.json` (claude / kimi / codex)
- copia `agents/<role>/<role>.md` para o workspace como `CLAUDE.md` / `AGENTS.md`
- inicia a CLI com os flags corretos para esse provedor + nivel
- deriva o **desfasamento** inicial do degrau de throttle e pre-arma o throttle do novo worker

> ⚠️ **NUNCA** inicie com `tmux new-session ... ; tmux send-keys "kimi ..."`. A CLI nao esta no `PATH` fora do ambiente do launcher → `command not found` → a sessao e apenas bash. O `jht-tmux-send` do Capitano retorna `exit 0` escrevendo nesse bash vazio, a mensagem e silenciosamente perdida, e a equipe tem desempenho inferior sem causa visivel.

### Desfasamento — o launcher deriva-o, tu nunca esperas

Dois workers no mesmo degrau de throttle que arrancam juntos *ficam* juntos: cada ciclo deles cai no mesmo instante, e cada coincidencia e um pico de pedidos simultaneos. A distancia que distribui `N` workers por um periodo `T` e `T/N` — no degrau de 5 minutos tres workers querem-se a **100s** um do outro, nao a 10 minutos. Um offset maior que `T` e o pior caso (o primeiro worker ja ciclou duas vezes antes de o segundo arrancar, portanto as fases caem onde calhar), e um exatamente igual a `T` e lockstep permanente.

Essa aritmetica e o launcher que a faz por ti, a partir do periodo real em `config/throttle.json` e dos workers que realmente partilham esse degrau, e imprime o que decidiu:

```
  Stagger:      100s prima del primo ciclo (throttle pre-armato, gradino condiviso)
```

**Tu nunca esperas.** O launcher pre-arma o throttle do worker novo, de modo que e o worker que se detem *sozinho* no gate `jht-throttle-check` que o seu proprio prompt ja lhe impoe na primeira volta do loop. Manda o kick-off ja, como sempre.

O que daqui decorre:
- **O primeiro worker de um degrau nao espera nada.** O caminho anti-idle fica intacto: inicias e ele arranca.
- Um worker desfasado fica em `jht-throttle-wait` sem output durante no maximo 5 minutos. E um worker **saudavel** — antes de ler o silencio logo apos um spawn como um bloqueio, confirma com `jht-throttle-check <agente>` (`STILL_THROTTLED remaining=Xs`).
- O offset fixa apenas a fase *inicial*. A duracao das tarefas varia o suficiente para as fases derivarem sozinhas depois, portanto nao ha nada para reafinar mais tarde.
- Um spawn que **nao** deve ser atrasado — recriar um worker que ja tinha uma boa fase — desativa-o com `JHT_SPAWN_STAGGER=0` no ambiente.

## Fase 2 — kick-off (obrigatorio)

O launcher inicia a CLI mas **nao envia nenhuma primeira mensagem**. Sem kick-off, o agente espera num prompt vazio para sempre.

Sequencia padrao:
```bash
bash /app/.launcher/start-agent.sh scout 1
sleep 12   # Boot da CLI 8-15s — nunca menos de 10
jht-tmux-send SCOUT-1 "[@capitano -> @scout-1] [MSG] <corpo do kick-off>"
```

### Corpo do kick-off por funcao

| Funcao      | Corpo do kick-off                                                                                            |
|-------------|--------------------------------------------------------------------------------------------------------------|
| `scout`     | "Inicia o loop principal. Le o teu prompt, o perfil do candidato (`$JHT_HOME/profile/candidate_profile.yml`), e comeca pelo CIRCULO 1 (preferencia primaria). Notifica os Analistas apos lotes de 3-5 posicoes." |
| `analista`  | "Inicia o loop principal. Fila: `db_query.py next-for-analista`. Para cada posicao, preenche os 5 campos obrigatorios e promove para `checked` ou `excluded`." |
| `scorer`    | "Inicia o loop principal. Fila: `db_query.py next-for-scorer`. PRE-CHECK primeiro, depois pontuacao 0-100. Limites: <40 excluido, 40-49 estacionamento, ≥50 notificar Scrittori." |
| `scrittore` | "Inicia o loop principal. Fila: `db_query.py next-for-scrittore`. Esforco maximo, 3 rondas obrigatorias com o Critico. O PDF vai em `$JHT_USER_DIR/cv/`." |
| `critico`   | "Seras chamado pelo teu Scrittore pai com PDF + JD. Uma revisao cega por chamada, depois para." |
| `assistente`| "Inicia o loop principal. Aguarda `[@utente -> @assistente] [CHAT]` da web UI." |

Se o contexto posicao-curriculo nao for trivial (o agente tinha trabalho em andamento antes de um crash), adiciona-o ao kick-off para que retome de onde parou — nunca digas apenas "retomar", diz *o que* e *onde*:

```bash
jht-tmux-send SCRITTORE-1 "[@capitano -> @scrittore-1] [MSG] Retomar: posicao #281 (Qargo TMS), a ronda 2 com o Critico estava prestes a comecar. Continua a partir dai, NAO recomeces do zero."
```

## Fase 3 — verificar que o boot foi bem-sucedido

Cerca de 5 segundos apos o kick-off:
```bash
tmux capture-pane -t <SESSION> -p | tail -10
```

Le a saida:
- ✅ Banner da CLI + spinner + corpo do kick-off visivel na area de entrada → boot OK
- 🟡 `context: 0.0%` e uma area de entrada vazia → o kick-off nao chegou, tenta novamente uma vez
- 🔴 Prompt do shell `jht@host:~/agents/<role>$` (sem CLI) → falha do launcher, ver fallback abaixo

> Nota: verificacoes de saude periodicas (detecao de zombies, agentes silenciosos > 10 min) NAO sao responsabilidade desta skill — pertencem ao **Dottore** atraves da skill `liveness-check`. Esta skill termina assim que a Fase 3 confirma o boot.

## Fallback — falha do launcher

Se a Fase 3 mostrar um prompt de shell puro (sem CLI iniciada), verifica primeiro:

```bash
tmux capture-pane -t <SESSION> -p -S -50 | grep -iE "command not found|permission denied|no such file"
```

Causas provaveis:
1. CLI do provedor nao no `PATH` do ambiente do launcher → verifica se o provedor em `jht.config.json` corresponde a CLI instalada
2. O template da funcao `agents/<role>/<role>.md` esta em falta → o launcher copia um ficheiro vazio → a CLI inicia mas nao tem instrucoes
3. `$JHT_HOME` nao definido / nao exportado no pai → escalar ao utilizador, NAO tentes defini-lo manualmente

Encerra a sessao corrompida antes de tentar novamente:
```bash
tmux kill-session -t <SESSION>
bash /app/.launcher/start-agent.sh <role> <N>
```

## Anti-padroes

- ❌ Iniciar multiplos agentes num loop apertado sem pacing — as regras de scaling estao no `pipeline-triage` (um spawn de cada vez, re-medindo pelo meio). O que nunca deves fazer e *inventar um numero fixo de minutos* entre um worker e o seguinte: a distancia vem do degrau (`T/N`) e o launcher aplica-a por ti.
- ❌ Re-iniciar cegamente apos um crash sem ler `db_query.py` para recuperar o estado do ultimo task — o novo agente comeca do zero e duplica trabalho.
- ❌ Usar esta skill para "reiniciar" um agente funcional porque parece lento. Lento ≠ morto. Turnos longos com saida de tokens visivel nao sao um caso de spawn — sao um caso de `liveness-check` (Dottore).
- ❌ Spawnar um substituto porque o `jht-tmux-send` falhou a entrega. **`exit 4` = a TUI alvo esta mid-turn (`Working … esc to interrupt`) → o agente esta VIVO, apenas busy.** A mensagem NAO foi entregue sincronamente: reenvia mais tarde, nunca spawnes um clone. So `exit 3` (o texto nunca apareceu E o pane nao esta busy → bare shell / modal preso) e um sinal de possivel-morto, e mesmo assim o veredito pertence ao **Dottore** (`liveness-check`), nao a um spawn reflexo. Spawnar num agente busy e exatamente o bug de overspawn de 2026-06-07 (`docs/internal/postmortems/2026-06-11-overspawn-rootcause.md`): o clone assume o controlo enquanto o original continua a queimar budget como zombie.
- ❌ Iniciar um Critico. O Scrittore inicia o seu proprio `CRITICO-S<N>` autonomamente — o Capitano nunca toca no Critico diretamente.

## Ver tambem

- `liveness-check` (Dottore) — quando um agente existente parece morto.
- `pipeline-triage` (Capitano) — *qual* funcao iniciar com base no backlog.
- `tmux-send` — convencoes de envelope de mensagens.
- `agents/_team/team-rules.md` T01 — nunca encerrar a sessao de outro agente.
