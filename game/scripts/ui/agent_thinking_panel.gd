class_name AgentThinkingPanel
extends CanvasLayer
## Osservatore read-only della pane tmux di un agente. Lo stream resta nel
## gioco, blocca la camera sottostante e non contiene alcun controllo capace
## di scrivere nella sessione.

signal closed

var _agent_key := ""
var _display_name := ""
var _accent := Palette.GREEN
var _output: RichTextLabel
var _status: Label
var _first_snapshot := true
var _closing := false
var _follow_tail := true
var _scroll_guard := false
var _last_text := ""


func _init(agent_key: String, display_name: String, accent: Color) -> void:
	_agent_key = agent_key
	_display_name = display_name
	_accent = accent
	layer = 55
	process_mode = Node.PROCESS_MODE_ALWAYS
	add_to_group("camera_blocking_overlay")


func _ready() -> void:
	_build_ui()
	BackendBus.agent_terminal_updated.connect(_on_terminal_updated)
	BackendBus.open_agent_terminal(_agent_key)
	Sfx.play_blip()


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("ui_cancel"):
		close()
		get_viewport().set_input_as_handled()


func _build_ui() -> void:
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.theme = TerminalTheme.get_theme()
	add_child(root)

	var dim := ColorRect.new()
	dim.color = Color(Palette.VOID.r, Palette.VOID.g, Palette.VOID.b, 0.90)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	dim.mouse_filter = Control.MOUSE_FILTER_STOP
	dim.gui_input.connect(func(event: InputEvent) -> void:
		if event is InputEventMouseButton and event.pressed \
				and event.button_index in [MOUSE_BUTTON_LEFT, MOUSE_BUTTON_RIGHT]:
			close())
	root.add_child(dim)

	var holder := MarginContainer.new()
	holder.set_anchors_preset(Control.PRESET_FULL_RECT)
	holder.add_theme_constant_override("margin_left", 72)
	holder.add_theme_constant_override("margin_right", 72)
	holder.add_theme_constant_override("margin_top", 48)
	holder.add_theme_constant_override("margin_bottom", 48)
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(holder)

	var panel := BracketPanel.new()
	panel.bracket_color = _accent
	panel.custom_minimum_size = Vector2(1100, 720)
	holder.add_child(panel)

	var pad := MarginContainer.new()
	for side in ["left", "right", "top", "bottom"]:
		pad.add_theme_constant_override("margin_" + side, 28)
	panel.add_child(pad)

	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 10)
	pad.add_child(col)

	var header := HBoxContainer.new()
	header.add_theme_constant_override("separation", 14)
	col.add_child(header)
	var titles := VBoxContainer.new()
	titles.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	header.add_child(titles)
	titles.add_child(TerminalTheme.label(
			UIStrings.t("agent.thinking_title") % _display_name.to_upper(),
			24, Palette.WHITE, "xbold"))
	var subtitle := TerminalTheme.label(UIStrings.t("agent.thinking_subtitle"),
			13, Palette.MUTED)
	subtitle.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	titles.add_child(subtitle)
	_status = TerminalTheme.label(UIStrings.t("agent.thinking_loading"),
			13, Palette.YELLOW, "bold")
	_status.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	header.add_child(_status)
	var close_button := Button.new()
	close_button.flat = true
	close_button.text = "✕"
	close_button.pressed.connect(close)
	header.add_child(close_button)
	col.add_child(HSeparator.new())

	_output = RichTextLabel.new()
	_output.bbcode_enabled = false
	_output.selection_enabled = true
	_output.context_menu_enabled = true
	_output.scroll_active = true
	_output.scroll_following = false
	_output.autowrap_mode = TextServer.AUTOWRAP_OFF
	_output.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_output.add_theme_font_size_override("normal_font_size", 15)
	_output.add_theme_color_override("default_color", Palette.BRIGHT)
	_output.text = UIStrings.t("agent.thinking_waiting")
	col.add_child(_output)
	_output.get_v_scroll_bar().value_changed.connect(_on_scroll_changed)

	col.add_child(HSeparator.new())
	var footer := HBoxContainer.new()
	footer.add_theme_constant_override("separation", 10)
	col.add_child(footer)
	var readonly := TerminalTheme.label("● " + UIStrings.t("agent.thinking_readonly"),
			12, _accent, "medium")
	readonly.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	footer.add_child(readonly)
	var bottom := Button.new()
	bottom.text = UIStrings.t("agent.thinking_bottom")
	bottom.pressed.connect(_resume_tail)
	footer.add_child(bottom)


func _on_terminal_updated(agent: String, text: String, error: String) -> void:
	if agent != _agent_key or _output == null:
		return
	if error != "":
		_status.text = "● " + UIStrings.t("agent.thinking_error")
		_status.add_theme_color_override("font_color", Palette.RED)
		_scroll_guard = true
		_output.text = error
		_finish_scroll_update.call_deferred(0.0, false)
		return
	_status.text = "● " + UIStrings.t("agent.thinking_live")
	_status.add_theme_color_override("font_color", _accent)
	var next_text := text if text != "" else UIStrings.t("agent.thinking_empty")
	# Il pane spesso cambia soltanto una spinner cell. Se lo snapshot testuale
	# e identico, non ricostruiamo il RichTextLabel: così una rotella in corso
	# non viene mai interrotta inutilmente dal poll.
	if next_text == _last_text:
		return

	var bar := _output.get_v_scroll_bar()
	var old_value := bar.value
	var should_follow := _first_snapshot or _follow_tail
	_scroll_guard = true
	_output.text = next_text
	_last_text = next_text
	_first_snapshot = false
	_finish_scroll_update.call_deferred(old_value, should_follow)


func _on_scroll_changed(value: float) -> void:
	if _scroll_guard or _output == null:
		return
	var bar := _output.get_v_scroll_bar()
	# Appena l'utente lascia il fondo, il live-tail si sgancia in modo
	# persistente. Non basta una soglia calcolata a ogni poll: vicino al fondo
	# il vecchio codice lo riattivava e riportava giu la lettura.
	_follow_tail = value >= bar.max_value - bar.page - 3.0


func _finish_scroll_update(old_value: float, should_follow: bool) -> void:
	if _output == null:
		return
	if should_follow:
		_output.scroll_to_line(maxi(0, _output.get_line_count() - 1))
	else:
		var bar := _output.get_v_scroll_bar()
		bar.value = minf(old_value, maxf(0.0, bar.max_value - bar.page))
	_scroll_guard = false


func _resume_tail() -> void:
	if _output:
		_follow_tail = true
		_scroll_guard = true
		_output.scroll_to_line(maxi(0, _output.get_line_count() - 1))
		_release_scroll_guard.call_deferred()


func _release_scroll_guard() -> void:
	_scroll_guard = false


func close(sound := true) -> void:
	if _closing:
		return
	_closing = true
	BackendBus.close_agent_terminal()
	if sound:
		Sfx.play_back()
	closed.emit()
	queue_free()


func _exit_tree() -> void:
	# Anche un cambio scena o la chiusura dell'app deve spegnere il polling.
	if not _closing:
		BackendBus.close_agent_terminal()
