---
name: graceful-shutdown
description: Close the working day on request from the user. Triggered by a `[SHUTDOWN]` message from @utente. The user is closing the application and every agent is about to be killed mid-task; before that happens each one must record where it got to, so tomorrow the team resumes instead of restarting. Stop the agents one by one, then create the flag that lets the application exit. NEVER use this for routine pacing decisions — it ends the whole team.
allowed-tools: Bash(jht-tmux-send *), Bash(node /app/cli/bin/jht.js team *), Bash(touch /jht_home/.shutdown-ready.flag), Bash(python3 /app/shared/skills/captain_diary.py *)
---

# graceful-shutdown — chiudere la giornata quando l'utente esce

L'utente sta chiudendo l'applicazione. Senza di te gli agenti verrebbero
troncati a metà lavoro: uno Scout in mezzo a un giro di board, uno Scrittore
con un CV a metà. **Il tuo compito è che nessuno perda il punto in cui era.**

Il gioco ti ha mandato `[@utente -> @capitano] [SHUTDOWN] …` e ora **aspetta un
flag da te**: finché non lo crei, la finestra resta aperta e mostra all'utente
quanti agenti stanno ancora lavorando.

## Procedura

1. **Chiedi a tutti di annotare e fermarsi.** A ogni sessione viva manda:

   ```bash
   jht-tmux-send SCOUT-1 "[@capitano -> @scout-1] [SHUTDOWN] Chiusura richiesta dall'utente. Scrivi sull'agenda a che punto sei (ultima board, ultima posizione salvata, cosa resta), poi fermati. Non iniziare nuovo lavoro."
   ```

   Una riga per agente, con il suo nome vero. Chi sta scrivendo su disco
   finisce il file corrente: interrompere una scrittura è peggio che aspettare
   qualche secondo.

2. **Annota tu la giornata** nel diario, così il Capitano di domani riprende il
   filo:

   ```bash
   python3 /app/shared/skills/captain_diary.py append "Chiusura richiesta dall'utente: <chi stava facendo cosa>"
   ```

3. **Ferma gli agenti** quando hanno confermato (o dopo una attesa ragionevole:
   non tenere l'utente fermo più di un paio di minuti per un agente che non
   risponde):

   ```bash
   node /app/cli/bin/jht.js team stop --all
   node /app/cli/bin/jht.js team stop assistente
   ```

4. **Crea il flag.** È l'ultima cosa che fai: dice al gioco che può spegnere il
   container e uscire.

   ```bash
   touch /jht_home/.shutdown-ready.flag
   ```

## Regole

- **Il flag va creato SEMPRE**, anche se qualcosa è andato storto. Se non lo
  crei, l'utente resta davanti a una finestra che aspetta te — e finirà per
  chiudere a forza, che è esattamente ciò che questa skill evita.
- **Non negoziare la chiusura.** L'utente ha deciso: il tuo compito è renderla
  ordinata, non discuterla o rimandarla.
- **Niente lavoro nuovo** dal momento in cui ricevi `[SHUTDOWN]`: nessuno
  spawn, nessun nuovo giro, nessuna scalata.
- Se un agente non risponde, annotalo nel diario e vai avanti: meglio perdere
  il punto di UN agente che bloccare la chiusura di tutti.
