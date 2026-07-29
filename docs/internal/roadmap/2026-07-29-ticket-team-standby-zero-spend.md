# TICKET — Standby a spesa zero: fermare anche i ruoli core

**Stato**: da implementare · **Tag**: `[TEAM-STANDBY-ZERO-SPEND]` ·
**Correlato**: `[STEPCAP-THROTTLE-RESUME]`, `[COORD-STATUS-PUSH-TO-PULL]`,
[note di sessione](../../sessions/2026-07-28-burn-test-scout-step-cap-stall.md)

---

## Problema

**Un team acceso ha un costo che nessuna leva attuale può azzerare.** Misurato in
produzione il 2026-07-29: con tutti e cinque i worker a `throttle=3600s` e **zero
posizioni prodotte**, il weekly è comunque salito da 98% a 100% in circa un'ora, cioè
**~2 punti di quota settimanale all'ora a pipeline completamente ferma**, fino a
sbattere sul muro. Il team è poi rimasto bloccato quattro giorni e mezzo, fino al reset
settimanale del provider.

La spesa residua non viene dai worker ma dai ruoli **core** — coordinatore, assistente,
sentinella, dottore, mentore — e dai tre bridge, che continuano a scambiarsi tick ogni
5-15 minuti indipendentemente dal fatto che ci sia lavoro. Nessuno di loro passa dal
`config/throttle.json`, che governa i soli worker.

### Gli strumenti che sembrano coprirlo, non lo coprono

Due skill esistono già e **escludono esattamente i ruoli che spendono**:

```python
# shared/skills/freeze_team.py
DEFAULT_EXCLUDE = {"CAPITANO", "ASSISTENTE", "SENTINELLA", "SENTINELLA-WORKER"}

# shared/skills/soft_pause_team.py
EXCLUDE = {"SENTINELLA", "ASSISTENTE", "SENTINELLA-WORKER"}
```

Entrambe fermano gli **operativi**, cioè quelli che il throttle può già azzerare.
Applicarle nell'incidente sopra non avrebbe cambiato il risultato di un punto.

L'esclusione è deliberata e sensata: la Sentinella è quella che deve accorgersi che la
quota è tornata e mandare il `[RIPRENDI]`. **Silenziarla senza sostituirla lascerebbe il
team spento per sempre.** Il ticket sta tutto qui: come togliere anche i core senza
perdere la sveglia.

---

## Il nodo: la sveglia deve stare fuori dal loop LLM

L'osservazione che rende il problema risolvibile: **leggere la quota non costa un turno
di modello**. I bridge la ottengono via HTTP e CLI del provider, non chiedendola a un
agente. Un bridge può quindi restare vivo a costo zero e fare da sveglia, purché smetta
di **scrivere agli agenti**.

Da cui il principio di disegno:

> In standby i bridge continuano a **leggere**, e smettono di **parlare**.

Non serve un processo nuovo: serve che i bridge esistenti abbiano una modalità in cui
campionano e loggano ma non inviano nulla in tmux.

---

## Implementazione

### 1 — Il flag

`$JHT_HOME/.team-standby.flag`, JSON, sulla falsariga di `.burn-intent.flag`:

```json
{"since": 1785690713, "until": null, "reason": "weekly quota exhausted",
 "wake_on": {"weekly_below": 100}}
```

`until` per uno standby a tempo, `wake_on` per uno standby condizionato — il caso
principale è «riaccenditi quando il weekly scende sotto il 100%». Almeno uno dei due
deve essere valorizzato: **uno standby senza condizione di uscita non si scrive**, per
non ripetere il problema noto dei flag che nessuno scade
(`config/throttle-floor-exempt.txt` porta già quel commento).

### 2 — La CLI

`cli/src/commands/standby.js`, modellato su `burn.js` che ha già la stessa forma:

```
jht standby on  --reason "…" [--until <iso> | --wake-on-weekly]
jht standby off
jht standby status
```

### 3 — Chi legge il flag

| componente | comportamento in standby |
|---|---|
| `sentinel-bridge.py` | continua a campionare la quota e scrivere `sentinel-data.jsonl`; **non invia** messaggi in tmux |
| `pacing-bridge.py` | sospende del tutto l'invio dei tick |
| `heartbeat-bridge.py` | sospende del tutto l'invio |
| `agent-watchdog.sh` | non respawna, non nudgea — le sessioni restano vive ma mute |
| `doctor-watchdog.sh` | idem |
| watchdog di `[STEPCAP-THROTTLE-RESUME]` | nessun nudge, nessun kick-off |

Il pattern di lettura esiste già: `.team-halted.flag` è letto da `agent-watchdog.sh:277`,
`doctor-watchdog.sh:41` e `codex-auth-healer.sh:27`. **Non riusare quel flag**: `halted`
significa «l'utente ha fermato il team» e disabilita il respawn, mentre standby è una
sospensione tecnica reversibile da sola. Semantiche diverse, file diversi.

### 4 — Fermare gli agenti

Estendere `soft_pause_team.py` con `--include-core`, che rimuove le esclusioni e manda
il messaggio di pausa anche a CAPITANO, ASSISTENTE, SENTINELLA. Usare la forma soft e
**non** `freeze_team.py`: gli Esc abortiscono il turno corrente e lasciano scritture a
metà, mentre qui non c'è alcuna urgenza — la quota è già finita, un task che si chiude
con calma non peggiora niente.

### 5 — Il risveglio

Il `sentinel-bridge.py`, che in standby continua a campionare, valuta `until` e `wake_on`
a ogni tick. Quando la condizione è soddisfatta:

1. rimuove `.team-standby.flag`;
2. manda `[RIPRENDI]` a tutti i ruoli, core inclusi;
3. logga l'uscita su `logs/standby.jsonl`.

⚠️ **Ordine obbligato**: prima rimuovere il flag, poi mandare `[RIPRENDI]`. Se si
inverte, il watchdog vede ancora lo standby e può risilenziare gli agenti appena
risvegliati.

⚠️ Il risveglio deve reggere il caso in cui il bridge sia morto durante lo standby: il
`agent-watchdog.sh` lo respawna già, e al riavvio il bridge deve **rileggere il flag e
riprendere il ruolo di sveglia**, non ripartire in modalità normale — altrimenti lo
standby si annulla al primo crash.

### 6 — Osservabilità

`logs/standby.jsonl`, un record per transizione:

```json
{"ts": …, "event": "enter|exit|wake_check", "reason": "…",
 "weekly_usage": 100, "agents_paused": 10}
```

Serve a rispondere a «quanto è stato in standby» e «perché non si è svegliato», che sono
le due domande che arriveranno.

---

## Cosa questo ticket rende misurabile

Oggi il costo di un team inattivo è ignoto e si scopre solo sbattendo sul muro. Con lo
standby diventa una scelta esplicita, e apre tre decisioni che oggi non si possono
prendere con dati:

- quante VPS regge un singolo account del provider;
- se convenga sospendere un beta tester inattivo invece di rallentarlo — vedi i due
  profili con oltre 1000 posizioni prodotte e **zero** aperte;
- quanto della quota settimanale se ne va in coordinamento anziché in produzione.

---

## Test di accettazione

1. **Spesa azzerata** — con standby attivo per un'ora, `usage` della finestra non deve
   muoversi di più di un punto. È il test che l'incidente originale avrebbe fallito.
2. **Nessun messaggio in tmux** — durante lo standby, nessun pane riceve input da bridge
   o watchdog; verificabile con l'hash dei pane invariato.
3. **Il campionamento continua** — `sentinel-data.jsonl` cresce regolarmente: la lettura
   della quota non si ferma.
4. **Risveglio condizionato** — con `wake_on.weekly_below`, simulare il rientro sotto
   soglia e verificare `[RIPRENDI]` a tutti i ruoli entro un tick.
5. **Sopravvive al crash del bridge** — uccidere il bridge in standby; dopo il respawn
   deve restare in standby e conservare la funzione di sveglia.
6. **Ordine flag/messaggio** — verificare che nessun agente venga risilenziato subito
   dopo il `[RIPRENDI]`.
7. **Non confonde `halted`** — con `.team-halted.flag` presente, uscire dallo standby
   **non** deve far ripartire il team: lo stop dell'utente vince.
