# 2026-05-09 — JHT experimentation overview, 15 giorni (25 apr → 9 mag)

> Pendant markdown del report HTML in
> [`docs/sessions/experimentation-overview-2026-04-25-to-2026-05-09/`](../sessions/experimentation-overview-2026-04-25-to-2026-05-09/index.html).
> I numeri qui sono grep-abili e immutabili dal momento del commit.

## ⏱ Range temporale

```
Inizio sperimentazione:    2026-04-25 23:11 UTC
Fine snapshot:             2026-05-09 16:44 UTC
Durata:                    ~15 giorni
Provider testati:          Kimi K2, Claude Opus, Codex GPT-5.5
```

## 📊 Numeri chiave

```
TOTAL TOKEN CONSUMED      164.8 MT (weighted: input fresco + output
                                    + reasoning, cache_read = 0)
WINDOWS RATE-BUDGET            58 sessioni con ≥5 sample sentinel
  ├ kimi                       31  (26 apr → 5 mag, week intera fino a
                                    weekly limit)
  ├ claude                     13  (test breve 26 aprile, max 36% peak)
  └ openai (codex)             14  (5 mag → 9 mag, week intera fino a
                                    weekly limit)

POSITIONS DISCOVERED          379  (scout consistente ~25/giorno)
  ├ scout-1                   302  (80% dei find totali)
  ├ scout-2                    74
  └ scout-3                     3

POSITIONS SCORED              288  (76% delle 379 trovate)
  ├ 80+                        33
  ├ 70-79                      76
  ├ 60-69                      74
  ├ 50-59                      67  (soglia minima per scrittore)
  ├ 40-49                      19  (promotable)
  ├ 30-39                      16
  └ <30                         3

APPLICATIONS WRITTEN          244
  ├ scrittore-1               100
  ├ scrittore-2                11
  ├ scrittore-3                 6
  └ legacy/migration         123-127  (some null written_by)

APPLICATIONS BY STATUS
  ├ draft                     214  (87%) ← bottleneck reale
  ├ approved                   29  (12%)
  └ ready                       1  (0.4%)

CRITIC SCORE DISTRIBUTION (244 total)
  ├ 8+                          9
  ├ 7-7.9                      68
  ├ 6-6.9                      67
  ├ 5-5.9                      73
  └ <5                         27  (status excluded)
```

## 🪟 Top finestre per provider

| Provider | Top finestra | Peak | Note |
|---|---|---|---|
| Kimi K2 | `T012216Z` (3 mag) | **100%** | Saturazione weekly |
| Kimi K2 | `T222300Z` (2 mag) | **100%** | Saturazione weekly |
| Kimi K2 | `T224459Z` (30 apr) | 84% | Long session 3h28m |
| Codex | `T011502Z` (8 mag) | **100%** | W2, saturazione |
| Codex | `T195322Z` (7 mag) | 85% | W1 prima del fix |
| Codex | `T020729Z` (9 mag) | 76% | W7 post-mailbox |
| Claude | `T010747Z` (26 apr) | 36% | Test breve |

## 🎯 Top consumer (token cumulativi 14 giorni)

```
critico               28387 kT (17.2%)  ← 3-round critic loop drena tanto
scrittore-1           27800 kT (16.9%)
scout-1               21495 kT (13.0%)
analista-1            16829 kT (10.2%)
scrittore-2           14326 kT  (8.7%)
capitano              12909 kT  (7.8%)
scout-2                8817 kT  (5.3%)
scorer-1               8689 kT  (5.3%)
sentinella             7935 kT  (4.8%)
scrittore-3            6061 kT  (3.7%)
analista-2             5892 kT  (3.6%)
dottore                3745 kT  (2.3%)  ← consumo basso nonostante
                                          giri ogni 30min
```

## 🩺 Dottore (deployato 2026-05-08 07:00 UTC)

```
Eventi totali:              1162
Spawns:                       59
Round complete:               50
Ping inviati:                507
Restart eseguiti:              6
Diagnosi:
  ├ alive:                  480 (95%)
  ├ ambiguous:               41
  ├ long_turn:               10
  ├ cli_dead:                 4
  └ stallo:                   3
```

## 📬 Bridge mailbox (deployato 2026-05-08 19:53 UTC)

```
Verdetti totali appended:     64
Delivered via tmux:           43
Recovered via mailbox:        21  (33% drop rate prima del fix)
Per kind:
  ├ tick:                    32
  ├ stalled:                 25
  └ skip:                     7
```

## 🎯 Esiti chiave

### ✅ Cosa ha funzionato

- **Scouting consistente** 24h/24: 3 positions/h reggono per 14 giorni
- **Filtro qualità** efficiente: solo 3 positions <30 (filtro scout
  prima del scorer funziona)
- **Saturazione finestre quando funziona**: 4 finestre toccano 100%,
  1 al 96% — il termostato sa portare il team al limite
- **Multi-provider ottenuto**: stesso codice gira con Kimi/Claude/Codex,
  patch incrementali per Codex (token-by-agent + team-tokens-by-type +
  pacing-bridge top-consumer filter)
- **Bridge mailbox**: recupero 33% verdetti che sarebbero stati persi
- **Dottore stabile**: 50 cicli health-check 0 crash watchdog

### ⚠️ Cosa è andato male

- **Oscillazione control loop**: 4 finestre Codex sotto 70% (W3=57,
  W4=61, W5=62, W6=50). Capitano applica throttle/release in modo binario
- **Bottleneck critic→approved**: 214 application restano draft (87%).
  Il loop 3-round scrittore↔critico non chiude il gating sufficiente
- **Capitano busy = bridge muto**: rc=3 in 33% dei tick prima del fix
  mailbox. Capitano in turno lungo perde verdetti SFORO/MARGINE
- **Quantizzazione Codex**: usage% reportato come integer al sorgente
  provider, bridge skip frequenti per delta=0 anche con team_kt > 0
- **Spawn cieco**: capitano spawnava sempre scout su PIPELINE STALLED.
  Fix data-driven deployato 9 mag 02:00

### ❌ Hard limits

- **Weekly limit hit due volte**: prima Kimi (5 mag), poi Codex (9 mag).
  4 giorni di stop forzato per ciascun reset weekly
- **0 companies in tabella**: il flusso analista non ha mai popolato
  `companies`. 88 positions risultano "unscored" e in realtà sono tutte
  status=excluded — bug schema/migration?
- **1 application = ready** dopo 244 scritte e 30 approved. Gating
  troppo stringente o critic falsamente rigido

### 🔧 Da cambiare nelle prossime 2 settimane

1. **Critic gate** troppo conservativo: rivedere soglie `critic_score`,
   magari 5.5 invece di 5
2. **Provider rotation automatica** quando uno hit weekly
3. **Auto-promotion 40-49**: 19 positions in quel range non promosse —
   capitano dovrebbe farlo by default sui top-N quando coda >=50 e' vuota
4. **Damping piu' aggressivo**: ridurre `frac_pct` cap da 25% a 15%
   per smorzare oscillazione
5. **Companies table**: investigare perché vuota mentre positions
   hanno `company_id` assegnato

## 🔗 Link correlati

- HTML report visuale interattivo:
  [`docs/sessions/experimentation-overview-2026-04-25-to-2026-05-09/`](../sessions/experimentation-overview-2026-04-25-to-2026-05-09/index.html)
- Report sessione precedente (Kimi K2, 30 apr → 1 mag):
  [`2026-05-01-team-session-report.md`](./2026-05-01-team-session-report.md)
- Pesi rate-limit Kimi:
  [`2026-05-03-rate-kimi-weights.md`](./2026-05-03-rate-kimi-weights.md)
- TODO Bridge V7:
  [`TODO-bridge-v7.md`](./TODO-bridge-v7.md)
