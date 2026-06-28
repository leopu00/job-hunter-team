# 🏆 Milestone — betaA (Codex): cap settimanale chiuso al 99% (auto-adattamento al budget)

**Data:** 2026-06-18 · **VPS:** betaA / `203.0.113.10` (Codex) · **user_id:** `9996e20c` (finance)
**Modalità:** sola osservazione read-only (nessun intervento — regola ferrea).

## 🎯 Il risultato

Nel ciclo del cap settimanale Codex il team ha **portato l'usage settimanale fino al 99%**
(rimaneva l'1%) **senza mai sforare**, per poi rientrare pulito al reset. Comportamento target:
**massima resa del budget settimanale, zero overshoot**.

**Precisazione — NON è stata una settimana piena di lavoro.** Il ciclo del cap è ancorato al
**giovedì 06:00 UTC** (gio→gio: reset Gio 11 → Gio 18). Ma il **consumo effettivo è partito
venerdì 12**: i token/giorno mostrano 8–11/06 ≈ 0 (team fermo), poi salita da Ven 12. Quindi
il budget settimanale è stato riempito in **~6 giorni (ven→gio), non 7**. Il fatto che si sia
comunque chiuso al 99% è esattamente la prova del punto qui sotto.

## 📈 La curva del cap settimanale

Salita progressiva fino al **99%** verso fine settimana, poi crollo verticale al **reset
(Gio 18 06:00 UTC)**, quindi ripartenza pulita (8% nelle prime ~8h della settimana nuova).
Nelle ore finali il team era in **COAST / weekly-bind**: il pacing-bridge frenava
deliberatamente (throttle, niente spawn) per **non superare il cap** — non era idle, era
gestione fine del residuo budget.

## 📊 Consumo token/giorno (la settimana)

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

## 🩺 Stato del team a fine ciclo

- **8 agenti vivi**: Capitano, Sentinella, Assistente, Mentor + 2 Scout, 1 Analista, 1 Scorer.
- **Pipeline**: 347 posizioni (+74 nella settimana), 235 scored / 112 excluded, coda drenata.
- **Qualità**: score medio **70.4** (range 34–94).
- **Bridge** tutti attivi (sentinel V7, pacing, window-ratio, tg×3), nessun crash. Container up 2gg.

## ✅ Cosa dimostra — auto-adattamento al budget

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
