# Agent loop — cosa manca

Baseline: `main.py`, copiato da `codecrafters-claude-code-python/app/main.py` senza modifiche.
Gira su OpenRouter con l'SDK `openai`, quindi è già l'adapter OpenAI-compatible del design.

Sotto ci sono solo sintomi e criteri di verifica. Nessuna soluzione: l'implementazione è l'esercizio.
I numeri di riga si riferiscono a `main.py` come sta ora.

---

## 1. Nessun tetto agli step — riga 84

`while not finished` esce solo quando il modello smette di chiamare tool. Se entra in un ciclo
(rilegge lo stesso file, riprova un comando che fallisce) gira finché non lo ammazzi tu, e ogni
giro è una chiamata a pagamento.

**Verifica:** dai un prompt che induce un ciclo e controlla che il loop termini da solo, con un
motivo di uscita distinguibile da un completamento normale.

## 2. Il dispatch dei tool è chiuso — righe 117-157

`if/elif` su `tool_name`, con la logica del tool dentro il loop. Aggiungere un tool oggi significa
mettere le mani nel `while`, e il loop non è più leggibile separatamente dai tool.

Nota che `TOOLS` (righe 11-65) e il dispatch sono due elenchi degli stessi tre nomi, in due posti
diversi. Se ne aggiungi uno solo a uno dei due, lo scopri a runtime.

**Verifica:** aggiungi un quarto tool senza aprire il corpo del `while`, e senza dichiarare il suo
nome in due punti.

## 3. Un tool che alza uccide il run — righe 114, 121, 132, 141

`open()` su un path che non esiste, `json.loads` su argomenti malformati, una `PermissionError` in
scrittura: sollevano tutte, e l'eccezione arriva fino a `main()`. Il processo muore con uno
stacktrace, la conversazione è persa.

Il modello non è infallibile: sbaglierà path e produrrà JSON rotto. È un caso normale, non un bug.

**Domanda da farsi:** in un loop agentico, chi ha bisogno di sapere che il tool è fallito? Il
terminale, o il modello che deve decidere la prossima mossa?

**Verifica:** chiedi di leggere un file inesistente. Il run deve arrivare a una risposta finale
sensata, non a un traceback.

## 4. `Bash` può bloccarsi per sempre — riga 141

`subprocess.run(..., shell=True)` senza `timeout`. Un comando interattivo o che attende su stdin
appende il loop a tempo indefinito. E `shell=True` su una stringa che arriva dal modello merita
comunque un pensiero a parte.

**Verifica:** fai eseguire un comando che non ritorna. Il loop deve andare avanti.

## 5. `response.usage` viene buttato — righe 86-90

Ogni risposta porta i suoi token e tu li scarti. Senza quel dato non sai cosa costa un run, non puoi
fissare un budget e non hai modo di accorgerti che il contesto sta crescendo di giro in giro.

**Verifica:** a fine run stampa i token per step e il totale.

## 6. BUG — su `Write` rimandi indietro tutto il contenuto — righe 130-135

Il tool result di `Write` è `result`, cioè l'intero `content` che il modello ha appena scritto.
Glielo rispedisci dentro la conversazione, dove resta per tutti gli step successivi.

Guarda cosa contiene quel messaggio e chiediti quale parte serve davvero al modello per capire che
la scrittura è andata a buon fine.

**Verifica:** fai scrivere un file grosso e confronta i token in input dello step successivo prima
e dopo la correzione. Il tool result di `Read` invece è legittimamente il contenuto — non
confonderli.

## 7. Nessun system prompt — righe 77-79

`messages` parte con il solo messaggio utente. L'agente non ha istruzioni, non ha vincoli e non sa
in che directory sta lavorando: quello che fa dipende interamente dai default del modello dietro
OpenRouter, che cambiano se cambi `MODEL`.

**Verifica:** lo stesso prompt su due modelli diversi dovrebbe dare comportamenti confrontabili.

## 8. `finish_reason` mai guardato — riga 96

Prendi `.message` e ignori perché il modello si è fermato. Se si ferma per `length` (output
troncato) puoi ritrovarti una tool call incompleta che appendi comunque a `messages`, e la chiamata
dopo va in errore lato provider.

**Verifica:** abbassa `max_tokens` fino a farlo troncare a metà tool call, e guarda cosa succede.

---

## Prerequisito d'ambiente

`requirements.txt` di questo repo **non** ha `openai` (c'è un commento che spiega perché è stato
rimosso). Serve aggiungerlo, pinnato come tutto il resto di quel file.

## Fuori scope per ora

Non da fare adesso, ma è dove porta la strada:

- Adapter Anthropic native accanto a questo, per cache write e usage reali.
- `ModelProfile` con capability e prezzi, per far decidere al profilo cosa un modello può fare.
- Provider `mock`, per testare il loop senza spendere token.
