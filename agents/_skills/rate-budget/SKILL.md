---
name: rate-budget
description: Read the rate-limit budget snapshot for the active provider (usage %, time-to-reset, velocity, projection, recommended throttle) from the bridge. Use it at Captain startup to plan pace and decide how many agents to spawn, then periodically when you want a fresh snapshot without spending tokens calling the provider directly. Zero provider calls — reads the latest tick already written by the bridge.
allowed-tools: Bash(python3 *)
---

# rate-budget — rate-limit budget snapshot

The monitoring bridge (`.launcher/sentinel-bridge.py`) polls the active provider every 1–10 min (dynamic — more often under pressure) and writes each sample to `/jht_home/logs/sentinel-data.jsonl`. This skill reads only the **latest sample** that's already been written — no extra provider call.

## Primary: the SAME tick the Sentinella gets

Run with no argument (or `tick`):

```bash
python3 /app/shared/skills/rate_budget.py tick
```

You get the **exact same message** the bridge sends to the Sentinella — the
bridge renders it every tick into `logs/last-tick.txt` and this reads it back
(zero provider calls, zero divergence). Three airy sections + a bridge hint:

```
── BRIDGE TICK · 12:45:03 · codex · ON ──

⏱  FINESTRA 5H
   usage 51%        target 92%  →  chiusura 2026-06-30 16:45 CEST (tra 4h 00m)
   velocità  11.5 %/h   ·   target  10.2 %/h     [+12% sopra]
   → ATTENZIONE   ·   proj 97%

📅  OGGI  (budget giornaliero)
   consumato 4.2% / budget 9.0% (cap 14.0%)   ✅
   velocità  1.1 %/h   ·   target  0.8 %/h     [+38% sopra]

📆  SETTIMANA
   usato 16%   ·   rimane 84%   ·   reset 2026-07-07 05:00 CEST (tra 6g 16h)
   velocità  3.4 %/h   ·   sostenibile  1.1 %/h     [+209% sopra]   ratio 3.09×
   SOPRA-PACE   ·   debito +6pp   ·   lockout ~58h

🧭  CONSIGLIO BRIDGE
   Sopra-pace: throttle-to-pace + STOP nuovi spawn finché rientri. ...
src=bridge.
```

**Read it like this — la velocità è IL segnale** (proj è solo INFO volatile):
- ogni sezione ha **velocità attuale** (usage consumato / tempo trascorso) vs **target** (quanto manca / tempo che resta), stessa unità %/h. Lo scarto `[+X%/-X%]` è il giudizio.
- **5h** = il soffitto del provider (lock a 100% prima del reset). **Oggi** = il budget del giorno. **Settimana** = budget + debito.
- velocità **sotto** target su tutte → c'è margine → spawn graduale (C-02). Velocità **sopra** target → frena / non spawnare. Segui il `🧭 CONSIGLIO`, ma **decidi tu** (C-01).

**If output is `NO_DATA`:** the bridge hasn't written a tick yet (not started, or off-hours). Wait 1–2 min and retry.

## Other modes

```bash
python3 /app/shared/skills/rate_budget.py plan     # scheda dettagliata (velocity EMA, host, policy)
python3 /app/shared/skills/rate_budget.py status   # one-liner scriptable
python3 /app/shared/skills/rate_budget.py live      # FORZA un fetch fresco al provider (costa) — solo per dubbi gravi
```

`status` one-liner:
```
# → provider=claude usage=55% status=OK throttle=0 reset_in=2h 34m (at 2026-04-24 15:49 CEST)
```

## When NOT to use it

- **Don't call it on every step.** Use it at *phase changes* of your plan (bootstrap, end of Scout batch, after a pause, etc.). The bridge updates at its own rate; calling more often doesn't return fresher data.
- **It does not replace the asynchronous `[BRIDGE ORDER]` flow:** the bridge notifies you *when* policy changes; you plan *while looking at* the budget. The two mechanisms are complementary.
