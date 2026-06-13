# 📡 Design-doc — Ridisegno monitoraggio usage (Sentinella ↔ Capitano)

> **Stato:** DRAFT (visione utente 2026-06-13). Il "cuore del team": senza questo, il pacing non funziona.
> **Collaborazione:** dev2 + dev3 (codice bridge/prompt), dev1 (design driver weekly). Branch dev-N, merge in master = solo utente.
> Nasce dall'indagine "perché Capitano/Sentinella non si accorgono del burn weekly" → la fix non è solo tecnica, è una **ridivisione di ruolo**.

## 🎯 Visione utente (la divisione corretta)
**La metrica che conta = la VELOCITÀ** (non il livello). Serve una **velocità media costante** lungo una **trend-line** (dal 1° giorno della settimana → reset; e dalla 1ª ora del giorno → ultima). Gli **sbalzi sono inevitabili** (alcuni agenti hanno turni lunghi non spezzettabili in checkpoint → spendono tanto in una volta); il throttle appiattisce *parte* degli sbalzi, non tutti. **Non si reagisce all'istante, si reagisce alla trend-line.**

### 🛰️ SENTINELLA = il cervello analitico (oggi non fa nulla di utile → darle lavoro vero)
- È l'**LLM** che riceve dati **grezzi** da script automatiche **non intelligenti** (bridge ~5 min, monitor ~15 min) e li **elabora**: media velocità/ora, proiezioni, pattern.
- Le script le forniscono una **TABELLA TEMPORALE**: consumo **per-agente ogni ~5 min nelle ultime ~2h** → la Sentinella vede i *pattern* (chi brucia, chi è in pausa, sbalzi vs trend).
- **NON bipolare**: non lancia allarme se qualcuno sta lavorando ma c'è margine e la trend-line regge (un picco isolato ≠ problema). Distingue sbalzo-inevitabile da deriva reale.
- **Decide se/quando** notificare il Capitano — **non** ogni 5 min. Filtra il rumore.

### 👨‍✈️ CAPITANO = il decisore (NON fa i calcoli)
- **Non** riceve i tick grezzi né calcola: riceve dalla **Sentinella** messaggi pronti = **consigli + dati analitici** (non decisionali).
- **Interpreta** i dati e **decide le azioni** (throttle, kill, hold-spawn). L'interpretazione e l'azione restano sempre sue.

## 📊 Analisi VPS Andras — come hanno lavorato (storico, read-only 2026-06-13)
**Hanno lavorato BENE** (conferma l'impressione dell'utente):
```
positions/giorno:  03/06 ▓▓▓ 25 · 04/06 ▓▓▓▓▓ 55 · 05/06 ▓▓▓▓▓ 51 · 06/06 ▓▓▓ 30 · 07/06 ▓▓▓▓ 36
                   [08-10/06 ZERO = lockout overspawn] · 11/06 17 · 12/06 5 + restart serale
distribuzione oraria: lavoro distribuito ~OGNI ORA dalle 06 alle 17 (9-27/ora) = ritmo costante, non a raffica
```
**Prova che l'overspawn era inutile:** scout-1=**138** pos, scout-2=54, scout-3=18, **scout-4/5/6 = 3 pos CIASCUNO**. Gli agenti extra dell'incidente hanno prodotto ~nulla → più agenti ≠ più output (giustifica C-12/COAST). Cavalli da tiro: scout-1, scorer-1 (115)/scorer-2 (75).
**Modello pre-incidente = valido**: ritmo costante 4 giorni + pause lunghe; l'unico difetto è stato l'overspawn non-fermabile (→ risolto dai Dottori ridisegnati).

## 📉 Smoking gun — lo status MENTE sul weekly (dev3, sentinel-data 3003 sample 03-13/06)
La prova a-terra di *perché* Capitano/Sentinella non si accorgono del burn weekly:

**Trend weekly/giorno** (consistente ma sopra-pace):
```
03/06 3→19 · 04/06 →31 · 05/06 31→59 · 06/06 59→79 · 07/06 79→100 ⛔ lockout (giorno 5)
```
Ritmo ~**20%/giorno** (trend-line pulita, costante — ciò che ha impressionato l'utente) ma sostenibile su 7gg ≈ **14%/giorno** → ~**1,4× troppo** → tocca 100% al **giorno 5**, non al 7.

**Il paradosso (distribuzione status storica):**
```
SOTTOUTILIZZO  2688  (89%)   ← "hai margine, lavora"
ATTENZIONE      252  ( 8%)
STEADY           51  ( 2%)
```
**Per l'89% del tempo lo status diceva SOTTOUTILIZZO mentre il weekly saliva fino a 100% e andava in lockout.** Lo status guarda la **finestra 5h** (che aveva margine); il **weekly-rate non è mai un driver**. → conferma definitiva del buco-metrica: `sustainable_burn` è calcolato ma resta **INFO**, non guida il verdetto (che usa `vel_team vs vel_target` sulla 5h).

## 🛰️ Sentinella-analista — dettaglio operativo (dev3)
Cosa deve **calcolare** (dai dati grezzi + tabella temporale per-agente) ed **emettere** al Capitano:
- **Trend-line weekly**: `vel_weekly` reale (media sulla storia weekly, robusta agli sbalzi) vs `sustainable_burn` → "a ritmo X esaurisci ~giorno N (M prima del reset)".
- **Cadenza intelligente, NON bipolare**: notifica il Capitano SOLO su cambio di regime (trend devia dal sostenibile per ≥K tick), non a ogni picco. Un turno-lungo isolato (sbalzo inevitabile) ≠ allarme: lo assorbe la media.
- **Consiglio ANALITICO, non decisionale**: es. *"weekly 1,4× sopra-pace da 30min, top-consumer dottore(35%, 0 check) + scout improduttivo → suggerisco: kill/throttle dottore, hold spawn. Tu decidi."* Il Capitano interpreta e agisce.

## 🛠️ Fix tecniche (dall'indagine weekly-blindness — già progettate)
1. **driver weekly** (dev1 design): `vel_weekly = Δweekly/Δt` vs `sustainable = weekly_remaining/weekly_active_hours`, esposto nei tick come *"bruci X%/h vs sost Y%/h (Zx, esaurisci ~N gg)"* → diventa DRIVER, non INFO.
2. **tick Sentinella** (dev2): portare vel + tabella-temporale-per-agente nel messaggio alla Sentinella (oggi porta solo livelli).
3. **verdetto Capitano** (dev3): scala con lo sforo (no +10s fisso) + Dottore nel radar consumatori.

## 📌 TO-DO (annotato, NON ora — priorità utente = osservare Dottori + monitoraggio usage)
- **Prompt di sistema iniettati al Capitano ogni tot** (reminder ricorrenti), es.:
  - "Hai verificato le posizioni scadute a inizio turno?"
  - "Stai mantenendo la direzione/richieste dell'utente?"
- **Note di viaggio del Capitano** (libro di bordo): file append-only dove annota cosa succede; a fine serata scrive una **bozza di com'è andata**; nei giorni futuri **le rilegge** (+ prompt-system che glielo impone).
  - **Motivo (caso reale):** l'utente aveva ordinato "NO spawn Scrittori di default" (writer-on-demand); tenuto 2 giorni; poi il Capitano è stato **riavviato → ha dimenticato il comando → ha ripreso a spawnare Scrittori**. Con note-di-viaggio + prompt "rileggile", non sarebbe successo. (Lega con [[project_writer_on_demand_arch]].)
- **Messaggi di sistema differenziati** monitor (15 min) vs bridge (5 min) verso il Capitano.

## 🔭 Priorità immediata (utente)
1. **Osservare** l'implementazione **Dottori** (dev1, in corso) e il **monitoraggio usage** — le 2 cose più importanti.
2. Poi rifinire la divisione Capitano/Sentinella su questi dati.
