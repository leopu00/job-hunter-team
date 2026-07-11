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

	# postazioni dei 5 reparti: stesso FurnitureNode dei mobili, kind variati
	for d in DepartmentDefs.all_desks():
		world.add_child(FurnitureNode.new({
			"id": "desk_%s_%d" % [d["dept"], d["index"]],
			"kind": d["kind"],
			"rect": d["rect"],
		}))

	for r in [FurnitureDefs.LAB_WALL_V, FurnitureDefs.LAB_WALL_H1, FurnitureDefs.LAB_WALL_H2]:
		world.add_child(_invisible_wall(r))
	_add_perimeter_walls()

	nav.build(FurnitureDefs.FLOOR, FurnitureDefs.obstacles() + DepartmentDefs.obstacles())

	for slug in CharacterDefs.AGENTS:
		var agent := AgentNPC.new()
		world.add_child(agent)
		agent.setup(slug, nav)
		agents.append(agent)

	_add_maintainers()
	_add_lights()
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

	# TEST-AUTO: JHT_SHOT=path.png → screenshot dopo un secondo e chiude.
	# Con JHT_OVERVIEW=1 permette a noi agenti di verificare il layout da soli.
	var shot := OS.get_environment("JHT_SHOT")
	if shot != "":
		_take_shot(shot)

func _take_shot(path: String) -> void:
	await get_tree().create_timer(1.2).timeout
	var img := get_viewport().get_texture().get_image()
	img.save_png(path)
	print("JHT_SHOT salvato: ", path)
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

## Click "pulito" dalla FreeCamera: agente > bacheca > reparto.
func _on_world_click(target: Vector2) -> void:
	if Game.dialogue_active:
		return
	if _registry:
		return  # col registro aperto, il mondo non riceve click
	for agent in agents:
		if agent.hit_by(target):
			_start_talk(agent)
			return
	if FurnitureDefs.get_rect("corkboard").grow(30).has_point(target):
		_registry = RegistryPanel.new()
		add_child(_registry)
		return
	var dept := DepartmentDefs.department_at(target)
	if dept != "":
		# pannello reparto in arrivo (M-reparti); intanto feedback sonoro
		Sfx.play_tick()
		print("[office] click sul reparto: ", dept)

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

func _start_talk(agent: AgentNPC) -> void:
	if Game.dialogue_active:
		return
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

## Pozze di luce calde + neon freddo su ambiente buio (DE: la luce definisce
## le zone, il resto resta in penombra). Poche e dipinte.
func _add_lights() -> void:
	if OS.get_environment("JHT_NOFX") == "1":
		return  # TEST-AUTO
	var cm := CanvasModulate.new()
	cm.color = Color(0.76, 0.77, 0.92)
	add_child(cm)
	add_child(ScreenGrade.new())

	var warm := Color("#ffb45c")
	var cool := Color("#4d9fff")
	var mint := Color("#7fffb2")
	var pools := [
		[Vector2(330, 260), 260.0, warm, 0.20],    # lampada lounge
		[Vector2(1090, 230), 210.0, warm, 0.13],   # libreria
		[Vector2(1500, 235), 240.0, warm, 0.18],   # angolo caffè
		[Vector2(545, 760), 250.0, warm, 0.17],    # desk Coordinatore
		[Vector2(595, 1160), 250.0, warm, 0.17],   # desk Assistente
		[Vector2(1205, 1110), 250.0, warm, 0.17],  # desk Scout
		[Vector2(1575, 1110), 200.0, warm, 0.10],  # desk pod
		[Vector2(2140, 1055), 260.0, warm, 0.17],  # postazione Scorer
		[Vector2(2115, 385), 260.0, mint, 0.12],   # lab (luce fredda)
		[Vector2(1300, 780), 330.0, mint, 0.13],   # ologramma
	]
	for p in pools:
		add_child(LightPool.new(p[0], p[1], p[2], p[3]))
	# lavaggio neon lungo i vetri
	var f := FurnitureDefs.FLOOR
	var top_wash := LightPool.new(Vector2(f.get_center().x, f.position.y), 1150.0, cool, 0.05, 0.10)
	var bottom_wash := LightPool.new(Vector2(f.get_center().x, f.end.y), 1150.0, cool, 0.05, 0.10)
	var left_wash := LightPool.new(Vector2(f.position.x, f.get_center().y), 640.0, cool, 0.05, 0.16)
	left_wash.rotation = PI / 2.0
	var right_wash := LightPool.new(Vector2(f.end.x, f.get_center().y), 640.0, cool, 0.05, 0.16)
	right_wash.rotation = PI / 2.0
	for wash in [top_wash, bottom_wash, left_wash, right_wash]:
		add_child(wash)

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

