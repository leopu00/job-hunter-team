# 🔬 burst_transient (P3) è un dead-letter — finding + redesign (backlog, prio BASSA)

**Data:** 2026-06-14 · **Trovato osservando:** betaB (Kimi) post-deploy fix-batch, confermato cross-VPS su betaA (Codex) · **Owner fetta:** `shared/skills/weekly_pace.py` (dev3) · **Consumer prompt:** Sentinella S-07 / Capitano C-09 (invariati) · **Regola:** finding annotato in OSSERVAZIONE, NON corretto a caldo.

## TL;DR
Il flag `burst_transient` introdotto col fix-batch (P3) **non scatta mai** nella pratica. Su betaA: **0 occorrenze su 22 tick SOPRA-PACE** (dev2), nonostante oscillazioni ampie (1.5x↔2.77x). Su betaB: non scatta nemmeno nello scenario-target (burst appena finito + team flat). La causa è **strutturale**, non una soglia da ritoccare. Il redesign converge (dev3+dev1) su un **flat-segment detector**.

## Cosa doveva fare P3
Il `vel_weekly` è una media a finestra 2h: un picco PASSATO la tiene gonfia per ~2h anche se il rate ora è ~0 → Capitano/Sentinella **over-brake** (freeze/no-spawn) su un segnale stale = idle-tail. `burst_transient` doveva segnalare "il burst sta svanendo, recupero rapido OK" per evitare il freno duro.

## Implementazione attuale (che non funziona)
```python
RECENT_WINDOW_H = 0.5         # sotto-finestra "recente"
BURST_TRANSIENT_RATIO = 0.4   # rate recente < 40% media 2h = burst in uscita
# recent = primo punto con t >= now - 0.5h ; newest = ultimo punto
# burst_transient = vel_weekly > sustainable AND vel_recent < 0.4*vel_weekly
```

## Root cause (verificata sui dati betaB)
Dump `weekly_usage` 2h (00:0X UTC, post-recreate 21:38):
```
20:05 →64 ... 21:24 →68
21:34:50 →68  ← ancora dentro recent-window (now-0.5h)
21:37 →69  21:38 →69 (recreate)  21:41 →70
21:43 · 21:46 · 21:48 · 21:50 · 21:56 · 22:01 →70   (FLAT da ~20min, rate reale ~0)
vel_weekly(2h)=3.12 %/h ; vel_recent(0.44h)=4.58 %/h ; soglia 0.4*3.12=1.25 → burst_transient=False
```
Due difetti che si sommano:
1. **Lag della recent-window**: i 0.5h ancorano al primo punto ≥ now-0.5h, che cattura ancora la **coda del burst** (68→70 a 21:37-41). Il team è flat da ~20min ma la finestra "vede" la salita → `vel_recent` alto.
2. **Quantizzazione intera**: `weekly_usage` è INTERO (quantum 1%). A rate sostenibili (~1.5%/h) c'è ~1 tick ogni ~40min, quindi **qualunque finestra abbastanza corta da reagire è dominata da un singolo +1 tick** → `vel_recent` resta sopra soglia. Accorciare la finestra (opzione scartata) PEGGIORA: su 3 tick un +1 domina ancora di più.

La Sentinella logga letteralmente `BURST_TRANSIENT not provided` → nessun override → over-brake sul segnale stale. Il bridge **surfacia** il flag correttamente (`sentinel-bridge.py` L1250-1251); il difetto è solo nel detector dentro `weekly_pace.py`.

## Redesign converge: flat-segment detector
Invece di un *rate* su finestra corta (grumoso con dati interi), usare un *detector di segmento piatto*:

```
burst_transient = (kind == "SOPRA-PACE")                         # media 2h ancora alta
                  AND (Δweekly_usage == 0 sugli ultimi K tick)   # ~3-4 tick / ~15min flat
```
- Con dati interi, **"0 incrementi per ~15min mentre la media 2h è alta" è un segnale PULITO** che il burst è finito: la granularità intera diventa un *vantaggio*, non rumore.
- L'**AND con SOPRA-PACE è obbligatorio**: senza, confonderebbe "burst finito" con "pace lento normale" (a 1.5%/h, 15min flat è anche fisiologico).
- **Bonus (un fix, due problemi)**: risolve anche lo *stale-data-su-volume* — `sentinel-data.jsonl` persiste sul volume attraverso il recreate, quindi dopo un boot la media 2h è gonfia dai dati pre-recreate. Ma i tick recenti post-boot sono flat (team appena su) → il flat-segment **sopprime correttamente il freno** sul segnale stale.
- **Lato prompt: nessun cambio.** C-09 (Capitano) e S-07 (Sentinella) consumano il flag `burst_transient` così com'è; cambia solo come viene calcolato in `weekly_pace.py` (`RECENT_WINDOW_*` → logica flat-segment).

### Rischio da evitare
Una P3-v2 troppo *eager* che spegne del tutto il freno over-pace. Il gate `AND SOPRA-PACE` + K tick flat consecutivi è il presidio.

## Priorità: BASSA → backlog tuning pacing
- Lo scenario osservato è **semi-artificiale**: il burst+stop è caduto su un boundary della finestra a causa della contaminazione dev3 pre-recreate. In un run naturale il burst non finisce così di netto.
- Il sistema **si auto-recupera comunque** via decadimento della finestra 2h (~30-60min): quando i punti vecchi escono dai 2h, `vel_weekly` cala → SOTTO-PACE → il Capitano riprende (ed eventualmente `burn_mode` accende l'accelerazione pre-reset).
- Va in backlog insieme al **coordinator-burn-no-op** (il bridge non sa frenare quando il top-consumer è un coordinatore, non un worker).

## Quando si implementa
Modifica isolata in `shared/skills/weekly_pace.py`:
- sostituire `RECENT_WINDOW_H` / `BURST_TRANSIENT_RATIO` con i parametri flat-segment (es. `FLAT_SEGMENT_TICKS = 4`, `FLAT_SEGMENT_MIN_H = 0.25`);
- nell'iterazione raccogliere gli ultimi K `weekly_usage` e verificare `max-min == 0` su una durata ≥ `FLAT_SEGMENT_MIN_H`;
- `burst_transient = (kind == "SOPRA-PACE") and flat`;
- test: caso burst-then-flat → True; caso pace-lento-costante (SOTTO/ALLINEATO) → False; caso over-pace-sostenuto (tick che salgono) → False.
