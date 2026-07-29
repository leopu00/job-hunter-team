extends SceneTree
## L'interruttore della deroga alla spesa deve dire lo STATO DEL FLAG, non
## l'ultima intenzione dell'utente: la deroga scade da sola e il Capitano può
## revocarla, quindi "acceso perché l'ho acceso io" è già una bugia dopo
## cinque ore — e mente nella direzione peggiore, quella che fa credere
## all'utente che i freni siano ancora giù.
##
## Il tempo è passato esplicitamente (come in budget_notice_selftest): un test
## che dipende dall'orologio passa o fallisce a seconda di quando lo si esegue.
##
## La seconda metà di questo file è documentazione ESEGUIBILE. L'avviso che
## l'utente legge prima di attivare NOMINA i quattro freni che non cedono e il
## tetto di ore: sono copiati da shared/skills/burn_intent.py, e una copia che
## diverge dal sorgente trasforma un avviso onesto in una rassicurazione
## falsa. Qui la copia viene confrontata con il Python vero.

const MSEC := 1000.0


func _init() -> void:
	var fails: Array[String] = []
	UIStrings.lang = "it"   # le stringhe attese sotto sono quelle di riferimento

	# ── Lo stato che si legge, e i tre modi di non saperlo ────────────
	var casi := [
		# [descrizione, payload, now_msec, stato atteso, secondi attesi, scadenza vicina]
		["mai letto → non lo so (NON 'spenta')",
			{}, 0.0, BurnMode.STATE_UNKNOWN, 0, false],
		["container muto → non lo so, il freno potrebbe essere giù",
			{"readable": false, "error": "ssh muto"}, 0.0,
			BurnMode.STATE_UNKNOWN, 0, false],
		["immagine più vecchia del gioco → non disponibile, non 'spenta'",
			{"readable": true, "supported": false}, 0.0,
			BurnMode.STATE_UNSUPPORTED, 0, false],
		["flag assente → spenta, il team si autoregola",
			{"readable": true, "supported": true, "active": false}, 0.0,
			BurnMode.STATE_OFF, 0, false],
		["deroga fresca → attiva, un'ora davanti",
			{"readable": true, "supported": true, "active": true,
				"remaining_sec": 3600, "received_msec": 0}, 0.0,
			BurnMode.STATE_ACTIVE, 3600, false],
		["dieci minuti alla fine → attiva ma in scadenza",
			{"readable": true, "supported": true, "active": true,
				"remaining_sec": 3600, "received_msec": 0}, 3000.0 * MSEC,
			BurnMode.STATE_ACTIVE, 600, true],
		["scaduta mentre la pagina era aperta → spenta senza richiedere nulla",
			{"readable": true, "supported": true, "active": true,
				"remaining_sec": 3600, "received_msec": 0}, 3600.0 * MSEC,
			BurnMode.STATE_OFF, 0, false],
		["orologio indietro → mai un residuo cresciuto per magia",
			{"readable": true, "supported": true, "active": true,
				"remaining_sec": 600, "received_msec": 5000}, 0.0,
			BurnMode.STATE_ACTIVE, 600, true],
	]
	for caso in casi:
		var got := BurnMode.state_for(caso[1], caso[2])
		if str(got["state"]) != str(caso[3]):
			fails.append("%s — stato %s invece di %s" % [caso[0], got["state"], caso[3]])
		elif int(got["remaining_sec"]) != int(caso[4]):
			fails.append("%s — %d s invece di %d" % [caso[0], got["remaining_sec"], caso[4]])
		elif bool(got["expiring_soon"]) != bool(caso[5]):
			fails.append("%s — scadenza vicina %s invece di %s"
					% [caso[0], got["expiring_soon"], caso[5]])

	# L'errore di lettura arriva fino alla UI: "non lo so" senza il perché
	# manda l'utente a indovinare se il team è giù o se è la deroga a mancare.
	var muto := BurnMode.state_for({"readable": false, "error": "ssh muto"})
	if str(muto["error"]) != "ssh muto":
		fails.append("il motivo della lettura fallita non arriva alla UI: %s" % muto)

	# I nomi dei freni li dice il CONTAINER: se un giorno la lista cambia in
	# burn_intent.py, l'avviso cambia con lei senza una release del gioco.
	var dal_container := BurnMode.state_for({"readable": true, "supported": true,
			"active": false, "never_yields": ["solo-questo"], "max_hours": 3})
	if dal_container["never_yields"] != ["solo-questo"]:
		fails.append("la lista dei freni non viene dal container: %s" % dal_container)
	if int(dal_container["max_hours"]) != 3:
		fails.append("il tetto di ore non viene dal container: %s" % dal_container)
	# …ma se il container non l'ha detta, si mostra la copia locale e non un
	# elenco vuoto: un avviso senza i quattro nomi non è più quell'avviso.
	var senza := BurnMode.state_for({"readable": true, "supported": true,
			"active": false})
	if senza["never_yields"] != BurnMode.NEVER_YIELDS:
		fails.append("senza risposta dal container manca l'elenco dei freni: %s" % senza)

	# ── Quanto manca, detto in unità che l'utente sa confrontare ──────
	for caso in [[4320, "1 h 12 min"], [18000, "5 h"], [2280, "38 min"],
			[30, "meno di un minuto"], [0, "meno di un minuto"]]:
		var got_text := BurnMode.remaining_text(int(caso[0]))
		if got_text != str(caso[1]):
			fails.append("residuo di %d s reso come «%s» invece di «%s»"
					% [caso[0], got_text, caso[1]])

	fails.append_array(_check_mirrors_python())

	if fails.is_empty():
		print("BURN-MODE-TEST PASS")
		quit(0)
	else:
		print("BURN-MODE-TEST FAIL ", fails)
		quit(1)


## Il confronto con il sorgente Python. Non è pedanteria: `NEVER_YIELDS`,
## DEFAULT_HOURS e MAX_HOURS finiscono TESTUALMENTE nell'avviso che l'utente
## legge prima di togliersi i freni di spesa. Se la lista Python cresce e la
## copia GDScript resta indietro, l'avviso continua a promettere quattro reti
## di sicurezza mentre il modulo ne conosce cinque — e nessuno se ne accorge,
## perché il gioco non fallisce: mente e basta.
func _check_mirrors_python() -> Array[String]:
	var fails: Array[String] = []
	var path := ProjectSettings.globalize_path("res://").path_join(
			"../shared/skills/burn_intent.py").simplify_path()
	var source := FileAccess.get_file_as_string(path)
	if source == "":
		fails.append("sorgente Python non leggibile (%s): la copia di "
				% path + "NEVER_YIELDS non è verificabile")
		return fails

	var tuple := RegEx.new()
	tuple.compile('NEVER_YIELDS\\s*=\\s*\\(([^)]*)\\)')
	var found := tuple.search(source)
	if found == null:
		fails.append("NEVER_YIELDS non trovata in burn_intent.py")
	else:
		var quoted := RegEx.new()
		quoted.compile('"([^"]+)"')
		var python_names := []
		for m in quoted.search_all(found.get_string(1)):
			python_names.append(m.get_string(1))
		if python_names != BurnMode.NEVER_YIELDS:
			fails.append("NEVER_YIELDS divergente — Python %s, gioco %s"
					% [python_names, BurnMode.NEVER_YIELDS])

	fails.append_array(_check_number(source, "DEFAULT_HOURS",
			BurnMode.DEFAULT_HOURS))
	fails.append_array(_check_number(source, "MAX_HOURS", BurnMode.MAX_HOURS))
	return fails


func _check_number(source: String, name: String, mirrored: int) -> Array[String]:
	var out: Array[String] = []
	var regex := RegEx.new()
	regex.compile(name + '\\s*=\\s*([0-9]+(?:\\.[0-9]+)?)')
	var found := regex.search(source)
	if found == null:
		out.append("%s non trovata in burn_intent.py" % name)
		return out
	var python_value := float(found.get_string(1))
	if not is_equal_approx(python_value, float(mirrored)):
		out.append("%s divergente — Python %s, gioco %d"
				% [name, found.get_string(1), mirrored])
	return out
