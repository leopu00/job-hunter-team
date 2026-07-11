class_name ExitDoor
extends Node2D
## La porta dell'ufficio (missione pipeline 20:1x): da qui ESCONO gli
## agenti killati/fermati — non si dissolvono nel nulla, semplicemente
## non sono più in ufficio. Due ante di vetro che scorrono quando
## qualcuno passa e insegna EXIT. Solo primitive _draw (gotcha GLES3).

static var instance: ExitDoor

const W := 150.0        # larghezza del varco
const POST := 10.0      # montanti
const GLASS := Color(0.35, 0.85, 1.0, 0.30)
const FRAME := Color(0.45, 0.95, 1.0, 0.85)

var _open := 0.0   # 0 = chiusa, 1 = ante rientrate nei montanti
var _hold := 0.0   # secondi in cui resta aperta

func _init(center: Vector2) -> void:
	position = center
	instance = self

## Qualcuno sta passando: le ante scorrono e restano aperte un attimo.
static func swing() -> void:
	if instance:
		instance._hold = 1.6

func _process(delta: float) -> void:
	var target := 1.0 if _hold > 0.0 else 0.0
	_hold = maxf(0.0, _hold - delta)
	var next := move_toward(_open, target, delta * 3.5)
	if not is_equal_approx(next, _open):
		_open = next
		queue_redraw()

func _draw() -> void:
	var half := W / 2.0
	# soglia sul pavimento (tappetino d'uscita)
	draw_rect(Rect2(Vector2(-half, -26), Vector2(W, 26)),
			Color(1, 1, 1, 0.045))
	# montanti ai lati del varco
	for sx: float in [-1.0, 1.0]:
		draw_rect(Rect2(Vector2(sx * half - POST / 2.0, -64),
				Vector2(POST, 70)), Palette.BORDER_GLOW)
		draw_rect(Rect2(Vector2(sx * half - POST / 2.0, -64),
				Vector2(POST, 70)), FRAME, false, 1.5)
	# le due ante scorrono verso i montanti quando _open cresce
	var leaf := half - POST / 2.0
	var slide := _open * leaf
	for sx: float in [-1.0, 1.0]:
		var x0 := sx * POST / 2.0 + sx * slide
		var r := Rect2(Vector2(minf(x0, x0 + sx * (leaf - slide)), -58),
				Vector2(maxf(2.0, leaf - slide), 52))
		draw_rect(r, GLASS)
		draw_rect(r, FRAME, false, 1.2)
	# insegna EXIT sopra il varco
	draw_rect(Rect2(Vector2(-30, -92), Vector2(60, 22)), Palette.PANEL)
	draw_rect(Rect2(Vector2(-30, -92), Vector2(60, 22)),
			Color(Palette.GREEN, 0.8), false, 1.2)
	draw_string(ThemeDB.fallback_font, Vector2(-17, -76), "EXIT",
			HORIZONTAL_ALIGNMENT_LEFT, -1, 13, Palette.GREEN)
