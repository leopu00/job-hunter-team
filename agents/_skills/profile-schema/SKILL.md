---
name: profile-schema
description: "Single source of truth dello SCHEMA del candidate_profile.yml — il formato canonico che TUTTO il team produce e consuma. Modello a 3 livelli: core congelato + blocchi standard + blocchi custom liberi. Definisce i 6 `kind` di blocco che il web sa rendere e la regola di governance (nessun agente inventa il formato). Ogni write del profilo va validato con `jht profile validate`. Riferita da profile-yaml, onboarding-flow, parse-cv, cv-structure."
allowed-tools: Bash(jht profile validate *), Bash(python3 *)
---

# profile-schema — il formato canonico del profilo

Tutti scrivono e leggono lo stesso profilo: l'Assistente lo costruisce, il web lo mostra,
Analista/Scorer/Scrittore lo consumano. Se ognuno usa chiavi diverse, il web non sa
renderizzare e il push perde dati. Questa skill è **l'unico formato concordato**. La
definizione macchina-verificabile vive in:
- `shared/config/profile-schema.ts` (tipi Zod, lato web)
- `shared/skills/validate_profile.py` (gate runtime, lato agenti/CLI)

## 🎚️ Modello a 3 livelli

```
L1 CORE      campi congelati e mandatori → tipizzati, interrogabili (matching, /map)
L2 STANDARD  slot raccomandati (about, goals, preferences, strengths) → blocchi
L3 CUSTOM    carta bianca: blocchi su misura per QUESTA persona → blocchi
```

L2 e L3 sono entrambi **blocchi** nello stesso array `blocks:`. La differenza è solo che
gli L2 usano `key` raccomandate (sotto); gli L3 hanno `key` libera che scegli tu.

## 🧊 L1 — core (sempre presente, mai inventare le chiavi)

```yaml
name: <str>                 # mandatorio
target_role: <str>          # mandatorio
location: <str>             # mandatorio
experience_years: <int>     # mandatorio (>= 0)
has_degree: <true|false>    # mandatorio
seniority_target: <str>     # mandatorio (junior|mid|senior|…)
email: <str>                # opzionale
timezone: <str>             # opzionale
nationality: <str>          # opzionale
birth_year: <int>           # opzionale
industry: <str>             # opzionale

skills:                     # mandatorio, primary >= 1
  primary: [<str>, …]
  secondary: [<str>, …]
languages:                  # mandatorio, >= 1.  ⚠️ chiave 'language' (NON 'name')
  - language: <str>
    level: <str>
experience:                 # lista, ognuna company+role
  - company: <str>
    role: <str>
    period: "Sep 2021 - Feb 2023"   # raw; il web la mostra in TIMELINE
    summary: |- …
education:
  - institution: <str>
    degree: <str>
    year: <str>
work_authorization:         # lista tipizzata (NON {eu,ch,…} annidato)
  - region: eu
    status: "EU citizen — free movement"
location_preferences: [<città>, …]
contacts:                   # PII — il web la mostra reveal-on-click
  email: …  phone: …  linkedin: …  github: …  website: …  address: …
```

## 🧩🎨 L2/L3 — `blocks` (il cuore della flessibilità)

```yaml
blocks:
  - key: <slug stabile>       # about / goals / preferences / strengths (L2) oppure libero (L3)
    kind: <uno dei 6 sotto>   # il "contratto" di rendering
    title: <titolo mostrato>
    ord: <int opzionale>      # ordine
    content: <forma dipende dal kind>
```

### I 6 `kind` (sono TUTTI — non inventarne altri)

| kind | content | quando |
|---|---|---|
| `narrative` | stringa markdown (1ª persona) | testi raccontati: about, goals, aspirazioni |
| `key_points` | `[{heading, text}]` | preferenze, punti di forza (sezionati, NON un blob) |
| `tag_list` | `[<str>]` | competenze extra, interessi, città, ruoli target |
| `key_value` | `[{label, value}]` | dati a coppie: "consulting fit", dettagli settore |
| `timeline` | `[{title, subtitle, period, detail}]` | sequenze datate ulteriori |
| `distribution` | `[{label, value}]` | quando un donut/grafico aiuta (es. mix città) |

`narrative` è il **fallback universale**: se un dato non entra negli altri 5, usalo lì.

### Esempi reali

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
  - key: consulting_fit            # ← L3 custom, key libera
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

## 🤝 Governance — NON inventare il formato

Ogni profilo è diverso e va mostrato al meglio: hai **carta bianca sul contenuto** dei
blocchi L3. Ma il **formato è congelato**. Regole:

1. **Mai inventare un `kind`** fuori dai 6. Se un dato non entra, usa `narrative`.
2. **Mai inventare chiavi L1** o rinominarle (es. `languages[].name` ❌ → `language` ✅).
3. Se ti serve davvero un nuovo `kind` o un nuovo campo core, **proponilo al Capitano** —
   l'estensione dello schema passa da qui (e da `profile-schema.ts` + `validate_profile.py`),
   mai da una convenzione locale del singolo agente.

## ✅ Validazione obbligatoria dopo OGNI write

Sostituisce il vecchio `yaml.safe_load` "è YAML valido" con "è conforme allo schema":

```bash
jht profile validate
# oppure diretto:
python3 /app/shared/skills/validate_profile.py "$JHT_HOME/profile/candidate_profile.yml"
```

`VALID_PROFILE` → prosegui. `INVALID_PROFILE` → leggi gli `ERROR:`, correggi, rivalida.
I `WARN:` (es. chiave legacy) non bloccano ma vanno sistemati quando tocchi quella sezione.
**Non parlare all'utente finché non è `VALID_PROFILE`** (un profilo rotto svuota la UI).

## See also

- `profile-yaml` — meccanica di scrittura/validazione del file (usa QUESTO schema)
- `profile-summaries` — i testi narrativi → diventano blocchi `kind: narrative`
- `onboarding-flow` — quando aggiornare cosa
- `shared/config/profile-schema.ts` · `shared/skills/validate_profile.py`
- `docs/internal/architecture/candidate-profile-cloud-sync-redesign.md`
