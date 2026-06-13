<!-- @translation: hu, ai-translated 2026-06-06 -->
---
name: profile-schema
description: "A candidate_profile.yml SCHEMAJA egyetlen igazsagforras — a kanonikus formatum, amelyet az EGESZ csapat eloallit es fogyaszt. 3 szintu modell: fagyasztott core + standard blokkkok + szabad egyedi blokkok. Definilja a 6 blokk-`kind`-ot, amelyet a web renderelni tud, es a kormanyzasi szabalyt (egyetlen ugynok sem talalja ki a formatumot). Minden profil-irast a `jht profile validate` paranccsal kell validalni. Hivatkozik ra: profile-yaml, onboarding-flow, parse-cv, cv-structure."
allowed-tools: Bash(jht profile validate *), Bash(python3 *)
---

# profile-schema — a profil kanonikus formatuma

Mindenki ugyanazt a profilt irja es olvassa: az Asszisztens epitI fel, a web megjelenitI,
az Elemzo/Pontoz/Iro fogyasztja. Ha mindenki mas kulcsokat hasznal, a web nem tudja
renderelni, es a push adatokat veszt. Ez a skill az **egyetlen egyeztetett formatum**. A
geppel ellenorizheto definicio itt el:
- `shared/config/profile-schema.ts` (Zod tipusok, web oldal)
- `shared/skills/validate_profile.py` (runtime gate, ugynokk/CLI oldal)

## 🎚️ 3 szintu modell

```
L1 CORE      fagyasztott es kotelezo mezok → tipizaltak, lekerdezhetok (matching, /map)
L2 STANDARD  ajanlott slotok (about, goals, preferences, strengths) → blokkok
L3 CUSTOM    szabad kezet kapsz: egyedi blokkok ERRE a szemelyre → blokkok
```

Az L2 es L3 egyarant **blokkok** ugyanabban a `blocks:` tombben. A kulonbseg csak annyi, hogy
az L2 ajanlott `key`-eket hasznal (lasd alabb); az L3-nak szabad `key`-je van, amit te valasztasz.

## 🧊 L1 — core (mindig jelen van, soha ne talalj ki kulcsokat)

```yaml
name: <str>                 # kotelezo
target_role: <str>          # kotelezo
location: <str>             # kotelezo
experience_years: <int>     # kotelezo (>= 0)
has_degree: <true|false>    # kotelezo
seniority_target: <str>     # kotelezo (junior|mid|senior|…)
email: <str>                # opcionalis
timezone: <str>             # opcionalis
nationality: <str>          # opcionalis
birth_year: <int>           # opcionalis
industry: <str>             # opcionalis

skills:                     # kotelezo, primary >= 1
  primary: [<str>, …]
  secondary: [<str>, …]
languages:                  # kotelezo, >= 1.  ⚠️ kulcs: 'language' (NEM 'name')
  - language: <str>
    level: <str>
experience:                 # lista, mindegyikben company+role
  - company: <str>
    role: <str>
    period: "Sep 2021 - Feb 2023"   # nyers; a web TIMELINE-kent jelenitI meg
    summary: |- …
education:
  - institution: <str>
    degree: <str>
    year: <str>
work_authorization:         # tipizalt lista (NEM {eu,ch,…} beagyazott)
  - region: eu
    status: "EU citizen — free movement"
location_preferences: [<varos>, …]
contacts:                   # PII — a web reveal-on-click moddal jelenitI meg
  email: …  phone: …  linkedin: …  github: …  website: …  address: …
```

## 🧩🎨 L2/L3 — `blocks` (a rugalmassag szive)

```yaml
blocks:
  - key: <stabil slug>        # about / goals / preferences / strengths (L2) vagy szabad (L3)
    kind: <az alabbi 6 kozul>  # a rendering "szerzodes"
    title: <megjelenItett cim>
    ord: <int opcionalis>      # sorrend
    content: <forma a kind-tol fugg>
```

### A 6 `kind` (ez az OSSZES — ne talalj ki ujakat)

| kind | content | mikor |
|---|---|---|
| `narrative` | markdown sztring (elso szemely) | elbeszelo szovegek: about, goals, torekves |
| `key_points` | `[{heading, text}]` | preferencia, erosseg (szekcionalt, NEM blob) |
| `tag_list` | `[<str>]` | extra kompetenciak, erdeklodesi korok, varosok, cel-szerepkorok |
| `key_value` | `[{label, value}]` | paros adatok: "consulting fit", iparagi reszletek |
| `timeline` | `[{title, subtitle, period, detail}]` | tovabbi datumozott sorozatok |
| `distribution` | `[{label, value}]` | amikor donut/grafikon segit (pl. varos-mix) |

A `narrative` az **univerzalis fallback**: ha egy adat nem fer be a masik 5-be, hasznald ezt.

### Valos peldak

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
  - key: consulting_fit            # ← L3 egyedi, szabad key
    kind: key_value
    title: Affinità consulting
    content:
      - label: Interesse
        value: Alto, su temi finance/transaction/strategy
      - label: Punto debole
        value: Voti non sempre adatti ai track più selettivi
  - key: beyond_work               # ← L3 egyedi
    kind: tag_list
    title: Oltre il lavoro
    content: [Skateboard downhill (campione HU), Canottaggio, Teatro]
```

## 🤝 Kormanyzas — NE talalj ki formatumot

Minden profil mas es a leheto legjobban kell megjeleniteni: **szabad kezet kapsz a tartalom**
teren az L3 blokkoknal. De a **formatum fagyasztott**. Szabalyok:

1. **Soha ne talalj ki `kind`-ot** a 6-on kIvul. Ha egy adat nem fer be, hasznald a `narrative`-ot.
2. **Soha ne talalj ki L1 kulcsokat** es ne nevezd at oket (pl. `languages[].name` ❌ → `language` ✅).
3. Ha tenyleg szukseged van egy uj `kind`-ra vagy uj core mezore, **javasolj a Kapitanynak** —
   a sema bovitese itt tortenik (es a `profile-schema.ts` + `validate_profile.py` fajlokban),
   soha egy egyedi ugynok helyi konvencioja altal.

## ✅ Kotelezo validacio MINDEN iras utan

A regi `yaml.safe_load` "ervenyes YAML" ellenorzest felvaltja a "semakonform" ellenorzes:

```bash
jht profile validate
# vagy kozvetlenul:
python3 /app/shared/skills/validate_profile.py "$JHT_HOME/profile/candidate_profile.yml"
```

`VALID_PROFILE` → folytasd. `INVALID_PROFILE` → olvasd el az `ERROR:`-okat, javits, ujravalidalj.
A `WARN:`-ok (pl. legacy kulcs) nem blokkoljak, de javitsd ki, amikor azt a szekciott modositod.
**Ne beszelj a felhasznaloval, amig nem `VALID_PROFILE`** (egy hibas profil kiuriti a UI-t).

## Lasd meg

- `profile-yaml` — a fajl irasi/validalasi mechanikaja (EZT a semat hasznalja)
- `profile-summaries` — a narrativ szovegek → `kind: narrative` blokkokka valnak
- `onboarding-flow` — mikor mit frissits
- `shared/config/profile-schema.ts` · `shared/skills/validate_profile.py`
