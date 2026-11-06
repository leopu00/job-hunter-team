extends SceneTree
## Synthetic command runners and dialog callbacks; no runtime is contacted.

const Request = preload("res://scripts/setup/graceful_shutdown_request.gd")
const Dialog = preload("res://scripts/ui/shutdown_dialog.gd")
var _failures: Array[String] = []


func _init() -> void:
	call_deferred("_run")


func _check(condition: bool, label: String) -> void:
	if not condition:
		_failures.append(label)


func _run() -> void:
	UIStrings.lang = "it"
	for rc: int in [0, 3, 1, 130]:
		var calls: Array = []
		var run := func(_binary: String, args: PackedStringArray) -> Dictionary:
			calls.append(args)
			return {"code": rc if args.has("jht-tmux-send") else 0}
		_check(Request.request(run, "/fixture/ready.flag") == (rc == 0),
				"request acknowledges only exit zero: %d" % rc)
		_check(calls.size() == 2, "clear precedes send")
	var denied_calls: Array = []
	var denied := func(_binary: String, _args: PackedStringArray) -> Dictionary:
		denied_calls.append(true)
		return {"code": 1}
	_check(not Request.request(denied, "/fixture/ready.flag"), "clear failure is visible")
	_check(denied_calls.size() == 1, "no send with a stale ready flag")
	await _dialog(false, false)
	await _dialog(true, false)
	await _dialog(true, true)
	for failure: String in _failures:
		push_error(failure)
	print("SHUTDOWN-DELIVERY-TEST %s" % ("PASS" if _failures.is_empty() else "FAIL"))
	quit(0 if _failures.is_empty() else 1)


func _dialog(delivered: bool, ready: bool) -> void:
	var selected: Array = []
	var dialog := Dialog.new(PackedStringArray(), func() -> bool: return delivered,
			func() -> bool: return ready,
			func() -> PackedStringArray: return PackedStringArray())
	root.add_child(dialog)
	dialog.set_process(false)
	dialog.chosen.connect(func(mode: String) -> void: selected.append(mode))
	dialog._start_graceful()
	if not delivered:
		_check(not dialog._waiting, "failed order does not start a wait")
		_check(dialog._status.text == UIStrings.t("shutdown.not_delivered"), "failed order is visible")
	else:
		_check(dialog._waiting, "delivered order starts waiting")
		dialog._process(Dialog.GRACEFUL_WAIT_S + 1)
		if ready:
			_check(selected == [HeadlessSession.MODE_GRACEFUL], "ready flag confirms shutdown")
		else:
			_check(not dialog._waiting and selected.is_empty(), "timeout never forces shutdown")
			_check(dialog._status.text == UIStrings.t("shutdown.timed_out"), "timeout is visible")
	dialog.queue_free()
	await process_frame
