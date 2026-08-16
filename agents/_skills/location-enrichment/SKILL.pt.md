<!-- @translation: pt, ai-translated 2026-06-06 -->
---
name: location-enrichment
description: Padronizar o texto livre de positions.location em colunas loc_*/work_*/role_family estruturadas ANTES de marcar qualquer posição como `checked`. Cobre 10 casos especiais (Europe Remote, Italy+remote, multi-location, US-entity-in-EU). Impõe uma-posição-de-cada-vez, vocabulário alinhado entre pares, work_country nunca NULL. Usar sempre que o Analista está prestes a definir status=checked numa posição.
allowed-tools: Bash(python3 *), Bash(jq *), WebSearch
---

# location-enrichment — playbook de estruturação de location + role_family

O Analista popula **11 colunas** da tabela `positions` ANTES de
marcar `status=checked`. Nunca deixar uma posição `checked` sem
location enrichment.

## As 11 colunas a popular

```
role_family         text   categoria semântica do papel
loc_city            text   cidade do escritório (NULL se apenas country)
loc_region          text   região/estado (opcional)
loc_country         text   país físico do escritório (NULL se apenas continent)
loc_country_code    text   ISO-3166 alpha-2: IT, IE, HU, ...
loc_continent       text   Europe | Asia | Americas | Africa | Oceania
work_mode           text   onsite | hybrid | remote
work_country        text   país contratual (entidade que assina) — NUNCA NULL
work_country_code   text   ISO-2 do work_country
is_multi_location   bool   true se JD lista mais cidades/países
location_notes      text   notas livres do analista
```

## REGRAS comportamentais (CRÍTICAS — sim 1-2 encontrou problemas aqui)

### R1 — Uma posição de cada vez (SEM BATCH)

Processar o seu range uma posição por turno: ler JD → raciocinar →
db-update → status=checked → próxima. NADA de carregar 20+ JDs num
único turno LLM. Exceção: 3-5 casos banais sem web search (ex.
"Dublin, Ireland" + hybrid).

**Porquê**: batch de 17k+ tokens (sim 1) gera respostas genéricas
("multi-location + remote + EU") em vez de dados específicos para cada
registo. E os outros analistas giram em vazio durante o seu mega-turno.

### R2 — Lookup de taxonomia entre pares no DB (a cada 5-10 registos)

ANTES de escolher um valor `role_family`, verificar o que os
colegas usaram:

```bash
python3 /app/shared/skills/db_query.py raw \
  "SELECT role_family, COUNT(*) AS n FROM positions
   WHERE role_family IS NOT NULL
   GROUP BY role_family ORDER BY n DESC"
```

Se encontrar uma family **semanticamente equivalente**, ALINHAR ao
nome deles. Exemplos errados vistos na sim 1:

```
✗ "Translation / Localization" vs "Localization / Language Quality"
  vs "Language / Localization"           → apenas um
✗ "Customer Support" vs "Customer Success / Technical"
  vs "Technical Support"                 → apenas um
✗ "Technical Engineering" para um Technical Writer  → errado
```

Se a posição é realmente uma nova categoria, anotar em
`location_notes` porquê.

### R3 — Fallback work_country (NUNCA NULL em checked)

Se após 2 tentativas de web search não encontrar `work_country` com
certeza, NÃO deixar NULL. Proceder:

1. País do **posting board** (ex. linkedin.it → IT) + nota
   `"work_country inferred from posting board (low confidence)"`
2. País citado no JD como "region" / "office" mesmo que não seja sede legal
3. Última instância: o `loc_continent` como placeholder + nota
   `"work_country=Europe placeholder, entity unverified"`

### R4 — Lookup de cidades na DB dos pares (ANTES de escrever `loc_city`)

Exatamente como R2 para `role_family`, mas para as **cidades**. ANTES de
escrever `loc_city`, verificar que forma os colegas já usaram para esse
país, para não criar um duplicado noutro idioma
(Rome vs Roma, Milan vs Milano):

```bash
python3 /app/shared/skills/db_query.py raw \
  "SELECT loc_country, loc_city, COUNT(*) AS n FROM positions
   WHERE loc_city IS NOT NULL
   GROUP BY loc_country, loc_city ORDER BY loc_country, n DESC"
```

- Se a cidade **já está presente** numa forma → ALINHAR a essa
  (desde que respeite o padrão "exonimo inglês", ver abaixo).
- Se vir um duplicado noutro idioma já na DB (ex. existem tanto
  `Roma` como `Rome`), usar a forma **inglesa** e anotar em
  `location_notes` a forma a consolidar.

## Padrão de escrita

### Países (`loc_country` / `work_country`)

| Sim ✓ | Não ✗ |
|---|---|
| `Italy` | `Italia`, `IT`, `Italie` |
| `United Kingdom` | `UK`, `Great Britain`, `England` |
| `Czechia` | `Czech Republic` |
| `Netherlands` | `Holland`, `The Netherlands` |
| `Székesfehérvár` | `Szekesfehervar` (preservar sempre os diacríticos) |
| ISO-2 `IT, IE, HU, NL, DE, GB, US, ES` | ISO-3, lowercase |

### Cidades (`loc_city`) — exonimo INGLÊS quando existe

**Regra única**: escrever sempre a forma **inglesa** da cidade quando
existe um exonimo consolidado. Se a cidade NÃO tem um exonimo inglês,
usar o nome local **preservando os diacríticos**. Isto alinha o Analista
com o mapa de dedup do Scout (`_CITY_SYNONYMS` em
`shared/skills/db_insert.py`) e elimina os duplicados Rome/Roma,
Milan/Milano.

| Sim ✓ (exonimo EN) | Não ✗ (forma local) |
|---|---|
| `Rome` | `Roma` |
| `Milan` | `Milano` |
| `Naples` | `Napoli` |
| `Turin` | `Torino` |
| `Florence` | `Firenze` |
| `Venice` | `Venezia` |
| `Genoa` | `Genova` |
| `Munich` | `München`, `Monaco di Baviera` |
| `Cologne` | `Köln` |
| `Vienna` | `Wien` |
| `Prague` | `Praha` |
| `Brussels` | `Bruxelles` |
| `Lisbon` | `Lisboa` |
| `Plzeň` (sem exonimo → local + diacríticos) | `Plzen` |

Em caso de dúvida sobre a existência de um exonimo consolidado, aplicar
o peer DB lookup (R4) e **alinhar-se à forma já presente** para essa
cidade.

## Casos especiais (decisão padrão)

### A — "Europe Remote" / "EMEA - Flexible" / "Remote"

```
loc_city          = NULL
loc_country       = NULL          # sem país físico vinculado
loc_continent     = "Europe"      # apenas se a área for explícita
work_mode         = "remote"
work_country      = <web search HQ empresa → fallback R3>
is_multi_location = false
location_notes    = "Remote within EU"
```

### B — "Italy" / "Spain" + full_remote (país + remote)

```
loc_country       = "Italy"
loc_country_code  = "IT"
loc_continent     = "Europe"
work_mode         = "remote"
work_country      = "Italy"       # mesmo país, contrato IT
work_country_code = "IT"
```

### C — "Dublin, Ireland" + hybrid (city+country limpo)

```
loc_city          = "Dublin"
loc_region        = "Leinster"    # opcional
loc_country       = "Ireland"
loc_country_code  = "IE"
loc_continent     = "Europe"
work_mode         = "hybrid"
work_country      = "Ireland"
work_country_code = "IE"
```

### D — Multi-location mesmo país ("Barcelona / Malaga")

```
loc_city          = NULL
loc_country       = "Spain"
loc_country_code  = "ES"
loc_continent     = "Europe"
work_mode         = "hybrid"
work_country      = "Spain"
is_multi_location = true
location_notes    = "Barcelona or Málaga (candidato sceglie)"
```

### E — Multi-country ("Amsterdam, Berlin, London, Remote-Europe")

```
loc_city          = NULL
loc_country       = NULL
loc_continent     = "Europe"
work_mode         = "hybrid"      # ou remote
work_country      = <HQ empresa via web>
is_multi_location = true
location_notes    = "EU multi-country: NL, DE, GB + remote option"
```

### F — Área metropolitana vaga ("Greater Bologna Metropolitan Area")

```
loc_city          = "Bologna"     # promover à cidade principal
loc_country       = "Italy"
location_notes    = "Area metropolitana Bologna (raggio ~30km)"
```

### G — Empresa US com entidade EU que contrata em Espanha

```
loc_country       = NULL
loc_continent     = "Europe"
work_mode         = "remote"
work_country      = "Spain"       # entidade local que assina
location_notes    = "US company (X Inc.), assume tramite entity ES"
```

### H — JD precisa cidade que o scout havia generalizado

Scout havia escrito "Italy" → JD no texto especifica "Milano HQ":
**promover a cidade**.

```
loc_city          = "Milan"
loc_country       = "Italy"
location_notes    = "JD specifica HQ Milano (scout havia 'Italy')"
```

### I — Cidade abreviada ("Dublin 2")

```
loc_city          = "Dublin"
loc_region        = "Dublin 2"    # distrito em region
```

### J — Empresa apenas job board (Railsware, Top Remote Talent, etc.)

Quando a empresa é uma sociedade distribuída sem HQ claro:
aplicar fallback R3 (país do posting board) + anotar.

## Proibidos absolutos

- ❌ `loc_country = "Europe"` ou `"EMEA"` — é continent, não country
- ❌ Mapear "EMEA" como "Europe" sem verificar (inclui Middle East + Africa)
- ❌ `work_country = NULL` numa posição `checked` (quebra UI de salário)
- ❌ Inventar role_family se os colegas já usaram similares → ver R2
- ❌ Escrever `loc_city` no idioma local quando existe o exonimo
  inglês (`Roma`, `Milano`, `Napoli` → usar `Rome`, `Milan`, `Naples`)
  ou sem peer DB lookup → ver R4 + tabela de cidades
- ❌ Carregar o batch inteiro do seu range → ver R1
- ❌ **`loc_city = "Remote" / "Anywhere" / "Distributed"`** — NÃO são cidades.
  Se a posição é full-remote sem city específica, `loc_city = NULL`.
  Bug observado na sim 4: A2 escreveu `loc_city='Remote'` para 8 registos
  (Canonical, Miratech, Link Group, etc.). Corrigir sempre com
  `db_update --loc-city ""` (string vazia = NULL).

## Comandos tipo

### Guardar estrutura de location completa

```bash
python3 /app/shared/skills/db_update.py position <ID> \
  --loc-city "Dublin" \
  --loc-region "Leinster" \
  --loc-country "Ireland" --loc-country-code "IE" \
  --loc-continent "Europe" \
  --work-mode "hybrid" \
  --work-country "Ireland" --work-country-code "IE" \
  --is-multi-location false \
  --role-family "Technical Writing" \
  --location-notes ""
```

### Lookup de taxonomia entre pares (executar a cada 5-10 registos)

```bash
python3 /app/shared/skills/db_query.py raw \
  "SELECT role_family, COUNT(*) AS n
   FROM positions WHERE role_family IS NOT NULL
   GROUP BY role_family ORDER BY n DESC"
```

### Promoção a checked (APENAS após enrichment completo)

```bash
python3 /app/shared/skills/db_update.py position <ID> --status checked \
  --notes "ESPERIENZA: ... \\n LINGUA: ... \\n SENIORITY: ..."
```
