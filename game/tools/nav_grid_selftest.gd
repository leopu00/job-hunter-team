extends SceneTree
## Self-test headless del contratto collisioni/pathfinding.
## Esecuzione: godot --headless --path game --script res://tools/nav_grid_selftest.gd

const NavGridScript = preload("res://scripts/office/nav_grid.gd")
const DepartmentDefsScript = preload("res://scripts/office/department_defs.gd")
const DeptRugsScript = preload("res://scripts/office/dept_rugs.gd")
const FurnitureDefsScript = preload("res://scripts/office/furniture_defs.gd")
const CharacterDefsScript = preload("res://scripts/characters/character_defs.gd")
const HandoffStationScript = preload("res://scripts/office/handoff_station.gd")

var _failures: Array[String] = []

func _init() -> void:
	_test_blocked_destination_is_clamped()
	_test_writer_radial_layout()
	_test_all_department_radial_layouts()
	_test_all_department_desk_textures()
	_test_department_occupied_composites()
	_test_department_character_variants()
	_test_core_workstations()
	_test_core_patrol_routes()
	_test_real_desk_routes()
	_test_handoff_routes()
	_test_writer_handoff_visual_clearance()
	if _failures.is_empty():
		print("[nav-test] PASS: collision clamp + all desk routes")
		quit(0)
		return
	for failure in _failures:
		push_error("[nav-test] " + failure)
	quit(1)

func _test_blocked_destination_is_clamped() -> void:
	var nav = NavGridScript.new()
	nav.build(Rect2(0, 0, 320, 320), [Rect2(128, 128, 64, 64)])
	# Fuori dal mobile fisico, ma dentro il margine nav di 16px: il vecchio
	# clamp lo rimetteva come ultimo waypoint e mandava il corpo sul mobile.
	var blocked_target := Vector2(120, 160)
	_assert(not nav.is_point_walkable(blocked_target), "synthetic target should be blocked")
	var route: PackedVector2Array = nav.path(Vector2(48, 160), blocked_target)
	_assert(not route.is_empty(), "synthetic route is empty")
	if not route.is_empty():
		_assert(route[-1] != blocked_target, "blocked target was preserved as final waypoint")
		_assert(nav.is_point_walkable(route[-1]), "clamped synthetic endpoint is not walkable")

	var safe_target := Vector2(80, 160)
	var safe_route: PackedVector2Array = nav.path(Vector2(48, 160), safe_target)
	_assert(not safe_route.is_empty(), "safe synthetic route is empty")
	if not safe_route.is_empty():
		_assert(safe_route[-1] == safe_target, "walkable destination should stay exact")

func _test_real_desk_routes() -> void:
	var nav = NavGridScript.new()
	var obstacles: Array = FurnitureDefsScript.obstacles()
	obstacles.append_array(DepartmentDefsScript.obstacles())
	nav.build(FurnitureDefsScript.FLOOR, obstacles, DepartmentDefsScript.GLASS_WALLS)
	var start := Vector2(1500, 900)
	for desk in DepartmentDefsScript.all_desks():
		var spot: Vector2 = DepartmentDefsScript.desk_spot(desk)
		var route: PackedVector2Array = nav.path(start, spot)
		var label := "%s:%d" % [desk["dept"], desk["index"]]
		var closest_id: int = nav.astar.get_closest_point(spot)
		var closest: Vector2 = nav.astar.get_point_position(closest_id)
		_assert(not route.is_empty(), "%s has no route (spot=%s closest=%s degree=%d)" % [
			label, spot, closest, nav.astar.get_point_connections(closest_id).size(),
		])
		if route.is_empty():
			continue
		_assert(nav.is_point_walkable(route[-1]), "%s endpoint remains blocked" % label)
		var approach: Vector2 = nav.approach_point(start, spot)
		var approach_route: PackedVector2Array = nav.path(start, approach)
		_assert(not approach_route.is_empty(), "%s has no approach route" % label)
		_assert(nav.is_point_walkable(approach), "%s approach is blocked" % label)
		_assert(approach.distance_to(spot) >= 48.0,
				"%s approach overlaps target (%0.1fpx)" % [label, approach.distance_to(spot)])

## Ogni tavolo di passaggio deve essere raggiungibile sia dal reparto che
## consegna sia da quello che ritira. È il contratto che consente di muovere
## liberamente i tavoli senza creare un layout bello ma non percorribile.
func _test_handoff_routes() -> void:
	var nav = NavGridScript.new()
	var obstacles: Array = FurnitureDefsScript.obstacles()
	obstacles.append_array(DepartmentDefsScript.obstacles())
	nav.build(FurnitureDefsScript.FLOOR, obstacles, DepartmentDefsScript.GLASS_WALLS)
	var order: Array = DepartmentDefsScript.DEPT_ORDER
	for dept_id in DepartmentDefsScript.HANDOFF_DEPTS:
		var producer_i := order.find(dept_id)
		var consumer_id: String = str(order[producer_i + 1])
		var producer_desk: Dictionary = DepartmentDefsScript.DEPARTMENTS[dept_id]["desks"][0]
		var consumer_desk: Dictionary = DepartmentDefsScript.DEPARTMENTS[consumer_id]["desks"][0]
		var drop: Vector2 = DepartmentDefsScript.handoff_spot(dept_id, false)
		var pickup: Vector2 = DepartmentDefsScript.handoff_spot(dept_id, true)
		_assert(nav.is_point_walkable(drop), "%s drop access is blocked: %s" % [dept_id, drop])
		_assert(nav.is_point_walkable(pickup), "%s pickup access is blocked: %s" % [dept_id, pickup])
		var producer_start: Vector2 = DepartmentDefsScript.desk_spot(producer_desk)
		var consumer_start: Vector2 = DepartmentDefsScript.desk_spot(consumer_desk)
		_assert(not nav.path(producer_start, drop).is_empty(),
				"%s producer cannot reach drop access" % dept_id)
		_assert(not nav.path(consumer_start, pickup).is_empty(),
				"%s consumer cannot reach pickup access" % dept_id)

## Le collisioni possono essere separate mentre i canvas pittorici si
## sovrappongono. Protegge il tavolo Scrittori dai tre props alti che lo
## attraversavano visivamente pur avendo footprint distinti.
func _test_writer_handoff_visual_clearance() -> void:
	var pos: Vector2 = DepartmentDefsScript.DEPARTMENTS["scrittori"]["inbox"]
	var table_tex: Texture2D = load(HandoffStationScript.TABLE_TEXTURES["scrittori"])
	var table_w: float = HandoffStationScript.TABLE_WIDTH
	var table_h: float = table_w * table_tex.get_height() / table_tex.get_width()
	var table_rect := Rect2(pos - Vector2(table_w / 2.0, table_h),
			Vector2(table_w, table_h))
	for item_id in ["plant_palm_a", "drawer_scrittori"]:
		var item: Dictionary = {}
		for candidate in FurnitureDefsScript.ITEMS:
			if str(candidate["id"]) == item_id:
				item = candidate
				break
		_assert(not item.is_empty(), "%s is missing from furniture" % item_id)
		if item.is_empty():
			continue
		var kind := str(item["kind"])
		var texture_path := "res://assets/gen-art/furniture/%s.png" % kind
		var texture: Texture2D = load(texture_path)
		_assert(texture != null, "%s visual is missing" % item_id)
		if texture == null:
			continue
		var footprint: Rect2 = item["rect"]
		var visual_w := footprint.size.x * 1.06
		var visual_h := visual_w * texture.get_height() / texture.get_width()
		var visual_rect := Rect2(
				Vector2(footprint.get_center().x - visual_w / 2.0,
						footprint.end.y - visual_h + 10.0),
				Vector2(visual_w, visual_h))
		_assert(not table_rect.intersects(visual_rect),
				"writers handoff overlaps %s visual (%s vs %s)" % [
						item_id, table_rect, visual_rect])

func _test_writer_radial_layout() -> void:
	var desks: Array = DepartmentDefsScript.DEPARTMENTS["scrittori"]["desks"]
	_assert(desks.size() == 6, "writers must have exactly six radial desks")
	if desks.size() != 6:
		return
	var center := Vector2(690, 1725)
	var expected_facing := ["left", "left", "up", "down", "right", "right"]
	var expected_texture := ["left", "down_left", "up", "down", "right", "down_right"]
	var expected_asset := ["side", "diag_down", "up", "down", "side", "diag_down"]
	var expected_flip := [false, true, false, false, true, false]
	# Tutte le viste radiali devono esistere davvero. ResourceLoader.exists()
	# da solo non basta: un .import orfano risulta presente ma load() fallisce.
	for suffix in ["side", "up", "down", "diag_down"]:
		var asset := "res://assets/gen-art/furniture/scrittori_a_%s.png" % suffix
		_assert(_texture_loads(asset), "writers texture is missing or unloadable: %s" % asset)
	var facing_vector := {
		"up": Vector2.UP, "right": Vector2.RIGHT,
		"down": Vector2.DOWN, "left": Vector2.LEFT,
	}
	for i in desks.size():
		var desk: Dictionary = desks[i]
		var facing: String = desk.get("facing", "")
		_assert(facing == expected_facing[i],
				"writer:%d facing=%s, expected=%s" % [i, facing, expected_facing[i]])
		_assert(str(desk.get("tex_facing", facing)) == expected_texture[i],
				"writer:%d texture facing=%s, expected=%s" % [
					i, desk.get("tex_facing", facing), expected_texture[i],
				])
		var visual: Dictionary = _desk_visual(desk)
		var wanted_path := "res://assets/gen-art/furniture/scrittori_a_%s.png" % expected_asset[i]
		_assert(str(visual.get("path", "")) == wanted_path,
				"writer:%d asset=%s, expected=%s" % [i, visual.get("path", ""), wanted_path])
		_assert(bool(visual.get("flip_h", false)) == expected_flip[i],
				"writer:%d flip_h=%s, expected=%s" % [
					i, visual.get("flip_h", false), expected_flip[i],
				])
		var radial: Vector2 = (desk["rect"] as Rect2).get_center() - center
		_assert(radial.dot(facing_vector.get(facing, Vector2.ZERO)) > 80.0,
				"writer:%d does not face outward (radial=%s facing=%s)" % [i, radial, facing])

## Ogni reparto ora condivide lo stesso contratto a sei spicchi: sedie verso
## il centro, corpi verso l'esterno e quattro viste raster realmente importate.
func _test_all_department_radial_layouts() -> void:
	# La sorgente della verità è il tappeto: così un reparto spostato non
	# può continuare a passare il test rispetto a un vecchio centro hardcoded.
	var centers := {}
	for dept in DepartmentDefsScript.DEPT_ORDER:
		centers[dept] = DeptRugsScript.RUGS[dept][0]
		var rug_asset := str(DeptRugsScript.RUGS[dept][2])
		_assert(_texture_loads(rug_asset), "%s Persian rug missing: %s" % [dept, rug_asset])
	_assert((DeptRugsScript.RUGS["scrittori"][1] as Vector2).x >= 980.0,
			"writer rug must cover the full six-desk ring")
	var expected_facing := ["left", "left", "up", "down", "right", "right"]
	var facing_vector := {
		"up": Vector2.UP, "right": Vector2.RIGHT,
		"down": Vector2.DOWN, "left": Vector2.LEFT,
	}
	for dept in DepartmentDefsScript.DEPT_ORDER:
		var desks: Array = DepartmentDefsScript.DEPARTMENTS[dept]["desks"]
		_assert(desks.size() == 6, "%s must have exactly six radial desks" % dept)
		if desks.size() != 6:
			continue
		var kind := str(desks[0].get("kind", ""))
		for suffix in ["side", "up", "down", "diag_down"]:
			var asset := "res://assets/gen-art/furniture/%s_%s.png" % [kind, suffix]
			_assert(_texture_loads(asset), "%s radial texture missing: %s" % [dept, asset])
		for i in desks.size():
			var desk: Dictionary = desks[i]
			var facing := str(desk.get("facing", ""))
			_assert(facing == expected_facing[i], "%s:%d facing=%s expected=%s" % [
				dept, i, facing, expected_facing[i],
			])
			var radial: Vector2 = (desk["rect"] as Rect2).get_center() - centers[dept]
			_assert(radial.dot(facing_vector.get(facing, Vector2.ZERO)) > 75.0,
					"%s:%d does not face outward (radial=%s facing=%s)" % [dept, i, radial, facing])
			if i == 3:
				_assert(bool(desk.get("integrated_chair", false)),
						"%s:3 must suppress the duplicate front chair" % dept)
				var cut := float(desk.get("front_occlusion", 0.0))
				_assert(cut >= 0.5 and cut <= 0.9,
						"%s:3 needs a valid animated-rig front occlusion cut" % dept)

## Contratto risorse dell'intero ufficio: ogni postazione deve risolvere alla
## variante orientata usata da FurnitureNode e quella texture deve caricarsi.
## Copre side/up/down/diag_down in tutti i reparti.
func _test_all_department_desk_textures() -> void:
	for desk in DepartmentDefsScript.all_desks():
		var visual: Dictionary = _desk_visual(desk)
		var label := "%s:%d" % [desk["dept"], desk["index"]]
		var path := str(visual.get("path", ""))
		_assert(not path.is_empty(), "%s has no desk texture path" % label)
		if path.is_empty():
			continue
		_assert(_texture_loads(path), "%s texture is missing or unloadable: %s" % [label, path])

## Ogni agente di reparto si siede dentro un composito completo della propria
## postazione. Il canvas deve coincidere con quello vuoto, altrimenti lo swap
## sposta o ridimensiona il mobile; le varianti b..f devono inoltre avere un
## path esplicito, così non ricadono mai sul volto legacy `a`.
func _test_department_occupied_composites() -> void:
	for desk in DepartmentDefsScript.all_desks():
		var dept := str(desk["dept"])
		var index := int(desk["index"])
		var label := "%s:%d" % [dept, index]
		var visual: Dictionary = _desk_visual(desk)
		var base_path := str(visual.get("path", ""))
		if base_path.is_empty() or not _texture_loads(base_path):
			continue
		var seated_path := str(desk.get("seated_art", ""))
		if seated_path.is_empty():
			var v2_path := base_path.replace(".png", "_seated_v2.png")
			var legacy_path := base_path.replace(".png", "_seated.png")
			seated_path = v2_path if _texture_loads(v2_path) else legacy_path
		_assert(_texture_loads(seated_path), "%s occupied art missing: %s" % [label, seated_path])
		if not _texture_loads(seated_path):
			continue
		var variant := str(CharacterDefsScript.VARIANT_BY_DESK[dept][index])
		if variant != "a":
			_assert(desk.has("seated_art"), "%s variant %s needs explicit occupied art" % [label, variant])
			_assert(seated_path.contains("_%s_" % variant),
					"%s occupied art does not match variant %s: %s" % [label, variant, seated_path])
		var base: Texture2D = load(base_path)
		var seated: Texture2D = load(seated_path)
		_assert(base.get_size() == seated.get_size(), "%s occupied canvas mismatch" % label)

## Ogni sedia di reparto ha un'identità stabile e un foglio movimento 6x12.
## Verifica anche che il roster non torni per errore a usare `a` per tutti.
func _test_department_character_variants() -> void:
	var seen := {}
	for def in CharacterDefsScript.spawn_list():
		var dept := str(def.get("dept", ""))
		if dept.is_empty():
			continue
		var slug := str(def["slug"])
		var variant := str(def.get("variant", ""))
		var desk := int(def["desk"])
		var expected := str(CharacterDefsScript.VARIANT_BY_DESK[dept][desk])
		_assert(variant == expected, "%s:%d variant=%s expected=%s" % [
			dept, desk, variant, expected,
		])
		seen["%s_%s" % [slug, variant]] = true
		var path := "res://assets/characters/sheets/%s_%s.png" % [slug, variant]
		_assert(_texture_loads(path), "character variant missing: %s" % path)
		if _texture_loads(path):
			var texture: Texture2D = load(path)
			_assert(texture.get_size() == Vector2(1536, 4608),
					"character variant has wrong size: %s" % path)
		var sit_path := "res://assets/characters/sheets/%s_%s_sit.png" % [slug, variant]
		if variant == "a":
			sit_path = "res://assets/characters/sheets/%s_sit.png" % slug
		_assert(_texture_loads(sit_path), "seated character variant missing: %s" % sit_path)
		if _texture_loads(sit_path):
			var sit_texture: Texture2D = load(sit_path)
			_assert(sit_texture.get_size() == Vector2(1024, 1152),
					"seated character variant has wrong size: %s" % sit_path)
			var rig: Node2D = CharacterDefsScript.make_rig(slug, variant)
			var selected_sit: Texture2D = rig.get("_sit_sheet")
			_assert(selected_sit != null, "rig did not select seated sheet: %s" % sit_path)
			if selected_sit != null:
				_assert(selected_sit.resource_path == sit_path,
						"rig selected %s instead of %s" % [selected_sit.resource_path, sit_path])
			rig.free()
	for dept_id in CharacterDefsScript.DEPT_ROLES:
		var slug := str(CharacterDefsScript.DEPT_ROLES[dept_id]["slug"])
		for variant in ["a", "b", "c", "d", "e", "f"]:
			_assert(seen.has("%s_%s" % [slug, variant]),
					"roster does not expose %s_%s" % [slug, variant])

## Ogni ruolo core seduto ha una postazione personale frontale: base e arte
## occupata devono essere entrambe presenti e avere lo stesso canvas,
## altrimenti lo swap durante la ronda produce un salto visibile.
func _test_core_workstations() -> void:
	var expected := {
		"core:coordinatore": {"stem": "coordinatore_desk_down", "facing": "down"},
		"core:sentinella": {"stem": "sentinella_desk_down", "facing": "down"},
		"core:mentor": {"stem": "mentor_armchair", "facing": "down"},
		"core:assistente": {"stem": "assistente_desk_down", "facing": "down"},
		"core:mantenitore": {"stem": "mantenitore_workbench_down", "facing": "down"},
		"core:dottore": {"stem": "dottore_armchair", "facing": "down"},
	}
	var found: Dictionary = {}
	for item in FurnitureDefsScript.ITEMS:
		var key := str(item.get("registry_key", ""))
		if key.is_empty():
			continue
		found[key] = true
		var contract: Dictionary = expected.get(key, {})
		_assert(not contract.is_empty(), "unexpected core workstation registry: %s" % key)
		if contract.is_empty():
			continue
		_assert(str(item.get("facing", "")) == str(contract["facing"]),
				"%s has the wrong facing" % key)
		var stem := str(contract["stem"])
		var base_path := "res://assets/gen-art/furniture/%s.png" % stem
		var seated_path := "res://assets/gen-art/furniture/%s_seated_v2.png" % stem
		_assert(_texture_loads(base_path), "%s base art missing" % key)
		_assert(_texture_loads(seated_path), "%s occupied art missing" % key)
		if _texture_loads(base_path) and _texture_loads(seated_path):
			var base: Texture2D = load(base_path)
			var seated: Texture2D = load(seated_path)
			_assert(base.get_size() == seated.get_size(), "%s canvas mismatch" % key)
	for key in expected:
		_assert(found.has(key), "%s workstation is not registered" % key)
	_assert(_texture_loads("res://assets/characters/sheets/sentinella_a.png"),
			"Sentinel must use its own Treasurer sheet")
	_assert(_texture_loads("res://assets/characters/sheets/dottore_a.png"),
			"Doctor must use his own medical sheet")

func _test_core_patrol_routes() -> void:
	var nav = NavGridScript.new()
	var obstacles: Array = FurnitureDefsScript.obstacles()
	obstacles.append_array(DepartmentDefsScript.obstacles())
	nav.build(FurnitureDefsScript.FLOOR, obstacles, DepartmentDefsScript.GLASS_WALLS)
	for slug in ["coordinatore", "sentinella", "mentor", "assistente", "mantenitore", "dottore"]:
		var def: Dictionary = CharacterDefsScript.AGENTS[slug]
		var home: Vector2 = nav.approach_point(Vector2(1700, 900), def["spot"])
		_assert(nav.is_point_walkable(home), "%s desk approach is blocked" % slug)
		for target in def["wander"]:
			var out_route: PackedVector2Array = nav.path(home, target)
			var back_route: PackedVector2Array = nav.path(target, home)
			_assert(not out_route.is_empty(), "%s cannot patrol to %s" % [slug, target])
			_assert(not back_route.is_empty(), "%s cannot return from %s" % [slug, target])

## Specchio del resolver di FurnitureNode, mantenuto qui come contratto di
## regressione: se cambia la convenzione di suffissi/flip, il test obbliga ad
## aggiornare insieme dati e risorse invece di mostrare un fallback sbagliato.
func _desk_visual(desk: Dictionary) -> Dictionary:
	var kind := str(desk.get("kind", ""))
	var facing := str(desk.get("tex_facing", desk.get("facing", "")))
	var suffix := "down"
	var flip_h := false
	match facing:
		"up": suffix = "up"
		"down_right": suffix = "diag_down"
		"down_left":
			suffix = "diag_down"
			flip_h = true
		"left": suffix = "side"
		"right":
			suffix = "side"
			flip_h = true
	var oriented := "res://assets/gen-art/furniture/%s_%s.png" % [kind, suffix]
	if _texture_loads(oriented):
		return {"path": oriented, "flip_h": flip_h}
	var direct := "res://assets/gen-art/furniture/%s.png" % kind
	if _texture_loads(direct):
		return {"path": direct, "flip_h": false}
	return {"path": "", "flip_h": false}

func _texture_loads(path: String) -> bool:
	if not ResourceLoader.exists(path):
		return false
	return load(path) is Texture2D

func _assert(condition: bool, message: String) -> void:
	if not condition:
		_failures.append(message)
