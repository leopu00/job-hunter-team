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
var _story_seen := {}
var _tour_visits := 0
var _tour_enabled := false
var _tour_tracker: TourTracker
var _tour_launch_opened := false
var _traffic_demo_started := false

## Palcoscenico del mondo: di norma è la scena stessa. Col profilo pixel
## diventa un SubViewport a risoluzione ridotta, ingrandito con filtro
## nearest — la GPU riempie un quarto dei pixel (a shrink 2) disegnando le
## stesse cose. La UI vive nei CanvasLayer, fuori di qui, e resta nitida.
var _stage: Node
var _pixel_stage: SubViewportContainer
var _pixel_layer: CanvasLayer
var _render_scale := 1.0

func _ready() -> void:
	_seat_audit = OS.get_environment("JHT_SEAT_AUDIT")
	_doctor_test = OS.get_environment("JHT_DOCTOR_TEST")
	_stage = self
	var wanted := Game.render_scale()
	# Prima di costruire qualsiasi cosa: le targhe e le vignette che nasceranno
	# devono già sapere su quanti pixel verranno disegnate. Va detto SEMPRE,
	# anche a scala piena, perché il fattore è statico e sopravvive a un ritorno
	# in ufficio dopo una partita passata col profilo ridotto.
	WorldText.set_world_scale(wanted)
	if wanted < 0.999:
		set_render_scale(wanted)
	# Stratificazione globale: sfondo (-3), tinte e tappeti (-2), aure degli
	# agenti (-1), mondo y-sortato (0+). Le aure risultano quindi davvero
	# appoggiate al suolo e vengono coperte dagli arredi senza maschere ad hoc.
	var floor_layer := OfficeFloor.new()
	floor_layer.z_index = -3
	_stage.add_child(floor_layer)
	var dressing_layer := DepartmentDressing.new()
	dressing_layer.z_index = -2
	_stage.add_child(dressing_layer)  # tinte/targhe dei 5 reparti (dev-art)
	var rugs_layer := DeptRugs.new()
	rugs_layer.z_index = -2
	_stage.add_child(rugs_layer)  # tappeti persiani rettangolari colore-reparto
	# Pavimento, tinte e tappeti sono disegnati a mano, primitiva per
	# primitiva (fughe, riflessi, ombre): centinaia di draw call che si
	# ripetono ogni frame per un'immagine che non cambia MAI — nessuno dei
	# tre ha _process o queue_redraw. Vengono cotti una volta in una texture
	# e da lì in poi costano una draw call sola.
	# ⚠️ NON ancora attivo di default (25/07): dentro il forno spariscono i
	# due Polygon2D di fondo di OfficeFloor — il void esterno e la base
	# scura del pavimento — perché usano `show_behind_parent`, che con un
	# genitore diverso non li mette più dietro. Risultato: ufficio slavato e
	# void grigio. Il guadagno è reale ma va risolto prima quel dettaglio;
	# fino ad allora si attiva solo con JHT_BAKE=1.
	if OS.get_environment("JHT_BAKE") == "1":
		_bake_backdrop([floor_layer, dressing_layer, rugs_layer])
	# giorno/notte sull'ora locale: esterno, lampade e luce dalle finestre.
	# Va qui, PRIMA di mondo e maintainer, che devono disegnarsi sopra.
	_stage.add_child(DayNight.new())
	if OS.get_environment("JHT_ONLYFLOOR") == "1":  # TEST-AUTO
		var c := Camera2D.new()
		c.position = Vector2(1300, 750)
		_stage.add_child(c)
		c.make_current()
		return

	world = Node2D.new()
	world.name = "World"
	world.y_sort_enabled = true
	_stage.add_child(world)
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
		for visual_key in ["occupied_person_scale", "occupied_person_pivot"]:
			if d.has(visual_key):
				desk_item[visual_key] = d[visual_key]
		var desk_node := FurnitureNode.new(desk_item)
		world.add_child(desk_node)
		# registry per lo scambio vuota/occupata quando l'agente si siede
		FurnitureNode.desks["%s:%d" % [d["dept"], d["index"]]] = desk_node

	# Vetrate complete dei cinque reparti: collisione sottile più parete
	# realmente trasparente. Anche il vecchio lab Analisti usa questo unico
	# perimetro, evitando segmenti doppi o fuori asse.
	var traffic_demo := OS.get_environment("JHT_TRAFFIC_DEMO") == "1"
	# Primo pass diagnostico: ignora i vetri per scoprire i varchi naturali.
	# Senza JHT_TRAFFIC_FREE la stessa demo verifica le porte reali.
	var traffic_free := traffic_demo \
			and OS.get_environment("JHT_TRAFFIC_FREE") == "1"
	for r in DepartmentDefs.GLASS_WALLS:
		if not traffic_free:
			world.add_child(_invisible_wall(r))
		world.add_child(GlassPartition.new(r))
	_add_perimeter_walls()

	var nav_obstacles: Array = FurnitureDefs.obstacles() + DepartmentDefs.obstacles()
	var nav_walls: Array = []
	if not traffic_free:
		nav_walls.append_array(DepartmentDefs.GLASS_WALLS)
	nav_obstacles.append(OutputShelf.RECT)
	nav.build(FurnitureDefs.FLOOR, nav_obstacles, nav_walls)

	# i macchinari si animano quando qualcuno li usa (ping da AgentNPC)
	world.add_child(PrinterFx.new(FurnitureDefs.get_rect("printer")))
	match OS.get_environment("JHT_FX"):  # TEST-AUTO: effetto forzato
		"printer":
			PrinterFx.ping(20.0)

	# Punti di consegna tra reparti. Sono OUTPUT, non generici inbox:
	# Scout → Analisti → Scorer → Scrittori → Critici. Il risultato dei
	# Critici va invece nello scaffale CV PRONTI accanto all'uscita.
	PaperPile.inbox = {}
	var handoff_to := {
		"scout": "Analisi", "analisti": "Compatibilità", "scorer": "Candidature",
		"scrittori": "Controllo qualità",
	}
	for dept_id in handoff_to:
		var inbox_pos: Vector2 = DepartmentDefs.DEPARTMENTS[dept_id]["inbox"]
		var dept_color: Color = DepartmentDefs.DEPARTMENTS[dept_id]["color"]
		var station := HandoffStation.new(dept_id, inbox_pos,
				handoff_to[dept_id], dept_color)
		world.add_child(station)
		var p := PaperPile.new(station.pile_spot())
		# gli Scout producono e basta: il loro inbox si riempie più svelto
		p.restock = 90.0 if DepartmentDefs.FETCH_FROM.has(dept_id) else 45.0
		p.add_sheets(randi_range(1, 6))
		world.add_child(p)
		PaperPile.inbox[dept_id] = p
	# L'anteprima va applicata anche prima del primo snapshot del backend:
	# in modalità NOVPS la pila altrimenti conserva il seme casuale iniziale.
	var pile_preview := OS.get_environment("JHT_PILE_PREVIEW").split(":", false, 1)
	if pile_preview.size() == 2 and PaperPile.inbox.has(pile_preview[0]) \
			and str(pile_preview[1]).is_valid_int():
		PaperPile.inbox[pile_preview[0]].set_target(
				maxi(0, int(pile_preview[1])), true)

	# Primo avvio come showroom: tutti i ruoli fondamentali e due persone per
	# reparto. Il primo snapshot reale li sostituisce senza mai presentare un
	# ufficio vuoto a chi sta ancora configurando il prodotto.
	var initial_defs: Array = []
	var all_seated_preview := OS.get_environment("JHT_ALL_SEATED_PREVIEW") == "1"
	if _seat_audit != "" or _doctor_test != "" or all_seated_preview:
		initial_defs = CharacterDefs.spawn_list()
	elif BackendBus.agents.is_empty():
		initial_defs = CharacterDefs.showroom_list()
	for def in initial_defs:
		if _seat_audit != "":
			var audit_parts := _seat_audit.split(":")
			if audit_parts.size() != 2 or def.get("dept", "") != audit_parts[0] \
					or int(def.get("desk", -1)) != int(audit_parts[1]):
				continue
		var agent := AgentNPC.new()
		world.add_child(agent)
		agent.setup(def, nav)
		# Niente parata d'ingresso all'avvio (feedback Leone 21/07): l'ufficio
		# si RITROVA già al lavoro — è anche la rappresentazione veritiera
		# (gli agenti esistono già) e cancella il picco di lag del boot.
		# `story_mode()` e non `not provider_authenticated()`: dal 25/07 la
		# modalità racconto guarda il canale vivo, non il token (un provider già
		# configurato col container spento spegneva i dialoghi authored).
		agent.set_story_marker(_seat_audit == "" and not all_seated_preview \
				and ScriptedOnboarding.story_mode())
		agents.append(agent)
	if traffic_demo:
		var probe := TrafficProbe.new()
		probe.setup(agents)
		_stage.add_child(probe)
	# Audit visuale locale: con JHT_SEAT_AUDIT=<reparto>:<desk> mostra una
	# vignetta reale sul singolo composito inquadrato, senza dipendere dalla VPS.
	if _seat_audit != "" and OS.get_environment("JHT_SPEECH_AUDIT") == "1" \
			and not agents.is_empty():
		agents[0].say("Verifica ancoraggio sopra la testa")

	_stage.add_child(TesseractEdges.new())  # gli spigoli blu della box (trasparenti)
	add_child(Sfx.make_ambient_hum())

	_camera = FreeCamera.new()
	_stage.add_child(_camera)
	_camera.clicked.connect(_on_world_click)
	if OS.get_environment("JHT_CENSUS") == "1":  # TEST-AUTO: fotografia scena
		_scene_census.call_deferred()
	if OS.get_environment("JHT_GFX_TEST") == "1":
		_gfx_profile_selftest.call_deferred()
	if OS.get_environment("JHT_WIZARD_JUMP_TEST") == "1":
		_wizard_jump_selftest.call_deferred()
	if OS.get_environment("JHT_STUCK_TEST") != "":
		var stuck := Node.new()
		stuck.set_script(load("res://tools/stuck_agent_watcher.gd"))
		get_tree().root.add_child.call_deferred(stuck)
	if OS.get_environment("JHT_WORLD_TEXT_TEST") == "1":
		_world_text_selftest.call_deferred()
	if OS.get_environment("JHT_GRAPHICS_PANEL_TEST") == "1":
		_graphics_panel_selftest.call_deferred()
	if OS.get_environment("JHT_CAMERA_LOCK_TEST") == "1":
		_camera_lock_selftest.call_deferred()
	if OS.get_environment("JHT_POSITIONS_PANEL_TEST") == "1":
		_positions_panel_selftest.call_deferred()
	if OS.get_environment("JHT_MAP_PANEL_TEST") == "1":
		_map_panel_selftest.call_deferred()
	if OS.get_environment("JHT_USAGE_PANEL_TEST") == "1":
		_usage_panel_selftest.call_deferred()
	if OS.get_environment("JHT_GUIDED_TEST") == "1":
		_guided_onboarding_selftest.call_deferred()
	if OS.get_environment("JHT_TOUR_TEST") == "1":
		_tour_selftest.call_deferred()
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
		_stage.add_child(ov)
		ov.make_current()
	elif OS.get_environment("JHT_FOCUS_CORE") == "1":
		# Audit delle due postazioni direzionali: entrambe nello stesso frame,
		# abbastanza vicino da controllare volto, seduta e monitor.
		var core_cam := Camera2D.new()
		core_cam.position = Vector2(1700, 535)
		core_cam.zoom = Vector2(1.45, 1.45)
		_stage.add_child(core_cam)
		core_cam.make_current()
	elif OS.get_environment("JHT_FOCUS_LOUNGE") == "1":
		# Inquadratura di controllo dell'intero angolo: Dottore/Mantenitore a
		# sinistra, tappeto centrato e Mentor seduto di schiena sulla destra.
		var lounge_cam := Camera2D.new()
		lounge_cam.position = Vector2(2490, 1140)
		lounge_cam.zoom = Vector2(1.45, 1.45)
		_stage.add_child(lounge_cam)
		lounge_cam.make_current()
	elif OS.get_environment("JHT_FOCUS_DEPT") != "":
		var focus_id := OS.get_environment("JHT_FOCUS_DEPT")
		if DepartmentDefs.DEPARTMENTS.has(focus_id):
			var focus_cam := Camera2D.new()
			var zone: Rect2 = DepartmentDefs.DEPARTMENTS[focus_id]["zone"]
			focus_cam.position = zone.get_center()
			focus_cam.zoom = Vector2(1.65, 1.65)
			_stage.add_child(focus_cam)
			focus_cam.make_current()

	if _seat_audit == "" and _doctor_test == "" \
			and OS.get_environment("JHT_ALL_SEATED_PREVIEW") != "1":
		_add_hud()
		var sidebar := GameSidebar.new()
		add_child(sidebar)  # sidebar stile desktop-app (linguetta ≡)
		sidebar.chat_requested.connect(_toggle_chat_access)
		# Tour del primo avvio: attivo solo nel flusso reale (titolo → ufficio;
		# ogni test/shot headless imposta JHT_SCENE e resta fuori) o quando il
		# selftest lo forza. Il tour guida con marker mirati, camera e to-do.
		_tour_enabled = OS.get_environment("JHT_TOUR_TEST") == "1" \
				or OS.get_environment("JHT_TOUR_PREVIEW") == "1" \
				or (OS.get_environment("JHT_SCENE") == "" and TourGuide.active() \
					and ScriptedOnboarding.story_mode())
		if _tour_enabled:
			Log.info("tour", "tour primo avvio attivo dal passo %d" % TourGuide.step_index())
			_tour_tracker = TourTracker.new()
			add_child(_tour_tracker)
			TourGuide.changed.connect(_on_tour_changed)
			_refresh_tour_markers()
			# Un breve respiro dopo il primo frame, poi la regia riprende il
			# tour dal punto giusto (primo saluto o tappa interrotta).
			get_tree().create_timer(1.2).timeout.connect(_tour_resume_entry)

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
	var tour_test := OS.get_environment("JHT_TOUR")
	if tour_test != "":
		for a in agents:
			if a.slug == tour_test:
				_start_talk(a)
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
		BackendBus.telemetry_updated.connect(_on_agent_cpu_telemetry)
		if not BackendBus.agents.is_empty():
			sync_agents(BackendBus.agents)
		if not BackendBus.transitions.is_empty():
			_on_transitions([])  # snapshot già sul bus: assorbito come baseline
		if not BackendBus.telemetry.is_empty():
			_on_agent_cpu_telemetry(BackendBus.telemetry, BackendBus.telemetry_history)
		SetupService.status_changed.connect(_on_setup_status_changed)
		_on_setup_status_changed(SetupService.status)

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
	if OS.get_environment("JHT_CHAT_UI_TEST") == "1":
		_chat_ui_selftest.call_deferred()

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
	var entry_test := OS.get_environment("JHT_ENTRY_TEST")
	if entry_test != "":
		_entry_selftest.call_deferred(entry_test)
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
## Riproduce il passo 03 del setup: dall'ufficio si chiede il wizard e la scena
## DEVE cambiare. Sul ThinkPad il click su "Configura" lasciava l'utente in
## ufficio (log pieno di "→ WIZARD" senza mai un cambio, 25/07) e nessuno
## guardava il codice di ritorno di change_scene_to_file.
func _wizard_jump_selftest() -> void:
	# L'osservatore vive su root: se restasse figlio dell'ufficio morirebbe
	# proprio nel momento che deve giudicare, e il test non stamperebbe nulla
	# (primo tentativo, 25/07 — sembrava un blocco, era la coroutine liberata).
	var watcher := Node.new()
	watcher.set_script(load("res://tools/wizard_jump_watcher.gd"))
	get_tree().root.add_child(watcher)


## Il profilo ridotto deve spegnere DAVVERO la scenografia (per due anni ha
## solo alzato un flag che nessuno leggeva) e non deve toccare il resto.
func _gfx_profile_selftest() -> void:
	await get_tree().process_frame
	var result := {}
	var group := get_tree().get_nodes_in_group(GfxProfile.GROUP)
	result["scenografia_registrata"] = group.size() >= 4
	Game.set_low_gfx(true, false)
	await get_tree().process_frame
	var off := 0
	for node in group:
		if node is CanvasItem and not (node as CanvasItem).visible:
			off += 1
	result["spenta_con_profilo_ridotto"] = off == group.size()
	# i mobili e gli agenti restano: il profilo taglia scenografia, non gioco
	result["mobili_intatti"] = world != null and world.visible
	Game.set_low_gfx(false, false)
	await get_tree().process_frame
	var on := 0
	for node in group:
		if node is CanvasItem and (node as CanvasItem).visible:
			on += 1
	result["riaccesa_con_profilo_pieno"] = on == group.size()
	var ok := true
	for key in result:
		ok = ok and bool(result[key])
	print("GFX-PROFILE-TEST %s %s" % ["PASS" if ok else "FAIL",
			JSON.stringify(result)])
	get_tree().quit(0 if ok else 1)


## Impostazioni → Grafica: quello che l'utente sceglie deve arrivare al mondo
## SUBITO e restare. Il test passa dal pannello vero, premendo i bottoni veri:
## se un domani la scelta smette di comandare sulla calibrazione, cade qui.
func _graphics_panel_selftest() -> void:
	await get_tree().process_frame
	var result := {}
	var panel := SectionPanel.new("graphics", 24.0)
	add_child(panel)
	await get_tree().process_frame
	await get_tree().process_frame
	var labels := ""
	for node in panel.find_children("*", "Label", true, false):
		labels += (node as Label).text + "\n"
	var buttons := ""
	for node in panel.find_children("*", "Button", true, false):
		buttons += (node as Button).text + "\n"
	result["quattro_profili_in_elenco"] = buttons.contains(
			UIStrings.t("gfx.auto").to_upper()) \
			and buttons.contains(UIStrings.t("gfx.full").to_upper()) \
			and buttons.contains(UIStrings.t("gfx.balanced").to_upper()) \
			and buttons.contains(UIStrings.t("gfx.performance").to_upper())
	# In automatico il pannello deve dire cosa sta girando ADESSO, non solo che
	# la scelta è "automatico": senza la riga di stato l'utente non sa nulla.
	result["stato_corrente_mostrato"] = labels.contains(
			UIStrings.t("gfx.state") % [int(round(Game.world_scale() * 100.0)),
					UIStrings.t("gfx.scenery_off" if Game.low_gfx else "gfx.scenery_on")])

	_press_graphics_choice(panel, "gfx.performance")
	await get_tree().process_frame
	result["scelta_salvata"] = Game.graphics_choice() == "performance"
	result["scelta_applicata_al_mondo"] = is_equal_approx(Game.world_scale(), 0.6) \
			and is_equal_approx(_render_scale, 0.6)
	result["scenografia_spenta"] = Game.low_gfx
	# La riga chiave: da qui in poi né la calibrazione né la sorveglianza
	# possono più toccare niente.
	result["calibrazione_disinnescata"] = Game._graphics_forced()
	# Il testo del mondo si è adeguato insieme alla scala.
	result["testo_compensato"] = is_equal_approx(WorldText.boost(), 1.0 / 0.6)
	# Riavvio simulato: rileggendo il profilo salvato la scala corrente deve
	# risultare quella scelta, non 1.0. Se qui torna 1.0 la sorveglianza crede
	# di essere a risoluzione piena e non restituisce più definizione a nessuno.
	Game.load_gfx_profile()
	result["scala_nota_dopo_riavvio"] = is_equal_approx(Game.world_scale(), 0.6)

	_press_graphics_choice(panel, "gfx.auto")
	await get_tree().process_frame
	result["ritorno_ad_automatico"] = Game.graphics_choice() == Game.CHOICE_AUTO \
			and not Game._graphics_forced()
	result["riparte_dal_profilo_pieno"] = not Game.low_gfx \
			and is_equal_approx(Game.world_scale(), 1.0)
	# La prossima calibrazione deve partire da zero: nel file non resta nessuna
	# misura vecchia da riapplicare al prossimo avvio. (Che _gfx_done torni
	# false non è verificabile headless: là la calibrazione è spenta per
	# principio, non c'è nessun framerate vero da misurare.)
	var cfg := ConfigFile.new()
	cfg.load(Game.GFX_CONFIG)
	result["nessuna_misura_residua"] = not cfg.has_section_key("graphics", "render_scale") \
			and not cfg.has_section_key("graphics", "low") \
			and str(cfg.get_value("graphics", "mode", "")) == Game.CHOICE_AUTO
	panel.queue_free()
	var ok := true
	for key in result:
		ok = ok and bool(result[key])
	print("GRAPHICS-PANEL-TEST %s %s" % ["PASS" if ok else "FAIL",
			JSON.stringify(result)])
	get_tree().quit(0 if ok else 1)


## Premere il bottone di un profilo come farebbe l'utente. Il pannello si
## ricostruisce a ogni scelta, quindi i bottoni vanno ritrovati ogni volta.
func _press_graphics_choice(panel: SectionPanel, key: String) -> void:
	var wanted := UIStrings.t(key).to_upper()
	for node in panel.find_children("*", "Button", true, false):
		var button := node as Button
		if button.text.begins_with(wanted):
			button.pressed.emit()
			return


## Il testo del mondo resta leggibile a ogni scala di rendering: quando il mondo
## si disegna su meno pixel, targhe e vignette si ingrandiscono della stessa
## proporzione, così il dettaglio in pixel FISICI non cala mai. Qui si misura
## proprio quello, sui nodi vivi dell'ufficio.
func _world_text_selftest() -> void:
	await get_tree().process_frame
	var result := {}
	var tag: AgentStateTag = null
	var bubble: SpeechBubble = null
	for agent in agents:
		if agent.state_tag != null and agent.speech != null:
			tag = agent.state_tag
			bubble = agent.speech
			break
	if tag == null or bubble == null:
		print("WORLD-TEXT-TEST FAIL {\"agenti_con_targa\":false}")
		get_tree().quit(1)
		return
	bubble.say("Ho trovato tre posizioni nuove e le ho passate agli analisti")
	await get_tree().process_frame
	set_render_scale(1.0)
	await get_tree().process_frame
	var full: Dictionary = tag.debug_metrics()
	var full_bubble: Dictionary = bubble.debug_snapshot()
	result["scala_piena_senza_compensazione"] = is_equal_approx(
			float(full["boost"]), 1.0)

	set_render_scale(0.6)
	await get_tree().process_frame
	var low: Dictionary = tag.debug_metrics()
	var low_bubble: Dictionary = bubble.debug_snapshot()
	# 1/0.6 = 1.667: il corpo del testo cresce di tanto, quindi in pixel fisici
	# la targa conserva il dettaglio che aveva a risoluzione piena.
	result["compensazione_pari_alla_scala"] = is_equal_approx(
			float(low["boost"]), 1.0 / 0.6)
	result["targa_ingrandita"] = int(low["font_size"]) >= int(
			round(float(full["font_size"]) / 0.6)) - 1
	result["vignetta_ingrandita"] = int(low_bubble["font_size"]) >= int(
			round(float(full_bubble["font_size"]) / 0.6)) - 1
	# Il riquadro deve continuare a contenere la frase: se crescesse solo il
	# font, il testo uscirebbe dalla targa.
	result["riquadro_contiene_il_testo"] = float(low["box_width"]) \
			> float(low["text_width"])
	# Stessa impaginazione: la larghezza di wrap è cresciuta col font, quindi la
	# vignetta ha la stessa forma — più grande, non ricomposta.
	result["impaginazione_invariata"] = int(low_bubble["lines"]) \
			== int(full_bubble["lines"]) and int(low_bubble["lines"]) > 1
	result["wrap_ingrandito"] = float(low_bubble["max_width"]) \
			> float(full_bubble["max_width"])

	# Il ritorno al profilo pieno riporta il testo alla misura di sempre.
	set_render_scale(1.0)
	await get_tree().process_frame
	result["ritorno_a_scala_piena"] = is_equal_approx(
			float(tag.debug_metrics()["boost"]), 1.0) \
			and int(bubble.debug_snapshot()["font_size"]) == int(full_bubble["font_size"])
	var ok := true
	for key in result:
		ok = ok and bool(result[key])
	print("WORLD-TEXT-TEST %s %s" % ["PASS" if ok else "FAIL",
			JSON.stringify(result)])
	get_tree().quit(0 if ok else 1)


## Fotografia della scena costruita: quanti CanvasItem visibili, da quale ramo
## arrivano e — con la finestra aperta, non headless — quante draw call costa
## ciascun ramo. La misura è differenziale: si spegne un ramo, si guarda di
## quanto scende il contatore, si riaccende. È l'unico modo onesto di attribuire
## le draw call, che non stanno in rapporto 1:1 coi nodi.
## I rami si cercano su `_stage`, non su `self`: col profilo pixel il mondo vive
## dentro il SubViewport e da qui si vedrebbe un solo figlio (PixelLayer).
func _scene_census() -> void:
	for _i in 5:
		await get_tree().process_frame
	Log.census(_stage)
	var baseline := await _draw_calls()
	Log.info("census", "draw call totali: %d" % baseline)
	if baseline > 0:
		var costs := []
		for branch in _stage.get_children():
			var item := branch as CanvasItem
			if item == null or not item.visible:
				continue
			item.visible = false
			var without := await _draw_calls()
			item.visible = true
			costs.append([_census_name(branch), baseline - without])
		costs.sort_custom(func(a: Array, b: Array) -> bool: return a[1] > b[1])
		for row in costs:
			Log.info("census", "  costo %-28s %4d draw call" % [row[0], row[1]])
		if world != null:
			await _census_group(world, baseline)
	get_tree().quit(0)


## Dentro il ramo più caro i figli sono centinaia: si spengono a gruppi
## omogenei (stesso script) per sapere quale famiglia di oggetti costa.
func _census_group(branch: Node, baseline: int) -> void:
	var groups := {}
	for child in branch.get_children():
		if child is CanvasItem:
			var key := _census_name(child)
			if not groups.has(key):
				groups[key] = []
			groups[key].append(child)
	var costs := []
	for key in groups:
		for node: CanvasItem in groups[key]:
			node.visible = false
		var without := await _draw_calls()
		for node: CanvasItem in groups[key]:
			node.visible = true
		costs.append([key, baseline - without, groups[key].size()])
	costs.sort_custom(func(a: Array, b: Array) -> bool: return a[1] > b[1])
	Log.info("census", "dentro %s:" % _census_name(branch))
	for row in costs:
		Log.info("census", "  %-26s %4d draw call su %3d nodi" % [row[0], row[1], row[2]])


## I nodi creati da codice restano anonimi (@Node2D@41): il nome dello script
## è l'unica etichetta leggibile per attribuire il costo.
func _census_name(node: Node) -> String:
	var script: Script = node.get_script() as Script
	if script != null and script.resource_path != "":
		return script.resource_path.get_file().trim_suffix(".gd")
	if not node.name.begins_with("@"):
		return str(node.name)
	return node.get_class()


## Contatore stabilizzato: il monitor si aggiorna a fine frame, quindi va
## letto dopo che il ramo spento è davvero uscito dal rendering.
func _draw_calls() -> int:
	for _i in 3:
		await get_tree().process_frame
	return int(Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME))


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
## pannello chat reale: prima offline choice-only, poi live col mock e scelte
## contestuali prodotte dall'agente (mai sovrapposte al copione authored).
## E2E del tour accompagnato: benvenuto con saluto orario, catena delle
## tappe presentate dall'Assistente, preferenze reali dal Mentor, scelta
## runtime del Coordinatore che apre la pagina giusta, checklist finale.
func _tour_selftest() -> void:
	var failures: Array[String] = []
	var check := func(ok: bool, message: String) -> void:
		if not ok:
			failures.append(message)
	# La macchina che esegue il test può avere Docker e provider veri:
	# lo stato va forzato a "primo avvio" come nel selftest guidato.
	ScriptedOnboarding.set_provider_test_override(0)
	SetupService.status["provider_authenticated"] = false
	SetupService.status["container_running"] = false
	SetupService.status["profile_ready"] = false
	SetupService.status["ready"] = false
	_on_setup_status_changed(SetupService.status)
	await get_tree().create_timer(0.6).timeout
	_refresh_tour_markers()
	check.call(_tour_enabled and TourGuide.active(), "tour non attivo")
	check.call(is_instance_valid(_tour_tracker), "TourTracker assente")
	check.call(TourGuide.current_slug() == "assistente",
			"il tour non parte dall'Assistente")
	for stop in TourGuide.TALK_STEPS:
		check.call(Dialogues.TREES.has(str(TourGuide.scene_for(stop).get("tree", ""))),
				"albero di dialogo mancante per la tappa " + stop)
		if TourGuide.requires_staged_colleague(stop):
			var scene := TourGuide.scene_for(stop)
			check.call(str(scene.get("portrait", "")) == stop,
					"ritratto del collega errato per la tappa " + stop)
			check.call(str(scene.get("name", "")) != "L'Assistente",
					"il reparto parla ancora con la voce dell'Assistente: " + stop)
	check.call(Dialogues.greeting() in ["Buongiorno", "Buon pomeriggio", "Buonasera"],
			"saluto orario fuori catalogo")
	var count_markers := func() -> Array:
		var visible_count := 0
		var marked_slugs := {}
		for a in agents:
			if a.quest_marker != null and a.quest_marker.visible:
				visible_count += 1
				marked_slugs[ScriptedOnboarding.normalize_agent(a.slug)] = true
		return [visible_count, marked_slugs]
	var markers: Array = count_markers.call()
	check.call(markers[1].size() == 1 and markers[1].has("assistente"),
			"marker non limitati all'Assistente (%d visibili)" % int(markers[0]))
	# ordine forzato: un incontro fuori sequenza non avanza il tour
	TourGuide.notify_talked("scout")
	check.call(TourGuide.step_index() == 0, "incontro fuori sequenza avanza il tour")
	# cattura le pagine aperte dalle azioni del tour (scelta runtime)
	var opened_sections: Array = []
	var capture := func(action: String, payload: Dictionary) -> void:
		if action == "open_section":
			opened_sections.append(str(payload.get("section", "")))
	ScriptedOnboarding.action_requested.connect(capture)
	# benvenuto: il click sull'Assistente apre tour_benvenuto
	var guide := _tour_guide_npc()
	check.call(guide != null, "Assistente assente dallo showroom")
	var find_dialogue := func() -> DialogueUI:
		var found: DialogueUI = null
		for child in get_children():
			if child is DialogueUI and not child.is_queued_for_deletion():
				found = child
		return found
	if guide:
		_start_talk(guide)
		await get_tree().process_frame
		var welcome: DialogueUI = find_dialogue.call()
		check.call(welcome != null and welcome._tree.has("ready"),
				"il primo dialogo non usa tour_benvenuto")
		if welcome:
			welcome._close()
	# da qui la catena è automatica (in test-mode senza camminate): a ogni
	# chiusura la tappa avanza e si apre il dialogo successivo
	var expected := ["scout", "analista", "scorer", "scrittore", "critico",
			"dottore", "mentor", "coordinatore"]
	var visited: Array = []
	for _i in expected.size():
		await get_tree().process_frame
		await get_tree().process_frame
		var stop := TourGuide.current_slug()
		var ui: DialogueUI = find_dialogue.call()
		if ui == null:
			failures.append("dialogo della tappa non aperto: " + stop)
			break
		visited.append(stop)
		var scene := TourGuide.scene_for(stop)
		check.call(ui._tree == Dialogues.TREES.get(str(scene.get("tree", "")), {}),
				"albero sbagliato per la tappa " + stop)
		if TourGuide.requires_staged_colleague(stop):
			var colleague := _tour_host_npc(stop)
			check.call(_tour_staged_host == colleague,
					"collega non messo in scena per la tappa " + stop)
			check.call(guide != null and str(guide.rig.facing) == "down" \
					and colleague != null and str(colleague.rig.facing) == "down",
					"personaggi non rivolti all'utente nella tappa " + stop)
		if stop == "mentor":
			# percorso adattivo: le scelte diventano preferenze salvate
			ui._goto("path_change")
			ui._goto("style_calm")
			ui._goto("cad_week")
		elif stop == "coordinatore":
			ui._goto("pick_vps")
		ui._close()
	check.call(visited == expected,
			"sequenza tappe errata: " + JSON.stringify(visited))
	var prefs := ScriptedOnboarding.preferences()
	check.call(prefs.get("career_priority", "") == "growth" \
			and prefs.get("search_style", "") == "cautious" \
			and prefs.get("mentor_cadence", "") == "weekly" \
			and prefs.get("runtime_location", "") == "vps",
			"le scelte del tour non diventano preferenze: " + JSON.stringify(prefs))
	check.call(TourGuide.in_launch_phase(), "fase di lancio non raggiunta")
	check.call(TourGuide.depts_visited() == 5, "conteggio reparti errato")
	await get_tree().process_frame
	check.call(_tour_launch_opened and opened_sections.has("vps"),
			"la scelta VPS non apre la pagina VPS: " + JSON.stringify(opened_sections))
	ScriptedOnboarding.action_requested.disconnect(capture)
	# checklist verde → tour concluso e marker showroom ripristinati
	SetupService.status["ready"] = true
	TourGuide.notify_setup_status(SetupService.status)
	check.call(not TourGuide.active(), "tour non concluso a setup pronto")
	await get_tree().process_frame
	markers = count_markers.call()
	check.call(int(markers[0]) == agents.size(),
			"marker showroom non ripristinati a tour finito (%d)" % int(markers[0]))

	# ── Placeholder personali e stato Docker nei dialoghi ─────────────
	ScriptedOnboarding.set_player_name("Test", "Utente")
	check.call(Dialogues.resolve_placeholders("{greeting}{player}!", TeamData)
			.contains(", Test"), "il saluto non usa il nome dell'utente")
	check.call(TourGuide.invite_line().contains(", Test"),
			"l'invito del tour non usa il nome dell'utente")
	SetupService.status["docker_available"] = false
	SetupService.status["docker_running"] = false
	var no_docker := Dialogues.resolve_placeholders("{docker_line}", TeamData)
	SetupService.status["docker_available"] = true
	SetupService.status["docker_running"] = true
	var docker_on := Dialogues.resolve_placeholders("{docker_line}", TeamData)
	check.call(no_docker.contains("installazione guidata") \
			and docker_on.contains("squadra") and no_docker != docker_on,
			"la battuta del Coordinatore non segue lo stato Docker")

	# ── Giro libero: ordine sparso, alberi in prima persona ───────────
	TourGuide.reset_for_test()
	_tour_launch_opened = false
	SetupService.status["ready"] = false
	check.call(TourGuide.active(), "reset per il giro libero fallito")
	# la scelta "giro libero" avviene DENTRO il benvenuto: prima la modalità,
	# poi la chiusura del dialogo (in guidato partirebbe la regia verso Scout)
	TourGuide.set_free_mode()
	TourGuide.notify_talked("assistente")
	check.call(TourGuide.mode() == "free", "modalità libera non attiva")
	check.call(TourGuide.pending_stops().size() == 8,
			"tappe pendenti errate in giro libero")
	for stop in ["critico", "scout", "mentor"]:
		check.call(TourGuide.stop_open(str(stop)),
				"tappa non apribile in giro libero: " + str(stop))
		check.call(Dialogues.TREES.has(str(TourGuide.scene_for(str(stop)).get("tree", ""))),
				"albero in prima persona mancante per " + str(stop))
	await get_tree().process_frame
	markers = count_markers.call()
	check.call(markers[1].size() == 8 and not markers[1].has("assistente"),
			"marker giro libero errati: " + JSON.stringify(markers[1].keys()))
	for stop in ["critico", "scout", "dottore", "mentor", "scorer", "analista",
			"scrittore"]:
		TourGuide.notify_talked(str(stop))
	check.call(not TourGuide.in_launch_phase(),
			"fase di lancio raggiunta col Coordinatore mancante")
	check.call(TourGuide.depts_visited() == 5,
			"conteggio reparti errato in giro libero")
	TourGuide.notify_talked("coordinatore")
	check.call(TourGuide.in_launch_phase(), "giro libero non arriva al lancio")

	# ── Teaser post-tour: team spento → l'agente invita al setup ──────
	TourGuide.finish()
	await get_tree().process_frame
	var writer: AgentNPC = _tour_host_npc("scrittore")
	check.call(writer != null, "scrittore assente dallo showroom")
	if writer:
		_start_talk(writer)
		await get_tree().process_frame
		var tease: DialogueUI = find_dialogue.call()
		check.call(tease != null and tease._tree_id == "tease_scrittore",
				"il post-tour senza setup non apre il teaser dello scrittore " \
				+ "(ui=%s tree=%s active=%s ready=%s)" % [
					str(tease != null),
					tease._tree_id if tease else "-",
					str(Game.dialogue_active),
					str(SetupService.status.get("ready", "?"))])
		if tease:
			tease._close()
	var ok := failures.is_empty()
	print("TOUR-TEST ", "PASS " if ok else "FAIL ",
			JSON.stringify({"failures": failures, "visited": visited}))
	await get_tree().create_timer(0.3).timeout
	get_tree().quit(0 if ok else 1)

func _guided_onboarding_selftest() -> void:
	var failures: Array[String] = []
	var original_setup := SetupService.status.duplicate(true)
	ScriptedOnboarding.set_provider_test_override(0)
	SetupService.status["provider_authenticated"] = false
	SetupService.status["container_running"] = false
	_on_setup_status_changed(SetupService.status)
	var check := func(ok: bool, message: String) -> void:
		if not ok:
			failures.append(message)
	var demo := DemoPositions.build()
	var families := {}
	for position in demo:
		families[str(position.get("role_family", ""))] = true
	check.call(demo.size() == 50 and families.size() >= 12,
			"catalogo showroom non contiene 50 ruoli trasversali")
	check.call(CharacterDefs.showroom_list().size() == 16,
			"roster showroom non contiene core + due persone per reparto")
	var marker_count := 0
	for showroom_agent in agents:
		if showroom_agent.quest_marker != null and showroom_agent.quest_marker.visible:
			marker_count += 1
	check.call(agents.size() == 16 and marker_count == 16 \
			and BackendBus.positions_are_demo and BackendBus.positions.size() == 50,
			"showroom offline non materializzato end-to-end")
	for role in ["coordinatore", "scout", "analista", "scorer", "scrittore",
			"critico", "mentor", "assistente", "mantenitore", "dottore", "sentinella"]:
		check.call(Dialogues.TREES.has(role), "dialogo showroom assente: " + role)
	var dialogue_agent: AgentNPC = null
	for candidate in agents:
		if candidate.slug == "assistente":
			dialogue_agent = candidate
			break
	if dialogue_agent:
		_start_talk(dialogue_agent)
		await get_tree().process_frame
		var dialogue_ui: DialogueUI = null
		for child in get_children():
			if child is DialogueUI:
				dialogue_ui = child
				break
		check.call(dialogue_ui != null, "click showroom non apre DialogueUI")
		if dialogue_ui:
			dialogue_ui._finish_typing()
			check.call(dialogue_ui._choices_box.get_child_count() == 3,
					"dialogo showroom non rende le scelte")
			dialogue_ui._close()
			await get_tree().process_frame
	ScriptedOnboarding.reset_for_test()
	check.call(ScriptedOnboarding.messages("assistente").size() == 1,
			"welcome Assistente assente")
	check.call(ScriptedOnboarding.options("assistente").size() == 3,
			"scelte Assistente errate")
	for choice in ["start", "software", "backend", "mid", "active", "adjacent",
			"remote_first", "europe", "depends", "permanent", "improve", "scaleup"]:
		ScriptedOnboarding.choose("assistente", choice)
	var draft := ScriptedOnboarding.profile_draft()
	check.call(draft.get("target_role") == "Software Engineering", "ruolo non raccolto")
	check.call(draft.get("experience_years") == "3", "esperienza non raccolta")
	check.call(draft.get("location") == "Europa", "località non raccolta")
	check.call(ScriptedOnboarding.options("assistente").size() == 3,
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
	check.call(ScriptedOnboarding.options("coordinatore").size() == 5,
			"preferenze autonomia Coordinatore assenti")
	for choice in ["review_cv", "balanced", "contextual", "always"]:
		ScriptedOnboarding.choose("coordinatore", choice)
	check.call(ScriptedOnboarding.options("coordinatore").size() == 4,
			"canali opzionali del Coordinatore assenti")
	ScriptedOnboarding.choose("coordinatore", "telegram")
	check.call(str(guided_actions[-1].get("payload", {}).get("section", "")) == "telegram",
			"configurazione Telegram non raggiungibile dalla conversazione")
	ScriptedOnboarding.choose("coordinatore", "skip_channels")
	check.call(ScriptedOnboarding.options("coordinatore").size() == 4,
			"attivazione team non raggiunta dopo i canali")
	ScriptedOnboarding.action_requested.disconnect(capture_action)
	for choice in ["growth", "plateau", "balanced", "low", "steady",
			"analytical", "weekly", "culture", "done"]:
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
	for choice in ["observe", "minimal", "strict", "custom"]:
		ScriptedOnboarding.choose("coordinatore", choice)
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
	for choice in ["salary", "curious", "ambitious", "high", "intensive",
			"direct", "milestones", "hours", "hours"]:
		ScriptedOnboarding.choose("mentor", choice)
	check.call(str(guided_actions[-1].get("payload", {}).get("section", "")) == "hours" \
			and not ScriptedOnboarding.is_complete("mentor"),
			"orari Mentor devono aprire la pagina senza chiudere il percorso")
	ScriptedOnboarding.choose("mentor", "restart")
	check.call(ScriptedOnboarding.options("mentor").size() == 7 \
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
	check.call(pressed_first and ScriptedOnboarding.options("assistente").size() == 7,
			"il primo bottone della chat non avanza al ruolo")
	for choice in ["software", "fullstack", "mid", "employed", "exact",
			"remote", "remote_only", "never", "employee", "market", "established"]:
		ScriptedOnboarding.choose("assistente", choice)
	draft = ScriptedOnboarding.profile_draft()
	check.call(ScriptedOnboarding.answers().size() >= 12,
			"le risposte onboarding non sono state strutturate")
	check.call(ScriptedOnboarding.llm_context_text().contains("target_role") \
			and ScriptedOnboarding.llm_context_text().contains("Software Engineering") \
			and ScriptedOnboarding.llm_context().get("schema_version", 0) == 2,
			"contesto LLM onboarding incompleto")
	ScriptedOnboarding.remember_profile_fields({"name": "Ada Test",
			"email": "ada@example.test", "languages": "Italiano, English"})
	ScriptedOnboarding.record_dialogue_choice("tour_scout", "n2",
			"Posso indicare aziende o tipi di lavoro preferiti?", "sources")
	check.call(ScriptedOnboarding.llm_context_text().contains("Ada Test") \
			and ScriptedOnboarding.profile_draft().get("email", "") == "ada@example.test" \
			and ScriptedOnboarding.llm_context_text().contains("lavoro preferiti"),
			"dati del profilo nativo non sincronizzati nel contesto LLM")

	BackendBus.set_backend(MockBackend.new())
	await get_tree().create_timer(1.2).timeout
	SetupService.status["container_running"] = true
	SetupService.status["provider_authenticated"] = true
	ScriptedOnboarding.set_provider_test_override(1)
	panel._refresh_chat_mode()
	await get_tree().process_frame
	await get_tree().process_frame
	check.call(panel._input.editable and not panel._send_btn.disabled,
			"testo libero non abilitato dopo provider + agente")
	check.call(panel._choices.get_child_count() == 0,
			"le risposte authored non spariscono dopo il login provider")
	panel._on_updated("assistente", [{"role": "assistant", "text": "Scegli tu.",
			"done": true, "choices": [
				{"label": "Controlla il profilo", "value": "Controlla il profilo"},
				{"label": "Mostra le posizioni", "value": "Mostra le posizioni"},
			]}])
	await get_tree().process_frame
	await get_tree().process_frame
	check.call(panel._choices.get_child_count() == 3,
			"risposte suggerite generate dall'agente non renderizzate")
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

	# Regressione 24/07 — provider GIÀ configurato e container ancora spento:
	# prima i dialoghi authored si spegnevano al solo vedere il token e la
	# chat viva non era disponibile, lasciando l'utente senza interlocutore.
	# Il criterio è il canale, non il token; e i passi già soddisfatti si
	# riconciliano invece di attendere un login che non arriverà mai.
	SetupService.status["container_running"] = false
	SetupService.status["provider_authenticated"] = true
	ScriptedOnboarding.set_provider_test_override(1)
	check.call(ScriptedOnboarding.use_scripted_chat("assistente") \
			and ScriptedOnboarding.use_scripted_chat("coordinatore"),
			"con container spento la chat guidata deve restare disponibile")
	check.call(not ScriptedOnboarding.live_text_available("coordinatore"),
			"senza container non può esistere testo libero verso l'agente reale")
	check.call(ScriptedOnboarding.story_mode(),
			"senza container l'ufficio deve restare in modalità racconto")
	ScriptedOnboarding._steps["coordinatore"] = "provider"
	ScriptedOnboarding._reconcile_with_status(SetupService.status)
	check.call(str(ScriptedOnboarding._steps["coordinatore"]) == "profile",
			"il passo provider va marcato fatto, non lasciato su un login impossibile")
	ScriptedOnboarding._steps["coordinatore"] = "runtime"
	SetupService.status["container_running"] = true
	ScriptedOnboarding._reconcile_with_status(SetupService.status)
	check.call(str(ScriptedOnboarding._steps["coordinatore"]) == "profile",
			"con runtime e provider pronti si arriva diretti al profilo")
	check.call(not ScriptedOnboarding.story_mode(),
			"con team operativo la modalità racconto deve chiudersi")

	# Pannello Docker: deve mostrare la versione del runtime e l'azione di
	# aggiornamento, altrimenti l'utente resta su un'immagine vecchia senza
	# nemmeno saperlo (il gioco si aggiorna con l'installer, il container no).
	SetupService.status["docker_running"] = true
	SetupService.status["container_exists"] = true
	SetupService.status["runtime_stale"] = true
	var docker_panel := SectionPanel.new("docker", 24.0)
	add_child(docker_panel)
	await get_tree().process_frame
	await get_tree().process_frame
	var docker_labels := ""
	var docker_buttons := ""
	for node in docker_panel.find_children("*", "", true, false):
		if node is Label:
			docker_labels += (node as Label).text + "\n"
		elif node is Button:
			docker_buttons += (node as Button).text + "\n"
	check.call(docker_labels.contains(UIStrings.t("setup.runtime_stale")),
			"il pannello Docker non segnala il runtime da aggiornare")
	check.call(docker_buttons.contains(UIStrings.t("setup.runtime_update")),
			"il pannello Docker non offre l'aggiornamento del runtime")
	docker_panel.queue_free()
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
	SetupService.status = original_setup
	ScriptedOnboarding.set_provider_test_override(-1)
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

## Regressione delle finestre di monitoraggio risorse: storico sintetico
## sul bus → finestra Usage con le tre quote e i controlli temporali,
## poi Consumi agenti con classifica/donut coerenti e isolamento a click.
func _usage_panel_selftest() -> void:
	var now := Time.get_unix_time_from_system()
	var sentinel: Array = []
	var meter: Array = []
	var rows: Array = []
	var t := now - 18000.0
	while t <= now:
		sentinel.append({"t": t, "usage": 40.0, "weekly": 60.0,
				"velocity": 12.0, "projection": 55.0, "throttle": 0.0})
		meter.append({"t": t, "weighted_kt": 5000.0, "events": 120})
		rows.append({"t": t, "critico": 30.0, "scout-1": 12.0})
		t += 300.0
	UsageRangeBar.span_idx = 0
	UsageRangeBar.to_ts = 0.0
	BackendBus.publish_usage_history(
			{"from_ts": now - 18000.0, "to_ts": now, "bucket_sec": 300},
			{"ok": true, "sentinel": sentinel, "meter": meter,
				"agents": {"names": ["critico", "scout-1"], "series": rows,
					"totals_kt": {"critico": 1830.0, "scout-1": 732.0}}})
	var panel := SectionPanel.new("usage_history", 24.0)
	add_child(panel)
	await get_tree().process_frame
	await get_tree().process_frame
	var chart := _ui_find_class_node(panel, "UsageChart") as UsageChart
	var history_ok := chart != null and chart._series.size() == 3 \
			and _ui_find_button(panel, "QUOTE %") != null \
			and _ui_find_button(panel, "5H") != null \
			and _ui_find_button(panel, "ORA") != null
	if history_ok:
		for s in chart._series:
			history_ok = history_ok and (s["points"] as Array).size() >= 60
	panel.queue_free()
	var agents_panel := SectionPanel.new("usage_agents", 24.0)
	add_child(agents_panel)
	await get_tree().process_frame
	await get_tree().process_frame
	var stacked := _ui_find_class_node(agents_panel, "UsageChart") as UsageChart
	var rank_btn := _ui_find_button(agents_panel, "critico")
	# 1830 / (1830+732) = 71%: classifica e donut concordano
	var agents_ok := stacked != null and stacked._series.size() == 2 \
			and rank_btn != null \
			and _ui_has_text(agents_panel, "critico · 71%")
	if rank_btn:
		rank_btn.pressed.emit()
		await get_tree().process_frame
		agents_ok = agents_ok and stacked._series.size() == 1
	agents_panel.queue_free()
	# deep-link dalla card: pending_agent → pagina agente col grafico
	# storico multi-asse (e i suoi interruttori TUTTE/NESSUNA)
	SectionPanel.pending_agent = "scout"
	var page_panel := SectionPanel.new("agents", 24.0)
	add_child(page_panel)
	await get_tree().process_frame
	await get_tree().process_frame
	var history := _ui_find_class_node(page_panel, "AgentHistoryChart")
	var page_ok := page_panel._current_page == "agent" \
			and page_panel._agent_detail == "scout" \
			and SectionPanel.pending_agent == "" \
			and history != null \
			and _ui_find_button(page_panel, UIStrings.t("agent.history_all")) != null
	var ok := history_ok and agents_ok and page_ok
	if not ok:
		print("USAGE-PANEL-TEST details history=", history_ok,
				" agents=", agents_ok, " page=", page_ok)
	print("USAGE-PANEL-TEST ", "PASS" if ok else "FAIL")
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

func _start_traffic_demo() -> void:
	await get_tree().create_timer(0.8).timeout
	for agent in agents:
		if agent.dept == "" or agent.is_dissolving():
			continue
		agent.set_backend_status("working")
		agent.perform_pipeline_step(true)
	Log.info("test", "traffic demo: %d agenti messi in viaggio" % agents.size())

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
	var previous := actor.global_position
	var max_step := 0.0
	while int(actor.debug_snapshot().get("pipeline_trips", 0)) < baseline + 1 \
			and Time.get_ticks_msec() < deadline:
		await get_tree().physics_frame
		var step := actor.global_position.distance_to(previous)
		max_step = maxf(max_step, step)
		previous = actor.global_position
	# Consenti alla posa seduta e alla maschera collisione di stabilizzarsi.
	for _i in 3:
		await get_tree().physics_frame
	var snap := actor.debug_snapshot()
	var ok := int(snap.get("pipeline_trips", 0)) == baseline + 1 \
			and int(snap.get("pending_pipeline", -1)) == 0 \
			and int(snap.get("state", -1)) == AgentNPC.S.WORK \
			and not bool(snap.get("forced_trip", true)) \
			and int(snap.get("collision_mask", -1)) == 0 \
			# Il cambio seduto/in piedi può spostare fino a ~100 px; qualunque
			# salto maggiore rivela un teletrasporto fra pila e scrivania.
			and max_step < 130.0 \
			and actor.global_position.distance_to(
					snap.get("work_position", Vector2.INF)) < 1.0
	snap["max_frame_step"] = max_step
	print("PIPELINE-FORCE-TEST ", "PASS" if ok else "FAIL", " ", JSON.stringify(snap))
	get_tree().quit(0 if ok else 1)

func _entry_selftest(role: String) -> void:
	await get_tree().create_timer(0.8).timeout
	var actor := _find_agent(role)
	if actor == null:
		print("ENTRY-CONTINUITY-TEST FAIL no actor for ", role)
		get_tree().quit(1)
		return
	actor.set_backend_status("idle")
	actor.enter_through(ENTRY_SPOT)
	await get_tree().physics_frame
	var started_at_door := actor.global_position.distance_to(ENTRY_SPOT) < 60.0 \
			and bool(actor.debug_snapshot().get("entering", false))
	var previous := actor.global_position
	var max_step := 0.0
	var deadline := Time.get_ticks_msec() + 45000
	while bool(actor.debug_snapshot().get("entering", false)) \
			and Time.get_ticks_msec() < deadline:
		await get_tree().physics_frame
		max_step = maxf(max_step, actor.global_position.distance_to(previous))
		previous = actor.global_position
	var snap := actor.debug_snapshot()
	var ok := started_at_door and max_step < 130.0 \
			and not bool(snap.get("entering", true)) \
			and bool(snap.get("desk_pose", false)) \
			and actor.global_position.distance_to(
					snap.get("work_position", Vector2.INF)) < 1.0
	snap["max_frame_step"] = max_step
	print("ENTRY-CONTINUITY-TEST ", "PASS" if ok else "FAIL", " ",
			JSON.stringify(snap))
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

func _chat_ui_selftest() -> void:
	await get_tree().process_frame
	BackendBus.clear_chat_unread()
	BackendBus.publish_chat({"ts": "ui-1", "from": "coordinatore",
			"to": "user", "text": "Aggiornamento per te"})
	await get_tree().process_frame
	var sidebar: GameSidebar
	for child in get_children():
		if child is GameSidebar:
			sidebar = child
			break
	var badge_ok := sidebar != null and "1" in sidebar._tab.text
	_open_chat_menu()
	await get_tree().process_frame
	var menu_ok := _chat_menu != null and _chat_menu._agents.size() == 3
	var coordinator := _find_agent("coordinatore")
	if _chat_menu:
		_chat_menu.close(false)
	await get_tree().process_frame
	if coordinator:
		_open_chat(coordinator)
	await get_tree().process_frame
	var read_ok := BackendBus.chat_unread_count("capitano") == 0 \
			and _chat_panel != null
	if _chat_panel:
		_chat_panel.close(false)
	await get_tree().process_frame
	var close_ok := _chat_panel == null
	_toggle_chat_access()
	await get_tree().process_frame
	var reopen_ok := _chat_menu != null
	_toggle_chat_access()
	await get_tree().process_frame
	var toggle_close_ok := _chat_menu == null
	if coordinator:
		deliver_chat("coordinatore", "user", "Aggiornamento per te")
	await get_tree().process_frame
	var overlap_ok := coordinator != null \
			and coordinator.state_tag.debug_suppressed() \
			and not coordinator.state_tag.visible
	var assistant := _find_agent("assistente")
	if coordinator and assistant:
		deliver_chat("coordinatore", "assistente", "Passaggio completato")
	var received_ok := assistant != null \
			and assistant.state_tag.debug_label().begins_with("MESSAGGIO DA")
	var ok := badge_ok and menu_ok and read_ok and close_ok and reopen_ok \
			and toggle_close_ok and overlap_ok and received_ok
	print("CHAT-UI-TEST ", "PASS" if ok else "FAIL", " ", JSON.stringify({
			"badge": badge_ok, "menu": menu_ok, "read": read_ok,
			"close": close_ok, "reopen": reopen_ok,
			"toggle_close": toggle_close_ok, "overlap": overlap_ok,
			"received": received_ok}))
	BackendBus.clear_chat_unread()
	get_tree().quit(0 if ok else 1)

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
			and not (event.meta_pressed or event.ctrl_pressed):
		_toggle_chat_access()
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
var _thinking_panel: AgentThinkingPanel
var _coordinator_panel: CoordinatorPanel

## Click "pulito" dalla FreeCamera: agente > bacheca > reparto.
func _on_world_click(target: Vector2) -> void:
	if Game.dialogue_active:
		return
	if _registry or _dept_panel or _agent_card or _chat_panel or _cv_shelf_panel \
			or _queue_panel or _thinking_panel or _coordinator_panel:
		return  # con un pannello aperto, il mondo non riceve click
	for agent in agents:
		if agent.hit_by(target):
			if ScriptedOnboarding.story_mode() and agent.uid == "":
				_start_talk(agent)
			else:
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

var _last_queue_hover := ""
var _last_shelf_hover := false

func _update_hover() -> void:
	var best: AgentNPC = null
	var shelf_hovered := false
	var queue_hovered := ""
	if not Game.dialogue_active and not _registry and not _dept_panel \
			and not _agent_card and not _chat_panel and not _cv_shelf_panel \
			and not _queue_panel and not _thinking_panel and not _coordinator_panel:
		var mouse := get_global_mouse_position()
		for agent in agents:
			if agent.hit_by(mouse):
				best = agent
				break
		if best == null:
			queue_hovered = PaperPile.inbox_at(mouse)
			if queue_hovered == "":
				shelf_hovered = OutputShelf.hit_by(mouse)
	# Broadcast solo al cambio: prima si rifacevano i giri su pile e
	# scaffale a ogni frame anche col mouse fermo nel vuoto.
	if queue_hovered != _last_queue_hover:
		_last_queue_hover = queue_hovered
		PaperPile.highlight_inbox(queue_hovered)
	if shelf_hovered != _last_shelf_hover:
		_last_shelf_hover = shelf_hovered
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
	_agent_card.thinking_requested.connect(func() -> void: _open_agent_thinking(agent))
	# scheda completa: sezione Agenti sulla pagina del ruolo, con i
	# grafici storici — stesso deep-link pattern di pending_detail
	_agent_card.stats_requested.connect(func() -> void:
		SectionPanel.pending_agent = agent.slug
		ScriptedOnboarding.action_requested.emit("open_section",
				{"section": "agents"}))
	_agent_card.coordinator_requested.connect(func() -> void: _open_coordinator_panel(agent))
	_agent_card.closed.connect(func() -> void:
		_agent_card = null)

func _open_agent_thinking(agent: AgentNPC) -> void:
	if agent.uid == "" or not BackendBus.can_chat_with(agent.uid):
		return
	Log.info("agent", "stream tmux read-only aperto: %s" % agent.uid)
	_thinking_panel = AgentThinkingPanel.new(
			agent.uid, agent.display_name, agent.accent_color())
	add_child(_thinking_panel)
	_thinking_panel.closed.connect(func() -> void:
		_thinking_panel = null)

func _open_coordinator_panel(agent: AgentNPC) -> void:
	if agent.slug != "coordinatore" or not BackendBus.can_chat_with(
			agent.uid if agent.uid != "" else agent.slug):
		return
	Log.info("agent", "console operativa del Coordinatore aperta")
	_coordinator_panel = CoordinatorPanel.new(agent.accent_color())
	add_child(_coordinator_panel)
	_coordinator_panel.closed.connect(func() -> void:
		_coordinator_panel = null)

var _chat_panel: ChatPanel
var _chat_menu: ChatMenu

## Lista degli agenti in scena → chat individuale (tasto C).
func _open_chat_menu() -> void:
	if _chat_menu or _chat_panel:
		return
	Log.info("chat", "menu chat aperto (%d agenti)" % agents.size())
	_chat_menu = ChatMenu.new(_chat_roster())
	add_child(_chat_menu)
	_chat_menu.closed.connect(func() -> void: _chat_menu = null)
	_chat_menu.open_chat.connect(func(slug: String, display_name: String) -> void:
		if ScriptedOnboarding.story_mode():
			for candidate in agents:
				if candidate.uid == "" and candidate.slug == slug \
						and candidate.display_name == display_name:
					_start_talk(candidate)
					return
		Log.info("chat", "pannello chat aperto dal menu con " + slug)
		_chat_panel = ChatPanel.new(slug, display_name, _chat_roster())
		add_child(_chat_panel)
		_chat_panel.closed.connect(func() -> void: _chat_panel = null))

## Roster per lo switcher del pannello chat: stesse coppie slug/nome del
## menu (uid quando l'agente è backend-driven, es. "scout-2").
func _chat_roster() -> Array:
	var roster: Array = []
	for a in agents:
		var ref: String = a.slug if a.uid == "" else a.uid
		if BackendBus.chat_replies(ref) or ScriptedOnboarding.supports(a.slug):
			roster.append({"slug": ref, "name": a.display_name})
	return roster

## Un solo gesto apre o chiude l'accesso rapido. La X/Esc del singolo overlay
## usa gli stessi close(), quindi i riferimenti tornano sempre null.
func _toggle_chat_access() -> void:
	if _chat_panel:
		_chat_panel.close()
		return
	if _chat_menu:
		_chat_menu.close()
		return
	if _agent_card == null:
		_open_chat_menu()

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
	var tour_running := _tour_enabled and TourGuide.active()
	var slug := ScriptedOnboarding.normalize_agent(agent.slug)
	# Giro libero: una tappa pendente apre la conversazione DIRETTA con
	# l'agente del reparto (prima persona), senza regia dell'Assistente.
	if tour_running and TourGuide.mode() == "free" and TourGuide.stop_open(slug):
		_camera.focus_on(agent.global_position + Vector2(0, -40), 1.05)
		_tour_open_stop_dialogue(slug)
		return
	if ScriptedOnboarding.story_mode():
		_story_seen[agent.slug] = true
		_tour_visits += 1
		if not tour_running:
			agent.set_story_marker(true, true)
		if _tour_visits == 3 and not tour_running:
			var helper := _find_agent("assistente")
			if helper:
				helper.say("Per domande libere e personali collega un provider dal setup. L'ufficio demo resta sempre esplorabile.")
	agent.start_talk()
	var ui := DialogueUI.new()
	add_child(ui)
	# Il primo saluto del tour: cliccando l'Assistente parte l'accoglienza
	# completa (saluto legato all'orario) e da lì in poi accompagna lei —
	# o, se l'utente sceglie così, si prosegue in giro libero.
	var is_guide := slug == "assistente"
	var tour_welcome := tour_running and is_guide \
			and TourGuide.current_slug() == "assistente"
	var tree_id := ""
	if tour_welcome:
		tree_id = "tour_benvenuto"
	elif not tour_running and not bool(SetupService.status.get("ready", false)) \
			and Dialogues.TREES.has("tease_" + slug):
		# Tour chiuso ma team ancora spento: l'agente si presenta in breve
		# e riporta con garbo alla checklist (mai le stesse risposte esaurite).
		tree_id = "tease_" + slug
	ui.action_triggered.connect(_on_tour_dialogue_action)
	ui.open(agent.slug, agent.display_name, tree_id)
	ui.closed.connect(func() -> void:
		if is_instance_valid(agent) and not agent.is_dissolving():
			agent.end_talk()
		if not (_tour_enabled and TourGuide.active()):
			return
		if tour_welcome:
			TourGuide.notify_talked("assistente")
		elif is_guide and TourGuide.mode() != "free" \
				and TourGuide.current_slug() != "assistente" \
				and not TourGuide.in_launch_phase():
			# l'utente ha fermato la guida per strada: il giro riprende
			_tour_go_to_stop())

# ── Tour del primo avvio: l'Assistente accompagna (TourGuide) ─────────

var _tour_runtime_choice := ""
var _tour_walk_serial := 0
var _tour_staged_host: AgentNPC

## Il diamante pulsa SOLO sull'Assistente al primo passo: da lì in poi è
## lei a fare strada. A tour finito torna il default showroom (marker su
## tutti finché il provider non è collegato).
func _refresh_tour_markers() -> void:
	var tour_running := _tour_enabled and TourGuide.active()
	var free_pending: Array = TourGuide.pending_stops() \
			if tour_running and TourGuide.mode() == "free" else []
	for agent in agents:
		if tour_running:
			var slug := ScriptedOnboarding.normalize_agent(agent.slug)
			if TourGuide.mode() == "free" and TourGuide.step_index() >= 1:
				# giro libero: il diamante segna OGNI tappa ancora da visitare
				agent.set_story_marker(free_pending.has(slug), false)
			else:
				agent.set_story_marker(slug == "assistente" \
						and TourGuide.current_slug() == "assistente", false)
		else:
			agent.set_story_marker(ScriptedOnboarding.story_mode(),
					bool(_story_seen.get(agent.slug, false)))

func _on_tour_changed() -> void:
	_refresh_tour_markers()
	if not TourGuide.active():
		_tour_release_guide()
		return
	if TourGuide.in_launch_phase():
		# Il giro è finito: la guida torna al suo posto e la checklist di
		# lancio prende la scena (se il Coordinatore non l'ha già aperta).
		_tour_release_guide()
		if not _tour_launch_opened:
			_tour_launch_opened = true
			ScriptedOnboarding.action_requested.emit("open_section",
					{"section": "activation"})
		return
	if TourGuide.mode() == "free":
		return  # niente accompagnamento: i diamanti fanno da guida
	if TourGuide.current_slug() == "assistente":
		_tour_focus_current()
		return
	_tour_go_to_stop()

## Ripresa all'avvio scena: primo saluto o tappa dove si era rimasti.
func _tour_resume_entry() -> void:
	if not _tour_enabled or not TourGuide.active() or TourGuide.in_launch_phase():
		return
	if TourGuide.mode() == "free":
		return  # i marker sono già accesi sulle tappe pendenti
	if TourGuide.current_slug() == "assistente":
		_tour_focus_current()
	else:
		_tour_go_to_stop()

## Primo passo: camera sull'Assistente, saluto legato all'orario, diamante.
func _tour_focus_current() -> void:
	if not _tour_enabled or not TourGuide.active() or Game.dialogue_active:
		return
	var guide := _tour_guide_npc()
	if guide == null:
		return
	_camera.focus_on(guide.global_position + Vector2(0, -40), 1.05)
	guide.say(TourGuide.invite_line())

func _tour_guide_npc() -> AgentNPC:
	for agent in agents:
		if ScriptedOnboarding.normalize_agent(agent.slug) == "assistente" \
				and not agent.is_dissolving():
			return agent
	return null

func _tour_host_npc(stop: String) -> AgentNPC:
	for agent in agents:
		if ScriptedOnboarding.normalize_agent(agent.slug) == stop \
				and not agent.is_dissolving():
			return agent
	return null

## Regia di una tappa: l'Assistente cammina fin lì (camera al seguito),
## saluta, l'ospite risponde, poi si apre il dialogo della tappa.
func _tour_go_to_stop() -> void:
	var stop := TourGuide.current_slug()
	if stop == "":
		return
	var guide := _tour_guide_npc()
	var host := _tour_host_npc(stop)
	if host == null:
		# tappa impossibile (roster cambiato sotto i piedi): mai bloccare
		TourGuide.notify_talked(stop)
		return
	if guide == null or guide == host \
			or OS.get_environment("JHT_TOUR_TEST") == "1":
		# senza accompagnatrice (o nei selftest) la regia va dritta al punto
		_camera.focus_on(host.global_position + Vector2(0, -40), 1.05)
		_tour_stage_arrival(stop)
		return
	_camera.follow(guide, 1.0)
	_tour_walk_serial += 1
	var serial := _tour_walk_serial
	var on_arrival := func() -> void:
		if serial == _tour_walk_serial and _tour_enabled \
				and TourGuide.current_slug() == stop:
			_tour_stage_arrival(stop)
	guide.tour_arrived.connect(on_arrival, CONNECT_ONE_SHOT)
	guide.tour_walk_to(host.global_position)

## All'arrivo l'Assistente resta frontale e, per i reparti, invita un collega
## ad alzarsi e a raggiungerla. Soltanto quando i due sono affiancati parte
## la presentazione: niente persone di schiena o dialoghi dalla scrivania.
func _tour_stage_arrival(stop: String) -> void:
	_camera.stop_follow()
	var guide := _tour_guide_npc()
	var host := _tour_host_npc(stop)
	if guide:
		guide.tour_face_audience()
	if TourGuide.requires_staged_colleague(stop) and guide and host \
			and guide != host:
		_tour_stage_colleague(stop, guide, host)
		return
	if host:
		host.tour_face_audience()
		_camera.focus_on(host.global_position + Vector2(0, -40), 1.05)
	_tour_begin_presentation(stop, guide, host)

## Compone una coppia orizzontale su un punto realmente camminabile. Prova
## prima destra e sinistra dell'Assistente e usa l'avvicinamento libero solo
## come ripiego se una scrivania occupa entrambi i lati.
func _tour_stage_colleague(stop: String, guide: AgentNPC, host: AgentNPC) -> void:
	_tour_staged_host = host
	if OS.get_environment("JHT_TOUR_TEST") == "1":
		host.tour_face_audience()
		_camera.focus_on((guide.global_position + host.global_position) * 0.5 \
				+ Vector2(0, -40), 1.05)
		_tour_begin_presentation(stop, guide, host)
		return
	var chosen := Vector2.INF
	var best_cost := INF
	for direction in [1.0, -1.0]:
		var candidate := guide.global_position + Vector2(82.0 * direction, 0)
		if not host.nav.is_point_walkable(candidate):
			continue
		var route := host.nav.path(host.global_position, candidate)
		if route.is_empty() or route[-1].distance_to(candidate) > 24.0:
			continue
		var cost := host.global_position.distance_to(route[0])
		for i in range(1, route.size()):
			cost += route[i - 1].distance_to(route[i])
		if cost < best_cost:
			best_cost = cost
			chosen = candidate
	if chosen == Vector2.INF:
		chosen = host.nav.approach_point(host.global_position,
				guide.global_position, 82.0)
	_tour_walk_serial += 1
	var serial := _tour_walk_serial
	var on_host_arrival := func() -> void:
		if serial != _tour_walk_serial or not _tour_enabled \
				or TourGuide.current_slug() != stop:
			return
		guide.tour_face_audience()
		host.tour_face_audience()
		_camera.focus_on((guide.global_position + host.global_position) * 0.5 \
				+ Vector2(0, -40), 1.05)
		_tour_begin_presentation(stop, guide, host)
	host.tour_arrived.connect(on_host_arrival, CONNECT_ONE_SHOT)
	host.tour_walk_exact(chosen)

## Scambio di battute in scena: prima presenta l'Assistente, poi risponde il
## collega. La finestra successiva appartiene allo stesso collega.
func _tour_begin_presentation(stop: String, guide: AgentNPC,
		host: AgentNPC) -> void:
	var scene := TourGuide.scene_for(stop)
	if OS.get_environment("JHT_TOUR_TEST") == "1":
		_tour_open_stop_dialogue(stop)
		return
	if guide and scene.has("greet"):
		guide.say(str(scene["greet"]))
	if host and scene.has("reply"):
		get_tree().create_timer(1.3).timeout.connect(func() -> void:
			if is_instance_valid(host) and TourGuide.current_slug() == stop:
				host.say(str(scene["reply"])))
	get_tree().create_timer(3.0).timeout.connect(func() -> void:
		_tour_open_stop_dialogue(stop))

## Apre il dialogo della tappa appena la scena è libera (ritenta finché
## un pannello o un altro dialogo occupano lo schermo).
func _tour_open_stop_dialogue(stop: String) -> void:
	if not _tour_enabled or not TourGuide.stop_open(stop):
		return
	if Game.dialogue_active or _registry or _dept_panel or _agent_card \
			or _chat_panel or _cv_shelf_panel or _queue_panel \
			or _thinking_panel or _coordinator_panel:
		get_tree().create_timer(0.8).timeout.connect(func() -> void:
			_tour_open_stop_dialogue(stop))
		return
	var scene := TourGuide.scene_for(stop)
	var host := _tour_host_npc(stop)
	var guide := _tour_guide_npc()
	if guide:
		guide.tour_face_audience()
	if host:
		host.start_talk()
	var ui := DialogueUI.new()
	add_child(ui)
	ui.action_triggered.connect(_on_tour_dialogue_action)
	ui.open(str(scene.get("portrait", "assistente")),
			str(scene.get("name", "L'Assistente")), str(scene.get("tree", "")))
	ui.closed.connect(func() -> void:
		if host == _tour_staged_host:
			_tour_staged_host = null
		if host and is_instance_valid(host) and not host.is_dissolving():
			host.end_talk()
		if not TourGuide.active():
			return
		if stop == "coordinatore" and _tour_runtime_choice != "":
			# la scelta del Coordinatore apre la pagina giusta e il tracker
			# passa alla checklist senza aprire anche la pagina generica
			_tour_launch_opened = true
			ScriptedOnboarding.action_requested.emit("open_section",
					{"section": "vps" if _tour_runtime_choice == "vps" else "docker"})
		TourGuide.notify_talked(stop))

## Le scelte narrative diventano effetti reali: preferenze salvate e
## destinazione del runtime (questo computer / dedicato / VPS).
func _on_tour_dialogue_action(action: String) -> void:
	if action.begins_with("pref:"):
		var kv := action.substr(5).split("=", false, 2)
		if kv.size() == 2:
			ScriptedOnboarding.set_preference(kv[0], kv[1])
	elif action.begins_with("runtime:"):
		_tour_runtime_choice = action.substr(8)
		ScriptedOnboarding.set_preference("runtime_location", _tour_runtime_choice)
	elif action == "tour:free":
		TourGuide.set_free_mode()
	elif action == "open_setup":
		ScriptedOnboarding.action_requested.emit("open_section",
				{"section": "activation"})

func _tour_release_guide() -> void:
	_camera.stop_follow()
	_tour_walk_serial += 1
	if _tour_staged_host and is_instance_valid(_tour_staged_host) \
			and not _tour_staged_host.is_dissolving():
		_tour_staged_host.tour_release()
	_tour_staged_host = null
	var guide := _tour_guide_npc()
	if guide:
		guide.tour_release()

# ── Roster dinamico dal backend (missione backend-integration) ────────
# In modalità backend la scena mostra SOLO gli agenti attivi sulla VPS:
# sync_agents() confronta lo stato con la scena: entra dalla porta chi nasce,
# esce dalla porta chi non appartiene più allo snapshot.

var _desk_pool: Dictionary = {}  # role -> Array di def libere (postazioni)
var _backend_mode := false
## false durante il primo snapshot backend (roster già vivo → subito in
## postazione); true dai sync successivi (i nuovi nati entrano dalla porta).
var _backend_join_parade := false
var _unplaced_roles: Dictionary = {}  # ruoli senza postazione già segnalati
var _core_overflow_serial: Dictionary = {} # istanze core extra (es. sentinella-worker)
var _agent_ui_test_started := false
var _coordinator_test_started := false

const AGENT_CPU_STALE_AFTER := 75.0  # sampler 30s: poco più di due tick

## Applica lo snapshot del backend (contratto BackendBus.agents_updated):
## list = [{slug: uid univoco, role, name, active, status}].
func sync_agents(list: Array) -> void:
	if list.is_empty():
		if _backend_mode:
			for agent in agents.duplicate():
				_despawn_agent(agent, false)
			_backend_mode = false
			_spawn_showroom()
		return
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
			_despawn_agent(agent, true)
		else:
			# throttle PRIMA dello status: la scelta seduto-vs-ricreazione
			# al cambio di stato legge la durata già aggiornata
			agent.set_throttle(float(wanted[agent.uid].get("throttle_secs", 0.0)))
			agent.set_activity_detail(str(wanted[agent.uid].get("activity_detail", "")))
			agent.set_backend_status(wanted[agent.uid].get("status", "working"))
			wanted.erase(agent.uid)
	for item_uid in wanted:
		_spawn_backend_agent(wanted[item_uid])
	# Quanti ne lavorano davvero contro quanti se ne vedono: l'utente contava
	# due agenti in ufficio mentre il Capitano ne comandava otto, e il gioco
	# non diceva nulla su chi fosse rimasto fuori (26/07).
	_log_roster_gap(list)
	# dal prossimo sync ogni nuovo processo entra fisicamente dalla porta
	_backend_join_parade = true
	if _tour_enabled and TourGuide.active():
		_refresh_tour_markers()
	if not BackendBus.telemetry.is_empty():
		_on_agent_cpu_telemetry(BackendBus.telemetry, BackendBus.telemetry_history)
	# Il roster backend arriva dopo _ready: il test-card va riprovato qui,
	# quando l'istanza richiesta esiste davvero.
	var card_test := OS.get_environment("JHT_CARD")
	if card_test != "" and _agent_card == null:
		for a in agents:
			if a.slug == card_test or a.uid == card_test:
				_open_agent_card(a)
				break
	# Preview/test della vista tmux: si apre solo dopo il roster vero/mock,
	# perché lo showroom non possiede sessioni da osservare.
	var thinking_test := OS.get_environment("JHT_THINKING")
	if thinking_test != "" and _thinking_panel == null:
		for a in agents:
			if a.slug == thinking_test or a.uid == thinking_test:
				_open_agent_thinking(a)
				break
	if OS.get_environment("JHT_AGENT_UI_TEST") == "1" \
			and _thinking_panel != null and not _agent_ui_test_started:
		_agent_ui_test_started = true
		_agent_ui_selftest.call_deferred()
	var coordinator_preview := OS.get_environment("JHT_COORDINATOR_TEST") == "1" \
			or OS.get_environment("JHT_COORDINATOR_PREVIEW") == "1"
	if coordinator_preview and _coordinator_panel == null:
		for a in agents:
			if a.slug == "coordinatore":
				_open_coordinator_panel(a)
				break
	if OS.get_environment("JHT_COORDINATOR_TEST") == "1" \
			and _coordinator_panel != null and not _coordinator_test_started:
		_coordinator_test_started = true
		_coordinator_selftest.call_deferred()
	if OS.get_environment("JHT_TRAFFIC_DEMO") == "1" \
			and not _traffic_demo_started and agents.size() >= 30:
		_traffic_demo_started = true
		_start_traffic_demo.call_deferred()

## Liveness operativa: il roster dice che il processo esiste, il sampler CPU
## dice se sta davvero elaborando. Dati mancanti o più vecchi di 75 secondi
## spengono il LED: non si conserva mai un falso verde all'infinito.
func _on_agent_cpu_telemetry(sample: Dictionary, _history: Array) -> void:
	var cpu_map: Dictionary = sample.get("agent_cpu", {})
	var age := float(sample.get("agent_vitals_age_s", -1.0))
	var fresh := age >= 0.0 and age <= AGENT_CPU_STALE_AFTER
	for agent in agents:
		var candidates: Array[String] = []
		if not agent.uid.is_empty():
			candidates.append(agent.uid.to_lower())
		candidates.append(agent.slug.to_lower())
		if agent.slug == "coordinatore":
			candidates.append("capitano")
		var found := false
		var cpu := 0.0
		for key in candidates:
			if cpu_map.has(key):
				cpu = float(cpu_map[key])
				found = true
				break
		agent.set_cpu_activity(cpu, fresh and found)

func _agent_ui_selftest() -> void:
	await get_tree().create_timer(2.2).timeout
	var colors := {}
	var auras_ok := not agents.is_empty()
	var ground_layer_ok := not agents.is_empty()
	for agent in agents:
		auras_ok = auras_ok and agent.aura != null and agent.aura.visible
		ground_layer_ok = ground_layer_ok and agent.aura != null \
				and not agent.aura.z_as_relative and agent.aura.z_index == -1 \
				and agent.rig.z_index == 0
		if agent.dept != "" and agent.aura:
			colors[agent.dept] = agent.aura.accent.to_html(false)
	var readonly_ok := _thinking_panel != null \
			and _thinking_panel.find_children("*", "LineEdit", true, false).is_empty()
	var stream_ok := _thinking_panel != null \
			and str(_thinking_panel._output.text).contains("sessione agente attiva")
	var scroll_lock_ok := false
	if _thinking_panel != null:
		var scroll_bar := _thinking_panel._output.get_v_scroll_bar()
		_thinking_panel._scroll_guard = false
		scroll_bar.value = 0.0
		await get_tree().process_frame
		var before_scroll := scroll_bar.value
		var extra := str(_thinking_panel._output.text) + "\nnuovo tick live"
		_thinking_panel._on_terminal_updated(
				_thinking_panel._agent_key, extra, "")
		await get_tree().process_frame
		await get_tree().process_frame
		scroll_lock_ok = not _thinking_panel._follow_tail \
				and is_equal_approx(scroll_bar.value, before_scroll)
	var hover_ok := false
	if not agents.is_empty() and agents[0].aura:
		agents[0].set_highlight(true)
		hover_ok = agents[0].aura.hovered
		agents[0].set_highlight(false)
	var cpu_threshold_ok := false
	var cpu_blink_ok := false
	var cpu_mapping_ok := false
	var cpu_stale_ok := false
	if not agents.is_empty():
		var probe: AgentNPC = agents[0]
		probe.set_cpu_activity(AgentStateTag.CPU_ACTIVE_THRESHOLD, true)
		var at_threshold: Dictionary = probe.state_tag.debug_cpu_led()
		probe.set_cpu_activity(AgentStateTag.CPU_ACTIVE_THRESHOLD + 0.1, true)
		var above_threshold: Dictionary = probe.state_tag.debug_cpu_led()
		var lit_before := bool(above_threshold.get("lit", false))
		probe.state_tag._process(0.5)
		var lit_after := bool(probe.state_tag.debug_cpu_led().get("lit", true))
		cpu_threshold_ok = not bool(at_threshold.get("active", true)) \
				and bool(above_threshold.get("active", false))
		cpu_blink_ok = lit_before and not lit_after
		_on_agent_cpu_telemetry({"agent_cpu": {"capitano": 25.0},
				"agent_vitals_age_s": 0.0}, [])
		var captain := _find_agent("coordinatore")
		cpu_mapping_ok = captain != null \
				and bool(captain.state_tag.debug_cpu_led().get("active", false))
		_on_agent_cpu_telemetry({"agent_cpu": {"capitano": 50.0},
				"agent_vitals_age_s": AGENT_CPU_STALE_AFTER + 1.0}, [])
		cpu_stale_ok = captain != null \
				and not bool(captain.state_tag.debug_cpu_led().get("active", true))
	var ok := auras_ok and ground_layer_ok and colors.size() >= 5 \
			and readonly_ok and stream_ok \
			and scroll_lock_ok and hover_ok and cpu_threshold_ok \
			and cpu_blink_ok and cpu_mapping_ok and cpu_stale_ok
	print("AGENT-UI-TEST ", "PASS" if ok else "FAIL", " ", JSON.stringify({
		"departments": colors, "auras": auras_ok, "readonly": readonly_ok,
		"ground_layer": ground_layer_ok, "stream": stream_ok,
		"scroll_lock": scroll_lock_ok, "hover": hover_ok,
		"cpu_threshold": cpu_threshold_ok, "cpu_blink": cpu_blink_ok,
		"cpu_mapping": cpu_mapping_ok, "cpu_stale": cpu_stale_ok,
	}))
	get_tree().quit(0 if ok else 1)

func _coordinator_selftest() -> void:
	await get_tree().create_timer(0.3).timeout
	var panel_ok := _coordinator_panel != null \
			and _coordinator_panel.is_in_group("camera_blocking_overlay")
	var navigation_ok := false
	var chat_ok := false
	var thinking_ok := false
	if panel_ok:
		_coordinator_panel._show_view(1)
		await get_tree().process_frame
		navigation_ok = _coordinator_panel._tabs.current_tab == 1 \
				and _coordinator_panel._monitor_built \
				and _ui_find_class_node(_coordinator_panel,
						"AgentHistoryChart") != null
		_coordinator_panel._open_chat()
		await get_tree().process_frame
		chat_ok = _coordinator_panel._chat_panel != null \
				and _coordinator_panel._chat_panel.layer == 70
		if chat_ok:
			_coordinator_panel._chat_panel.close(false)
		await get_tree().process_frame
		_coordinator_panel._open_thinking()
		await get_tree().process_frame
		thinking_ok = _coordinator_panel._thinking_panel != null \
				and _coordinator_panel._thinking_panel.layer == 70
		if thinking_ok:
			_coordinator_panel._thinking_panel.close(false)
		_coordinator_panel._show_view(0)
		navigation_ok = navigation_ok \
				and _coordinator_panel._tabs.current_tab == 0
	var controls_ok := panel_ok and _coordinator_panel._geo_non_remote != null \
			and _coordinator_panel._recheck_days != null \
			and _coordinator_panel._directives.get_child_count() >= 1 \
			and _coordinator_panel._queue_grid.get_child_count() == 7 \
			and _coordinator_panel._stop_search.disabled \
			and _coordinator_panel._geo_score.editable
	if panel_ok:
		_coordinator_panel._maintenance.button_pressed = true
		_coordinator_panel._geo_score.value = 72
		controls_ok = controls_ok and not _coordinator_panel._stop_search.disabled
		_coordinator_panel._save_settings()
	await get_tree().process_frame
	var save_ok := bool(BackendBus.coordinator_state.get("maintenance", {}) \
			.get("enabled", false)) \
			and int(BackendBus.coordinator_state.get("enrichment", {}) \
			.get("geocode_min_score", 0)) == 72
	var before: int = BackendBus.coordinator_state.get("directives", []).size()
	BackendBus.add_team_directive("Test direttiva console", "order")
	await get_tree().process_frame
	var directive_ok: bool = BackendBus.coordinator_state.get("directives", []).size() \
			== before + 1
	var ok: bool = panel_ok and navigation_ok and chat_ok and thinking_ok \
			and controls_ok and save_ok and directive_ok
	print("COORDINATOR-CONSOLE-TEST ", "PASS" if ok else "FAIL", " ",
			JSON.stringify({"panel": panel_ok, "controls": controls_ok,
				"navigation": navigation_ok, "chat": chat_ok,
				"thinking": thinking_ok, "save": save_ok,
				"directive": directive_ok}))
	get_tree().quit(0 if ok else 1)

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
				to_label = "MESSAGGIO PER TE"
			_:
				to_label = _name_of(to_uid)
		speaker.say(text, to_label)
		if target and not target.is_dissolving():
			target.show_received_message(speaker.display_name)

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
const ENTRY_SPOT := Vector2(1300, 1948)

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
	"scrittori": "written",
}

var _last_ready := -1
var _piles_synced := false

func _sync_piles(hold_seconds := 0.0) -> void:
	var counts: Dictionary = BackendBus.pipeline_counts()
	# Hook esclusivamente visivo per gli screenshot di regressione: permette di
	# verificare l'ingombro/prospettiva di una coda grande senza dipendere dai
	# dati della VPS. Formato: JHT_PILE_PREVIEW=scorer:517.
	var preview := OS.get_environment("JHT_PILE_PREVIEW").split(":", false, 1)
	if preview.size() == 2 and PILE_PHASE.has(preview[0]) \
			and str(preview[1]).is_valid_int():
		counts[PILE_PHASE[preview[0]]] = maxi(0, int(preview[1]))
	for dept_id in PILE_PHASE:
		if PaperPile.inbox.has(dept_id):
			# Rapporto esatto 1:1. Il primo snapshot è immediato; i successivi
			# aspettano il viaggio fisico dell'agente prima di riconciliarsi.
			PaperPile.inbox[dept_id].set_target(
					int(counts[PILE_PHASE[dept_id]]), not _piles_synced, hold_seconds)
	_piles_synced = true
	var ready := int(counts["cv_ready"])
	OutputShelf.set_ready(ready)
	# Un PASS in più: è il Critico, ultimo anello, a portare il CV nello
	# scaffale dei pronti. Lo Scrittore lo aveva lasciato sulla propria pila.
	if _last_ready >= 0 and ready > _last_ready:
		for agent in agents:
			if agent.dept == "critici" and not agent.is_dissolving():
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
	var fresh: Array = []
	for t in BackendBus.transitions:
		var key := "%s|%s|%s|%s" % [str(t.get("position_id", "")),
				str(t.get("ts", "")), str(t.get("to_state", "")),
				str(t.get("by_agent", ""))]
		if _tr_seen.has(key):
			continue
		_tr_seen[key] = true
		fresh.append(t)
	# Il primo snapshot allinea subito le pile. In seguito il nuovo target
	# resta sospeso mentre gli agenti compiono davvero ritiro e consegna;
	# dopo un minuto riconcilia eventuali raffiche o eventi senza attore.
	if not BackendBus.positions.is_empty():
		_sync_piles(65.0 if _tr_baseline and not fresh.is_empty() else 0.0)
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
	actor.perform_pipeline_step(true, to_st)
	Log.debug("scene", "reazione %s: %s → %s" % [by, what, to_st])

## Primo snapshot backend: le postazioni tornano nel pool e il roster
## locale di ambientazione lascia la scena — comanda lo stato reale.
func _enter_backend_mode() -> void:
	_backend_mode = true
	_backend_join_parade = false
	_desk_pool = {}
	for def in CharacterDefs.spawn_list():
		var role: String = def["slug"]
		if not _desk_pool.has(role):
			_desk_pool[role] = []
		_desk_pool[role].append(def)
	# Lo showroom lascia il posto SUBITO, senza corteo verso la porta: il
	# passaggio ai dati reali deve sembrare un cambio di realtà, non un
	# cambio turno (feedback Leone 21/07: niente frenesia alla porta).
	for agent in agents.duplicate():
		if agent.uid == "":
			_despawn_agent(agent, false, true)
	Log.info("backend", "modalità backend: in scena solo gli agenti attivi")

## Ingresso a ondate: cinque corsie affiancate e una nuova fila ogni 0,9 s.
## Tutti gli agenti restano disponibili subito per la sync, ma non formano
## più la colonna di corpi sovrapposti che sembrava uno sprite sdoppiato.
func _stage_agent_entry(agent: AgentNPC) -> void:
	var index := agents.size()
	var wave := index / 5
	var lane := posmod(index, 5) - 2
	agent.enter_through(ENTRY_SPOT, float(wave) * 0.9, float(lane))

func _spawn_showroom() -> void:
	if world == null:
		return
	for def in CharacterDefs.showroom_list():
		var exists := false
		for current in agents:
			if current.uid == "" and current.display_name == str(def["name"]):
				exists = true
				break
		if exists:
			continue
		var agent := AgentNPC.new()
		world.add_child(agent)
		agent.setup(def, nav)
		# Anche il ritorno allo showroom ritrova l'ufficio popolato: niente
		# fila alla porta quando la connessione VPS cade.
		agent.set_story_marker(ScriptedOnboarding.story_mode(),
				bool(_story_seen.get(str(def["slug"]), false)))
		agents.append(agent)
	if _tour_enabled and TourGuide.active():
		_refresh_tour_markers()

func _on_setup_status_changed(status: Dictionary) -> void:
	var authenticated := bool(status.get("provider_authenticated", false))
	for agent in agents:
		if agent.uid == "":
			agent.set_story_marker(not authenticated,
					bool(_story_seen.get(agent.slug, false)))
	if _tour_enabled and TourGuide.active() and not authenticated:
		_refresh_tour_markers()
	if authenticated:
		for child in get_children():
			if child is DialogueUI:
				(child as DialogueUI)._close()
		BackendBus.clear_demo_positions()
	elif BackendBus.positions.is_empty() or BackendBus.positions_are_demo:
		BackendBus.show_demo_positions()

func _despawn_agent(agent: AgentNPC, refill_pool := true, instant := false) -> void:
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
	# Un agente viene rimosso soltanto oltre la porta: nessun despawn tecnico
	# può più dissolverlo nel mezzo dell'ufficio. Unica eccezione: lo swap
	# istantaneo showroom→backend, che è un cambio di realtà, non un'uscita.
	if instant:
		agent.vanish()
	else:
		agent.exit_through(EXIT_SPOT)

## Confronto fra il roster del backend e i corpi in scena. Se qualcuno manca,
## il log dice CHI: senza questo l'unico modo di accorgersene era contare gli
## agenti a schermo e fidarsi della memoria.
func _log_roster_gap(list: Array) -> void:
	var expected := PackedStringArray()
	for item in list:
		if item.get("active", true) and str(item.get("status", "")) != "killed":
			expected.append(str(item.get("uid", item.get("slug", ""))))
	var on_stage := PackedStringArray()
	for agent in agents:
		if agent.uid != "":
			on_stage.append(agent.uid)
	if expected.size() == on_stage.size():
		Log.info("backend", "roster: %d agenti attivi, tutti in scena" % expected.size())
		return
	var missing := PackedStringArray()
	for uid in expected:
		if not on_stage.has(uid):
			missing.append(uid)
	Log.warn("backend", "roster: %d attivi ma %d in scena — mancano: %s"
			% [expected.size(), on_stage.size(), ", ".join(missing)])


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
	# Il primo snapshot fotografa processi GIÀ vivi sulla VPS: si ritrovano
	# alla postazione. La camminata dalla porta resta per chi nasce DOPO,
	# perché lì l'ingresso è un fatto reale (feedback Leone 21/07).
	if _backend_join_parade:
		_stage_agent_entry(agent)
	agents.append(agent)

# ── Costruzione scena ─────────────────────────────────────────────────

## Cuoce i livelli statici di sfondo in un'unica texture. I nodi originali
## finiscono in un SubViewport che renderizza UNA volta sola: da lì in poi
## lo sfondo dell'ufficio è uno Sprite2D, e le centinaia di primitive che lo
## componevano non toccano più la GPU. L'aspetto è identico al pixel.
func _bake_backdrop(layers: Array) -> void:
	var rect: Rect2 = FurnitureDefs.WORLD
	var oven := SubViewport.new()
	oven.name = "BackdropOven"
	oven.size = Vector2i(rect.size)
	# Fondo OPACO (il clear color è già il VOID della scena): su fondo
	# trasparente le tinte e le ombre semi-trasparenti si comporrebbero
	# contro il nulla e uscirebbero schiarite — l'ufficio cotto sembrava
	# sbiadito e il void attorno diventava grigio.
	oven.transparent_bg = false
	oven.disable_3d = true
	oven.render_target_update_mode = SubViewport.UPDATE_ONCE
	add_child(oven)
	# Il mondo ha origine negativa (WORLD parte da y=-420): la teglia va
	# traslata, altrimenti si cuoce metà pavimento fuori dai bordi.
	var holder := Node2D.new()
	holder.position = -rect.position
	oven.add_child(holder)
	for layer in layers:
		var node: Node2D = layer
		node.get_parent().remove_child(node)
		node.z_index = 0
		holder.add_child(node)
	_finish_bake.call_deferred(oven, rect)


## Il render target va copiato in una texture NORMALE, non usato com'è: la
## ViewportTexture resta nello spazio colore del target e, ridisegnata, alza
## i toni scuri — il void nero diventava grigio e le tinte uscivano slavate.
## Il passaggio per l'immagine costa una frazione di secondo, una volta sola,
## e restituisce esattamente i colori della scena viva.
func _finish_bake(oven: SubViewport, rect: Rect2) -> void:
	if not is_instance_valid(oven):
		return
	await RenderingServer.frame_post_draw
	var image := oven.get_texture().get_image()
	if image == null or image.is_empty():
		Log.warn("perf", "bake sfondo non riuscito: resto sui livelli disegnati")
		return
	var backdrop := Sprite2D.new()
	backdrop.name = "BackdropBaked"
	backdrop.texture = ImageTexture.create_from_image(image)
	backdrop.centered = false
	backdrop.position = rect.position
	backdrop.z_index = -3
	_stage.add_child(backdrop)
	_stage.move_child(backdrop, 0)
	oven.queue_free()  # con dentro i livelli sorgente: non servono più
	Log.info("perf", "sfondo ufficio cotto in una texture %dx%d"
			% [image.get_width(), image.get_height()])


## Monta (o smonta) il palcoscenico a risoluzione ridotta. Funziona anche a
## ufficio già avviato: la calibrazione decide dopo 15 secondi, e a quel
## punto i nodi del mondo vengono semplicemente traslocati nel SubViewport.
## `value` è la scala di rendering del mondo: 1.0 = nativo, 0.75 = tre quarti
## di lato, 0.5 = metà. Deliberatamente CONTINUA e non un divisore intero:
## fra "nativo" e "metà" c'è tutto lo spazio dove la grana si vede appena
## (richiesta Leone 25/07) e dove sta comunque metà del risparmio.
func set_render_scale(value: float) -> void:
	var target := clampf(value, 0.25, 1.0)
	if is_equal_approx(target, _render_scale):
		return
	_render_scale = target
	# Il testo del mondo si rimisura insieme alla scala, nello stesso istante:
	# la calibrazione può cambiarla anche a ufficio pieno di agenti.
	WorldText.set_world_scale(target)
	if target >= 0.999:
		if _pixel_stage != null:
			_move_world_nodes(_pixel_stage.get_child(0), self)
			_pixel_layer.queue_free()
			_pixel_layer = null
			_pixel_stage = null
			_stage = self
		return
	if _pixel_stage != null:
		_apply_stage_size()
		return
	# Il container è un Control: figlio diretto di un Node2D resterebbe di
	# dimensione zero (gli anchor hanno senso solo dentro uno spazio schermo)
	# e il mondo uscirebbe nero. Serve un CanvasLayer, sotto tutta la UI.
	_pixel_layer = CanvasLayer.new()
	_pixel_layer.name = "PixelLayer"
	_pixel_layer.layer = -100
	add_child(_pixel_layer)
	# Il container resta a shrink 1 e viene RIMPICCIOLITO come Control, poi
	# riportato a schermo pieno con `scale`: così il fattore è continuo e
	# l'inoltro degli eventi resta quello del SubViewportContainer, che
	# rimappa da sé le coordinate del mouse.
	_pixel_stage = SubViewportContainer.new()
	_pixel_stage.name = "PixelStage"
	_pixel_stage.stretch = true
	_pixel_stage.texture_filter = CanvasItem.TEXTURE_FILTER_NEAREST
	_pixel_layer.add_child(_pixel_stage)
	var vp := SubViewport.new()
	vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	vp.handle_input_locally = false
	vp.transparent_bg = false
	_pixel_stage.add_child(vp)
	_apply_stage_size()
	if not get_viewport().size_changed.is_connected(_apply_stage_size):
		get_viewport().size_changed.connect(_apply_stage_size)
	_stage = vp
	_move_world_nodes(self, vp)


## Dimensiona il palcoscenico sulla finestra corrente. Il container copre
## `scala × finestra` e viene poi ingrandito di 1/scala: il mondo si disegna
## su quei pixel e basta.
func _apply_stage_size() -> void:
	if _pixel_stage == null:
		return
	var window: Vector2 = get_viewport_rect().size
	var inner := (window * _render_scale).floor().max(Vector2(320, 180))
	_pixel_stage.position = Vector2.ZERO
	_pixel_stage.size = inner
	_pixel_stage.scale = window / inner


## Trasloca i nodi di mondo (Node2D e camere) preservando l'ordine. HUD,
## pannelli e sidebar sono CanvasLayer: non si toccano, devono restare
## a risoluzione piena.
func _move_world_nodes(from: Node, to: Node) -> void:
	if from == null or to == null or from == to:
		return
	var current: Camera2D = null
	for node in from.get_children():
		if not (node is Node2D):
			continue
		if node is Camera2D and (node as Camera2D).is_current():
			current = node
		from.remove_child(node)
		to.add_child(node)
	if current != null:
		current.make_current()


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
