extends SceneTree
## Self-test headless del contratto collisioni/pathfinding.
## Esecuzione: godot --headless --path game --script res://tools/nav_grid_selftest.gd

const NavGridScript = preload("res://scripts/office/nav_grid.gd")
const DepartmentDefsScript = preload("res://scripts/office/department_defs.gd")
const FurnitureDefsScript = preload("res://scripts/office/furniture_defs.gd")

var _failures: Array[String] = []

func _init() -> void:
	_test_blocked_destination_is_clamped()
	_test_writer_radial_layout()
	_test_real_desk_routes()
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
	obstacles.append_array(DepartmentDefsScript.GLASS_WALLS)
	nav.build(FurnitureDefsScript.FLOOR, obstacles)
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

func _test_writer_radial_layout() -> void:
	var desks: Array = DepartmentDefsScript.DEPARTMENTS["scrittori"]["desks"]
	_assert(desks.size() == 6, "writers must have exactly six radial desks")
	if desks.size() != 6:
		return
	var center := Vector2(690, 1725)
	var expected_facing := ["left", "left", "up", "down", "right", "right"]
	var facing_vector := {
		"up": Vector2.UP, "right": Vector2.RIGHT,
		"down": Vector2.DOWN, "left": Vector2.LEFT,
	}
	for i in desks.size():
		var desk: Dictionary = desks[i]
		var facing: String = desk.get("facing", "")
		_assert(facing == expected_facing[i],
				"writer:%d facing=%s, expected=%s" % [i, facing, expected_facing[i]])
		var radial: Vector2 = (desk["rect"] as Rect2).get_center() - center
		_assert(radial.dot(facing_vector.get(facing, Vector2.ZERO)) > 80.0,
				"writer:%d does not face outward (radial=%s facing=%s)" % [i, radial, facing])

func _assert(condition: bool, message: String) -> void:
	if not condition:
		_failures.append(message)
