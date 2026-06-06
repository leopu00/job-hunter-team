<!-- @translation: fr, ai-translated 2026-06-06 -->
---
name: cv-disk-audit
description: Vérification de santé périodique (Dottore) pour réconcilier les CV sur disque et cv_pdf_path dans la DB. Identifie les orphelins (fichier sur disque sans ligne DB) et les fantômes (ligne DB avec cv_pdf_path pointant vers un fichier inexistant). Notifie le Capitano sur les incohérences pour que l'utilisateur ne perde pas les meilleurs PASS invisibles et ne voie pas "CV à écrire" pour des CV déjà écrits.
allowed-tools: Bash(python3 *), Bash(find *), Bash(stat *), Bash(jht-tmux-send *)
---

# cv-disk-audit — réconciliation disque↔DB des CV

Le bug #26 a révélé le pattern : le Scrittore génère le PDF, est tué (EMERGENZA freeze 2026-05-17 04:43) avant l'UPDATE DB. Le fichier reste sur `/jht_user/cv/`, mais `applications.cv_pdf_path` reste NULL. Sisal 7.5/10 (meilleur PASS de la fenêtre) était devenu *"CV à écrire"* sur le tableau de bord utilisateur — invisible.

Le correctif préventif (écriture atomique dans la skill `cv-structure`) empêche les nouveaux orphelins. Cet audit recoud ceux déjà existants et capture toute nouvelle divergence qui pourrait apparaître (ex. utilisateur déplace un PDF manuellement, watchdog tue le Scrittore pendant le renommage).

## Quand le lancer

Déclencheur Dottore (fin de tour, hors budget critique) :
- Toujours au premier tour après une EMERGENZA / kill d'un Scrittore.
- Sinon ~tous les 4 tours Dottore (≈2h, vu le tour de 30 min).

Le Dottore exécute cette skill APRÈS `liveness-check` et AVANT `cache-prune` — l'audit est informatif, pas destructif.

## Procédure

```bash
# 1. Snapshot disque
DISK_PDFS=$(find /jht_user/cv -maxdepth 1 -type f -name '*.pdf' 2>/dev/null | sort)

# 2. Snapshot DB (cv_pdf_path != NULL)
DB_PDFS=$(python3 /app/shared/skills/db_query.py cv-pdf-paths 2>/dev/null | sort)

# 3. Diff
ORFANI=$(comm -23 <(echo "$DISK_PDFS") <(echo "$DB_PDFS"))     # disque mais pas DB
GHOST=$(comm -13 <(echo "$DISK_PDFS") <(echo "$DB_PDFS"))      # DB mais pas disque

# 4. Rapport au Capitano (déterministe, pas de LLM)
if [ -n "$ORFANI$GHOST" ]; then
  msg="[@dottore -> @capitano] [REPORT] CV audit mismatch — "
  msg="${msg}orfani=$(echo "$ORFANI" | grep -c .) "
  msg="${msg}ghost=$(echo "$GHOST" | grep -c .)"
  jht-tmux-send CAPITANO "$msg"
  # Log détails
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  echo "{\"ts\":\"$ts\",\"orfani\":$(echo "$ORFANI" | jq -R . | jq -s .),\"ghost\":$(echo "$GHOST" | jq -R . | jq -s .)}" \
    >> /jht_home/logs/cv-disk-audit.jsonl
fi
```

`db_query.py cv-pdf-paths` (à implémenter) : écrit 1 chemin par ligne de toutes les applications avec `cv_pdf_path IS NOT NULL`. Une ligne adaptée au script pour le `comm`.

## Ce que fait le Capitano avec le rapport

Il reçoit `[REPORT] CV audit mismatch — orfani=2 ghost=0`. Ouvre `/jht_home/logs/cv-disk-audit.jsonl`, lit les orphelins, et pour chacun tente le match heuristique :

1. `CV_<Candidato>_<position_id>_<...>.pdf` — nouveau nommage bug #25 → extrait `position_id`, fait `db_update.py application <pid> --cv-pdf-path <path>`.
2. `CV_<Candidato>_<Company>.pdf` — ancien nommage → cherche l'application draft de cette entreprise sans cv_pdf_path. S'il en trouve une seule → raccorde. S'il en trouve plus d'une → signale à l'utilisateur (Sisal vs Leadtech vs Canonical : cas ambigu du 2026-05-17).

Le Capitano NE supprime PAS de fichier (jamais). Il déplace dans `/jht_user/cv/_orphan/` s'il veut archiver sans perdre.

## Anti-patterns

- ❌ Auto-raccorder un orphelin avec `cv_pdf_path` quand il y a plusieurs applications draft pour la même entreprise — ambiguïté, laisser décider l'utilisateur.
- ❌ Supprimer un orphelin : les CV représentent un coût cognitif élevé, toujours archiver plutôt que `rm`.
- ❌ Exécuter l'audit pendant une EMERGENZA : le Dottore ne doit tourner qu'en fin de tour en régime normal.

## Voir aussi

- `cv-structure` § Génération PDF (W-03 écriture atomique, bug #26)
- `application-flow` Étape 6 (nommage avec position_id, bug #25)
- `db-update` § Porte d'écriture unique (bug #21)
- `liveness-check` (exécuté avant dans le même tour Dottore)
