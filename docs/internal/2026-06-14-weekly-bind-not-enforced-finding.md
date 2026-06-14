# 🔬 Weekly-bind non enforced: il pacing target è l'arco-5h, mai il weekly (backlog, PRIO ALTA)

**Data:** 2026-06-14 (notte) · **Trovato osservando:** betaB (Kimi) post-fix, pipeline piena · **Confermato design:** dev1 · **Lane fix:** pacing-bridge (dev3) + S-06 (dev2) + C-09 (dev1) · **Regola:** OSSERVAZIONE, NON corretto a caldo.

## TL;DR
Il redesign usage-monitoring ha sistemato la **visibilità** del burn weekly (la metrica `weekly_pace` vede SOPRA-PACE + `early_lockout`). Il **controllo** è parziale: il `vel_target` del pacing-bridge usa il weekly sostenibile come target **quando il weekly è il vincolo dominante** (5h-arc freddo) — vedi Aggiornamento #22 — **ma quando il 5h-arc è CALDO e il weekly è anche stretto, prioritizza il 5h-arc** (~20%/h, più largo) invece del `min(5h, weekly)`. Risultato in quel caso-conflitto: throttle sano ma verso il **setpoint sbagliato** → over-burn weekly. È il **pezzo di CONTROLLO dello smoking-gun originale**: non un'assenza totale di weekly-binding, ma una **risoluzione del conflitto** sbagliata fra i due vincoli quando entrambi sono attivi.

## Evidenza (betaB, 01:39 Rome)
- Trend weekly misurato: **71→77% in ~1h = ~6%/h sostenuto** (non un burst; pipeline SCOUT-4+ANALISTA-4+SCORER-2 attiva).
- `[BRIDGE TICK]` reale: `WEEKLY-PACE[SOPRA-PACE] vel_weekly=3.63%/h sost=1.41%/h ratio=2.57x early_lockout=10.8h`, `weekly_reset=17:11`, `weekly_remaining=25%`, MONTHLY rem=99%. **La metrica vede tutto.**
- `[BRIDGE PACING]` (→Capitano): `vel_target=20-21%/h "per chiudere a 88% al reset 5h"`; il weekly è citato come `weekly_active_hours=18h sustainable_burn=1.41%/h — vincolo WEEKLY parallelo, binda anche in Phase 1 (S-06/C-09)` ma il `vel_target` resta **sempre ~20%/h, mai ~1.41**. I VERDETTI/CMD (throttle analista-4 +120s, scout-4 +30s) inseguono l'arco-5h.
- Sentinella: rileva il peggioramento (`SOPRA-PACE 2.57x early_lockout=10.8h`) ma **resta INFO/silente** — cooldown + Phase-1 gated sul `proj-5h<100%`. Non escala mai sul weekly.
- Traiettoria: 23% residuo / 6%/h → **100% weekly ~05:25 Rome → lockout ~12h prima del reset 17:11**.

## Perché conta anche su betaB (correzione alla cornice "benigno")
Prima lettura (dse3): "benigno perché use-it-or-lose-it usa comunque tutto il budget". **dev1 corregge ed ha ragione:** l'obiettivo è **atterrare ~100% AL reset (17:11)**, non front-load a 05:25 + ~12h di idle-lockout. A parità di budget speso, lo spread:
- tiene betaB **produttivo fino al reset** (il front-load finisce alle 05:25 e poi è locked, non processa lavoro in arrivo 05:25→17:11);
- evita il **lockout duro** (rischio stuck/crash-and-wait, cfr. idle-burn Kimi).
Su una config a **orari normali** (es. betaA 08-20) è peggio ancora: lockout a metà giornata = ore lavorative sprecate. → **suboptimal su ENTRAMBE le config**, non solo betaA.

## Fix design (3 pezzi allineati, vanno INSIEME)
1. **PACING-BRIDGE — dev3 (lane mia):** il pace target operativo diventa il **BINDING** = `min(target_arco_5h, target_da_weekly_sostenibile)`. Quando weekly SOPRA-PACE con `early_lockout < (reset − now)`, il vincolo weekly è il più stretto → `vel_target` scende a ~`sustainable`. È il **duale di `burn_mode`** (lì alzi quando SOTTO + reset vicino; qui abbassi quando SOPRA + lockout anticipato).
2. **SENTINELLA S-06 — dev2:** l'escalation a ordine operativo (Phase 2) deve includere il **weekly SOPRA-PACE** (`early_lockout` che indica lockout > N h prima del reset), non restare INFO gated sul solo `proj-5h`. È il gate che oggi tiene la Sentinella silente.
3. **CAPITANO C-09 — dev1:** già dice "SOPRA-PACE → throttle-to-pace", ma oggi 'pace' = arco-5h. Precisare che su **weekly** SOPRA-PACE il throttle-to-pace mira al **weekly sostenibile**, non all'arco — morde solo se (1) fornisce il target weekly-bound. **Prompt + bridge vanno insieme.**

## Priorità
**La più alta del backlog pacing** (è il CONTROL del bug originale), sopra P3-v2 (burst_transient flat-segment) e coordinator-burn-no-op. **NON urgente stanotte** (betaB usa comunque il budget; betaA in pausa fino 08:00). Si decide con l'utente; nessuno tocca il runtime.

## Aggiornamento osservativo (monitor #18, ~02:48 Rome) — severità ridimensionata
La previsione iniziale ("lockout ~05:25-08:00 a ~6%/h costante") era **troppo aggressiva**. Osservando oltre:
- il weekly è andato in **PLATEAU a 80%** (non marcia a 100%): è il **trough di un'oscillazione throttle** — over-pace 5h → Capitano throttla pesante (analista-4 435s, scout-4 330s) → overshoot a `vel_team=4.19%/h` → `VERDETTO MARGINE -8.70%` → rilascio throttle. Bang-bang attorno al target 5h.
- **3 moderatori indiretti** del burn weekly che mitigano il lockout: (1) il **cap 5h per-finestra** (88%) rende il weekly a stair-step, non continuo; (2) l'**oscillazione throttle** abbassa il burn medio; (3) il **backlog in svuotamento** (342 tot, 105 ready, scorer coda vuota) = meno lavoro = meno burn naturale.
- **L'architettura del finding TIENE** (il `vel_target` mira al 5h-arc, il weekly-bind non è enforced; il fix 3-pezzi resta valido e prioritario) **ma la severità è molto più bassa**: lockout realistico semmai ~12:00+ Rome, o forse nullo prima del reset 17:11. Il sistema ha **backstop indiretti**; il fix migliora la *smoothness/ottimalità* (atterrare al reset), non previene una catastrofe imminente.
- Nota collaterale: l'oscillazione bang-bang (throttle pesante → idle trough) è coerente coi finding di *coarseness* del controllo (lag 2h, step di throttle discreti) — stesso impianto di [P3 burst_transient](2026-06-14-burst-transient-dead-letter-finding.md).
- **P4 win osservato:** al tick 00:15 il bridge ha flaggato il Mantenitore (27% burn, cadenza~0) con la logica nuova `VERIFICA → se ancora stuck KILL (C-12)` — comportamento voluto.

## Aggiornamento osservativo #22 (~10:21 Rome) — il bridge USA il weekly quando domina
Osservato a weekly 94% con 5h-arc freddo (idle): il `[BRIDGE PACING]` riporta `MARGINE -22%/h, burn ANALISTA-4 0.36%/h sotto sustainable 0.67%/h → riduco throttle a 180s per avvicinarmi al target weekly senza sprecare`. Quindi:
- Il bridge **NON è cieco al weekly**: quando il weekly è il vincolo dominante (5h-arc freddo), il `vel_target`/MARGINE è calcolato sul **weekly sostenibile** (qui 0.67%/h) e il bridge nudga il burn *verso* quel target (use-it-or-lose-it: non sprecare il residuo).
- Il finding va **riformulato**: non "il weekly non binda mai", ma "**la risoluzione del conflitto** fra 5h-arc e weekly è sbagliata quando ENTRAMBI sono attivi (5h-arc caldo + weekly stretto, caso #16): vince il 5h-arc (più largo) invece del `min`".
- **Severità ancora più bassa**: appena il 5h-arc si raffredda (#19→22) il bridge passa a targettare il weekly → **convergenza/soft-landing** spontanea (weekly fermo a 94%, atterraggio morbido verso il reset, forse senza lockout). Il fix `min(5h, weekly)` serve a rendere robusto il caso-conflitto, non a introdurre un binding che a tratti già esiste.

## Aggiornamento #26 (~12:51 Rome) — il LOCKOUT si materializza + duale difensivo mancante
Contro la previsione di soft-landing: il team ha ripreso l'enrichment (geocoding companies) e ha bruciato l'ultimo 5% → **weekly=100% alle ~12:22 Rome**, **early-lockout ~5h prima del reset 17:11**. Osservato AL lockout:
- **403-spam multi-agente:** CAPITANO ~6, SENTINELLA ~4, ANALISTA-4 ~2, SCORER-2 ~2 righe `403 access_terminated "You've reached your usage limit for this billing cycle"`. Nessun back-off: gli agenti continuano a chiamare l'API e a incassare 403, presumibilmente fino al reset 17:11 (~5h di churn).
- **Status CIECO al lockout (smoking-gun nella forma più pura):** `[BRIDGE TICK] usage=39% proj=43% status=SOTTOUTILIZZO ... weekly=100% weekly_remaining=0.0%`. Il bridge LEGGE `weekly=100%/remaining=0%` ma il campo `status` resta **SOTTOUTILIZZO** perché calcolato sull'arco-5h (39%) → segnale "lavora di più" mentre il team è hard-locked. Nessun watchdog che mappi `weekly_remaining=0% → hard-sleep fino al reset`.

**Duale difensivo del finding:** oltre al preventivo (target = `min(5h, weekly)` per non arrivare al 100% troppo presto), serve anche il **difensivo**. Linea decisa dall'utente (14/06): **RALLENTARE, mai CONGELARE** (una pausa totale rischia il non-risveglio al reset = danno grave). Tre punti:
1. **Radice:** quando `weekly_remaining==0%` (o 403 `access_terminated`), il `status` deve diventare **LOCKED/ESAURITO**, non SOTTOUTILIZZO → il Capitano smette di spawnare worker = si spegne la SORGENTE dei 403 (non solo il sintomo).
2. **Strato-1 (chiamate usage):** a weekly=100% → RALLENTA il polling, ma mantieni un **heartbeat ancorato al `weekly_reset` noto** → risveglio garantito. Mai stop cieco.
3. **Strato-2 (notifiche a Sentinella/Capitano):** a 100% → UN solo avviso "LOCKED fino a HH:MM" + un check garantito vicino al reset; non azzerare (se il check-100% si rompe, il team rischia di non svegliarsi mai). Orari come riferimento dinamico, non hard-coded.

> Nota: una prima bozza di questo doc proponeva "hard-sleep fino al reset" — **corretto**: l'utente ha giustamente escluso la pausa totale per il rischio non-risveglio.

Stesso root dei punti sopra: status/controllo guidati dall'arco-5h, ciechi al weekly esausto. Anche questo è backlog (NON corretto a caldo): il team recupera da solo al reset.

## Relazione con gli altri finding pacing
- [P3 burst_transient dead-letter](2026-06-14-burst-transient-dead-letter-finding.md): lato SOTTO/recovery, finestra di detection.
- coordinator-burn-no-op: il bridge non sa frenare quando il top-consumer è un coordinatore.
- **Questo (weekly-bind):** il target operativo ignora il vincolo weekly. È il più strutturale dei tre.
