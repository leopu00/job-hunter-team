<!-- @translation: pt, ai-translated 2026-06-06 -->
---
name: circles-and-sources
description: Mapa estratégico de o que procurar ONDE, derivado inteiramente do perfil do candidato. Os 5 círculos concêntricos (work_mode + relocation) indicam o âmbito geográfico; os 4 níveis de fontes (LinkedIn → agregadores ATS → nicho → web) indicam quais plataformas drenar em ordem. Um scout que procura no nível errado no círculo errado desperdiça a sua quota e a sua partição `scout-coord`. Abrir esta skill no boot (após `scout-coord`) e novamente sempre que um círculo estiver esgotado ou um `[FEEDBACK]` do Analista sugerir mudar de fonte.
allowed-tools: Bash(python3 /app/shared/skills/safe_fetch.py *), Bash(python3 /app/shared/skills/linkedin_check.py *)
---

# circles-and-sources — ler o perfil, construir o mapa

Dois eixos ortogonais:
- **Círculos** = ONDE (âmbito geográfico / modo de trabalho)
- **Níveis** = QUAIS plataformas (por ordem de prioridade)

Ambos vêm de `$JHT_HOME/profile/candidate_profile.yml`. **Não assuma**: leia `preferences.work_mode`, `location`, `preferences.relocation`, depois construa os círculos com base no que o candidato realmente quer.

## Os 5 círculos concêntricos

Esgotar cada círculo de dentro para fora antes de avançar para o exterior.

| # | Círculo                      | O que é                                                                                                  | Quando entrar                                                            |
|---|------------------------------|-------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------|
| 1 | 🎯 **Preferência primária**   | O modo + geografia que o candidato declarou como prioridade.                                               | Sempre começar aqui. Drenar primeiro.                                    |
| 2 | 🗺️ **Vizinhos geográficos**   | Áreas imediatamente extensíveis do círculo 1.                                                              | Apenas se `relocation` permitir OU o círculo 1 estiver esgotado.         |
| 3 | ✈️ **Relocation direcionada**  | Cidades / países listados em `preferences.relocation` (ou inferidos de `"ovunque"` / `"Europa"`).          | Apenas se `relocation` for não-vazio (true / lista / `"ovunque"`).       |
| 4 | 🛰️ **Satélite**               | Geografia fora do alvo central, menor probabilidade.                                                       | Apenas se os círculos 1-3 estiverem esgotados.                           |
| 5 | 🌗 **Fronteira**              | Papéis **adjacentes** ao stack primário do candidato (sub-domínios da mesma linguagem, cross-functional, automação, ML adjacente, etc.). O candidato é tratado como adaptável; o Scorer aplica a penalidade de gap a jusante. | Apenas após os círculos 1-4 estarem drenados para o dia. |

### Como materializar o círculo 1 a partir do perfil

```yaml
preferences:
  work_mode: <remoto|ibrido|in sede|flessibile>
  ...
location: <city/area>
preferences:
  relocation: <true|false|"per la giusta posizione"|list>
```

| `work_mode`   | Círculo 1 = O QUE procurar                                                                              |
|---------------|---------------------------------------------------------------------------------------------------------|
| `remote`      | Papéis remotos compatíveis com o fuso/país do candidato (ex. `Remote (EU only)` para baseado na UE)      |
| `on-site`     | Papéis em `location` (base da cidade) apenas                                                             |
| `hybrid`      | Papéis na cidade de `location`, com tag híbrido ou raio de commute                                       |
| `flessibile`  | União dos três acima — esgotar por ordem remoto → cidade → híbrido                                       |

### Círculo 2 — vizinhos geográficos

| Tipo do círculo 1  | Expansão do círculo 2                                                                         |
|------------------|------------------------------------------------------------------------------------------------|
| Remoto (nacional)| Remoto regional / continental compatível com fuso + work-auth do candidato                     |
| Presencial       | Região / área metropolitana do país base                                                      |
| Híbrido          | Igual ao presencial (alargamento do raio de commute)                                          |

### Círculo 3 — relocation direcionada

Apenas se `preferences.relocation` for não-vazio:

| Valor de `relocation`        | Expansão do círculo 3                                                                       |
|------------------------|---------------------------------------------------------------------------------------------|
| Lista (`["Berlin", "Lisbon"]`) | Apenas essas cidades                                                                |
| `"ovunque"`            | Hubs globais **para o domínio do candidato** (finanças → Londres, NYC, Zurique, Frankfurt, Singapura, Dublin, Luxemburgo; tech → SF, Berlim, Amesterdão, Lisboa, Tel Aviv…). **Rodar entre eles round-robin — NÃO drenar o hub mais denso (ex. Londres para finanças) primeiro**, ou a shortlist fica dominada por hubs (ver regra anti-viés, guarda de localização). |
| `"Europa"`             | Hubs tech da UE (Berlim, Londres, Amesterdão, Lisboa, Dublin, Madrid, Paris, Estocolmo, ...) |
| `"per la giusta posizione"` | Pular o círculo 3, marcar candidatos limítrofes do círculo 4 com flag de relocation nas notas |

## Os 4 níveis de fontes

Drenar um nível completamente antes de avançar para o próximo.

| Nível | Tipo                               | Fontes                                                                                                        | Notas                                                                                          |
|------|-------------------------------------|--------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------|
| 1    | **LinkedIn**                        | `linkedin_check.py` (perfil autenticado), `safe_fetch.py`                                           | Universal: cobre remoto, presencial, híbrido. Primeiro passo obrigatório para cada círculo. **NUNCA `fetch` MCP** — bloqueado por robots.txt. |
| 2    | **Agregadores ATS**                 | Boards Greenhouse, boards Lever, Indeed, Wellfound (ex AngelList)                                             | Funcionam para qualquer work_mode. Cobrem muitas empresas num scrape.                          |
| 3    | **Boards de nicho (específicos do perfil)** | Escolher por `work_mode` E domínio                                                                    | (ver tabela abaixo)                                                                            |
| 4    | **WebSearch + páginas de carreiras** | Queries `WebSearch` + scrape de páginas de carreiras de empresas                                              | Último recurso apenas após os níveis 1-3 estarem drenados.                                     |

### Nível 3 — escolher por work_mode + domínio

| `work_mode` do candidato | Boards de nicho a considerar                                                                              |
|-------------------------|--------------------------------------------------------------------------------------------------------------------|
| `remote`                | Remote.co, WeWorkRemotely, RemoteOK, EURemoteJobs (ou equivalentes regionais)                                      |
| `on-site` / `hybrid`    | Boards locais / nacionais (InfoJobs, Glassdoor regional, Stepstone, Welcome to the Jungle FR, ...)                |
| `flessibile`            | Combinar remoto + local                                                                                           |
| Específico por domínio (qualquer) | Nicho por stack: PyJobs (Python), GoJobs (Go), Djinni (Europa de Leste / dev), 4dayweek.io (semana de 4 dias), ... |

> ⚠️ **Não trazer boards específicos de remoto para uma pesquisa não-remota**, e vice-versa. WeWorkRemotely num candidato que quer presencial em Milão é scraping desperdiçado.

## Regra anti-viés (obrigatória) — sobre **empresa E localização**

Duas guardas independentes, ambas no final do lote:

1. **Empresa**: se **> 30% das posições de um único lote vêm de uma empresa**, mude de fonte/query para o próximo lote. Uma scaleup a despejar 12 papéis num board inunda o pool — diversidade importa mais que volume.
2. **Localização** (cidade/área): se **> 40% de um único lote vem de uma cidade**, o próximo lote DEVE visar uma cidade de *outro* círculo. Sem isto, um candidato aberto a um círculo multi-cidade (ex. relocation `"ovunque"`/`"Europa"`) recebe um pool dominado pelo único hub que tem mais postings para o seu domínio — finanças → **Londres**, tech → SF/Berlim. Incidente real (beta tester #2): um candidato de finanças recebeu uma shortlist quase exclusivamente de Londres porque Londres tem ~10× mais postings que qualquer outro hub. Rodar pelas cidades do círculo round-robin; não drenar o hub mais denso primeiro.

```python
# pseudocódigo para a verificação no final do lote
from collections import Counter
batch = [...]
n = len(batch)

# guarda 1 — empresa
top_company, c_count = Counter(p.company for p in batch).most_common(1)[0]
if c_count / n > 0.30:
    log(f"anti-bias empresa: {top_company} = {c_count}/{n} >30% → mudar fonte/query")

# guarda 2 — localização (cidade), CUMULATIVO em todo o run (NÃO apenas este lote)
# A guarda por-lote não basta: um hub (Londres para finanças) fica abaixo-do-limiar
# em cada lote individual e contudo acumula 60% do DB ao longo do tempo (visto ao vivo no
# beta: London=57/97=59%). Medir no TOTAL do DB.
db_by_city = dict(db.execute(
    "SELECT COALESCE(loc_city, TRIM(SUBSTR(location,1,INSTR(location||',',',')-1))), COUNT(*) "
    "FROM positions GROUP BY 1"))
db_total = sum(db_by_city.values()) or 1
top_city, top_n = max(db_by_city.items(), key=lambda kv: kv[1])
if top_n / db_total > 0.35:                       # SOFT cap: nenhuma cidade > ~35% do run
    log(f"anti-bias localização CUMULATIVO: {top_city}={top_n}/{db_total} (>35%) → "
        f"PARAR queries em {top_city}, próximo sweep em cidades prioritárias sub-servidas")
```

**Regra de balanceamento geográfico (cumulativa, soft-cap) — incentiva o spread, não impõe a paridade:**

1. **Leia o perfil**: as `priority cities` (campo `location` / `preferences.relocation`) são o alvo. É normal e justo que as cidades com mais fit pesem mais — NÃO forçar uma divisão uniforme.
2. **Meça no run inteiro** antes de cada novo sweep: `SELECT loc_city, COUNT(*) FROM positions GROUP BY loc_city ORDER BY 2 DESC`.
3. **Soft-cap ~35%**: se UMA só cidade ultrapassar ~35% do total do DB, **pare de a interrogar** nos próximos sweeps e redirecione o esforço. Um hub (ex. Londres para finanças supera cada outra cidade ~10×): deixá-lo correr produz uma shortlist dominada por hubs, inútil para quem tem prioridade multi-cidade.
4. **Quota de cobertura prioritária**: as priority-city do perfil a **0 ou sub-servidas** têm precedência nos próximos sweeps — dedique queries direcionadas (`<provider>:<keyword>:<city>`) até terem uma presença mínima, antes de voltar aos hubs já cheios.
5. **Cidade fora-do-perfil como hub = duplo alarme**: se a cidade dominante NÃO está entre as prioridades do perfil, é hub-bias + off-target → rebalancear com urgência.

### ⚠️ Work-authorization como filtro ANTES do balanceamento (Brexit, vistos)

Balancear localizações não serve se as ofertas não são **trabalháveis** pelo utilizador. Antes de aceitar um hub, verifique a compatibilidade de work-permit com o perfil (cidadania / vistos declarados):

- 🇬🇧 **UK pós-Brexit**: um cidadão **UE sem visto UK** NÃO pode trabalhar em Londres/UK sem **sponsorship** (Skilled Worker visa). Portanto para um perfil só-UE as ofertas UK valem **apenas se** o JD mencionar explicitamente *visa sponsorship*; caso contrário são work-auth incompatíveis → SKIP (ver "Filtros permissivos", regra geo).
- 🇨🇭 **Suíça / não-UE**: mesma lógica — verificar permissão de trabalho.
- Regra prática: se o hub dominante está num país que requer uma permissão que o utilizador não tem (e os JDs não oferecem sponsorship), esse volume é **fantasma** — não conta como cobertura e deve ser excluído do pool, não apenas balanceado.

### 🗣️ Sourcing ciente de idioma — não recolher o que será excluído por língua

Mesmo princípio da work-auth, na frente linguística. Se as **línguas do utilizador** (`languages`, com nível) NÃO cobrem a **língua de trabalho local** de uma cidade alvo, os papéis que a exigem serão descartados a jusante pelo Analista (`[LANGUAGE]`) — recolhê-los é desperdício. Caso real (beta): candidato com inglês C1 + alemão apenas conversacional + nada IT/ES/FR → das 18 excluídas, 11 eram por língua local obrigatória (M&A em alemão em Munique/Zurique, IB em italiano em Milão, etc.).

**Regra:** antes de interrogar uma cidade cujo idioma local o utilizador não domina a nível business, **enviesce as queries para papéis English-first / internacional**:
- Adicione qualificadores à query: `"English-speaking"`, `"international team"`, `"English required"`, nomes de multinacionais/firmas globais (Big4, bulge-bracket, scale-ups internacionais) que trabalham em inglês mesmo em mercados não-anglófonos.
- Para papéis que **requerem** a língua local (e o utilizador não a tem a nível business): trate-os como os UK-sem-sponsor — não inserir, ou inserir apenas se o JD disser explicitamente que a língua local não é necessária.
- Inglês como língua de trabalho ≠ país anglófono: em Amesterdão, Zurique, Luxemburgo, Lisboa muitos papéis de finanças são em inglês. São o **sweet spot** para quem fala apenas inglês mas quer a Europa continental.

Resultado: o pool que sobrevive ao Analista é mais pequeno mas **de alto rendimento** (acessível por língua E por work-auth), em vez de se inflar com papéis que serão descartados.

## Filtros permissivos ao nível do SCOUT

O Scout pré-filtra apenas os casos **totalmente fora de escopo**. **Não fazer o trabalho do Analista** — o candidato é tratado como adaptável a papéis adjacentes. Pular um posting apenas se:

- 🚫 Título contém explicitamente: `senior`, `lead`, `staff`, `principal`, `head of`, `director` → SKIP (gap de seniority demasiado grande)
- 🚫 Work-auth geográfico incompatível com o perfil (ex. `US-only` / `Canada-only` e o candidato não tem visto) → SKIP
- 🚫 Domínio completamente fora de IT/coding (ex. pasteleiro, contabilista, vendas) quando o candidato está em IT → SKIP
- 🚫 Requisito rígido de `> anos_reais + 3` anos de experiência → SKIP (gap moderado é aceitável, o Scorer decide)

Tudo o resto: **inserir**. Stacks adjacentes (dados, devops, plataforma, frontend, automação, ML adjacente, etc.) passam todos; o Scorer atribui uma pontuação proporcional ao fit e o utilizador vê-os.

## Ouvir feedback do Analista

Quando o Analista envia `[FEEDBACK]` com uma tag recorrente (`[SENIORITY] · [STACK] · [GEO] · [LINGUA]`):

1. ACK a mensagem
2. Ajustar as queries / fontes do próximo lote conforme a sugestão
3. Priorizar a fonte/filtro alternativo sugerido para a próxima rotação
4. Notificar o Capitano apenas se emergir um viés sistémico (não resolúvel por mudança de fonte)

Exemplo: Analista diz "4 das últimas 5 do greenhouse.io requerem senior+, mudar fonte". No próximo lote, pular greenhouse.io, experimentar um board Lever ou uma fonte de nicho amigável para juniores.

## Anti-padrões

- ❌ Pesquisar o círculo 2 antes de esgotar o círculo 1 — desperdiça âmbito, dilui resultados.
- ❌ Ir para o nível 4 (WebSearch) antes dos níveis 1-3 estarem drenados — `WebSearch` é a fonte mais ruidosa, guardar para o final.
- ❌ Inferir `relocation = "ovunque"` para um candidato cujo perfil diz `false` — leia o perfil, não projete.
- ❌ Usar LinkedIn via `fetch` MCP — bloqueado por robots.txt; sempre `linkedin_check.py` (autenticado) ou `safe_fetch.py`.
- ❌ Incluir JDs com título senior esperando que o Scorer os filtre — desperdiça orçamento do Scorer, adiciona ruído. Os 4 filtros ao nível do SCOUT acima são o lugar certo.
- ❌ Verificação anti-viés esquecida — uma empresa gananciosa inunda o seu lote.

## Ver também

- `scout-coord` — partição no boot entre scouts (COMO dividir este mapa entre instâncias).
- `position-insert` — o que fazer para cada posição candidata uma vez decidido ONDE procurar.
- `agents/scout/scout.md` — o prompt orquestrador do Scout que chama esta skill.
- `agents/_team/architettura.md` Fase 1 — panorama geral da Descoberta dentro do pipeline.
