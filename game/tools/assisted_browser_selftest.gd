extends SceneTree
const BrowserView = preload("res://scripts/ui/assisted_browser_panel.gd")
var requests: Array = []
var failures: Array = []
var panel
var passed := 0
func check(condition: bool, name: String) -> void:
	if condition:
		passed += 1
	else:
		failures.append(name)
	print("UI-CHECK ", name, " ", "PASS" if condition else "FAIL")
func reply(value: Dictionary) -> void:
	panel.accept_result(panel._pending, value)
func _initialize() -> void:
	panel = BrowserView.new()
	root.add_child(panel)
	await process_frame
	panel._timer.stop()
	panel.request.connect(func(body, token): requests.append({"body": body.duplicate(true), "token": token}))
	panel.refresh()
	check(requests[-1].body == {"op": "descriptor"}, "descriptor only")
	var identity := {"ok": true, "mission_id": "a".repeat(32), "owner_id": "b".repeat(32), "position_id": 41, "generation": 1, "display_id": "c".repeat(32), "review_id": "d".repeat(32), "phase": "review_wait", "input_ready": false, "allowed_actions": ["frame", "snapshot", "confirm", "handoff", "finish", "abandon", "delete_snapshot"]}
	var descriptor := identity.duplicate(true)
	descriptor.block = {"event_id": "e".repeat(32), "reason": "synthetic challenge", "action": "Inspect the retained browser", "screenshot_available": true}
	reply(descriptor)
	check(requests[-1].body.op == "snapshot" and requests[-1].body.event_id == "e".repeat(32), "private block snapshot binding")
	var image := Image.create(640, 400, false, Image.FORMAT_RGB8)
	image.fill(Color(0.05, 0.2, 0.1))
	var png := Marshalls.raw_to_base64(image.save_png_to_buffer())
	var snapshot := identity.duplicate(true)
	snapshot.event_id = "e".repeat(32)
	snapshot.png_base64 = png
	reply(snapshot)
	check(panel._image.texture != null and panel._reason.text.contains("synthetic challenge") and panel._action.text.contains("retained"), "block pixels reason action distinct")
	panel._next_frame = true
	panel._poll()
	var frame := identity.duplicate(true)
	frame.merge({"frame_sequence": 1, "width": 640, "height": 400, "png_base64": png})
	reply(frame)
	check(panel._desktop.texture != null and panel._frame_sequence == 1, "real frame contract native texture")
	panel._desktop.size = Vector2(800, 600)
	var event := InputEventMouseButton.new()
	event.position = Vector2(400, 300)
	event.button_index = MOUSE_BUTTON_LEFT
	event.pressed = true
	var before := requests.size()
	panel._desktop_input(event)
	check(requests.size() == before, "input denied during automation")
	panel.refresh()
	identity.phase = "handoff"
	identity.input_ready = true
	identity.allowed_actions = ["frame", "snapshot", "observe", "input", "finish", "abandon"]
	reply(identity)
	panel._desktop.size = Vector2(800, 600)
	panel._desktop_input(event)
	var input: Dictionary = requests[-1].body
	check(input.op == "input" and input.x == 320 and input.y == 200 and input.frame_sequence == 1 and input.display_id == "c".repeat(32), "letterbox coordinates bound official input")
	reply({"ok": true, "queued": true})
	panel._frame_at -= 2500
	before = requests.size()
	panel._desktop_input(event)
	check(requests.size() == before, "stale frame disables input")
	panel.refresh()
	reply({"ok": false, "error": "synthetic_transport_lost"})
	check(panel._desktop.texture == null and panel._mission.is_empty() and panel._buttons.handoff.disabled and panel._state.text.contains("unknown"), "disconnect unknown wipes controls and frames")
	panel.accept_result(1, frame)
	check(panel._desktop.texture == null, "late response cannot restore old display")
	panel.refresh()
	reply(identity)
	panel._press("observe")
	check(requests[-1].body.op == "observe" and requests[-1].body.owner_id == "b".repeat(32), "resume is official observe with binding")
	reply({"ok": true, "queued": true})
	check(panel._notice.text.contains("queued") and not panel._notice.text.contains("succeeded"), "queued is not application outcome")
	panel.reset_session()
	check(panel._desktop.texture == null and panel._image.texture == null and not panel._human_ready(), "backend switch destroys retained pixels")
	panel.refresh()
	var no_capability := identity.duplicate(true)
	no_capability.phase = "review_wait"
	no_capability.allowed_actions = []
	reply(no_capability)
	check(panel._buttons.confirm.disabled and panel._buttons.handoff.disabled and not panel._human_ready(), "phase alone never grants an action")
	panel.refresh()
	no_capability.phase = "blocked"
	no_capability.allowed_actions = ["handoff", "finish"]
	reply(no_capability)
	check(panel._buttons.confirm.disabled and not panel._buttons.handoff.disabled and panel._desktop.texture == null, "non-review block can handoff without fake confirm or frame")
	panel._descriptor_at -= 2500
	panel._update_buttons()
	check(panel._buttons.handoff.disabled, "stale descriptor disables official controls")
	check(BrowserView._decode_png("not-a-png") == null, "invalid image rejected")
	panel.queue_free()
	await process_frame
	print("ASSISTED-UI-TEST ", passed, " PASS / ", failures.size(), " FAIL")
	quit(0 if failures.is_empty() else 1)
