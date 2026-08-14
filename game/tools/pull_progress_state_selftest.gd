extends SceneTree
## Self-test puro del progresso materiale di `docker compose pull`.
## Esecuzione: godot --headless --path game --script \
##   res://tools/pull_progress_state_selftest.gd
##
## Riproduce il difetto #133: diciassette livelli conclusi e l'ultimo in
## estrazione. Una riga duplicata non è heartbeat; l'ingresso in Extracting e
## l'avanzamento dell'estrazione lo sono anche a byte di download invariati.

const ProgressState := preload("res://scripts/setup/pull_progress_state.gd")

var _fails: Array[String] = []
var _sections := 0


func _check(what: String, ok: bool, detail := "") -> void:
	if not ok:
		_fails.append(what + ("" if detail == "" else " — " + detail))


func _init() -> void:
	_classifier_contract()
	_seventeen_of_eighteen_contract()
	_fingerprint_contract()
	_observer_high_water_contract()
	_check("tutte le sezioni arrivate in fondo", _sections == 4,
			"%d/4" % _sections)
	if _fails.is_empty():
		print("PULL-PROGRESS-STATE-TEST PASS")
		quit(0)
	else:
		print("PULL-PROGRESS-STATE-TEST FAIL ", _fails)
		quit(1)


func _classifier_contract() -> void:
	var cases := {
		"Pulling fs layer": ProgressState.PHASE_QUEUED,
		"Waiting": ProgressState.PHASE_WAITING,
		"Downloading 12.5MB": ProgressState.PHASE_DOWNLOADING,
		"Download complete": ProgressState.PHASE_DOWNLOADED,
		"Verifying Checksum": ProgressState.PHASE_VERIFYING,
		"Extracting 4.2MB/10MB": ProgressState.PHASE_EXTRACTING,
		"Pull complete": ProgressState.PHASE_COMPLETE,
		"Already exists": ProgressState.PHASE_COMPLETE,
	}
	for status: String in cases:
		var actual := ProgressState.classify_status(status)
		_check("classifica %s" % status, actual == cases[status], actual)
	_check("Download complete non è Pull complete",
			ProgressState.classify_status("Download complete")
			!= ProgressState.PHASE_COMPLETE)
	_sections += 1


func _seventeen_of_eighteen_contract() -> void:
	# Il vecchio contatore cercava la sottostringa "complete": diciassette
	# "Download complete" diventavano quindi 17/18 anche se nessun layer aveva
	# ancora terminato verifica ed estrazione.
	var downloaded_layers := {}
	for index in 17:
		downloaded_layers["download-%02d" % index] = "Download complete"
	downloaded_layers["download-17"] = "Extracting 768MB/1024MB"
	var downloaded_state := ProgressState.classify(downloaded_layers)
	_check("17/18 opaco: Download complete non gonfia done",
			int(downloaded_state["done"]) == 0, str(downloaded_state))
	_check("17/18 opaco: extracting resta la fase materiale",
			str(downloaded_state["phase"]) == ProgressState.PHASE_EXTRACTING,
			str(downloaded_state))

	# Se diciassette layer sono invece davvero a Pull complete, il conteggio
	# resta corretto ma la fase dell'ultimo spiega perché il pull non è finito.
	var layers := {}
	for index in 17:
		layers["layer-%02d" % index] = "Pull complete"
	layers["layer-17"] = "Extracting 768MB/1024MB"
	var state := ProgressState.classify(layers)
	_check("17/18: completati reali", int(state["done"]) == 17, str(state))
	_check("17/18: totale", int(state["total"]) == 18, str(state))
	_check("17/18: fase visibile extracting",
			str(state["phase"]) == ProgressState.PHASE_EXTRACTING,
			str(state))
	_sections += 1


func _fingerprint_contract() -> void:
	var layers := {"aa": "Downloading 10 MB"}
	var bytes := {"aa": {"got": 10.0, "total": 20.0}}
	var initial := ProgressState.material_fingerprint(layers, bytes)

	# Stessa osservazione, anche con spazi cosmetici e ordine diverso: non è
	# progresso e non deve tenere vivo il timeout all'infinito.
	var duplicate_layers := {"aa": "  Downloading   10 MB  "}
	var duplicate_bytes := {"aa": {"total": 20.0, "got": 10.0}}
	var duplicate := ProgressState.material_fingerprint(
			duplicate_layers, duplicate_bytes)
	_check("duplicato: fingerprint invariato", duplicate == initial)
	_check("download: formato testo diverso non è progresso",
			ProgressState.material_fingerprint(
					{"aa": "Downloading 10.0MB"}, duplicate_bytes) == initial)

	bytes["aa"]["got"] = 10.0 + 1.0 / 1048576.0
	var advanced := ProgressState.material_fingerprint(layers, bytes)
	_check("download: un byte materiale cambia fingerprint", advanced != initial)

	# I byte di download restano completi durante verifica/estrazione: è la
	# fase, non il contatore download, a dimostrare che il pull procede.
	bytes["aa"] = {"got": 20.0, "total": 20.0}
	layers["aa"] = "Download complete"
	var downloaded := ProgressState.material_fingerprint(layers, bytes)
	layers["aa"] = "Extracting 1 MB"
	var extracting := ProgressState.material_fingerprint(layers, bytes)
	_check("extracting: cambio fase materiale a byte download fermi",
			extracting != downloaded)
	_check("extracting: non conta come livello finito",
			int(ProgressState.classify(layers)["done"]) == 0)

	var duplicate_extracting := ProgressState.material_fingerprint(
			{"aa": "Extracting 1 MB"}, bytes)
	_check("extracting duplicato: fingerprint invariato",
			duplicate_extracting == extracting)
	_check("extracting: unità equivalente non è progresso",
			ProgressState.material_fingerprint(
					{"aa": "Extracting 1.0MB"}, bytes) == extracting)
	layers["aa"] = "Extracting 2 MB"
	var extracting_advanced := ProgressState.material_fingerprint(layers, bytes)
	_check("extracting: unità avanzata cambia fingerprint",
			extracting_advanced != extracting)

	layers["aa"] = "Pull complete"
	var complete := ProgressState.material_fingerprint(layers, bytes)
	var state := ProgressState.classify(layers)
	_check("complete: transizione materiale", complete != extracting_advanced)
	_check("complete: livello finito", int(state["done"]) == 1, str(state))
	_check("complete: fase terminale",
			str(state["phase"]) == ProgressState.PHASE_COMPLETE, str(state))

	# Inserire gli stessi livelli in ordine opposto non crea un falso evento.
	var ordered_a := {"aa": "Pull complete", "bb": "Waiting"}
	var ordered_b := {"bb": "Waiting", "aa": "Pull complete"}
	_check("ordine dizionario: fingerprint stabile",
			ProgressState.material_fingerprint(ordered_a, {})
			== ProgressState.material_fingerprint(ordered_b, {}))
	_sections += 1


func _observer_high_water_contract() -> void:
	var observer := ProgressState.new()
	var layers := {"aa": "Downloading 10 MB"}
	var bytes := {"aa": {"got": 10.0, "total": 20.0}}
	var event: Dictionary = observer.observe(layers, bytes)
	_check("osservatore: il primo stato strutturato avanza",
			bool(event["changed"]) and bool(event["advanced"]), str(event))

	event = observer.observe({"aa": " Downloading 10.0MB "},
			{"aa": {"got": 10.0, "total": 20.0}})
	_check("osservatore: duplicato non cambia e non avanza",
			not bool(event["changed"]) and not bool(event["advanced"]), str(event))
	event = observer.observe(layers,
			{"aa": {"got": 10.0, "total": 21.0}})
	_check("osservatore: totale scoperto cambia ma non avanza",
			bool(event["changed"]) and not bool(event["advanced"]), str(event))

	# Un byte, non un megabyte: e' il minimo avanzamento misurabile dal parser.
	bytes["aa"]["got"] = 10.0 + 1.0 / 1048576.0
	event = observer.observe(layers, bytes)
	_check("osservatore: un byte supera l'high-water",
			bool(event["changed"]) and bool(event["advanced"]), str(event))

	bytes["aa"]["got"] = 10.0
	event = observer.observe(layers, bytes)
	_check("osservatore: byte in calo cambiano ma non avanzano",
			bool(event["changed"]) and not bool(event["advanced"]), str(event))
	bytes["aa"]["got"] = 10.0 + 1.0 / 1048576.0
	event = observer.observe(layers, bytes)
	_check("osservatore: ritorno allo stesso massimo e' stale",
			bool(event["changed"]) and not bool(event["advanced"]), str(event))

	# Entrare e avanzare in estrazione e' lavoro; oscillare sotto o sul massimo
	# gia visto non puo tenere vivo il timeout.
	bytes["aa"] = {"got": 20.0, "total": 20.0}
	event = observer.observe({"aa": "Extracting 2 MB/20 MB"}, bytes)
	_check("osservatore: ingresso extracting avanza", bool(event["advanced"]),
			str(event))
	event = observer.observe({"aa": "Extracting 1 MB/20 MB"}, bytes)
	_check("osservatore: extracting reverse non avanza",
			bool(event["changed"]) and not bool(event["advanced"]), str(event))
	event = observer.observe({"aa": "Extracting 2 MB/20 MB"}, bytes)
	_check("osservatore: oscillazione sul massimo non avanza",
			bool(event["changed"]) and not bool(event["advanced"]), str(event))
	event = observer.observe({"aa": "Extracting 3 MB/20 MB"}, bytes)
	_check("osservatore: extracting oltre il massimo avanza",
			bool(event["advanced"]), str(event))

	event = observer.observe({"aa": "Pull complete"}, bytes)
	_check("osservatore: complete avanza", bool(event["advanced"]), str(event))
	_check("osservatore: complete espone done monotono",
			int((event["state"] as Dictionary)["done"]) == 1, str(event))
	event = observer.observe({"aa": "Downloading 19 MB"},
			{"aa": {"got": 19.0, "total": 20.0}})
	_check("osservatore: complete -> downloading e' stale",
			bool(event["changed"]) and not bool(event["advanced"]), str(event))
	_check("osservatore: stato UI non regredisce dopo complete",
			int((event["state"] as Dictionary)["done"]) == 1
			and str((event["state"] as Dictionary)["phase"])
			== ProgressState.PHASE_COMPLETE, str(event))

	event = observer.observe({"aa": "messaggio opaco A"}, bytes)
	_check("osservatore: OTHER variabile resta fail-closed",
			bool(event["changed"]) and not bool(event["advanced"]), str(event))
	event = observer.observe({"aa": "messaggio opaco B"}, bytes)
	_check("osservatore: OTHER oscillante non rinnova",
			bool(event["changed"]) and not bool(event["advanced"]), str(event))
	_check("osservatore: OTHER non regredisce lo stato UI",
			int((event["state"] as Dictionary)["done"]) == 1, str(event))

	# Il producer puo annunciare la verifica dopo Download complete: e' una
	# fase causale successiva, anche se i byte di download sono gia' al totale.
	var phase_observer := ProgressState.new()
	phase_observer.observe({"bb": "Download complete"},
			{"bb": {"got": 20.0, "total": 20.0}})
	event = phase_observer.observe({"bb": "Verifying Checksum"},
			{"bb": {"got": 20.0, "total": 20.0}})
	_check("osservatore: Download complete -> Verifying avanza",
			bool(event["changed"]) and bool(event["advanced"]), str(event))
	_check("osservatore: stato high-water espone verifying",
			str((event["state"] as Dictionary)["phase"])
			== ProgressState.PHASE_VERIFYING, str(event))
	_sections += 1
