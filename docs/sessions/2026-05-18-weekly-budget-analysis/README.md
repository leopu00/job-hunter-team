# 📊 Analisi consumo weekly Kimi — 18 maggio 2026

**Sintesi in 1 riga**: 1% di una finestra Kimi (5h) ≈ 0.20% del weekly budget. Settimana corrente consuma ~8.5% in più della precedente per finestra unitaria, principalmente per **Capitano context bloat** (83.7k tokens/turn).

---

## ⏱️ Contesto

```
Reset weekly:  2026-05-17 17:11 UTC
Snapshot:      2026-05-18 10:37 UTC  (17h 26m dal reset)
Weekly usage:  47%
```

---

## 🪟 Finestre Kimi vere (5h rolling) post-reset

Raggruppate per `reset_at` (cambio di reset = nuova finestra Kimi
server-side, indipendentemente dai `session_id` che cambiano per
recreate container).

| # | reset_at | inizio→fine     | usage max | Δweekly | stato |
|---|----------|-----------------|-----------|---------|-------|
| F2 | 23:11   | 18:12 → 23:04   | 99%       | +20%    | ✅ piena (5 recreate container dentro) |
| F3 | 04:11   | 23:14 → 04:09   | 3%        | +0%*    | 💀 zombie night (Capitano morto) |
| F4 | 09:11   | 04:12 → 09:05   | 97%       | +20%    | ✅ piena (recupero mattutino) |
| F5 | 14:11   | 09:15 → 10:37   | 34%       | +7%     | 🔄 in corso |
| **TOT** | | | **233 unità** | **+47%** | |

\* Il bridge tronca a 0% per arrotondamento sotto-tick. In realtà la
zombie ha consumato ~0.6% weekly (3% finestra × 0.20).

---

## 🧮 Coefficiente di conversione

Derivato dai 4 punti osservati (regressione semplice):

```
1% usage finestra ≈ 0.20% weekly  (settimana corrente)

1 finestra al 100% = 20% weekly
1 finestra al  95% = 19% weekly
1 finestra al  50% = 10% weekly
1 finestra al  10% =  2% weekly
1 finestra al   1% = 0.2% weekly
```

### Verifica modello vs realtà

| Finestra | usage max | stima (×0.20) | osservato | Δ |
|---|---|---|---|---|
| F2 | 99% | 19.8% | 20% | +0.2 |
| F3 |  3% |  0.6% |  0% | -0.6 (troncamento) |
| F4 | 97% | 19.4% | 20% | +0.6 |
| F5 | 34% |  6.8% |  7% | +0.2 |
| **Σ** | 233% | **46.6%** | **47%** | **+0.4** ✓ |

Modello affidabile, scarto 0.4 pp su 47.

---

## 📊 Confronto con settimana precedente

```
                              1% finestra → ? weekly
Settimana scorsa (5 fin.)         0.189%   weekly
Settimana corrente   (4 fin.)     0.205%   weekly
─────────────────────────────────────────────────────
Inflazione per unità              +8.5%

Capienza max settimanale (al 100%):
  Settimana scorsa: 100 / 18.9 = 5.3 finestre piene
  Settimana corrente: 100 / 20.5 = 4.9 finestre piene
  Δ: -0.4 finestre
```

---

## 🔍 Cause inflazione (+8.5% per finestra)

### 1️⃣ Capitano context bloat (causa principale)

```
Tokens/turn medio:
  Settimana scorsa: ~50k tokens/turn (Capitano short-lived,
                                       reset naturale ogni 5h)
  Settimana corrente: 83.7k tokens/turn (+67% in più per turn)

Spesa settimanale Capitano:
  77.2 MT totali → 27.8% del weekly Kimi.

Causa: dal boot del container il Capitano accumula tutta la storia
inter-agente nel suo context. Ogni turn legge nuovamente la storia
completa → cost cresce linearmente col tempo dall'ultimo restart.
```

### 2️⃣ Worker paralleli

```
Stamattina contemporanei: SCRITTORE-1, SCRITTORE-2, SCRITTORE-3
                          + CRITICO-S1, CRITICO-S2 (per 3 round)
Settimana scorsa media: 1-2 worker paralleli max.

Più worker = più context da gestire = più ack/coordination Capitano.
```

### 3️⃣ Auto-report ogni 2h

```
Loop bash check ogni 5 min (deterministico, ~0 token).
Invio reale ogni 2h (PNG + Telegram, deterministico via auto_report.py).

Impatto Capitano: PACING tick extra ricevuti → +context history,
ma trascurabile (~1% weekly stimato).
```

### 4️⃣ Critic-loop su volume più alto

```
CV processati settimana corrente: 31+ (dati DB current)
CV settimana scorsa: ~12-15

3 round per CV × 31 = ~93 spawn CRITICO-S vs 36-45 prima.
Ogni round consuma ~5k tokens contesto base × 3 = 15k/CV minimo.
```

---

## 💸 Costo zombie night quantificato

```
F3 (zombie night 23:14-09:05 UTC) doveva essere finestra piena come
F2/F4 → ~97% usage → ~19% weekly speso.

Realtà: 3% usage → 0.6% weekly.

CAPACITÀ LAVORATIVA persa (NON budget perso):
  19% - 0.6% = ~18% weekly NON SPESO ma anche NON LAVORATO

Tradotto:
  -5h di team produttivo perdute (notte 23:14-04:09)
  +0% extra di spesa weekly
  Il budget non-speso è ancora disponibile.

Recuperato in F4 mattutina (post-rianimazione Capitano alle 06:11):
  +20% weekly = un'altra finestra piena di lavoro.
```

---

## 📏 Cumulativo finestra-units consumate

```
Finestre piene contribuiscono proporzionalmente:

  F2 (99%) →  99 unità  ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰
  F3 ( 3%) →   3 unità  ▰                       ← zombie minima impronta
  F4 (97%) →  97 unità  ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰
  F5 (34%) →  34 unità  ▰▰▰▰▰▰▰
  ──────────────────────────────────────────
  TOT     →  233 unità  → ~47% weekly

Budget rimanente: 100% - 47% = 53% weekly
In finestra-units: 53 / 0.20 = 265 unità rimanenti
                 = 2.65 finestre al 100%
                 = 3 finestre al 88%
                 = 4 finestre al 66%
                 = 5 finestre al 53%
```

---

## 🎯 Spesa per agente (settimana corrente)

```
Totale token: 278 MT  (milioni di token dal reset 17/5 17:11 UTC)

agent           tokens    turns     %     tk/turn
─────────────────────────────────────────────────────
scrittore-1    79.8 MT   1092     28.7%   73.0k
capitano       77.2 MT    922     27.8%   83.7k   ← context bloat
scout-1        43.4 MT    371     15.6%  116.9k   ← sweep grandi
scrittore-3    38.7 MT    515     13.9%   75.2k
analista-1     16.8 MT    244      6.0%   68.6k
?               8.8 MT    157      3.2%   55.9k
sentinella      4.6 MT    134      1.7%   34.5k
scrittore-2     4.4 MT    204      1.6%   21.7k
scorer-1        2.4 MT     20      0.9%  119.5k
assistente      1.9 MT     57      0.7%   33.4k
mentor          0.2 MT     15      0.1%   14.6k
```

Top 4 = 86% del consumo settimanale (scrittore-1, capitano, scout-1, scrittore-3).

---

## 🛠 Mitigazioni proposte

### 🥇 Refresh contesto periodico del Capitano (impatto massimo)

```
Idea utente: gli agenti possono ripartire con memoria nuova senza
fare danni perché il loro stato è registrato nel DB. La conversazione
in chat non è critica.

Implementazione (da fare in sessione futura):
  - ogni N ore (es. 4-6h), il Capitano si auto-restarta via
    spawn-agent (kill session + new kimi --yolo)
  - lo state critico (claim worker, sentinel-state) è in DB/JSON
  - il prompt + skills.list lo ricaricano fresco
  - context bloat resettato → tokens/turn torna a ~50k

Beneficio stimato: -10% spesa Capitano = ~2.8% weekly recuperati
                 = 1 finestra extra disponibile.
```

### 🥈 Scout sweep più mirati

```
Scout-1 a 116.9k tokens/turn (alto). Sweep web rumorosi: probabilmente
fetch HTML pesanti messi nel context invece di estratti.

Azione: rivedere skill scout-web-access per:
  - Cap a 8000 chars per fetch (già configurato in linkedin_access.py)
  - Strip HTML/CSS prima di passare al context
  - Dedup hash content per evitare re-elaborazione
```

### 🥉 Fix già applicati (impatto su consumo futuro)

```
✅ Doctor-watchdog cadenza 30min→2h (-5% weekly stimato)
✅ Agent-watchdog pane_check (no più zombie night da -18% capacity)
✅ CV engine wkhtmltopdf gate (-0% spesa ma molta meno frustrazione utente)
✅ Skill spawn-doctor (no più URG a Dottori morti, recupero più rapido)
```

---

## 📐 Formula riassuntiva

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│   weekly% consumed ≈ Σ ( usage%_finestra_i × 0.205 )         │
│                                                              │
│   dove 0.205 è il coefficiente di conversione corrente,      │
│   inflazionato da 0.189 della settimana scorsa per via       │
│   del context bloat Capitano (+8.5%).                        │
│                                                              │
│   Target: tornare a coefficiente 0.18-0.19 con il refresh    │
│   contesto periodico = +1 finestra di capacità settimanale.  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 🔗 Documenti collegati

- `docs/sessions/2026-05-17-budget-windows/` — analisi grafica
  cumulativa 5 finestre Kimi della settimana precedente
- `docs/sessions/2026-05-18-capitano-zombie-night/README.md` —
  post-mortem zombie night che ha causato F3 al 3%
- `docs/sessions/2026-05-17-team-strategy-bugs.md` §24 — Sentinella
  3 fasi (impatto su throttling fine-grained)
- `agents/capitano/capitano.md` — Capitano prompt (potenziale
  refresh periodico futuro)
