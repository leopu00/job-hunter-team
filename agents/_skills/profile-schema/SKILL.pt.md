<!-- @translation: pt, ai-translated 2026-06-06 -->
---
name: profile-schema
description: "Fonte unica de verdade do SCHEMA do candidate_profile.yml — o formato canónico que TODO o time produz e consome. Modelo de 3 níveis: core congelado + blocos standard + blocos custom livres. Define os 6 `kind` de bloco que o web sabe renderizar e a regra de governança (nenhum agente inventa o formato). Cada escrita do perfil deve ser validada com `jht profile validate`. Referenciada por profile-yaml, onboarding-flow, parse-cv, cv-structure."
allowed-tools: Bash(jht profile validate *), Bash(python3 *)
---

# profile-schema — o formato canónico do perfil

Todos escrevem e leem o mesmo perfil: o Assistente constrói-o, o web mostra-o,
Analista/Scorer/Escritor consomem-no. Se cada um usa chaves diferentes, o web não
consegue renderizar e o push perde dados. Esta skill é **o único formato acordado**. A
definição verificável por máquina vive em:
- `shared/config/profile-schema.ts` (tipos Zod, lado web)
- `shared/skills/validate_profile.py` (gate runtime, lado agentes/CLI)

## 🎚️ Modelo de 3 níveis

```
L1 CORE      campos congelados e obrigatórios → tipados, consultáveis (matching, /map)
L2 STANDARD  slots recomendados (about, goals, preferences, strengths) → blocos
L3 CUSTOM    carta branca: blocos sob medida para ESTA pessoa → blocos
```

L2 e L3 são ambos **blocos** no mesmo array `blocks:`. A diferença é apenas que
os L2 usam `key` recomendadas (abaixo); os L3 têm `key` livre que escolhes tu.

## 🧊 L1 — core (sempre presente, nunca inventar as chaves)

```yaml
name: <str>                 # obrigatório
target_role: <str>          # obrigatório
location: <str>             # obrigatório
experience_years: <int>     # obrigatório (>= 0)
has_degree: <true|false>    # obrigatório
seniority_target: <str>     # obrigatório (junior|mid|senior|…)
email: <str>                # opcional
timezone: <str>             # opcional
nationality: <str>          # opcional
birth_year: <int>           # opcional
industry: <str>             # opcional

skills:                     # obrigatório, primary >= 1
  primary: [<str>, …]
  secondary: [<str>, …]
languages:                  # obrigatório, >= 1.  ⚠️ chave 'language' (NÃO 'name')
  - language: <str>
    level: <str>
experience:                 # lista, cada uma company+role
  - company: <str>
    role: <str>
    period: "Sep 2021 - Feb 2023"   # raw; o web mostra-o em TIMELINE
    summary: |- …
education:
  - institution: <str>
    degree: <str>
    year: <str>
work_authorization:         # lista tipada (NÃO {eu,ch,…} aninhado)
  - region: eu
    status: "EU citizen — free movement"
location_preferences: [<cidade>, …]
contacts:                   # PII — o web mostra com reveal-on-click
  email: …  phone: …  linkedin: …  github: …  website: …  address: …
```

## 🧩🎨 L2/L3 — `blocks` (o coração da flexibilidade)

```yaml
blocks:
  - key: <slug estável>       # about / goals / preferences / strengths (L2) ou livre (L3)
    kind: <um dos 6 abaixo>   # o "contrato" de renderização
    title: <título exibido>
    ord: <int opcional>       # ordem
    content: <forma depende do kind>
```

### Os 6 `kind` (são TODOS — não inventes outros)

| kind | content | quando |
|---|---|---|
| `narrative` | string markdown (1.ª pessoa) | textos narrados: about, goals, aspirações |
| `key_points` | `[{heading, text}]` | preferências, pontos fortes (seccionados, NÃO um blob) |
| `tag_list` | `[<str>]` | competências extra, interesses, cidades, papéis-alvo |
| `key_value` | `[{label, value}]` | dados em pares: "consulting fit", detalhes do setor |
| `timeline` | `[{title, subtitle, period, detail}]` | sequências datadas adicionais |
| `distribution` | `[{label, value}]` | quando um donut/gráfico ajuda (ex. mix cidades) |

`narrative` é o **fallback universal**: se um dado não encaixa nos outros 5, usa-o aí.

### Exemplos reais

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
  - key: consulting_fit            # ← L3 custom, key livre
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

## 🤝 Governança — NÃO inventes o formato

Cada perfil é diferente e deve ser mostrado da melhor forma: tens **carta branca sobre o conteúdo** dos
blocos L3. Mas o **formato está congelado**. Regras:

1. **Nunca inventes um `kind`** fora dos 6. Se um dado não encaixa, usa `narrative`.
2. **Nunca inventes chaves L1** nem as renomeies (ex. `languages[].name` ❌ → `language` ✅).
3. Se precisares realmente de um novo `kind` ou de um novo campo core, **propõe ao Capitão** —
   a extensão do schema passa por aqui (e por `profile-schema.ts` + `validate_profile.py`),
   nunca por uma convenção local de um agente individual.

## ✅ Validação obrigatória após CADA escrita

Substitui o antigo `yaml.safe_load` "é YAML válido" por "é conforme ao schema":

```bash
jht profile validate
# ou diretamente:
python3 /app/shared/skills/validate_profile.py "$JHT_HOME/profile/candidate_profile.yml"
```

`VALID_PROFILE` → prossegue. `INVALID_PROFILE` → lê os `ERROR:`, corrige, revalida.
Os `WARN:` (ex. chave legacy) não bloqueiam mas devem ser corrigidos quando tocares nessa secção.
**Não fales com o utilizador enquanto não for `VALID_PROFILE`** (um perfil corrompido esvazia a UI).

## See also

- `profile-yaml` — mecânica de escrita/validação do ficheiro (usa ESTE schema)
- `profile-summaries` — os textos narrativos → tornam-se blocos `kind: narrative`
- `onboarding-flow` — quando atualizar o quê
- `shared/config/profile-schema.ts` · `shared/skills/validate_profile.py`
- `docs/internal/architecture/candidate-profile-cloud-sync-redesign.md`
