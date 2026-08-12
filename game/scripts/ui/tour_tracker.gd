class_name TourTracker
extends CanvasLayer
## To-do list del tour a schermo (in alto a sinistra, sotto la linguetta ≡):
## la lista dei passi con ✓/▸, il conteggio dei reparti visitati e — in fase
## di lancio — i tre requisiti della checklist letti da SetupService. È una
## vista pura su TourGuide: nessuno stato proprio oltre al pulse grafico.

var _panel: BracketPanel
var _rows: VBoxContainer
var _current_labels: Array[Label] = []
var _time := 0.0

func _init() -> void:
	layer = 15  # sotto la sidebar (20): il cassetto aperto lo copre

func _ready() -> void:
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.theme = TerminalTheme.get_theme()
	add_child(root)
	_panel = BracketPanel.new()
	# a destra della linguetta ≡ (10,150) della sidebar: mai coprirla
	_panel.position = Vector2(68, 84)
	root.add_child(_panel)
	var margin := MarginContainer.new()
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 14)
	_panel.add_child(margin)
	_rows = VBoxContainer.new()
	_rows.add_theme_constant_override("separation", 5)
	margin.add_child(_rows)
	TourGuide.changed.connect(_rebuild)
	TourGuide.tour_finished.connect(_on_finished)
	SetupService.status_changed.connect(_on_setup_status)
	_rebuild()

func _on_setup_status(status: Dictionary) -> void:
	TourGuide.notify_setup_status(status)
	if TourGuide.in_launch_phase():
		_rebuild()

func _process(delta: float) -> void:
	_time += delta
	var alpha := 0.55 + 0.45 * maxf(0.0, sin(_time * 3.0))
	for label in _current_labels:
		if is_instance_valid(label):
			label.modulate.a = alpha

func _rebuild() -> void:
	if TourGuide._done:
		return  # la chiusura è gestita da _on_finished
	_current_labels.clear()
	for child in _rows.get_children():
		child.queue_free()
	var title := TerminalTheme.label(UIStrings.t("tour.title"), 16, Palette.WHITE, "xbold")
	_rows.add_child(title)
	_rows.add_child(_spacer(2))

	var idx := TourGuide.step_index()
	var launch := TourGuide.in_launch_phase()
	var depts_label := UIStrings.t("tour.step_depts")
	if TourGuide.row_state("depts") == "current":
		depts_label += " (%d/5)" % TourGuide.depts_visited()
	_row(UIStrings.t("tour.step_assistant"), TourGuide.row_state("assistente"))
	_row(depts_label, TourGuide.row_state("depts"))
	_row(UIStrings.t("tour.step_doctor"), TourGuide.row_state("dottore"))
	_row(UIStrings.t("tour.step_mentor"), TourGuide.row_state("mentor"))
	_row(UIStrings.t("tour.step_coordinator"), TourGuide.row_state("coordinatore"))
	_row(UIStrings.t("tour.step_launch"), "current" if launch else "todo")

	if launch:
		var status := SetupService.status
		_check_row(UIStrings.t("tour.chk_container"),
				bool(status.get("container_running", false)))
		_check_row(UIStrings.t("tour.chk_provider"),
				bool(status.get("provider_authenticated", false)))
		_check_row(UIStrings.t("tour.chk_profile"),
				bool(status.get("profile_ready", false)))

	_rows.add_child(_spacer(4))
	var hint_key := "tour.hint_follow"
	if idx == 0:
		hint_key = "tour.hint_talk"
	elif launch:
		hint_key = "tour.hint_launch"
	elif TourGuide.mode() == "free":
		hint_key = "tour.hint_free"
	var hint := TerminalTheme.label(UIStrings.t(hint_key), 12, Palette.DIM)
	hint.custom_minimum_size = Vector2(250, 0)
	hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_rows.add_child(hint)

	var skip := Button.new()
	# La pausa silenzia regia e chat insieme ma conserva la tappa; il percorso
	# di ripresa resta nella sidebar, raggiungibile anche dopo un riavvio.
	skip.text = UIStrings.t("tour.pause")
	skip.flat = true
	skip.alignment = HORIZONTAL_ALIGNMENT_LEFT
	skip.add_theme_font_size_override("font_size", 12)
	skip.add_theme_color_override("font_color", Palette.MUTED)
	skip.add_theme_color_override("font_hover_color", Palette.WHITE)
	skip.pressed.connect(Game.exit_guided_onboarding)
	_rows.add_child(skip)

## Stato di una riga principale rispetto all'indice del tour: il blocco
## reparti occupa gli indici [first..last] (1..5), gli altri un solo indice.
func _state(idx: int, first: int, last: int) -> String:
	if idx > last:
		return "done"
	if idx >= first:
		return "current"
	return "todo"

func _row(text: String, state: String) -> void:
	var line := HBoxContainer.new()
	line.add_theme_constant_override("separation", 8)
	_rows.add_child(line)
	var icon_text := "·"
	var color := Palette.MUTED
	var weight := "medium"
	match state:
		"done":
			icon_text = "✓"
			color = Palette.MINT
		"current":
			icon_text = "▸"
			color = Palette.YELLOW
			weight = "bold"
	var icon := TerminalTheme.label(icon_text, 14, color, "bold")
	icon.custom_minimum_size = Vector2(16, 0)
	line.add_child(icon)
	var label := TerminalTheme.label(text, 14,
			color if state != "done" else Palette.BASE, weight)
	line.add_child(label)
	if state == "current":
		_current_labels.append(label)
		_current_labels.append(icon)

## Sotto-requisito della fase di lancio: spia verde/rossa dalla checklist.
func _check_row(text: String, ok: bool) -> void:
	var line := HBoxContainer.new()
	line.add_theme_constant_override("separation", 8)
	_rows.add_child(line)
	var pad := Control.new()
	pad.custom_minimum_size = Vector2(16, 0)
	line.add_child(pad)
	line.add_child(TerminalTheme.label("●", 11,
			Palette.GREEN if ok else Palette.RED))
	line.add_child(TerminalTheme.label(text, 13,
			Palette.BASE if ok else Palette.MUTED))

func _spacer(h: float) -> Control:
	var s := Control.new()
	s.custom_minimum_size = Vector2(0, h)
	return s

## Congedo: la lista lascia il posto a una riga di completamento che svanisce.
func _on_finished() -> void:
	_current_labels.clear()
	for child in _rows.get_children():
		child.queue_free()
	_rows.add_child(TerminalTheme.label(UIStrings.t("tour.done"), 16, Palette.MINT, "xbold"))
	var tw := create_tween()
	tw.tween_interval(4.0)
	tw.tween_property(_panel, "modulate:a", 0.0, 0.8)
	tw.tween_callback(queue_free)
