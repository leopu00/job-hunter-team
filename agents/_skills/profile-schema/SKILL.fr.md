<!-- @translation: fr, ai-translated 2026-06-06 -->
---
name: profile-schema
description: "Source unique de verite du SCHEMA du candidate_profile.yml — le format canonique que TOUTE l'equipe produit et consomme. Modele a 3 niveaux : core gele + blocs standard + blocs custom libres. Definit les 6 `kind` de bloc que le web sait rendre et la regle de gouvernance (aucun agent n'invente le format). Chaque ecriture du profil doit etre validee avec `jht profile validate`. Referencee par profile-yaml, onboarding-flow, parse-cv, cv-structure."
allowed-tools: Bash(jht profile validate *), Bash(python3 *)
---

# profile-schema — le format canonique du profil

Tout le monde ecrit et lit le meme profil : l'Assistant le construit, le web l'affiche,
Analyste/Scorer/Redacteur le consomment. Si chacun utilise des cles differentes, le web ne sait
pas rendre et le push perd des donnees. Cette skill est **le seul format convenu**. La
definition verifiable par la machine se trouve dans :
- `shared/config/profile-schema.ts` (types Zod, cote web)
- `shared/skills/validate_profile.py` (gate runtime, cote agents/CLI)

## 🎚️ Modele a 3 niveaux

```
L1 CORE      champs geles et obligatoires → types, interrogeables (matching, /map)
L2 STANDARD  slots recommandes (about, goals, preferences, strengths) → blocs
L3 CUSTOM    carte blanche : blocs sur mesure pour CETTE personne → blocs
```

L2 et L3 sont tous deux des **blocs** dans le meme tableau `blocks:`. La seule difference est
que les L2 utilisent des `key` recommandees (ci-dessous) ; les L3 ont une `key` libre que tu choisis.

## 🧊 L1 — core (toujours present, ne jamais inventer les cles)

```yaml
name: <str>                 # obligatoire
target_role: <str>          # obligatoire
location: <str>             # obligatoire
experience_years: <int>     # obligatoire (>= 0)
has_degree: <true|false>    # obligatoire
seniority_target: <str>     # obligatoire (junior|mid|senior|…)
email: <str>                # optionnel
timezone: <str>             # optionnel
nationality: <str>          # optionnel
birth_year: <int>           # optionnel
industry: <str>             # optionnel

skills:                     # obligatoire, primary >= 1
  primary: [<str>, …]
  secondary: [<str>, …]
languages:                  # obligatoire, >= 1.  ⚠️ cle 'language' (PAS 'name')
  - language: <str>
    level: <str>
experience:                 # liste, chacune company+role
  - company: <str>
    role: <str>
    period: "Sep 2021 - Feb 2023"   # brut ; le web l'affiche en TIMELINE
    summary: |- …
education:
  - institution: <str>
    degree: <str>
    year: <str>
work_authorization:         # liste typee (PAS {eu,ch,…} imbrique)
  - region: eu
    status: "EU citizen — free movement"
location_preferences: [<ville>, …]
contacts:                   # PII — le web l'affiche en reveal-on-click
  email: …  phone: …  linkedin: …  github: …  website: …  address: …
```

## 🧩🎨 L2/L3 — `blocks` (le coeur de la flexibilite)

```yaml
blocks:
  - key: <slug stable>        # about / goals / preferences / strengths (L2) ou libre (L3)
    kind: <un des 6 ci-dessous>  # le "contrat" de rendu
    title: <titre affiche>
    ord: <int optionnel>      # ordre
    content: <forme depend du kind>
```

### Les 6 `kind` (ce sont TOUS — n'en invente pas d'autres)

| kind | content | quand |
|---|---|---|
| `narrative` | chaine markdown (1re personne) | textes racontes : about, goals, aspirations |
| `key_points` | `[{heading, text}]` | preferences, points forts (sectionnes, PAS un blob) |
| `tag_list` | `[<str>]` | competences supplementaires, interets, villes, roles cibles |
| `key_value` | `[{label, value}]` | donnees en paires : "consulting fit", details secteur |
| `timeline` | `[{title, subtitle, period, detail}]` | sequences datees supplementaires |
| `distribution` | `[{label, value}]` | quand un donut/graphique aide (ex. mix villes) |

`narrative` est le **fallback universel** : si une donnee n'entre pas dans les 5 autres, utilise-le.

### Exemples concrets

```yaml
blocks:
  - key: about
    kind: narrative
    title: Chi sono
    content: |-
      Sono un analista di credit risk con due anni in private equity…
  - key: strengths
    kind: key_points
    title: Punti di forza
    content:
      - heading: Analisi del credito
        text: Due diligence forense, rating, revisione portafogli.
      - heading: Comunicazione
        text: Presento deep dive di settore e case study.
  - key: consulting_fit            # ← L3 custom, key libre
    kind: key_value
    title: Affinità consulting
    content:
      - label: Interesse
        value: Alto, su temi finance/transaction/strategy
      - label: Punto debole
        value: Voti non sempre adatti ai track più selettivi
  - key: beyond_work               # ← L3 custom
    kind: tag_list
    title: Oltre il lavoro
    content: [Skateboard downhill (campione HU), Canottaggio, Teatro]
```

## 🤝 Gouvernance — NE PAS inventer le format

Chaque profil est different et doit etre presente au mieux : tu as **carte blanche sur le contenu** des
blocs L3. Mais le **format est gele**. Regles :

1. **Ne jamais inventer un `kind`** en dehors des 6. Si une donnee n'entre pas, utilise `narrative`.
2. **Ne jamais inventer des cles L1** ni les renommer (ex. `languages[].name` ❌ → `language` ✅).
3. Si tu as vraiment besoin d'un nouveau `kind` ou d'un nouveau champ core, **propose-le au Capitaine** —
   l'extension du schema passe par ici (et par `profile-schema.ts` + `validate_profile.py`),
   jamais par une convention locale d'un agent individuel.

## ✅ Validation obligatoire apres CHAQUE ecriture

Remplace l'ancien `yaml.safe_load` "c'est du YAML valide" par "c'est conforme au schema" :

```bash
jht profile validate
# ou directement :
python3 /app/shared/skills/validate_profile.py "$JHT_HOME/profile/candidate_profile.yml"
```

`VALID_PROFILE` → continue. `INVALID_PROFILE` → lis les `ERROR:`, corrige, revalide.
Les `WARN:` (ex. cle legacy) ne bloquent pas mais doivent etre corriges quand tu touches cette section.
**Ne parle pas a l'utilisateur tant que ce n'est pas `VALID_PROFILE`** (un profil casse vide l'interface).

## See also

- `profile-yaml` — mecanique d'ecriture/validation du fichier (utilise CE schema)
- `profile-summaries` — les textes narratifs → deviennent des blocs `kind: narrative`
- `onboarding-flow` — quand mettre a jour quoi
- `shared/config/profile-schema.ts` · `shared/skills/validate_profile.py`
- `docs/internal/architecture/candidate-profile-cloud-sync-redesign-2026-06-05.md`
