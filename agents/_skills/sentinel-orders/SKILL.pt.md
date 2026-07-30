<!-- @translation: pt, ai-translated 2026-06-06 -->
---
name: sentinel-orders
description: Traduz cada ordem `[SENTINELLA] ...` recebida no tmux do Capitão na ação correta (nível de throttle, spawn/kill, freeze, soft-pause, resume). A Sentinella é o batimento cardíaco da equipa — as suas ordens são comandos, não sugestões. O comportamento padrão é executar sem voltar a verificar; questionar a Sentinella executando um `rate_budget live` imediato infla o velocity_smoothing no seu JSONL e induz ordens de seguimento incorretas. Abre esta skill SEMPRE QUE um envelope `[SENTINELLA]` chegar.
allowed-tools: Bash(jht-tmux-send *), Bash(python3 /app/shared/skills/throttle-config.py *), Bash(python3 /app/shared/skills/freeze_team.py *), Bash(python3 /app/shared/skills/soft_pause_team.py *), Bash(tmux *)
---

# sentinel-orders — reagir ao watchdog

A Sentinella emite um tick a cada ~5 min e converte utilização + velocidade (`vel_team` vs `vel_target`) + semanal numa das ordens abaixo. Cada ordem corresponde a uma ação precisa. Segue o mapeamento; não improvises. **NB: `proj` no tick é INFO volátil (oscila ±400pt) — NÃO é o trigger; usa `vel_team` vs `vel_target` + `usage` vs `target` + `weekly`.**

## Tabela de throttle (config-driven)

A Sentinella envia um nível `Throttle: N`. Tu traduzes isso em durações por agente em `$JHT_HOME/config/throttle.json`. Os agentes leem esse ficheiro via `jht-throttle --agent <name>` — uma única escrita atómica propaga-se a toda a equipa.

| Nível | Pausa | Ações extra                                                            |
|-------|-------|-------------------------------------------------------------------------|
| **0** velocidade máxima | 0s    | sem restrição; spawn permitido se o backlog o exigir               |
| **1** leve              | 30s   | sem spawn                                                          |
| **2** moderado          | 120s  | + parar uma instância extra (ex. SCRITTORE-2)                      |
| **3** pesado            | 300s  | + manter apenas uma instância por papel                            |
| **4** quase-freeze      | 600s  | + ESC ações correntes, sem spawn                                   |

```bash
python3 /app/shared/skills/throttle-config.py set scout-1 60
python3 /app/shared/skills/throttle-config.py bulk-set \
    scout-1=300 scrittore-1=60 analista-1=0 scorer-1=0 critico=0
python3 /app/shared/skills/throttle-config.py dump          # estado completo
python3 /app/shared/skills/throttle-config.py reset         # todos a 0
```

Usa **`bulk-set`** quando quiseres valores diferenciados por agente com base no consumo individual (cruza com `token-rate-now` se precisares de ver quem está a dominar neste momento).

> 🎯 **O nível da tabela não é o valor que escreves.** `Throttle: N` é um único número para toda a equipa; em `throttle.json` há um valor por agente, e escolher a repartição cabe só a ti — nenhum script mexe já no throttle dos worker. A aritmética vive em **`throttle-distribution`**: **de quem** vem o corte (paga o top-burn; o Analista e o Scorer, os dois papéis que transformam um backlog numa posição **com score**, são os últimos em que tocas), **quantos segundos** são na ladder, e **quando a jogada certa é não fazer nada**. Dar a todos o mesmo número é exatamente a falha que essa skill existe para evitar — gasta o travão onde não havia nada a ganhar e tira throughput onde custa mais.

> ⚠️ **Cadência vs duração.** "Com que frequência" um agente chama `jht-throttle` no seu ciclo muda-se via `tmux` (envias uma mensagem ao agente e dizes-lhe para chamar após cada ronda do Crítico, etc.). "Quantos segundos" a pausa dura muda-se no ficheiro de configuração. Nunca envies números de throttle via tmux.

## Ao ordenar um freeze explícito — aviso de timeout `N+30` (CRÍTICO)

Quando envias um `[URG]` a um agente com `jht-throttle <N>`, **DEVES instruí-lo na própria mensagem a passar `timeout: N+30` como parâmetro à sua chamada shell tool**. Sem isso, o bash pai é morto pelo timeout padrão da CLI (Kimi 60s) — o agente desbloqueia-se após 60s em vez de N. O freeze é executado **mal**.

Corpo da mensagem correto:
```
[URG] FREEZE — call jht-throttle 600 --agent scrittore-1 --reason "freeze".
IMPORTANT: pass timeout: 630 to the shell tool call, otherwise the parent dies at 60s and the throttle is executed BADLY.
```

Se o `tmux capture-pane` do agente alvo mostrar `Killed by timeout (60s)`, o agente NÃO respeitou a instrução — é um **erro de execução** (dele, ou teu se esqueceste de incluir). Diagnostica com `jht-throttle-check <agent>` (devolve os segundos restantes no ficheiro de estado). Nunca aceites relançar o comando ou `nohup &` como "fix": a única cura é passar o timeout. Consulta `agents/_skills/throttle/DESIGN-NOTES.md` para o design completo.

## Tipos de ordem

### Pacing de rotina

| Ordem                                          | Significado / trigger                                              | Ação                                                                                                              |
|------------------------------------------------|--------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------|
| `[URG] RALLENTARE` `Throttle: N`               | velocidade acima do alvo                                           | aplica o nível N imediatamente — mas **o nível está decidido, a repartição não**: `throttle-distribution` traduz isso em valores por agente |
| `ACCELERARE` `Throttle: 0`                     | primeira luz verde após uma desaceleração                          | spawn de **um único** agente, espera pelo próximo tick antes do segundo (nunca 5 seguidos)                        |
| `SCALA UP`                                     | `vel_team` bem abaixo de `vel_target` (under-pace) durante 2+ tick, backlog não vazio | usa `pipeline-triage` para identificar o papel gargalo, spawn 1, espera pelo próximo tick                         |
| `PUSH G-SPOT`                                  | `vel_team` ligeiramente abaixo de `vel_target`, estagnado          | um agente leve (Writer se fila score ≥50, caso contrário o gargalo) para voltar on-pace                           |
| `MANTIENI`                                     | on-pace (`vel_team` ≈ `vel_target`, veredicto ALLINEATO) durante ≥3 tick | não fazer nada — sem spawn, sem mudança de throttle. Apenas ACK.                                                  |
| `RIENTRO`                                      | regresso ao ritmo nominal                                          | retoma o plano normal                                                                                             |
| `RESET SESSIONE`                               | janela de utilização desceu de alta → ~0%                          | recomeça a partir de SCOUT-1, espera por ordens antes de escalar                                                  |

### Pipeline vazia

| Ordem                                          | Significado                                                        | Ação                                                                                                              |
|------------------------------------------------|--------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------|
| `PIPELINE VUOTA + UNDERSHOOT`                  | under-pace (`vel_team` abaixo de `vel_target`) E fila de writer vazia (scored ≥ 50) | **Não esperes por novas ordens.** Abre a skill `pipeline-triage` — diz-te qual papel spawnar (raramente Scout).   |

### Emergências

| Ordem                                          | Significado                                                        | Ação                                                                                                              |
|------------------------------------------------|--------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------|
| `[EMERGENZA] FREEZATO`                         | a Sentinella já premiu ESC na equipa                               | decide se retomas após o reset da janela de rate; não te oponhas ao freeze                                        |
| `[RECOVERY TRACKING]`                          | INFO durante a recuperação, nenhuma ação por defeito               | se o Δ de recuperação é demasiado lento, lança um diagnóstico autónomo (`db_query`, `rate_budget live` on-demand) e decide os cortes |
| `[URG] STAGNAZIONE CRITICA`                    | a recuperação está a falhar, burn severo sustentado (`vel_team` ≫ `vel_target`) durante 5+ tick + usage a subir para 100% | mata os operadores pesados (mesmo Sonnet) — escolhe os que estão em tool calls (`tmux capture-pane`). Usage > 100% iminente → `freeze_team.py` |
| `[URG] PEGGIORAMENTO POST-FREEZE`              | `vel`/usage voltaram a subir após a descida                        | drástico: `freeze_team.py` + `tmux kill-session` em cada Sonnet. Manter vivos apenas CAPITANO / SENTINELLA / SENTINELLA-WORKER / ASSISTENTE |

### Mensagens de source-failure (raras, críticas)

Chegam quando a monitorização falha completamente (L1 + L2 + L3 down).

| Ordem              | Significado                                                     | Ação                                                                                                                    |
|--------------------|-----------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------|
| `[PAUSA TEAM]`     | a Sentinella já enviou `[PAUSA]` aos operadores via `soft_pause_team.py` | **Tu também paras**: sem spawn, sem ordens, sem verificações (a fonte está avariada). Fecha o turno e espera em silêncio. |
| `[HARD FREEZE]`    | segundo FATAL: ESC×2 via `freeze_team.py`                        | como `[PAUSA TEAM]`, mais possíveis tarefas interrompidas para tratar ao retomar                                        |
| `[RIPRENDI]`       | fonte de novo live                                               | lê o throttle sugerido; **redistribui a todos os operadores**; recupera qualquer tarefa interrompida                    |

Snippet de resume (usar tal e qual):
```bash
for s in $(tmux list-sessions -F '#{session_name}' | grep -vE '^(CAPITANO|SENTINELLA|SENTINELLA-WORKER|ASSISTENTE)$'); do
  /app/agents/_skills/tmux-send/jht-tmux-send "$s" "[CAPITANO] [RIPRENDI] source usage live. Resume work. Throttle: N (sleep Xs between operations). Verify the state of any task you had left and proceed."
done
```

## Mensagens com prefixo Bridge (não são ordens, mas vê-las no teu painel)

| Mensagem             | Ação                                                                                                  |
|----------------------|-------------------------------------------------------------------------------------------------------|
| `[BRIDGE ALERT] sorgente degraded da N tick` | opera com prudência, sem spawn agressivo                                                              |
| `[BRIDGE INFO]`      | recuperação / heartbeat — nenhuma ação                                                                |
| `[BRIDGE PACING]`    | tick de pacing de 15 min — `bridge-pacing` descodifica os números, `throttle-distribution` decide quem paga. Desde 2026-06-25 este tick cai no pane da **Sentinella** (push→pull): se um chegar a ti é a exceção, não a regra |

## Comportamento padrão — executar sem questionar

A Sentinella vê velocidade + tendência ao longo do tempo (`vel_team` vs `vel_target`); tu vês apenas o momento presente. **Aplica as ordens sem voltar a verificar.** Um `rate_budget live` próximo após uma ordem da Sentinella escreve uma amostra etiquetada `source=capitano` no JSONL, infla `velocity_smooth`, e induz a *próxima* ordem da Sentinella a ser incorreta.

Quando a verificação É justificada:
- antes de aplicar um throttle pesado (3 ou 4) num `[URG]` / `[EMERGENZA]` — verificação de duas fontes via `rate_budget live`
- silêncio da Sentinella mais longo que o habitual, verifica que o bridge está vivo
- após uma mudança significativa da equipa (3 spawns seguidos, kill de uma instância, `bulk-set`) — observa o efeito antes do próximo tick

Quando a verificação NÃO é justificada:
- ordens `OK` / `SOTTOUTILIZZO` / `RIENTRO` — nada a verificar, simplesmente executa
- dentro de 2 minutos da última amostra JSONL — o EMA anti-spike descarta-a mas fica como ruído

## Regras invioláveis

- Espera o efeito de um throttle (3-5 min) antes de outra intervenção.
- Abaixo de 85% sem ordem da Sentinella → adiciona capacidade no gargalo (usa `pipeline-triage`), NÃO faças spawn aleatório.
- Não discutas um throttle porque "a equipa está a trabalhar bem": a Sentinella vê velocidade + tendência (`vel_team` vs `vel_target`), tu vês apenas o presente.

## Ver também

- `bridge-pacing` — a fórmula de calibração de 15 min (fluxo separado).
- `throttle-distribution` — *quem* abranda e quanto, uma vez decidido o nível: a repartição por agente, a ladder, largar o travão e os casos em que não se faz nada. **Esta skill descodifica a ordem; aquela escolhe os valores.** É também a casa do aviso `[PACE-GUARD]`, que já não aplica o throttle por si.
- `bridge-mailbox` — esvazia os veredictos pendentes no início do turno (obrigatório antes de reagir ao tick de hoje).
- `pipeline-triage` — *qual* papel spawnar sob `SCALA UP` / `PIPELINE VUOTA`.
- `spawn-agent` — *como* spawnar depois de decidires qual papel.
- `throttle` (e `agents/_skills/throttle/DESIGN-NOTES.md`) — detalhes internos do sistema de throttle, o design do timeout `N+30`.
