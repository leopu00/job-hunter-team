<!-- @translation: pt, ai-translated 2026-06-06 -->
---
name: cache-prune
description: "Recuperar disco nas caches partilhadas do JHT (cache de wheels `uv` + log SQLite `codex`) a cada ~24h. Pertence ao Dottore — instância única, executa no final de uma ronda rotineira quando a equipa está ociosa. Nunca executar durante emergência: o VACUUM do SQLite bloqueia por ~30s num DB de 200 MB e roubaria ciclos de uma recuperação conduzida pela Sentinella. Migrado do Capitano para que o Capitano se mantenha focado na coordenação, não na manutenção."
allowed-tools: Bash(node /app/cli/bin/jht.js cache *), Bash(du *), Bash(df *)
---

# cache-prune — recuperar caches partilhadas

O `$JHT_HOME` partilhado acumula duas caches que crescem monotonicamente até serem recuperadas:

| Caminho                               | O que armazena                          | Crescimento típico (amostra 2026-05-02) |
|---------------------------------------|-----------------------------------------|------------------------------------|
| `$JHT_HOME/.cache/uv/`                | cache de wheels para cada `uv pip install` | ~364 MB                           |
| `$JHT_HOME/.codex/logs_2.sqlite`      | telemetria SQLite do Codex (71% linhas TRACE) | ~223 MB                       |

Nenhuma é necessária em disco: o uv re-descarrega se precisar, o Codex trunca linhas TRACE com segurança. Os números acima vieram de uma execução contínua; num `$JHT_HOME` fresco começam em 0 e atingem centenas de MB em poucos dias.

## O único comando seguro

```bash
node /app/cli/bin/jht.js cache prune
```

Idempotente e no-op quando não há nada para recuperar. Internamente:
1. `uv cache prune` — elimina wheels obsoletas (mantém o conjunto ativo referenciado pelas instalações atuais).
2. SQLite `VACUUM` em `logs_2.sqlite` após eliminar linhas TRACE antigas.
3. Limpeza de ficheiros temporários efémeros do Codex.

Cada passo tem uma porta de segurança: `idle > 1h` nas operações que são destrutivas (bloqueio VACUUM, eliminação TRACE) — se a equipa está ativamente a queimar tokens, o passo é pulado.

## Quando executar

- 👨‍⚕️ **Final de uma ronda rotineira do Dottore** (~24h de execução contínua, ou no início de um dia operacional ocioso).
- 📉 **Sob demanda** se `du -sh $JHT_HOME/.cache $JHT_HOME/.codex` mostrar crescimento > 800 MB total.
- 🚫 **NUNCA** durante situação crítica de orçamento (proj > 95%) — o VACUUM de 30s bloqueia o SQLite do Codex que a Sentinella lê através da bridge.
- 🚫 **NUNCA** em reação a um `[ORDINE]` da Sentinella — ordens exigem ações de pacing/scaling, não manutenção.

## Segurança: o que NÃO tocar

A equipa tem *outras* caches que parecem similares mas NÃO estão no âmbito aqui:

| Caminho                              | Porquê não tocar                                                  |
|--------------------------------------|-------------------------------------------------------------------|
| `.cache/ms-playwright/`              | binários de browser fixados por versão — re-descarregar é lento + instável |
| `.cache/claude-cli-nodejs/`          | cache de runtime do CLI Anthropic, recreada preguiçosamente mas maior quando quente |
| `$JHT_HOME/logs/`                    | O estado da Sentinella vive aqui. Limpá-lo perde a janela EMA e vários minutos de histórico de monitorização. |

O raio de explosão do `cache prune` está limitado aos dois caminhos na tabela no topo.

> ⚠️ **`cache clear` é proibido.** Esse comando (um primo destrutivo de `cache prune` exposto pelo `jht`) limpa `logs/` juntamente com as caches, destruindo o estado da Sentinella. Se alguma vez sentir a urgência de `cache clear`, escale para o utilizador em vez disso.

## Crescimento anómalo — escalar

Se `du -sh` mostrar um caminho *fora* dos 2 alvos acima a crescer rapidamente (ex. `.cache/ms-playwright/` duplicou, `.codex/sessions/` a inchar), **NÃO** o limpe por conta própria. Capture:

```bash
du -sh $JHT_HOME/.cache/* $JHT_HOME/.codex/*
df -h $JHT_HOME
```

…registe em `dottore-actions.jsonl` com `event=disk_anomaly` + a saída do `du`, e faça chegar ao utilizador via o Capitano (`jht-tmux-send CAPITANO`). Um novo caminho a crescer pode significar que uma nova ferramenta foi adicionada sem orçamento para limpeza.

## Saída para o log

Anexar a `/jht_home/logs/dottore-actions.jsonl`:

```json
{"ts": "ISO-UTC", "round_id": "...", "event": "cache_prune",
 "uv_freed_mb": 142, "codex_freed_mb": 87, "total_freed_mb": 229,
 "duration_sec": 31}
```

Se um passo foi pulado pela porta de idle, defina o `_freed_mb` correspondente como `null` e adicione `"skipped": ["vacuum"]`.

## Anti-padrões

- ❌ Executar `cache prune` do Capitano — essa responsabilidade foi migrada para cá. O Capitano coordena, o Dottore mantém.
- ❌ Executar enquanto um Scrittore está a meio de um CV (o loop deles toca na cache uv ocasionalmente para libs pandoc/typst).
- ❌ Adicionar um loop tipo cron no prompt do Dottore — o Dottore é one-shot com cadência de ~30 min, encaixe o cache-prune no final da ronda quando fizer sentido, não num schedule fixo.
- ❌ Contornar o wrapper `jht.js cache prune` para executar `uv cache prune` / `sqlite vacuum` diretamente — pula a porta de idle e o logging unificado.

## Ver também

- `agents/dottore/dottore.md` — quando no ciclo de vida do Dottore encaixar esta skill (apenas no final da ronda).
- `py-tools-audit` — skill irmã de manutenção (pacotes Python, cadência ~semanal).
- `agents/_team/team-rules.md` T13 — regra uv-como-único-instalador (porquê a cache uv existe em primeiro lugar).
