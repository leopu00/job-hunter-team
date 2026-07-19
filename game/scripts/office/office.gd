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
	# Registry condiviso: oltre ai desk dei reparti contiene le postazioni
	# personali dei core, che usano lo stesso swap vuota/occupata.
	FurnitureNode.desks = {}
	FurnitureNode.front_chairs = {}
	for item in FurnitureDefs.ITEMS:
		if item["kind"] == "hologram":
			world.add_child(Hologram.new(item["rect"]))
			world.add_child(_invisible_wall(item["rect"]))
		else:
			var furniture := FurnitureNode.new(item)
			world.add_child(furniture)
			if item.has("registry_key"):
				FurnitureNode.desks[item["registry_key"]] = furniture

	# postazioni dei 5 reparti: stesso FurnitureNode dei mobili, kind variati;
	# facing passa al visual (texture orientate _down/_side/_up, dev-art).
	# Ogni postazione ha un visual completo con sedia nello stesso verso.
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
	# Audit visuale locale: con JHT_SEAT_AUDIT=<reparto>:<desk> mostra una
	# vignetta reale sul singolo composito inquadrato, senza dipendere dalla VPS.
	if _seat_audit != "" and OS.get_environment("JHT_SPEECH_AUDIT") == "1" \
			and not agents.is_empty():
		agents[0].say("Verifica ancoraggio sopra la testa")

	add_child(TesseractEdges.new())  # gli spigoli blu della box (trasparenti)
	add_child(Sfx.make_ambient_hum())

	_camera = FreeCamera.new()
	add_child(_camera)
	_camera.clicked.connect(_on_world_click)
	if OS.get_environment("JHT_CAMERA_LOCK_TEST") == "1":
		_camera_lock_selftest.call_deferred()
	if OS.get_environment("JHT_POSITIONS_PANEL_TEST") == "1":
		_positions_panel_selftest.call_deferred()
	if OS.get_environment("JHT_MAP_PANEL_TEST") == "1":
		_map_panel_selftest.call_deferred()
	if OS.get_environment("JHT_GUIDED_TEST") == "1":
		_guided_onboarding_selftest.call_deferred()
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
	elif OS.get_environment("JHT_FOCUS_CORE") == "1":
		# Audit delle due postazioni direzionali: entrambe nello stesso frame,
		# abbastanza vicino da controllare volto, seduta e monitor.
		var core_cam := Camera2D.new()
		core_cam.position = Vector2(1700, 535)
		core_cam.zoom = Vector2(1.45, 1.45)
		add_child(core_cam)
		core_cam.make_current()
	elif OS.get_environment("JHT_FOCUS_LOUNGE") == "1":
		# Inquadratura di controllo dell'intero angolo: Dottore/Mantenitore a
		# sinistra, tappeto centrato e Mentor seduto di schiena sulla destra.
		var lounge_cam := Camera2D.new()
		lounge_cam.position = Vector2(2490, 1140)
		lounge_cam.zoom = Vector2(1.45, 1.45)
		add_child(lounge_cam)
		lounge_cam.make_current()
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
		if not BackendBus.positions.is_empty():
			_open_cv_shelf.call_deferred()
		else:
			BackendBus.positions_updated.connect(func(_l: Array) -> void:
				if _cv_shelf_panel == null:
					_open_cv_shelf())
	# TEST-AUTO: apre una delle cinque code fisiche col primo snapshot.
	var queue_test := OS.get_environment("JHT_PIPELINE_QUEUE")
	if DepartmentDefs.DEPT_ORDER.has(queue_test):
		if not BackendBus.positions.is_empty():
			_open_pipeline_queue.call_deferred(queue_test)
		else:
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
	# Preview/E2E del dialogo first-run anche senza backend o agente attivo.
	var guided_chat := OS.get_environment("JHT_GUIDED_CHAT")
	if guided_chat != "" and ScriptedOnboarding.supports(guided_chat):
		var guided_names := {"assistente": "Assistente",
				"coordinatore": "Coordinatore", "mentor": "Mentor"}
		_chat_panel = ChatPanel.new(guided_chat,
				str(guided_names.get(guided_chat, guided_chat.capitalize())), _chat_roster())
		add_child(_chat_panel)

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
	var core_patrol_test := OS.get_environment("JHT_CORE_PATROL_TEST")
	if core_patrol_test != "":
		_force_core_patrol.call_deferred(core_patrol_test)

	# TEST-AUTO: JHT_SHOT=path.png → screenshot dopo un secondo e chiude.
	# Con JHT_OVERVIEW=1 permette a noi agenti di verificare il layout da soli.
	var shot := OS.get_environment("JHT_SHOT")
	if shot != "":
		_take_shot(shot)

## Regressione trackpad/overlay: una gesture consegnata direttamente alla
## camera non deve cambiare né pan né zoom finché il gruppo modal è attivo.
func _camera_lock_selftest() -> void:
	var blocker := Node.new()
	add_child(blocker)
	blocker.add_to_group("camera_blocking_overlay")
	var before_pos := _camera.position
	var before_zoom := _camera.zoom
	var pan := InputEventPanGesture.new()
	pan.delta = Vector2(20, 15)
	_camera._unhandled_input(pan)
	var wheel := InputEventMouseButton.new()
	wheel.button_index = MOUSE_BUTTON_WHEEL_UP
	wheel.pressed = true
	_camera._unhandled_input(wheel)
	var ok := _camera.position.is_equal_approx(before_pos) \
			and _camera.zoom.is_equal_approx(before_zoom)
	print("CAMERA-OVERLAY-LOCK-TEST ", "PASS" if ok else "FAIL")
	blocker.queue_free()
	get_tree().quit(0 if ok else 1)


## First-run E2E senza rete: attraversa gli alberi scripted e monta il
## pannello chat reale, prima offline e poi in modalità ibrida col mock.
func _guided_onboarding_selftest() -> void:
	var failures: Array[String] = []
	var check := func(ok: bool, message: String) -> void:
		if not ok:
			failures.append(message)
	ScriptedOnboarding.reset_for_test()
	check.call(ScriptedOnboarding.messages("assistente").size() == 1,
			"welcome Assistente assente")
	check.call(ScriptedOnboarding.options("assistente").size() == 3,
			"scelte Assistente errate")
	for choice in ["start", "software", "mid", "remote", "europe"]:
		ScriptedOnboarding.choose("assistente", choice)
	var draft := ScriptedOnboarding.profile_draft()
	check.call(draft.get("target_role") == "Software Engineering", "ruolo non raccolto")
	check.call(draft.get("experience_years") == "3", "esperienza non raccolta")
	check.call(draft.get("location") == "Europa", "località non raccolta")
	check.call(ScriptedOnboarding.options("assistente").size() == 2,
			"finale Assistente non raggiunto")
	var guided_actions: Array = []
	var capture_action := func(action: String, payload: Dictionary) -> void:
		guided_actions.append({"action": action, "payload": payload})
	ScriptedOnboarding.action_requested.connect(capture_action)
	ScriptedOnboarding.choose("coordinatore", "explain")
	check.call(ScriptedOnboarding.options("coordinatore").size() == 3,
			"spiegazione Coordinatore non torna alla scelta")
	ScriptedOnboarding.choose("coordinatore", "local")
	ScriptedOnboarding.choose("coordinatore", "ready")
	check.call(ScriptedOnboarding.options("coordinatore").size() == 4,
			"scelta provider Coordinatore non raggiunta")
	ScriptedOnboarding.choose("coordinatore", "compare")
	ScriptedOnboarding.choose("coordinatore", "codex")
	ScriptedOnboarding.choose("coordinatore", "login")
	check.call(not guided_actions.is_empty() \
			and str(guided_actions[-1].get("action", "")) == "open_section" \
			and str(guided_actions[-1].get("payload", {}).get("section", "")) == "docker",
			"gate container del Coordinatore non apre Docker")
	ScriptedOnboarding.choose("coordinatore", "check")
	ScriptedOnboarding.choose("coordinatore", "already")
	check.call(ScriptedOnboarding.options("coordinatore").size() == 4,
			"canali opzionali del Coordinatore assenti")
	ScriptedOnboarding.choose("coordinatore", "telegram")
	check.call(str(guided_actions[-1].get("payload", {}).get("section", "")) == "telegram",
			"configurazione Telegram non raggiungibile dalla conversazione")
	ScriptedOnboarding.choose("coordinatore", "skip_channels")
	check.call(ScriptedOnboarding.options("coordinatore").size() == 3,
			"attivazione team non raggiunta dopo i canali")
	ScriptedOnboarding.action_requested.disconnect(capture_action)
	for choice in ["growth", "balanced", "weekly", "done"]:
		ScriptedOnboarding.choose("mentor", choice)
	check.call(ScriptedOnboarding.is_complete("mentor"), "Mentor non completato")
	check.call(ScriptedOnboarding.preferences().get("mentor_cadence") == "weekly",
			"preferenza Mentor non salvata")

	# Percorsi alternativi: uscita non bloccante, VPS, cambio provider,
	# configurazioni opzionali e revisione delle preferenze del Mentor.
	ScriptedOnboarding.reset_for_test()
	guided_actions.clear()
	ScriptedOnboarding.action_requested.connect(capture_action)
	ScriptedOnboarding.choose("assistente", "later")
	check.call(ScriptedOnboarding.options("assistente").size() == 3,
			"esplora prima dovrebbe lasciare l'Assistente all'intro")
	ScriptedOnboarding.choose("assistente", "profile")
	check.call(not guided_actions.is_empty() \
			and str(guided_actions[-1].get("payload", {}).get("section", "")) == "profile",
			"profilo diretto Assistente non apre il modulo nativo")
	ScriptedOnboarding.choose("assistente", "complete_profile")
	check.call(ScriptedOnboarding.is_complete("assistente"),
			"profilo diretto non completa il percorso Assistente")
	ScriptedOnboarding.choose("coordinatore", "vps")
	check.call(str(guided_actions[-1].get("payload", {}).get("section", "")) == "vps",
			"ramo VPS Coordinatore non apre la pagina VPS")
	ScriptedOnboarding.choose("coordinatore", "ready")
	ScriptedOnboarding.choose("coordinatore", "kimi")
	ScriptedOnboarding.choose("coordinatore", "different")
	check.call(ScriptedOnboarding.options("coordinatore").size() == 4,
			"cambio provider non torna alla selezione")
	ScriptedOnboarding.choose("coordinatore", "claude")
	ScriptedOnboarding.choose("coordinatore", "check")
	ScriptedOnboarding.choose("coordinatore", "open_profile")
	for section_choice in ["email", "cloud"]:
		ScriptedOnboarding.choose("coordinatore", section_choice)
	check.call(str(guided_actions[-1].get("payload", {}).get("section", "")) == "account",
			"ramo cloud non apre Account")
	ScriptedOnboarding.choose("coordinatore", "skip_channels")
	ScriptedOnboarding.choose("coordinatore", "overview")
	check.call(str(guided_actions[-1].get("payload", {}).get("section", "")) == "activation",
			"checklist Coordinatore non apre Attivazione")
	ScriptedOnboarding.choose("coordinatore", "mentor")
	check.call(str(guided_actions[-1].get("action", "")) == "open_scripted_chat" \
			and str(guided_actions[-1].get("payload", {}).get("agent", "")) == "mentor",
			"handoff Coordinatore-Mentor assente")
	for choice in ["salary", "ambitious", "milestones", "hours"]:
		ScriptedOnboarding.choose("mentor", choice)
	check.call(str(guided_actions[-1].get("payload", {}).get("section", "")) == "hours" \
			and not ScriptedOnboarding.is_complete("mentor"),
			"orari Mentor devono aprire la pagina senza chiudere il percorso")
	ScriptedOnboarding.choose("mentor", "restart")
	check.call(ScriptedOnboarding.options("mentor").size() == 4 \
			and ScriptedOnboarding.preferences().get("mentor_cadence", "") == "",
			"riavvio Mentor non azzera il percorso")
	ScriptedOnboarding.action_requested.disconnect(capture_action)

	# Monta la UI da zero e attiva davvero il primo Button: protegge anche da
	# regressioni nelle closure create dal ciclo delle risposte suggerite.
	ScriptedOnboarding.reset_for_test()
	var panel := ChatPanel.new("assistente", "Assistente")
	add_child(panel)
	await get_tree().process_frame
	await get_tree().process_frame
	check.call(panel._choices.get_child_count() >= 2, "bottoni guided non renderizzati")
	check.call(not panel._input.editable and panel._send_btn.disabled,
			"testo libero acceso prima del provider")
	var pressed_first := false
	for child in panel._choices.get_children():
		if child is Button:
			(child as Button).pressed.emit()
			pressed_first = true
			break
	await get_tree().process_frame
	await get_tree().process_frame
	check.call(pressed_first and ScriptedOnboarding.options("assistente").size() == 4,
			"il primo bottone della chat non avanza al ruolo")
	for choice in ["software", "mid", "remote", "europe"]:
		ScriptedOnboarding.choose("assistente", choice)
	draft = ScriptedOnboarding.profile_draft()

	BackendBus.set_backend(MockBackend.new())
	await get_tree().create_timer(1.2).timeout
	SetupService.status["container_running"] = true
	SetupService.status["provider_authenticated"] = true
	panel._refresh_chat_mode()
	check.call(panel._input.editable and not panel._send_btn.disabled,
			"testo libero non abilitato dopo provider + agente")
	check.call(panel._choices.get_child_count() >= 2,
			"risposte suggerite assenti nel modo ibrido")
	# Il modulo profilo deve esistere anche senza LLM e includere proprio i
	# campi che determinano il gate ready (email e lingue comprese).
	BackendBus._backend.live = true
	var profile_panel := SectionPanel.new("profile", 24.0)
	add_child(profile_panel)
	await get_tree().process_frame
	await get_tree().process_frame
	check.call(profile_panel._prof_edits.has("email"), "campo email assente dal profilo nativo")
	check.call(profile_panel._prof_edits.has("languages"), "campo lingue assente dal profilo nativo")
	check.call(profile_panel._prof_edits.has("target_role") \
			and profile_panel._prof_edits["target_role"].text == "Software Engineering",
			"bozza scripted non precompila il profilo")
	var ok := failures.is_empty()
	print("GUIDED-ONBOARDING-TEST ", "PASS " if ok else "FAIL ",
			JSON.stringify({"failures": failures, "draft": draft,
					"mentor": ScriptedOnboarding.preferences()}))
	panel.close(false)
	profile_panel.queue_free()
	BackendBus.disconnect_backend()
	await get_tree().create_timer(1.1).timeout
	# Il click reale sopra ha avviato il tick procedurale: rilascia lo stream
	# dal player prima del quit headless, così il test resta leak-free.
	for player in Sfx._pool:
		player.stop()
		player.stream = null
	get_tree().quit(0 if ok else 1)

## Regressione della vista Posizioni dentro il boot normale (gli script `-s`
## non hanno gli autoload): pagine vere e filtri compatti, mai più slice a 40.
func _positions_panel_selftest() -> void:
	var rows: Array = []
	for i in 126:
		rows.append({
			"id": i + 1, "title": "Ruolo %03d" % (i + 1), "company": "Azienda",
			"status": "scored" if i % 2 == 0 else "checked",
			"total_score": 70 + i % 20,
			"role_family": "AI Engineering" if i % 3 == 0 else "Backend Engineering",
			"work_mode": "remote" if i % 2 == 0 else "hybrid",
			"loc_city": "Roma", "loc_country": "Italy",
		})
	BackendBus.positions = rows
	var panel := SectionPanel.new("positions", 24.0)
	add_child(panel)
	await get_tree().process_frame
	await get_tree().process_frame
	var ok := _ui_has_text(panel, "1–50 di 126") \
			and _ui_has_text(panel, "PAGINA 1 / 3") \
			and _ui_find_button(panel, "FILTRI (0)") != null \
			and _ui_count_class(panel, "MenuButton") == 0
	var next := _ui_find_button(panel, "SUCCESSIVA ▶")
	ok = ok and next != null
	if next:
		next.pressed.emit()
		await get_tree().process_frame
		await get_tree().process_frame
		ok = ok and _ui_has_text(panel, "51–100 di 126") \
				and _ui_has_text(panel, "PAGINA 2 / 3")
	var size_25 := _ui_find_button(panel, "25")
	ok = ok and size_25 != null
	if size_25:
		size_25.pressed.emit()
		await get_tree().process_frame
		await get_tree().process_frame
		ok = ok and _ui_has_text(panel, "1–25 di 126") \
				and _ui_has_text(panel, "PAGINA 1 / 6")
	var filters := _ui_find_button(panel, "FILTRI (0)")
	ok = ok and filters != null
	if filters:
		filters.pressed.emit()
		await get_tree().process_frame
		await get_tree().process_frame
		ok = ok and _ui_count_class(panel, "MenuButton") == 4
	print("POSITIONS-PANEL-TEST ", "PASS" if ok else "FAIL")
	get_tree().quit(0 if ok else 1)

## Test/preview deterministico della mappa: 14 offerte coincidenti a Stoccolma
## devono essere tutte raggiungibili e i gesti devono seguire lo stesso asse.
func _map_panel_selftest() -> void:
	var rows: Array = []
	for i in 14:
		rows.append({
			"id": i + 1, "title": "Ruolo Stockholm %02d" % (i + 1),
			"company": "Azienda", "status": "scored", "total_score": 70 + i,
			"role_family": "AI Engineering", "work_mode": "remote",
			"loc_city": "Stockholm", "loc_country": "Sweden",
			"office_lat": 59.3293, "office_lon": 18.0686,
		})
	for extra in [
		{"city": "San Francisco", "country": "United States", "lat": 37.7749, "lon": -122.4194},
		{"city": "Sydney", "country": "Australia", "lat": -33.8688, "lon": 151.2093},
		{"city": "Tokyo", "country": "Japan", "lat": 35.6762, "lon": 139.6503},
		{"city": "Milano", "country": "Italy", "lat": 45.4642, "lon": 9.1900},
		{"city": "Bergamo", "country": "Italy", "lat": 45.6983, "lon": 9.6773},
		{"city": "Roma", "country": "Italy", "lat": 41.9028, "lon": 12.4964},
		{"city": "Torino", "country": "Italy", "lat": 45.0703, "lon": 7.6869},
	]:
		rows.append({
			"id": rows.size() + 1, "title": "Ruolo " + str(extra["city"]),
			"company": "Azienda", "status": "scored", "total_score": 78,
			"role_family": "AI Engineering", "work_mode": "remote",
			"loc_city": extra["city"], "loc_country": extra["country"],
			"office_lat": extra["lat"], "office_lon": extra["lon"],
		})
	BackendBus.positions = rows
	var panel := SectionPanel.new("map", 24.0)
	add_child(panel)
	await get_tree().process_frame
	await get_tree().process_frame
	var world := _ui_find_class_node(panel, "WorldMap") as WorldMap
	if world == null:
		print("MAP-PANEL-TEST FAIL no WorldMap")
		get_tree().quit(1)
		return
	var overview_zoom: float = world._flat._target_zoom
	if OS.get_environment("JHT_SHOT") != "" \
			and OS.get_environment("JHT_MAP_CLUSTER_PREVIEW") == "1":
		return
	world._flat.zoom_f = 4.0
	world._flat._target_zoom = 4.0
	var italy_cluster := {}
	for pin in world._flat._display_pins():
		if bool(pin.get("is_cluster", false)) and str(pin["label"]).begins_with("Italy"):
			italy_cluster = pin
			break
	var cluster_ok := not italy_cluster.is_empty() \
			and int(italy_cluster["source_count"]) == 4
	if cluster_ok:
		world._flat._click_pin(world._flat._to_screen(italy_cluster["norm"]))
		cluster_ok = world._flat._target_zoom > 5.0
	# Un pin isolato aperto dalla panoramica non deve più fare il vecchio
	# mega-zoom 11. La coda deve inoltre scartare una tile obsoleta e contenere
	# soltanto il livello della destinazione corrente.
	world._flat.zoom_f = 4.0
	world._flat._target_zoom = 4.0
	var single_pin := {}
	for pin in world._flat._display_pins():
		if str(pin.get("city", "")) == "San Francisco":
			single_pin = pin
			break
	var auto_zoom_ok := not single_pin.is_empty()
	if auto_zoom_ok:
		world._flat._click_pin(world._flat._to_screen(single_pin["norm"]))
		auto_zoom_ok = world._flat._target_zoom <= 8.01
	world._flat._queue.append("3/0/0")
	world._flat._target_tile_signature = ""
	world._flat._ensure_target_tiles()
	var target_prefix := "%d/" % int(ceil(world._flat._target_zoom))
	var tile_queue_ok := world._flat._queue.size() < 100
	for queued_key in world._flat._queue:
		tile_queue_ok = tile_queue_ok and str(queued_key).begins_with(target_prefix)
	world._flat.fly_to(Vector2(18.0686, 59.3293), 10.0)
	world._flat.select_key("Stockholm|Sweden")
	await get_tree().process_frame
	# Con JHT_SHOT il medesimo scenario resta aperto per l'audit visivo.
	if OS.get_environment("JHT_SHOT") != "":
		return
	var card_count := _ui_count_position_buttons(panel)
	var hint_ok := _ui_has_text(panel,
			"14 posizioni · scorri l’elenco e clicca per aprire la scheda")
	var base_ok := card_count == 14 and hint_ok and world._flat.visible \
			and _ui_find_class_node(panel, "MapGlobe") == null \
			and overview_zoom < 5.0 and cluster_ok and auto_zoom_ok \
			and tile_queue_ok
	var ok := base_ok
	var flat_before: Vector2 = world._flat.center
	var pan := InputEventPanGesture.new()
	pan.delta = Vector2(2.0, 3.0)
	world._flat._gui_input(pan)
	ok = ok and world._flat.center.x < flat_before.x \
			and world._flat.center.y < flat_before.y
	# Percorso reale della sidebar: click riga → navigate("positions") con
	# pending_detail → nuovo SectionPanel già sulla descrizione completa.
	# Il dizionario è condiviso per riferimento con la lambda (gli scalari
	# catturati da GDScript non propagano l'assegnazione al chiamante).
	var route_state := {"section": ""}
	panel.navigate.connect(func(next_section: String) -> void:
		route_state["section"] = next_section)
	var open_btn := _ui_find_position_button(panel, 14)
	ok = ok and open_btn != null
	if open_btn:
		open_btn.pressed.emit()
		await get_tree().process_frame
		var route_ok := str(route_state["section"]) == "positions" \
				and SectionPanel.pending_detail == 14
		ok = ok and route_ok
		var detail_panel := SectionPanel.new("positions", 24.0)
		add_child(detail_panel)
		await get_tree().process_frame
		await get_tree().process_frame
		var detail_ok := detail_panel._current_page == "detail" \
				and detail_panel._pos_detail_id == 14 \
				and _ui_has_text(detail_panel, "Ruolo Stockholm 14")
		ok = ok and detail_ok
		if not ok:
			print("MAP-PANEL-TEST details base=", base_ok, " count=", card_count,
					" hint=", hint_ok, " cluster=", cluster_ok,
					" auto_zoom=", auto_zoom_ok, " tile_queue=", tile_queue_ok,
					" route=", route_ok, " requested=", route_state["section"],
					" pending=", SectionPanel.pending_detail,
					" detail=", detail_ok, " page=", detail_panel._current_page,
					" id=", detail_panel._pos_detail_id)
	print("MAP-PANEL-TEST ", "PASS" if ok else "FAIL")
	get_tree().quit(0 if ok else 1)

func _ui_has_text(node: Node, wanted: String) -> bool:
	if node is Label and node.text == wanted:
		return true
	for child in node.get_children():
		if _ui_has_text(child, wanted):
			return true
	return false

func _ui_find_button(node: Node, wanted: String) -> Button:
	if node is Button and node.text == wanted:
		return node
	for child in node.get_children():
		var found := _ui_find_button(child, wanted)
		if found:
			return found
	return null

func _ui_find_class_node(node: Node, type_name: String) -> Node:
	if node.get_class() == type_name or node.get_script() != null \
			and node.get_script().get_global_name() == type_name:
		return node
	for child in node.get_children():
		var found := _ui_find_class_node(child, type_name)
		if found:
			return found
	return null

func _ui_count_position_buttons(node: Node) -> int:
	var count := 1 if node is Button and node.has_meta("position_id") else 0
	for child in node.get_children():
		count += _ui_count_position_buttons(child)
	return count

func _ui_find_position_button(node: Node, position_id: int) -> Button:
	if node is Button and int(node.get_meta("position_id", 0)) == position_id:
		return node
	for child in node.get_children():
		var found := _ui_find_position_button(child, position_id)
		if found:
			return found
	return null

func _ui_count_class(node: Node, type_name: String) -> int:
	var count := 1 if node.get_class() == type_name else 0
	for child in node.get_children():
		count += _ui_count_class(child, type_name)
	return count

func _force_pipeline_trip(test_dept: String) -> void:
	await get_tree().create_timer(0.8).timeout
	for agent in agents:
		if agent.dept == test_dept:
			agent.set_backend_status("working")
			agent.perform_pipeline_step()
			return

func _force_core_patrol(role: String) -> void:
	await get_tree().create_timer(0.45).timeout
	var actor := _find_agent(role)
	if actor:
		actor.set_backend_status("working")
		actor.perform_patrol()

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
				# Il Dottore ora rientra seduto nel composito della poltrona: la
				# posizione di lavoro include l'offset del sedile, come i reparti.
				and doctor.global_position.distance_to(
						snap.get("work_position", Vector2.INF)) < 1.0 \
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
			# Le copie live dei core restano mobili: la postazione personale è
			# riservata al lead e non può essere occupata da due texture insieme.
			def.erase("workstation_key")
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
