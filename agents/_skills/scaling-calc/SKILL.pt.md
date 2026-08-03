<!-- @translation: pt, ai-translated 2026-08-03 -->
---
name: scaling-calc
description: "Calibração gradual do roster — mede o burn de 1 worker, calcula quantos workers e que throttle são precisos para atingir a velocidade-alvo, e spawna por etapas (nunca em sexta)."
---

# 🎚️ scaling-calc — engata uma mudança de cada vez, não arranques logo em sexta

Quando a equipa abre a janela de trabalho (ou precisas de consumir mais), **NÃO** arranques
em sexta ("há orçamento de sobra → spawnar 5 scouts / throttle a 0"): ainda não sabes quanto
consome realmente um worker NESTE ciclo. Calibras-te por degraus.

## Procedimento

**1. Começa com 1 ÚNICO worker** no floor (5min, o mínimo para os workers).

**2. Observa durante ~30 min** para medir o burn real. Lê o burn do worker:
```
python3 /app/shared/skills/rate_budget.py            # velocidade-alvo sustentável (S)
# burn por agente: a partir da tabela que a Sentinella te reencaminha, ou:
python3 /app/shared/skills/agent-speed-table.py
```
Toma: **S** = velocidade sustentável (p. ex. `sustainable_burn` %weekly/h) e **b** = o burn
medido do worker (mesma unidade).

**3. Calcula** roster + throttle:
```
python3 /app/agents/_skills/scaling-calc/scaling_calc.py --target <S> --measured <b>
# se observaste N workers a throttle T:
python3 .../scaling_calc.py --target <S> --measured <b_total> --workers <N> --throttle <T>
```
Dá-te: **quantos workers**, **que throttle** e um **plano por etapas**.

**4. Spawna POR ETAPAS** seguindo o plano: **um de cada vez**, **voltando a medir** antes do
seguinte (~10 min chegam para ver o burn do recém-chegado). NUNCA spawnes o bloco todo de
uma vez.

> Esses 10 minutos são uma **janela de observação**, não um desfasamento: a distância de fase
> entre dois workers do mesmo degrau é `T/N` (o período dividido pelo número de workers que o
> partilham) e o launcher aplica-a por si próprio no momento do spawn. Não é um número para
> decidir aqui, e não é uma constante: num degrau de 5 minutos, três workers querem estar a
> 100s uns dos outros.

## As duas alavancas
- **Worker abaixo do alvo** (1 worker queima menos do que o alvo) → a alavanca é o **número de
  workers** (paralelismo), todos **no floor**. Acrescenta-os por etapas.
- **Worker acima do alvo** (1 worker já queima mais do que o alvo) → a alavanca é o
  **throttle**: mantém 1 worker e **sobe** o seu throttle (a ferramenta dá-te o valor exato).
  NUNCA ponhas o throttle a zero (os workers têm de qualquer forma um floor de 5min).

## O que NÃO fazer
- ❌ "Equipa ON, orçamento de sobra → ACELERAR TUDO" — é esse o frenesim que queima uma janela
  de orçamento em 25 min com output zero. **ACELERAR = subir UM degrau** (mais um worker, ou um
  degrau de throttle a menos **até ao floor**), e depois voltar a medir.
- ❌ Spawnar 2-3 workers em conjunto. Sempre **escalonados**.
- ❌ Throttle a 0 num worker (impossível: floor de 5min; e de qualquer forma é disso que são feitas as maratonas).

## Exemplo
1 scout no floor (5min) queimou **1.4%/h**, alvo sustentável **0.7%/h**:
```
scaling_calc.py --target 0.7 --measured 1.4
→ 1 worker @ 600s (10min) → burn ≈ 0.7/h   (basta subir o throttle, sem spawn)
```
Se em vez disso 1 scout queima apenas **0.3%/h** com um alvo de 0.7:
```
→ 2 workers @ 300s (floor), por etapas: spawna o #1, observa 10min, volta a medir, depois o #2.
```
