# 📋 Case Study Staging — Run VPS1 (Codex) + Run Kimi K2

**Purpose**: documento di consolidamento per promuovere a `docs/about/RESULTS.md` come Case Study #2 e #3. Aggrega tutto ciò che abbiamo già scritto nei doc internal/sessions, marca i gap, lista cosa serve recuperare dalle VPS Hetzner (DB SQLite raw, log Sentinella, transcript agenti).

**Status**: 🟡 WIP — Phase 1 (consolidamento doc esistenti) done. Phase 2 VPS1/Codex (raw VPS data) ✅ done 2026-05-23. Phase 2 Kimi pending (SSH key mismatch da risolvere).

**Provenance fonti**:
- VPS1/Codex: `docs/internal/2026-05-21-vps1-run-postmortem.md` (consolidato da merge `0b5e5ba7` di 3 file: team-idle-gaps + team-output-analysis + kimi-vs-codex) + `docs/internal/2026-05-21-halt-weekly-incident.md`
- Kimi K2: `docs/internal/_archive/2026-05-17-team-strategy-bugs.md` (146KB, misto bug-fix log + numeri run) + `docs/sessions/2026-05-18-fix-effectiveness-review/README.md` + `docs/sessions/2026-05-17-pipeline-snapshot/README.md`

---

## 🧪 Case Study #2 — Codex ProLite × Beta tester 1 (senior multilingual technical profile, multi-country EU)

### 📋 Metadata (✅ verificato da DB raw 2026-05-23)
| Campo | Valore |
|---|---|
| Provider | Codex ProLite — gpt-5.5 high |
| Subscription tier | Weekly cap 10080 min (~168h), primary 300 min per finestra 5h |
| User profile | **Beta tester 1** — senior 10y in multilingual technical documentation/translation, con skill secondary tecnico-manifatturiere. Multi-country EU search. *📝 staging baseline diceva "non-tech multi-dominio" → corretto* |
| Target geo / lingue | Multi-country EU search (3 primary markets + EU remote fallback) |
| Periodo | **19 mag 2026 20:29:58 UTC → 21 mag 2026 07:20:05 UTC** ✅ exact |
| Durata | **34.84h** (~35h ✓) |
| Hardware | Hetzner **CPX22** (2 vCPU AMD x86, 4GB RAM, 80GB disk) — IP `203.0.113.20`, location Falkenstein (fsn1) |
| Costo VPS | ~€9.75/mo listino CPX22 (fattura da confermare) |
| Costo subscription Codex | ❓ ProLite mensile non esplicitato |
| Config | `JHT_LANG=en`, `JHT_HOST_TYPE=vps`, `JHT_USER_TZ=UTC` |

### 📊 Numeri pipeline (✅ verificato da DB raw)

**Status distribution** (`positions`, n=206):
| Stadio | Conteggio | % |
|---|---|---|
| ready (CV+critic PASS) | 105 | 51.0% |
| excluded | 63 | 30.6% |
| scored | 31 | 15.0% |
| checked | 5 | 2.4% |
| writing (bloccate al HALT) | 2 | 1.0% |

**Pipeline activity** (`position_state_transitions`, n=881):
| Agente | Transitions | Note |
|---|---|---|
| analista-1 | 206 | analizzato 100% |
| scorer-1 | 190 | 16 non scorate (escluse pre-score) |
| scout-1 | 130 | initial inserts |
| scrittore-2 | 99 | top writer per attività |
| scrittore-1 | 93 | |
| scrittore-3 | 85 | |
| scout-2 | 76 | initial inserts |
| capitano | 2 | coordination only |

**State flow** (transitioni tracciate):
```
new (206) → checked (196) → scored (168) → writing (138) → ready (104)
                                                          ↘ ready direct (1)  ← bypass
            excluded (10) | (23) | (3) | (27)               = 105 ready total
```

**Companies** (`companies`, n=179):
| Verdict | Conteggio | % |
|---|---|---|
| GO | 120 | 67.0% |
| CAUTIOUS | 59 | 33.0% |
| **NO_GO** | **0** | **0.0% — rubric bug confermato** |

**Applications** (`applications`, n=122):
| Status | Conteggio |
|---|---|
| ready | 105 |
| draft | 17 |
| **applied (auto-submit)** | **0** ✅ by-design |

**Critic verdict** (su applications, n=119 con score):
| Verdict | Conteggio | Avg score |
|---|---|---|
| PASS | 105 | 6.53 / 10 |
| REJECT | 14 | 4.58 / 10 |
| **Overall** | **119** | **6.35 / 10** |

> 📝 staging baseline diceva "critic score medio 6.30" → verificato **6.35** (overall) o **6.53** (solo PASS).

**Score distribution** (`scores`, n=180):
| Bucket | Conteggio | % di scorate |
|---|---|---|
| 85-100 top | 14 | 7.8% |
| 75-84 high | 41 | 22.8% |
| 65-74 mid | 45 | 25.0% |
| 55-64 low | 37 | 20.6% |
| <55 reject | 43 | 23.9% |

**Scout split** (con scoring):
| Scout | Trovate | Scorate | Avg score | High 80+ | Low <60 |
|---|---|---|---|---|---|
| scout-1 | 130 | 112 | **63.1** | 16 (14%) | 45 (40%) |
| scout-2 | 76 | 68 | **68.4** | 15 (22%) | 15 (22%) |

> 📝 staging diceva "Scout-2 54.4% vs 40.2% high-score" → verificato: scout-2 22% vs scout-1 14%. **High concentration di scout-2 è 1.6× scout-1, non 1.3×**. Filtering filone curated funziona ma magnitude inferiore al claimato.

### 🌍 Geo & domain breakdown (✅ nuovo, non in staging baseline)

**Geo aggregato per paese** (top normalizzati):
| Country | n | % |
|---|---|---|
| IT | 70 | 34.0% |
| HU | 24 | 11.7% |
| UK | 19 | 9.2% |
| Company/EU | 18 | 8.7% |
| IE | 15 | 7.3% |
| NL | 11 | 5.3% |
| DE | 11 | 5.3% |
| ES | 7 | 3.4% |
| FR | 2 | 1.0% |
| OTHER | 29 | 14.1% |

**Company type**:
| Type | n | % |
|---|---|---|
| onsite | 98 | 47.6% |
| full_remote | 63 | 30.6% |
| hybrid | 45 | 21.8% |

**Domain (estratto da title keywords)**:
| Domain | n | Avg score |
|---|---|---|
| Other | 85 | 60.8 |
| TechWriter/Editor | 77 | 65.2 |
| CNC/Manufacturing | 22 | 71.0 |
| Designer | 13 | 70.2 |
| Translator/Linguist | 5 | 73.4 |
| **Woodworking** | **4** | **87.3** ← top score domain |

> 📝 staging diceva "niche-manifatturiero score 84.2" → verificato **87.3** (più alto del documentato). Solo **4 posizioni** nel dominio, alta variance ma top-quality match.

**Time-to-ready** (found_at → status='ready', n=105):
- Avg: **7.39 ore**
- Min: 0.21h (12 minuti!)
- Max: 18.88h

> 📝 staging diceva "median 8h20min" → avg verificato 7.39h. Coerente.

### 📁 Deliverables on disk (✅ verificato)
| Tipo | File count | Size |
|---|---|---|
| CV PDF | 124 | 6.0M |
| CV MD | 124 | (incl. sopra) |
| Critiche | 334 | 2.5M |
| Allegati (cover letters) | 2 | minimal |
| Output (per-position packets) | 157 | 1.9M |

> 📝 staging diceva "100% wkhtmltopdf" — verifica da metadata PDF deferita.
> **124 CV PDF ≠ 105 ready** — discrepanza di 19 (probabilmente 17 draft + 2 writing che hanno CV generato ma non promossi).

### 💰 Economics (✅ token-meter + Hetzner API verificati)
**Token consumption (Codex weighted)**:
- **Totale**: **396,902,228 weighted tokens** (~397M) cumulato in 34.84h
- **Breakdown**: in_raw 267M + out_raw 575K + cache_read 258M + cache_creation 0
- **Sessions Codex aperte**: 85
- **Ratio empirico**: **4.27M tokens / 1% weekly budget** (calibrazione su Codex ProLite)
- **Rate orario medio**: ~11.4M tokens/h (vs Codex weekly burn ~2.7%/h)
- **Burn rate al peak**: bridge_pct = 93-96% STEADY durante run

**Costo VPS (Hetzner CPX22)** — fonte: `hcloud server-type describe cpx22`:
- Hourly: **€0.01561**, Monthly: **€9.7478**, traffic incluso 20 TiB
- **Costo Codex run (34.84h)**: **€0.54**
- **Costo idle post-run** (21/05 07:20 → 23/05 ~16:00, ~57h): **€0.89** (VPS lasciata accesa)
- **Costo totale VPS Codex 19/05→23/05**: **~€1.43**

**Costo subscription Codex ProLite**: **~€100/mo** (1 mese pagato, fonte: maintainer dichiarazione 2026-05-23)

### 📅 Timeline produttività
**Positions found per day**:
| Day | n |
|---|---|
| 19/05 | 28 |
| **20/05** | **172 ← peak day** |
| 21/05 | 6 |

**Applications created per day**:
| Day | n |
|---|---|
| 19/05 | 15 |
| **20/05** | **80 ← peak** |
| 21/05 | 27 |

### ✅ Cosa ha funzionato (verificato)
1. **Pipeline end-to-end chiusa** — 206 → 105 ready in 34.84h, 51% conversion rate.
2. **Critic loop sostenuto** — 119 review (88.2% PASS), score PASS 6.53/10. Qualità output **protocol-driven**, non provider-driven.
3. **Scout-2 quality > Scout-1** — 22% high-score vs 14% (filone curated supera volume; effetto reale ma più modesto del claimato).
4. **Woodworking dominio top** — score medio 87.3 su 4 posizioni (high-precision, small-volume — pattern interessante).
5. **State tracking attivo** — 881 transizioni loggate (bug #14 fix attivo). 1 caso `scored → ready direct` bypass writing — verificato anomalia.
6. **Time-to-ready basso** — avg 7.39h, min 12 minuti (filone fluido).

### ⚠️ Cosa NON ha funzionato (verificato + correzioni)
1. **[PACING-WEEKLY-EXHAUSTION] P0** — Weekly cap consumato in ~2.3 giorni vs goal 7.
2. **Companies rubric inadeguato — confermato** — **0 NO_GO su 179** (120 GO + 59 CAUTIOUS). Hard-requirements (laurea, geo) non filtrate da Analista.
3. **Writer attribution rotto** — solo 8/119 `written_by` popolato (93% null), peggio del 95% claimato staging.
4. **Glassdoor rating non popolato** — verifico da DB se 0/179 confermato. *[da query]*
5. **2 position in `writing` al HALT** — verificato bloccate (state transitorio).
6. **Cover letters quasi assenti** — solo 2 file in `allegati/`, vs 124 CV. **Pattern non-coperto nello staging**: writer non genera cover sistematicamente.
7. **Capitano transitions = 2** — coordination via tmux/messages, non state changes. Aspettato.

### 🔍 Lesson learned / confidence (post-DB verification)
- **Numeri base TUTTI VERIFICATI**: 206 / 105 / 119 / 63 / 31 — exact match staging.
- **Companies bug rubric reale**: 0 NO_GO non è artefatto, è gap di filtering.
- **Cover letter gap nuovo trovato**: pre-launch è da discutere se generare cover automaticamente o richiede skill esplicita.
- **Profilo candidato CORRETTO**: Beta tester 1 = senior 10y in multilingual technical documentation + skill secondary tecnico-manifatturiere, non "non-tech generic" come da staging. Le skill secondary spiegano il filone niche-manifatturiero high-score.
- **Time-to-ready 7.39h** sostiene narrativa "AI scrive CV in ~mezza giornata".

### ❓ Dati ancora mancanti
- ❓ Costo Codex ProLite subscription mensile (fattura/billing dashboard)
- ❓ Costo VPS Hetzner reale (fattura aprile-maggio)
- ❓ Token cost **per-agent** (token-meter aggrega solo per provider) — serve parsing sessions logs in container
- ❓ Engine generazione CV per file (wkhtmltopdf vs altro) — verifica via PDF metadata
- ❓ `glassdoor_rating` popolato su quante companies (claimato 0/179)
- ❓ Sentinella event timeline per estrarre weekly burn curve precisa

---

## 🧪 Case Study #3 — Kimi K2 × Beta tester 2 (junior software developer, single capital city)

> 📝 **Profilo CORRETTO da DB raw**: candidato = **Beta tester 2** (maintainer-internal tester, profilo costruito ad hoc). Target = **junior software developer ~1y, no degree, single European capital city, settore tech/finance**. Staging baseline diceva "tech SWE Python/Data" — verificato + arricchito. **Profilo diverso da Codex run**: i due case study NON sono "stesso candidato + due provider" ma "due profili + due provider". Comparazione provider richiede caveat esplicito.

### 📋 Metadata (✅ verificato da DB raw 2026-05-23)
| Campo | Valore |
|---|---|
| Provider | Kimi K2 (token-based, no weekly cap) |
| User profile | **Beta tester 2** — junior software developer ~1y, no degree, single European capital city, settore tech/finance |
| Periodo (state transitions) | **17 mag 2026 19:14:20 UTC → 19 mag 2026 01:27:27 UTC = 30.22h** ✅ |
| Periodo (positions found) | **16 mag 2026 → 19 mag 2026** (4 giorni, scout attivo prima dello state-log) |
| Hardware | Hetzner **CPX22** — IP `203.0.113.30`, location Nuremberg (nbg1) |
| Costo VPS | ~€9.75/mo listino CPX22 |
| Costo subscription Kimi | ❓ probabile €40 mass-market tier |

> 📝 **Run molto più lungo del documentato**: staging baseline diceva "~17 maggio + 65h pre-fix + 17h post-fix" → verificato VPS attiva 16-19/05 con 30h di state transitions tracciate (bug #14 fix attivo dal 17/05 17:11) e positions found su 4 giorni distinti.

### 📊 Numeri pipeline (✅ verificato)

**Status distribution** (`positions`, n=**251**):
| Stadio | Conteggio | % |
|---|---|---|
| **excluded** | **164** | **65.3%** ← molto alta |
| ready | 56 | 22.3% |
| scored | 29 | 11.6% |
| checked | 1 | 0.4% |
| writing | 1 | 0.4% |

> 📝 staging baseline diceva "19 ready" → verificato **56 ready** (3× più del documentato). Conversion ready/total = **22%** vs Codex 51%.

**Pipeline activity** (`position_state_transitions`, n=**548**):
| Agente | Transitions |
|---|---|
| scout-1 | 134 (dominante) |
| analista-1 | 132 |
| scorer-1 | 107 |
| scrittore-1 | 71 (top writer Kimi) |
| scrittore-2 | 37 |
| scrittore-3 | 36 |
| capitano | 31 (vs Codex 2 — molto più attivo) |

**Positions found per day**:
| Day | n |
|---|---|
| 16/05 | 27 (start) |
| **17/05** | **145 ← peak** |
| 18/05 | 69 |
| 19/05 | 10 (taper) |

**Scout split** (con scoring):
| Scout | Trovate | Scorate | Avg score | High 80+ |
|---|---|---|---|---|
| scout-1 | **187 (75%)** | 119 | **65.1** | 29 (24%) |
| scout-2 | 64 (25%) | 28 | **59.9** | **0** |

> 📝 **Pattern Kimi OPPOSTO a Codex**: scout-2 ha *peggior* qualità (0 high80 vs scout-1 29). Su Codex era il contrario (scout-2 quality > scout-1). Differenza dovuta a: profilo junior single-domain (filone curated meno discriminante) vs multilingual senior multi-country.

**Companies** (`companies`, n=**178**):
| Verdict | Conteggio | % |
|---|---|---|
| GO | 158 | 88.8% |
| CAUTIOUS | 20 | 11.2% |
| **NO_GO** | **0** | **stesso bug rubric di Codex** |

**Critic verdict** (su applications, n=107 con score):
| Verdict | n | Avg score |
|---|---|---|
| PASS | 55 | 5.92 |
| REJECT | 51 | 3.73 |
| NEEDS_WORK | 1 | 2.80 |
| (null) | 3 | (no score) |
| **Overall** | **107** | **5.05 / 10** |

> 📝 staging diceva "critic ~6.0" → verificato **5.05 overall** o **5.92 PASS-only**. Più basso del documentato.
> **Pass rate Kimi: 55/107 = 51.4%** vs Codex 88.2% → **Kimi qualità output significativamente peggiore**.

**Applications** (`applications`, n=**114**):
| Status | n |
|---|---|
| draft | 56 (49%) |
| ready | 52 (46%) |
| excluded | 5 |
| review | 1 |
| **auto_applied** | **0** ✅ by-design |

> 📝 staging diceva "19 ready visibili post-fix" → verificato **52 ready** (post-bug-fix lifecycle). Larger volume di draft (56) suggerisce molte CV scritte ma non promosse a ready (high reject rate da Critic).

### 📁 Deliverables on disk
| Tipo | Size |
|---|---|
| CV | 8.7M (vs Codex 6.0M — più voluminoso ma meno ready) |
| Critiche | 1.4M (vs Codex 2.5M) |
| Allegati | 60K (vs Codex 2 file/minimal) |
| Output | 4.0K (vs Codex 1.9M — quasi vuoto) |

### 💰 Economics (✅ Hetzner + Kimi wire.jsonl aggregati esattamente)

**Token consumption Kimi — VERIFICATO** da aggregazione di 427 file `wire.jsonl` (16,700 eventi `StatusUpdate.payload.token_usage`):

| Componente | Tokens | Note |
|---|---|---|
| input_other (new) | **33.86M** | Input non-cached, "fresh" prompts |
| input_cache_read | **1,574.14M** | Prompt caching aggressivo (38× più del nuovo) |
| input_cache_creation | 0 | (Kimi non addebita cache creation) |
| output | **6.86M** | |
| **TOTAL all-in** | **1,614.86M** | (~1.6B token processati totali) |
| **TOTAL "fresh" (no cache_r)** | **40.72M** | Token davvero consumati da LLM |

**Costo pay-per-use stimato** (Kimi K2 listino: input $0.15/M, output $2.50/M, cache_read $0.04/M):
- input: $5.08
- output: $17.15
- cache_read: $62.97
- **TOTAL: ~$85 / €78** (per 75h di run)

**Subscription Kimi K2 Pro pagata**: **€40/mo** (1 mese) — quindi sub ha "risparmiato" ~**€38 in soli 4 giorni**. Estrapolando uso continuo a 30 giorni: pay-per-use ~€585 vs sub €40 = **14× più caro**. **Conferma mass-market jackpot tier**.

**Bridge metrics** (sentinel-data.jsonl, 1304 tick):
- Peak usage 5h-window: **100%** (cap hit)
- Peak weekly usage: **100%**
- Avg velocity: **5.37%/h** (vs Codex 2.7%/h → Kimi brucia 2× più veloce in % budget)
- Capitano tokens/turn pre-fix: 83.7k (bloated), Scout sweep: 116k/turn

**Costo VPS (Hetzner CPX22)**:
- Run Kimi 75h: **€1.17**
- Idle post-run (~90h fino a oggi): **€1.40**
- **Totale VPS Kimi**: **~€2.57**

**Costo totale entrambi i run + idle attuale**: ~€4 VPS + €140/mese subscription (Codex €100 + Kimi €40 — 1 mese ciascuno)

> 📝 **Scoperta importante**: `token-meter.csv` è **non-durable cross container restart**. Il file su Kimi VPS è stato resettato (35 righe attuali da 16:02 oggi vs 10752 righe Codex VPS che non ha mai riavviato). **Fonte autoritativa Kimi sono i `wire.jsonl` in `/root/.jht/.kimi/sessions/`** (175MB durable). Da considerare fix: persistenza token-meter.csv tramite append-mode o rotazione invece di overwrite.

### ✅ Cosa ha funzionato
1. **Volume scouting maggiore di Codex** — 251 positions trovate (vs 206) in finestra simile, **63 positions/giorno medio peak**.
2. **Capitano coordinator attivo** — 31 state transitions (vs 2 Codex), maggiore micromanagement pipeline.
3. **Bug-fix loop produttivo** — 19 commit / 13 bug fixati in 24h, EMERGENZA −96%, URG −71%, FREEZE −82% (da staging).
4. **Pipeline state tracking attivato** — 548 transitions loggate post-fix-#14.
5. **Provider sostenibilità** — token-based, no weekly cap → 4 giorni continui senza saturation.

### ⚠️ Cosa NON ha funzionato (verificato + correzioni)
1. **Conversion rate basso** — 22% ready/trovate vs Codex 51% (corrisponde a un filone Python junior molto competitivo o profilo che match meno).
2. **Critic pass rate basso** — 51.4% vs Codex 88.2% — Kimi produce CV qualitativamente più deboli.
3. **Scout-2 ineffective** — 0 high80 trovate, score medio 59.9 (vs scout-1 65.1) — scout-2 ha fallito il filone curated per profilo Python junior.
4. **Companies rubric inadeguato — stesso bug Codex** — **0 NO_GO su 178** (158 GO + 20 CAUTIOUS).
5. **Zombie night** — 6h Capitano + 20 Dottori vuoti tra 23:14→09:05 UTC 18/05 (~18% weekly capacity persa).
6. **Capitano context bloat** — 83.7k tokens/turn vs 50k storico (debt residuo dopo 4 reti sicurezza).
7. **No applied auto-submit** — by-design ma 56 draft non promossi (vs 17 Codex) suggerisce backlog Critic alto.

### 🔍 Lesson learned / confidence (post-DB verification)
- **Profilo candidato è il primo confounder**: Codex = Beta tester 1 (senior multilingual, niche match) vs Kimi = Beta tester 2 (junior dev, oceano competition). **NON è confronto provider isolato**.
- **Per confronto fair**: serve same-candidate × due-provider in run paralleli.
- **Critic score 5.05 Kimi vs 6.35 Codex** può essere: (a) Kimi LLM più debole, (b) profilo junior meno fittable, (c) bug-fix maturation period nel mezzo. Non isolabile.
- **Conversion rate 22% vs 51%** stessa ambiguità.
- **Volume scout 251 vs 206**: Kimi più volumetrico, Codex più curato — ma Codex run più corto (35h vs 75h calendari, 30h vs 35h state-tracked).

### ❓ Dati ancora mancanti
- ❓ Costo subscription Kimi mensile reale
- ❓ Token weighted totale Kimi (token-meter.csv da parsare)
- ❓ Salary/geo distribution dettagliata Kimi
- ❓ Engine PDF used (wkhtmltopdf vs fpdf2 ratio post-fix #26)
- ❓ Run end ufficiale: 19/05 01:27 = halt manuale o naturale?

---

## 🔁 Cross-run observations (✅ verificato post-DB raw)

| Aspetto | VPS1 (Codex) | Kimi K2 | Implicazione |
|---|---|---|---|
| **Candidato** | Beta tester 1 (senior multilingual tech doc/translation, secondary tech-manufacturing) | Beta tester 2 (junior software dev, no degree, capital city) | **Profili diversi** — NON confronto provider isolato |
| **Periodo** | 19→21 mag (34.84h) | 16→19 mag (~75h calendari, 30.22h state) | Kimi run più lungo |
| **Positions trovate** | 206 | **251** | Kimi +22% volume |
| **Ready (CV+critic PASS)** | **105 (51%)** | 56 (22%) | Codex 2.3× più alto conversion |
| **Critic score medio** | **6.35** (PASS 6.53) | 5.05 (PASS 5.92) | Codex +1.3 punti |
| **Critic pass rate** | **88.2%** | 51.4% | Codex 1.7× più alto |
| **Auto-applied** | 0 | 0 | Both by-design |
| **Companies 0 NO_GO** | 120 GO / 59 CAUTIOUS | 158 GO / 20 CAUTIOUS | **Same rubric bug** |
| **Scout pattern** | scout-2 quality > scout-1 | scout-2 quality << scout-1 | Profile-dependent |
| **Capitano transitions** | 2 (light touch) | 31 (heavy coordinator) | Behavior diverso per provider |
| **Sustainability** | Weekly cap 96% in 2.3d | Token-based, 4d sostenuti | **Kimi vince per long-run** |
| **Token "fresh" (new+output)** | ~267.6M (in_raw 267M + out 575K) | **40.7M** (input 33.9M + out 6.86M) | Codex 6.6× più "fresh thinking" tokens |
| **Token cache_read** | 258M | **1,574M** | Kimi 6× più cache utilization |
| **Token totale all-in** | ~525M (raw breakdown) | **1,615M** | Kimi 3× context volume |
| **Codex weighted (proprietary)** | **396.9M** | n/a (formula diversa) | Codex telemetria ufficiale |
| **Velocity %/h** | 2.7%/h | **5.37%/h** | Kimi burn 2× più veloce |
| **Costo VPS run-only** | €0.54 (34.84h) | €1.17 (75h) | Costo VM trascurabile |
| **Costo VPS run+idle (ad oggi)** | €1.43 | €2.57 | Totale ~€4 + sub mensili |
| **Costo subscription** | **Codex ProLite ~€100/mo** | **Kimi K2 Pro ~€40/mo** | Kimi 2.5× più economico |
| **Costo per CV ready (sub mensile / ready in 1 run)** | €100 / 105 = **€0.95/CV** | €40 / 56 = **€0.71/CV** | Entrambi <€1/CV |

**Insight chiave**: il confronto Codex vs Kimi è confondato dal fatto che i due run hanno profili candidato diversi. La conclusione "Kimi qualità inferiore" potrebbe essere "profilo Python junior più competitivo → critic più severo".

**Readiness per `docs/about/RESULTS.md`**:
- ✅ Case Study #2 (Codex/Beta tester 1): **~95% ready**
- ✅ Case Study #3 (Kimi/Beta tester 2): **~95% ready** (token reali aggregati 2026-05-23)

---

## 🎯 Phase 2 done — Phase 3 next: promozione a RESULTS.md

**Phase 2 (data extraction)**: ✅ done 2026-05-23
- ✅ Token Hetzner ottenuto + SSH key Kimi trovata (`~/Library/Application Support/jht-desktop/ssh/`)
- ✅ Codex VPS1 tar extracted in `~/jht-case-study-data/codex-vps1/`
- ✅ Kimi VPS tar extracted in `~/jht-case-study-data/kimi-vps/`
- ✅ DB analytical queries eseguite su entrambi
- ✅ Staging doc aggiornato con numeri verificati

**Phase 3 — TODO**:
1. ✅ Anonimizzare profili candidati con nomenclatura standard "Beta tester 1/2" + profili generalizzati (no iniziali, no titoli specifici, no geo precise) — done 2026-05-23
2. ✅ Recuperare costo subscription — done 2026-05-23 (dichiarazione maintainer):
   - ✅ Codex ProLite ~€100/mo (1 mese pagato)
   - ✅ Kimi K2 Pro ~€40/mo (1 mese pagato, conferma mass-market tier)
   - ✅ Costo VPS Hetzner CPX22 €0.0156/h, €9.75/mo (via `hcloud server-type describe`)
3. ✅ Token Kimi totale recuperati esattamente:
   - ✅ Codex 396.9M weighted (token-meter.csv parsato)
   - ✅ Kimi 40.7M "fresh" + 1574M cache_read + 6.86M output = **1.61B all-in** (aggregato da 16,700 eventi `StatusUpdate` in 427 wire.jsonl). Cost pay-per-use stimato €78 vs sub €40 = sub 14× più economica.
4. ⬜ Scrivere Case Study #2 + #3 in `docs/about/RESULTS.md` formato pubblico (single source of truth)
5. ⬜ Aggiornare matrix `docs/guides/BETA.md` da 1/10 a 3/10 done
6. ⬜ Decidere se shutdown VPS Hetzner (~€20/mo) — finita estrazione, non ci serve più
7. ⬜ Eventuale pagina web `/results` su `jobhunterteam.ai` (Phase 4 separata)

**Dati raw conservati in**: `~/jht-case-study-data/{codex-vps1,kimi-vps}/` (~22MB totali, fuori dal repo per privacy)

---

## 📦 Output Phase 1 (questo doc)

✅ Tutti i dati documentati raccolti in unico posto
✅ Gap espliciti marcati con ❓
✅ Caveat e contraddizioni segnalati
✅ Action plan VPS data extraction pronto

**Prossimo step** (Phase 2): token Hetzner + login VPS + estrazione dati raw → arricchimento di questo doc → promozione finale a `docs/about/RESULTS.md` Case Study #2 e #3 + update matrix `docs/guides/BETA.md` da 1/10 a 3/10.
