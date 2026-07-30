class_name BurnMode
## Lettura della deroga utente agli automatismi di spesa: il flag
## `$JHT_HOME/.burn-intent.flag` governato da `shared/skills/burn_intent.py`.
##
## Solo logica, nessun nodo e nessun autoload — come BudgetWindow resta
## verificabile con `godot --script`, dove gli autoload non esistono.
##
## Il motivo per cui questo file non tiene NESSUNO stato proprio: la deroga
## scade da sola e il Capitano può revocarla. Un interruttore che ricorda
## l'ultimo click dell'utente comincia a mentire entro cinque ore, e mente
## proprio nella direzione pericolosa ("è ancora accesa" quando non lo è più,
## oppure "l'ho spenta" quando il flag è rimasto). Lo stato si legge, sempre.


## Stati mostrabili. `unknown` e `unsupported` non sono `off`: "il freno è
## attivo" e "non so se il freno è attivo" meritano risposte diverse, e
## fonderli sarebbe la stessa deduzione che questo file esiste per evitare.
const STATE_OFF := "off"
const STATE_ACTIVE := "active"
const STATE_UNKNOWN := "unknown"
const STATE_UNSUPPORTED := "unsupported"

## Sotto questa soglia la scadenza è imminente e va detta in evidenza: chi
## legge "attiva" e trova il ritmo normale mezz'ora dopo deve poterlo prevedere.
const EXPIRING_SOON_SEC := 900

## Specchio di DEFAULT_HOURS / MAX_HOURS di burn_intent.py. Il container resta
## la fonte di verità (li rispedisce a ogni lettura): questi valori servono
## solo finché non ha ancora risposto. burn_mode_selftest.gd verifica che la
## copia coincida con il sorgente Python.
const DEFAULT_HOURS := 5
const MAX_HOURS := 12

## Specchio di NEVER_YIELDS: i freni che non cedono nemmeno in deroga.
## Elencarli È metà dell'avviso all'utente, quindi la copia non può divergere:
## anche questa la controlla burn_mode_selftest.gd contro il sorgente Python.
const NEVER_YIELDS := ["weekly-halt", "host_agent_cap", "SC-09", "freeze_team"]


## {state, remaining_sec, expiring_soon, never_yields, max_hours, error}
## a partire dal payload pubblicato dal backend.
##
## `now_msec` è passato esplicitamente per gli stessi motivi di BudgetWindow:
## un test che dipende dall'orologio passa o fallisce a seconda di quando lo
## si esegue.
static func state_for(payload: Dictionary, now_msec: float = -1.0) -> Dictionary:
	var out := {
		"state": STATE_UNKNOWN,
		"remaining_sec": 0,
		"expiring_soon": false,
		"never_yields": NEVER_YIELDS.duplicate(),
		"max_hours": MAX_HOURS,
		"default_hours": DEFAULT_HOURS,
		"error": "",
	}
	if payload.is_empty():
		return out
	out["error"] = str(payload.get("error", ""))
	# Il backend non ha potuto leggere il flag (container giù, SSH muto). Non
	# è "spenta": è "non lo so", e l'interruttore deve restare fermo.
	if not bool(payload.get("readable", false)):
		return out
	# Deploy sfasato: il gioco può essere più nuovo dell'immagine del container
	# per qualche minuto. Meglio dirlo che offrire un interruttore che non
	# comanda nulla (stessa cautela di COORDINATOR_STATE_PY).
	if not bool(payload.get("supported", true)):
		out["state"] = STATE_UNSUPPORTED
		return out
	# I nomi dei freni e i limiti li DICE il container: se un giorno la lista
	# cambia in burn_intent.py, l'avviso cambia con lei senza passare di qui.
	var yields: Array = payload.get("never_yields", [])
	if not yields.is_empty():
		out["never_yields"] = yields.duplicate()
	if payload.get("max_hours") != null:
		out["max_hours"] = int(payload["max_hours"])
	if payload.get("default_hours") != null:
		out["default_hours"] = int(payload["default_hours"])
	if not bool(payload.get("active", false)):
		out["state"] = STATE_OFF
		return out
	# La scadenza si conta dal MOMENTO DELLA LETTURA, non dall'orologio del
	# gioco: fra host e container il fuso e l'ora possono differire, mentre un
	# delta in secondi non richiede che i due parlino la stessa lingua sui
	# timestamp. Il container manda quanto manca, noi sottraiamo quanto è
	# passato da quando ce l'ha detto.
	var elapsed := 0.0
	var received: Variant = payload.get("received_msec")
	if received != null:
		var now := now_msec if now_msec >= 0.0 else float(Time.get_ticks_msec())
		elapsed = maxf(0.0, (now - float(received)) / 1000.0)
	var remaining := maxf(0.0, float(payload.get("remaining_sec", 0)) - elapsed)
	if remaining <= 0.0:
		# Scaduta mentre la pagina era aperta. Il flag può esistere ancora
		# (lo spazza il sentinel-bridge) ma non vale più nulla: `is_active()`
		# lato Python risponde già False, e l'interruttore deve dire lo stesso.
		out["state"] = STATE_OFF
		return out
	out["state"] = STATE_ACTIVE
	out["remaining_sec"] = int(remaining)
	out["expiring_soon"] = remaining <= float(EXPIRING_SOON_SEC)
	return out


## "4 h 12 min" / "38 min" — quanto manca, in unità che l'utente possa
## confrontare con la propria serata. Sotto il minuto si smette di contare:
## un countdown al secondo su una deroga di ore è solo agitazione.
static func remaining_text(seconds: int) -> String:
	if seconds >= 3600:
		var minutes := (seconds % 3600) / 60
		# "5 h 0 min" è la prima cosa che si legge appena concessa la deroga,
		# e sembra un bug più che un'ora tonda.
		if minutes == 0:
			return UIStrings.t("burn.left_h") % str(seconds / 3600)
		return UIStrings.t("burn.left_hm") % [str(seconds / 3600), str(minutes)]
	if seconds >= 60:
		return UIStrings.t("burn.left_m") % str(seconds / 60)
	return UIStrings.t("burn.left_soon")
