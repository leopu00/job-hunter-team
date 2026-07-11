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

func _ready() -> void:
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

	for item in FurnitureDefs.ITEMS:
		if item["kind"] == "hologram":
			world.add_child(Hologram.new(item["rect"]))
			world.add_child(_invisible_wall(item["rect"]))
		else:
			world.add_child(FurnitureNode.new(item))

	# postazioni dei 5 reparti: stesso FurnitureNode dei mobili, kind variati;
	# facing passa al visual (texture orientate _down/_side/_up, dev-art).
	# kind "none" = seduta di un mobile condiviso (es. il tavolo lungo degli
	# Analisti): conta per spot/ostacoli ma il visual è l'item in FurnitureDefs.
	for d in DepartmentDefs.all_desks():
		# micro-prop sul piano (anche sulle sedute del tavolo lungo)
		world.add_child(DeskClutter.new(d["rect"], "%s:%d" % [d["dept"], d["index"]]))
		if d["kind"] == "none":
			continue
		world.add_child(FurnitureNode.new({
			"id": "desk_%s_%d" % [d["dept"], d["index"]],
			"kind": d["kind"],
			"rect": d["rect"],
			"facing": d.get("facing", "down"),
		}))

	for r in [FurnitureDefs.LAB_WALL_V, FurnitureDefs.LAB_WALL_H1, FurnitureDefs.LAB_WALL_H2]:
		world.add_child(_invisible_wall(r))
	# vetrate dei reparti: collisioni sottili, il visual è in OfficeFloor
	for r in DepartmentDefs.GLASS_WALLS:
		world.add_child(_invisible_wall(r))
	_add_perimeter_walls()

	nav.build(FurnitureDefs.FLOOR, FurnitureDefs.obstacles()
			+ DepartmentDefs.obstacles() + DepartmentDefs.GLASS_WALLS)

	# la stampante si anima quando qualcuno stampa (ping da AgentNPC)
	world.add_child(PrinterFx.new(FurnitureDefs.get_rect("printer")))
	if OS.get_environment("JHT_FX") == "printer":  # TEST-AUTO: stampa forzata
		PrinterFx.ping(20.0)

	# pile degli inbox di reparto: il ritiro le svuota, le soste le
	# riforniscono, e un restock lento simula l'upstream che stampa.
	PaperPile.inbox = {}
	for dept_id in DepartmentDefs.DEPT_ORDER:
		var inbox_pos: Vector2 = DepartmentDefs.DEPARTMENTS[dept_id]["inbox"]
		var p := PaperPile.new(Rect2(inbox_pos - Vector2(28, 16), Vector2(56, 32)))
		# gli Scout producono e basta: il loro inbox si riempie più svelto
		p.restock = 90.0 if DepartmentDefs.FETCH_FROM.has(dept_id) else 45.0
		p.add_sheets(randi_range(1, 6))
		world.add_child(p)
		PaperPile.inbox[dept_id] = p

	for def in CharacterDefs.spawn_list():
		var agent := AgentNPC.new()
		world.add_child(agent)
		agent.setup(def, nav)
		agents.append(agent)

	add_child(TesseractEdges.new())  # gli spigoli blu della box (trasparenti)
	add_child(Sfx.make_ambient_hum())

	_camera = FreeCamera.new()
	add_child(_camera)
	_camera.clicked.connect(_on_world_click)

	if OS.get_environment("JHT_OVERVIEW") == "1":  # TEST-AUTO: tutta la box in un frame
		var ov := Camera2D.new()
		ov.position = FurnitureDefs.WORLD.get_center()
		var vp := get_viewport_rect().size
		var z := minf(vp.x / FurnitureDefs.WORLD.size.x, vp.y / FurnitureDefs.WORLD.size.y)
		ov.zoom = Vector2(z, z)
		add_child(ov)
		ov.make_current()

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

	# TEST-AUTO: JHT_BACKEND_TEST=1 simula il flusso del BackendBus senza
	# VPS: sync a roster ridotto (despawn di massa), fumetti di chat in
	# raffica, poi un rientro (materializzazione). Da fotografare con
	# JHT_SHOT_DELAY a tempi diversi.
	if OS.get_environment("JHT_BACKEND_TEST") == "1":
		_run_backend_selftest()

	# TEST-AUTO: JHT_SHOT=path.png → screenshot dopo un secondo e chiude.
	# Con JHT_OVERVIEW=1 permette a noi agenti di verificare il layout da soli.
	var shot := OS.get_environment("JHT_SHOT")
	if shot != "":
		_take_shot(shot)

func _run_backend_selftest() -> void:
	var roster := [
		{"slug": "coordinatore-1", "role": "coordinatore", "name": "Coordinatore", "active": true, "status": "working"},
		{"slug": "scout-1", "role": "scout", "name": "Scout Lead", "active": true, "status": "working"},
		{"slug": "scout-2", "role": "scout", "name": "Scout 02", "active": true, "status": "idle"},
		{"slug": "analista-1", "role": "analista", "name": "Analista Lead", "active": true, "status": "working"},
	]
	await get_tree().create_timer(1.0).timeout
	sync_agents(roster)
	await get_tree().create_timer(1.2).timeout
	deliver_chat("scout-1", "all", "Trovate 6 posizioni nuove su 3 board: 2 senior backend a Berlino, il resto remoto EU.")
	deliver_chat("coordinatore-1", "scout-2", "Riprendi il giro delle board: la coda analisti è vuota.")
	deliver_chat("analista-1", "user", "Il report della mattinata è pronto: 4 aziende profilate.")
	await get_tree().create_timer(3.0).timeout
	roster.append({"slug": "scorer-1", "role": "scorer", "name": "Scorer Lead", "active": true, "status": "working"})
	sync_agents(roster)

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

var _registry: RegistryPanel

func _unhandled_input(event: InputEvent) -> void:
	if Game.dialogue_active:
		return
	if event.is_action_pressed("registry"):
		if _registry:
			_registry.queue_free()
			_registry = null
			Sfx.play_back()
		else:
			_registry = RegistryPanel.new()
			add_child(_registry)

var _dept_panel: DepartmentPanel
var _agent_card: AgentCard

## Click "pulito" dalla FreeCamera: agente > bacheca > reparto.
func _on_world_click(target: Vector2) -> void:
	if Game.dialogue_active:
		return
	if _registry or _dept_panel or _agent_card:
		return  # con un pannello aperto, il mondo non riceve click
	for agent in agents:
		if agent.hit_by(target):
			_open_agent_card(agent)
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

func _open_dept(dept: String) -> void:
	Log.info("dept", "pannello reparto aperto: " + dept)
	_dept_panel = DepartmentPanel.new(dept)
	add_child(_dept_panel)
	_dept_panel.closed.connect(func() -> void: _dept_panel = null)

# ── Hover col mouse (evidenzia l'agente cliccabile) ───────────────────

func _update_hover() -> void:
	var best: AgentNPC = null
	if not Game.dialogue_active:
		var mouse := get_global_mouse_position()
		for agent in agents:
			if agent.hit_by(mouse):
				best = agent
				break
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
	agent.start_talk()  # si ferma e guarda in camera mentre lo esamini
	_agent_card = AgentCard.new(agent)
	add_child(_agent_card)
	_agent_card.talk_requested.connect(func() -> void: _start_talk(agent))
	_agent_card.closed.connect(func() -> void:
		_agent_card = null
		if not Game.dialogue_active:
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
		agent.end_talk())

# ── Roster dinamico dal backend (missione backend-integration) ────────
# In modalità backend la scena mostra SOLO gli agenti attivi sulla VPS:
# sync_agents() confronta lo stato con la scena e materializza/dissolve.

var _desk_pool: Dictionary = {}  # role -> Array di def libere (postazioni)
var _backend_mode := false

## Applica lo snapshot del backend (contratto BackendBus.agents_updated):
## list = [{slug: uid univoco, role, name, active, status}].
func sync_agents(list: Array) -> void:
	if not _backend_mode:
		_enter_backend_mode()
	var wanted := {}
	for item in list:
		if item.get("active", true):
			wanted[item["slug"]] = item
	for agent in agents.duplicate():
		if not wanted.has(agent.uid):
			_despawn_agent(agent)
		else:
			agent.set_backend_status(wanted[agent.uid].get("status", "working"))
			wanted.erase(agent.uid)
	for item_uid in wanted:
		_spawn_backend_agent(wanted[item_uid])

## Recapita un messaggio della chat di team come fumetto (contratto
## BackendBus.chat_message): from/to sono uid agente, "user" o "all".
func deliver_chat(from_uid: String, to_uid: String, text: String) -> void:
	for agent in agents:
		if agent.uid == from_uid and not agent.is_dissolving():
			var to_label := ""
			match to_uid:
				"all":
					to_label = ""
				"user":
					to_label = "te"
				_:
					to_label = _name_of(to_uid)
			agent.say(text, to_label)
			return

func _name_of(uid: String) -> String:
	for agent in agents:
		if agent.uid == uid:
			return agent.display_name
	return uid

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
			_despawn_agent(agent, false)
	Log.info("backend", "modalità backend: in scena solo gli agenti attivi")

func _despawn_agent(agent: AgentNPC, refill_pool := true) -> void:
	agents.erase(agent)
	if _hover_agent == agent:
		_hover_agent = null
	if refill_pool and agent.has_meta("def"):
		var def: Dictionary = agent.get_meta("def")
		var role: String = def["slug"]
		# il lead rientra in testa: alla riattivazione riprende il suo posto
		if def.get("lead", false):
			_desk_pool[role].push_front(def)
		else:
			_desk_pool[role].append(def)
	agent.dissolve()

func _spawn_backend_agent(item: Dictionary) -> void:
	var role: String = item.get("role", "")
	var pool: Array = _desk_pool.get(role, [])
	if pool.is_empty():
		Log.warn("backend", "nessuna postazione libera per il ruolo " + role)
		return
	var def: Dictionary = pool.pop_front()
	var live := def.duplicate(true)
	if item.get("name", "") != "":
		live["name"] = item["name"]
	var agent := AgentNPC.new()
	world.add_child(agent)
	agent.setup(live, nav)
	agent.uid = item["slug"]
	agent.set_meta("def", def)
	agent.set_backend_status(item.get("status", "working"))
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
	var hint := TerminalTheme.label(
			"trascina o WASD per la camera · rotella zoom · click su agenti e reparti · TAB registro · ESC menu",
			15, Palette.DIM)
	hint.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	hint.position = Vector2(-hint.size.x / 2.0, -30)
	hint.grow_horizontal = Control.GROW_DIRECTION_BOTH
	hint.grow_vertical = Control.GROW_DIRECTION_BEGIN
	hud.add_child(hint)

