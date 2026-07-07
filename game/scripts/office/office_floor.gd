class_name OfficeFloor
extends Node2D
## Pavimento, esterno buio e pareti di vetro con glow (come the-box.png).
## Disegnato sotto al layer Y-sort di mobili e personaggi.

const GLASS_CORE := Color("#bfe3ff", 0.9)

func _draw() -> void:
	var world := FurnitureDefs.WORLD
	var floor_rect := FurnitureDefs.FLOOR

	# Esterno della box: void profondo
	draw_rect(world, Palette.VOID)

	# Pavimento
	draw_rect(floor_rect, Palette.PANEL)

	# Griglia sottile del pavimento (piastrelle)
	var step := 64.0
	var x := floor_rect.position.x + step
	while x < floor_rect.end.x:
		draw_line(Vector2(x, floor_rect.position.y), Vector2(x, floor_rect.end.y),
				Color(1, 1, 1, 0.022), 1.0)
		x += step
	var y := floor_rect.position.y + step
	while y < floor_rect.end.y:
		draw_line(Vector2(floor_rect.position.x, y), Vector2(floor_rect.end.x, y),
				Color(1, 1, 1, 0.022), 1.0)
		y += step

	# Alone morbido attorno all'ologramma (luce verde sul pavimento)
	var holo_c := FurnitureDefs.get_rect("hologram").get_center()
	for i in 5:
		var r := 90.0 + i * 34.0
		draw_circle(holo_c, r, Color(Palette.GREEN.r, Palette.GREEN.g, Palette.GREEN.b, 0.016))

	# Pareti di vetro perimetrali: tre passate per il glow ciano
	_glass_rect(floor_rect, 1.0)

	# Vetri interni del lab (più discreti), con porta nella parete bassa
	_glass_line(FurnitureDefs.LAB_WALL_V.get_center() - Vector2(0, FurnitureDefs.LAB_WALL_V.size.y / 2),
			FurnitureDefs.LAB_WALL_V.get_center() + Vector2(0, FurnitureDefs.LAB_WALL_V.size.y / 2), 0.55)
	_glass_line(Vector2(FurnitureDefs.LAB_WALL_H1.position.x, FurnitureDefs.LAB_WALL_H1.get_center().y),
			Vector2(FurnitureDefs.LAB_WALL_H1.end.x, FurnitureDefs.LAB_WALL_H1.get_center().y), 0.55)
	_glass_line(Vector2(FurnitureDefs.LAB_WALL_H2.position.x, FurnitureDefs.LAB_WALL_H2.get_center().y),
			Vector2(FurnitureDefs.LAB_WALL_H2.end.x, FurnitureDefs.LAB_WALL_H2.get_center().y), 0.55)

func _glass_rect(r: Rect2, intensity: float) -> void:
	var pts := [
		r.position, Vector2(r.end.x, r.position.y), r.end,
		Vector2(r.position.x, r.end.y), r.position,
	]
	for i in 4:
		_glass_line(pts[i], pts[i + 1], intensity)

func _glass_line(a: Vector2, b: Vector2, intensity: float) -> void:
	draw_line(a, b, Color(Palette.BLUE.r, Palette.BLUE.g, Palette.BLUE.b, 0.10 * intensity), 14.0)
	draw_line(a, b, Color(Palette.BLUE.r, Palette.BLUE.g, Palette.BLUE.b, 0.30 * intensity), 5.0)
	draw_line(a, b, Color(GLASS_CORE.r, GLASS_CORE.g, GLASS_CORE.b, GLASS_CORE.a * intensity), 1.6)
