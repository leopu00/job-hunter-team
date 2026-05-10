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

## Tabella throttle

```
rapporto = velocità_smussata / velocità_ideale
```

| rapporto | throttle | sleep tra operazioni | semantica |
|---|---|---|---|
| ≤ 1.0 | **0** | 0s | full speed, sotto target |
| 1.0 – 1.3 | **1** | 30s | leggermente sopra |
| 1.3 – 1.8 | **2** | 2 min | moderato |
| 1.8 – 2.5 | **3** | 5 min | pesante |
| > 2.5 | **4** | 10 min | near-freeze, emergenza |

Se `velocità_ideale ≤ 0` (proj > SAFE_TARGET 95%) → throttle = 4.

## Bypass emergenza (manda subito, ignora cooldown)

Una di queste condizioni → manda EMERGENZA + esegui freeze_team.py (vedi skill `emergency-handling`):

- `proj > 200%` (catastrofica)
- `velocità_smussata > velocità_ideale × 5` (esplosione)
- `usage ≥ 90%` assoluto (limite hard)

## Velocità ideale

```
velocità_ideale = (92 - usage_attuale) / ore_al_reset
```

(target 92% = un po' sotto SAFE_TARGET 95% per margine).
