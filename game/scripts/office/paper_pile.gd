class_name PaperPile
extends Node2D
## La pila di fogli sulla scrivania (ciclo grafica 11/07): quando un agente
## torna da stampante/inbox in modalità carry, i fogli si ACCUMULANO qui,
## visibilmente; mentre lavora li smaltisce uno alla volta. Quattro stati
## visivi: sprite pile_1..4.png di dev-art (gen-art/furniture, nome=kind)
## appena esistono, altrimenti blockout a foglietti sfalsati.
##
## GLES3: texture su Sprite2D figlio, primitive _draw solo su self e solo
## in modalità blockout — mai le due cose sullo stesso CanvasItem.

const TEX_BASE := "res://assets/gen-art/furniture/pile_"
const MAX_SHEETS := 18
const WIDTH := 56.0  # larghezza resa sulla scrivania

var count := 0
var _sprite: Sprite2D
var _has_tex := false

func _init(desk_rect: Rect2) -> void:
	# su un angolo del piano di lavoro, non al centro (lì c'è il monitor)
	position = Vector2(desk_rect.get_center().x + desk_rect.size.x * 0.26,
			desk_rect.get_center().y + 2.0)
	z_index = 1  # sopra il mobile: la pila sta SUL piano

func _ready() -> void:
	_has_tex = ResourceLoader.exists(TEX_BASE + "1.png")
	if _has_tex:
		_sprite = Sprite2D.new()
		add_child(_sprite)
	_refresh()

func add_sheets(n: int) -> void:
	count = mini(count + n, MAX_SHEETS)
	_refresh()

func take_sheet() -> void:
	if count > 0:
		count -= 1
		_refresh()

## 0 = niente pila, 1..4 = stato visivo crescente.
func _stage() -> int:
	if count <= 0:
		return 0
	if count <= 3:
		return 1
	if count <= 7:
		return 2
	if count <= 12:
		return 3
	return 4

func _refresh() -> void:
	if not _has_tex:
		queue_redraw()
		return
	var st := _stage()
	_sprite.visible = st > 0
	if st == 0:
		return
	# se manca lo stato alto (consegna dev-art parziale) degrada al più vicino
	while st > 1 and not ResourceLoader.exists(TEX_BASE + str(st) + ".png"):
		st -= 1
	var tex: Texture2D = load(TEX_BASE + str(st) + ".png")
	_sprite.texture = tex
	_sprite.scale = Vector2.ONE * (WIDTH / tex.get_width())

## Blockout: foglietti bianchi sfalsati, la pila si alza con lo stato.
func _draw() -> void:
	if _has_tex or count <= 0:
		return
	for i in _stage() * 2:
		var off := Vector2(sin(i * 2.399) * 3.0, -i * 2.0)
		draw_rect(Rect2(Vector2(-14, -9) + off, Vector2(28, 18)),
				Color(0.96, 0.95, 0.90), true)
		draw_rect(Rect2(Vector2(-14, -9) + off, Vector2(28, 18)),
				Color(0.60, 0.60, 0.62, 0.8), false, 1.0)
