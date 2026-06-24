# Ex step onboarding — "How the models compare" + tabella piani

> **DEPRECATO** — rimosso dal wizard desktop il 2026-06-23 (snellimento
> onboarding). Lo step di benchmark e la tabella degli abbonamenti per
> provider sono stati tolti: ora si sceglie solo il NOME del provider, il
> team distribuisce comunque il budget su qualsiasi abbonamento. Conservato
> qui per riferimento.

## Step "How the models compare"

**Lead:** Five variants that matter: Claude in two tiers (Opus 4.7 ceiling
vs Sonnet 4.6 workhorse), Codex at two reasoning efforts (GPT-5.3 high vs
xhigh), and Kimi Code — which has no thinking mode, so it's shown as a
single bar.

**Footnote/fonti:** SWE-bench Verified leaderboard, Artificial Analysis
throughput data, vendor API pricing (April 2026). Kimi Code intelligence
stimata da K2.5 — i numeri di K2.6 Preview non sono ancora pubblicati.

### Dati benchmark (MODEL_VARIANTS)

| Provider | Modello | Intelligence | Speed (t/s) | Cost ($/M) |
|---|---|---|---|---|
| Claude | Opus 4.7 | 87.6 | 51 | 25 |
| Claude | Sonnet 4.6 | 79.6 | 53 | 15 |
| Codex | GPT-5.3 xhigh | 82 | 73 | 14 |
| Codex | GPT-5.3 high | 80 | 90 | 14 |
| Kimi | Kimi Code | 78 | 60 | 2.5 |

Note metodologiche:
- GPT-5.3-Codex (non GPT-5.4): GPT-5.4 è il generalista su ChatGPT; il
  modello nativo della Codex CLI è ancora GPT-5.3-Codex (coding-specialized,
  più forte su SWE-bench Verified). Chi sceglie "Codex" ottiene GPT-5.3-Codex
  di default.
- Haiku escluso — non abbastanza profondo per i ruoli Capitano/Scrittore/Critico.
- GPT-5.3 xhigh estrapolato dal default "high" (~80% SWE-bench Verified da
  benchlm.ai) applicando il guadagno "xhigh" di OpenAI (pochi punti in più
  per 3-5× output token di reasoning).

## Tabella piani per provider (PROVIDER_PLANS)

Metodologia (rielaborata aprile 2026, riconciliata con misure reali da
ksred.com, productcompass.pm, Faros.ai, thread OpenAI community, kimik2ai.com).
Token uncached. Lo sconto cache 75% di Kimi alza il throughput reale.
Monthly tokens = weekly × 4 (conservativo).

### Claude
| Piano | Modello | Prezzo | Token/mese | Note |
|---|---|---|---|---|
| Claude Pro | Sonnet 4.6 · Opus 4.7 | $20/mo | ~32M | ~44k tok / baseline 5h |
| Claude Max 5× | Sonnet 4.6 · Opus 4.7 | $100/mo | ~160M | ~88k tok / 5h · 5× Pro |
| Claude Max 20× | Sonnet 4.6 · Opus 4.7 | $200/mo | ~400M | misurato ~280–440M/mo (post weekly cap) — *consigliato (intelligence)* |

### Codex
| Piano | Modello | Prezzo | Token/mese | Note |
|---|---|---|---|---|
| ChatGPT Plus | GPT-5.3-Codex | $20/mo | ~80M | misurato ~60–100M/mo (post rebalance) |
| ChatGPT Pro 5× | GPT-5.4 · GPT-5.3-Codex | $100/mo | ~400M | ~5× Plus — *consigliato (balanced)* |
| ChatGPT Pro 20× | GPT-5.4 · GPT-5.3-Codex-Spark | $200/mo | ~1.6B | ~20× Plus |

### Kimi
| Piano | Modello | Prezzo | Token/mese | Note |
|---|---|---|---|---|
| Moderato | Kimi Code | $19/mo | ~64M | 2048 Kimi Code req/wk (verificato) |
| Allegretto | Kimi Code | $39/mo | ~320M (est.) | 5× crediti Moderato — *consigliato (affordable)* |
| Allegro | Kimi Code | $99/mo | ~960M (est.) | 15× crediti Moderato |
| Vivace | Kimi Code | $199/mo | ~2.8B (est.) | 44× crediti Moderato |

> Nota di prodotto (2026-06-23): il piano base ~$20 (Claude Pro / ChatGPT
> Plus / Kimi Moderato) **non è consigliato** per un team — non basta nemmeno
> per due agenti attivi. Con un budget di soli ~$20/mese conviene usare il
> CLI da soli, non un team.
