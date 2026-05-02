# JHT Team Session Report — 2026-04-30 22:44 → 2026-05-01 02:12 UTC

> Sessione conclusa, team fermato. Report finale con metriche complete,
> grafici e considerazioni operative.

## ⏱ Durata e contesto

```
Inizio team:           2026-04-30 22:44:00 UTC  (00:44 CEST)
Fine team:             2026-05-01 02:12:00 UTC  (~04:12 CEST)
Durata:                ~3h 28min
Provider attivo:       Kimi K2 Plan
Bridge:                V6 (state machine + g-spot + cooldown 15min)
```

## 📊 Numeri chiave

```
TOTAL EVENTS                  1134 messaggi Kimi (response API)
BRIDGE TICKS                    44 ticks
WEIGHTED TOKENS         10,785,877  (10.79 MT)
RAW TOKENS  
  input new                1,410,868
  output                     575,752
  cache_read              87,992,576  (cache hit ratio ~98%, ottimo)
RATE BUDGET KIMI           20% → 84%   (Δ +64% in 3h28m)

VELOCITY MEDIA         52.26 kT/min   (peak 100+ kT/min nei burst)
RATIO INCREMENTALE     162 kT per 1%  (alta variabilità, vedi nota cache)
```

## 👥 Consumo per agente

```
AGENTE          EVENTS  WEIGHTED kT  AVG kT/min   % team total
─────────────────────────────────────────────────────────────────
📝 SCRITTORE-1    455      5,205     27.18         48.2%
🕵 SCOUT-1        226      3,064     27.05         28.4%
👑 CAPITANO       121        866      4.26          8.0%
🔎 CRITICO        171        660      3.55          6.1%
⚖ SCORER-1         40        228     23.19         2.1%
🛡 SENTINELLA      16         96      0.52         0.9%   ✅ <5% target
─────────────────────────────────────────────────────────────────
TOTAL            1029     10,119                  93.7%
unmapped          105        666                   6.3%
```

### 🎯 Insight per-agente

```
✅ SENTINELLA al 0.9% del totale team:
   bridge V6 raggiunge il target esplicito di [JHT-SENTINELLA-OPTIMIZE]
   < 5%. Sentinella si è davvero comportata da "fallback only".
   16 events in 3h28m = 1 evento ogni ~13 min (cooldown 15min funziona).

📝 SCRITTORE-1 dominante (48% del totale):
   genera 30 sessioni di REVIEW al Critico, ognuna a costo medio ~22kT
   (review cieca delle candidature). È il bottleneck di costo.
   Possibile ottimizzazione: cache delle review template/contesto.

🕵 SCOUT-1 secondo per consumo (28%):
   consumo costante a 27 kT/min, lavoro intensivo di ricerca posizioni
   con shell (curl/python). Burst durante la fase di esplorazione
   LinkedIn dopo l'istruzione del Comandante.

👑 CAPITANO contenuto (8% del totale):
   nonostante 3 nudge dell'Utente nella seconda metà della sessione,
   Capitano ha mantenuto consumo basso (~4 kT/min). Buon coordinatore.

⚖ SCORER-1 ad alto rate ma pochi eventi:
   23 kT/min ma solo 40 eventi → bursts di scoring concentrati,
   non background load.

🔎 CRITICO regolare (6%):
   171 eventi, ognuno breve (~4 kT), cooperazione efficiente con Scrittore.
```

## 🌐 Grafo comunicazioni — chi parla a chi

```
                              👑 CAPITANO
                              (8% consumo)
                              /    |     \
                    1 sess /     1 sess    \ 1 sess
                          ↓        ↓         ↓
                      🕵 SCOUT  📝 SCRITTORE  ⚖ SCORER
                                    │
                              30 sessioni REQ  
                                    ↓
                                🔎 CRITICO

  🧑 UTENTE → 🛡 SENTINELLA (1 boot msg)
  🧑 UTENTE → 👑 CAPITANO  (4 msg: 1 boot + 3 nudge)

  Distribuzione tipi messaggio:
    REQ  = 30  (Scrittore → Critico, review cieche)
    MSG  =  5  (boot + nudge dell'utente)
```

PNG salvato in `/jht_home/logs/agent-communication.png` e in
`/tmp/jht-final-communication.png` per visualizzazione locale.

### Pattern interessanti dal grafo

```
1. Capitano è hub spawn-only:
   1 sessione per spawning di Scout/Scrittore/Scorer, poi non riapre.
   I worker spawnati lavorano in autonomia.

2. Scrittore↔Critico è il loop più intenso:
   30 review REQ in 3.5h ≈ 1 ogni 7 min.
   È il pattern "blind review" canonico.

3. Sentinella isolata:
   solo input dall'Utente al boot, niente output (non ha mai mandato
   ordini di throttle al Capitano in questa sessione perché bridge V6
   non l'ha mai svegliata in zona critica grazie al cooldown).

4. L'Utente è entrato nel grafo:
   non era 100% autonomo. 3 nudge espliciti per "spingere al massimo
   senza sforare". Il team ha reagito (vedi sezione sotto).
```

## 🎚 Bridge V6 in azione

```
samples bridge:        44 ticks in 3h28m
proj range:            20% → 84%
proj media:            ~75% (curva ascendente verso target)

phase transitions osservate:
   DEFAULT (3min)
     ↓ proj entra g-spot
   GSPOT_FAST (2min)
     ↓ 3 tick consecutivi nel g-spot
   GSPOT_STABLE (5min)
     ↓ (verso fine sessione)
   ❌ GSPOT_CALM non raggiunto (servirebbero altri 3 tick STABLE)

Sentinella notify count:        ~3-4 (basso, come da design)
```

### 🚨 Eventi notable durante la sessione

```
22:44  team avviato dal Comandante
22:44  bridge V6 stabilisce baseline (era pid=526 dopo restart)
22:55  utente -> capitano: nudge per fix LinkedIn extraction
       (dopo che Scout-1 si era arreso su "linkedin blocked")
23:30  proj saliva linearmente verso 95%
~00:?? VM Mac in sleep ~25 min — bridge si è correttamente ripreso
       al wake-up (sample naive proj=20%, poi recovery EMA)
~00:?? utente -> capitano: "controlla lo usage"
~01:?? utente -> capitano: "non state sfruttando la FINESTRA AL MASSIMO"
~01:?? utente -> capitano: "SPINGI AL MASSIMO SENZA SFORARE"
       → conseguenza: velocità sale da ~25 kT/min a 145 kT/min nei
         3 tick successivi
04:00  watcher finale 15min (5 iter):
         iter 1  76%  79.49%  DEFAULT      11574 kT
         iter 2  78%  80.69%  GSPOT_FAST   12009 kT  (+435 kT in 3min)
         iter 3  81%  82.52%  GSPOT_STABLE 12233 kT
         iter 4  81%  82.52%  GSPOT_STABLE 12474 kT  (no nuovo bridge tick)
         iter 5  84%  84.14%  GSPOT_STABLE 12758 kT
04:12  team fermato dal Comandante
```

## 🧠 Lessons learned di questa sessione

### Cosa ha funzionato

```
✅ Bridge V6 con cooldown 15min:
   Sentinella consumo 0.9% (target <5%). Loop autoindotto V5 chiuso.

✅ State machine g-spot:
   Promozione automatica DEFAULT → FAST → STABLE osservata in real-time.

✅ State file pubblico:
   API web /api/bridge/status ora autoritativa, no drift V*→TS.

✅ Token-meter PoC:
   30s sample, ~98% cache hit ratio osservato, mapping per-agente
   funziona via state.json custom_title (con fix regex sender vs
   receiver).

✅ Wake-up VM recovery:
   il bridge si è ripreso correttamente dopo 25min di pausa Mac sleep,
   senza loop o restart manuale.

✅ Comunicazione agenti via tmux:
   tutto loggato, ricostruibile retroattivamente.
```

### Cosa NON ha funzionato (o richiede attenzione)

```
⚠️ Sotto-utilizzo verso fine sessione:
   il team da solo NON ha sfruttato il budget. Senza i 3 nudge
   dell'Utente, sarebbe rimasto fermo a proj ~70-75%.
   
   Idea futura [JHT-BRIDGE-V8]: bridge auto-rileva
      proj < 80% AND reset_window_remaining < 90min
   e manda automaticamente "[BRIDGE NUDGE] spingi" al Capitano.
   
   Questo è il dual del cooldown: oggi rallentiamo, domani anche
   acceleriamo se vediamo budget non sfruttato.

⚠️ Ratio cumulativo instabile (162 kT/% medio, 45-387 spread):
   problema noto, finestra fissa 5h dello script include sample
   pre-team-start. Fix: WINDOW = since reset_at del bridge.

⚠️ Critico non collegato al Capitano direttamente:
   se Critico bocciasse troppe review, Capitano non lo saprebbe.
   Pattern di escalation da progettare.

⚠️ Wake-up VM "naive proj":
   primo sample post-wake con vel=0 → proj naive=usage. EMA si
   stabilizza in 2-3 tick ma è un picco/valle artefatto nel grafico.
```

### 💡 Idee strategiche emerse durante la sessione

```
1. PID throttle per-agente [JHT-BRIDGE-V7] — proposto in BACKLOG
   - misurazione fine c'è (token-meter)
   - manca solo l'attuazione fine (controller deterministico)
   
2. AUTO-INCENTIVE [JHT-BRIDGE-V8] — emerso oggi dai 3 nudge utente
   - bridge accelera il team se vede budget non sfruttato verso
     fine finestra
   - opposto del cooldown
   
3. Mapping session→agente via custom_title funziona ma fragile:
   - Kimi non logga cwd nei propri sessions
   - Workaround: parse @receiver del custom_title
   - Più robusto: forzare kimi-cli a loggare cwd in metadata
```

## 📁 Artefatti prodotti

```
PNG (in /tmp/ host + /jht_home/logs/ container):
   📊 jht-final-token-analysis.png    cumulative + velocity + ratio + top sessions
   📊 jht-final-by-agent.png          consumo cumulativo per agente
   📊 jht-final-by-agent-rate.png     velocità rolling per agente
   🌐 jht-final-communication.png     network graph chi parla a chi

CSV:
   /jht_home/logs/token-meter.csv     ~430 sample @ 30s = 3.5h dati per analisi

Script (in shared/skills/, persistenti via bind-mount):
   token-meter.py             daemon di monitoring continuo
   token-meter-plot.py        analisi 4-panel
   token-by-agent-plot.py     plot per-agente cumulativo
   token-by-agent-rate.py     plot per-agente rate
   agent-communication-graph.py  network graph

Documenti:
   docs/internal/2026-05-01-bridge-and-token-monitoring.md  (brainstorm)
   docs/internal/2026-05-01-team-session-report.md          (questo file)

Modifiche al codice:
   .launcher/sentinel-bridge.py       V5 → V6 (state machine + state file)
   web/app/api/bridge/status/route.ts  legge state file invece di replicare
   web/proxy.ts                        CSP nonce integrato (ex middleware.ts)
   web/app/components/landing/JsonLd.tsx  fix Client/Server boundary
   BACKLOG.md                          nuove entry + status update
```

## 🎯 Prossimi step suggeriti

```
URGENTE (tier 2):
   • token-meter window dinamica = since reset_at
   • token-meter come servizio persistente (singleton + autorestart)

DEDICATA (tier 3):
   • throttle-controller per-agente (PID semplice + dead-band)
   • [JHT-BRIDGE-V8] auto-incentive verso fine finestra
   • Fix BUG-TUI-BUILD (CI Docker rotta dal 27/04)

STRATEGICO (tier 4):
   • Repo pubblica con strategia low-profile (modello Bellard/Sysoev)
     timeline 6-8 settimane di prep
   • Weekly window monitoring [JHT-MONITORING-WEEKLY]
   • Hour slots [JHT-MONITORING-WORKHOURS]
```
