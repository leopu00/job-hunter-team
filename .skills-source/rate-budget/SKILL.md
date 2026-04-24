---
name: rate-budget
description: Legge il budget di rate-limit del provider attivo (usage %, tempo al reset, velocity, proiezione, throttle consigliato) dal bridge. Usala all'avvio del Capitano per pianificare il ritmo e decidere quanti agenti spawnare, e periodicamente quando vuoi una snapshot fresca senza sprecare token chiamando il provider direttamente. Zero chiamate al provider — legge solo l'ultimo tick gia' scritto dal bridge.
allowed-tools: Bash(python3 *)
---

# rate-budget — snapshot del budget rate-limit

Il bridge di monitoraggio (`.launcher/sentinel-bridge.py`) polla il provider attivo ogni 1-10 min (dinamico, piu' spesso sotto pressione) e scrive ogni sample in `/jht_home/logs/sentinel-data.jsonl`. Questa skill legge solo l'**ultimo sample** gia' scritto — nessuna chiamata extra al provider.

## All'avvio del Capitano

Prima di spawnare qualsiasi agente, chiama:

```bash
python3 /app/shared/skills/rate_budget.py plan
```

Output tipico:
```
=== Rate Budget - openai ===
  Utilizzo:         53%
  Reset:            13:49 (tra 2h 34m)
  Velocity misurata:+0.39%/h (EMA)
  Velocity target:  11.38%/h (per chiudere a 92% al reset)
  Proiezione reset: 56%
  Status:           OK
  Throttle:         T0 full speed
  Host:             cpu=4.7% ram=9.8% (OK)

  Policy consigliata: Puoi spawnare in parallelo senza restrizioni. Mantieni ritmo normale.
  Margine al target 92%: 39%
  Ultimo tick:      2026-04-24T10:23:18.705062+00:00
```

**Interpretazione per il Capitano:**
- `Throttle T0-T1` + `Proiezione < 80%` → spawn pieno (scout+analista+scorer+scrittore+critico)
- `Throttle T1-T2` + `Proiezione 80-100%` → spawn ridotto (solo 1 istanza per ruolo)
- `Throttle T2+` o `Proiezione > 100%` → NESSUNO spawn, aspetta il bridge che decida quando puoi
- `Margine al target 92%` ti dice quanto puoi ancora consumare prima di sforare

**Se output e' `NO_DATA`:** il bridge non ha ancora pollato. Aspetta 1-2 min e riprova. Non avviare il team senza questo dato — rischi di saturare il rate senza saperlo.

## Versione one-liner (scriptable)

```bash
python3 /app/shared/skills/rate_budget.py status
# → provider=openai usage=55% status=OK throttle=T0 reset=13:49 (in 2h 34m)
```

Utile per log rapidi o check nel mezzo di un loop.

## Quando NON usarla

- **Non** usarla per ogni singolo step: fallo ad ogni _cambio di fase_ del tuo piano (bootstrap, fine batch scout, dopo una pausa, ecc.). I dati vengono aggiornati dal bridge al suo ritmo, chiamarla piu' spesso non porta dati piu' freschi.
- **Non** sostituisce il [BRIDGE ORDER] asincrono: il bridge ti avvisa _quando_ la policy cambia, tu pianifichi _guardando_ il budget. I due meccanismi sono complementari.
