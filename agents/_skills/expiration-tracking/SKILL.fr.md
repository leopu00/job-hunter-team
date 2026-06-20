<!-- @translation: fr, ai-translated 2026-06-06 -->
---
name: expiration-tracking
description: Extraire les dates limites du JD (helper deadline_extract) et produire des alertes utilisateur quand une candidature READY est sur le point d'expirer (helper expiration_alerts, idempotent). F-4 task #50. Scout/Analista remplissent positions.deadline, Mentor/Capitano notifient l'utilisateur quand deadline-now ≤ 3 jours.
allowed-tools: Bash(python3 /app/shared/skills/deadline_extract.py *), Bash(python3 /app/shared/skills/expiration_alerts.py *), Bash(jht-telegram-send *)
---

# expiration-tracking — ne pas perdre les meilleurs PASS par expiration

Bug latent F-4 : l'utilisateur accumule 50 CV `ready`, oublie de postuler pendant 2 jours, la meilleure opportunité (ex. Sisal PASS 7.5) expire en silence. Le pipeline est user-curated apply (bug #9 déclassé) → sans alerte proactive, le zèle de l'équipe à entraîner les meilleurs CV est annulé par le silence de l'utilisateur.

## A. Scout/Analista : extraction de la deadline du JD

Quand vous insérez une nouvelle position (Scout) ou quand vous enrichissez le JD (Analista), passez le texte par `deadline_extract` :

```bash
# CLI direct : extrait depuis stdin ou --jd
echo "$JD_TEXT" | python3 /app/shared/skills/deadline_extract.py
# → 2026-06-15 (date ISO) ou chaîne vide

# En ligne dans db_insert.py position
deadline_iso=$(echo "$JD_TEXT" | python3 /app/shared/skills/deadline_extract.py)
if [ -n "$deadline_iso" ]; then
  python3 /app/shared/skills/db_insert.py position \
    --title "$TITLE" --company "$COMPANY" --url "$URL" \
    --jd-text "$JD_TEXT" \
    --deadline "$deadline_iso"  # ← nouveau, F-4
fi
```

Le parseur est **conservateur** (uniquement ISO, dd/mm/yyyy EU, Month dd[, yyyy] EN/IT, "expires in N days"). S'il ne trouve pas de match à haute confiance, il retourne une chaîne vide → mieux vaut NULL en DB qu'une date inventée.

## C. Mentor/Capitano : alerte utilisateur proactive

Déclencheur recommandé : après chaque `[BRIDGE TICK]` (Capitano) ou fin de passe du Mentor. L'idempotence fait que des appels fréquents ne produisent des alertes que pour les NOUVELLES paires (app_id, deadline_iso).

```bash
alerts=$(python3 /app/shared/skills/expiration_alerts.py)
if [ -n "$alerts" ]; then
  # Envoyer à l'utilisateur via Telegram
  echo "$alerts" | jht-telegram-send --from capitano --keyboard capitano
fi
```

Sortie 1 ligne par application à risque :
```
⏳ [ALERT scadenza] Sisal Data Analyst (PASS 7.5) — scade 2026-05-18 (DOMANI). Spedisci candidatura o perdi l'opportunità.
```

L'état d'idempotence est dans `$JHT_HOME/state/expiration_alerts_sent.json` (ensemble de `(app_id, deadline_iso)` déjà notifiés). Pour renvoyer une alerte déjà envoyée : `expiration_alerts.py --reset` (dev uniquement).

## B. Re-vérification périodique des positions anciennes (Analista) — À FAIRE

Extension future de la skill `liveness-check` : toutes les 6h, refetch URL des positions en `status IN ('scored', 'ready')` avec `last_checked < NOW() - 12h`. Si l'URL retourne 404 / "no longer accepting" → flip à `status='expired'` + note. Hors scope pour F-4 initial ; le bottom-up des deadlines capturées depuis le JD couvre la majorité des cas.

## Anti-patterns

- ❌ Parser les deadlines à la main avec des regex en ligne — utiliser le helper, il a un fallback EN/IT + contrôle de cohérence sur les dates passées.
- ❌ Inventer une deadline quand le JD ne la spécifie pas explicitement — mieux vaut `NULL` qu'un `+30j arbitraire`.
- ❌ Spammer l'utilisateur avec la même alerte toutes les 6h — l'état d'idempotence existe justement pour cela.
- ❌ Envoyer l'alerte depuis un bot différent du Capitano (ex. Assistente générique) — perd le contexte opérationnel ; le Capitano l'accompagne vers le pipeline.

## Voir aussi

- `shared/skills/deadline_extract.py` — parseur
- `shared/skills/expiration_alerts.py` — émetteur + état d'idempotence
- `agents/_skills/db-update/SKILL.md` § Positions — flag `--deadline`
