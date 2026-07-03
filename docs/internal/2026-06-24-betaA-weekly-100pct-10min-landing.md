# 🎯 Milestone — betaA (Codex): cap settimanale al 100% a 10 minuti dalla chiusura

**Data:** 2026-06-24 · **VPS:** betaA / `203.0.113.10` (Codex) · **user_id:** `<redacted>` (finance)
**Modalità:** sola osservazione read-only (nessun intervento — regola ferrea).
**Segue / supera:** [`2026-06-18-betaA-weekly-99pct-milestone.md`](2026-06-18-betaA-weekly-99pct-milestone.md)

## 🏆 Il risultato

Nel ciclo del cap settimanale Codex il team ha **portato l'usage settimanale al 100%** e lo ha
fatto **alle 19:50 ora di Roma di mercoledì 24/06 — esattamente 10 minuti prima della chiusura
dell'ultima finestra di lavoro utile dell'intero ciclo** (working hours `08:00–20:00` Europe/Rome).

Non è "10 minuti prima di una chiusura qualsiasi": è 10 minuti prima dell'**ultimo istante
spendibile della settimana**. Dopo le 20:00 di mercoledì il team va in off-hours; il reset
settimanale è giovedì 06:00 UTC (08:00 Roma), **prima** che il turno di giovedì apra alle 08:00.
Quindi il budget settimanale poteva essere consumato solo fino a **mercoledì 20:00 Roma**, e il
team lo ha riempito al 100% con 10 minuti di margine. Atterraggio sul filo, zero overshoot.

## ⏱️ La transizione esatta (storico Sentinella)

```
2026-06-24  16:35 UTC (18:35 Roma)  →  weekly = 99%
2026-06-24  17:50 UTC (19:50 Roma)  →  weekly = 100%   ← landing
2026-06-24  20:00 Roma              →  chiusura turno → off-hours
2026-06-25  06:00 UTC (08:00 Roma)  →  reset settimanale → nuovo ciclo
```

- **100% raggiunto:** 17:50 UTC = **19:50 Roma**.
- **Deadline di spesa (chiusura turno):** 20:00 Roma = 18:00 UTC.
- **Margine: 10 minuti.**
- Negli ultimi minuti il team era in **COAST**: `proj_weekly` si è stabilizzata a ~109%
  (proiezione naive "se tenesse il passo"), ma il **consumo reale è rimasto inchiodato a 100%**
  perché il pacing-bridge aveva già frenato (tutti i worker throttlati a 1200s, niente spawn).

## 🗓️ Ancoraggio del ciclo (verificato)

- Cap settimanale ancorato al **giovedì 06:00 UTC** (≠ reset finestra 5h rolling).
- Questo ciclo: reset Gio 18 06:00 UTC → prossimo reset **Gio 25 06:00 UTC** → **Thu→Thu pieno
  (7 giorni)**. Differenza rilevante rispetto al milestone del 18/06, che era un ciclo ridotto
  (~6 giorni, consumo effettivo ven→gio). Qui l'auto-adattamento ha tenuto sull'**orizzonte
  intero**, non solo su una coda corta.
- L'ultima finestra di lavoro del ciclo è **mercoledì 08:00–20:00 Roma**: il turno di giovedì
  (08:00) cade dopo il reset delle 06:00 UTC → appartiene già al ciclo nuovo.

## 🩺 Stato del team a fine ciclo (snapshot live read-only)

- **Nessun halt flag.** Host up 21 giorni, container `jht` up 45h, load 0.13.
- **Agenti vivi:** core (Capitano/Sentinella/Assistente/Mentor) + worker dinamici
  (Scout-1/3/6, Analista-3/6, Scorer-5) + one-shot Dottore/Mantenitore in standby.
- **Pipeline:** 463 posizioni, 385 scored, **score medio 70.2** (range 27–94).
- **Tassonomia:** 8 famiglie finance attive (il redesign brain-driven ha tenuto — vedi
  `project_taxonomy_brain_driven_redesign_2026_06_20`).
- **Bridge:** sentinel V7 in `GSPOT_CALM`/`LOCKED` (9 tick consecutivi), pacing + window-ratio
  attivi (`confidence=1.0`, 21 giorni osservati), nessun crash.

## ✅ Perché è un achievement superiore al 99%

1. **100% pieno, non 99%** → estrae *tutto* il budget settimanale disponibile, non quasi-tutto.
2. **Precisione del landing**: il 100% cade 10 minuti prima dell'**ultimo istante spendibile**
   dell'intero ciclo, non genericamente "verso fine settimana". È il pacing che, conoscendo
   `residual_to_reset` e le ore-attive rimanenti, dosa il `sustainable_burn` fino a esaurire la
   finestra utile **al minuto**.
3. **Orizzonte pieno**: tenuto su un ciclo Thu→Thu completo (7gg), non su una coda di 6 giorni.

È la conferma — su Codex e su un ciclo intero — del comportamento weekly-aware del redesign
usage-monitoring: burn in banda, **COAST** all'avvicinarsi del cap (throttle, niente spawn),
chiusura **al 100% senza sforare**, reset pulito. **Comportamento da preservare/replicare.**

> Nota: il reset weekly (giovedì 06:00 UTC) è cosa diversa dal reset della finestra 5h
> (rolling 06/11/16/21/01 UTC) — non confonderli leggendo i log. Il `proj_weekly ~109%` è
> proiezione naive a passo costante, **non** il consumo reale (rimasto a 100%).
