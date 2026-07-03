# 🎚️ Scaling graduale del Capitano + consumo spalmato sulla giornata (design 2026-06-26)

**Movente (osservato dal vivo su betaB/Kimi, 2026-06-26):** quando il team va ON, il
Capitano ordina `ACCELERARE` "in 6ª marcia" → lo Scout azzera il throttle e va in
frenesia (106 tool call in 25 min, ~308 kT, 3 sole posizioni). Kimi **front-loada**:
finisce il budget la mattina, e la sera l'utente non può chattare col team perché il
budget è esaurito. Vedi `2026-06-26-sentinella-capitano-relationship-live.md` (forensics
scout-6) e `2026-06-25-pacing-future-ideas.md` (even-spread + riserva, ora promossi).

Tre interventi coerenti, tutti verso **"non bruciare di mattina, spalmare sulla giornata".**

---

## 1. 🛑 Throttle floor 5 min sui WORKER (mai 0)

**Oggi:** il default del throttle è `0` (fast path) → un worker può fare batch su batch
senza pausa = **l'abilitatore del marathon**.

**Cambio:** i **worker** (Scout/Analista/Scorer/Scrittore/Critico) hanno **floor 5 min,
sempre** — `get_agent()` ritorna `max(300, …)` per i worker. Niente più `0` per loro:
ogni azione è seguita da almeno una pausa-checkpoint di 5 min → spalma da solo e dà al
Capitano un punto di controllo tra un'unità e l'altra.

**⚠️ Eccezione decisa (2026-06-26):** il **core interattivo** (Assistente, Capitano,
Sentinella, Mentor) **NON** ha il floor — deve restare reattivo, altrimenti la **chat
serale dell'utente risponderebbe con 5 min di ritardo** (l'opposto del punto 3). Il floor
è solo per i worker che macinano budget in loop.

**Dove:** `shared/skills/throttle-config.py` — `WORKER_FLOOR=300`, `_is_worker()`,
applicato in `get_agent()`. Il floor vale a **lettura** (effettivo), quindi tiene anche se
il config dice 0.

---

## 2. 📈 Capitano: calibrazione graduale invece di "6ª marcia"

**Oggi:** il Capitano ragiona *"team ON, tanto budget → accelera!"* e spawna/accelera di
colpo. Sbagliato: non sa ancora **quanto consuma davvero** un worker in questo ciclo.

**Cambio — controllore a calibrazione (nuovo flusso allo start di ogni finestra di lavoro):**
1. **Parti con 1 solo Scout** a throttle minimo (5 min).
2. **Osserva ~30 min** per misurare il burn reale (1 scout @ 5min → X% in 30 min).
3. **Calcola** (skill `scaling-calc`): dato il burn-per-worker misurato e la velocità-target
   sostenibile (dal bridge: `sustainable_burn`, `weekly_remaining`, ore attive) →
   **quanti** worker e con **quale** throttle servono per centrare il target.
4. **Spawna a SCAGLIONI**, non in blocco: se il calcolo dice "+2 scout a 10 min" → metti
   **uno, aspetti ~10 min, poi l'altro**, ri-misurando. Si sale di marcia per gradini.

**Razionale:** è system-identification + controllo. Niente burst: la velocità cresce
misurata, e se un worker consuma più/meno del previsto il calcolo si auto-corregge al
prossimo scaglione.

**Semantica `ACCELERARE` (fix collegato):** "accelera" **non** vuol dire "togli ogni freno
e spara 100 chiamate". Vuol dire "sali di un gradino di throttle/roster", **sempre 1 unità
per turno + yield** (vedi disciplina-turno Scout, fix separato).

**Dove:** `agents/capitano/capitano.md` (riscrittura della logica di scale-up, C-02/C-07)
+ nuova skill `agents/capitano/_skills/scaling-calc/` (il calcolo roster+throttle→target).

---

## 3. 🌅 Distribuire sulla giornata + riserva serale

**Oggi:** Kimi tende a **finire il lavoro la mattina** (non lavora peggio, ma front-loada).
Risultato: la sera l'utente non ha budget per chattare col team.

**Cambio:**
- **Target di consumo spalmato sull'intera finestra di lavoro** (non riempire la mattina) —
  costruito sopra il #2 (il ramp graduale + il floor 5min già spingono qui) e sul daily
  even-spread (CAP→TARGET) di `2026-06-25-pacing-future-ideas.md`.
- **Riserva `R%`** del budget giornaliero **tenuta da parte di giorno**. Nelle **ultime ~2h**
  della finestra: o l'utente la usa (chat col team), **oppure** si **brucia** sul lavoro
  (burn-mode reclaim) → niente budget sprecato, si atterra ~100% al reset.

**Dove:** logica daily nel `sentinel-bridge.py` (`_daily_pacing_via_skill`): scorporare una
riserva `R` dal budget di giorno e rilasciarla/bruciarla nelle ultime ~2h; enfasi nel
prompt Capitano/Sentinella sullo spalmare. (Il floor 5min + il ramp graduale fanno già
metà del lavoro; la riserva esplicita è il pezzo in più.)

---

## Ordine di implementazione
1. **Throttle floor 5 min sui worker** — quick win, taglia subito il marathon. ← parto da qui
2. **Capitano calibrazione-graduale + skill `scaling-calc`** — il pezzo grosso.
3. **Day-spread + riserva serale** — sopra il #2.

Tutto su dev2, gated rebuild+redeploy. i18n prompt (×6 lingue) = follow-up.
