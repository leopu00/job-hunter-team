<!-- @translation: pt, ai-translated 2026-06-06 -->
---
name: spawn-doctor
description: Cria um DOTTORE novo sob demanda quando voce (Capitano/Assistente/Sentinella/Mentor) precisa de uma rodada de health-check imediata. Use esta skill EM VEZ DE escrever na sessao DOTTORE quando o usuario pede "fai partire il dottore" / "dottora" / "controlla il team", porque entre rodadas agendadas a sessao DOTTORE e bash residual (ciclo de vida one-shot, ~10 min ativo + ~110 min dormindo ate o proximo spawn do ciclo de 2h).
allowed-tools: Bash(/app/.launcher/spawn-doctor.sh *), Bash(tmux *), Bash(jht-tmux-send *)
---

# spawn-doctor — chamada de emergencia ao Dottore

## Por que existe

O **doctor-watchdog** cria automaticamente um DOTTORE a cada 2 horas
(cadencia escolhida em 2026-05-18 para reduzir desperdicio de tokens:
12 spawns/dia em vez de 48). Entre um spawn e o seguinte, a sessao tmux
`DOTTORE` existe mas e "bash residual" (o Dottore anterior se
autodestruiu no fim da rodada). Enviar um `[URG]` ou `[HEALTH]` para
essa sessao e **inutil**: a mensagem acaba no bash e ninguem a le.

Caso classico (post-mortem `2026-05-18-capitano-zombie-night`):
o Assistente enviou 2 URG ao Dottore as 06:08/06:09 porque o usuario
havia pedido, mas o Dottore anterior tinha se autodestruido as 05:48
→ 2 URG perdidos no vazio, o Capitano permaneceu zombie por mais ~20 min
ate que o Assistente entendeu que precisava agir diretamente.

Esta skill fecha o loop: em vez de "falar com um Dottore morto",
**crio um novo** imediatamente.

## Quem pode usa-la

Os 4 agentes coordenadores long-lived:
- 👨‍✈️ **Capitano** — quando detecta workers zombie e quer uma segunda
  opiniao antes de fazer o respawn ele mesmo.
- 💬 **Assistente** — quando o usuario pede "fai partire il dottore" ou
  "controlla il team" via Telegram/chat.
- 🧙‍♂️ **Mentor** — quando num digest semanal detecta padroes anomalos
  e quer uma verificacao de saude da infraestrutura.
- 💂 **Sentinella** — quando um agente para de consumir tokens
  inesperadamente em plena janela produtiva.

Os demais agentes (Scout, Analista, Scorer, Scrittore, Critico) **NAO**
tem esta skill: se veem um problema, reportam ao Capitano via `[REPORT]`
e deixam a decisao com ele.

## Como usa-la

```bash
# Spawn one-shot. O script e idempotente: mata qualquer DOTTORE* existente
# antes de criar um novo, entao voce pode chama-lo sem medo de
# duplicatas.
bash /app/.launcher/spawn-doctor.sh
```

Output esperado:
```
[spawn-doctor] killing old session: DOTTORE     (se presente)
[spawn-doctor] DOTTORE avviato — workdir=/jht_home/agents/dottore — round=YYYYMMDDTHHMMSSZ-spawn
```

O novo DOTTORE LLM (Codex/Kimi/Claude conforme `active_provider`)
inicia em ~6-10 segundos, le `AGENTS.md` (= prompt do Dottore), e
comeca a rodada de health-check. Autodestruicao no final.

## Apos o spawn — interaja atraves do Dottore (nao sozinho)

```bash
# 1. Spawn
bash /app/.launcher/spawn-doctor.sh

# 2. Aguarde 8-12s para o LLM estar pronto para receber
sleep 10

# 3. Envie um [REQ] direcionado (o Dottore seguira seu procedimento padrao,
#    mas voce pode orienta-lo se tiver uma suspeita precisa).
jht-tmux-send DOTTORE \
  "[@$MY_ID -> @dottore] [REQ] Round mirato: il Capitano non risponde da
   ~30 min, capture-pane mostra solo bash. Verifica e respawn se zombie.
   Riporta a me con [RES] alla fine."

# 4. Aguarde [RES] do Dottore (~10 min budget padrao) — sem polling
#    agressivo. O proprio Dottore registrara eventos em
#    /jht_home/logs/dottore-actions.jsonl quando agir.
```

## Quando NAO usa-la

- ❌ Worker zombie e voce e o **Capitano**: faca o respawn diretamente via
  skill `spawn-agent` + kick-off resume. Nao precisa incomodar o Dottore.
  O Dottore e para problemas que exigem LLM de alto nivel
  (diagnostico de token spike, deadlock sutil, prune cache cross-system).
- ❌ Loop de pedidos: se voce ja fez `spawn-doctor` nos ultimos
  15 min, espere. Criar um novo Dottore enquanto o anterior ainda
  esta trabalhando o mata (o script e idempotente com
  `kill-session` no inicio) — voce perderia tempo e orcamento.
- ❌ Sem razao concreta: o Dottore custa ~3-5% do orcamento Kimi por
  rodada. Nao o crie "para verificar se esta tudo bem" — ja existe o
  doctor-watchdog a cada 2h para isso. Crie-o quando tiver um evento
  especifico para investigar.

## Anti-patterns

- ❌ `jht-tmux-send DOTTORE "[URG] ..."` sem antes criar — exit 0
  mas mensagem perdida no bash residual. Erro historico observado em
  2026-05-18 06:08-06:09 UTC.
- ❌ Criar manualmente com `tmux new-session -d -s DOTTORE` — ignora
  o prompt sync `AGENTS.md` + log JSONL + cleanup. Use SEMPRE
  `spawn-doctor.sh`.
- ❌ Esperar que o Dottore resolva um task nao-health (ex. "scrivi
  un CV"). O Dottore e single-purpose: liveness + cache-prune +
  py-tools-audit + cv-disk-audit. Nada mais.

## Veja tambem

- `agents/dottore/dottore.md` — prompt do Dottore, lifecycle one-shot
- `agents/_skills/liveness-check/SKILL.md` — diagnostico que o Dottore executa
- `.launcher/spawn-doctor.sh` — script idempotente (rev. legacy 2026-05-08)
- `.launcher/doctor-watchdog.sh` — loop cadencia 2h (post-mortem 2026-05-18)
- `docs/sessions/2026-05-18-capitano-zombie-night/README.md` — caso que originou esta skill
