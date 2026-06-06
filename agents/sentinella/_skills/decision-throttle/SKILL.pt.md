<!-- @translation: pt, ai-translated 2026-06-06 -->
---
name: decision-throttle
description: Tabela de referência que mapeia `proj` (uso projetado no reset) a um estado Sentinela e um nível de throttle (0-4). Use-a a cada tick DEPOIS de obter uma amostra fresca para decidir qual ordem enviar ao Capitão.
---

# Skill — Tabela de estados e throttle

Referência para decidir o estado a partir do `proj` recebido e o nível de throttle a impor ao Capitão.

## Estados baseados em `proj`

| Estado | Condição `proj` | Ordem ao Capitão |
|---|---|---|
| **CRÍTICO** | `> 100%` | EMERGÊNCIA / FREAR forte |
| **ATENÇÃO** | `95-100%` | FREAR levemente |
| **STEADY** (G-spot) | `90-95%` por **3 ticks consecutivos** | MANTER |
| **SUBUTILIZAÇÃO próxima** | `70-90%` por **2+ ticks estagnados** | PUSH G-SPOT |
| **SUBUTILIZAÇÃO grave** | `< 70%` por **2+ ticks + vel<ideale×0.7** | ESCALAR UP |
| **OK** | qualquer, primeiro tick | ACELERAR |

## Tabela de throttle

```
rapporto = velocità_smussata / velocità_ideale
```

| rapporto | throttle | sleep entre operações | semântica |
|---|---|---|---|
| ≤ 1.0 | **0** | 0s | velocidade máxima, abaixo do alvo |
| 1.0 – 1.3 | **1** | 30s | levemente acima |
| 1.3 – 1.8 | **2** | 2 min | moderado |
| 1.8 – 2.5 | **3** | 5 min | pesado |
| > 2.5 | **4** | 10 min | quase congelado, emergência |

Se `velocità_ideale ≤ 0` (proj > SAFE_TARGET 95%) → throttle = 4.

## Bypass de emergência (enviar imediatamente, ignorar cooldown)

Uma destas condições → enviar EMERGÊNCIA + executar freeze_team.py (ver skill `emergency-handling`):

- `proj > 200%` (catastrófica)
- `velocità_smussata > velocità_ideale × 5` (explosão)
- `usage ≥ 90%` absoluto (limite hard)

## Velocidade ideal

```
velocità_ideale = (TARGET - usage_attuale) / ore_al_reset
```

`TARGET` é **dinâmico**, escolhido nesta ordem:

1. Se o último `[BRIDGE TICK]` inclui `target=N%` → usar **N** (alvo ciente das horas de trabalho: o pacing-bridge calculou-o com base nas horas de trabalho que o utilizador configurou e na relação cap-5h/cap-weekly do fornecedor).
2. Caso contrário → **92** (fallback histórico, abaixo de SAFE_TARGET 95% por margem de segurança).

### Exemplos

- Tick padrão 24/7: `[BRIDGE TICK] ... ` (sem campo target) → target = 92.
- Horário de escritório no Codex Pro: `[BRIDGE TICK] ... target=76% work_phase=ON` → target = 76. Significa que o pacing-bridge sabe que o utilizador trabalha das 9 às 18 e com essa relação uma janela de 5h completa valeria 14.7% do weekly → apontar para 76% no reset distribui exatamente 100% do weekly nas horas ON.
- Fora do horário (raro, porque o pacing-bridge geralmente salta o tick): `[BRIDGE TICK] ... target=0% work_phase=OFF` → target = 0 (a equipa deve descer/manter-se baixo).

### Tabela de estados — também centrada no TARGET

Os limiares 95%/90% na tabela acima interpretam-se sempre como "perto do alvo". Quando o alvo é 76% (horas de trabalho), STEADY = `proj ∈ [target−4, target+1]` ≈ 72-77%, ATENÇÃO = 77-82%, CRÍTICO > 84%. Quando o alvo é 92% (fallback), os limiares voltam aos números originais 90/95/100.

Se não tiver certeza do alvo no tick atual → mantenha-o em 92 e log explícito "(target fallback 92)". Melhor um comportamento conservador do que interpretar mal o schedule.
