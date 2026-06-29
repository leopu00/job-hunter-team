# 🧭 Status bi-dimensionale (5h ∧ weekly) — pacing weekly-aware

**Data:** 2026-06-29 · **Branch:** dev2 · **Stato:** prototipo committato, **NON deployato**
**File toccati:** `shared/skills/compute_metrics.py`, `.launcher/sentinel-bridge.py`

---

## 🔎 Il problema

Lo `status` che il bridge scrive in `sentinel-data.jsonl` (e che Sentinella/Capitano/UI
leggono) è calcolato **solo dall'asse rate-limit a 5 ore** (`projection` 5h vs band, in
`compute_metrics.py`). Il **budget settimanale** è completamente fuori dal segnale.

Conseguenza osservata il 2026-06-29 sulla flotta: tutte e 3 le VPS mostravano
`status=SOTTOUTILIZZO` **anche quando il weekly correva**:

| VPS | weekly usato | status (vecchio) | realtà |
|---|---|---|---|
| b3 | **57 %** | `SOTTOUTILIZZO` | brucia a **1.91× il sostenibile** → verso il lockout pre-reset |
| betaC | 8 % | `SOTTOUTILIZZO` | in realtà **in pari** (0.86×) |
| betaB | 19 % | `SOTTOUTILIZZO` | genuinamente sotto (0.41×) |

Un `SOTTOUTILIZZO` significa per il Capitano *«puoi scalare su»*. Ma su b3 quello
spingerebbe a **front-loadare** il budget settimanale e ad arrivare al lockout prima del
reset. Il segnale è cieco proprio sull'asse che conta a fine settimana.

### Perché era così (è in parte voluto)

`compute_metrics.py` marca i campi weekly come **awareness-only** (decisione 2026-06-13):
niente halt a soglia assoluta, l'obiettivo è **saturare ~100 % entro il reset** senza
incagliare il budget a metà settimana. Il freno weekly «vero» vive nel pacing-bridge
(`vel_team` vs `vel_target`, active-hours-aware). **Esiste già** un verdetto weekly
pulito — `weekly_pace.py::weekly_pace_assessment` — ma **non arriva nello `status`**:
restano due segnali scollegati.

C'è anche una trappola: il `proj_weekly` esposto da `compute_metrics` è calcolato su ore
di **calendario** (include le notti idle) → **sovra-proietta** su un team a orari. È quello
che faceva leggere `proj_weekly=325 / 460` (numeri non fisici). **Non va usato per decidere.**

---

## 🎯 La soluzione: `status` = vincolo BINDING dei due assi

Lo `status` diventa il **più stretto** di due assi indipendenti, usando il verdetto weekly
**de-rumorato active-hours** (non il `proj_weekly` calendario):

```
asse 5h:      projection vs band         → ATTENZIONE / STEADY / OK / SOTTOUTILIZZO
asse weekly:  vel_weekly / sustainable    → SOPRA-PACE(>1.2) / ALLINEATO / SOTTO-PACE(<0.8)
              (sustainable = weekly_remaining / ore_ATTIVE_al_reset)

status = worst-case(asse_5h, asse_weekly) + tag dell'asse binding
```

Regole di composizione (in `compute_metrics.py`, dopo il calcolo dell'asse 5h):

1. **weekly SOPRA-PACE** e il 5h non è già allertato (`ATTENZIONE`/`RESET`)
   → `status = "SOPRA-PACE-WEEKLY"`, `binding_axis = "weekly"`
   *(= FRENA, non scalare — anche se il 5h è basso)*
2. **weekly ALLINEATO** e il 5h è `SOTTOUTILIZZO`
   → `status = "STEADY"`, `binding_axis = "weekly"`
   *(il 5h dice «scala per riempire», ma il weekly è già a target → non scalare)*
3. altrimenti → status 5h invariato (`binding_axis = "5h"`)

### Cosa NON fa (per rispettare il design)

- **Nessun halt a soglia assoluta.** Non reintroduce il freno-a-75 % rifiutato nel 2026-06-13.
  È un segnale **rate-based active-hours** (quello che il design già *vuole*), portato dentro
  il singolo `status` team-facing invece di restare scollegato.
- **Non tocca `throttle`/`phase`** (calcolati sul 5h, invariati). Lo `status` resta
  «informativo»: il throttle effettivo lo decidono Capitano + pacing-bridge.
- Il caso **LOCKED** (weekly_remaining ≤ 0) resta nel bridge ed è più severo: ha precedenza.
  Ordine di severità: `SOTTOUTILIZZO < STEADY < SOPRA-PACE-WEEKLY < ATTENZIONE < LOCKED`.

---

## 🛠️ Implementazione

**`shared/skills/compute_metrics.py`**
- Firma: `compute_metrics(parsed, last, history=None, weekly_axis=None)`.
  `weekly_axis` = dict da `weekly_pace_assessment` (`{kind, ratio, …}`) oppure `None`.
- Blocco di composizione prima del `return` (non tocca `phase`/`throttle`).
- Nuovi campi nel sample JSONL:
  - `status_5h` — l'asse 5h grezzo (trasparenza/audit)
  - `binding_axis` — `"5h"` | `"weekly"`
  - `weekly_pace_kind` — `SOPRA-PACE` | `ALLINEATO` | `SOTTO-PACE` | `ND`
  - `weekly_pace_ratio` — `vel_weekly / sustainable`
- **Back-compat:** con `weekly_axis=None` il comportamento è identico a prima.

**`.launcher/sentinel-bridge.py`**
- Nel tick, **prima** di `compute_metrics` (così lo status *persistito* è già composto),
  si pre-calcola il verdetto weekly via `_weekly_pace_via_skill` (usa il `weekly_remaining`
  corrente + la storia dal JSONL ≤ tick precedente — il sample odierno non serve per il rate).
- `_compute_metrics_via_skill(..., weekly_axis=…)` lo inoltra a `compute_metrics`.

---

## ✅ Dry-test su dati live (2026-06-29, ~10:30)

Verdetto weekly calcolato con la skill **deployata** + regola di composizione del prototipo:

```
            status_5h      weekly_kind (ratio)   weekly%   →  STATUS composto      binding
─────────────────────────────────────────────────────────────────────────────────────────────
 betaB      SOTTOUTILIZZO  SOTTO-PACE (0.41)     19%       →  SOTTOUTILIZZO         5h      (invariato)
 betaC     SOTTOUTILIZZO  ALLINEATO  (0.86)      8%       →  STEADY                weekly  (cambiato)
 b3         SOTTOUTILIZZO  SOPRA-PACE (1.91)      57%      →  SOPRA-PACE-WEEKLY     weekly  (cambiato)
```

Da notare: il ratio active-hours di betaC è **0.86** (in pari), non i **325** del
`proj_weekly` calendario → conferma che quel campo è rumore e che la metrica active-hours
è quella corretta su cui comporre.

---

## ⚠️ Residui prima di un eventuale deploy

1. **Consumatori downstream — FATTO (baseline EN + UI) 2026-06-29:**
   - `capitano.md` (C-09): `status=SOPRA-PACE-WEEKLY`/`binding_axis=weekly` collegato
     alla logica SOPRA-PACE esistente (throttle-to-pace, niente nuovi spawn) + ⚠️ «NON
     leggerlo come SOTTOUTILIZZO, non scalare».
   - `sentinella.md` (S-06): nota che il bridge ora compone il `status` con l'asse weekly
     (conferma del suo assessment S-07, non un segnale nuovo).
   - UI: `STATUS_COLOR` + union type in `sentinella/page.tsx`, `api/sentinella/data/route.ts`,
     `UsageChart.tsx`, `UsageTokensChart.tsx` (aggiunti anche `STEADY` e `LOCKED`, prima non
     mappati). Esposti i nuovi campi `status_5h`/`binding_axis`/`weekly_pace_kind`/`ratio`.
   - **Residuo:** le 6 varianti i18n per lingua di capitano.md/sentinella.md
     (de/es/fr/hu/pt/it). Le VPS attuali girano in EN → baseline EN sufficiente per la
     flotta; le i18n servono solo per deployment non-EN.
2. **Soglie** (0.8 / 1.2 sul ratio weekly) ereditate da `weekly_pace.py` — da validare su
   più giorni se vogliamo renderle più/meno aggressive.
3. **Doppio calcolo weekly_pace per tick** (uno per lo status, uno per il messaggio
   Sentinella): innocuo ma ottimizzabile riusando il primo verdetto.
4. **Non deployato.** Prototipo su dev2; il deploy resta una scelta esplicita (merge→master
   + rebuild + redeploy), dopo aver chiuso il punto 1.
