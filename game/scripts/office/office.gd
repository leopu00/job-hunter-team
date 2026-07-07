extends Node2D
## La box: costruisce pavimento, mobili, collisioni, navigazione, giocatore
## e camera. Il layout vive in FurnitureDefs; qui solo assemblaggio.

var nav := NavGrid.new()
var player: Player
var world: Node2D

func _ready() -> void:
	add_child(OfficeFloor.new())

	world = Node2D.new()
	world.name = "World"
	world.y_sort_enabled = true
	add_child(world)

	for item in FurnitureDefs.ITEMS:
		if item["kind"] == "hologram":
			world.add_child(Hologram.new(item["rect"]))
			# l'ologramma blocca comunque il passaggio (pedana)
			world.add_child(_invisible_wall(item["rect"]))
		else:
			world.add_child(FurnitureNode.new(item))

	# vetri del lab + perimetro: corpi invisibili
	for r in [FurnitureDefs.LAB_WALL_V, FurnitureDefs.LAB_WALL_H1, FurnitureDefs.LAB_WALL_H2]:
		world.add_child(_invisible_wall(r))
	_add_perimeter_walls()

	nav.build(FurnitureDefs.FLOOR, FurnitureDefs.obstacles())

	player = Player.new()
	player.nav = nav
	player.position = Vector2(820, 1240)  # entrata, in basso a sinistra
	world.add_child(player)

	var cam := Camera2D.new()
	cam.limit_left = 0
	cam.limit_top = 0
	cam.limit_right = int(FurnitureDefs.WORLD.size.x)
	cam.limit_bottom = int(FurnitureDefs.WORLD.size.y)
	cam.position_smoothing_enabled = true
	cam.position_smoothing_speed = 6.0
	player.add_child(cam)
	cam.make_current()

	_add_hint()

func _unhandled_input(event: InputEvent) -> void:
	if Game.dialogue_active:
		return
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT \
			and event.pressed:
		var target := get_global_mouse_position()
		if FurnitureDefs.FLOOR.has_point(target):
			player.set_click_target(target)
			var marker := ClickMarker.new()
			marker.position = target
			add_child(marker)

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
		Rect2(f.position.x - t, f.position.y - t, f.size.x + t * 2, t),  # alto
		Rect2(f.position.x - t, f.end.y, f.size.x + t * 2, t),           # basso
		Rect2(f.position.x - t, f.position.y, t, f.size.y),              # sinistra
		Rect2(f.end.x, f.position.y, t, f.size.y),                       # destra
	]
	for r in rects:
		add_child(_invisible_wall(r))

func _add_hint() -> void:
	var hud := CanvasLayer.new()
	hud.layer = 10
	add_child(hud)
	var hint := TerminalTheme.label(
			"WASD / frecce per muoverti · click per andare · ESC menu",
			15, Palette.DIM)
	hint.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	hint.position = Vector2(-hint.size.x / 2.0, -36)
	hint.grow_horizontal = Control.GROW_DIRECTION_BOTH
	hint.grow_vertical = Control.GROW_DIRECTION_BEGIN
	hud.add_child(hint)
