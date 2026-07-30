# TICKET — Throttle fuori dal dominio degli agenti: motore Python, notifica tmux, flag di stato

**Stato**: da implementare · **Tag**: `[THROTTLE-ENGINE-EXTERNAL]` ·
**Decisione utente**: 2026-07-30 ·
**Correlato**: `[STEPCAP-THROTTLE-RESUME]`, `[TMUX-SEND-LOST-ENTER-ON-CLAUDE]`

---

## Problema

Oggi il throttle è un contratto che l'agente deve onorare da solo: chiama `jht-throttle`,
che **blocca il suo stesso processo** con un loop di sleep, e se il processo muore deve
accorgersene e ribloccarsi con `jht-throttle-wait`. Le failure mode osservate in
produzione sono tutte figlie di questo disegno:

- **2026-07-30, stallo di 2h15m**: un Analista ha lanciato `jht-throttle … &` dentro un
  comando composito ucciso dal timeout della tool call (60s). Il figlio detached è morto
  col parent, l'agente ha chiuso il turno convinto che «the detached throttle child
  survives» — e nessuno l'ha più svegliato. Il watchdog lo classificava `idle` = sano.
- Gli agenti conoscono la propria durata di attesa e la gestiscono in proprio: ogni
  variante di implementazione (blocco in-turn, background task, detached) ha una
  semantica diversa, e solo una è corretta.
- Il coordinatore per cambiare i ritmi deve scrivere config che gli agenti rileggono
  «quando capita»: nessuna garanzia di quando il nuovo valore morde.

## Il disegno deciso dall'utente

**Il tempo esce dal dominio dell'agente.** L'agente non sa quanto aspetta e non deve
saperlo: si registra e resta fermo finché non viene svegliato.

```
AGENTE                      MOTORE (python, fuori dall'agente)
  |                            |
  |-- skill: throttle <me> --->|  legge config/throttle.json per <me>  (es. scout-1=600s)
  |                            |  scrive flag di stato: <me> = IN_THROTTLE
  |   (l'agente chiude il      |  arma un timer di 600s  (processo del motore,
  |    turno e non fa NULLA)   |   NON figlio della shell dell'agente)
  |                            |
  |<-- notifica tmux ----------|  timer scaduto → flag = NOTIFIED → messaggio di risveglio
  |                            |
  |-- skill: throttle-ack ---->|  L'AGENTE cambia il flag: NOTIFIED → ACTIVE
  |   (primo atto al risveglio)|
```

### Il punto chiave: il flag lo chiude l'agente, non il motore

Il motore mette `IN_THROTTLE` e poi `NOTIFIED`. Il passaggio a `ACTIVE` è **solo
dell'agente**, via skill, come primo atto dopo il risveglio. Questo trasforma il flag in
una **prova di reattività**: se un flag resta `NOTIFIED` oltre una soglia, l'agente ha
ricevuto la sveglia e non ha risposto — non è «forse idle», è **certamente bloccato**.

È la risposta strutturale al buco che tutti i watchdog attuali condividono: `idle` e
`bloccato` sono indistinguibili guardando il pane. Con la macchina a stati diventano
tre condizioni misurabili e deterministiche:

| flag | significato | anomalia se dura troppo |
|---|---|---|
| `IN_THROTTLE` | attesa legittima | no (durata nota al motore) |
| `NOTIFIED` | sveglia inviata, ack atteso | **sì → escalation dopo N min** |
| `ACTIVE` | agente operativo | valutare col progresso DB |

### Il coordinatore governa i ritmi senza toccare gli agenti

Skill dedicata del Capitano che modifica `config/throttle.json` per agente. Il motore
legge il valore **all'armamento di ogni timer**, quindi un cambio morde al ciclo
successivo dell'agente — senza messaggi, senza rilettura da parte dei worker, senza che
i worker sappiano nulla. `effective()` (floor, ladder, burn-intent) resta nel motore:
gli agenti non vedono mai un numero.

## Implementazione

### Componenti

1. **`shared/skills/throttle_engine.py`** — il motore. Un daemon avviato da pid1 accanto
   ai bridge (NON un processo per timer figlio di shell agente: è esattamente il difetto
   da eliminare). Stato su disco in `$JHT_HOME/state/throttle-flags.json` (un oggetto per
   agente: `{state, since, until, timer_armed_at}`), così un crash/respawn del daemon
   **rilegge i timer pendenti e li ri-arma** — nessun throttle perso per un riavvio.
2. **Skill agente `throttle`** (sostituisce l'attuale `jht-throttle`): una chiamata,
   `throttle <agent-id>`, ritorno immediato. Niente sleep, niente `&`, niente wait.
3. **Skill agente `throttle-ack`**: `throttle-ack <agent-id>`, flip `NOTIFIED→ACTIVE`.
   Da prompt di ruolo: «primo comando di ogni risveglio».
4. **Skill Capitano `throttle-set`**: wrapper su `throttle-config.py` (che già esiste
   con bulk-set/get/ladder) — resta la sola superficie di scrittura.

### La notifica di risveglio

Via il sender protetto (`jht-tmux-send`), **mai** `send-keys` nudo — vedi
`[TMUX-SEND-LOST-ENTER-ON-CLAUDE]`: un Enter a freddo non viene processato e il
messaggio resta nel prompt rendendo il pane finto-occupato. Il motore deve verificare
dopo l'invio che il prompt si sia svuotato, e ritentare (bounded) se no. Ogni invio va
loggato su `logs/throttle-engine.jsonl`.

### Migrazione

- `jht-throttle` / `jht-throttle-wait` / `jht-throttle-check` diventano shim che
  chiamano il motore (compat per le skill esistenti), poi si ritirano dai prompt.
- `pace_guard` e Sentinella smettono di *scrivere* il throttle (già solo-consiglio su
  master): la scrittura passa esclusivamente dalla skill del Capitano.
- Lo `stepcap-watchdog` acquisisce il controllo `NOTIFIED > N min → escalation` — è il
  segnale che gli mancava per distinguere idle da stallo.

## Test di accettazione

1. **Timer sopravvive alla morte dell'agente**: killare la shell dell'agente durante
   `IN_THROTTLE` → la notifica arriva comunque alla scadenza.
2. **Timer sopravvive al riavvio del motore**: kill del daemon a metà attesa → dopo il
   respawn la notifica arriva alla scadenza originale (stato su disco).
3. **Ack mancato = escalation**: sopprimere l'ack di un agente di prova → entro N min
   il watchdog escala; il flag `NOTIFIED` con timestamp è la prova.
4. **Cambio ritmo senza toccare l'agente**: `throttle-set scout-1 120` a metà attesa →
   il ciclo *successivo* dura 120s; quello in corso non viene alterato.
5. **Notifica robusta**: agente con testo pendente simulato nel prompt → la notifica
   viene comunque consegnata (Space+Enter / verifica post-invio), non persa in silenzio.
6. **Burn-intent**: con deroga attiva, valori sotto il floor passano; senza, il motore
   applica floor+ladder — gli agenti non cambiano di una riga.
