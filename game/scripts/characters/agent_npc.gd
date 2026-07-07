class_name AgentNPC
extends CharacterBody2D
## Un agente del team in ufficio: lavora alla sua postazione, ogni tanto
## vagabonda (caffè, ologramma), mostra status bubble alla Gather, può
## essere "chiamato" con un click (wave-to-summon) e messo in dialogo.

signal arrived_to_player(agent: AgentNPC)

const SPEED := 150.0
const SUMMON_SPEED := 240.0

enum S { WORK, GO_OUT, OUT_IDLE, GO_BACK, SUMMONED, TALK }

var slug := ""
var display_name := ""
var nav: NavGrid
var rig: CharacterRig
var bubble: StatusBubble

var state: S = S.WORK
var _spot := Vector2.ZERO
var _wander: Array = []
var _chatter: Array = []
var _path := PackedVector2Array()
var _pi := 0
var _state_timer := 0.0
var _bubble_timer := 0.0
var _highlight := false
var _pulse := 0.0
var _summon_target: Node2D

func setup(p_slug: String, p_nav: NavGrid) -> void:
	slug = p_slug
	nav = p_nav
	var def: Dictionary = CharacterDefs.AGENTS[slug]
	display_name = def["name"]
	_spot = def["spot"]
	_wander = def["wander"]
	_chatter = def["chatter"]
	position = _spot
	_state_timer = randf_range(6.0, 16.0)
	_bubble_timer = randf_range(2.0, 9.0)

	var shape := CollisionShape2D.new()
	var circle := CircleShape2D.new()
	circle.radius = 13.0
	shape.shape = circle
	shape.position = Vector2(0, -12)
	add_child(shape)

	rig = CharacterRig.new()
	rig.setup(CharacterDefs.agent_textures(slug))
	add_child(rig)
	rig.set_motion("down", false, "work")

	bubble = StatusBubble.new()
	bubble.position = Vector2(0, -96)
	add_child(bubble)

func set_highlight(on: bool) -> void:
	if _highlight != on:
		_highlight = on
		queue_redraw()

## Wave-to-summon: l'agente saluta e viene incontro al giocatore.
func summon(target: Node2D) -> void:
	if state == S.TALK:
		return
	_summon_target = target
	state = S.SUMMONED
	bubble.show_text("arrivo…", 2.5)
	_repath_to_summon()

func start_talk(player: Node2D) -> void:
	state = S.TALK
	_path = PackedVector2Array()
	velocity = Vector2.ZERO
	_face_point(player.global_position)
	rig.set_motion(rig.facing, rig.flipped, "idle")
	bubble.hide_now()

func end_talk() -> void:
	state = S.GO_BACK
	_path = nav.path(global_position, _spot)
	_pi = 0

func is_talking() -> bool:
	return state == S.TALK

## True se il punto (click) cade sul corpo dell'agente.
func hit_by(point: Vector2) -> bool:
	return point.distance_to(global_position + Vector2(0, -44)) < 52 \
			or point.distance_to(global_position) < 26

func _physics_process(delta: float) -> void:
	_pulse += delta
	if _highlight:
		queue_redraw()
	_bubble_tick(delta)
	match state:
		S.WORK:
			velocity = Vector2.ZERO
			_state_timer -= delta
			if _state_timer <= 0.0:
				_state_timer = randf_range(10.0, 22.0)
				if randf() < 0.55 and not _wander.is_empty():
					state = S.GO_OUT
					_path = nav.path(global_position, _wander[randi() % _wander.size()])
					_pi = 0
		S.GO_OUT, S.GO_BACK, S.SUMMONED:
			if state == S.SUMMONED and _summon_target \
					and _pi < _path.size() \
					and _path[_path.size() - 1].distance_to(_summon_target.global_position) > 160.0:
				_repath_to_summon()  # il giocatore si è spostato parecchio
			var speed := SUMMON_SPEED if state == S.SUMMONED else SPEED
			if _follow_path(speed):
				match state:
					S.GO_OUT:
						state = S.OUT_IDLE
						_state_timer = randf_range(4.0, 9.0)
						rig.set_motion("down", false, "idle")
					S.GO_BACK:
						state = S.WORK
						position = _spot
						rig.set_motion("down", false, "work")
					S.SUMMONED:
						state = S.TALK
						if _summon_target:
							_face_point(_summon_target.global_position)
						rig.set_motion(rig.facing, rig.flipped, "idle")
						arrived_to_player.emit(self)
		S.OUT_IDLE:
			velocity = Vector2.ZERO
			_state_timer -= delta
			if _state_timer <= 0.0:
				state = S.GO_BACK
				_path = nav.path(global_position, _spot)
				_pi = 0
		S.TALK:
			velocity = Vector2.ZERO
			if _summon_target:
				_face_point(_summon_target.global_position)
	move_and_slide()

func _follow_path(speed: float) -> bool:
	if _pi >= _path.size():
		return true
	var target := _path[_pi]
	var to_target := target - global_position
	if to_target.length() < 10.0:
		_pi += 1
		if _pi >= _path.size():
			velocity = Vector2.ZERO
			return true
		to_target = _path[_pi] - global_position
	velocity = to_target.normalized() * speed
	_face_point(global_position + velocity)
	rig.set_motion(rig.facing, rig.flipped, "walk")
	return false

func _repath_to_summon() -> void:
	var to_me := (global_position - _summon_target.global_position).normalized()
	var stop_at: Vector2 = _summon_target.global_position + to_me * 70.0
	_path = nav.path(global_position, stop_at)
	_pi = 0

func _face_point(p: Vector2) -> void:
	var d := p - global_position
	if absf(d.x) > absf(d.y):
		rig.set_motion("side", d.x < 0, rig.mode)
	else:
		rig.set_motion("down" if d.y > 0 else "up", false, rig.mode)

func _bubble_tick(delta: float) -> void:
	if state == S.TALK:
		return
	_bubble_timer -= delta
	if _bubble_timer <= 0.0:
		_bubble_timer = randf_range(8.0, 16.0)
		var lines := _chatter.duplicate()
		var status: Dictionary = TeamData.agent_status().get(slug, {})
		if status.has("detail"):
			lines.append(status["detail"])
		bubble.show_text(lines[randi() % lines.size()])

## Proximity ring (pattern Gather) ai piedi dell'agente interagibile.
func _draw() -> void:
	if not _highlight:
		return
	var a := 0.55 + 0.25 * sin(_pulse * 5.0)
	draw_set_transform(Vector2.ZERO, 0.0, Vector2(1.0, 0.5))
	draw_arc(Vector2.ZERO, 30.0, 0, TAU, 40,
			Color(Palette.GREEN.r, Palette.GREEN.g, Palette.GREEN.b, a), 2.2)
	draw_arc(Vector2.ZERO, 34.0, 0, TAU, 40,
			Color(Palette.GREEN.r, Palette.GREEN.g, Palette.GREEN.b, a * 0.35), 4.0)
