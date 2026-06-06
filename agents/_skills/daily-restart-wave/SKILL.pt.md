<!-- @translation: pt, ai-translated 2026-06-06 -->
---
name: daily-restart-wave
description: "Reinício em massa preventivo de cada agente da equipa uma vez a cada 24h para frescura de contexto. Pertence ao Dottore. Executa apenas dentro de uma janela diária estreita (padrão 03:00 UTC ± 30 min) e apenas se nenhuma onda disparou nas últimas 23h. Cada agente é eliminado + regenerado via a mesma sequência atómica do `liveness-check` Passo 3, ordenados tier 3 → tier 2 → tier 1 para que os workers ciclem primeiro e os coordenadores (Capitano/Sentinella/Mentor/Assistente) por último. Contexto: sessões Codex/Kimi de longa duração acumulam \"ruído\" — decisões antigas, factos desatualizados, drift do prompt — e tornam-se mensuravelmente menos lúcidas após horas. Evidência empírica do Case Study #1 (run Codex 2026-05-19/21): o reinício em massa manual restaurou a qualidade de decisão. Esta skill fecha essa lacuna sem intervenção manual."
allowed-tools: Bash(tmux *), Bash(jht-tmux-send *), Bash(bash /app/.launcher/start-agent.sh *), Bash(python3 /app/shared/skills/db_query.py *), Bash(sleep *), Bash(cat *), Bash(mkdir *), Bash(date *)
---

# daily-restart-wave — reinício preventivo para frescura de contexto

O trabalho normal do Dottore (`liveness-check`) é **conservador**: reiniciar apenas os silenciosamente mortos. Esta skill é o oposto: **reiniciar todos, de propósito, uma vez por dia**, porque sessões de agentes de longa duração desviam-se mesmo quando não morrem. Mesma primitiva de respawn atómico (`liveness-check` Passo 3), trigger diferente e ordenação diferente.

## Porquê isto existe

Empírico: no Case Study #1 (run Codex 2026-05-19/21, ver `docs/about/RESULTS.md`) o mantenedor notou degradação na qualidade de decisão após ~12-24h de uptime contínuo dos agentes — erros repetidos, referências a factos desatualizados, ignorar ocasionalmente ordens explícitas do utilizador. Uma instrução manual "reiniciar todos" na hora ~30 restaurou visivelmente a nitidez. O Codex não mostra uma janela de contexto como o Claude/Kimi, por isso o drift é invisível até comparar antes/depois.

Teórico: cada sessão LLM é uma conversa longa. À medida que os tokens acumulam, o modelo:
- Ancora-se em decisões iniciais que podem ter estado erradas
- Raciocina sobre factos desatualizados (uma vaga que fechou, uma estratégia que foi revista)
- Torna-se mais lento por turno (mais KV-cache para atender)
- Desvia-se do seu system prompt sob pressão do utilizador ("o sweep das regras de equipa")

Um boot fresco relê o prompt + estado recente do DB + snapshots de handoff e decide a partir de terreno limpo. Custo: ~2 min/agente de "estou a pôr-me a par". Benefício: horas de output de baixa qualidade evitado.

## Quando disparar — as 3 condições de porta

TODAS AS TRÊS devem ser verdadeiras. Pular com `status=skipped` e um campo `reason` no log caso contrário.

1. **Dentro da janela diária**. Padrão: 03:00 UTC ± 30 min (i.e. 02:30–03:30 UTC). Justificação: janela de baixa atividade real do utilizador para utilizadores diurnos Europeus/US; se o utilizador está a dormir, o desfile de ~10 min de reinício é invisível. Ler a hora atual:

   ```bash
   now_h=$(date -u +%H)
   now_m=$(date -u +%M)
   # 02:30 ≤ now ≤ 03:30
   in_window=$([ "$now_h" = "02" -a "$now_m" -ge "30" ] || [ "$now_h" = "03" -a "$now_m" -le "30" ] && echo yes || echo no)
   ```

2. **Nenhuma onda disparou nas últimas 23h** (anti-thrash). Ler `/jht_home/logs/daily-restart-wave-state.json`:

   ```json
   { "last_wave_at": "2026-05-30T03:11:42Z", "agents_restarted": 9, "duration_sec": 612 }
   ```

   Se o ficheiro não existir → tratar como "nunca disparou" → condição é verdadeira.
   Se `now - last_wave_at < 23h` → pular com `reason=anti_thrash`.

3. **A equipa não está em `.team-halted.flag` ou `.weekly-halt.flag`**. Se qualquer flag existir, o utilizador pausou explicitamente a equipa — reiniciar agora seria hostil.

   ```bash
   [ -f /jht_home/.jht/.team-halted.flag ] && skip
   [ -f /jht_home/.jht/.weekly-halt.flag ] && skip
   ```

Se todas as 3 passarem → prosseguir. Todo o bloco de 3 verificações é `<2s`, executa a cada despertar do Dottore, não custa nada quando fora da janela.

## Ordem de reinício — tier 3 → tier 2 → tier 1

Inverso do `liveness-check` (que verifica user-facing PRIMEIRO para que não morram sem serem notados). Para uma onda preventiva queremos o oposto: **workers primeiro, coordenadores por último**, para que o Capitano seja o último a perder o fio e possa observar (no seu painel) que todos os seus workers voltaram frescos, depois ele próprio é reciclado e começa o novo dia com uma slate limpa.

```
TIER 3 (workers, reiniciar PRIMEIRO):
  SCOUT-*, SCRITTORE-*, CRITICO-*, ANALISTA-*, SCORER-*

TIER 2 (semi-coordenadores):
  (nenhum hoje — reservado para futuros "coordenadores subordinados")

TIER 1 (user-facing de longa duração, reiniciar POR ÚLTIMO):
  ASSISTENTE, MENTOR, SENTINELLA, CAPITANO   (Capitano último dos últimos)
```

Sessões vazias do tier 3 (ex. `SCRITTORE-*` quando nenhum CV está em voo conforme Writer-on-demand V6) → pular silenciosamente, sem kill, sem respawn. O próximo spawn-on-demand do Capitano será fresco de qualquer forma.

## Notificação ao Capitano — 10 minutos antes

O Capitano coordena spawn/scaling. Se está prestes a spawnar um burst de Scrittori e nós o eliminamos 30s depois, o spawn morre a meio. Portanto:

1. **Em t=0 da onda** (decisão de disparar tomada), ANTES de tocar em qualquer agente, envie ao Capitano um aviso via `tmux-send`:

   ```
   [HEADS-UP DOTTORE → CAPITANO] Daily restart wave parte fra 10 min.
   Non spawnare nuovi worker fino a NEW DAY. Termina task <5min in corso.
   Quando arriva il tuo turno (ultimo), ti riavvio io.
   ```

2. **Sleep 10 min**. Dar tempo ao Capitano para drenar estado de curta duração.

3. **Depois iniciar o desfile** na ordem tier 3 → tier 1.

Se o Capitano já for um zombie (bash puro), pular o aviso e ir diretamente ao desfile — não há nada para coordenar.

## A primitiva de respawn — reutilizar Passo 3 do liveness-check

Para cada sessão alvo, independentemente do estado de liveness:

```
a. tmux capture-pane -t <SESSION> -S -200 -p > /tmp/$session-pre-restart.log
b. python3 /app/shared/skills/db_query.py <agent-role> --recent-context   (opcional)
c. tmux kill-session -t <SESSION>
d. bash /app/.launcher/start-agent.sh <agent-role> [<instance-num>]
e. sleep 8s   (deixar o CLI arrancar)
f. tmux send-keys -t <SESSION> "RESUME: daily restart wave. Riprendi dai recenti log DB (db-query) + tuo prompt di identità. Nessuna task short-lived persa: il Capitano ha dranato la coda 10 min fa." Enter
g. log event=agent_restarted, agent=<role-N>, duration_ms=<X>
```

Notas:
- A captura do painel vai para `/tmp/` para que a nova instância possa lê-la se quiser inspecionar "o que estava a fazer".
- NÃO escrevemos `~/.jht/<agent>-pre-respawn-snapshot.txt` aqui (isso é um handoff estruturado pedido no follow-up do BACKLOG mas requer que o prompt de cada agente saiba como escrever+ler — fora de escopo para MVP, rastreado separadamente).
- A mensagem `RESUME:` de kick-off é genérica; diz ao agente para olhar para as suas próprias pistas no DB em vez de depender de um snapshot interno.

## Pacing entre reinícios

Esperar **15-20s entre agentes** do mesmo tier. Porquê:
- Chamadas `start-agent.sh` em rápida sucessão podem correr em race nas escritas partilhadas de `~/.jht/.local/` (RULE-T13 magazzino python).
- Dá ao CLI de cada novo agente ~10s para assentar (handshake, listagem de ferramentas, eval do system prompt) antes do próximo inundar o servidor tmux.

Tempo total para uma equipa saudável (8-10 sessões):
- 1 min aviso + 10 min sleep do Capitano
- 7 agentes tier-3 × ~20s = ~2.5 min (a maioria ausentes em regime estável)
- 4 agentes tier-1 × ~30s (prompts mais pesados) = ~2 min
- **Orçamento total: ~15 min**, confortavelmente abaixo dos 30 min pior caso que o Dottore poderia estar vivo para a onda.

## Logging no final da onda

Anexar a `/jht_home/logs/dottore-actions.jsonl`:

```json
{"ts":"2026-05-31T03:08:11Z","event":"daily_restart_wave_done","agents_restarted":9,"agents_skipped_empty":3,"duration_sec":612,"capitano_ack":"yes"}
```

Atualizar ficheiro de estado `/jht_home/logs/daily-restart-wave-state.json`:

```json
{ "last_wave_at": "2026-05-31T03:08:11Z", "agents_restarted": 9, "duration_sec": 612 }
```

Notificar o Capitano (agora fresco) uma linha:

```
[DA DOTTORE A CAPITANO] Daily restart wave completed at 03:08 UTC.
9 agents restarted, 0 errors. Team back online — riprendi la pipeline.
```

## Modos de falha — o que fazer

| Falha | Ação |
|---|---|
| `start-agent.sh` exit ≠ 0 para algum agente | Log `event=agent_restart_failed`, pular para o próximo, NÃO abortar a onda. A próxima ronda rotineira `liveness-check` notará a ausência e tentará de novo. |
| Servidor `tmux` sem resposta (raro) | Abortar onda, log `event=tmux_dead`, NÃO atualizar `last_wave_at` (para que o próximo Dottore tente de novo). |
| Onda abortada a meio (orçamento de timeout do Dottore 10 min) | Log `event=daily_restart_wave_partial`, NÃO atualizar `last_wave_at`. O próximo Dottore dentro da janela retomará (re-check anti-thrash falhará até 23h, mas é a mesma onda — aceitar o raro double-tap). |
| Capitano nunca ACK o aviso | Esperar os 10 min de qualquer forma. Se estiver silencioso em t=10 o desfile elimina-o também — o novo Capitano arrancará limpo. |

## O que esta skill NÃO faz

- ❌ **Reinício sob demanda** fora da janela diária. Se o utilizador quer "reiniciar todos agora", envia mensagem ao Assistente / Capitano, e um deles chama `spawn-agent` por alvo ou pede ao Dottore para pular a porta (um futuro parâmetro explícito, não no MVP).
- ❌ **Snapshot da tarefa em voo** de cada agente. Hoje o respawn depende do agente reler DB + capture-pane em `/tmp/`. Um handoff adequado (cada agente escreve "o que estava a fazer + próximo passo" antes de sair) precisa de alterações de prompt em todos os 10 agentes — rastreado como follow-up BACKLOG separado.
- ❌ **Ler `~/.jht/preferences.json`** para ajuste por utilizador de hora/janela. MVP hardcoda 03:00 UTC ± 30 min, 23h anti-thrash. Se o utilizador corre num fuso não-UE e quer uma janela diferente, edita este ficheiro de skill (ou espera pelo hook preferences.json follow-up).
- ❌ **Sobrepor `.team-halted.flag`**. Se o utilizador parou a equipa, sem onda. Ponto final.
