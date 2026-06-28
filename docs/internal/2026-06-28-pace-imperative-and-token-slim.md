# 🎯 Pacing slim — verdetto imperativo (Passo A) + driver-in-token (Passo B)

**Data:** 2026-06-28 · **Branch:** `dev3` · **Visione utente:** snellire la mega-repo, scolpire solo ciò che serve; il segnale di pacing deve essere **forward e imperativo**, non una media-2h rumorosa che *decide*. Doc gemello: [`2026-06-28-weekly-debt-aware-pacing.md`](2026-06-28-weekly-debt-aware-pacing.md).

---

## 🧭 Il modello (concordato)

Due velocità diverse, oggi mescolate nel nome:

- **IDEALE (target, "quanto DEVO andare"):** `v* = budget_residuo / ore_LAVORO_residue`.
  Forward, **zero storia, si auto-corregge** (uno schizzo abbassa il residuo → `v*` cala → si
  rallenta). È già nel codice come `sustainable_pct_h`. **Questa steera.**
- **REALE (misurata, "quanto STO andando"):** derivata del consumo su una finestra. È l'unico
  pezzo che guarda indietro → è da qui che nasce tutta la complicazione (contatore intero
  `weekly_usage` a passi di 1% → finestra adattiva, `burst_transient`, soglie). **Questa è solo
  DIAGNOSI/trend, NON deve decidere.**

Valuta comune ideale = **token (kT)**: il `weekly_usage` % è quantizzato a 1% (rumore ±0.5%/h,
grande quanto il sostenibile); i token hanno risoluzione enorme → niente quantizzazione. La
conversione `kT ↔ %` si **impara online** (`ratio = team_kt / Δusage`, già calcolata nel
pacing-bridge); instabile al boot → serve un prior/warmup.

Due guinzagli, si steera al più stretto: `v* = min(weekly_resid/ore_a_reset_weekly,
window5h_resid/ore_a_reset_5h)`. (Il bridge già piega il weekly dentro il target 5h via
`residual_to_reset` — da rendere esplicito in token nel Passo B, non da aggiungere.)

---

## ✅ Passo A — FATTO su `dev3` (basso rischio, gated sul deploy)

Il bridge **calcola e antepone il VERDETTO imperativo** al tick della Sentinella: la conclusione
pronta, ideale per un modello debole (i **Kimi**, poco manovrabili). I token grezzi restano
**appesi** dopo → **contratto S-07 intatto** (i nomi sono "lockati col bridge" in 7 lingue).

| File | Modifica |
|---|---|
| `.launcher/sentinel-bridge.py` | nuova `_pace_verdict_line(weekly_pace, wk_remaining)`; anteposta a `weekly_pace_field` nell'emit |
| `agents/sentinella/sentinella.md` | S-07: documenta il verdetto in testa (azione pronta, grezzi appesi per l'analisi a fondo) |

Verdetti emessi (priorità: burst > frena > accelera > mantieni):

```
WEEKLY-PACE→RALLENTA ~42%: vai a ~0.48%/h (ora 0.83) (resta 41% in 86h-lavoro) → altrimenti ESAURISCI ~31h-lavoro PRIMA del reset
WEEKLY-PACE→ACCELERA-SATURA: a ritmo attuale chiudi ~64%, spreco ~36% del weekly prima del reset
WEEKLY-PACE→RIPRESA-CONTROLLATA: picco in uscita, NON frenare duro
WEEKLY-PACE→MANTIENI (~0.59%/h) (resta 41% in 120h-lavoro)
```

La DECISIONE resta `sustainable_pct_h` (forward); `vel_weekly` (media 2h) serve **solo** a
quantificare di quanto tagliare, non a decidere. Niente script cancellata: `weekly_pace.py`
intatto come libreria.

**Validato:** syntax OK + 5 casi unit (front-load, sopra-pace, burst, burn-mode, in-pari) rendono
l'output atteso. **Gated:** vive su dev3, va live solo con merge→master + rebuild immagine VPS.

---

## 📋 Passo B — DA FARE (gated / shadow, è il control-loop LIVE)

Obiettivo: far guidare la ladder da `v*`-in-token e **ritirare dal percorso critico** la macchina
di de-rumore (resta come diagnostica, non come decisione).

1. **Driver in token, shadow-mode.** In `pacing-bridge.compute_tick` la ladder oggi gira su
   `delta = vel_team − vel_target` (`vel_target` = forward OK; `vel_team` = media rumorosa). Sostituire
   il driver con `v*`-in-token (residuo_kT / ore_lavoro_residue, min dei due guinzagli). **Log-only
   per N giorni** ("avrei messo X invece di Y") sulla VPS live, confronto, poi flip.
2. **Slim del prompt + emit.** Una volta validato, togliere i token grezzi dal tick e **riallineare
   S-07** (base + 6 lingue, oggi già backlog drift) al solo verdetto. Solo allora la finestra
   adattiva + `burst_transient` + metà `is_weekly_binding` escono dal percorso critico (restano in
   `weekly_pace.py` come trend-line diagnostica).
3. **Trend-line esplicita** (opz., basso valore su Codex che già atterra bene): proiezione "a questo
   ritmo chiudi a X% / esaurisci Nh prima" — già derivabile da `projected_final_pct`/`early_lockout_h`.

**Vincoli da preservare:** `ore_LAVORO_residue` (active-hours, non wall-clock — era il vecchio bug
notti idle); niente HALT su livello assoluto (obiettivo = atterrare ~100% AL reset); il prior di
calibrazione token↔% al boot. **Target vero della semplificazione = manovrabilità Kimi** (Codex è
già a posto da ~3 settimane).
