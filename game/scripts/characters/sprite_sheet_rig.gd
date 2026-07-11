class_name SpriteSheetRig
extends Node2D
## Rig a spritesheet per gli agenti in-world (sostituisce il CharacterRig a
## parti SVG). Contratto del foglio in docs/SPRITES.md: griglia 6×12, cella
## 256×384 (arte quasi 1:1 con gli originali imagegen, il rig scala giù),
## piedi a (128, 360), side = destra.
## API pubblica identica al vecchio rig: set_motion(facing, flipped, mode).

# La resa in scena è invariata dal 0.85 su celle 128×192 (agente ~136px,
# persona ≈ larghezza scrivania, calibrato con Leone): celle raddoppiate
# per pareggiare la definizione degli arredi → scala dimezzata.
const RIG_SCALE := 0.425
const COLS := 6
const CELL := Vector2(256, 384)
const FEET := Vector2(128, 360)

## riga nel foglio, frame usati e fps per ogni traccia mode+facing.
const TRACKS := {
	"idle_down": [0, 2, 2.0], "idle_up": [1, 2, 2.0], "idle_side": [2, 2, 2.0],
	"walk_down": [3, 6, 10.0], "walk_up": [4, 6, 10.0], "walk_side": [5, 6, 10.0],
	"work_down": [6, 4, 8.0], "work_up": [7, 4, 8.0], "work_side": [8, 4, 8.0],
	"carry_down": [9, 6, 10.0], "carry_up": [10, 6, 10.0], "carry_side": [11, 6, 10.0],
}

## "sit" vive in un foglio SEPARATO <slug>_sit.png (4×3, stessa cella):
## righe down/up/side. Il contratto 6×12 del foglio principale non cambia.
const SIT_COLS := 4
const SIT_TRACKS := {
	"sit_down": [0, 4, 8.0], "sit_up": [1, 4, 8.0], "sit_side": [2, 4, 8.0],
}

var mode := "idle"
var facing := "down"       # down / up / side
var flipped := false

## true se il foglio seduto è caricato: i chiamanti (AgentNPC) applicano
## l'offset-sedia solo quando la posa seduta esiste davvero (contratto
## has_sit concordato in chat 16:1x).
var has_sit: bool:
	get:
		return _sit_sheet != null

var _sprite: Sprite2D
var _sheet: Texture2D
var _sit_sheet: Texture2D
var _row := 0
var _frames := 2
var _fps := 2.0
var _t := 0.0

func setup(sheet: Texture2D, sit_sheet: Texture2D = null) -> void:
	scale = Vector2(RIG_SCALE, RIG_SCALE)
	_sheet = sheet
	_sit_sheet = sit_sheet
	_sprite = Sprite2D.new()
	_sprite.texture = sheet
	_sprite.centered = false
	_sprite.hframes = COLS
	_sprite.vframes = 12
	_sprite.position = -FEET
	add_child(_sprite)
	_t = randf() * 10.0  # fase casuale: gli agenti non marciano in sincrono
	_apply_track()

func set_motion(p_facing: String, p_flipped: bool, p_mode: String) -> void:
	if p_facing == facing and p_flipped == flipped and p_mode == mode:
		return
	facing = p_facing
	flipped = p_flipped
	# "sit" senza foglio seduto degrada a work (si digita in piedi finché
	# l'arte non arriva); modi sconosciuti degradano a idle: mai rompersi
	if p_mode == "sit":
		mode = "sit" if _sit_sheet != null else "work"
	else:
		mode = p_mode if TRACKS.has(p_mode + "_down") else "idle"
	_apply_track()
	queue_redraw()  # l'anello dell'ombra segue il modo (walk/carry)

func _apply_track() -> void:
	var sitting := mode == "sit"
	var tex := _sit_sheet if sitting else _sheet
	if _sprite.texture != tex:
		_sprite.texture = tex
		_sprite.hframes = SIT_COLS if sitting else COLS
		_sprite.vframes = 3 if sitting else 12
	var table: Dictionary = SIT_TRACKS if sitting else TRACKS
	var key := mode + "_" + facing
	if not table.has(key):
		key = mode + "_down"
	var track: Array = table[key]
	_row = track[0]
	_frames = track[1]
	_fps = track[2]
	scale.x = -RIG_SCALE if (facing == "side" and flipped) else RIG_SCALE
	_update_frame()

func _process(delta: float) -> void:
	_t += delta
	_update_frame()
	# respiro in idle: i fogli idle hanno 2 frame quasi uguali (o il
	# fallback dal walk, statico) — il micro-bob dà vita comunque
	_sprite.position.y = -FEET.y + (sin(_t * 1.7) * 2.8 if mode == "idle" else 0.0)

## Ombra ai piedi: àncora la figura al pavimento (profondità 2.5D).
## Più marcata del primo giro (feedback test finale: in cammino gli
## agenti si confondevano con lo sfondo) e con un anello netto quando
## la figura si muove.
func _draw() -> void:
	draw_set_transform(Vector2.ZERO, 0.0, Vector2(1.0, 0.38))
	for i in 3:
		draw_circle(Vector2.ZERO, 60.0 + i * 16.0, Color(0, 0, 0, 0.16 - i * 0.045))
	if mode == "walk" or mode == "carry":
		draw_arc(Vector2.ZERO, 66.0, 0, TAU, 48, Color(0.65, 0.95, 1.0, 0.38), 3.0)
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)

func _update_frame() -> void:
	if _sprite == null:
		return
	var idx := int(_t * _fps) % _frames
	_sprite.frame = _row * (SIT_COLS if mode == "sit" else COLS) + idx
