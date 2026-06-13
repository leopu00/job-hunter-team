<!-- @translation: fr, ai-translated 2026-06-06 -->
---
name: salary-estimate
description: Estimation salariale hiérarchique pour le Scorer (bug #27). 4 niveaux — fourchette déclarée (L1), cache local (L2), web search (L3), default neutre (L4). Cache local réservé aux Scorer, pas de sync distant. TTL 30 jours car les salaires changent d'année en année, pas de semaine en semaine. Utilise la skill chaque fois que tu t'apprêtes à écrire `salary_fit` : sans elle, 95% des positions finissent avec `salary_fit=5/10` neutre (de facto inerte).
allowed-tools: Bash(python3 /app/shared/skills/salary_estimate.py *), Bash(python3 /app/shared/skills/db_update.py *)
---

# salary-estimate — estimation hiérarchique avec cache local

## Pourquoi elle existe

Snapshot 2026-05-17 (43 scores Kimi) : 41 scores sur 43 avec
`salary_fit=5/10` (default "no data no bias"), 2 avec des valeurs
réelles issues d'un JD explicite. Résultat : salary_fit (poids 10/100)
était *de facto* inerte — espace décisionnel du Scorer réduit de 100
à 95.

Cause : personne ne remplissait `salary_estimated_*`. Le Scorer est
honnête, il n'invente pas, et sans donnée il retombe sur le default.
Décision utilisateur : construire un cache local des estimations pour
que la première fetch coûte, et les suivantes soient gratuites.
*"Les salaires ne changent pas de semaine en semaine, mais d'année en
année"*.

## 4 niveaux (dans l'ordre, arrêt au premier qui produit une fourchette)

### NIVEAU 1 — Fourchette déclarée (position)
Si `positions.salary_declared_min` et `salary_declared_max` ne sont pas
NULL → utilise ceux-là, pas d'estimation. Le Writer peut appeler :

```bash
python3 /app/shared/skills/salary_estimate.py --position-id 42
```

Le script lit les declared depuis la DB et retourne `level=1` avec les
chiffres.

### NIVEAU 2 — Cache local
Path : `/jht_home/.cache/salary_estimates.json`. Clé :
`(stack, seniority, country, mode)`. TTL 30 jours.

```bash
python3 /app/shared/skills/salary_estimate.py \
    --stack python --seniority junior --country IT --mode remote
```

Hit → JSON avec `level=2, source=cache, min, max`. Miss → retombe sur
L3 ou L4.

### NIVEAU 3 — Web search (stub, dépend de F-2)
Pour l'instant retourne None : la skill retombe directement sur L4.
Quand F-2 (Scout web access) sera disponible, le Scout/Analyste
remplira le cache via web search Glassdoor/Levels/Indeed. À partir de
ce moment, le premier lookup d'une nouvelle combinaison fait une seule
fetch, puis 29 jours de hits gratuits.

### NIVEAU 4 — Default neutre + flag
Si tous les niveaux précédents échouent → retourne `level=4, min=null,
max=null, estimation_failed=true, reason="no_data_default"`. Le Scorer
met `salary_fit=5` ET ajoute `no_data_default` dans `score.notes` —
ainsi le Mentor (downstream) ne propage pas le 5 comme donnée réelle
mais comme "N/D" (voir bug #27 fix Mentor).

## Output schema

```json
{
  "level": 1 | 2 | 3 | 4,
  "min": int | null,
  "max": int | null,
  "currency": "EUR",
  "source": "declared" | "cache" | "web" | "default",
  "fetched_at": "YYYY-MM-DD",
  "estimation_failed": false | true,
  "reason": "<optional>"
}
```

## Ce que fait le Scorer avec le résultat

```bash
result=$(python3 /app/shared/skills/salary_estimate.py \
    --stack "$STACK" --seniority "$SENIORITY" \
    --country "$COUNTRY" --mode "$MODE" \
    --declared-min "$DECL_MIN" --declared-max "$DECL_MAX")

# 1. Extraire les champs
min=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['min'] or '')")
max=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['max'] or '')")
failed=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin).get('estimation_failed', False))")

# 2. S'il a des chiffres réels, remplir positions.salary_estimated_*
if [ -n "$min" ] && [ -n "$max" ]; then
  python3 /app/shared/skills/db_update.py position "$POS_ID" \
    --salary-estimated-min "$min" --salary-estimated-max "$max" \
    --salary-estimated-source "salary-estimate"
fi

# 3. Calculer salary_fit (0-10) avec ta logique existante
#    (comparaison avec le target du candidat depuis candidate_profile.salary_annual_eur)
#    et inclure la note "no_data_default" si failed=True.
```

## Seed-cache dev-only

Pour préchauffer le cache sur un nouveau container (ex. test) :

```bash
python3 /app/shared/skills/salary_estimate.py --seed-cache \
    --stack python --seniority junior --country IT --mode remote \
    --declared-min 28000 --declared-max 38000
```

En production le cache se réchauffe tout seul : L1 (declared du JD) +
futur L3 (web search) le remplissent organiquement en l'espace d'une
semaine d'activité.

## Anti-patterns

- ❌ Web fetch à chaque position — le cache existe précisément pour
  l'éviter. Même `python junior IT remote` exécuté 10 fois =
  9 fetches gaspillées.
- ❌ TTL agressif (1 jour) — les salaires ont une granularité annuelle,
  rafraîchir tous les jours c'est zero-info-gain + gaspillage.
- ❌ Sauvegarder les declared dans le cache — le declared est déjà dans
  la DB de la position, inutile de le dupliquer dans le cache
  d'estimations.
- ❌ Sync du cache sur Supabase — c'est un cache **local aux Scorer**,
  il ne doit être ni sauvegardé ni partagé. Il se régénère de zéro en
  quelques jours.

## Voir aussi

- `agents/_skills/db-update/SKILL.md` § Positions — `salary-estimated-*`
- `candidate_profile.yml.example` — `salary_annual_eur` (target du candidat,
  side-fix bug #27)
- `agents/_skills/mentor-output/SKILL.md` — masque le "5 passif" quand
  `notes` contient `no_data_default`
