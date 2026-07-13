class_name SpawnFx
extends Node2D
## Effetto di materializzazione/smaterializzazione di un agente: gli agenti
## in scena sono SOLO quelli attivi sulla VPS, quindi entrano ed escono a
## runtime. Il linguaggio è quello della box: anelli e colonne di luce blu
## tesseract che si chiudono (spawn) o si aprono (despawn) sul punto.

const LIFE := 0.7
const HEIGHT := 74.0  # colonna di luce quanto un agente

var _t := 0.0
var _reverse := false  # false = materializza, true = dissolve

static func burst(parent: Node, at: Vector2, reverse := false) -> void:
	var fx := SpawnFx.new()
	fx.position = at
	fx._reverse = reverse
	parent.add_child(fx)

func _ready() -> void:
	z_index = 55

func _process(delta: float) -> void:
	_t += delta
	if _t >= LIFE:
		queue_free()
		return
	queue_redraw()

func _draw() -> void:
	var p := clampf(_t / LIFE, 0.0, 1.0)
	if _reverse:
		p = 1.0 - p
	# p 0→1 = l'energia converge: anello che si stringe, colonna che si alza
	var fade := sin(clampf(_t / LIFE, 0.0, 1.0) * PI)  # entra ed esce morbido
	var blue := Palette.BLUE
	# anello a terra (schiacciato in prospettiva come il proximity ring)
	draw_set_transform(Vector2.ZERO, 0.0, Vector2(1.0, 0.5))
	var radius := lerpf(46.0, 14.0, p)
	draw_arc(Vector2.ZERO, radius, 0, TAU, 36,
			Color(blue.r, blue.g, blue.b, 0.8 * fade), 2.0)
	draw_arc(Vector2.ZERO, radius + 7.0, 0, TAU, 36,
			Color(blue.r, blue.g, blue.b, 0.3 * fade), 3.5)
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	# colonne di luce verticali che "scansionano" il corpo
	var h := HEIGHT * p
	for i in 5:
		var x := -14.0 + i * 7.0
		var a := 0.5 * fade * (0.5 + 0.5 * sin(_t * 40.0 + i * 1.7))
		draw_line(Vector2(x, 0), Vector2(x, -h), Color(blue.r, blue.g, blue.b, a), 1.5)
	# scintilla al vertice della colonna
	draw_circle(Vector2(0, -h), 2.5, Color(1, 1, 1, 0.9 * fade))
