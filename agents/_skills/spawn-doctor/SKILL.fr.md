<!-- @translation: fr, ai-translated 2026-06-06 -->
---
name: spawn-doctor
description: Lance un DOTTORE frais a la demande quand tu (Capitano/Assistente/Sentinella/Mentor) as besoin d'un tour de health-check immediat. Utilise cette skill AU LIEU D'ecrire dans la session DOTTORE quand l'utilisateur demande "fai partire il dottore" / "dottora" / "controlla il team", car entre les rounds programmes la session DOTTORE est un bash residuel (cycle de vie one-shot, ~10 min actif + ~110 min en sommeil jusqu'au prochain spawn du cycle 2h).
allowed-tools: Bash(/app/.launcher/spawn-doctor.sh *), Bash(tmux *), Bash(jht-tmux-send *)
---

# spawn-doctor — appel d'urgence au Dottore

## Pourquoi elle existe

Le **doctor-watchdog** lance automatiquement un DOTTORE toutes les 2 heures
(cadence choisie le 2026-05-18 pour reduire le gaspillage de tokens :
12 spawn/jour au lieu de 48). Entre un spawn et le suivant, la session
tmux `DOTTORE` existe mais est un "bash residuel" (le Dottore precedent
s'est auto-detruit a la fin de son tour). Envoyer un `[URG]` ou
`[HEALTH]` a cette session est **inutile** : le message finit dans le
bash et personne ne le lit.

Cas classique (post-mortem `2026-05-18-capitano-zombie-night`) :
l'Assistente a envoye 2 URG au Dottore a 06:08/06:09 parce que
l'utilisateur l'avait demande, mais le Dottore precedent s'etait
auto-detruit a 05:48 → 2 URG perdus dans le vide, le Capitano est
reste zombie ~20 min de plus jusqu'a ce que l'Assistente comprenne
qu'il devait agir directement.

Cette skill ferme la boucle : au lieu de "parler a un Dottore mort",
**j'en lance un nouveau** immediatement.

## Qui peut l'utiliser

Les 4 agents coordinateurs long-lived :
- 👨‍✈️ **Capitano** — quand il detecte des workers zombie et veut un
  second avis avant de respawn lui-meme.
- 💬 **Assistente** — quand l'utilisateur demande "fai partire il dottore"
  ou "controlla il team" via Telegram/chat.
- 🧙‍♂️ **Mentor** — quand dans un digest hebdomadaire il detecte des
  patterns anormaux et veut une verification de sante de l'infrastructure.
- 💂 **Sentinella** — quand un agent arrete de consommer des tokens
  de maniere inattendue en pleine fenetre productive.

Les autres agents (Scout, Analista, Scorer, Scrittore, Critico) **N'ONT
PAS** cette skill : s'ils voient un probleme, ils le rapportent au
Capitano via `[REPORT]` et lui laissent la decision.

## Comment l'utiliser

```bash
# Spawn one-shot. Le script est idempotent : il tue tout DOTTORE* existant
# avant d'en creer un nouveau, donc tu peux l'appeler sans crainte de
# doublons.
bash /app/.launcher/spawn-doctor.sh
```

Output attendu :
```
[spawn-doctor] killing old session: DOTTORE     (si presente)
[spawn-doctor] DOTTORE avviato — workdir=/jht_home/agents/dottore — round=YYYYMMDDTHHMMSSZ-spawn
```

Le nouveau DOTTORE LLM (Codex/Kimi/Claude selon `active_provider`)
demarre en ~6-10 secondes, lit `AGENTS.md` (= prompt du Dottore), et
commence le tour de health-check. Auto-destruction a la fin.

## Apres le spawn — interagis a travers le Dottore (pas tout seul)

```bash
# 1. Spawn
bash /app/.launcher/spawn-doctor.sh

# 2. Attends 8-12s que le LLM soit pret a recevoir
sleep 10

# 3. Envoie un [REQ] cible (le Dottore suivra sa procedure standard,
#    mais tu peux l'orienter si tu as un soupcon precis).
jht-tmux-send DOTTORE \
  "[@$MY_ID -> @dottore] [REQ] Round mirato: il Capitano non risponde da
   ~30 min, capture-pane mostra solo bash. Verifica e respawn se zombie.
   Riporta a me con [RES] alla fine."

# 4. Attends le [RES] du Dottore (~10 min budget standard) — pas de polling
#    agressif. Le Dottore lui-meme enregistrera les evenements dans
#    /jht_home/logs/dottore-actions.jsonl quand il agira.
```

## Quand NE PAS l'utiliser

- ❌ Worker zombie et tu es le **Capitano** : fais le respawn directement via
  skill `spawn-agent` + kick-off resume. Pas besoin de deranger le Dottore.
  Le Dottore est pour les problemes qui necessitent un LLM de haut niveau
  (diagnostic token spike, deadlock subtil, prune cache cross-system).
- ❌ Boucle de requetes : si tu as deja fait `spawn-doctor` dans les
  derniers 15 min, attends. Lancer un nouveau Dottore pendant que le
  precedent travaille encore le tue (le script est idempotent avec
  `kill-session` en amont) — tu perdrais du temps et du budget.
- ❌ Sans raison concrete : le Dottore coute ~3-5% du budget Kimi par
  tour. Ne le lance pas "pour verifier si tout va bien" — il y a deja le
  doctor-watchdog toutes les 2h pour ca. Lance-le quand tu as un
  evenement specifique a investiguer.

## Anti-patterns

- ❌ `jht-tmux-send DOTTORE "[URG] ..."` sans d'abord spawner — exit 0
  mais message perdu dans le bash residuel. Erreur historique observee
  le 2026-05-18 06:08-06:09 UTC.
- ❌ Spawner manuellement avec `tmux new-session -d -s DOTTORE` — contourne
  le prompt sync `AGENTS.md` + log JSONL + cleanup. Utilise TOUJOURS
  `spawn-doctor.sh`.
- ❌ S'attendre a ce que le Dottore resolve un task non-health (ex. "scrivi
  un CV"). Le Dottore est single-purpose : liveness + cache-prune +
  py-tools-audit + cv-disk-audit. Rien d'autre.

## Voir aussi

- `agents/dottore/dottore.md` — prompt du Dottore, lifecycle one-shot
- `agents/_skills/liveness-check/SKILL.md` — diagnostic que le Dottore execute
- `.launcher/spawn-doctor.sh` — script idempotent (rev. legacy 2026-05-08)
- `.launcher/doctor-watchdog.sh` — boucle cadence 2h (post-mortem 2026-05-18)
- `docs/sessions/2026-05-18-capitano-zombie-night/README.md` — cas a l'origine de cette skill
