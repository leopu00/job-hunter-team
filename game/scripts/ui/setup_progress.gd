class_name SetupProgress
extends VBoxContainer
## La barra di avanzamento dell'attivazione. Il caso peggiore è il primo
## avvio: il pull dell'immagine è qualche GB e su una rete lenta dura minuti —
## un marcatore ◌ e una riga di testo non distinguono "sta scaricando" da
## "è bloccato" (Leone, 30/07).
##
## Regole:
## - la percentuale esiste SOLO dove esiste il dato (byte del pull dichiarati
##   da docker, via SetupService.pull_progress); altrove barra di attività
##   e la frase onesta "questa fase non riporta una percentuale";
## - il tempo trascorso c'è sempre; l'ETA solo se il rate è misurato davvero
##   (due campioni di byte distanti almeno RATE_WINDOW_MS);
## - mai sembrare morta: se non arrivano eventi per STALL_AFTER_S lo dice.
##
## Il widget si aggiorna DA SOLO sui segnali del servizio: il pannello che lo
## ospita non deve ricostruire l'albero a ogni tick (~1.5s) del pull.

## Le fasi che ogni azione attraversa, nell'ordine vero (specchio dei
## _set_phase in SetupService).
const ACTION_PHASES := {
	"container": ["engine", "image", "container"],
	"team": ["team"],
}
## Dopo quanti secondi di silenzio dichiarare che non arrivano aggiornamenti.
const STALL_AFTER_S := 10
## Finestra minima per considerare misurato il rate di download (ms).
const RATE_WINDOW_MS := 8000
const ACTIVE_PULL_PHASES := [
	"queued", "waiting", "downloaded", "verifying", "extracting", "other",
	"unknown",
]

var _action := ""
var _phase := ""
var _action_started_ms := 0
var _last_event_ms := 0
var _info := {}           # ultimo pull_progress ricevuto ({} = nessun dato)
var _samples: Array = []  # [ms, got_mb] per il rate misurato
var _progress_fingerprint := ""

var _phase_lbl: Label
var _elapsed_lbl: Label
var _detail_lbl: Label
var _stall_lbl: Label
var _bar: Bar


func _ready() -> void:
	add_theme_constant_override("separation", 6)
	var head := HBoxContainer.new()
	add_child(head)
	_phase_lbl = TerminalTheme.label("", 13, Palette.BRIGHT, "bold")
	_phase_lbl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(_phase_lbl)
	_elapsed_lbl = TerminalTheme.label("", 13, Palette.MUTED)
	head.add_child(_elapsed_lbl)
	_bar = Bar.new()
	add_child(_bar)
	_detail_lbl = TerminalTheme.label("", 13, Palette.MUTED)
	add_child(_detail_lbl)
	_stall_lbl = TerminalTheme.label("", 12, Palette.YELLOW)
	_stall_lbl.visible = false
	add_child(_stall_lbl)
	_last_event_ms = Time.get_ticks_msec()
	# Aggancio al servizio, se c'è: nei selftest headless il widget vive da
	# solo e viene pilotato con apply_phase/apply_progress.
	var svc := get_tree().root.get_node_or_null("SetupService")
	if svc != null:
		svc.pull_progress.connect(apply_progress)
		svc.phase_changed.connect(apply_phase)
		svc.action_changed.connect(_on_action_changed)
		_action = str(svc.current_action)
		_phase = str(svc.action_phase)
		_action_started_ms = int(svc.action_started_ms)
		if not (svc.last_pull as Dictionary).is_empty():
			_info = svc.last_pull
			_progress_fingerprint = _info_fingerprint(_info)
	var timer := Timer.new()
	timer.wait_time = 1.0
	timer.autostart = true
	add_child(timer)
	timer.timeout.connect(_tick)
	_refresh()


## Cambio fase: contatore e campioni ripartono — i byte del pull non
## descrivono la fase successiva.
func apply_phase(action: String, phase: String) -> void:
	_action = action
	_phase = phase
	_info = {}
	_samples = []
	_progress_fingerprint = ""
	_note_event()
	_refresh()


## Avanzamento strutturato del pull (got_mb/total_mb/fraction).
func apply_progress(info: Dictionary) -> void:
	var fingerprint := _info_fingerprint(info)
	if fingerprint == _progress_fingerprint:
		return
	_progress_fingerprint = fingerprint
	var advanced := bool(info.get("advanced", false))
	var next_info := info.duplicate(true)
	if not advanced and not _info.is_empty():
		# Un redraw (per esempio un totale appena scoperto) non autorizza uno
		# snapshot stale a far regredire fase o completati gia mostrati.
		for key in ["phase", "done_layers"]:
			if _info.has(key):
				next_info[key] = _info[key]
		next_info["layers"] = maxi(int(info.get("layers", 0)),
				int(_info.get("layers", 0)))
		next_info["got_mb"] = maxf(float(info.get("got_mb", 0.0)),
				float(_info.get("got_mb", 0.0)))
		next_info["total_mb"] = maxf(float(info.get("total_mb", 0.0)),
				float(_info.get("total_mb", 0.0)))
		var known_meter := float(info.get("fraction", -1.0)) >= 0.0 \
				or float(_info.get("fraction", -1.0)) >= 0.0
		next_info["fraction"] = clampf(
				float(next_info["got_mb"]) / float(next_info["total_mb"]),
				0.0, 1.0) if known_meter and float(next_info["total_mb"]) > 0.0 \
				else -1.0
	_info = next_info
	var got := float(_info.get("got_mb", 0.0))
	if advanced and got > 0.0:
		_samples.append([Time.get_ticks_msec(), got])
		while _samples.size() > 2 \
				and Time.get_ticks_msec() - int(_samples[0][0]) > 60000:
			_samples.pop_front()
	if advanced:
		_note_event()
	_refresh()


func _on_action_changed(_action_name: String, _running: bool,
		_message: String, _ok: bool) -> void:
	# Anche i messaggi testuali (es. il poll del motore ogni 2s) contano come
	# segno di vita: il contatore di stallo riparte.
	_note_event()


func _note_event() -> void:
	_last_event_ms = Time.get_ticks_msec()
	if is_instance_valid(_stall_lbl):
		_stall_lbl.visible = false


## Battito a 1 Hz: tempo trascorso e rilevazione dello stallo. Aggiorna SOLO
## le etichette, mai l'albero.
func _tick() -> void:
	if not is_instance_valid(_elapsed_lbl):
		return
	_elapsed_lbl.text = UIStrings.t("setup.progress_elapsed") \
			% _fmt_time(int((Time.get_ticks_msec() - _action_started_ms) / 1000.0))
	var silent := int((Time.get_ticks_msec() - _last_event_ms) / 1000.0)
	if silent >= STALL_AFTER_S:
		_stall_lbl.text = UIStrings.t("setup.progress_stalled") % silent
		_stall_lbl.visible = true


func _refresh() -> void:
	if not is_instance_valid(_phase_lbl):
		return
	var phases: Array = ACTION_PHASES.get(_action, [])
	var idx := phases.find(_phase)
	var phase_name := UIStrings.t("setup.phase_" + _phase) if _phase != "" else ""
	# Con una fase sola il contatore "fase 1 di 1" non dice niente: resta
	# solo il nome. Il peso vero delle fasi lo racconta la filiera sopra.
	_phase_lbl.text = phase_name if phases.size() <= 1 or idx < 0 \
			else UIStrings.t("setup.progress_phase") % [idx + 1, phases.size(), phase_name]
	var fraction := float(_info.get("fraction", -1.0))
	var pull_phase := str(_info.get("phase", ""))
	# Il metro misura byte scaricati, non verifica/estrazione. In quelle fasi
	# torna barra di attivita: un 100% pieno mentre Docker estrae era proprio
	# l'ambiguita del 17/18 segnalato.
	_bar.fraction = 1.0 if pull_phase == "complete" \
			else (-1.0 if pull_phase in ACTIVE_PULL_PHASES else fraction)
	_tick()  # il tempo trascorso è aggiornato SUBITO, non al prossimo secondo
	var stage := _pull_stage_text()
	var got := float(_info.get("got_mb", 0.0))
	if fraction < 0.0:
		if got <= 0.0:
			# Nessun dato di nessun tipo: barra di attività e la ragione.
			_detail_lbl.text = _join_detail(stage,
					UIStrings.t("setup.progress_no_meter"))
			return
		# I docker moderni su pipe non dichiarano MAI il totale: percentuale
		# ed ETA non esistono, ma i byte scaricati e il rate misurato sì —
		# "890 MB scaricati · 6.2 MB/s" batte una barra muta.
		var partial := UIStrings.t("setup.progress_downloaded") % _fmt_mb(got)
		var dl_rate := _measured_rate()
		if dl_rate > 0.0:
			partial += " · %.1f MB/s" % dl_rate
		_detail_lbl.text = _join_detail(stage, partial)
		return
	var total := float(_info.get("total_mb", 0.0))
	var text := "%s / %s · %d%%" % [_fmt_mb(got), _fmt_mb(total),
			int(round(fraction * 100.0))]
	var rate := _measured_rate()
	if rate > 0.0:
		text += " · %.1f MB/s" % rate
		if total > got:
			text += " · " + UIStrings.t("setup.progress_eta") \
					% _fmt_time(int((total - got) / rate))
	_detail_lbl.text = _join_detail(stage, text)


func _pull_stage_text() -> String:
	var phase := str(_info.get("phase", ""))
	var done := int(_info.get("done_layers", -1))
	var total := int(_info.get("layers", -1))
	if phase == "" or done < 0 or total < 0:
		return ""
	return UIStrings.t("setup.progress_pull_stage") % [
		UIStrings.t("setup.pull_phase_" + phase), done, total,
	]


static func _join_detail(stage: String, detail: String) -> String:
	return detail if stage == "" else stage + " · " + detail


static func _info_fingerprint(info: Dictionary) -> String:
	# Unita intere evitano heartbeat cosmetici da rappresentazioni float.
	return JSON.stringify([
		str(info.get("phase", "")),
		int(info.get("done_layers", -1)),
		int(info.get("layers", -1)),
		int(round(float(info.get("got_mb", 0.0)) * 1048576.0)),
		int(round(float(info.get("total_mb", 0.0)) * 1048576.0)),
	])


## MB/s misurati sui campioni del pull: 0.0 finché la finestra è troppo corta
## per dire qualcosa di vero (e quindi niente ETA).
func _measured_rate() -> float:
	if _samples.size() < 2:
		return 0.0
	var dt_ms := int(_samples[-1][0]) - int(_samples[0][0])
	var dmb := float(_samples[-1][1]) - float(_samples[0][1])
	if dt_ms < RATE_WINDOW_MS or dmb <= 0.0:
		return 0.0
	return dmb * 1000.0 / dt_ms


static func _fmt_mb(mb: float) -> String:
	return "%.1f GB" % (mb / 1024.0) if mb >= 1024.0 else "%d MB" % int(round(mb))


static func _fmt_time(seconds: int) -> String:
	var s := maxi(seconds, 0)
	if s >= 3600:
		return "%d:%02d:%02d" % [int(s / 3600.0), int(s % 3600 / 60.0), s % 60]
	return "%d:%02d" % [int(s / 60.0), s % 60]


## La barra vera e propria: determinata (riempimento reale) o di attività
## (segmento che scorre). Un solo Control ridisegnato, mai l'albero.
class Bar extends Control:
	var fraction := -1.0:
		set(value):
			fraction = value
			set_process(fraction < 0.0)
			queue_redraw()

	func _init() -> void:
		custom_minimum_size = Vector2(0, 14)
		size_flags_horizontal = Control.SIZE_EXPAND_FILL
		mouse_filter = Control.MOUSE_FILTER_IGNORE

	func _process(_delta: float) -> void:
		queue_redraw()  # solo in modalità attività (vedi setter)

	func _draw() -> void:
		var r := Rect2(Vector2.ZERO, size)
		draw_rect(r, Palette.DEEP)
		if fraction >= 0.0:
			draw_rect(Rect2(Vector2.ZERO,
					Vector2(size.x * clampf(fraction, 0.0, 1.0), size.y)),
					Palette.GREEN)
		else:
			# Attività: un segmento (1/4 della larghezza) che scorre in ~1.6s.
			# Dice "sto lavorando" senza fingere di sapere quanto manca.
			var band := size.x * 0.25
			var span := size.x + band
			var x := fposmod(Time.get_ticks_msec() * 0.001 / 1.6, 1.0) * span - band
			var from := maxf(x, 0.0)
			var to := minf(x + band, size.x)
			if to > from:
				draw_rect(Rect2(Vector2(from, 0), Vector2(to - from, size.y)),
						Palette.GREEN)
		draw_rect(r, Palette.BORDER, false, TerminalTheme.hairline())
