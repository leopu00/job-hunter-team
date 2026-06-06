<!-- @translation: pt, ai-translated 2026-06-06 -->
---
name: rate-budget
description: Lê o snapshot do orçamento de rate-limit para o provedor ativo (uso %, tempo até o reset, velocidade, projeção, throttle recomendado) a partir da bridge. Usar no arranque do Captain para planear o ritmo e decidir quantos agentes spawnar, depois periodicamente quando quiser um snapshot fresco sem gastar tokens chamando o provedor diretamente. Zero chamadas ao provedor — lê o último tick já escrito pela bridge.
allowed-tools: Bash(python3 *)
---

# rate-budget — snapshot do orçamento de rate-limit

A bridge de monitorização (`.launcher/sentinel-bridge.py`) sonda o provedor ativo a cada 1–10 min (dinâmico — mais frequente sob pressão) e escreve cada amostra em `/jht_home/logs/sentinel-data.jsonl`. Esta skill lê apenas a **última amostra** já escrita — nenhuma chamada extra ao provedor.

## No arranque do Captain

Antes de spawnar qualquer agente, executar:

```bash
python3 /app/shared/skills/rate_budget.py plan
```

Saída típica:
```
=== Rate Budget — claude ===
  Usage:            53%
  Reset:            13:49 (in 2h 34m)
  Measured velocity:+0.39%/h (EMA)
  Target velocity:  11.38%/h (to close at 92% by reset)
  Reset projection: 56%
  Status:           OK
  Throttle:         T0 full speed
  Host:             cpu=4.7% ram=9.8% (OK)

  Recommended policy: Spawn freely in parallel — keep normal pace.
  Margin to 92% target: 39%
  Last tick:        2026-04-24T10:23:18.705062+00:00
```

**Interpretação do Captain** (usar `Measured velocity` vs `Target velocity` — NÃO `Reset projection`, que é INFO volátil):
- `Throttle T0–T1` + `Measured velocity` bem abaixo de `Target velocity` (abaixo do ritmo) → spawn completo (Scout + Analyst + Scorer + Writer + Critic)
- `Throttle T1–T2` + `Measured` ≈ `Target` (no ritmo) → spawn reduzido (uma instância por função)
- `Throttle T2+` ou `Measured velocity` acima de `Target velocity` (a queimar) → **sem spawn**, esperar que a bridge liberte o throttle
- `Reset projection` é apenas INFO (extrapolação volátil no final da janela) — não basear o spawn nisso.

**Se a saída for `NO_DATA`:** a bridge ainda não sondou. Esperar 1-2 min e tentar novamente. Não iniciar a equipa sem este sinal — arrisca saturar o rate-limit às cegas.

## Versão de uma linha (scriptável)

```bash
python3 /app/shared/skills/rate_budget.py status
# → provider=claude usage=55% status=OK throttle=T0 reset=13:49 (in 2h 34m)
```

Útil para logs rápidos ou verificações a meio do ciclo.

## Quando NÃO usar

- **Não chamar a cada passo.** Usar nos *câmbios de fase* do teu plano (bootstrap, fim do batch Scout, após uma pausa, etc.). A bridge atualiza ao seu próprio ritmo; chamar mais frequentemente não devolve dados mais frescos.
- **Não substitui o fluxo assíncrono `[BRIDGE ORDER]`:** a bridge notifica-te *quando* a política muda; tu planeias *enquanto olhas* para o orçamento. Os dois mecanismos são complementares.
