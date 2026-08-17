<!-- @translation: fr, ai-translated 2026-06-06 -->
---
name: application-flow
description: Contrat DB + système de fichiers que chaque Scrittore suit pour faire passer une position de `scored` (≥50) à `ready`/`excluded`. Trois portes AVANT d'écrire la moindre ligne de CV (anti-réécriture, anti-collision, vérification de lien), un chemin canonique pour les livrables, une porte finale après le 3e tour du Critico. Sauter l'une d'entre elles produit du travail en double, écrase la revendication d'un autre Scrittore, ou — pire — pousse un CV de niveau `excluded` vers l'utilisateur comme `ready`. Propriété du Scrittore.
allowed-tools: Bash(python3 *), Bash(mkdir -p *), Bash(find *), Bash(test *)
---

# application-flow — revendiquer, écrire, contrôler

Le Scrittore ne touche que deux zones de la DB :
- `positions.status` (writing → ready | excluded)
- `applications` (INSERT + UPDATE via UPSERT)

Tout le reste est interdit : jamais `scores`, `companies`, `position_highlights`, `positions.notes` (territoire de l'Analista), `positions.applied` (Capitano/utilisateur uniquement). T09 + périmètre du rôle scrittore.

## Étape 1 — Récupérer la prochaine position

```bash
python3 /app/shared/skills/db_query.py next-for-scrittore
```

Priorité : `score ≥ 70` d'abord, puis `50-69` par ordre décroissant. Le script gère déjà le tri.

## Étape 2 — Porte anti-réécriture (DOIT être exécutée avant la revendication)

Une position dont le verdict du Critico est déjà défini est FINALE — ne jamais la re-examiner.

```bash
if python3 /app/shared/skills/db_query.py application "$ID" >/dev/null; then
  : # exit 0 → application absente, OU application sans verdict → procéder
else
  : # exit 1 → critic_verdict déjà valorisé → SKIP ABSOLU
  continue
fi
```

Codes de sortie :
- `0` → pas encore d'application, ou application sans verdict → passer à l'Étape 3.
- `1` → `critic_verdict` déjà défini → **SKIP ABSOLU**, le vote du Critico est final.

> ⚠️ Le CLI `sqlite3` n'est PAS installé dans le conteneur. Utilisez toujours `db_query.py`. Jamais de contournement `python3 -c "import sqlite3 ..."` — ils contournent les invariants du script.

## Étape 3 — Revendication anti-collision

Vérifier que la position n'est pas déjà revendiquée par un autre Scrittore, puis la revendiquer atomiquement en changeant le statut.

```bash
# Vérifier l'état actuel
python3 /app/shared/skills/db_query.py position "$ID"

# Si le statut est déjà `writing` → un autre Scrittore l'a, SKIP
# Sinon revendiquer :
python3 /app/shared/skills/db_update.py position "$ID" --status writing
```

Optionnel mais recommandé : annoncer la revendication aux pairs via tmux pour qu'ils ne lancent même pas la séquence de vérification sur le même ID.

```bash
for s in $(tmux list-sessions -F '#{session_name}' | grep -E '^SCRITTORE-[0-9]+$' | grep -v "^${MY_SESSION}$"); do
  jht-tmux-send "$s" "[@$MY_ID -> @${s,,}] [INFO] Sto prendendo position #$ID"
done
```

Détails du contrat anti-collision : `agents/_manual/anti-collision.md`.

## Étape 4 — Vérification de lien

Un JD qui est mort entre la Phase 2 (Analista) et maintenant ne DOIT PAS consommer le budget du Critico. Vérification à deux niveaux :

```bash
# Niveau 1 — fetch contrôlé avec UA navigateur
python3 /app/shared/skills/safe_fetch.py "<JD-URL>" \
  | grep -i 'no longer accepting\|closed-job\|position has been filled\|expired\|job not found'
```

Si correspondance → marquer exclue et sortir :
```bash
python3 /app/shared/skills/db_update.py position "$ID" --status excluded \
  --notes "ESCLUSA: [LINK_MORTO] verificato dallo Scrittore prima di scrivere"
```

Niveau 2 (uniquement si le Niveau 1 est non concluant) — fetch MCP, rechercher "No longer accepting" / "applications closed" dans le DOM rendu.

## Étape 5 — INSÉRER la ligne application + écrire le CV

Après validation du lien, créer la ligne application. **Toujours via `db_update.py application` (UPSERT)** — jamais de `python3 -c "import sqlite3 ... INSERT INTO applications ..."` brut.

```bash
python3 /app/shared/skills/db_insert.py application \
  --position-id "$ID" \
  --cv-path "$JHT_USER_DIR/cv/CV_<Candidato>_<Company>.md" \
  --cv-pdf-path "$JHT_USER_DIR/cv/CV_<Candidato>_<Company>.pdf" \
  --written-by "$MY_ID" --written-at now
```

> ⚠️ Ne jamais passer la chaîne littérale `'now'` comme valeur de timestamp dans un SQL écrit manuellement — elle est stockée comme la chaîne `"now"` au lieu d'un timestamp ISO. Le wrapper gère correctement `--written-at now` ; le wrapper est le seul chemin sûr.

Ensuite écrire le CV (skill `cv-structure`) → générer le PDF → exécuter `critic-loop`.

## Étape 6 — Discipline des chemins (T11) + nommage unique (bug #25)

Les livrables finaux DOIVENT être sous `$JHT_USER_DIR`, JAMAIS sous `$JHT_AGENT_DIR`. **Le nom de fichier doit inclure `position_id`** pour que 2+ postes dans la même entreprise ne s'écrasent pas mutuellement :

| Artefact                       | Chemin                                                                                |
|--------------------------------|--------------------------------------------------------------------------------------|
| CV markdown                    | `$JHT_USER_DIR/cv/CV_<Candidato>_<position_id>_<CompanySlug>_<TitleSlug>.md`         |
| CV PDF                         | `$JHT_USER_DIR/cv/CV_<Candidato>_<position_id>_<CompanySlug>_<TitleSlug>.pdf`        |
| Lettre de motivation (si demandée)   | `$JHT_USER_DIR/allegati/CoverLetter_<Candidato>_<position_id>_<CompanySlug>.{md,pdf}` |

- `<Candidato>` = `Prénom_Nom` du profil.
- `<position_id>` = `positions.id` (entier, monotone, unique).
- `<CompanySlug>` = nom d'entreprise en minuscules, non-alphanumérique → `-`. Ex. `canonical`, `bending-spoons`.
- `<TitleSlug>` = titre en minuscules + tronqué à ~30 caractères. Ex. `observability`, `junior-ubuntu`.

Exemple pour 2 postes Canonical (cas du bug #25) :
```
CV_MarioRossi_28_canonical_observability.pdf
CV_MarioRossi_62_canonical_junior-ubuntu.pdf
```

Avant la correction du bug #25, les deux étaient sauvegardés comme `CV_MarioRossi_Canonical.pdf` → le second écrasait le premier → la DB avait 2 lignes d'application pointant vers le même fichier → corruption de données silencieuse visible uniquement quand l'utilisateur ouvrait le PDF et lisait le contenu de l'*autre* application.

Lors de l'enregistrement du chemin dans la DB (`--cv-path`, `--cv-pdf-path`), enregistrez le chemin `$JHT_USER_DIR/...`. Jamais un chemin sous `$JHT_AGENT_DIR` (c'est du brouillon — voir espace de travail ci-dessous).

## Étape 7 — Porte finale (après que `critic-loop` atteint le tour 3)

La skill `critic-loop` enregistre le score de chaque tour ; ici vous persistez le verdict, changez le statut de l'application et alignez le statut de la position.

> ⚠️ **Règle d'écriture unique (bug #21).** `applications.status='ready'` est défini **uniquement ici, par vous, après le PASS du Critico**. Le Critico n'écrit jamais `applications.status` directement — sa seule sortie est `critic_verdict` + `critic_score`. Vous êtes propriétaire de la transition finale.

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
# UPSERT final sur l'application — verdict + score + promotion ready/draft
# `--reviewed-by` doit être l'ID de session du DERNIER Critico que vous avez spawné
# (ex. CRITICO-S3 si le tour 3 était le dernier). Sans cela, `reviewed_by`
# reste NULL — observé à 95% null avant le 2026-05-22 (vps1-run-postmortem #1).
LAST_CRITIC="${LAST_CRITIC:-CRITICO-S3}"   # défini par critic-loop au spawn du tour

if [[ <final_verdict> == "PASS" ]]; then
  python3 /app/shared/skills/db_update.py application "$ID" \
    --critic-verdict PASS \
    --critic-score <X.X> \
    --critic-round 3 \
    --critic-notes "$CRITIC_NOTES" \
    --reviewed-by "$LAST_CRITIC" \
    --status ready
else
  python3 /app/shared/skills/db_update.py application "$ID" \
    --critic-verdict <NEEDS_WORK|REJECT> \
    --critic-score <X.X> \
    --critic-round 3 \
    --critic-notes "$CRITIC_NOTES" \
    --reviewed-by "$LAST_CRITIC"
  # le statut reste 'draft' — l'application n'est pas prête pour l'utilisateur.
fi

# Statut de la position — automatique depuis le score final
if [[ <final_score>_int >= 5 ]]; then
  python3 /app/shared/skills/db_update.py position "$ID" --status ready
else
  python3 /app/shared/skills/db_update.py position "$ID" --status excluded
fi
```

La promotion `applications.status='ready'` est ce qui rend le CV visible sur le tableau de bord `/ready` de l'utilisateur. L'omettre laisse la ligne en `'draft'` pour toujours — le Capitano rapporte un nombre de ready que la DB et le tableau de bord ne confirment pas.

Ensuite notifier le Capitano avec un `[REPORT]` (skill `tmux-send`).

## Espace de travail — `tools/` + `tmp/`, maintenance au démarrage (T12)

Votre `$JHT_AGENT_DIR` a 2 sous-répertoires canoniques créés par le lanceur :

| Sous-rép                     | Contenu                                                           | Durée de vie                            |
|------------------------------|-------------------------------------------------------------------|------------------------------------------|
| `$JHT_AGENT_DIR/tools/`      | scripts utilitaires que vous avez écrits pour vous-même (parseurs JD ponctuels, etc.)  | aussi longtemps qu'utile ; auditer à chaque démarrage       |
| `$JHT_AGENT_DIR/tmp/`        | brouillon : JD téléchargées, révisions de CV entre les tours         | effacé au démarrage si plus vieux que 7 jours       |

**Maintenance au démarrage (PREMIÈRE étape de votre boucle, avant l'Étape 1) :**

```bash
mkdir -p "$JHT_AGENT_DIR/tools" "$JHT_AGENT_DIR/tmp"
find "$JHT_AGENT_DIR/tmp" -type f -mtime +7 -delete 2>/dev/null || true
```

Répéter toutes les ~6h d'exécution continue ou toutes les ~50 itérations de la boucle principale. PAS dans une boucle serrée — cela coûte des appels FS.

> 🚫 **Hors limites :** ne jamais `find -delete` en dehors de `$JHT_AGENT_DIR/tmp/`. Ne jamais effacer `$JHT_USER_DIR` (livrables), ne jamais effacer les espaces de travail des agents voisins. T12.

## Règles strictes

- **Anti-réécriture avant revendication, toujours.** Sauter l'Étape 2 signifie relancer le Critico sur une application finalisée = tokens Opus gaspillés et potentiellement écraser un verdict final.
- **Revendiquer avant d'écrire.** Un CV écrit sans revendication risque de produire deux CV en parallèle pour la même position par deux Scrittore.
- **Chemin sous `$JHT_USER_DIR/cv/`, jamais `$JHT_AGENT_DIR/`.** L'utilisateur regarde sous `$JHT_USER_DIR` ; les CV éparpillés dans les espaces de travail des agents lui sont invisibles. T11.
- **Pas de SQL brut.** Toujours `db_query.py` / `db_update.py` / `db_insert.py`. Les wrappers appliquent des invariants dont l'équipe dépend.
- **Pas de git.** Pas de `git add`, pas de `git commit`, pas de `git push` (T02).

## Anti-patterns

- ❌ Sauter l'Étape 2 (anti-réécriture) "parce que la position semble récente" — exit 1 signifie que le Critico a déjà voté, jamais invisible.
- ❌ Revendiquer une position puis écrire le CV sous `$JHT_AGENT_DIR/cv/` — l'utilisateur ne peut pas le voir ; le chemin dans la DB est faux ; violation T11.
- ❌ `python3 -c "import sqlite3; INSERT INTO applications ..."` — contourne la logique UPSERT, données corrompues dans la DB.
- ❌ Passer `'now'` comme chaîne littérale sans utiliser le wrapper — stocké comme chaîne au lieu de timestamp ISO.
- ❌ Toucher `positions.notes` (colonne de l'Analista) — violation du périmètre de rôle, casse les champs structurés de l'Analista.
- ❌ Modifier `positions.applied` depuis ici — seul le Capitano ou l'utilisateur peut basculer ce drapeau.

## Voir aussi

- `cv-structure` — quoi écrire entre l'Étape 5 et `critic-loop`.
- `critic-loop` — la revue en 3 tours qui produit le score final pour l'Étape 7.
- `agents/_manual/anti-collision.md` — contrat complet de coordination multi-Scrittore.
- `agents/_manual/db-schema.md` — colonnes `applications` + périmètres de rôle.
- `agents/_team/team-rules.md` T11 (chemin des livrables) + T12 (maintenance de l'espace de travail).
