# 💸 Weekly pace debito-aware (anti front-load) — fatto + DA FARE

**Data:** 2026-06-28 · **Branch:** `dev6` · **Stato:** implementato + testato su `dev6`, **NON deployato**.
**Doc gemello:** [`2026-06-25-pacing-future-ideas.md`](2026-06-25-pacing-future-ideas.md) (daily guardrail / riserva serale).

---

## 🔍 Il problema (osservato dal vivo)

Run live (VPS nuova `ubuntu-4gb-fsn1-b3` / `203.0.113.40`, account `beta-user@example.com`,
provider Kimi): dopo ~18h dal boot il team aveva consumato il **28% del weekly** pur essendo
trascorso solo il **~10.8% del ciclo** (front-load del boot). Eppure la Sentinella si dichiarava
**"weekly ALLINEATO 1.07×"** e `weekly_binding=false`.

Calcolo del burn (sample 28/06 10:10 UTC, ciclo Sab 27/06 16:03 → Sab 04/07 16:03):

| Finestra | Burn reale | vs sostenibile (0.595%/h) | Esaurimento |
|---|---|---|---|
| Media dall'inizio | 1.52 %/h | 2.56× | Mar 30/06 → **4.3 gg prima** del reset |
| Ultime 6h (in HARD-COAST) | 0.83 %/h | 1.40× | Mer 02/07 → **2.7 gg prima** |

→ A qualunque ritmo osservato il budget finiva **2.7–4.3 giorni prima** del reset (blackout di
mezza settimana). Il rate-limite massimo sostenibile **da quel punto** era 0.48%/h; il team stava
a 0.83–1.0%/h.

### Causa-radice
1. **`vel_weekly` rumoroso.** Era misurato su finestra **fissa 2h** su `weekly_usage` a
   risoluzione **1% intero**: il delta era spesso 1 solo punto → errore di quantizzazione ±0.5%/h,
   grande quanto il sostenibile (~0.5%/h). Il `ratio` diventava rumore → falso "ALLINEATO 1.07×"
   (il rate vero, su finestra lunga, era ~1.7–2.1× = SOPRA-PACE).
2. **Nessun segnale di SALDO cumulativo.** Il sistema guardava il *rate* (e il daily cap S-09/C-19,
   per-giorno) ma mai un "quanto sei avanti/indietro **vs la retta ideale** su tutto il ciclo".
   Il 28% già speso non veniva mai contabilizzato come debito.

> Nota: il freno proporzionale al runway **esiste già** (C-09 "scala il freno al runway") e il
> tetto giornaliero anti-front-load **esiste già** (C-19/S-09, è ciò che ha generato l'HARD-COAST
> osservato). Quello che mancava era de-rumorare il rate **e** esporre il debito cumulativo, che
> poi *alimenta* il freno proporzionale esistente.

---

## ✅ Fatto su `dev6` (3 commit)

| Commit | Tipo | Contenuto |
|---|---|---|
| `6d5fbb71d` | fix(pacing) | core `weekly_pace.py` + test |
| `2ea0c11ea` | feat(pacing) | cablaggio `sentinel-bridge.py` |
| `4fba304e8` | docs(prompts) | guida C-09/S-07, base + 7 lingue |

### `shared/skills/weekly_pace.py`
- **Finestra adattiva** per `vel_weekly`: si allarga all'indietro finché il delta intero è ≥
  `MIN_DELTA_PCT` (3), scegliendo la più corta affidabile (cap `MAX_WINDOW_H`=8h). De-rumora.
  Nuovo campo diagnostico `rate_window_h`.
- **Debito cumulativo**: nuovo param `weekly_total_active_hours` → calcola `debt_pct` (= speso −
  ideale, su ore ATTIVE), `ideal_used_pct`, `sustainable_nominal_pct_h`.
- **`is_weekly_binding` esteso**: binda anche con `debt_pct ≥ DEBT_BIND_PCT` (8) **e** `ratio>1.0`
  (in debito la tolleranza scende da 1.2× a 1.0×). Mai binding su `burst_transient`.
- **Fix falso positivo `burst_transient`** a rate bassi: ci si fida del "rate recente crollato"
  solo se il rate medio produrrebbe ≥ `BURST_MIN_SIGNAL_PTS` (1.5) punti interi nella finestra
  recente; altrimenti è rumore di quantizzazione e vetava il binding su over-pace reale.
- Backward-compatible: senza `weekly_total_active_hours` i campi debito sono `None` e il binding
  ricade sul rate classico.

### `.launcher/sentinel-bridge.py`
- `_weekly_pace_via_skill` passa anche le ore attive dell'INTERO ciclo
  (`active_hours_in_range(reset−7gg, reset)`).
- Il tick verso la Sentinella espone ` debt=±Npp` nella riga `WEEKLY-PACE[...]` (anche quando
  `kind=ALLINEATO`). `ATTENZIONE-WEEKLY` scatta già col binding-da-debito.

### Prompt (`agents/capitano/capitano*.md`, `agents/sentinella/sentinella*.md`)
- S-07: documenta `debt`; ratio=foto del rate ORA vs debt=saldo accumulato; in debito tolleranza
  1.0× e freno scalato anche sul debito.
- C-09: freno scalato anche sul debito (un `early_lockout` grande è illusorio se hai front-loadato).

### Test — `tests/test_pacing_weekly_awareness.py`
13/13 verdi. Nuovi: binding-su-debito, in-recupero (no bind), sotto-soglia (no bind), no-bind su
burst, finestra-adattiva e2e (smaschera l'over-pace lento), fallback legacy (debito None).

---

## 📋 DA FARE (gated / backlog)

### 1. Deploy sul run live — gated UTENTE
- [ ] **merge `dev6` → `master`** (decisione utente).
- [ ] **rebuild + redeploy immagine VPS** (`docker compose pull` + `docker image prune -f`, vedi
      gotcha disco pieno) così il fix arriva sulle VPS (live: betaD su `203.0.113.40`; e betaB,
      betaC).
- [ ] **validare dal vivo**: dopo il deploy, sul prossimo front-load il tick deve mostrare
      ` debt=+Npp` e `ATTENZIONE-WEEKLY`, la Sentinella deve girare l'ordine al Capitano, e il
      Capitano deve scalare il freno sul debito (non il 300s timido). Confrontare il burn col
      sostenibile-da-ora (deve scendere sotto ~0.48%/h finché il debito rientra).

### 2. Riallineamento prompt localizzati — BACKLOG (drift preesistente)
Le varianti `capitano.{it,de,es,fr,hu,pt}.md` e `sentinella.*.md` sono **indietro rispetto al
base** `capitano.md`/`sentinella.md`: mancano (almeno) il sotto-bullet **runway-scaling** (C-09
P3), **`burst_transient`** e **BURN-MODE**. Il bullet del debito 2026-06-28 è stato inserito nel
punto logico corrispondente in tutte le lingue, ma:
- [ ] allineare integralmente i prompt tradotti al base (non solo il debito).
- [ ] NB: `capitano.md` base è in **italiano**, mentre `start-agent.sh` (commento ~L624) dichiara
      il base come "EN master language" — incoerenza da chiarire/sanare.

### 3. Possibili affinamenti (futuri, opzionali)
- [ ] Tuning soglie `DEBT_BIND_PCT` (8), `MIN_DELTA_PCT` (3), `MAX_WINDOW_H` (8h),
      `BURST_MIN_SIGNAL_PTS` (1.5) sui dati di più run reali.
- [ ] Valutare se esporre `debt_pct` anche come awareness-field in `compute_metrics.py` (oggi vive
      solo in `weekly_pace`), per coerenza con `weekly_remaining_pct`.

---

## 🔑 Concetti chiave per chi implementa il seguito

- **`ratio` = rate ORA; `debt` = saldo accumulato.** Possono divergere: il bug era proprio
  `ratio≈1.0` (calmo) con debito alto (serbatoio già intaccato). Non confonderli.
- Il `sustainable` di `weekly_pace` **è già adattivo** (residuo/ore-residue): inseguirlo ti fa
  atterrare a 100% al reset. Il debito serve a non *dimettere il freno troppo presto* mentre il
  saldo è ancora in rosso.
- Il debito è **immune al rumore di quantizzazione** perché cumulativo (non a finestra) → è il
  segnale robusto su cui far scattare il binding quando il rate istantaneo inganna.
- Non re-introdurre un **HALT su livello assoluto**: l'obiettivo resta atterrare ~100% AL reset
  (saturare il sub, non bruciarlo prima né sprecarlo). Il debito modula il *freno*, non ferma.
