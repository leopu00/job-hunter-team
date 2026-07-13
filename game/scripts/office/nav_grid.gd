class_name NavGrid
extends RefCounted
## Pathfinding semplice su griglia AStar2D (celle 32px).
## Il pavimento meno i mobili (con margine) è camminabile; usato sia dal
## click-to-move del giocatore sia dal vagabondaggio degli agenti.

const CELL := 32.0
const MARGIN := 16.0  # quanto "crescono" gli ostacoli attorno ai mobili

var astar := AStar2D.new()
var _origin: Vector2
var _cols := 0
var _rows := 0
var _walkable := {}
var _floor_rect := Rect2()
var _grown_obstacles: Array[Rect2] = []

func build(floor_rect: Rect2, obstacle_rects: Array) -> void:
	astar.clear()
	_walkable.clear()
	_floor_rect = floor_rect
	_origin = floor_rect.position
	_cols = int(floor_rect.size.x / CELL)
	_rows = int(floor_rect.size.y / CELL)
	_grown_obstacles.clear()
	for r in obstacle_rects:
		_grown_obstacles.append((r as Rect2).grow(MARGIN))
	for y in _rows:
		for x in _cols:
			var p := _origin + Vector2((x + 0.5) * CELL, (y + 0.5) * CELL)
			var blocked := false
			for r in _grown_obstacles:
				if (r as Rect2).has_point(p):
					blocked = true
					break
			if not blocked:
				var id := _id(x, y)
				astar.add_point(id, p)
				_walkable[id] = true
	for y in _rows:
		for x in _cols:
			var id := _id(x, y)
			if not _walkable.has(id):
				continue
			# ortogonali
			for off: Vector2i in [Vector2i(1, 0), Vector2i(0, 1)]:
				var nid := _id(x + off.x, y + off.y)
				if _valid(x + off.x, y + off.y) and _walkable.has(nid):
					astar.connect_points(id, nid)
			# diagonali solo se entrambe le ortogonali sono libere
			for off: Vector2i in [Vector2i(1, 1), Vector2i(1, -1)]:
				var nx: int = x + off.x
				var ny: int = y + off.y
				if not _valid(nx, ny):
					continue
				var nid := _id(nx, ny)
				if _walkable.has(nid) and _walkable.has(_id(x + off.x, y)) \
						and _walkable.has(_id(x, y + off.y)):
					astar.connect_points(id, nid)

func path(from: Vector2, to: Vector2) -> PackedVector2Array:
	if astar.get_point_count() == 0:
		return PackedVector2Array()
	var a := astar.get_closest_point(from)
	var b := astar.get_closest_point(to)
	var pts := astar.get_point_path(a, b)
	if pts.size() > 0:
		pts[pts.size() - 1] = _clamp_to_walkable(to)
	return pts

## Punto camminabile casuale (per il vagabondaggio degli agenti).
func random_point() -> Vector2:
	var ids := _walkable.keys()
	if ids.is_empty():
		return _origin
	return astar.get_point_position(ids[randi() % ids.size()])

## True solo per punti realmente dentro il pavimento e fuori dal margine
## degli ostacoli. Non basta che la cella A* più vicina sia libera: le mete
## delle postazioni cadono spesso a pochi pixel dal mobile.
func is_point_walkable(p: Vector2) -> bool:
	if not _floor_rect.has_point(p):
		return false
	for obstacle in _grown_obstacles:
		if obstacle.has_point(p):
			return false
	return true

func _clamp_to_walkable(p: Vector2) -> Vector2:
	if is_point_walkable(p):
		return p
	var id := astar.get_closest_point(p)
	return astar.get_point_position(id)

func _valid(x: int, y: int) -> bool:
	return x >= 0 and y >= 0 and x < _cols and y < _rows

func _id(x: int, y: int) -> int:
	return y * _cols + x
