class_name HeadlessSession
## L'uscita che NON spegne il team, e il modo di accorgersene al ritorno.
##
## Il gioco è una finestra sul team, non il team: gli agenti vivono in sessioni
## tmux dentro il container, e nessun client le tiene in piedi. È esattamente
## quello che fa la CLI — `jht team start` le apre e se ne va, il team resta —
## e questa terza via all'uscita non inventa niente: si limita a NON eseguire
## i comandi di spegnimento. Chiudere la finestra torna a essere una cosa sola
## (chiudo io) invece di due (chiudo io e fermo loro).
##
## Qui vive la decisione, non il disegno: quale modo di uscita ferma il team,
## dove si segna che è rimasto acceso, e quanto tempo ha lavorato da solo.
## Nessun nodo e nessun autoload, come BudgetWindow: resta verificabile con
## `godot --script`, dove gli autoload non esistono.

## I modi di uscire, nell'ordine in cui il dialogo li offre. `DETACH` è l'unico
## che lascia vivo il container; `CANCEL` non esce affatto.
const MODE_GRACEFUL := "graceful"
const MODE_DETACH := "detach"
const MODE_FORCED := "forced"
const MODE_CANCEL := "cancel"

## Il marcatore "sono uscito lasciandoli al lavoro". Sta fra le preferenze del
## gioco e non nel container: descrive come ha chiuso QUESTA finestra, che è
## una cosa del gioco, non del team.
const CFG := "user://headless.cfg"

## Oltre una settimana il marcatore non racconta più un rientro ma un residuo
## (container spento nel frattempo, marcatore mai consumato): dire "hanno
## lavorato senza di te per ventun giorni" sarebbe falso, e tacere è meglio.
const MAX_AGE_S := 604800


## L'unico bivio che conta nel percorso di uscita. Vive qui, e non in un `if`
## dentro game.gd, perché è la riga che un domani si può sbagliare senza che
## nessuno se ne accorga: il team si spegnerebbe lo stesso e l'utente lo
## scoprirebbe la mattina dopo, dal lavoro non fatto.
static func stops_team(mode: String) -> bool:
	return mode != MODE_DETACH and mode != MODE_CANCEL


## Segna (o cancella) come si è usciti. Cancellare quando NON si è staccati è
## parte del contratto: un marcatore vecchio farebbe salutare al ritorno un
## lavoro notturno che non c'è stato.
static func record_exit(detached: bool, now_unix := -1.0) -> void:
	if not detached:
		clear()
		return
	var cfg := ConfigFile.new()
	cfg.set_value("headless", "detached_at",
			now_unix if now_unix >= 0.0 else Time.get_unix_time_from_system())
	cfg.save(CFG)


## Quando si è usciti lasciandoli al lavoro, 0.0 se non è successo.
static func detached_at() -> float:
	var cfg := ConfigFile.new()
	if cfg.load(CFG) != OK:
		return 0.0
	return float(cfg.get_value("headless", "detached_at", 0.0))


static func clear() -> void:
	if FileAccess.file_exists(CFG):
		DirAccess.remove_absolute(CFG)


## {show, seconds} — c'è qualcosa da dire al ritorno?
##
## Serve che siano vere due cose insieme: che si sia usciti lasciandoli al
## lavoro, e che qualcuno stia effettivamente lavorando adesso. Con l'ufficio
## vuoto il saluto sarebbe una bugia: il container può essere stato fermato da
## fuori, o il team può essere finito in stallo mentre nessuno guardava.
static func state_for(marker_unix: float, agents_alive: int,
		now_unix: float) -> Dictionary:
	var out := {"show": false, "seconds": 0}
	if marker_unix <= 0.0 or agents_alive <= 0:
		return out
	var seconds := int(maxf(0.0, now_unix - marker_unix))
	if seconds > MAX_AGE_S:
		return out
	out["seconds"] = seconds
	out["show"] = true
	return out


## Durata leggibile. Sotto il minuto si dice comunque "1 min": "0 min" farebbe
## sembrare che non sia successo niente.
static func duration_text(seconds: int) -> String:
	var minutes := maxi(1, int(round(float(seconds) / 60.0)))
	if minutes < 60:
		return UIStrings.t("headless.dur_min") % minutes
	return UIStrings.t("headless.dur_hour") % [minutes / 60, minutes % 60]
