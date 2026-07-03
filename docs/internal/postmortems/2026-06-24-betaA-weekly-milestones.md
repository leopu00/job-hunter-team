# 🏆 betaA/Codex — chiusura del weekly al 99% e poi al 100% (milestone, 18–24/06)

Stessa osservazione in due atti, sola lettura, comportamento **da preservare**: il team Codex chiude il cap settimanale al massimo senza sforare grazie all'auto-adattamento (`residual_to_reset` + `sustainable_burn`). Atto I (18/06): 99% su ciclo corto ~6gg. Atto II (24/06): 100% pieno toccato 10 minuti prima dell'ultima finestra utile, su ciclo Thu→Thu completo.

---

> **Atto I — weekly al 99% (2026-06-18)** · origine: `2026-06-18-betaA-weekly-99pct-milestone.md` — contenuto integrale, non riscritto.

## 🏆 Milestone — betaA (Codex): cap settimanale chiuso al 99% (auto-adattamento al budget)

**Data:** 2026-06-18 · **VPS:** betaA / `203.0.113.10` (Codex) · **user_id:** `9996e20c` (finance)
**Modalità:** sola osservazione read-only (nessun intervento — regola ferrea).

### 🎯 Il risultato

Nel ciclo del cap settimanale Codex il team ha **portato l'usage settimanale fino al 99%**
(rimaneva l'1%) **senza mai sforare**, per poi rientrare pulito al reset. Comportamento target:
**massima resa del budget settimanale, zero overshoot**.

**Precisazione — NON è stata una settimana piena di lavoro.** Il ciclo del cap è ancorato al
**giovedì 06:00 UTC** (gio→gio: reset Gio 11 → Gio 18). Ma il **consumo effettivo è partito
venerdì 12**: i token/giorno mostrano 8–11/06 ≈ 0 (team fermo), poi salita da Ven 12. Quindi
il budget settimanale è stato riempito in **~6 giorni (ven→gio), non 7**. Il fatto che si sia
comunque chiuso al 99% è esattamente la prova del punto qui sotto.

### 📈 La curva del cap settimanale

Salita progressiva fino al **99%** verso fine settimana, poi crollo verticale al **reset
(Gio 18 06:00 UTC)**, quindi ripartenza pulita (8% nelle prime ~8h della settimana nuova).
Nelle ore finali il team era in **COAST / weekly-bind**: il pacing-bridge frenava
deliberatamente (throttle, niente spawn) per **non superare il cap** — non era idle, era
gestione fine del residuo budget.

### 📊 Consumo token/giorno (la settimana)

| Giorno | Token | 
|---|---|
| Ven 12 | 54 Mtok |
| Sab 13 | 168 Mtok |
| **Dom 14** | **239 Mtok** ← picco |
| Lun 15 | 159 Mtok |
| Mar 16 | 72 Mtok |
| Mer 17 | 41 Mtok |

Picco nel weekend (Dom 14), poi discesa controllata man mano che il weekly si avvicinava
al cap → COAST.

### 🩺 Stato del team a fine ciclo

- **8 agenti vivi**: Capitano, Sentinella, Assistente, Mentor + 2 Scout, 1 Analista, 1 Scorer.
- **Pipeline**: 347 posizioni (+74 nella settimana), 235 scored / 112 excluded, coda drenata.
- **Qualità**: score medio **70.4** (range 34–94).
- **Bridge** tutti attivi (sentinel V7, pacing, window-ratio, tg×3), nessun crash. Container up 2gg.

### ✅ Cosa dimostra — auto-adattamento al budget

Il pregio non è "ha lavorato 7 giorni" (non li ha lavorati): è che **il sistema si auto-adatta
al budget residuo**. Nei dati: `weekly_window_source = 'residual_to_reset'` + `sustainable_burn`
calcolato dinamicamente (≈1.2%/h). Il pacing non assume una settimana fissa — calcola
**budget rimanente ÷ ore attive rimanenti fino al reset** e ci spende dentro. Per questo è
arrivato al **99% al reset a prescindere dall'aver iniziato venerdì** (~6 giorni): se avesse
avuto più o meno tempo/budget, avrebbe ricalibrato il burn di conseguenza.

È la **validazione del comportamento weekly-aware** del redesign usage-monitoring su **Codex**
(prima validato su betaB/Kimi): il pacing-bridge tiene il burn in banda e — avvicinandosi al
cap — passa a **COAST** (throttle, niente spawn) per chiudere **a un soffio dal limite (99%)
senza sforare**, poi riparte al reset. Massima resa del budget, zero overshoot.
**Comportamento da preservare/replicare.**

> Nota: il reset weekly (giovedì 06:00 UTC) è cosa diversa dal reset della finestra 5h
> (rolling ogni 5h: 06/11/16/21/01 UTC) — non confonderli leggendo i log.

---

> **Atto II — weekly al 100%, atterraggio a 10 minuti dalla chiusura (2026-06-24)** · origine: `2026-06-24-betaA-weekly-100pct-10min-landing.md` — contenuto integrale, non riscritto.

## 🎯 Milestone — betaA (Codex): cap settimanale al 100% a 10 minuti dalla chiusura

**Data:** 2026-06-24 · **VPS:** betaA / `203.0.113.10` (Codex) · **user_id:** `9996e20c` (finance)
**Modalità:** sola osservazione read-only (nessun intervento — regola ferrea).
**Segue / supera:** `2026-06-18-betaA-weekly-99pct-milestone.md`

### 🏆 Il risultato

Nel ciclo del cap settimanale Codex il team ha **portato l'usage settimanale al 100%** e lo ha
fatto **alle 19:50 ora di Roma di mercoledì 24/06 — esattamente 10 minuti prima della chiusura
dell'ultima finestra di lavoro utile dell'intero ciclo** (working hours `08:00–20:00` Europe/Rome).

Non è "10 minuti prima di una chiusura qualsiasi": è 10 minuti prima dell'**ultimo istante
spendibile della settimana**. Dopo le 20:00 di mercoledì il team va in off-hours; il reset
settimanale è giovedì 06:00 UTC (08:00 Roma), **prima** che il turno di giovedì apra alle 08:00.
Quindi il budget settimanale poteva essere consumato solo fino a **mercoledì 20:00 Roma**, e il
team lo ha riempito al 100% con 10 minuti di margine. Atterraggio sul filo, zero overshoot.

### ⏱️ La transizione esatta (storico Sentinella)

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

### 🗓️ Ancoraggio del ciclo (verificato)

- Cap settimanale ancorato al **giovedì 06:00 UTC** (≠ reset finestra 5h rolling).
- Questo ciclo: reset Gio 18 06:00 UTC → prossimo reset **Gio 25 06:00 UTC** → **Thu→Thu pieno
  (7 giorni)**. Differenza rilevante rispetto al milestone del 18/06, che era un ciclo ridotto
  (~6 giorni, consumo effettivo ven→gio). Qui l'auto-adattamento ha tenuto sull'**orizzonte
  intero**, non solo su una coda corta.
- L'ultima finestra di lavoro del ciclo è **mercoledì 08:00–20:00 Roma**: il turno di giovedì
  (08:00) cade dopo il reset delle 06:00 UTC → appartiene già al ciclo nuovo.

### 🩺 Stato del team a fine ciclo (snapshot live read-only)

- **Nessun halt flag.** Host up 21 giorni, container `jht` up 45h, load 0.13.
- **Agenti vivi:** core (Capitano/Sentinella/Assistente/Mentor) + worker dinamici
  (Scout-1/3/6, Analista-3/6, Scorer-5) + one-shot Dottore/Mantenitore in standby.
- **Pipeline:** 463 posizioni, 385 scored, **score medio 70.2** (range 27–94).
- **Tassonomia:** 8 famiglie finance attive (il redesign brain-driven ha tenuto — vedi
  `project_taxonomy_brain_driven_redesign_2026_06_20`).
- **Bridge:** sentinel V7 in `GSPOT_CALM`/`LOCKED` (9 tick consecutivi), pacing + window-ratio
  attivi (`confidence=1.0`, 21 giorni osservati), nessun crash.

### ✅ Perché è un achievement superiore al 99%

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
