extends SceneTree
## Self-test headless della barra di avanzamento dell'attivazione.
## Esecuzione: godot --headless --path game --script res://tools/setup_progress_selftest.gd
##
## La barra ha tre promesse: percentuale SOLO dove il dato esiste (byte del
## pull), mai sembrare morta (stallo dichiarato dopo 10s di silenzio), mai
## ereditare il pieno della fase precedente. Qui si inietta la sequenza che
## un pull vero attraversa — nessun dato → 0% → 40% → 40s di silenzio →
## ripresa → 100% → fase successiva — e si verifica cosa la UI racconta.
##
## In più si verifica la contabilità dei byte dello stream: le righe
## "Extracting x/y" riportano byte DECOMPRESSI e non devono gonfiare il
## totale di download; "Download complete" blocca il livello sul suo totale.

var _fails: Array[String] = []
var _sections := 0
const EVENT_SENTINEL := -123456789


func _check(what: String, ok: bool, detail := "") -> void:
	if not ok:
		_fails.append(what + ("" if detail == "" else " — " + detail))


func _init() -> void:
	# Il widget ha bisogno di un albero attivo perché scatti _ready: il corpo
	# del test parte al primo frame. Il watchdog evita che un errore a metà
	# lasci il processo appeso senza verdetto.
	create_timer(30.0).timeout.connect(func() -> void:
		print("SETUP-PROGRESS-TEST FAIL [timeout]")
		quit(2))
	process_frame.connect(_run, CONNECT_ONE_SHOT)


func _run() -> void:
	var w := SetupProgress.new()
	root.add_child(w)

	# Fase motore: nessun dato di avanzamento → attività, non percentuale.
	w.apply_phase("container", "engine")
	_check("motore: barra indeterminata", w._bar.fraction < 0.0)
	_check("motore: la fase dice che non c'è percentuale",
			w._detail_lbl.text == UIStrings.t("setup.progress_no_meter"),
			w._detail_lbl.text)
	_check("motore: contatore fase 1 di 3",
			w._phase_lbl.text.contains("1") and w._phase_lbl.text.contains("3"),
			w._phase_lbl.text)

	# Pull partito, docker dichiara le dimensioni: percentuale reale.
	w.apply_phase("container", "image")
	w.apply_progress({"got_mb": 0.0, "total_mb": 3200.0,
			"fraction": 0.0, "layers": 12, "advanced": true})
	_check("pull 0%: barra a zero", is_equal_approx(w._bar.fraction, 0.0))
	_check("pull 0%: percentuale a video", w._detail_lbl.text.contains("0%"),
			w._detail_lbl.text)
	w.apply_progress({"got_mb": 1280.0, "total_mb": 3200.0,
			"fraction": 0.4, "layers": 12,
			"done_layers": 7, "phase": "downloading", "advanced": true})
	_check("pull 40%: barra a 0.4", is_equal_approx(w._bar.fraction, 0.4))
	_check("pull 40%: percentuale a video", w._detail_lbl.text.contains("40%"),
			w._detail_lbl.text)
	_check("pull 40%: GB scaricati/totali a video",
			w._detail_lbl.text.contains("GB"), w._detail_lbl.text)
	_check("pull 40%: fase e layer reali a video",
			w._detail_lbl.text.contains(
					UIStrings.t("setup.pull_phase_downloading"))
			and w._detail_lbl.text.contains("7/12"), w._detail_lbl.text)

	# Una ristampa identica non e' un evento di vita; la transizione di stage
	# agli stessi byte invece deve aggiornare subito testo e heartbeat UI.
	w._last_event_ms = EVENT_SENTINEL
	w.apply_progress({"got_mb": 1280.0, "total_mb": 3200.0,
			"fraction": 0.4, "layers": 12,
			"done_layers": 7, "phase": "downloading", "advanced": true})
	_check("duplicato UI: heartbeat invariato",
			w._last_event_ms == EVENT_SENTINEL, str(w._last_event_ms))
	# Anche un redraw reale (totale appena scoperto) non e' un heartbeat.
	w.apply_progress({"got_mb": 1280.0, "total_mb": 3300.0,
			"fraction": 1280.0 / 3300.0, "layers": 12,
			"done_layers": 7, "phase": "downloading", "advanced": false})
	_check("redraw total-only: heartbeat sentinella invariato",
			w._last_event_ms == EVENT_SENTINEL, str(w._last_event_ms))

	w.apply_progress({"got_mb": 1280.0, "total_mb": 3300.0,
			"fraction": 1280.0 / 3300.0, "layers": 12,
			"done_layers": 7, "phase": "downloaded", "advanced": true})
	_check("stage UI: downloaded resta non terminale",
			w._bar.fraction < 0.0 and w._detail_lbl.text.contains(
					UIStrings.t("setup.pull_phase_downloaded")), w._detail_lbl.text)
	w._last_event_ms = EVENT_SENTINEL
	w.apply_progress({"got_mb": 1280.0, "total_mb": 3300.0,
			"fraction": 1280.0 / 3300.0, "layers": 12,
			"done_layers": 7, "phase": "verifying", "advanced": true})
	_check("stage UI: downloaded -> verifying rinnova heartbeat",
			w._last_event_ms != EVENT_SENTINEL, str(w._last_event_ms))
	w._last_event_ms = EVENT_SENTINEL
	w.apply_progress({"got_mb": 1280.0, "total_mb": 3200.0,
			"fraction": 0.4, "layers": 12,
			"done_layers": 7, "phase": "extracting", "advanced": true})
	_check("stage UI: stessi byte ma heartbeat rinnovato",
			w._last_event_ms != EVENT_SENTINEL, str(w._last_event_ms))
	_check("stage UI: extracting visibile",
			w._detail_lbl.text.contains(UIStrings.t("setup.pull_phase_extracting")),
			w._detail_lbl.text)
	_check("stage UI: extracting usa barra attivita", w._bar.fraction < 0.0)
	# 40 secondi senza eventi: la barra DEVE dirlo, non restare immobile.
	w._last_event_ms -= 40000
	w._tick()
	_check("stallo: avviso visibile", w._stall_lbl.visible)
	_check("stallo: i secondi di silenzio sono scritti",
			w._stall_lbl.text.contains("40"), w._stall_lbl.text)

	# Un nuovo evento riparte il contatore e spegne l'avviso.
	w.apply_progress({"got_mb": 1300.0, "total_mb": 3200.0,
			"fraction": 0.406, "layers": 12,
			"done_layers": 7, "phase": "extracting", "advanced": true})
	_check("ripresa: avviso di stallo spento", not w._stall_lbl.visible)

	# ETA solo con rate misurato davvero: finestra corta → niente numero.
	w._samples = [[0, 100.0], [10000, 200.0]]
	_check("rate misurato su 10s", is_equal_approx(w._measured_rate(), 10.0),
			str(w._measured_rate()))
	w._samples = [[0, 100.0], [3000, 200.0]]
	_check("finestra corta: nessun rate", w._measured_rate() == 0.0)

	# 100% e passaggio di fase: il pieno NON si eredita.
	w.apply_progress({"got_mb": 3200.0, "total_mb": 3200.0,
			"fraction": 1.0, "layers": 12,
			"done_layers": 12, "phase": "complete", "advanced": true})
	_check("pull 100%: barra piena", is_equal_approx(w._bar.fraction, 1.0))
	w.apply_progress({"got_mb": 1300.0, "total_mb": 3200.0,
			"fraction": 0.406, "layers": 12,
			"done_layers": 7, "phase": "downloading", "advanced": false})
	_check("snapshot stale: terminale high-water resta visibile",
			is_equal_approx(w._bar.fraction, 1.0)
			and w._detail_lbl.text.contains(UIStrings.t("setup.pull_phase_complete"))
			and w._detail_lbl.text.contains("12/12")
			and w._detail_lbl.text.contains("100%"), w._detail_lbl.text)
	w.apply_phase("container", "container")
	_check("fase nuova: barra di nuovo indeterminata", w._bar.fraction < 0.0)

	# Pull SENZA totale (docker moderni su pipe non dichiarano mai la
	# dimensione): niente percentuale né ETA, ma i byte scaricati SÌ —
	# "890 MB scaricati" batte una barra muta.
	w.apply_phase("container", "image")
	w.apply_progress({"got_mb": 890.0, "total_mb": 0.0,
			"fraction": -1.0, "layers": 14, "advanced": true})
	_check("pull cieco: barra indeterminata", w._bar.fraction < 0.0)
	_check("pull cieco: i byte scaricati sono a video",
			w._detail_lbl.text.contains("890 MB"), w._detail_lbl.text)
	_check("pull cieco: nessuna percentuale",
			not w._detail_lbl.text.contains("%"), w._detail_lbl.text)
	_check("pull cieco: nessuna ETA",
			not w._detail_lbl.text.contains(
					UIStrings.t("setup.progress_eta").split("%")[0].strip_edges()),
			w._detail_lbl.text)
	# Col rate misurato (due campioni oltre la finestra) compare anche il MB/s.
	w.apply_progress({"got_mb": 950.0, "total_mb": 0.0,
			"fraction": -1.0, "layers": 14, "advanced": true})
	w._samples = [[0, 100.0], [10000, 200.0]]
	w._refresh()
	_check("pull cieco: rate misurato a video",
			w._detail_lbl.text.contains("MB/s"), w._detail_lbl.text)

	_bytes_accounting()
	_formats()
	_check("sezioni helper arrivate in fondo", _sections == 2,
			"%d/2" % _sections)

	if _fails.is_empty():
		print("SETUP-PROGRESS-TEST PASS")
		quit(0)
	else:
		print("SETUP-PROGRESS-TEST FAIL ", _fails)
		quit(1)


## La contabilità dei byte con cui SetupService costruisce l'avanzamento.
func _bytes_accounting() -> void:
	var svc: GDScript = load("res://scripts/setup/setup_service.gd")
	# Nessuna dimensione dichiarata → fraction -1, MAI una percentuale finta.
	var blind: Dictionary = svc._pull_progress_info(
			{"aa": "Pulling fs layer", "bb": "Waiting"}, {})
	_check("senza dimensioni: fraction -1",
			float(blind["fraction"]) == -1.0, str(blind))
	# Somma di download parziali + livello completato bloccato sul totale.
	var info: Dictionary = svc._pull_progress_info(
			{"aa": "Downloading", "bb": "Extracting", "cc": "Pulling fs layer"},
			{"aa": {"got": 100.0, "total": 400.0},
				"bb": {"got": 600.0, "total": 600.0}})
	_check("somma byte scaricati", is_equal_approx(float(info["got_mb"]), 700.0),
			str(info))
	_check("somma byte totali", is_equal_approx(float(info["total_mb"]), 1000.0),
			str(info))
	_check("frazione reale", is_equal_approx(float(info["fraction"]), 0.7),
			str(info))
	_check("conteggio livelli", int(info["layers"]) == 3, str(info))
	_sections += 1


func _formats() -> void:
	_check("MB sotto il GB", SetupProgress._fmt_mb(890.0) == "890 MB",
			SetupProgress._fmt_mb(890.0))
	_check("GB sopra la soglia", SetupProgress._fmt_mb(2560.0) == "2.5 GB",
			SetupProgress._fmt_mb(2560.0))
	_check("mm:ss", SetupProgress._fmt_time(161) == "2:41",
			SetupProgress._fmt_time(161))
	_check("h:mm:ss", SetupProgress._fmt_time(3723) == "1:02:03",
			SetupProgress._fmt_time(3723))
	_sections += 1
