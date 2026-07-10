class_name Player
extends CharacterBody2D
## Il giocatore: WASD/frecce + click-to-move (path dalla NavGrid dell'ufficio).
## L'origine è ai piedi; il visual (placeholder in M1, rig SVG da M2) sta sopra.

const SPEED := 340.0

var nav: NavGrid
## Direzione in cui guarda (per il rig): "down", "up", "side" (+flip)
var facing := "down"
var flip := false
var is_moving := false

var _path := PackedVector2Array()
var _path_i := 0
var _rig: CharacterRig

func _ready() -> void:
	var shape := CollisionShape2D.new()
	var circle := CircleShape2D.new()
	circle.radius = 14.0
	shape.shape = circle
	shape.position = Vector2(0, -12)
	add_child(shape)
	_rig = CharacterRig.new()
	_rig.name = "Rig"
	_rig.setup(CharacterDefs.player_textures(Game.profile))
	add_child(_rig)
	queue_redraw()

func set_click_target(target: Vector2) -> void:
	if nav == null:
		return
	_path = nav.path(global_position, target)
	_path_i = 0

func stop() -> void:
	_path = PackedVector2Array()
	velocity = Vector2.ZERO
	is_moving = false

func _physics_process(_delta: float) -> void:
	if Game.dialogue_active:
		stop()
		return
	var input := Input.get_vector("move_left", "move_right", "move_up", "move_down")
	if input != Vector2.ZERO:
		_path = PackedVector2Array()  # i tasti hanno priorità sul click
		velocity = input * SPEED
	elif _path_i < _path.size():
		var target := _path[_path_i]
		var to_target := target - global_position
		if to_target.length() < 10.0:
			_path_i += 1
			velocity = Vector2.ZERO
		else:
			velocity = to_target.normalized() * SPEED
	else:
		velocity = Vector2.ZERO
	is_moving = velocity.length() > 1.0
	if is_moving:
		_update_facing(velocity)
	if _rig:
		_rig.set_motion(facing, flip, "walk" if is_moving else "idle")
	move_and_slide()

## Visual placeholder (M1): capsula col colore brand finché non c'è il rig SVG.
func _draw() -> void:
	if get_node_or_null("Rig") != null:
		return
	draw_set_transform(Vector2(0, -4), 0.0, Vector2(1.0, 0.4))
	draw_circle(Vector2.ZERO, 18, Color(0, 0, 0, 0.3))
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	var body := Rect2(Vector2(-14, -64), Vector2(28, 56))
	draw_rect(body, Palette.CARD)
	draw_rect(body, Palette.GREEN, false, 2.0)
	draw_circle(Vector2(0, -74), 12, Palette.CARD)
	draw_arc(Vector2(0, -74), 12, 0, TAU, 24, Palette.GREEN, 2.0)

func _update_facing(v: Vector2) -> void:
	if absf(v.x) > absf(v.y):
		facing = "side"
		flip = v.x < 0
	else:
		facing = "down" if v.y > 0 else "up"
