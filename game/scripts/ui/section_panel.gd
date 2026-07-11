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
		_:
			_build_placeholder()

func _build_placeholder() -> void:
	_content.add_child(TerminalTheme.label(
			"// sezione in migrazione dalla desktop app", 16, Palette.DIM))
	_content.add_child(TerminalTheme.label(
			"I contenuti di «%s» verranno portati qui, un pezzo alla volta."
			% SidebarDefs.label_for(section), 15, Palette.MUTED))

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
