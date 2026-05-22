# 2026-05-21 — VPS1 first run (35h) postmortem

> Consolida 3 inchieste sullo stesso run VPS1 (2026-05-19 20:29 → 2026-05-21 07:20 UTC, ≈ 35h):
> output stats, idle gaps investigation, Kimi vs Codex comparison.
> Per Halt-Weekly incident operativo vedi `2026-05-21-halt-weekly-incident.md`.
> Per la spec watchdog reboot agenti vedi `context-watchdog-spec.md`.

## 🧭 TL;DR

**Pipeline 35h**: 206 position trovate → 143 pipeline → 116 CV scritti → **105 ready** → **0 applied** (by design, user-curated).

3 conclusioni che reggono:
1. **Codex ~10× throughput vs Kimi** ma weekly cap brucia in 2-3 giorni invece di 7 → `[PACING-WEEKLY-EXHAUSTION]` P0.
2. **Qualità CV guidata dal protocollo, non dal provider**: critic medio ~6.0 (Kimi) → 6.30 (Codex), Δ non statisticamente significativo.
3. **Cooperative idle è la causa primaria dei gap >20min**, NON throttle né esaurimento fonti. Manca watchdog di liveness pipeline.

## 📊 Output metrics

### Positions (206 totali)

| Status | N | % |
|---|---|---|
| ready | 105 | 51.0 % |
| excluded | 63 | 30.6 % |
| scored | 31 | 15.0 % |
| checked | 5 | 2.4 % |
| writing | 2 | 1.0 % |
| **applied** | **0** | **0 %** |

| Scout | N trovate | score avg | % score ≥ 70 |
|---|---|---|---|
| scout-1 | 130 | 63.1 | 40.2 % |
| **scout-2** | 76 | **68.4** | **54.4 %** |

→ **Scout-2 trova meno ma meglio** (+5 punti, +14pp high-score). Per il prossimo run: scout-1 → source noisy ad alto volume (LinkedIn), scout-2 → curated (Company 015/Greenhouse/company-careers).

### Source distribution

LinkedIn 128 · Company 015 24 · Profession 10 · Greenhouse 7 · Company-careers 6 · Lever 5 · altri 6 source ≤3.

### Score per categoria ruolo

| Categoria | N | score avg | top |
|---|---|---|---|
| **Falegname/Carpenter/Wood** | 6 | **84.2** | 90 |
| Translator/Linguist | 6 | 74.8 | 94 |
| Designer/Progettista | 8 | 74.8 | 88 |
| Editor/Content | 8 | 68.1 | 82 |
| Technical Writer | 71 | 65.3 | 91 |
| Other | 80 | 61.5 | 86 |

→ Falegname e Translator sono i filoni strategici. Technical Writer è volumetrico ma score sotto media — filtrare meglio in Scout (niche-TW invece di generico).

### Critico (119 review)

Voto medio **6.30/10**, pass rate **88.2%** (105/119). 14 reject su Developer Relations / DevAdvocate / Compliance / QA — il candidato manca della deep tech expertise. Pearson `r=0.211` tra position_score e critic_score → correlazione debole.

### Time-to-write

- found_at → written_at: **avg 8h 1min**, median 8h 20min, p10 18min, p90 15h.
- written_at → critic_reviewed_at: avg 5.8min, median 2.9min.

→ Throughput sostenuto ~3 CV/giorno per Scrittore. 3 Scrittori = ~10-15 CV/giorno teorici. Per 100 CV ready servono 7-10 giorni full-team.

### Salary / Geo / Companies

- Salario dichiarato: 29/206 (14%). Avg min €42.3k – max €56.6k. Mediana stimata ~45k €/anno.
- Geo: Italy 71, Hungary 24, Company/EU 20, UK 14, DE 13, NL 11, ES 11.
- Companies: 120 GO + 59 CAUTIOUS, 0 NO_GO (rubric Analista da rivedere).

## 🕳️ Idle gaps investigation (DA ELABORARE)

**Misurazione**: query su `~/.codex/logs_2.sqlite` per gap >5min tra `session_task.turn` consecutivi nel range 20:55 → 10:00 UTC.

**Risultato**: 31 gap >5min, totale **~8h15min di stasi su 13h di operatività** osservata.

Cambio di regime visibile dal gap #18 (02:05 UTC, durata 44m): da quel momento gap "grandi" (44m, 28m, 60m, 40m, 49m, 29m). Prima erano tutti <13min.

### Ipotesi formulate e loro stato

| Ipotesi | Stato | Note |
|---|---|---|
| A — Scout-1 ha esaurito le fonti | ❌ Scartata | Scout-2 alle 05:14 ha inserito 5 nuove posizioni dalle stesse aree |
| B — Deadlock di workflow | ❌ Termine sbagliato | Nessun wait esplicito nei log |
| C — Throttle 240s × N round | ❌ Scartata | 240s dà 1 round/240s, non zero round in 60min |
| **D — Cooperative idle** | ✅ **Confermata** | Team in attesa passiva, `team_kt=0`, exit solo via Bridge TICK |
| **E — NO CV mode attivo** (scoperta a posteriori) | ✅ **Causa primaria post-07:42** | User ordina "no CV, solo ricerca" → Scrittori `gate Phase2` idle by design |

### Da elaborare a freddo

- Separare gap "fisiologici" (NO CV by design post-07:42) da gap "patologici" (cooperative idle pre-07:42).
- Perché il Capitano non auto-rilancia Scout-1 dopo l'ack dell'ultima position? Bug del prompt o design intenzionale?
- Bridge TICK skip pattern alle 04:45/05:00 (`insufficient_samples`/`non_positive_delta`) → loop saturante?
- Aggiungere **watchdog di liveness pipeline**: se nessun `team_kt > 0` per N minuti, kickoff forzato Capitano.

### Tracing da abilitare al prossimo run

1. `tmux pipe-pane -o` su tutte le session → ricostruire scrollback storico.
2. Mappatura `session_id codex → nome agente` deterministica.
3. Snapshot append-only del `throttle-<agent>.json` ogni minuto.
4. Append-only del `pacing-bridge-state.json` per ricostruire storia.

## 🆚 Kimi vs Codex — confronto run

⚠️ **Avvertenza**: i due test sono su **due profili candidato diversi**. Confronti su filoni di ricerca o trend evolutivi sono **non validi**. Vedi memory `project_beta_test_users`.

| Metrica | Run Kimi (≈17/05) | Run Codex VPS1 (35h) |
|---|---|---|
| Provider | Kimi K2 | Codex ProLite gpt-5.5 high |
| Position trovate | ~22-28 | **206** |
| `status=ready` | 19 | **105** |
| `applied=1` | 0 | 0 |
| Critic score medio | ~6.0 | 6.30 |
| Capitano context cumulato | 83.7k token ("bloated") | 168M token (24×) |

### Conclusioni che reggono

1. **Velocità ~10× con Codex**, ma cause **non isolabili**: maturazione team (fix bug #14/21/25, skill, tracking) + Codex più veloce sul singolo turn. Non si può attribuire il 10× a un singolo fattore.
2. **Qualità output stabile** (Δ critic +0.3 non significativo). Il loop Critico 3-round è il meccanismo di qualità, non il provider. **Cambiare provider non migliora la qualità.**
3. **Sostenibilità weekly diversa**: Kimi token-based reggeva per giorni; Codex weekly cap (10080 min/168h) brucia in 2-3 giorni al burn rate 2.7%/h. → **vero collo di bottiglia** del run, origine di `[PACING-WEEKLY-EXHAUSTION]`.
4. **`applied=0` NON è un gap di sistema** — è by-design (user-curated). Estendere a "funnel rotto" è inferenza scorretta.

### Modello mentale del weekly Codex

Estratto da questo run (non disponibile con Kimi token-based):

> **1% primary ≈ 3 min ≈ 0.03% weekly · 1 primary saturata = 3% weekly**

Implicazione per Sentinella: dial sul weekly secondary, non solo sul primary 5h.

## 🐛 Anomalie rilevate (14)

1. **`written_by`/`reviewed_by` null al 95%** — tracking non propagato pre-20/05. Bug: campi obbligatori nelle INSERT/UPDATE applications.
2. **`glassdoor_rating`: 0/179 popolato** — Analista ignora il campo.
3. **7 (title, company) duplicate** — Scout dedup difettoso quando position appare da source multipli (LinkedIn + Company 015 diretto). Aggiungere check normalizzazione URL pre-INSERT.
4. **2 position in `writing`** ancora bloccate al HALT — controllare cleanup al resume.
5. **`scored → ready` direct (1 caso)** — bypass writing non previsto. Data corruption o flusso alt?
6. **Solo `scorer-1` ha scorato** (180/180) — Scorer non sharded. Per high-throughput: `MAX_INSTANCES=2`.
7. **0 NO_GO companies** — Analista assegna solo GO/CAUTIOUS. Rubric da rivedere.
8. **27 `writing → excluded`** — filtro hard requirements (laurea/esperienza/geo) arriva troppo tardi. **Spostare allo Scorer (pre-CV)** salva ~13% compute Scrittore.

## 🎯 Insight operativi per il prossimo run

1. **Scout split**: scout-1 → noisy volume (LinkedIn), scout-2 → curated (Company 015/Greenhouse).
2. **Espandere filone Falegname/Wood** (score 84.2 record). Non ristretto come fatto in mid-run.
3. **Espandere Translator/Linguist** (top 94, match IT+HU raro).
4. **Filtrare meglio Technical Writer in Scout** (niche-TW vs generico).
5. **Filtro hard-requirements tardivo** → muovere allo Scorer.
6. **Time-to-write median ~8h 20m** → pianificare 7-10 giorni per 100 CV ready.
7. **0 applied non richiede fix sistemico** — eventuali nudge UI/Telegram sono UX, non bug.

## 🔗 Riferimenti

- `BACKLOG.md` — `[PACING-WEEKLY-EXHAUSTION]` P0 (la saturazione weekly è coerente con il throughput stimato qui).
- `docs/internal/2026-05-21-halt-weekly-incident.md` — operazione di stop team da cui derivano questi dati finali.
- `docs/internal/context-watchdog-spec.md` — spec del watchdog per evitare context bloat (Capitano 168M token).
- `docs/internal/_archive/2026-05-17-team-strategy-bugs.md` — strategy session run Kimi (archiviato).
- `docs/internal/2026-05-03-rate-kimi-weights.md` — calibrazione rate budget Kimi.

## 📂 Superseded

Questo doc consolida e sostituisce:
- `2026-05-20-team-idle-gaps-investigation.md` (full gap timeline + ipotesi A-E)
- `2026-05-21-team-output-analysis.md` (full DB stats: highlights 497, transitions 881, timing per ora, ecc.)
- `2026-05-21-kimi-vs-codex-run-comparison.md` (full diff table run)

Dettaglio completo (gap-by-gap table, distribuzioni full, query SQL transitorie) recuperabile dalla git history dei 3 file prima del commit di consolidamento.
