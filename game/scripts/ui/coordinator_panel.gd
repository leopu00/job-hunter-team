class_name CoordinatorPanel
extends CanvasLayer
## Console nativa del Coordinatore: policy applicate a codice, modalità di
## lavoro, ordini immediati e bacheca permanente. Nessun terminale esterno.

signal closed

var _accent := Palette.GREEN
var _closing := false
var _status: Label
var _mode_badge: Label
var _queue_grid: GridContainer
var _directives: VBoxContainer
var _command: TextEdit
var _permanent: CheckButton

## Le 5 modalità di lavoro (enum chiuso, contratto 2026-08): il valore scelto
## finisce in profile/capitano-maintenance.json alla chiave "mode" (filename
## storico — vedi coordinator_save.py). Assenza del file = "search".
const WORK_MODES: Array[String] = ["search", "harvest", "care",
		"calibration", "saving"]
var _mode_group := ButtonGroup.new()
var _mode_buttons := {}       # mode → CheckBox (radio)
var _mode_data_labels := {}   # mode → Label col dato che motiva la scelta
var _stop_search: CheckButton
var _discard_expired: CheckButton
var _cv_score: SpinBox
var _precheck_cv: CheckButton
## «Fino a quando» (`mode_until`, [SAVING-MODE-HAS-NO-DEADLINE]): nessuna
## modalità deve durare per inerzia, quindi la scadenza va SCELTA qui e non
## soltanto dal terminale. Si manda come durata e il container la datalizza:
## fra host e container il fuso può differire, come per la deroga di spesa.
var _until_toggle: CheckButton
var _until_row: Control
var _until_days: SpinBox
var _until_hours: SpinBox
var _until_state: Label
## Il campo si tocca, non si sfiora: finché l'utente non lo cambia, salvare
## un'ALTRA impostazione non deve spostare né cancellare la scadenza in corso —
## è il difetto da cui nasce questo pannello.
var _until_dirty := false
var _until_syncing := false
var _economy: CheckButton
var _geo_enabled: CheckButton
var _geo_score: SpinBox
var _geo_non_remote: CheckButton
var _logo_enabled: CheckButton
var _logo_score: SpinBox
var _recheck_enabled: CheckButton
var _recheck_score: SpinBox
var _recheck_days: SpinBox
var _maintenance_options: Control
var _automation_options: Control
var _geo_options: Control
var _logo_options: Control
var _recheck_options: Control
var _tabs: TabContainer
var _monitor_body: VBoxContainer
var _monitor_built := false
var _nav_control: Button
var _nav_monitor: Button
var _nav_chat: Button
var _nav_thinking: Button
var _chat_panel: ChatPanel
var _thinking_panel: AgentThinkingPanel
var _monitor_values := {}
var _monitor_detail: Label
var _ram_spark: AgentMetricSparkline
var _token_spark: AgentMetricSparkline


func _init(accent: Color) -> void:
	_accent = accent
	layer = 56
	process_mode = Node.PROCESS_MODE_ALWAYS
	add_to_group("camera_blocking_overlay")


func _ready() -> void:
	_build_ui()
	BackendBus.coordinator_state_updated.connect(_apply_state)
	BackendBus.coordinator_action_done.connect(_on_action_done)
	BackendBus.user_chat_sent.connect(_on_order_sent)
	BackendBus.telemetry_updated.connect(_on_monitor_telemetry)
	BackendBus.agents_updated.connect(_on_monitor_agents)
	if not BackendBus.coordinator_state.is_empty():
		_apply_state(BackendBus.coordinator_state)
	BackendBus.request_coordinator_state()
	Sfx.play_blip()


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("ui_cancel"):
		if is_instance_valid(_chat_panel) or is_instance_valid(_thinking_panel):
			return
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
	holder.add_theme_constant_override("margin_left", 58)
	holder.add_theme_constant_override("margin_right", 58)
	holder.add_theme_constant_override("margin_top", 42)
	holder.add_theme_constant_override("margin_bottom", 42)
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(holder)

	var panel := BracketPanel.new()
	panel.bracket_color = _accent
	panel.custom_minimum_size = Vector2(1180, 760)
	holder.add_child(panel)
	var pad := MarginContainer.new()
	for side in ["left", "right", "top", "bottom"]:
		pad.add_theme_constant_override("margin_" + side, 26)
	panel.add_child(pad)
	var shell := VBoxContainer.new()
	shell.add_theme_constant_override("separation", 10)
	pad.add_child(shell)

	var header := HBoxContainer.new()
	header.add_theme_constant_override("separation", 14)
	shell.add_child(header)
	var titles := VBoxContainer.new()
	titles.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	header.add_child(titles)
	titles.add_child(TerminalTheme.label(UIStrings.t("coord.title"), 25,
			Palette.WHITE, "xbold"))
	var subtitle := TerminalTheme.label(UIStrings.t("coord.subtitle"), 13,
			Palette.MUTED)
	subtitle.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	titles.add_child(subtitle)
	_mode_badge = TerminalTheme.label(UIStrings.t("coord.loading"), 13,
			Palette.YELLOW, "bold")
	_mode_badge.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	header.add_child(_mode_badge)
	var refresh := Button.new()
	refresh.text = "↻"
	refresh.tooltip_text = UIStrings.t("coord.refresh")
	refresh.pressed.connect(func() -> void:
		_status_text(UIStrings.t("coord.loading"), Palette.YELLOW)
		BackendBus.request_coordinator_state())
	header.add_child(refresh)
	var x := Button.new()
	x.flat = true
	x.text = "✕"
	x.pressed.connect(close)
	header.add_child(x)
	shell.add_child(HSeparator.new())

	var navigation := HBoxContainer.new()
	navigation.add_theme_constant_override("separation", 8)
	shell.add_child(navigation)
	_nav_control = _nav_button(UIStrings.t("coord.nav_control"),
			func() -> void: _show_view(0))
	navigation.add_child(_nav_control)
	_nav_monitor = _nav_button(UIStrings.t("coord.nav_monitor"),
			func() -> void: _show_view(1))
	navigation.add_child(_nav_monitor)
	var nav_space := Control.new()
	nav_space.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	navigation.add_child(nav_space)
	_nav_thinking = _nav_button(UIStrings.t("coord.nav_thinking"),
			_open_thinking)
	navigation.add_child(_nav_thinking)
	_nav_chat = _nav_button(UIStrings.t("coord.nav_chat"), _open_chat)
	_nav_chat.add_theme_color_override("font_color", Palette.GREEN)
	navigation.add_child(_nav_chat)

	_tabs = TabContainer.new()
	_tabs.tabs_visible = false
	_tabs.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_tabs.use_hidden_tabs_for_min_size = true
	shell.add_child(_tabs)
	var scroll := ScrollContainer.new()
	scroll.name = "Controllo"
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.mouse_filter = Control.MOUSE_FILTER_STOP
	_tabs.add_child(scroll)
	var body := VBoxContainer.new()
	body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	body.add_theme_constant_override("separation", 20)
	scroll.add_child(body)

	_add_section_heading(body, UIStrings.t("coord.queues"),
			UIStrings.t("coord.queues_desc"))
	_queue_grid = GridContainer.new()
	_queue_grid.columns = 7
	_queue_grid.add_theme_constant_override("h_separation", 10)
	body.add_child(_queue_grid)
	_build_queue_cards({})

	var columns := HBoxContainer.new()
	columns.add_theme_constant_override("separation", 20)
	body.add_child(columns)
	var work := _section_card(columns, UIStrings.t("coord.mode"),
			UIStrings.t("coord.mode_desc"), Palette.YELLOW)
	# Il selettore: una voce per modalità, ognuna con nome, cosa implica e
	# quando sceglierla — la scelta si capisce da qui, senza documentazione.
	for mode: String in WORK_MODES:
		var option := _mode_option(work, mode)
		if mode == "care":
			# Le opzioni fini della cura vivono DENTRO la sua voce: sono
			# gli `orders` che il file scrive solo quando la cura è attiva.
			_maintenance_options = _options_box(option["body"])
			_stop_search = _compact_check(_maintenance_options,
					UIStrings.t("coord.stop_search"))
			_discard_expired = _compact_check(_maintenance_options,
					UIStrings.t("coord.expired"))
			_cv_score = _spin(_maintenance_options,
					UIStrings.t("coord.cv_score"), 0, 100, 90)
			_precheck_cv = _compact_check(_maintenance_options,
					UIStrings.t("coord.precheck"))
	(_mode_buttons["search"] as CheckBox).set_pressed_no_signal(true)
	_build_deadline(work)

	var automation := _section_card(columns, UIStrings.t("coord.automation"),
			UIStrings.t("coord.automation_desc"), Palette.BLUE)
	var economy_block := _feature_block(automation,
			UIStrings.t("coord.economy"), UIStrings.t("coord.economy_tip"),
			Palette.YELLOW)
	_economy = economy_block["toggle"]
	_automation_options = VBoxContainer.new()
	(_automation_options as VBoxContainer).add_theme_constant_override(
			"separation", 10)
	automation.add_child(_automation_options)

	var geo_block := _feature_block(_automation_options,
			UIStrings.t("coord.geo"), UIStrings.t("coord.geo_desc"), Palette.BLUE)
	_geo_enabled = geo_block["toggle"]
	_geo_options = _options_box(geo_block["body"])
	_geo_score = _spin(_geo_options, UIStrings.t("coord.min_score"), 0, 100,
			65, UIStrings.t("coord.zero_all"))
	_geo_non_remote = _compact_check(_geo_options,
			UIStrings.t("coord.non_remote"))

	var logo_block := _feature_block(_automation_options,
			UIStrings.t("coord.logo"), UIStrings.t("coord.logo_desc"),
			Palette.PURPLE)
	_logo_enabled = logo_block["toggle"]
	_logo_options = _options_box(logo_block["body"])
	_logo_score = _spin(_logo_options, UIStrings.t("coord.min_score_logo"),
			0, 100, 70, UIStrings.t("coord.zero_all"))

	var recheck_block := _feature_block(_automation_options,
			UIStrings.t("coord.recheck"), UIStrings.t("coord.recheck_desc"),
			Palette.ORANGE)
	_recheck_enabled = recheck_block["toggle"]
	_recheck_options = _options_box(recheck_block["body"])
	var pair := HBoxContainer.new()
	pair.add_theme_constant_override("separation", 16)
	_recheck_options.add_child(pair)
	_recheck_score = _spin(pair, UIStrings.t("coord.score"), 0, 100, 65)
	_recheck_days = _spin(pair, UIStrings.t("coord.days"), 1, 365, 14)

	for toggle in [_economy, _geo_enabled, _logo_enabled, _recheck_enabled]:
		toggle.toggled.connect(func(_pressed: bool) -> void:
			_refresh_control_states())

	var save := Button.new()
	save.text = UIStrings.t("coord.save")
	save.custom_minimum_size = Vector2(0, 54)
	save.add_theme_color_override("font_color", _accent)
	save.pressed.connect(_save_settings)
	body.add_child(save)

	var command_columns := HBoxContainer.new()
	command_columns.add_theme_constant_override("separation", 20)
	body.add_child(command_columns)
	var orders := _section_card(command_columns, UIStrings.t("coord.orders"),
			UIStrings.t("coord.orders_desc"), _accent)
	orders.size_flags_stretch_ratio = 1.25
	var presets := GridContainer.new()
	presets.columns = 2
	presets.add_theme_constant_override("h_separation", 10)
	presets.add_theme_constant_override("v_separation", 10)
	orders.add_child(presets)
	_action_card(presets, UIStrings.t("coord.preset_scout"),
			UIStrings.t("coord.preset_scout_desc"), func() -> void:
				_send_order(UIStrings.t("coord.prompt_scout")))
	_action_card(presets, UIStrings.t("coord.preset_balance"),
			UIStrings.t("coord.preset_balance_desc"), func() -> void:
				_send_order(UIStrings.t("coord.prompt_balance")))
	_action_card(presets, UIStrings.t("coord.preset_reanalyze"),
			UIStrings.t("coord.preset_reanalyze_desc"), func() -> void:
				_send_order(UIStrings.t("coord.prompt_reanalyze") % [
						int(_recheck_days.value), int(_recheck_score.value)]))
	_action_card(presets, UIStrings.t("coord.preset_maintenance"),
			UIStrings.t("coord.preset_maintenance_desc"), func() -> void:
				_send_order(UIStrings.t("coord.prompt_maintenance")))
	orders.add_child(_minor_heading(UIStrings.t("coord.custom")))
	_command = TextEdit.new()
	_command.custom_minimum_size = Vector2(0, 112)
	_command.placeholder_text = UIStrings.t("coord.command_placeholder")
	_command.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
	orders.add_child(_command)
	var send_row := HBoxContainer.new()
	send_row.add_theme_constant_override("separation", 10)
	orders.add_child(send_row)
	_permanent = CheckButton.new()
	_permanent.text = UIStrings.t("coord.permanent")
	_permanent.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	send_row.add_child(_permanent)
	var send := Button.new()
	send.text = UIStrings.t("coord.send")
	send.add_theme_color_override("font_color", _accent)
	send.pressed.connect(_send_custom)
	send_row.add_child(send)

	var board := _section_card(command_columns, UIStrings.t("coord.board"),
			UIStrings.t("coord.board_tip"), Palette.PURPLE)
	board.size_flags_stretch_ratio = 0.75
	var board_scroll := ScrollContainer.new()
	board_scroll.custom_minimum_size = Vector2(0, 390)
	board_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	board_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	board.add_child(board_scroll)
	_directives = VBoxContainer.new()
	_directives.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_directives.add_theme_constant_override("separation", 8)
	board_scroll.add_child(_directives)

	var monitor_scroll := ScrollContainer.new()
	monitor_scroll.name = "Monitoraggio"
	monitor_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	monitor_scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	monitor_scroll.mouse_filter = Control.MOUSE_FILTER_STOP
	_tabs.add_child(monitor_scroll)
	_monitor_body = VBoxContainer.new()
	_monitor_body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_monitor_body.add_theme_constant_override("separation", 18)
	monitor_scroll.add_child(_monitor_body)

	shell.add_child(HSeparator.new())
	var footer := HBoxContainer.new()
	footer.add_theme_constant_override("separation", 10)
	shell.add_child(footer)
	_status = TerminalTheme.label(UIStrings.t("coord.loading"), 12,
			Palette.YELLOW, "medium")
	_status.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	footer.add_child(_status)
	footer.add_child(TerminalTheme.label(UIStrings.t("coord.close"), 12,
			Palette.DIM))
	_refresh_control_states()
	_on_monitor_agents(BackendBus.agents)
	_show_view(0)


func _nav_button(text: String, action: Callable) -> Button:
	var button := Button.new()
	button.text = text
	button.add_theme_font_size_override("font_size", 12)
	button.pressed.connect(action)
	return button


func _show_view(index: int) -> void:
	if not is_instance_valid(_tabs):
		return
	if index == 1 and not _monitor_built:
		_build_monitor()
	_tabs.current_tab = index
	_nav_control.add_theme_color_override("font_color",
			_accent if index == 0 else Palette.MUTED)
	_nav_monitor.add_theme_color_override("font_color",
			Palette.BLUE if index == 1 else Palette.MUTED)
	_status_text(UIStrings.t("coord.view_control") if index == 0 \
			else UIStrings.t("coord.view_monitor"),
			Palette.MINT if index == 0 else Palette.BLUE)


func _open_chat() -> void:
	if is_instance_valid(_chat_panel):
		return
	var agent := _coordinator_agent()
	var uid := str(agent.get("uid", "coordinatore"))
	var display := str(agent.get("name", UIStrings.t("coord.coordinator")))
	_chat_panel = ChatPanel.new(uid, display)
	_chat_panel.layer = 70
	add_child(_chat_panel)
	_chat_panel.closed.connect(func() -> void:
		_chat_panel = null)


func _open_thinking() -> void:
	if is_instance_valid(_thinking_panel):
		return
	var agent := _coordinator_agent()
	var uid := str(agent.get("uid", "coordinatore"))
	var display := str(agent.get("name", UIStrings.t("coord.coordinator")))
	_thinking_panel = AgentThinkingPanel.new(uid, display, _accent)
	_thinking_panel.layer = 70
	add_child(_thinking_panel)
	_thinking_panel.closed.connect(func() -> void:
		_thinking_panel = null)


func _build_monitor() -> void:
	_monitor_built = true
	for child in _monitor_body.get_children():
		child.queue_free()
	_add_section_heading(_monitor_body, UIStrings.t("coord.monitor_title"),
			UIStrings.t("coord.monitor_desc"))
	var live := _section_card(_monitor_body, UIStrings.t("coord.monitor_live"),
			UIStrings.t("coord.monitor_live_desc"), Palette.BLUE)
	var kpis := GridContainer.new()
	kpis.columns = 4
	kpis.add_theme_constant_override("h_separation", 10)
	live.add_child(kpis)
	_monitor_values = {
		"status": _monitor_kpi(kpis, UIStrings.t("coord.m_status"),
				Palette.GREEN),
		"session": _monitor_kpi(kpis, UIStrings.t("coord.m_session"),
				Palette.BLUE),
		"ram": _monitor_kpi(kpis, UIStrings.t("coord.m_ram"),
				Palette.PURPLE),
		"tokens": _monitor_kpi(kpis, UIStrings.t("coord.m_tokens"),
				Palette.YELLOW),
	}
	_monitor_detail = TerminalTheme.label("", 12, Palette.MUTED)
	_monitor_detail.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	live.add_child(_monitor_detail)
	var live_charts := HBoxContainer.new()
	live_charts.add_theme_constant_override("separation", 12)
	live.add_child(live_charts)
	var session := _coordinator_session()
	var ram_box := _mini_chart_card(live_charts,
			UIStrings.t("coord.m_ram_live"), Palette.PURPLE)
	_ram_spark = AgentMetricSparkline.new(session, "ram", Palette.PURPLE)
	ram_box.add_child(_ram_spark)
	var token_box := _mini_chart_card(live_charts,
			UIStrings.t("coord.m_token_buckets"), Palette.YELLOW)
	_token_spark = AgentMetricSparkline.new(session, "tokens", Palette.YELLOW)
	token_box.add_child(_token_spark)

	var history := _section_card(_monitor_body,
			UIStrings.t("coord.monitor_history"),
			UIStrings.t("coord.monitor_history_desc"), Palette.PURPLE)
	history.add_child(AgentHistoryChart.new("capitano"))
	_refresh_monitor(BackendBus.telemetry, BackendBus.telemetry_history)


func _monitor_kpi(parent: Container, title: String, color: Color) -> Label:
	var panel := PanelContainer.new()
	panel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	panel.add_theme_stylebox_override("panel", _card_style(Palette.DEEP,
			Color(color.r, color.g, color.b, 0.52), 12))
	parent.add_child(panel)
	var box := VBoxContainer.new()
	panel.add_child(box)
	box.add_child(TerminalTheme.label(title.to_upper(), 10, Palette.DIM,
			"medium"))
	var value := TerminalTheme.label("—", 17, color, "bold")
	value.clip_text = true
	box.add_child(value)
	return value


func _mini_chart_card(parent: Container, title: String,
		color: Color) -> VBoxContainer:
	var panel := PanelContainer.new()
	panel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	panel.add_theme_stylebox_override("panel", _card_style(Palette.DEEP,
			Palette.BORDER, 10))
	parent.add_child(panel)
	var box := VBoxContainer.new()
	panel.add_child(box)
	box.add_child(TerminalTheme.label(title.to_upper(), 10, color, "bold"))
	return box


func _coordinator_agent() -> Dictionary:
	for agent: Dictionary in BackendBus.agents:
		if str(agent.get("slug", "")) == "coordinatore" \
				or str(agent.get("uid", "")) == "coordinatore":
			return agent
	return {}


func _coordinator_session() -> String:
	var agent := _coordinator_agent()
	return str(agent.get("session", "capitano")).to_lower()


func _on_monitor_agents(_agents: Array) -> void:
	var available := not _coordinator_agent().is_empty()
	if is_instance_valid(_nav_chat):
		_nav_chat.disabled = not available
	if is_instance_valid(_nav_thinking):
		_nav_thinking.disabled = not available
	if _monitor_built:
		_refresh_monitor(BackendBus.telemetry, BackendBus.telemetry_history)


func _on_monitor_telemetry(sample: Dictionary, history: Array) -> void:
	if _monitor_built:
		_refresh_monitor(sample, history)


func _refresh_monitor(sample: Dictionary, history: Array) -> void:
	if _monitor_values.is_empty():
		return
	var agent := _coordinator_agent()
	var available := not agent.is_empty()
	var status := str(agent.get("status", "offline")) if available else "offline"
	_monitor_values["status"].text = status.to_upper()
	_monitor_values["session"].text = _coordinator_session().to_upper()
	var session := _coordinator_session()
	var ram_bytes := float((sample.get("agent_ram", {}) as Dictionary).get(
			session, 0.0))
	_monitor_values["ram"].text = _format_bytes(ram_bytes) \
			if ram_bytes > 0 else "—"
	var total_tokens := 0.0
	var has_tokens := false
	for bucket: Dictionary in sample.get("token_series", []):
		if bucket.has(session):
			has_tokens = true
			total_tokens += float(bucket[session])
	_monitor_values["tokens"].text = "%.1f kt" % total_tokens \
			if has_tokens else "—"
	var detail := str(agent.get("activity_detail", ""))
	_monitor_detail.text = ("● " + detail) if detail != "" \
			else UIStrings.t("coord.monitor_no_detail")
	_monitor_detail.add_theme_color_override("font_color",
			Palette.MINT if status == "working" else Palette.MUTED)
	if is_instance_valid(_ram_spark):
		_ram_spark.key = session
		_ram_spark.set_data(history, sample)
	if is_instance_valid(_token_spark):
		_token_spark.key = session
		_token_spark.set_data(history, sample)


static func _format_bytes(value: float) -> String:
	var amount := value
	for unit in ["B", "KB", "MB", "GB", "TB"]:
		if amount < 1024.0 or unit == "TB":
			return "%.1f %s" % [amount, unit]
		amount /= 1024.0
	return "—"


func _add_section_heading(parent: Container, title: String,
		description: String) -> void:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 14)
	parent.add_child(row)
	row.add_child(TerminalTheme.label("▰ " + title.to_upper(), 14,
			_accent, "bold"))
	var desc := TerminalTheme.label(description, 11, Palette.DIM)
	desc.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	desc.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	row.add_child(desc)


func _section_card(parent: Container, title: String, description: String,
		color: Color) -> VBoxContainer:
	var panel := PanelContainer.new()
	panel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	panel.add_theme_stylebox_override("panel", _card_style(Palette.CARD,
			Color(color.r, color.g, color.b, 0.42), 18))
	parent.add_child(panel)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 12)
	panel.add_child(box)
	box.add_child(TerminalTheme.label("◆ " + title.to_upper(), 16,
			color, "bold"))
	var desc := TerminalTheme.label(description, 11, Palette.MUTED)
	desc.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	box.add_child(desc)
	box.add_child(HSeparator.new())
	return box


func _feature_block(parent: Container, title: String, description: String,
		color: Color) -> Dictionary:
	var panel := PanelContainer.new()
	panel.add_theme_stylebox_override("panel", _card_style(Palette.DEEP,
			Palette.BORDER, 14))
	parent.add_child(panel)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 9)
	panel.add_child(box)
	var header := HBoxContainer.new()
	header.add_theme_constant_override("separation", 12)
	box.add_child(header)
	var copy := VBoxContainer.new()
	copy.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	header.add_child(copy)
	copy.add_child(TerminalTheme.label(title, 13, Palette.BRIGHT, "bold"))
	var desc := TerminalTheme.label(description, 10, Palette.MUTED)
	desc.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	copy.add_child(desc)
	var toggle := CheckButton.new()
	toggle.text = ""
	toggle.custom_minimum_size = Vector2(54, 0)
	toggle.tooltip_text = title
	header.add_child(toggle)
	toggle.toggled.connect(func(on: bool) -> void:
		panel.add_theme_stylebox_override("panel", _card_style(Palette.DEEP,
				Color(color.r, color.g, color.b, 0.72) if on else Palette.BORDER,
				14)))
	return {"body": box, "toggle": toggle, "panel": panel}


## Il colore che identifica ogni modalità nel selettore e nel badge.
func _mode_color(mode: String) -> Color:
	match mode:
		"harvest":
			return Palette.ORANGE
		"care":
			return Palette.YELLOW
		"calibration":
			return Palette.BLUE
		"saving":
			return Palette.PURPLE
		_:
			return Palette.GREEN


## Una voce del selettore delle modalità: radio + nome, poi una riga su cosa
## implica e una su quando ha senso sceglierla. Sotto, quando il backend li
## fornisce, i numeri che motivano la scelta (es. quante posizioni buone
## restano senza CV) — il click migliore è quello che non va inventato.
func _mode_option(parent: Container, mode: String) -> Dictionary:
	var color := _mode_color(mode)
	var panel := PanelContainer.new()
	panel.add_theme_stylebox_override("panel", _card_style(Palette.DEEP,
			Palette.BORDER, 12))
	parent.add_child(panel)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 5)
	panel.add_child(box)
	var radio := CheckBox.new()
	radio.text = UIStrings.t("coord.mode_" + mode)
	radio.button_group = _mode_group
	radio.add_theme_font_size_override("font_size", 13)
	box.add_child(radio)
	var what := TerminalTheme.label(UIStrings.t("coord.mode_%s_what" % mode),
			10, Palette.MUTED)
	what.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	box.add_child(what)
	var when := TerminalTheme.label(UIStrings.t("coord.mode_%s_when" % mode),
			10, Palette.DIM)
	when.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	box.add_child(when)
	var data := TerminalTheme.label("", 10, color, "bold")
	data.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	data.visible = false
	box.add_child(data)
	_mode_buttons[mode] = radio
	_mode_data_labels[mode] = data
	radio.toggled.connect(func(on: bool) -> void:
		panel.add_theme_stylebox_override("panel", _card_style(Palette.DEEP,
				Color(color.r, color.g, color.b, 0.72) if on else Palette.BORDER,
				12))
		_refresh_control_states())
	return {"body": box, "panel": panel}


## La modalità selezionata nel pannello (non necessariamente già salvata).
func _selected_mode() -> String:
	for mode: String in WORK_MODES:
		var radio: BaseButton = _mode_buttons.get(mode)
		if radio != null and radio.button_pressed:
			return mode
	return "search"


## I numeri accanto alle voci del selettore. Un backend più vecchio (o il
## mock senza dati) può non fornirli: in quel caso la riga resta nascosta —
## meglio nessun numero di un numero inventato.
func _update_mode_data(counts: Dictionary) -> void:
	for entry in [["harvest", "coord.mode_harvest_data"],
			["calibration", "coord.mode_calibration_data"]]:
		var label: Label = _mode_data_labels.get(entry[0])
		if label == null:
			continue
		label.visible = counts.has(entry[0])
		if counts.has(entry[0]):
			label.text = UIStrings.t(entry[1]) % int(counts.get(entry[0], 0))


## «Fino a quando»: la scadenza della modalità come SCELTA, non come cosa che
## si può solo perdere. Vale per la modalità selezionata, qualunque sia — la
## lezione dei 18 giorni di cura che nessuno aveva notato non riguardava
## `saving` in particolare, riguardava il durare per inerzia.
##
## Si scelgono giorni e ore, non una data: il gioco non sa in che fuso vive il
## container, quindi manda una DURATA e il container la trasforma nell'istante
## che poi tutti i lettori valutano (stessa scelta della deroga di spesa).
func _build_deadline(parent: Container) -> void:
	parent.add_child(HSeparator.new())
	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", 10)
	parent.add_child(head)
	var title := TerminalTheme.label(UIStrings.t("coord.until"), 12,
			Palette.BRIGHT, "bold")
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	title.tooltip_text = UIStrings.t("coord.until_tip")
	head.add_child(title)
	_until_toggle = CheckButton.new()
	_until_toggle.tooltip_text = UIStrings.t("coord.until_tip")
	head.add_child(_until_toggle)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 14)
	parent.add_child(row)
	_until_row = row
	_until_days = _spin(row, UIStrings.t("coord.until_days"), 0, 90, 1)
	_until_hours = _spin(row, UIStrings.t("coord.until_hours"), 0, 23, 0)
	_until_state = TerminalTheme.label("", 10, Palette.MUTED)
	_until_state.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	parent.add_child(_until_state)
	_until_toggle.toggled.connect(func(_on: bool) -> void: _touch_deadline())
	_until_days.value_changed.connect(func(_v: float) -> void: _touch_deadline())
	_until_hours.value_changed.connect(func(_v: float) -> void: _touch_deadline())


## L'utente ha cambiato la scadenza (non la stiamo solo rileggendo dal backend).
func _touch_deadline() -> void:
	if _until_syncing:
		return
	_until_dirty = true
	_refresh_control_states()


## Quanto durerà la modalità, in ore. 0 = senza scadenza.
func _deadline_hours() -> int:
	return int(_until_days.value) * 24 + int(_until_hours.value)


func _options_box(parent: Container) -> VBoxContainer:
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 7)
	parent.add_child(box)
	return box


func _compact_check(parent: Container, text: String) -> CheckButton:
	var control := CheckButton.new()
	control.text = text
	control.add_theme_font_size_override("font_size", 11)
	parent.add_child(control)
	return control


func _spin(parent: Container, label_text: String, minimum: float,
		maximum: float, initial: float, tip := "") -> SpinBox:
	var row := HBoxContainer.new()
	row.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	parent.add_child(row)
	var label := TerminalTheme.label(label_text, 11, Palette.MUTED)
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	label.tooltip_text = tip
	row.add_child(label)
	var spin := SpinBox.new()
	spin.min_value = minimum
	spin.max_value = maximum
	spin.step = 1
	spin.value = initial
	spin.custom_minimum_size = Vector2(92, 0)
	spin.tooltip_text = tip
	row.add_child(spin)
	return spin


func _minor_heading(text: String) -> Label:
	return TerminalTheme.label(text.to_upper(), 11, Palette.MUTED, "bold")


func _action_card(parent: Container, title: String, description: String,
		action: Callable) -> void:
	var panel := PanelContainer.new()
	panel.custom_minimum_size = Vector2(0, 120)
	panel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	panel.add_theme_stylebox_override("panel", _card_style(Palette.DEEP,
			Palette.BORDER, 12))
	parent.add_child(panel)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 6)
	panel.add_child(box)
	box.add_child(TerminalTheme.label(title, 12, Palette.BRIGHT, "bold"))
	var desc := TerminalTheme.label(description, 10, Palette.MUTED)
	desc.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	desc.size_flags_vertical = Control.SIZE_EXPAND_FILL
	box.add_child(desc)
	var button := Button.new()
	button.text = UIStrings.t("coord.execute")
	button.add_theme_font_size_override("font_size", 11)
	button.add_theme_color_override("font_color", _accent)
	button.pressed.connect(action)
	box.add_child(button)


func _card_style(background: Color, border: Color, padding: float) -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = background
	style.border_color = border
	style.set_border_width_all(TerminalTheme.hairline())
	style.content_margin_left = padding
	style.content_margin_right = padding
	style.content_margin_top = padding
	style.content_margin_bottom = padding
	return style


func _save_settings() -> void:
	_status_text(UIStrings.t("coord.saving"), Palette.YELLOW)
	var maintenance := {
		# "mode" è il contratto nuovo (enum chiuso); "enabled" resta per
		# compatibilità con chi legge ancora il toggle binario.
		"mode": _selected_mode(),
		"enabled": _selected_mode() == "care",
		"stop_search": _stop_search.button_pressed,
		"discard_expired_rotating": _discard_expired.button_pressed,
		"cv_min_score": int(_cv_score.value),
		"pre_check_liveness_for_cv": _precheck_cv.button_pressed,
	}
	# La scadenza si NOMINA solo se l'utente l'ha toccata: una chiave che la
	# Console non manda resta com'è sul file, quindi salvare un'altra
	# impostazione non sposta (e non cancella) una scadenza in corso. Prima era
	# il contrario, e la scadenza sparita era il difetto.
	if _until_dirty:
		if _until_toggle.button_pressed:
			maintenance["mode_until_hours"] = _deadline_hours()
		else:
			maintenance["mode_until"] = null
	BackendBus.save_coordinator_settings({
		"maintenance": maintenance,
		"enrichment": {
			"economy": _economy.button_pressed,
			"logo_enabled": _logo_enabled.button_pressed,
			"logo_min_score": null if int(_logo_score.value) == 0 else int(_logo_score.value),
			"geocode_enabled": _geo_enabled.button_pressed,
			"geocode_min_score": null if int(_geo_score.value) == 0 else int(_geo_score.value),
			"geocode_non_remote_only": _geo_non_remote.button_pressed,
			"recheck_enabled": _recheck_enabled.button_pressed,
			"recheck_min_score": int(_recheck_score.value),
			"recheck_older_days": int(_recheck_days.value),
		},
	})


func _send_custom() -> void:
	var text := _command.text.strip_edges()
	if text == "":
		_status_text(UIStrings.t("coord.empty_order"), Palette.RED)
		return
	if _permanent.button_pressed:
		_status_text(UIStrings.t("coord.saving"), Palette.YELLOW)
		BackendBus.add_team_directive(text, "order")
	else:
		_send_order(text)
	_command.text = ""


func _send_order(prompt: String) -> void:
	_status_text(UIStrings.t("coord.sending"), Palette.YELLOW)
	BackendBus.send_user_chat("coordinatore", "[ORDINE DALLA CONSOLE] " + prompt)


func _refresh_control_states() -> void:
	if _maintenance_options == null:
		return
	var care_on := _selected_mode() == "care"
	_maintenance_options.modulate.a = 1.0 if care_on else 0.34
	_stop_search.disabled = not care_on
	_discard_expired.disabled = not care_on
	_cv_score.editable = care_on
	_precheck_cv.disabled = not care_on

	if _until_toggle != null:
		var until_on := _until_toggle.button_pressed
		_until_row.modulate.a = 1.0 if until_on else 0.34
		_until_days.editable = until_on
		_until_hours.editable = until_on

	var economy_on := _economy.button_pressed
	_automation_options.modulate.a = 0.34 if economy_on else 1.0
	_geo_enabled.disabled = economy_on
	_logo_enabled.disabled = economy_on
	_recheck_enabled.disabled = economy_on
	var geo_on := not economy_on and _geo_enabled.button_pressed
	_geo_options.modulate.a = 1.0 if geo_on else 0.34
	_geo_score.editable = geo_on
	_geo_non_remote.disabled = not geo_on
	var logo_on := not economy_on and _logo_enabled.button_pressed
	_logo_options.modulate.a = 1.0 if logo_on else 0.34
	_logo_score.editable = logo_on
	var recheck_on := not economy_on and _recheck_enabled.button_pressed
	_recheck_options.modulate.a = 1.0 if recheck_on else 0.34
	_recheck_score.editable = recheck_on
	_recheck_days.editable = recheck_on


func _apply_state(state: Dictionary) -> void:
	var maintenance: Dictionary = state.get("maintenance", {})
	var enrichment: Dictionary = state.get("enrichment", {})
	var mode := str(maintenance.get("mode", ""))
	if mode == "maintenance":
		mode = "care"
	if not WORK_MODES.has(mode):
		# Backend più vecchio (solo toggle binario) o valore fuori enum.
		mode = "care" if bool(maintenance.get("enabled", false)) else "search"
	var radio: BaseButton = _mode_buttons.get(mode)
	if radio != null:
		# `button_pressed = true` lascia al ButtonGroup il de-selezionare
		# le altre voci (set_pressed_no_signal non lo farebbe).
		radio.button_pressed = true
	_stop_search.button_pressed = bool(maintenance.get("stop_search", true))
	_discard_expired.button_pressed = bool(
			maintenance.get("discard_expired_rotating", true))
	_cv_score.value = float(maintenance.get("cv_min_score", 90))
	_precheck_cv.button_pressed = bool(
			maintenance.get("pre_check_liveness_for_cv", true))
	_economy.button_pressed = bool(enrichment.get("economy", false))
	_logo_enabled.button_pressed = bool(enrichment.get("logo_enabled", true))
	_logo_score.value = _nullable_score(enrichment.get("logo_min_score"))
	_geo_enabled.button_pressed = bool(enrichment.get("geocode_enabled", true))
	_geo_score.value = _nullable_score(enrichment.get("geocode_min_score"))
	_geo_non_remote.button_pressed = bool(
			enrichment.get("geocode_non_remote_only", true))
	_recheck_enabled.button_pressed = bool(enrichment.get("recheck_enabled", true))
	_recheck_score.value = float(enrichment.get("recheck_min_score", 70))
	_recheck_days.value = float(enrichment.get("recheck_older_days", 7))
	_mode_badge.text = "● " + UIStrings.t("coord.mode_" + mode).to_upper()
	_mode_badge.add_theme_color_override("font_color", _mode_color(mode))
	_apply_deadline(maintenance)
	_update_mode_data(state.get("queue_counts", {}))
	_build_queue_cards(state.get("queue_counts", {}))
	_build_directives(state.get("directives", []))
	_refresh_control_states()
	_status_text(UIStrings.t("coord.ready"), Palette.MINT)


## La scadenza in vigore secondo il backend. `maintenance.mode` arriva già
## VALUTATO (una `saving` finita è `search`): qui si dice all'utente cosa è
## scaduto e quando, invece di lasciargli credere che il team stia ancora
## facendo quello che aveva chiesto. Un backend più vecchio non manda nessuna di
## queste chiavi: il blocco resta muto e la scadenza non si tocca.
func _apply_deadline(maintenance: Dictionary) -> void:
	if _until_toggle == null:
		return
	var until: Variant = maintenance.get("mode_until", null)
	var expired := bool(maintenance.get("expired", false))
	var left := int(maintenance.get("mode_until_sec", 0))
	var armed: bool = until != null and not expired
	# `_until_syncing`: applicare lo stato non è una scelta dell'utente, e non
	# deve far credere al salvataggio che la scadenza sia stata cambiata.
	_until_syncing = true
	_until_toggle.set_pressed_no_signal(armed)
	if armed and left > 0:
		_until_days.value = float(left / 86400)
		_until_hours.value = float((left % 86400) / 3600)
	_until_syncing = false
	_until_dirty = false
	var color := Palette.MUTED
	if expired:
		var ended := str(maintenance.get("mode_raw", ""))
		_until_state.text = UIStrings.t("coord.until_expired") % [
				UIStrings.t("coord.mode_" + ended) if ended != "" else ended,
				str(until)]
		color = Palette.YELLOW
	elif until == null:
		_until_state.text = UIStrings.t("coord.until_none")
	elif maintenance.get("mode_until_valid", true) == false:
		# Una data illeggibile NON scade (direzione sicura), ma va detto:
		# l'utente crede di aver messo una fine e non ce n'è nessuna.
		_until_state.text = UIStrings.t("coord.until_unreadable") % str(until)
		color = Palette.RED
	else:
		_until_state.text = UIStrings.t("coord.until_set") % [str(until),
				str(maintenance.get("mode_until_in", ""))]
		color = Palette.MINT
	_until_state.add_theme_color_override("font_color", color)


func _nullable_score(value: Variant) -> float:
	return 0.0 if value == null else float(value)


func _build_queue_cards(counts: Dictionary) -> void:
	for child in _queue_grid.get_children():
		child.queue_free()
	for entry in [
		["new", UIStrings.t("coord.q_new"), Palette.GREEN],
		["analysis", UIStrings.t("coord.q_analysis"), Palette.BLUE],
		["scored", UIStrings.t("coord.q_scored"), Palette.YELLOW],
		["geocode", UIStrings.t("coord.q_geo"), Palette.BLUE],
		["logos", UIStrings.t("coord.q_logo"), Palette.PURPLE],
		["recheck", UIStrings.t("coord.q_recheck"), Palette.ORANGE],
		["expired", UIStrings.t("coord.q_expired"), Palette.RED],
	]:
		var color: Color = entry[2]
		var card := PanelContainer.new()
		card.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		card.add_theme_stylebox_override("panel", _card_style(Palette.DEEP,
				Color(color.r, color.g, color.b, 0.52), 12))
		var box := VBoxContainer.new()
		box.alignment = BoxContainer.ALIGNMENT_CENTER
		card.add_child(box)
		# Chiave assente = il backend NON sa dire quel numero (immagine container
		# più vecchia del gioco, per qualche minuto durante un aggiornamento).
		# «—» e non 0: uno zero è un'informazione — «la coda è vuota» — e questo
		# non lo è. Mostrarlo come zero è come sbagliava la Console prima di
		# chiedere alle code condivise, solo nell'altra direzione.
		var value := TerminalTheme.label(
				str(int(counts[entry[0]])) if counts.has(entry[0]) else "—",
				20, color, "bold")
		value.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		box.add_child(value)
		var label := TerminalTheme.label(entry[1], 10, Palette.DIM, "medium")
		label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		box.add_child(label)
		_queue_grid.add_child(card)


func _build_directives(items: Array) -> void:
	for child in _directives.get_children():
		child.queue_free()
	if items.is_empty():
		_directives.add_child(TerminalTheme.label(UIStrings.t("coord.board_empty"),
				12, Palette.DIM))
		return
	for item: Dictionary in items:
		var card := PanelContainer.new()
		card.add_theme_stylebox_override("panel", _card_style(Palette.DEEP,
				Palette.BORDER, 10))
		_directives.add_child(card)
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 8)
		card.add_child(row)
		var body := TerminalTheme.label("[%s] %s" % [
				str(item.get("kind", "order")).to_upper(),
				str(item.get("body", ""))], 12, Palette.BASE)
		body.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(body)
		var archive := Button.new()
		archive.text = UIStrings.t("coord.archive")
		var directive_id := int(item.get("id", 0))
		archive.pressed.connect(func() -> void:
			_status_text(UIStrings.t("coord.saving"), Palette.YELLOW)
			BackendBus.archive_team_directive(directive_id))
		row.add_child(archive)


func _on_action_done(_action: String, ok: bool, error: String) -> void:
	_status_text(UIStrings.t("coord.saved") if ok \
			else UIStrings.t("coord.error") % error,
			Palette.MINT if ok else Palette.RED)


func _on_order_sent(agent: String, ok: bool, error: String) -> void:
	if not (agent.begins_with("coordinatore") or agent.begins_with("capitano")):
		return
	_status_text(UIStrings.t("coord.sent") if ok \
			else UIStrings.t("coord.error") % error,
			Palette.MINT if ok else Palette.RED)


func _status_text(value: String, color: Color) -> void:
	if not is_instance_valid(_status):
		return
	_status.text = "● " + value
	_status.add_theme_color_override("font_color", color)


func close(sound := true) -> void:
	if _closing:
		return
	_closing = true
	if sound:
		Sfx.play_back()
	closed.emit()
	queue_free()
