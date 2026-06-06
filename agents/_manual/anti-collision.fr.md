<!-- @translation: fr, ai-translated 2026-06-06 -->
# 🛡️ Protocole Anti-Collision

Lorsque plusieurs agents du mme rle puisent dans la mme file d'attente, ils DOIVENT viter de travailler sur le mme enregistrement. Le mcanisme est **spcifique au rle** — chaque phase utilise la stratgie de verrouillage la mieux adapte  sa forme de travail.

## 🎯 Mcanismes de verrouillage par rle

### 🕵️ Scout — ddup pr-INSERT

Les Scouts crivent de *nouveaux* enregistrements, ils ne peuvent donc pas verrouiller quelque chose qui n'existe pas encore. Le risque de collision est que deux scouts insrent la mme offre d'emploi depuis des sources diffrentes. Mcanisme :

```bash
# Avant l'INSERT, vrifier si l'URL est dj en BD
python3 shared/skills/db_query.py check-url "<url>"
# Retourne "TROVATA" (ignorer) ou "NON TROVATA" (procder avec l'INSERT).
```

Partitionnement au dmarrage : les scouts ngocient galement des **cercles** et des **sources** via `scout_coord.py` pour ne pas se chevaucher sur la mme source ds le dpart. Voir `agents/scout/scout.md` pour les dtails.

### 👨‍🔬 Analyste  👨‍💻 Scorer — filigrane `last_checked`

Les deux puisent dans une file (`status = new` pour les Analystes, `status = checked` pour les Scorers) et mettent  jour des enregistrements existants. Le risque de collision est que deux pairs slectionnent le mme enregistrement au mme moment. Mcanisme :

1. **Lire** `last_checked` pour l'enregistrement candidat.
2. **Si rcent** (un pair l'a tamponn dans les dernires minutes) → ignorer ; prendre le suivant.
3. **Sinon** tamponner `last_checked = now()` pour le revendiquer, puis travailler.

```bash
# Revendication
python3 shared/skills/db_update.py position <ID> --last-checked now
```

Le filigrane est un verrouillage souple : il signale uniquement "touch rcemment", pas "verrouill dfinitivement". La gestion des revendications primes est laisse au jugement de l'agent (voir § Revendications primes ci-dessous).

### 👨‍🏫 crivain — bascule `status = writing`

Les crivains puisent dans `status = scored`. Le risque de collision est que deux crivains s'emparent de la mme position  haut score. Mcanisme :

```bash
# Revendication atomique par bascule du status
python3 shared/skills/db_update.py position <ID> --status writing
```

Les pairs excutant `next-for-scrittore` ne verront pas les enregistrements dj en `status = writing`, donc la bascule elle-mme constitue le verrou. Rgle anti-rcriture en plus : si `applications.critic_verdict` est dj dfini, **ignorer absolument** (le verdict est dfinitif).

## 📡 Communication

Quand un agent doit informer un pair (ex. "Je prends les IDs 42-44") ou notifier en aval (ex. Scout → Analyste avec un lot frais), utiliser le wrapper atomique :

```bash
jht-tmux-send <PEER_SESSION> "[@me -> @peer] [INFO] taking IDs 42-44"
```

⚠️ **Ne pas utiliser `tmux send-keys` directement** : les TUIs de Codex/Kimi perdent le caractre Enter s'il arrive dans le mme appel `send-keys` que le corps du texte. Le wrapper gre texte + Enter de manire atomique avec une pause de rendu. Skill : `agents/_skills/tmux-send/jht-tmux-send`.

## 👨‍⚕️ Revendications primes (rares en production)

Les agents en production tournent pendant des mois sans tomber — les revendications primes sont surtout un artefact de l'environnement de test. Quand elles surviennent :

- **Ne volez pas aveuglment une revendication prime.** Un `last_checked` d'il y a 10 minutes pourrait tre un pair simplement lent sur un seul enregistrement, pas une session morte.
- **Vrifiez d'abord la vivacit du pair.** Vrifiez la session tmux du pair (`tmux has-session -t <peer>`) ; inspectez le panneau (`tmux capture-pane -p`) pour voir s'il travaille encore, est bloqu sur un fetch, ou est rellement mort.
- **Si le pair est vivant mais bloqu**, escaladez vers le Capitaine plutt que de lui arracher l'enregistrement.
- **Si le pair est mort**, revendiquez l'enregistrement vous-mme et notifiez le Capitaine.

L'intention : viter le vol silencieux d'enregistrements. Les dcisions de rcupration doivent tre dlibres, pas automatiques.

## 📋 Rgles communes

- **Lire avant de revendiquer.** Vrifiez toujours l'tat actuel de l'enregistrement avant de le revendiquer.
- **La premire criture gagne.** Si deux agents font la course sur le mme enregistrement, la premire mise  jour en BD gagne ; le perdant passe au suivant.
- **Jamais de DELETE.** Utilisez `--status excluded` avec des notes quand un enregistrement s'avre invalide ; ne dtruisez jamais les donnes.
- **Mettre  jour le status final une fois termin.** Aprs le travail : `checked` (Analyste), `scored` / `excluded` (Scorer), `ready` / `excluded` (crivain).

## 🛠️ Unification future (planifie)

Une paire `positions.claimed_by + claimed_at` est dans la feuille de route pour permettre les **revendications par lots** (un seul `UPDATE … LIMIT N` atomique au lieu de N allers-retours par enregistrement) et pour alimenter une vue en temps rel de l'activit des agents dans le tableau de bord UI. Les mcanismes spcifiques par rle ci-dessus continueront de fonctionner en parallle. Voir ROADMAP § *Database schema optimization*.
