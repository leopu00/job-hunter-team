# Togliere la riga gemella da `chat.jsonl` — proposta

> ⛔ **Nulla di questo documento è stato eseguito.** È la proposta da
> approvare prima di scrivere lo strumento e prima di toccare un solo file di
> un utente. Ticket: `[CHAT-DUPLICATES-BORN-INSIDE-THE-BOX]`.

## 📍 Dove siamo

Le tre cause dei doppioni sono chiuse e le due firme sono spiegate. Restano
**le righe già scritte**, che sono doppie in tre posti:

| Dove | Cosa vede l'utente | Come si toglie |
|---|---|---|
| `<agente>/chat.jsonl` sul box | due bolle nella chat del **videogioco** | questo documento |
| `pending_user_messages` (SQLite del box) | niente di diretto, ma **rialimenta** il cloud a ogni push | DELETE, dopo il travaso |
| `pending_user_messages` (Supabase) | due bolle nella chat **web** | DELETE, per ultima |

Il travaso dello stato è già pronto in
[`chat_duplicate_state_merge.sql`](../../scripts/analysis/chat_duplicate_state_merge.sql)
e va fatto **prima** di qualsiasi cancellazione: rende le due copie
interscambiabili, così togliere quella di troppo non può perdere niente.

**Quantità reale: due coppie.** `38/114` sul capitano e `291/292`
sull'assistente. Cioè **due righe da togliere, in due file**. Le altre coppie
che la query pesca (224/227/228, 51/55, 1/3, 222/223) distano da 34 secondi a
giorni: sono messaggi ripetuti davvero, non doppioni, e non si toccano.

## 1. Quale riga sopravvive, e come la scelgo

**Non introduco un criterio nuovo.** La riga che sopravvive nel file è quella
il cui `ts` è uguale al `chat_ts` della riga che sopravvive nella tabella,
scelta già motivata nel travaso:

- **Firma A — due bocche** (`38/114`): sopravvive la riga del **mirror**
  (`jht-notify-user`), l'unica che può portare `related_position_id`, un
  `kind` diverso da `notification` e una consegna Telegram, e l'unica che il
  flusso delle risposte sa indirizzare. Si toglie dal file la riga scritta da
  `jht-send`, cioè quella con `ts` = `chat_ts` della gemella.
- **Firma B — troncamento** (`291/292`): sopravvive l'**originale**, quella
  con la frazione non tonda. La gemella a `.000` è l'artefatto del
  ripescaggio. Si toglie la riga con `ts` intero.

Una sola sorgente di verità: se il travaso ha ragione, il file la segue.

**Il criterio di identificazione è il `ts`, mai il testo.** Il `ts` è la
chiave della corsia (`chat_ts`), il testo non è univoco — «ok» arriva mille
volte, ed è la ragione per cui non si deduplica per corpo.

Con una verifica in più prima di scrivere: la riga individuata per `ts` deve
avere **anche** il testo atteso. Se non coincide, lo strumento si ferma e non
tocca niente: vuol dire che la mia mappa non descrive quel box.

## 2. L'ordine, che non è negoziabile

```
1. FERMARE il team          ← altrimenti si perde ciò che viene scritto nel mentre
2. COPIA del chat.jsonl     ← è il ritorno indietro
3. togliere la RIGA dal file
4. verificare
5. DELETE della riga in SQLite (box)
6. DELETE della riga su Supabase
7. ripartire
```

Perché proprio questo ordine:

- **File prima, tabella dopo.** Al contrario no: tolta la riga dalla tabella,
  il suo `ts` torna sconosciuto alla dedup e il primo giro della corsia (~5 s)
  la **reimporta dal file**. Si otterrebbe un doppione nuovo di zecca.
  Togliendo prima la riga dal file, invece, non c'è niente che la rimetta: il
  mirror riscrive solo le righe con `chat_ts` NULL, e la gemella ce l'ha.
- **Box prima, cloud dopo.** `handlePush` rilegge `pending_user_messages`
  **intera** a ogni «Sync now», senza cursore: una riga tolta solo dal cloud
  torna al primo push.

## 3. ⚠️ Fermare il team non è opzionale

`chat.jsonl` viene aperto in append da cinque scrittori — `jht-send`,
`jht-reply-options`, il mirror, l'import dal cloud e il videogioco — **mentre
la squadra lavora**. Riscrivere il file in place significa leggerlo, filtrare
e riscriverlo: tutto ciò che viene appeso fra la lettura e la scrittura
**sparisce**, senza errori e senza traccia. Sarebbe una perdita di messaggi,
cioè esattamente il difetto dell'altro ticket, causato dalla riparazione di
questo.

Nota sul come fermarlo: il flag `.weekly-halt.flag` mette in pausa la corsia
nel loop a poll (`cloud.js:3426`), **ma nel ramo Realtime il timer della chat
gira lo stesso** — `setInterval(() => runChatSync(...))` non guarda il flag,
mentre la cadenza lenta lì accanto sì (`cloud.js:3653`). Con
`JHT_REALTIME_SYNC=1` il flag quindi non basta. Siccome sul fleet quel flag è
spento la pausa funzionerebbe, ma non voglio appoggiarmi a una differenza del
genere per un'operazione distruttiva: **si ferma il container**, che è
inequivocabile. (La disparità fra i due loop è un difetto a sé; la segnalo,
non la sistemo qui.)

## 4. Cosa succede se sbaglio

| Errore | Effetto | Gravità | Recupero |
|---|---|---|---|
| Tolgo la riga **sbagliata** (quella del sopravvissuto) | nel gioco sparisce una bolla; la tabella resta intatta e **non** si crea un doppione, quindi il difetto è **silenzioso** | 🔴 la peggiore: è una perdita che non si annuncia | ripristino della copia |
| Tolgo la riga giusta ma **non** cancello la riga in tabella | il gioco mostra una bolla sola, il web due; nessuna perdita | 🟢 stato intermedio innocuo | si prosegue col passo 5 |
| Cancello in tabella **senza** togliere la riga dal file | la corsia reimporta: il doppione torna, e sembra che la pulizia non funzioni | 🟡 rumoroso, non distruttivo | rifare nell'ordine giusto |
| Riscrivo il file **col team acceso** | sparisce quello che è stato scritto nel frattempo | 🔴 perdita muta di messaggi veri | ripristino della copia, ma **solo** fino all'istante della copia |
| File corrotto a metà scrittura | il gioco perde la conversazione | 🔴 | ripristino della copia |

Il filo conduttore: **ogni errore grave è una perdita silenziosa**, e l'unica
rete è la copia. Per questo il passo 2 non è una formalità.

## 5. Come si torna indietro

1. **Copia timestampata accanto all'originale**, prima di toccare:
   `chat.jsonl.bak-<epoch>` nella stessa directory. Stessa ricetta del backup
   del profilo in `vps_backend.gd` (backup sul posto, non altrove: se il
   ripristino serve, deve essere lì).
2. Il ripristino è una copia all'indietro, e riporta **l'intero file** allo
   stato di partenza — comprese le due bolle doppie. Non è un undo parziale:
   è tutto o niente, ed è la ragione per cui la copia va fatta a team fermo,
   così l'istante è netto.
3. Le righe della tabella **non si cancellano finché il file non è
   verificato**. Finché la DELETE non è partita, il ritorno indietro è
   completo e non serve toccare né SQLite né Supabase.
4. Se la DELETE è già partita e serve tornare indietro: le righe cancellate
   **non** si ricostruiscono dalla copia del file — il file non contiene id,
   consegne, letture o risposte. Da lì in poi il ritorno indietro è parziale.
   È il punto di non ritorno, e va attraversato consapevolmente.

## 6. Tre opzioni, e cosa consiglio

**A. Non fare niente.** Restano due bolle doppie nello storico di due
conversazioni. Le cause sono chiuse, quindi il numero non cresce più.
Costo: due doppioni visibili scorrendo indietro. Rischio: **zero**.

**B. Solo il cloud e la tabella, non il file.** Sistema la chat web, lascia il
gioco. Non funziona: il full-push rimette la riga sul cloud finché quella
locale c'è, e togliere quella locale senza toccare il file fa reimportare.
Cioè richiede comunque il passo sul file. **Scartata, non è un'opzione
davvero.**

**C. La pulizia completa**, nell'ordine del §2, a team fermo, con copia.
Costo: una finestra di fermo di qualche minuto e un'operazione distruttiva su
dati veri, per due righe.

**Consiglio A**, e lo dico controvoglia perché la pulizia è la cosa che
soddisfa. Il rapporto non torna: si rischia una perdita muta di messaggi veri
per togliere **due** bolle duplicate in uno storico che nessuno rilegge, in un
prodotto dove la stessa classe di difetto — il messaggio che sparisce senza
dirlo — è già costata un ticket. Se invece le coppie fossero decine, o se un
utente le avesse segnalate, C diventa giustificata: il rischio è lo stesso, il
beneficio no.

Se scegli **C**, dimmelo e scrivo lo strumento con questa forma: legge il
file, esige `ts` **e** testo, rifiuta se la riga non è esattamente una, fa la
copia, riscrive, ristampa il diff delle righe e **si ferma prima di ogni
DELETE**, che resta un gesto tuo.
