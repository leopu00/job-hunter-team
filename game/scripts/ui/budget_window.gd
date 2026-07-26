class_name BudgetWindow
## Lettura della finestra di consumo del provider: quanto è piena e quanto
## manca alla riapertura. Solo logica, nessun autoload e nessun nodo — così
## resta verificabile con `godot --script`, dove gli autoload non esistono.

const NEAR_LIMIT := 90.0
const FULL := 99.5

const LEVEL_NONE := "none"
const LEVEL_NEAR := "near"
const LEVEL_FULL := "full"


## Minuti alla riapertura, o -1 se non è determinabile. Il dato buono è
## l'epoch: l'orario nudo non dice di che giorno è.
static func minutes_to_reset(window: Dictionary, now_unix: float = -1.0) -> int:
	var unix: Variant = window.get("reset_at_unix")
	if not (unix is float or unix is int):
		return -1
	var now := now_unix if now_unix >= 0.0 else Time.get_unix_time_from_system()
	var left := float(unix) - now
	return -1 if left < 0.0 else int(ceil(left / 60.0))


## {level, minutes, usage} — cosa dire all'utente, se c'è qualcosa da dire.
##
## `none` copre tre casi che si assomigliano solo da fuori: finestra ancora
## comoda, nessun dato (il gioco parte prima del primo campione), e reset già
## passato con il campione vecchio. In tutti e tre tacere è corretto: un
## avviso perenne diventa rumore, e l'utente smette di leggerlo proprio il
## giorno in cui conta.
static func state_for(window: Dictionary, now_unix: float = -1.0) -> Dictionary:
	var out := {"level": LEVEL_NONE, "minutes": -1, "usage": 0.0}
	if window.is_empty():
		return out
	var usage: Variant = window.get("usage_pct")
	if not (usage is float or usage is int):
		return out
	out["usage"] = float(usage)
	if float(usage) < NEAR_LIMIT:
		return out
	var minutes := minutes_to_reset(window, now_unix)
	if minutes < 0:
		return out
	out["minutes"] = minutes
	out["level"] = LEVEL_FULL if float(usage) >= FULL else LEVEL_NEAR
	return out
