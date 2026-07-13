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
	"sentinella": 140.0,  # il watchdog è quasi sempre in ronda
}

enum S { WORK, TRIP, TALK }

var slug := ""
var uid := ""  # id univoco lato backend (es. "scout-2"); "" = roster locale
var display_name := ""
var dept := ""
var nav: NavGrid
var rig  # CharacterRig o SpriteSheetRig: stessa interfaccia set_motion
var bubble: StatusBubble
var speech: SpeechBubble
## Stato riportato dal backend: working|idle|paused. Con idle/paused
## l'agente resta alla postazione senza viaggi né digitazione.
var backend_status := "working"
## Stima secondi di throttle rimanenti (contratto additivo col backend):
## sotto REC_THROTTLE_SECS si aspetta SEDUTI, sopra si va in ricreazione.
var throttle_secs := 0.0
const REC_THROTTLE_SECS := 90.0
var _dissolving := false
var _exiting := false

var state: S = S.WORK
var _spot := Vector2.ZERO
var _desk_facing := "down"
var pile: PaperPile  # i fogli accumulati sulla MIA scrivania
var _consume_timer := 0.0
var _standing := false  # standing desk (dado 16:10): lavora in piedi
var _seat_sink := 46.0  # affondo della seduta nel desk (per-scrivania)
var _desk_key := ""  # chiave nel registry FurnitureNode.desks
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
		_standing = desk.get("standing", false)
		# affondo per-scrivania: le texture col fronte-camera alto (monitor
		# multipli) chiedono più profondità del default
		_seat_sink = float(desk.get("seat_sink", _seat_sink))
		_desk_key = "%s:%d" % [dept, def["desk"]]
		# la pila di fogli vive sul piano della postazione (sibling nel
		# World: setup() arriva quando siamo già nell'albero)
		pile = PaperPile.new(desk["rect"])
		get_parent().add_child(pile)
		pile.add_sheets(randi_range(0, 5))  # non si parte mai a tavolo vuoto
	# i core con scrivania personale dichiarano il verso nel def (fix
	# test finale: il Capitano sedeva DIETRO il desk invece che davanti)
	_desk_facing = def.get("facing", _desk_facing)
	position = _spot
	# gli agenti NON collidono tra loro (si incastravano nei passaggi):
	# restano solide solo le collisioni coi mobili (layer 1)
	collision_layer = 2
	collision_mask = 1
	# primo viaggio sparso su tutta la cadenza: niente fuggi-fuggi al boot
	_state_timer = _cadence() * randf_range(0.15, 1.0)
	_pose_timer = randf_range(12.0, 35.0)
	_bubble_timer = randf_range(2.0, 12.0)
	_consume_timer = randf_range(30.0, 70.0)

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

	speech = SpeechBubble.new()
	speech.position = Vector2(0, -100)
	add_child(speech)

## Fa dire all'agente un messaggio della chat reale (fumetto in coda).
## to_label: "" per i broadcast, altrimenti il nome del destinatario.
func say(text: String, to_label := "") -> void:
	speech.say(text, to_label)

## Entrata in scena: l'agente si materializza (energia tesseract) alla
## postazione. Da chiamare subito dopo setup().
func materialize() -> void:
	modulate.a = 0.0
	SpawnFx.burst(get_parent(), _spot)
	var tw := create_tween()
	tw.tween_interval(0.25)  # prima l'energia converge, poi il corpo appare
	tw.tween_property(self, "modulate:a", 1.0, 0.4)

## Uscita di scena: dissolve e si rimuove (con la sua pila di fogli).
## L'FX è sibling, così sopravvive al queue_free dell'agente.
func dissolve() -> void:
	if _dissolving:
		return
	_dissolving = true
	_set_desk_occupied(false)
	SpawnFx.burst(get_parent(), global_position, true)
	speech.clear_now()
	bubble.hide_now()
	var tw := create_tween()
	tw.tween_property(self, "modulate:a", 0.0, 0.45)
	tw.tween_callback(func() -> void:
		if pile:
			pile.queue_free()
		queue_free())

## Stato dal backend: con idle/paused/throttled niente viaggi né
## digitazione, l'agente resta alla postazione in attesa (seduto se ha
## lo sheet). Un throttle LUNGO manda invece in ricreazione (dado).
func set_backend_status(status: String) -> void:
	if backend_status == status:
		return
	backend_status = status
	if state == S.WORK:
		_work_pose()
		if status == "throttled" and throttle_secs >= REC_THROTTLE_SECS:
			_plan_recreation()

func set_throttle(secs: float) -> void:
	throttle_secs = secs

## Uscita FISICA di scena (agente killato/fermato, missione pipeline
## 20:1x): cammina fino alla porta dell'ufficio e svanisce oltre la
## soglia — niente tesseract, semplicemente non è più in ufficio.
func exit_through(door_spot: Vector2) -> void:
	if _dissolving or _exiting:
		return
	_exiting = true
	speech.clear_now()
	bubble.hide_now()
	var leg := _leg_to(door_spot, "walk", 0.0, "idle")
	leg["exit"] = true
	_legs = [leg]
	_start_next_leg()

## Un CV nuovo è pronto: lo scrittore lo porta FISICAMENTE allo
## scaffale output accanto alla porta (teatro sul dato vero, chiamato
## dalla scena quando cv_ready cresce).
func deliver_to_shelf() -> void:
	if state != S.WORK or backend_status != "working" or is_dissolving():
		return
	_legs = [
		_leg_to(OutputShelf.RECT.get_center() + Vector2(0, 46.0), "carry",
				randf_range(1.0, 1.8), "idle"),
		_leg_to(_spot, "walk", 0.0, "work"),
	]
	_start_next_leg()

## Throttle LUNGO: dado a 3 facce per l'attività ricreativa (ordine
## Leone 20:1x) — divano, ping-pong o si va a cucinare qualcosa.
func _plan_recreation() -> void:
	var picks := ["rec_sofa", "rec_pingpong", "rec_kitchenette"]
	var r := FurnitureDefs.get_rect(picks[randi() % picks.size()])
	var spot := Vector2(r.get_center().x, r.end.y + 26.0)
	_legs = [
		_leg_to(_jit(spot), "walk", randf_range(25.0, 45.0), "idle"),
		_leg_to(_spot, "walk", 0.0, "work"),
	]
	_start_next_leg()

## Reazione a una transizione REALE del registro attività: il corpo
## pulsa due volte (il lavoro vero si deve vedere in scena) e una
## scrittura CV accende la stampante dell'ufficio. Il fumetto con la
## posizione lavorata lo recapita office.gd via say().
func react_to_work(print_job := false) -> void:
	if _dissolving:
		return
	if print_job:
		PrinterFx.ping(4.0)
	var tw := create_tween()
	for _i in 2:
		tw.tween_property(rig, "modulate", Color(0.72, 1.3, 1.05), 0.16)
		tw.tween_property(rig, "modulate", Color.WHITE, 0.45)

func set_highlight(on: bool) -> void:
	if _highlight != on:
		_highlight = on
		queue_redraw()

## Interrogato con un click: si ferma e guarda in camera.
func start_talk() -> void:
	_set_desk_occupied(false)
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

func is_dissolving() -> bool:
	return _dissolving or _exiting

## True se il punto (click) cade sul corpo dell'agente.
func hit_by(point: Vector2) -> bool:
	# generoso di proposito (feedback test finale: il click sull'agente
	# "non fa nulla"): a zoom out il bersaglio su schermo è piccolo
	return point.distance_to(global_position + Vector2(0, -44)) < 68 \
			or point.distance_to(global_position) < 36

func _physics_process(delta: float) -> void:
	if _dissolving:
		velocity = Vector2.ZERO
		return
	_pulse += delta
	if _highlight:
		queue_redraw()
	_bubble_tick(delta)
	match state:
		S.WORK:
			velocity = Vector2.ZERO
			_tick_desk_pose(delta)
			_consume_tick(delta)
			_state_timer -= delta
			if _state_timer <= 0.0:
				_state_timer = _cadence() * randf_range(0.6, 1.4)
				if backend_status == "working":
					_plan_trip()
				elif backend_status == "throttled" \
						and throttle_secs >= REC_THROTTLE_SECS:
					# throttle ancora lungo: nuovo giro di ricreazione
					_state_timer = randf_range(70.0, 110.0)
					_plan_recreation()
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
## dei tick veri. Circa 70% del tempo in work. Da seduti la traccia è
## una sola ("sit"): l'alternanza pilota solo lo smaltimento pila.
func _tick_desk_pose(delta: float) -> void:
	_pose_timer -= delta
	if _pose_timer > 0.0:
		return
	_desk_working = not _desk_working and backend_status == "working"
	_pose_timer = randf_range(18.0, 40.0) if _desk_working else randf_range(6.0, 16.0)
	if _seated():
		_desk_motion("sit")
	else:
		_desk_motion("work" if _desk_working else "idle")

## Seduto alla postazione? Missione 16:10: la gran maggioranza SIEDE
## quando lavora; in piedi solo chi ha lo standing desk. Gated sul
## contratto rig (has_sit = lo sheet <slug>_sit.png esiste): senza
## texture l'offset farebbe solo salire l'agente SULLA sedia.
func _seated() -> bool:
	return not _standing and rig != null and rig.get("has_sit") == true

## Dove sta il corpo quando è seduto: AFFONDATO verso la scrivania così
## il piano copre le gambe e resta il busto dietro i monitor (feedback
## Leone 03:5x: con l'offset timido gli agenti erano appollaiati a
## mezz'aria SOPRA il mobile). Il y-sort fa il resto: il corpo resta a
## nord della baseline del desk e viene occluso dove si sovrappone.
func _seat_offset() -> Vector2:
	match _desk_facing:
		"up":
			return Vector2(0, -6)
		"left":
			return Vector2(-26, -2)
		"right":
			return Vector2(26, -2)
		_:
			return Vector2(0, _seat_sink)

## Lavorando la pila si smaltisce: un foglio ogni ~minuto di lavoro vero.
func _consume_tick(delta: float) -> void:
	if pile == null or not _desk_working:
		return
	_consume_timer -= delta
	if _consume_timer <= 0.0:
		_consume_timer = randf_range(40.0, 75.0)
		pile.take_sheet()

## set_motion coerente col verso della scrivania (left/right = side+flip).
func _desk_motion(mode: String) -> void:
	match _desk_facing:
		"left":
			rig.set_motion("side", true, mode)
		"right":
			rig.set_motion("side", false, mode)
		_:
			rig.set_motion(_desk_facing, false, mode)

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
	if dept == "analisti" and roll < 0.35:
		# banco-test (missione pipeline 3/3): si va a verificare in piedi
		# fra le bobine, poi si torna a scrivere il report alla scrivania
		_legs = [
			_leg_to(TestBench.work_spot(), "walk", randf_range(10.0, 20.0), "work"),
			_leg_to(_spot, "walk", 0.0, "work"),
		]
		_start_next_leg()
		return
	if dept == "critici" and roll < 0.40:
		# loop scrittore↔critico (3/3): il critico RITIRA fisicamente il
		# CV dagli scrittori, lo esamina nel suo ufficio e lo RIDÀ
		var wr_inbox: Vector2 = DepartmentDefs.DEPARTMENTS["scrittori"]["inbox"]
		var pick := _leg_to(_jit(wr_inbox), "walk", randf_range(0.8, 1.4), "idle")
		pick["pile_take"] = "scrittori"
		var back := _leg_to(_jit(wr_inbox), "carry", randf_range(0.6, 1.2), "idle")
		back["pile_drop"] = "scrittori"
		_legs = [
			pick,
			_leg_to(_spot, "carry", randf_range(14.0, 24.0), "work"),
			back,
			_leg_to(_spot, "walk", 0.0, "work"),
		]
		_start_next_leg()
		return
	if roll < 0.45:
		# stampa: vai alla stampante, aspetta il foglio, torna coi fogli
		var pr := _leg_to(_jit(pois["printer"]["spot"]), "walk",
				randf_range(1.5, 3.0), "idle")
		pr["fx_printer"] = true  # il macchinario si anima per la sosta
		_legs = [pr, _leg_to(_spot, "carry", 0.0, "work")]
	elif roll < 0.80 and DepartmentDefs.FETCH_FROM.has(dept):
		# ritiro: inbox del reparto a monte → inbox di casa → scrivania
		var src: String = DepartmentDefs.FETCH_FROM[dept]
		# il ritiro si vede sulle pile: l'inbox a monte si svuota, quello
		# di casa riceve una parte, il resto arriva FINO alla scrivania
		var pick := _leg_to(_jit(DepartmentDefs.DEPARTMENTS[src]["inbox"]), "walk",
				randf_range(0.8, 1.6), "idle")
		pick["pile_take"] = src
		var drop := _leg_to(_jit(DepartmentDefs.DEPARTMENTS[dept]["inbox"]), "carry",
				randf_range(0.5, 1.0), "idle")
		drop["pile_drop"] = dept
		_legs = [pick, drop, _leg_to(_spot, "carry", 0.0, "work")]
	elif roll < 0.88:
		# pausa caffè / macchinetta (raro: i tick non aspettano)
		var is_coffee := randf() < 0.7
		var poi: Vector2 = pois["coffee"]["spot"] if is_coffee \
				else pois["water_cooler"]["spot"]
		var cl := _leg_to(_jit(poi), "walk", randf_range(3.0, 7.0), "idle")
		if is_coffee:
			cl["fx_coffee"] = true  # il vapore sale finché è in pausa
		_legs = [cl, _leg_to(_spot, "walk", 0.0, "work")]
	elif roll < 0.94:
		# pausa vera in sala relax (rarissima, ma il divano esiste apposta)
		_legs = [
			_leg_to(_jit(pois["rec_room"]["spot"]), "walk", randf_range(5.0, 10.0), "idle"),
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
	_set_desk_occupied(false)  # ci si alza: il desk torna vuoto
	_leg = _legs.pop_front()
	_path = nav.path(global_position, _leg["target"])
	_pi = 0
	state = S.TRIP

func _arrive_at_leg() -> void:
	if _leg.get("exit", false):
		# sulla soglia: la porta scorre e l'agente svanisce oltre
		ExitDoor.swing()
		_dissolving = true
		rig.set_motion("down", false, "idle")  # la porta è a sud
		var tw := create_tween()
		tw.tween_property(self, "modulate:a", 0.0, 0.55)
		tw.tween_callback(func() -> void:
			if pile:
				pile.queue_free()
			queue_free())
		return
	if _leg.get("fx_printer", false):
		PrinterFx.ping(float(_leg.get("pause", 2.0)))
	if _leg.get("fx_coffee", false):
		CoffeeFx.ping(float(_leg.get("pause", 4.0)))
	# movimenti di fogli sugli inbox di reparto (pile condivise)
	if _leg.has("pile_take") and PaperPile.inbox.has(_leg["pile_take"]):
		PaperPile.inbox[_leg["pile_take"]].take_sheets(randi_range(2, 3))
	if _leg.has("pile_drop") and PaperPile.inbox.has(_leg["pile_drop"]):
		PaperPile.inbox[_leg["pile_drop"]].add_sheets(randi_range(1, 2))
	if float(_leg.get("pause", 0.0)) > 0.0:
		_pause = _leg["pause"]
		rig.set_motion(rig.facing, rig.flipped, _leg.get("pause_mode", "idle"))
	elif _legs.is_empty():
		_end_trip()
	else:
		_start_next_leg()

func _end_trip() -> void:
	# se l'ultimo tratto era un carry, i fogli si depositano sulla pila
	if pile and _leg.get("mode", "") == "carry":
		pile.add_sheets(randi_range(2, 4))
	state = S.WORK
	position = _spot
	_work_pose()

## Alla scrivania: rivolto secondo la postazione (down = viso in camera).
## Con la variante artistica "desk occupato" (ordine Leone 04:2x) il
## corpo seduto vive NELLA texture della scrivania: il rig si nasconde
## e il mobile scambia immagine. Senza variante, resta il rig seduto.
func _set_desk_occupied(on: bool) -> void:
	var node: FurnitureNode = FurnitureNode.desks.get(_desk_key)
	if node and node.has_seated_art():
		node.set_occupied(on)
		rig.visible = not on
	elif rig:
		rig.visible = true

func _work_pose() -> void:
	_desk_working = backend_status == "working"
	if _seated():
		position = _spot + _seat_offset()
		_desk_motion("sit")
		_set_desk_occupied(true)
	else:
		_desk_motion("work" if _desk_working else "idle")

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
	# coi dati VERI il chatter di ambientazione tace: sotto il badge
	# "DATI REALI" parlano solo i messaggi autentici (SpeechBubble)
	if BackendBus.is_live():
		bubble.hide_now()
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
