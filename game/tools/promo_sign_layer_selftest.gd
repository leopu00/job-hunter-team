extends SceneTree
## La veste inglese del set promo sostituisce DepartmentDressing con un nodo
## nuovo. Il nodo deve restare sotto il World y-sortato: una targa sopra un
## agente in cammino gli taglia visivamente la testa nel raw.
##
## Esecuzione:
##   godot --headless --path game --script res://tools/promo_sign_layer_selftest.gd

var _fails: Array[String] = []


func _init() -> void:
	process_frame.connect(_run, CONNECT_ONE_SHOT)


func _run() -> void:
	var signs: Node2D = load("res://tools/promo_dept_signs.gd").new()
	var world := Node2D.new()
	world.y_sort_enabled = true
	_check("la targa inglese usa il layer fondale del reparto",
			signs.z_index == -2, str(signs.z_index))
	_check("la targa inglese resta sotto il mondo degli agenti",
			signs.z_index < world.z_index,
			"signs=%d world=%d" % [signs.z_index, world.z_index])
	world.free()
	signs.free()
	if _fails.is_empty():
		print("PROMO-SIGN-LAYER-TEST PASS")
		quit(0)
	else:
		print("PROMO-SIGN-LAYER-TEST FAIL ", _fails)
		quit(1)


func _check(what: String, ok: bool, detail := "") -> void:
	if not ok:
		_fails.append(what + ("" if detail == "" else " — " + detail))
