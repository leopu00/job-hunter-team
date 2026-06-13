---
name: session-refresh
description: "Réservé au Dottore. Tour de rafraîchissement du contexte : pour chaque session d'agent, faire une rétrospective (âge + capture large + entretien + analytics), ajouter une synthèse dense au journal quotidien qui s'enrichit au fil de la journée, puis TUER + recréer + reprendre la session avec un contexte de continuation — afin que la fenêtre de contexte de l'agent soit vidée sans perdre où il en était. S'exécute 2× par fenêtre de travail (à +30min et à mi-fenêtre). Ignore les sessions fraîches et ne redémarre jamais une session que le Capitano a délibérément mise en attente."
allowed-tools: Bash(tmux *), Bash(python3 *), Bash(bash /app/.launcher/start-agent.sh *), Bash(jht-tmux-send *), Bash(/app/agents/_skills/tmux-send/jht-tmux-send *), Bash(sleep *), Bash(cat *), Bash(grep *), Bash(echo *)
---

# session-refresh — vider le contexte de l'agent, garder la continuité

Toi (le Dottore) es lancé à un créneau planifié (`+30min` après le début de la fenêtre de travail, ou à `mid` de la fenêtre). Ton rôle dans ce tour n'est **pas** de faire des pings de vivacité — c'est de **rafraîchir le contexte** des sessions d'agents actives : chaque session de longue durée accumule une fenêtre de contexte surchargée ; tu résumes ce qu'elle a fait, tu le persistes, puis tu recrées la session à neuf et tu lui rends la continuation.

> Pourquoi cela existe : l'ancien Dottore brûlait ~51% du budget de l'équipe à pinger `[HEALTH]` toutes les 2h avec zéro vérification utile. Ce tour est rare (2×/fenêtre) et produit un journal durable et dense du travail de l'équipe.

## Étape 0 — début de la fenêtre (la fenêtre analytics)
```bash
WIN_START=$(python3 -c "import sys; sys.path.insert(0,'/app'); from shared.skills.working_hours import current_window_bounds as b; w=b(); print(w[0].isoformat() if w else '')")
# 24/7 (pas de fenêtre) : repli sur les 6 dernières heures
[ -z "$WIN_START" ] && WIN_START=$(python3 -c "import datetime; print((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(hours=6)).isoformat())")
ROUND_ID=$(date -u +%Y%m%dT%H%M%SZ)
DAY=$(date -u +%F)
JOURNAL=/jht_home/logs/doctor-retrospective.jsonl
```

## Étape 1 — lister les sessions + âge, décider l'ordre
```bash
tmux list-sessions -F '#{session_name}|#{session_created}'
```
- **Ordre** : les sessions de travailleurs D'ABORD (`SCOUT-N · ANALISTA-N · SCORER-N · SCRITTORE-N · CRITICO-S*`), celles tournées vers l'utilisateur EN DERNIER et avec précaution (`ASSISTENTE · MENTOR · SENTINELLA · CAPITANO`). Ne rafraîchis jamais `DOTTORE` / `DOCTOR-WATCHDOG` (toi-même / le planificateur).
- **Ignorer si FRESH** : `age = now - session_created`. Si `age < 40 min` → IGNORER entièrement (rien à résumer encore, et rafraîchir gaspillerait une session qui vient tout juste de démarrer). Journaliser `action=skipped_fresh`.

## Étape 2 — par session : capture (large + saillant)
Capture tout le scrollback une fois, puis les lignes saillantes — ne charge PAS des milliers de lignes dans ton propre contexte, grep les moments forts :
```bash
tmux capture-pane -p -S - -t "$S" > /tmp/cap_$S.txt          # scrollback complet vers un fichier
tail -n 60 /tmp/cap_$S.txt                                    # état récent
grep -nE '\[ERROR\]|Traceback|throttle|EXCLUDED|inserted|\[FEEDBACK\]|\[RETRO\]|spawn|Killed' /tmp/cap_$S.txt | tail -40   # moments saillants
```

## Étape 3 — analytics (chiffres objectifs, pas seulement le récit de l'agent)
```bash
python3 /app/shared/skills/doctor_analytics.py "$S" "$WIN_START"
```
Renvoie du JSON : `produced{found,analyzed,scored,written,reviewed}`, `communications{sent,received,top_peers}`, `throttles{events,max_sleep_s}`, `last_captain_msg`, `session_age_h`, `role`, `instance`.

## Étape 4 — vérification PARKED (pilotée par les données, ne PAS deviner)
Une session est **PARKED** (le Capitano l'a délibérément laissée allumée mais ne l'utilise pas — p.ex. un Scout reliquat de la fenêtre précédente que le Capitano n'a pas assigné aujourd'hui) quand **toutes** ces conditions sont vraies :
- age ≥ 40min (pas fraîche), ET
- `produced` est entièrement à zéro dans la fenêtre, ET
- `last_captain_msg` est null ou antérieur au début de la fenêtre.

Si PARKED → **ne PAS recréer pour la redémarrer**. Écris la synthèse (Étape 6) avec `action=skipped_parked` et passe à la suite. (La recréer transformerait une mise en attente délibérée en travail que le Capitano ne voulait pas.) Si tu la recrées par hygiène, le message de reprise DOIT dire qu'elle était inactive : `[RESUME] you were in STANDBY — stay idle until the Capitano assigns you a queue.`

## Étape 5 — interviewer l'agent
```bash
/app/agents/_skills/tmux-send/jht-tmux-send "$S" "[@dottore -> @${s_lower}] [RETRO] Inizio-giornata: 1) intoppi in questa sessione? 2) imparato qualcosa di utile? 3) cosa stavi facendo proprio ora (per il resume)? Rispondi denso, 3-4 righe."
sleep 45
tmux capture-pane -p -S -40 -t "$S" | tail -25   # lire la réponse
```
(Ignore l'entretien pour les sessions PARKED/fraîches — il n'y a rien en cours sur quoi les questionner.)

## Étape 6 — ajouter la synthèse DENSE (ajout seul, s'enrichit chaque jour)
Une entrée JSONL par agent par tour. Combine analytics + entretien en un résumé serré. NE JAMAIS écraser — plusieurs Dottori tout au long de la journée ajoutent tous.
```bash
python3 - "$S" "$ROUND_ID" "$DAY" "$JOURNAL" <<'PY'
import json, sys, datetime
session, round_id, day, journal = sys.argv[1:5]
entry = {
  "ts": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00","Z"),
  "round_id": round_id, "day": day,
  "timing": "start+30",          # ou "mid"  — fixe au créneau pour lequel tu as été lancé
  "session": session, "role": "<role>", "session_age_h": 0.0,
  "analytics": { },              # colle ici le JSON de doctor_analytics.py
  "interview": {"intoppi": "...", "imparato": "...", "summary_denso": "..."},
  "action": "recreated",         # recreated | skipped_parked | skipped_fresh
  "resume_msg_sent": False,
}
with open(journal, "a") as f:
    f.write(json.dumps(entry, ensure_ascii=False) + "\n")
print("appended", session)
PY
```

## Étape 7 — recréer + reprendre (seulement si PAS fraîche et PAS parquée)
Rafraîchissement atomique — tu as déjà capturé le contexte à l'Étape 2, donc tuer est sans danger :
```bash
ROLE=<role>; N=<instance>      # depuis analytics ; recrée le MÊME numéro (pas de dé — le dé sert uniquement aux NOUVEAUX spawns)
tmux kill-session -t "$S"
bash /app/.launcher/start-agent.sh "$ROLE" "$N"
sleep 8
/app/agents/_skills/tmux-send/jht-tmux-send "$S" "[@dottore -> @${s_lower}] [RESUME] Contesto pre-refresh: stavi facendo <X>; avevi completato <Y> (analytics: produced=<...>); il prossimo passo era <Z>. Riprendi da li'. Coda: <next-for-role>."
```
Mets `resume_msg_sent=True` dans l'entrée du journal. Puis passe à la session suivante (cadence ~15-20s entre les agents).

## Règles
- **Un seul Dottore traite toutes les sessions ce tour** (ordre de l'utilisateur : un seul Dottore pour l'instant). Utilise la capture sur fichier + grep pour ne jamais faire exploser ta propre fenêtre de contexte.
- **Ne jamais** recréer `CAPITANO`/`SENTINELLA` à la légère — ce sont l'orchestration/le battement de cœur ; ne les rafraîchis que si leur contexte est manifestement surchargé et après un préavis, en dernier dans l'ordre.
- **Ne jamais** faire `tmux new-session` à la main — toujours `start-agent.sh` (voir `spawn-agent`).
- Journalise chaque action dans le journal (`recreated`/`skipped_parked`/`skipped_fresh`) — le journal est la piste d'audit et s'enrichit chaque jour.
