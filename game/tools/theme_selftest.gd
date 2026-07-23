extends SceneTree
## Contratto del tema UI: entrambe le palette devono produrre un Theme
## coerente e leggibile. Non salva preferenze, così il test non modifica
## l'impostazione scelta dal giocatore.

var _failures: Array[String] = []


func _init() -> void:
	var original := Palette.mode
	_check_mode(Palette.MODE_LIGHT)
	_check_mode(Palette.MODE_DARK)
	Palette.set_mode(original, false)
	TerminalTheme.reset()
	if _failures.is_empty():
		print("THEME-TEST PASS")
		quit(0)
		return
	for failure in _failures:
		push_error("[theme-test] " + failure)
	print("THEME-TEST FAIL")
	quit(1)


func _check_mode(requested: String) -> void:
	_assert(Palette.set_mode(requested, false) or Palette.mode == requested,
			"impossibile attivare " + requested)
	TerminalTheme.reset()
	var theme := TerminalTheme.get_theme()
	var panel := theme.get_stylebox("panel", "Panel") as StyleBoxFlat
	var line_edit := theme.get_stylebox("normal", "LineEdit") as StyleBoxFlat
	_assert(panel != null and _near(panel.bg_color, Palette.PANEL),
			requested + ": pannello non usa Palette.PANEL")
	_assert(line_edit != null and _near(line_edit.bg_color, Palette.DEEP),
			requested + ": campo testo non usa Palette.DEEP")
	_assert(theme.get_color("font_color", "Label") == Palette.BASE,
			requested + ": testo label fuori palette")
	_assert(Palette.WHITE.get_luminance() < Palette.PANEL.get_luminance()
			if requested == Palette.MODE_LIGHT
			else Palette.WHITE.get_luminance() > Palette.PANEL.get_luminance(),
			requested + ": contrasto testo/sfondo invertito")


func _near(a: Color, b: Color) -> bool:
	return absf(a.r - b.r) < 0.001 and absf(a.g - b.g) < 0.001 \
			and absf(a.b - b.b) < 0.001 and absf(a.a - b.a) < 0.001


func _assert(condition: bool, message: String) -> void:
	if not condition:
		_failures.append(message)
