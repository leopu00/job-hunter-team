class_name OfficeFloor
extends Node2D
## Pavimento pittorico alla Disco Elysium (ANALISI-GIOCHI §6): niente
## riempimenti uniformi — macchie tonali larghe, pennellate, sporco,
## sentieri d'usura, riflessi freddi sotto i vetri. Tutto procedurale e
## seedato (deterministico). Le pareti di vetro con glow restano l'identità
## della box. Disegnato sotto al layer Y-sort.

const GLASS_CORE := Color("#bfe3ff", 0.9)
const SEED := 20260707
## Texture dipinte consegnate da dev1-art; se assenti, blockout procedurale.
const FLOOR_TEX := "res://assets/gen-art/floor/floor_main.png"
const WALL_TEX := "res://assets/gen-art/environment/wall_main.png"
const WALL_H := 120.0  # altezza a schermo della fascia muro nord
const GLASS_TEX := "res://assets/gen-art/environment/glass_box.png"
const GLASS_H := 72.0  # vetrata sopra il parapetto nord
const RUG_TEX := "res://assets/gen-art/furniture/rug.png"

## True se il pavimento dipinto è stato caricato davvero; altrimenti _draw
## disegna il blockout procedurale.
var _floor_textured := false

## exists() è true anche col solo file .import (senza binario importato):
## load() torna null. Questo helper carica solo se la texture è reale.
func _load_tex(path: String) -> Texture2D:
	return load(path) if ResourceLoader.exists(path) else null

## La texture va in un CanvasItem SEPARATO dalle primitive: mescolare
## draw_texture_rect con molte draw_line/draw_rect nello stesso item rompe
## il batching GLES3 su macOS (tutto l'item rende bianco).
func _ready() -> void:
	var world := FurnitureDefs.WORLD
	var floor_rect := FurnitureDefs.FLOOR
	var ext := Polygon2D.new()
	ext.polygon = PackedVector2Array([
		world.position, Vector2(world.end.x, world.position.y),
		world.end, Vector2(world.position.x, world.end.y),
	])
	ext.color = Palette.VOID
	ext.show_behind_parent = true
	add_child(ext)
	var base := Polygon2D.new()
	base.polygon = PackedVector2Array([
		floor_rect.position, Vector2(floor_rect.end.x, floor_rect.position.y),
		floor_rect.end, Vector2(floor_rect.position.x, floor_rect.end.y),
	])
	base.color = Color("#101016")
	base.show_behind_parent = true
	add_child(base)
	var floor_tex := _load_tex(FLOOR_TEX)
	if floor_tex != null:
		_floor_textured = true
		var spr := Sprite2D.new()
		spr.texture = floor_tex
		spr.centered = false
		spr.position = floor_rect.position
		spr.scale = floor_rect.size / floor_tex.get_size()
		spr.show_behind_parent = true
		add_child(spr)
	var wtex := _load_tex(WALL_TEX)
	if wtex != null:
		# fascia muro nord (faccia interna, battiscopa alla base sul pavimento)
		var wall := Sprite2D.new()
		wall.texture = wtex
		wall.centered = false
		wall.texture_repeat = CanvasItem.TEXTURE_REPEAT_ENABLED
		wall.region_enabled = true
		var wall_scale := WALL_H / wtex.get_size().y
		wall.region_rect = Rect2(0, 0, floor_rect.size.x / wall_scale, wtex.get_size().y)
		wall.scale = Vector2(wall_scale, wall_scale)
		wall.position = Vector2(floor_rect.position.x, floor_rect.position.y - WALL_H)
		wall.show_behind_parent = true
		add_child(wall)
	var gtex := _load_tex(GLASS_TEX)
	if gtex != null:
		# vetrata della box sopra il parapetto nord (the-box: vetro su struttura bassa)
		var band := Sprite2D.new()
		band.texture = gtex
		band.centered = false
		band.position = Vector2(floor_rect.position.x, floor_rect.position.y - WALL_H - GLASS_H)
		band.scale = Vector2(floor_rect.size.x, GLASS_H) / gtex.get_size()
		band.show_behind_parent = true
		add_child(band)
	var rug_tex := _load_tex(RUG_TEX)
	if rug_tex != null:
		# Tappeto dell'area comune trasferita nella vecchia zona Scorer.
		var rug := Sprite2D.new()
		rug.texture = rug_tex
		# Centro visivo dell'angolo comune: tavolino sul tappeto, figure di
		# servizio a sinistra e divanetto del Mentor sul bordo destro.
		rug.position = Vector2(2620, 1190)
		rug.scale = Vector2(0.68, 0.68)
		rug.show_behind_parent = true
		add_child(rug)
func _draw() -> void:
	var world := FurnitureDefs.WORLD
	var floor_rect := FurnitureDefs.FLOOR
	var rng := RandomNumberGenerator.new()
	rng.seed = SEED

	if not _floor_textured:
		_procedural_floor(rng, floor_rect)

	_floor_accents(rng, floor_rect)

	# maschera: l'esterno resta void anche dove le macchie sbordano
	draw_rect(Rect2(world.position, Vector2(world.size.x, floor_rect.position.y - world.position.y)), Palette.VOID)
	draw_rect(Rect2(Vector2(world.position.x, floor_rect.end.y), Vector2(world.size.x, world.end.y - floor_rect.end.y)), Palette.VOID)
	draw_rect(Rect2(world.position, Vector2(floor_rect.position.x - world.position.x, world.size.y)), Palette.VOID)
	draw_rect(Rect2(Vector2(floor_rect.end.x, world.position.y), Vector2(world.end.x - floor_rect.end.x, world.size.y)), Palette.VOID)

	# alone morbido attorno all'ologramma (luce verde sul pavimento)
	var holo_c := FurnitureDefs.get_rect("hologram").get_center()
	for i in 5:
		var r := 90.0 + i * 34.0
		draw_circle(holo_c, r, Color(Palette.GREEN.r, Palette.GREEN.g, Palette.GREEN.b, 0.016))

	# pareti di vetro perimetrali: tre passate per il glow ciano
	_glass_rect(floor_rect, 1.0)

	# Vetrate dei reparti: un unico perimetro anche per il lab Analisti.
	for r in DepartmentDefs.GLASS_WALLS:
		var g: Rect2 = r
		if g.size.x >= g.size.y:
			_glass_line(Vector2(g.position.x, g.get_center().y),
					Vector2(g.end.x, g.get_center().y), 0.55)
		else:
			_glass_line(Vector2(g.get_center().x, g.position.y),
					Vector2(g.get_center().x, g.end.y), 0.55)

## Blockout pittorico procedurale (usato solo senza texture gen-art).
func _procedural_floor(rng: RandomNumberGenerator, floor_rect: Rect2) -> void:
	# 1. macchie tonali larghe (valore prima del colore: variazioni sotto il 6%)
	var hues := [
		Color("#1a1c26"), Color("#201b16"), Color("#171d19"),
		Color("#13141e"), Color("#1e1e28"),
	]
	for i in 46:
		var c: Color = hues[rng.randi() % hues.size()]
		c.a = rng.randf_range(0.05, 0.10)
		_blotch(rng, floor_rect, c, rng.randf_range(180.0, 520.0))

	# 2. macchie medie
	for i in 90:
		var c2: Color = hues[rng.randi() % hues.size()]
		c2.a = rng.randf_range(0.04, 0.08)
		_blotch(rng, floor_rect, c2, rng.randf_range(50.0, 170.0))

	# 3. sporco e chiazze piccole, più scure
	for i in 150:
		var c3 := Color(0, 0, 0, rng.randf_range(0.05, 0.12))
		_blotch(rng, floor_rect, c3, rng.randf_range(6.0, 28.0))

	# 4. pennellate larghe chiare (sheen del cemento lucidato)
	for i in 34:
		var y := rng.randf_range(floor_rect.position.y + 60, floor_rect.end.y - 60)
		var x := rng.randf_range(floor_rect.position.x + 60, floor_rect.end.x - 400)
		var w := rng.randf_range(180.0, 460.0)
		var h := rng.randf_range(6.0, 18.0)
		draw_set_transform(Vector2(x, y), rng.randf_range(-0.06, 0.06), Vector2.ONE)
		draw_rect(Rect2(Vector2.ZERO, Vector2(w, h)),
				Color(0.24, 0.25, 0.34, rng.randf_range(0.025, 0.05)))
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)

	# 5. sentieri d'usura lungo i percorsi principali (entrata→ologramma→caffè)
	var paths := [
		[Vector2(830, 1230), Vector2(1290, 900)],
		[Vector2(1290, 900), Vector2(1480, 330)],
		[Vector2(660, 800), Vector2(1180, 830)],
		[Vector2(1420, 900), Vector2(2080, 1030)],
	]
	for p in paths:
		var a: Vector2 = p[0]
		var b: Vector2 = p[1]
		for k in 26:
			var t := k / 25.0
			var pos := a.lerp(b, t) + Vector2(rng.randf_range(-26, 26), rng.randf_range(-18, 18))
			draw_set_transform(pos, 0.0, Vector2(1.0, 0.45))
			draw_circle(Vector2.ZERO, rng.randf_range(28.0, 58.0), Color(0, 0, 0, 0.035))
		draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)

## Accenti comuni sopra il pavimento (dipinto o procedurale).
func _floor_accents(rng: RandomNumberGenerator, floor_rect: Rect2) -> void:
	# griglia piastrelle: sottile, con jitter (mai linee perfette)
	var step := 64.0
	var x := floor_rect.position.x + step
	while x < floor_rect.end.x:
		var jx := x + rng.randf_range(-1.5, 1.5)
		draw_line(Vector2(jx, floor_rect.position.y), Vector2(jx, floor_rect.end.y),
				Color(1, 1, 1, rng.randf_range(0.010, 0.026)), 1.0)
		x += step
	var y2 := floor_rect.position.y + step
	while y2 < floor_rect.end.y:
		var jy := y2 + rng.randf_range(-1.5, 1.5)
		draw_line(Vector2(floor_rect.position.x, jy), Vector2(floor_rect.end.x, jy),
				Color(1, 1, 1, rng.randf_range(0.010, 0.026)), 1.0)
		y2 += step

	# riflessi freddi del vetro sul pavimento (strisce verticali morbide)
	for i in 26:
		var rx := rng.randf_range(floor_rect.position.x + 20, floor_rect.end.x - 20)
		var top_h := rng.randf_range(40.0, 110.0)
		draw_rect(Rect2(Vector2(rx, floor_rect.position.y + 2), Vector2(rng.randf_range(4, 14), top_h)),
				Color(Palette.BLUE.r, Palette.BLUE.g, Palette.BLUE.b, rng.randf_range(0.02, 0.05)))
		var bx := rng.randf_range(floor_rect.position.x + 20, floor_rect.end.x - 20)
		var bot_h := rng.randf_range(30.0, 90.0)
		draw_rect(Rect2(Vector2(bx, floor_rect.end.y - 2 - bot_h), Vector2(rng.randf_range(4, 14), bot_h)),
				Color(Palette.BLUE.r, Palette.BLUE.g, Palette.BLUE.b, rng.randf_range(0.015, 0.04)))

## Macchia ellittica ruotata e schiacciata (pennellata larga).
func _blotch(rng: RandomNumberGenerator, area: Rect2, color: Color, radius: float) -> void:
	var pos := Vector2(
		rng.randf_range(area.position.x + 30, area.end.x - 30),
		rng.randf_range(area.position.y + 30, area.end.y - 30))
	draw_set_transform(pos, rng.randf_range(0, TAU), Vector2(1.0, rng.randf_range(0.3, 0.7)))
	draw_circle(Vector2.ZERO, radius, color)
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)

func _glass_rect(r: Rect2, intensity: float) -> void:
	var pts := [
		r.position, Vector2(r.end.x, r.position.y), r.end,
		Vector2(r.position.x, r.end.y), r.position,
	]
	for i in 4:
		_glass_line(pts[i], pts[i + 1], intensity)

func _glass_line(a: Vector2, b: Vector2, intensity: float) -> void:
	draw_line(a, b, Color(Palette.BLUE.r, Palette.BLUE.g, Palette.BLUE.b, 0.10 * intensity), 14.0)
	draw_line(a, b, Color(Palette.BLUE.r, Palette.BLUE.g, Palette.BLUE.b, 0.30 * intensity), 5.0)
	draw_line(a, b, Color(GLASS_CORE.r, GLASS_CORE.g, GLASS_CORE.b, GLASS_CORE.a * intensity), 1.6)
