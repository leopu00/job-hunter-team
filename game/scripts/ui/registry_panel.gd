class_name RegistryPanel
extends CanvasLayer
## Registro candidature (quest log, TAB): candidature come quest a stadi
## inviata → screening → colloquio → offerta, con streak+freeze in testa.

const STAGES := 4

func _init() -> void:
	layer = 40

func _ready() -> void:
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.theme = TerminalTheme.get_theme()
	add_child(root)
	var dim := ColorRect.new()
	dim.color = Color(Palette.VOID.r, Palette.VOID.g, Palette.VOID.b, 0.6)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.add_child(dim)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.add_child(center)
	var panel := BracketPanel.new()
	panel.custom_minimum_size = Vector2(980, 0)
	center.add_child(panel)
	var margin := MarginContainer.new()
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 28)
	panel.add_child(margin)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 14)
	margin.add_child(box)

	var title := TerminalTheme.label(UIStrings.t("registry.title"), 26, Palette.WHITE, "xbold")
	box.add_child(title)

	var streak: Dictionary = TeamData.streak()
	var streak_row := HBoxContainer.new()
	streak_row.add_theme_constant_override("separation", 10)
	box.add_child(streak_row)
	var flames := ""
	for i in mini(int(streak.get("days", 0)), 10):
		flames += "▮"
	streak_row.add_child(TerminalTheme.label(flames, 18, Palette.ORANGE, "bold"))
	streak_row.add_child(TerminalTheme.label(
			UIStrings.t("registry.streak") % [streak.get("days", 0), streak.get("freezes", 0)],
			16, Palette.MUTED))
	box.add_child(HSeparator.new())

	var apps: Array = TeamData.applications()
	if apps.is_empty():
		box.add_child(TerminalTheme.label(UIStrings.t("registry.empty"), 17, Palette.DIM))
	for app in apps:
		box.add_child(_app_row(app))

	var hint := TerminalTheme.label(UIStrings.t("registry.close"), 14, Palette.DIM)
	hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	box.add_child(hint)
	Sfx.play_blip()

func _app_row(app: Dictionary) -> Control:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 18)
	var score := TerminalTheme.label(str(app["score"]), 22,
			Palette.MINT if app["score"] >= 70 else Palette.YELLOW, "xbold")
	score.custom_minimum_size = Vector2(52, 0)
	row.add_child(score)
	var text_col := VBoxContainer.new()
	text_col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(text_col)
	text_col.add_child(TerminalTheme.label(app["title"], 18, Palette.BRIGHT, "medium"))
	text_col.add_child(TerminalTheme.label(app["company"], 14, Palette.MUTED))
	# pips di stadio: ▰ raggiunti, ▱ da fare
	var stage: int = app["stage"]
	var pips := ""
	for i in STAGES:
		pips += "▰" if i <= stage else "▱"
	var stage_col := VBoxContainer.new()
	row.add_child(stage_col)
	var pips_label := TerminalTheme.label(pips, 20,
			Palette.GREEN if stage >= 3 else Palette.BASE, "bold")
	pips_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	stage_col.add_child(pips_label)
	var stage_name := TerminalTheme.label(UIStrings.t("registry.stage_%d" % stage), 13,
			Palette.GREEN if stage >= 3 else Palette.DIM)
	stage_name.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	stage_col.add_child(stage_name)
	return row
