<!-- @translation: de, ai-translated 2026-06-06 -->
---
name: decision-throttle
description: Referenztabelle, die `proj` (prognostizierte Nutzung beim Reset) einem Sentinel-Zustand und einer Throttle-Stufe (0-4) zuordnet. Verwende sie bei jedem Tick NACHDEM du ein frisches Sample hast, um zu entscheiden, welchen Befehl du an den Kapitän sendest.
---

# Skill — Zustands- und Throttle-Tabelle

Referenz zur Bestimmung des Zustands anhand des empfangenen `proj` und der dem Kapitän aufzuerlegenden Throttle-Stufe.

## Zustände basierend auf `proj`

| Zustand | Bedingung `proj` | Befehl an den Kapitän |
|---|---|---|
| **KRITISCH** | `> 100%` | NOTFALL / STARK BREMSEN |
| **ACHTUNG** | `95-100%` | LEICHT BREMSEN |
| **STEADY** (G-spot) | `90-95%` für **3 aufeinanderfolgende Ticks** | HALTEN |
| **UNTERAUSLASTUNG nah** | `70-90%` für **2+ stagnierende Ticks** | PUSH G-SPOT |
| **UNTERAUSLASTUNG schwer** | `< 70%` für **2+ Ticks + vel<ideale×0.7** | HOCHSKALIEREN |
| **OK** | beliebig, erster Tick | BESCHLEUNIGEN |

## Throttle-Tabelle

```
rapporto = velocità_smussata / velocità_ideale
```

| rapporto | throttle | sleep zwischen Operationen | Semantik |
|---|---|---|---|
| ≤ 1.0 | **0** | 0s | Vollgas, unter Ziel |
| 1.0 – 1.3 | **1** | 30s | leicht darüber |
| 1.3 – 1.8 | **2** | 2 min | moderat |
| 1.8 – 2.5 | **3** | 5 min | schwer |
| > 2.5 | **4** | 10 min | fast eingefroren, Notfall |

Wenn `velocità_ideale ≤ 0` (proj > SAFE_TARGET 95%) → throttle = 4.

## Notfall-Bypass (sofort senden, Cooldown ignorieren)

Eine dieser Bedingungen → NOTFALL senden + freeze_team.py ausführen (siehe Skill `emergency-handling`):

- `proj > 200%` (katastrophal)
- `velocità_smussata > velocità_ideale × 5` (Explosion)
- `usage ≥ 90%` absolut (hartes Limit)

## Ideale Geschwindigkeit

```
velocità_ideale = (TARGET - usage_attuale) / ore_al_reset
```

`TARGET` ist **dynamisch**, in dieser Reihenfolge gewählt:

1. Wenn der letzte `[BRIDGE TICK]` `target=N%` enthält → verwende **N** (arbeitszeitbewusstes Ziel: der pacing-bridge hat es basierend auf den vom Benutzer konfigurierten Arbeitszeiten und dem Verhältnis cap-5h/cap-weekly des Anbieters berechnet).
2. Andernfalls → **92** (historischer Fallback, unter SAFE_TARGET 95% als Sicherheitsmarge).

### Beispiele

- Standard-Tick 24/7: `[BRIDGE TICK] ... ` (kein target-Feld) → target = 92.
- Bürozeiten auf Codex Pro: `[BRIDGE TICK] ... target=76% work_phase=ON` → target = 76. Das bedeutet, der pacing-bridge weiß, dass der Benutzer von 9 bis 18 Uhr arbeitet und bei diesem Verhältnis ein volles 5h-Fenster 14.7% des weekly ausmachen würde → auf 76% beim Reset zu zielen verteilt genau 100% des weekly auf die ON-Stunden.
- Außerhalb der Arbeitszeit (selten, da der pacing-bridge den Tick normalerweise überspringt): `[BRIDGE TICK] ... target=0% work_phase=OFF` → target = 0 (das Team muss runterfahren/niedrig bleiben).

### Zustandstabelle — auch diese ist auf das TARGET zentriert

Die Schwellenwerte 95%/90% in der obigen Tabelle werden immer als "nahe am Ziel" interpretiert. Wenn das Ziel 76% ist (Arbeitszeiten), ist STEADY = `proj ∈ [target−4, target+1]` ≈ 72-77%, ACHTUNG = 77-82%, KRITISCH > 84%. Wenn das Ziel 92% ist (Fallback), kehren die Schwellenwerte zu den ursprünglichen Zahlen 90/95/100 zurück.

Wenn du dir beim aktuellen Tick über das Ziel unsicher bist → behalte es bei 92 und logge explizit "(target fallback 92)". Konservatives Verhalten ist besser als den Schedule falsch zu interpretieren.
