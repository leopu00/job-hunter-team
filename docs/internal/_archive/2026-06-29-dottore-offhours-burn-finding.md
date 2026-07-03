# 🌙 Dottore brucia budget in off-hours — ❌ FINDING ERRATO (misdiagnosi, chiuso)

> ## ⚠️ CORREZIONE 2026-06-30 — questo finding era SBAGLIATO
> Verificando il codice: lo **scheduled-Dottore È GIÀ gated** sulle working-hours, **identico al Mantenitore** (entrambi via `shared/skills/doctor_schedule.py`). In `.launcher/doctor-watchdog.sh`: `doctor_schedule.py check` ritorna **`OFF` fuori finestra** → il watchdog logga *"fuori working hours — scheduling sospeso"* e **NON spawna** (righe 105-111); spawna solo su slot `T30|MID` **dentro** la finestra. Il fallback ~6h che bypassa il gate vale **solo** per le VPS `NOWINDOW` (24/7, senza finestra), non per betaB (20-08). → La "asimmetria Dottore-non-gated vs Mantenitore-gated" qui sotto è **falsa**.
>
> **Cos'era davvero il +2% off-hours:** (1) **churn dei worker su coda vuota** (~49 cicli di analista-1) = il grosso, **già fixato** col protocollo Scout-esausto + `C-05b` (commit 2026-06-30); (2) un **Dottore in standby** (non si autodistrugge) **risvegliato on-demand** = il path di sicurezza (liveness/zombie-rescue) che vogliamo **preservare**.
>
> **Conclusione: niente da implementare.** Voce BACKLOG `[PACING-DOTTORE-OFFHOURS-GATE]` chiusa come misdiagnosi. Il testo sotto resta solo come storico (premessa errata).

**Data:** 2026-06-29 · **VPS:** betaB (`203.0.113.20`, Kimi, user `22a8e78c`) · **Tipo:** osservazione read-only, NON intervenuto. **Severità:** ~~minore~~ → **nulla (finding errato)**.

---

## 🔍 Come è emerso

Confronto diretto betaC (Codex, turno giorno) vs betaB (Kimi, turno notte 20:00→08:00 Roma = 18:00→06:00 UTC), cicli weekly partiti quasi insieme (betaC 29/06 00:05 UTC, betaB 28/06 21:05 UTC). Guardando la curva di burn weekly di betaB saltava all'occhio un **+2% weekly DURANTE le off-hours**, apparente contraddizione con "il team è fermo di giorno".

## 📊 I dati fini (sentinel-data.jsonl, betaB)

```
UTC    Roma   weekly  5h    fase
05:45  05:45   15     26     ATTIVO (turno notte)
06:00  08:00   18     37     ← FINE TURNO (08:00 Roma). weekly già 18% QUI
─────────────────────────────  OFF
06:35  08:35   18      0     5h reset, weekly piatto
08:55  10:55   18      1     OFF, piatto
09:30  11:30   19      4   ← +1% e il 5h si MUOVE (4→8%)
12:40  12:40   19      8   ← qualcosa GIRA in off-hours
13:20  15:20   20      3   ← +1% ancora
```

Due fatti distinti:
1. **Il grosso (13→18%) è successo MENTRE ATTIVO** (entro le 06:00 UTC, fine turno). Un campionamento a bucket da 6h lo aveva mascherato come off-shift — non lo era.
2. **Il residuo (18→20%, 2 punti) È off-hours**, e il 5h che ticca 4-8% indica **consumo reale**, non lag di reporting.

## 🎯 Causa: il Dottore (one-shot) non è working-hours-gated

Cattura del pane `DOTTORE` nella fascia: sessione Kimi K2.7 **viva e con lavoro reale** (*"corretto `tools/session_refresh_round.py`… resume consegnati… resto in standby"*, context 17.8%).

- Il **Dottore** è un one-shot (context-refresher dei coordinatori) spawnato da `doctor-watchdog` sul **suo schedule ~ogni 2h** (`doctor_schedule.py`).
- Il **gate orario ferma i LOOP dei worker** (Scout/Analista/Scorer), **non** i one-shot LLM: il Dottore può accendersi e bruciare un blocco anche in off-hours.
- Asimmetria col **Mantenitore**, che invece HA il gate (`mantenitore.md` §"Working-hours gate — OFF = stop": fuori finestra logga `phase=OFF` e resta idle). Il Dottore no.

Quantità (gate funziona ma non azzera):
```
attivo (notte):  ~2.0 %/h   worker pieni
off (giorno):    ~0.25 %/h  solo one-shot/coordinatori → ~8× più basso
```

⚠️ **Limite della diagnosi:** non ho timbrato l'orario esatto della run dal log — i `dottore-liveness-*` sono sporadici/on-demand (zombie-rescue), e `agent-usage-table.json` è rolling di sole 2h (i bucket 09-12 UTC erano già scaduti). Evidenza = pane vivo + blip del 5h, fortemente consistente col Dottore; non una prova al microsecondo.

## 🛠️ Fix proposto (per il CODICE, gated)

**Gatare il Dottore sulle working-hours come il Mantenitore**: in off-hours il refresh di context dei coordinatori ha **poco valore** (i coordinatori sono idle, non accumulano context da fermi) → è budget speso quando il team dovrebbe riposare. Particolarmente rilevante su **Kimi** (budget weekly più stretto, [[project_betaA_weekly_99pct_milestone]] vale per Codex ma i Kimi vanno spremuti).

Sfumatura importante da preservare: **lo zombie-rescue ON-DEMAND** (un coordinatore che chiede una `liveness-check` perché un agente è morto) **deve restare permesso anche in off-hours** — è sicurezza, non refresh decorativo. Quindi gatare solo il **refresh schedulato** (`doctor_schedule.py`), non la rianimazione on-demand.

## 📌 Note

- **Non è un blocker.** ~2% del weekly su ~8h off; e in questo caso il Dottore ha pure fatto lavoro utile (ha sistemato `session_refresh_round.py`).
- Collegato a [[project_coordinator_burn_discovery]] (costo fisso dei turni LLM dei coordinatori, indipendente dal lavoro) e al design working-hours (`docs/internal/2026-05-25-work-hours-design.md`).
- Osservazione pura: nessun intervento a runtime (team in osservazione = sola lettura).
