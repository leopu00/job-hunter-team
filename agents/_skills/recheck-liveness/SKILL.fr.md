<!-- @translation: fr, ai-translated 2026-08-03 -->
---
name: recheck-liveness
description: "Vérifie si une offre est TOUJOURS OUVERTE sans produire de faux ouverts. Remplace le curl improvisé (HTTP 200 = « ouverte ») qui NE voit PAS l'expiration rendue en JavaScript (Ashby/Workday/Greenhouse) ni l'authwall de LinkedIn (200 également pour les offres fermées). À utiliser TOUJOURS dans le recheck ; ne jamais fixer is_open à la main sur la base d'un seul HTTP 200."
allowed-tools: Bash(python3 /app/shared/skills/recheck_liveness.py *)
---

# recheck-liveness — « l'offre est-elle toujours ouverte ? », fait correctement

## Pourquoi elle existe
L'ancien recheck était un curl improvisé (`code=200 marker=none → ouverte`). curl ne voit que le
HTML BRUT : sur beaucoup d'ATS (Ashby/Workday/Greenhouse) et sur LinkedIn, le statut
« expirée/fermée » est rendu en JS ou se trouve derrière un authwall → curl ne le voit pas →
`is_open=1` sur des offres déjà FERMÉES. Données sales en aval (score, carte).

## Comment l'utiliser
```sh
python3 /app/shared/skills/recheck_liveness.py "<url>" "[titre facultatif]"
```
Sortie JSON + exit code :
| state | exit | signification |
|---|---|---|
| `OPEN` | 0 | ouverture vérifiée |
| `CLOSED` | 1 | fermée/expirée (404/410 ou marqueur de fermeture) |
| `OPEN_UNVERIFIED` | 2 | impossible à vérifier (hôte JS/authwall + navigateur indisponible) |

## Ce qu'elle fait (par paliers)
1. **curl** rapide : code HTTP + recherche des marqueurs de fermeture (EN+IT) + 404/410.
2. hôte **ATS-JS / LinkedIn** ou code ambigu → **escalade vers le NAVIGATEUR**
   (rendu Playwright) et nouvelle recherche des marqueurs sur le HTML RENDU.
3. toujours incertain → **`OPEN_UNVERIFIED`** — JAMAIS un faux ouvert (motif `resilience`).

## Règle d'or
- `is_open=1` **UNIQUEMENT** si `state == OPEN`.
- `state == CLOSED` → `status='expired'` + une note reprenant l'`evidence`.
- `state == OPEN_UNVERIFIED` → **laisser `is_open` inchangé** + une note `[OPEN_UNVERIFIED]` ;
  ne pas la faire passer pour ouverte.
- Le curl improvisé « 200 = ouverte » est **interdit** comme moyen de décider de la liveness.
