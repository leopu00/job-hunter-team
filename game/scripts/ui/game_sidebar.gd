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

	# linguetta sempre visibile (apre/chiude il cassetto)
	var tab := Button.new()
	tab.text = "≡"
	tab.flat = true
	tab.add_theme_font_size_override("font_size", 26)
	tab.add_theme_color_override("font_color", Palette.GREEN)
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

	for group in SidebarDefs.GROUPS:
		var gt := TerminalTheme.label((group["title"] as String).to_upper(), 12, Palette.DIM, "medium")
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

func _nav_button(item: Dictionary) -> Control:
	var btn := Button.new()
	btn.flat = true
	btn.alignment = HORIZONTAL_ALIGNMENT_LEFT
	btn.text = "%s  %s" % [item["icon"], item["label"]]
	btn.add_theme_font_size_override("font_size", 16)
	btn.add_theme_color_override("font_color", Palette.BASE)
	btn.add_theme_color_override("font_hover_color", Palette.WHITE)
	btn.add_theme_color_override("font_pressed_color", Palette.GREEN)
	btn.pressed.connect(func() -> void: _select(item["id"]))
	_buttons[item["id"]] = btn
	var pad := MarginContainer.new()
	pad.add_theme_constant_override("margin_left", 10)
	pad.add_theme_constant_override("margin_right", 10)
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
		b.add_theme_color_override("font_color",
				Palette.GREEN if id == section else Palette.BASE)
