# DIAGNOSI COLLABORATIVA — pacing weekly (2026-06-03/04) — CASO CHIUSO

> Diagnosi condivisa multi-agente (master + dev1 + dev2 + dev3). **Consenso 4/4** raggiunto 2026-06-04.
> Ogni finding verificato indipendentemente sui dati live del VPS (non per fiducia).
> PII del beta tester anonimizzata (host/IP/profilo/località rimossi).

## ❓ Domanda guida
**Il team (Capitano + Sentinella) è al corrente di COME deve distribuire il weekly usage?**
Risposta sintetica: **NO a livello di prompt.** Il *bridge* calcola il target corretto (gate-weighted) e lo invia, ma i prompt degli agenti ragionano con un **modello 24/7 pre-working-hours**. Dettaglio sotto.

## ✅ Conclusioni convergenti (master + dev1 + dev2 + dev3)
1. **Distribuzione weekly del BRIDGE = corretta e gate-weighted** (`weekly_window_source=residual_to_reset`, `weekly_active_hours≈46.7h`, `target_source=schedule+ratio+weekly`). Pesa le 12h attive 8-20, non 24/7.
2. **Il 421%/SFORO NON è una crisi weekly** → è un artefatto (vedi sezione [master] proj). Weekly sostenibile fino al reset reale (~7 giu 15:41, ~3.9gg, 84% residuo su ~46.7h attive).
3. **Mismatch bridge↔agenti**: il bridge manda il numero giusto; i prompt (C-09/S-06) hanno il modello sbagliato → over-conservazione (es. pausa-spawn "budget 13%").
4. Il **ratio finestra→weekly ha 3 valori in giro** (C-09=3%, seed=14.7%, misurato≈19-25%): serve UNA fonte di verità.

---

## 🎯 MODELLO TARGET CANONICO (lockato dall'utente, 2026-06-04)
**Orari** 7g/7 08:00-20:00 Rome → 12h×7 = **84h attive/sett**. **Obiettivo**: arrivare all'ultimo minuto di lavoro col weekly usage **= 100%** (saturare il sub, non bruciarlo prima né sprecarlo).
```
finestre/sett        = 84h / 5h          ≈ 17 finestre
quota weekly/finestra= 100% / 17         ≈ 5.9% del weekly        (settimana piena)
target % del cap 5h  = (5.9% weekly) / ratio_finestra→weekly
AUTO-CALIBRA         = weekly_residuo / finestre_residue  (ricalcolo ogni tick sul consumo reale)
```
**✅ Il bridge GIÀ calcola questo** (`work_hours_target.py`: `5 × weekly_residuo / ore_attive_residue` = `weekly_residuo / finestre_residue`, verificato `9.16% = 5×86/46.948`; auto-calibrazione intrinseca). **La matematica NON va riscritta.**

**⚠️ UNICO ritocco numerico (da dev3+dev2):** il ratio REALE misurato su finestra piena è **~17-19%**, non il seed 14.7% → il target per finestra dovrebbe essere **~33% del cap 5h, non ~40%** (oggi un filo troppo generoso). Fix = seed codex 14.7→~17 + EMA pulito (no quantizzazione/cold-start).

**⚠️ ATTENZIONE — il 100%/17 è solo IPOTETICO (start allineato).** Questo team NON è partito all'inizio di una finestra 5h né all'inizio della finestra settimanale. Le finestre 5h e il reset weekly seguono lo **schedule del provider** (reset weekly fisso ~7 giu 15:41), non il momento di avvio team. Quindi il calcolo va fatto sul **RESIDUO di partenza reale**, non sulla settimana piena:
```
target_finestra = (ore_attive in QUESTA finestra) × weekly_residuo / ore_attive_residue_al_reset
```
- partiali: la finestra corrente può avere <5h attive (bordo gate / avvio a metà finestra) → `active_hours_in_window` < 5.
- **Numeri REALI ora** (non l'ideale): weekly_residuo ≈ **84%**, ore attive residue al reset ≈ **~44h** → finestre residue ≈ **~8.7** → quota ≈ **~9.6% weekly/finestra** → a ratio ~17% ≈ **~56% del cap 5h** (≠ il 5.9%/33% ideale). È più alto perché abbiamo consumato poco (16%) e restano molte % da spendere in poche finestre prima del reset.
- Dopo il reset 7 giu → settimana piena → converge allo steady-state 5.9%/finestra.

✅ Il bridge fa **esattamente** questo (`residual_to_reset` + `active_hours_in_window`, ricalcolo ogni tick). La formula ideale serve solo come sanity-check; quella operativa è la situazionale.

I gap da chiudere sono solo: **robustezza segnali** (P1/P3/P4/P5) + **awareness agenti** (P2) — non la formula.

---

## [master] Pezzo 1 — proj 5h + h_to_reset (RISOLTO)
- `proj` nel pacing-bridge = `sample["projection"]`: è la proiezione della finestra **PRIMARY 5h** prodotta dal sentinel (skill compute_metrics), NON una proiezione weekly e NON gate-weighted.
- `h_to_reset = hours_to_reset(sample["reset_at"], now)`. **BUG**: `hours_to_reset` (pacing-bridge.py:376) parsa `reset_at` come **solo "HH:MM" senza data**. Subito dopo un reset 5h, `target = HH:MM oggi <= now` → aggiunge 1 giorno → ritorna **~24h** invece di ~5h.
- **Conseguenza**: `proj = usage_now + vel × h_to_reset` con h_to_reset≈24h → **esplode (es. 421%)** al confine del reset → falso `SFORO` → throttle ingiustificato. **Il famoso `23.95h` è esattamente questo** (transiente reset-boundary, confermato anche da dev2).
- **FIX proposto**:
  1. `hours_to_reset` usi **`reset_at_unix`** (già nel sample, sentinel-bridge.py:411) invece della stringa HH:MM → nessuna ambiguità di data.
  2. Clamp `min(h_to_reset, 5.0)` per la primary (un reset 5h non può distare >5h).
  3. Anti-spike: skip/ignora `proj` per il primo tick dopo un reset.
- **Impatto**: rimuove i falsi SFORO/picchi a inizio finestra → niente throttle spurio. (Tracker correzioni: collegare a #8/sentinel.)

## [master] Pezzo 2 — Awareness del team (RISOLTO, è la risposta alla domanda guida)
I prompt runtime hanno un modello **24/7 pre-working-hours**:
- **Capitano C-09** e **Sentinella S-06**: usano `0.14% weekly/h` come "sostenibile" = 100%/**168h** (24/7). Col gate 8-20 il team è attivo 84h/sett (residuo ~46.7h) → sostenibile **~1.8%/h ATTIVO**. Gli agenti non lo sanno.
- **S-06** calcola `proj_weekly = weekly_usage + vel × hours_to_weekly_reset` con **ore WALLCLOCK**, non gate-weighted → assume burn 24/7 fino al reset → **sovrastima** → falsi `ATTENZIONE WEEKLY`.
- Ratio `3% weekly/primary` in C-09/S-06 = vecchio VPS1 ProLite, non il 14.7-25% del meter.
- **dev1**: il bridge **non proietta** il weekly, espone solo `weekly_usage` grezzo (7d API) → la proj_weekly che C-09/S-06 referenziano è lasciata all'agente, con formula wallclock sbagliata.
- **FIX proposto**: riscrivere C-09 + S-06 al modello gate-weighted → (a) il weekly si distribuisce sulle ORE ATTIVE; (b) `proj_weekly` su ore attive, non wallclock; (c) fidarsi di `current_window_target_pct` + `weekly_active_hours` + `weekly_remaining_pct` dal bridge come autorità; (d) rimuovere `0.14%/h` e `3%/primary`.

---

## [dev1] Pezzo 3 — g_spot band: GIÀ agganciata a current_window_target_pct (V8); il fisso 80-105 è solo fallback

**Esito verifica: NON è una costante fissa.** Il g_spot è già dinamico e agganciato al target work-hours-aware:
- `_is_in_gspot(proj, target_pct)` (sentinel-bridge.py:169) → `_gspot_bounds(target_pct)` (155): se `target_pct` è presente ritorna `(target − GSPOT_BAND_BELOW, target + GSPOT_BAND_ABOVE)` = `target−12 .. target+13`; ricade su `GSPOT_LOWER/UPPER = 80-105` (89-90) **solo** quando `target_pct is None`.
- Aggancio: riga 944 `in_gspot = _is_in_gspot(proj, target_pct=dyn_target)`, con `dyn_target,_ = _read_dynamic_target()` (131) che legge `current_window_target_pct` **top-level** da `pacing-bridge-state.json`.
- **LIVE il fallback NON è attivo**: `current_window_target_pct=15.53` è scritto top-level ed è letto → banda dinamica reale `3.5 .. 28.5`. Il `target_band_center=92` resta nello state come campo legacy ma **non** è quello usato dal gate (il 92 è `TARGET_BAND_CENTER` del pacing-bridge, finisce in `current_window_target_pct` solo se schedule+ratio mancano → ora inattivo).
- ⟹ **non c'è un fix di aggancio da fare: è già in V8.** (Correzione al primo report: il mio sospetto di "disconnect nome campo" era infondato, `current_window_target_pct` esiste top-level.)

**Issue VERO residuo (questo sì da fixare):** il g_spot confronta la **projection PRIMARY** (mira al riempimento 100% della finestra 5h; live 172%, gonfiata dal bug `h_to_reset≈24h` — vedi [master] Pezzo 1) con il target weekly-spalmato 15.5%. Risultato: durante l'attività `proj` sta **strutturalmente sopra** la banda → notify quasi continui alla Sentinella **anche con usage assoluto sano** (live `usage=8%` < target `15.5%`). I `proj 137/421` sono questo, non sforo accumulato.

**FIX proposto [dev1]:** gating a doppia condizione prima della notifica (`_should_notify_sentinella`): non svegliare la Sentinella se `usage_assoluto ≤ target_pct` anche quando `proj` è fuori banda (proj alta da sola = sola velocità istantanea, non sforo). Si combina col fix `h_to_reset`+clamp di master (Pezzo 1): corretto `h_to_reset`, `proj` smette di esplodere e il doppio-gate elimina il rumore residuo di inizio finestra.

## [dev2] Pezzo 4 — window-ratio-meter (overshoot 25%) — RISOLTO
- **CAUSA #1 quantizzazione**: `usage` e `weekly_usage` dal bridge sono **INTERI** (`usage=int(round(...))` r399; weekly=15,16). `ratio_inst = dw/du` con delta interi → errore di quantizzazione → ratio gonfiato.
- **CAUSA #2 EMA cold-start avvelenato**: al primo sample `ema=ratio_inst` (r198-199). Se il primo paired tick è +1/+1 = 100%, l'EMA parte avvelenata → overshoot a 25%.
- **Perché NON rompe ancora**: `provider_capacity` blenda seed+ema per confidence: `conf=days/4=0.034` → `0.966×14.7 + 0.034×25 = 15.05%`. Il seed domina → effettivo ~15%, l'overshoot è **innocuo finché confidence è bassa**.
- **Su #15 (dev3)**: NON seedare a 19 — anche il 19 è inflazionato dalla quantizzazione (denominatore medio). La misura pulita è più bassa.
- **FIX proposto**: (a) accumula `du/dw` tra i tick e calcola il ratio solo quando `du_cum ≥ ~10-15pp` (errore quantizz <10%), non per-tick; (b) fix EMA cold-start (non inizializzare ema = primo ratio_inst grezzo).

## [dev3] Pezzo 5 — ratio single-source-of-truth (riconcilia 3% / 14.7% / 19%)

**Modello di riferimento (utente, 2026-06-04) — è la cornice di TUTTO il pacing:**
Lavoro `12h × 7 = `**`84h attive/sett`**. Finestre 5h che partono col team → `84/5 ≈ `**`17 finestre/sett`**. Budget weekly per finestra = `100% / 17 ≈ `**`5.9% weekly`**. Il **target primary per finestra** = `(100%/17) / ratio`: la `ratio window_cap_pct_of_weekly` è il **PERNO** che converte "quota weekly della finestra" in "% della 5h da consumare". Autocalibrazione = `residual_to_reset` (ricalcola quota = `weekly_residuo / finestre_residue` ad ogni tick → se una finestra sfora, la successiva stringe).

**Dove vive il seed:** `shared/skills/provider_capacity.py`, lookup table: `codex/openai/codex-plus = 14.7`, `claude/claude-max5 = 15.0`. Il daemon blenda EMA (window-ratio-meter) col seed via confidence (`conf = days/4`).

**Riconciliazione dei 3 valori — il ratio fissa il target/finestra:**
| Fonte | ratio | → target/finestra `(5.9%/ratio)` | nota |
|---|---|---|---|
| C-09 / S-06 (prompt) | **3%** | ~197% (impossibile) | vecchio VPS1 ProLite, scollegato → **da rimuovere** |
| Seed `provider_capacity` | **14.7%** | **40.5%** (= il `40.49%` del bridge) | design day-0 |
| Misurato dev3 (finestra piena) | **~19%** | **~31%** | Δprimary 79 / Δweekly 15 |
| Meter EMA | ~25% (conf 0.03) | — | overshoot per-tick (vedi dev2) |

**Risposta a dev2 (quantizzazione):** d'accordo che il **meter per-tick** è avvelenato (delta interi `+1/+1` → errore enorme). MA la mia misura usa la **finestra PIENA** (`Δprimary 79 / Δweekly 15`, delta grandi → errore quantizz ~±6%, non per-tick). Quindi il vero ratio è **~17-19%, comunque SOPRA il seed 14.7** → il target `40.5%` è **troppo generoso**: a ratio reale ~18 il target/finestra dovrebbe essere **~33%**, non 40. (Concordo di non seedare a 19 secco, ma neanche restare a 14.7: mediana misure pulite ~17.)

**FIX [dev3] — UNA fonte = `provider_capacity` (seed+EMA):**
1. alza il **seed codex 14.7 → ~17** (mediana misure pulite, in attesa che l'EMA fixato converga);
2. accetta il fix EMA di **dev2** (accumula `du ≥ 10pp`, no cold-start grezzo) + gate **`confidence > 0.3`** prima di fidarsi dell'EMA sul seed;
3. **rimuovi il `3%` da C-09/S-06** e fa' leggere agli agenti il `window_cap_pct_of_weekly` REALE dal bridge (mai un numero hardcoded nel prompt).
⟹ così il target/finestra dell'utente `(100%/17)/ratio` ha **UN solo ratio coerente** end-to-end (prompt = bridge = meter).

---

## [dev1+master] Pezzo 6 — pausa OFF NON enforced (VERIFICATO con dati live)
**Trovato da dev1, verificato indipendentemente da master sui dati VPS** (non accettato per fiducia):
- La fase `work_phase=OFF` è calcolata **correttamente** (gate 8-20), MA **non è enforced**: il `doctor-watchdog` spawna un **Dottore fresco ogni ~2h anche in OFF** → prove: nuove sessioni rollout Codex a **18:33 / 20:33 / 22:33 UTC**.
- Ogni health-check del Dottore **sveglia gli 8 agenti** (sessioni persistenti dal pomeriggio, tmux created 13:26-14:30 → NON è un restart) → i loro `rollout-*.jsonl` vengono appesi a **22:35-23:08 UTC (00:35-01:08 Rome)** = generazione notturna reale.
- Effetto: durante la notte il team genera comunque (dev1: **184 turn, 11.69M token** in OFF, riprodotto da dev3).
- **IMPATTO RICONCILIATO (dev1 token + dev3 cap, verificato anche da master)**: di quei 11.69M, **89% (10.37M) è input CACHED** (contesto ri-inviato dai liveness-reply), output reale solo ~31k. Il **cap weekly reale** sale solo **18→19% = +1pp** in tutta la fascia OFF (verificato master su sentinel-data: weekly stabile a 18 dalle 18:17 alle 21:17 UTC, 19 dalle 21:35). → **P6 è un bug REALE (pausa non enforced) ma NON un'emergenza weekly**: ~+1pp/4h, cache-dominated. dev1 misurava i TOKEN (giusto), dev3 il CAP (giusto): metriche diverse, ora allineate.
- Verifica: `dottore.md` non cita `working_hours`; nessun watchdog in `cli/` chiama `is_within_working_hours` (solo il pacing-bridge lo usa).
- **FIX [dev1]**: (a) Dottore/watchdog **gate-aware** (niente spawn/health-check in OFF, o cadenza ridottissima); (b) `target=0` (OFF) deve tradursi in **PAUSA REALE** (stop spawn/wake), non solo un numero; (c) lasciare al più la Sentinella a tick ridotto.

---

## 🔧 Azioni proposte (riepilogo)
| Pezzo | Owner | Fix |
|---|---|---|
| proj 5h / h_to_reset | master | hours_to_reset via reset_at_unix + clamp 5h + anti-spike |
| awareness C-09/S-06 | master (+dev3) | riscrivere al modello gate-weighted, proj_weekly su ore attive |
| g_spot fissa | dev1 | GIÀ agganciata (V8) — fix vero: doppio-gate notify (usage ≤ target) |
| ratio-meter overshoot | dev2 | seed/clamp + gate confidence |
| ratio single-source | dev3 | una sola fonte del window_cap_pct_of_weekly |
| **pausa OFF non enforced** | **dev1** | Dottore/watchdog gate-aware + target=0 → stop reale (no wake notturni) |
