class_name SpriteSheetRig
extends Node2D
## Rig a spritesheet per gli agenti in-world (sostituisce il CharacterRig a
## parti SVG). Contratto del foglio in docs/SPRITES.md: griglia 6×12, cella
## 128×192 (arte a 2×, il rig scala 0.5), piedi a (64, 180), side = destra.
## API pubblica identica al vecchio rig: set_motion(facing, flipped, mode).

# 0.5 rendeva gli agenti ~80px contro scrivanie da 190: sproporzione
# bocciata da Leone. A 0.85 l'agente (~136px) sta alle desk ~170px come
# nell'illustrazione the-box (persona ≈ larghezza scrivania).
const RIG_SCALE := 0.85
const COLS := 6
const CELL := Vector2(128, 192)
const FEET := Vector2(64, 180)

## riga nel foglio, frame usati e fps per ogni traccia mode+facing.
const TRACKS := {
	"idle_down": [0, 2, 2.0], "idle_up": [1, 2, 2.0], "idle_side": [2, 2, 2.0],
	"walk_down": [3, 6, 10.0], "walk_up": [4, 6, 10.0], "walk_side": [5, 6, 10.0],
	"work_down": [6, 4, 8.0], "work_up": [7, 4, 8.0], "work_side": [8, 4, 8.0],
	"carry_down": [9, 6, 10.0], "carry_up": [10, 6, 10.0], "carry_side": [11, 6, 10.0],
}

var mode := "idle"
var facing := "down"       # down / up / side
var flipped := false

var _sprite: Sprite2D
var _row := 0
var _frames := 2
var _fps := 2.0
var _t := 0.0

func setup(sheet: Texture2D) -> void:
	scale = Vector2(RIG_SCALE, RIG_SCALE)
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
	# modi sconosciuti degradano a idle: il rig non deve mai rompersi
	mode = p_mode if TRACKS.has(p_mode + "_down") else "idle"
	_apply_track()

func _apply_track() -> void:
	var key := mode + "_" + facing
	if not TRACKS.has(key):
		key = mode + "_down"
	var track: Array = TRACKS[key]
	_row = track[0]
	_frames = track[1]
	_fps = track[2]
	scale.x = -RIG_SCALE if (facing == "side" and flipped) else RIG_SCALE
	_update_frame()

func _process(delta: float) -> void:
	_t += delta
	_update_frame()

func _update_frame() -> void:
	if _sprite == null:
		return
	var idx := int(_t * _fps) % _frames
	_sprite.frame = _row * COLS + idx
