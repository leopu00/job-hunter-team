<!-- @translation: fr, ai-translated 2026-06-06 -->
---
name: format-time
description: Convertir les timestamps UTC vers le fuseau horaire de l'utilisateur avant de les afficher dans le chat, les graphiques, Telegram ou toute sortie destinée à l'utilisateur. Utiliser ce helper chaque fois que vous écririez autrement un `strftime("%H:%M")` brut d'un datetime UTC dans quelque chose que l'utilisateur lit.
allowed-tools: Bash(python3 *)
---

# format-time — UTC → fuseau horaire utilisateur dans la sortie

Bug #15 : le conteneur tourne en UTC, l'utilisateur vit en CEST/CET. Sans conversion, chaque "reset at 03:11" dans le chat ou les graphiques force l'utilisateur à calculer `+2` de tête — et parfois l'utilisateur dit *"ici il est 3:21"* et le Capitano doit se dépêcher pour la conversion.

## Quand l'utiliser

L'appliquer chaque fois que vous produisez un timestamp que l'**utilisateur** va lire :

- Messages Telegram de n'importe quel agent (Capitano, Assistente, Mentor)
- Sous-titres de graphiques Matplotlib, étiquettes d'axe x, légendes
- Widgets de tableau de bord qui affichent l'heure
- Lignes de log ou résumés retournés à l'utilisateur

**Ne pas appliquer** quand :
- Écriture de fichiers de log internes (`messages.jsonl`, `sentinel-data.jsonl`,
  `dottore-actions.jsonl`) — ils restent en ISO UTC pour le parsing inter-agents.
- Écriture de colonnes DB — garder ISO UTC pour que le tableau de bord puisse formater au rendu.
- Calcul d'intervalles / deltas — travailler en UTC, formater uniquement aux bordures.

## Comment l'utiliser

```python
from shared.skills.format_time import fmt_user, fmt_user_with_utc
from datetime import datetime, timezone

now = datetime.now(timezone.utc)
print(fmt_user(now))            # "03:21 CEST"
print(fmt_user_with_utc(now))   # "03:21 CEST (01:21 UTC)"
```

Ou, depuis bash :

```bash
python3 /app/shared/skills/format_time.py --now
python3 /app/shared/skills/format_time.py --iso 2026-05-17T01:14:00Z --with-utc
```

## Quand afficher les deux heure-utilisateur et UTC

Dans les **graphiques opérationnels** qu'un ingénieur d'astreinte (ou vous, en débogage) pourrait lire à côté des logs UTC de l'équipe, préférer `fmt_user_with_utc` pour que les deux soient visibles :

> *"Now 03:21 CEST (01:21 UTC) — usage 63% — proj 92.2%"*

Dans le **chat Telegram ordinaire** à l'utilisateur, `fmt_user` seul suffit généralement :

> *"📅 Reset finestra 5h alle 05:11 CEST (~1h 50m)."*

## D'où vient le fuseau horaire utilisateur

`candidate_profile.yml::timezone` (nom IANA, ex. `Europe/Rome`). Défaut `Europe/Rome` si manquant — couvre ~95% des utilisateurs beta. Pour surcharger par session : variable d'env `JHT_USER_TZ` (lue par le helper).

## Anti-patterns

- ❌ `datetime.now().strftime("%H:%M")` dans une chaîne destinée à l'utilisateur — produit l'heure du **conteneur** (UTC) sans suffixe → confusion de l'utilisateur.
- ❌ Arithmétique manuelle `+2` n'importe où. Utiliser le helper ; le DST fait passer Europe/Rome en CET (+1) fin octobre et vous l'oublierez.
- ❌ Coder en dur `"CEST"` comme suffixe — faux la moitié de l'année et faux pour les utilisateurs non-italiens.

## Voir aussi

- `shared/skills/format_time.py` — implémentation.
- `candidate_profile.yml.example` — documentation du champ `timezone:`.
- `docs/internal/_archive/2026-05-17-team-strategy-bugs.md` §15 — référence de l'incident.
