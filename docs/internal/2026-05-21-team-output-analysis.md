# Team Output Analysis — JHT VPS1, primo run 35h

Snapshot: **2026-05-21 07:55 UTC** subito dopo HALT-WEEKLY (vedi `2026-05-21-halt-weekly-incident.md`).
DB: `/jht_home/jobs.db` (bind mount, persistente).

**Periodo attività team**: dal **2026-05-19 20:29 UTC** al **2026-05-21 07:20 UTC** ≈ **34 h 51 min**.

Tutte le query sotto sono state eseguite da Claude (host) direttamente su DB, senza interrogare gli agenti Codex — costo weekly = 0.

---

## 0. Ricap numerico in una riga

**Pipeline 35h**: 206 position trovate → 143 ammesse alla pipeline → 116 CV scritti → 122 PDF generati → **105 ready** → **0 effettivamente candidati dall'utente** (status `applied=1`).

---

## 1. POSITIONS — 206 trovate

| Status | N | % |
|---|---|---|
| ready | **105** | 51.0 % |
| excluded | 63 | 30.6 % |
| scored | 31 | 15.0 % |
| checked | 5 | 2.4 % |
| writing | 2 | 1.0 % |
| applied | **0** | 0 % |

| Scout | N trovate |
|---|---|
| scout-1 | 130 |
| scout-2 | 76 |

| Remote | N |
|---|---|
| onsite | 98 |
| full_remote | 63 |
| hybrid | 45 |

| Source (top) | N |
|---|---|
| linkedin | 128 |
| ashby | 24 |
| profession | 10 |
| greenhouse | 7 |
| company-careers | 6 |
| lever | 5 |
| altri 6 source | ≤ 3 ciascuno |

---

## 2. EXCLUSION REASONS — perché 63 position sono state scartate

Esclusioni per attore:

| last_actor | N excluded | % del totale 63 |
|---|---|---|
| scorer-1 | 23 | 36.5 % |
| scrittore-2 | 11 | 17.5 % |
| capitano | 10 | 15.9 % |
| analista-1 | 10 | 15.9 % |
| scrittore-1 | 5 | 7.9 % |
| scrittore-3 | 4 | 6.3 % |

**Filtro tardivo significativo**: 20/63 esclusioni (32 %) avvengono **dopo** che il CV è stato avviato (transition `writing → excluded`). Lo Scrittore si accorge in scrittura che il JD richiede laurea o esperienza che il candidato non ha. Filtro corretto ma costoso (lo Scrittore brucia compute prima di abbandonare).

Pattern di nota nei `notes` di esclusione:
- `ESPERIENZA_RICHIESTA + ESPERIENZA_TIPO + LAUREA` (filtro hard requirements) — applicato dagli Scrittori in fase di scrittura.
- `EXCLUDED: [COMPENSATION]` (no salario dichiarato, hourly contract) — Analista.
- `EXCLUDED: [GEO]` (hybrid/onsite fuori dall'Italia ammessa) — Analista.
- 7 (title, company) duplicate (Nozomi 3×, Binalyze, Keywords, MongoDB, Nebius, Rithum, Enfuce, 2× ciascuno) — Scout dedup difettoso quando la position appare da source multipli.

---

## 3. GEOGRAFIA — distribuzione location

| zona (classificata euristica) | N |
|---|---|
| Italy | 71 |
| Hungary | 24 |
| Remote/EU | 20 |
| UK/London | 14 |
| Germany | 13 |
| Netherlands | 11 |
| Spain | 11 |
| Other / unclassified | 42 |

Top città italiane: Brugnera (FVG) 3, Milan 2, Parma 2, Sesto Calende 2, Giussano 2, San Daniele del Friuli 2, Rome 3.
Top città Hungary: Prague 3, Székesfehérvár 4 (2+2 grafie diverse), Dunaharaszti 2.

→ **Italia + Hungary** sono le due aree dove il candidato è competitivo. Hungary è il bonus linguistico (vedi sezione 5).

---

## 4. SCORES — 180 position scorate (di 206)

- **Score medio totale**: **65.1 / 100** · min 33, max 94.
- **Solo scorer-1** ha lavorato (180/180 scoring).

Distribuzione score:
```
0-19    0
20-39  12   ████████████
40-49  24   ████████████████████████
50-59  24   ████████████████████████
60-69  38   ██████████████████████████████████████
70-79  51   ███████████████████████████████████████████████████  ← picco
80-100 31   ███████████████████████████████
```

Medie per dimensione (con peso max teorico):

| dimensione | avg | min | max | peso max |
|---|---|---|---|---|
| stack_match | 26.8 | 10 | 38 | 40 |
| remote_fit | 17.8 | 0 | 25 | 25 |
| salary_fit | 12.6 | 6 | 20 | 20 |
| experience_fit | 7.3 | 2 | 10 | 10 |
| strategic_fit | 9.7 | 3 | 15 | 15 |

→ La dimensione che varia di più è `remote_fit` (range 0-25, alcune position 0 = onsite all'estero). `stack_match` tiene un buon livello medio (67 % del massimo).

### Scout: chi trova posizioni di qualità migliore

| Scout | N position | score medio | score median | % score ≥ 70 |
|---|---|---|---|---|
| scout-1 | 112 | 63.1 | 64 | 40.2 % |
| **scout-2** | 68 | **68.4** | **72** | **54.4 %** |

→ **Scout-2 trova meno ma meglio** (+5 punti score medio, +14 pp position high-score). Scout-1 fa quantità, Scout-2 fa qualità. Da considerare per il rebalance quando ripartirà il team.

### Score per categoria ruolo

| categoria ruolo | N | score avg | top |
|---|---|---|---|
| Falegname/Carpenter/Wood | 6 | **84.2** | 90 |
| Translator/Linguist | 6 | 74.8 | 94 |
| Designer/Progettista (non legno) | 8 | 74.8 | 88 |
| Editor/Content | 8 | 68.1 | 82 |
| Technical Writer/Documentation | 71 | 65.3 | 91 |
| Project Manager / Coordinator | 1 | 62.0 | 62 |
| Other | 80 | 61.5 | 86 |

→ I **6 ruoli legno** hanno score medio 84.2 (record). I **6 translator** medio 74.8 ma con il top assoluto (94, position #66 Technical translator with Hungarian @ LocalEyes). I 71 Technical Writer (categoria volumetrica) hanno score medio 65.3 — sotto la media.

---

## 5. CRITICO — 119 review eseguite

- **Voto medio**: **6.30 / 10** · min 4.0, max 8.4.
- **Pass rate**: 105/119 = **88.2 %**.

Distribuzione critic_score:
```
< 5.0     11
5.0-5.9   35
6.0-6.9   26
7.0-7.9   35
8.0-10    12
```

### 14 REJECT — quali sono

| pos | title | company | score | critic |
|---|---|---|---|---|
| #84 | Developer Relations - Go to Market | Chromatic | 4.0 | REJECT |
| #85 | Senior Developer Content Lead | Sanity | 4.0 | REJECT |
| #108 | QA Analyst | Nebuly | 4.0 | REJECT |
| #78 | Technical Content Engineer | SuperPlane | 4.0 | REJECT |
| #156 | Product Support Engineer - EMEA | Ashby | 4.0 | REJECT |
| #104 | Compliance Engineer - EU | ElevenLabs | 4.0 | REJECT |
| #95 | Developer Advocate | Kestra | 4.1 | REJECT |
| #14 | CNC Milling Specialist | Project 10 | 4.4 | REJECT |
| #90 | Documentation Engineer II - Europe | Storyblok | 4.5 | REJECT |
| #200 | Technical Writer | Deepnote | 4.7 | REJECT |
| #103 | Technical Writer (Contract Role) | Enfuce | 4.8 | REJECT |
| #189 | Artwork coordinator | Propelis | 5.5 | REJECT |
| #131 | Documentation Engineer | Chainlink Labs | 5.9 | REJECT |
| #133 | Technical Writer | ORBCOMM | 6.2 | REJECT |

Pattern dei reject: **Developer Relations / DevAdvocate / Compliance / QA / Engineering ruoli** dove il candidato manca dell'esperienza tecnica deep richiesta. Anche 4 Technical Writer reject — il critico le ha bocciate per allineamento JD insufficiente.

### Correlazione position_score ↔ critic_score

- N pairs: 119
- Avg position_score: 71.9 (dei CV scritti)
- Avg critic_score: 6.30
- **Pearson r = 0.211** → correlazione **debole positiva**

| fascia position | N | critic avg |
|---|---|---|
| 50-59 | 12 | 6.08 |
| 60-69 | 33 | 6.12 |
| 70-79 | 47 | 6.32 |
| 80-100 | 27 | **6.60** |

→ Position score più alto = CV leggermente migliore, ma non in modo determinante. Lo Scrittore riesce a fare CV decenti anche su position di score medio (50-59 → critic 6.08).

### Scrittore: chi scrive CV migliori (limitato dal tracking)

Solo 8 CV hanno `written_by` valorizzato (gli altri 114 sono pre-tracking):

| Scrittore | N CV | critic avg | critic median |
|---|---|---|---|
| **scrittore-2** | 3 | **7.10** | 7.5 |
| scrittore-3 | 5 | 5.90 | 5.5 |
| scrittore-1 | 0 | — | — |

Campione minuscolo, ma sui 8 dati Scrittore-2 batte Scrittore-3 di 1.2 punti voto critico. Da rivedere quando il tracking sarà sistematico.

---

## 6. TIME-TO-WRITE — quanto ci mette il team

- **found_at → written_at** (Scout → CV pronto): **avg 481 min (8h 1min)** · median 501 min · p10 18 min · p90 901 min (15h) · min 6.9 min · max 1144 min (19h).
- **written_at → critic_reviewed_at**: avg 5.8 min · median 2.9 min · p90 15.5 min (il loop critico è veloce).

→ Il tempo dominante (~8h medio) sta tra "Scout trova" e "Scrittore inizia/finisce CV". Plausibile dato il loop pipeline + throttle Sentinella. La median 501 min (~8h 20min) suggerisce che il throughput sostenibile è ~3 CV/giorno per Scrittore singolo.

---

## 7. COMPANIES — 179 analizzate

| Verdict | N | % |
|---|---|---|
| GO | 120 | 67 % |
| CAUTIOUS | 59 | 33 % |
| (no NO_GO assegnati) | | |

Top company per numero offerte aperte trovate dal team:

| company | N pos | verdict |
|---|---|---|
| Adecco | 4 | CAUTIOUS |
| Nebius | 4 | GO |
| Nozomi Networks | 3 | GO |
| Openjobmetis SpA | 3 | CAUTIOUS |
| Amazon, Bentley Systems, Binalyze, CAE, Enfuce, Enovis, Kestra, Keywords, MongoDB, Crossing Hurdles, Gi Group | 2 ciascuna | mix |

**Glassdoor rating**: 0/179 popolato → bug noto. L'Analista non scrive il campo nonostante lo schema lo preveda.

---

## 8. SALARY — distribuzione

- **JD con salario dichiarato**: 29/206 (14 %). Avg min €42.3 k - max €56.6 k.
- **Salario stimato dallo Scorer**: 67/206 (32 %).

Distribuzione `salary_estimated_min`:

| fascia €/anno | N |
|---|---|
| 30 k - 39 k | 18 |
| 40 k - 49 k | 21 |
| 50 k - 59 k | 10 |
| 60 k - 69 k | 10 |
| 70 k - 89 k | 7 |
| 90 k+ | 1 |

→ Mediana ~45 k €/anno, code lunghe verso il basso (HR/staffing entry-level) e brevi verso l'alto.

---

## 9. HIGHLIGHTS — 497 sticky points

| type | N |
|---|---|
| con | 249 |
| pro | 248 |

Bilanciamento quasi perfetto pro/con (50/50). Lo Scorer/Scrittore non sta privilegiando un lato — buon segno di obiettività, da rivedere se invece dovrebbe avere bias positivo nei CV destinati al candidato (in stile self-presentation).

---

## 10. STATE TRANSITIONS — 881 transitions

| from | to | N |
|---|---|---|
| (null) | new | 206 |
| new | checked | 196 |
| checked | scored | 168 |
| scored | writing | 138 |
| writing | ready | 104 |
| writing | excluded | **27** |
| checked | excluded | 23 |
| new | excluded | 10 |
| writing | scored | 5 |
| scored | excluded | 3 |
| scored | ready | 1 |

→ **27 transitions `writing → excluded`** = filtro tardivo significativo. Vedi sezione 2.
→ 5 transitions `writing → scored` = lo Scrittore restituisce indietro la position allo Scorer (probabile loop di chiarimento).
→ 1 transition `scored → ready` saltando `writing` = bug o by-design? Da indagare.

---

## 11. TIMING — quando ha lavorato il team

Picco position trovate per ora UTC:

```
14:00  22  ███████████  ← picco
13:00  21  ██████████
11:00  21  ██████████
06:00  19  █████████
09:00  18  █████████
20:00  15  ███████
21:00  13  ██████
02:00  11  █████  ← Scout-1 attivo di notte
07:00  10  █████
```

Picco CV scritti per ora UTC:

```
23:00  14  ███████  ← picco notturno
00:00  14  ███████
22:00  12  ██████
03:00  11  █████
21:00   9  ████
```

→ Gli **Scout** lavorano principalmente di giorno (UTC 06-15, cioè 08-17 ora italiana).
→ Gli **Scrittori** lavorano di notte (UTC 21-03, cioè 23-05 ora italiana). Plausibile perché il throttle Sentinella in ore notturne è meno restrittivo (meno consumo concorrente del team Italia awake).

---

## 12. APPLICATIONS — l'utente non ha mai cliccato

- `applied=1`: 0
- `applied_at NOT NULL`: 0
- `applied_via NOT NULL`: 0
- `response NOT NULL`: 0

→ **0 candidature effettivamente inviate**. Il team ha 105 CV "ready" sul disco ma nessuno è arrivato sul recruiter. Questo è coerente col fatto che il candidato (Leone) è in modalità beta-test: vede l'output, non clicca.

---

## 13. ANOMALIE rilevate

1. **`written_by` / `reviewed_by` null per il 95 % delle entry**: tracking dello scrittore/critico non propagato in DB prima del 20/05. Bug noto — fixare al prossimo team boot (campo dovrebbe essere obbligatorio nella INSERT/UPDATE di `applications`).
2. **`glassdoor_rating`: 0/179 popolato**. L'Analista ignora il campo. Bug.
3. **7 (title, company) duplicate**: Scout dedup difettoso quando la stessa position appare su source diversi (LinkedIn + Ashby diretto). Aggiungere check `(title, company)` o normalizzazione URL prima dell'INSERT in Scout.
4. **2 position in `writing`** ancora bloccate al momento del HALT (kill Scrittore-3 stamattina). Saranno state lasciate a metà — controllare al resume per cleanup.
5. **`scored → ready` direct (1 caso)**: bypass di `writing` non previsto dal flow. Verificare se è data corruption o flusso alternativo legittimo.
6. **Solo `scorer-1` ha scorato**: 180/180 scoring. Mancato sharding o scaling. Per future istanze ad alto throughput considerare un secondo Scorer (`MAX_INSTANCES=2` come per Scout/Analista).
7. **0 NO_GO companies**: l'Analista assegna solo GO/CAUTIOUS. Manca discriminator forte → tutte le company passano oltre. Da rivedere la rubric.
8. **27 `writing → excluded`**: filtro hard requirements (laurea/esperienza/geo) arriva troppo tardi. Spostarlo allo Scorer (pre-CV) salverebbe il compute degli Scrittori.

---

## 14. INSIGHT operativi per il prossimo run

1. **Scout-2 è 1.4× più qualitativo di Scout-1**. Bilanciamento: assegnare Scout-1 a source ad alto volume noisy (LinkedIn), Scout-2 a source curated (Ashby, company-careers, Greenhouse).
2. **Il candidato è competitivo sul falegname/legno** (score avg 84.2 su 6 posizioni). Quel filone va espanso negli Scout sources, non ristretto come fatto il 20/05 ("basta legno → traduzione/linguistica").
3. **Translator/Linguist** è il filone più strategico (top score 94, segnale che il match Italian+Hungarian è raro). Espandere.
4. **Technical Writer** è il filone volumetrico ma score sotto media (65.3). Da filtrare meglio in Scout (cercare niche-TW invece che "TW generico").
5. **Filtro hard requirements tardivo**: muoverlo dallo Scrittore allo Scorer risparmierebbe ~13 % del compute Scrittore (27/206 transitions).
6. **0 applied**: il loop si chiude solo se l'utente clicca. Dashboard / Telegram nudge per portare l'utente sui 105 ready non c'è oggi — da pensare per la prossima iterazione.
7. **Time-to-write median 8h 20m** è il rate sostenuto. Per 3-5 CV/giorno per Scrittore × 3 Scrittori = ~10-15 CV/giorno massimo realistico. Quindi per produrre 100 CV ready servono 7-10 giorni full-team.

---

## 15. Riferimenti

- `BACKLOG.md` — entry `[PACING-WEEKLY-EXHAUSTION]` (la saturazione weekly osservata è coerente col throughput stimato qui).
- `docs/internal/2026-05-21-halt-weekly-incident.md` — operazione di stop team da cui derivano questi dati finali.
- `docs/internal/2026-05-20-team-idle-gaps-investigation.md` — gap pre-HALT.
- `docs/internal/2026-05-20-agent-context-saturation.md` — PoC restart.

Lo script di estrazione (Python) è transitorio in `/tmp/team-stats-deep.py` sul container VPS1, non in repo.
