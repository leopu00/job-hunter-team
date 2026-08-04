<!-- @translation: fr, ai-translated 2026-06-06 -->
---
name: expiration-tracking
description: Extrait les echeances des offres et fournit des informations factuelles uniquement apres une demande explicite de l'utilisateur. Ne notifie ni ne relance jamais automatiquement.
allowed-tools: Bash(python3 /app/shared/skills/deadline_extract.py *), Bash(python3 /app/shared/skills/expiration_alerts.py *)
---

# expiration-tracking — donnees d'echeance sur demande

Les echeances aident l'utilisateur a evaluer les opportunites. Conserve-les avec precision, mais ne les transforme pas en rappel, invitation a candidater ou mesure de progres.

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

## C. Information d'echeance, uniquement sur demande

Utilise cette section uniquement en reponse a la question explicite de l'utilisateur sur l'echeance d'un poste ou d'une candidature. Ne la planifie jamais, ne l'envoie pas de maniere proactive et ne transfere jamais sa sortie comme notification.

Execute : python3 /app/shared/skills/expiration_alerts.py --user-requested

La sortie fournit des informations factuelles sur les echeances des postes deja presents dans les donnees de l'utilisateur, par exemple : [DEADLINE] Sisal Data Analyst (PASS 7.5) — expire le 2026-05-18 (demain).

## B. Re-vérification périodique des positions anciennes (Analista) — À FAIRE

Extension future de la skill `liveness-check` : toutes les 6h, refetch URL des positions en `status IN ('scored', 'ready')` avec `last_checked < NOW() - 12h`. Si l'URL retourne 404 / "no longer accepting" → flip à `status='expired'` + note. Hors scope pour F-4 initial ; le bottom-up des deadlines capturées depuis le JD couvre la majorité des cas.

## Anti-patterns

- Ne lance pas le rapport d'echeance sans demande explicite de l'utilisateur.
- Ne transforme pas l'information d'echeance en invitation, rappel ou pression a candidater.

## Voir aussi

- `shared/skills/deadline_extract.py` — parseur
- shared/skills/expiration_alerts.py — rapport d'echeance sur demande
- `agents/_skills/db-update/SKILL.md` § Positions — flag `--deadline`
