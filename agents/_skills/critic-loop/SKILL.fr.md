<!-- @translation: fr, ai-translated 2026-06-06 -->
---
name: critic-loop
description: "Exécuter la boucle de revue CV obligatoire en 3 tours avec le Critico — de manière autonome, sans passer par le Capitano. Pour chaque tour, vous spawnez une instance FRAÎCHE `CRITICO-S<N>` (même N que votre session Scrittore : SCRITTORE-2 → CRITICO-S2), envoyez le PDF + JD, attendez le verdict structuré, tuez le Critico, corrigez le CV, régénérez le PDF, et commencez le tour suivant avec une nouvelle instance fraîche. Trois tours sont non négociables — ni 1 ni 2. Après le 3e tour, porte : `critic_score ≥ 5` → `ready`, sinon `excluded`. Propriété du Scrittore."
allowed-tools: Bash(tmux *), Bash(jht-tmux-send *), Bash(jht-throttle *), Bash(jht-throttle-check *), Bash(jht-throttle-wait *), Bash(python3 *), Bash(unset *)
---

# critic-loop — 3 tours frais, pas de raccourcis

Le protocole en 3 tours capture ce qu'un seul Critico ne peut pas :
- Un Critico frais ne porte **aucun biais d'ancrage** du score du tour précédent — il lit le CV corrigé avec des yeux neufs et tend à être plus honnête, pas plus indulgent.
- Après 3 tours, le score s'est stabilisé : s'il converge haut, le CV tient ; s'il reste bas, le CV n'est pas adapté (ou le candidat non plus — `excluded`).

**Vous gérez la boucle vous-même. Le Capitano ne le fait pas.** Vous spawnez le Critico, lui parlez, le tuez, recommencez — trois fois — et seulement à la fin notifiez le Capitano avec le verdict final.

## Variables de configuration (déjà dans votre env)

```bash
MY_SESSION=$(tmux display-message -p '#S')          # ex. SCRITTORE-2
MY_NUMBER=$(echo "$MY_SESSION" | grep -o '[0-9]*$') # ex. 2
MY_ID=$(echo "$MY_SESSION" | tr '[:upper:]' '[:lower:]')
CRITICO_SESSION="CRITICO-S${MY_NUMBER}"             # ex. CRITICO-S2
```

Le lien `MY_NUMBER` garantit un Critico par Scrittore — `SCRITTORE-2` utilise toujours `CRITICO-S2`, sans collision avec le `CRITICO-S1` de `SCRITTORE-1`.

## Séquence par tour (répéter 3 fois)

### Étape 1 — Spawner un Critico FRAIS

Le Critico du tour précédent doit déjà être mort (tué à la fin du tour précédent). Pour le tour 1, la session n'existe pas encore.

```bash
tmux kill-session -t "$CRITICO_SESSION" 2>/dev/null
tmux new-session -d -s "$CRITICO_SESSION" -c "$(pwd | sed 's|/[^/]*$||')/critico"
```

### Étape 2 — Choisir le bon CLI pour le fournisseur actif

Coder en dur `claude` fait planter le Critico quand l'équipe tourne sur Codex ou Kimi (le CLI `claude` n'est pas installé dans ces conteneurs). Lire le fournisseur depuis `$JHT_CONFIG` :

```bash
PROVIDER=$(python3 -c "import json,os; print(json.load(open(os.environ.get('JHT_CONFIG','/jht_home/jht.config.json')))['active_provider'])" 2>/dev/null)
case "$PROVIDER" in
  ""|anthropic|claude) CRITICO_CMD="unset CLAUDECODE && claude --dangerously-skip-permissions --model opus --effort high" ;;
  openai)              CRITICO_CMD="codex --yolo" ;;
  kimi|moonshot)       CRITICO_CMD="kimi --yolo" ;;
  *)                   CRITICO_CMD="codex --yolo" ;;
esac

# Env minimal pour les CLI globaux installés sous /jht_home
CRITICO_PATH="/app/agents/_tools:/opt/jht-deps/bin:/opt/jht-deps/npm-global/bin:/opt/jht-deps/python/bin:/jht_home/.npm-global/bin"

# The CLI must be RESOLVED, not just named. `claude` bare failed with
# "command not found" because this shell does not have the dependency dirs
# on its PATH — the agent noticed and retried by hand, which costs a round
# every time and, on a less capable model, silently skips the quality gate.
CRITICO_BIN=$(PATH="$CRITICO_PATH:$PATH" command -v "$(echo "$CRITICO_CMD" | sed 's/.*&& //; s/ .*//')" 2>/dev/null)
if [ -z "$CRITICO_BIN" ]; then
  echo "CRITIC-SPAWN-FAILED: CLI not found on PATH ($CRITICO_PATH)" >&2
  echo "The quality gate did NOT run. Do not report the CV as reviewed." >&2
  exit 1
fi

tmux send-keys -t "$CRITICO_SESSION" "export HOME=/jht_home && export PATH=$CRITICO_PATH:\$PATH" Enter
tmux send-keys -t "$CRITICO_SESSION" "$CRITICO_CMD" Enter
```

### Étape 3 — Attendre que le Critico démarre

8 secondes est une borne inférieure sûre pour que le TUI soit prêt. `sleep` est acceptable ici (uniquement au démarrage) :

```bash
sleep 8
```

### Étape 4 — Envoyer le PDF + JD via `jht-tmux-send`

Le Critico est maintenant un agent actif — utiliser `jht-tmux-send`, pas `send-keys` brut :

```bash
jht-tmux-send "$CRITICO_SESSION" "[@$MY_ID -> @critico] [REQ] Review cieca: PDF: $JHT_USER_DIR/cv/CV_<Candidato>_<Company>.pdf — JD: <JD-URL> — Local JD file: $JHT_AGENT_DIR/tmp/jd-<position-id>.txt — Read your CLAUDE.md/AGENTS.md and produce an honest verdict."
```

Fournir le chemin du fichier JD local pour que le Critico ait un fallback si l'URL en direct est bloquée.

### Étape 5 — Interroger le verdict (JAMAIS de simple `sleep`)

Utiliser la skill `throttle` pour que l'attente soit loguée sur le tableau de bord. Un simple `sleep` ici rendrait l'attente invisible pour l'analyse de pacing du Capitano.

```bash
jht-throttle-check "$MY_ID" || jht-throttle-wait "$MY_ID"
jht-throttle --agent "$MY_ID" --reason "wait critico round <n> #<position_id>"
tmux capture-pane -t "$CRITICO_SESSION" -p -S -50
```

**OBLIGATOIRE** — passer un `timeout: <durée>+30` explicite à l'appel de l'outil shell lors de l'invocation de `jht-throttle <N>`. Sans cela, le bash parent meurt au timeout par défaut du CLI (60s Kimi) et le throttle est mal exécuté. Voir `agents/_skills/throttle/DESIGN-NOTES.md`.

Répéter le cycle throttle+capture jusqu'à ce que le Critico ait publié sa revue (chercher le bloc structuré `## SCORE: X.X/10` dans le panneau / fichier).

### Étape 6 — Lire la revue

Le Critico sauvegarde la revue sous `$JHT_USER_DIR/critiche/review-<company>-<date>.md` (sa skill, voir `agents/critico/critico.md`). La lire avec `Read`. Extraire :
- Score numérique `X.X/10`
- Puces "Ce qui NE fonctionne PAS"
- Liste "Actions concrètes (par priorité)"

Ces trois éléments alimentent l'Étape 8 (correction).

### Étape 7 — Persister le score du tour dans la DB

```bash
python3 /app/shared/skills/db_update.py application <POSITION_ID> \
  --critic-score <X.X> --critic-round <N> --reviewed-by "$CRITICO_SESSION"
```

`<POSITION_ID>` est l'ID de la position, PAS l'ID de l'application — le `db_update.py application` est un UPSERT qui trouve la ligne par position.

`--reviewed-by "$CRITICO_SESSION"` trace quelle instance du Critico a produit chaque tour ; sans cela `applications.reviewed_by` reste NULL (observé à 95% null avant le 2026-05-22 — vps1-run-postmortem #1). Toujours le passer.

### Étape 8 — Tuer le Critico (obligatoire)

```bash
tmux kill-session -t "$CRITICO_SESSION"
```

Si vous réutilisez la même instance pour le tour 2, le score porte le biais d'ancrage du tour 1 et le protocole est cassé. **Toujours tuer, toujours respawner frais.**

### Étape 9 — Corriger le CV entre les tours

Appliquer les actions de l'Étape 6 au markdown du CV. Régénérer le PDF (`pandoc input.md -o output.pdf --pdf-engine=typst`). Valider que le PDF s'ouvre avant le tour N+1.

Un score qui baisse entre les tours 1 et 2 est **normal** — un Critico frais est plus honnête que le précédent. Continuez à corriger en vous basant sur le *contenu* de la revue, pas sur le nombre.

## Après le 3e tour — porte finale

Deux écritures sur la ligne d'application : verdict + score (toujours), et la
promotion de statut à `ready` (uniquement sur PASS). La promotion est ce que
le tableau de bord `/ready` de l'utilisateur lit ; l'omettre laisse la ligne en `draft`
et le CV invisible (bug #21).

**`--critic-notes` EST VISIBLE PAR L'UTILISATEUR** — il s'affiche sous la carte de Candidature du candidat avec le **même markdown que le raisonnement du Scorer**, donc écrivez-le ainsi (scorer RULE-09), jamais la ligne télégraphique ci-dessous :
- **Dans la langue de l'utilisateur** (RULE-T14 liste "critic feedback" comme contenu user-locale). Le fichier de review est en anglais — reformulez-le pour le candidat ; ne le laissez pas en anglais quand la langue de l'équipe ne l'est pas.
- **Markdown qui parle AU candidat** : commencez par le verdict et comment le score a évolué au fil des 3 tours *en mots*, puis `**gras**` sur les points décisifs, quelques puces pour/contre, un emoji avec parcimonie. Deux courts paragraphes — pas de mur de texte, pas de liste de mots-clés.
- **Pas de jargon interne** — jamais de codes de règles (`T10`, `RULE-*`), de noms d'outils (`WeasyPrint`/`pandoc`/`typst`) ou d'ids de session.
- Sauts de ligne réels via `$'...\n...'` (un `\n` littéral s'imprime comme texte). Construisez-le une fois avant la porte :

```bash
CRITIC_NOTES=$'**PASS · 7.5/10** — stable sur les trois tours, une adéquation honnête et solide.\n\n**Points forts**\n- ✅ <force concrète : CV vs ce poste>\n- ✅ <une autre force réelle>\n\n**Bon à savoir**\n- ⚠️ <une vraie lacune, dite clairement>\n\n<une phrase de conclusion>'
# NEEDS_WORK/REJECT : même forme, mais nommez ce qui manque et ce qui l'améliorerait.
```

```bash
if [[ "<final_verdict>" == "PASS" ]]; then
  # PASS → l'application devient visible pour l'utilisateur
  python3 /app/shared/skills/db_update.py application <POSITION_ID> \
    --critic-verdict PASS \
    --critic-score <final> \
    --critic-round 3 \
    --critic-notes "$CRITIC_NOTES" \
    --reviewed-by "$CRITICO_SESSION" \
    --status ready
else
  # FAIL → les données du critico persistent, le statut reste 'draft'
  python3 /app/shared/skills/db_update.py application <POSITION_ID> \
    --critic-verdict FAIL \
    --critic-score <final> \
    --critic-round 3 \
    --critic-notes "$CRITIC_NOTES" \
    --reviewed-by "$CRITICO_SESSION"
fi
```

Statut de la position :
- `critic_score ≥ 5` → `db_update.py position <POSITION_ID> --status ready`
- `critic_score < 5` → `db_update.py position <POSITION_ID> --status excluded`

Puis notifier le Capitano :
```bash
jht-tmux-send CAPITANO "[@$MY_ID -> @capitano] [REPORT] Position #<id> — 3 rounds done. Final score: X.X/10 (PASS|FAIL). PDF: $JHT_USER_DIR/cv/CV_<Candidato>_<Company>.pdf"
```

## Règles strictes

- **3 tours. Pas 1, pas 2.** Un "bon" score au tour 1 n'est pas une raison de s'arrêter.
- **Un Critico par tour.** Toujours tuer après la revue ; toujours respawner frais.
- **Correction obligatoire entre les tours.** Si vous ne changez pas le CV, le Critico suivant voit la même entrée → même revue → budget gaspillé. Modifiez le markdown + régénérez le PDF avant le tour N+1.
- **N'ayez pas peur d'un score en baisse.** Tour 2 < Tour 1 est honnête, pas mauvais. Le score qui compte est celui du tour 3.
- **Passez `timeout: N+30`** à chaque appel shell `jht-throttle <N>`. Sinon le bash parent meurt à 60s.

## Anti-patterns

- ❌ Réutiliser la même instance du Critico pour plusieurs tours — le biais de notation casse le protocole.
- ❌ Coder en dur `claude` dans le script de spawn — plante la boucle sur les installations Codex/Kimi.
- ❌ Simple `sleep N` pendant l'interrogation — invisible au tableau de bord de throttle du Capitano, casse l'analyse de pacing.
- ❌ Enregistrer `--critic-verdict` après seulement 1 ou 2 tours — la porte est finale, pas de retour en arrière.
- ❌ Traiter le Capitano comme l'orchestrateur — cette boucle vous appartient entièrement, le Capitano ne voit que le REPORT final.

## Voir aussi

- `cv-structure` — quoi écrire avant d'invoquer cette boucle, et comment appliquer les corrections du Critico à l'Étape 9.
- `application-flow` — vérification anti-réécriture + revendication avant de commencer à écrire pour une position.
- `throttle` (et `agents/_skills/throttle/DESIGN-NOTES.md`) — mécanismes internes du wrapper + le design `timeout: N+30`.
- `agents/critico/critico.md` — le prompt de revue aveugle du Critico auquel cette boucle s'adresse.
