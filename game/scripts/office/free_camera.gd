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
var _press_world_position := Vector2.ZERO

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
	# La box include molto vuoto decorativo a nord; centrarla tagliava le
	# postazioni meridionali nel primo frame normale. Il pavimento e' invece
	# il perimetro operativo: il suo centro conserva tutto il roster visibile.
	position = FurnitureDefs.FLOOR.get_center()
	make_current()
	# TEST-AUTO: JHT_ZOOM_TEST=<factor> spara un pinch sintetico al boot,
	# così lo screenshot dimostra che la magnify gesture zooma davvero.
	var zt := OS.get_environment("JHT_ZOOM_TEST")
	if zt != "":
		var g := InputEventMagnifyGesture.new()
		g.factor = float(zt)
		Input.parse_input_event.call_deferred(g)

func _process(delta: float) -> void:
	if _input_blocked():
		_dragging = false
		return
	var dir := Input.get_vector("move_left", "move_right", "move_up", "move_down")
	if dir != Vector2.ZERO:
		_stop_focus()  # un gesto dell'utente vince sempre sulla regia guidata
		position += dir * PAN_SPEED * delta / zoom.x
	elif _follow_target != null:
		if is_instance_valid(_follow_target):
			position = _follow_target.global_position + Vector2(0, -40)
		else:
			_follow_target = null
	_clamp_to_world()

## Regia guidata (tour): glissa verso un punto del mondo con uno zoom di
## contesto. Qualunque input di pan/zoom dell'utente interrompe la corsa.
var _focus_tween: Tween
## Inseguimento morbido di un nodo (l'Assistente che accompagna): la
## position segue il bersaglio, lo smoothing della camera fa il resto.
var _follow_target: Node2D

func follow(target: Node2D, target_zoom := 1.0) -> void:
	_stop_focus()
	_follow_target = target
	var z := clampf(target_zoom, _zoom_min, ZOOM_MAX)
	if not is_equal_approx(z, zoom.x):
		var tw := create_tween()
		tw.tween_property(self, "zoom", Vector2(z, z), 0.7) \
				.set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)

func stop_follow() -> void:
	_follow_target = null

func focus_on(world_pos: Vector2, target_zoom := 1.0) -> void:
	_stop_focus()
	var z := clampf(target_zoom, _zoom_min, ZOOM_MAX)
	# la destinazione va bloccata sui limiti del mondo allo zoom d'arrivo,
	# altrimenti il tween termina fuori e _clamp la fa scattare indietro
	var vp := get_viewport_rect().size / z
	var world := FurnitureDefs.WORLD
	var target := Vector2(
			clampf(world_pos.x, world.position.x + vp.x / 2.0, world.end.x - vp.x / 2.0),
			clampf(world_pos.y, world.position.y + vp.y / 2.0, world.end.y - vp.y / 2.0))
	_focus_tween = create_tween()
	_focus_tween.set_ease(Tween.EASE_IN_OUT).set_trans(Tween.TRANS_SINE)
	_focus_tween.set_parallel()
	_focus_tween.tween_property(self, "position", target, 0.9)
	_focus_tween.tween_property(self, "zoom", Vector2(z, z), 0.9)

func _stop_focus() -> void:
	if _focus_tween:
		_focus_tween.kill()
		_focus_tween = null
	_follow_target = null

func _unhandled_input(event: InputEvent) -> void:
	if _input_blocked():
		_dragging = false
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
					# Campiona PRIMA di fermare la regia: il tween/smoothing può
					# cambiare la trasformata canvas già fra press e release.
					_press_world_position = _event_world_position(event)
					_stop_focus()
					_dragging = true
					_drag_travel = 0.0
				elif _dragging:
					_dragging = false
					if _drag_travel < DRAG_CLICK_TOLERANCE:
						clicked.emit(_press_world_position)
	elif event is InputEventMouseMotion and _dragging:
		_drag_travel += event.relative.length()
		if _drag_travel >= DRAG_CLICK_TOLERANCE:
			position -= event.relative / zoom.x
			_clamp_to_world()
	# trackpad macOS: pinch = zoom, scroll a due dita = pan
	elif event is InputEventMagnifyGesture:
		_zoom_at(event.factor, get_global_mouse_position())
	elif event is InputEventPanGesture:
		_stop_focus()
		position += event.delta * 18.0 / zoom.x
		_clamp_to_world()
	# fallback senza mouse né trackpad: +/- zoomano verso il centro vista
	elif event is InputEventKey and event.pressed:
		match event.keycode:
			KEY_PLUS, KEY_EQUAL, KEY_KP_ADD:
				_zoom_at(ZOOM_STEP, get_screen_center_position())
			KEY_MINUS, KEY_KP_SUBTRACT:
				_zoom_at(1.0 / ZOOM_STEP, get_screen_center_position())

## Converte subito la posizione consegnata insieme all'evento, cioè lo stesso
## pixel che l'utente ha premuto. Rileggerla al rilascio usa la trasformata
## corrente della Camera2D: durante la regia tweenata/smussata può non essere
## più quella con cui il personaggio è stato disegnato e il click visibile
## sull'Assistente finisce nel reparto Scorer retrostante.
func _event_world_position(event: InputEventMouse) -> Vector2:
	var world := get_viewport().get_canvas_transform().affine_inverse() * event.position
	if OS.get_environment("JHT_INPUT_DIAGNOSTIC") == "1":
		Log.info("input", "click screen=%v world=%v cursor_world=%v camera=%v shown=%v zoom=%v" % [
				event.position, world, get_global_mouse_position(), position,
				get_screen_center_position(), zoom])
	return world

## Le gesture del trackpad possono arrivare a _unhandled_input anche se il
## puntatore è sopra un Control. Gli overlay si registrano nel gruppo per
## congelare pan, drag, zoom e WASD per tutta la loro durata.
func _input_blocked() -> bool:
	return Game.dialogue_active or get_tree().has_group(&"camera_blocking_overlay")

## Zoom verso il cursore: il punto del mondo sotto il mouse resta sotto il mouse.
func _zoom_at_mouse(factor: float) -> void:
	_zoom_at(factor, get_global_mouse_position())

## Zoom verso un punto-àncora del mondo, che resta fermo sullo schermo.
func _zoom_at(factor: float, anchor: Vector2) -> void:
	_stop_focus()
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
