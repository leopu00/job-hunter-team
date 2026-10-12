extends SceneTree
const BrowserView = preload("res://scripts/ui/assisted_browser_panel.gd")
var panel
var sent: Array = []
var failed := 0
var passed := 0

func check(condition: bool, label: String) -> void:
	if condition:
		passed += 1
	else:
		failed += 1
	print("UI-REVIEW ", label, " ", "PASS" if condition else "FAIL")

func reply(value: Dictionary) -> void:
	panel.accept_result(panel._pending, value)

func _initialize() -> void:
	panel = BrowserView.new()
	root.add_child(panel)
	await process_frame
	panel._timer.stop()
	panel.request.connect(func(body, _token): sent.append(body.duplicate(true)))
	check(panel._notice.text.contains("expire after 24 hours") and panel._notice.text.contains("opportunistically"), "retention states access expiry and opportunistic purge")
	var binding := {"ok": true, "mission_id": "a".repeat(32), "position_id": 41,
		"owner_id": "b".repeat(32), "generation": 1, "display_id": "c".repeat(32),
		"phase": "handoff", "input_ready": true, "allowed_actions": ["frame", "input", "snapshot", "delete_snapshot"]}
	var image := Image.create(20, 10, false, Image.FORMAT_RGB8)
	image.fill(Color(0.1, 0.3, 0.4))
	var png := Marshalls.raw_to_base64(image.save_png_to_buffer())
	var descriptor := binding.duplicate(true)
	descriptor.block = {"event_id": "e".repeat(32), "screenshot_available": true}
	panel.refresh()
	reply(descriptor)
	var snapshot := binding.duplicate(true)
	snapshot.merge({"event_id": "e".repeat(32), "png_base64": png})
	reply(snapshot)
	panel._next_frame = true
	panel._poll()
	var frame := binding.duplicate(true)
	frame.merge({"frame_sequence": 1, "width": 20, "height": 10, "png_base64": png})
	reply(frame)
	var desktop_before = panel._desktop.texture
	panel.refresh()
	descriptor.block.screenshot_available = false
	reply(descriptor)
	check(panel._image.texture == null and panel._event == "" and panel._desktop.texture == desktop_before, "same-event snapshot revoked while display remains available")
	# Capture frame N+1 while an event is created on the still-visible frame N.
	panel._next_frame = true
	panel._poll()
	panel._desktop.size = Vector2(200, 100)
	var event := InputEventMouseButton.new()
	event.position = Vector2(100, 50)
	event.button_index = MOUSE_BUTTON_LEFT
	event.pressed = true
	panel._desktop_input(event)
	check(panel._input_queue.size() == 1 and panel._input_queue[0].get("frame_sequence") == 1 and panel._input_queue[0].get("owner_id") == binding.owner_id, "queued event captures observed binding and sequence")
	frame.frame_sequence = 2
	reply(frame)
	panel._poll()
	var input_count := 0
	for body in sent:
		if body.op == "input":
			input_count += 1
	check(input_count == 0 and panel._input_queue.is_empty() and sent[-1].op == "frame", "old-frame input discarded and refresh requested without replay")
	# Current-frame input still works; no blanket input disablement.
	frame.frame_sequence = 3
	reply(frame)
	panel._desktop_input(event)
	check(sent[-1].op == "input" and sent[-1].frame_sequence == 3 and sent[-1].display_id == binding.display_id, "fresh event dispatch keeps original sequence")
	reply({"ok": true})
	# Explicit deletion clears only the private artifact, not the live display.
	panel.refresh()
	descriptor.block.screenshot_available = true
	reply(descriptor)
	reply(snapshot)
	desktop_before = panel._desktop.texture
	panel._press("delete_snapshot")
	reply({"ok": true})
	check(panel._image.texture == null and panel._event == "" and panel._desktop.texture == desktop_before, "explicit delete clears artifact binding without clearing display")
	# Each identity field is captured at enqueue time, never supplied at dispatch.
	for key in ["mission_id", "position_id", "owner_id", "generation", "display_id"]:
		panel._mission = binding.duplicate(true)
		panel._frame_at = Time.get_ticks_msec()
		panel._descriptor_at = Time.get_ticks_msec()
		panel._pending = 123
		panel._enqueue_input({"kind": "key", "key": "x", "pressed": true})
		panel._mission[key] = 42 if key == "position_id" else (2 if key == "generation" else "f".repeat(32))
		panel._pending = 0
		var first := sent.size()
		panel._poll()
		var replayed := false
		for index in range(first, sent.size()):
			replayed = replayed or sent[index].op == "input"
		check(not replayed and panel._input_queue.is_empty(), "queued input discarded on changed " + key)
		panel._pending = 0
	panel.queue_free()
	await process_frame
	print("UI-REVIEW-RESULT ", passed, " PASS / ", failed, " FAIL")
	quit(0 if failed == 0 else 1)
