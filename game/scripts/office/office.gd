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
var _selftests: OfficeSelftests

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

	# La scena vive sul BackendBus: roster reale → spawn/despawn,
	# chat del team → fumetti. Se un backend è già connesso (snapshot
	# presente), la scena si allinea subito.
	if _seat_audit == "" and _doctor_test == "":
		BackendBus.agents_updated.connect(sync_agents)
		BackendBus.chat_message.connect(_on_chat_message)
		BackendBus.positions_updated.connect(_on_transitions)
		BackendBus.telemetry_updated.connect(_on_agent_cpu_telemetry)
		BackendBus.backend_reset.connect(_on_backend_reset)
		if not BackendBus.agents.is_empty():
			sync_agents(BackendBus.agents)
		if not BackendBus.transitions.is_empty():
			_on_transitions([])  # snapshot già sul bus: assorbito come baseline
		if BackendBus.state != BackendBus.DISCONNECTED and not _piles_synced:
			# Backend già collegato quando la scena nasce (rientro in ufficio
			# dopo aver cambiato macchina): le pile partono dai SUOI conteggi —
			# zero se il box è appena stato creato — mai dal seme casuale di
			# scenografia, che sarebbe un numero inventato.
			_reseed_piles()
		if not BackendBus.telemetry.is_empty():
			_on_agent_cpu_telemetry(BackendBus.telemetry, BackendBus.telemetry_history)
		SetupService.status_changed.connect(_on_setup_status_changed)
		_on_setup_status_changed(SetupService.status)

	# ── Modalità test/preview ────────────────────────────────────────────
	# I selftest e i ganci JHT_* vivono in un nodo a parte, che nasce solo se
	# almeno una di quelle variabili è valorizzata: in una build normale il
	# codice resta a riposo e questa _ready resta leggibile.
	if OfficeSelftests.armed():
		_selftests = OfficeSelftests.new()
		_selftests.office = self
		add_child(_selftests)

func _on_chat_message(msg: Dictionary) -> void:
	deliver_chat(msg.get("from", ""), msg.get("to", "all"), msg.get("text", ""))

func _process(_delta: float) -> void:
	_update_hover()


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
			str(scene.get("name", CharacterDefs.role_name("assistente"))),
			str(scene.get("tree", "")))
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
	# I ganci di test che aspettavano il roster vero (scheda agente, vista
	# tmux, console del Coordinatore) vivono nel nodo dei selftest.
	if _selftests != null:
		_selftests.on_agents_synced()

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
			target.show_received_message(
					AgentNames.short_name(speaker.uid, speaker.display_name))

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

## Come si chiama il destinatario di un messaggio, dentro una vignetta sopra
## la testa: il SOLO cognome. La vignetta si allarga col testo più lungo che
## contiene, e "→ Holmes · scout-1" la farebbe crescere oltre la scrivania per
## dire due volte la stessa cosa. Il nome per esteso vive nei pannelli, dove
## c'è la riga intera.
##
## Chi non ha un cognome tiene il suo nome di scena; chi non è nemmeno in
## scena resta l'uid, come prima — un destinatario fuori campo va comunque
## detto.
func _name_of(uid: String) -> String:
	for agent in agents:
		if agent.uid == uid:
			return AgentNames.short_name(uid, agent.display_name)
	return AgentNames.short_name(uid)

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
	# Primo snapshot di QUESTA connessione: pile e scaffale si agganciano di
	# colpo. Senza l'aggancio immediato la deriva foglio-per-foglio partirebbe
	# dai numeri della macchina precedente e li terrebbe a schermo per un
	# minuto (694 → 14 = oltre ottanta secondi).
	var first_paint := not _piles_synced
	for dept_id in PILE_PHASE:
		if PaperPile.inbox.has(dept_id):
			# Rapporto esatto 1:1. Il primo snapshot è immediato; i successivi
			# aspettano il viaggio fisico dell'agente prima di riconciliarsi.
			PaperPile.inbox[dept_id].set_target(
					int(counts[PILE_PHASE[dept_id]]), first_paint, hold_seconds)
	_piles_synced = true
	var ready := int(counts["cv_ready"])
	OutputShelf.set_ready(ready, first_paint)
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

## Cambio di connessione (BackendBus.backend_reset): pile, scaffale e registro
## delle transizioni descrivevano UN'ALTRA macchina. Vengono azzerati DENTRO
## il frame del cambio — il bus è già svuotato quando arriva questo segnale —
## così non esiste un fotogramma coi conteggi del box precedente. Il caso
## misurato il 27/07: box nuovo con 14 posizioni, pila dello Scorer ferma sulle
## 694 righe `scored` di quello di prima perché uno snapshot vuoto non
## riseminava nulla e i target restavano quelli vecchi.
func _on_backend_reset() -> void:
	_tr_seen.clear()
	_tr_baseline = false
	_last_ready = -1
	_reseed_piles()
	# LED di attività: senza campione fresco nessun agente resta verde con la
	# CPU misurata sulla macchina di prima.
	_on_agent_cpu_telemetry({}, [])

## Riallinea pile e scaffale ai conteggi che il bus ha ADESSO, di colpo, e
## lascia il prossimo snapshot come "prima pittura": quello arriva da un'altra
## macchina e deve agganciarsi altrettanto di colpo, non risalire un foglio
## alla volta partendo da zero.
func _reseed_piles() -> void:
	_piles_synced = false
	_sync_piles()
	_piles_synced = false


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


## La postazione di un agente discende dal SUO numero: `scout-5` siede al
## quinto banco, sempre. Prima si pescava in ordine di arrivo (`pop_front`),
## e siccome il volto è legato alla sedia il primo Scout entrato aveva sempre
## la stessa faccia: con due soli worker attivi metà del cast disegnato non
## entrava mai in scena, e i ritratti nuovi non si vedevano affatto (Leone,
## 26/07). Il numero lo tira già il dado (`roll_worker_number.py`) fra quelli
## liberi, quindi due agenti non possono contendersi lo stesso banco.
##
## Se quel banco non è disponibile — roster più grande delle sedie, o numero
## non leggibile — si ripiega sull'ordine di arrivo: meglio una sedia
## qualsiasi che nessuna.
func _take_desk_for(pool: Array, uid: String) -> Dictionary:
	var wanted := _desk_index_from_uid(uid)
	if wanted >= 0:
		for i in pool.size():
			if int((pool[i] as Dictionary).get("desk", -1)) == wanted:
				return pool.pop_at(i)
	return pool.pop_front()


## `scout-5` → banco 4 (i banchi contano da zero, gli agenti da uno).
## -1 quando il nome non porta un numero: i ruoli core non ne hanno.
static func _desk_index_from_uid(uid: String) -> int:
	var parts := uid.strip_edges().to_lower().split("-")
	if parts.size() < 2 or not parts[parts.size() - 1].is_valid_int():
		return -1
	var n := int(parts[parts.size() - 1])
	return n - 1 if n >= 1 else -1


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
		def = _take_desk_for(pool, str(item.get("uid", "")))
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
	theme_root.add_child(BudgetNotice.new())  # perche il team tace, quando tace
	theme_root.add_child(HeadlessNotice.new())  # hanno lavorato senza di te
	theme_root.add_child(UpdateNotice.new())  # c'e una versione piu recente
	var hint := TerminalTheme.label(
			UIStrings.t("office.camera_hint"),
			15, Palette.DIM)
	hint.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	hint.position = Vector2(-hint.size.x / 2.0, -30)
	hint.grow_horizontal = Control.GROW_DIRECTION_BOTH
	hint.grow_vertical = Control.GROW_DIRECTION_BEGIN
	hud.add_child(hint)
