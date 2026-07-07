class_name FurnitureNode
extends StaticBody2D
## Un mobile: collisione dal rect + visual 2.5D (faccia frontale + piano).
## In M1 il visual è disegnato proceduralmente; da M2 i kind principali
## vengono sostituiti da texture SVG mantenendo lo stesso ingombro.

const FRONT_H := 26.0  # altezza della faccia frontale (effetto 3/4)

## Colori per kind: [piano, fronte, dettaglio]
const KIND_COLORS := {
	"desk": [Color("#5e4a33"), Color("#453624"), Color("#16161d")],
	"desk_wide": [Color("#3a3a46"), Color("#26262f"), Color("#16161d")],
	"table_low": [Color("#4a3b29"), Color("#352a1d"), Color("#16161d")],
	"sofa": [Color("#333f5c"), Color("#252e44"), Color("#1a2032")],
	"armchair": [Color("#3c4866"), Color("#2a3349"), Color("#1a2032")],
	"shelf_h": [Color("#42342a"), Color("#2f251d"), Color("#5e4a33")],
	"shelf_v": [Color("#42342a"), Color("#2f251d"), Color("#5e4a33")],
	"coffee": [Color("#3a3a46"), Color("#26262f"), Color("#f5c518")],
	"lab_bench": [Color("#3f4652"), Color("#2b303a"), Color("#7fffb2")],
	"blackboard": [Color("#1d2420"), Color("#141a16"), Color("#7a7a96")],
	"lamp": [Color("#2e3d35"), Color("#1f2a24"), Color("#f5c518")],
	"plant": [Color("#2e6b47"), Color("#1e4a31"), Color("#3a2c20")],
}

## Sprite pittorici consegnati da dev1-art (gen-art); se assenti, blockout.
const GEN_ART := {
	"desk": "res://assets/gen-art/furniture/desk.png",
	"desk_wide": "res://assets/gen-art/furniture/desk_wide.png",
	"sofa": "res://assets/gen-art/furniture/sofa_bright.png",
	"armchair": "res://assets/gen-art/furniture/armchair.png",
	"table_low": "res://assets/gen-art/furniture/coffee_table.png",
	"shelf_h": "res://assets/gen-art/furniture/bookshelf.png",
	"coffee": "res://assets/gen-art/furniture/coffee_bar.png",
	"lab_bench": "res://assets/gen-art/furniture/lab_bench.png",
	"blackboard": "res://assets/gen-art/furniture/blackboard.png",
	"plant": "res://assets/gen-art/furniture/plant.png",
	"lamp": "res://assets/gen-art/furniture/floor_lamp.png",
	"corkboard": "res://assets/gen-art/furniture/corkboard.png",
}

var item: Dictionary
var _rect: Rect2
var _textured := false

func _init(p_item: Dictionary) -> void:
	item = p_item
	_rect = item["rect"]
	position = Vector2(_rect.get_center().x, _rect.end.y)

func _ready() -> void:
	var shape := CollisionShape2D.new()
	var box := RectangleShape2D.new()
	box.size = _rect.size
	shape.shape = box
	shape.position = Vector2(0, -_rect.size.y / 2.0)
	add_child(shape)
	# la texture vive in un CanvasItem separato dalle primitive del _draw
	# (mescolarle rompe il batching GLES3 su macOS: tutto bianco)
	var path: String = GEN_ART.get(item["kind"], "")
	if not path.is_empty() and ResourceLoader.exists(path):
		var tex: Texture2D = load(path)
		var spr := Sprite2D.new()
		spr.texture = tex
		spr.centered = false
		var s := _rect.size.x * 1.06 / tex.get_size().x
		spr.scale = Vector2(s, s)
		spr.offset = Vector2(-tex.get_size().x / 2.0, -tex.get_size().y + 10.0 / s)
		add_child(spr)
		_textured = true

func _draw() -> void:
	var kind: String = item["kind"]
	var cols: Array = KIND_COLORS.get(kind, [Palette.ROW, Palette.CARD, Palette.BORDER])
	var w := _rect.size.x
	var h := _rect.size.y
	var top := Rect2(Vector2(-w / 2.0, -h), Vector2(w, h - FRONT_H))
	var front := Rect2(Vector2(-w / 2.0, -FRONT_H), Vector2(w, FRONT_H))
	var rng := RandomNumberGenerator.new()
	rng.seed = hash(item["id"])
	# ombra a terra morbida (tre passate concentriche, non un rettangolo netto)
	for i in 3:
		var grow := 4.0 + i * 9.0
		draw_set_transform(Vector2(0, -2), 0.0, Vector2(1.0, 0.30))
		draw_circle(Vector2.ZERO, w * 0.52 + grow, Color(0, 0, 0, 0.10 - i * 0.03))
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	if _textured:
		return  # lo sprite pittorico (figlio) fa il resto
	draw_rect(top, cols[0])
	draw_rect(front, cols[1])
	# usura pittorica sul piano: chiazze e graffi seedati per mobile
	for i in 5:
		var px := rng.randf_range(top.position.x + 10, top.end.x - 10)
		var py := rng.randf_range(top.position.y + 8, top.end.y - 8)
		var dark := rng.randf() < 0.65
		var col := Color(0, 0, 0, rng.randf_range(0.06, 0.14)) if dark \
				else Color(1, 1, 1, rng.randf_range(0.03, 0.06))
		draw_set_transform(Vector2(px, py), rng.randf_range(0, TAU), Vector2(1.0, rng.randf_range(0.25, 0.6)))
		draw_circle(Vector2.ZERO, rng.randf_range(8.0, w * 0.16), col)
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	# la luce delle lampade accende il bordo alto del piano
	draw_line(top.position + Vector2(2, 1), Vector2(top.end.x - 2, top.position.y + 1),
			Color(1, 1, 0.9, 0.10), 2.0)
	# contorno rotto: due passate leggere e sfalsate, mai una linea pulita
	draw_rect(top, Color(0, 0, 0, 0.22), false, 1.5)
	draw_rect(top.grow(1.5), Color(0, 0, 0, 0.12), false, 1.0)
	# dettaglio semplice per riconoscere il mobile a colpo d'occhio
	match kind:
		"desk", "desk_wide":
			# monitor sul piano
			var mw := w * 0.32
			draw_rect(Rect2(Vector2(-mw / 2.0, -h + 8), Vector2(mw, 26)), cols[2])
			draw_rect(Rect2(Vector2(-mw / 2.0 + 3, -h + 11), Vector2(mw - 6, 20)), Color("#0e1a14"))
		"plant":
			draw_circle(Vector2(0, -h - 10), w * 0.42, cols[0])
			draw_circle(Vector2(-8, -h - 20), w * 0.3, Color("#38835a"))
			draw_circle(Vector2(9, -h - 16), w * 0.28, Color("#256744"))
		"lamp":
			draw_line(Vector2(0, -FRONT_H), Vector2(0, -h - 46), Color("#3a3a46"), 3.0)
			draw_circle(Vector2(0, -h - 52), 12, cols[2])
		"blackboard":
			draw_rect(Rect2(Vector2(-w / 2.0 + 5, -h + 6), Vector2(w - 10, h - FRONT_H - 12)), Color("#0f1512"))
		"coffee":
			draw_rect(Rect2(Vector2(-14, -h + 6), Vector2(28, 22)), Color("#16161d"))
			draw_circle(Vector2(0, -h + 40), 4, cols[2])
		"lab_bench":
			for i in 3:
				draw_rect(Rect2(Vector2(-w / 2.0 + 26 + i * 34, -h + 10), Vector2(8, 18)),
						Color(Palette.MINT.r, Palette.MINT.g, Palette.MINT.b, 0.5))
		"shelf_h", "shelf_v":
			var inner := top.grow(-6)
			draw_rect(inner, cols[2])
			draw_rect(inner, Color(0, 0, 0, 0.4), false, 1.0)
