extends Node2D
## La box: pavimento, mobili, luci, navigazione e agenti al lavoro.
## Nessun personaggio-utente: si osserva con la FreeCamera e si clicca
## su agenti e reparti. Il layout vive in FurnitureDefs + DepartmentDefs,
## il roster in CharacterDefs.

var nav := NavGrid.new()
var world: Node2D
var agents: Array[AgentNPC] = []
var _hover_agent: AgentNPC
var _team_hud: TeamHud
var _camera: FreeCamera
var _seat_audit := ""
var _doctor_test := ""

func _ready() -> void:
	_seat_audit = OS.get_environment("JHT_SEAT_AUDIT")
	_doctor_test = OS.get_environment("JHT_DOCTOR_TEST")
	add_child(OfficeFloor.new())
	add_child(DepartmentDressing.new())  # tinte/targhe dei 5 reparti (dev-art)
	add_child(DeptRugs.new())  # tappetoni tondi colore-reparto (reference)
	# giorno/notte sull'ora locale: esterno, lampade e luce dalle finestre.
	# Va qui, PRIMA di mondo e maintainer, che devono disegnarsi sopra.
	add_child(DayNight.new())
	if OS.get_environment("JHT_ONLYFLOOR") == "1":  # TEST-AUTO
		var c := Camera2D.new()
		c.position = Vector2(1300, 750)
		add_child(c)
		c.make_current()
		return

	world = Node2D.new()
	world.name = "World"
	world.y_sort_enabled = true
	add_child(world)
	# la porta dell'ufficio (perimetro sud, accanto all'entrata): da qui
	# escono gli agenti killati/fermati — missione pipeline 20:1x
	world.add_child(ExitDoor.new(EXIT_DOOR))
	# lo scaffale dei CV PRONTI accanto alla porta (sezione output 3/3)
	world.add_child(OutputShelf.new())
	world.add_child(_invisible_wall(OutputShelf.RECT))
	for item in FurnitureDefs.ITEMS:
		if item["kind"] == "hologram":
			world.add_child(Hologram.new(item["rect"]))
			world.add_child(_invisible_wall(item["rect"]))
		else:
			world.add_child(FurnitureNode.new(item))

	# postazioni dei 5 reparti: stesso FurnitureNode dei mobili, kind variati;
	# facing passa al visual (texture orientate _down/_side/_up, dev-art).
	# Ogni postazione ha un visual completo con sedia nello stesso verso.
	FurnitureNode.desks = {}
	FurnitureNode.front_chairs = {}
	for d in DepartmentDefs.all_desks():
		# Le scrivanie pittoriche sono già complete. Il vecchio DeskClutter
		# duplicava tazze/fogli con icone flat sospese e senza prospettiva.
		if d["kind"] == "none":
			continue
		var desk_item := {
			"id": "desk_%s_%d" % [d["dept"], d["index"]],
			"kind": d["kind"],
			"rect": d["rect"],
			"facing": d.get("facing", "down"),
			"tex_facing": d.get("tex_facing", d.get("facing", "down")),
		}
		if d.has("front_occlusion"):
			desk_item["front_occlusion"] = d["front_occlusion"]
		# Override opzionale dell'arte occupata: normalmente FurnitureNode
		# risolve la variante seduta dalla vista orientata; i prototipi già
		# approvati possono fissare qui un path specifico.
		if d.has("seated_art"):
			desk_item["seated_art"] = d["seated_art"]
		var desk_node := FurnitureNode.new(desk_item)
		world.add_child(desk_node)
		# registry per lo scambio vuota/occupata quando l'agente si siede
		FurnitureNode.desks["%s:%d" % [d["dept"], d["index"]]] = desk_node

	for r in [FurnitureDefs.LAB_WALL_V, FurnitureDefs.LAB_WALL_H1, FurnitureDefs.LAB_WALL_H2]:
		world.add_child(_invisible_wall(r))
	# vetrate dei reparti: collisioni sottili, il visual è in OfficeFloor
	for r in DepartmentDefs.GLASS_WALLS:
		world.add_child(_invisible_wall(r))
	_add_perimeter_walls()

	nav.build(FurnitureDefs.FLOOR, FurnitureDefs.obstacles()
			+ DepartmentDefs.obstacles() + DepartmentDefs.GLASS_WALLS
			+ [OutputShelf.RECT])

	# i macchinari si animano quando qualcuno li usa (ping da AgentNPC)
	world.add_child(PrinterFx.new(FurnitureDefs.get_rect("printer")))
	world.add_child(CoffeeFx.new(FurnitureDefs.get_rect("coffee_bar")))
	match OS.get_environment("JHT_FX"):  # TEST-AUTO: effetto forzato
		"printer":
			PrinterFx.ping(20.0)
		"coffee":
			CoffeeFx.ping(20.0)

	# Punti di consegna tra reparti. Ogni pila vive dentro una vaschetta
	# fisica etichettata: Scout → Analisti → Scorer → Scrittori → Critici.
	# Quella degli Scorer è il deposito unico richiesto dagli Scrittori.
	PaperPile.inbox = {}
	var handoff_to := {
		"scout": "Analisti", "analisti": "Scorer", "scorer": "Scrittori",
		"scrittori": "Critici", "critici": "Pronti",
	}
	for dept_id in DepartmentDefs.DEPT_ORDER:
		var inbox_pos: Vector2 = DepartmentDefs.DEPARTMENTS[dept_id]["inbox"]
		var dept_color: Color = DepartmentDefs.DEPARTMENTS[dept_id]["color"]
		world.add_child(HandoffStation.new(dept_id, inbox_pos,
				handoff_to[dept_id], dept_color))
		var p := PaperPile.new(Rect2(inbox_pos - Vector2(28, 16), Vector2(56, 32)))
		# gli Scout producono e basta: il loro inbox si riempie più svelto
		p.restock = 90.0 if DepartmentDefs.FETCH_FROM.has(dept_id) else 45.0
		p.add_sheets(randi_range(1, 6))
		world.add_child(p)
		PaperPile.inbox[dept_id] = p

	# Ambientazione offline sobria: solo lead e core. Se una VPS è già in
	# connessione (o parte il mock), NON mostriamo comparse provvisorie:
	# l'ufficio resta vuoto fino al primo snapshot autorevole.
	var backend_expected := _doctor_test == "" and (\
			BackendBus.state != BackendBus.DISCONNECTED \
			or OS.get_environment("JHT_BACKEND_TEST") == "1")
	for def in CharacterDefs.spawn_list():
		if _seat_audit != "":
			var audit_parts := _seat_audit.split(":")
			if audit_parts.size() != 2 or def.get("dept", "") != audit_parts[0] \
					or int(def.get("desk", -1)) != int(audit_parts[1]):
				continue
		# Nel gioco offline normale bastano i lead; l'audit invece deve poter
		# materializzare anche desk 0..5 e controllare davvero ogni seduta.
		elif backend_expected or not def.get("lead", false):
			continue
		var agent := AgentNPC.new()
		world.add_child(agent)
		agent.setup(def, nav)
		agents.append(agent)

	add_child(TesseractEdges.new())  # gli spigoli blu della box (trasparenti)
	add_child(Sfx.make_ambient_hum())

	_camera = FreeCamera.new()
	add_child(_camera)
	_camera.clicked.connect(_on_world_click)
	if _seat_audit != "":
		var audit_parts := _seat_audit.split(":")
		if audit_parts.size() == 2 and DepartmentDefs.DEPARTMENTS.has(audit_parts[0]):
			var audit_desks: Array = DepartmentDefs.DEPARTMENTS[audit_parts[0]]["desks"]
			var audit_i := int(audit_parts[1])
			if audit_i >= 0 and audit_i < audit_desks.size():
				var audit_cam := Camera2D.new()
				var audit_rect: Rect2 = audit_desks[audit_i]["rect"]
				audit_cam.position = audit_rect.get_center() + Vector2(0, 8)
				audit_cam.zoom = Vector2(2.6, 2.6)
				add_child(audit_cam)
				audit_cam.make_current()

	if OS.get_environment("JHT_OVERVIEW") == "1":  # TEST-AUTO: tutta la box in un frame
		var ov := Camera2D.new()
		ov.position = FurnitureDefs.WORLD.get_center()
		var vp := get_viewport_rect().size
		var z := minf(vp.x / FurnitureDefs.WORLD.size.x, vp.y / FurnitureDefs.WORLD.size.y)
		ov.zoom = Vector2(z, z)
		add_child(ov)
		ov.make_current()
	elif OS.get_environment("JHT_FOCUS_DEPT") != "":
		var focus_id := OS.get_environment("JHT_FOCUS_DEPT")
		if DepartmentDefs.DEPARTMENTS.has(focus_id):
			var focus_cam := Camera2D.new()
			var zone: Rect2 = DepartmentDefs.DEPARTMENTS[focus_id]["zone"]
			focus_cam.position = zone.get_center()
			focus_cam.zoom = Vector2(1.65, 1.65)
			add_child(focus_cam)
			focus_cam.make_current()

	if _seat_audit == "" and _doctor_test == "":
		_add_hud()
		add_child(GameSidebar.new())  # sidebar stile desktop-app (linguetta ≡)

	Log.info("scene", "ufficio pronto: %d agenti, %d postazioni reparto, mondo %v" % [
			agents.size(), DepartmentDefs.all_desks().size(), FurnitureDefs.WORLD.size])

	# TEST-AUTO: JHT_DEPT=<id> apre il pannello di quel reparto all'avvio;
	# JHT_CARD=<slug> apre la scheda del primo agente con quel ruolo.
	var dept_test := OS.get_environment("JHT_DEPT")
	if dept_test != "" and DepartmentDefs.DEPARTMENTS.has(dept_test):
		_open_dept(dept_test)
	var card_test := OS.get_environment("JHT_CARD")
	if card_test != "":
		for a in agents:
			if a.slug == card_test:
				_open_agent_card(a)
				break
	# TEST-AUTO: JHT_REGISTRY=1 apre il registro candidature (TAB) —
	# ritardato al primo snapshot così lo shot mostra i dati veri
	if OS.get_environment("JHT_REGISTRY") == "1":
		BackendBus.positions_updated.connect(func(_l: Array) -> void:
			if _registry == null:
				_registry = RegistryPanel.new()
				add_child(_registry))
	# TEST-AUTO: apre l'archivio dello scaffale quando arriva lo snapshot.
	if OS.get_environment("JHT_CV_SHELF") == "1":
		BackendBus.positions_updated.connect(func(_l: Array) -> void:
			if _cv_shelf_panel == null:
				_open_cv_shelf())
	# TEST-AUTO: apre una delle cinque code fisiche col primo snapshot.
	var queue_test := OS.get_environment("JHT_PIPELINE_QUEUE")
	if DepartmentDefs.DEPT_ORDER.has(queue_test):
		BackendBus.positions_updated.connect(func(_l: Array) -> void:
			if _queue_panel == null:
				_open_pipeline_queue(queue_test))

	# TEST-AUTO: JHT_SEARCH=<query> apre la GlobalSearch precompilata
	# (il refresh con le posizioni vere arriva col primo snapshot)
	var search_test := OS.get_environment("JHT_SEARCH")
	if search_test != "":
		_toggle_search()
		_search.set_query.call_deferred(search_test)
		BackendBus.positions_updated.connect(func(_l: Array) -> void:
			if _search:
				_search.set_query(search_test))

	# La scena vive sul BackendBus: roster reale → spawn/despawn,
	# chat del team → fumetti. Se un backend è già connesso (snapshot
	# presente), la scena si allinea subito.
	if _seat_audit == "" and _doctor_test == "":
		BackendBus.agents_updated.connect(sync_agents)
		BackendBus.chat_message.connect(_on_chat_message)
		BackendBus.positions_updated.connect(_on_transitions)
		if not BackendBus.agents.is_empty():
			sync_agents(BackendBus.agents)
		if not BackendBus.transitions.is_empty():
			_on_transitions([])  # snapshot già sul bus: assorbito come baseline

	# TEST-AUTO: JHT_BACKEND_TEST=1 monta il simulatore (MockBackend):
	# connessione, roster che va e viene, chat a fumetti — senza VPS.
	if OS.get_environment("JHT_BACKEND_TEST") == "1":
		BackendBus.set_backend(MockBackend.new())
	if OS.get_environment("JHT_STATE_SELFTEST") == "1":
		_state_selftest.call_deferred()

	# TEST-AUTO: JHT_CHAT=<ruolo> apre il pannello chat col primo agente
	# di quel ruolo e invia un messaggio di prova (eco + risposta mock;
	# con la VPS il messaggio parte DAVVERO verso l'agente reale).
	# JHT_CHAT_VIEW=<ruolo> apre solo il pannello senza inviare: per
	# fotografare la risposta arrivata senza rimandare il messaggio.
	if OS.get_environment("JHT_CHAT") != "":
		_chat_selftest(OS.get_environment("JHT_CHAT"), true)
	elif OS.get_environment("JHT_CHAT_VIEW") != "":
		_chat_selftest(OS.get_environment("JHT_CHAT_VIEW"), false)

	# TEST-AUTO: JHT_CHATMENU=1 apre il menu delle chat 1-a-1 (tasto C)
	if OS.get_environment("JHT_CHATMENU") == "1":
		get_tree().create_timer(2.5).timeout.connect(_open_chat_menu)

	# TEST-AUTO: JHT_THROTTLE_TEST=1 forza throttle e rimozione roster,
	# senza aspettare il ciclo eventi del mock.
	if OS.get_environment("JHT_THROTTLE_TEST") == "1":
		_throttle_selftest()
	# TEST-AUTO: forza un singolo giro completo della pipeline offline.
	# Esempio JHT_PIPELINE_TEST=scout|analisti|scorer|scrittori.
	var pipeline_test := OS.get_environment("JHT_PIPELINE_TEST")
	if pipeline_test != "":
		_force_pipeline_trip.call_deferred(pipeline_test)
	var pipeline_force_test := OS.get_environment("JHT_PIPELINE_FORCE_TEST")
	if pipeline_force_test != "":
		_pipeline_force_selftest.call_deferred(pipeline_force_test)
	if _doctor_test != "":
		_doctor_selftest.call_deferred(_doctor_test)

	# TEST-AUTO: JHT_SHOT=path.png → screenshot dopo un secondo e chiude.
	# Con JHT_OVERVIEW=1 permette a noi agenti di verificare il layout da soli.
	var shot := OS.get_environment("JHT_SHOT")
	if shot != "":
		_take_shot(shot)

func _force_pipeline_trip(test_dept: String) -> void:
	await get_tree().create_timer(0.8).timeout
	for agent in agents:
		if agent.dept == test_dept:
			agent.set_backend_status("working")
			agent.perform_pipeline_step()
			return

func _pipeline_force_selftest(test_dept: String) -> void:
	await get_tree().create_timer(0.8).timeout
	var actor: AgentNPC = null
	for candidate in agents:
		if candidate.dept == test_dept:
			actor = candidate
			break
	if actor == null:
		print("PIPELINE-FORCE-TEST FAIL no actor for ", test_dept)
		get_tree().quit(1)
		return
	actor.set_backend_status("idle")
	var baseline := int(actor.debug_snapshot().get("pipeline_trips", 0))
	actor.perform_pipeline_step(true)
	await get_tree().process_frame
	var deadline := Time.get_ticks_msec() + 60000
	while int(actor.debug_snapshot().get("pipeline_trips", 0)) < baseline + 1 \
			and Time.get_ticks_msec() < deadline:
		await get_tree().process_frame
	# Consenti alla posa seduta e alla maschera collisione di stabilizzarsi.
	for _i in 3:
		await get_tree().physics_frame
	var snap := actor.debug_snapshot()
	var ok := int(snap.get("pipeline_trips", 0)) == baseline + 1 \
			and int(snap.get("pending_pipeline", -1)) == 0 \
			and int(snap.get("state", -1)) == AgentNPC.S.WORK \
			and not bool(snap.get("forced_trip", true)) \
			and int(snap.get("collision_mask", -1)) == 0 \
			and actor.global_position.distance_to(
					snap.get("work_position", Vector2.INF)) < 1.0
	print("PIPELINE-FORCE-TEST ", "PASS" if ok else "FAIL", " ", JSON.stringify(snap))
	get_tree().quit(0 if ok else 1)

func _doctor_selftest(target_ref: String) -> void:
	await get_tree().create_timer(0.8).timeout
	var doctor: AgentNPC = _find_agent("dottore")
	var target: AgentNPC = _find_agent(target_ref)
	if doctor and target:
		# Passa dallo stesso ingresso dei messaggi VPS: il test copre anche
		# risoluzione uid/ruolo e dispatch chat-driven, non solo il movimento.
		deliver_chat("dottore", target_ref, "Controllo contesto e carico operativo.")
		await get_tree().process_frame
	if doctor and target and bool(doctor.debug_snapshot().get("forced_trip", false)):
		doctor.set_backend_status("idle")  # la visita deve comunque concludersi
		target.set_backend_status("idle")
		Log.info("test", "visita Dottore → %s avviata in idle" % target_ref)
		var deadline := Time.get_ticks_msec() + 45000
		while is_instance_valid(doctor) \
				and bool(doctor.debug_snapshot().get("forced_trip", false)) \
				and Time.get_ticks_msec() < deadline:
			await get_tree().process_frame
		if not is_instance_valid(doctor):
			print("SIMULATION-DOCTOR-TEST FAIL doctor freed before return")
			get_tree().quit(1)
			return
		var snap := doctor.debug_snapshot()
		var ok := not bool(snap.get("forced_trip", true)) \
				and doctor.global_position.distance_to(snap.get("home", Vector2.INF)) < 1.0 \
				and int(snap.get("state", -1)) == AgentNPC.S.WORK \
				and int(snap.get("investigations", 0)) == 1
		print("SIMULATION-DOCTOR-TEST ", "PASS" if ok else "FAIL", " ",
				JSON.stringify(snap))
		get_tree().quit(0 if ok else 1)
	else:
		Log.warn("test", "visita Dottore non avviata: target=" + target_ref)
		get_tree().quit(1)

func _on_chat_message(msg: Dictionary) -> void:
	deliver_chat(msg.get("from", ""), msg.get("to", "all"), msg.get("text", ""))

## Aspetta che il backend abbia popolato la scena, poi apre la chat e
## (se send) scrive: il giro utente→canale→risposta si vede da solo.
func _chat_selftest(role: String, send: bool) -> void:
	await get_tree().create_timer(2.5).timeout
	for a in agents:
		if a.slug == role or a.uid.begins_with(role):
			_open_chat(a)
			if send:
				await get_tree().create_timer(0.5).timeout
				BackendBus.send_user_chat(a.slug, "Come procede il lavoro?")
			return

## Forza i due comportamenti nuovi sul roster corrente (vedi _ready).
func _throttle_selftest() -> void:
	await get_tree().create_timer(4.0).timeout
	if agents.size() < 2:
		return
	agents[1].set_throttle(240.0)
	agents[1].set_backend_status("throttled")
	_despawn_agent(agents[agents.size() - 1])
	Log.info("test", "throttle selftest: %s in ricreazione, uno alla porta"
			% agents[1].uid)

func _take_shot(path: String) -> void:
	# JHT_SHOT_DELAY=N ritarda lo scatto: utile per fotografare la
	# simulazione a regime (viaggi in corso) e scovare ingorghi.
	var delay := 1.2
	var delay_env := OS.get_environment("JHT_SHOT_DELAY")
	if delay_env != "":
		delay = maxf(0.5, float(delay_env))
	await get_tree().create_timer(delay).timeout
	var img := get_viewport().get_texture().get_image()
	img.save_png(path)
	Log.info("test", "JHT_SHOT salvato: " + path)
	get_tree().quit()

func _process(_delta: float) -> void:
	_update_hover()

## Test end-to-end del contratto visivo, dentro la scena vera: presenza,
## motion track e velocità per i quattro stati backend.
func _state_selftest() -> void:
	var sample := [
		{"uid": "scout-test", "slug": "scout", "role": "scout", "name": "Scout test",
				"active": true, "status": "working", "activity_detail": "turno"},
		{"uid": "analista-test", "slug": "analista", "role": "analista", "name": "Analista test",
				"active": true, "status": "idle", "activity_detail": "attesa"},
		{"uid": "scorer-test", "slug": "scorer", "role": "scorer", "name": "Scorer test",
				"active": true, "status": "paused", "activity_detail": "pausa"},
		{"uid": "scrittore-test", "slug": "scrittore", "role": "scrittore", "name": "Scrittore test",
				"active": true, "status": "throttled", "throttle_secs": 180.0,
				"activity_detail": "pacing"},
	]
	sync_agents(sample)
	await get_tree().process_frame
	var by := {}
	for a in agents:
		by[a.uid] = a.debug_snapshot()
	var ok := agents.size() == 4 \
			and str(by.get("scout-test", {}).get("motion", "")) == "sit" \
			and str(by.get("analista-test", {}).get("motion", "")) == "sit_idle" \
			and str(by.get("scorer-test", {}).get("motion", "")) == "sit_idle" \
			and str(by.get("scrittore-test", {}).get("motion", "")) == "sit_idle"
	for snap in by.values():
		ok = ok and float(snap.get("speed", -1.0)) == 0.0
	# Snapshot completo successivo: chi non compare viene rimosso subito
	# dall'array di scena; non può restare sul divano o in corridoio.
	sync_agents([sample[1]])
	await get_tree().process_frame
	ok = ok and agents.size() == 1 and agents[0].uid == "analista-test"
	print("SIMULATION-STATE-TEST ", "PASS" if ok else "FAIL", " ", JSON.stringify(by))

var _registry: RegistryPanel
var _search: GlobalSearch
var _cv_shelf_panel: CvShelfPanel
var _queue_panel: PipelineQueuePanel

func _unhandled_input(event: InputEvent) -> void:
	if Game.dialogue_active:
		return
	# menu delle chat 1-a-1 (feedback test finale): C apre la lista agenti
	if event is InputEventKey and event.pressed and event.keycode == KEY_C \
			and not (event.meta_pressed or event.ctrl_pressed) \
			and _chat_menu == null and _chat_panel == null and _agent_card == null:
		_open_chat_menu()
		return
	# GlobalSearch del web: Cmd/Ctrl+K apre la ricerca sulle posizioni
	if event is InputEventKey and event.pressed and event.keycode == KEY_K \
			and (event.meta_pressed or event.ctrl_pressed):
		_toggle_search()
		get_viewport().set_input_as_handled()
		return
	if event.is_action_pressed("registry"):
		if _registry:
			_registry.queue_free()
			_registry = null
			Sfx.play_back()
		else:
			_registry = RegistryPanel.new()
			add_child(_registry)

func _toggle_search() -> void:
	if _search:
		_search.queue_free()
		_search = null
		Sfx.play_back()
		return
	_search = GlobalSearch.new()
	add_child(_search)
	Sfx.play_blip()
	_search.closed.connect(func() -> void:
		if _search:
			_search.queue_free()
			_search = null)
	_search.open_position.connect(func(id: int) -> void:
		_search.queue_free()
		_search = null
		# apre la sezione positions direttamente sul dettaglio
		var panel := SectionPanel.new("positions", 24.0)
		panel._pos_detail_id = id
		add_child(panel)
		panel.closed.connect(panel.queue_free))

var _dept_panel: DepartmentPanel
var _agent_card: AgentCard

## Click "pulito" dalla FreeCamera: agente > bacheca > reparto.
func _on_world_click(target: Vector2) -> void:
	if Game.dialogue_active:
		return
	if _registry or _dept_panel or _agent_card or _chat_panel or _cv_shelf_panel \
			or _queue_panel:
		return  # con un pannello aperto, il mondo non riceve click
	for agent in agents:
		if agent.hit_by(target):
			_open_agent_card(agent)
			return
	var queue_dept := PaperPile.inbox_at(target)
	if queue_dept != "":
		_open_pipeline_queue(queue_dept)
		return
	if OutputShelf.hit_by(target):
		_open_cv_shelf()
		return
	if FurnitureDefs.get_rect("corkboard").grow(30).has_point(target):
		_registry = RegistryPanel.new()
		add_child(_registry)
		return
	# il mappamondo apre la mappa delle offerte coi pin (vista web migrata)
	if FurnitureDefs.get_rect("hologram").grow(24).has_point(target):
		Log.info("ui", "mappa offerte aperta dal mappamondo")
		var map_panel := SectionPanel.new("map", 24.0)
		add_child(map_panel)
		map_panel.closed.connect(map_panel.queue_free)
		return
	var dept := DepartmentDefs.department_at(target)
	if dept != "":
		_open_dept(dept)

func _open_cv_shelf() -> void:
	Log.info("ui", "archivio CV aperto dallo scaffale output")
	_cv_shelf_panel = CvShelfPanel.new()
	add_child(_cv_shelf_panel)
	_cv_shelf_panel.closed.connect(func() -> void: _cv_shelf_panel = null)
	_cv_shelf_panel.open_position.connect(func(position_id: int) -> void:
		if _cv_shelf_panel:
			_cv_shelf_panel.queue_free()
			_cv_shelf_panel = null
		var panel := SectionPanel.new("positions", 24.0)
		panel._pos_detail_id = position_id
		add_child(panel)
		panel.closed.connect(panel.queue_free))

func _open_pipeline_queue(source_dept: String) -> void:
	Log.info("ui", "coda pipeline aperta dalla pila: " + source_dept)
	_queue_panel = PipelineQueuePanel.new(source_dept)
	add_child(_queue_panel)
	_queue_panel.closed.connect(func() -> void: _queue_panel = null)
	_queue_panel.open_position.connect(func(position_id: int) -> void:
		if _queue_panel:
			_queue_panel.queue_free()
			_queue_panel = null
		var panel := SectionPanel.new("positions", 24.0)
		panel._pos_detail_id = position_id
		add_child(panel)
		panel.closed.connect(panel.queue_free))

func _open_dept(dept: String) -> void:
	Log.info("dept", "pannello reparto aperto: " + dept)
	_dept_panel = DepartmentPanel.new(dept)
	add_child(_dept_panel)
	_dept_panel.closed.connect(func() -> void: _dept_panel = null)

# ── Hover col mouse (evidenzia l'agente cliccabile) ───────────────────

func _update_hover() -> void:
	var best: AgentNPC = null
	var shelf_hovered := false
	var queue_hovered := ""
	if not Game.dialogue_active and not _registry and not _dept_panel \
			and not _agent_card and not _chat_panel and not _cv_shelf_panel \
			and not _queue_panel:
		var mouse := get_global_mouse_position()
		for agent in agents:
			if agent.hit_by(mouse):
				best = agent
				break
		if best == null:
			queue_hovered = PaperPile.inbox_at(mouse)
			if queue_hovered == "":
				shelf_hovered = OutputShelf.hit_by(mouse)
	PaperPile.highlight_inbox(queue_hovered)
	OutputShelf.set_highlight(shelf_hovered)
	if best != _hover_agent:
		if _hover_agent:
			_hover_agent.set_highlight(false)
		_hover_agent = best
		if _hover_agent:
			_hover_agent.set_highlight(true)
			Sfx.play_tick()

## Scheda "chi è / cosa ha fatto"; da lì si passa al dialogo.
func _open_agent_card(agent: AgentNPC) -> void:
	Log.info("agent", "scheda aperta: %s (%s)" % [agent.display_name, agent.slug])
	# Osservare non modifica il sistema osservato: niente teletrasporto,
	# standing pose o ritorno alla scrivania causati dall'apertura UI.
	_agent_card = AgentCard.new(agent)
	add_child(_agent_card)
	_agent_card.talk_requested.connect(func() -> void: _start_talk(agent))
	_agent_card.chat_requested.connect(func() -> void: _open_chat(agent))
	_agent_card.closed.connect(func() -> void:
		_agent_card = null)

var _chat_panel: ChatPanel
var _chat_menu: ChatMenu

## Lista degli agenti in scena → chat individuale (tasto C).
func _open_chat_menu() -> void:
	Log.info("chat", "menu chat aperto (%d agenti)" % agents.size())
	_chat_menu = ChatMenu.new(agents)
	add_child(_chat_menu)
	_chat_menu.closed.connect(func() -> void: _chat_menu = null)
	_chat_menu.open_chat.connect(func(slug: String, display_name: String) -> void:
		Log.info("chat", "pannello chat aperto dal menu con " + slug)
		_chat_panel = ChatPanel.new(slug, display_name, _chat_roster())
		add_child(_chat_panel)
		_chat_panel.closed.connect(func() -> void: _chat_panel = null))

## Roster per lo switcher del pannello chat: stesse coppie slug/nome del
## menu (uid quando l'agente è backend-driven, es. "scout-2").
func _chat_roster() -> Array:
	var roster: Array = []
	for a in agents:
		roster.append({"slug": a.slug if a.uid == "" else a.uid,
				"name": a.display_name})
	return roster

## Chat REALE con l'agente: si apre con lo slug di gioco, il bus lo
## traduce nel nome del sistema reale (coordinatore → capitano).
func _open_chat(agent: AgentNPC) -> void:
	Log.info("chat", "pannello chat aperto con " + agent.slug)
	_chat_panel = ChatPanel.new(agent.slug, agent.display_name, _chat_roster())
	add_child(_chat_panel)
	_chat_panel.closed.connect(func() -> void:
		_chat_panel = null
		if is_instance_valid(agent) and not agent.is_dissolving():
			agent.end_talk())

func _start_talk(agent: AgentNPC) -> void:
	if Game.dialogue_active:
		return
	Log.info("agent", "dialogo aperto con " + agent.slug)
	agent.start_talk()
	var ui := DialogueUI.new()
	add_child(ui)
	ui.open(agent.slug, agent.display_name, "")
	ui.closed.connect(func() -> void:
		if is_instance_valid(agent) and not agent.is_dissolving():
			agent.end_talk())

# ── Roster dinamico dal backend (missione backend-integration) ────────
# In modalità backend la scena mostra SOLO gli agenti attivi sulla VPS:
# sync_agents() confronta lo stato con la scena e materializza/dissolve.

var _desk_pool: Dictionary = {}  # role -> Array di def libere (postazioni)
var _backend_mode := false
var _unplaced_roles: Dictionary = {}  # ruoli senza postazione già segnalati
var _core_overflow_serial: Dictionary = {} # istanze core extra (es. sentinella-worker)

## Applica lo snapshot del backend (contratto BackendBus.agents_updated):
## list = [{slug: uid univoco, role, name, active, status}].
func sync_agents(list: Array) -> void:
	if not _backend_mode:
		_enter_backend_mode()
	var wanted := {}
	for item in list:
		# un killed è di fatto fuori squadra: esce dalla porta come chi
		# sparisce dal roster (missione pipeline 20:1x). La chiave è
		# l'UID per-istanza (contratto 1053f1ce: slug=ruolo, uid=istanza)
		if item.get("active", true) and str(item.get("status", "")) != "killed":
			wanted[str(item.get("uid", item.get("slug", "")))] = item
	for agent in agents.duplicate():
		if not wanted.has(agent.uid):
			_despawn_agent(agent, true, true)
		else:
			# throttle PRIMA dello status: la scelta seduto-vs-ricreazione
			# al cambio di stato legge la durata già aggiornata
			agent.set_throttle(float(wanted[agent.uid].get("throttle_secs", 0.0)))
			agent.set_activity_detail(str(wanted[agent.uid].get("activity_detail", "")))
			agent.set_backend_status(wanted[agent.uid].get("status", "working"))
			wanted.erase(agent.uid)
	for item_uid in wanted:
		_spawn_backend_agent(wanted[item_uid])
	# Il roster backend arriva dopo _ready: il test-card va riprovato qui,
	# quando l'istanza richiesta esiste davvero.
	var card_test := OS.get_environment("JHT_CARD")
	if card_test != "" and _agent_card == null:
		for a in agents:
			if a.slug == card_test or a.uid == card_test:
				_open_agent_card(a)
				break

## Recapita un messaggio della chat di team come fumetto (contratto
## BackendBus.chat_message): from/to sono uid agente, "user" o "all".
func deliver_chat(from_uid: String, to_uid: String, text: String) -> void:
	var speaker := _find_agent(from_uid)
	if speaker and not speaker.is_dissolving():
		var target := _find_agent(to_uid) if to_uid not in ["all", "user"] else null
		if speaker.slug == "dottore" and target \
				and speaker.investigate_agent(target, text):
			return
		# Vignette simultanee: ogni agente conserva la propria coda per almeno
		# un minuto. L'indagine del Dottore resta il caso fisico speciale sopra.
		var to_label := ""
		match to_uid:
			"all":
				to_label = ""
			"user":
				to_label = "te"
			_:
				to_label = _name_of(to_uid)
		speaker.say(text, to_label)

## Risolve uid reale o ruolo. Nei self-test offline "scout-4" sceglie la
## quarta istanza del ruolo, mentre sulla VPS vince sempre l'uid esatto.
func _find_agent(ref: String) -> AgentNPC:
	for agent in agents:
		if agent.uid == ref and ref != "":
			return agent
	# Con dati veri un UID assente e davvero assente: attribuire il suo
	# messaggio a un'altra istanza dello stesso ruolo falsifica la scena.
	# Il fallback posizionale resta utile soltanto nei self-test offline.
	if BackendBus.is_live():
		return null
	var role := ref
	var requested_index := 1
	var dash := ref.rfind("-")
	if dash > 0 and ref.substr(dash + 1).is_valid_int():
		role = ref.substr(0, dash)
		requested_index = maxi(1, int(ref.substr(dash + 1)))
	var matches: Array[AgentNPC] = []
	for agent in agents:
		if agent.slug == role and not agent.is_dissolving():
			matches.append(agent)
	if matches.is_empty():
		return null
	return matches[mini(requested_index - 1, matches.size() - 1)]

func _name_of(uid: String) -> String:
	for agent in agents:
		if agent.uid == uid:
			return agent.display_name
	return uid

## ── Scena reattiva al registro attività ──────────────────────────────

## La porta d'uscita (perimetro sud, presso l'entrata/Assistente) e il
## punto interno dove gli agenti in uscita camminano prima di svanire.
const EXIT_DOOR := Vector2(1300, 2000)
const EXIT_SPOT := Vector2(1300, 1952)

const MAX_TR_REACTIONS := 6   # per refresh: il resto resta solo nel registro
const TR_REACT_GAP := 2.4     # secondi fra due reazioni (non un coro)

## Gli stati VERI del jobs.db (SELECT DISTINCT to_state sulla VPS) come
## frase parlata; uno stato nuovo cade sul generico "%s → stato".
const TR_PHRASES := {
	"new": "Nuova posizione: %s",
	"checked": "Verificata: %s",
	"scored": "Valutata: %s",
	"writing": "CV in scrittura: %s",
	"ready": "CV pronto: %s",
	"excluded": "Esclusa: %s",
}
## Stati che accendono la stampante dell'ufficio (lavoro sul CV).
const TR_PRINT := ["writing", "ready"]

var _tr_seen: Dictionary = {}
var _tr_baseline := false

## Fase della pipeline → inbox di reparto: la pila fisica mostra il
## contatore VERO (missione pipeline 2/3). L'inbox di un reparto è ciò
## che ha PRODOTTO e che il reparto a valle viene a ritirare.
const PILE_PHASE := {
	"scout": "to_analyze",
	"analisti": "analyzed",
	"scorer": "with_score",
	"scrittori": "to_write",
	"critici": "written",
}

## Contatore reale → fogli visibili: scala in radice (i numeri veri
## arrivano a decine) col cap della pila; 0 resta 0.
static func _pile_visual(n: int) -> int:
	if n <= 0:
		return 0
	return mini(int(ceil(sqrt(float(n)) * 1.9)), PaperPile.MAX_SHEETS)

var _last_ready := -1

func _sync_piles() -> void:
	var counts: Dictionary = BackendBus.pipeline_counts()
	for dept_id in PILE_PHASE:
		if PaperPile.inbox.has(dept_id):
			PaperPile.inbox[dept_id].set_target(
					_pile_visual(int(counts[PILE_PHASE[dept_id]])))
	var ready := int(counts["cv_ready"])
	OutputShelf.set_ready(ready)
	# un CV in più rispetto all'ultimo giro: uno scrittore lo porta
	# fisicamente allo scaffale (teatro sopra il dato vero)
	if _last_ready >= 0 and ready > _last_ready:
		for agent in agents:
			if agent.dept == "scrittori" and not agent.is_dissolving():
				agent.deliver_to_shelf()
				break
	_last_ready = ready
	Log.debug("scene", "pile agganciate ai counts: %s" % str(counts))

## Le transizioni di stato REALI muovono la scena: a ogni refresh del
## jobs.db (BackendBus.transitions è già aggiornato quando arriva
## positions_updated) quelle mai viste diventano reazioni dell'agente
## che le ha firmate. Il primo snapshot fa solo da baseline: lo storico
## non va recitato all'avvio.
func _on_transitions(_positions: Array) -> void:
	# con uno snapshot VERO le pile seguono i contatori reali; senza
	# posizioni (mock/offline) resta il teatro simulato del restock
	if not BackendBus.positions.is_empty():
		_sync_piles()
	var fresh: Array = []
	for t in BackendBus.transitions:
		var key := "%s|%s|%s|%s" % [str(t.get("position_id", "")),
				str(t.get("ts", "")), str(t.get("to_state", "")),
				str(t.get("by_agent", ""))]
		if _tr_seen.has(key):
			continue
		_tr_seen[key] = true
		fresh.append(t)
	if not _tr_baseline:
		_tr_baseline = true
		return
	fresh.reverse()  # il registro è DESC: si recita in ordine cronologico
	if fresh.size() > MAX_TR_REACTIONS:
		fresh = fresh.slice(fresh.size() - MAX_TR_REACTIONS)
	var delay := 0.0
	for t in fresh:
		var tt: Dictionary = t
		get_tree().create_timer(delay).timeout.connect(func() -> void:
			_react_to_transition(tt))
		delay += TR_REACT_GAP

## L'agente giusto reagisce — per-istanza (by_agent "scout-2" → uid
## "scout-2" in scena) o, se quell'istanza non c'è, un collega dello
## stesso ruolo. Fumetto con la posizione lavorata + pulse del corpo;
## una scrittura CV accende la stampante.
func _react_to_transition(t: Dictionary) -> void:
	var by := str(t.get("by_agent", "") if t.get("by_agent") else "")
	if by == "":
		return
	var actor: AgentNPC = null
	for agent in agents:
		if agent.uid == by:
			actor = agent
			break
	if actor == null:
		var base := by.split("-")[0]
		for agent in agents:
			if agent.uid != "" and agent.uid.split("-")[0] == base:
				actor = agent
				break
	if actor == null or actor.is_dissolving():
		return
	var to_st := str(t.get("to_state", "") if t.get("to_state") else "?")
	var what := str(t.get("title", "") if t.get("title") else "")
	var company := str(t.get("company", "") if t.get("company") else "")
	if what != "" and company != "":
		what += " · " + company
	elif what == "":
		what = company if company != "" else "posizione #%s" % str(t.get("position_id", "?"))
	if TR_PHRASES.has(to_st):
		actor.say(TR_PHRASES[to_st] % what)
	else:
		actor.say("%s → %s" % [what, to_st])
	actor.react_to_work(to_st in TR_PRINT)
	# Il dato reale non genera solo un pulse: mette fisicamente in moto il
	# reparto che ha firmato la transizione e il suo foglio lungo la pipeline.
	# La transizione nel jobs.db e prova autoritativa del lavoro: anche se il
	# poll della TUI vede gia idle, il viaggio fisico deve ancora avvenire.
	actor.perform_pipeline_step(true)
	Log.debug("scene", "reazione %s: %s → %s" % [by, what, to_st])

## Primo snapshot backend: le postazioni tornano nel pool e il roster
## locale di ambientazione lascia la scena — comanda lo stato reale.
func _enter_backend_mode() -> void:
	_backend_mode = true
	_desk_pool = {}
	for def in CharacterDefs.spawn_list():
		var role: String = def["slug"]
		if not _desk_pool.has(role):
			_desk_pool[role] = []
		_desk_pool[role].append(def)
	for agent in agents.duplicate():
		if agent.uid == "":
			_despawn_agent(agent, false, false)
	Log.info("backend", "modalità backend: in scena solo gli agenti attivi")

func _despawn_agent(agent: AgentNPC, refill_pool := true, via_door := false) -> void:
	agents.erase(agent)
	if _hover_agent == agent:
		_hover_agent = null
	# se l'utente lo stava esaminando, la scheda si chiude con lui
	if _agent_card and _agent_card.get("_agent") == agent:
		_agent_card.close(false)
	if refill_pool and agent.has_meta("def"):
		var def: Dictionary = agent.get_meta("def")
		var role: String = def["slug"]
		# il lead rientra in testa: alla riattivazione riprende il suo posto
		if def.get("lead", false):
			_desk_pool[role].push_front(def)
		else:
			_desk_pool[role].append(def)
	# un agente fermato ESCE dalla porta (missione pipeline 20:1x); il
	# dissolve tesseract resta per gli sfollamenti tecnici di massa
	if via_door:
		agent.exit_through(EXIT_SPOT)
	else:
		agent.dissolve()

func _spawn_backend_agent(item: Dictionary) -> void:
	var role: String = item.get("role", "")
	var pool: Array = _desk_pool.get(role, [])
	var def: Dictionary
	if pool.is_empty():
		# I ruoli core non hanno una batteria di scrivanie, ma sulla VPS possono
		# avere piu istanze (oggi: sentinella + sentinella-worker). Materializza
		# anche le copie, con home sfalsata, invece di cancellarle dalla scena.
		if CharacterDefs.AGENTS.has(role):
			var serial := int(_core_overflow_serial.get(role, 0)) + 1
			_core_overflow_serial[role] = serial
			def = CharacterDefs.AGENTS[role].duplicate(true)
			def["slug"] = role
			def["lead"] = false
			if def.has("spot"):
				def["spot"] = Vector2(def["spot"]) + Vector2(
						84.0 * serial, 52.0 * (serial % 2))
			else:
				# Reparto oltre le sedie disponibili: non sovrapporre due corpi
				# sulla stessa sedia e soprattutto non far fallire tutta la sync.
				# L'istanza resta visibile come postazione mobile accanto all'inbox.
				var overflow_dept := str(def.get("dept", ""))
				def.erase("dept")
				def.erase("desk")
				var anchor: Vector2 = DepartmentDefs.DEPARTMENTS.get(
						overflow_dept, {}).get("inbox", Vector2(1700, 1200))
				def["spot"] = anchor + Vector2(58.0 * serial, 46.0 * (serial % 2))
		else:
			if not _unplaced_roles.has(role):
				_unplaced_roles[role] = true
				Log.warn("backend", "nessuna postazione libera per il ruolo " + role)
			return
	else:
		def = pool.pop_front()
	var live := def.duplicate(true)
	if item.get("name", "") != "":
		live["name"] = item["name"]
	var agent := AgentNPC.new()
	world.add_child(agent)
	agent.setup(live, nav)
	agent.uid = str(item.get("uid", item.get("slug", "")))
	agent.set_meta("def", def)
	agent.set_throttle(float(item.get("throttle_secs", 0.0)))
	agent.set_activity_detail(str(item.get("activity_detail", "")))
	agent.set_backend_status(item.get("status", "idle"))
	agent.materialize()
	agents.append(agent)

# ── Costruzione scena ─────────────────────────────────────────────────

func _invisible_wall(r: Rect2) -> StaticBody2D:
	var body := StaticBody2D.new()
	body.position = Vector2(r.get_center().x, r.end.y)
	var shape := CollisionShape2D.new()
	var box := RectangleShape2D.new()
	box.size = r.size
	shape.shape = box
	shape.position = Vector2(0, -r.size.y / 2.0)
	body.add_child(shape)
	return body

func _add_perimeter_walls() -> void:
	var f := FurnitureDefs.FLOOR
	var t := 60.0
	var rects := [
		Rect2(f.position.x - t, f.position.y - t, f.size.x + t * 2, t),
		Rect2(f.position.x - t, f.end.y, f.size.x + t * 2, t),
		Rect2(f.position.x - t, f.position.y, t, f.size.y),
		Rect2(f.end.x, f.position.y, t, f.size.y),
	]
	for r in rects:
		add_child(_invisible_wall(r))

func _add_hud() -> void:
	var hud := CanvasLayer.new()
	hud.layer = 10
	add_child(hud)
	var theme_root := Control.new()
	theme_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	theme_root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	theme_root.theme = TerminalTheme.get_theme()
	hud.add_child(theme_root)
	_team_hud = TeamHud.new()
	theme_root.add_child(_team_hud)
	theme_root.add_child(SimBadge.new())  # SIMULAZIONE vs DATI REALI
	var hint := TerminalTheme.label(
			UIStrings.t("office.camera_hint"),
			15, Palette.DIM)
	hint.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	hint.position = Vector2(-hint.size.x / 2.0, -30)
	hint.grow_horizontal = Control.GROW_DIRECTION_BOTH
	hint.grow_vertical = Control.GROW_DIRECTION_BEGIN
	hud.add_child(hint)
