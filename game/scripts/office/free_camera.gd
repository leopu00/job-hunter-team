class_name FreeCamera
extends Camera2D
## La regia della box senza personaggio: pan con WASD/frecce, trascinando
## col mouse o con lo scroll a due dita del trackpad; zoom con la rotella,
## col pinch del trackpad (verso il cursore) o con i tasti +/- (verso il
## centro). Emette `clicked` per i click "puliti" (press+release quasi
## fermi), così l'ufficio distingue un click su agente/reparto da un pan.

signal clicked(world_pos: Vector2)

const PAN_SPEED := 1100.0
const ZOOM_STEP := 1.12
const ZOOM_MAX := 2.8  # zoom profondo: i dettagli minuti devono leggersi
# 14px: su trackpad un tap viaggia di qualche pixel e con 8 il click
# moriva come micro-drag (feedback test finale: click inaffidabili)
const DRAG_CLICK_TOLERANCE := 14.0

## Sotto questo zoom si vedrebbe il void oltre i vetri: calcolato in _ready
## perché dipende dal viewport (a min zoom la box riempie sempre la larghezza).
var _zoom_min := 0.5

var _dragging := false
var _drag_travel := 0.0

func _ready() -> void:
	var world := FurnitureDefs.WORLD
	limit_left = int(world.position.x)
	limit_top = int(world.position.y)
	limit_right = int(world.end.x)
	limit_bottom = int(world.end.y)
	position_smoothing_enabled = true
	position_smoothing_speed = 8.0
	var vp := get_viewport_rect().size
	_zoom_min = maxf(vp.x / world.size.x, vp.y / world.size.y)
	zoom = Vector2(_zoom_min, _zoom_min)
	position = world.get_center()
	make_current()
	# TEST-AUTO: JHT_ZOOM_TEST=<factor> spara un pinch sintetico al boot,
	# così lo screenshot dimostra che la magnify gesture zooma davvero.
	var zt := OS.get_environment("JHT_ZOOM_TEST")
	if zt != "":
		var g := InputEventMagnifyGesture.new()
		g.factor = float(zt)
		Input.parse_input_event.call_deferred(g)

func _process(delta: float) -> void:
	if Game.dialogue_active:
		return
	var dir := Input.get_vector("move_left", "move_right", "move_up", "move_down")
	if dir != Vector2.ZERO:
		position += dir * PAN_SPEED * delta / zoom.x
	_clamp_to_world()

func _unhandled_input(event: InputEvent) -> void:
	if Game.dialogue_active:
		return
	if event is InputEventMouseButton:
		match event.button_index:
			MOUSE_BUTTON_WHEEL_UP:
				if event.pressed:
					_zoom_at_mouse(ZOOM_STEP)
			MOUSE_BUTTON_WHEEL_DOWN:
				if event.pressed:
					_zoom_at_mouse(1.0 / ZOOM_STEP)
			MOUSE_BUTTON_LEFT:
				if event.pressed:
					_dragging = true
					_drag_travel = 0.0
				elif _dragging:
					_dragging = false
					if _drag_travel < DRAG_CLICK_TOLERANCE:
						clicked.emit(get_global_mouse_position())
	elif event is InputEventMouseMotion and _dragging:
		_drag_travel += event.relative.length()
		if _drag_travel >= DRAG_CLICK_TOLERANCE:
			position -= event.relative / zoom.x
			_clamp_to_world()
	# trackpad macOS: pinch = zoom, scroll a due dita = pan
	elif event is InputEventMagnifyGesture:
		_zoom_at(event.factor, get_global_mouse_position())
	elif event is InputEventPanGesture:
		position += event.delta * 18.0 / zoom.x
		_clamp_to_world()
	# fallback senza mouse né trackpad: +/- zoomano verso il centro vista
	elif event is InputEventKey and event.pressed:
		match event.keycode:
			KEY_PLUS, KEY_EQUAL, KEY_KP_ADD:
				_zoom_at(ZOOM_STEP, get_screen_center_position())
			KEY_MINUS, KEY_KP_SUBTRACT:
				_zoom_at(1.0 / ZOOM_STEP, get_screen_center_position())

## Zoom verso il cursore: il punto del mondo sotto il mouse resta sotto il mouse.
func _zoom_at_mouse(factor: float) -> void:
	_zoom_at(factor, get_global_mouse_position())

## Zoom verso un punto-àncora del mondo, che resta fermo sullo schermo.
func _zoom_at(factor: float, anchor: Vector2) -> void:
	var old_z := zoom.x
	var z := clampf(old_z * factor, _zoom_min, ZOOM_MAX)
	if is_equal_approx(z, old_z):
		return
	zoom = Vector2(z, z)
	position = anchor + (position - anchor) * (old_z / z)
	# il posizionamento sotto il mouse non deve "sbandare" con lo smoothing
	reset_smoothing()
	_clamp_to_world()

## Tiene il centro camera dentro il mondo al netto della mezza-vista corrente
## (i limit_* di Camera2D fanno fede a runtime; questo evita rimbalzi).
func _clamp_to_world() -> void:
	var world := FurnitureDefs.WORLD
	var half := get_viewport_rect().size / (2.0 * zoom.x)
	position.x = clampf(position.x, world.position.x + half.x, maxf(world.position.x + half.x, world.end.x - half.x))
	position.y = clampf(position.y, world.position.y + half.y, maxf(world.position.y + half.y, world.end.y - half.y))
