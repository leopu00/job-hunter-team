extends SceneTree
## Regressione del caso P0: la fascia bassa dei desk frontali e' utile solo
## per un rig dinamico seduto. Se resta a z assoluto nel World, copre la testa
## di qualunque agente in cammino, anche quando i suoi piedi sono davanti al
## mobile nel normale y-sort.
##
## Esecuzione:
##   godot --headless --path game --script res://tools/furniture_occlusion_selftest.gd

const FurnitureNodeScript = preload("res://scripts/office/furniture_node.gd")
const DepartmentDefsScript = preload("res://scripts/office/department_defs.gd")

var _fails: Array[String] = []


func _init() -> void:
	process_frame.connect(_run, CONNECT_ONE_SHOT)


func _run() -> void:
	var front_desks: Array = []
	for desk in DepartmentDefsScript.all_desks():
		if desk.has("front_occlusion"):
			front_desks.append(desk)
	_check("tutti i cinque reparti dichiarano il desk frontale", front_desks.size() == 5,
			str(front_desks.size()))
	var every_front_desk_has_composite := true
	for desk in front_desks:
		every_front_desk_has_composite = every_front_desk_has_composite \
				and not str(desk.get("seated_art", "")).is_empty()
	_check("i desk frontali attuali hanno un composito seated", every_front_desk_has_composite)

	var world := Node2D.new()
	world.y_sort_enabled = true
	root.add_child(world)
	var probe_item: Dictionary = front_desks[0].duplicate()
	probe_item["id"] = "occlusion_probe"
	var desk: FurnitureNode = FurnitureNodeScript.new(probe_item)
	world.add_child(desk)
	await process_frame
	_check("la fascia frontale e' costruita per il desk frontale", desk.has_front_occlusion())
	_check("la fascia frontale nasce spenta per i passaggi", not desk.front_occlusion_visible())
	desk.set_front_occlusion(true)
	_check("la fascia si puo' attivare soltanto per posa seduta dinamica",
			desk.front_occlusion_visible())
	desk.set_front_occlusion(false)
	_check("la fascia torna invisibile appena l'agente si alza",
			not desk.front_occlusion_visible())

	var furniture_source := FileAccess.get_file_as_string("res://scripts/office/furniture_node.gd")
	var agent_source := FileAccess.get_file_as_string("res://scripts/characters/agent_npc.gd")
	_check("nessun FrontOccluder resta visibile di default",
			furniture_source.contains("overlay.visible = false"))
	_check("AgentNPC limita la maschera al rig seduto non composito",
			agent_source.contains("desk_node.set_front_occlusion(on and _seated() and not use_composite)"))
	world.queue_free()
	if _fails.is_empty():
		print("FURNITURE-OCCLUSION-TEST PASS")
		quit(0)
	else:
		print("FURNITURE-OCCLUSION-TEST FAIL ", _fails)
		quit(1)


func _check(what: String, ok: bool, detail := "") -> void:
	if not ok:
		_fails.append(what + ("" if detail == "" else " — " + detail))
