<!-- @translation: fr, ai-translated 2026-06-06 -->
---
name: emergency-handling
description: Comment gérer les urgences de rate-limit et la cascade FATAL lorsque le bridge devient aveugle. Inclut les déclencheurs de bypass du cooldown, le chemin de récupération L4-SOFT/L5-HARD et la gestion du RESET SESSIONE lors d'une chute de usage > 30 points.
allowed-tools: Bash(python3 *)
---

# Skill — Gestion des urgences et cascade FATAL

## 🚨 Bypass du cooldown d'urgence (envoyer immédiatement)

L'une de ces conditions → envoie un ordre immédiat sans attendre le cooldown :

- `proj > 200%` (catastrophique) **et** `reset_edge_guard != true`
- `velocità_smussata > velocità_ideale × 5` (explosion)
- `usage ≥ 90%` absolu (limite hard)

Dans ces cas, **AVANT la notification, exécute freeze_team.py** :

```bash
python3 /app/shared/skills/freeze_team.py
```

Envoie Esc x2 à tous les opérationnels (exclut CAPITANO/ASSISTENTE/SENTINELLA/SENTINELLA-WORKER). La consommation s'arrête même si le message au Capitano est perdu.

Définit `freeze_active = True`.

### Guard au bord du reset (30 dernières minutes)

Lorsque le tick contient `reset_edge_guard=true`, la projection est uniquement
diagnostique : ne déclenche ni freeze, ni throttle, ni kill et ne mets pas à
jour `emergency_proj_history` à cause de `proj`, y compris pour une persistance
`proj > 150%`. Garde `suggested_throttle_s=0`. Les signaux hard indépendants
(`usage >= 90%`, FATAL du bridge) restent actifs.

## 📊 Déclencheurs en zone d'urgence (proj > 100%, guard inactif)

Maintiens `emergency_proj_history` (5 derniers) et `emergency_proj_min`. Trois déclencheurs :

### RECOVERY TRACKING (info toutes les 3 ticks)
```
SE recovery_tracking_cooldown == 0 AND len(history) >= 3:
    delta_3 = history[-3] - history[-1]
    SE delta_3 > 0:    manda RECOVERY TRACKING (calo)
    SE delta_3 ≈ 0:    → vedi STAGNAZIONE
    SE delta_3 < -5:   → vedi PEGGIORAMENTO
    recovery_tracking_cooldown = 3
```

### STAGNAZIONE CRITICA (stagnation critique)
```
SE len(history) >= 5 AND proj > 150% AND (max(history) - min(history)) < 10:
    manda STAGNAZIONE CRITICA → "kill altri agenti, throttle non basta"
    cooldown 5 tick prima di rimandarla
```

### PEGGIORAMENTO POST-FREEZE (dégradation post-freeze)
```
SE proj > emergency_proj_min + 10:
    manda PEGGIORAMENTO POST-FREEZE → "secondo freeze + kill totale"
    no cooldown: scatta subito
```

## 🛡️ Cascade FATAL (bridge totalement aveugle)

Lorsque le bridge ne parvient pas à lire le usage et que tu reçois `[BRIDGE FAILURE]` :

```
L1 — fetch HTTP rapide (voir skill `check-usage-http`)
     • OK → continue normalement
     • FAIL → ↓
L2 — TUI worker manuel (voir skill `check-usage-tui`)
     • OK → continue normalement
     • FAIL → ↓
L3 — FATAL : aucune donnée du bridge pendant N cycles consécutifs
```

### L4-SOFT — premier FATAL (`fatal_streak == 0 → 1`)

```bash
python3 /app/shared/skills/soft_pause_team.py
```

La skill envoie 2 messages différenciés via `jht-tmux-send` :
- aux opérationnels : "[PAUSA] termina task corrente, attendi [RIPRENDI]"
- au CAPITANO : message long explicatif

Définit `fatal_streak = 1`. Silence jusqu'à l'arrivée d'un BRIDGE TICK valide ou INFO.

### L5-HARD — second FATAL consécutif (`fatal_streak == 1 → 2`)

```bash
python3 /app/shared/skills/freeze_team.py
```

Envoie Esc x2 à tous les opérationnels (plus agressif). En outre, envoie au Capitano l'ordre HARD FREEZE (voir skill `order-formats`).

Définit `fatal_streak = 2`.

### RIPRENDI (récupération après FATAL)

Lorsqu'un `[BRIDGE TICK]` valide ou `[BRIDGE INFO]` arrive avec `fatal_streak >= 1` :

1. Reset `fatal_streak = 0`, `freeze_active = False`
2. Calcule immédiatement le throttle à partir du sample
3. Envoie au Capitano l'ordre RIPRENDI avec des données fraîches (voir skill `order-formats`)
4. Le Capitano se charge de redistribuer `[RIPRENDI]` à ses opérationnels

### Tableau récapitulatif FATAL

| `fatal_streak` | Déclencheur | Action |
|---|---|---|
| 0 → 1 | premier L1+L2 ko | `soft_pause_team.py` + PAUSA TEAM al Capitano |
| 1 → 2 | second L1+L2 ko consécutif | `freeze_team.py` + HARD FREEZE al Capitano |
| ≥ 1 → 0 | `[BRIDGE TICK]` valide ou `[BRIDGE INFO]` | `[RIPRENDI]` al Capitano |

## 🔁 RESET SESSIONE

Si dans un tick tu détectes que `usage` a chuté de **> 30 points** par rapport au sample précédent, c'est un reset de fenêtre :

1. Réinitialise tout l'historique (voir skill `memory-state`)
2. Envoie RESET SESSIONE au Capitano (voir skill `order-formats`)
3. Traite le prochain tick comme un "premier check" (baseline, pas d'ordre)
