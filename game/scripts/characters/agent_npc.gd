class_name AgentNPC
extends CharacterBody2D
## Un agente del team in ufficio: sta alla sua postazione (alterna digitare
## e pensare, come i tick veri) e OGNI TANTO — a cadenza calibrata sui dati
## di attività reali — parte per un viaggio di lavoro visibile: stampante
## (torna coi fogli), ritiro dall'inbox del reparto a monte, raro caffè.
## Mostra status bubble e si interroga con un click.

const SPEED := 150.0

## Cadenza MEDIA fra due viaggi, secondi di gioco, per ruolo (jitter ±40%).
## Ancorata ai dati veri esposti da TeamData: lo Scout fa ~3 visite/ora
## ("3 board visitate nell'ultima ora"), lo Scorer ha code corte
## ("coda: 1 posizione"), gli Scrittori sono on-demand e i core girano
## poco. Un agente reale agisce a intervalli: il default è la scrivania.
const TRIP_EVERY := {
	"scout": 190.0,
	"analista": 240.0,
	"scorer": 300.0,
	"scrittore": 280.0,
	"critico": 320.0,
	"coordinatore": 170.0,  # il giro dei reparti è il suo lavoro
	"mentor": 240.0,
	"assistente": 300.0,
}

enum S { WORK, TRIP, TALK }

var slug := ""
var display_name := ""
var dept := ""
var nav: NavGrid
var rig  # CharacterRig o SpriteSheetRig: stessa interfaccia set_motion
var bubble: StatusBubble

var state: S = S.WORK
var _spot := Vector2.ZERO
var _desk_facing := "down"
var _chatter: Array = []
var _wander: Array = []  # solo core (mentor/coordinatore/assistente)

## Viaggio corrente: lista di tappe {target, mode, pause, pause_mode}.
## mode = walk|carry (animazione in cammino); pause_mode = idle|work.
var _legs: Array = []
var _leg: Dictionary = {}
var _pause := 0.0

var _path := PackedVector2Array()
var _pi := 0
var _state_timer := 0.0
var _pose_timer := 0.0     # alternanza work/idle alla scrivania
var _desk_working := true
var _bubble_timer := 0.0
var _highlight := false
var _pulse := 0.0

func setup(def: Dictionary, p_nav: NavGrid) -> void:
	nav = p_nav
	slug = def["slug"]
	display_name = def["name"]
	dept = def.get("dept", "")
	_spot = def["spot"]
	_chatter = def.get("chatter", [])
	_wander = def.get("wander", [])
	if dept != "":
		var desk: Dictionary = DepartmentDefs.DEPARTMENTS[dept]["desks"][def["desk"]]
		_desk_facing = desk.get("facing", "down")
	position = _spot
	# primo viaggio sparso su tutta la cadenza: niente fuggi-fuggi al boot
	_state_timer = _cadence() * randf_range(0.15, 1.0)
	_pose_timer = randf_range(12.0, 35.0)
	_bubble_timer = randf_range(2.0, 12.0)

	var shape := CollisionShape2D.new()
	var circle := CircleShape2D.new()
	circle.radius = 13.0
	shape.shape = circle
	shape.position = Vector2(0, -12)
	add_child(shape)

	rig = CharacterDefs.make_rig(slug)
	add_child(rig)
	_work_pose()

	bubble = StatusBubble.new()
	bubble.position = Vector2(0, -96)
	add_child(bubble)

func set_highlight(on: bool) -> void:
	if _highlight != on:
		_highlight = on
		queue_redraw()

## Interrogato con un click: si ferma e guarda in camera.
func start_talk() -> void:
	state = S.TALK
	_path = PackedVector2Array()
	velocity = Vector2.ZERO
	rig.set_motion("down", false, "idle")
	bubble.hide_now()

## Fine dialogo: torna alla postazione (viaggio minimo) e riprende.
func end_talk() -> void:
	_legs = [_leg_to(_spot, "walk", 0.0, "work")]
	_start_next_leg()

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
			_tick_desk_pose(delta)
			_state_timer -= delta
			if _state_timer <= 0.0:
				_state_timer = _cadence() * randf_range(0.6, 1.4)
				_plan_trip()
		S.TRIP:
			if _pause > 0.0:
				velocity = Vector2.ZERO
				_pause -= delta
				if _pause <= 0.0:
					_start_next_leg()
			elif _follow_path(SPEED, _leg.get("mode", "walk")):
				_arrive_at_leg()
		S.TALK:
			velocity = Vector2.ZERO
	move_and_slide()

# ── Scrivania: si lavora a tick, non di continuo ─────────────────────

func _cadence() -> float:
	return TRIP_EVERY.get(slug, 260.0)

## Alterna digitazione (work) e pensiero (idle) alla postazione: il ritmo
## dei tick veri. Circa 70% del tempo in work.
func _tick_desk_pose(delta: float) -> void:
	_pose_timer -= delta
	if _pose_timer > 0.0:
		return
	_desk_working = not _desk_working
	if _desk_working:
		_pose_timer = randf_range(18.0, 40.0)
		rig.set_motion(_desk_facing, false, "work")
	else:
		_pose_timer = randf_range(6.0, 16.0)
		rig.set_motion(_desk_facing, false, "idle")

# ── Viaggi di lavoro ──────────────────────────────────────────────────

func _leg_to(target: Vector2, mode: String, pause: float, pause_mode: String) -> Dictionary:
	return {"target": target, "mode": mode, "pause": pause, "pause_mode": pause_mode}

## Sceglie il prossimo viaggio in base al ruolo. La cadenza è già rara
## (TRIP_EVERY): quando il timer scatta il motivo è quasi sempre di lavoro
## — stampa o ritiro fogli; caffè e ologramma sono l'eccezione.
func _plan_trip() -> void:
	_legs = []
	if dept == "":
		# core: il Coordinatore fa il giro dei reparti, gli altri due passi
		if _wander.is_empty():
			return
		_legs = [
			_leg_to(_jit(_wander[randi() % _wander.size()]), "walk",
					randf_range(3.0, 7.0), "idle"),
			_leg_to(_spot, "walk", 0.0, "work"),
		]
		_start_next_leg()
		return
	var pois := DepartmentDefs.POIS
	var roll := randf()
	if roll < 0.45:
		# stampa: vai alla stampante, aspetta il foglio, torna coi fogli
		_legs = [
			_leg_to(_jit(pois["printer"]["spot"]), "walk", randf_range(1.5, 3.0), "idle"),
			_leg_to(_spot, "carry", 0.0, "work"),
		]
	elif roll < 0.80 and DepartmentDefs.FETCH_FROM.has(dept):
		# ritiro: inbox del reparto a monte → inbox di casa → scrivania
		var src: String = DepartmentDefs.FETCH_FROM[dept]
		_legs = [
			_leg_to(_jit(DepartmentDefs.DEPARTMENTS[src]["inbox"]), "walk",
					randf_range(0.8, 1.6), "idle"),
			_leg_to(_jit(DepartmentDefs.DEPARTMENTS[dept]["inbox"]), "carry",
					randf_range(0.5, 1.0), "idle"),
			_leg_to(_spot, "walk", 0.0, "work"),
		]
	elif roll < 0.90:
		# pausa caffè / macchinetta (raro: i tick non aspettano)
		var poi: Vector2 = pois["coffee"]["spot"] if randf() < 0.7 \
				else pois["water_cooler"]["spot"]
		_legs = [
			_leg_to(_jit(poi), "walk", randf_range(3.0, 7.0), "idle"),
			_leg_to(_spot, "walk", 0.0, "work"),
		]
	else:
		# un'occhiata all'ologramma della ricerca
		_legs = [
			_leg_to(_jit(pois["hologram"]["spot"]), "walk", randf_range(2.0, 5.0), "idle"),
			_leg_to(_spot, "walk", 0.0, "work"),
		]
	_start_next_leg()

## Jitter sulla meta: trenta agenti sullo stesso pixel sembrano una coda.
func _jit(p: Vector2) -> Vector2:
	return p + Vector2(randf_range(-26, 26), randf_range(-14, 14))

func _start_next_leg() -> void:
	if _legs.is_empty():
		_end_trip()
		return
	_leg = _legs.pop_front()
	_path = nav.path(global_position, _leg["target"])
	_pi = 0
	state = S.TRIP

func _arrive_at_leg() -> void:
	if float(_leg.get("pause", 0.0)) > 0.0:
		_pause = _leg["pause"]
		rig.set_motion(rig.facing, rig.flipped, _leg.get("pause_mode", "idle"))
	elif _legs.is_empty():
		_end_trip()
	else:
		_start_next_leg()

func _end_trip() -> void:
	state = S.WORK
	position = _spot
	_work_pose()

## Alla scrivania: rivolto secondo la postazione (down = viso in camera).
func _work_pose() -> void:
	rig.set_motion(_desk_facing, false, "work")

func _follow_path(speed: float, mode := "walk") -> bool:
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
	rig.set_motion(rig.facing, rig.flipped, mode)
	return false

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
		if not lines.is_empty():
			bubble.show_text(lines[randi() % lines.size()])

## Proximity ring (pattern Gather) sotto l'agente in hover.
func _draw() -> void:
	if not _highlight:
		return
	var a := 0.55 + 0.25 * sin(_pulse * 5.0)
	draw_set_transform(Vector2.ZERO, 0.0, Vector2(1.0, 0.5))
	draw_arc(Vector2.ZERO, 30.0, 0, TAU, 40,
			Color(Palette.GREEN.r, Palette.GREEN.g, Palette.GREEN.b, a), 2.2)
	draw_arc(Vector2.ZERO, 34.0, 0, TAU, 40,
			Color(Palette.GREEN.r, Palette.GREEN.g, Palette.GREEN.b, a * 0.35), 4.0)
