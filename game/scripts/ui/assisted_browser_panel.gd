class_name AssistedBrowserPanel
extends VBoxContainer
## Native Godot view. Session secrets and screenshot bytes stay in memory.
## Closing this view does not send finish/abandon or grant human control.
signal request(body: Dictionary, token: int)

const MAX_PNG := 8388608
const TERMINAL := ["completed", "closed", "unknown", "absent"]
var _mission: Dictionary = {}
var _pending := 0
var _sequence := 0
var _operation := ""
var _event := ""
var _timer: Timer
var _state: Label
var _reason: Label
var _action: Label
var _notice: Label
var _image: TextureRect
var _buttons: Dictionary = {}
var _descriptor_at := 0
var _frame_sequence := 0
var _frame_size := Vector2.ZERO
var _frame_at := 0
var _next_frame := false
var _desktop: TextureRect
var _input_queue: Array[Dictionary] = []
var _held_keys: Dictionary = {}
var _stream_notice: Label

func _ready() -> void:
	size_flags_vertical = Control.SIZE_EXPAND_FILL
	add_theme_constant_override("separation", 10)
	_state = _label("Connecting to your team's browser…", 22)
	_reason = _label("", 17)
	_action = _label("", 16)
	_stream_notice = _label("Desktop frames • disconnected", 14)
	_desktop = TextureRect.new()
	_desktop.custom_minimum_size = Vector2(320, 240)
	_desktop.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_desktop.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_desktop.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	_desktop.focus_mode = Control.FOCUS_ALL
	_desktop.gui_input.connect(_desktop_input)
	add_child(_desktop)
	_image = TextureRect.new()
	_image.custom_minimum_size = Vector2(180, 100)
	_image.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_image.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_image.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	_image.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_image)
	var row := HFlowContainer.new()
	add_child(row)
	for entry in [["refresh", "Refresh"], ["confirm", "Confirm application"],
			["handoff", "Take human control"], ["observe", "Observe result"],
			["finish", "Finish"], ["abandon", "Abandon"],
			["delete_snapshot", "Delete private image"]]:
		var operation: String = entry[0]
		var button := Button.new()
		button.text = entry[1]
		button.disabled = operation != "refresh"
		button.pressed.connect(_press.bind(operation))
		row.add_child(button)
		_buttons[operation] = button
	move_child(row, 3)
	_notice = _label("Private images expire after 24 hours • up to 8 events • delete anytime.\nExpired files are purged opportunistically.\nHuman control requires an official handoff; chat is not a confirmation.", 14)
	_timer = Timer.new()
	_timer.wait_time = 0.5
	_timer.timeout.connect(_poll)
	add_child(_timer)
	_timer.start()

func _label(value: String, font_size: int) -> Label:
	var label := Label.new()
	label.text = value
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.add_theme_font_size_override("font_size", font_size)
	add_child(label)
	return label

func reset_session() -> void:
	_pending = 0
	_mission.clear()
	_descriptor_at = 0
	_clear_desktop()
	_event = ""
	_image.texture = null
	_state.text = "Disconnected — reconnect to your team"
	_reason.text = ""
	_action.text = ""
	_update_buttons()

func refresh() -> void:
	if _pending == 0:
		_send({"op": "descriptor"})

func _bound(operation: String) -> Dictionary:
	var body := {"op": operation}
	for key in ["mission_id", "position_id", "owner_id", "generation"]:
		if _mission.has(key):
			body[key] = _mission[key]
	if operation in ["confirm", "handoff"]:
		body["review_id"] = _mission.get("review_id")
	elif operation in ["frame", "input"]:
		body["display_id"] = _mission.get("display_id")
	return body

func _press(operation: String) -> void:
	if _pending != 0:
		return
	_input_queue.clear()
	if operation == "refresh":
		refresh()
		return
	if not _buttons.has(operation) or _buttons[operation].disabled or Time.get_ticks_msec() - _descriptor_at >= 2000:
		return
	var body := _bound(operation)
	if operation == "delete_snapshot":
		body["event_id"] = _event
	_send(body)

func _send(body: Dictionary) -> void:
	_sequence += 1
	_pending = int(get_instance_id()) * 100000 + _sequence
	_operation = str(body["op"])
	_update_buttons()
	request.emit(body, _pending)

static func _identity(value: Dictionary) -> Array:
	return [value.get("mission_id"), value.get("position_id"),
		value.get("owner_id"), value.get("generation")]

func accept_result(token: int, response: Dictionary) -> void:
	if token != _pending or _pending == 0:
		return
	_pending = 0
	if not bool(response.get("ok", false)):
		_notice.text = "Operation unavailable: " + str(response.get("error", "unknown")).left(160)
		# A lost response never proves that an operation failed or succeeded.
		_mission.clear()
		_clear_desktop()
		_image.texture = null
		_state.text = "State unknown — refresh before another operation"
		_update_buttons()
		return
	if _operation == "descriptor":
		_apply_descriptor(response)
	elif _operation == "frame":
		if _identity(response) == _identity(_mission) and response.get("display_id") == _mission.get("display_id"):
			var sequence := int(response.get("frame_sequence", 0))
			var image := _decode_png(str(response.get("png_base64", "")))
			if image and sequence > _frame_sequence and image.get_width() == int(response.get("width", 0)) and image.get_height() == int(response.get("height", 0)):
				_desktop.texture = ImageTexture.create_from_image(image)
				_frame_size = image.get_size()
				_frame_sequence = sequence
				_frame_at = Time.get_ticks_msec()
				if response.get("allowed_actions") is Array:
					_mission["allowed_actions"] = response["allowed_actions"].duplicate()
				if _mission.get("phase") == "handoff":
					_state.text = "Human control permitted — automation paused" if _human_ready() else "Handoff — input unavailable"
				_stream_notice.text = "Desktop frames • connected • input " + ("enabled" if _human_ready() else "disabled")
	elif _operation == "snapshot":
		if _identity(response) == _identity(_mission) and str(response.get("event_id", "")) == _event:
			var image := _decode_png(str(response.get("png_base64", "")))
			if image:
				_image.texture = ImageTexture.create_from_image(image)
	elif _operation == "delete_snapshot":
		_image.texture = null
		_event = ""
		_notice.text = "Private image deleted."
	elif _operation != "input":
		_notice.text = "Official request queued — waiting for the owner's observed state."
	_update_buttons()
	if not _input_queue.is_empty():
		_poll.call_deferred()

static func _valid_identifier(value: Variant) -> bool:
	if not value is String or value.length() != 32:
		return false
	for character in value:
		if not character in "0123456789abcdef":
			return false
	return true

func _apply_descriptor(value: Dictionary) -> void:
	if value.get("phase") == "admitted" and value.get("owner_id") == null:
		reset_session()
		_state.text = "Waiting for Closer to own the interactive browser"
		return
	if value.get("phase", "absent") != "absent" and (not _valid_identifier(value.get("mission_id")) or not _valid_identifier(value.get("owner_id")) or value.get("generation") != 1 or not value.get("position_id") is int or int(value.get("position_id", 0)) <= 0):
		reset_session()
		_notice.text = "Invalid session binding — input disabled"
		return
	if _identity(value) != _identity(_mission) or value.get("display_id") != _mission.get("display_id"):
		_image.texture = null
		_clear_desktop()
		_event = ""
	_mission = value.duplicate(true)
	_descriptor_at = Time.get_ticks_msec()
	if value.has("stream_available") and not bool(value.get("stream_available")):
		_stream_notice.text = "Desktop unavailable — no live owner display"
		_notice.text = "No retained desktop is available. Refresh to observe the next state."
	var phase := str(value.get("phase", "absent"))
	var labels := {"review_wait": "Review — waiting for your official decision",
		"handoff": "Human control permitted — automation paused" if _human_ready() else "Handoff — input unavailable", "running": "Viewing — automation active",
		"unknown": "Outcome unknown — no second submission", "completed": "Application outcome recorded",
		"closed": "Session closed", "absent": "No interactive application session"}
	_state.text = str(labels.get(phase, "Viewing — " + phase))
	if phase != "handoff" or not bool(value.get("input_ready", false)):
		_input_queue.clear()
		_held_keys.clear()
	var block: Dictionary = value.get("block", {})
	_reason.text = "Reason: " + str(block.get("reason", "—")).left(300)
	_action.text = "Next action: " + str(block.get("action", "—")).left(500)
	if not _allowed("frame"):
		_clear_desktop()
	var event_id := str(block.get("event_id", ""))
	var snapshot_available := _allowed("snapshot") and bool(block.get("screenshot_available", false)) and event_id != ""
	if not snapshot_available or event_id != _event:
		_image.texture = null
		_event = ""
	if snapshot_available and event_id != _event:
		_event = event_id
		var body := _bound("snapshot")
		body["event_id"] = event_id
		_send(body)

static func _decode_png(encoded: String) -> Image:
	if encoded.length() % 4 != 0 or encoded.length() > MAX_PNG * 4 / 3 + 8:
		return null
	var data := Marshalls.base64_to_raw(encoded)
	if data.size() < 24 or data.size() > MAX_PNG or data.slice(0, 8) != PackedByteArray([137,80,78,71,13,10,26,10]):
		return null
	# Inspect dimensions before allocating a decoded image.
	var width := 0
	var height := 0
	for offset in range(4):
		width = (width << 8) | data[16 + offset]
		height = (height << 8) | data[20 + offset]
	if width < 1 or height < 1 or width > 4096 or height > 4096:
		return null
	var image := Image.new()
	if image.load_png_from_buffer(data) == OK:
		return image
	return null

func _allowed(operation: String) -> bool:
	var allowed: Variant = _mission.get("allowed_actions")
	return allowed is Array and allowed.has(operation)

func _update_buttons() -> void:
	for operation in _buttons:
		var allowed: bool = operation == "refresh" or (_allowed(operation) and Time.get_ticks_msec() - _descriptor_at < 2000)
		if operation == "delete_snapshot":
			allowed = allowed and _event != ""
		_buttons[operation].disabled = _pending != 0 or not allowed


func _clear_desktop() -> void:
	if _desktop:
		_desktop.texture = null
	_frame_sequence = 0
	_frame_size = Vector2.ZERO
	_frame_at = 0
	_input_queue.clear()
	_held_keys.clear()
	if _stream_notice:
		_stream_notice.text = "Desktop frames • disconnected • input disabled"

func _human_ready() -> bool:
	return _allowed("input") and Time.get_ticks_msec() - _descriptor_at < 2000 and _mission.get("phase") == "handoff" and bool(_mission.get("input_ready", false)) 		and _frame_sequence > 0 and Time.get_ticks_msec() - _frame_at < 1800

func _poll() -> void:
	if _frame_at > 0 and Time.get_ticks_msec() - _frame_at >= 1800:
		_stream_notice.text = "Desktop frames • stale • input disabled"
	if _pending != 0:
		return
	if Time.get_ticks_msec() - _descriptor_at >= 1500:
		refresh()
		return
	if not _input_queue.is_empty():
		if _human_ready():
			var body: Dictionary = _input_queue.pop_front()
			if _identity(body) != _identity(_mission) or body.get("display_id") != _mission.get("display_id") or body.get("frame_sequence") != _frame_sequence:
				# Never replay an event against pixels it was not created on.
				_input_queue.clear()
				_held_keys.clear()
				_next_frame = true
			else:
				_send(body)
				return
		if _mission.get("phase") != "handoff" or not bool(_mission.get("input_ready", false)):
			_input_queue.clear()
	if (_next_frame or not _input_queue.is_empty()) and not str(_mission.get("display_id", "")).is_empty() and _allowed("frame"):
		_next_frame = false
		var body := _bound("frame")
		body["frame_sequence"] = _frame_sequence
		_send(body)
	else:
		_next_frame = true
		refresh()

func _desktop_input(event: InputEvent) -> void:
	if not _human_ready():
		return
	if event is InputEventMouseButton:
		var factor := minf(_desktop.size.x / _frame_size.x, _desktop.size.y / _frame_size.y)
		var point: Vector2 = (event.position - (_desktop.size - _frame_size * factor) / 2.0) / factor
		if point.x < 0 or point.y < 0 or point.x >= _frame_size.x or point.y >= _frame_size.y:
			return
		var button_map := {MOUSE_BUTTON_LEFT: 1, MOUSE_BUTTON_MIDDLE: 2,
			MOUSE_BUTTON_RIGHT: 3, MOUSE_BUTTON_WHEEL_UP: 4, MOUSE_BUTTON_WHEEL_DOWN: 5}
		if not button_map.has(event.button_index):
			return
		var body := {"kind": "pointer", "x": int(point.x), "y": int(point.y),
			"button": button_map[event.button_index], "pressed": event.pressed}
		_enqueue_input(body)
		if event.button_index in [MOUSE_BUTTON_WHEEL_UP, MOUSE_BUTTON_WHEEL_DOWN] and event.pressed:
			body = body.duplicate()
			body["pressed"] = false
			_enqueue_input(body)
		_desktop.grab_focus()
		_desktop.accept_event()
	elif event is InputEventKey and not event.echo:
		var names := {KEY_ENTER: "Return", KEY_KP_ENTER: "Return", KEY_TAB: "Tab",
			KEY_BACKSPACE: "BackSpace", KEY_DELETE: "Delete", KEY_ESCAPE: "Escape",
			KEY_HOME: "Home", KEY_END: "End", KEY_PAGEUP: "Page_Up", KEY_PAGEDOWN: "Page_Down",
			KEY_LEFT: "Left", KEY_RIGHT: "Right", KEY_UP: "Up", KEY_DOWN: "Down",
			KEY_SHIFT: "Shift_L", KEY_CTRL: "Control_L", KEY_ALT: "Alt_L"}
		var key := str(names.get(event.keycode, ""))
		if event.pressed and key.is_empty() and event.unicode >= 32:
			key = String.chr(event.unicode)
		elif not event.pressed:
			key = str(_held_keys.get(event.physical_keycode, key))
		if key.is_empty():
			return
		if event.pressed:
			_held_keys[event.physical_keycode] = key
		else:
			_held_keys.erase(event.physical_keycode)
		_enqueue_input({"kind": "key", "key": key, "pressed": event.pressed})
		_desktop.accept_event()

func _enqueue_input(body: Dictionary) -> void:
	if _input_queue.size() < 64:
		var observed := _bound("input")
		observed.merge(body)
		observed["frame_sequence"] = _frame_sequence
		_input_queue.append(observed)
		if _pending == 0:
			_poll()
