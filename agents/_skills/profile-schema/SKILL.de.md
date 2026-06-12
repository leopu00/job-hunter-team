<!-- @translation: de, ai-translated 2026-06-06 -->
---
name: profile-schema
description: "Single Source of Truth des SCHEMAS von candidate_profile.yml — das kanonische Format, das das GESAMTE Team produziert und konsumiert. 3-Ebenen-Modell: eingefrorener Core + Standard-Bloecke + freie Custom-Bloecke. Definiert die 6 `kind` von Bloecken, die das Web rendern kann, und die Governance-Regel (kein Agent erfindet das Format). Jeder Profil-Write muss mit `jht profile validate` validiert werden. Referenziert von profile-yaml, onboarding-flow, parse-cv, cv-structure."
allowed-tools: Bash(jht profile validate *), Bash(python3 *)
---

# profile-schema — das kanonische Profilformat

Alle schreiben und lesen dasselbe Profil: der Assistent baut es auf, das Web zeigt es an,
Analyst/Scorer/Schreiber konsumieren es. Wenn jeder unterschiedliche Keys verwendet, kann das
Web nicht rendern und der Push verliert Daten. Diese Skill ist **das einzige vereinbarte Format**. Die
maschinenverifizierbare Definition lebt in:
- `shared/config/profile-schema.ts` (Zod-Typen, Web-Seite)
- `shared/skills/validate_profile.py` (Runtime-Gate, Agenten-/CLI-Seite)

## 🎚️ 3-Ebenen-Modell

```
L1 CORE      eingefrorene und obligatorische Felder → typisiert, abfragbar (matching, /map)
L2 STANDARD  empfohlene Slots (about, goals, preferences, strengths) → Bloecke
L3 CUSTOM    freie Hand: massgeschneiderte Bloecke fuer DIESE Person → Bloecke
```

L2 und L3 sind beides **Bloecke** im selben Array `blocks:`. Der einzige Unterschied ist,
dass L2 empfohlene `key`s verwenden (siehe unten); L3 haben einen freien `key`, den du waehlst.

## 🧊 L1 — Core (immer vorhanden, niemals Keys erfinden)

```yaml
name: <str>                 # obligatorisch
target_role: <str>          # obligatorisch
location: <str>             # obligatorisch
experience_years: <int>     # obligatorisch (>= 0)
has_degree: <true|false>    # obligatorisch
seniority_target: <str>     # obligatorisch (junior|mid|senior|…)
email: <str>                # optional
timezone: <str>             # optional
nationality: <str>          # optional
birth_year: <int>           # optional
industry: <str>             # optional

skills:                     # obligatorisch, primary >= 1
  primary: [<str>, …]
  secondary: [<str>, …]
languages:                  # obligatorisch, >= 1.  ⚠️ Key 'language' (NICHT 'name')
  - language: <str>
    level: <str>
experience:                 # Liste, jeweils company+role
  - company: <str>
    role: <str>
    period: "Sep 2021 - Feb 2023"   # roh; das Web zeigt sie in TIMELINE
    summary: |- …
education:
  - institution: <str>
    degree: <str>
    year: <str>
work_authorization:         # typisierte Liste (NICHT {eu,ch,…} verschachtelt)
  - region: eu
    status: "EU citizen — free movement"
location_preferences: [<Stadt>, …]
contacts:                   # PII — das Web zeigt sie mit Reveal-on-Click
  email: …  phone: …  linkedin: …  github: …  website: …  address: …
```

## 🧩🎨 L2/L3 — `blocks` (das Herzstück der Flexibilitaet)

```yaml
blocks:
  - key: <stabiler Slug>       # about / goals / preferences / strengths (L2) oder frei (L3)
    kind: <einer der 6 unten>  # der Rendering-"Vertrag"
    title: <angezeigter Titel>
    ord: <int optional>        # Reihenfolge
    content: <Form haengt vom kind ab>
```

### Die 6 `kind` (das sind ALLE — erfinde keine weiteren)

| kind | content | wann |
|---|---|---|
| `narrative` | Markdown-String (1. Person) | erzaehlte Texte: about, goals, Ambitionen |
| `key_points` | `[{heading, text}]` | Praeferenzen, Staerken (sektioniert, KEIN Blob) |
| `tag_list` | `[<str>]` | Extra-Kompetenzen, Interessen, Staedte, Zielrollen |
| `key_value` | `[{label, value}]` | Datenpaare: "consulting fit", Branchendetails |
| `timeline` | `[{title, subtitle, period, detail}]` | weitere datierte Abfolgen |
| `distribution` | `[{label, value}]` | wenn ein Donut-/Diagramm hilft (z.B. Staedtemix) |

`narrative` ist der **universelle Fallback**: Wenn ein Datum nicht in die anderen 5 passt, verwende diesen.

### Reale Beispiele

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
  - key: consulting_fit            # ← L3 custom, freier key
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

## 🤝 Governance — das Format NICHT erfinden

Jedes Profil ist anders und soll bestmoeglich dargestellt werden: du hast **freie Hand beim Inhalt** der
L3-Bloecke. Aber das **Format ist eingefroren**. Regeln:

1. **Niemals ein `kind` erfinden** ausserhalb der 6. Wenn ein Datum nicht reinpasst, verwende `narrative`.
2. **Niemals L1-Keys erfinden** oder umbenennen (z.B. `languages[].name` ❌ → `language` ✅).
3. Wenn du wirklich ein neues `kind` oder ein neues Core-Feld brauchst, **schlage es dem Kapitaen vor** —
   die Schema-Erweiterung geht ueber hier (und ueber `profile-schema.ts` + `validate_profile.py`),
   niemals ueber eine lokale Konvention eines einzelnen Agenten.

## ✅ Obligatorische Validierung nach JEDEM Write

Ersetzt das alte `yaml.safe_load` "ist gueltiges YAML" durch "ist schemakonform":

```bash
jht profile validate
# oder direkt:
python3 /app/shared/skills/validate_profile.py "$JHT_HOME/profile/candidate_profile.yml"
```

`VALID_PROFILE` → weiter. `INVALID_PROFILE` → lies die `ERROR:`-Meldungen, korrigiere, revalidiere.
Die `WARN:`-Meldungen (z.B. Legacy-Key) blockieren nicht, sollten aber behoben werden, wenn du diesen Abschnitt bearbeitest.
**Sprich nicht mit dem Benutzer, solange es nicht `VALID_PROFILE` ist** (ein kaputtes Profil leert die UI).

## See also

- `profile-yaml` — Schreib-/Validierungsmechanik der Datei (nutzt DIESES Schema)
- `profile-summaries` — die narrativen Texte → werden zu Bloecken `kind: narrative`
- `onboarding-flow` — wann was aktualisiert wird
- `shared/config/profile-schema.ts` · `shared/skills/validate_profile.py`
- `docs/internal/architecture/candidate-profile-cloud-sync-redesign-2026-06-05.md`
