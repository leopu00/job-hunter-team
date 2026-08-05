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

## I fogli da sei pose hanno un passo completo di circa 45 px di mondo alla
## scala del rig. Gli AgentNPC percorrono invece corsie a 150/185 px/s:
## lasciare la cadenza fissa a 10 fps creava un forte disallineamento fra
## traslazione e lettura dei cel. La frequenza e' percio' proporzionale alla
## velocita' fisica, con un tetto sotto il refresh del girato a 30 fps. Non
## cambia disegni, ordine dei cel o coordinate dei piedi: corregge solo il
## tempo con cui i cel sono letti. La qualita' delle pose resta verificata dal
## gate grafico dedicato.
const WALK_REFERENCE_SPEED := 75.0
const WALK_MAX_FPS := 24.0

## riga nel foglio, frame usati e fps per ogni traccia mode+facing.
const TRACKS := {
	"idle_down": [0, 2, 2.0], "idle_up": [1, 2, 2.0], "idle_side": [2, 2, 2.0],
	# still = agente acceso ma senza turno in corso: un singolo frame,
	# nessun respiro/bob. Non deve sembrare al lavoro se la VPS è idle.
	"still_down": [0, 1, 0.0], "still_up": [1, 1, 0.0], "still_side": [2, 1, 0.0],
	"walk_down": [3, 6, 10.0], "walk_up": [4, 6, 10.0], "walk_side": [5, 6, 10.0],
	"work_down": [6, 4, 8.0], "work_up": [7, 4, 8.0], "work_side": [8, 4, 8.0],
	"carry_down": [9, 6, 10.0], "carry_up": [10, 6, 10.0], "carry_side": [11, 6, 10.0],
}

## "sit" vive in un foglio SEPARATO <slug>_sit.png (4×3, stessa cella):
## righe down/up/side. Il contratto 6×12 del foglio principale non cambia.
const SIT_COLS := 4
const SIT_TRACKS := {
	"sit_down": [0, 4, 8.0], "sit_up": [1, 4, 8.0], "sit_side": [2, 4, 8.0],
	"sit_idle_down": [0, 1, 0.0], "sit_idle_up": [1, 1, 0.0],
	"sit_idle_side": [2, 1, 0.0],
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
var _base_fps := 2.0
## Ultima velocita' fisica ricevuta da AgentNPC. La tratteniamo anche mentre
## il facing cambia: _apply_track puo' cosi' scegliere subito il cel della
## fase corrente, senza un frame transitorio letto alla vecchia cadenza 10.
var _walk_speed := WALK_REFERENCE_SPEED
var _t := 0.0
## Cache di visual_top_y per (texture, frame): get_image() è un readback
## GPU→CPU con scan dei pixel — a regime NON deve mai ripetersi.
var _top_cache := {}

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
	_t = randf() * 10.0  # idle casuale; ogni viaggio parte invece da un contatto
	_apply_track()

func set_motion(p_facing: String, p_flipped: bool, p_mode: String) -> void:
	if p_facing == facing and p_flipped == flipped and p_mode == mode:
		return
	var starts_gait := mode not in ["walk", "carry"] and p_mode in ["walk", "carry"]
	facing = p_facing
	flipped = p_flipped
	# "sit" senza foglio seduto degrada a work (si digita in piedi finché
	# l'arte non arriva); modi sconosciuti degradano a idle: mai rompersi
	if p_mode == "sit" or p_mode == "sit_idle":
		mode = p_mode if _sit_sheet != null else ("work" if p_mode == "sit" else "still")
	else:
		mode = p_mode if TRACKS.has(p_mode + "_down") else "idle"
		# Una tratta nuova inizia sempre dal primo contatto del ciclo. La fase
		# non viene invece azzerata quando il path cambia verso: cosi' non ci
		# sono scatti ne' inversioni di piedi in mezzo al passo.
		if starts_gait:
			_t = 0.0
		_apply_track()
	queue_redraw()  # l'anello dell'ombra segue il modo (walk/carry)

## Collega la cadenza del foglio al movimento reale del CharacterBody2D.
## L'API resta opzionale per il vecchio CharacterRig: AgentNPC la chiama solo
## quando il rig la espone. Con 150 px/s il ciclo diventa 20 fps; a 185 px/s
## arriva al tetto 24, quindi il video a 30 fps non salta pose intermedie.
func set_walk_speed(world_speed: float) -> void:
	if mode not in ["walk", "carry"]:
		return
	_walk_speed = maxf(0.0, world_speed)
	_fps = walk_fps_for_speed(_base_fps, _walk_speed)
	# Il cambio di velocita' puo' attraversare una soglia di fase: aggiorna
	# subito il cel, non al _process successivo, perche' Movie Maker puo'
	# disegnare proprio fra un cambio facing e il frame seguente.
	_update_frame()
	set_process(true)

static func walk_fps_for_speed(base_fps: float, world_speed: float) -> float:
	if base_fps <= 0.0:
		return 0.0
	var proportional := base_fps * maxf(world_speed, WALK_REFERENCE_SPEED) / WALK_REFERENCE_SPEED
	return clampf(proportional, base_fps, WALK_MAX_FPS)

## Limite superiore realmente occupato dal frame corrente, in coordinate del
## nodo AgentNPC (origine ai piedi). I fogli non hanno tutti lo stesso margine
## trasparente: usare un offset fisso faceva finire il badge sulla fronte di
## alcuni agenti e molto lontano da altri.
func visual_top_y() -> float:
	if _sprite == null or _sprite.texture == null:
		return -132.0
	var cache_key := str(_sprite.texture.get_rid()) + ":" + str(_sprite.frame)
	if _top_cache.has(cache_key):
		return _top_cache[cache_key]
	var result := _measure_top_y()
	_top_cache[cache_key] = result
	return result

func _measure_top_y() -> float:
	var image := _sprite.texture.get_image()
	if image == null or image.is_empty():
		return -132.0
	if image.is_compressed():
		# I fogli sono VRAM-compressed (BCn): get_region/blit non lavorano
		# su formati compressi — si decomprime SOLO per questa misura una
		# tantum (il risultato finisce in _top_cache).
		image.decompress()
	var cols := maxi(1, _sprite.hframes)
	var rows := maxi(1, _sprite.vframes)
	var cell_w := image.get_width() / cols
	var cell_h := image.get_height() / rows
	var frame := _sprite.frame
	var region := image.get_region(Rect2i((frame % cols) * cell_w,
			(frame / cols) * cell_h, cell_w, cell_h))
	var used := region.get_used_rect()
	if used.size == Vector2i.ZERO:
		return -132.0
	return (_sprite.position.y + float(used.position.y)) * absf(scale.y)

func _apply_track() -> void:
	var sitting := mode == "sit" or mode == "sit_idle"
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
	_base_fps = track[2]
	_fps = walk_fps_for_speed(_base_fps, _walk_speed) if mode in ["walk", "carry"] else _base_fps
	scale.x = -RIG_SCALE if (facing == "side" and flipped) else RIG_SCALE
	_update_frame()
	# Tracce a frame fisso (still/sit_idle) senza bob: il rig dorme del tutto.
	# Con 16 agenti per lo più fermi sono 16 _process a frame in meno.
	set_process(_fps > 0.0 or mode == "idle")

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
	# La postazione pittorica contiene già sedia, base e ruote. L'ovale ai
	# piedi è corretto in cammino ma, da seduti, crea un secondo appoggio
	# staccato dal sedile e fa sembrare il corpo sospeso davanti alla sedia.
	if mode == "sit" or mode == "sit_idle":
		return
	draw_set_transform(Vector2.ZERO, 0.0, Vector2(1.0, 0.38))
	for i in 3:
		draw_circle(Vector2.ZERO, 60.0 + i * 16.0, Color(0, 0, 0, 0.16 - i * 0.045))
	if mode == "walk" or mode == "carry":
		draw_arc(Vector2.ZERO, 66.0, 0, TAU, 48, Color(0.65, 0.95, 1.0, 0.38), 3.0)
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)

func _update_frame() -> void:
	if _sprite == null:
		return
	var idx := 0 if _fps <= 0.0 else int(_t * _fps) % _frames
	var sitting := mode == "sit" or mode == "sit_idle"
	_sprite.frame = _row * (SIT_COLS if sitting else COLS) + idx
