<!-- @translation: pt, ai-translated 2026-06-06 -->
---
name: liveness-check
description: "Diagnosticar se a sessão tmux de um agente da equipa está viva, num turno longo, ou silenciosamente morta — e regenerá-la preservando contexto se morta. Pertence ao Dottore (o agente de health-check itinerante da equipa), não ao Capitano. O modo de falha principal que esta skill apanha: `jht-tmux-send` retorna `exit 0` mesmo quando o CLI do alvo crashou (a mensagem é escrita numa bash pura, depois perdida). Sem verificações periódicas de liveness a equipa continua a \"falar com um cadáver\" e o Capitano conta com ações que nunca acontecerão."
allowed-tools: Bash(tmux *), Bash(jht-tmux-send *), Bash(bash /app/.launcher/start-agent.sh *), Bash(python3 /app/shared/skills/db_query.py *), Bash(sleep *)
---

# liveness-check — manter a equipa honesta

Uma sessão tmux pode sobreviver ao seu CLI. Quando o TUI Codex / Kimi crasha, o tmux recua para um prompt bash puro; mensagens continuam a ser escritas nele (`exit 0` de `jht-tmux-send`), ninguém as lê, o agente é um zombie. Esta skill deteta o estado e recupera.

## Quando executar uma verificação

- 👨‍⚕️ **Ronda rotineira** — a cada despertar do Dottore (~30 min) percorre cada sessão da equipa em sequência (ver `agents/dottore/dottore.md` para o ciclo de vida one-shot completo).
- 🚨 **Handoff do Capitano** — quando o Capitano reporta um agente silencioso > 10 min enquanto deveria estar a trabalhar (sem REPORT do Scout, sem ACK do Scrittore ao Critico).
- 🔁 **Pós-URG** — 10-30s após um `[URG]` / `[MSG]` do Capitano para confirmar ACK + o CLI ainda estar vivo.
- ⚖️ **Pré-scaling** — antes de um spawn/kill que depende do estado de um agente existente (não spawnar o Analista se o Scout do qual depende está morto).

## Ordem de prioridade — user-facing PRIMEIRO

Antes de qualquer caminhada, ordenar os alvos para que os agentes user-facing
de longa duração sejam verificados primeiro. Estão no topo da cadeia — se morrerem,
**ninguém os regenera** (o Capitano spawna workers, não a si próprio /
o Assistente / o Mentor / a Sentinella). O post-mortem da
noite zombie de 2026-05-18 teve 6-8h de Capitano morto porque os Dottores
caminharam os workers primeiro, nunca chegaram ao Capitano, e auto-destruíram-se.

```
PRIORIDADE 1 (verificar sempre primeiro):
  ASSISTENTE, CAPITANO, MENTOR, SENTINELLA
PRIORIDADE 2 (workers, o Capitano pode regenerá-los):
  SCOUT-N, SCRITTORE-N, CRITICO-S*, ANALISTA-N, SCORER-N
```

Se tiver apenas 10 min de orçamento para a ronda, **sempre terminar a PRIORIDADE 1
antes de tocar na PRIORIDADE 2**. Um worker morto 30 min é recuperável; um
Capitano morto 30 min significa que todo o pipeline está silencioso.

## Passo 0 — `pane_current_command` (pré-verificação barata)

Antes do capture-pane, fazer a verificação barata:

```bash
cmd=$(tmux list-panes -t <SESSION> -F '#{pane_current_command}' | head -1)
```

Se `$cmd` não for `Kimi` / `kimi` / `claude` / `codex` / `node` / `python*`
→ o CLI do LLM está **já morto**, o painel é bash residual.
Pular o ping (seria perdido na bash e `jht-tmux-send` retornaria
`exit 0` enganadoramente), ir diretamente ao Passo 3 RESPAWN.

Esta única verificação teria apanhado o Capitano zombie de 2026-05-18 —
painel era bash (PID 663, `/proc/663/exe → /usr/bin/bash`) com kimi
crashado. `tmux has-session` retornou True, mentindo ao watchdog durante
11 horas.

## Passo 1 — capturar, não confiar

Sempre ler o painel primeiro; não agir às cegas:

```bash
tmux capture-pane -t <SESSION> -p -S -200
```

O scroll-back de 200 linhas dá contexto suficiente para (a) julgar estado, (b) reconstruir o que o agente estava a fazer para o kick-off de retoma se tiver de ser regenerado.

## Passo 2 — tabela de diagnóstico

Comparar as **últimas 20 linhas** com:

| Padrão em `tmux capture-pane -t <SESSION> -p \| tail -20`           | Diagnóstico          | Ação                |
|----------------------------------------------------------------------|---------------------|---------------------|
| Resposta concreta a um ping recente (ex. "writing CV on #281")       | ✅ vivo, a trabalhar | log `status=alive`, próximo agente |
| `Working...` há > 5 min no mesmo turno, mas output de tokens visível | 🟡 turno longo       | log `status=long_turn`, NÃO regenerar |
| Painel inalterado desde antes do ping                                | 🔴 estagnado / inerte | RESPAWN (Passo 3)  |
| Spinner `Whirlpooling...` > 10 min, zero output                     | 🔴 estagnação silenciosa | RESPAWN          |
| Última linha = `jht@<host>:~/agents/<role>$` (prompt shell puro)     | 💀 CLI saiu          | RESPAWN             |
| `Permission denied: …/.kimi/sessions/.../context.jsonl`              | 💀 kimi crashou em IO de contexto | RESPAWN |
| `Run kimi export and send the exported data to support`              | 💀 banner de crash kimi | RESPAWN          |
| `To resume this session: kimi -r <id>`                               | 💀 sessão órfã       | RESPAWN             |
| `Killed by timeout (60s)` (Kimi)                                     | 🟡 chamada de tool eliminada, CLI vivo | NÃO é caso de respawn — o agente esqueceu de passar `timeout: N+30` na sua chamada de ferramenta shell (ver `agents/_skills/throttle/DESIGN-NOTES.md`). Diagnosticar com `jht-throttle-check <agent>`. |
| `command not found` para `kimi` / `claude` / `codex`                 | 💀 launcher contornado | RESPAWN           |
| Painel parado > 5 min, sem spinner, sem input                        | 🟡 idle ambíguo      | captura estendida (`-S -100`) para contexto completo |

Se incerto: **não regenerar**. Log `status=ambiguous`. Um falso positivo (respawn desnecessário) custa 1-2 min de reboot + contexto perdido. Um falso negativo (zombie perdido) custa no máximo 30 min até a próxima ronda do Dottore.

## Passo 3 — respawn com contexto (apenas em 🔴 / 💀)

Sequência atómica:

a) **Usar o painel já capturado** no Passo 1 como a "memória" do agente. Extrair:
   - última tarefa em progresso (ex. "writing CV on position #281")
   - última mensagem do Capitano (procurar marcadores `[@capitano -> @<role>]`)
   - qualquer erro recente

b) **Identificar papel + workdir**.
   - Singletons (`capitano | critico | sentinella | assistente | mentor | dottore`) → `/jht_home/agents/<role>/`
   - Multi-instância (`scout | scrittore | scorer | analista`) → `/jht_home/agents/<role>-<N>/` onde `<N>` é o número final na sessão tmux (ex. `SCRITTORE-2` → `/jht_home/agents/scrittore-2/`).

c) **Eliminar a sessão avariada, regenerar via launcher** (usar semântica da skill `spawn-agent` — nunca `tmux new-session` direto + `send-keys "kimi ..."`):

```bash
tmux kill-session -t <SESSION>
bash /app/.launcher/start-agent.sh <role> <N>
sleep 12
```

d) **Injetar contexto de retoma** como corpo do kick-off (não dizer apenas "resume" — dizer *o quê* e *onde*):

```bash
jht-tmux-send <SESSION> "[@dottore -> @<role>] [MSG] Resume: <tarefa em progresso antes do crash>. Last Captain order: <citado do painel>. Pick up from there, do NOT restart from scratch. Acknowledge with [@<role> -> @capitano] [RESUME] <descrição de uma linha>."
```

Se o painel mostrar que o agente tinha uma linha do DB reivindicada (ex. `status=writing` numa posição), incluir isso no contexto de retoma para não duplicar trabalho. **Nunca regenerar às cegas**: ler `db_query.py` primeiro se necessário.

## Exceções rígidas de "não regenerar"

NUNCA regenerar:
- Uma sessão com **atividade de output de tokens nos últimos 60 segundos** — o agente está a trabalhar, mesmo que pareça lento.
- O `CAPITANO` durante uma rotação de janela Codex (session_id a mudar na sentinella) — esperar estabilização.
- Turnos longos (> 5 min) COM output de tokens visível (parsing, edições de ficheiros) — longo ≠ morto.
- A si próprio (`DOTTORE*`) ou `DOCTOR-WATCHDOG`.

## Idempotência

Se o painel capturado já mostrar um marcador `[RESUME]` recente (dentro de ~5 min), outra ronda do Dottore acabou de regenerar o agente. Log `status=alive` e avançar — não regenerar novamente.

## Logging

Cada ação vai para `/jht_home/logs/dottore-actions.jsonl` (append-only, um JSON por linha):

```json
{"ts": "ISO-UTC", "round_id": "uuid-ou-epoch", "session": "SCRITTORE-1",
 "role": "scrittore-1", "event": "diagnosis",
 "status": "alive|long_turn|stallo|cli_dead|ambiguous",
 "evidence": "últimas 1-2 linhas do painel"}
{"ts": "ISO-UTC", "round_id": "...", "session": "SCRITTORE-1", "role": "scrittore-1",
 "event": "respawn", "context_recovered": "...", "new_pid": null}
```

Gerar `round_id` uma vez por ronda do Dottore (ex. epoch seconds no início da ronda). Anexar com `>>`, nunca sobrescrever.

## Anti-padrões

- ❌ Confiar no exit code 0 de `jht-tmux-send` como prova de entrega. Entrega ≠ execução. Sempre combinar com capture-pane numa mensagem crítica.
- ❌ Eliminar uma sessão sem capture-pane primeiro — pode estar numa chamada de tool longa, não morta.
- ❌ Regenerar às cegas (sem contexto de retoma) — o novo agente recomeça do zero, duplica trabalho, perde linhas DB reivindicadas.
- ❌ Caminhar sessões em paralelo — apenas sequencial, um ping de cada vez. Pings paralelos sobrecarregam o tmux em equipas grandes.
- ❌ Gastar > 10 min total numa única ronda — se uma ronda corre longa, abreviar; o próximo Dottore chega em ~30 min.

## Ver também

- `agents/dottore/dottore.md` — o ciclo de vida one-shot completo do Dottore (boot → ronda → auto-destruição).
- `spawn-agent` (Capitano) — o launcher + contrato de kick-off que esta skill reutiliza para respawns.
- `agents/_skills/throttle/DESIGN-NOTES.md` — o caso `Killed by timeout (60s)` (NÃO é um respawn).
- `agents/_team/team-rules.md` T01 — nunca eliminar a sessão de outro agente **exceto** no fluxo de respawn explícito acima.
