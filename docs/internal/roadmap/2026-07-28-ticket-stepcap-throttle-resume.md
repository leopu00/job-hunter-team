# TICKET — Ripresa automatica degli agenti fermi sul cap di step

**Stato**: implementato il 2026-07-28 — `.launcher/stepcap-watchdog.py`, avviato da
pid1, sei test di accettazione in `tests/test_stepcap_watchdog.py`. Resta da vedere
su un container vero l'unica cosa che un test non può dire: se un pane Kimi fermo
sul cap è davvero *immobile* (vedi § Limiti noti nella docstring dello script) e se
il paste dal buffer entra nella TUI. · **Tag**: `[STEPCAP-THROTTLE-RESUME]` ·
**Correlato**: `[SPAWN-STAGGER-BY-PERIOD]` in `BACKLOG.md`,
[note di sessione](../../sessions/2026-07-28-burn-test-scout-step-cap-stall.md)

---

## Problema

Il cap `max_steps=100` interrompe l'agente ma **non lo termina**: la sessione tmux
resta viva, il pane risponde, e l'ultima riga è

```
Max number of steps reached: 100
Send another message to continue where it left off.
```

L'agente aspetta un input che **nessun componente del sistema è incaricato di mandare**.
Osservato in produzione il 2026-07-28: l'unico Scout attivo fermo in questo stato, con
la conseguenza che la coda degli Analisti si è svuotata e gli Scorer sono rimasti senza
lavoro. Produzione a 6 posizioni/ora con load a 0,27 su 4 core — il sistema sembrava
sano da ogni indicatore disponibile.

I watchdog esistenti (`agent-watchdog.sh`, `doctor-watchdog.sh`) verificano che la
sessione **esista** e che il pane non sia degradato a bash idle. Uno stallo sul cap di
step supera entrambi i controlli: il processo dell'agente c'è, il comando del pane è
quello giusto. Il file `logs/idle-nudge.jsonl` non esiste e nessun processo di
idle-nudge gira sulla macchina.

---

## Comportamento richiesto

Quando un agente raggiunge il cap di step:

1. **si rileva** lo stallo;
2. **si applica un throttle** all'agente;
3. **alla scadenza del throttle** gli si manda via tmux il messaggio di continuare.

Il throttle in mezzo non è un dettaglio: il cap di 100 step è spesso il sintomo di un
rabbit-hole. Rimettere in moto l'agente **immediatamente** lo rimanda nello stesso loop
e brucia budget senza produrre nulla. La pausa serve sia a spezzare il loop sia a
riportare la ripresa dentro il ritmo di pacing invece che fuori.

---

## Implementazione

### Dove

Nuovo processo `.launcher/stepcap-watchdog.py`, avviato da pid1 accanto agli altri
bridge. **Non** estendere `agent-watchdog.sh`: quel file ha una storia di post-mortem
(commento a `:106`, incidente capitano-zombie) e il parsing dei pane in bash è fragile.

### 1 — Rilevazione

Loop ogni 60s. Per ogni sessione worker (non i core: il Capitano non va nudgeato in
automatico):

```
tmux capture-pane -p -t <SESSIONE> | tail -40
```

Cerca un marcatore in una **lista configurabile per provider** — il testo cambia da CLI
a CLI, e hard-codarne uno solo rende il watchdog inutile al primo cambio di provider:

```python
STEP_CAP_MARKERS = [
    "Max number of steps reached",   # Kimi
    # aggiungere i marcatori degli altri provider man mano che si osservano
]
```

⚠️ **Il marcatore resta nello scrollback anche dopo la ripresa.** Trovarlo non basta.
Serve la doppia condizione:

- il marcatore compare nelle ultime righe **non vuote** del pane, e
- l'hash del pane è **identico** a quello del giro precedente (l'agente non sta scrivendo).

Solo allora lo stallo è confermato. Senza il secondo controllo si generano nudge a
raffica su un agente che sta lavorando normalmente.

### 2 — Throttle

Riusare l'infrastruttura esistente invece di inventarne una: scrivere
`$JHT_HOME/state/throttle-<agent>.json` nello stesso formato di `agents/_tools/jht-throttle`:

```json
{"agent":"scout-3","id":"stepcap-<ts>","until":<epoch>,"started":<epoch>,"applied_sec":<n>}
```

La durata viene dalla `THROTTLE_LADDER` di `shared/skills/throttle-config.py`, partendo
dal rung corrente dell'agente.

**Backoff su stalli ripetuti.** Se lo stesso agente sbatte sul cap più volte di fila,
non è un incidente ma un rabbit-hole strutturale:

| stallo consecutivo | azione |
|---|---|
| 1° | throttle al rung corrente, poi continua |
| 2° | throttle al rung **successivo** della ladder, poi continua |
| 3° | throttle al rung successivo, continua **e** segnala al Capitano |
| 4° | **niente continua** — escalation al Capitano, che decide se `/clear` o respawn |

Il contatore si azzera quando l'agente produce (una riga nuova in `positions`/`scores`
attribuita a lui), non semplicemente quando riparte: ripartire e rifermarsi non è
progresso.

### 3 — Ripresa via tmux

Alla scadenza di `until`, mandare il messaggio. **Non** usare `send-keys` con il testo
inline — il quoting salta al primo apice nel messaggio. Scrivere su file e usare i buffer:

```bash
printf '%s' "$MSG" > /root/.stepcap-msg
tmux load-buffer /root/.stepcap-msg
tmux paste-buffer -t "$SESSIONE"
tmux send-keys -t "$SESSIONE" Enter
```

Il messaggio segue la convenzione degli header:

```
[DA @SISTEMA A @SCOUT-3] Continua da dove ti eri fermato. Se il compito
corrente è in stallo, chiudilo e passa al successivo della coda.
```

La seconda frase è deliberata: senza di essa l'agente riprende esattamente il ramo che
lo aveva portato al cap.

### 4 — Gate da rispettare

**Non riprendere** se una qualsiasi di queste condizioni è vera:

- `team-halted.flag`, `daily-halt.flag` o `weekly-halt.flag` presenti;
- l'orario corrente è fuori dalle working hours configurate;
- il tetto di sessioni è già saturo e l'agente stava per essere terminato comunque.

Il watchdog **riprende** gli agenti, non aggira i freni di sicurezza.

### 5 — Osservabilità

Ogni decisione va su `$JHT_HOME/logs/stepcap.jsonl`, un record per evento:

```json
{"ts":<epoch>,"agent":"scout-3","event":"detected|throttled|resumed|escalated",
 "consecutive":2,"throttle_sec":600,"marker":"Max number of steps reached"}
```

Motivo esplicito: il predecessore di questo meccanismo scriveva su
`logs/idle-nudge.jsonl`, e la sua morte è stata invisibile finché non si è andati a
cercare il file **e non c'era**. Un watchdog senza log è un watchdog di cui non sai dire
se è vivo. Aggiungere il controllo di freschezza di questo file ai check del Dottore.

---

## Test di accettazione

1. **Rilevazione** — iniettare il marcatore in un pane di prova e verificare che l'evento
   `detected` compaia entro due giri.
2. **Nessun falso positivo** — un agente che lavora normalmente e che ha il marcatore
   nello scrollback da un ciclo precedente **non** deve generare eventi.
3. **Il throttle è rispettato** — fra `throttled` e `resumed` devono passare almeno
   `throttle_sec` secondi.
4. **La ripresa funziona davvero** — dopo `resumed` il pane deve cambiare hash entro un giro.
5. **Backoff** — quattro stalli consecutivi devono terminare in `escalated`, senza un
   quarto `resumed`.
6. **Gate** — con `team-halted.flag` presente, uno stallo produce `detected` ma mai `resumed`.

---

## Nota di scoping

Questo ticket risolve la **ripresa**, non la causa. Un agente che raggiunge i 100 step
sta facendo qualcosa di inefficiente, e il backoff serve a rendere il problema visibile
invece di mascherarlo con nudge infiniti. Se il contatore di escalation si accende
spesso su un ruolo specifico, il lavoro vero è sulla skill di quel ruolo — non qui.
