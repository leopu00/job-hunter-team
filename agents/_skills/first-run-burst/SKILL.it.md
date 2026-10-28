---
name: first-run-burst
description: La prima mezz'ora in cui un utente nuovo guarda il team lavorare. Apri questa skill quando ricevi `[PROFILO-PRONTO]` dall'Assistente, o al risveglio se `first_run.py status` riporta fase `awaiting_profile` / `burst`. Deroga alla calibrazione graduale (C-02) per la prima finestra soltanto, e definisce il successo come posizioni CON PUNTEGGIO a schermo — non come posizioni trovate.
allowed-tools: Bash(python3 /app/shared/skills/first_run.py *), Bash(python3 /app/shared/skills/plan_registry.py *), Bash(python3 /app/shared/skills/db_query.py *), Bash(/app/.launcher/start-agent.sh *), Bash(python3 /app/shared/skills/throttle-config.py *), Bash(jht-tmux-send *), Bash(jht-send *)
---

# first-run-burst — la dimostrazione da cui dipende se l'utente resta

Un utente nuovo finisce il setup, accende il team e sta a guardare. Dopo dieci
minuti ha visto comparire **una** posizione grezza. Niente gli permette di
distinguere un team che si sta dosando da un'applicazione rotta — quindi
conclude che è rotta, e non sta ragionando male.

La tua calibrazione normale (C-02: un worker, osserva 30 minuti, sali di un
gradino) è la regola giusta **a regime**, dove sbagliare costa una finestra di
budget. Al primo avvio costa l'utente. Questa skill è l'eccezione documentata,
e vale **solo per la prima finestra**.

## Trigger

- `[@assistente -> @capitano] [PROFILO-PRONTO]` — il profilo è appena diventato usabile
- al risveglio, se `python3 /app/shared/skills/first_run.py status` riporta
  `phase: awaiting_profile` o `phase: burst`

## Cosa vuol dire riuscire, qui

**Posizioni con un punteggio, a schermo.** Non posizioni trovate. Un run che
raccoglie 50 offerte e ne punteggia 3 (misurato, 26/07/2026) non ha prodotto
quasi nulla di visibile: la shortlist è il prodotto, lo scraping è idraulica.
Tutto quello che segue discende da questa frase.

## La procedura

**1. Apri il burst e leggi il roster.**

```bash
python3 /app/shared/skills/first_run.py begin-burst
```

Ti restituisce il `roster` (quanti Scout / Analisti / Scorer), lo
`scout_cap_first_pass` e il `target_scored`, tutti derivati dall'abbonamento
che l'utente ha dichiarato. Se rifiuta (`ok: false`, «piano di abbonamento non
selezionato»), il piano non è ancora dichiarato: **non indovinare** un roster,
una sovrastima gli brucia la finestra il primo giorno. Chiediglielo con `python3 /app/shared/skills/first_run.py ask-plan`: è l'unico modo, perché pubblica la card nell'app, con i piani e quello che la riga `Codex reports:` indica segnato come suggerito — un suggerimento, mai una tua scelta. Una domanda scritta come testo nel tuo pane non arriva a nessuno: l'utente guarda l'app, non il tuo pane. Quando l'utente risponde, scrivi esattamente la sua scelta con `python3 /app/shared/skills/plan_registry.py set <provider>:<id>` (va bene l'id della card: `pro_max` è `pro-max`) e rilancia `begin-burst`. Se risponde «non lo so», fermati e diglielo; richiedilo al prossimo risveglio.

**Mentre il burst gira, il piano può sparire** (la configurazione è stata azzerata, il provider è cambiato, il
file è stato modificato). `first_run.py status` e `begin-burst` portano allora `plan_missing: true` con un
`hint`: non leggere «burst already in progress» come «tutto a posto». Il burst continua e il piano si dichiara
allo stesso modo: chiedilo con `python3 /app/shared/skills/first_run.py ask-plan` (la card, mai testo semplice) e scrivi esattamente la sua scelta con `python3 /app/shared/skills/plan_registry.py set <provider>:<id>`. Lo chiede anche l'Assistente quando l'utente gli parla.

**«Non lo so» non è una fine.** Se la persona ha risposto «Non lo so» alla card, `begin-burst` non rifiuta: apre una **partenza lenta** (`prudent: true`, `plan_unknown: true`): un worker per ruolo, il primo giro e l'obiettivo più piccoli. Di' alla persona in chat la frase in `say` (è già nella sua lingua) e non richiedere tu il piano: la card torna da sola dopo un'ora. Quando poi ti dice il piano, scrivi esattamente la sua scelta con `python3 /app/shared/skills/plan_registry.py set <provider>:<id>` e rilancia `begin-burst`: risponde `upgraded: true` e il roster di quel piano sostituisce quello prudente.

**Il piano si chiede una volta sola.** Finché la tua domanda sul piano è senza risposta in chat, non rifarla, nemmeno con altre parole: un nuovo messaggio «profilo pronto», un altro risveglio o `plan_missing` nel prossimo `status` non cambiano ciò che aspetti. Guarda prima la chat: se hai già chiesto e l'utente non ha risposto, aspetta. Richiedilo solo dopo che l'utente ha risposto «non lo so». `ask-plan` non pubblica una seconda card finché la prima non ha risposta: se dice che la domanda è aperta, aspetta. Se non chiedi, la card la pubblica il sistema pochi minuti dopo l'import del profilo. Dopo «non lo so» ripubblica la card solo dopo un'ora, e mai più di tre volte in tutto: se lo dice, aspetta e non chiedere a parole.

**Mai prima del profilo, e la card va dove sta l'utente.** `ask-plan` non pubblica niente finché il profilo non è salvato (`wait_for_profile: true`): non chiedere il piano al benvenuto né mentre il profilo si costruisce, e aspetta il messaggio di profilo pronto. Finché l'utente conferma il profilo con l'Assistente, la card va nella chat dell'Assistente, chiunque lanci `ask-plan` (`agent` e `in_your_chat` nella risposta dicono dov'è). Quando ne parli all'utente, nomina la chat che ce l'ha — «la chat con l'Assistente» — mai «questa chat» se `in_your_chat` è `false`.

**Il piano viene solo dalla configurazione o dall'utente.** Non scriverlo mai tu dal diario, da una nota, dalla memoria o da una conversazione passata: «l'utente ha confermato Pro» in una nota è ciò che l'utente ha detto allora, non una dichiarazione di adesso (la configurazione può essere stata azzerata e il piano può essere cambiato). Finché c'è `plan_missing` il piano manca: chiedi, una volta sola, e scrivi solo ciò che l'utente risponde.

**Chiedere con i bottoni.** Se chiedi con `jht-notify-user --oggetto … --option id=etichetta`, l'id di un'opzione ammette solo `a-z`, `0-9` e `_` (fino a 24 caratteri, mai con `_` all'inizio): il piano `pro-max` è l'id `pro_max`, e quando arriva la risposta scrivi l'id del registro, `plan_registry.py set <provider>:pro-max`.

**2. Spawna tutto il roster, scaglionato di ~60 secondi.**

Non un worker ogni dieci minuti: tutta la formazione, di seguito, sempre
tramite `start-agent.sh` (C-03). Questa è l'eccezione deliberata a C-02.

**Dopo un riavvio, avvia solo ciò che manca.** Quando ti svegli in un burst già aperto (i container sono stati riavviati, quindi ogni sessione è sparita), `first_run.py status` e `begin-burst` portano `roster_alive` e `roster_missing` per ruolo. Avvia solo i ruoli in `roster_missing`, scaglionati allo stesso modo, e lascia stare quelli già su, qualunque cosa stiano facendo: una sessione occupata è viva (C-08 bis). Non rispawnare tutta la formazione e non ribriffare un worker che sta già lavorando. Se `roster_check` è `unavailable`, guarda tu le sessioni tmux prima di spawnare qualunque cosa.

**3. Non aspettare code piene per accendere il downstream.**

Spawna l'Analista appena esiste **una** posizione, lo Scorer appena **una**
posizione è checked. L'abitudine "prima raccolgo, poi valuto" è esattamente
ciò che lascia l'utente davanti a un mucchio di righe senza punteggio.

**4. Metti un tetto al primo giro di sourcing.**

Comunica a ogni Scout la sua quota di `scout_cap_first_pass` e digli di
riferire quando la raggiunge, invece di cercare finché il budget regge. Le
posizioni oltre quel tetto non valgono ancora niente: si accodano dietro a
quelle che nessuno ha punteggiato.

**5. Riferisci presto, non a lavoro finito.**

Appena le prime ~3 posizioni hanno un punteggio, manda all'utente un
`jht-send` breve con cosa sono: è il momento in cui l'applicazione smette di
sembrare rotta. Poi prosegui fino a `target_scored`.

**6. Chiudi il burst.**

```bash
python3 /app/shared/skills/first_run.py check
```

Eseguilo a ogni `[HEARTBEAT]`. Quando passa a `steady` sei tornato sotto le
regole ordinarie, calibrazione C-02 compresa.

## La velocità qui la gestisci tu — il bridge consiglia soltanto

`pace_guard` misura il consumo contro la curva della finestra a ogni sample del
bridge e ti scrive nel pane una riga `[PACE-GUARD]` con il throttle che
consiglierebbe. **Non** lo applica: non lo applica nessuno finché non esegui tu
`throttle-config.py`. Quindi:

- **Mai** `freeze_team.py` durante il burst. Un team congelato è esattamente il
  silenzio che questa skill esiste per evitare.
- Leggi una riga `[PACE-GUARD]` come una decisione da prendere, non come una
  notifica. Porta il comando già scritto per i worker vivi — adattalo a chi sta
  facendo cosa ed eseguilo. Se la ignori, il ritmo non cambia: nessuno script
  tocca il throttle al posto tuo.
- Se ti arriva come `LOCKOUT-IMMINENTE`, il freno consigliato è già al tetto di
  1h — frenare non basta più, e la leva è il **roster**: uccidi uno Scout (mai
  l'Analista o lo Scorer, senza di loro non si punteggia niente).
- La finestra deve arrivare al 100% **al reset**, non prima. Essere al 100% a
  metà strada significa lasciare l'utente con un team muto per due ore; essere
  al 40% al reset significa budget lasciato sul tavolo. Sono due fallimenti, e
  il primo è molto peggio.

## Anti-pattern

- ❌ Spawnare solo Scout, "prima il materiale, poi i punteggi" — l'esito
  misurato è 50 trovate / 3 punteggiate, che per l'utente è un'app rotta.
- ❌ Aspettare un `[BRIDGE TICK]` prima del primo spawn: il trigger **è** il
  profilo pronto.
- ❌ Salire la scala di C-02 durante il burst — quella regola governa il
  regime, questa finestra è l'eccezione.
- ❌ Congelare il team per proteggere il budget. Lento si recupera, muto no.
- ❌ Annunciare il burst all'utente col linguaggio dell'infrastruttura
  ("spawnati 4 worker, throttle 300s"). Riferisci posizioni, aziende, punteggi.

## Vedi anche

- `spawn-agent` — il lancio vero e proprio, invariato.
- `pipeline-triage` — quale ruolo scioglie il collo di bottiglia, a regime.
- `scaling-calc` / **C-02** — la calibrazione graduale che questa skill sospende.
- `chat-web` — come formulare il primo resoconto all'utente.
