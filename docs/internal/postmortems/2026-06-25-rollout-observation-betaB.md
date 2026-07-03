# 🔭 Osservazione rollout betaB/Kimi — push→pull + daily guardrail (2026-06-25 sera)

**Data:** 2026-06-25, shift notturno (19:30 Roma start) · **VPS:** betaB/Kimi (203.0.113.20)
**Cosa è stato deployato stasera:** bridge→Sentinella (push→pull), daily guardrail (C-19/S-09),
+ i fix di stamattina (max_steps=100, Continua, batch≤5). Immagine verificata pre-`up -d`;
pacing-bridge target=SENTINELLA via hotfix (codice committato `5ee54f910` per il rebuild).
**Modalità:** osservazione (no intervento).

> ⚠️ **NOTA 2026-07-02 (correzione):** più giù l'inciso "capitano … (ancora top-consumer)" riflette la vecchia tesi coordinator-burn, ridimensionata dalla misura pulita full-history: su Kimi il Capitano pesa ~13,6% (≈ Codex), non è il consumatore dominante; l'alta quota coordinatori di quella notte è coast/idle. Living doc: [`architecture/kimi-vs-codex-economics.md`](../architecture/kimi-vs-codex-economics.md). *(Resta valida l'attribuzione del burn allo scout-5 rabbit-hole.)*

## ✅ Cosa funziona (confermato dal vivo)

1. **push→pull**: ogni `[BRIDGE PACING]` va a `to=sentinella` (mai più al Capitano). Confermato
   su tutti i tick del monitor 19:08→20:28.
2. **daily guardrail LIVE**: riga `daily: oggi=Y% budget=X% cap=Z%` nel `[BRIDGE TICK]` alla
   Sentinella, traccia correttamente (oggi 8→11%, budget ~11%, cap ~16%). Calcolato dal bridge.
3. Nessun crash/halt; immagine col fix verificata prima di `up -d`.

## 🔴 BUG CRITICO: il Capitano scavalca gli ordini espliciti della Sentinella

Il Capitano è rimasto nel mindset **"agisco sul `[BRIDGE PACING]` ogni 15 min"**. Col push→pull
quel tick **non gli arriva più** (va alla Sentinella), ma il Capitano continua a **rimandare le
decisioni** a *"il prossimo pacing tick"* — che non arriverà mai a lui. Risultato: **non obbedisce
agli ordini espliciti della Sentinella.**

Timeline ordini Sentinella → reazione Capitano (stasera):
```
19:45  Sentinella: SCALA UP / pipeline vuota          → Capitano TIENE (ancorato a SFORO stale)
20:45  Sentinella: SCALA UP (2° stallo consecutivo)   → Capitano alla fine spawna SCOUT-5
21:15  Sentinella: KILL+respawn scout-5 (stuck 16%/h) → Capitano: "lascio scout-5, il prossimo
                                                          pacing tick dirà se va killato" → NON killa
21:30  Sentinella: [URG] VITALS CPU 100% + scout-5 stuck
```
Frasi-chiave dalla pane del Capitano:
- *"That order is now stale relative to bridge SFORO… We should not spawn."* (scavalca SCALA-UP)
- *"il prossimo pacing tick dirà se va killato per C-12. Nessun intervento ora."* (scavalca KILL)
- *"Aspetto il prossimo pacing tick."* (che non arriva più a lui)

**Diagnosi:** prima del push→pull il `[BRIDGE PACING]` ogni 15 min era il **battito** che
ri-triggerava il Capitano a rivalutare. Toltolo, il Capitano resta incagliato sulla decisione
stale e **defer-a-un-tick-che-non-viene** invece di agire sugli ordini Sentinella. Non è la
Sentinella muta (lei ha escalato): è il **Capitano troppo dipendente dal pacing tick periodico**.

### Conseguenza misurata
SCOUT-5 in **rabbit-hole** (Kimi Scout classico) brucia veloce → **CPU container 100% (rischio
OOM)**, front-load **+17% del weekly stanotte** (3.89%/h = **4.7× l'ideale 0.82%/h**), e il
Capitano non lo killa nonostante l'ordine. Il rabbit-hole brucia incontrollato.

## 🟡 Bug Sentinella: definizione di "CALMO" (chiarita dall'utente)

"Tutto calmo" **NON** significa "tutti fermi / nessuno consuma". Significa: team alla **velocità
ideale ± banda**. Es. ideale 7%/h → calmo = 5-9%/h; **sotto ~5%/h o sopra ~10%/h = NON calmo**.
Quindi **idle/0-consumo = SOTTO soglia = NON calmo → deve notificare il Capitano** (under-pace).
Stasera la Sentinella ha comunque escalato (SCALA UP ×2), ma a un tick (20:30) ha detto "nessun
ordine" su consumo 0 → comportamento **incoerente**, da rendere esplicito nel prompt (`S-04`/`S-07`):
banda di calma = `vel_team ∈ [ideale−Δ, ideale+Δ]`; fuori banda (incluso under) = notifica.

## 📊 Quadro budget betaB (21:50 UTC)
```
weekly USATO 43% (rimane 57%)   reset 01/07 → 5.8 giorni
SOSTENIBILE 0.82%/h attivo   →   budget di OGGI ≈ 9.8%
STANOTTE (da 19:30 Roma): 26% → 43% = +17% in 4.4h = 3.89%/h = 4.7× ideale  (FRONT-LOAD)
oggi (17%) > cap giornaliero (~15%) → daily guardrail in soglia di sforo
```
Token stanotte (1881 kT): analista-2 556 kT **36.6 tool/turno** (⚠ altissimo vs Codex ~8),
capitano 469 kT (ancora top-consumer), sentinella 307, assistente 252, scorer-4 185, mentor 112.
→ candidato tuning: abbassare i **giri (max_steps)** di Kimi verso il livello Codex (~8 tool/turno).

## 🔧 Soluzione concordata (FUTURO): heartbeat-bridge al Capitano

Il Capitano è troppo dipendente dalla Sentinella e si incaglia. Dargli un **bridge dedicato**
(come la Sentinella ne ha uno) che **lo risveglia 1×/ora** (allo scoccare dell'ora):
- NON è il pacing (quello resta alla Sentinella). È un **nudge** per farlo ragionare/rivalutare.
- Per ora anche un semplice testo ("come procede / controlla il team / procedi") basta a sbloccarlo.
- Da evolvere in **script statico INTELLIGENTE**: varia il messaggio sui **dati del DB** — un'ora
  "controlla le code", un'ora "verifica i top-consumer", un'ora niente, un'ora un altro tema. Non
  LLM (come la Sentinella), ma uno strumento deterministico che tiene il Capitano **attivo** e lo
  fa ragionare come vogliamo, senza renderlo totalmente autonomo.
- Possibile aggancio: l'**Assistente** (rappresenta l'utente) gli pone domande che farebbe
  l'utente ("perché non stai sourcing?", "le code sono piene?") → aiuta il Capitano ad aggiustarsi
  perché magari non se le pone, troppo preso a coordinare.

## ✅ STATO 2026-06-26 — tutte implementate (su dev2, gated rebuild+redeploy)

1. **Gerarchia Capitano↔Sentinella ribaltata** (`8971ffb34`) — era la causa-radice del bug critico.
   C-01: la Sentinella **consiglia**, il Capitano **interpreta+verifica+decide** (era "absolute
   priority without re-checking"). C-02: tolto *"wait for next [BRIDGE TICK] → next order"* (la
   radice del "aspetto il pacing tick"). La Sentinella è **al suo servizio**, non viceversa.
2. **Sentinella "calmo"** (`e289972a8`) — calmo = `vel ∈ [0.7×ideal, 1.3×ideal]`; idle/0-consumo =
   sotto-banda = NON calmo → avvisa. Trigger 8 senza più il gate `proj<70%`.
3. **Kimi rounds → analista turn-discipline** (`8f8dc2dd6`) — `max_steps` a livello Codex STALLA
   (provato), cap resta 100; l'analista lavora **UNA posizione per turno** (~9 tool/turno come
   Codex, era 36 = ~4 posizioni incatenate).
4. **Heartbeat-bridge** (`3bab28fb5`) — `capitano-bridge.py`: battito 1×/ora, nudge deterministico
   sui dati DB (pipeline-ferma / worker-caldo / backlog / rotazione+silenzio), C-20. Anti-incaglio.
   Inoltre `5ee54f910` (launcher: pacing→SENTINELLA di default).

### Correzioni alle ipotesi di questo doc
- **"Bug daily su Codex" = NON è un bug.** La funzione `_daily_pacing_via_skill` gira sui dati
  Codex (verificato: `budget = 81/(72/12) = 13.5%`). Il `daily: ASSENTE` su betaA era perché il
  **redeploy (18:52 UTC) è caduto FUORI dall'orario di lavoro** (06-18 UTC) → 0 tick → il codice
  nuovo non ha mai girato; gli ultimi tick nel log erano pre-redeploy. Comparirà alla riapertura.
  **Lezione: rideployare DURANTE l'orario di lavoro del team.**
- **betaA aveva GIÀ il nuovo image** (stesso digest di betaB, build 18:45) — la prima lettura
  "vecchia immagine" era sbagliata (guardavo il target del processo, forzato a CAPITANO dal
  launcher pre-fix, non il codice).

### Backlog (futuro)
- daily even-spread (CAP→TARGET) + riserva utente — vedi `2026-06-25-pacing-future-ideas.md`.
- i18n delle modifiche prompt (capitano/sentinella/analista) nelle 6 lingue.
