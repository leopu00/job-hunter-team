<!-- @translation: fr, ai-translated 2026-06-06 -->
---
name: db-update
description: Mettre à jour des enregistrements existants dans la DB JHT (positions / applications). À utiliser pour promouvoir les positions en checked/excluded, écrire le score/verdict du Critico, marquer les applications comme envoyées, mettre à jour le salaire, last-checked, etc. Toujours après un `db-query` qui confirme l'état actuel de l'enregistrement.
allowed-tools: Bash(python3 *)
---

# db-update — mises à jour d'enregistrements dans la DB JHT

Wrapper dans `/app/shared/skills/db_update.py`. Met à jour des champs spécifiques sur des enregistrements existants. **Ne crée pas** d'enregistrements — pour cela, voir `db-insert`.

## Pattern général

```bash
python3 /app/shared/skills/db_update.py <table> <id> --<field> <value> [--<field> <value>...]
```

Tables : `position`, `application`.

## Positions

```bash
# Promouvoir en checked / excluded (travail de l'Analista)
python3 /app/shared/skills/db_update.py position 42 --status checked
python3 /app/shared/skills/db_update.py position 42 --status excluded

# Marqueur last-checked (lien confirmé vivant — aussi utilisé comme revendication anti-collision)
python3 /app/shared/skills/db_update.py position 42 --last-checked now

# Liveness : --is-open / --last-open-check font avancer aussi last_checked,
# donc une position revérifiée sort de la file de soin (qui filtre sur la plus
# récente des deux dates). --last-checked seulement pour la forcer.
python3 /app/shared/skills/db_update.py position 42 --is-open false --last-open-check now

# Salaire tel que déclaré dans le JD
python3 /app/shared/skills/db_update.py position 42 --salary-declared-min 40000 --salary-declared-max 55000

# Salaire estimé (glassdoor / levels.fyi / estimation de l'analista)
python3 /app/shared/skills/db_update.py position 42 --salary-estimated-min 35000 --salary-estimated-max 50000 --salary-estimated-source glassdoor

# Famille de rôle (catégorie sémantique).
python3 /app/shared/skills/db_update.py position 42 --role-family "Technical Writing"

# Location structurée (Analista). Exemple complet pour "Dublin, Ireland" hybrid :
python3 /app/shared/skills/db_update.py position 42 \
  --loc-city "Dublin" --loc-region "Leinster" \
  --loc-country "Ireland" --loc-country-code "IE" \
  --loc-continent "Europe" \
  --work-mode "hybrid" \
  --work-country "Ireland" --work-country-code "IE" \
  --is-multi-location false

# Exemples de cas spéciaux:
# A) "Europe Remote" → country=NULL, continent=EU, work_country du HQ de l'entreprise
python3 /app/shared/skills/db_update.py position 42 \
  --loc-continent "Europe" --work-mode "remote" \
  --work-country "United States" --work-country-code "US" \
  --location-notes "Remote within EU, US-based company"

# B) "Italy" + full_remote
python3 /app/shared/skills/db_update.py position 42 \
  --loc-country "Italy" --loc-country-code "IT" --loc-continent "Europe" \
  --work-mode "remote" --work-country "Italy" --work-country-code "IT"

# E) Multi-location même pays ("Barcelona / Malaga")
python3 /app/shared/skills/db_update.py position 42 \
  --loc-country "Spain" --loc-country-code "ES" --loc-continent "Europe" \
  --work-mode "hybrid" --work-country "Spain" --work-country-code "ES" \
  --is-multi-location true --location-notes "Barcelona or Málaga (candidato sceglie)"

# Pour "nettoyer" un champ (set NULL) passer une chaîne vide :
python3 /app/shared/skills/db_update.py position 42 --loc-city ""
```

## Applications

```bash
# Verdict du Critico (par tour : NEEDS_WORK / PASS / REJECT) + score 0-10 + notes
python3 /app/shared/skills/db_update.py application 42 --critic-verdict NEEDS_WORK --critic-score 5.0 --critic-notes "needs more detail on project X"

# CV/lettre de motivation validés (le Scrittore marque comme écrits)
python3 /app/shared/skills/db_update.py application 42 --written-at now

# Promouvoir en ready après PASS du Critico — Scrittore uniquement, dans application-flow Étape 7
python3 /app/shared/skills/db_update.py application 42 --status ready

# L'utilisateur a confirmé l'envoi de la candidature
python3 /app/shared/skills/db_update.py application 42 --applied-at "2026-02-28" --applied-via linkedin
python3 /app/shared/skills/db_update.py application 42 --applied true

# Réponse reçue (`interview` / `rejected` / `ghosted`)
python3 /app/shared/skills/db_update.py application 42 --response "rejected" --response-at now
```

### Les transitions d'état de position sont auto-loguées (bug #14)

Chaque appel à `db_update.py position <id> --status <s>` qui change effectivement `positions.status` insère une ligne dans `position_state_transitions` avec `from_state`, `to_state`, `ts`, `by_agent` (depuis `JHT_AGENT_NAME`), et le `--notes` que vous avez passé (le cas échéant). Idem pour le `db_insert.py position` initial (logué comme `NULL → 'new'`).

Vous n'avez rien à faire — le wrapper s'en charge. Ne le contournez pas avec du SQL brut : un contournement `python3 -c "import sqlite3; UPDATE positions SET status=..."` saute le log de transition et fait sous-compter les graphiques de throughput / funnel.

### Porte d'écriture unique sur `applications.status='ready'` (bug #21)

`applications.status='ready'` est **défini exclusivement par le Scrittore** dans `application-flow` Étape 7, **uniquement après** un PASS du Critico au 3e tour. C'est la porte qui rend le CV visible sur le tableau de bord `/ready` de l'utilisateur. Les autres agents :

- **Critico** : écrit `critic_verdict` + `critic_score` uniquement. Jamais `status`.
- **Capitano** : n'écrit jamais `applications.status`. Peut le lire.
- **Mentor / Assistente** : lecture seule sur `applications`.

Sans cette porte, le Capitano peut rapporter "12 ready" verbalement tandis que la DB montre toujours 0 — exactement la divergence que le bug #21 a corrigée.

## Règles de sécurité

1. **Lire d'abord.** Exécuter `db-query position <id>` (ou `application`) pour voir l'état actuel avant d'écrire. Les écrasements aveugles produisent des enregistrements incohérents.
2. **Le flux de statut est unidirectionnel.** Transitions légitimes : `new → checked → scored → writing → ready → applied → response`. `excluded` est accessible depuis n'importe quelle étape mais aucune étape ne revient en arrière. Ne pas inverser.
3. **Timestamp `now`.** Le wrapper convertit la chaîne littérale `now` en timestamp actuel. Ne pas passer `$(date)` — le parsing est géré côté Python.
4. **Tags d'exclusion dans `--notes`.** Lors du marquage d'une position `excluded`, préfixer les notes avec l'un des tags canoniques : `[LINK_MORTO]` · `[SCAM]` · `[GEO]` · `[LINGUA]` · `[SENIORITY]` · `[STACK]`. Même taxonomie utilisée par l'Analista (voir `agents/analista/analista.md` REGOLA-06).

## Ne pas l'utiliser pour

- Lectures : utiliser **`db-query`**
- Création d'enregistrements : utiliser **`db-insert`** (seul le Scout INSÈRE des positions)
- Changements de schéma : ne jamais exécuter du `sqlite3` brut contre les tables — cela contourne les clés étrangères et le journaling WAL de Next.js
