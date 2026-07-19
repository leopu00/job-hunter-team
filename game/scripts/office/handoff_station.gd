class_name HandoffStation
extends Node2D
## Tavolo fisico di passaggio tra reparti. Ogni anello della pipeline ha un
## mobile distinto e riconoscibile; PaperPile dispone le risme sul piano,
## mai più direttamente sul pavimento.

const TABLE_WIDTH := 220.0
const PILE_OFFSET := Vector2(0, -78)
const TABLE_TEXTURES := {
	"scout": "res://assets/gen-art/handoff/handoff_table_scout.png",
	"analisti": "res://assets/gen-art/handoff/handoff_table_analisti.png",
	"scorer": "res://assets/gen-art/handoff/handoff_table_scorer.png",
	"scrittori": "res://assets/gen-art/handoff/handoff_table_scrittori.png",
}

var dept := ""
var destination := ""
var color := Color.WHITE
var _font: Font
var _table: Sprite2D

func _init(p_dept: String, p_position: Vector2, p_destination: String,
		p_color: Color) -> void:
	dept = p_dept
	destination = p_destination
	color = p_color
	position = p_position

func _ready() -> void:
	_font = load(TerminalTheme.FONT_MEDIUM)
	var path: String = TABLE_TEXTURES.get(dept, "")
	if not path.is_empty() and ResourceLoader.exists(path):
		var texture: Texture2D = load(path)
		if texture:
			_table = Sprite2D.new()
			_table.texture = texture
			_table.centered = false
			var scale_factor := TABLE_WIDTH / texture.get_width()
			_table.scale = Vector2.ONE * scale_factor
			_table.offset = Vector2(-texture.get_width() / 2.0, -texture.get_height())
			add_child(_table)
	queue_redraw()

func pile_spot() -> Vector2:
	return position + PILE_OFFSET

func _draw() -> void:
	# Ombra sobria a terra; il mobile pittorico è un child separato per non
	# mescolare texture e primitive sullo stesso CanvasItem GLES3.
	draw_set_transform(Vector2(0, 4), 0.0, Vector2(1.0, 0.30))
	draw_circle(Vector2.ZERO, 96.0, Color(0, 0, 0, 0.18))
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	if _font:
		var text := "%s  →  %s" % [dept.to_upper(), destination.to_upper()]
		var w := _font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, 10).x
		draw_rect(Rect2(Vector2(-w / 2.0 - 5, 8), Vector2(w + 10, 16)),
				Color(0.04, 0.04, 0.06, 0.94))
		draw_rect(Rect2(Vector2(-w / 2.0 - 5, 8), Vector2(w + 10, 16)),
				color.darkened(0.12), false, 1.2)
		draw_string(_font, Vector2(-w / 2.0, 20), text,
				HORIZONTAL_ALIGNMENT_LEFT, -1, 10, color.lightened(0.18))
