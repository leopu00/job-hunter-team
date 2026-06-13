<!-- @translation: es, ai-translated 2026-06-06 -->
---
name: profile-schema
description: "Fuente única de verdad del ESQUEMA del candidate_profile.yml — el formato canónico que TODO el equipo produce y consume. Modelo de 3 niveles: core congelado + bloques estándar + bloques custom libres. Define los 6 `kind` de bloque que el web sabe renderizar y la regla de gobernanza (ningún agente inventa el formato). Cada escritura del perfil debe validarse con `jht profile validate`. Referenciada por profile-yaml, onboarding-flow, parse-cv, cv-structure."
allowed-tools: Bash(jht profile validate *), Bash(python3 *)
---

# profile-schema — el formato canónico del perfil

Todos escriben y leen el mismo perfil: el Asistente lo construye, el web lo muestra,
Analista/Scorer/Escritor lo consumen. Si cada uno usa claves distintas, el web no sabe
renderizar y el push pierde datos. Esta skill es **el único formato acordado**. La
definición verificable por máquina vive en:
- `shared/config/profile-schema.ts` (tipos Zod, lado web)
- `shared/skills/validate_profile.py` (gate en tiempo de ejecución, lado agentes/CLI)

## 🎚️ Modelo de 3 niveles

```
L1 CORE      campos congelados y obligatorios → tipados, consultables (matching, /map)
L2 STANDARD  slots recomendados (about, goals, preferences, strengths) → bloques
L3 CUSTOM    carta blanca: bloques a medida para ESTA persona → bloques
```

L2 y L3 son ambos **bloques** en el mismo array `blocks:`. La diferencia es solo que
los L2 usan `key` recomendadas (abajo); los L3 tienen `key` libre que eliges tú.

## 🧊 L1 — core (siempre presente, nunca inventar las claves)

```yaml
name: <str>                 # obligatorio
target_role: <str>          # obligatorio
location: <str>             # obligatorio
experience_years: <int>     # obligatorio (>= 0)
has_degree: <true|false>    # obligatorio
seniority_target: <str>     # obligatorio (junior|mid|senior|…)
email: <str>                # opcional
timezone: <str>             # opcional
nationality: <str>          # opcional
birth_year: <int>           # opcional
industry: <str>             # opcional

skills:                     # obligatorio, primary >= 1
  primary: [<str>, …]
  secondary: [<str>, …]
languages:                  # obligatorio, >= 1.  ⚠️ clave 'language' (NO 'name')
  - language: <str>
    level: <str>
experience:                 # lista, cada una company+role
  - company: <str>
    role: <str>
    period: "Sep 2021 - Feb 2023"   # raw; el web la muestra en TIMELINE
    summary: |- …
education:
  - institution: <str>
    degree: <str>
    year: <str>
work_authorization:         # lista tipada (NO {eu,ch,…} anidado)
  - region: eu
    status: "EU citizen — free movement"
location_preferences: [<ciudad>, …]
contacts:                   # PII — el web la muestra reveal-on-click
  email: …  phone: …  linkedin: …  github: …  website: …  address: …
```

## 🧩🎨 L2/L3 — `blocks` (el corazón de la flexibilidad)

```yaml
blocks:
  - key: <slug estable>       # about / goals / preferences / strengths (L2) o libre (L3)
    kind: <uno de los 6 abajo>   # el "contrato" de rendering
    title: <título mostrado>
    ord: <int opcional>      # orden
    content: <forma depende del kind>
```

### Los 6 `kind` (son TODOS — no inventes otros)

| kind | content | cuándo |
|---|---|---|
| `narrative` | cadena markdown (1.ª persona) | textos narrativos: about, goals, aspiraciones |
| `key_points` | `[{heading, text}]` | preferencias, puntos fuertes (seccionados, NO un blob) |
| `tag_list` | `[<str>]` | competencias extra, intereses, ciudades, roles objetivo |
| `key_value` | `[{label, value}]` | datos en pares: "consulting fit", detalles del sector |
| `timeline` | `[{title, subtitle, period, detail}]` | secuencias con fechas adicionales |
| `distribution` | `[{label, value}]` | cuando un donut/gráfico ayuda (ej. mix ciudades) |

`narrative` es el **fallback universal**: si un dato no encaja en los otros 5, úsalo ahí.

### Ejemplos reales

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

## 🤝 Gobernanza — NO inventes el formato

Cada perfil es diferente y debe mostrarse de la mejor manera: tienes **carta blanca sobre el contenido** de
los bloques L3. Pero el **formato está congelado**. Reglas:

1. **Nunca inventes un `kind`** fuera de los 6. Si un dato no encaja, usa `narrative`.
2. **Nunca inventes claves L1** ni las renombres (ej. `languages[].name` ❌ → `language` ✅).
3. Si realmente necesitas un nuevo `kind` o un nuevo campo core, **proponlo al Capitán** —
   la extensión del esquema pasa por aquí (y por `profile-schema.ts` + `validate_profile.py`),
   nunca por una convención local del agente individual.

## ✅ Validación obligatoria después de CADA escritura

Sustituye el antiguo `yaml.safe_load` "es YAML válido" por "es conforme al esquema":

```bash
jht profile validate
# o directamente:
python3 /app/shared/skills/validate_profile.py "$JHT_HOME/profile/candidate_profile.yml"
```

`VALID_PROFILE` → continúa. `INVALID_PROFILE` → lee los `ERROR:`, corrige, revalida.
Los `WARN:` (ej. clave legacy) no bloquean pero deben corregirse cuando toques esa sección.
**No hables con el usuario hasta que sea `VALID_PROFILE`** (un perfil roto vacía la UI).

## See also

- `profile-yaml` — mecánica de escritura/validación del archivo (usa ESTE esquema)
- `profile-summaries` — los textos narrativos → se convierten en bloques `kind: narrative`
- `onboarding-flow` — cuándo actualizar qué
- `shared/config/profile-schema.ts` · `shared/skills/validate_profile.py`
- `docs/internal/architecture/candidate-profile-cloud-sync-redesign.md`
