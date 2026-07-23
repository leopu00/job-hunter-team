extends SceneTree
## Riproduce sulla NavGrid reale un ciclo di lavoro per tutte le 30
## postazioni, senza vetrate, e conta dove i percorsi attraversano il bordo
## del proprio reparto. Il picco indica il centro naturale della porta.

const NavGridScript = preload("res://scripts/office/nav_grid.gd")
const FurnitureDefsScript = preload("res://scripts/office/furniture_defs.gd")
const DepartmentDefsScript = preload("res://scripts/office/department_defs.gd")
const OutputShelfScript = preload("res://scripts/office/output_shelf.gd")

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	var nav = NavGridScript.new()
	var obstacles: Array = FurnitureDefsScript.obstacles()
	obstacles.append_array(DepartmentDefsScript.obstacles())
	var with_glass := OS.get_environment("JHT_WITH_GLASS") == "1"
	obstacles.append(OutputShelfScript.RECT)
	nav.build(FurnitureDefsScript.FLOOR, obstacles,
			DepartmentDefsScript.GLASS_WALLS if with_glass else [])
	if with_glass:
		_print_connectivity(nav)
		if OS.get_environment("JHT_DIRECTNESS") == "1":
			_print_directness(nav)
		quit()
		return
	var result := {}
	for dept_id in DepartmentDefsScript.DEPT_ORDER:
		var zone: Rect2 = DepartmentDefsScript.DEPARTMENTS[dept_id]["zone"]
		var counts := {}
		for desk in DepartmentDefsScript.DEPARTMENTS[dept_id]["desks"]:
			var current: Vector2 = DepartmentDefsScript.desk_spot(desk)
			for target in _work_cycle(dept_id, current):
				var route: PackedVector2Array = nav.path(current, target)
				_count_crossings(route, zone, counts)
				current = target
		var ranked: Array = []
		for key in counts:
			ranked.append({"door": key, "crossings": counts[key]})
		ranked.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
			return int(a["crossings"]) > int(b["crossings"]))
		result[dept_id] = ranked.slice(0, mini(5, ranked.size()))
	print("TRAFFIC-DOOR-AUDIT ", JSON.stringify(result))
	quit()

func _print_connectivity(nav) -> void:
	var hub := Vector2(1500, 750)
	var result := {}
	for dept_id in DepartmentDefsScript.DEPT_ORDER:
		var desk: Dictionary = DepartmentDefsScript.DEPARTMENTS[dept_id]["desks"][0]
		var spot: Vector2 = DepartmentDefsScript.desk_spot(desk)
		result[dept_id] = {
			"route_to_hub": nav.path(spot, hub).size(),
			"spot": str(spot),
		}
	print("DOOR-CONNECTIVITY-AUDIT ", JSON.stringify(result))

func _print_directness(nav) -> void:
	var routes: Array = []
	for dept_id in DepartmentDefsScript.DEPT_ORDER:
		var desk_i := 0
		for desk in DepartmentDefsScript.DEPARTMENTS[dept_id]["desks"]:
			var current: Vector2 = DepartmentDefsScript.desk_spot(desk)
			var leg_i := 0
			for target in _work_cycle(dept_id, current):
				var route: PackedVector2Array = nav.path(current, target)
				var length := _path_length(route, current)
				var direct := current.distance_to(target)
				routes.append({
					"route": "%s:%d/%d" % [dept_id, desk_i, leg_i],
					"ratio": snappedf(length / maxf(direct, 1.0), 0.01),
					"length": roundi(length),
					"direct": roundi(direct),
					"from": str(current),
					"to": str(target),
				})
				current = target
				leg_i += 1
			desk_i += 1
	routes.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		return float(a["ratio"]) > float(b["ratio"]))
	print("PATH-DIRECTNESS-AUDIT ", JSON.stringify(routes.slice(0, mini(12, routes.size()))))

func _path_length(route: PackedVector2Array, start: Vector2) -> float:
	var length := 0.0
	var previous := start
	for point in route:
		length += previous.distance_to(point)
		previous = point
	return length

func _work_cycle(dept_id: String, home: Vector2) -> Array:
	var drop: Vector2 = DepartmentDefsScript.handoff_spot(dept_id)
	if dept_id == "scout":
		return [DepartmentDefsScript.POIS["printer"]["spot"], home, drop, home]
	var src: String = DepartmentDefsScript.FETCH_FROM[dept_id]
	var pick: Vector2 = DepartmentDefsScript.handoff_spot(src, true)
	if dept_id == "critici":
		return [pick, home, OutputShelfScript.RECT.get_center() + Vector2(0, 46), home]
	return [pick, home, drop, home]

func _count_crossings(route: PackedVector2Array, zone: Rect2, counts: Dictionary) -> void:
	for i in range(1, route.size()):
		var a := route[i - 1]
		var b := route[i]
		if zone.has_point(a) == zone.has_point(b):
			continue
		var p := (a + b) * 0.5
		var distances := {
			"nord": absf(p.y - zone.position.y),
			"sud": absf(p.y - zone.end.y),
			"ovest": absf(p.x - zone.position.x),
			"est": absf(p.x - zone.end.x),
		}
		var edge := "nord"
		for candidate in distances:
			if float(distances[candidate]) < float(distances[edge]):
				edge = candidate
		var axis := p.x if edge in ["nord", "sud"] else p.y
		var snapped := int(round(axis / 32.0) * 32.0)
		var key := "%s@%d" % [edge, snapped]
		counts[key] = int(counts.get(key, 0)) + 1
