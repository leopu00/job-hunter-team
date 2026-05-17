---
name: salary-estimate
description: Stima salariale gerarchica per il Scorer (bug #27). 4 livelli — range dichiarato (L1), cache locale (L2), web search (L3), default neutrale (L4). Cache locale ai soli Scorer, niente sync remoto. TTL 30 giorni perché i salari cambiano di anno in anno, non di settimana. Usa la skill ogni volta che stai per scrivere `salary_fit`: senza, finisce che 95% delle posizioni ha `salary_fit=5/10` neutrale (de facto inerte).
allowed-tools: Bash(python3 /app/shared/skills/salary_estimate.py *), Bash(python3 /app/shared/skills/db_update.py *)
---

# salary-estimate — stima gerarchica con cache locale

## Perché esiste

Snapshot 2026-05-17 (43 score Kimi): 41 score su 43 con
`salary_fit=5/10` (default "no data no bias"), 2 con valori reali da
JD esplicito. Risultato: salary_fit (peso 10/100) era *de facto*
inerte — spazio decisionale dello Scorer ridotto da 100 a 95.

Causa: nessuno popolava `salary_estimated_*`. Lo Scorer è onesto,
non inventa, e senza dato ricade sul default. Decisione utente:
costruire una cache locale degli stimati così la prima fetch costa, le
successive sono gratis. *"I salari non cambiano di settimana in
settimana, ma di anno in anno"*.

## 4 livelli (in ordine, stop al primo che produce un range)

### LIVELLO 1 — Range dichiarato (posizione)
Se `positions.salary_declared_min` e `salary_declared_max` non NULL →
usa quelli, niente stima. Lo Scrittore può chiamare:

```bash
python3 /app/shared/skills/salary_estimate.py --position-id 42
```

Lo script legge i declared dalla DB e ritorna `level=1` con i numeri.

### LIVELLO 2 — Cache locale
Path: `/jht_home/.cache/salary_estimates.json`. Key:
`(stack, seniority, country, mode)`. TTL 30 giorni.

```bash
python3 /app/shared/skills/salary_estimate.py \
    --stack python --seniority junior --country IT --mode remote
```

Hit → JSON con `level=2, source=cache, min, max`. Miss → cade su L3
o L4.

### LIVELLO 3 — Web search (stub, dipende F-2)
Per ora ritorna None: la skill cade direttamente su L4. Quando
F-2 (Scout web access) sarà disponibile, lo Scout/Analista popolerà
la cache via web search Glassdoor/Levels/Indeed. Da quel momento il
primo lookup di una nuova combinazione fa una sola fetch, poi 29 giorni
di hit gratuiti.

### LIVELLO 4 — Default neutrale + flag
Se tutti i livelli sopra falliscono → ritorna `level=4, min=null,
max=null, estimation_failed=true, reason="no_data_default"`. Lo Scorer
mette `salary_fit=5` E aggiunge `no_data_default` in `score.notes` —
così il Mentor (downstream) non propaga il 5 come dato reale ma come
"N/D" (vedi bug #27 fix Mentor).

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

## Cosa fa lo Scorer col risultato

```bash
result=$(python3 /app/shared/skills/salary_estimate.py \
    --stack "$STACK" --seniority "$SENIORITY" \
    --country "$COUNTRY" --mode "$MODE" \
    --declared-min "$DECL_MIN" --declared-max "$DECL_MAX")

# 1. Estrai i campi
min=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['min'] or '')")
max=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['max'] or '')")
failed=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin).get('estimation_failed', False))")

# 2. Se ha numeri reali, popola positions.salary_estimated_*
if [ -n "$min" ] && [ -n "$max" ]; then
  python3 /app/shared/skills/db_update.py position "$POS_ID" \
    --salary-estimated-min "$min" --salary-estimated-max "$max" \
    --salary-estimated-source "salary-estimate"
fi

# 3. Calcola salary_fit (0-10) con la tua logica esistente
#    (confronto con target candidato da candidate_profile.salary_annual_eur)
#    e include la nota "no_data_default" se failed=True.
```

## Seed-cache dev-only

Per scaldare la cache su un nuovo container (es. test):

```bash
python3 /app/shared/skills/salary_estimate.py --seed-cache \
    --stack python --seniority junior --country IT --mode remote \
    --declared-min 28000 --declared-max 38000
```

In produzione la cache si scalda da sola: L1 (declared dal JD) +
futuro L3 (web search) la popolano organicamente nell'arco di una
settimana di operatività.

## Anti-patterns

- ❌ Web fetch ad ogni posizione — la cache esiste apposta per
  evitarlo. Stesso `python junior IT remote` rieseguito 10 volte =
  9 fetch sprecate.
- ❌ TTL aggressivo (1 giorno) — i salari hanno granularità annuale,
  refresh tutti i giorni è zero-info-gain + spreco.
- ❌ Salvare i declared in cache — il declared è già nella DB della
  posizione, non serve duplicarlo nella cache stima.
- ❌ Sync cache su Supabase — è una cache **locale agli Scorer**, non
  va né backuppata né condivisa. Si rigenera da zero in pochi giorni.

## See also

- `agents/_skills/db-update/SKILL.md` § Positions — `salary-estimated-*`
- `candidate_profile.yml.example` — `salary_annual_eur` (target candidato,
  side-fix bug #27)
- `agents/_skills/mentor-output/SKILL.md` — hide "5 passivo" quando
  `notes` contiene `no_data_default`
- `docs/internal/2026-05-17-team-strategy-bugs.md` §27 — discussione
  Scorer + decisione utente
