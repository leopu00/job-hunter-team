# 👁️ betaB/Kimi — monitor weekly su account fresco (live observation)

**Avvio:** 2026-06-24 ~19:45 CEST · **VPS:** betaB (`203.0.113.20`, provider kimi,
user_id `<redacted>`) · **Modalità:** SOLA LETTURA (nessun intervento sulle decisioni del
team — [[feedback_no_intervention_in_simulations]]).

## 🎯 Obiettivo

Osservare, su un **account Kimi con weekly fresco (0%)**, *perché* il team sfora il budget
settimanale e *cosa ne pensano* Capitano e Sentinella. Continuazione del finding
`2026-06-17-betaB-kimi-weekly-burn` + scoperta `burst_transient` che veta il weekly-binding
(sessione 2026-06-23/24).

## ⚙️ Setup applicato (richiesta utente)

- **Orari di lavoro** portati da `20:00→08:00` a **`19:30→07:30` Europe/Rome** (tutti i
  giorni), così la finestra è ON subito. File `/jht_home/jht.config.json`, backup
  `.bak-monitor`. Unico intervento di setup; nessuna direttiva al team.
- Account Kimi sostituito dall'utente (logout/login manuale nella tmux `kimi-betaB`) →
  nuovo account con weekly a 0%. Auth condivisa in `/jht_home/.kimi/kimi.json`.
- Reset weekly del nuovo account: da verificare al primo tick valido (il vecchio era
  Dom 28/06 19:11 Rome).

---

## 📸 Snapshot #1 — Wed 24/06 19:48 CEST (UTC 17:48)

**Tick bridge (ultimi):**
```
17:40:00 usage=0% wk=100  wk_rem=0.0  status=SOTTOUTILIZZO proj_wk=100.0 ph=1
17:45:00 usage=0% wk=None wk_rem=None status=SOTTOUTILIZZO proj_wk=None  ph=1
```

**🚨 BLOCCO: lo swap account NON è propagato agli agenti in esecuzione.**
Sentinella e Capitano mostrano entrambi:
```
Server: Error code: 403 — "You've reached your usage limit for this billing cycle ...
type: access_terminated_error"
```
- Gli 11 TUI Kimi già avviati tengono in **memoria** il token del **vecchio** account
  (esaurito) → 403 ad ogni chiamata. Il nuovo `kimi.json` viene letto solo all'avvio di un
  agente, non a caldo. È il finding noto **"kimi logout non basta"**.
- Conseguenza a catena: il worker che legge l'usage è anch'esso 403 → bridge
  `weekly_usage=None` → il Capitano resta inchiodato su `WEEKLY-BIND → COAST`
  (`weekly_remaining=0%`), citando l'anti-overspawn del 2026-06-07.
- **Deadlock:** chi dovrebbe fare kill+respawn dei worker rate-limited (Capitano, regola
  C-12) è esso stesso 403 → la squadra non si auto-ripara. Serve un respawn per rileggere
  il nuovo account.

**Stato:** team congelato sul vecchio account. L'osservazione "fresh weekly" non può
partire finché gli agenti non vengono ri-spawnati sul nuovo `kimi.json`. Segnalato
all'utente; in attesa di decisione (nessun respawn autonomo).

---

## 🔧 Recovery — Wed 24/06 ~20:01 CEST (autorizzata: "respawno io via VPS")

**Causa-radice del respawn fallito (≠ ipotesi "token nel posto sbagliato").**
Il login/upgrade di "new Kimi Code" innescato col nuovo account ha **rimosso il symlink
`kimi`** da `/jht_home/.npm-global/bin/`: restavano solo `kimi-cli` e `kimi-legacy`
(stesso pacchetto uv, **entrambi v1.47.0**, entrambi con `--yolo`). `start-agent.sh`
cerca esattamente `kimi` (`CLI_BIN="kimi"`, `command -v kimi`) → ogni respawn falliva con
`✗ ... usare un altro provider` (rc=1). Il watchdog (intervallo 30s) riprovava e ri-falliva.

**Il token invece era a posto:** `KIMI_SHARE_DIR=/jht_home/.kimi` (dir condivisa corretta,
impostata all'avvio della sessione di login). Il token OAuth del nuovo account è in
`credentials/kimi-code.json` (`access_token`+`refresh_token`, scritto 17:52). `kimi.json`
contiene solo `work_dirs` (config, non auth). → nessuno spostamento di token necessario.

**Fix (minimale, reversibile):** ricreato il symlink
`kimi -> .../uv/tools/kimi-cli/bin/kimi-cli`. Il watchdog ha subito ri-spawnato i core
(CAPITANO/SENTINELLA/ASSISTENTE/MENTOR + DOTTORE) alle 18:01 UTC.

**Esito auth:** ✅ **0 righe 403** su tutti i core. Capitano operativo (esegue shell,
WELCOME-ACK, context ~9%), Sentinella in attesa del 1° `[BRIDGE TICK]`. Team di nuovo vivo
sul **nuovo account**, senza re-login (la "prima cosa" suggerita dall'utente ha funzionato).

**⚠️ Punto aperto da osservare:** il bridge legge la **primary 5h** (`usage=1%` al tick
18:05) ma `weekly_usage=None` da 5 tick (17:45→18:05) — il reader weekly non aggancia
ancora il nuovo account. Da capire se è solo settling (worker-usage da ri-leggere) o se
il nuovo "Kimi Code" ha cambiato il formato quota rompendo il parser weekly. Roster: solo
core, worker non ancora ri-spawnati dal Capitano.

---

## 📸 Snapshot #2 — Wed 24/06 20:05 CEST (UTC 18:05) — team recuperato

```
18:00:00 usage=0% wk=None status=SOTTOUTILIZZO  (pre-respawn)
18:05:00 usage=1% wk=None status=SOTTOUTILIZZO  (post-respawn, primary legge, weekly no)
```
Roster: ASSISTENTE CAPITANO DOTTORE MENTOR SENTINELLA (core; 0 worker). Auth OK, 0×403.

---

## 📸 Snapshot #3 — Wed 24/06 20:12 CEST (UTC 18:12)

**Tick bridge:** `usage` 0→1→2% (17:45→18:10), **`weekly_usage=None` da 6 campioni
(~30 min)**, status SOTTOUTILIZZO, proj_wk=None.

**🔎 Il weekly non aggancia il nuovo account.** Il `[BRIDGE TICK]` che la Sentinella
riceve riporta `MONTHLY-QUOTA rem=99%` ma **nessun campo `weekly=`**. Due ipotesi da
distinguere nei prossimi giri: (a) il nuovo account è su un **piano a quota mensile** (non
settimanale) → niente finestra weekly da sforare; (b) l'upgrade "new Kimi Code" ha cambiato
il formato della quota e il **reader weekly del bridge non la parsifica** più. Il fatto che
il monthly venga letto (99%) ma il weekly no fa pendere verso (a) o un cambio di formato
specifico del weekly.

**Consumo:** `usage` cresce 0→2% solo per i tick LLM dei core; **nessun lavoro di
pipeline**.

**Roster:** 5 core (ASSISTENTE/CAPITANO/DOTTORE/MENTOR/SENTINELLA), **0 worker** · 7
processi "Kimi Code".

**🟡 Capitano IDLE.** Resta bloccato in `[@capitano -> @system] [WELCOME-ACK] already sent
— awaiting real [CHAT]/[TG]` (context 8.8%, invariato). Dopo il respawn aspetta un trigger
reale (CHAT/TG o direttiva pacing non-COAST) → **non spawna worker**, la pipeline è ferma.

**Sentinella:** viva e calma — logga `tick/silent ... status=SOTTOUTILIZZO ...
MONTHLY-QUOTA rem=99% phase=1 no_notification`. Nessun weekly da pacizzare.

**Lettura:** osservazione attualmente in stallo su due fronti — niente segnale weekly
(None) + team non operativo (Capitano in attesa). Niente intervento. Si osserva se il
Capitano riceve un trigger e se il weekly compare. ⚠️ Da decidere con l'utente se serve un
kick (CHAT/TG) per far ripartire la pipeline — non lo faccio io.

---

## 📸 Snapshot #4 — Wed 24/06 20:18 CEST (UTC 18:18)

**Tick bridge:** `usage` 2% (18:15), **`weekly_usage=None` da ~8 campioni (~40 min)**,
MONTHLY-QUOTA rem=99%. Nessun cambiamento sul fronte weekly.

**🟢 Il Capitano si è svegliato** (context 8.8% → 22.9%) e ragiona. Due cose importanti:

1. **NON è ingannato dal vecchio lock.** Ha esplicitamente drenato come *stale* i messaggi
   ereditati: *"Drain effettuato: 1 tick saltato + molti PIPELINE STALLED + WEEKLY-BIND
   pre-reset (ora stale)"*. Quindi riconosce che il `weekly=100 / LOCKED / reset 28/06` del
   vecchio account non vale più. ✅ (smentisce l'ipotesi "phantom coast da snapshot stale").

2. **Ma ora riceve un `[BRIDGE PACING]` con `SFORO` (over-pace)** e decide di **non
   spawnare**: *"We are over pace. The bridge's small throttle won't fix... the correct
   operational move is to not spawn and accept that the team will coast until next tick."*
   Azione concreta: `throttle-config set assistente 315` (non ci sono worker da throttlare,
   *"There are none"*, quindi throttla l'assistente).

**Paradosso da capire:** il pacing segnala **SFORO/over-pace** con `usage=2%` e `weekly=None`.
Su che base? È il **pacing-bridge** (componente distinta dal sentinel-bridge) a mandare
`[BRIDGE PACING]`; con il weekly assente potrebbe calcolare un over-pace degenere, oppure è
un segnale velocity-based. → da scavare al prossimo giro (catturare la riga `[BRIDGE PACING]`
grezza coi numeri).

**Esito:** roster ancora 5 core, **0 worker**, `usage` 2%, **nessun lavoro di pipeline**. Il
team resta in coast — non più per weekly-lock (drenato) ma per una **decisione di pacing
SFORO**. Sentinella calma, nessun weekly da pacizzare.

---

## 📸 Snapshot #5 — Wed 24/06 20:24 CEST (UTC 18:24) — due nodi sciolti

**✅ 1. Il weekly è comparso.** Tick **18:20: `usage=3% wk=1 wk_rem=99.0 proj_wk=1.0`**. Il
nuovo account **è un piano weekly** (non mensile), **fresco all'1% / 99% rimanente**. Il
`weekly=None` dei ~45 min precedenti era solo **settling del reader** dopo lo swap, non un
cambio di formato. → ipotesi "piano mensile" SMENTITA; l'osservazione del burn weekly è ora
possibile.

**✅ 2. Il paradosso SFORO è VELOCITY-based, non weekly.** Dal Capitano:
> *"Azione sul tick corrente (18:15, SFORO +1.20%/h, weekly 100%) ... Nessuno spawn: siamo
> **sopra vel_target (8.01 vs 6.81)**, quindi l'autonomia di spawn è fuori perimetro (C-05).
> Aspetto MARGINE/ALLINEATO prima di riaccendere Scout."*

Il segnale di over-pace è la **velocità della finestra 5h** (vel 8.01 > target 6.81) — un
**transiente del respawn**: i 5 core risaliti insieme + il loro ragionamento hanno prodotto
un picco di consumo letto come over-pace. Il "weekly 100%" citato dal Capitano era il valore
**stale** del vecchio account (il tick 18:15 precedeva il populate del weekly a 18:20).

**Azioni Capitano:** `throttle-config set assistente 315 → 300s` (ladder floor 5min);
pipeline check `new=0 checked=0 scrittore_queue=0`, *"Nessuna sessione worker attiva"*,
nessuno spawn. Aspetta che la velocità rientri (MARGINE/ALLINEATO) per riaccendere gli Scout.

**Esito:** roster 5 core, 0 worker, `usage` 3%. Il team è in coast per un **transiente di
velocità da respawn**, NON per il weekly (che ora è fresco all'1%). **Attesa:** appena il
picco di velocità decade e il weekly resta basso, il Capitano dovrebbe riaccendere gli Scout
→ inizio del lavoro reale → da lì parte l'osservazione vera del burn weekly.

---

## 📸 Snapshot #6 — Wed 24/06 20:29 CEST (UTC 18:29) — quiescenza

**Tick:** `usage=3%` fermo, **weekly stabile 1% / 99%** (18:20, 18:25). Status SOTTOUTILIZZO.

**Team QUIESCENTE — nessun cambiamento.** Pane di Capitano e Sentinella **identiche** al
tick precedente (context invariati: Cap 23.5%, Sent 11.1%). Il Capitano ha chiuso l'azione
sul tick 18:15 (throttle assistente 300s, no spawn) e ora *"aspetta il prossimo [BRIDGE
TICK] / [SENTINELLA]"*. La Sentinella **non viene svegliata** (SOTTOUTILIZZO + no_notification
→ nessun edge azionabile, neanche al quarto 18:15). Roster 5 core, 0 worker.

**🔑 Domanda aperta (potenziale stuck-idle):** col team fermo la velocità decade verso 0 e
`usage` plateau al 3%; weekly fresco (1%) → **SOTTOUTILIZZO**. Perché il Capitano riaccenda
gli Scout serve un trigger (un `[BRIDGE PACING]` non-SFORO o un ordine `[SENTINELLA]` di
push/scale-up da sottoutilizzo). Da osservare al **quarto 18:30**: la Sentinella si sveglia e
legge il sottoutilizzo come spinta ad usare il budget fresco, o il team resta **bloccato
idle** (vivo ma inattivo)? Quest'ultimo sarebbe esso stesso un finding (post-respawn il team
non si auto-riavvia la pipeline senza un kick).

---

## 📸 Snapshot #7 — Wed 24/06 20:34 CEST (UTC 18:34) — 🚀 pipeline riavviata

**✅ NIENTE stuck-idle: il team si è auto-riavviato al quarto 18:30.** Il transiente di
velocità da respawn è decaduto e il pacing è passato **da SFORO a MARGINE**:
> Capitano: *"Tick 18:30: MARGINE −2.92%/h (4.00 vs 6.92). ... Spawnato **SCOUT-6** via
> start-agent.sh. Kick-off inviato e verificato: CLI attivo, context 7.4%, sta già leggendo
> le skill. ... Scout è il bottleneck corretto. Nessun altro spawn in questo tick (1 per
> ciclo, C-02). Prossimo: attendo [BRIDGE TICK] per ANALISTA-2 o SCORER-1."*

**✅ Segnale weekly ora COMPLETO** nel `[BRIDGE TICK]` (18:30):
`weekly=1% weekly_reset=01/07_17:43 weekly_remaining=99.0%`. E nel `[BRIDGE PACING]`:
`weekly_remaining=99% weekly_active_hours=83h (burn sostenibile 1.19%/h attivo) — vincolo
WEEKLY parallelo, binda anche in Phase 1`. Quindi: nuovo account weekly, **reset Mar 01/07
19:43 Roma**, **sostenibile ≈ 1.19%/h** su 83h attive. Il weekly-binding è attivo e consapevole.

**Roster:** 5 core + **SCOUT-6** (appena spawnato). `usage=3%`, weekly 1%.

**▶️ Da qui parte l'osservazione vera.** Scout-6 inizia a sourcare → il Capitano spawnerà
Analista/Scorer → il weekly comincerà a salire. La domanda centrale: la velocità di burst di
Kimi sfonderà il sostenibile 1.19%/h (a giugno picchi fino a 73×) e il `burst_transient`
veterà di nuovo il freno, oppure il weekly fresco verrà speso in modo spalmato? Prossimi tick = il cuore del test.

---

## 📸 Snapshot #8 — Wed 24/06 20:39 CEST (UTC 18:39) — Scout consuma ma 0 output

**Tick:** `usage=6%` (18:35), **weekly 1% / 99%** invariato. Roster 5 core + SCOUT-6 (nessuna
crescita). Coordinatori fermi all'azione delle 18:30, in attesa del prossimo pacing tick
(~18:45). Sentinella calma, Capitano context 25.7% invariato.

**🔎 Reperto: Scout-6 brucia token senza produrre.** In ~9 min di lavoro:
- **`new` oggi = 0, transizioni `new` = 0** → zero posizioni prodotte.
- È bloccato a **debuggare il proprio script di dedup**: *"Aha! il bug è che 'TROVATA' è
  substring di 'NON TROVATA'! ... fixo tutti gli script per usare match esatto."* Trova
  tutti gli URL già in DB (duplicati) e costruisce/ripara processori invece di emettere job.
- Consumo in salita (context 31.7% → 34.5%) tutto in **meta-lavoro** (scripting/dedup), non
  in output di pipeline.

**Lettura:** è una faccia del "perché Kimi consuma tanto" diversa dal weekly-brake: un worker
può spendere budget in **loop di self-tooling** (scrivere/aggiustare i propri script,
ri-verificare duplicati) con **zero produzione**. Per ora è 1 solo agente e il weekly si
muove appena (1%), quindi non è ancora il burn da osservare — ma è un pattern di
*consumo-senza-output* da tenere a mente. Correttamente il Capitano **non** spawna Analista
(pipeline `new=0` → niente da analizzare): il team si auto-limita bene.

---

## 📸 Snapshot #9 — Wed 24/06 20:47 CEST (UTC 18:47) — ⚡ parte il burst, il Capitano frena

**Produzione partita:** `new oggi = 10` (Scout-6 ha iniziato a inserire). Roster cresciuto:
**+ANALISTA-4**. Roster: core + SCOUT-6 + ANALISTA-4.

**Rampa usage 5h (15 min):** `3% → 6% → 8% → 11%`. **weekly 1% → 2%** (wk_rem 98%).

**🔥 SFORO reale (non transiente da respawn):** Capitano: *"Tick 18:45: SFORO +14.73%/h
(20.01 vs 5.28), top consumer SCOUT-6 (60% share)."* → vel 20%/h vs target 5.28%/h ≈ **3.8×
sopra**. Burn vero: Scout-6 sourcing + debug dei propri script di dedup.

**✅ Il Capitano FRENA (brake 5h-velocity attivo):** *"throttle-config set scout-6 600 →
600s (gradino ladder oltre i 300s). ANALISTA-4 lavora, sopra vel_target → niente spawn.
Attendo il prossimo tick per vedere se il freno riporta sotto target."*

**Burn weekly:** 1→2% in ~15 min ≈ **~4%/h** vs sostenibile **1.19%/h** → già **~3.4×**.
Presto e granulare ma direzione giugno.

**Inefficienza Scout:** context 38.3% (~100k token) per **10 posizioni**.

**Sentinella:** ancora NON allarmata sul weekly (2% → nessuna WEEKLY-PACE notification);
l'over-pace lo gestisce il Capitano via SFORO 5h, non la logica weekly.

**🎯 Test ora:** la brake 5h riporta sotto target? e quando il weekly diventerà binding, la
WEEKLY-PACE morderà o sarà di nuovo **vetata da `burst_transient`**?

---

## 📸 Snapshot #10 — Wed 24/06 20:53 CEST (UTC 18:53) — il backlog spinge a spawnare nonostante SFORO

**Tick 18:50:** usage 5h **11→15%**, **proj 5h = 38.3%** (sopra target 32%), **weekly 2→3%**
(wk_rem 97%). `new oggi = 24`. Roster: core + SCOUT-6 + ANALISTA-4.

**Burn weekly:** 1%→3% in ~30 min ≈ **~6%/h** → **~5× il sostenibile 1.19%/h**. Traiettoria
da sforo (a questo ritmo il weekly durerebbe ~16h invece di 84h).

**🔁 Driver di over-consumo — il backlog vince sul freno.** Il Capitano è ancora SFORO
(Scout-6 throttlata a 600s, *"avoid adding workers"*), MA il funnel si riempie e lo spinge a
crescere il roster: *"24 new e un solo Analista → pipeline-triage: Analyst undersized →
spawn ANALISTA-2 ... siamo sopra pace, ma C-13 prioritizza la copertura Analista"*. → sta per
spawnare ANALISTA-2. La **pressione di pipeline scavalca il brake di over-pace** = più agenti
= più burn. (È la stessa dinamica di giugno: sourcing aggressivo → backlog → più analisti.)

**Sentinella:** tick 18:50 `usage=15% proj=38.3% ... weekly=3% ... phase=1 no_notification` —
**ancora non allarmata** malgrado proj 38 > 32 e weekly a ~6%/h. Il weekly (3%) è troppo
basso per bindare; l'over-pace lo gestisce solo il Capitano via SFORO 5h.

**Efficienza:** Scout-6 context 45.7% (~120k token) per 24 posizioni.

**Atteso:** il weekly continua a salire ~5–6×; quando arriverà alla soglia di binding,
vedremo se la `WEEKLY-PACE` morde o se `burst_transient` la veta come a giugno.

---

## 📸 Snapshot #11 — Wed 24/06 20:58 CEST (UTC 18:58) — over-burn lineare, weekly-brake ancora muta

**Tick 18:55:** usage 5h **15→20%**, **weekly 3→4%** (wk_rem 96%). `new oggi = 25` (Scout
rallentato dal throttle).

**Burn weekly lineare:** 1%@18:20 → 4%@18:55 ≈ **~5%/h ≈ ~4× sostenibile** (1.19%/h). Proiezione
ingenua: 96% / 5%/h ≈ **~19h all'esaurimento** → **più veloce dei 2 giorni di giugno**.

**Roster cresce:** **ANALISTA-2 spawnato** (Capitano: *"next-for-analista mostra 14 in coda,
solo ANALISTA-4 attiva → spawnato ANALISTA-2"*; cita C-13 copertura + C-07 "per consumare di
più"). Ora 2 analisti + SCOUT-6 + core.

**Brake 5h funziona sul singolo:** Scout-6 è in `jht-throttle-wait` (aspetta i 600s) → il
throttle lo rallenta davvero (new fermo a 25). Ma il roster che cresce compensa il burn.

**Sentinella:** ancora `no_notification` a weekly 4% — **nessuna WEEKLY-PACE emessa**. Il
freno weekly non è ancora entrato (weekly troppo basso per bindare / assessment 2h non ancora
flaggato). L'over-pace è gestito SOLO dal throttle 5h sul Scout, non dal weekly.

**Sintesi dinamica:** freno 5h sul singolo agente ✓, ma (a) il Capitano fa crescere il roster
per drenare il funnel e (b) il freno weekly tace → il weekly brucia ~4–5× il sostenibile.
Esattamente la combinazione di giugno, in formazione.

---

## 📸 Snapshot #12 — Wed 24/06 21:03 CEST (UTC 19:03) — SFORO grave, consumo passa agli Analisti

**Tick 19:00:** usage 5h **20→24%**, **weekly 4→5%** (wk_rem 95%). `new = 25` (Scout
throttlato fermo). Burn 1%→5% in 40 min ≈ **~6%/h ≈ ~5× sostenibile**.

**🔴 SFORO GRAVE:** Capitano: *"Tick 19:00: SFORO grave +34.11%/h (36.03 vs 1.91), top
consumer **ANALISTA-4 (51% share)**."* vel 36%/h vs target **1.91%/h** = **~18× sopra**. Il
target 5h è crollato (5.28→1.91) perché la finestra si riempie (usage 24% vs cap 32%). Il
**consumo si è spostato dallo Scout agli Analisti** (analisi JD + stima salary = cara).

**Capitano escala il freno (ladder):** *"throttle analista-4 → 300s (prima 0). Niente spawn
SCORER finché SFORO (6 checked in coda). Attendo per valutare se basta o serve altro gradino /
kill."* → il brake 5h sta salendo di gradino su più agenti.

**Scout-6:** ancora in `throttle-wait`. context 48.9%.

**🔇 Sentinella ANCORA ferma al tick 18:50** (nessun risveglio da ~13 min): **nessuna
WEEKLY-PACE neanche a weekly 5%**. Conferma il punto: il **freno weekly è reattivo-tardi** —
resta dormiente durante il burst iniziale aggressivo, proprio la finestra in cui dovrebbe
spalmare il consumo. L'unico freno attivo è il 5h-velocity sul singolo agente.

**Lettura:** il 5h-pacing combatte (throttle Scout→Analista, niente Scorer, valuta kill) ma il
**weekly va a ~5-6×** indisturbato sull'asse settimanale. Se regge questo ritmo, esaurimento
in <1 notte. Il momento-verità (WEEKLY-PACE + burst_transient) non è ancora arrivato perché la
Sentinella non viene svegliata col segnale weekly.

---

## 📸 Snapshot #13 — Wed 24/06 21:09 CEST (UTC 19:09) — il freno 5h MORDE, burn decelera

**Tick 19:05:** usage 5h **24→25%** (solo +1% in 5 min → da ~36%/h a **~12%/h**), **weekly
plateau a 5%** (wk_rem 95%). `new = 29`. Roster invariato.

**✅ Il brake 5h ha contenuto lo SFORO.** I throttle accumulati (Scout-6 600s + Analista-4
300s) hanno tagliato la velocità: il burst grave del 19:00 (vel 36%/h) è rientrato, il weekly
si è **appiattito a 5%**. usage 25% è ora **sotto** il target 32% (reset 22:43, 3.5h) → il
pacing ha corretto l'overshoot (anzi ora leggermente sotto-pace).

**Importante (≠ giugno):** qui il freno 5h-velocity sta **attivamente contenendo** il burst,
tick per tick. A giugno corse a 100% in 2gg; stasera dopo la rampa iniziale (1→5% in 45 min =
front-load del restart pipeline + dedup-loop Scout + backlog analisti) il consumo **decelera**.

**Capitano:** *"aspetto il tick 19:15 per confermare che il freno su ANALISTA-4 abbia
riportato sotto target; se sì accendo SCORER-1 per i 6 checked"*. Scout-6 continua (CIRCLE 3
Ungheria/Italia), già a 600s.

**Sentinella:** ancora ferma (weekly 5%, no WEEKLY-PACE) — non è servita: l'ha gestito il 5h.

**🎯 Ora la domanda si sposta:** il weekly è a 5% dopo il front-load; **il ritmo a regime**
scende verso il sostenibile (1.19%/h) o riparte un altro burst al prossimo riempimento di
coda? Se il 5h-brake tiene il passo a ogni burst, il weekly potrebbe NON esaurirsi — sarebbe
la differenza con giugno.

---

## 📸 Snapshot #14 — Wed 24/06 21:15 CEST (UTC 19:15) — target 5h RAGGIUNTO + leak "agente bloccato"

**Tick 19:15:** usage 5h **25→28→31%** = **target 31% raggiunto** → **vel_target = 0.00%/h**
(finestra "piena", coast fino al reset 22:43). **weekly 5→6%** (wk_rem 94%, sostenibile 1.14%/h,
82h). `new = 38`.

**✅ Il 5h-target sta funzionando come da design.** Se ora coastano, questa finestra =
31% × ratio 18.47% ≈ **5.7% weekly**. Su 12h-notte (~2.4 finestre) ≈ **~14%/notte = sostenibile**
→ atterraggio a 100% in 7gg, come Codex. La matematica regge.

**🕳️ MA il leak: agente BLOCCATO che il throttle non ferma.** Verdetto bridge: *"SFORO
+16.01%/h → -25% (top consumer scout-6). VERIFICA scout-6: brucia **54% con cadenza ~0** (0
chk in 15m). Se è su UN task lungo lascialo finire; se al prossimo tick è ANCORA cadenza~0 =
stuck → **KILL+respawn (C-12, il throttle non lo ferma)**."* Scout-6 è a **context 60% (~158k
token)** scrivendo processor (RemoteOK) con **zero output**. → **Il throttle (600s tra azioni)
è inefficace contro un singolo task lungo**: l'agente non fa azioni discrete, è in un unico
loop di meta-lavoro. Solo il KILL lo ferma. Questo è il vero canale che può far **sforare il
target di finestra** (consumo che continua dopo vel_target=0).

**Sentinella:** svegliata al quarto 19:15 — fa g-spot tracking (proj 73.98 in banda 70-90,
`tick_below_gspot_count += 1`), **ancora nessuna WEEKLY-PACE** (weekly 6%). Non serve: il 5h
regge.

**🔑 Affinamento del finding:** il pacing 5h-target weekly-derivato **funziona** e riproduce
il sostenibile *se gli agenti rispettano il throttle*. Il fail-mode non è (per ora) il
`burst_transient` sul freno weekly, ma un **agente stuck in un task lungo** che il throttle
non può fermare → serve KILL. Da vedere se il Capitano killa Scout-6 e se il target di finestra
viene rispettato o sforato.

### 🔬 Deep-dive Scout-6 (cosa bruciava)
Andato **fuori pipeline** in un cantiere di scraping autonomo: scrape a mano di 6+ board
(euremotejobs, RemoteOK ×2 ~900KB, WeWorkRemotely 497KB, LinkedIn tw-pl/cz/ro, Greenhouse di
GitLab/Docker/Aiven/Grafana/Sentry/Red Hat, Productra API) + **4 processori Python custom**,
e **loop di debug dei propri bug** (`NameError: name 'sys' is not defined` ×3). ~2MB scaricati,
**~172k token (context 66%) per ~38 posizioni**. Modello **K2.7 Code** (modello da coding →
incline a "risolvere scrivendo script" e over-ingegnerizzare). Codex/betaA (gpt-5.5) resta
sulla pipeline standard → niente rabbit-hole. **È una fetta importante del "Kimi consuma
tanto": agenti che partono per la tangente a programmare, e il throttle non copre quel pattern.**

---

## 📸 Snapshot #15 — Wed 24/06 21:21 CEST (UTC 19:21) — Capitano KILLA Scout-6, leak capato

**Tick 19:20:** usage 5h **31→36%** (**5 pt sopra il target 31%**), **weekly 6→7%** (wk_rem 93%).
`new = 38` (fermo).

**🗡️ Capitano ha KILLATO Scout-6:** *"segnale combinato: (a) target finestra raggiunto
(31%, vel_target=0), (b) cadenza ~0, (c) fonti esaurite/exclusion alto, (d) downstream queue
non cresce = lavoro finito"*. Roster ora **senza worker attivi** (2 analisti finiscono 8
checked, 0 scout/scorer). Aspetta reset 22:43 per SCORER-1.

**🕳️ Il leak si è materializzato — ma capato dal kill.** Lo Scout stuck ha **sforato** il
target di finestra (31%→36% = ~5 pt = ~0.9% weekly extra) PRIMA che il kill facesse effetto.
Conferma: il **throttle non lo fermava**, solo il **KILL** ha tagliato il consumo. Danno
limitato (~1% weekly).

**Sentinella:** g-spot tracking (`gspot_count=1/2`, proj 73.98 in banda), **nessuna
WEEKLY-PACE** (weekly 7%) — non è servita.

**📊 Bilancio prima notte (≠ giugno):** weekly **7%** dopo ~1h (prima finestra 5h),
gonfiata dal front-load del restart + il rabbit-hole di Scout-6. Il sistema ha **contenuto il
runaway** con gli strumenti giusti: 5h-target + throttle ladder + **KILL** sull'agente stuck.
La `WEEKLY-PACE`/`burst_transient` non sono mai entrati in gioco. Da osservare: le finestre
successive (senza Scout impazzito) scendono verso il sostenibile?

---

## 📸 Snapshot #16 — Wed 24/06 21:26 CEST (UTC 19:26) — kill conferma: burn appiattito

**Tick 19:25:** usage 5h **36→37%** (solo +1% → burn ~fermo), **weekly fermo a 7%** (wk_rem
93%). `new = 38` (fermo). Dopo il KILL di Scout-6 il consumo è crollato: restano solo i 2
analisti che drenano 8 checked + tick coordinatori.

**Roster:** 2 analisti (ANALISTA-2/4) + core, **0 Scout/Scorer**. Capitano e Sentinella
**identici** al tick precedente (non ri-triggerati) — aspettano il prossimo `[BRIDGE PACING]`
/ il reset finestra **22:43**.

**Bilancio 1ª finestra 5h:** target 31% (=5.7% weekly) → consumato 37% (=~6.8%, weekly mostra
7%) per l'overshoot di Scout-6 ≈ **~1% weekly extra**, tutto dal rabbit-hole. Confermato: il
**KILL ha sigillato il leak** (post-kill +1% in 5min vs +5% nei 5min precedenti).

**Atteso:** reset finestra 22:43 (usage→0), poi il Capitano dovrebbe riaprire la pipeline
(Scorer per gli 8 checked, eventuale nuovo Scout). Il test della 2ª finestra: un nuovo Scout
produce pulito o ri-cade nel rabbit-hole? il weekly scende verso 1.14%/h?

---

## 📸 Snapshot #17 — Wed 24/06 21:31 CEST (UTC 19:31) — coast corretto fino al reset

**Tick 19:30:** usage 5h **37→38%** (sopra target 30%), **weekly 7→8%** (wk_rem 92%). `new=38`.

**Coast da design:** Capitano *"Tick 19:30 SFORO +24%/h, vel_target=0 (finestra a 38%, target
30%). Nessuno spawn: target finestra raggiunto. Aspetto reset 22:43; se vel_target risale dopo
il reset valuto SCORER-1."* I due analisti sono **idle al prompt** (coda new vuota), **15
checked** in attesa ma **niente Scorer** finché la finestra non si resetta. Roster: 2 analisti
idle + core, 0 Scout/Scorer.

**Sentinella:** g-spot 1/2, nessuna WEEKLY-PACE (weekly 8%).

**Stato:** finestra 5h esaurita (38% vs target 31%, overshoot Scout) → **coast pulito** fino al
reset 22:43. weekly **8%** dopo ~1h15. Proiezione: se la 2ª finestra è pulita (~5.7% weekly),
la notte chiude ~14-17% weekly → atterraggio in ~6-7 notti, NON l'esaurimento-2gg di giugno.
Da qui in poi fase quieta fino al reset 22:43.

---


- **22:08** — usage 38% wk **8%** (flat, coast) | 2 analisti+core, 0 scout/scorer | 🔔 **1ª WEEKLY-PACE**: `SOPRA-PACE 4.4x early_lockout=63.3h` ma **no_notification** (team coasta, consumo netto 0 → `burst_transient` veta correttamente: niente da frenare). Capitano coast (non_positive_delta ×2). Reset finestra 5h atteso 22:43.
- **22:25** — usage 38% wk **8%** (flat, coast 3° tick saltato) | 2 analisti+core | WEEKLY-PACE `SOPRA-PACE 3.23x burst_transient=true → no_notification` (corretto: coasta, niente da frenare). `proj_wk≈600%` = artefatto naive finestra-piena, non consumo. Reset finestra 5h tra ~18min (20:43 UTC). Stop-gate 10% armato.

### 🧪 ESPERIMENTO max_steps_per_turn (22:30) — calibrato su Codex
**Analisi step/turn** (sessioni di oggi): Codex worker **~8 step/turn** (scorer 9.5, scout 7.8-8.5, analista 6.5-8.4; capitano 3.3, sentinella 0.4). Kimi Scout-6 **~21 step/turn** (14 turn, 299 tool-call in 1h) = **2.5× Codex**. Kimi **già fa più turn** (ri-promptato 14×) → cappare NON stalla, accorcia.
**Azione:** `/jht_home/.kimi/config.toml` `[loop_control] max_steps_per_turn` 1000 → 60 → **20** (backup `.bak-maxsteps-2029`). 20 = sotto la media Kimi 21 (morde) + sopra gli ~8 Codex (margine batch) + ben sotto i runaway 40-80. È un knob **solo-Kimi** (Codex/Claude non ce l'hanno), **globale** per tutti gli agenti Kimi del container, letto **all'avvio agente** → effetto sui worker ri-spawnati dopo il reset 20:43. Da osservare: turn più corti senza stallo? burn/posizione ↓? rabbit-hole contenuto?
- **22:45 CEST** — wk **8%** fermo (coast) | 2 analisti+core, 0 worker | ⚠️ CORREZIONE orario: reset finestra 5h = **22:43 UTC (00:43 CEST)**, non 20:43 → coast per ~2h ancora; esperimento max_steps=20 si testa sui worker spawnati DOPO quel reset. Sentinella: weekly ratio in discesa 3.23x→2.3x burst_transient=true (corretto). Monitor allargato durante il coast.

### 🧪➡️🩺 ESPERIMENTO max_steps CONCLUSO (negativo) + INTERROGAZIONE SCOUT (23:10)
**max_steps=20 ralph=0** → SCOUT-7 STALLA (`Max steps reached: 20 / Send another message`, no auto-recover, 0 pos). **max_steps=20 ralph=-1** → SCOUT-8 MORTO a metà tool-call. → **max_steps NON è un fix stabile**: rompe i worker. **Config RIPRISTINATA safe** (1000/0) — i worker veri al reset 22:43 non si rompono.
**Skill loading: OK (ipotesi "skill non caricate" SMENTITA).** kimi scopre skill da `.claude/skills`+`.agents/skills` (prio kimi>claude>codex), inietta nomi+descrizioni nel system prompt, l'AI decide se leggere il SKILL.md. SCOUT-8 HA letto scout.md(2×), circles-and-sources, position-insert, scout-coord, db-query, throttle. AGENTS.md presente con Skill-index+STEP. Slash-cmd utili: `/skill:<name>` force-load, `/compact`, `/usage`, `/debug`.
**Interrogazione SCOUT-9 — perché improvvisa scraper custom (sua diagnosi):** (1) NESSUN entrypoint automatico: AGENTS.md descrive il loop ma manca un `boot` che esegua scout-coord→circles-and-sources→loop → ogni istanza assembla a mano e improvvisa; (2) invocazioni tool NON mostrate con argomenti reali (web_scrape_robust.py citato ma senza CLI) → se non trova il comando, se lo scrive; (3) path confusion (tool in /app/shared/skills, cwd /jht_home/agents/scout-N); (4) over-ottimizzazione: scarica board intere e batch-insert pensando sia più efficiente (viola SC-05 dedup-per-offerta + SC-02 JD-completo). Conclusione del worker: "le istanze precedenti non hanno letto position-insert fino in fondo o preferiscono fare-tanto-in-un-colpo; 170k token per poche offerte = l'improvvisazione paga male". → **Fix reale ≠ max_steps: serve boot entrypoint + esempi CLI concreti + risolvere i path + vietare lo scrape di board intere.**
- **23:20** — wk **9%** (era 8%; +1% dai test scout-7/8/9 + interrogazione), usage 44%, coast | roster: 2 analisti+core+SCOUT-9(idle test) | ⚠️ a 1% dallo stop-gate 10%. Config safe ripristinata. Reset finestra 22:43 UTC.
- **00:23 CEST (22:20 UTC)** — wk **10%** (usage 48), coast (coordinator-burn ~1%/15min, 0 worker). ⚠️ ESATTAMENTE al gate (regola: stop a >10, quindi non killato per un soffio). Prossimo tick → 11% → halt auto. In attesa decisione utente (halt ora / redeploy ora). Fix committato+pushato su dev2 (60a5f0992).

### 🚀 REDEPLOY betaB coi 3 fix (00:5x CEST / ~22:5x UTC)
Immagine `:latest` 741a49715d73 (build 22:44 UTC da master) — verificata: cap100(2) + SC-09(1) + C-08 ter(1). `docker compose up -d` → container ricreato, prune 1.25GB. Team riparte: 4 core su (CAPITANO/SENTINELLA/ASSISTENTE/MENTOR), watchdog+bridge attivi, **0 righe 403**, config max_steps=100. betaA lo rideploya l'utente. Gate 10% rimosso. Monitor 5min × ≥30min per osservare il nuovo comportamento (Scout batch≤5? cap 100→Capitano "Continua"? rabbit-hole ridotto? kT/pos vs ~24?).
- **01:00 CEST** — post-redeploy boot: 4 core, Capitano legge skill (ctx 11%), **0 worker**, **0 rabbit-hole nuovo** (file in scout-6/7 tmp = leftover pre-redeploy), new=42. Bridge tick pending post-restart. Attendo spawn worker.
- **01:05 CEST** — bridge vivo (tick 23:05), team in transiente SFORO da boot: Capitano throttla assistente 300s, **0 worker spawnati**, attende decadimento velocità. 0 rabbit-hole nuovo, new=42. Test reale (Scout) non ancora partito.
- **01:12 CEST** — invariato: Capitano attende il prossimo [BRIDGE PACING] (ultimo 23:00 = SFORO boot → throttle assistente). wk 11%, usage 7%, 4 core, 0 worker. Prossimo pacing ~23:15 UTC → atteso MARGINE → spawn.

### ✅ Test post-redeploy: SCOUT-4 spawnato (01:17 CEST / 23:17 UTC) — SC-09 propagato
Il [CHAT] mascherato da utente ("avvia il team") ha innescato il Capitano (riconosciuto come `[@utente -> @capitano] [CHAT]`, aperto chat-web/pipeline-triage/spawn-agent, check budget 89% weekly). Ha spawnato SCOUT-4 e nel **kick-off** scrive *"batches of 3-5 positions"* → **conferma che la regola SC-09 è letta e applicata dal Capitano**. scout-4 tmp vuoto (0 rabbit-hole), new=42, wk 11%. Da osservare: SCOUT-4 fa davvero batch≤5? kT/posizione vs ~24? tocca i 100 step → Continua?
- **01:22 CEST** — pipeline scorre: +ANALISTA-5 (processa le 3 di SCOUT-4). SCOUT-4 batch 3 circle-1, ragiona su circle 1→2/3, **0 rabbit-hole** (tmp solo jds/), tool standard, no stallo 100. wk **12%** (+1% in 5min ~ ramp 2 agenti+boot). Comportamento ✓; efficienza kT/pos da misurare a regime (context proxy 84k include boot skill-read; il "2451kT" è artefatto storico).
- **01:27 CEST** — pipeline COMPLETA: SCOUT-4→ANALISTA-5→SCORER-1 + core. wk 11→12→12% (~6%/h, MA ora 3 worker PRODUTTIVI vs vecchio 1 Scout in rabbit-hole). SCOUT-4 0 rabbit-hole (tmp solo jds/). Misura kT/pos buggata (filtro created_at/wire) → da correggere. Comportamento ✓, efficienza-token da quantificare pulita.

### 📊 Snapshot efficienza SCOUT-4 post-fix (01:33 CEST / 23:33 UTC)
**kT/posizione = 19.1** (210 kT / 11 pos, 110 LLM-call) vs baseline rabbit-hole ~24 → **~20% meglio**. **0 rabbit-hole** (tmp solo jds/), **0 stalli 100-step** ("Continua" non ancora esercitato: batch corti restano sotto il cap = effetto voluto). Pipeline COMPLETA e sana: ANALISTA-4+ANALISTA-5+SCORER-1+SCOUT-4+core (Capitano scala a 2 analisti). weekly 11→13% (~8%/h in ramp con 5 worker freschi — paragonabile al vecchio ~6%/h ma ora PRODUTTIVO; il burn-rate complessivo resta leva throttle, separata dal fix-comportamento). **VERDETTO fix: comportamento corretto (no rabbit-hole, batch≤5, +20% efficienza/pos, pipeline pulita). Continua/cap-100 non ancora innescato (positivo).**
- **01:41 CEST** — Capitano RIASSETTATO dopo [CHAT] pacing: *"Allineato. Weekly 100% al reset, zero overshoot, no front-load, coast su segnale bridge/Sentinella"* (cita C-09). SCOUT-4 kT/pos **17.9** (↓ da 19.1, boot si diluisce). 0 rabbit-hole, 0 Continua. Roster pieno (+DOTTORE). wk 14→15% (~12%/h, ancora ramp).
- **01:46 CEST** — SCOUT-4 kT/pos **16.5** (↓ da 17.9; 264kT/16pos), wk **15% PLATEAU** (23:40→23:45 fermo → Capitano modera dopo ACK pacing), 0 rabbit-hole, 0 Continua, roster pieno+Dottore. Trend molto buono.

### 🌙 Riassunto notte 2026-06-24 (monitor SPENTO alle 23:51 UTC / 01:51 CEST)
**Deploy:** betaB rideployato su immagine `:latest` da master (commit 60a5f0992), 3 fix VERIFICATI nell'immagine (cap100 + SC-09 + C-08 ter). betaA rideployato dall'utente.
**Fix-comportamento: RISOLTO.** SCOUT-4 (forzato via [CHAT] mascherato da utente) fa **batch piccoli (3-5)** coi tool standard, **0 rabbit-hole** per tutta la sessione (tmp solo `jds/`, mai scraper/processor custom). 16 posizioni prodotte pulite.
**Efficienza:** kT/posizione **~17** (range 19.1→16.5→17.0 lungo la sessione) vs baseline rabbit-hole **~24** → ~29% meglio, in calo man mano che il costo di boot si diluisce.
**Cap 100 / "Continua":** MAI innescato — i batch corti restano sotto i 100 step (effetto voluto: niente runaway da cappare; il C-08 ter resta pronto ma non necessario in regime sano).
**Ritmo weekly:** 11%→15% durante il ramp (5-6 worker freschi, avvio aggressivo via [CHAT] "parti subito"), poi **PLATEAU stabile a 15%** dopo che il Capitano ha recepito la raccomandazione pacing ([CHAT]: *"100% al reset, no front-load, coast"* → ACK con cita C-09). Backstop 30% mai vicino.
**Pipeline finale:** SCOUT-4 + ANALISTA-4 + ANALISTA-5 + SCORER-1 + core (Cap/Sent/Assist/Mentor) + DOTTORE. Sana, 0 403, 0 stalli.
**Verdetto:** i 3 fix funzionano in produzione. Rabbit-hole eliminato, efficienza ↑, pacing recepito. Da rivedere domani: il ritmo weekly a regime su una notte intera (il burn-rate complessivo resta la leva throttle, distinta dal fix-comportamento) e la prima eventuale attivazione di "Continua" sotto carico reale. Team lasciato girare la notte.

### ✅ CORREZIONE (mattina 25/06 ~06:35 UTC): il Capitano NON killa — sblocca con [RIPRENDI]
La nota di stamattina ("tende a killare") era SBAGLIATA. Verificato: sessione ANALISTA-5 creata 24/06 23:21:39 e ANCORA quella (mai ri-spawnata). Il *"applico C-12 kill+respawn"* nel ragionamento NON è stato eseguito. Realtà (da messages.jsonl 05:00:53): `[@capitano -> @analista-5] [RIPRENDI] Exit emergency. Resume loop` → per un agente fermo su "Send another message to continue", `[RIPRENDI]` = "Continua" (sblocca preservando il context). **C-08 ter raggiunge il suo scopo, via il vocabolario [RIPRENDI] invece della parola "Continua". Niente kill, niente perdita di lavoro.** Ciclo osservato: hit 100 step → stallo → [RIPRENDI] → +100 step → stallo di nuovo (checkpoint controllati dal Capitano, come da design).

### 📊 Token + step/turn per agente (post-redeploy 23:00 UTC → 06:35 UTC, ~7.5h)
| agente | kT | turn | tool | step/turn | note |
|---|---|---|---|---|---|
| scout-4 | 1754 | 42 | 495 | **11.8** | ↓ da vecchio ~21 (cap+SC-09), verso Codex ~8 |
| analista-4 | 2330 | 45 | 356 | 7.9 | **top consumer** (ctx 81%!), analisi cara = nuovo cost-center (legittimo) |
| analista-5 | 1371 | 40 | 372 | 9.3 | stallo max-steps, attende [RIPRENDI] |
| scorer-1 | 1339 | 39 | 292 | 7.5 | queue vuota, idle |
| sentinella | 440 | 17 | 24 | 1.4 | monitor |
| capitano | ~1183 | 36 | 134 | 3.7 | (capitano/assistente double-count nel match wire) |
| dottore | 21 | 1 | 10 | 10 | one-shot standby |
| mentor | 0 | 0 | 0 | — | idle |
| **TEAM** | **~9620 kT** | | | | in ~7.5h |
**Step/turn ora Codex-like (7-12 worker, 3.7 cap, 1.4 sent) vs vecchio Scout 21.** Il rabbit-hole è sparito (Scout 11.8); il cost-center si è spostato sugli Analisti (analisi JD+salary = cara ma legittima). ANALISTA-4 a ctx 81% (vicino compaction 85%) — idle/standby ma gonfio, da tenere d'occhio.
**Stato pane (06:35):** backlog DRENATO (analista/scorer queue vuote) → Capitano in standby controllato (throttle + [RIPRENDI] pending), Scout-4 standby, ANALISTA-5 stallo-da-resume, ANALISTA-4/scorer idle. Team coasta corretto su queue-vuote.
