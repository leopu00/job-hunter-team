class_name SectionPanel
extends CanvasLayer
## Pannello di una sezione della sidebar (scheletro): titolo + placeholder.
## Il contenuto vero arriva sezione per sezione con la migrazione dalla
## desktop app. Si chiude con la ✕ o ricliccando la voce in sidebar.

signal closed
## Chiesto un salto a un'altra sezione (es. box pipeline → positions):
## chi ospita il pannello (la sidebar) decide come aprirla.
signal navigate(section: String)

## Filtro status da applicare al prossimo pannello positions (i box
## della pipeline pre-filtrano come i link del web). Consumato al build.
static var pending_status: Array = []
## Dettaglio da aprire al prossimo pannello positions (click su una
## posizione da un'altra sezione, es. grafici stats). Consumato al build.
static var pending_detail := 0

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
	_content.size_flags_vertical = Control.SIZE_EXPAND_FILL
	box.add_child(_content)
	# TEST-AUTO: JHT_POS_DETAIL=<id> apre il dettaglio di quella posizione
	# appena lo snapshot arriva (il refresh del bus rientra da solo);
	# JHT_AGENT_PAGE=<slug> apre la pagina del singolo agente.
	if section == "positions" and OS.get_environment("JHT_POS_DETAIL") != "":
		_pos_detail_id = int(OS.get_environment("JHT_POS_DETAIL"))
	if section == "positions" and pending_detail != 0:
		_pos_detail_id = pending_detail
		pending_detail = 0
	if section == "agents" and OS.get_environment("JHT_AGENT_PAGE") != "":
		_agent_detail = OS.get_environment("JHT_AGENT_PAGE")
		_build("agent")
		return
	_build("detail" if _pos_detail_id != 0 else "")

var _content: VBoxContainer

## Contenuto per sezione: le viste migrate hanno il loro builder, le altre
## mostrano il placeholder finché non vengono portate dalla desktop app.
var _current_page := ""

func _build(page := "") -> void:
	_current_page = page
	for child in _content.get_children():
		child.queue_free()
	match section:
		"stats":
			if page == "usage":
				_build_usage()
			else:
				_build_stats()
		"map":
			# l'esperienza mappa del web privato: globo → mappa piatta
			_content.add_child(WorldMap.new())
		"team":
			_build_team()
		"agents":
			if page == "agent" and _agent_detail != "":
				_build_agent_page()
			else:
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
			if page == "detail" and _pos_detail_id != 0:
				_build_pos_detail()
			else:
				_build_positions()
		"language":
			_build_language()
		"profile":
			_build_profile()
		"hours":
			_build_hours()
		"provider", "docker", "account", "email", "advanced":
			_build_config()
		_:
			_build_placeholder()

## Sezioni config: coppie etichetta/valore, SOLA LETTURA — in linea col
## modello desktop-first. Con la VPS collegata mostrano la config VERA
## del team (campi safe da jht.config.json), altrimenti il mock.
func _build_config() -> void:
	if not BackendBus.live_settings_updated.is_connected(_on_config_refresh):
		BackendBus.live_settings_updated.connect(_on_config_refresh)
	var rows: Array = []
	if BackendBus.is_live():
		# connessi: mostra la config VERA — mai il mock spacciato per reale
		rows = BackendBus.live_settings.get(section, [])
		if rows.is_empty():
			_content.add_child(TerminalTheme.label(
					UIStrings.t("config.incoming") if BackendBus.live_settings.is_empty()
					else UIStrings.t("config.not_exposed"), 14, Palette.DIM))
			return
	else:
		rows = TeamData.settings().get(section, [])
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
		# a capo automatico: un valore lungo (es. lista skill) non deve
		# allargare il pannello oltre lo schermo
		var val := TerminalTheme.label(str(pair[1]), 16, Palette.BRIGHT)
		val.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		val.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(val)
	_content.add_child(HSeparator.new())
	_content.add_child(TerminalTheme.label(
			UIStrings.t("common.readonly_desktop"), 13, Palette.DIM))

## Gli ORARI DI LAVORO del team: editabili QUI, con feedback DINAMICO
## (feedback Leone 21:3x): cambi le finestre e vedi subito le ore
## attive, la stima approssimativa di posizioni/giorno (rate storico
## degli ultimi 7 giorni) e il budget riproporzionato.
var _hours_tz: LineEdit
var _hours_windows: Array = []   # working copy [{days, start, end}]
var _hours_estimate_lbl: Label
var _hours_status: Label
var _hours_save_btn: Button
var _hours_loaded := false

func _build_hours() -> void:
	if not BackendBus.hours_saved.is_connected(_on_hours_saved):
		BackendBus.hours_saved.connect(_on_hours_saved)
	var raw: Dictionary = BackendBus.live_settings.get("hours_raw", {})
	if not BackendBus.is_live() or raw.is_empty():
		_build_config()
		return
	if not _hours_loaded:
		_hours_windows = []
		for w in raw.get("windows", []):
			_hours_windows.append({"days": ", ".join(PackedStringArray(w.get("days", []))),
					"start": str(w.get("start", "09:00")), "end": str(w.get("end", "18:00"))})
		_hours_loaded = true
	_content.add_child(TerminalTheme.label(UIStrings.t("hours.intro"), 14, Palette.MUTED))
	var tz_row := HBoxContainer.new()
	tz_row.add_theme_constant_override("separation", 12)
	_content.add_child(tz_row)
	var tz_lbl := TerminalTheme.label(UIStrings.t("hours.tz"), 14, Palette.MUTED, "medium")
	tz_lbl.custom_minimum_size = Vector2(220, 0)
	tz_row.add_child(tz_lbl)
	_hours_tz = LineEdit.new()
	_hours_tz.text = str(raw.get("timezone", "Europe/Rome"))
	_hours_tz.custom_minimum_size = Vector2(280, 0)
	tz_row.add_child(_hours_tz)
	_content.add_child(TerminalTheme.label(UIStrings.t("hours.windows"),
			14, Palette.MUTED, "medium"))
	for i in _hours_windows.size():
		var w: Dictionary = _hours_windows[i]
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 10)
		_content.add_child(row)
		var days := LineEdit.new()
		days.text = str(w["days"])
		days.placeholder_text = "mon, tue, wed…"
		days.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(days)
		var start := LineEdit.new()
		start.text = str(w["start"])
		start.custom_minimum_size = Vector2(100, 0)
		row.add_child(start)
		row.add_child(TerminalTheme.label("→", 14, Palette.DIM))
		var end := LineEdit.new()
		end.text = str(w["end"])
		end.custom_minimum_size = Vector2(100, 0)
		row.add_child(end)
		var win: Dictionary = w
		var sync := func() -> void:
			win["days"] = days.text
			win["start"] = start.text
			win["end"] = end.text
			_refresh_hours_estimate()
		days.text_changed.connect(func(_t: String) -> void: sync.call())
		start.text_changed.connect(func(_t: String) -> void: sync.call())
		end.text_changed.connect(func(_t: String) -> void: sync.call())
		var rm := Button.new()
		rm.flat = true
		rm.text = "✕"
		rm.add_theme_color_override("font_color", Palette.RED)
		var idx := i
		rm.pressed.connect(func() -> void:
			_hours_windows.remove_at(idx)
			_build())
		row.add_child(rm)
	var add := Button.new()
	add.flat = true
	add.text = UIStrings.t("hours.add")
	add.add_theme_color_override("font_color", Palette.GREEN)
	add.alignment = HORIZONTAL_ALIGNMENT_LEFT
	add.pressed.connect(func() -> void:
		_hours_windows.append({"days": "mon, tue, wed, thu, fri",
				"start": "09:00", "end": "18:00"})
		_build())
	_content.add_child(add)
	_content.add_child(HSeparator.new())
	_hours_estimate_lbl = TerminalTheme.label("", 14, Palette.YELLOW)
	_hours_estimate_lbl.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_content.add_child(_hours_estimate_lbl)
	_refresh_hours_estimate()
	_hours_save_btn = Button.new()
	_hours_save_btn.text = UIStrings.t("hours.save")
	_hours_save_btn.add_theme_font_size_override("font_size", 16)
	_hours_save_btn.add_theme_color_override("font_color", Palette.GREEN)
	_hours_save_btn.pressed.connect(_save_hours)
	_content.add_child(_hours_save_btn)
	_hours_status = TerminalTheme.label("", 13, Palette.DIM)
	_content.add_child(_hours_status)

## Ore attive/settimana di una lista finestre del form.
static func _hours_per_week(windows: Array) -> float:
	var total := 0.0
	for w in windows:
		var days := 0
		for d in str(w["days"]).split(","):
			if d.strip_edges() != "":
				days += 1
		var s := _hhmm(str(w["start"]))
		var e := _hhmm(str(w["end"]))
		if e <= s:
			e += 24.0  # attraversa la mezzanotte (o end 00:00 = 24:00)
		total += (e - s) * days
	return total

static func _hhmm(t: String) -> float:
	var parts := t.strip_edges().split(":")
	if parts.size() < 2:
		return 0.0
	return float(parts[0].to_int()) + float(parts[1].to_int()) / 60.0

## La stima dinamica: rate storico (posizioni degli ultimi 7 giorni per
## ora attiva del config corrente) proiettato sulle ore del form.
func _refresh_hours_estimate() -> void:
	if not is_instance_valid(_hours_estimate_lbl):
		return
	var cur_raw: Dictionary = BackendBus.live_settings.get("hours_raw", {})
	var cur_windows: Array = []
	for w in cur_raw.get("windows", []):
		cur_windows.append({"days": ", ".join(PackedStringArray(w.get("days", []))),
				"start": str(w.get("start", "")), "end": str(w.get("end", ""))})
	var cur_h := maxf(1.0, _hours_per_week(cur_windows))
	var new_h := _hours_per_week(_hours_windows)
	var week_ago := Time.get_unix_time_from_system() - 7 * 86400
	var found7 := 0
	for p in BackendBus.positions:
		var ts := Time.get_unix_time_from_datetime_string(
				str(p.get("found_at", "")).left(19))
		if ts > 0 and float(ts) >= week_ago:
			found7 += 1
	var rate := float(found7) / cur_h          # posizioni per ora attiva
	var est_day := rate * new_h / 7.0
	_hours_estimate_lbl.text = UIStrings.t("hours.estimate") % [
			new_h, est_day, int(round(new_h / cur_h * 100.0))]

func _save_hours() -> void:
	var windows: Array = []
	for w in _hours_windows:
		var days: Array = []
		for d in str(w["days"]).split(","):
			var day := d.strip_edges().to_lower()
			if ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].has(day):
				days.append(day)
		if days.is_empty() or not str(w["start"]).contains(":") \
				or not str(w["end"]).contains(":"):
			_hours_status.text = UIStrings.t("hours.invalid")
			_hours_status.add_theme_color_override("font_color", Palette.RED)
			return
		windows.append({"days": days, "start": str(w["start"]).strip_edges(),
				"end": str(w["end"]).strip_edges()})
	_hours_save_btn.disabled = true
	_hours_status.text = UIStrings.t("prof.saving")
	_hours_status.add_theme_color_override("font_color", Palette.DIM)
	BackendBus.save_working_hours({
		"timezone": _hours_tz.text.strip_edges(), "windows": windows})

func _on_hours_saved(ok: bool, error: String) -> void:
	if not is_instance_valid(_hours_status):
		return
	_hours_status.text = UIStrings.t("hours.saved") if ok \
			else UIStrings.t("prof.save_err") % error
	_hours_status.add_theme_color_override("font_color",
			Palette.MINT if ok else Palette.RED)
	if is_instance_valid(_hours_save_btn):
		_hours_save_btn.disabled = false
	if ok:
		_hours_loaded = false  # al prossimo build ricarica dal config vero

## Il PROFILO dell'utente: editabile QUI (paradigma desktop app 21:26).
## I campi arrivano da profile_raw (chiavi vere del candidate_profile),
## il salvataggio riscrive il yml sulla VPS con backup. Offline: mock.
const PROFILE_FIELDS := [
	["name", "prof.name"], ["target_role", "prof.target_role"],
	["location", "prof.location"], ["experience_years", "prof.experience"],
	["seniority_target", "prof.seniority"], ["industry", "prof.industry"],
	["nationality", "prof.nationality"],
]

var _prof_edits := {}
var _prof_status: Label

func _build_profile() -> void:
	if not BackendBus.live_settings_updated.is_connected(_on_profile_refresh):
		BackendBus.live_settings_updated.connect(_on_profile_refresh)
	if not BackendBus.profile_saved.is_connected(_on_profile_saved):
		BackendBus.profile_saved.connect(_on_profile_saved)
	var raw: Dictionary = BackendBus.live_settings.get("profile_raw", {})
	if not BackendBus.is_live() or raw.is_empty():
		_build_config()  # offline: coppie mock; live-ma-vuoto: placeholder
		return
	_prof_edits.clear()
	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 18)
	grid.add_theme_constant_override("v_separation", 10)
	_content.add_child(grid)
	for f in PROFILE_FIELDS:
		var lbl := TerminalTheme.label(UIStrings.t(f[1]), 14, Palette.MUTED, "medium")
		lbl.custom_minimum_size = Vector2(220, 0)
		grid.add_child(lbl)
		var edit := LineEdit.new()
		edit.text = str(raw.get(f[0], ""))
		edit.custom_minimum_size = Vector2(560, 0)
		edit.add_theme_font_size_override("font_size", 15)
		grid.add_child(edit)
		_prof_edits[f[0]] = edit
	# skill su riga intera, salario su tre campi affiancati
	_content.add_child(TerminalTheme.label(UIStrings.t("prof.skills"),
			14, Palette.MUTED, "medium"))
	var skills := LineEdit.new()
	skills.text = str(raw.get("skills_primary", ""))
	skills.add_theme_font_size_override("font_size", 15)
	skills.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_content.add_child(skills)
	_prof_edits["skills_primary"] = skills
	var sal_row := HBoxContainer.new()
	sal_row.add_theme_constant_override("separation", 12)
	_content.add_child(sal_row)
	sal_row.add_child(TerminalTheme.label(UIStrings.t("prof.salary"),
			14, Palette.MUTED, "medium"))
	for sf in ["salary_min", "salary_max", "salary_currency"]:
		var e := LineEdit.new()
		e.text = str(raw.get(sf, ""))
		e.custom_minimum_size = Vector2(120 if sf != "salary_currency" else 70, 0)
		e.add_theme_font_size_override("font_size", 15)
		sal_row.add_child(e)
		_prof_edits[sf] = e
	_content.add_child(HSeparator.new())
	var save := Button.new()
	save.text = UIStrings.t("prof.save")
	save.add_theme_font_size_override("font_size", 16)
	save.add_theme_color_override("font_color", Palette.GREEN)
	save.pressed.connect(func() -> void:
		var fields := {}
		for key in _prof_edits:
			fields[key] = _prof_edits[key].text.strip_edges()
		save.disabled = true
		_prof_status.text = UIStrings.t("prof.saving")
		_prof_status.add_theme_color_override("font_color", Palette.DIM)
		BackendBus.save_user_profile(fields))
	_content.add_child(save)
	_prof_status = TerminalTheme.label("", 13, Palette.DIM)
	_content.add_child(_prof_status)
	_prof_save_btn = save

var _prof_save_btn: Button

## Il refresh periodico non deve cancellare quello che stai scrivendo:
## si ricostruisce solo se nessun campo del form ha il focus.
func _on_profile_refresh(_settings: Dictionary) -> void:
	if section != "profile" or not is_instance_valid(_content):
		return
	for key in _prof_edits:
		var e: LineEdit = _prof_edits[key]
		if is_instance_valid(e) and e.has_focus():
			return
	_build()

func _on_profile_saved(ok: bool, error: String) -> void:
	if not is_instance_valid(_prof_status):
		return
	_prof_status.text = UIStrings.t("prof.saved") if ok \
			else UIStrings.t("prof.save_err") % error
	_prof_status.add_theme_color_override("font_color",
			Palette.MINT if ok else Palette.RED)
	if is_instance_valid(_prof_save_btn):
		_prof_save_btn.disabled = false

## Impostazioni → Lingua: le 7 lingue del web. Il cambio si applica
## subito a ciò che viene (ri)costruito; la scena intorno si aggiorna
## man mano che i pannelli si riaprono.
func _build_language() -> void:
	_content.add_child(TerminalTheme.label(UIStrings.t("lang.intro"), 14, Palette.MUTED))
	for l in UIStrings.LANGS:
		var selected: bool = UIStrings.lang == l
		var btn := Button.new()
		btn.flat = true
		btn.alignment = HORIZONTAL_ALIGNMENT_LEFT
		btn.text = ("▸ " if selected else "  ") + str(UIStrings.LANGS[l])
		btn.add_theme_font_size_override("font_size", 16)
		btn.add_theme_color_override("font_color",
				Palette.GREEN if selected else Palette.BASE)
		btn.add_theme_color_override("font_hover_color", Palette.MINT)
		btn.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
		var code := str(l)
		btn.pressed.connect(func() -> void:
			UIStrings.set_lang(code)
			_build())
		_content.add_child(btn)
	_content.add_child(HSeparator.new())
	_content.add_child(TerminalTheme.label(UIStrings.t("lang.note"), 13, Palette.DIM))

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
	if not pending_status.is_empty():
		var chosen := {}
		for st in pending_status:
			chosen[st] = true
		_pos_filters["status"] = chosen
		pending_status = []
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
				UIStrings.t("common.more") % (visible_rows.size() - POS_LIST_MAX),
				13, Palette.DIM))

func _on_positions_refresh(_list: Array) -> void:
	if section == "positions" and is_instance_valid(_content):
		# lo snapshot nuovo non deve buttarti fuori dal dettaglio aperto,
		# né cancellare il ticket che stai scrivendo o aspettando
		if is_instance_valid(_ticket_input) and (_ticket_input.text.strip_edges() != ""
				or (is_instance_valid(_ticket_send) and _ticket_send.disabled)):
			return
		_build("detail" if _pos_detail_id != 0 else "")

func _on_dash_refresh(_list: Array) -> void:
	if section != "dashboard" or not is_instance_valid(_content):
		return
	# non azzerare i filtri che l'utente ha scelto nei grafici: coi
	# filtri attivi i charts si aggiornano da soli, il resto aspetta
	for c in _content.get_children():
		if c is ScrollContainer and c.get_child_count() > 0 \
				and c.get_child(0) is StatsCharts and c.get_child(0)._active_count() > 0:
			return
	_build()

## Il primo snapshot posizioni rimpiazza mock/placeholder coi grafici
## veri; una volta montati, StatsCharts si aggiorna da sé (e non va
## ricostruito: azzererebbe i filtri scelti). Mai mentre sei su Utilizzo.
func _on_stats_refresh(_list: Array) -> void:
	if section == "stats" and _current_page == "" and is_instance_valid(_content) \
			and _content.get_child_count() > 0 and not (_content.get_child(0) is ScrollContainer):
		_build()

func _on_agents_refresh(_list: Array) -> void:
	if section == "agents" and is_instance_valid(_content):
		_build("agent" if _agent_detail != "" else "")

var _agent_detail := ""

func _on_agent_page_refresh(_settings: Dictionary) -> void:
	if section == "agents" and _agent_detail != "" and is_instance_valid(_content):
		_build("agent")

## La pagina del singolo agente (/team/<slug> del web): stato live,
## consumo nella finestra, le SUE ultime transizioni. Tutto dal bus.
func _build_agent_page() -> void:
	# refresh anche entrando qui direttamente (senza passare dalla lista)
	if not BackendBus.agents_updated.is_connected(_on_agents_refresh):
		BackendBus.agents_updated.connect(_on_agents_refresh)
	if not BackendBus.live_settings_updated.is_connected(_on_agent_page_refresh):
		BackendBus.live_settings_updated.connect(_on_agent_page_refresh)
	var agent := {}
	for a in BackendBus.agents:
		if str(a.get("slug", "")) == _agent_detail:
			agent = a
			break
	var back := Button.new()
	back.flat = true
	back.text = UIStrings.t("agents.back")
	back.add_theme_font_size_override("font_size", 14)
	back.add_theme_color_override("font_color", Palette.MUTED)
	back.add_theme_color_override("font_hover_color", Palette.GREEN)
	back.alignment = HORIZONTAL_ALIGNMENT_LEFT
	back.pressed.connect(func() -> void:
		_agent_detail = ""
		Sfx.play_back()
		_build())
	_content.add_child(back)

	var slug := _agent_detail
	var title_row := HBoxContainer.new()
	title_row.add_theme_constant_override("separation", 14)
	_content.add_child(title_row)
	title_row.add_child(TerminalTheme.label(ROLE_EMOJI.get(slug, "●"), 22, Palette.GREEN))
	title_row.add_child(TerminalTheme.label(
			str(agent.get("name", slug.capitalize())), 22, Palette.WHITE, "xbold"))
	title_row.add_child(TerminalTheme.label(
			str(agent.get("status", "offline")) if not agent.is_empty()
					else UIStrings.t("agents.not_active"),
			15, Palette.MINT if not agent.is_empty() else Palette.DIM, "medium"))
	# la chat con l'agente si apre DA QUI (paradigma desktop app)
	if BackendBus.can_chat_with(slug):
		var chat_btn := Button.new()
		chat_btn.text = UIStrings.t("agent.chat")
		chat_btn.add_theme_font_size_override("font_size", 14)
		chat_btn.add_theme_color_override("font_color", Palette.GREEN)
		var display := str(agent.get("name", slug.capitalize()))
		chat_btn.pressed.connect(func() -> void:
			add_child(ChatPanel.new(slug, display)))
		title_row.add_child(chat_btn)
		if not BackendBus.chat_replies(slug):
			title_row.add_child(TerminalTheme.label(
					UIStrings.t("agents.chat_besteffort"), 12, Palette.DIM))
	_content.add_child(HSeparator.new())

	# consumo dell'agente nella finestra usage (tutte le sue istanze)
	var usage: Dictionary = BackendBus.live_settings.get("usage", {})
	var per_agent: Dictionary = usage.get("per_agent_kt", {})
	var kt := 0.0
	var real := "capitano" if slug == "coordinatore" else slug
	for key in per_agent:
		if str(key).split("-")[0] == real:
			kt += float(per_agent[key])
	_kpi_row(UIStrings.t("agents.consumption") % str(usage.get("window_h", "?")),
			"%.1f kt" % kt, Palette.MINT)

	# le sue transizioni recenti (tutte le istanze del ruolo)
	var mine: Array = []
	for t in BackendBus.transitions:
		var by := str(t.get("by_agent", "") if t.get("by_agent") else "")
		if by.split("-")[0] == real:
			mine.append(t)
	_kpi_row(UIStrings.t("agents.registry_actions"), str(mine.size()), Palette.BRIGHT)
	_content.add_child(HSeparator.new())
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_content.add_child(scroll)
	var list := VBoxContainer.new()
	list.add_theme_constant_override("separation", 8)
	list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(list)
	list.add_child(TerminalTheme.label(UIStrings.t("agent.activity"),
			14, Palette.MUTED, "medium"))
	if mine.is_empty():
		list.add_child(TerminalTheme.label(
				UIStrings.t("agents.no_transitions"), 14, Palette.DIM))
	for t in mine.slice(0, 30):
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 14)
		list.add_child(row)
		var when := TerminalTheme.label(str(t.get("ts", "")).left(16), 13, Palette.DIM)
		when.custom_minimum_size = Vector2(140, 0)
		row.add_child(when)
		var who := TerminalTheme.label(str(t.get("by_agent", "?")), 13, Palette.MINT)
		who.custom_minimum_size = Vector2(110, 0)
		row.add_child(who)
		var what := TerminalTheme.label("%s — %s" % [str(t.get("title", "?")),
				str(t.get("company", ""))], 14, Palette.BASE)
		what.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		what.clip_text = true
		row.add_child(what)
		var to_st := str(t.get("to_state", "?"))
		row.add_child(TerminalTheme.label("→ " + to_st, 13,
				POS_STATUS_COLORS.get(to_st, Palette.MUTED), "medium"))

	# le sue COMUNICAZIONI nel team (i core non lavorano posizioni, ma
	# parlano: senza questo blocco la pagina di Assistente/Mentor è vuota)
	var talks: Array = []
	for m in BackendBus.chat_log:
		if str(m.get("from", "")) == slug or str(m.get("to", "")) == slug:
			talks.append(m)
	list.add_child(HSeparator.new())
	list.add_child(TerminalTheme.label(UIStrings.t("agents.comms"),
			14, Palette.MUTED, "medium"))
	if talks.is_empty():
		list.add_child(TerminalTheme.label(UIStrings.t("agents.no_comms"),
				14, Palette.DIM))
	for i in range(maxi(0, talks.size() - 15), talks.size()):
		var m: Dictionary = talks[i]
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 14)
		list.add_child(row)
		var when := TerminalTheme.label(
				str(m.get("ts", "")).replace("T", " ").left(16), 13, Palette.DIM)
		when.custom_minimum_size = Vector2(140, 0)
		row.add_child(when)
		var who := TerminalTheme.label("%s → %s" % [m.get("from", "?"),
				m.get("to", "?")], 13, Palette.MINT, "medium")
		who.custom_minimum_size = Vector2(210, 0)
		row.add_child(who)
		row.add_child(_pos_paragraph(str(m.get("text", ""))))

func _on_config_refresh(_settings: Dictionary) -> void:
	if is_instance_valid(_content) and section in ["hours",
			"provider", "docker", "account", "email", "language", "advanced"]:
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

## Una posizione in lista, tabellare full-width come la pagina web:
## score | titolo — azienda (espande) | famiglia | luogo | salario | stato.
func _pos_row(p: Dictionary) -> Control:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 14)
	var score_v: Variant = p.get("total_score")
	var score_txt := "—" if score_v == null else str(int(score_v))
	var score_col: Color = Palette.DIM if score_v == null \
			else (Palette.MINT if int(score_v) >= 70 else Palette.YELLOW)
	var score := TerminalTheme.label(score_txt, 17, score_col, "bold")
	score.custom_minimum_size = Vector2(44, 0)
	row.add_child(score)
	# il titolo apre la pagina della posizione (come sul web)
	var title_btn := Button.new()
	title_btn.flat = true
	title_btn.text = "%s — %s" % [_pos_value(p, "title"), _pos_value(p, "company")]
	title_btn.add_theme_font_size_override("font_size", 15)
	title_btn.add_theme_color_override("font_color", Palette.BRIGHT)
	title_btn.add_theme_color_override("font_hover_color", Palette.GREEN)
	title_btn.alignment = HORIZONTAL_ALIGNMENT_LEFT
	title_btn.clip_text = true
	title_btn.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	title_btn.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
	var pid := int(p.get("id", 0))
	title_btn.pressed.connect(func() -> void:
		_pos_detail_id = pid
		Sfx.play_tick()
		_build("detail"))
	row.add_child(title_btn)
	var family := TerminalTheme.label(_pos_value(p, "role_family"), 13, Palette.MUTED)
	family.custom_minimum_size = Vector2(220, 0)
	family.clip_text = true
	row.add_child(family)
	var place := TerminalTheme.label("%s · %s" % [
			str(p.get("loc_city", "") if p.get("loc_city") else "—"),
			_pos_value(p, "loc_country")], 13, Palette.MUTED)
	place.custom_minimum_size = Vector2(200, 0)
	place.clip_text = true
	row.add_child(place)
	var est: bool = p.get("salary_estimated_min") != null
	var s_min: Variant = p.get("salary_estimated_min") if est else p.get("salary_declared_min")
	var s_max: Variant = p.get("salary_estimated_max") if est else p.get("salary_declared_max")
	var cur_v: Variant = p.get("salary_estimated_currency") if est \
			else p.get("salary_declared_currency")
	var s_cur := str(cur_v) if cur_v != null else "EUR"
	var sal := "—" if s_min == null and s_max == null \
			else _fmt_salary_eur(s_min, s_max, s_cur)
	var sal_lbl := TerminalTheme.label(sal, 13,
			Palette.BASE if sal != "—" else Palette.DIM)
	sal_lbl.custom_minimum_size = Vector2(110, 0)
	row.add_child(sal_lbl)
	var st := _pos_value(p, "status")
	var st_lbl := TerminalTheme.label(st, 13,
			POS_STATUS_COLORS.get(st, Palette.MUTED), "medium")
	st_lbl.custom_minimum_size = Vector2(90, 0)
	row.add_child(st_lbl)
	# aria a destra: la scrollbar non deve coprire lo stato
	var pad := Control.new()
	pad.custom_minimum_size = Vector2(14, 0)
	row.add_child(pad)
	return row

# ── Dettaglio posizione (la pagina del web privato) ───────────────────

## Pesi del breakdown come sul web: fattore → massimo.
const SCORE_WEIGHTS := [
	["stack_match", "Stack", 40], ["remote_fit", "Remote", 25],
	["salary_fit", "Salary", 20], ["experience_fit", "Experience", 10],
	["strategic_fit", "Strategic", 15],
]
const VERDICT_COLORS := {
	"PASS": Palette.GREEN, "NEEDS_WORK": Palette.YELLOW, "REJECT": Palette.RED,
}

var _pos_detail_id := 0

func _build_pos_detail() -> void:
	var p := {}
	for row in BackendBus.positions:
		if int(row.get("id", 0)) == _pos_detail_id:
			p = row
			break
	if p.is_empty():
		_build_positions()
		return

	var back := Button.new()
	back.flat = true
	back.text = UIStrings.t("pos.back")
	back.add_theme_font_size_override("font_size", 14)
	back.add_theme_color_override("font_color", Palette.MUTED)
	back.add_theme_color_override("font_hover_color", Palette.GREEN)
	back.alignment = HORIZONTAL_ALIGNMENT_LEFT
	back.pressed.connect(func() -> void:
		_pos_detail_id = 0
		Sfx.play_back()
		_build())
	_content.add_child(back)

	# scroll unico: il dettaglio è lungo
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.custom_minimum_size = Vector2(0, 540)
	_content.add_child(scroll)
	# TEST-AUTO: JHT_SCROLL_END=1 porta lo scroll in fondo (per gli shot
	# delle sezioni basse del dettaglio: ticket, esclusioni)
	if OS.get_environment("JHT_SCROLL_END") == "1":
		scroll.get_v_scroll_bar().changed.connect(func() -> void:
			scroll.scroll_vertical = int(scroll.get_v_scroll_bar().max_value))
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 10)
	box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(box)

	# ── intestazione ──
	box.add_child(TerminalTheme.label(_pos_value(p, "title"), 22, Palette.WHITE, "xbold"))
	var sub := HBoxContainer.new()
	sub.add_theme_constant_override("separation", 14)
	box.add_child(sub)
	sub.add_child(TerminalTheme.label(_pos_value(p, "company"), 16, Palette.BRIGHT, "medium"))
	sub.add_child(TerminalTheme.label("%s · %s · %s" % [
			str(p.get("loc_city", "") if p.get("loc_city") else "—"),
			_pos_value(p, "loc_country"), _pos_value(p, "work_mode")],
			14, Palette.MUTED))
	var st := _pos_value(p, "status")
	sub.add_child(TerminalTheme.label(st, 14,
			POS_STATUS_COLORS.get(st, Palette.MUTED), "bold"))
	if p.get("found_by"):
		box.add_child(TerminalTheme.label(UIStrings.t("pos.found") % [
				str(p["found_by"]), str(p.get("found_at", "")).left(10)], 13, Palette.DIM))
	if p.get("url"):
		# il link all'annuncio si APRE davvero, nel browser di sistema
		var link := Button.new()
		link.flat = true
		link.alignment = HORIZONTAL_ALIGNMENT_LEFT
		link.clip_text = true
		link.text = "↗ " + str(p["url"])
		link.add_theme_font_size_override("font_size", 13)
		link.add_theme_color_override("font_color", Palette.BLUE)
		link.add_theme_color_override("font_hover_color", Palette.MINT)
		link.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
		link.tooltip_text = UIStrings.t("pos.open_url")
		var url := str(p["url"])
		link.pressed.connect(func() -> void: OS.shell_open(url))
		box.add_child(link)
	var open_v: Variant = p.get("is_open")
	if open_v != null:
		box.add_child(TerminalTheme.label(
				UIStrings.t("pos.open_yes") if int(open_v) == 1 else UIStrings.t("pos.open_no"),
				13, Palette.MINT if int(open_v) == 1 else Palette.RED))
	box.add_child(HSeparator.new())

	# ── stipendio (stima del team se c'è, altrimenti il dichiarato) ──
	var est: bool = p.get("salary_estimated_min") != null or p.get("salary_estimated_max") != null
	var s_min: Variant = p.get("salary_estimated_min") if est else p.get("salary_declared_min")
	var s_max: Variant = p.get("salary_estimated_max") if est else p.get("salary_declared_max")
	if s_min != null or s_max != null:
		var cur := str(p.get("salary_estimated_currency") if est \
				else p.get("salary_declared_currency"))
		if cur == "" or cur == "<null>":
			cur = "EUR"
		var rng := _fmt_salary_eur(s_min, s_max, cur)
		if cur.to_upper() != "EUR":
			rng += "  (%s–%s %s)" % [_fmt_k(s_min), _fmt_k(s_max), cur]
		var srow := HBoxContainer.new()
		srow.add_theme_constant_override("separation", 12)
		box.add_child(srow)
		var slbl := TerminalTheme.label(UIStrings.t("pos.salary"), 14, Palette.MUTED, "medium")
		slbl.custom_minimum_size = Vector2(220, 0)
		srow.add_child(slbl)
		srow.add_child(TerminalTheme.label(rng, 17, Palette.MINT, "bold"))
		srow.add_child(TerminalTheme.label(
				UIStrings.t("pos.salary_estimated") if est else UIStrings.t("pos.salary_declared"),
				13, Palette.DIM))

	# ── riassunto annuncio ──
	if p.get("jd_summary"):
		box.add_child(TerminalTheme.label(UIStrings.t("pos.summary"), 14, Palette.MUTED, "medium"))
		box.add_child(_pos_paragraph(str(p["jd_summary"])))
	box.add_child(HSeparator.new())

	# ── score breakdown pesato ──
	if p.get("total_score") != null:
		box.add_child(TerminalTheme.label(
				UIStrings.t("pos.score_title") % int(p["total_score"]), 17,
				Palette.MINT if int(p["total_score"]) >= 70 else Palette.YELLOW, "bold"))
		for w in SCORE_WEIGHTS:
			var val: Variant = p.get(w[0])
			if val == null:
				continue
			var wrow := HBoxContainer.new()
			wrow.add_theme_constant_override("separation", 12)
			box.add_child(wrow)
			var wl := TerminalTheme.label("%s (su %d)" % [w[1], w[2]], 13, Palette.MUTED)
			wl.custom_minimum_size = Vector2(220, 0)
			wrow.add_child(wl)
			var bar := ProgressBar.new()
			bar.custom_minimum_size = Vector2(220, 12)
			bar.max_value = float(w[2])
			bar.value = float(val)
			bar.show_percentage = false
			bar.modulate = Palette.GREEN
			wrow.add_child(bar)
			wrow.add_child(TerminalTheme.label("%d/%d" % [int(val), w[2]],
					13, Palette.BRIGHT, "medium"))
		if p.get("score_notes"):
			box.add_child(TerminalTheme.label(UIStrings.t("pos.score_rationale"),
					13, Palette.MUTED, "medium"))
			box.add_child(_pos_paragraph(str(p["score_notes"])))
		if p.get("scored_by"):
			box.add_child(TerminalTheme.label("— %s · %s" % [str(p["scored_by"]),
					str(p.get("scored_at", "")).left(10)], 12, Palette.DIM))
	else:
		box.add_child(TerminalTheme.label(UIStrings.t("pos.score_none"), 14, Palette.DIM))
	box.add_child(HSeparator.new())

	# ── voto del critico (0-10, distinto dallo score) ──
	if p.get("critic_score") != null:
		var crow := HBoxContainer.new()
		crow.add_theme_constant_override("separation", 14)
		box.add_child(crow)
		crow.add_child(TerminalTheme.label(
				UIStrings.t("pos.critic_title") % float(p["critic_score"]),
				16, Palette.BRIGHT, "bold"))
		var verdict := str(p.get("critic_verdict", ""))
		if verdict != "" and verdict != "<null>":
			crow.add_child(TerminalTheme.label(verdict, 15,
					VERDICT_COLORS.get(verdict, Palette.MUTED), "bold"))
		if p.get("critic_notes"):
			box.add_child(_pos_paragraph(str(p["critic_notes"])))
	else:
		box.add_child(TerminalTheme.label(UIStrings.t("pos.critic_none"), 14, Palette.DIM))
	box.add_child(HSeparator.new())

	# ── punti chiave ──
	var highlights: Array = p.get("highlights", [])
	if not highlights.is_empty():
		box.add_child(TerminalTheme.label(UIStrings.t("pos.highlights"), 14,
				Palette.MUTED, "medium"))
		for h in highlights:
			var kind := str(h.get("type", ""))
			var good := kind.containsn("pro") or kind.containsn("plus") or kind.containsn("match")
			var bad := kind.containsn("con") or kind.containsn("minus") or kind.containsn("risk")
			var hrow := HBoxContainer.new()
			hrow.add_theme_constant_override("separation", 10)
			box.add_child(hrow)
			hrow.add_child(TerminalTheme.label("▲" if good else ("▼" if bad else "•"), 13,
					Palette.GREEN if good else (Palette.RED if bad else Palette.MUTED)))
			hrow.add_child(_pos_paragraph(str(h.get("text", ""))))
		box.add_child(HSeparator.new())

	# ── esclusione utente ──
	if p.get("user_excluded_reason"):
		box.add_child(TerminalTheme.label(UIStrings.t("pos.excluded_title"), 14,
				Palette.RED, "bold"))
		var reason := str(p["user_excluded_reason"])
		if p.get("user_excluded_note"):
			reason += " — " + str(p["user_excluded_note"])
		box.add_child(_pos_paragraph(reason))
		box.add_child(HSeparator.new())

	# ── stato delle azioni on-demand (per ora sola lettura) ──
	box.add_child(TerminalTheme.label(UIStrings.t("pos.actions"), 14,
			Palette.MUTED, "medium"))
	for act in [["pos.act_write", "write_requested"],
			["pos.act_geocode", "geocode_requested"],
			["pos.act_recheck", "recheck_requested"]]:
		var requested := int(p.get(act[1], 0) if p.get(act[1]) != null else 0) == 1
		var arow := HBoxContainer.new()
		arow.add_theme_constant_override("separation", 12)
		box.add_child(arow)
		var al := TerminalTheme.label(UIStrings.t(act[0]), 14, Palette.BASE)
		al.custom_minimum_size = Vector2(280, 0)
		arow.add_child(al)
		arow.add_child(TerminalTheme.label(
				UIStrings.t("pos.act_requested") if requested else UIStrings.t("pos.act_not_requested"),
				13, Palette.YELLOW if requested else Palette.DIM, "medium"))
	box.add_child(TerminalTheme.label(UIStrings.t("pos.act_note"), 12, Palette.DIM))
	box.add_child(HSeparator.new())

	# ── ticket col team ──
	box.add_child(TerminalTheme.label(UIStrings.t("pos.tickets"), 14,
			Palette.MUTED, "medium"))
	var tickets: Array = p.get("tickets", [])
	if tickets.is_empty():
		box.add_child(TerminalTheme.label(UIStrings.t("pos.ticket_none"), 13, Palette.DIM))
	for t in tickets:
		var trow := HBoxContainer.new()
		trow.add_theme_constant_override("separation", 12)
		box.add_child(trow)
		trow.add_child(TerminalTheme.label("[%s]" % str(t.get("status", "?")), 13,
				Palette.MINT if str(t.get("status")) == "resolved" else Palette.YELLOW, "medium"))
		trow.add_child(_pos_paragraph(str(t.get("request_text", ""))))
		if t.get("response_text"):
			box.add_child(_pos_paragraph("↳ " + str(t["response_text"])))
	_build_ticket_form(box, int(p.get("id", 0)))

## Form "nuovo ticket": la richiesta utente→team, l'unica scrittura
## remota autorizzata (gate 1). L'esito arriva su ticket_created; la
## lista sopra si aggiorna col fetch posizioni che il backend rilancia.
func _build_ticket_form(box: VBoxContainer, pid: int) -> void:
	if not BackendBus.is_live():
		box.add_child(TerminalTheme.label(UIStrings.t("pos.ticket_need_vps"),
				12, Palette.DIM))
		return
	if not BackendBus.ticket_created.is_connected(_on_ticket_created):
		BackendBus.ticket_created.connect(_on_ticket_created)
	var form := HBoxContainer.new()
	form.add_theme_constant_override("separation", 10)
	box.add_child(form)
	_ticket_input = LineEdit.new()
	_ticket_input.placeholder_text = UIStrings.t("pos.ticket_placeholder")
	_ticket_input.max_length = 2000
	_ticket_input.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	form.add_child(_ticket_input)
	_ticket_send = Button.new()
	_ticket_send.text = UIStrings.t("pos.ticket_send")
	form.add_child(_ticket_send)
	_ticket_status = TerminalTheme.label("", 12, Palette.DIM)
	box.add_child(_ticket_status)
	var submit := func() -> void:
		var txt: String = _ticket_input.text.strip_edges()
		if txt == "" or _ticket_send.disabled:
			return
		_ticket_send.disabled = true
		_ticket_status.text = UIStrings.t("pos.ticket_sending")
		_ticket_status.add_theme_color_override("font_color", Palette.DIM)
		BackendBus.create_position_ticket(pid, txt)
	_ticket_send.pressed.connect(submit)
	_ticket_input.text_submitted.connect(func(_t: String) -> void: submit.call())
	# TEST-AUTO: JHT_TICKET_TEST=<testo> invia un ticket appena il form
	# esiste (una volta sola), per verificare il canale con lo shot.
	if OS.get_environment("JHT_TICKET_TEST") != "" and not _ticket_test_done:
		_ticket_test_done = true
		_ticket_input.text = OS.get_environment("JHT_TICKET_TEST")
		submit.call_deferred()

static var _ticket_test_done := false

var _ticket_input: LineEdit
var _ticket_send: Button
var _ticket_status: Label

func _on_ticket_created(_pid: int, ok: bool, error: String) -> void:
	if not is_instance_valid(_ticket_status):
		return
	if ok:
		_ticket_status.text = UIStrings.t("pos.ticket_ok")
		_ticket_status.add_theme_color_override("font_color", Palette.MINT)
		if is_instance_valid(_ticket_input):
			_ticket_input.text = ""
	else:
		_ticket_status.text = UIStrings.t("pos.ticket_err") % error
		_ticket_status.add_theme_color_override("font_color", Palette.RED)
	if is_instance_valid(_ticket_send):
		_ticket_send.disabled = false

## Paragrafo a capo automatico; via i **grassetti** markdown del team.
func _pos_paragraph(text: String) -> Label:
	var lbl := TerminalTheme.label(text.replace("**", ""), 14, Palette.BASE)
	lbl.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	lbl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return lbl

static func _fmt_k(v: Variant) -> String:
	if v == null:
		return "?"
	return "%dk" % int(round(float(v) / 1000.0)) if float(v) >= 1000.0 else str(int(v))

## Range salariale in EUR quando il tasso c'è (multi-valuta come sul
## web, tassi BCE), altrimenti valuta originale esplicitata.
static func _fmt_salary_eur(s_min: Variant, s_max: Variant, cur: String) -> String:
	var c := cur.strip_edges().to_upper()
	if c == "" or c == "<NULL>":
		c = "EUR"
	if c == "EUR":
		return "%s–%s" % [_fmt_k(s_min), _fmt_k(s_max)]
	var lo := -1.0 if s_min == null else BackendBus.to_eur(float(s_min), c)
	var hi := -1.0 if s_max == null else BackendBus.to_eur(float(s_max), c)
	if lo >= 0.0 or hi >= 0.0:
		return "~%s–%s €" % [_fmt_k(lo if lo >= 0.0 else null),
				_fmt_k(hi if hi >= 0.0 else null)]
	return "%s–%s %s" % [_fmt_k(s_min), _fmt_k(s_max), c]

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

	_vps_ip = _vps_input(UIStrings.t("vps.ip"), cfg.get("ip", ""), "167.233.135.77")
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
			UIStrings.t("section.migrating"), 16, Palette.DIM))
	_content.add_child(TerminalTheme.label(
			UIStrings.t("section.migrating_body")
			% SidebarDefs.label_for(section), 15, Palette.MUTED))

# ── Team / Agenti / Attività / Candidature / Dashboard ────────────────

## Il team per reparto: organico e postazioni libere, più i core.
## Reparto della scena → slug ruolo del sistema reale.
const DEPT_ROLE := {"scout": "scout", "analisti": "analista", "scorer": "scorer",
		"scrittori": "scrittore", "critici": "critico"}

func _build_team() -> void:
	if not BackendBus.agents_updated.is_connected(_on_team_refresh):
		BackendBus.agents_updated.connect(_on_team_refresh)
	for dept_id in DepartmentDefs.DEPT_ORDER:
		var dept: Dictionary = DepartmentDefs.DEPARTMENTS[dept_id]
		var occupied := 0
		if not BackendBus.agents.is_empty():
			# postazioni = agenti VERI del ruolo attivi in questo momento
			for a in BackendBus.agents:
				if str(a.get("slug", "")) == str(DEPT_ROLE.get(dept_id, "")):
					occupied += 1
		else:
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
		row.add_child(TerminalTheme.label(UIStrings.t("team.desks") % [occupied,
				(dept["desks"] as Array).size()], 15, Palette.MUTED))
		var tag := TerminalTheme.label(dept["tagline"], 14, Palette.DIM)
		tag.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		tag.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		row.add_child(tag)
	_content.add_child(HSeparator.new())
	_content.add_child(TerminalTheme.label(UIStrings.t("team.core"), 15, Palette.MUTED))

## Tutti gli agenti in scena con stato del ruolo. Con la VPS collegata:
## il roster VERO (sessioni tmux attive), aggiornato a ogni poll.
func _build_agents() -> void:
	if not BackendBus.agents_updated.is_connected(_on_agents_refresh):
		BackendBus.agents_updated.connect(_on_agents_refresh)
	if not BackendBus.agents.is_empty():
		_content.add_child(TerminalTheme.label(
				UIStrings.t("agents.active_count") % BackendBus.agents.size(),
				14, Palette.MUTED, "medium"))
		for a in BackendBus.agents:
			var row := HBoxContainer.new()
			row.add_theme_constant_override("separation", 12)
			_content.add_child(row)
			var slug := str(a.get("slug", "?"))
			row.add_child(TerminalTheme.label(ROLE_EMOJI.get(slug, "●"), 14, Palette.GREEN))
			# il nome apre la pagina dell'agente (come /team/<slug> sul web)
			var name_btn := Button.new()
			name_btn.flat = true
			name_btn.text = str(a.get("name", slug))
			name_btn.add_theme_font_size_override("font_size", 16)
			name_btn.add_theme_color_override("font_color", Palette.BRIGHT)
			name_btn.add_theme_color_override("font_hover_color", Palette.GREEN)
			name_btn.alignment = HORIZONTAL_ALIGNMENT_LEFT
			name_btn.custom_minimum_size = Vector2(220, 0)
			name_btn.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
			name_btn.pressed.connect(func() -> void:
				_agent_detail = slug
				Sfx.play_tick()
				_build("agent"))
			row.add_child(name_btn)
			var st := TerminalTheme.label(str(a.get("status", "working")), 14, Palette.MINT)
			st.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			st.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
			row.add_child(st)
		return
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
		var st := TerminalTheme.label(
				status.get("status", UIStrings.t("agents.status_default")), 14, Palette.MINT)
		st.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		st.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		row.add_child(st)

## Emoji-ruolo per l'attribuzione per-istanza (scout-2, scorer-1…).
const ROLE_EMOJI := {
	"scout": "🔍", "analista": "🧠", "scorer": "🎯", "scrittore": "✍",
	"critico": "🧐", "capitano": "🧭", "coordinatore": "🧭", "sentinella": "🛡",
	"assistente": "📋", "mentor": "🎓", "dottore": "🩺", "mantenitore": "🔧",
}

## Feed attività: il registro transizioni VERO quando la VPS è collegata
## (chi ha fatto cosa, con l'istanza), altrimenti il mock.
func _build_activity() -> void:
	if not BackendBus.positions_updated.is_connected(_on_activity_refresh):
		BackendBus.positions_updated.connect(_on_activity_refresh)
	var transitions: Array = BackendBus.transitions
	if not transitions.is_empty():
		var scroll := ScrollContainer.new()
		scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
		scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
		scroll.custom_minimum_size = Vector2(0, 520)
		_content.add_child(scroll)
		var list := VBoxContainer.new()
		list.add_theme_constant_override("separation", 8)
		list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		scroll.add_child(list)
		for t in transitions:
			var row := HBoxContainer.new()
			row.add_theme_constant_override("separation", 14)
			list.add_child(row)
			var when := TerminalTheme.label(str(t.get("ts", "")).left(16), 13, Palette.DIM)
			when.custom_minimum_size = Vector2(140, 0)
			row.add_child(when)
			var by := str(t.get("by_agent", "?") if t.get("by_agent") else "?")
			var base := by.split("-")[0]
			var who := TerminalTheme.label("%s %s" % [ROLE_EMOJI.get(base, "•"), by],
					13, Palette.MINT, "medium")
			who.custom_minimum_size = Vector2(150, 0)
			row.add_child(who)
			var title_lbl := TerminalTheme.label("%s — %s" % [
					str(t.get("title", "?")), str(t.get("company", ""))], 14, Palette.BASE)
			title_lbl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			title_lbl.clip_text = true
			row.add_child(title_lbl)
			var from_st := str(t.get("from_state", "") if t.get("from_state") else "—")
			row.add_child(TerminalTheme.label(from_st, 13,
					POS_STATUS_COLORS.get(from_st, Palette.DIM)))
			row.add_child(TerminalTheme.label("→", 13, Palette.DIM))
			var to_st := str(t.get("to_state", "?"))
			row.add_child(TerminalTheme.label(to_st, 13,
					POS_STATUS_COLORS.get(to_st, Palette.MUTED), "medium"))
			var pad := Control.new()
			pad.custom_minimum_size = Vector2(14, 0)
			row.add_child(pad)
		return
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

func _on_activity_refresh(_list: Array) -> void:
	if section == "activity" and is_instance_valid(_content):
		_build()

func _on_team_refresh(_list: Array) -> void:
	if section == "team" and is_instance_valid(_content):
		_build()

## Candidature a stadi (stessi dati del registro TAB).
## Stadi reali di una candidatura (status del jobs.db → etichetta).
const APP_STAGES := {"ready": "apps.ready", "applied": "apps.applied",
		"response": "apps.response"}

func _build_apps() -> void:
	if not BackendBus.positions_updated.is_connected(_on_apps_refresh):
		BackendBus.positions_updated.connect(_on_apps_refresh)
	# con la VPS: le candidature VERE (CV pronti, inviate, con risposta)
	if not BackendBus.positions.is_empty():
		var rows: Array = []
		for p in BackendBus.positions:
			if APP_STAGES.has(str(p.get("status", ""))):
				rows.append(p)
		if rows.is_empty():
			_content.add_child(TerminalTheme.label(UIStrings.t("apps.empty_live"),
					15, Palette.DIM))
			return
		for p in rows:
			var row := HBoxContainer.new()
			row.add_theme_constant_override("separation", 14)
			_content.add_child(row)
			var score_v: Variant = p.get("total_score")
			row.add_child(TerminalTheme.label(
					"—" if score_v == null else str(int(score_v)), 18,
					Palette.MINT if score_v != null and float(score_v) >= 70.0
					else Palette.YELLOW, "bold"))
			var btn := Button.new()
			btn.flat = true
			btn.alignment = HORIZONTAL_ALIGNMENT_LEFT
			btn.clip_text = true
			btn.text = "%s — %s" % [str(p.get("title", "?")), str(p.get("company", "?"))]
			btn.add_theme_font_size_override("font_size", 15)
			btn.add_theme_color_override("font_color", Palette.BRIGHT)
			btn.add_theme_color_override("font_hover_color", Palette.GREEN)
			btn.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
			btn.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			var pid := int(p.get("id", 0))
			btn.pressed.connect(func() -> void:
				pending_detail = pid
				navigate.emit("positions"))
			row.add_child(btn)
			var status := str(p.get("status", ""))
			row.add_child(TerminalTheme.label(UIStrings.t(APP_STAGES[status]), 14,
					POS_STATUS_COLORS.get(status, Palette.MUTED), "medium"))
			var verdict := str(p.get("critic_verdict", "")
					if p.get("critic_verdict") != null else "")
			if verdict != "":
				row.add_child(TerminalTheme.label(verdict, 13,
						VERDICT_COLORS.get(verdict, Palette.MUTED), "bold"))
		return
	var apps: Array = TeamData.applications()
	if apps.is_empty():
		_content.add_child(TerminalTheme.label(UIStrings.t("registry.empty"), 15, Palette.DIM))
	var names: Array = []
	for i in 4:  # gli stessi stadi del registro TAB
		names.append(UIStrings.t("registry.stage_%d" % i))
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

func _on_apps_refresh(_list: Array) -> void:
	if section == "apps" and is_instance_valid(_content):
		_build()

## Dashboard: pipeline e KPI reali (se la VPS è collegata) o il mock.
func _build_dashboard() -> void:
	if not BackendBus.positions_updated.is_connected(_on_dash_refresh):
		BackendBus.positions_updated.connect(_on_dash_refresh)
	_build_dash_pipeline()
	if not BackendBus.positions.is_empty():
		var kpi: Dictionary = BackendBus.kpi_summary()
		_kpi_row(UIStrings.t("kpi.positions_today"), str(kpi["found_today"]), Palette.MINT)
		_kpi_row(UIStrings.t("kpi.avg_score"), str(kpi["avg_score"]), Palette.MINT)
		_kpi_row(UIStrings.t("kpi.positions_total"), str(kpi["total"]), Palette.BRIGHT)
		_content.add_child(HSeparator.new())
		# i grafici linked del web VIVONO nella dashboard (feedback
		# Leone 21:2x: "dashboard senza grafici"), cross-filter incluso
		var scroll := ScrollContainer.new()
		scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
		scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
		scroll.custom_minimum_size = Vector2(0, 380)
		_content.add_child(scroll)
		var charts := StatsCharts.new()
		charts.open_position.connect(func(pid: int) -> void:
			pending_detail = pid
			navigate.emit("positions"))
		scroll.add_child(charts)
		return
	var s: Dictionary = TeamData.summary()
	_kpi_row(UIStrings.t("kpi.positions_today"), str(s.get("positions_today", 0)), Palette.MINT)
	_kpi_row(UIStrings.t("kpi.avg_score"), str(s.get("avg_score", 0)), Palette.MINT)
	_bar_row(UIStrings.t("kpi.budget_used"), s.get("budget_used_pct", 0.0), Palette.GREEN)
	_content.add_child(HSeparator.new())
	_content.add_child(TerminalTheme.label(UIStrings.t("kpi.positions_list"),
			14, Palette.MUTED, "medium"))
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

## La pipeline a 5 box del dashboard web (flusso reale 2026-06-07):
## Da analizzare → Analizzate → Con lo score → Da scrivere → Scritte.
## Ogni box conta dallo snapshot vero e apre le posizioni pre-filtrate.
func _build_dash_pipeline() -> void:
	if BackendBus.positions.is_empty():
		return
	# il mapping status→fase vive in UN posto solo (lo usa anche la
	# scena per il flusso fisico dei fogli)
	var counts: Dictionary = BackendBus.pipeline_counts()
	var boxes := [
		["to_analyze", "dash.pl_to_analyze", Palette.MUTED, ["new"]],
		["analyzed", "dash.pl_analyzed", Palette.BLUE, ["checked"]],
		["with_score", "dash.pl_with_score", Palette.PURPLE, ["scored"]],
		["to_write", "dash.pl_to_write", Palette.YELLOW, ["scored", "writing", "review"]],
		["written", "dash.pl_written", Palette.MINT, ["ready"]],
	]
	_content.add_child(TerminalTheme.label(UIStrings.t("dash.pipeline"), 14,
			Palette.MUTED, "medium"))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	_content.add_child(row)
	for i in boxes.size():
		var b: Array = boxes[i]
		if i > 0:
			row.add_child(TerminalTheme.label("▸", 16, Palette.DIM))
		var btn := Button.new()
		var color: Color = b[2]
		btn.custom_minimum_size = Vector2(150, 64)
		var sb := StyleBoxFlat.new()
		sb.bg_color = Color(color.r, color.g, color.b, 0.10)
		sb.border_color = Color(color.r, color.g, color.b, 0.55)
		sb.set_border_width_all(1)
		btn.add_theme_stylebox_override("normal", sb)
		var hover := sb.duplicate()
		hover.border_color = color
		btn.add_theme_stylebox_override("hover", hover)
		btn.add_theme_stylebox_override("pressed", hover.duplicate())
		btn.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
		btn.text = "%d\n%s" % [counts[b[0]], UIStrings.t(b[1])]
		btn.add_theme_font_size_override("font_size", 15)
		btn.add_theme_color_override("font_color", color)
		var statuses: Array = b[3]
		btn.pressed.connect(func() -> void:
			pending_status = statuses
			Sfx.play_tick()
			navigate.emit("positions"))
		row.add_child(btn)
	_content.add_child(TerminalTheme.label(UIStrings.t("dash.pl_hint"), 12, Palette.DIM))
	_content.add_child(HSeparator.new())

## Notifiche recenti del team. Con la VPS: gli eventi VERI che contano
## per l'utente — ticket risolti/in lavorazione e i traguardi della
## pipeline (valutata, CV scritto, inviata, risposta) dalle transizioni.
const NOTIF_STATES := {"scored": "notifs.scored", "ready": "notifs.cv_ready",
		"applied": "notifs.applied", "response": "notifs.response"}
const NOTIF_MAX := 15

func _build_notifs() -> void:
	if not BackendBus.positions_updated.is_connected(_on_notifs_refresh):
		BackendBus.positions_updated.connect(_on_notifs_refresh)
	if not BackendBus.positions.is_empty():
		var items: Array = []  # {ts, icon, color, text}
		for t_pos in BackendBus.positions:
			for t in t_pos.get("tickets", []):
				var status := str(t.get("status", ""))
				var req := str(t.get("request_text", "")).left(70)
				if status == "resolved":
					items.append({"ts": str(t.get("created_at", "")), "icon": "✔",
							"color": Palette.MINT,
							"text": UIStrings.t("notifs.ticket_resolved") % req})
				elif status == "assigned":
					items.append({"ts": str(t.get("created_at", "")), "icon": "●",
							"color": Palette.YELLOW,
							"text": UIStrings.t("notifs.ticket_assigned") % req})
		for tr in BackendBus.transitions:
			var to := str(tr.get("to_state", ""))
			if not NOTIF_STATES.has(to):
				continue
			var what := "%s — %s" % [str(tr.get("title", "?")), str(tr.get("company", "?"))]
			items.append({"ts": str(tr.get("ts", "")), "icon": "●",
					"color": POS_STATUS_COLORS.get(to, Palette.GREEN),
					"text": UIStrings.t(NOTIF_STATES[to]) % what})
		items.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
			return str(a["ts"]) > str(b["ts"]))
		if items.is_empty():
			_content.add_child(TerminalTheme.label(UIStrings.t("notifs.empty"),
					15, Palette.DIM))
			return
		for i in mini(items.size(), NOTIF_MAX):
			var n: Dictionary = items[i]
			var row := HBoxContainer.new()
			row.add_theme_constant_override("separation", 14)
			_content.add_child(row)
			row.add_child(TerminalTheme.label(str(n["icon"]), 14, n["color"]))
			var when := TerminalTheme.label(
					str(n["ts"]).replace("T", " ").left(16), 13, Palette.DIM)
			when.custom_minimum_size = Vector2(130, 0)
			row.add_child(when)
			var txt := TerminalTheme.label(str(n["text"]), 15, Palette.BASE)
			txt.clip_text = true
			txt.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			row.add_child(txt)
		return
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

func _on_notifs_refresh(_list: Array) -> void:
	if section == "notifs" and is_instance_valid(_content):
		_build()

## Chat del team: con la VPS collegata i messaggi VERI che gli agenti
## si scambiano (stesso flusso dei fumetti), altrimenti il mock.
func _build_chat() -> void:
	if not BackendBus.chat_message.is_connected(_on_teamchat_refresh):
		BackendBus.chat_message.connect(_on_teamchat_refresh)
	var live: Array = BackendBus.chat_log
	if not live.is_empty():
		var scroll := ScrollContainer.new()
		scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
		scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
		scroll.custom_minimum_size = Vector2(0, 480)
		_content.add_child(scroll)
		var list := VBoxContainer.new()
		list.add_theme_constant_override("separation", 8)
		list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		scroll.add_child(list)
		for msg in live:
			var row := HBoxContainer.new()
			row.add_theme_constant_override("separation", 12)
			list.add_child(row)
			var when := TerminalTheme.label(
					str(msg.get("ts", "")).replace("T", " ").left(16), 13, Palette.DIM)
			when.custom_minimum_size = Vector2(130, 0)
			row.add_child(when)
			var base := str(msg.get("from", "?")).split("-")[0]
			var who := TerminalTheme.label("%s %s → %s" % [ROLE_EMOJI.get(base, "•"),
					msg.get("from", "?"), msg.get("to", "?")], 13, Palette.MINT, "medium")
			who.custom_minimum_size = Vector2(230, 0)
			row.add_child(who)
			var txt := _pos_paragraph(str(msg.get("text", "")))
			row.add_child(txt)
			var pad := Control.new()
			pad.custom_minimum_size = Vector2(14, 0)
			row.add_child(pad)
		scroll.set_deferred("scroll_vertical", 999999)  # parte dal fondo
		return
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
			UIStrings.t("common.readonly_chat"), 13, Palette.DIM))

func _on_teamchat_refresh(_msg: Dictionary) -> void:
	if section == "chat" and is_instance_valid(_content):
		_build()

# ── Statistiche + pagina Utilizzo ─────────────────────────────────────

func _build_stats() -> void:
	# con la VPS collegata: i grafici cross-filter del web sui dati veri
	# (mai il mock spacciato per reale)
	if not BackendBus.positions_updated.is_connected(_on_stats_refresh):
		BackendBus.positions_updated.connect(_on_stats_refresh)
	if BackendBus.is_live() and BackendBus.positions.is_empty():
		_content.add_child(TerminalTheme.label(
				UIStrings.t("common.data_incoming"), 14, Palette.DIM))
		return
	if not BackendBus.positions.is_empty():
		var scroll := ScrollContainer.new()
		scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
		scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
		scroll.custom_minimum_size = Vector2(0, 540)
		_content.add_child(scroll)
		var charts := StatsCharts.new()
		charts.open_position.connect(func(pid: int) -> void:
			pending_detail = pid
			navigate.emit("positions"))
		scroll.add_child(charts)
		var usage_link := Button.new()
		usage_link.text = UIStrings.t("usage.open")
		usage_link.add_theme_font_size_override("font_size", 16)
		usage_link.add_theme_color_override("font_color", Palette.GREEN)
		usage_link.pressed.connect(func() -> void: _build("usage"))
		_content.add_child(usage_link)
		return
	var s: Dictionary = TeamData.summary()
	var streak: Dictionary = TeamData.streak()
	_kpi_row(UIStrings.t("kpi.positions_today"), str(s.get("positions_today", 0)), Palette.MINT)
	_kpi_row(UIStrings.t("kpi.avg_score"), str(s.get("avg_score", 0)), Palette.MINT)
	_kpi_row(UIStrings.t("kpi.streak"), UIStrings.t("kpi.streak_value")
			% [streak.get("days", 0), streak.get("freezes", 0)], Palette.ORANGE)
	_bar_row(UIStrings.t("kpi.budget_used"), s.get("budget_used_pct", 0.0), Palette.GREEN)
	_content.add_child(HSeparator.new())
	# candidature per stadio
	var stages := [0, 0, 0, 0]
	for app in TeamData.applications():
		stages[clampi(int(app["stage"]), 0, 3)] += 1
	_content.add_child(TerminalTheme.label(UIStrings.t("kpi.apps_by_stage"),
			14, Palette.MUTED, "medium"))
	var names: Array = []
	for i in 4:  # gli stessi stadi del registro TAB
		names.append(UIStrings.t("registry.stage_%d" % i))
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
	usage_btn.text = UIStrings.t("usage.open")
	usage_btn.add_theme_font_size_override("font_size", 16)
	usage_btn.add_theme_color_override("font_color", Palette.GREEN)
	usage_btn.pressed.connect(func() -> void: _build("usage"))
	_content.add_child(usage_btn)

func _build_usage() -> void:
	# con la VPS collegata: consumo VERO per agente (kt nella finestra)
	var live: Dictionary = BackendBus.live_settings.get("usage", {})
	if not live.is_empty():
		_content.add_child(TerminalTheme.label(UIStrings.t("usage.title_window")
				% str(live.get("window_h", "?")), 16, Palette.WHITE, "bold"))
		var per_agent: Dictionary = live.get("per_agent_kt", {})
		if per_agent.is_empty():
			_content.add_child(TerminalTheme.label(
					UIStrings.t("usage.none"), 14, Palette.DIM))
		var keys: Array = per_agent.keys()
		keys.sort()
		for agent in keys:
			var row := HBoxContainer.new()
			row.add_theme_constant_override("separation", 12)
			_content.add_child(row)
			var base := str(agent).split("-")[0]
			var lbl := TerminalTheme.label("%s %s" % [ROLE_EMOJI.get(base, "•"), agent],
					14, Palette.BASE)
			lbl.custom_minimum_size = Vector2(220, 0)
			row.add_child(lbl)
			row.add_child(TerminalTheme.label("%.1f kt" % float(per_agent[agent]),
					15, Palette.MINT, "bold"))
		_content.add_child(TerminalTheme.label(UIStrings.t("common.updated")
				% str(live.get("generated_at", "")).left(16), 12, Palette.DIM))
		_content.add_child(HSeparator.new())
		var back_live := Button.new()
		back_live.text = UIStrings.t("usage.back")
		back_live.add_theme_font_size_override("font_size", 16)
		back_live.add_theme_color_override("font_color", Palette.MUTED)
		back_live.pressed.connect(func() -> void: _build())
		_content.add_child(back_live)
		return
	var u: Dictionary = TeamData.usage()
	_content.add_child(TerminalTheme.label(UIStrings.t("usage.title"), 16, Palette.WHITE, "bold"))
	_kpi_row(UIStrings.t("kpi.provider"), str(u.get("provider", "—")), Palette.BRIGHT)
	_kpi_row(UIStrings.t("kpi.actions_today"), str(u.get("actions_today", 0)), Palette.MINT)
	_kpi_row(UIStrings.t("kpi.actions_week"), str(u.get("actions_week", 0)), Palette.MINT)
	_kpi_row(UIStrings.t("kpi.tokens_today"), str(u.get("tokens_today", "—")), Palette.MINT)
	_bar_row(UIStrings.t("kpi.quota_week"), u.get("quota_week_pct", 0.0), Palette.YELLOW)
	_bar_row(UIStrings.t("kpi.budget_used"), u.get("budget_used_pct", 0.0), Palette.GREEN)
	_content.add_child(HSeparator.new())
	var back := Button.new()
	back.text = UIStrings.t("usage.back")
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
