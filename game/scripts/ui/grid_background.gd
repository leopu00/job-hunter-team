class_name GridBackground
extends Control
## Sfondo "console": nero-lavanda pieno + griglia sottilissima del brand.

@export var bg_color := Color.TRANSPARENT
@export var spacing := 48.0

func _ready() -> void:
	if bg_color == Color.TRANSPARENT:
		bg_color = Palette.VOID
	resized.connect(queue_redraw)
	mouse_filter = Control.MOUSE_FILTER_IGNORE

func _draw() -> void:
	draw_rect(Rect2(Vector2.ZERO, size), bg_color)
	var x := spacing
	while x < size.x:
		draw_line(Vector2(x, 0), Vector2(x, size.y), Palette.GRID, 1.0)
		x += spacing
	var y := spacing
	while y < size.y:
		draw_line(Vector2(0, y), Vector2(size.x, y), Palette.GRID, 1.0)
		y += spacing
