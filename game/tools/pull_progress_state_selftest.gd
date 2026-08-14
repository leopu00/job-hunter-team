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


func _check(what: String, ok: bool, detail := "") -> void:
	if not ok:
		_fails.append(what + ("" if detail == "" else " — " + detail))


func _init() -> void:
	_classifier_contract()
	_seventeen_of_eighteen_contract()
	_fingerprint_contract()
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


func _seventeen_of_eighteen_contract() -> void:
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

	bytes["aa"]["got"] = 11.0
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
