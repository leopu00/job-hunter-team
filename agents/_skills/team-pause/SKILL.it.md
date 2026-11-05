---
name: team-pause
description: "PAUSE the team (or one agent) without shutting anything down, and resume it. Open it the moment the user says «take a break», «pause», «hold on», «stop for now», «wait until I tell you», «freeze» — or «resume», «carry on», «you can start again». A pause keeps every session ON with its context; nobody works and nothing new starts until the user says to resume. It is NOT the stop: shutting the team down (`jht team stop`, `.team-halted.flag`, killing sessions) throws every agent's context away and is only for an explicit «turn the team off»."
allowed-tools: Bash(python3 /app/shared/skills/agent_control.py *), Bash(python3 /app/shared/skills/standby.py status *), Bash(python3 /app/shared/skills/agent_pause.py status *)
---

# team-pause — una pausa non è uno spegnimento

Il 05/11 l'utente ha detto all'Assistente *«fate una pausa, vi dico io quando ricominciare»*. L'Assistente ha chiesto un «controlled freeze» al Capitano; il Capitano, senza nessuna skill per la pausa, ha scritto il flag di stop e **chiuso tutte le sessioni** — ogni agente ha perso il suo contesto — e all'utente è stato detto *«Paused ✅»*. Questa skill esiste perché non succeda più: la pausa chiesta dall'utente tiene le sessioni accese e il contesto intatto, e **quello che dici all'utente è quello che dice la risposta del comando**.

## 1. Quale parola vuol dire cosa

| L'utente dice (in qualunque lingua) | Vuol dire | Cosa fai |
|---|---|---|
| «pausa», «fermatevi», «aspettate, vi dico io quando ricominciare», «congelate», «tutti fermi per ora» | **PAUSA** | §2 |
| «riprendete», «ripartite», «potete ricominciare», «via» (dopo una pausa) | **RIPRESA** | §4 |
| «metti in pausa lo Scout» / «ferma Analista-1 per un po'» | **PAUSA di un agente** | §5 |
| «spegni la squadra», «spegnete tutto», «ferma il team» *detto come spegnimento* | **STOP** — non è questa skill | di' all'utente che chiude le sessioni e fa perdere a ogni agente quello che aveva in mente; fallo solo se conferma che vuole questo |
| ambiguo («fermati», «ferma tutto») | trattalo come **PAUSA** | si può annullare e tiene il contesto; dillo, e offri lo spegnimento se intendeva quello |

**Mai** `jht team stop`, `.team-halted.flag`, `tmux kill-session` o il «freeze» del Capitano per una pausa: quelli sono lo stop.

## 2. Mettere in pausa la squadra

L'**Assistente** lancia il comando da solo (non chiedere al Capitano di improvvisare un freeze):

```bash
python3 /app/shared/skills/agent_control.py pause --until-resumed --from-assistant
```

Il **Capitano**, se l'ordine arriva a lui (un `[REQ]` che dice pausa, o l'utente che gli scrive), lancia la stessa riga **senza** `--from-assistant`. Torna una riga JSON. Leggila:

```json
{"ok": true, "op": "pause", "result": "paused",
 "detail": {"reached": ["CAPITANO","SCOUT-1", ...], "not_reached": ["SCORER-1"], "until_resumed": true}}
```

- `result: "paused"` — fatto. `"already_paused"` — lo era già; dillo.
- `detail.reached` — le sessioni che hanno ricevuto il messaggio *«chiudi il passo, annota dove sei, aspetta»*. `detail.not_reached` — sessioni vive che non hanno risposto al trasporto: **di' all'utente quali**.
- `ok: false` / `error` — **non** è successo. Dillo. Mai «in pausa» dopo un errore.

Le sessioni restano accese. Bridge e watchdog tacciono da soli (niente heartbeat, niente tick di pacing, niente refresh, niente nudge). L'Assistente **non** è in pausa: resta raggiungibile.

La pausa non ha un'ora di fine: finisce quando lo dice l'utente, con un **tetto di 7 giorni** dopo il quale la squadra riprende da sola (così una pausa dimenticata non la zittisce per sempre). Dillo una volta.

## 3. Mentre la squadra è in pausa

- **Non** svegliare il Capitano né nessun altro per richieste, ticket o risposte nuove: di' all'utente che *saranno gestite appena riprende*. Un ticket resta aperto, niente va perso.
- **Non** avviare, fermare, riavviare o creare agenti. Non toccare i throttle.
- Se ti chiedono com'è la situazione: `python3 /app/shared/skills/standby.py status` (e, per un agente, `python3 /app/shared/skills/agent_pause.py status SCOUT-1`). Le sessioni sono accese; nessuno lavora.
- Il Capitano, se sveglio: chiudi il passo, niente ordini nuovi, aspetta in silenzio.

## 4. Riprendere

```bash
python3 /app/shared/skills/agent_control.py resume
```

`result: "resumed"` — ogni sessione ha ricevuto *«riparti esattamente da dove eri»* e l'automazione è di nuovo attiva. `"not_paused"` — non c'era nessuna pausa. `error: "team_halted"` — l'utente aveva **fermato** la squadra: riprendere una pausa non la accende; dillo e offri di avviarla.

Un agente che l'utente ha messo in pausa **da solo** (§5) non viene svegliato dalla ripresa della squadra: resta in pausa finché non lo si riprende per conto suo.

## 5. Un agente solo

```bash
python3 /app/shared/skills/agent_control.py pause-agent SCOUT-1
python3 /app/shared/skills/agent_control.py resume-agent SCOUT-1
```

Il resto della squadra continua a lavorare. `error: "agent_not_running"` — quella sessione non è accesa; `"agent_contained"` — qualcuno l'ha fermata di proposito: dillo, non forzarla. Fermare o riavviare un agente ne cancella la pausa.

## 6. Cosa dici all'utente — solo quello che è successo

Dopo la pausa (adatta le parole, tieni i fatti):

> La squadra è in pausa. I N agenti sono ancora accesi e ognuno tiene a mente quello che stava facendo; nessuno lavora finché non mi dici di riprendere, e non è stato spento niente. Resto qui. (Se `not_reached`: «X non ha risposto, non sono riuscito ad avvisarlo.»)

Dopo la ripresa: *«Fatto: ognuno riparte da dove era.»* Dopo un errore: *cosa non ha funzionato*, e in che stato è la squadra (`standby.py status`).

## Anti-pattern

- ❌ «Paused ✅» senza la risposta del comando. La parola viene da `result`, i numeri da `detail`.
- ❌ Chiedere al Capitano di «applicare un controlled freeze» e riferire la sua risposta come la pausa. Il Capitano senza skill ha scritto il flag di stop.
- ❌ `jht team stop`, `.team-halted.flag`, `kill-session`, `freeze_team.py` (Esc a ogni pane) per una pausa.
- ❌ Svegliare la squadra per un ticket durante una pausa.
- ❌ Fare dello spegnimento il comportamento di default per «ferma tutto»: fa perdere il contesto a ogni agente.

## Vedi anche

- `graceful-shutdown` — chiudere la giornata quando l'utente esce dall'applicazione (un'altra cosa: gli agenti vengono chiusi).
- `throttle-distribution` — rallentare gli agenti al passo del budget (una pausa non è un throttle).
