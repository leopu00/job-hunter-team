<!-- @translation: pt, ai-translated 2026-06-06 -->
---
name: salary-estimate
description: Estimativa salarial hierárquica para o Scorer (bug #27). 4 níveis — faixa declarada (L1), cache local (L2), web search (L3), default neutro (L4). Cache local apenas para os Scorer, sem sync remoto. TTL 30 dias porque os salários mudam de ano em ano, não de semana em semana. Usa a skill toda vez que fores escrever `salary_fit`: sem ela, 95% das posições fica com `salary_fit=5/10` neutro (de facto inerte).
allowed-tools: Bash(python3 /app/shared/skills/salary_estimate.py *), Bash(python3 /app/shared/skills/db_update.py *)
---

# salary-estimate — estimativa hierárquica com cache local

## Por que existe

Snapshot 2026-05-17 (43 scores Kimi): 41 scores em 43 com
`salary_fit=5/10` (default "no data no bias"), 2 com valores reais de
JD explícito. Resultado: salary_fit (peso 10/100) era *de facto*
inerte — espaço decisional do Scorer reduzido de 100 para 95.

Causa: ninguém preenchia `salary_estimated_*`. O Scorer é honesto,
não inventa, e sem dado recai no default. Decisão do utilizador:
construir uma cache local das estimativas para que a primeira fetch
custe, e as seguintes sejam grátis. *"Os salários não mudam de semana
em semana, mas de ano em ano"*.

## 4 níveis (por ordem, para no primeiro que produz uma faixa)

### NÍVEL 1 — Faixa declarada (posição)
Se `positions.salary_declared_min` e `salary_declared_max` não forem
NULL → usa esses, sem estimativa. O Writer pode chamar:

```bash
python3 /app/shared/skills/salary_estimate.py --position-id 42
```

O script lê os declared da DB e devolve `level=1` com os números.

### NÍVEL 2 — Cache local
Path: `/jht_home/.cache/salary_estimates.json`. Chave:
`(stack, seniority, country, mode)`. TTL 30 dias.

```bash
python3 /app/shared/skills/salary_estimate.py \
    --stack python --seniority junior --country IT --mode remote
```

Hit → JSON com `level=2, source=cache, min, max`. Miss → cai para L3
ou L4.

### NÍVEL 3 — Web search (stub, depende de F-2)
Por agora devolve None: a skill cai diretamente para L4. Quando
F-2 (Scout web access) estiver disponível, o Scout/Analista preencherá
a cache via web search Glassdoor/Levels/Indeed. A partir desse momento,
o primeiro lookup de uma nova combinação faz uma única fetch, depois
29 dias de hits gratuitos.

### NÍVEL 4 — Default neutro + flag
Se todos os níveis anteriores falharem → devolve `level=4, min=null,
max=null, estimation_failed=true, reason="no_data_default"`. O Scorer
coloca `salary_fit=5` E adiciona `no_data_default` em `score.notes` —
assim o Mentor (downstream) não propaga o 5 como dado real mas como
"N/D" (ver bug #27 fix Mentor).

## Output schema

```json
{
  "level": 1 | 2 | 3 | 4,
  "min": int | null,
  "max": int | null,
  "currency": "EUR",
  "source": "declared" | "cache" | "web" | "default",
  "fetched_at": "YYYY-MM-DD",
  "estimation_failed": false | true,
  "reason": "<optional>"
}
```

## O que o Scorer faz com o resultado

```bash
result=$(python3 /app/shared/skills/salary_estimate.py \
    --stack "$STACK" --seniority "$SENIORITY" \
    --country "$COUNTRY" --mode "$MODE" \
    --declared-min "$DECL_MIN" --declared-max "$DECL_MAX")

# 1. Extrair os campos
min=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['min'] or '')")
max=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['max'] or '')")
failed=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin).get('estimation_failed', False))")

# 2. Se tiver números reais, preenche positions.salary_estimated_*
if [ -n "$min" ] && [ -n "$max" ]; then
  python3 /app/shared/skills/db_update.py position "$POS_ID" \
    --salary-estimated-min "$min" --salary-estimated-max "$max" \
    --salary-estimated-source "salary-estimate"
fi

# 3. Calcula salary_fit (0-10) com a tua lógica existente
#    (comparação com target do candidato de candidate_profile.salary_annual_eur)
#    e inclui a nota "no_data_default" se failed=True.
```

## Seed-cache dev-only

Para aquecer a cache num novo container (ex. teste):

```bash
python3 /app/shared/skills/salary_estimate.py --seed-cache \
    --stack python --seniority junior --country IT --mode remote \
    --declared-min 28000 --declared-max 38000
```

Em produção a cache aquece sozinha: L1 (declared do JD) +
futuro L3 (web search) preenchem-na organicamente no espaço de uma
semana de operação.

## Anti-patterns

- ❌ Web fetch em cada posição — a cache existe precisamente para
  evitar isso. Mesmo `python junior IT remote` executado 10 vezes =
  9 fetches desperdiçadas.
- ❌ TTL agressivo (1 dia) — os salários têm granularidade anual,
  atualizar todos os dias é zero-info-gain + desperdício.
- ❌ Guardar os declared na cache — o declared já está na DB da
  posição, não é preciso duplicá-lo na cache de estimativas.
- ❌ Sync da cache no Supabase — é uma cache **local dos Scorer**, não
  deve ser nem guardada nem partilhada. Regenera-se do zero em poucos
  dias.

## Ver também

- `agents/_skills/db-update/SKILL.md` § Positions — `salary-estimated-*`
- `docs/examples/candidate_profile.yml.example` — `salary_annual_eur` (target do candidato,
  side-fix bug #27)
- `agents/_skills/mentor-output/SKILL.md` — esconde o "5 passivo" quando
  `notes` contém `no_data_default`
