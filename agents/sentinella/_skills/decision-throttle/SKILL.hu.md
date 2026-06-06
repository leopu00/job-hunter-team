<!-- @translation: hu, ai-translated 2026-06-06 -->
---
name: decision-throttle
description: Referencia-tabla, amely a `proj` (becsült használat a resetnél) értéket egy Sentinel-állapothoz és egy throttle-szinthez (0-4) rendeli. Használd minden tick-nél, MIUTÁN friss mintát kaptál, hogy eldöntsd, milyen parancsot küldj a Kapitánynak.
---

# Skill — Állapot- és throttle-tábla

Referencia az állapot meghatározásához a kapott `proj` alapján, valamint a Kapitányra kirovandó throttle-szint megállapításához.

## `proj` alapú állapotok

| Állapot | `proj` feltétel | Parancs a Kapitánynak |
|---|---|---|
| **KRITIKUS** | `> 100%` | VÉSZHELYZET / ERŐSEN FÉKEZZ |
| **FIGYELEM** | `95-100%` | ENYHÉN FÉKEZZ |
| **STEADY** (G-spot) | `90-95%` **3 egymást követő tick-en** | TARTSD |
| **ALULKIHASZNÁLÁS közeli** | `70-90%` **2+ stagnáló tick-en** | PUSH G-SPOT |
| **ALULKIHASZNÁLÁS súlyos** | `< 70%` **2+ tick-en + vel<ideale×0.7** | SKÁLÁZZ FEL |
| **OK** | bármilyen, első tick | GYORSÍTS |

## Throttle-tábla

```
rapporto = velocità_smussata / velocità_ideale
```

| rapporto | throttle | sleep műveletek között | szemantika |
|---|---|---|---|
| ≤ 1.0 | **0** | 0s | teljes sebesség, célérték alatt |
| 1.0 – 1.3 | **1** | 30s | enyhén felette |
| 1.3 – 1.8 | **2** | 2 min | mérsékelt |
| 1.8 – 2.5 | **3** | 5 min | nehéz |
| > 2.5 | **4** | 10 min | majdnem befagyasztva, vészhelyzet |

Ha `velocità_ideale ≤ 0` (proj > SAFE_TARGET 95%) → throttle = 4.

## Vészhelyzeti bypass (azonnali küldés, cooldown figyelmen kívül hagyása)

Az alábbi feltételek bármelyike → VÉSZHELYZET küldése + freeze_team.py futtatása (lásd `emergency-handling` skill):

- `proj > 200%` (katasztrofális)
- `velocità_smussata > velocità_ideale × 5` (robbanás)
- `usage ≥ 90%` abszolút (hard korlát)

## Ideális sebesség

```
velocità_ideale = (TARGET - usage_attuale) / ore_al_reset
```

A `TARGET` **dinamikus**, az alábbi sorrendben választva:

1. Ha az utolsó `[BRIDGE TICK]` tartalmazza a `target=N%` mezőt → használd **N**-t (munkaidő-tudatos célérték: a pacing-bridge a felhasználó által konfigurált munkaidő és a szolgáltató cap-5h/cap-weekly aránya alapján számolta ki).
2. Egyébként → **92** (történelmi fallback, a SAFE_TARGET 95% alatt biztonsági tartalékkal).

### Példák

- Standard 24/7 tick: `[BRIDGE TICK] ... ` (nincs target mező) → target = 92.
- Irodai munkaidő Codex Pro-n: `[BRIDGE TICK] ... target=76% work_phase=ON` → target = 76. Ez azt jelenti, hogy a pacing-bridge tudja, hogy a felhasználó 9-től 18-ig dolgozik, és ezzel az aránnyal egy teljes 5 órás ablak a weekly 14.7%-át tenné ki → a 76%-ra célzás a resetnél pontosan a weekly 100%-át osztja el az ON órákra.
- Munkaidőn kívül (ritka, mert a pacing-bridge általában kihagyja a tick-et): `[BRIDGE TICK] ... target=0% work_phase=OFF` → target = 0 (a csapatnak le kell mennie / alacsonyan kell maradnia).

### Állapottábla — ez is a TARGET köré épül

A fenti tábla 95%/90%-os küszöbértékei mindig "célértékhez közel"-ként értelmezendők. Ha a célérték 76% (munkaidő), STEADY = `proj ∈ [target−4, target+1]` ≈ 72-77%, FIGYELEM = 77-82%, KRITIKUS > 84%. Ha a célérték 92% (fallback), a küszöbértékek visszaállnak az eredeti 90/95/100 számokra.

Ha nem vagy biztos az aktuális tick célértékében → tartsd 92-n és naplózz explicit módon "(target fallback 92)". Jobb a konzervatív viselkedés, mint félreérteni a schedule-t.
