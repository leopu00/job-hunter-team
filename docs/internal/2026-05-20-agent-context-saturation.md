# 2026-05-20 — Agent context saturation + reboot periodico via Dottore

> **Status: PROPOSTA / WORK IN PROGRESS.** Misurazione confermata, intuizione
> dell'utente sul rimedio (reboot via Dottore) condivisa, ma il design
> dell'implementazione e i side effect non sono ancora elaborati. Da
> rivedere a freddo prima di codificare.

## Misurazione effettuata (snapshot 2026-05-20 ~10:20 UTC, ~14h dal boot)

Letto dal file `/jht_home/.codex/state_5.sqlite`, tabella `threads`, campo
`tokens_used`:

### Agenti long-lived (1 solo thread che vive dal boot)

| Agente | tokens_used | thread age (h) | rate token/h |
|---|---:|---:|---:|
| **scrittore-2** | **148.5 M** | ~13.5 | ~11.0 M/h |
| **capitano** | **141.9 M** | ~14.0 | ~10.1 M/h |
| **scrittore-1** | **125.2 M** | ~13.6 | ~9.2 M/h |
| analista-1 | 44.6 M | ~13.7 | 3.3 M/h |
| scout-1 | 42.9 M | ~13.7 | 3.1 M/h |
| scorer-1 | 39.8 M | ~13.6 | 2.9 M/h |
| scout-2 | 33.2 M | ~5.2 (spawn 05:08) | 6.4 M/h |
| assistente | 15.1 M | ~14.0 | 1.1 M/h |
| mentor | 3.6 M | ~14.0 | 0.3 M/h |
| sentinella | 3.2 M | ~14.0 | 0.2 M/h |

### Agenti ephemeral (un thread nuovo per ogni task)

| Agente | thread count | max singolo | sum |
|---|---:|---:|---:|
| critico-s1 | **61** | 471 k | 13.0 M |
| critico-s2 | **43** | 430 k | 9.5 M |
| dottore | 8 | 1.3 M | 5.0 M |

I Critici dimostrano che il pattern "un thread per task" funziona: nessun
thread supera 500 k token, sintomi di saturazione (latenza, cooperative
idle, errori semantici) **non si osservano** sui Critici.

## Interpretazione del numero `tokens_used`

`tokens_used` è **cumulativo lifetime del thread**: somma di tutti i token
processati dal modello in tutte le risposte di quel thread (input + output
+ reasoning trace). Non è il context window snapshot corrente.

Codex CLI applica **compaction silenziosa periodica** quando il thread
si avvicina al limite del context window di GPT-5.5 (~400 k token presunti
per high reasoning). La compaction conserva un riassunto e libera token,
ma:

1. Il context "vivo" dopo compaction è comunque pesante (50-100 k token
   per turn, stima)
2. Ogni compaction lascia un "residuo" cumulativo nel rollout
3. Compaction multiple in sequenza degradano la qualità della
   conversazione (lost in the middle, attention dilution)

Quindi `tokens_used` alto **non è di per sé un errore**, ma è un proxy
abbastanza affidabile dello "stato di affaticamento" del thread.

## Sintomi correlabili al context saturo

Osservati nelle ultime ore sul Capitano (142 M token):

1. **Latenza decisionale alta**: tempo medio tra un input dalla Sentinella
   e una risposta del Capitano è cresciuto nelle ore notturne (da
   ~10-30 s a ~1-3 min).

2. **Cooperative idle prolungato**: il Capitano non auto-rilancia Scout
   quando la pipeline si svuota. Vedi
   [[2026-05-20-team-idle-gaps-investigation]] — 31 gap > 5 min, 6 gap
   > 20 min, totale ~8h15m di stasi su ~13h di operatività.

3. **Errori semantici (claim race)**: alle 04:05 UTC, Scrittore-1 e
   Scrittore-2 hanno entrambi rivendicato la position #45 De Wave perché
   il Capitano aveva mandato a entrambi "Prendi #X" senza tracking di
   chi possedeva cosa. Errore tipico di context con tracking distratto.

4. **Loop di kickoff**: alle 05:09 il Capitano ha mandato lo stesso
   messaggio "Start the main loop" a Scout-2 due volte in 17 secondi
   ("KICKOFF RETRY"). Suggerisce che il Capitano non ricordava di averlo
   già mandato (o Scout-2 non aveva ack-ato e il Capitano ha re-iterato
   senza tracking).

5. **Frasi più lunghe e verbose** nel tempo: i messaggi del Capitano
   diventano progressivamente più articolati (più "spiegoni" e meno
   ordini secchi), tipico di un modello che cerca di "tenersi tutto a
   mente".

## Proposta: reboot periodico del Capitano via Dottore

### Idea

Aggiungere al ciclo del Dottore un check basato su token consumati:

```
ogni ROUND del Dottore (oggi 2h tramite spawn-doctor.sh):
  per ciascun agente long-lived:
    leggi threads.tokens_used dal codex state_5.sqlite
    se tokens_used > SOGLIA_AGENTE:
      → notifica all'agente: "RESTART IMMINENTE in 60s, scarica task pendenti"
      → attendi ack o timeout
      → tmux kill-session -t <AGENTE>
      → bash /app/.launcher/start-agent.sh <agente>
      → il nuovo thread codex parte vergine
      → si riallinea leggendo: AGENTS.md (prompt), DB sqlite (stato pipeline),
        pacing-bridge-state.json (stato budget), eventuale memo persistente
```

### Soglie iniziali proposte (da tarare)

| Agente | Soglia tokens_used | Frequenza max reboot |
|---|---:|---|
| **capitano** | **50 M** | max 1 reboot ogni 3h |
| scrittore-1, scrittore-2 | 75 M | max 1 ogni 4h |
| scout-1, scout-2 | 50 M | max 1 ogni 4h |
| analista-1, scorer-1 | 50 M | max 1 ogni 6h |
| assistente | 30 M | max 1 ogni 6h (è user-facing su Telegram, attenzione) |
| sentinella | – | mai (deve essere sempre attiva, troppo low-token) |
| mentor | – | mai (uso sporadico, leggero) |
| dottore | – | si auto-respawna già ogni 2h tramite spawn-doctor.sh |

Le soglie sono **circa 1/3 dei valori attuali** dei più carichi → reboot
ragionevolmente frequente sul Capitano (ogni 4-5h), meno sui ruoli meno
strategici.

### Coreografia del reboot del Capitano (sensibile)

Il Capitano è il coordinatore — il suo reboot va orchestrato:

1. **Heads-up agli operatori**: il Dottore manda `[@dottore -> @<agent>]
   [INFO] Capitano restart in 60s, fermati al prossimo gate, non
   spawnare nuovi task` a tutti gli operatori attivi.
2. **Attesa ack** o timeout 60s
3. **Kill della session tmux** `CAPITANO`
4. **Snapshot di continuità su disco**: il vecchio Capitano scrive un
   file `/jht_home/.capitano-handoff.md` con (a) lista positions
   in-flight, (b) ultimi ordini emessi, (c) throttle config attivo, (d)
   chi possiede cosa. Questo è il "passaggio di consegne".
   - **Da elaborare**: il vecchio Capitano deve essere ancora vivo per
     scrivere questo, prima del kill. Serve un trigger "scarica stato
     prima di morire" — un nuovo skill `jht-capitano-handoff`.
5. **Respawn** via `start-agent.sh capitano`
6. **Auto-onboarding del nuovo Capitano**: il prompt deve includere
   "Se esiste `~/.capitano-handoff.md`, leggilo per primo. Riprende lo
   stato dalla pipeline (DB sqlite) + handoff. Saluta tutti gli operatori
   attivi con un ACK quando sei pronto."
7. **Operatori riprendono**: alla ricezione del saluto, gli operatori
   tornano in modalità normale.

### Reboot di Scrittori / Scout / Analista / Scorer (meno critico)

Sono più semplici — non coordinano altri agenti, quindi:

1. Heads-up al Capitano: "Sto per riavviare scrittore-2"
2. Kill della session tmux `<AGENTE>`
3. Respawn via `start-agent.sh <agente>`
4. Capitano fa l'ack al nuovo agente quando lo vede vivo

Niente handoff su disco — lo stato dell'operatore è quasi tutto in DB
(positions, scores, applications) e nel suo AGENTS.md.

### Trigger alternativo: tempo invece di soglia

Più semplice (ma meno preciso):

- Capitano: reboot fisso ogni 4h
- Scrittori: reboot fisso ogni 6h
- Operatori: reboot fisso ogni 8h
- Sentinella / Dottore / Mentor: mai

Pro: deterministico, facile da pianificare.
Contro: spreca reboot quando l'agente è "fresco" e ne salta uno quando
l'agente è particolarmente carico.

Soluzione ibrida: **trigger tempo + cap soglia** — "reboot ogni 4h MA
saltabile se tokens_used < 30 M".

## Differenza Codex vs Claude sul "compact"

- **Claude Code CLI**: ha `/compact` slash command che riassume la
  conversazione e libera context. Il thread resta lo stesso ma il
  context viene esplicitamente shrinkato.
- **Codex CLI**: usa compaction **silenziosa automatica** quando il
  context si avvicina al limite (vedi `thread.preview` nel `state_5.sqlite`).
  Non c'è un slash command equivalente noto.
- **Conseguenza**: per codex non possiamo fare "compact su comando".
  L'unico modo di forzare un context fresco è **un nuovo thread**, e
  l'unico modo di forzare un nuovo thread è **killare e riavviare la
  session codex**.

Da verificare:
- Codex CLI supporta `codex resume` su un thread esistente. Si potrebbe
  fare un "fork from checkpoint pulito" invece di kill+respawn?
- Lo schema `threads` ha `rollout_path` — esiste un meccanismo di
  rollback a un thread precedente con `tokens_used` basso?

## Cose ancora NON misurate / NON spiegate

1. **Effetto reale del reboot**: non abbiamo ancora fatto un reboot test
   del Capitano per verificare che le metriche di latenza e cooperative
   idle migliorino davvero. Servirebbe un A/B controllato.

2. **Soglia ottimale di tokens_used**: 50 M sul Capitano è un'ipotesi
   ragionevole, non un valore tarato. Servirebbe un esperimento (es.
   reboot a 30 M / 50 M / 80 M e misurare gap > 5 min nelle 4 h
   successive).

3. **Compaction silenziosa codex**: non sappiamo esattamente cosa
   conserva e cosa scarta codex durante il compaction. Forse il
   problema reale non sono i 142 M token cumulativi ma il **contenuto**
   del context dopo le compaction (es. perdita di tracking di chi possiede
   cosa).

4. **Handoff su disco**: il file `.capitano-handoff.md` proposto non
   esiste ancora. Serve una skill nuova `jht-capitano-handoff` che il
   vecchio Capitano chiama prima di morire. Da progettare con cura.

5. **Side effect su Telegram (assistente)**: l'Assistente è user-facing
   sul Telegram. Un suo reboot durante una conversazione con l'utente
   potrebbe perdere il filo. Serve un "pause mode" che drena il dialogo
   prima di riavviarsi.

## Prossimi step proposti (DA ELABORARE)

1. **Esperimento manuale**: stasera o domani mattina, fare un kill+restart
   del Capitano in finestra "calma" (es. notte, batch chiuso) e
   confrontare:
   - Tempo medio risposta Sentinella → Capitano nelle 2h prima vs dopo
   - Numero di gap > 5 min nelle 4h dopo
   - Eventuali errori claim-race o kickoff duplicati
2. Se l'esperimento conferma il beneficio: estendere a Scrittore-1/2
   con coreografia minimale (no handoff).
3. Codificare il loop nel Dottore: estendere `spawn-doctor.sh` o
   aggiungere `jht-context-watchdog.py` che:
   - Legge `tokens_used` per ogni agente da `state_5.sqlite`
   - Decide quale agente "reboot" usando soglie + cap frequenza
   - Esegue la coreografia
4. Aggiungere metric output: ogni reboot scrive un log
   `/jht_home/logs/reboots.jsonl` con `agent, tokens_used_before,
   reason, ack_received, restart_duration_sec`.
5. Long-term: valutare se ridisegnare gli agenti più "task-oriented"
   come ephemeral (pattern Critico) invece di long-lived.

## Memory rilevante

- [[2026-05-20-team-idle-gaps-investigation]] — i gap di idle sono
  probabilmente correlati alla saturazione del Capitano
- [[feedback_dev_time_over_repair_time]] — Leone vuole feature, non
  riparare tooling. Il reboot via Dottore è tooling, ma supporta
  l'operatività di tutte le feature
- [[project_jht_goal_and_state]] — JHT è personal tool + open platform.
  Per scalare a beta tester, il reboot automatico è critico (altrimenti
  ogni tester dovrà reset manualmente ogni 4-6h)
