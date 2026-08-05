extends SceneTree
## Contratto tecnico delle tre riprese V3 approvate dall'operatore.
## Verifica le coordinate contro la NavGrid vera, le durate minime, e i ganci
## di camera/regia che mantengono il frame product-only senza UI incorporata.
##
## Esecuzione:
##   godot --headless --path game --script res://tools/promo_v3_selftest.gd

const NavGridScript = preload("res://scripts/office/nav_grid.gd")
const FurnitureDefsScript = preload("res://scripts/office/furniture_defs.gd")
const DepartmentDefsScript = preload("res://scripts/office/department_defs.gd")

const TEAM_STEPS := [
	[Vector2(1450.0, 650.0), Vector2(1450.0, 780.0)],
	[Vector2(1570.0, 650.0), Vector2(1570.0, 780.0)],
	[Vector2(1690.0, 650.0), Vector2(1690.0, 780.0)],
]
const TEAM_CAMERA := Vector2(1570.0, 650.0)
const TEAM_ZOOM := 1.82
const TEAM_VISIBLE_TOP := 780.0 - 180.0
const TEAM_VISIBLE_FEET := 780.0
const INTRO_STEP := [Vector2(1790.0, 1390.0), Vector2(1790.0, 1450.0)]
const WALK_FROM := Vector2(1260.0, 780.0)
const WALK_TO := Vector2(2600.0, 780.0)
const MIN_WALK_DISTANCE := 150.0 * 8.5
const V5_STEPS := [
	[Vector2(1450.0, 650.0), Vector2(1450.0, 780.0)],
	[Vector2(1450.0, 780.0), Vector2(1350.0, 780.0)],
	[Vector2(1570.0, 650.0), Vector2(1570.0, 780.0)],
	[Vector2(1570.0, 780.0), Vector2(1700.0, 780.0)],
	[Vector2(1690.0, 650.0), Vector2(1690.0, 780.0)],
	[Vector2(1690.0, 780.0), Vector2(1790.0, 780.0)],
]
const V5_CLOSE_CAMERA := Vector2(1570.0, 760.0)
const V5_CLOSE_ZOOM := 1.65
const V5_AGENT_SIDE_CLEARANCE := 110.0

var _fails: Array[String] = []


func _init() -> void:
	_test_real_routes()
	_test_v3_director_contract()
	if _fails.is_empty():
		print("PROMO-V3-REGIA-TEST PASS")
		quit(0)
		return
	print("PROMO-V3-REGIA-TEST FAIL ", _fails)
	quit(1)


func _nav():
	var nav = NavGridScript.new()
	var obstacles: Array = FurnitureDefsScript.obstacles()
	obstacles.append_array(DepartmentDefsScript.obstacles())
	# Output shelf: Office lo aggiunge alla stessa matrice, qui e' fuori dalle
	# tre tratte ma lo includiamo per non validare una nav piu' permissiva.
	obstacles.append(Rect2(1395, 1908, 170, 64))
	nav.build(FurnitureDefsScript.FLOOR, obstacles, DepartmentDefsScript.GLASS_WALLS)
	return nav


func _test_real_routes() -> void:
	var nav = _nav()
	for i in TEAM_STEPS.size():
		_check_route(nav, TEAM_STEPS[i][0], TEAM_STEPS[i][1],
				"team-welcome passo %d" % (i + 1))
	_check_route(nav, INTRO_STEP[0], INTRO_STEP[1], "assistant-intro passo frontale")
	var route: PackedVector2Array = nav.path(WALK_FROM, WALK_TO)
	_check(nav.is_point_walkable(WALK_FROM) and nav.is_point_walkable(WALK_TO),
			"assistant-walk-right parte e termina su pavimento libero")
	_check(not route.is_empty(), "assistant-walk-right ha una route NavGrid")
	if route.is_empty():
		return
	var distance := _route_distance(route)
	_check(distance >= MIN_WALK_DISTANCE,
			"assistant-walk-right cammina per almeno 8.5 s a 150 px/s",
			"%.1f < %.1f" % [distance, MIN_WALK_DISTANCE])
	var never_turns_left := true
	for i in range(1, route.size()):
		if route[i].x + 0.1 < route[i - 1].x:
			never_turns_left = false
	_check(never_turns_left, "assistant-walk-right non inverte la marcia")
	# La prima ripresa V3 teneva il centro a y=960: i piedi dei tre agenti
	# erano nel quadro ma le teste cadevano sopra il bordo. Protegge il framing
	# col box conservativo di 180 px sopra il piede (piu' alto dei fogli reali).
	var top_screen := _screen_y(TEAM_VISIBLE_TOP, TEAM_CAMERA.y, TEAM_ZOOM)
	var feet_screen := _screen_y(TEAM_VISIBLE_FEET, TEAM_CAMERA.y, TEAM_ZOOM)
	_check(top_screen >= 40.0 and feet_screen <= 1040.0,
			"team-welcome mantiene il cast intero nel frame 16:9",
			"top=%.1f feet=%.1f" % [top_screen, feet_screen])
	for step in V5_STEPS:
		_check_route(nav, step[0], step[1], "V5 reveal usa NavGrid reale")
	# Il close portrait (h=1920) concede più aria del 16:9: testa e piedi
	# dell'Assistente devono restare lontani dai bordi già nel primo handle.
	var v5_top := _portrait_screen_y(600.0, V5_CLOSE_CAMERA.y, V5_CLOSE_ZOOM)
	var v5_feet := _portrait_screen_y(780.0, V5_CLOSE_CAMERA.y, V5_CLOSE_ZOOM)
	_check(v5_top >= 80.0 and v5_feet <= 1840.0,
			"V5 reveal mantiene testa e piedi nel portrait",
			"top=%.1f feet=%.1f" % [v5_top, v5_feet])
	for step in V5_STEPS:
		for point: Vector2 in step:
			var x := _portrait_screen_x(point.x, V5_CLOSE_CAMERA.x, V5_CLOSE_ZOOM)
			_check(x >= V5_AGENT_SIDE_CLEARANCE and x <= 1080.0 - V5_AGENT_SIDE_CLEARANCE,
					"V5 reveal mantiene intera la silhouette sul lato",
					"x=%.1f point=%s" % [x, point])


func _check_route(nav, from: Vector2, to: Vector2, label: String) -> void:
	_check(nav.is_point_walkable(from) and nav.is_point_walkable(to),
			label + " usa solo punti camminabili")
	_check(not nav.path(from, to).is_empty(), label + " usa NavGrid reale")


func _route_distance(route: PackedVector2Array) -> float:
	var total := 0.0
	for i in range(1, route.size()):
		total += route[i - 1].distance_to(route[i])
	return total


func _screen_y(world_y: float, camera_y: float, zoom: float) -> float:
	return 540.0 + (world_y - camera_y) * zoom


func _portrait_screen_y(world_y: float, camera_y: float, zoom: float) -> float:
	return 960.0 + (world_y - camera_y) * zoom


func _portrait_screen_x(world_x: float, camera_x: float, zoom: float) -> float:
	return 540.0 + (world_x - camera_x) * zoom


func _test_v3_director_contract() -> void:
	var source := FileAccess.get_file_as_string("res://tools/promo_director.gd")
	for mode in ["team-welcome", "assistant-intro", "assistant-walk-right"]:
		_check(source.contains('"%s":' % mode), "mode promo %s registrato" % mode)
	for fn in ["_team_welcome_clip", "_assistant_intro_clip", "_assistant_walk_right_clip"]:
		_check(source.contains("func %s" % fn), "regia %s presente" % fn)
	_check(source.contains("V3_TEAM_WELCOME_SECONDS := 9.6")
			and source.contains("V3_ASSISTANT_INTRO_SECONDS := 7.2")
			and source.contains("V3_ASSISTANT_WALK_SECONDS := 8.6"),
			"tutte le durate superano il minimo V3")
	_check(source.contains("V3_TEAM_CAMERA := Vector2(1570.0, 650.0)"),
			"team-welcome usa il framing post-occlusione")
	_check(source.contains("_dress_promo_set()")
			and source.contains("_hide_promo_hud()")
			and source.contains("_hide_simulation_badge()")
			and source.contains("_silence_state_tags()"),
			"le clip V3 riusano la superficie product-only")
	_check(source.contains("func _v3_silence_quest_markers()")
			and source.contains("agent.set_story_marker(false)")
			and source.contains("if _v3_active:"),
			"i marker onboarding non rientrano nei frame V3")
	_check(source.contains("_track_target = assistant")
			and source.contains("V3_ASSISTANT_WALK_CAMERA_OFFSET")
			and source.contains("_mount_camera(assistant.global_position + _track_offset"),
			"assistant-walk-right aggancia la Camera2D al soggetto")
	_check(source.contains("_force_legs(agent")
			and source.contains("_force_legs(assistant"),
			"le clip V3 usano gambe AgentNPC invece di animazioni separate")
	_check(not source.contains("BackendBus.publish_chat({\"ts\": Time.get_datetime_string_from_system(),\n\t\t\"from\": \"assistente\""),
			"la nuova regia Assistant non inietta dialoghi baked-in")
	_check(source.contains('"v5-reveal":')
			and source.contains("func _v5_reveal_clip")
			and source.contains("V5_REVEAL_SECONDS := 14.2"),
			"V5 reveal è una ripresa distinta con durata superiore a 14 s")
	_check(source.contains("V5_REVEAL_CLOSE_CAMERA")
			and source.contains("V5_REVEAL_WIDE_CAMERA")
			and source.contains("_force_legs(agent")
			and source.contains("_v5_hide_world_copy()")
			and source.contains("station is PaperPile")
			and source.contains("if dressing is DepartmentDressing")
			and source.contains("agent.aura.visible = false"),
			"V5 reveal muove Camera2D e AgentNPC reali, non una panoramica statica")


func _check(ok: bool, what: String, detail := "") -> void:
	if not ok:
		_fails.append(what + ("" if detail == "" else " — " + detail))
