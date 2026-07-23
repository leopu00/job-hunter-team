class_name BracketPanel
extends PanelContainer
## Pannello HUD con i brackets a L verdi agli angoli, come sul sito.

@export var bracket_color := Color.TRANSPARENT
@export var bracket_len := 16.0
@export var bracket_width := 2.0

func _ready() -> void:
	if bracket_color == Color.TRANSPARENT:
		bracket_color = Palette.GREEN
	resized.connect(queue_redraw)

func _draw() -> void:
	var s := size
	var l := bracket_len
	var w := bracket_width
	# alto-sx
	draw_line(Vector2(0, l), Vector2(0, 0), bracket_color, w)
	draw_line(Vector2(-w * 0.5, 0), Vector2(l, 0), bracket_color, w)
	# alto-dx
	draw_line(Vector2(s.x - l, 0), Vector2(s.x + w * 0.5, 0), bracket_color, w)
	draw_line(Vector2(s.x, 0), Vector2(s.x, l), bracket_color, w)
	# basso-dx
	draw_line(Vector2(s.x, s.y - l), Vector2(s.x, s.y), bracket_color, w)
	draw_line(Vector2(s.x + w * 0.5, s.y), Vector2(s.x - l, s.y), bracket_color, w)
	# basso-sx
	draw_line(Vector2(l, s.y), Vector2(-w * 0.5, s.y), bracket_color, w)
	draw_line(Vector2(0, s.y), Vector2(0, s.y - l), bracket_color, w)
