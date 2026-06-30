<!-- @translation: it, ai-translated 2026-06-06 -->
---
name: rate-budget
description: Legge lo snapshot del budget rate-limit per il provider attivo (utilizzo %, tempo al reset, velocità, proiezione, throttle consigliato) dalla bridge. Usalo all'avvio del Captain per pianificare il ritmo e decidere quanti agenti spawnare, poi periodicamente quando vuoi uno snapshot fresco senza spendere token chiamando il provider direttamente. Zero chiamate al provider — legge l'ultimo tick già scritto dalla bridge.
allowed-tools: Bash(python3 *)
---

# rate-budget — snapshot del budget rate-limit

La bridge di monitoraggio (`.launcher/sentinel-bridge.py`) polla il provider attivo ogni 1–10 min (dinamico — più spesso sotto pressione) e scrive ogni campione in `/jht_home/logs/sentinel-data.jsonl`. Questa skill legge solo l'**ultimo campione** già scritto — nessuna chiamata extra al provider.

## All'avvio del Captain

Prima di spawnare qualsiasi agente, esegui:

```bash
python3 /app/shared/skills/rate_budget.py plan
```

Output tipico:
```
=== Rate Budget — claude ===
  Usage:            53%
  Reset:            tra 2h 34m (2026-04-24 15:49 CEST)
  Measured velocity:+0.39%/h (EMA)
  Target velocity:  11.38%/h (to close at 92% by reset)
  Reset projection: 56%
  Status:           OK
  Throttle:         T0 full speed
  Host:             cpu=4.7% ram=9.8% (OK)

  Recommended policy: Spawn freely in parallel — keep normal pace.
  Margin to 92% target: 39%
  Last tick:        2026-04-24T10:23:18.705062+00:00
```

**Interpretazione del Captain** (usa `Measured velocity` vs `Target velocity` — NON `Reset projection`, che è INFO volatile):
- `Throttle T0–T1` + `Measured velocity` ben sotto `Target velocity` (sotto-ritmo) → spawn completo (Scout + Analyst + Scorer + Writer + Critic)
- `Throttle T1–T2` + `Measured` ≈ `Target` (a ritmo) → spawn ridotto (una istanza per ruolo)
- `Throttle T2+` o `Measured velocity` sopra `Target velocity` (bruciando) → **nessun spawn**, aspetta che la bridge liberi il throttle
- `Reset projection` è solo INFO (estrapolazione volatile a fine finestra) — non basare lo spawn su quello.

**Se l'output è `NO_DATA`:** la bridge non ha ancora pollato. Aspetta 1-2 min e riprova. Non avviare il team senza questo segnale — rischi di saturare il rate-limit alla cieca.

## Versione one-liner (scriptabile)

```bash
python3 /app/shared/skills/rate_budget.py status
# → provider=claude usage=55% status=OK throttle=0 reset_in=2h 34m (at 2026-04-24 15:49 CEST)
```

Utile per log veloci o check a metà loop.

## Quando NON usarla

- **Non chiamarla ad ogni step.** Usala ai *cambi di fase* del tuo piano (bootstrap, fine del batch Scout, dopo una pausa, ecc.). La bridge si aggiorna al suo ritmo; chiamare più spesso non restituisce dati più freschi.
- **Non sostituisce il flusso asincrono `[BRIDGE ORDER]`:** la bridge ti notifica *quando* la policy cambia; tu pianifichi *guardando* il budget. I due meccanismi sono complementari.
