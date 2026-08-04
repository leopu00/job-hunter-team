<!-- @translation: pt, ai-translated 2026-06-06 -->
---
name: emergency-handling
description: Como lidar com emergências de rate-limit e a cascata FATAL quando a bridge fica cega. Inclui os gatilhos de bypass de cooldown, o caminho de recuperação L4-SOFT/L5-HARD e o tratamento do RESET SESSIONE numa queda de usage > 30 pontos.
allowed-tools: Bash(python3 *)
---

# Skill — Gestão de emergências e cascata FATAL

## 🚨 Bypass de cooldown de emergência (enviar imediatamente)

Uma destas condições → envia ordem imediata sem esperar cooldown:

- `proj > 200%` (catastrófica) **e** `reset_edge_guard != true`
- `velocità_smussata > velocità_ideale × 5` (explosão)
- `usage ≥ 90%` absoluto (limite hard)

Nestes casos, **ANTES da notificação executa freeze_team.py**:

```bash
python3 /app/shared/skills/freeze_team.py
```

Envia Esc x2 a todos os operacionais (exclui CAPITANO/ASSISTENTE/SENTINELLA/SENTINELLA-WORKER). O consumo para mesmo que a mensagem ao Capitano se perca.

Define `freeze_active = True`.

### Guard no limite do reset (últimos 30 minutos)

Quando o tick tem `reset_edge_guard=true`, a projeção é apenas diagnóstica:
não faças freeze, throttle, kill nem atualizes `emergency_proj_history` por
causa de `proj`, incluindo a persistência `proj > 150%`. Mantém
`suggested_throttle_s=0`. Os sinais hard independentes (`usage >= 90%`, FATAL
da bridge) continuam ativos.

## 📊 Gatilhos na zona de emergência (proj > 100%, guard inativo)

Mantém `emergency_proj_history` (últimos 5) e `emergency_proj_min`. Três gatilhos:

### RECOVERY TRACKING (info a cada 3 ticks)
```
SE recovery_tracking_cooldown == 0 AND len(history) >= 3:
    delta_3 = history[-3] - history[-1]
    SE delta_3 > 0:    manda RECOVERY TRACKING (calo)
    SE delta_3 ≈ 0:    → vedi STAGNAZIONE
    SE delta_3 < -5:   → vedi PEGGIORAMENTO
    recovery_tracking_cooldown = 3
```

### STAGNAZIONE CRITICA (estagnação crítica)
```
SE len(history) >= 5 AND proj > 150% AND (max(history) - min(history)) < 10:
    manda STAGNAZIONE CRITICA → "kill altri agenti, throttle non basta"
    cooldown 5 tick prima di rimandarla
```

### PEGGIORAMENTO POST-FREEZE (agravamento pós-freeze)
```
SE proj > emergency_proj_min + 10:
    manda PEGGIORAMENTO POST-FREEZE → "secondo freeze + kill totale"
    no cooldown: scatta subito
```

## 🛡️ Cascata FATAL (bridge totalmente cega)

Quando a bridge não consegue ler o usage e recebes `[BRIDGE FAILURE]`:

```
L1 — fetch HTTP rápido (ver skill `check-usage-http`)
     • OK → continua normalmente
     • FAIL → ↓
L2 — TUI worker manual (ver skill `check-usage-tui`)
     • OK → continua normalmente
     • FAIL → ↓
L3 — FATAL: nenhum dado da bridge durante N ciclos consecutivos
```

### L4-SOFT — primeiro FATAL (`fatal_streak == 0 → 1`)

```bash
python3 /app/shared/skills/soft_pause_team.py
```

A skill envia 2 mensagens diferenciadas via `jht-tmux-send`:
- aos operacionais: "[PAUSA] termina task corrente, attendi [RIPRENDI]"
- ao CAPITANO: mensagem longa explicativa

Define `fatal_streak = 1`. Silêncio até que chegue um BRIDGE TICK válido ou INFO.

### L5-HARD — segundo FATAL consecutivo (`fatal_streak == 1 → 2`)

```bash
python3 /app/shared/skills/freeze_team.py
```

Envia Esc x2 a todos os operacionais (mais agressivo). Além disso, envia ao Capitano a ordem HARD FREEZE (ver skill `order-formats`).

Define `fatal_streak = 2`.

### RIPRENDI (recuperação após FATAL)

Quando chega um `[BRIDGE TICK]` válido ou `[BRIDGE INFO]` com `fatal_streak >= 1`:

1. Reset `fatal_streak = 0`, `freeze_active = False`
2. Calcula imediatamente o throttle a partir do sample
3. Envia ao Capitano a ordem RIPRENDI com dados frescos (ver skill `order-formats`)
4. O Capitano encarrega-se de redistribuir `[RIPRENDI]` aos seus operacionais

### Tabela resumo FATAL

| `fatal_streak` | Gatilho | Ação |
|---|---|---|
| 0 → 1 | primeiro L1+L2 ko | `soft_pause_team.py` + PAUSA TEAM al Capitano |
| 1 → 2 | segundo L1+L2 ko consecutivo | `freeze_team.py` + HARD FREEZE al Capitano |
| ≥ 1 → 0 | `[BRIDGE TICK]` válido ou `[BRIDGE INFO]` | `[RIPRENDI]` al Capitano |

## 🔁 RESET SESSIONE

Se num tick detetares que `usage` caiu **> 30 pontos** em relação ao sample anterior, é um reset de janela:

1. Limpa todo o histórico (ver skill `memory-state`)
2. Envia RESET SESSIONE ao Capitano (ver skill `order-formats`)
3. Trata o próximo tick como "primeiro check" (baseline, sem ordem)
