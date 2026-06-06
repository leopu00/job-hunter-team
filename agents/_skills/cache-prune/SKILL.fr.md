<!-- @translation: fr, ai-translated 2026-06-06 -->
---
name: cache-prune
description: "Récupérer de l'espace disque sur les caches partagés JHT (cache de wheels `uv` + log SQLite `codex`) toutes les ~24h. Propriété du Dottore — instance unique, exécuté à la fin d'un tour de routine quand l'équipe est inactive. Ne jamais exécuter en pleine urgence : le VACUUM SQLite bloque pendant ~30s sur une DB de 200 Mo et volerait des cycles à une récupération pilotée par la Sentinella. Migré depuis le Capitano pour que celui-ci reste concentré sur la coordination, pas la maintenance."
allowed-tools: Bash(node /app/cli/bin/jht.js cache *), Bash(du *), Bash(df *)
---

# cache-prune — récupérer les caches partagés

Le `$JHT_HOME` partagé accumule deux caches qui croissent de manière monotone jusqu'à récupération :

| Chemin                                | Ce qu'il stocke                         | Croissance typique (échantillon 2026-05-02) |
|---------------------------------------|-----------------------------------------|------------------------------------|
| `$JHT_HOME/.cache/uv/`                | cache de wheels pour chaque `uv pip install`  | ~364 Mo                            |
| `$JHT_HOME/.codex/logs_2.sqlite`      | télémétrie SQLite Codex (71% de lignes TRACE) | ~223 Mo                            |

Ni l'un ni l'autre n'est nécessaire sur le disque : uv retélécharge si besoin, Codex tronque les lignes TRACE en toute sécurité. Les chiffres ci-dessus proviennent d'une exécution continue ; sur un `$JHT_HOME` neuf, ils commencent à 0 et atteignent des centaines de Mo en quelques jours.

## La seule commande sûre

```bash
node /app/cli/bin/jht.js cache prune
```

Idempotente et sans effet quand il n'y a rien à récupérer. En interne :
1. `uv cache prune` — supprime les wheels obsolètes (conserve le jeu actif référencé par les installations courantes).
2. SQLite `VACUUM` sur `logs_2.sqlite` après suppression des anciennes lignes TRACE.
3. Nettoyage des fichiers temporaires éphémères de Codex.

Chaque étape a une porte de sécurité : `idle > 1h` sur les opérations destructives (verrou VACUUM, suppression TRACE) — si l'équipe brûle activement des tokens, l'étape est sautée.

## Quand exécuter

- 👨‍⚕️ **Fin d'un tour de routine du Dottore** (~24h d'exécution continue, ou au début d'une journée opérationnelle inactive).
- 📉 **À la demande** si `du -sh $JHT_HOME/.cache $JHT_HOME/.codex` montre une croissance > 800 Mo au total.
- 🚫 **JAMAIS** en plein budget critique (proj > 95%) — le VACUUM de 30s bloque le SQLite Codex que la Sentinella lit via le bridge.
- 🚫 **JAMAIS** en réaction à un `[ORDINE]` de la Sentinella — les ordres exigent des actions de pacing/scaling, pas de la maintenance.

## Sécurité : ce qu'il NE FAUT PAS toucher

L'équipe a d'*autres* caches qui ressemblent mais ne sont PAS dans le périmètre ici :

| Chemin                               | Pourquoi ne pas y toucher                                         |
|--------------------------------------|-------------------------------------------------------------------|
| `.cache/ms-playwright/`              | binaires navigateur épinglés par version — re-télécharger est lent + instable |
| `.cache/claude-cli-nodejs/`          | cache runtime CLI Anthropic, recréé paresseusement mais plus gros à chaud |
| `$JHT_HOME/logs/`                    | L'état de la Sentinella y réside. L'effacer perd la fenêtre EMA et plusieurs minutes d'historique de monitoring. |

Le rayon d'impact de `cache prune` se limite aux deux chemins du tableau en haut.

> ⚠️ **`cache clear` est interdit.** Cette commande (une cousine destructive de `cache prune` exposée par `jht`) efface `logs/` en même temps que les caches, détruisant l'état de la Sentinella. Si jamais vous ressentez l'envie de faire `cache clear`, escaladez vers l'utilisateur à la place.

## Croissance anormale — escalader

Si `du -sh` montre un chemin *en dehors* des 2 cibles ci-dessus qui croît rapidement (ex. `.cache/ms-playwright/` a doublé, `.codex/sessions/` qui gonfle), ne le prunez PAS vous-même. Capturez :

```bash
du -sh $JHT_HOME/.cache/* $JHT_HOME/.codex/*
df -h $JHT_HOME
```

…loguez-le dans `dottore-actions.jsonl` avec `event=disk_anomaly` + la sortie `du`, et faites remonter à l'utilisateur via le Capitano (`jht-tmux-send CAPITANO`). Un nouveau chemin en croissance pourrait signifier qu'un nouvel outil a été ajouté sans budget pour le nettoyage.

## Sortie vers le log

Ajouter à `/jht_home/logs/dottore-actions.jsonl` :

```json
{"ts": "ISO-UTC", "round_id": "...", "event": "cache_prune",
 "uv_freed_mb": 142, "codex_freed_mb": 87, "total_freed_mb": 229,
 "duration_sec": 31}
```

Si une étape a été sautée par la porte d'inactivité, mettre le `_freed_mb` correspondant à `null` et ajouter `"skipped": ["vacuum"]`.

## Anti-patterns

- ❌ Exécuter `cache prune` depuis le Capitano — cette responsabilité a été migrée ici. Le Capitano coordonne, le Dottore maintient.
- ❌ L'exécuter pendant qu'un Scrittore est en plein CV (sa boucle touche occasionnellement le cache uv pour les libs pandoc/typst).
- ❌ Ajouter une boucle de type cron dans le prompt du Dottore — le Dottore est one-shot avec une cadence de ~30 min, vous insérez cache-prune en fin de tour quand c'est pertinent, pas selon un planning fixe.
- ❌ Contourner le wrapper `jht.js cache prune` pour exécuter `uv cache prune` / `sqlite vacuum` directement — vous sautez la porte d'inactivité et le logging unifié.

## Voir aussi

- `agents/dottore/dottore.md` — quand dans le cycle de vie du Dottore insérer cette skill (fin de tour uniquement).
- `py-tools-audit` — skill de maintenance sœur (packages Python, cadence ~hebdomadaire).
- `agents/_team/team-rules.md` T13 — la règle uv-comme-seul-installateur (pourquoi le cache uv existe en premier lieu).
