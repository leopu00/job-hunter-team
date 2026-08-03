<!-- @translation: de, ai-translated 2026-06-06 -->
---
name: emergency-handling
description: Wie Rate-Limit-Notfälle und die FATAL-Kaskade behandelt werden, wenn die Bridge blind wird. Enthält die Cooldown-Bypass-Trigger, den L4-SOFT/L5-HARD-Wiederherstellungspfad und die RESET SESSIONE-Behandlung bei einem Usage-Rückgang > 30 Punkte.
allowed-tools: Bash(python3 *)
---

# Skill — Notfallbehandlung und FATAL-Kaskade

## 🚨 Notfall-Cooldown-Bypass (sofort senden)

Eine dieser Bedingungen → sende sofort einen Befehl ohne Cooldown abzuwarten:

- `proj > 200%` (katastrophal) **und** `reset_edge_guard != true`
- `velocità_smussata > velocità_ideale × 5` (Explosion)
- `usage ≥ 90%` absolut (Hard-Limit)

In diesen Fällen **VOR der Benachrichtigung freeze_team.py ausführen**:

```bash
python3 /app/shared/skills/freeze_team.py
```

Sendet Esc x2 an alle Operativen (ausgenommen CAPITANO/ASSISTENTE/SENTINELLA/SENTINELLA-WORKER). Der Verbrauch stoppt, selbst wenn die Nachricht an den Capitano verloren geht.

Setzt `freeze_active = True`.

### Guard an der Reset-Grenze (letzte 30 Minuten)

Wenn der Tick `reset_edge_guard=true` enthält, dient die Projektion nur der
Diagnose: Wegen `proj` weder Freeze, Throttle noch Kill auslösen und
`emergency_proj_history` nicht aktualisieren, auch nicht bei dauerhaftem
`proj > 150%`. `suggested_throttle_s=0` beibehalten. Unabhängige Hard-Signale
(`usage >= 90%`, Bridge-FATAL) bleiben aktiv.

## 📊 Trigger in der Notfallzone (proj > 100%, Guard inaktiv)

Pflege `emergency_proj_history` (letzte 5) und `emergency_proj_min`. Drei Trigger:

### RECOVERY TRACKING (Info alle 3 Ticks)
```
SE recovery_tracking_cooldown == 0 AND len(history) >= 3:
    delta_3 = history[-3] - history[-1]
    SE delta_3 > 0:    manda RECOVERY TRACKING (calo)
    SE delta_3 ≈ 0:    → vedi STAGNAZIONE
    SE delta_3 < -5:   → vedi PEGGIORAMENTO
    recovery_tracking_cooldown = 3
```

### STAGNAZIONE CRITICA (kritische Stagnation)
```
SE len(history) >= 5 AND proj > 150% AND (max(history) - min(history)) < 10:
    manda STAGNAZIONE CRITICA → "kill altri agenti, throttle non basta"
    cooldown 5 tick prima di rimandarla
```

### PEGGIORAMENTO POST-FREEZE (Verschlechterung nach Freeze)
```
SE proj > emergency_proj_min + 10:
    manda PEGGIORAMENTO POST-FREEZE → "secondo freeze + kill totale"
    no cooldown: scatta subito
```

## 🛡️ FATAL-Kaskade (Bridge vollständig blind)

Wenn die Bridge den Usage nicht lesen kann und du `[BRIDGE FAILURE]` erhältst:

```
L1 — schneller HTTP-Fetch (siehe Skill `check-usage-http`)
     • OK → normal weiter
     • FAIL → ↓
L2 — manueller TUI-Worker (siehe Skill `check-usage-tui`)
     • OK → normal weiter
     • FAIL → ↓
L3 — FATAL: keine Daten von der Bridge seit N aufeinanderfolgenden Zyklen
```

### L4-SOFT — erstes FATAL (`fatal_streak == 0 → 1`)

```bash
python3 /app/shared/skills/soft_pause_team.py
```

Die Skill sendet 2 unterschiedliche Nachrichten über `jht-tmux-send`:
- an die Operativen: "[PAUSA] termina task corrente, attendi [RIPRENDI]"
- an den CAPITANO: ausführliche Erklärungsnachricht

Setzt `fatal_streak = 1`. Schweige, bis ein gültiger BRIDGE TICK oder INFO eintrifft.

### L5-HARD — zweites aufeinanderfolgendes FATAL (`fatal_streak == 1 → 2`)

```bash
python3 /app/shared/skills/freeze_team.py
```

Sendet Esc x2 an alle Operativen (aggressiver). Sendet außerdem den HARD FREEZE-Befehl an den Capitano (siehe Skill `order-formats`).

Setzt `fatal_streak = 2`.

### RIPRENDI (Wiederherstellung nach FATAL)

Wenn ein gültiger `[BRIDGE TICK]` oder `[BRIDGE INFO]` mit `fatal_streak >= 1` eintrifft:

1. Reset `fatal_streak = 0`, `freeze_active = False`
2. Berechne sofort den Throttle aus dem Sample
3. Sende dem Capitano den RIPRENDI-Befehl mit frischen Daten (siehe Skill `order-formats`)
4. Der Capitano kümmert sich um die Weiterverteilung von `[RIPRENDI]` an seine Operativen

### FATAL-Übersichtstabelle

| `fatal_streak` | Trigger | Aktion |
|---|---|---|
| 0 → 1 | erstes L1+L2 ko | `soft_pause_team.py` + PAUSA TEAM al Capitano |
| 1 → 2 | zweites aufeinanderfolgendes L1+L2 ko | `freeze_team.py` + HARD FREEZE al Capitano |
| ≥ 1 → 0 | `[BRIDGE TICK]` gültig oder `[BRIDGE INFO]` | `[RIPRENDI]` al Capitano |

## 🔁 RESET SESSIONE

Wenn du in einem Tick erkennst, dass `usage` um **> 30 Punkte** gegenüber dem vorherigen Sample gefallen ist, handelt es sich um einen Fenster-Reset:

1. Setze den gesamten Verlauf zurück (siehe Skill `memory-state`)
2. Sende RESET SESSIONE an den Capitano (siehe Skill `order-formats`)
3. Behandle den nächsten Tick als "ersten Check" (Baseline, kein Befehl)
