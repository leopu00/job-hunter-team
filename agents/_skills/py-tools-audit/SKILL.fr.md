<!-- @translation: fr, ai-translated 2026-06-06 -->
---
name: py-tools-audit
description: "Nettoyage coordonné à l'échelle de l'équipe des paquets Python installés sous `$JHT_HOME/.local` via `uv pip install --user` (T13 magazzino). Géré par le Dottore. L'audit N'EST PAS unilatéral — seuls les agents Writer / Critic savent si une bibliothèque importée dynamiquement leur est encore utile, d'où le flux : broadcast → fenêtre de consentement de 1h → désinstaller l'ensemble silencieux → ré-audit. Comme le Dottore est one-shot (~10 min par round, ~30 min d'intervalle), la fenêtre de consentement de 1h couvre 2 rounds du Dottore : le round N lance l'audit + broadcast, le round N+1 collecte les réponses + désinstalle."
allowed-tools: Bash(python3 /app/shared/skills/py_tools_audit.py *), Bash(uv pip uninstall *), Bash(jht-tmux-send *), Bash(tmux *), Bash(du *), Bash(xargs *)
---

# py-tools-audit — nettoyer le magazzino Python partagé

`$JHT_HOME/.local/lib/python3.x/site-packages/` est la **seule user-base partagée** dans laquelle tous les agents lisent (T13). N'importe quel agent peut faire `uv pip install --user <pkg>` quand il a besoin d'une bibliothèque, mais les agents *ne* désinstallent *pas* quand ils changent d'approche — les paquets s'accumulent. Environ chaque semaine, le magazzino dépasse 800 Mo et nécessite un audit coordonné.

L'audit est coordonné car un `import` grep statique peut rater des bibliothèques chargées dynamiquement à l'exécution (par exemple un script dans `tools/` que le Writer appelle uniquement quand une JD exige un format spécifique). D'où la règle : demander avant de supprimer.

## Déclencheur

- ⏰ ~hebdomadaire (tous les 7 jours d'exécution continue), au début d'un jour opérationnel calme
- 📈 à la demande quand `du -sh /jht_home/.local` > 800 Mo
- 🚀 avant une release majeure / remise à l'utilisateur

## Flux en deux rounds (car le Dottore est one-shot)

```
Round N:    audit → broadcast des candidats → sauvegarde du fichier d'état
…30 min…
Round N+1:  collecte des réponses → calcul du keep_set → désinstallation → ré-audit → rapport
```

Chaque round enregistre sa phase dans `$JHT_HOME/logs/py-audit-state.json` :

```json
{"phase": "broadcast_sent", "round_id": "...", "ts": "ISO-UTC",
 "candidates": ["pymupdf", "pdfminer.six", "reportlab", "..."],
 "broadcast_at": "ISO-UTC"}
```

Quand tu te réveilles, **vérifie ce fichier en premier** :
- fichier absent ou `phase=done` → nouveau round, va à « Round N » ci-dessous
- `phase=broadcast_sent` et `now - broadcast_at >= 1h` → « Round N+1 » ci-dessous
- `phase=broadcast_sent` et `now - broadcast_at < 1h` → la fenêtre de consentement n'est pas encore fermée, saute l'audit ce round-ci

## Round N — lancer l'audit

### 1. Vérification du seuil

```bash
python3 /app/shared/skills/py_tools_audit.py --threshold-mb 800
```

- Exit `0` → rien d'urgent. Arrête-toi ici, pas de broadcast.
- Exit `2` → le nettoyage vaut le coup. Le script affiche aussi la *table des candidats* — paquets sans import actif, hors whitelist (dépendances transitives + CLIs binaires épinglés).

### 2. Broadcast à chaque agent

Envoie un message `[PY-AUDIT]` à chaque session d'agent active via `jht-tmux-send` :

```
[@dottore -> @<role>] [PY-AUDIT] candidates uninstall: pymupdf,
pdfminer_six, reportlab, weasyprint, pypdf, ...
If you USE one of these, reply within 1h with [KEEP <pkg>].
Silence = consent to uninstall.
```

La fenêtre de 1h est appliquée par le **démarrage du round suivant**, pas par un `sleep` dans ce round (le Dottore est one-shot). Persiste l'heure du broadcast dans `py-audit-state.json`.

### 3. Persister l'état et quitter le round

```json
{"phase": "broadcast_sent", "round_id": "...",
 "candidates": ["..."], "broadcast_at": "ISO-UTC"}
```

Fin du Round N. Auto-destruction habituelle ; le prochain Dottore (~30 min plus tard) reprendra à partir d'ici.

## Round N+1 — collecter, désinstaller, rapporter

Se déclenche quand `py-audit-state.json` indique `phase=broadcast_sent` et ≥1h s'est écoulée.

### 1. Récolter les réponses

Pour chaque agent ayant reçu le broadcast, exécute `tmux capture-pane -t <SESSION> -p -S -200 | grep '\[KEEP '` pour trouver d'éventuelles réponses `[KEEP <pkg>]`. Construis le `keep_set` :

```
keep_set = (whitelist par défaut) ∪ (chaque <pkg> dans toute réponse [KEEP])
```

Silence sur un candidat = consentement à la désinstallation.

### 2. Désinstaller l'ensemble silencieux

```bash
python3 /app/shared/skills/py_tools_audit.py --candidates-only --keep <keep_set...> \
  | xargs -r uv pip uninstall --user -y
```

`xargs -r` saute l'appel quand il n'y a rien à désinstaller (stdin vide).

### 3. Ré-audit + rapport

```bash
python3 /app/shared/skills/py_tools_audit.py
du -sh /jht_home/.local
```

Calcule `freed_mb = before - after` et notifie l'utilisateur via le Capitano :

```bash
jht-tmux-send CAPITANO "[@dottore -> @capitano] [REPORT] py-audit done: <N> packages removed, <freed_mb> MB freed. Magazzino now <after_mb> MB."
```

### 4. Réinitialiser l'état

```json
{"phase": "done", "round_id": "...", "completed_at": "ISO-UTC",
 "removed": ["..."], "freed_mb": 142}
```

Un `py-audit-state.json` propre avec `phase=done` permet au prochain round de repartir de zéro.

## Règles strictes

- **Ne jamais désinstaller sans le broadcast + fenêtre de 1h.** Certains paquets sont chargés dynamiquement et n'apparaîtront pas dans un grep statique — le broadcast est le seul moyen de les détecter.
- **Ne jamais toucher à `ALWAYS_KEEP`.** Les notes transitives (numpy, pillow, packaging, etc.) sont là pour de bonnes raisons ; le script d'audit les exclut déjà.
- **Si un Writer proteste après une désinstallation**, réinstalle immédiatement et ajoute le paquet à `ALWAYS_KEEP`. Traite cela comme un bug de processus (le broadcast a raté l'agent), pas comme une faute du Writer.
- **Jamais de sudo-uninstall.** Reste dans `uv pip uninstall --user`. T13 interdit `sudo pip` pour la même raison qu'il interdit `sudo pip install`.

## Anti-patterns

- ❌ Exécuter les deux rounds dans un seul réveil du Dottore avec `sleep 3600` — dépasse le budget de 10 min par round et casse la cadence du watchdog.
- ❌ Déduire le keep set de son propre `import` grep sans broadcaster — échecs silencieux sur les chargements dynamiques.
- ❌ Désinstaller > 100 paquets en un seul round — trop bruyant, difficile à annuler. Limite au lot naturel de l'audit (ce que retourne le script de seuil).
- ❌ Exécuter cette skill en réaction à un `[ORDINE]` du Sentinel — les ordres demandent du pacing/scaling, pas de la maintenance. py-audit attend une fenêtre d'inactivité.

## Voir aussi

- `cache-prune` — skill de maintenance sœur (uv wheel cache, ~24h de cadence). Exécute-la en premier ; elle réduit parfois la taille du magazzino sous les 800 Mo et rend l'audit inutile.
- `agents/_team/team-rules.md` T13 — règle d'installation (`uv pip install --user`) qui justifie cet audit.
- `agents/dottore/dottore.md` — cycle de vie du Dottore ; cette skill s'étend sur 2 rounds du cycle de vie via le fichier d'état.
