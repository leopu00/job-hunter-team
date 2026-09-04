# Agent loop — cosa manca

*English version: [`TODO.md`](TODO.md).*

Baseline di partenza: `main.py`, copiato da `codecrafters-claude-code-python/app/main.py`.
Gira su OpenRouter con l'SDK `openai`, quindi è già l'adapter OpenAI-compatible del design.

**Aggiornato il 4 set 2026** con il lavoro fatto a mano sul PC di lavoro (là il file si chiama
`FincoBot/app/fincobot.py`, qui `main.py`: stesso codice, stessa base). Il file è passato da 165 a
206 righe e **i buchi 5 e 6 sono chiusi**. Il ragionamento riga per riga sta in
`lezioni/fincobot.md`, che non entra nel repo.

Sotto ci sono solo sintomi e criteri di verifica. Nessuna soluzione: l'implementazione è l'esercizio.
I numeri di riga si riferiscono a `main.py` **come sta ora**, dopo l'aggiornamento del 4 set.

---

## 1. Nessun tetto agli step — riga 89 ⬜ APERTO

`while not finished` esce solo quando il modello smette di chiamare tool. Se entra in un ciclo
(rilegge lo stesso file, riprova un comando che fallisce) gira finché non lo ammazzi tu, e ogni
giro è una chiamata a pagamento.

**Verifica:** dai un prompt che induce un ciclo e controlla che il loop termini da solo, con un
motivo di uscita distinguibile da un completamento normale.

## 2. Il dispatch dei tool è chiuso — righe 152-196 ⬜ APERTO

`if/elif` su `tool_name`, con la logica del tool dentro il loop. Aggiungere un tool oggi significa
mettere le mani nel `while`, e il loop non è più leggibile separatamente dai tool.

Nota che `TOOLS` (righe 11-65) e il dispatch sono due elenchi degli stessi tre nomi, in due posti
diversi. Se ne aggiungi uno solo a uno dei due, lo scopri a runtime.

**Verifica:** aggiungi un quarto tool senza aprire il corpo del `while`, e senza dichiarare il suo
nome in due punti.

## 3. Un tool che alza uccide il run — righe 150, 158, 169, 180 ⬜ APERTO

`open()` su un path che non esiste, `json.loads` su argomenti malformati, una `PermissionError` in
scrittura: sollevano tutte, e l'eccezione arriva fino a `main()`. Il processo muore con uno
stacktrace, la conversazione è persa.

Il modello non è infallibile: sbaglierà path e produrrà JSON rotto. È un caso normale, non un bug.

**Domanda da farsi:** in un loop agentico, chi ha bisogno di sapere che il tool è fallito? Il
terminale, o il modello che deve decidere la prossima mossa?

**Verifica:** chiedi di leggere un file inesistente. Il run deve arrivare a una risposta finale
sensata, non a un traceback.

## 4. `Bash` può bloccarsi per sempre — riga 180 ⬜ APERTO

`subprocess.run(..., shell=True)` senza `timeout`. Un comando interattivo o che attende su stdin
appende il loop a tempo indefinito. E `shell=True` su una stringa che arriva dal modello merita
comunque un pensiero a parte.

**Verifica:** fai eseguire un comando che non ritorna. Il loop deve andare avanti.

## 5. `response.usage` viene buttato — ✅ CHIUSO il 4 set 2026 (righe 109, 122)

Ora ogni giro stampa su `stderr` i token in input e in output, i totali cumulati e — la parte che
conta — il **delta rispetto al giro precedente** (`input_tokens - previous_prompt_tokens`), che è il
costo marginale di quel turno. Il contatore `round` numera i giri.

Scoperta emersa misurando, non leggendo: **il costo di un turno si vede con un giro di ritardo**,
perché i token di ciò che appendi ora si pagano alla chiamata successiva. Dettagli in
`lezioni/fincobot.md`, sezione *«Il principio del ritardo di un giro»*.

Resta aperto sopra questo: nessun **budget** che fermi il run quando la spesa supera una soglia
(si lega al buco 1), e i numeri vanno su `stderr` a mano invece che in una struttura interrogabile.

## 6. BUG — su `Write` rimandi indietro tutto il contenuto — ✅ CHIUSO il 4 set 2026 (righe 163-174)

`content` e `result` sono ora due variabili distinte: si scrive `content` sul file e si restituisce
al modello `f"File scritto con successo: {file_path}"`. Il tool result di `Read` resta il contenuto,
come deve essere.

Misurato prima e dopo sul campo: la differenza si vede nei token in input del giro successivo.

## 7. Nessun system prompt — righe 77-79 ⬜ APERTO

`messages` parte con il solo messaggio utente. L'agente non ha istruzioni, non ha vincoli e non sa
in che directory sta lavorando: quello che fa dipende interamente dai default del modello dietro
OpenRouter, che cambiano se cambi `MODEL`.

**Verifica:** lo stesso prompt su due modelli diversi dovrebbe dare comportamenti confrontabili.

## 8. `finish_reason` mai guardato — riga 105 ⬜ APERTO

Prendi `.message` e ignori perché il modello si è fermato. Se si ferma per `length` (output
troncato) puoi ritrovarti una tool call incompleta che appendi comunque a `messages`, e la chiamata
dopo va in errore lato provider.

**Verifica:** abbassa `max_tokens` fino a farlo troncare a metà tool call, e guarda cosa succede.

## 9. La history era una lista mista — ✅ CHIUSO il 4 set 2026 (riga 128)

Non era nella lista originale: è saltato fuori stampando i messaggi. `messages` conteneva sia
dizionari scritti a mano sia oggetti dell'SDK (`ChatCompletionMessage`), quindi `json.dumps` sulla
lista si rompeva e nessun lettore poteva trattarla in modo uniforme.

Ora si appende `msg.model_dump(exclude_none=True)`: **la conversione avviene al confine**, appena il
dato entra in casa, e da lì in poi la history è omogenea. Un solo lettore la stampa tutta.

Vedi `lezioni/fincobot.md`, sezioni *«La history è una lista mista»* e
*«Stampa: non scrivere un lettore per ogni forma»*.

---

## Da dove ripartire (4 set 2026)

In ordine, come li ha lasciati la sessione con l'istruttore:

1. **Buco 1 — step cap.** È il più urgente: senza tetto, ogni difetto degli altri buchi costa soldi
   veri finché non ammazzi il processo a mano.
2. **Buco 3 — eccezioni restituite al modello.** È quello che cambia di più il comportamento
   dell'agente: un errore diventa informazione invece che una fine.
3. **Buco 2 — registry.** Da fare dopo il 3, altrimenti riscrivi due volte la gestione errori.

Regola della sessione, da mantenere: **il codice lo scrive Leone a mano.** Gli appunti in
`lezioni/` contengono il ragionamento, non le soluzioni.

---

## Prerequisito d'ambiente

`requirements.txt` di questo repo **non** ha `openai` (c'è un commento che spiega perché è stato
rimosso). Serve aggiungerlo, pinnato come tutto il resto di quel file.

## Fuori scope per ora

Non da fare adesso, ma è dove porta la strada:

- Adapter Anthropic native accanto a questo, per cache write e usage reali.
- `ModelProfile` con capability e prezzi, per far decidere al profilo cosa un modello può fare.
- Provider `mock`, per testare il loop senza spendere token.
