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
	_check_chat_text()
	_check_emoji_fallback()
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


## Come arriva in chat quello che scrive un agente: markdown reso, a capo
## veri anche quando il messaggio li porta come escape letterali (jht-send).
func _check_chat_text() -> void:
	var rich := TerminalTheme.markdown_label(
			"Ciao!\\n\\nChe **ruolo** cerchi?", 15, Palette.BASE)
	var body: String = rich.text
	_assert(not body.contains("\\n"), "escape \\n non decodificato in chat")
	_assert(body.contains("\n\n"), "a capo mancante nel testo di chat")
	_assert(body.contains("[b]ruolo[/b]"), "grassetto markdown non convertito")
	rich.free()
	var right := TerminalTheme.markdown_label("ciao", 15, Palette.BASE,
			HORIZONTAL_ALIGNMENT_RIGHT)
	_assert(right.text.begins_with("[right]"), "messaggio utente non allineato a destra")
	right.free()


## Le emoji dei messaggi agente non devono cadere sui font di sistema:
## il fallback imbarcato deve essere agganciato ai font del tema.
func _check_emoji_fallback() -> void:
	var regular := TerminalTheme.font(TerminalTheme.FONT_REGULAR)
	_assert(regular.fallbacks.size() > 0, "font senza fallback emoji")
	var emoji: FontFile = load(TerminalTheme.FONT_EMOJI)
	_assert(emoji != null and emoji.has_char(0x1F4CE), "font emoji privo dei glifi attesi")
	_assert(regular.has_char(0x1F4CE), "graffetta 📎 non risolta dal fallback")


func _near(a: Color, b: Color) -> bool:
	return absf(a.r - b.r) < 0.001 and absf(a.g - b.g) < 0.001 \
			and absf(a.b - b.b) < 0.001 and absf(a.a - b.a) < 0.001


func _assert(condition: bool, message: String) -> void:
	if not condition:
		_failures.append(message)
