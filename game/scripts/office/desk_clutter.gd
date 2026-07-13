class_name DeskClutter
extends Node2D
## Micro-prop sul piano delle scrivanie ("fate elementi grafici SOPRA
## altri elementi grafici", ciclo grafica 11/07): tazza, post-it,
## cancelleria, cornice foto, lampada. Scelta e posa DETERMINISTICHE
## per postazione (seed da reparto+indice): gli screenshot restano
## confrontabili tra run e nessun mobile "cambia arredo" al riavvio.
## Ogni prop usa il PNG di gen-art appena esiste; finché manca viene
## disegnato in blockout procedurale, così il piano è vivo comunque.
##
## GLES3: i PNG stanno su Sprite2D figli, il blockout su _draw di self —
## mai texture e primitive sullo stesso CanvasItem.

const DIR := "res://assets/gen-art/furniture/"
const PROPS := [
	{"kind": "mp_mug", "w": 24.0},
	{"kind": "mp_postits", "w": 28.0},
	{"kind": "mp_stationery", "w": 32.0},
	{"kind": "mp_photo_frame", "w": 22.0},
	{"kind": "nc_desk_lamp", "w": 36.0},  # di dev-art, dedup in chat
]
## Slot sul piano (frazioni della size del desk), scelti lontani
## dall'angolo della PaperPile (+0.26) e dal centro (monitor).
const SLOTS := [Vector2(-0.30, 0.12), Vector2(-0.06, -0.24), Vector2(0.33, -0.20)]

var _blockout: Array = []  # [{kind, pos}] dei prop senza texture

func _init(desk_rect: Rect2, seed_text: String) -> void:
	position = desk_rect.get_center()
	z_index = 1  # i prop stanno SUL piano, sopra la texture del mobile
	var rng := RandomNumberGenerator.new()
	rng.seed = hash(seed_text)
	var pool := PROPS.duplicate()
	var slots := SLOTS.duplicate()
	var n := rng.randi_range(1, 3)
	for i in n:
		var p: Dictionary = pool.pop_at(rng.randi() % pool.size())
		var slot: Vector2 = slots.pop_at(rng.randi() % slots.size())
		var pos := Vector2(desk_rect.size.x * slot.x, desk_rect.size.y * slot.y)
		var path: String = DIR + p["kind"] + ".png"
		if ResourceLoader.exists(path):
			var tex: Texture2D = load(path)
			var spr := Sprite2D.new()
			spr.texture = tex
			spr.position = pos
			spr.scale = Vector2.ONE * (p["w"] / tex.get_width())
			add_child(spr)
		else:
			_blockout.append({"kind": p["kind"], "pos": pos})

## Blockout: forme minime finché il PNG non arriva da dev-art.
func _draw() -> void:
	for b in _blockout:
		var o: Vector2 = b["pos"]
		match b["kind"]:
			"mp_mug":
				draw_circle(o, 7.0, Color(0.85, 0.42, 0.30))
				draw_circle(o, 4.5, Color(0.32, 0.20, 0.14))
				draw_arc(o + Vector2(8, 0), 4.0, -PI / 2, PI / 2, 10,
						Color(0.85, 0.42, 0.30), 2.0)
			"mp_postits":
				for j in 3:
					var c: Color = [Color(0.98, 0.88, 0.35), Color(0.95, 0.60, 0.70),
							Color(0.60, 0.88, 0.70)][j]
					var off := Vector2(j * 7 - 7, sin(j * 2.1) * 4.0)
					draw_rect(Rect2(o + off - Vector2(4, 4), Vector2(8, 8)), c)
			"mp_stationery":
				draw_rect(Rect2(o - Vector2(5, 7), Vector2(10, 12)),
						Color(0.25, 0.28, 0.36))
				for j in 3:
					var x := o.x - 3.0 + j * 3.0
					draw_line(Vector2(x, o.y - 6), Vector2(x - 1, o.y - 13),
							[Color(0.85, 0.75, 0.30), Color(0.40, 0.60, 0.90),
							Color(0.80, 0.35, 0.30)][j], 1.6)
			"mp_photo_frame":
				draw_rect(Rect2(o - Vector2(6, 8), Vector2(12, 14)),
						Color(0.90, 0.88, 0.82))
				draw_rect(Rect2(o - Vector2(4, 6), Vector2(8, 9)),
						Color(0.45, 0.65, 0.85))
			"nc_desk_lamp":
				draw_circle(o + Vector2(0, 4), 5.0, Color(0.22, 0.24, 0.30))
				draw_line(o + Vector2(0, 3), o + Vector2(6, -10),
						Color(0.22, 0.24, 0.30), 2.0)
				draw_circle(o + Vector2(8, -11), 4.0, Color(0.95, 0.85, 0.55))
