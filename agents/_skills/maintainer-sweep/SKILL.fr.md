<!-- @translation: fr, ai-translated 2026-08-03 -->
---
name: maintainer-sweep
description: "La tournée de maintenance INFRA du Mantenitore 👷‍♂️ (jumelle de celle du Dottore, mais portant sur l'infrastructure et non sur les agents). Un passage one-shot par jour : canari de liveness des processus de survie du conteneur (bridge/daemon/watchdog) via process_health.py, smoke-test des outils mission-critical (browser/LinkedIn) via tool_health.py, audit/consolidation des dépendances hors standard, GC des scripts orphelins et des fichiers tmp, de-dup des scripts récurrents, fraîcheur des dépendances, tendance disque/RAM, canari de la locale UTF-8 des panes via locale_health.py (défaut cosmétique vs données corrompues). Single-writer : le Mantenitore est le SEUL à réparer l'infra ; les actions DESTRUCTIVES (supprimer/archiver) il les PROPOSE, c'est le Capitano qui décide. Résultat ajouté à mantenitore-logbook.jsonl."
allowed-tools: Bash(python3 /app/shared/skills/process_health.py *), Bash(python3 /app/shared/skills/tool_health.py *), Bash(python3 /app/shared/skills/sync_health.py *), Bash(python3 /app/shared/skills/host_vitals.py *), Bash(python3 /app/shared/skills/locale_health.py *), Bash(python3 /app/shared/skills/log_archive.py *), Bash(bash /app/.launcher/start-agent.sh *), Bash(df *), Bash(du *), Bash(free *), Bash(tmux ls *), Bash(jht-install *), Bash(ls *), Bash(stat *), Bash(jht-tmux-send *)
---

# maintainer-sweep — garder l'INFRA en bonne santé, en silence et à l'abri des régressions

Le Mantenitore est le jumeau du Dottore : **Dottore = santé des AGENTS** (sessions, tokens, context-refresh) ; **Mantenitore = santé de l'INFRA** (outils, dépendances, disque, scripts). One-shot par jour : boot → tournée → logbook → STANDBY (reste au repos, pas d'auto-terminaison ; le prochain spawn te remplace, kill-then-create). Budget ~10 min. Frontière nette, zéro chevauchement avec le Dottore.

> **Pourquoi elle existe :** le bug `libatk` (browser mort, LinkedIn invérifiable) est resté invisible pendant des heures parce que *personne ne faisait le smoke-test des outils et personne ne s'occupait de l'infra*. La tournée rend cette vigilance STRUCTURELLE.

## Règle d'or — single-writer + proposer, pas supprimer
Le Mantenitore **répare** l'infra (installe les dépendances manquantes, consolide, corrige). Mais toute action **DESTRUCTIVE** (supprimer/archiver des fichiers, nettoyage disque), il la **PROPOSE** au Capitano avec la commande exacte ; **c'est le Capitano qui décide** (comme dans la refonte du monitoring d'usage). Ne supprime jamais de ta propre initiative.

## La tournée (les étapes, dans l'ordre)

### 0. 🫀 Canari de liveness des processus de survie (le filet de sécurité)
**PREMIÈRE étape, avant toute autre chose.** Les bridges/daemons qui maintiennent le conteneur en vie (sentinel-bridge, pacing-bridge, heartbeat-bridge, window-ratio-meter, codex-auth-healer + tg-bridge) sont lancés `setsid` detached → **hors du respawn-on-crash de pid1**. L'`agent-watchdog` (`maybe_respawn_bridges`) les resurveille toutes les 30s, MAIS si lui aussi venait à échouer (bug, flap-cap atteint, watchdog lui-même dégradé) c'est toi **le dernier filet** : à la première tournée de la journée tu les détectes et tu les répares. Sans ce canari, un daemon mort reste invisible pendant des heures (c'est exactement ce qui est arrivé au sentinel-bridge sur betaC le 2026-06-27 → 8h d'aveuglement sur l'usage).
```bash
python3 /app/shared/skills/process_health.py summary
```
Il affiche OK/DEAD pour chaque processus attendu (bridge-suite, pid1-child, daemon, tg-bridge). Pour ceux qui sont DEAD :
- **groupe `bridge-suite`** (detached, réparable par toi) → **RÉPARE** immédiatement, c'est un respawn non destructif :
  ```bash
  bash /app/.launcher/start-agent.sh bridge      # relance toute la suite (idempotent)
  ```
  puis **relance le canari** pour confirmer qu'ils sont de nouveau vivants. Journalise `processes_respawned`.
- **tg-bridge** absent (et bots Telegram configurés) → `bash /app/.launcher/start-agent.sh tg-bridge`.
- **groupe `pid1-child` / `daemon` / `core`** (agent-watchdog, doctor-watchdog, auto-report-loop, cloud-daemon, pid1) → leur respawn est l'affaire de pid1 : s'ils sont morts, le problème est plus profond → **ESCALADE au Capitano** via `jht-tmux-send` (n'essaie PAS de les relancer à la main : tu les rendrais orphelins). Ne laisse jamais passer en silence.

Si tout est vivant → journalise `processes_health: all_ok` et passe à la suite. C'est le jumeau-pour-PROCESSUS du smoke-test-pour-OUTILS de l'étape 1.

### 0.5 ☁️ Canari CLOUD-SYNC (pull + push)
Juste après le canari des processus. La synchro local↔cloud s'est bloquée deux fois
(pull churn : curseur figé → il réécrivait ~500 positions/tick ; push 413 :
payload monolithique trop gros → curseur jamais avancé → dashboard cloud figé
pendant ~14h). Les bugs de code sont corrigés, mais la vigilance doit être rendue
STRUCTURELLE.
```bash
python3 /app/shared/skills/sync_health.py summary        # ou --json
```
Il lit les curseurs en lecture seule (`.cloud-sync-cursor.json`, `.cloud-pull-cursor.json`),
le max `positions.updated_at` en base et la fin de `logs/daemon.log`. Il renvoie
`problems[]` avec sévérité. Résultat :
- **aucun problème** → journalise `sync_health: ok` et passe à la suite.
- **push_behind / push_errors (HIGH)** → le push n'atteint pas le cloud. Ce n'est PAS
  réparable par toi à la main sans risque (single-writer sur la base = l'équipe). **ESCALADE
  au Capitano** via `jht-tmux-send` avec les détails du check (lag + nombre de 413).
  Si le check suggère le drain d'urgence (`JHT_PUSH_POS_CHUNK=40`), transmets la
  proposition au Capitano, n'agis pas seul.
- **pull_churn (MEDIUM)** → signale au Capitano que le pull réapplique
  trop de lignes (symptôme d'un curseur qui ne converge pas / fix non déployé).
- **cursor_stale (MEDIUM)** → indice secondaire ; ne l'inclus dans l'escalade que
  s'il accompagne un signal HIGH.
Journalise le résultat sous `sync_health` dans l'entrée du logbook (voir plus bas). La règle
d'or ne change pas : **détecter + signaler, jamais log-and-forget** (c'est la même erreur que
le bug libatk et le sentinel-bridge, ici sur les CURSEURS de la synchro).

### 1. 🩺 Smoke-test des outils mission-critical (le cœur)
```bash
python3 /app/shared/skills/tool_health.py --json
```
Il renvoie `tools_health` avec `{status: OK|BROKEN|UNKNOWN, evidence}` pour chaque outil (browser/Playwright, linkedin_check, …) + `broken[]`.
- **BROKEN** → **RÉPARE** immédiatement : `jht-install <dep>` (p. ex. les fichiers `.so` de Chromium) puis relance le check. Si c'est réparé → journalise `repaired`.
- **BROKEN et non réparable** → **ESCALADE au Capitano** avec le correctif EXACT via `jht-tmux-send` (p. ex. « browser HS : `sudo playwright install-deps` ; tant que ce n'est pas corrigé LinkedIn = OPEN_UNVERIFIED »). Ne laisse jamais passer en silence.
- C'est le MÊME `tool_health.py` qui alimente le gate au build-time (dev1) et le champ `tools_health` dans le tick : une seule source de vérité sur l'état des outils.

### 2. 📦 Audit des dépendances hors standard → consolider
Dépendances installées hors des préfixes standard (`/opt/jht-deps`, `PLAYWRIGHT_BROWSERS_PATH`, préfixe npm, venv) → réinstalle-les dans le préfixe standard via `jht-install`, pour qu'elles ne soient pas éparpillées. Journalise celles que tu as consolidées.

### 3. 🧹 GC des scripts orphelins/fichiers tmp
Scripts temporaires laissés derrière eux par des agents **tués** (session absente de `tmux ls`) et fichiers tmp expirés (> N heures). Liste les candidats → **PROPOSE** la suppression au Capitano (action destructive), ne supprime pas directement.

### 4. 🔁 De-dup des scripts récurrents
Scripts quasi identiques répétés par plusieurs agents → **propose** une unique skill canonique (ne la réécris pas à la volée). Journalise la proposition.

### 5. 📅 Fraîcheur des dépendances
Bibliothèques/outils dépréciés ou versions cassées / outils cruciaux injoignables → signale au Capitano (pas d'auto-upgrade risqué).

### 6. 💾 Disque / RAM + tendance + recoupement des VITALS
`du` sur les gros chemins, `free` pour la RAM. Pour **`disk.used_pct` utilise TOUJOURS `df`** — commande canonique :
```bash
df -P /jht_home | awk 'NR==2 {gsub("%","",$5); print $5}'   # p. ex. 30  (pourcentage tel que df le rapporte)
```
**JAMAIS** le dériver de `statvfs`/`os.statvfs` (`f_bavail`/`f_blocks`) : les blocs réservés le gonflent d'environ 3× → fausses alertes (p. ex. 88 % rapportés contre 30 % réels). Compare-le à la **tendance du dernier logbook** : s'il croît vers un seuil → discute avec le Capitano de ce qu'il faut archiver/supprimer (c'est lui qui décide). Journalise les chiffres + le delta.
**Puis RECOUPE la série temporelle des vitals** (le bridge échantillonne la RAM+CPU du conteneur toutes les quelques minutes dans `vitals.jsonl`) :
```bash
python3 /app/shared/skills/host_vitals.py summary --hours 24
```
Il te donne **pic/moyenne RAM+CPU + l'HEURE du pic** sur les dernières 24h. **Corrèle les pics avec le *quand*** (p. ex. RAM à 92 % à 03:00 avec 3 Analista actifs ; CPU saturé pendant un script lourd) : c'est cette donnée qui affine le diagnostic bien plus qu'un instantané seul. Si un pic paraît anormal → signale-le au Capitano. Journalise `vitals_24h` (pic RAM/CPU + heure) dans l'entrée. NB : la Sentinella ne reçoit l'alarme que si la RAM/CPU dépasse 95 % en direct ; lire l'historique et le corréler, c'est **TON boulot**.

### 6.5 🗜️ Archivage des historiques de monitoring (ordre de Leone 19/07 — DU CODE, pas du jugement)
Les historiques append-only (`sentinel-data.jsonl`, `token-meter.csv`,
`throttle-events.jsonl`, `agent-vitals.jsonl`, `vitals.jsonl`) grossissent sans fin :
ils alimentent les graphiques d'usage du jeu, donc ils ne doivent jamais être
supprimés à la main — ils doivent être **archivés avec le flux déterministe** :
```bash
python3 /app/shared/skills/log_archive.py status          # profondeur et tailles
python3 /app/shared/skills/log_archive.py run             # coupe >30j → zips hebdomadaires
```
Ce que fait `run` (tout est en code, tu ne fais que lire le résumé JSON) : les semaines
de plus de 30 jours quittent les fichiers vifs et entrent dans
`logs/archive/logs-<YYYY>-Www.zip` (le zip de la semaine grossit à chaque
passage) ; la coupe est atomique et une ligne entre dans le zip AVANT de disparaître du
fichier vif. Si l'espace manque (archive >500MB ou <1GB libre) il supprime tout seul
les zips les PLUS ANCIENS et te les liste sous `pruned`.
- Fréquence : 1×/semaine suffit (le dimanche) ; en semaine seulement `status`
  si le disque de l'étape 6 croît anormalement.
- `pruned` NON vide → signale-le EXPLICITEMENT dans le logbook et préviens le Capitano
  (c'est la seule perte de données du flux, autorisée par Leone uniquement sous
  pression d'espace).
- Exception DÉLIBÉRÉE à la règle d'or : ce flux est pré-autorisé par
  Leone (19/07) — tu n'as pas besoin de l'OK du Capitano pour `run` ; pour toute
  autre suppression hors du flux, la règle single-writer s'applique.
- Journalise dans l'entrée : `log_archive: {archived_rows, weeks, pruned, free_gb}`.

### 7. 🔤 Locale UTF-8 des panes (cosmétique ≠ données corrompues)
```bash
python3 /app/shared/skills/locale_health.py summary        # ou --json
```
Deux mesures en une, et c'est la seconde qui compte. Il lit la locale du **conteneur** (`/proc/1/environ` — PAS l'environnement de ce processus : CPython « coerce » de lui-même `LC_CTYPE` en `C.UTF-8`, donc un check sur `os.environ` déclarerait sain un conteneur cassé) puis **décode en mode STRICT** un `capture-pane` de chaque session vivante. L'exit code porte le verdict :
- **`0` ok** → journalise `locale_health: ok` et passe à la suite.
- **`1` cosmetic** (locale non UTF-8, ZÉRO octet invalide) → les données sont **INTACTES** : ce qui est cassé, c'est le rendu pour qui s'attache depuis l'extérieur (`_` à la place de chaque lettre accentuée). **Signale-le au Capitano, ne le traite pas comme une urgence** et surtout ne le « répare » pas : le fix est `LANG=C.UTF-8` dans le `docker-compose.yml` de l'hôte et ne prend effet qu'à la recréation du conteneur — hors de portée d'un agent qui tourne DEDANS. Mitigation immédiate pour l'opérateur : `docker exec -it -e LC_ALL=C.UTF-8 jht tmux -u attach -r -t <session>`.
- **`2` data_corruption** (octets invalides dans un pane) → **P1, ESCALADE** vers le Capitano avec les sessions listées : là, les agents peuvent vraiment lire un mot pour un autre.

**Pourquoi les deux checks et pas seulement le premier** : `echo $LANG` sait dire « cosmétique » mais ne saura JAMAIS dire « corrompu » — le décodage strict est le seul des deux qui sépare un défaut d'affichage de données abîmées. Le 2026-08-10, c'est lui qui a transformé un soupçon (« les agents reçoivent des mots tronqués ») en une mesure (392 accentuées intactes, pas un seul octet invalide) et a arrêté un fix visant le mauvais problème.

Journalise `locale_health: {verdict, env, panes_scanned, corrupted_sessions}` dans l'entrée.

## Logbook (append-only)
Chaque tournée écrit UNE entrée dense dans `/jht_home/logs/mantenitore-logbook.jsonl` (jumeau du logbook du Dottore), afin que le prochain Mantenitore puisse voir la tendance :
```json
{"ts":"ISO-UTC","slot":"maintainer-daily","processes_health":{"all_ok":true,"dead":[]},
 "processes_respawned":[...],"sync_health":{"healthy":true,"problems":[]},
 "tools_health":{...},"repaired":[...],
 "escalated":[...],"deps_consolidated":[...],"gc_proposed":[...],"dedup_proposed":[...],
 "locale_health":{"verdict":"ok|cosmetic|data_corruption","panes_scanned":N},
 "disk":{"used_pct":N,"delta_vs_last":N},"ram":{...},"duration_sec":N,"capitano_ack":"..."}
```
Ajoute avec `>>`, n'écrase jamais. Résumé dense (comme les carnets de route du Dottore/Capitano) : ce que j'ai trouvé, ce que j'ai réparé, ce que j'ai proposé.

## Anti-patterns
- ❌ Supprimer/archiver sans l'OK du Capitano (single-writer : propose). SEULE exception : le flux `log_archive.py` de l'étape 6.5, pré-autorisé par Leone.
- ❌ Auto-upgrader des bibliothèques vers de nouvelles versions (risque de casse) — signale, ne mets pas à jour de ton propre chef.
- ❌ Laisser un outil BROKEN sans le réparer NI l'escalader (c'est exactement le bug libatk silencieux).
- ❌ Laisser un bridge/daemon DEAD sans le réparer NI l'escalader (la même erreur, sur les PROCESSUS : c'est le crash du sentinel-bridge sur betaC le 2026-06-27).
- ❌ Empiéter sur la santé des AGENTS (sessions/tokens/contexte) — c'est le domaine du Dottore.

## Voir aussi
- `shared/skills/process_health.py` — le canari de liveness des processus de survie utilisé à l'étape 0 (filet de sécurité quotidien ; le jumeau-pour-processus de tool_health).
- `shared/skills/sync_health.py` — le canari de la cloud-sync utilisé à l'étape 0.5 (pull churn / push 413 / curseurs stale) ; en lecture seule, le jumeau-pour-SYNC de process_health/tool_health.
- `shared/skills/tool_health.py` — le smoke-test réutilisé à l'étape 1 (également gate au build-time + tick).
- `shared/skills/locale_health.py` — le canari de la locale de l'étape 7 (locale du conteneur + décodage UTF-8 strict des panes) ; read-only, il distingue un défaut cosmétique de données corrompues.
- `shared/skills/log_archive.py` — l'archiveur déterministe de l'étape 6.5 (coupe les semaines >30j → zip, élague sous pression d'espace).
- `.launcher/agent-watchdog.sh` — la récupération RAPIDE (toutes les 30s, `maybe_respawn_bridges`) dont l'étape 0 est le filet de sécurité quotidien ; leçon du 27/06 : les bridges démarrent `setsid` detached, donc ni le respawn de pid1 ni `agent-watchdog` (qui relance des sessions tmux, pas des processus Python) ne les couvre — s'ils crashent ils restent à terre jusqu'au redémarrage du conteneur.
- `agents/mantenitore/mantenitore.md` — persona/cycle de vie du Mantenitore (dev3).
- `agents/_skills/resilience/SKILL.md` — l'échelle anti-silence pour les agents (dev3) ; son étape « classify » réutilise `tool_health.py`.
- `agents/_skills/liveness-check/SKILL.md` — le jumeau côté Dottore (santé des agents), pour la structure.
