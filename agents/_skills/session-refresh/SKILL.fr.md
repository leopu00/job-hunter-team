---
name: session-refresh
description: "Réservé au Dottore. Tour de rafraîchissement du contexte : pour chaque session d'agent, lire l'occupation réelle de son contexte (commande client-side du fournisseur, zéro token) et ne rafraîchir QUE les sessions dont la fenêtre de contexte est remplie à plus de 50% — faire une rétrospective (capture + entretien + analytics), ajouter une synthèse dense au journal quotidien qui s'enrichit au fil de la journée, puis TUER + recréer + reprendre la session avec un contexte de continuation, afin que sa fenêtre de contexte soit vidée sans perdre où elle en était. S'exécute 2× par fenêtre de travail (à +30min et à mi-fenêtre). Ignore les sessions fraîches, à faible contexte (≤50%) et celles mises en attente par le Capitano — SAUF au-delà du TTL de 12h de la session (JHT_AGENT_MAX_SESSION_AGE_H), qui prime sur tout saut : seul l'âge décide, sans exception."
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
- **Ordre** : les sessions de travailleurs D'ABORD (`SCOUT-N · ANALISTA-N · SCORER-N · SCRITTORE-N · CRITICO-S*`), les coordinateurs EN DERNIER et avec précaution (`ASSISTENTE · MENTOR · SENTINELLA · CAPITANO`). « Avec précaution » veut dire **capturer bien leur état et les compacter — NE PAS les sauter** (ce sont les top consumers ; voir Règles). Ne rafraîchis jamais `DOTTORE` / `DOCTOR-WATCHDOG` (toi-même / le planificateur).
- **Ignorer si FRESH** (pré-filtre économique avant la vérification du contexte) : `age = now - session_created`. Si `age < 40 min` → IGNORER entièrement (rien à résumer encore, et rafraîchir gaspillerait une session qui vient tout juste de démarrer). Journaliser `action=skipped_fresh`. Tout ce qui passe ce pré-filtre passe par l'**Étape 1.4 (TTL)** puis par l'**Étape 1.5 (vérification du contexte)** — c'est cette mesure `>50%`, et non l'âge, qui décide du rafraîchissement *ordinaire*.

## Étape 1.4 — TTL : **toute session d'agent vit au maximum 12 heures**
```bash
TTL_H="${JHT_AGENT_MAX_SESSION_AGE_H:-12}"
AGE_H=$(( ( $(date -u +%s) - $(tmux display-message -p -t "$S" '#{session_created}') ) / 3600 ))
[ "$AGE_H" -ge "$TTL_H" ] && echo "TTL EXPIRÉ ($AGE_H h) → rafraîchissement OBLIGATOIRE"
```
**Si `AGE_H ≥ TTL_H`, la session est rafraîchie. Point.** Le TTL est vérifié **avant** tout le reste et **annule tous les sauts prévus dans cette skill** — aucune exception, aucune dérogation, aucun « mais » :

| saut normal | au-delà du TTL |
|---|---|
| `skipped_fresh` (age < 40min) | impossible au-delà de 12h, mais le TTL l'emporte quand même |
| `skipped_lowctx` (contexte ≤ 50%) | **ignoré** — une session à 4% après 30h est recréée quand même |
| `skipped_parked` (PARKED, Étape 4) | **ignoré** — parquée ou non, le TTL s'applique |
| « l'agent travaille » | **ignoré** — capture son état dans le seed et recrée |
| hors de la fenêtre de travail | **ignoré** — le TTL n'est jamais suspendu (voir Règles) |

Journalise `action=recreated` avec `reason=ttl` et le `session_age_h` mesuré. Puis va droit aux Étapes 2 → 7 (capture, analytics, synthèse, recréer + reprendre) : **saute entièrement l'Étape 1.5 et l'Étape 4**, elles ne peuvent produire qu'un saut et le saut n'est pas disponible ici.

Pourquoi l'âge seul, sans heuristique de santé par-dessus : lors de l'incident du 2026-07-28/29 les sessions avaient **38,5 · 29,5 · 27,0 · 14,5 · 14,2 heures**, toutes les heuristiques disaient « sain » et l'équipe était paralysée depuis onze heures. Les contextes étaient sous les 50%, donc aucune règle ne les a touchées. Un TTL n'a pas d'heuristique à se tromper.

## Étape 1.5 — VÉRIFICATION DU CONTEXTE (le déclencheur du rafraîchissement *ordinaire* : **>50%**)
Uniquement pour les sessions qui n'ont **pas** déclenché le TTL à l'Étape 1.4.
**Ne rafraîchis QUE les sessions dont la fenêtre de contexte est remplie à plus de 50%.** Lis l'occupation réelle avec la commande de contexte **client-side** du fournisseur — elle coûte **zéro token** (rendue en local, aucun appel LLM) et est instantanée. L'âge n'est PLUS le déclencheur : une session vieille-mais-vide (p.ex. un Mentor inactif à 2%) doit être IGNORÉE, une session surchargée doit être rafraîchie.

Deux exigences impératives — les ignorer *brûle* du budget au lieu d'en économiser :
- La session DOIT être **inactive** (aucun tour en cours). Si un spinner / `esc to interrupt` s'affiche, elle travaille → IGNORE ce tour (le prochain Doctor la reprend). N'envoie jamais de touches en plein tour.
- **Vide d'abord la ligne de saisie.** Sinon la commande se concatène au texte résiduel et est soumise comme prompt à l'LLM (brûle des tokens). Envoie `Escape` puis `C-u` avant de taper.

```bash
S=<session>
# provider → command:  claude → /context   ·   codex → /status   ·   kimi → (verify on its TUI)
tmux send-keys -t "$S" Escape; sleep 1
tmux send-keys -t "$S" C-u;    sleep 1          # clear the input line (mandatory)
tmux send-keys -t "$S" "/context"; sleep 1
tmux send-keys -t "$S" Enter;  sleep 3
PCT=$(tmux capture-pane -p -t "$S" | grep -aoE '[0-9.]+k?/[0-9.]+[km] tokens \([0-9]+%\)' | tail -1 | grep -aoE '\([0-9]+%\)' | tr -dc '0-9')
tmux send-keys -t "$S" Escape                   # dismiss the panel
echo "context=$PCT%"
```
Décide à partir de `$PCT` (extrait d'une ligne comme `24.9k/1m tokens (2%)`) :
- **`PCT` ≤ 50** → IGNORER **sauf si le TTL s'est déclenché à l'Étape 1.4**. NE recrée PAS une session sous le TTL, même si elle est vieille. Journalise `action=skipped_lowctx` avec le `%` mesuré. Passe à la session suivante.
- **`PCT` > 50** → procède au rafraîchissement (Étapes 2–7).
- **la commande ne s'est pas affichée / le parsing a échoué** → repli sur l'heuristique d'âge (`age ≥ 40min` → rafraîchir) et journalise `ctx=unparsed`.

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

**Deux exceptions impératives au PARKED — cette règle décrivait l'incident à la lettre et a gardé les mains du Dottore liées précisément quand l'équipe en avait le plus besoin :**
1. **Au-delà du TTL (Étape 1.4), PARKED ne s'applique pas.** Parquée ou non, une session de 12h+ est recréée.
2. **Un agent bloqué n'est pas un agent parqué.** « pas fraîche + produced == 0 + aucun message récent du Capitano » est aussi l'empreinte exacte d'une équipe dont la coordination est cassée. Le signal objectif qui les sépare : **un agent qui réessaie vers un autre agent sans réponse n'est pas parqué, il est bloqué** (les entrées `retry_loop` du scan d'`agent-unblock`, et le pane montre les tentatives). Idem pour « tous les opérationnels à l'arrêt avec du quota disponible ». Dans ces cas, NE journalise PAS `skipped_parked` — dénoue le blocage (`agent-unblock`), puis poursuis le tour.

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
  "action": "recreated",         # recreated | skipped_lowctx | skipped_parked | skipped_fresh
  "context_pct": 0,              # occupation du contexte mesurée à l'Étape 1.5 (le gate >50%)
  "resume_msg_sent": False,
}
with open(journal, "a") as f:
    f.write(json.dumps(entry, ensure_ascii=False) + "\n")
print("appended", session)
PY
```

## Étape 7 — recréer + reprendre (si le TTL s'est déclenché, OU contexte **>50%** et PAS fraîche, PAS parquée)
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
- **Le TTL de 12h n'a ni échappatoire ni interrupteur.** `JHT_AGENT_MAX_SESSION_AGE_H`, défaut `12`. Ni PARKED, ni skip-fresh, ni le seuil de contexte, ni « il travaille », ni le gate horaire ne peuvent l'annuler. **Échelonne-le** : les sessions naissent par vagues et expireraient ensemble — rafraîchis au maximum UNE session au-delà du TTL par passage, en ordonnant par âge **décroissant**, ainsi la plus vieille passe en premier et l'équipe n'est jamais recréée d'un seul coup.
- **Hors de la fenêtre de travail le tour ne tourne pas — mais le TTL, si.** La nuit le tour est sauté parce qu'interviewer les agents brûlerait du budget pour rien ; une session de 30 heures est recréée quand même, car un kick-off ne coûte rien face à une journée perdue. `agent-watchdog.sh` applique le même plafond de façon déterministe (même env var) pour quand le Dottore est arrêté, bloqué ou jamais lancé — ce qui est exactement ce qui s'est passé le 2026-07-28/29. Les deux chemins doivent exister : celui-ci est le refresh *riche* (rétrospective + resume), celui-là est le filet qui garantit le plafond à tout prix.
- **`working_hours: null` (ou absent, ou vide) signifie AUCUNE restriction horaire** — l'équipe est en 24/7 et le tour tourne normalement. Cela ne signifie jamais « toujours hors fenêtre ». Lors de l'incident, `working_hours` était null précisément parce que la réponse de l'utilisateur sur le fuseau horaire était la ligne restée en suspens dans le composer du Capitano.
- **Débloque avant de rafraîchir.** Exécute d'abord la phase `agent-unblock` : rafraîchir une équipe paralysée recrée la paralysie avec une fenêtre de contexte propre.
- **Un seul Dottore traite toutes les sessions ce tour** (ordre de l'utilisateur : un seul Dottore pour l'instant). Utilise la capture sur fichier + grep pour ne jamais faire exploser ta propre fenêtre de contexte.
- **CAPITANO et SENTINELLA sont les TOP consumers de token** (leur contexte est presque toujours surchargé — la Sentinella ticke toutes les ~15min, le Capitano coordonne en continu). Ils passent quand même par le **gate de contexte >50%** comme tout le monde (Étape 1.5) — mais en pratique ils mesurent bien au-dessus de 50%, donc ils sont rafraîchis presque à chaque tour. Fais-les en **dernier** (après les workers) et **compacte, ne réinitialise pas** — le refresh par synthèse dense préserve la continuité, un kill brut la perd. Si l'un mesure ≤50% (rare), saute-le ce tour-là comme n'importe quelle autre session à faible contexte.
- **CAPITANO** : c'est le coordinateur avec un état in-flight (assignations des workers, config de throttle active, dernier ordre de pacing, décisions en attente). Pendant l'entretien (Step 5), capture explicitement cet état de coordination et mets-le dans le seed (Step 7) pour qu'il ne perde pas le fil. **Si `$JHT_HOME/profile/capitano-maintenance.json` existe, lis-le et mets aussi ses `orders` actifs (mode maintenance + `stop_search` / `discard_expired_rotating` / weekly-recheck / geocoding) dans le seed** — retirer cet ordre de maintenance du seed a réduit au silence toute une semaine de maintenance le 2026-07-12 (le Capitano relit ensuite le fichier de toute façon selon sa propre règle C-18, mais reporte-le dans le seed pour ne jamais en dépendre). Fais-le en DERNIER ; s'il gère une EMERGENZA en direct (orchestration visible dans le pane à l'instant), laisse-le se stabiliser d'abord, sinon compacte-le.
- **SENTINELLA** : elle est **near-stateless** — son état de travail vit dans le bridge/config et dans `sentinel-data.jsonl`, pas dans sa chat. Cela en fait la **plus sûre et la plus rentable à compacter** : rafraîchis-la à chaque tour, en dernier, avec un seed minimal : `[RESUME] sei la Sentinella; il tuo stato vive nel bridge + sentinel-data.jsonl — riprendi il monitoraggio del pacing dal prossimo tick.` Le recreate par âge de l'`agent-watchdog` (au-delà de `JHT_SENTINELLA_MAX_CTX_AGE_H`, défaut 24h) ne reste qu'en **fallback** pour quand le Dottore ne tourne pas ; comme tu la compactes désormais à chaque tour elle n'atteindra pas cet âge, donc aucun race.
- **Ne jamais** faire `tmux new-session` à la main — toujours `start-agent.sh` (voir `spawn-agent`).
- Journalise chaque action dans le journal (`recreated`/`skipped_lowctx`/`skipped_parked`/`skipped_fresh`) avec la `context_pct` mesurée — le journal est la piste d'audit et s'enrichit chaque jour.
