class_name SectionPanel
extends CanvasLayer
## Pannello di una sezione della sidebar (scheletro): titolo + placeholder.
## Il contenuto vero arriva sezione per sezione con la migrazione dalla
## desktop app. Si chiude con la ✕ o ricliccando la voce in sidebar.

signal closed

var section := ""
var _sidebar_width := 0.0

func _init(p_section: String, sidebar_width: float) -> void:
	section = p_section
	_sidebar_width = sidebar_width
	layer = 19  # sotto la sidebar: la linguetta resta cliccabile

func _ready() -> void:
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.theme = TerminalTheme.get_theme()
	add_child(root)

	var holder := MarginContainer.new()
	holder.set_anchors_preset(Control.PRESET_FULL_RECT)
	holder.add_theme_constant_override("margin_left", int(_sidebar_width) + 24)
	holder.add_theme_constant_override("margin_right", 120)
	holder.add_theme_constant_override("margin_top", 40)
	holder.add_theme_constant_override("margin_bottom", 60)
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(holder)

	var panel := BracketPanel.new()
	holder.add_child(panel)
	var margin := MarginContainer.new()
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 26)
	panel.add_child(margin)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 12)
	margin.add_child(box)

	var title_row := HBoxContainer.new()
	box.add_child(title_row)
	var title := TerminalTheme.label(
			SidebarDefs.label_for(section).to_upper(), 24, Palette.WHITE, "xbold")
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	title_row.add_child(title)
	var close_btn := Button.new()
	close_btn.flat = true
	close_btn.text = "✕"
	close_btn.add_theme_font_size_override("font_size", 20)
	close_btn.add_theme_color_override("font_color", Palette.MUTED)
	close_btn.add_theme_color_override("font_hover_color", Palette.RED)
	close_btn.pressed.connect(func() -> void: closed.emit())
	title_row.add_child(close_btn)

	box.add_child(HSeparator.new())
	_content = VBoxContainer.new()
	_content.add_theme_constant_override("separation", 10)
	box.add_child(_content)
	_build()

var _content: VBoxContainer

## Contenuto per sezione: le viste migrate hanno il loro builder, le altre
## mostrano il placeholder finché non vengono portate dalla desktop app.
func _build(page := "") -> void:
	for child in _content.get_children():
		child.queue_free()
	match section:
		"stats":
			if page == "usage":
				_build_usage()
			else:
				_build_stats()
		"map":
			_content.add_child(MapView.new())
		"team":
			_build_team()
		"agents":
			_build_agents()
		"activity":
			_build_activity()
		"apps":
			_build_apps()
		"dashboard":
			_build_dashboard()
		"notifs":
			_build_notifs()
		"chat":
			_build_chat()
		"vps":
			_build_vps()
		"positions":
			_build_positions()
		"profile", "hours", "provider", "docker", "account", "email", "language", "advanced":
			_build_config()
		_:
			_build_placeholder()

## Sezioni config: coppie etichetta/valore dal contratto dati, SOLA
## LETTURA — in linea col modello desktop-first (si modifica solo da lì).
func _build_config() -> void:
	var rows: Array = TeamData.settings().get(section, [])
	if rows.is_empty():
		_build_placeholder()
		return
	for pair in rows:
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 12)
		_content.add_child(row)
		var lbl := TerminalTheme.label(str(pair[0]), 14, Palette.MUTED, "medium")
		lbl.custom_minimum_size = Vector2(220, 0)
		row.add_child(lbl)
		row.add_child(TerminalTheme.label(str(pair[1]), 16, Palette.BRIGHT))
	_content.add_child(HSeparator.new())
	_content.add_child(TerminalTheme.label(
			"// sola lettura — si modifica dalla desktop app", 13, Palette.DIM))

# ── Posizioni: la pagina positions del web privato, dati veri ────────

## Stessi colori-fase della pipeline web (status → colore).
const POS_STATUS_COLORS := {
	"new": Palette.MUTED, "checked": Palette.BLUE, "scored": Palette.PURPLE,
	"writing": Palette.YELLOW, "review": Palette.ORANGE, "ready": Palette.MINT,
	"applied": Palette.GREEN, "response": Palette.BLUE, "excluded": Palette.RED,
}
const POS_STATUS_ORDER := ["new", "checked", "scored", "writing", "review",
		"ready", "applied", "response", "excluded"]
const POS_LIST_MAX := 40

## Filtri attivi (chip → set di valori). Persistono finché il pannello vive.
var _pos_filters := {
	"status": {}, "role_family": {}, "loc_country": {}, "work_mode": {},
}

## Cross-filtering come sul web: ogni gruppo di chip conta le posizioni
## filtrate da TUTTI GLI ALTRI gruppi, la lista le filtra da tutti.
func _build_positions() -> void:
	var all: Array = BackendBus.positions
	if all.is_empty():
		_content.add_child(TerminalTheme.label(UIStrings.t("pos.need_vps"),
				15, Palette.MUTED))
		if not BackendBus.positions_updated.is_connected(_on_positions_refresh):
			BackendBus.positions_updated.connect(_on_positions_refresh)
		return
	if not BackendBus.positions_updated.is_connected(_on_positions_refresh):
		BackendBus.positions_updated.connect(_on_positions_refresh)

	var visible_rows := _pos_filtered(all, "")
	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", 16)
	_content.add_child(head)
	var count := TerminalTheme.label(UIStrings.t("pos.count")
			% [all.size(), visible_rows.size()], 15, Palette.MINT, "medium")
	count.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(count)
	var any_filter := false
	for key in _pos_filters:
		if not (_pos_filters[key] as Dictionary).is_empty():
			any_filter = true
	if any_filter:
		var clear := Button.new()
		clear.text = UIStrings.t("pos.clear")
		clear.add_theme_font_size_override("font_size", 13)
		clear.add_theme_color_override("font_color", Palette.RED)
		clear.pressed.connect(func() -> void:
			for key in _pos_filters:
				_pos_filters[key] = {}
			_build())
		head.add_child(clear)

	_pos_chip_row("status", UIStrings.t("pos.f_status"), all)
	_pos_chip_row("role_family", UIStrings.t("pos.f_family"), all)
	_pos_chip_row("work_mode", UIStrings.t("pos.f_mode"), all)
	_pos_chip_row("loc_country", UIStrings.t("pos.f_country"), all)
	_content.add_child(HSeparator.new())

	if visible_rows.is_empty():
		_content.add_child(TerminalTheme.label(UIStrings.t("pos.no_match"),
				15, Palette.DIM))
		return
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.custom_minimum_size = Vector2(0, 300)
	_content.add_child(scroll)
	var list := VBoxContainer.new()
	list.add_theme_constant_override("separation", 6)
	list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(list)
	for p in visible_rows.slice(0, POS_LIST_MAX):
		list.add_child(_pos_row(p))
	if visible_rows.size() > POS_LIST_MAX:
		list.add_child(TerminalTheme.label(
				"… e altre %d" % (visible_rows.size() - POS_LIST_MAX), 13, Palette.DIM))

func _on_positions_refresh(_list: Array) -> void:
	if section == "positions" and is_instance_valid(_content):
		_build()

## Posizioni filtrate da tutti i gruppi tranne `skip` (cross-filter).
func _pos_filtered(all: Array, skip: String) -> Array:
	var out: Array = []
	for p in all:
		var ok := true
		for key in _pos_filters:
			if key == skip:
				continue
			var chosen: Dictionary = _pos_filters[key]
			if chosen.is_empty():
				continue
			if not chosen.has(_pos_value(p, key)):
				ok = false
				break
		if ok:
			out.append(p)
	return out

func _pos_value(p: Dictionary, key: String) -> String:
	var v := str(p.get(key, ""))
	return v if v != "" and v != "<null>" else UIStrings.t("pos.uncategorized")

## Una riga di chip per un gruppo di filtro, con conteggi cross-filtrati.
func _pos_chip_row(key: String, title: String, all: Array) -> void:
	var pool := _pos_filtered(all, key)
	var counts := {}
	for p in pool:
		var v := _pos_value(p, key)
		counts[v] = int(counts.get(v, 0)) + 1
	var values: Array = counts.keys()
	if key == "status":  # ordine di pipeline, non alfabetico
		var ordered: Array = []
		for st in POS_STATUS_ORDER:
			if counts.has(st):
				ordered.append(st)
		for v in values:
			if not POS_STATUS_ORDER.has(v):
				ordered.append(v)
		values = ordered
	else:
		values.sort()

	var row := HFlowContainer.new()
	row.add_theme_constant_override("h_separation", 8)
	row.add_theme_constant_override("v_separation", 6)
	_content.add_child(row)
	var lbl := TerminalTheme.label(title, 13, Palette.DIM, "medium")
	lbl.custom_minimum_size = Vector2(150, 0)
	row.add_child(lbl)
	var chosen: Dictionary = _pos_filters[key]
	for v in values:
		var chip := Button.new()
		var active: bool = chosen.has(v)
		chip.text = "%s %d" % [v, counts[v]]
		chip.add_theme_font_size_override("font_size", 13)
		var color: Color = POS_STATUS_COLORS.get(v, Palette.BASE) \
				if key == "status" else Palette.BASE
		chip.add_theme_color_override("font_color",
				color if active or chosen.is_empty() else Palette.DIM)
		var sb := StyleBoxFlat.new()
		sb.bg_color = Color(color.r, color.g, color.b, 0.18 if active else 0.0)
		sb.border_color = color if active else Palette.BORDER
		sb.set_border_width_all(1)
		sb.content_margin_left = 8
		sb.content_margin_right = 8
		sb.content_margin_top = 2
		sb.content_margin_bottom = 3
		chip.add_theme_stylebox_override("normal", sb)
		chip.add_theme_stylebox_override("hover", sb.duplicate())
		chip.add_theme_stylebox_override("pressed", sb.duplicate())
		chip.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
		chip.pressed.connect(func() -> void:
			if chosen.has(v):
				chosen.erase(v)
			else:
				chosen[v] = true
			Sfx.play_tick()
			_build())
		row.add_child(chip)

## Una posizione in lista: score | titolo — azienda | luogo | stato.
func _pos_row(p: Dictionary) -> Control:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 14)
	var score_v: Variant = p.get("total_score")
	var score_txt := "—" if score_v == null else str(int(score_v))
	var score_col: Color = Palette.DIM if score_v == null \
			else (Palette.MINT if int(score_v) >= 70 else Palette.YELLOW)
	var score := TerminalTheme.label(score_txt, 17, score_col, "bold")
	score.custom_minimum_size = Vector2(40, 0)
	row.add_child(score)
	var text_col := VBoxContainer.new()
	text_col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(text_col)
	text_col.add_child(TerminalTheme.label("%s — %s" % [
			_pos_value(p, "title"), _pos_value(p, "company")], 15, Palette.BRIGHT))
	var place := "%s · %s" % [str(p.get("loc_city", "") if p.get("loc_city") else "—"),
			_pos_value(p, "loc_country")]
	text_col.add_child(TerminalTheme.label(place, 13, Palette.MUTED))
	var st := _pos_value(p, "status")
	var st_lbl := TerminalTheme.label(st, 13,
			POS_STATUS_COLORS.get(st, Palette.MUTED), "medium")
	st_lbl.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(st_lbl)
	# aria a destra: la scrollbar non deve coprire lo stato
	var pad := Control.new()
	pad.custom_minimum_size = Vector2(18, 0)
	row.add_child(pad)
	return row

# ── Impostazioni → Collega VPS ────────────────────────────────────────

var _vps_ip: LineEdit
var _vps_key: LineEdit
var _vps_state_lbl: Label
var _vps_agents_box: VBoxContainer

## Il form del PRIMO PASSO backend: IP + chiave SSH → VpsBackend reale.
## Stato e roster arrivano live dal BackendBus (il collegamento resta
## vivo anche a pannello chiuso: vive nell'autoload, non qui).
func _build_vps() -> void:
	_content.add_child(TerminalTheme.label(UIStrings.t("vps.intro"), 15, Palette.MUTED))
	var cfg: Dictionary = BackendBus.load_vps_config()

	_vps_ip = _vps_input(UIStrings.t("vps.ip"), cfg.get("ip", ""), "203.0.113.10")
	_vps_key = _vps_input(UIStrings.t("vps.key"), cfg.get("key_path", ""),
			"~/.ssh/id_ed25519")
	var browse := Button.new()
	browse.text = UIStrings.t("vps.key_browse")
	browse.add_theme_font_size_override("font_size", 14)
	browse.add_theme_color_override("font_color", Palette.MUTED)
	browse.pressed.connect(_browse_vps_key)
	_vps_key.get_parent().add_child(browse)

	var actions := HBoxContainer.new()
	actions.add_theme_constant_override("separation", 16)
	_content.add_child(actions)
	var connect_btn := Button.new()
	connect_btn.text = UIStrings.t("vps.connect")
	connect_btn.add_theme_font_size_override("font_size", 16)
	connect_btn.add_theme_color_override("font_color", Palette.GREEN)
	connect_btn.pressed.connect(_connect_vps)
	actions.add_child(connect_btn)
	var disconnect_btn := Button.new()
	disconnect_btn.text = UIStrings.t("vps.disconnect")
	disconnect_btn.add_theme_font_size_override("font_size", 16)
	disconnect_btn.add_theme_color_override("font_color", Palette.MUTED)
	disconnect_btn.pressed.connect(func() -> void: BackendBus.disconnect_backend())
	actions.add_child(disconnect_btn)

	_vps_state_lbl = TerminalTheme.label("", 16, Palette.MUTED, "medium")
	_content.add_child(_vps_state_lbl)
	_content.add_child(HSeparator.new())
	_content.add_child(TerminalTheme.label(UIStrings.t("vps.agents_live"),
			14, Palette.MUTED, "medium"))
	_vps_agents_box = VBoxContainer.new()
	_vps_agents_box.add_theme_constant_override("separation", 6)
	_content.add_child(_vps_agents_box)

	BackendBus.connection_changed.connect(_on_vps_state)
	BackendBus.agents_updated.connect(_on_vps_agents)
	_on_vps_state(BackendBus.state, BackendBus.state_detail)
	_on_vps_agents(BackendBus.agents)

func _vps_input(label_text: String, value: String, placeholder: String) -> LineEdit:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	_content.add_child(row)
	var lbl := TerminalTheme.label(label_text, 14, Palette.MUTED, "medium")
	lbl.custom_minimum_size = Vector2(220, 0)
	row.add_child(lbl)
	var edit := LineEdit.new()
	edit.text = value
	edit.placeholder_text = placeholder
	edit.custom_minimum_size = Vector2(360, 0)
	edit.add_theme_font_size_override("font_size", 15)
	row.add_child(edit)
	return edit

func _browse_vps_key() -> void:
	var dlg := FileDialog.new()
	dlg.file_mode = FileDialog.FILE_MODE_OPEN_FILE
	dlg.access = FileDialog.ACCESS_FILESYSTEM
	dlg.use_native_dialog = true
	dlg.show_hidden_files = true
	dlg.file_selected.connect(func(path: String) -> void: _vps_key.text = path)
	add_child(dlg)
	dlg.popup_centered()

func _connect_vps() -> void:
	var ip := _vps_ip.text.strip_edges()
	var key := _vps_key.text.strip_edges().replace("~", OS.get_environment("HOME"))
	if ip == "" or key == "":
		_vps_state_lbl.text = "● " + UIStrings.t("vps.missing_fields")
		_vps_state_lbl.add_theme_color_override("font_color", Palette.YELLOW)
		return
	BackendBus.save_vps_config(ip, key)
	BackendBus.set_backend(VpsBackend.new(), {"ip": ip, "key_path": key})

func _on_vps_state(state: int, detail: String) -> void:
	if not is_instance_valid(_vps_state_lbl):
		return
	match state:
		BackendBus.CONNECTED:
			_vps_state_lbl.text = "● %s — %s" % [UIStrings.t("vps.state_connected"), detail]
			_vps_state_lbl.add_theme_color_override("font_color", Palette.GREEN)
		BackendBus.CONNECTING:
			_vps_state_lbl.text = "◌ %s %s" % [UIStrings.t("vps.state_connecting"), detail]
			_vps_state_lbl.add_theme_color_override("font_color", Palette.YELLOW)
		BackendBus.ERROR:
			_vps_state_lbl.text = "▲ %s: %s" % [UIStrings.t("vps.state_error"), detail]
			_vps_state_lbl.add_theme_color_override("font_color", Palette.RED)
		_:
			_vps_state_lbl.text = "○ " + UIStrings.t("vps.state_disconnected")
			_vps_state_lbl.add_theme_color_override("font_color", Palette.MUTED)

func _on_vps_agents(agents: Array) -> void:
	if not is_instance_valid(_vps_agents_box):
		return
	for child in _vps_agents_box.get_children():
		child.queue_free()
	if agents.is_empty():
		_vps_agents_box.add_child(TerminalTheme.label(
				UIStrings.t("vps.agents_none"), 14, Palette.DIM))
		return
	for a in agents:
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 12)
		_vps_agents_box.add_child(row)
		row.add_child(TerminalTheme.label("●", 13, Palette.GREEN))
		var name_lbl := TerminalTheme.label(str(a.get("name", a.get("slug", "?"))),
				15, Palette.BRIGHT)
		name_lbl.custom_minimum_size = Vector2(220, 0)
		row.add_child(name_lbl)
		row.add_child(TerminalTheme.label(str(a.get("status", "working")), 14, Palette.MINT))

func _build_placeholder() -> void:
	_content.add_child(TerminalTheme.label(
			"// sezione in migrazione dalla desktop app", 16, Palette.DIM))
	_content.add_child(TerminalTheme.label(
			"I contenuti di «%s» verranno portati qui, un pezzo alla volta."
			% SidebarDefs.label_for(section), 15, Palette.MUTED))

# ── Team / Agenti / Attività / Candidature / Dashboard ────────────────

## Il team per reparto: organico e postazioni libere, più i core.
func _build_team() -> void:
	for dept_id in DepartmentDefs.DEPT_ORDER:
		var dept: Dictionary = DepartmentDefs.DEPARTMENTS[dept_id]
		var occupied := 0
		for i in (dept["desks"] as Array).size():
			if CharacterDefs.desk_occupant_name(dept_id, i) != "":
				occupied += 1
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 12)
		_content.add_child(row)
		row.add_child(TerminalTheme.label("▮", 16, dept["color"], "bold"))
		var name_lbl := TerminalTheme.label(dept["name"], 17, Palette.BRIGHT, "medium")
		name_lbl.custom_minimum_size = Vector2(160, 0)
		row.add_child(name_lbl)
		row.add_child(TerminalTheme.label("%d/%d postazioni" % [occupied,
				(dept["desks"] as Array).size()], 15, Palette.MUTED))
		var tag := TerminalTheme.label(dept["tagline"], 14, Palette.DIM)
		tag.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		tag.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		row.add_child(tag)
	_content.add_child(HSeparator.new())
	_content.add_child(TerminalTheme.label(
			"Core: Il Coordinatore · Il Mentor · L'Assistente", 15, Palette.MUTED))

## Tutti gli agenti in scena con stato del ruolo.
func _build_agents() -> void:
	for def in CharacterDefs.spawn_list():
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 12)
		_content.add_child(row)
		var dept_id: String = def.get("dept", "")
		var color: Color = DepartmentDefs.DEPARTMENTS[dept_id]["color"] \
				if dept_id != "" else Palette.MUTED
		row.add_child(TerminalTheme.label("●", 13, color))
		var name_lbl := TerminalTheme.label(def["name"], 16,
				Palette.BRIGHT if def.get("lead", false) else Palette.BASE,
				"medium" if def.get("lead", false) else "")
		name_lbl.custom_minimum_size = Vector2(220, 0)
		row.add_child(name_lbl)
		var status: Dictionary = TeamData.agent_status().get(def["slug"], {})
		var st := TerminalTheme.label(status.get("status", "operativo"), 14, Palette.MINT)
		st.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		st.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		row.add_child(st)

## Feed unico delle attività recenti di tutti i ruoli.
func _build_activity() -> void:
	for slug in ["scout", "analista", "scorer", "scrittore", "critico", "coordinatore"]:
		for entry in TeamData.agent_activity(slug):
			var row := HBoxContainer.new()
			row.add_theme_constant_override("separation", 14)
			_content.add_child(row)
			var when := TerminalTheme.label(entry["when"], 13, Palette.DIM)
			when.custom_minimum_size = Vector2(80, 0)
			row.add_child(when)
			var who := TerminalTheme.label(slug, 13, Palette.MUTED)
			who.custom_minimum_size = Vector2(110, 0)
			row.add_child(who)
			row.add_child(TerminalTheme.label(entry["text"], 14, Palette.BASE))

## Candidature a stadi (stessi dati del registro TAB).
func _build_apps() -> void:
	var apps: Array = TeamData.applications()
	if apps.is_empty():
		_content.add_child(TerminalTheme.label(UIStrings.t("registry.empty"), 15, Palette.DIM))
	var names := ["inviata", "screening", "colloquio", "offerta"]
	for app in apps:
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 14)
		_content.add_child(row)
		var score := TerminalTheme.label(str(app["score"]), 18,
				Palette.MINT if app["score"] >= 70 else Palette.YELLOW, "bold")
		score.custom_minimum_size = Vector2(44, 0)
		row.add_child(score)
		var title_lbl := TerminalTheme.label("%s — %s" % [app["title"], app["company"]],
				15, Palette.BRIGHT)
		title_lbl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(title_lbl)
		var stage: int = app["stage"]
		row.add_child(TerminalTheme.label(names[clampi(stage, 0, 3)], 14,
				Palette.GREEN if stage >= 2 else Palette.MUTED, "medium"))

## Dashboard: riepilogo + posizioni di oggi.
func _build_dashboard() -> void:
	var s: Dictionary = TeamData.summary()
	_kpi_row("POSIZIONI OGGI", str(s.get("positions_today", 0)), Palette.MINT)
	_kpi_row("SCORE MEDIO", str(s.get("avg_score", 0)), Palette.MINT)
	_bar_row("BUDGET USATO", s.get("budget_used_pct", 0.0), Palette.GREEN)
	_content.add_child(HSeparator.new())
	_content.add_child(TerminalTheme.label("POSIZIONI DI OGGI", 14, Palette.MUTED, "medium"))
	for p in TeamData.positions_today():
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 14)
		_content.add_child(row)
		var score := TerminalTheme.label(str(p["score"]), 18,
				Palette.MINT if p["score"] >= 70 else Palette.YELLOW, "bold")
		score.custom_minimum_size = Vector2(44, 0)
		row.add_child(score)
		var text_col := VBoxContainer.new()
		text_col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(text_col)
		text_col.add_child(TerminalTheme.label("%s — %s" % [p["title"], p["company"]],
				15, Palette.BRIGHT))
		text_col.add_child(TerminalTheme.label("%s · %s" % [p["location"], p["salary"]],
				13, Palette.MUTED))

## Notifiche recenti del team.
func _build_notifs() -> void:
	for n in TeamData.notifications():
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 14)
		_content.add_child(row)
		var warn: bool = n.get("level", "info") == "warn"
		row.add_child(TerminalTheme.label("▲" if warn else "●", 14,
				Palette.YELLOW if warn else Palette.GREEN))
		var when := TerminalTheme.label(n["when"], 13, Palette.DIM)
		when.custom_minimum_size = Vector2(80, 0)
		row.add_child(when)
		row.add_child(TerminalTheme.label(n["text"], 15, Palette.BASE))

## Chat del team (sola lettura: si scrive dalla desktop app).
func _build_chat() -> void:
	for msg in TeamData.chat():
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 12)
		_content.add_child(row)
		var when := TerminalTheme.label(msg["when"], 13, Palette.DIM)
		when.custom_minimum_size = Vector2(56, 0)
		row.add_child(when)
		var who := TerminalTheme.label(msg["from"], 14, Palette.MINT, "medium")
		who.custom_minimum_size = Vector2(120, 0)
		row.add_child(who)
		row.add_child(TerminalTheme.label(msg["text"], 15, Palette.BASE))
	_content.add_child(HSeparator.new())
	_content.add_child(TerminalTheme.label(
			"// sola lettura — si scrive dalla desktop app", 13, Palette.DIM))

# ── Statistiche + pagina Utilizzo ─────────────────────────────────────

func _build_stats() -> void:
	var s: Dictionary = TeamData.summary()
	var streak: Dictionary = TeamData.streak()
	_kpi_row("POSIZIONI OGGI", str(s.get("positions_today", 0)), Palette.MINT)
	_kpi_row("SCORE MEDIO", str(s.get("avg_score", 0)), Palette.MINT)
	_kpi_row("STREAK", "%d giorni · %d freeze" % [streak.get("days", 0),
			streak.get("freezes", 0)], Palette.ORANGE)
	_bar_row("BUDGET USATO", s.get("budget_used_pct", 0.0), Palette.GREEN)
	_content.add_child(HSeparator.new())
	# candidature per stadio
	var stages := [0, 0, 0, 0]
	for app in TeamData.applications():
		stages[clampi(int(app["stage"]), 0, 3)] += 1
	_content.add_child(TerminalTheme.label("CANDIDATURE PER STADIO", 14, Palette.MUTED, "medium"))
	var names := ["inviata", "screening", "colloquio", "offerta"]
	for i in 4:
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 12)
		_content.add_child(row)
		var lbl := TerminalTheme.label(names[i], 14, Palette.BASE)
		lbl.custom_minimum_size = Vector2(120, 0)
		row.add_child(lbl)
		row.add_child(TerminalTheme.label("▰".repeat(stages[i]) if stages[i] > 0 else "—",
				16, Palette.GREEN if i >= 2 else Palette.BASE, "bold"))
		row.add_child(TerminalTheme.label(str(stages[i]), 14, Palette.MUTED))
	_content.add_child(HSeparator.new())
	var usage_btn := Button.new()
	usage_btn.text = "▶ UTILIZZO"
	usage_btn.add_theme_font_size_override("font_size", 16)
	usage_btn.add_theme_color_override("font_color", Palette.GREEN)
	usage_btn.pressed.connect(func() -> void: _build("usage"))
	_content.add_child(usage_btn)

func _build_usage() -> void:
	var u: Dictionary = TeamData.usage()
	_content.add_child(TerminalTheme.label("UTILIZZO", 16, Palette.WHITE, "bold"))
	_kpi_row("PROVIDER", str(u.get("provider", "—")), Palette.BRIGHT)
	_kpi_row("AZIONI OGGI", str(u.get("actions_today", 0)), Palette.MINT)
	_kpi_row("AZIONI SETTIMANA", str(u.get("actions_week", 0)), Palette.MINT)
	_kpi_row("TOKEN OGGI", str(u.get("tokens_today", "—")), Palette.MINT)
	_bar_row("QUOTA SETTIMANALE", u.get("quota_week_pct", 0.0), Palette.YELLOW)
	_bar_row("BUDGET USATO", u.get("budget_used_pct", 0.0), Palette.GREEN)
	_content.add_child(HSeparator.new())
	var back := Button.new()
	back.text = "◀ STATISTICHE"
	back.add_theme_font_size_override("font_size", 16)
	back.add_theme_color_override("font_color", Palette.MUTED)
	back.pressed.connect(func() -> void: _build())
	_content.add_child(back)

func _kpi_row(label_text: String, value: String, value_color: Color) -> void:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	_content.add_child(row)
	var lbl := TerminalTheme.label(label_text, 14, Palette.MUTED, "medium")
	lbl.custom_minimum_size = Vector2(220, 0)
	row.add_child(lbl)
	row.add_child(TerminalTheme.label(value, 18, value_color, "bold"))

func _bar_row(label_text: String, pct: float, color: Color) -> void:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	_content.add_child(row)
	var lbl := TerminalTheme.label(label_text, 14, Palette.MUTED, "medium")
	lbl.custom_minimum_size = Vector2(220, 0)
	row.add_child(lbl)
	var bar := ProgressBar.new()
	bar.custom_minimum_size = Vector2(220, 16)
	bar.max_value = 1.0
	bar.value = pct
	bar.show_percentage = false
	bar.modulate = color
	row.add_child(bar)
	row.add_child(TerminalTheme.label("%d%%" % int(pct * 100), 14, color, "bold"))
