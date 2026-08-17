class_name ClientControl
extends Node
## Control plane locale per `jht game` / `jht gui`.
##
## Vive in user://client: e' storage dell'app host, non ~/.jht (che su Linux
## puo essere chownato all'utente del container). Ogni richiesta porta il nonce
## dell'istanza: un PID riciclato o un request fossile non puo chiudere un
## processo diverso. Il polling resta sul main thread per tutte le API finestra.

const CONTROL_DIR := "user://client"
const STATE_FILE := "state.json"
const LAUNCHER_FILE := "launcher.json"
const REQUEST_FILE := "request.json"
const POLL_SECONDS := 0.2

var instance_id := ""
var _control_abs := ""
var _timer: Timer
var _enabled := false


func _ready() -> void:
	if not WindowsInstanceGuard.normal_work_allowed():
		return
	if DisplayServer.get_name() == "headless" \
			or OS.get_environment("JHT_GAME_CONTROL_DISABLED") == "1":
		return
	var user_args := _user_options()
	var configured_dir := str(user_args.get("jht-control-dir",
			OS.get_environment("JHT_GAME_CONTROL_DIR"))).strip_edges()
	_control_abs = configured_dir if configured_dir.is_absolute_path() \
			else ProjectSettings.globalize_path(
			configured_dir if configured_dir != "" else CONTROL_DIR)
	if DirAccess.make_dir_recursive_absolute(_control_abs) != OK:
		Log.warn("client-control", "directory non scrivibile: " + _control_abs)
		return
	instance_id = str(user_args.get("jht-instance-id",
			OS.get_environment("JHT_GAME_INSTANCE_ID"))).strip_edges()
	if instance_id == "":
		instance_id = "%d-%d" % [OS.get_process_id(), Time.get_ticks_usec()]
	var state := {
		"schema": 1,
		"instance_id": instance_id,
		"pid": OS.get_process_id(),
		"executable": OS.get_executable_path(),
		"started_at": Time.get_unix_time_from_system(),
	}
	if OS.get_name() == "Windows":
		var guard := WindowsInstanceGuard.binding()
		if guard.is_empty():
			return
		state["schema"] = 2
		state["guard"] = {
			"desktop_executable": guard["desktop_exe_path"],
			"desktop_started": guard["desktop_started"],
			"executable": guard["guard_exe_path"],
			"instance_id": guard["instance_id"],
			"mode": guard["mode"],
			"mutex_fingerprint": guard["mutex_fingerprint"],
			"pid": guard["guard_pid"],
			"source_sha256": guard["source_sha256"],
			"started": guard["guard_started"],
		}
	if not _write_json(_path(STATE_FILE), state):
		return
	# L'archivio macOS e il tar Linux possono essere estratti ovunque. Dopo la
	# prima apertura manuale ricordiamo quindi il binario reale: i successivi
	# `jht game start` non devono indovinare una directory scelta dall'utente.
	if not _write_json(_path(LAUNCHER_FILE), {
		"schema": 1,
		"executable": OS.get_executable_path(),
		"updated_at": Time.get_unix_time_from_system(),
	}):
		Log.warn("client-control", "percorso launcher non persistito")
	_enabled = true
	_timer = Timer.new()
	_timer.wait_time = POLL_SECONDS
	_timer.autostart = true
	_timer.timeout.connect(_poll_request)
	add_child(_timer)
	Log.info("client-control", "istanza registrata: " + instance_id)


func _exit_tree() -> void:
	if _enabled:
		_remove_state_if_owned()


func _poll_request() -> void:
	var request_path := _path(REQUEST_FILE)
	if not FileAccess.file_exists(request_path):
		return
	var request := _read_json(request_path)
	if request.is_empty():
		DirAccess.remove_absolute(request_path)
		return
	var request_id := str(request.get("request_id", ""))
	var target := str(request.get("target_instance_id", ""))
	var action := str(request.get("action", ""))
	if request_id == "":
		DirAccess.remove_absolute(request_path)
		return
	# Una seconda istanza aperta manualmente non deve consumare una richiesta
	# indirizzata all'istanza registrata nel relativo state.json.
	if target != instance_id:
		return
	DirAccess.remove_absolute(request_path)
	match action:
		"foreground":
			_foreground_and_ack.call_deferred(request_id)
		"background":
			_background_and_ack.call_deferred(request_id)
		"stop":
			_write_json(_path("ack-%s.json" % request_id), {
				"schema": 1, "request_id": request_id,
				"instance_id": instance_id, "ok": true,
			})
			Game.detach_from_cli.call_deferred()
		_:
			_write_json(_path("ack-%s.json" % request_id), {
				"schema": 1, "request_id": request_id,
				"instance_id": instance_id, "ok": false,
			})


func _foreground_and_ack(request_id: String) -> void:
	if DisplayServer.window_get_mode() == DisplayServer.WINDOW_MODE_MINIMIZED:
		DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_WINDOWED)
	DisplayServer.window_move_to_foreground()
	DisplayServer.window_request_attention()
	# Il window manager puo rifiutare il foreground. L'ACK deve raccontare il
	# risultato osservato, non soltanto che abbiamo chiamato una API best-effort.
	var focus_deadline := Time.get_ticks_msec() + 1500
	while not DisplayServer.window_is_focused() \
			and Time.get_ticks_msec() < focus_deadline:
		await get_tree().process_frame
	var visible := DisplayServer.window_get_mode() != DisplayServer.WINDOW_MODE_MINIMIZED
	_write_json(_path("ack-%s.json" % request_id), {
		"schema": 1, "request_id": request_id,
		"instance_id": instance_id,
		"ok": visible and DisplayServer.window_is_focused(),
	})


func _background_and_ack(request_id: String) -> void:
	DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_MINIMIZED)
	# Come il foreground, anche la minimizzazione e' best-effort del window
	# manager: l'exit code CLI deve riflettere lo stato osservato.
	var minimize_deadline := Time.get_ticks_msec() + 1500
	while DisplayServer.window_get_mode() != DisplayServer.WINDOW_MODE_MINIMIZED \
			and Time.get_ticks_msec() < minimize_deadline:
		await get_tree().process_frame
	_write_json(_path("ack-%s.json" % request_id), {
		"schema": 1, "request_id": request_id,
		"instance_id": instance_id,
		"ok": DisplayServer.window_get_mode() == DisplayServer.WINDOW_MODE_MINIMIZED,
	})


static func _user_options() -> Dictionary:
	var out := {}
	for arg in OS.get_cmdline_user_args():
		if not arg.begins_with("--") or not arg.contains("="):
			continue
		var separator := arg.find("=")
		out[arg.substr(2, separator - 2)] = arg.substr(separator + 1)
	return out


func _remove_state_if_owned() -> void:
	var state_path := _path(STATE_FILE)
	var state := _read_json(state_path)
	if str(state.get("instance_id", "")) == instance_id:
		DirAccess.remove_absolute(state_path)


func _path(name: String) -> String:
	return _control_abs.path_join(name)


static func _read_json(path: String) -> Dictionary:
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		return {}
	var parsed: Variant = JSON.parse_string(file.get_as_text())
	return parsed if parsed is Dictionary else {}


static func _write_json(path: String, value: Dictionary) -> bool:
	var temp := "%s.tmp-%d-%d" % [path, OS.get_process_id(), Time.get_ticks_usec()]
	var file := FileAccess.open(temp, FileAccess.WRITE)
	if file == null:
		return false
	file.store_string(JSON.stringify(value) + "\n")
	file.close()
	if DirAccess.rename_absolute(temp, path) != OK:
		DirAccess.remove_absolute(temp)
		return false
	return true
