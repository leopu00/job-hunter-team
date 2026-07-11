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
	# facing passa al visual (texture orientate _down/_side/_up, dev-art)
	for d in DepartmentDefs.all_desks():
		world.add_child(FurnitureNode.new({
			"id": "desk_%s_%d" % [d["dept"], d["index"]],
			"kind": d["kind"],
			"rect": d["rect"],
			"facing": d.get("facing", "down"),
		}))

	for r in [FurnitureDefs.LAB_WALL_V, FurnitureDefs.LAB_WALL_H1, FurnitureDefs.LAB_WALL_H2]:
		world.add_child(_invisible_wall(r))
	_add_perimeter_walls()

	nav.build(FurnitureDefs.FLOOR, FurnitureDefs.obstacles() + DepartmentDefs.obstacles())

	for def in CharacterDefs.spawn_list():
		var agent := AgentNPC.new()
		world.add_child(agent)
		agent.setup(def, nav)
		agents.append(agent)

	_add_maintainers()
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

	# TEST-AUTO: JHT_SHOT=path.png → screenshot dopo un secondo e chiude.
	# Con JHT_OVERVIEW=1 permette a noi agenti di verificare il layout da soli.
	var shot := OS.get_environment("JHT_SHOT")
	if shot != "":
		_take_shot(shot)

func _take_shot(path: String) -> void:
	await get_tree().create_timer(1.2).timeout
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

# ── Costruzione scena ─────────────────────────────────────────────────

## I due maintainer fuori dalla box (the-box.png): osservano, in penombra.
func _add_maintainers() -> void:
	var specs := [
		{"pos": Vector2(148, 1085), "facing": "down", "clip": true},
		{"pos": Vector2(200, 1240), "facing": "side", "clip": false},
	]
	for spec in specs:
		var holder := Node2D.new()
		holder.position = spec["pos"]
		holder.modulate = Color(0.72, 0.75, 0.9)
		add_child(holder)  # fuori dal World: niente Y-sort né collisioni
		var rig := CharacterDefs.make_rig("maintainer")
		rig.scale *= 1.08
		holder.add_child(rig)
		rig.set_motion(spec["facing"], false, "idle")
		if spec["clip"]:
			var clip := Sprite2D.new()
			clip.texture = load(CharacterDefs.GEN + "maintainer/clipboard.svg")
			clip.centered = false
			clip.offset = Vector2(-64, -188)
			rig.add_child(clip)

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

