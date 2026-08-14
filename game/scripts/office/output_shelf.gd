class_name OutputShelf
extends Node2D
## La sezione OUTPUT dell'ufficio (missione pipeline 3/3): lo scaffale
## dei CV PRONTI per essere mandati — scritte + PASS del critico. Sta
## accanto alla porta d'uscita, simbolicamente in partenza. Il numero
## grande è il contatore VERO (cv_ready dal bus); le cartelline visive
## crescono con un drift, una alla volta. Primitive _draw (gotcha GLES3).

static var instance: OutputShelf

const RECT := Rect2(1395, 1908, 170, 64)
const FOLDER := Color(0.93, 0.90, 0.82)
const FOLDER_EDGE := Color(0.62, 0.58, 0.50)
const WOOD := Color("#2a2320")
const WOOD_EDGE := Color("#4a3d33")
const MAX_VISUAL := 14  # cartelline per ripiano x 2 ripiani

var _real := 0     # il contatore vero, mostrato in cifra
var _visual := 0   # cartelline disegnate (drift verso _real)
var _drift := 0.0
var _highlighted := false

func _init() -> void:
	position = RECT.get_center()
	instance = self

## Aggancio al dato vero (chiamato dal sync della scena). `immediate` salta il
## drift: serve al primo snapshot di una connessione, perché le cartelline già
## sui ripiani sono quelle della macchina precedente e a 1,5-3 s l'una
## resterebbero in vista per quasi un minuto.
static func set_ready(n: int, immediate := false) -> void:
	if instance:
		instance._real = maxi(0, n)
		if immediate:
			instance._visual = mini(instance._real, MAX_VISUAL)
			instance._drift = 0.0
		instance.set_process(true)
		instance.queue_redraw()

## Il mobile e la targa formano un unico bersaglio cliccabile. Il grow
## rende il click comodo anche con zoom molto bassi della FreeCamera.
static func hit_by(point: Vector2) -> bool:
	return RECT.grow(22.0).has_point(point)

static func set_highlight(on: bool) -> void:
	if instance and instance._highlighted != on:
		instance._highlighted = on
		instance.queue_redraw()

func _process(delta: float) -> void:
	var target := mini(_real, MAX_VISUAL)
	if _visual == target:
		set_process(false)
		return
	_drift -= delta
	if _drift <= 0.0:
		_drift = randf_range(1.5, 3.0)
		_visual += signi(target - _visual)
		queue_redraw()

func _draw() -> void:
	var half := RECT.size / 2.0
	if _highlighted:
		draw_rect(Rect2(-half - Vector2(6, 6), RECT.size + Vector2(12, 12)),
				Color(Palette.GREEN, 0.12))
		draw_rect(Rect2(-half - Vector2(6, 6), RECT.size + Vector2(12, 12)),
				Palette.GREEN, false, 2.0)
	# corpo dello scaffale: due ripiani aperti
	draw_rect(Rect2(-half, RECT.size), WOOD)
	draw_rect(Rect2(-half, RECT.size), WOOD_EDGE, false, 2.0)
	draw_line(Vector2(-half.x + 4, 0), Vector2(half.x - 4, 0), WOOD_EDGE, 2.0)
	# cartelline CV in piedi sui ripiani, con linguetta
	for i in _visual:
		var shelf_row := i / 7  # 7 per ripiano
		var slot := i % 7
		var x := -half.x + 12.0 + slot * 21.0
		var y := -6.0 if shelf_row == 0 else half.y - 8.0
		var lean := sin(i * 1.7) * 1.5
		draw_set_transform(Vector2(x, y), lean * 0.04, Vector2.ONE)
		draw_rect(Rect2(Vector2(0, -22), Vector2(15, 22)), FOLDER)
		draw_rect(Rect2(Vector2(0, -22), Vector2(15, 22)), FOLDER_EDGE, false, 1.0)
		draw_rect(Rect2(Vector2(2, -25), Vector2(7, 3)), FOLDER)
		draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	# targa sopra: etichetta + contatore VERO
	draw_rect(Rect2(Vector2(-52, -half.y - 30), Vector2(104, 22)), Palette.PANEL)
	draw_rect(Rect2(Vector2(-52, -half.y - 30), Vector2(104, 22)),
			Palette.GREEN if _highlighted else Color(Palette.GREEN, 0.7), false,
			2.0 if _highlighted else 1.2)
	draw_string(ThemeDB.fallback_font, Vector2(-45, -half.y - 14),
			UIStrings.t("office.ready_cvs_count") % _real,
			HORIZONTAL_ALIGNMENT_LEFT, -1, 12,
			Palette.GREEN)
