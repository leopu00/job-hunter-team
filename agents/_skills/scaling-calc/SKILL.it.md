<!-- @translation: it, ai-translated 2026-08-03 -->
---
name: scaling-calc
description: "Calibrazione graduale del roster — misura il burn di 1 worker, calcola quanti worker e quale throttle servono per centrare la velocità-target, e spawna a scaglioni (mai in sesta)."
---

# 🎚️ scaling-calc — cambia marcia un gradino alla volta, non partire in sesta

Quando il team apre la finestra di lavoro (o devi consumare di più), **NON** partire
in sesta ("c'è budget in abbondanza → spawna 5 scout / throttle a 0"): non sai ancora
quanto consuma davvero un worker in QUESTO ciclo. Ti calibri per gradini.

## Procedura

**1. Parti da 1 SOLO worker** al floor (5min, il minimo per i worker).

**2. Osserva per ~30 min** per misurare il burn reale. Leggi il burn del worker:
```
python3 /app/shared/skills/rate_budget.py            # velocità-target sostenibile (S)
# burn per agente: dalla tabella che ti inoltra la Sentinella, oppure:
python3 /app/shared/skills/agent-speed-table.py
```
Prendi: **S** = velocità sostenibile (es. `sustainable_burn` %weekly/h) e **b** = il
burn misurato del worker (stessa unità).

**3. Calcola** roster + throttle:
```
python3 /app/agents/_skills/scaling-calc/scaling_calc.py --target <S> --measured <b>
# se hai osservato N worker a throttle T:
python3 .../scaling_calc.py --target <S> --measured <b_total> --workers <N> --throttle <T>
```
Ti dà: **quanti worker**, **quale throttle** e un **piano a scaglioni**.

**4. Spawna A SCAGLIONI** seguendo il piano: **uno per volta**, **ri-misurando** prima del
successivo (~10 min bastano per vedere il burn del nuovo arrivato). MAI spawnare tutto il
blocco in una volta.

> Quei 10 minuti sono una **finestra di osservazione**, non uno sfasamento: la distanza di fase
> fra due worker dello stesso gradino è `T/N` (il periodo diviso il numero di worker che se lo
> spartiscono) e il launcher la applica da sé al momento dello spawn. Non è un numero da decidere
> qui, e non è una costante: su un gradino da 5 minuti, tre worker vogliono stare a 100s l'uno
> dall'altro.

## Le due leve
- **Worker sotto target** (1 worker brucia meno del target) → la leva è il **numero di
  worker** (parallelismo), tutti **al floor**. Aggiungili a scaglioni.
- **Worker sopra target** (1 worker brucia già più del target) → la leva è il
  **throttle**: tieni 1 worker e **alza** il suo throttle (il tool ti dà il valore
  esatto). MAI azzerare il throttle (i worker hanno comunque un floor di 5min).

## Cosa NON fare
- ❌ "Team ON, budget in abbondanza → ACCELERARE TUTTO" — è la frenesia che brucia una
  finestra di budget in 25 min a output zero. **ACCELERARE = salire di UN gradino** (un worker
  in più, o un gradino di throttle in meno **fino al floor**), poi ri-misurare.
- ❌ Spawnare 2-3 worker insieme. Sempre **scaglionati**.
- ❌ Throttle a 0 su un worker (impossibile: floor 5min; e comunque è di quello che sono fatte le maratone).

## Esempio
1 scout al floor (5min) ha bruciato **1.4%/h**, target sostenibile **0.7%/h**:
```
scaling_calc.py --target 0.7 --measured 1.4
→ 1 worker @ 600s (10min) → burn ≈ 0.7/h   (basta alzare il throttle, nessuno spawn)
```
Se invece 1 scout brucia solo **0.3%/h** con un target di 0.7:
```
→ 2 worker @ 300s (floor), a scaglioni: spawna il #1, osserva 10min, ri-misura, poi il #2.
```
