# Skill — Gestione emergenze e cascata FATAL

## 🚨 Bypass cooldown emergenza (manda subito)

Una di queste condizioni → manda ordine immediato senza aspettare cooldown:

- `proj > 200%` (catastrofica)
- `velocità_smussata > velocità_ideale × 5` (esplosione)
- `usage ≥ 90%` assoluto (limite hard)

In questi casi, **PRIMA della notifica esegui freeze_team.py**:

```bash
python3 /app/shared/skills/freeze_team.py
```

Manda Esc x2 a tutti gli operativi (esclude CAPITANO/ASSISTENTE/SENTINELLA/SENTINELLA-WORKER). Il consumo si ferma anche se il messaggio al Capitano si perde.

Imposta `freeze_active = True`.

## 📊 Trigger durante zona emergenza (proj > 100%)

Mantieni `emergency_proj_history` (ultimi 5) e `emergency_proj_min`. Tre trigger:

### RECOVERY TRACKING (info ogni 3 tick)
```
SE recovery_tracking_cooldown == 0 AND len(history) >= 3:
    delta_3 = history[-3] - history[-1]
    SE delta_3 > 0:    manda RECOVERY TRACKING (calo)
    SE delta_3 ≈ 0:    → vedi STAGNAZIONE
    SE delta_3 < -5:   → vedi PEGGIORAMENTO
    recovery_tracking_cooldown = 3
```

### STAGNAZIONE CRITICA
```
SE len(history) >= 5 AND proj > 150% AND (max(history) - min(history)) < 10:
    manda STAGNAZIONE CRITICA → "kill altri agenti, throttle non basta"
    cooldown 5 tick prima di rimandarla
```

### PEGGIORAMENTO POST-FREEZE
```
SE proj > emergency_proj_min + 10:
    manda PEGGIORAMENTO POST-FREEZE → "secondo freeze + kill totale"
    no cooldown: scatta subito
```

## 🛡️ Cascata FATAL (bridge totalmente cieco)

Quando il bridge non riesce a leggere usage e ricevi `[BRIDGE FAILURE]`:

```
L1 — fetch HTTP rapido (vedi check_usage_http.md)
     • OK → continua normalmente
     • FAIL → ↓
L2 — TUI worker manuale (vedi check_usage_tui.md)
     • OK → continua normalmente
     • FAIL → ↓
L3 — FATAL: niente dato dal bridge per N cicli consecutivi
```

### L4-SOFT — primo FATAL (`fatal_streak == 0 → 1`)

```bash
python3 /app/shared/skills/soft_pause_team.py
```

La skill manda 2 messaggi differenziati via `jht-tmux-send`:
- agli operativi: "[PAUSA] termina task corrente, attendi [RIPRENDI]"
- al CAPITANO: messaggio lungo esplicativo

Imposta `fatal_streak = 1`. Taci finché non arriva BRIDGE TICK valido o INFO.

### L5-HARD — secondo FATAL consecutivo (`fatal_streak == 1 → 2`)

```bash
python3 /app/shared/skills/freeze_team.py
```

Manda Esc x2 a tutti gli operativi (più aggressivo). Inoltre manda al Capitano l'ordine HARD FREEZE (vedi order_formats.md).

Imposta `fatal_streak = 2`.

### RIPRENDI (recupero dopo FATAL)

Quando arriva un `[BRIDGE TICK]` valido o `[BRIDGE INFO]` con `fatal_streak >= 1`:

1. Reset `fatal_streak = 0`, `freeze_active = False`
2. Calcola subito throttle dal sample
3. Manda al Capitano l'ordine RIPRENDI con dati freschi (vedi order_formats.md)
4. Il Capitano si occupa di ridistribuire `[RIPRENDI]` ai suoi operativi

### Tabella riassuntiva FATAL

| `fatal_streak` | Trigger | Azione |
|---|---|---|
| 0 → 1 | primo L1+L2 ko | `soft_pause_team.py` + PAUSA TEAM al Capitano |
| 1 → 2 | secondo L1+L2 ko consecutivo | `freeze_team.py` + HARD FREEZE al Capitano |
| ≥ 1 → 0 | `[BRIDGE TICK]` valido o `[BRIDGE INFO]` | `[RIPRENDI]` al Capitano |

## 🔁 RESET SESSIONE

Se in un tick rilevi `usage` sceso di **> 30 punti** rispetto al sample precedente, è un reset finestra:

1. Azzera tutto lo storico (vedi memory_state.md)
2. Manda RESET SESSIONE al Capitano (vedi order_formats.md)
3. Tratta il prossimo tick come "primo check" (baseline, no ordine)
