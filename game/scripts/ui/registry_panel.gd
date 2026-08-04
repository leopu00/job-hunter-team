class_name RegistryPanel
extends CanvasLayer
## Registro candidature (TAB): stati informativi da inviata a offerta.

const STAGES := 4

func _init() -> void:
	layer = 40
	add_to_group("camera_blocking_overlay")

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

	# con la VPS: le candidature VERE (CV pronto → inviata → risposta).
	if not BackendBus.positions.is_empty():
		box.add_child(HSeparator.new())
		var live_rows := 0
		for p in BackendBus.positions:
			if not LIVE_STAGES.has(str(p.get("status", ""))):
				continue
			box.add_child(_live_row(p))
			live_rows += 1
		if live_rows == 0:
			box.add_child(TerminalTheme.label(UIStrings.t("apps.empty_live"),
					17, Palette.DIM))
	else:
		var apps: Array = TeamData.applications()
		if apps.is_empty():
			box.add_child(TerminalTheme.label(UIStrings.t("registry.empty"), 17, Palette.DIM))
		for app in apps:
			box.add_child(_app_row(app))

	var hint := TerminalTheme.label(UIStrings.t("registry.close"), 14, Palette.DIM)
	hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	box.add_child(hint)
	Sfx.play_blip()

## Stadi reali sui 3 pip: CV pronto → inviata → risposta ricevuta.
const LIVE_STAGES := {"ready": ["apps.ready", 0], "applied": ["apps.applied", 1],
		"response": ["apps.response", 2]}

func _live_row(p: Dictionary) -> Control:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 18)
	var score_v: Variant = p.get("total_score")
	var score := TerminalTheme.label("—" if score_v == null else str(int(score_v)), 22,
			Palette.MINT if score_v != null and float(score_v) >= 70.0
			else Palette.YELLOW, "xbold")
	score.custom_minimum_size = Vector2(52, 0)
	row.add_child(score)
	var text_col := VBoxContainer.new()
	text_col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(text_col)
	text_col.add_child(TerminalTheme.label(str(p.get("title", "?")), 18,
			Palette.BRIGHT, "medium"))
	text_col.add_child(TerminalTheme.label(str(p.get("company", "?")), 14, Palette.MUTED))
	var info: Array = LIVE_STAGES[str(p.get("status", ""))]
	var stage := int(info[1])
	var pips := ""
	for i in LIVE_STAGES.size():
		pips += "▰" if i <= stage else "▱"
	var stage_col := VBoxContainer.new()
	row.add_child(stage_col)
	var pips_label := TerminalTheme.label(pips, 20,
			Palette.GREEN if stage >= 2 else Palette.BASE, "bold")
	pips_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	stage_col.add_child(pips_label)
	var stage_name := TerminalTheme.label(UIStrings.t(str(info[0])), 13,
			Palette.GREEN if stage >= 2 else Palette.DIM)
	stage_name.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	stage_col.add_child(stage_name)
	return row

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
