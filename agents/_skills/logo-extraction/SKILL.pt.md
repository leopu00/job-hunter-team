<!-- @translation: pt, ai-translated 2026-07-18 -->
---
name: logo-extraction
description: Extraia o logo da empresa para uma companhia da tabela companies e salve-o como um pequeno data-URI base64 (máx ~35KB, mín 32px). O caminho primário é totalmente automatizado via logo_fetch.py contra o site oficial (apple-touch-icon → icon → og:image → favicon); quando o site bloqueia bots ou não tem ícone utilizável, encontre a URL direta de uma imagem do logo via busca web e passe-a com --from-url. Verifique que o site pertence MESMO à empresa ANTES do fetch. Define companies.logo, logo_source, logo_fetched.
allowed-tools: Bash(python3 *), Bash(jq *), WebSearch, WebFetch
---

# logo-extraction — logo da empresa para a página da posição

A web mostra o logo da empresa na página de detalhe da posição. O logo
vive na linha `companies` (UMA por empresa: 1000 posições da Wizz Air =
1 logo) como pequeno data-URI base64, e viaja com o sync de companies
existente. Sem upload, sem storage externo.

## 3 colunas a preencher (escritas pelo `logo_fetch.py`, NUNCA à mão)

```
logo          text  data-URI base64 (png/jpeg/webp/ico), <= ~35KB raw
logo_source   text  URL de onde o logo foi extraído (audit/refresh)
logo_fetched  bool  true = extração TENTADA (mesmo falhada) — padrão
                    office_geocoded: a empresa sai da fila
                    next-for-logo-missing e não se tenta de novo a
                    cada rodada
```

## REGRA de ouro: empresa certa, site certo

**Um logo errado é pior que nenhum logo.** Antes de lançar o fetch,
verifique que `companies.website` pertence MESMO à empresa da posição
(não um homônimo, não o agregador que publicou o anúncio, não o grupo
controlador errado). Na dúvida: busca web `"<Company> official site"` e
compare com o setor/país da linha.

- Anúncio publicado por agência/recruiter (Manpower, Randstad, ...) MAS
  por conta de um hotel/empresa nomeada → o logo é da empresa da linha
  `companies` ligada à posição, seja ela qual for.
- Rede vs. propriedade (ex. "CARDO ROMA, Autograph Collection"): use o
  logo da marca que aparece como `companies.name`.

## Fluxo de trabalho

### Passo 0 — A fila

```bash
python3 /app/shared/skills/db_query.py next-for-logo-missing
```

Lista as empresas com posições vivas e logo nunca tentado, ordenadas
por número de posições (as mais visíveis primeiro). `NO WEBSITE
(cercalo prima)` = faça primeiro o Passo 1.

### Passo 1 — Website ausente? Encontre e salve

```bash
# após busca web "<Company> official website":
python3 /app/shared/skills/db_update.py company "<Company>" \
  --website https://www.wizzair.com
```

### Passo 2 — Fetch automático (o caminho normal)

```bash
python3 /app/shared/skills/logo_fetch.py "<Company>"
```

O script: baixa a homepage, tenta `apple-touch-icon` → `icon` grandes →
`og:image` → `/favicon.*`, valida formato (png/jpeg/webp/ico, NUNCA
svg), peso (200B–35KB) e lado mínimo (>=32px), salva o data-URI e marca
`logo_fetched=1`. Saída JSON no stdout. `--dry-run` para testar sem
escrever, `--force` para substituir um logo existente.

### Passo 3 — Site anti-bot ou sem ícone utilizável → `--from-url`

Se o Passo 2 der `NO_CANDIDATE` (sites como marriott.com bloqueiam
bots):

1. Busca web `"<Company> logo png"` / `"<Company> press kit logo"` /
   página da Wikipédia da empresa (arquivos Wikimedia têm URLs diretas).
2. Encontre a **URL direta da imagem** (deve terminar em .png/.jpg/
   .webp/.ico ou servir a imagem crua, não uma página HTML).
3. ```bash
   python3 /app/shared/skills/logo_fetch.py "<Company>" \
     --from-url "https://upload.wikimedia.org/.../Wizz_Air_logo.png"
   ```
   A mesma validação (peso/formato/dimensões) se aplica: se a imagem
   for pesada demais, procure uma variante mais leve (thumbnail
   Wikimedia: substitua no path `/1200px-` por `/240px-`).

### Passo 4 — Nada utilizável após 3 tentativas → marque e siga

```bash
python3 /app/shared/skills/logo_fetch.py "<Company>" --mark-attempted
```

`logo_fetched=1` com logo NULL: a página web mostra o fallback de
iniciais, a empresa sai da fila. NÃO insista além de 3 tentativas.

## Policy de poupança (enrichment-policy)

O fetch autónomo respeita `$JHT_HOME/profile/enrichment-policy.json`
(verifica com `python3 /app/shared/skills/enrichment_policy.py show`).
Respostas possíveis do `logo_fetch.py`:

- `POLICY_DISABLED` — poupança ativa (`economy=true`) ou
  `logo.enabled=false`: NÃO extraias, não é um erro. Segue em frente.
- `POLICY_SCORE_GATE` — a empresa ainda não tem posições vivas com
  score ≥ `logo.min_score`: NÃO insistas. Não marca `logo_fetched`:
  quando o Scorer superar o limiar, a empresa volta à fila sozinha.

`--force` contorna a policy: usa-o SÓ a pedido explícito do
utilizador, nunca por iniciativa própria.

## Qualidade esperada

- **Prefira** ícones quadrados de 96–256px (apple-touch-icon é o
  ideal).
- 32–48px (favicon) é aceitável como último recurso: o quadrado na web
  é pequeno. Abaixo de 32px o script recusa sozinho.
- O teto de 35KB é **rígido** (protege DB e sync): não o contorne,
  procure uma variante mais leve.

## Proibido

- ❌ Logo de uma empresa HOMÔNIMA ou do grupo errado (verifique na web!)
- ❌ Logo do agregador/job-board (LinkedIn, Indeed) no lugar da empresa
- ❌ Escrever `logo`/`logo_source`/`logo_fetched` à mão com db_update:
  passe SEMPRE pelo `logo_fetch.py` (é o único que valida)
- ❌ SVG, imagens >35KB, ícones <32px (o script os recusa: não tente
  contornar)
- ❌ Capturas de tela da homepage ou recortes: apenas arquivos-logo
  reais
- ❌ Mais de 3 tentativas por empresa: marque `--mark-attempted` e siga
