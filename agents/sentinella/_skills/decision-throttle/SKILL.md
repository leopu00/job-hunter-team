---
name: decision-throttle
description: Reference table mapping `proj` (projected usage at reset) to a Sentinel state and a throttle level (0-4). Use it every tick AFTER you have a fresh sample to decide which order to send to the Captain.
---

# Skill — Tabella stati e throttle

Riferimento per decidere lo stato dal `proj` ricevuto e il livello throttle da imporre al Capitano.

## Stati basati su `proj`

| Stato | Condizione `proj` | Ordine al Capitano |
|---|---|---|
| **CRITICO** | `> 100%` | EMERGENZA / RALLENTA forte |
| **ATTENZIONE** | `95-100%` | RALLENTA leggermente |
| **STEADY** (G-spot) | `90-95%` per **3 tick consecutivi** | MANTIENI |
| **SOTTOUTILIZZO vicino** | `70-90%` per **2+ tick stagnanti** | PUSH G-SPOT |
| **SOTTOUTILIZZO grave** | `< 70%` per **2+ tick + vel<ideale×0.7** | SCALA UP |
| **OK** | qualunque, primo tick | ACCELERARE |

## Tabella throttle — FLOOR 5min, ladder a gradini (2026-06-21)

**Niente throttle sotto i 5min.** Lo storico mostra che i throttle <5min (78-86% degli
eventi su Kimi/Codex) erano correzioni marginali applicate a raffica = chatter. Ora il
throttle è `0` (off) **oppure** ≥5min agganciato alla **ladder** `{5,10,15,20,25,30,40,50,60}min`
(floor 5min, cap 1h). `jht-throttle`/`throttle-config` agganciano da soli qualunque valore
(es. 120s → 300s), quindi ordina pure in minuti "puliti".

```
rapporto = velocità_smussata / velocità_ideale
```

| rapporto | sleep tra operazioni | semantica |
|---|---|---|
| ≤ 1.0 | **0s** | sotto target, full speed |
| 1.0 – 1.5 | **5 min** | leggermente sopra |
| 1.5 – 2.0 | **10 min** | moderato |
| 2.0 – 3.0 | **20 min** | pesante |
| > 3.0 | **30 min** (sali fino a 60) | near-freeze, emergenza |

Se `velocità_ideale ≤ 0` (proj > SAFE_TARGET 95%) → sali la ladder (30-60min).

**⚠️ Per CONSUMARE di più NON si scende sotto i 5min.** Il throttle pace il SINGOLO
agente; la PORTATA del team la regola il numero di agenti. Se al floor di 5min il team
sotto-utilizza il budget, la leva è il PARALLELISMO: ordina **SCALA UP** → il Capitano
spawna più agenti (più agenti in simultanea = più throughput a parità di floor). Mai
inseguire il budget abbassando il throttle sotto i 5min: non esiste più.

## Bypass emergenza (manda subito, ignora cooldown)

Una di queste condizioni → manda EMERGENZA + esegui freeze_team.py (vedi skill `emergency-handling`):

- `proj > 200%` (catastrofica)
- `velocità_smussata > velocità_ideale × 5` (esplosione)
- `usage ≥ 90%` assoluto (limite hard)

## Velocità ideale

```
velocità_ideale = (TARGET - usage_attuale) / ore_al_reset
```

`TARGET` è **dinamico**, scelto in quest'ordine:

1. Se l'ultimo `[BRIDGE TICK]` include `target=N%` → usa **N** (target work-hours-aware: il pacing-bridge l'ha calcolato in base alle ore di lavoro che l'utente ha configurato e al rapporto cap-5h/cap-weekly del provider).
2. Altrimenti → **92** (fallback storico, sotto SAFE_TARGET 95% per margine).

### Esempi

- Tick standard 24/7: `[BRIDGE TICK] ... ` (no target field) → target = 92.
- Office hours su Codex Pro: `[BRIDGE TICK] ... target=76% work_phase=ON` → target = 76. Significa che il pacing-bridge sa che l'utente lavora 9-18 e con quel ratio una finestra 5h piena varrebbe 14.7% del weekly → puntare al 76% al reset distribuisce esattamente il 100% del weekly sulle ore ON.
- Fuori orario (raro, perché il pacing-bridge in genere salta il tick): `[BRIDGE TICK] ... target=0% work_phase=OFF` → target = 0 (team deve scendere/restare basso).

### Tabella stati — anche questa è centrata sul TARGET

Le soglie 95%/90% nella tabella in cima si interpretano sempre come "vicino al target". Quando il target è 76% (work-hours), STEADY = `proj ∈ [target−4, target+1]` ≈ 72-77%, ATTENZIONE = 77-82%, CRITICO > 84%. Quando il target è 92% (fallback) le soglie tornano ai numeri originali 90/95/100.

Se non sei sicura del target nel tick corrente → tienilo a 92 e log esplicito "(target fallback 92)". Meglio comportamento conservativo che fraintendere lo schedule.
