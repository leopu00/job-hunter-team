class_name StatusBubble
extends Node2D
## Bubble di stato sopra la testa di un agente (pattern Gather/Oxenfree):
## piccola vignetta terminale che appare e svanisce con il testo corrente.

const FONT_SIZE := 13
const PAD := Vector2(8, 5)

var _text := ""
var _alpha := 0.0
var _target_alpha := 0.0
var _font: Font
var _fs := FONT_SIZE  # compensato sotto scala 1 (leggibilità 1366x768)
var _boost := 1.0     # compensazione della scala di rendering del mondo

func _ready() -> void:
	_font = load(TerminalTheme.FONT_REGULAR)
	z_index = 50  # sopra i personaggi, sotto l'HUD
	# Registrandosi il nodo riceve subito la misura giusta per la scala in corso.
	WorldText.mark(self)  # leggibile a qualunque risoluzione del mondo

## Rimisura il corpo del testo: boost degli schermi piccoli per compensazione
## della scala di rendering del mondo.
func refresh_world_text() -> void:
	_boost = WorldText.boost()
	_fs = int(round(FONT_SIZE * TerminalTheme.text_boost() * _boost))
	queue_redraw()

func show_text(text: String, duration := 3.5) -> void:
	_text = text
	_target_alpha = 1.0
	queue_redraw()
	var timer := get_tree().create_timer(duration)
	timer.timeout.connect(func() -> void:
		if _text == text:  # nessun testo più recente nel frattempo
			_target_alpha = 0.0)

func hide_now() -> void:
	_target_alpha = 0.0

## Visibile o in dissolvenza: chi deve cedere il posto (la targa di stato)
## controlla qui, non l'alpha istantaneo.
func is_showing() -> bool:
	return _target_alpha > 0.0 or _alpha > 0.01

func _process(delta: float) -> void:
	var prev := _alpha
	_alpha = move_toward(_alpha, _target_alpha, delta * 6.0)
	if _alpha != prev:
		queue_redraw()

func _draw() -> void:
	if _alpha <= 0.01 or _text.is_empty():
		return
	# Vignetta e codino crescono col testo (_boost): a risoluzione ridotta il
	# riquadro deve restare cucito addosso alla frase, non tagliarla.
	var pad := PAD * _boost
	var size := _font.get_string_size(_text, HORIZONTAL_ALIGNMENT_LEFT, -1, _fs)
	var box := Rect2(Vector2(-size.x / 2.0 - pad.x, -size.y - pad.y * 2.0 - 10.0 * _boost),
			Vector2(size.x + pad.x * 2.0, size.y + pad.y * 2.0))
	var rise := (1.0 - _alpha) * 4.0 * _boost  # piccolo slide-in verticale
	box.position.y += rise
	var bg := Color(Palette.PANEL.r, Palette.PANEL.g, Palette.PANEL.b, 0.94 * _alpha)
	var border := Color(Palette.BORDER_GLOW.r, Palette.BORDER_GLOW.g, Palette.BORDER_GLOW.b, _alpha)
	draw_rect(box, bg)
	draw_rect(box, border, false, 1.0 * _boost)
	# codino verso la testa
	var tail := PackedVector2Array([
		Vector2(-4.0 * _boost, box.end.y), Vector2(4.0 * _boost, box.end.y),
		Vector2(0, box.end.y + 6.0 * _boost),
	])
	draw_colored_polygon(tail, bg)
	draw_string(_font, box.position + Vector2(pad.x, pad.y + size.y - 4.0 * _boost), _text,
			HORIZONTAL_ALIGNMENT_LEFT, -1, _fs,
			Color(Palette.BASE.r, Palette.BASE.g, Palette.BASE.b, _alpha))
