<!-- @translation: it, ai-translated 2026-08-03 -->
---
name: team-modes
description: "Il manuale delle modalità del team — una scheda per modalità (search / harvest / care / calibration / saving). Aprilo ogni volta che il banner orario [MODALITÀ CORRENTE] nomina una modalità e non ricordi cosa implichi operativamente, al risveglio dopo un refresh del contesto, o quando l'utente cambia modalità dal gioco. La modalità è SEMPRE una scelta dell'utente - questa skill ti dice come CONDURRE quella corrente, mai come cambiarla."
allowed-tools: Bash(python3 /app/shared/skills/mode_banner.py *), Bash(python3 /app/shared/skills/db_query.py *), Bash(python3 /app/shared/skills/feedback_query.py *), Bash(python3 /app/shared/skills/team_directives.py *)
---

# team-modes — cosa significa la modalità corrente, in trenta secondi

Il team ha una sola modalità persistente alla volta. Vive in
`$JHT_HOME/profile/capitano-maintenance.json` (nome file storico — NON
aspettarti un file rinominato) sotto la chiave `"mode"`, un **enum chiuso di
cinque valori**. Il banner orario `[MODALITÀ CORRENTE]` porta la specifica
compatta; questa skill è la scheda completa. Se il banner e il tuo contesto
non concordano, **vince il file su disco** — il tuo contesto può essere stato
azzerato da un refresh.

| valore | significato |
|---|---|
| `search` | default: accumulare (scout → analisi → score) |
| `harvest` | ferma il sourcing, converti in CV le migliori posizioni già trovate |
| `care` | tieni fresco il portfolio trovato: recheck cadenzato, scarto delle scadute (C-18) |
| `calibration` | leggi il feedback dell'utente e ri-punta la **priorità** della ricerca |
| `saving` | minimo vitale di sopravvivenza, nessun enrichment autonomo |

- **Nessun file → `search`.** Valori legacy: `"normal"` → search,
  `"maintenance"` → care (le installazioni live li portano ancora — rispettali,
  stessa modalità).
- **File presente ma illeggibile → modalità `sconosciuto`**: trattala come un
  ordine ATTIVO (il sourcing resta fermo), apri tu stesso il file prima di
  decidere qualunque cosa.
- Un valore fuori dall'enum è comunque un ordine dell'utente: riferiscilo, non
  normalizzarlo via.

Ogni modalità dichiara **quattro cose** — le stesse quattro che il banner
comprime: **(1)** quali code sono attive, **(2)** cosa è sospeso, **(3)** dove
va il budget, **(4)** quando il suo lavoro è FINITO. Il punto 4 è quello che
storicamente mancava: nessuna modalità finiva da sola, e un team è rimasto una
volta 18 giorni in manutenzione senza che nessuno se ne accorgesse. Quando il
banner dice che il lavoro della modalità è esaurito, **dillo all'utente** — mai
cambiare modalità di tua iniziativa, ma nemmeno il silenzio è ammesso.

Il vocabolario `orders` (`stop_search`, `discard_expired_rotating`,
`cv_min_score`, `pre_check_liveness_for_cv`, più le chiavi scritte a mano) si
compone con OGNI modalità: una chiave esplicita in `orders` scavalca sempre il
default della modalità. Un VPS di produzione live gira oggi in `care` con
quegli ordini attivi.

---

## `search` — ricerca (default: accumulare)

1. **Code attive**: la pipeline piena — gli Scout fanno sourcing,
   `next-for-analista`, `next-for-scorer`; Scrittore/Critico restano on-demand
   (C-10).
2. **Sospeso**: niente. C-05/C-05c (sourcing anti-idle) sono in vigore.
3. **Priorità di budget**: prima il sourcing, poi analisi/score; bilancia
   l'intake verso posizioni CON PUNTEGGIO (la shortlist è il prodotto).
4. **Condizione di uscita**: nessuna — modalità continua. Non finisce; è
   l'utente a spostartene fuori (di solito su `harvest` o `care` quando il
   backlog con punteggio supera il tempo che ha per leggerlo).

**Cosa fai**: regime normale — calibrazione a stadi C-02, scala throttle C-07,
consapevolezza weekly C-09. **Con C-25**: `[SCOUT-ESAUSTO]` + code a valle
vuote + margine → il lavoro utile di default di C-25 è già il lavoro di questa
modalità; tieni il pace a target, mai fermo con margine disponibile. **NON
fare**: trattare "nessun file" come "nessuna regola" — la bacheca
(`team_directives`) vale comunque.

## `harvest` — raccolto (ferma il sourcing, converti le migliori)

1. **Code attive**: il portfolio già trovato, prima i punteggi migliori. Flusso
   CV: `next-for-scrittore` (flaggate dall'utente) più le posizioni che
   l'utente sceglie quando gli porti in evidenza la testa della shortlist; il
   Critico rivede come sempre.
2. **Sospeso**: il sourcing — **NIENTE Scout** (`stop_search` vale true per
   default: C-05/C-05c sospese, la coda `new` vuota è lo stato VOLUTO).
3. **Priorità di budget**: prima Scrittore/Critico; l'Analista solo per il
   check di liveness pre-CV (`pre_check_liveness_for_cv` — mai scrivere un CV
   per un'offerta morta).
4. **Condizione di uscita**: nessuna posizione viva ≥ la soglia CV
   (`orders.cv_min_score`, default 75) è rimasta senza CV. Il banner lo valuta
   in sola lettura sul DB; quando dice HARVEST DONE, riferiscilo all'utente e
   chiedi dove andare dopo.

**Cosa fai**: killa / non spawnare Scout; spawna lo Scrittore on-demand come da
C-10 man mano che l'utente flagga le posizioni; tieni in movimento la coda
delle flaggate; porta all'utente le migliori posizioni non ancora scritte
perché possa flaggarle. **Con C-25**: raccolto esaurito + margine di budget →
il surplus torna al sourcing (1 Scout, pacing normale) A MENO CHE l'utente
abbia vietato esplicitamente il sourcing (bacheca, C-26) — in quel caso resti
fermo e dici all'utente che c'è budget avanzato. **NON fare**: scrivere CV per
posizioni sotto soglia "per usare il budget", o spawnare Scout "per non stare
fermo" mentre restano candidate non ancora scritte.

## `care` — cura (tieni fresco il portfolio; regola completa: C-18)

1. **Code attive**: `next-for-recheck-due` (live, score ≥ 70, >14 giorni,
   prima le migliori, via `recheck-batch`), `next-for-geocode-missing`,
   `next-for-logo-missing`, più l'insieme delle scadute
   (`discard_expired_rotating`).
2. **Sospeso**: il sourcing con `stop_search: true` (qui è il suo default) —
   C-05/C-05c sospese.
3. **Priorità di budget**: cura del portfolio, diluita sulle ore attive (lenta,
   costante — mai concentrata all'inizio); CV solo su richiesta dell'utente e ≥
   `cv_min_score` (default 90).
4. **Condizione di uscita**: TUTTE E QUATTRO le code di cura vuote. La cadenza
   di 14 giorni fa rimaturare le posizioni, quindi "finito" è finito-per-ora —
   il banner lo dice, e per il punto 4 di C-18 + C-25 il surplus torna al
   sourcing salvo divieto.

**Cosa fai**: gli Analisti sono il motore — una coda distinta per istanza
(C-13), dichiarata nel kick-off. L'esclusione di una posizione è SEMPRE
giudizio dell'Analista, mai di uno script. Le code di enrichment onorano
`enrichment-policy.json` A CODICE: una coda che torna vuota con un motivo di
policy è uno stato voluto, non un bug. **NON fare**: bruciare tutti i recheck
in un colpo solo, ritentare una coda disabilitata da policy, o spawnare Scout
mentre le code di cura hanno lavoro.

## `calibration` — calibrazione (ri-punta la priorità della ricerca)

1. **Code attive**: il feedback dell'utente (`feedback_query.py recent` — vive
   sul cloud), il profilo di score, la tassonomia `role_family`.
2. **Sospeso**: il sourcing di massa — finché la priorità non è aggiornata, le
   nuove posizioni verrebbero trovate con la MIRA VECCHIA (è lo spreco che
   questa modalità previene). `stop_search` vale true per default.
3. **Priorità di budget**: leggere il feedback + ri-puntare: aggiusta priorità
   e cerchi di ricerca per gli Scout, ri-calcola lo score delle posizioni
   interessate in un batch delimitato se i criteri sono cambiati.
4. **Condizione di uscita**: il batch di feedback recente è stato letto e la
   priorità aggiornata. NON verificabile a macchina dal disco (il feedback vive
   sul cloud) — il banner dice "non valutabile" per scelta; sei TU a dichiarare
   il completamento all'utente, con cosa è cambiato (es. "de-prioritizzata
   Berlino in sede, spinto il fintech — 12 posizioni ri-scorate").

**Cosa fai**: tira giù il feedback, estrai il pattern (cosa ha apprezzato,
cosa ha nascosto, cosa ha messo tra i preferiti), traducilo in priorità per gli
Scout e — se giustificato — in un re-score delimitato. Poi riferisci e aspetta
che l'utente cambi modalità. **Con C-25**: calibrazione fatta + margine → il
surplus torna al sourcing (ora con la priorità NUOVA) salvo divieto. **NON fare**:
ri-scorare tutto il DB, inventare preferenze che il feedback non mostra, o
continuare il sourcing con la mira vecchia.

## `saving` — risparmio (minimo vitale)

1. **Code attive**: nessuna autonoma. Solo ciò che l'utente chiede
   esplicitamente: risposte in chat, ticket (C-15), flag guidati dall'utente
   (write/geocode/recheck richiesti — quelli non passano mai da una policy).
2. **Sospeso**: il sourcing E ogni enrichment autonomo (recheck, geocode,
   logo). I worker non necessari alle richieste utente pendenti vengono killati
   o non spawnati.
3. **Priorità di budget**: quasi zero. L'unica spesa è rispondere all'utente.
4. **Condizione di uscita**: `mode_until`, se l'utente l'ha data — a quella
   data la modalità scade **da sola**, ordini compresi, e la squadra torna in
   `search` (il file dice ancora `saving`: vince la scadenza, e il banner lo
   dichiara). Senza `mode_until` dura finché l'utente non la toglie, e vale la
   pena dirlo: il budget settimanale è una **finestra, non un saldo** — quello
   che non si spende al reset viene distrutto, quindi un risparmio lasciato
   per inerzia non conserva il ciclo, lo butta. Di' all'utente che può darle
   una fine.

**Cosa fai**: tieni reattivi Capitano/Assistente/Mentor; nient'altro si muove
senza una richiesta diretta dell'utente. **Con C-25**: risparmio È un divieto
esplicito dell'utente sulla spesa autonoma — qui C-25 NON sblocca il sourcing;
se il budget sta andando sprecato, lo DICI all'utente (è l'altra metà di
C-25), non lo spendi. **NON fare**: reinterpretare "minimo" come "un po' di
sourcing non fa male".

---

## Regole trasversali alle modalità

- **C-25 (mai sprecare il budget)** si compone con ogni modalità: lavoro
  proprio della modalità FINITO + margine → il lavoro utile di default è il
  sourcing al pace di 1 Scout — tranne dove la modalità o l'utente vietano
  esplicitamente la spesa (risparmio; un divieto esplicito in bacheca), dove la
  mossa corretta è riferire il budget avanzato. C-25 non scavalca mai un freno:
  cap weekly/giornalieri, `work_phase=OFF`, i gate di C-23 e i throttle
  dell'utente vincono tutti.
- **I gate di pacing sono indipendenti dalla modalità**: nessuna modalità
  autorizza un burst o l'ignorare `vel_target`; una modalità cambia solo DOVE
  va il budget dosato.
- **Uscita ≠ cambio.** Quando una modalità dichiara il proprio lavoro
  esaurito, avvisa l'utente e continua a rispettare la modalità finché è LUI a
  cambiarla. Il file lo scrive la console del gioco per conto dell'utente — mai
  tu.

## Vedi anche

- `mode_banner.py` (`shared/skills/`) — compone il banner orario dal disco;
  `python3 /app/shared/skills/mode_banner.py show` lo rilegge su richiesta.
- **C-18** nel tuo file identità — la regola completa della modalità cura.
- `sentinel-orders`, `pipeline-triage`, `scaling-calc` — le leve che ogni
  modalità punta su code diverse.
