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
	box.add_child(TerminalTheme.label(
			"// sezione in migrazione dalla desktop app", 16, Palette.DIM))
	box.add_child(TerminalTheme.label(
			"I contenuti di «%s» verranno portati qui, un pezzo alla volta."
			% SidebarDefs.label_for(section), 15, Palette.MUTED))
