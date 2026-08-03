<!-- @translation: pt, ai-translated 2026-06-06 -->
---
name: office-geocoding
description: Geocodificar o edifício preciso do escritório (lat/lon/endereço) para uma posição APÓS location-enrichment ter populado loc_city/loc_country. Usar web search agressivamente (3+ tentativas) para encontrar o endereço do HQ/escritório da empresa, depois resolver coordenadas via Nominatim/Photon. Pular APENAS após busca exaustiva falhar ou quando múltiplos escritórios ambíguos existem. Define office_lat, office_lon, office_address, office_geocoded, office_verified.
allowed-tools: Bash(python3 *), Bash(curl *), Bash(jq *), WebSearch, WebFetch
---

# office-geocoding — coordenadas precisas do escritório

Executar **após** `location-enrichment`. Pré-requisitos: `loc_city` e/ou
`loc_country` populados (de R12-15). Se a posição é full-remote sem
city, skip imediato (sem escritório para geocodificar).

## 5 colunas a popular

```
office_lat        numeric  latitude WGS84 (ex. 41.8933203)
office_lon        numeric  longitude WGS84 (ex. 12.4829321)
office_address    text     endereço completo do escritório
office_geocoded   bool     true se executou geocoding
office_verified   bool     true se TEM CERTEZA que é o escritório correto;
                           false se fallback ao nível da cidade / multi-ambíguo
```

## REGRA de ouro: verificação web obrigatória

**NÃO guardar nunca um endereço ao nível de rua sem antes tê-lo
verificado via web** como escritório real da empresa. A sequência
correta é **web search ANTES, geocoding DEPOIS** — não o inverso.

### Sequência canónica (sempre nesta ordem)

1. **Tentativa 1 — Web search HQ da empresa na city**
   - Query: `"<Company> headquarters <city> address"`, `"<Company>
     sede <city>"`, `"<Company> office <city>"`, `"<Company> contact"`
   - Fontes aceitáveis como prova: site oficial da empresa,
     LinkedIn "About", Crunchbase, registos comerciais (partitaiva.it,
     cerved.com para IT), resultado Google Maps da empresa.
   - **Extrair o endereço** da fonte encontrada.

2. **Tentativa 2 — Extração do JD**
   - Procurar padrões "Visit us at...", "Sede operativa:", "Our office",
     endereço no rodapé do JD.

3. **Tentativa 3 — Webfetch de uma fonte suspeita**
   - Se a web search mostra título mas não snippet com endereço,
     `WebFetch` da página oficial para extrair.

4. **Geocoding via Nominatim/Photon** **APENAS após** ter encontrado
   o endereço. Nominatim/Photon convertem texto→coordenadas, **não
   são verificação**. Sem endereço da web → sem
   `office_verified=true`.

5. **Fallback ao nível da cidade** quando todas as tentativas acima falham:
   geocodifique o **nome da cidade** (ex. `"Roma, Italy"`), guarde com
   `office_verified=false` e `office_address = <city>, <country>`.
   **NUNCA deixar NULL se a posição tem city/country do location-
   enrichment** — use o fallback da cidade.

### Quando pular com TUDO NULL

Apenas se a posição é full-remote sem loc_city/loc_country (sem
escritório físico para geocodificar). Ver secção "Quando SKIP" abaixo.

## Quando popular com `office_verified=true`

Tem **realmente certeza** que aquele endereço é o escritório correto:

- Site da empresa confirma explicitamente a sede naquela city
- Posting inclui endereço rua + número explicitamente
- LinkedIn "About" da empresa lista aquela city com endereço
- Registo comercial / câmara de comércio para empresas Italy/EU

## Quando popular com `office_verified=false`

Tem coordenadas mas com incerteza:

- Encontrou a sede principal mas JD diz "we have multiple offices
  in <city>, candidate works from one of them"
- Geocodificou ao nível da cidade (centróide cidade) como fallback
- O endereço é aproximado (ex. apenas nome do bairro sem rua)

## Quando SKIP (deixar tudo NULL)

```
office_lat = NULL
office_lon = NULL
office_address = NULL
office_geocoded = false
office_verified = false
```

- Full remote: posição totalmente distribuída sem city específica
- Multi-location ambígua: "Roma ou Milano ou Torino" + work_mode=remote
- 3+ tentativas falharam, nada de concreto encontrado
- Empresa extremamente genérica (agência/recrutador sem escritório próprio
  para aquela posição)

## Workflow de comandos

### Passo 1 — Web search HQ da empresa

```bash
# Procurar a sede principal da empresa naquela city
# Tentar 2-3 queries diferentes se a primeira não esclarecer
```

Use a ferramenta `WebSearch` com queries tipo:
- `"<Company> headquarters <city> address"`
- `"<Company> office <city> via OR street"`  (italiano: via)
- `"<Company> sede legale OR sede operativa <city>"`  (italiano)
- `"<Company> contact us <city>"`  (frequentemente tem endereço)

Para JDs italianos em particular procurar também:
- `"<Company> Roma sede"` / `"<Company> Milano via"` / etc.
- Em registos como `partitaiva.it`, `easy.it`, `cerved.com`,
  `infoimprese.it` para empresas italianas

### Passo 2 — Geocoding via Nominatim (1 req/sec rate limit)

```bash
# URL-encode a query
Q=$(jq -nr --arg s "<endereço encontrado> <city>" '$s | @uri')

curl -sS "https://nominatim.openstreetmap.org/search?q=${Q}&format=json&limit=1" \
  -H 'User-Agent: jht-analyst/1.0 (analista@jht.local)' \
  --max-time 15
```

Resposta JSON: `[{"lat": "...", "lon": "...", "display_name": "..."}]`.
Extrair `lat`, `lon`, `display_name` (= `office_address`).

**Rate limit**: sleep 1.2 sec entre queries Nominatim. Se 429: mudar para Photon.

### Passo 3 — Fallback Photon (komoot, sem rate limit visível)

```bash
Q=$(jq -nr --arg s "<Company> <City>" '$s | @uri')
curl -sS "https://photon.komoot.io/api?q=${Q}&limit=1" \
  -H 'User-Agent: jht-analyst/1.0' --max-time 15
```

GeoJSON: `features[0].geometry.coordinates = [lon, lat]` (NB ordem
invertida! Photon = `[lon, lat]`, Nominatim = `{"lat","lon"}`).

### Passo 4 — UPDATE Supabase via wrapper

```bash
python3 /app/shared/skills/db_update.py position <ID> \
  --office-lat 41.8933203 \
  --office-lon 12.4829321 \
  --office-address "Via Roma 1, 00100 Roma, Italy" \
  --office-geocoded true \
  --office-verified true \
  --action geocode --outcome updated
```

Para skip após 3 tentativas:
```bash
python3 /app/shared/skills/db_update.py position <ID> \
  --office-geocoded false --office-verified false \
  --action geocode --outcome failed
# (lat/lon/address ficam NULL)
```

## Casos típicos resolvidos

### Caso 1 — Empresa italiana com sede única clara

```
"Bending Spoons" + "Milano"
→ web search: "Bending Spoons via Nino Bonnet 10, 20154 Milano"
→ Nominatim: 45.4870, 9.1908
→ office_address = "Bending Spoons Spa, Via Nino Bonnet, Milano"
→ office_verified = TRUE
```

### Caso 2 — Multi-sede na mesma city (TBD explícito)

```
"ION Group" + "Roma" → tem 3 escritórios em Roma (Eur, Centro, Tiburtina)
→ JD não especifica qual → office_verified = FALSE
→ Usar coordenada da sede principal (HQ Roma)
→ office_address = "ION Trading Italy, Viale dell'Aeronautica 100, Roma"
```

### Caso 3 — JD inclui endereço no texto

```
JD: "...vieni a trovarci in Via Tagliamento 45, Roma..."
→ Extrair diretamente o endereço do jd_text
→ Geocodificar esse → office_verified = TRUE
```

### Caso 4 — Skip por ambiguidade

```
"IBM" + "Roma" + remote-eligible
→ IBM tem 4 sedes em Roma, JD não especifica
→ office_geocoded=true, office_verified=false, coordenada sede HQ Roma
→ location_notes já contém "IBM Roma multi-sede"
```

### Caso 5 — Skip por full remote

```
work_mode = remote, loc_city = NULL
→ Posição não tem escritório físico → tudo NULL
→ office_geocoded = false, office_verified = false
```

## Política de rate limit

- Nominatim: 1 req/sec, sleep 1.2s entre queries. Nunca mais de 6 req em 10s.
- Photon: sem rate limit visível, contudo sleep 0.5s de cortesia.
- Web search: preguiçoso, apenas quando geocoding direto falha.
- Se 429 de Nominatim: sleep 30s, mudar para Photon, NÃO tentar novamente
  Nominatim nos próximos 5 minutos.

## Proibidos

- ❌ Inventar coordenadas plausíveis sem verificação web
- ❌ Pôr `office_verified=true` se usou centróide da cidade
- ❌ Desistir após UMA única tentativa Nominatim vazia
- ❌ Geocodificar full-remote (sem escritório físico)
- ❌ Deixar `office_geocoded=NULL` (deve ser `true` ou `false` explícito)
- ❌ Guardar um endereço Nominatim "encontrado" sem antes tê-lo
  ancorado a uma fonte web (site empresa / LinkedIn / registo
  comercial) → risco de geocodificar um nome similar noutra cidade
- ❌ Deixar `office_address=NULL` para posições que TÊM city/country:
  fallback obrigatório `office_address = "<city>, <country>"` com
  `office_verified=false`
