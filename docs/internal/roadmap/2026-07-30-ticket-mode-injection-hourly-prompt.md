# TICKET — La modalità operativa va iniettata nel messaggio periodico del Capitano

**Stato**: implementato 2026-07-30 · **Tag**: `[MODE-INJECTION-HOURLY-PROMPT]` ·
**Decisione utente**: 2026-07-30 ·
**Correlato**: C-18, `[DOCTOR-UNBLOCK-AND-TTL]`

> **Implementazione**: `shared/skills/mode_banner.py` compone la sezione leggendo
> da disco a ogni chiamata; `.launcher/heartbeat-bridge.py` la accoda a ogni
> messaggio (e con `stop_search` sul disco smette di ordinare lo spawn Scout di
> C-05, che la contraddirebbe nello stesso messaggio); la skill
> `session-refresh` la accoda al `[RESUME]` del Capitano in tutte e 7 le lingue.
> 29 test in `tests/test_mode_injection.py`.
>
> **Due scelte diverse dal ticket**, entrambe deliberate:
> 1. **L'ora di silenzio della rotazione salta** quando c'è un ordine in vigore.
>    Il ticket prometteva «al peggio si perde per un'ora», ma la rotazione tace
>    un'ora su tre: senza questo, il buco reale era di due ore. Costo: al massimo
>    un messaggio in più ogni tre ore, e solo a modalità non-normale.
> 2. **La bacheca non viene popolata automaticamente** quando l'utente imposta
>    una modalità. Il bridge la LEGGE (ed è il punto), ma scriverci in automatico
>    l'ordine già presente in `capitano-maintenance.json` renderebbe la sezione
>    ridondante — lo stesso ordine due volte in ogni messaggio orario — e
>    creerebbe una seconda fonte di verità sulla stessa cosa, con la domanda
>    aperta di chi la archivia. La sezione dichiara `DIRETTIVE ATTIVE: nessuna`
>    a ogni battito, che è il promemoria di popolarla a mano.

---

## Problema: un ordine dell'utente è evaporato per 18 giorni

Verificato in produzione il 2026-07-30. L'11/07 l'utente ha messo un team in modalità
manutenzione (`stop_search: true`). L'ordine è stato scritto in
`profile/capitano-maintenance.json` e recepito: il 12/07 il diario del Capitano registra
uno spawn Scout **soppresso** citando l'ordine. Il 13/07, dopo un refresh di contesto,
l'ordine è sparito dalla memoria operativa: il 13-14/07 gli Scout producono 52 posizioni
nuove, e per i successivi **18 giorni** il team lavora in modalità normale — 183
posizioni sorgente, weekly bruciato al 100% **due volte** — finché l'utente non riemette
l'ordine a mano il 29/07.

Le difese esistenti non hanno tenuto, ciascuna per un motivo prevedibile:

- **C-18 «rileggi il file a ogni apertura di finestra»** è un obbligo *di prompt*: si
  affida alla stessa memoria che il refresh cancella. È già fallito una volta il
  12/07/2026 (incidente citato nella stessa C-18) ed è rifallito qui.
- **`team_directives` (la bacheca persistente)** era ed è **vuota**: nessun processo la
  popola quando l'utente dà un ordine di modalità, quindi la «fonte di verità da
  rileggere» non contiene la verità.
- Il **`[RESUME]` del Dottore** dovrebbe riportare gli ordini nel contesto nuovo, ma il
  Dottore stesso è un agente: se il suo round salta (è successo), il passaggio si perde.

Il difetto comune: la persistenza dell'ordine dipende da **qualcuno che si ricorda di
leggere**. La correzione dell'utente ribalta la direzione: **l'ordine raggiunge il
Capitano, periodicamente, senza che debba ricordarsi nulla.**

## Il disegno deciso dall'utente

Il Capitano riceve già messaggi periodici dai bridge (heartbeat ~1/ora, tick di pacing).
**Quel messaggio deve contenere una sezione che dichiara la modalità corrente e cosa
comporta.** Un ordine iniettato ogni ora non può evaporare: al peggio si perde per
un'ora.

## Implementazione

### Dove

`heartbeat-bridge.py` (il messaggio orario al Capitano è suo). Il bridge è un processo
Python deterministico, non un agente: non dimentica, non salta i giri, non dipende dal
contesto.

### Cosa inietta

A ogni invio, il bridge legge **da disco** (mai da cache):

1. `profile/capitano-maintenance.json` → modalità e orders;
2. `team_directives` attive (via `team_directives.py list` o query diretta) → ordini
   permanenti dell'utente;
3. i flag operativi rilevanti già noti al sistema (burn-intent attivo, standby, halt).

E compone una sezione fissa in coda al messaggio periodico:

```
[MODALITÀ CORRENTE — iniettata dal bridge, fonte: file su disco]
MODE: maintenance (dal 2026-07-29 17:42 UTC)
- stop_search: false — sourcing SOLO col budget che avanza (search_priority=secondary…)
- priorità: ① recheck vive score≥70 stale>7gg  ② geocoding uffici  ③ logo/sito aziende
- esclusioni: solo se posizione certamente morta/scaduta
- cv_min_score: 90, pre_check_liveness_for_cv: true
DIRETTIVE ATTIVE: (elenco da team_directives, o "nessuna")
Se questa sezione contraddice il tuo contesto, VINCE QUESTA: il file su disco è la
fonte di verità e il tuo contesto può essere stato azzerato da un refresh.
```

L'ultima riga è parte del disegno, non decorazione: dopo un refresh il Capitano ha un
contesto pulito che *contraddice* l'ordine, e deve sapere quale dei due vince.

### Dettagli che contano

- **Idempotente e a costo zero**: il bridge manda già il messaggio; la sezione aggiunge
  ~15 righe. Nessun turno LLM extra, nessun processo nuovo.
- **`mode: normal` si inietta uguale** (una riga). L'assenza della sezione deve poter
  significare solo «bridge rotto», mai «modalità normale» — altrimenti si ricrea
  l'ambiguità silenzio=default.
- **Anche nel `[RESUME]` del Dottore**: la skill `session-refresh` deve accodare la
  stessa sezione (letta da disco, non dal contesto morente) al messaggio di ripresa.
  Doppio canale: il bridge copre il tempo, il resume copre l'istante del refresh.
- **Popolare la bacheca resta necessario**: quando l'utente imposta una modalità, chi
  scrive il JSON (CLI `jht`, console di gioco, o l'operatore) deve scrivere **anche** la
  direttiva in `team_directives`. Il bridge inietta da entrambe le fonti; la bacheca
  resta la storia consultabile.
- I worker non ricevono l'iniezione: la modalità la applica il Capitano assegnando le
  code. Un worker che riparte chiede al Capitano o guarda la coda assegnata — invariato.

## Test di accettazione

1. **Sopravvive al refresh**: ricreare la sessione del Capitano con modalità attiva →
   entro un'ora il suo contesto contiene di nuovo la sezione, senza interventi umani.
2. **Il file vince sul contesto**: con un Capitano il cui contesto dice «modalità
   normale» e file che dice `maintenance`, al primo messaggio iniettato il Capitano
   non spawna Scout oltre la policy (verificabile su un caso sintetico).
3. **Cambio a caldo**: modificare il JSON → la sezione del messaggio successivo riflette
   il nuovo contenuto (il bridge legge da disco a ogni giro).
4. **`normal` esplicito**: senza file di manutenzione, la sezione dice `MODE: normal` —
   mai assente.
5. **Bacheca inclusa**: una direttiva aggiunta a `team_directives` compare
   nell'iniezione successiva.
6. **Regressione 18-giorni**: simulare la sequenza dell'incidente (ordine → refresh →
   18 giorni compressi in N heartbeat) → a ogni heartbeat l'ordine è nel contesto; lo
   spawn Scout resta soppresso per tutta la durata.
