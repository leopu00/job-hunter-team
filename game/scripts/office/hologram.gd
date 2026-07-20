class_name Hologram
extends Node2D
## L'ologramma verde al centro della box: pedana scura + globo wireframe
## che pulsa e ruota (il "cuore" della ricerca, come in the-box.png).

const TEX := "res://assets/gen-art/furniture/hologram.png"

var _rect: Rect2
var _t := 0.0
var _textured := false
var _redraw_acc := 0.0

func _init(rect: Rect2) -> void:
	_rect = rect
	# origine sul fondo per lo Y-sort
	position = Vector2(rect.get_center().x, rect.end.y)

func _ready() -> void:
	# Con la camera libera l'ologramma è spesso fuori inquadratura: lì
	# l'animazione si ferma del tutto (niente _draw, niente _process).
	var vis := VisibleOnScreenNotifier2D.new()
	vis.rect = Rect2(-_rect.size.x, -_rect.size.y * 3.0,
			_rect.size.x * 2.0, _rect.size.y * 3.5)
	vis.screen_entered.connect(set_process.bind(true))
	vis.screen_exited.connect(set_process.bind(false))
	add_child(vis)
	# exists() è true col solo .import: senza binario load() torna null e va
	# saltata la base pittorica (resta l'animazione procedurale del _draw).
	var tex: Texture2D = load(TEX) if ResourceLoader.exists(TEX) else null
	if tex == null:
		return
	# base pittorica (gen-art) in un CanvasItem separato; l'animazione
	# procedurale del _draw le pulsa sopra
	var spr := Sprite2D.new()
	spr.texture = tex
	spr.centered = false
	var s := _rect.size.x * 1.06 / tex.get_size().x
	spr.scale = Vector2(s, s)
	spr.offset = Vector2(-tex.get_size().x / 2.0, -tex.get_size().y)
	spr.show_behind_parent = true
	add_child(spr)
	_textured = true

func _process(delta: float) -> void:
	# 20 Hz bastano: meridiani lenti (0.5 giri/s) e battito morbido. A pieno
	# framerate erano 4+ draw_arc ri-tessellati 60 volte al secondo.
	_t += delta
	_redraw_acc += delta
	if _redraw_acc >= 0.05:
		_redraw_acc = 0.0
		queue_redraw()

func _draw() -> void:
	var w := _rect.size.x
	if _textured:
		# solo gli accenti animati sopra il dipinto: meridiani e battito
		var pulse2 := 0.5 + 0.5 * sin(_t * 2.2)
		var c2 := Vector2(0, -_rect.size.x * 1.06 / 520.0 * 640.0 * 0.62)
		var r2 := w * 0.30
		var g2 := Palette.GREEN
		for k in 3:
			var phase2 := fmod(_t * 0.5 + k / 3.0, 1.0)
			var sx2: float = abs(cos(phase2 * PI))
			draw_set_transform(c2, 0.0, Vector2(sx2 * 0.95 + 0.05, 1.0))
			draw_arc(Vector2.ZERO, r2, 0, TAU, 48,
					Color(g2.r, g2.g, g2.b, 0.20 + 0.18 * pulse2), 1.2)
		draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
		draw_circle(c2, r2 * 0.08,
				Color(Palette.MINT.r, Palette.MINT.g, Palette.MINT.b, 0.35 + 0.3 * pulse2))
		return
	var pedestal_c := Vector2(0, -18)
	# pedana ellittica scura con anello verde
	draw_set_transform(pedestal_c, 0.0, Vector2(1.0, 0.42))
	draw_circle(Vector2.ZERO, w * 0.46, Palette.CARD)
	draw_arc(Vector2.ZERO, w * 0.46, 0, TAU, 48, Palette.BORDER_GLOW, 2.0)
	var pulse := 0.5 + 0.5 * sin(_t * 2.2)
	draw_arc(Vector2.ZERO, w * 0.38, 0, TAU, 48,
			Color(Palette.GREEN.r, Palette.GREEN.g, Palette.GREEN.b, 0.25 + 0.35 * pulse), 3.0)
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)

	# globo wireframe
	var c := Vector2(0, -18 - w * 0.52)
	var r := w * 0.34
	var g := Palette.GREEN
	var alpha := 0.55 + 0.25 * pulse
	draw_arc(c, r, 0, TAU, 64, Color(g.r, g.g, g.b, alpha), 1.8)
	# paralleli
	for i in [-0.55, 0.0, 0.55]:
		var ry := r * sqrt(1.0 - i * i)
		draw_set_transform(c + Vector2(0, r * i), 0.0, Vector2(1.0, 0.32))
		draw_arc(Vector2.ZERO, ry, 0, TAU, 48, Color(g.r, g.g, g.b, alpha * 0.7), 1.2)
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	# meridiani rotanti
	for k in 3:
		var phase := fmod(_t * 0.5 + k / 3.0, 1.0)
		var sx: float = abs(cos(phase * PI))
		draw_set_transform(c, 0.0, Vector2(sx * 0.95 + 0.05, 1.0))
		draw_arc(Vector2.ZERO, r, 0, TAU, 48, Color(g.r, g.g, g.b, alpha * 0.5), 1.2)
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	# bagliore centrale
	draw_circle(c, r * 0.1, Color(Palette.MINT.r, Palette.MINT.g, Palette.MINT.b, 0.5 + 0.3 * pulse))
