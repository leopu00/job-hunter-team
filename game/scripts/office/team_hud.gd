class_name TeamHud
extends BracketPanel
## Pannello terminale in alto a sinistra: stato del team (mock via TeamData).

var _positions: Label
var _score: Label
var _budget: ProgressBar
var _accum := 9.0  # aggiorna subito al primo frame

func _ready() -> void:
	super._ready()
	# in alto a DESTRA: a sinistra vive la sidebar stile desktop-app
	set_anchors_and_offsets_preset(Control.PRESET_TOP_RIGHT, Control.PRESET_MODE_MINSIZE, 24)
	grow_horizontal = Control.GROW_DIRECTION_BEGIN
	var margin := MarginContainer.new()
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 14)
	add_child(margin)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 6)
	margin.add_child(box)

	var team_name := UIStrings.t("hud.team_default")
	var title_row := HBoxContainer.new()
	title_row.add_theme_constant_override("separation", 10)
	box.add_child(title_row)
	var dot := TerminalTheme.label("●", 15, Palette.GREEN)
	title_row.add_child(dot)
	title_row.add_child(TerminalTheme.label(team_name.to_upper(), 18, Palette.WHITE, "xbold"))

	_positions = _stat_row(box, UIStrings.t("hud.positions_today"))
	_score = _stat_row(box, UIStrings.t("hud.avg_score"))

	var budget_row := HBoxContainer.new()
	budget_row.add_theme_constant_override("separation", 12)
	box.add_child(budget_row)
	var budget_label := TerminalTheme.label(UIStrings.t("hud.budget"), 15, Palette.MUTED, "medium")
	budget_label.custom_minimum_size = Vector2(190, 0)
	budget_row.add_child(budget_label)
	_budget = ProgressBar.new()
	_budget.custom_minimum_size = Vector2(120, 16)
	_budget.max_value = 1.0
	_budget.show_percentage = false
	budget_row.add_child(_budget)

func _process(delta: float) -> void:
	_accum += delta
	if _accum < 5.0:
		return
	_accum = 0.0
	var s: Dictionary = TeamData.summary()
	_positions.text = str(s["positions_today"])
	_score.text = str(s["avg_score"])
	_budget.value = s["budget_used_pct"]

func _stat_row(parent: Node, label_text: String) -> Label:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	parent.add_child(row)
	var lbl := TerminalTheme.label(label_text, 15, Palette.MUTED, "medium")
	lbl.custom_minimum_size = Vector2(190, 0)
	row.add_child(lbl)
	var value := TerminalTheme.label("—", 16, Palette.MINT, "bold")
	row.add_child(value)
	return value
