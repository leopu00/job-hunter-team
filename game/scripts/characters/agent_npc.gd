class_name AgentNPC
extends CharacterBody2D
## Un agente del team in ufficio: sta alla sua postazione (alterna digitare
## e pensare, come i tick veri) e OGNI TANTO — a cadenza calibrata sui dati
## di attività reali — parte per un viaggio di lavoro visibile: stampante
## (torna coi fogli), ritiro dall'inbox del reparto a monte, raro caffè.
## Mostra status bubble e si interroga con un click.

const SPEED := 150.0
const STATUS_BUBBLE_POS := Vector2(0, -96)
const SPEECH_BUBBLE_POS := Vector2(0, -100)
const STATE_TAG_POS := Vector2(0, -126)

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
	"coordinatore": 90.0,  # alterna spesso scrivania e giro dei reparti
	"mentor": 1800.0,  # circa ogni mezz'ora: libro, lavagna, ritorno al divano
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
var state_tag: AgentStateTag
## Stato riportato dal backend: working|idle|paused. Con idle/paused
## l'agente resta alla postazione senza viaggi né digitazione.
var backend_status := "working"
var activity_detail := ""
## Stima secondi di throttle rimanenti (contratto additivo col backend):
## resta fermo alla postazione e il countdown spiega il motivo.
var throttle_secs := 0.0
var _dissolving := false
var _exiting := false
var _exit_pending := false
var _pending_exit_spot := Vector2.ZERO

var state: S = S.WORK
var _spot := Vector2.ZERO
var _desk_facing := "down"
var pile: PaperPile  # i fogli accumulati sulla MIA scrivania
var _consume_timer := 0.0
var _standing := false  # standing desk (dado 16:10): lavora in piedi
var _has_workstation := false
var _seat_sink := 90.0  # baseline appena dietro quella del desk
var _custom_seat_offset := Vector2.ZERO
var _has_custom_seat_offset := false
var _desk_key := ""  # chiave nel registry FurnitureNode.desks
var _chatter: Array = []
var _wander: Array = []  # solo core (mentor/coordinatore/assistente/sentinella)

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
var _forced_trip := false  # visite chat-driven: finiscono anche se passa idle
var _investigation_count := 0
var _pending_pipeline: Array[bool] = []
var _pipeline_trip_active := false
var _pipeline_trip_count := 0

func setup(def: Dictionary, p_nav: NavGrid) -> void:
	nav = p_nav
	slug = def["slug"]
	display_name = def["name"]
	dept = def.get("dept", "")
	_has_workstation = dept != "" or def.has("workstation_key") \
			or slug == "assistente"
	_spot = def["spot"]
	_chatter = def.get("chatter", [])
	_wander = def.get("wander", [])
	_desk_key = str(def.get("workstation_key", ""))
	if dept != "":
		var desk: Dictionary = DepartmentDefs.DEPARTMENTS[dept]["desks"][def["desk"]]
		_desk_facing = desk.get("facing", "down")
		_standing = desk.get("standing", false)
		# affondo per-scrivania: le texture col fronte-camera alto (monitor
		# multipli) chiedono più profondità del default
		_seat_sink = float(desk.get("seat_sink", _seat_sink))
		if desk.has("seat_offset"):
			_custom_seat_offset = desk["seat_offset"]
			_has_custom_seat_offset = true
		_desk_key = "%s:%d" % [dept, def["desk"]]
		# Alcune viste frontali nuove includono già la sedia sul lato interno.
		# Non sovrapporre la vecchia sedia separata all'asset integrato.
		if _desk_facing == "down" and not bool(desk.get("integrated_chair", false)):
			_ensure_front_chair(desk)
		# Le texture delle postazioni contengono già strumenti e documenti.
		# Una seconda PaperPile composta sopra il mobile produceva risme
		# sospese e fuori prospettiva. Le pile animate restano soltanto negli
		# inbox condivisi, dove hanno un significato nel flusso di lavoro.
	# i core con scrivania personale dichiarano il verso nel def (fix
	# test finale: il Capitano sedeva DIETRO il desk invece che davanti)
	_desk_facing = def.get("facing", _desk_facing)
	if def.has("seat_offset"):
		_custom_seat_offset = def["seat_offset"]
		_has_custom_seat_offset = true
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
	bubble.position = STATUS_BUBBLE_POS
	add_child(bubble)

	speech = SpeechBubble.new()
	speech.position = SPEECH_BUBBLE_POS
	add_child(speech)

	state_tag = AgentStateTag.new()
	state_tag.position = STATE_TAG_POS
	add_child(state_tag)
	state_tag.set_state(backend_status, throttle_secs, activity_detail)
	# _work_pose() viene eseguito prima che badge e fumetti esistano: ripeti
	# l'aggancio ora, così l'offset del composito non viene perso al bootstrap.
	if _seated():
		_set_desk_occupied(true)

## Le viste frontali delle scrivanie non includono una sedia (nelle viste
## up/side è già dipinta nella texture). La aggiungiamo come sibling y-sort:
## sedia → agente → desk, tutti su baseline distinte di pochi pixel.
func _ensure_front_chair(desk: Dictionary) -> void:
	if FurnitureNode.front_chairs.has(_desk_key):
		return
	var path := "res://assets/gen-art/furniture/office_chair_front.png"
	if not ResourceLoader.exists(path):
		return
	var tex: Texture2D = load(path)
	if tex == null:
		return
	var r: Rect2 = desk["rect"]
	var chair := Sprite2D.new()
	chair.name = "FrontChair_%s" % _desk_key.replace(":", "_")
	chair.texture = tex
	chair.centered = false
	chair.offset = Vector2(-tex.get_size().x / 2.0, -tex.get_size().y)
	chair.scale = Vector2(0.12, 0.09)
	chair.position = Vector2(r.get_center().x, r.end.y - 3.0)
	get_parent().add_child(chair)
	FurnitureNode.front_chairs[_desk_key] = chair

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
## lo sheet). Nessuna passeggiata ricreativa inventata dai dati.
func set_backend_status(status: String) -> void:
	status = status if status in ["working", "idle", "paused", "throttled", "resting"] else "idle"
	var changed := backend_status != status
	backend_status = status
	if state_tag:
		state_tag.set_state(backend_status, throttle_secs, activity_detail)
	if changed and state == S.WORK:
		_work_pose()
	elif changed and state == S.TRIP and backend_status != "working" and not _forced_trip:
		velocity = Vector2.ZERO
		rig.set_motion(rig.facing, rig.flipped, "still")

func set_throttle(secs: float) -> void:
	throttle_secs = secs
	if state_tag:
		state_tag.set_state(backend_status, throttle_secs, activity_detail)

func set_activity_detail(detail: String) -> void:
	activity_detail = detail
	if state_tag:
		state_tag.set_state(backend_status, throttle_secs, activity_detail)

## Uscita FISICA di scena (agente killato/fermato, missione pipeline
## 20:1x): cammina fino alla porta dell'ufficio e svanisce oltre la
## soglia — niente tesseract, semplicemente non è più in ufficio.
func exit_through(door_spot: Vector2) -> void:
	if _dissolving or _exiting or _exit_pending:
		return
	# Un messaggio gia mostrato mantiene il contratto di un minuto anche se
	# la sessione tmux termina: l'avatar aspetta, poi esce fisicamente.
	if speech and speech.is_speaking():
		_exit_pending = true
		_pending_exit_spot = door_spot
		backend_status = "idle"
		state = S.WORK
		velocity = Vector2.ZERO
		bubble.hide_now()
		_work_pose()
		return
	_begin_exit(door_spot)

func _begin_exit(door_spot: Vector2) -> void:
	_exiting = true
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

## Reazione a una transizione REALE del registro attività: il corpo
## pulsa due volte (il lavoro vero si deve vedere in scena) e una
## scrittura CV accende la stampante dell'ufficio. Il fumetto con la
## posizione lavorata lo recapita office.gd via say().
func react_to_work(print_job := false) -> void:
	if _dissolving:
		return
	if print_job:
		PrinterFx.ping(4.0)
	# col seated art il rig è nascosto (il corpo vive nella texture del
	# desk): il lampo del lavoro reale pulsa sul mobile, non sul rig
	if rig and not rig.visible:
		var node: FurnitureNode = FurnitureNode.desks.get(_desk_key)
		if node:
			node.flash()
		return
	var tw := create_tween()
	for _i in 2:
		tw.tween_property(rig, "modulate", Color(0.72, 1.3, 1.05), 0.16)
		tw.tween_property(rig, "modulate", Color.WHITE, 0.45)

## Una transizione REALE della pipeline diventa un viaggio fisico. Non è un
## giro casuale: ogni ruolo preleva l'output del precedente, lavora seduto e
## deposita il foglio nella vaschetta destinata al reparto successivo.
func perform_pipeline_step(force_observed := false) -> void:
	if is_dissolving():
		return
	# Una raffica di transizioni dello stesso agente non deve perdersi mentre
	# sta gia portando un foglio. La coda e corta ma causale e, per eventi
	# reali osservati nel DB, resta valida anche se il pane e gia tornato idle.
	if state != S.WORK:
		_pending_pipeline.append(force_observed)
		if _pending_pipeline.size() > 8:
			_pending_pipeline.pop_front()
		# Un evento DB autoritativo sblocca anche il viaggio gia in corso:
		# altrimenti un poll idle lo congelerebbe prima di raggiungere la coda.
		if force_observed and state == S.TRIP:
			_forced_trip = true
		return
	if backend_status != "working" and not force_observed:
		return
	if _prepare_pipeline_trip():
		_pipeline_trip_active = true
		_forced_trip = force_observed
		_start_next_leg()

## Una chat mirata del Dottore diventa una visita fisica: si ferma accanto
## al destinatario (mai sullo stesso punto), mostra la vignetta e rientra.
## È un'azione già osservata, quindi non viene interrotta da uno snapshot
## backend idle arrivato mentre il Dottore è in cammino.
func investigate_agent(target: AgentNPC, text: String) -> bool:
	if target == null or target == self or is_dissolving() or state == S.TALK:
		return false
	var approach := nav.approach_point(global_position, target.global_position)
	var inspect := _leg_to(approach, "walk", 4.5, "idle")
	inspect["investigation_text"] = text
	inspect["investigation_target"] = target.display_name
	_forced_trip = true
	_legs = [inspect, _leg_to(_spot, "walk", 0.0, "work")]
	_start_next_leg()
	return true

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
	# da seduti la position è affondata nel desk (seat_sink/offset): il
	# rig che riappare per il dialogo si alza in piedi alla postazione,
	# non dentro il mobile
	if _seated():
		position = _spot
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
	if _exit_pending and (speech == null or not speech.is_speaking()):
		_exit_pending = false
		_begin_exit(_pending_exit_spot)
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
				_state_timer = _next_trip_delay()
				# Con dati reali nessun tragitto inventato: il movimento nasce
				# soltanto da attività/transizioni osservate. Il teatro casuale
				# resta disponibile esclusivamente nella demo offline.
				# Capitano, Tesoriere e Mentor pattugliano davvero anche in live. Il
				# Mentor si muove molto meno: la sua cadenza media è mezz'ora.
				var live_patrol := slug in ["coordinatore", "sentinella", "mentor"]
				if backend_status == "working" and (live_patrol \
						or BackendBus.state != BackendBus.CONNECTED):
					_plan_trip()
		S.TRIP:
			if backend_status != "working" and not _exiting and not _forced_trip:
				velocity = Vector2.ZERO
				rig.set_motion(rig.facing, rig.flipped, "still")
			elif _pause > 0.0:
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

func _next_trip_delay() -> float:
	# Il rituale del Mentor deve restare davvero vicino alla mezz'ora; il
	# jitter largo degli altri agenti lo anticiperebbe anche a soli 18 minuti.
	if slug == "mentor":
		return _cadence() * randf_range(0.95, 1.05)
	return _cadence() * randf_range(0.6, 1.4)

## Alterna digitazione (work) e pensiero (idle) alla postazione: il ritmo
## dei tick veri. Circa 70% del tempo in work. Da seduti la traccia è
## una sola ("sit"): l'alternanza pilota solo lo smaltimento pila.
func _tick_desk_pose(delta: float) -> void:
	if backend_status != "working":
		_desk_working = false
		return
	_pose_timer -= delta
	if _pose_timer > 0.0:
		return
	_desk_working = not _desk_working and backend_status == "working"
	_pose_timer = randf_range(18.0, 40.0) if _desk_working else randf_range(6.0, 16.0)
	if _seated():
		_desk_motion("sit")
	else:
		_desk_motion("work")

## Seduto alla postazione? Missione 16:10: la gran maggioranza SIEDE
## quando lavora; in piedi solo chi ha lo standing desk. Gated sul
## contratto rig (has_sit) oppure sull'illustrazione composita registrata.
## Quest'ultima permette ai core senza sheet seduto di usare un asset unico.
func _seated() -> bool:
	if not _has_workstation or _standing or rig == null:
		return false
	if rig.get("has_sit") == true:
		return true
	var desk_node: FurnitureNode = FurnitureNode.desks.get(_desk_key)
	return desk_node != null and desk_node.has_seated_art()

## Dove sta il corpo quando è seduto: AFFONDATO verso la scrivania così
## il piano copre le gambe e resta il busto dietro i monitor (feedback
## Leone 03:5x: con l'offset timido gli agenti erano appollaiati a
## mezz'aria SOPRA il mobile). Il y-sort fa il resto: il corpo resta a
## nord della baseline del desk e viene occluso dove si sovrappone.
func _seat_offset() -> Vector2:
	if _has_custom_seat_offset:
		return _custom_seat_offset
	match _desk_facing:
		"up":
			# desk_spot(up) è r.end.y + 24; la sedia dipinta nella texture è
			# invece ancorata a r.end.y. Allineando qui le due baseline, il
			# bacino entra nel sedile e il corpo resta dentro braccioli/schienale,
			# anziché 18 px davanti alla sedia.
			return Vector2(0, -24)
		"left":
			return Vector2(-26, -2)
		"right":
			return Vector2(26, -2)
		"down":
			# La vista ore 6 contiene la sedia sul lato nord del desk. La
			# baseline del rig deve superare di pochi pixel quella del mobile:
			# così il busto frontale resta visibile invece di sparire interamente
			# dietro la fascia, mentre la posa seduta conserva gambe raccolte.
			return Vector2(0, 95)
		_:
			return Vector2(0, _seat_sink)

## Il composito occupato è disegnato dal nodo scrivania, non dal rig agente:
## il centro logico resta sul sedile ma la testa visibile cambia posizione in
## base alla prospettiva. Questa correzione porta codino e badge sopra la
## testa per tutte le quattro viste usate dai cinque reparti.
func _composite_overhead_delta() -> Vector2:
	# La poltrona del Mentor è volutamente piccola: il delta dei desk
	# direzionali lascerebbe il badge sospeso troppo lontano dalla testa.
	if _desk_key == "core:mentor":
		return Vector2(0, -16)
	# I due desk direzionali hanno schienale e busto più alti delle postazioni
	# radiali: il delta standard metterebbe il badge esattamente sul volto.
	if _desk_key.begins_with("core:"):
		return Vector2(0, -58)
	if _has_custom_seat_offset:
		var side := signf(_custom_seat_offset.x)
		var diagonal := absf(_custom_seat_offset.y) > 20.0
		return Vector2(-side * (14.0 if diagonal else 20.0),
				-18.0 if diagonal else -30.0)
	match _desk_facing:
		"up":
			return Vector2(0, -14)
		"down":
			return Vector2(0, -10)
		_:
			return Vector2.ZERO

func _set_overhead_delta(delta: Vector2) -> void:
	if bubble:
		bubble.position = STATUS_BUBBLE_POS + delta
	if speech:
		speech.position = SPEECH_BUBBLE_POS + delta
	if state_tag:
		state_tag.position = STATE_TAG_POS + delta

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

## Avvio esplicito della ronda dei ruoli core; usato dal controllo visuale e
## disponibile agli eventi reali senza esporre la costruzione delle tappe.
func perform_patrol() -> void:
	if dept == "" and not _wander.is_empty() and state == S.WORK:
		_plan_trip()

## Sceglie il prossimo viaggio in base al ruolo. La cadenza è già rara
## (TRIP_EVERY): quando il timer scatta il motivo è quasi sempre di lavoro
## — stampa o ritiro fogli; caffè e ologramma sono l'eccezione.
func _plan_trip() -> void:
	_legs = []
	if dept == "":
		# Il Mentor compie sempre il piccolo rituale completo: libreria,
		# lavagna, poi divanetto. Non sceglie una sola meta casuale, così le
		# diverse posizioni richieste restano tutte osservabili.
		if _wander.is_empty():
			return
		if slug == "mentor" and _wander.size() >= 2:
			_legs = [
				_leg_to(_wander[0], "walk", randf_range(5.0, 8.0), "idle"),
				_leg_to(_wander[1], "walk", randf_range(7.0, 12.0), "idle"),
				_leg_to(_spot, "walk", 0.0, "work"),
			]
			_start_next_leg()
			return
		# Gli altri core scelgono una tappa della propria ronda e rientrano.
		_legs = [
			_leg_to(_jit(_wander[randi() % _wander.size()]), "walk",
					randf_range(3.0, 7.0), "idle"),
			_leg_to(_spot, "walk", 0.0, "work"),
		]
		_start_next_leg()
		return
	# Nella demo offline usiamo la stessa catena causale della VPS. Le pause
	# ricreative restano rare; il comportamento dominante è il lavoro.
	if randf() < 0.90 and _prepare_pipeline_trip():
		_start_next_leg()
		return
	var pois := DepartmentDefs.POIS
	var roll := randf()
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
	else:
		# un'occhiata all'ologramma della ricerca
		_legs = [
			_leg_to(_jit(pois["hologram"]["spot"]), "walk", randf_range(2.0, 5.0), "idle"),
			_leg_to(_spot, "walk", 0.0, "work"),
		]
	_start_next_leg()

## Prepara, senza avviarlo, il percorso di produzione del ruolo corrente.
## Le pile registrate in PaperPile.inbox sono OUTPUT: chi sta a valle prende
## dal reparto precedente e deposita nel proprio punto di consegna.
func _prepare_pipeline_trip() -> bool:
	_legs = []
	var home_out: Vector2 = DepartmentDefs.DEPARTMENTS[dept]["inbox"]
	if dept == "scout":
		var pr := _leg_to(DepartmentDefs.POIS["printer"]["spot"], "walk",
				randf_range(1.8, 3.0), "idle")
		pr["fx_printer"] = true
		var read := _leg_to(_spot, "carry", randf_range(8.0, 14.0), "work")
		read["desk_work"] = true
		var deliver := _leg_to(home_out, "carry", randf_range(0.8, 1.4), "idle")
		deliver["pile_drop"] = dept
		_legs = [pr, read, deliver, _leg_to(_spot, "walk", 0.0, "work")]
		return true
	if not DepartmentDefs.FETCH_FROM.has(dept):
		return false
	var src: String = DepartmentDefs.FETCH_FROM[dept]
	var pick := _leg_to(DepartmentDefs.DEPARTMENTS[src]["inbox"], "walk",
			randf_range(0.8, 1.4), "idle")
	pick["pile_take"] = src
	var durations := {
		"analisti": Vector2(10.0, 18.0), "scorer": Vector2(8.0, 15.0),
		"scrittori": Vector2(14.0, 24.0), "critici": Vector2(9.0, 16.0),
	}
	var window: Vector2 = durations.get(dept, Vector2(8.0, 14.0))
	var process := _leg_to(_spot, "carry", randf_range(window.x, window.y), "work")
	process["desk_work"] = true
	var deliver := _leg_to(home_out, "carry", randf_range(0.8, 1.4), "idle")
	deliver["pile_drop"] = dept
	_legs = [pick, process, deliver, _leg_to(_spot, "walk", 0.0, "work")]
	return true

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
	if _leg.has("investigation_text"):
		say(str(_leg["investigation_text"]), str(_leg.get("investigation_target", "")))
		_investigation_count += 1
	# movimenti di fogli sugli inbox di reparto (pile condivise)
	if _leg.has("pile_take") and PaperPile.inbox.has(_leg["pile_take"]):
		PaperPile.inbox[_leg["pile_take"]].take_sheets(randi_range(2, 3))
	if _leg.has("pile_drop") and PaperPile.inbox.has(_leg["pile_drop"]):
		PaperPile.inbox[_leg["pile_drop"]].add_sheets(randi_range(1, 2))
	if float(_leg.get("pause", 0.0)) > 0.0:
		_pause = _leg["pause"]
		if _leg.get("desk_work", false):
			position = _spot + (_seat_offset() if _seated() else Vector2.ZERO)
			_desk_motion("sit" if _seated() else "work")
			_set_desk_occupied(true)
		else:
			rig.set_motion(rig.facing, rig.flipped, _leg.get("pause_mode", "idle"))
	elif _legs.is_empty():
		_end_trip()
	else:
		_start_next_leg()

func _end_trip() -> void:
	# se l'ultimo tratto era un carry, i fogli si depositano sulla pila
	if pile and _leg.get("mode", "") == "carry":
		pile.add_sheets(randi_range(2, 4))
	var completed_pipeline := _pipeline_trip_active
	_pipeline_trip_active = false
	_forced_trip = false
	state = S.WORK
	position = _spot
	_work_pose()
	if completed_pipeline:
		_pipeline_trip_count += 1
	if not _pending_pipeline.is_empty():
		var force_next: bool = _pending_pipeline.pop_front()
		perform_pipeline_step.call_deferred(force_next)

## Alla scrivania: rivolto secondo la postazione (down = viso in camera).
## Le postazioni pilota possono sostituire il rig con un'unica illustrazione
## desk+sedia+agente: quando si alza, torna il desk vuoto e il rig ricompare.
func _set_desk_occupied(on: bool) -> void:
	var desk_node: FurnitureNode = FurnitureNode.desks.get(_desk_key)
	var use_composite := _seated() and desk_node != null \
			and desk_node.has_seated_art()
	if desk_node and desk_node.has_seated_art():
		desk_node.set_occupied(on and use_composite)
	if rig:
		rig.visible = not (on and use_composite)
	var overhead_delta := Vector2.ZERO
	if on and use_composite:
		overhead_delta = _composite_overhead_delta()
	elif slug in ["coordinatore", "sentinella", "mentor", "mantenitore", "dottore"]:
		# I fogli di cammino dei core sono più alti del roster standard: badge
		# e vignette devono partire sopra la testa, mai dalla schiena.
		overhead_delta = Vector2(0, -42)
	_set_overhead_delta(overhead_delta)
	if _seated():
		if on:
			# Sedersi richiede la sovrapposizione col desk; senza maschera zero
			# move_and_slide depenetra l'avatar fuori dalla sedia.
			collision_mask = 0
		else:
			# Prima ci si rialza nel punto navigabile, poi tornano solide le pareti.
			position = _spot
			collision_mask = 1
	else:
		collision_mask = 1

func _work_pose() -> void:
	_desk_working = backend_status == "working"
	if _seated():
		# Il corpo seduto deve sovrapporsi volontariamente alla sagoma della
		# scrivania. Lasciare attiva la collisione lo espelleva dal sedile al
		# frame seguente (la causa degli avatar sospesi davanti alla sedia).
		position = _spot + _seat_offset()
		_desk_motion("sit" if _desk_working else "sit_idle")
		_set_desk_occupied(true)
	else:
		_desk_motion("work" if _desk_working else "still")
	if state_tag:
		state_tag.set_state(backend_status, throttle_secs, activity_detail)

func debug_snapshot() -> Dictionary:
	return {"uid": uid, "status": backend_status, "state": int(state),
			"motion": str(rig.mode if rig else ""), "speed": velocity.length(),
			"visible": visible, "detail": activity_detail,
			"forced_trip": _forced_trip, "home": _spot,
			"work_position": _spot + (_seat_offset() if _seated() else Vector2.ZERO),
			"collision_mask": collision_mask,
			"position": global_position,
			"investigations": _investigation_count,
			"pipeline_trips": _pipeline_trip_count,
			"pending_pipeline": _pending_pipeline.size()}

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
