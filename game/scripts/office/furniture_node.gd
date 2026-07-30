class_name FurnitureNode
extends StaticBody2D
## Un mobile: collisione dal rect + visual 2.5D (faccia frontale + piano).
## In M1 il visual è disegnato proceduralmente; da M2 i kind principali
## vengono sostituiti da texture SVG mantenendo lo stesso ingombro.

const FRONT_H := 26.0  # altezza della faccia frontale (effetto 3/4)

## Colori per kind: [piano, fronte, dettaglio]. Solo i kind DAVVERO istanziati
## da FurnitureDefs/DepartmentDefs: una chiave in piu' e' una mappa che mente su
## cosa esiste in ufficio, e tiene in vita l'arte che le sta dietro. Il gate e'
## `tools/asset_orphan_audit.py --keys`, dentro `tools/run.sh test`.
## I kind senza voce qui cadono sul default di _draw (Palette.ROW/CARD/BORDER).
const KIND_COLORS := {
	"printer": [Color("#3a3a46"), Color("#26262f"), Color("#b8b8d0")],
	"table_low": [Color("#4a3b29"), Color("#352a1d"), Color("#16161d")],
	"shelf_h": [Color("#42342a"), Color("#2f251d"), Color("#5e4a33")],
	"lab_bench": [Color("#3f4652"), Color("#2b303a"), Color("#7fffb2")],
	"blackboard": [Color("#1d2420"), Color("#141a16"), Color("#7a7a96")],
	"lamp": [Color("#2e3d35"), Color("#1f2a24"), Color("#f5c518")],
	"plant": [Color("#2e6b47"), Color("#1e4a31"), Color("#3a2c20")],
}

## Sprite pittorici consegnati da dev1-art (gen-art); se assenti, blockout.
##
## Serve solo ai kind il cui file NON si chiama come loro: gli altri li trova
## gia' il fallback "nome file = kind" piu' sotto (riga ~150). Stessa regola di
## KIND_COLORS: qui dentro solo kind istanziati, o l'audit degli asset diventa
## cieco proprio sull'arte che questa mappa trattiene.
const GEN_ART := {
	"table_low": "res://assets/gen-art/furniture/coffee_table.png",
	"shelf_h": "res://assets/gen-art/furniture/bookshelf.png",
	"lamp": "res://assets/gen-art/furniture/floor_lamp.png",
	"lab_bench": "res://assets/gen-art/furniture/lab_bench.png",
	"blackboard": "res://assets/gen-art/furniture/blackboard.png",
	"plant": "res://assets/gen-art/furniture/plant.png",
	"corkboard": "res://assets/gen-art/furniture/corkboard.png",
	"printer": "res://assets/gen-art/furniture/printer.png",
}

var item: Dictionary
var _rect: Rect2
var _textured := false

## Postazioni registrate da office.gd ("dept:index" → nodo): la scena
## scambia la texture vuota/occupata quando l'agente si siede (ordine
## Leone 04:2x: l'agente seduto va GENERATO nell'arte, non composto).
static var desks: Dictionary = {}
## Sedie frontali separate: le texture *_down mostrano il fronte del desk
## ma, attraverso il vano centrale, la sedia deve esistere dietro l'agente.
## Registry per non duplicarla quando il backend riassegna una postazione.
static var front_chairs: Dictionary = {}
var _sprite: Sprite2D
var _base_tex: Texture2D
var _seated_tex: Texture2D
var _occupied_material: ShaderMaterial

func has_seated_art() -> bool:
	return _seated_tex != null

func set_occupied(on: bool) -> void:
	if _sprite and _seated_tex:
		if _occupied_material:
			_sprite.texture = _base_tex
			_occupied_material.set_shader_parameter("occupied", on)
		else:
			_sprite.texture = _seated_tex if on else _base_tex

## Lampo di lavoro (react_to_work): quando l'agente è dipinto nella
## texture del desk il rig è nascosto — il segnale del lavoro reale
## deve pulsare sul mobile, stessa doppia pulsazione del rig.
func flash() -> void:
	if _sprite == null:
		return
	var tw := create_tween()
	for _i in 2:
		tw.tween_property(_sprite, "modulate", Color(0.72, 1.3, 1.05), 0.16)
		tw.tween_property(_sprite, "modulate", Color.WHITE, 0.45)

func _init(p_item: Dictionary) -> void:
	item = p_item
	_rect = item["rect"]
	position = Vector2(_rect.get_center().x, _rect.end.y)

func _ready() -> void:
	if not bool(item.get("non_blocking", false)):
		var shape := CollisionShape2D.new()
		var box := RectangleShape2D.new()
		box.size = _rect.size
		shape.shape = box
		shape.position = Vector2(0, -_rect.size.y / 2.0)
		add_child(shape)
	# la texture vive in un CanvasItem separato dalle primitive del _draw
	# (mescolarle rompe il batching GLES3 su macOS: tutto bianco)
	#
	# Arredi ORIENTATI (recensione 2): se l'item porta un "facing", prima si
	# cerca la variante con suffisso _down/_side/_up (left = _side flippata,
	# stessa regola degli sprite agenti); senza variante si ricade sul kind.
	var kind_str: String = item["kind"]
	# tex_facing scollega il VISUAL dal verso dell'agente (seat-audit
	# 04:0x: alcune texture _down mostrano il FRONTE del desk — l'agente
	# a nord ci finiva seduto sopra i monitor; col retro _up torna tutto)
	var facing: String = item.get("tex_facing", item.get("facing", ""))
	# Alcuni arredi decorativi condividono lo stesso asset ma richiedono una
	# composizione specchiata (per esempio le due lavagne del Capitano).
	var flip_h := bool(item.get("flip_h", false))
	var path := ""
	if facing != "":
		var suffix := "down"
		match facing:
			"up": suffix = "up"
			# Diagonale bassa generata apposta per gli spicchi ore 4/8.
			# La sorgente guarda verso down-right; down-left è lo specchio.
			"down_right": suffix = "diag_down"
			"down_left":
				suffix = "diag_down"
				flip_h = true
			# La sorgente _side ha la sedia a DESTRA e quindi accoglie un
			# agente che guarda a sinistra. Per il verso opposto si specchia
			# l'intera postazione. La vecchia mappatura era invertita: sedia
			# e corpo finivano ai lati opposti della scrivania.
			"left": suffix = "side"
			"right":
				suffix = "side"
				flip_h = true
		var oriented := "res://assets/gen-art/furniture/%s_%s.png" % [kind_str, suffix]
		if ResourceLoader.exists(oriented) and load(oriented) != null:
			path = oriented
	if path.is_empty():
		path = GEN_ART.get(kind_str, "")
	if path.is_empty():
		# fallback generico: gli asset consegnati con nome file = kind
		# (piante, sala relax, …) si agganciano senza toccare la mappa
		var direct := "res://assets/gen-art/furniture/%s.png" % kind_str
		if ResourceLoader.exists(direct):
			path = direct
	# ResourceLoader.exists() è true anche quando esiste solo il .import senza
	# il binario importato: load() torna null → serve il guard, altrimenti si
	# ricade con grazia sul disegno procedurale in _draw().
	var tex: Texture2D = load(path) if (not path.is_empty() and ResourceLoader.exists(path)) else null
	if tex != null:
		var spr := Sprite2D.new()
		spr.texture = tex
		spr.centered = false
		var s := _rect.size.x * 1.06 / tex.get_size().x
		spr.scale = Vector2(-s if flip_h else s, s)
		spr.offset = Vector2(-tex.get_size().x / 2.0, -tex.get_size().y + 10.0 / s)
		if flip_h:
			# con scale.x negativa l'offset va specchiato per restare centrato
			spr.offset.x = -tex.get_size().x / 2.0
		add_child(spr)
		_textured = true
		_sprite = spr
		_base_tex = tex
		# Nello spicchio ore 6 il rig frontale deve stare davanti alla parte
		# alta del desk (testa/mani visibili), ma dietro alla fascia bassa
		# (gambe nascoste dal mobile). Un secondo pass raster, ritagliato via
		# shader, crea questa maschera senza congelare l'agente nella texture.
		if item.has("front_occlusion"):
			_add_front_occluder(spr, tex, float(item["front_occlusion"]))
		# Variante con agente+sedia+desk in un solo elemento grafico. Un path
		# esplicito conserva i prototipi già approvati; altrimenti ogni vista
		# cerca prima la nuova arte v2 e poi l'eventuale variante legacy.
		var seated_path := str(item.get("seated_art", ""))
		if seated_path.is_empty():
			var v2_path := path.replace(".png", "_seated_v2.png")
			var legacy_path := path.replace(".png", "_seated.png")
			if ResourceLoader.exists(v2_path):
				seated_path = v2_path
			elif ResourceLoader.exists(legacy_path):
				seated_path = legacy_path
		if not seated_path.is_empty() and ResourceLoader.exists(seated_path):
			var st: Texture2D = load(seated_path)
			if st != null:
				if st.get_size() == tex.get_size():
					_seated_tex = st
					if item.has("occupied_person_scale"):
						_add_scaled_occupant_material(spr, tex, st)
				else:
					push_warning("Seated art canvas mismatch: %s is %s, base %s is %s; using dynamic rig." % [
						seated_path, st.get_size(), path, tex.get_size(),
					])

## Alcune illustrazioni composite hanno il tavolo già proporzionato ma la
## persona di una vista specifica troppo grande. Lo shader confronta base e
## variante seduta, isola i pixel cambiati e scala soltanto quella differenza:
## il mobile resta perfettamente immobile quando l'agente si siede o si alza.
func _add_scaled_occupant_material(spr: Sprite2D, base: Texture2D,
		seated: Texture2D) -> void:
	var shader := Shader.new()
	shader.code = """
shader_type canvas_item;
uniform sampler2D seated_texture : source_color;
uniform bool occupied = false;
uniform float person_scale = 1.0;
uniform vec2 person_pivot = vec2(0.5, 0.5);

void fragment() {
	vec4 base_pixel = texture(TEXTURE, UV);
	if (!occupied) {
		COLOR = base_pixel;
	} else {
		vec2 source_uv = (UV - person_pivot) / person_scale + person_pivot;
		if (source_uv.x < 0.0 || source_uv.x > 1.0
				|| source_uv.y < 0.0 || source_uv.y > 1.0) {
			COLOR = base_pixel;
		} else {
			vec4 seated_pixel = texture(seated_texture, source_uv);
			vec4 source_base = texture(TEXTURE, source_uv);
			float color_delta = max(max(abs(seated_pixel.r - source_base.r),
					abs(seated_pixel.g - source_base.g)),
					abs(seated_pixel.b - source_base.b));
			float alpha_delta = abs(seated_pixel.a - source_base.a);
			float changed = smoothstep(0.025, 0.085,
					max(color_delta, alpha_delta));
			float mask = changed * seated_pixel.a;
			COLOR = mix(base_pixel, seated_pixel, mask);
		}
	}
}
"""
	_occupied_material = ShaderMaterial.new()
	_occupied_material.shader = shader
	_occupied_material.set_shader_parameter("seated_texture", seated)
	_occupied_material.set_shader_parameter("person_scale",
			clampf(float(item["occupied_person_scale"]), 0.5, 1.0))
	_occupied_material.set_shader_parameter("person_pivot",
			item.get("occupied_person_pivot", Vector2(0.5, 0.5)))
	spr.material = _occupied_material

func _add_front_occluder(source: Sprite2D, tex: Texture2D, cut: float) -> void:
	var overlay := Sprite2D.new()
	overlay.name = "FrontOccluder"
	overlay.texture = tex
	overlay.centered = source.centered
	overlay.offset = source.offset
	overlay.scale = source.scale
	# Va aggiunto al contenitore y-sort come sibling del rig: come child del
	# mobile il ramo veniva composto tutto insieme prima dell'agente.
	# z assoluto: deve superare anche il rig, che è un sibling del mobile
	# nel contenitore y-sortato, non soltanto gli altri child del mobile.
	overlay.z_as_relative = false
	overlay.z_index = 100
	var shader := Shader.new()
	shader.code = """
shader_type canvas_item;
uniform float front_cut = 0.72;
void fragment() {
	vec4 pixel = texture(TEXTURE, UV);
	if (UV.y < front_cut) { discard; }
	COLOR = pixel * COLOR;
}
"""
	var material := ShaderMaterial.new()
	material.shader = shader
	material.set_shader_parameter("front_cut", clampf(cut, 0.0, 1.0))
	overlay.material = material
	var layer := get_parent()
	layer.add_child(overlay)
	overlay.global_position = source.global_position

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
	if kind.begins_with("desk"):
		# monitor sul piano (tutte le varianti desk_a..f e la wide)
		var mw := w * 0.32
		draw_rect(Rect2(Vector2(-mw / 2.0, -h + 8), Vector2(mw, 26)), cols[2])
		draw_rect(Rect2(Vector2(-mw / 2.0 + 3, -h + 11), Vector2(mw - 6, 20)), Color("#0e1a14"))
		return
	match kind:
		"printer":
			# vassoio carta + spia di stato
			draw_rect(Rect2(Vector2(-w * 0.28, -h + 6), Vector2(w * 0.56, 12)), Color("#e8e8f0"))
			draw_circle(Vector2(w * 0.30, -FRONT_H - 8), 3.5, Palette.GREEN)
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
