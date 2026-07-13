class_name GameSidebar
extends CanvasLayer
## Sidebar stile desktop-app dentro il gioco: stessi gruppi/voci/ordine
## della app (SidebarDefs), veste terminale del gioco. Ogni voce apre un
## SectionPanel; il contenuto vero delle sezioni arriverà con la migrazione.
## Si apre/chiude con il bottone-linguetta ≡ in alto a sinistra.

const WIDTH := 232.0

var _drawer: Control
var _panel: SectionPanel
var _buttons := {}  # id sezione → Button
var _open := false

func _init() -> void:
	layer = 20

func _ready() -> void:
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.theme = TerminalTheme.get_theme()
	add_child(root)

	# linguetta sempre visibile (apre/chiude il cassetto): cornice terminale
	var tab := Button.new()
	tab.text = "≡"
	tab.add_theme_font_size_override("font_size", 26)
	tab.add_theme_color_override("font_color", Palette.GREEN)
	tab.add_theme_color_override("font_hover_color", Palette.MINT)
	var tab_style := StyleBoxFlat.new()
	tab_style.bg_color = Color(Palette.PANEL.r, Palette.PANEL.g, Palette.PANEL.b, 0.92)
	tab_style.border_color = Palette.BORDER_GLOW
	tab_style.set_border_width_all(1)
	tab_style.content_margin_left = 12
	tab_style.content_margin_right = 12
	tab_style.content_margin_top = 4
	tab_style.content_margin_bottom = 6
	var tab_hover := tab_style.duplicate()
	tab_hover.border_color = Palette.GREEN
	tab.add_theme_stylebox_override("normal", tab_style)
	tab.add_theme_stylebox_override("hover", tab_hover)
	tab.add_theme_stylebox_override("pressed", tab_hover.duplicate())
	tab.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
	tab.position = Vector2(10, 150)
	tab.pressed.connect(toggle)
	root.add_child(tab)

	_drawer = PanelContainer.new()
	var style := StyleBoxFlat.new()
	style.bg_color = Color(Palette.PANEL.r, Palette.PANEL.g, Palette.PANEL.b, 0.96)
	style.border_color = Palette.BORDER_GLOW
	style.set_border_width_all(1)
	_drawer.add_theme_stylebox_override("panel", style)
	_drawer.custom_minimum_size = Vector2(WIDTH, 0)
	_drawer.set_anchors_preset(Control.PRESET_LEFT_WIDE)
	_drawer.visible = false
	root.add_child(_drawer)

	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_drawer.add_child(scroll)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 2)
	box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(box)

	var brand := TerminalTheme.label("JOB HUNTER TEAM", 15, Palette.WHITE, "xbold")
	brand.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	var brand_pad := MarginContainer.new()
	for side in ["top", "bottom"]:
		brand_pad.add_theme_constant_override("margin_" + side, 14)
	brand_pad.add_child(brand)
	box.add_child(brand_pad)

	# TEST-AUTO: JHT_SIDEBAR=1 apre il cassetto al boot (per gli screenshot);
	# JHT_SECTION=<id> apre anche il pannello di quella sezione.
	if OS.get_environment("JHT_SIDEBAR") == "1":
		toggle.call_deferred()
	var sec := OS.get_environment("JHT_SECTION")
	if sec != "":
		if not _open:
			toggle.call_deferred()
		_select.call_deferred(sec)

	for group in SidebarDefs.GROUPS:
		var gt := TerminalTheme.label(
				SidebarDefs.group_title(group).to_upper(), 12, Palette.DIM, "medium")
		var gt_pad := MarginContainer.new()
		gt_pad.add_theme_constant_override("margin_left", 14)
		gt_pad.add_theme_constant_override("margin_top", 12)
		gt_pad.add_theme_constant_override("margin_bottom", 4)
		gt_pad.add_child(gt)
		box.add_child(gt_pad)
		for item in group["items"]:
			box.add_child(_nav_button(item))

func toggle() -> void:
	_open = not _open
	_drawer.visible = _open
	if not _open:
		_close_panel()
	Sfx.play_tick()

## Stile riga di navigazione: sfondo pieno, accento verde a sinistra.
## `bg_alpha` 0 = trasparente (normal); `accent` accende la barra 3px.
static func _row_style(bg: Color, bg_alpha: float, accent: bool) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(bg.r, bg.g, bg.b, bg_alpha)
	sb.set_border_width_all(0)
	if accent:
		sb.border_width_left = 3
		sb.border_color = Palette.GREEN
	sb.content_margin_left = 14
	sb.content_margin_right = 10
	sb.content_margin_top = 7
	sb.content_margin_bottom = 7
	return sb

func _nav_button(item: Dictionary) -> Control:
	var btn := Button.new()
	btn.alignment = HORIZONTAL_ALIGNMENT_LEFT
	btn.text = "%s  %s" % [item["icon"], SidebarDefs.label_for(item["id"])]
	btn.add_theme_font_size_override("font_size", 16)
	btn.add_theme_font_override("font", load(TerminalTheme.FONT_MEDIUM))
	btn.add_theme_color_override("font_color", Palette.BASE)
	btn.add_theme_color_override("font_hover_color", Palette.WHITE)
	btn.add_theme_color_override("font_pressed_color", Palette.GREEN)
	btn.add_theme_stylebox_override("normal", _row_style(Palette.ROW, 0.0, false))
	btn.add_theme_stylebox_override("hover", _row_style(Palette.ROW, 0.85, true))
	btn.add_theme_stylebox_override("pressed", _row_style(Palette.DEEP, 1.0, true))
	btn.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
	btn.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	btn.pressed.connect(func() -> void: _select(item["id"]))
	_buttons[item["id"]] = btn
	var pad := MarginContainer.new()
	pad.add_theme_constant_override("margin_left", 8)
	pad.add_theme_constant_override("margin_right", 8)
	pad.add_child(btn)
	return pad

## Apre (o richiude, se già attiva) la sezione richiesta.
func _select(section: String) -> void:
	if _panel and _panel.section == section:
		_close_panel()
		return
	_close_panel()
	_panel = SectionPanel.new(section, WIDTH)
	add_child(_panel)
	_panel.closed.connect(_close_panel)
	_panel.navigate.connect(_select)  # es. box pipeline → positions filtrate
	_set_active(section)
	Sfx.play_blip()

func _close_panel() -> void:
	if _panel:
		_panel.queue_free()
		_panel = null
	_set_active("")

func _set_active(section: String) -> void:
	for id in _buttons:
		var b: Button = _buttons[id]
		var active: bool = (id == section)
		b.add_theme_color_override("font_color",
				Palette.GREEN if active else Palette.BASE)
		# la voce attiva tiene sfondo e barra accento anche fuori hover
		b.add_theme_stylebox_override("normal",
				_row_style(Palette.DEEP, 1.0, true) if active
				else _row_style(Palette.ROW, 0.0, false))
