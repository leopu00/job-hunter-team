class_name TerminalTheme
## Costruisce (una volta) il Theme "console JHT": JetBrains Mono, pannelli
## piatti quasi-neri, bordi squadrati 1px, hover verde. Niente border-radius.

static var _theme: Theme

const FONT_REGULAR := "res://assets/fonts/JetBrainsMono-Regular.ttf"
const FONT_MEDIUM := "res://assets/fonts/JetBrainsMono-Medium.ttf"
const FONT_BOLD := "res://assets/fonts/JetBrainsMono-Bold.ttf"
const FONT_XBOLD := "res://assets/fonts/JetBrainsMono-ExtraBold.ttf"

static func get_theme() -> Theme:
	if _theme:
		return _theme
	var t := Theme.new()
	t.default_font = load(FONT_REGULAR)
	t.default_font_size = 19

	# Pannelli
	var panel := _flat(Palette.PANEL, Palette.BORDER)
	t.set_stylebox("panel", "Panel", panel)
	t.set_stylebox("panel", "PanelContainer", panel)

	# Label
	t.set_color("font_color", "Label", Palette.BASE)

	# Bottoni
	var btn := _flat(Palette.CARD, Palette.BORDER)
	btn.content_margin_left = 18
	btn.content_margin_right = 18
	btn.content_margin_top = 8
	btn.content_margin_bottom = 8
	var btn_hover := btn.duplicate()
	btn_hover.border_color = Palette.GREEN
	btn_hover.bg_color = Palette.ROW
	var btn_pressed := btn_hover.duplicate()
	btn_pressed.bg_color = Palette.DEEP
	var btn_disabled := btn_hover.duplicate()
	btn_disabled.bg_color = Palette.ROW
	t.set_stylebox("normal", "Button", btn)
	t.set_stylebox("hover", "Button", btn_hover)
	t.set_stylebox("pressed", "Button", btn_pressed)
	t.set_stylebox("focus", "Button", btn_hover.duplicate())
	t.set_stylebox("disabled", "Button", btn_disabled)
	t.set_color("font_color", "Button", Palette.BASE)
	t.set_color("font_hover_color", "Button", Palette.GREEN)
	t.set_color("font_pressed_color", "Button", Palette.MINT)
	t.set_color("font_focus_color", "Button", Palette.GREEN)
	t.set_color("font_disabled_color", "Button", Palette.GREEN)
	t.set_font("font", "Button", load(FONT_MEDIUM))

	# LineEdit
	var le := _flat(Palette.DEEP, Palette.BORDER)
	le.content_margin_left = 12
	le.content_margin_right = 12
	le.content_margin_top = 8
	le.content_margin_bottom = 8
	var le_focus := le.duplicate()
	le_focus.border_color = Palette.GREEN
	t.set_stylebox("normal", "LineEdit", le)
	t.set_stylebox("focus", "LineEdit", le_focus)
	t.set_color("font_color", "LineEdit", Palette.WHITE)
	t.set_color("font_placeholder_color", "LineEdit", Palette.DIM)
	t.set_color("caret_color", "LineEdit", Palette.GREEN)
	t.set_color("selection_color", "LineEdit", Color(Palette.GREEN, 0.24))

	# TextEdit / CodeEdit: usati da anteprime e console incorporate.
	for type in ["TextEdit", "CodeEdit"]:
		t.set_stylebox("normal", type, le.duplicate())
		t.set_stylebox("focus", type, le_focus.duplicate())
		t.set_color("font_color", type, Palette.WHITE)
		t.set_color("font_placeholder_color", type, Palette.DIM)
		t.set_color("caret_color", type, Palette.GREEN)
		t.set_color("selection_color", type, Color(Palette.GREEN, 0.24))

	# ProgressBar
	var pb_bg := _flat(Palette.DEEP, Palette.BORDER)
	var pb_fill := _flat(Palette.GREEN, Palette.GREEN)
	t.set_stylebox("background", "ProgressBar", pb_bg)
	t.set_stylebox("fill", "ProgressBar", pb_fill)
	t.set_color("font_color", "ProgressBar", Palette.VOID)

	# RichTextLabel (dialoghi)
	t.set_color("default_color", "RichTextLabel", Palette.BRIGHT)
	t.set_font("normal_font", "RichTextLabel", load(FONT_REGULAR))
	t.set_font("bold_font", "RichTextLabel", load(FONT_BOLD))

	# Separatori e scrollbar devono schiarirsi insieme ai pannelli: lasciare
	# quelli del tema Godot produrrebbe righe e binari dark nel tema light.
	var separator := StyleBoxLine.new()
	separator.color = Palette.BORDER
	separator.thickness = hairline()
	t.set_stylebox("separator", "HSeparator", separator)
	var vseparator := separator.duplicate()
	vseparator.vertical = true
	t.set_stylebox("separator", "VSeparator", vseparator)
	var scroll_bg := _flat(Palette.CARD, Palette.BORDER)
	var scroll_grab := _flat(Palette.BORDER_GLOW, Palette.BORDER_GLOW)
	for type in ["VScrollBar", "HScrollBar"]:
		t.set_stylebox("scroll", type, scroll_bg.duplicate())
		t.set_stylebox("grabber", type, scroll_grab.duplicate())
		t.set_stylebox("grabber_highlight", type, _flat(Palette.GREEN, Palette.GREEN))

	_theme = t
	return t


static func reset() -> void:
	_theme = null

## Spessore del bordo "hairline". Il design 1920x1080 viene riscalato con
## canvas_items: su schermi più piccoli (1366x768) un bordo di 1px logico
## scende sotto il pixel fisico e certi driver (Intel HD + ANGLE) ne perdono
## dei lati interi — i "bordi su tre lati" visti da Leone su Windows 22/07.
## A scala <1 il bordo passa a 2px logici (≥1px fisico garantito).
static func hairline() -> int:
	var screen := DisplayServer.screen_get_size()
	if screen.x <= 0 or screen.y <= 0:
		return 1
	var scale := minf(screen.x / 1920.0, screen.y / 1080.0)
	return 2 if scale < 1.0 else 1


## Fattore di leggibilità per il testo di scena (fumetti, targhe): sotto
## scala 1 (schermi 1366x768) i corpi piccoli scendono sotto la soglia di
## lettura — "quello che scrivono gli agenti si vede male" (Leone 22/07).
## Si compensa quanto basta a ritrovare la dimensione fisica del design.
static func text_boost() -> float:
	var screen := DisplayServer.screen_get_size()
	if screen.x <= 0 or screen.y <= 0:
		return 1.0
	var scale := minf(screen.x / 1920.0, screen.y / 1080.0)
	return clampf(1.0 / scale, 1.0, 1.5) if scale < 1.0 else 1.0


static func _flat(bg: Color, border: Color) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = bg
	sb.border_color = border
	sb.set_border_width_all(hairline())
	sb.set_corner_radius_all(0)
	sb.content_margin_left = 10
	sb.content_margin_right = 10
	sb.content_margin_top = 6
	sb.content_margin_bottom = 6
	return sb

## Label helper: crea una Label monospace con size/colore/peso dati.
static func label(text: String, size: int, color: Color, weight := "regular") -> Label:
	var l := Label.new()
	l.text = text
	var fonts := {
		"regular": FONT_REGULAR, "medium": FONT_MEDIUM,
		"bold": FONT_BOLD, "xbold": FONT_XBOLD,
	}
	l.add_theme_font_override("font", load(fonts[weight]))
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	return l

## Paragrafo Markdown leggero per i testi prodotti dal team. Godot parla
## BBCode: convertiamo il grassetto **...** e preserviamo le parentesi
## quadre letterali, frequenti nelle job description.
static func markdown_label(text: String, size: int, color: Color) -> RichTextLabel:
	var rich := RichTextLabel.new()
	rich.bbcode_enabled = true
	rich.fit_content = true
	rich.scroll_active = false
	rich.selection_enabled = true
	rich.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	rich.add_theme_font_size_override("normal_font_size", size)
	rich.add_theme_font_size_override("bold_font_size", size)
	rich.add_theme_color_override("default_color", color)
	rich.text = _markdown_to_bbcode(text)
	return rich

static func _markdown_to_bbcode(text: String) -> String:
	var decoded := _decode_unicode_escapes(text)
	var rendered := decoded.replace("[", "\uE000").replace("]", "[rb]") \
			.replace("\uE000", "[lb]")
	var bold := RegEx.new()
	if bold.compile("\\*\\*([^*]+)\\*\\*") == OK:
		rendered = bold.sub(rendered, "[b]$1[/b]", true)
	return rendered

## Alcuni jd_summary persistiti dal team contengono escape Python letterali
## (es. "\\U0001F310") invece del codepoint Unicode. Le convertiamo solo
## quando la forma è esattamente valida, lasciando intatto ogni altro slash.
static func _decode_unicode_escapes(text: String) -> String:
	var unicode_escape := RegEx.new()
	if unicode_escape.compile("\\\\(?:U([0-9A-Fa-f]{8})|u([0-9A-Fa-f]{4}))") != OK:
		return text
	var result := ""
	var cursor := 0
	for found in unicode_escape.search_all(text):
		result += text.substr(cursor, found.get_start() - cursor)
		var digits := found.get_string(1)
		if digits == "":
			digits = found.get_string(2)
		var codepoint := digits.hex_to_int()
		if codepoint <= 0x10FFFF and not (codepoint >= 0xD800 and codepoint <= 0xDFFF):
			result += String.chr(codepoint)
		else:
			result += found.get_string()
		cursor = found.get_end()
	result += text.substr(cursor)
	return result
