<!-- @translation: pt, ai-translated 2026-08-03 -->
---
name: maintainer-sweep
description: "A ronda de manutenção da INFRA do Mantenitore 👷‍♂️ (gémea da do Dottore, mas com âmbito na infraestrutura em vez de nos agentes). Uma passagem one-shot por dia: canário de liveness dos processos de suporte de vida do contentor (bridge/daemon/watchdog) via process_health.py, smoke-test das ferramentas mission-critical (browser/LinkedIn) via tool_health.py, auditoria/consolidação de dependências fora do padrão, GC de scripts órfãos e ficheiros tmp, de-dup de scripts recorrentes, atualidade das dependências, tendência de disco/RAM. Single-writer: o Mantenitore é o ÚNICO que repara a infra; as ações DESTRUTIVAS (apagar/arquivar) ele PROPÕE, quem decide é o Capitano. Resultado acrescentado a mantenitore-logbook.jsonl."
allowed-tools: Bash(python3 /app/shared/skills/process_health.py *), Bash(python3 /app/shared/skills/tool_health.py *), Bash(python3 /app/shared/skills/sync_health.py *), Bash(python3 /app/shared/skills/host_vitals.py *), Bash(python3 /app/shared/skills/log_archive.py *), Bash(bash /app/.launcher/start-agent.sh *), Bash(df *), Bash(du *), Bash(free *), Bash(tmux ls *), Bash(jht-install *), Bash(ls *), Bash(stat *), Bash(jht-tmux-send *)
---

# maintainer-sweep — manter a INFRA saudável, em silêncio e à prova de regressões

O Mantenitore é o gémeo do Dottore: **Dottore = saúde dos AGENTES** (sessões, tokens, context-refresh); **Mantenitore = saúde da INFRA** (ferramentas, dependências, disco, scripts). One-shot por dia: boot → ronda → logbook → STANDBY (fica parado, sem autoterminar; o próximo spawn substitui-te, kill-then-create). Orçamento ~10 min. Fronteira nítida, zero sobreposição com o Dottore.

> **Porque existe:** o bug do `libatk` (browser morto, LinkedIn não verificável) ficou invisível durante horas porque *ninguém fazia smoke-test das ferramentas e ninguém tratava da infra*. A ronda torna essa vigilância ESTRUTURAL.

## Regra de ouro — single-writer + propor, não apagar
O Mantenitore **repara** a infra (instala dependências em falta, consolida, corrige). Mas toda a ação **DESTRUTIVA** (apagar/arquivar ficheiros, limpeza de disco) ele **PROPÕE** ao Capitano com o comando exato; **quem decide é o Capitano** (como no redesenho da monitorização de usage). Nunca apagues por iniciativa própria.

## A ronda (os passos, por ordem)

### 0. 🫀 Canário de liveness dos processos de suporte de vida (a rede de segurança)
**PRIMEIRO passo, antes de tudo o resto.** Os bridges/daemons que mantêm o contentor vivo (sentinel-bridge, pacing-bridge, heartbeat-bridge, window-ratio-meter, codex-auth-healer + tg-bridge) são lançados `setsid` detached → **fora do respawn-on-crash do pid1**. O `agent-watchdog` (`maybe_respawn_bridges`) volta a verificá-los a cada 30s, MAS se também esse falhar (bug, flap-cap atingido, o próprio watchdog degradado) és tu **a última rede**: na primeira ronda do dia deteta-los e repara-los. Sem este canário um daemon morto fica invisível durante horas (foi exatamente o que aconteceu ao sentinel-bridge na betaC a 2026-06-27 → 8h cegos quanto ao usage).
```bash
python3 /app/shared/skills/process_health.py summary
```
Imprime OK/DEAD para cada processo esperado (bridge-suite, pid1-child, daemon, tg-bridge). Para os DEAD:
- **grupo `bridge-suite`** (detached, reparável por ti) → **REPARA** já, é um respawn não destrutivo:
  ```bash
  bash /app/.launcher/start-agent.sh bridge      # relança a suite inteira (idempotente)
  ```
  depois **corre de novo o canário** para confirmar que voltaram a estar vivos. Regista `processes_respawned`.
- **tg-bridge** em falta (e bots de Telegram configurados) → `bash /app/.launcher/start-agent.sh tg-bridge`.
- **grupo `pid1-child` / `daemon` / `core`** (agent-watchdog, doctor-watchdog, auto-report-loop, cloud-daemon, pid1) → relançá-los é tarefa do pid1: se estiverem mortos o problema é mais fundo → **ESCALA para o Capitano** via `jht-tmux-send` (NÃO tentes relançá-los à mão: ficariam órfãos). Nunca deixes passar em silêncio.

Se estiver tudo vivo → regista `processes_health: all_ok` e segue em frente. Este é o gémeo-para-PROCESSOS do smoke-test-para-FERRAMENTAS do passo 1.

### 0.5 ☁️ Canário de CLOUD-SYNC (pull + push)
Logo a seguir ao canário dos processos. A sincronização local↔cloud encravou duas
vezes (pull churn: cursor congelado → reescrevia ~500 posições/tick; push 413:
payload monolítico demasiado grande → o cursor nunca avançava → dashboard cloud
parado durante ~14h). Os bugs de código estão corrigidos, mas a vigilância tem de
se tornar ESTRUTURAL.
```bash
python3 /app/shared/skills/sync_health.py summary        # ou --json
```
Lê os cursores só de leitura (`.cloud-sync-cursor.json`, `.cloud-pull-cursor.json`),
o máximo de `positions.updated_at` na DB e a cauda de `logs/daemon.log`. Devolve
`problems[]` com severidade. Resultado:
- **nenhum problema** → regista `sync_health: ok` e segue em frente.
- **push_behind / push_errors (HIGH)** → o push não está a chegar à cloud. NÃO é
  reparável por ti à mão em segurança (single-writer na DB = a equipa). **ESCALA
  para o Capitano** via `jht-tmux-send` com os detalhes do check (lag + contagem de 413).
  Se o check sugerir o drain de emergência (`JHT_PUSH_POS_CHUNK=40`), passa a
  proposta ao Capitano, não ajas por tua conta.
- **pull_churn (MEDIUM)** → reporta ao Capitano que o pull está a reaplicar
  demasiadas linhas (sintoma de cursor que não converge / fix não deployado).
- **cursor_stale (MEDIUM)** → evidência secundária; inclui-a na escalada apenas
  se acompanhar um sinal HIGH.
Regista o resultado sob `sync_health` na entrada do logbook (ver abaixo). A regra de ouro
mantém-se: **detetar + reportar, nunca log-and-forget** (é o mesmo erro do bug do
libatk e do sentinel-bridge, aqui sobre os CURSORES da sync).

### 1. 🩺 Smoke-test das ferramentas mission-critical (o coração)
```bash
python3 /app/shared/skills/tool_health.py --json
```
Devolve `tools_health` com `{status: OK|BROKEN|UNKNOWN, evidence}` para cada ferramenta (browser/Playwright, linkedin_check, …) + `broken[]`.
- **BROKEN** → **REPARA** já: `jht-install <dep>` (p. ex. os ficheiros `.so` do Chromium) e depois volta a correr o check. Se ficou reparado → regista `repaired`.
- **BROKEN e não reparável** → **ESCALA para o Capitano** com o fix EXATO via `jht-tmux-send` (p. ex. "browser em baixo: `sudo playwright install-deps`; até estar resolvido LinkedIn = OPEN_UNVERIFIED"). Nunca deixes passar em silêncio.
- É o MESMO `tool_health.py` que alimenta o gate em build-time (dev1) e o campo `tools_health` no tick: uma única fonte de verdade sobre o estado das ferramentas.

### 2. 📦 Auditoria de dependências fora do padrão → consolidar
Dependências instaladas fora dos prefixos padrão (`/opt/jht-deps`, `PLAYWRIGHT_BROWSERS_PATH`, prefixo npm, venv) → reinstala-as no padrão via `jht-install`, para não ficarem espalhadas. Regista quais consolidaste.

### 3. 🧹 GC de scripts órfãos/ficheiros tmp
Scripts temporários deixados para trás por agentes **mortos** (sessão já não presente em `tmux ls`) e ficheiros tmp expirados (> N horas). Lista os candidatos → **PROPÕE** a eliminação ao Capitano (ação destrutiva), não apagues diretamente.

### 4. 🔁 De-dup de scripts recorrentes
Scripts quase idênticos repetidos por vários agentes → **propõe** uma única skill canónica (não a reescrevas em cima do joelho). Regista a proposta.

### 5. 📅 Atualidade das dependências
Bibliotecas/ferramentas depreciadas ou versões partidas / ferramentas cruciais inalcançáveis → reporta ao Capitano (nada de auto-upgrades arriscados).

### 6. 💾 Disco / RAM + tendência + cruzamento com os VITALS
`du` nos caminhos grandes, `free` para a RAM. Para **`disk.used_pct` usa SEMPRE `df`** — comando canónico:
```bash
df -P /jht_home | awk 'NR==2 {gsub("%","",$5); print $5}'   # p. ex. 30  (percentagem tal como o df a reporta)
```
**NUNCA** o derives de `statvfs`/`os.statvfs` (`f_bavail`/`f_blocks`): os blocos reservados inflacionam-no ~3× → falsos alarmes (p. ex. 88% reportados contra 30% reais). Compara-o com a **tendência do último logbook**: se estiver a crescer na direção de um limiar → discute com o Capitano o que arquivar/apagar (decide ele). Regista os números + o delta.
**Depois CRUZA com a série temporal dos vitals** (o bridge amostra a RAM+CPU do contentor de poucos em poucos minutos para `vitals.jsonl`):
```bash
python3 /app/shared/skills/host_vitals.py summary --hours 24
```
Dá-te **pico/média de RAM+CPU + a HORA do pico** das últimas 24h. **Correlaciona os picos com o *quando*** (p. ex. RAM a 92% às 03:00 com 3 Analista ativos; CPU no máximo durante um script pesado): é esse o dado que afina o diagnóstico muito mais do que uma fotografia instantânea. Se um pico parecer anómalo → reporta-o ao Capitano. Regista `vitals_24h` (pico de RAM/CPU + hora) na entrada. NB: a Sentinella só recebe o alarme se a RAM/CPU estiver >95% em direto; ler o histórico e correlacioná-lo é trabalho **TEU**.

### 6.5 🗜️ Arquivo dos históricos de monitorização (ordem do Leone 19/07 — CÓDIGO, não critério pessoal)
Os históricos append-only (`sentinel-data.jsonl`, `token-meter.csv`,
`throttle-events.jsonl`, `agent-vitals.jsonl`, `vitals.jsonl`) crescem para sempre:
alimentam os gráficos de usage do jogo, por isso nunca podem ser apagados
à mão — têm de ser **arquivados com o fluxo determinista**:
```bash
python3 /app/shared/skills/log_archive.py status          # profundidade e tamanhos
python3 /app/shared/skills/log_archive.py run             # corta >30d → zips semanais
```
O que o `run` faz (tudo em código, tu só lês o resumo JSON): as semanas com mais
de 30 dias saem dos ficheiros vivos e entram em
`logs/archive/logs-<YYYY>-Www.zip` (o zip da semana cresce a cada
passagem); o corte é atómico e uma linha entra no zip ANTES de desaparecer do
ficheiro vivo. Se o espaço acabar (arquivo >500MB ou <1GB livre) apaga sozinho
os zips MAIS ANTIGOS e lista-tos sob `pruned`.
- Frequência: 1×/semana chega (domingo); nos dias úteis apenas `status`
  se o disco no passo 6 estiver a crescer de forma anómala.
- `pruned` NÃO vazio → reporta-o EXPLICITAMENTE no logbook e avisa o Capitano
  (é a única perda de dados do fluxo, autorizada pelo Leone apenas sob
  pressão de espaço).
- Exceção DELIBERADA à regra de ouro: este fluxo está pré-autorizado pelo
  Leone (19/07) — não precisas do OK do Capitano para o `run`; para qualquer
  outra eliminação fora do fluxo, mantém-se a regra single-writer.
- Regista na entrada: `log_archive: {archived_rows, weeks, pruned, free_gb}`.

## Logbook (append-only)
Cada ronda escreve UMA entrada densa em `/jht_home/logs/mantenitore-logbook.jsonl` (gémeo do logbook do Dottore), para que o próximo Mantenitore consiga ver a tendência:
```json
{"ts":"ISO-UTC","slot":"maintainer-daily","processes_health":{"all_ok":true,"dead":[]},
 "processes_respawned":[...],"sync_health":{"healthy":true,"problems":[]},
 "tools_health":{...},"repaired":[...],
 "escalated":[...],"deps_consolidated":[...],"gc_proposed":[...],"dedup_proposed":[...],
 "disk":{"used_pct":N,"delta_vs_last":N},"ram":{...},"duration_sec":N,"capitano_ack":"..."}
```
Acrescenta com `>>`, nunca sobrescrevas. Resumo denso (como as notas de viagem do Dottore/Capitano): o que encontrei, o que reparei, o que propus.

## Antipadrões
- ❌ Apagar/arquivar sem o OK do Capitano (single-writer: propõe). ÚNICA exceção: o fluxo `log_archive.py` do passo 6.5, pré-autorizado pelo Leone.
- ❌ Fazer auto-upgrade de bibliotecas para versões novas (risco de partir tudo) — reporta, não atualizes por tua conta.
- ❌ Deixar uma ferramenta BROKEN sem a reparar NEM escalar (é exatamente o bug silencioso do libatk).
- ❌ Deixar um bridge/daemon DEAD sem o reparar NEM escalar (o mesmo erro, sobre os PROCESSOS: é o crash do sentinel-bridge na betaC a 2026-06-27).
- ❌ Meteres-te na saúde dos AGENTES (sessões/tokens/contexto) — isso é do Dottore.

## Ver também
- `shared/skills/process_health.py` — o canário de liveness dos processos de suporte de vida usado no passo 0 (rede de segurança diária; o gémeo-para-processos do tool_health).
- `shared/skills/sync_health.py` — o canário da cloud-sync usado no passo 0.5 (pull churn / push 413 / cursores stale); só de leitura, o gémeo-para-SYNC do process_health/tool_health.
- `shared/skills/tool_health.py` — o smoke-test reutilizado no passo 1 (também gate em build-time + tick).
- `shared/skills/log_archive.py` — o arquivador determinista do passo 6.5 (corta semanas >30d → zip, faz prune sob pressão de espaço).
- `.launcher/agent-watchdog.sh` — a recuperação RÁPIDA (a cada 30s, `maybe_respawn_bridges`) para a qual o passo 0 é a rede de segurança diária; lição de 27/06: os bridges arrancam `setsid` detached, por isso nem o respawn do pid1 nem o `agent-watchdog` (que relança sessões tmux, não processos Python) os cobrem — se crasharem ficam em baixo até o contentor reiniciar.
- `agents/mantenitore/mantenitore.md` — persona/ciclo de vida do Mantenitore (dev3).
- `agents/_skills/resilience/SKILL.md` — a escada anti-silêncio para os agentes (dev3); o seu passo "classify" reutiliza o `tool_health.py`.
- `agents/_skills/liveness-check/SKILL.md` — o gémeo do lado do Dottore (saúde dos agentes), pela estrutura.
