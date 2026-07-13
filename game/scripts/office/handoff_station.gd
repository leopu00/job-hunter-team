class_name HandoffStation
extends Node2D
## Vaschetta fisica di passaggio tra reparti. La pila PaperPile vive sopra
## questo mobile: niente più fogli sospesi sul pavimento e il punto unico di
## consegna resta leggibile anche quando la pila è vuota.

const SIZE := Vector2(92, 38)

var dept := ""
var destination := ""
var color := Color.WHITE
var _font: Font

func _init(p_dept: String, p_position: Vector2, p_destination: String,
		p_color: Color) -> void:
	dept = p_dept
	destination = p_destination
	color = p_color
	position = p_position

func _ready() -> void:
	_font = load(TerminalTheme.FONT_MEDIUM)
	queue_redraw()

func _draw() -> void:
	# ombra e piedistallo basso: il foglio è appoggiato a un oggetto reale.
	draw_set_transform(Vector2(0, 8), 0.0, Vector2(1.0, 0.32))
	draw_circle(Vector2.ZERO, 52.0, Color(0, 0, 0, 0.22))
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	draw_rect(Rect2(-SIZE / 2.0 + Vector2(5, 8), SIZE - Vector2(10, 0)),
			Color("#24252d"))
	draw_rect(Rect2(-SIZE / 2.0, SIZE), Color("#484b55"))
	draw_rect(Rect2(-SIZE / 2.0, SIZE), color.darkened(0.22), false, 2.0)
	# bordo rialzato della vaschetta.
	draw_line(Vector2(-SIZE.x / 2.0, -SIZE.y / 2.0),
			Vector2(-SIZE.x / 2.0, SIZE.y / 2.0), color, 3.0)
	draw_line(Vector2(SIZE.x / 2.0, -SIZE.y / 2.0),
			Vector2(SIZE.x / 2.0, SIZE.y / 2.0), color, 3.0)
	draw_line(Vector2(-SIZE.x / 2.0, SIZE.y / 2.0),
			Vector2(SIZE.x / 2.0, SIZE.y / 2.0), color, 3.0)
	if _font:
		var text := "→ " + destination.to_upper()
		var w := _font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, 10).x
		draw_rect(Rect2(Vector2(-w / 2.0 - 5, 22), Vector2(w + 10, 16)),
				Color(0.04, 0.04, 0.06, 0.94))
		draw_string(_font, Vector2(-w / 2.0, 34), text,
				HORIZONTAL_ALIGNMENT_LEFT, -1, 10, color.lightened(0.18))
