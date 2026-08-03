<!-- @translation: hu, ai-translated 2026-06-06 -->
---
name: emergency-handling
description: Hogyan kezeljük a rate-limit vészhelyzeteket és a FATAL kaszkádot, amikor a bridge megvakul. Tartalmazza a cooldown-bypass triggereket, az L4-SOFT/L5-HARD helyreállítási utat és a RESET SESSIONE kezelését > 30 pontos usage-csökkenésnél.
allowed-tools: Bash(python3 *)
---

# Skill — Vészhelyzet-kezelés és FATAL kaszkád

## 🚨 Vészhelyzeti cooldown-bypass (azonnali küldés)

Ezen feltételek bármelyike → azonnali parancs küldése cooldown nélkül:

- `proj > 200%` (katasztrofális) **és** `reset_edge_guard != true`
- `velocità_smussata > velocità_ideale × 5` (robbanás)
- `usage ≥ 90%` abszolút (hard limit)

Ezekben az esetekben **az értesítés ELŐTT futtasd a freeze_team.py-t**:

```bash
python3 /app/shared/skills/freeze_team.py
```

Esc x2-t küld az összes operatívnak (kizárva CAPITANO/ASSISTENTE/SENTINELLA/SENTINELLA-WORKER). A fogyasztás leáll, még ha a Capitano-nak küldött üzenet elvész is.

Beállítja: `freeze_active = True`.

### Guard a reset határán (utolsó 30 perc)

Ha a tick `reset_edge_guard=true` értéket tartalmaz, a projection csak
diagnosztikai adat: `proj` miatt ne legyen freeze, throttle vagy kill, és ne
frissítsd az `emergency_proj_history` értékét, tartós `proj > 150%` esetén sem.
Maradjon `suggested_throttle_s=0`. A független hard jelek (`usage >= 90%`,
bridge FATAL) továbbra is aktívak.

## 📊 Triggerek a vészhelyzeti zónában (proj > 100%, inaktív guard)

Tartsd karban az `emergency_proj_history` (utolsó 5) és `emergency_proj_min` értékeket. Három trigger:

### RECOVERY TRACKING (info minden 3. ticknél)
```
SE recovery_tracking_cooldown == 0 AND len(history) >= 3:
    delta_3 = history[-3] - history[-1]
    SE delta_3 > 0:    manda RECOVERY TRACKING (calo)
    SE delta_3 ≈ 0:    → vedi STAGNAZIONE
    SE delta_3 < -5:   → vedi PEGGIORAMENTO
    recovery_tracking_cooldown = 3
```

### STAGNAZIONE CRITICA (kritikus stagnálás)
```
SE len(history) >= 5 AND proj > 150% AND (max(history) - min(history)) < 10:
    manda STAGNAZIONE CRITICA → "kill altri agenti, throttle non basta"
    cooldown 5 tick prima di rimandarla
```

### PEGGIORAMENTO POST-FREEZE (romlás freeze után)
```
SE proj > emergency_proj_min + 10:
    manda PEGGIORAMENTO POST-FREEZE → "secondo freeze + kill totale"
    no cooldown: scatta subito
```

## 🛡️ FATAL kaszkád (bridge teljesen vak)

Amikor a bridge nem tudja olvasni a usage-t és `[BRIDGE FAILURE]`-t kapsz:

```
L1 — gyors HTTP fetch (lásd skill `check-usage-http`)
     • OK → normálisan folytatódik
     • FAIL → ↓
L2 — manuális TUI worker (lásd skill `check-usage-tui`)
     • OK → normálisan folytatódik
     • FAIL → ↓
L3 — FATAL: nincs adat a bridge-től N egymást követő ciklusban
```

### L4-SOFT — első FATAL (`fatal_streak == 0 → 1`)

```bash
python3 /app/shared/skills/soft_pause_team.py
```

A skill 2 megkülönböztetett üzenetet küld `jht-tmux-send` segítségével:
- az operatívoknak: "[PAUSA] termina task corrente, attendi [RIPRENDI]"
- a CAPITANO-nak: hosszú magyarázó üzenet

Beállítja: `fatal_streak = 1`. Csend, amíg érvényes BRIDGE TICK vagy INFO nem érkezik.

### L5-HARD — második egymást követő FATAL (`fatal_streak == 1 → 2`)

```bash
python3 /app/shared/skills/freeze_team.py
```

Esc x2-t küld az összes operatívnak (agresszívebb). Továbbá HARD FREEZE parancsot küld a Capitano-nak (lásd skill `order-formats`).

Beállítja: `fatal_streak = 2`.

### RIPRENDI (helyreállítás FATAL után)

Amikor érvényes `[BRIDGE TICK]` vagy `[BRIDGE INFO]` érkezik `fatal_streak >= 1` mellett:

1. Reset `fatal_streak = 0`, `freeze_active = False`
2. Azonnal számold ki a throttle-t a sample-ből
3. Küld a Capitano-nak a RIPRENDI parancsot friss adatokkal (lásd skill `order-formats`)
4. A Capitano gondoskodik a `[RIPRENDI]` szétosztásáról az operatívjai között

### FATAL összefoglaló táblázat

| `fatal_streak` | Trigger | Művelet |
|---|---|---|
| 0 → 1 | első L1+L2 ko | `soft_pause_team.py` + PAUSA TEAM al Capitano |
| 1 → 2 | második egymást követő L1+L2 ko | `freeze_team.py` + HARD FREEZE al Capitano |
| ≥ 1 → 0 | `[BRIDGE TICK]` érvényes vagy `[BRIDGE INFO]` | `[RIPRENDI]` al Capitano |

## 🔁 RESET SESSIONE

Ha egy tickben észleled, hogy a `usage` **> 30 ponttal** csökkent az előző sample-hez képest, az ablak-reset:

1. Töröld az összes előzményt (lásd skill `memory-state`)
2. Küld RESET SESSIONE-t a Capitano-nak (lásd skill `order-formats`)
3. Kezeld a következő ticket "első check"-ként (baseline, nincs parancs)
