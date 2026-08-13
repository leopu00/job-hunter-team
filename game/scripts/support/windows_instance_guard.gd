extends Node
## Primo autoload Windows: il desktop non avvia log, rete o stato finche il
## sidecar attestato nel PCK non possiede la lease kernel per questa sessione.

const SOURCE_PATH := "res://scripts/support/windows_instance_guard.ps1"
const SOURCE_SHA256 := "5a0a3bc554239c4d3022d634cd9d5a58dfc401aad6ba87cf135b863a3f975b5a"
const SOURCE_MAX_BYTES := 10_000
const ARGV_MAX_UTF16 := 30_000
const REQUEST_MAX_BYTES := 2_048
const READY_MAX_BYTES := 2_048
const STDERR_MAX_BYTES := 2_048
const READY_TIMEOUT_MSEC := 8_000
const HEARTBEAT_TIMEOUT_MSEC := 1_500

var _allowed := false
var _failed := false
var _stdio: FileAccess
var _stderr: FileAccess
var _guard_pid := -1
var _last_heartbeat_msec := 0
var _heartbeat_bytes := PackedByteArray()
var _stderr_bytes := PackedByteArray()
var _binding := {}
var _source_byte_count := 0
var _command_length := 0


func _enter_tree() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	# L'editor non e un artefatto distribuibile e non possiede il PCK firmato.
	# Gli export Windows, compresi i gate headless, percorrono sempre il guard.
	if OS.get_name() != "Windows" or OS.has_feature("editor"):
		_allowed = true
		return
	if not _start_guard():
		_fail_closed("bootstrap")
	elif OS.get_environment("JHT_WINDOWS_INSTANCE_GUARD_PCK_TEST") == "1":
		print("WINDOWS-INSTANCE-GUARD-PCK source=exported-pck bytes=",
				_source_byte_count, " argv_utf16=", _command_length,
				" sha256=", SOURCE_SHA256)
		_allowed = false
		get_tree().quit(0)


func _process(_delta: float) -> void:
	if not _allowed or _failed or _guard_pid <= 0:
		return
	if not OS.is_process_running(_guard_pid):
		_fail_closed("guard_exit")
		return
	_drain_stderr()
	if _failed:
		return
	var chunk := _stdio.get_buffer(512)
	if not chunk.is_empty():
		_heartbeat_bytes.append_array(chunk)
		if _heartbeat_bytes.size() > READY_MAX_BYTES:
			_fail_closed("pipe_overflow")
			return
		_consume_heartbeats()
	if Time.get_ticks_msec() - _last_heartbeat_msec > HEARTBEAT_TIMEOUT_MSEC:
		_fail_closed("pipe_timeout")


func _exit_tree() -> void:
	_close_pipes()


func normal_work_allowed() -> bool:
	return _allowed and not _failed


func binding() -> Dictionary:
	return _binding.duplicate(true) if normal_work_allowed() else {}


func _start_guard() -> bool:
	var raw := FileAccess.get_file_as_bytes(SOURCE_PATH)
	if not source_bytes_valid(raw, SOURCE_SHA256):
		return false
	_source_byte_count = raw.size()
	var encoded := encoded_command(raw)
	if encoded.is_empty():
		return false
	var powershell := _powershell_path()
	var args := PackedStringArray([
		"-NoLogo", "-NoProfile", "-NonInteractive",
		"-EncodedCommand", encoded,
	])
	_command_length = command_utf16_length(powershell, args)
	if powershell.is_empty() or _command_length >= ARGV_MAX_UTF16:
		return false
	var request := _request_line()
	if request.is_empty() or request.to_utf8_buffer().size() > REQUEST_MAX_BYTES:
		return false
	var process := OS.execute_with_pipe(powershell, args, false)
	if process.is_empty():
		return false
	_stdio = process["stdio"]
	_stderr = process["stderr"]
	_guard_pid = int(process["pid"])
	if _guard_pid <= 0 or not _stdio.store_buffer((request + "\n").to_utf8_buffer()):
		_close_pipes()
		return false
	_stdio.flush()
	var ready_line := _read_ready_line()
	if ready_line.is_empty() or not _accept_ready(ready_line, request, powershell):
		_close_pipes()
		return false
	_allowed = true
	_last_heartbeat_msec = Time.get_ticks_msec()
	return true


func _read_ready_line() -> String:
	var bytes := PackedByteArray()
	var deadline := Time.get_ticks_msec() + READY_TIMEOUT_MSEC
	while Time.get_ticks_msec() < deadline:
		_drain_stderr()
		if _failed or _guard_pid <= 0 or not OS.is_process_running(_guard_pid):
			return ""
		var one := _stdio.get_buffer(1)
		if one.is_empty():
			OS.delay_msec(2)
			continue
		if one[0] == 10:
			var text := bytes.get_string_from_utf8()
			return text if text.to_utf8_buffer() == bytes else ""
		if one[0] < 32 or one[0] == 127 or bytes.size() >= READY_MAX_BYTES:
			return ""
		bytes.append(one[0])
	return ""


func _accept_ready(line: String, request_line: String, powershell: String) -> bool:
	var ready: Variant = JSON.parse_string(line)
	var request: Variant = JSON.parse_string(request_line)
	if not ready is Dictionary or not request is Dictionary \
			or JSON.stringify(ready, "", true, false) != line:
		return false
	var expected_keys := ["desktop_exe_path", "desktop_pid", "desktop_started",
		"guard_exe_path", "guard_pid", "guard_started", "instance_id", "mode",
		"mutex_fingerprint", "nonce", "request_id", "request_token", "schema",
		"source_sha256", "type"]
	if not _exact_keys(ready, expected_keys):
		return false
	var executable := OS.get_executable_path().replace("\\", "/").to_lower()
	var guard_executable := powershell.replace("\\", "/").to_lower()
	if int(ready.get("schema", 0)) != 1 or str(ready.get("type", "")) != "ready" \
			or int(ready.get("desktop_pid", 0)) != OS.get_process_id() \
			or str(ready.get("desktop_exe_path", "")) != executable \
			or int(ready.get("guard_pid", 0)) != _guard_pid \
			or str(ready.get("guard_exe_path", "")) != guard_executable \
			or str(ready.get("instance_id", "")) != str(request.get("instance_id", "")) \
			or str(ready.get("mode", "")) != str(request.get("mode", "")) \
			or str(ready.get("nonce", "")) != str(request.get("nonce", "")) \
			or str(ready.get("request_id", "")) != str(request.get("request_id", "")) \
			or str(ready.get("request_token", "")) != str(request.get("request_token", "")) \
			or str(ready.get("source_sha256", "")) != SOURCE_SHA256 \
			or not _decimal(str(ready.get("desktop_started", ""))) \
			or not _decimal(str(ready.get("guard_started", ""))) \
			or not _lower_hex(str(ready.get("mutex_fingerprint", "")), 64):
		return false
	_binding = ready
	return true


func _request_line() -> String:
	var options := _user_options()
	var request_token := str(options.get("jht-instance-request", ""))
	if request_token.is_empty():
		var request := {
			"desktop_pid": OS.get_process_id(),
			"instance_id": "instance-" + _random_hex(12),
			"mode": "normal",
			"nonce": _random_hex(16),
			"request_id": "normal-" + _random_hex(12),
			"request_token": "guard-" + _random_hex(16),
			"schema": 1,
			"source_sha256": SOURCE_SHA256,
		}
		return JSON.stringify(request, "", true, false)
	if not _token(request_token, "guard-", 32):
		return ""
	var local_app_data := OS.get_environment("LOCALAPPDATA").strip_edges()
	if local_app_data.is_empty() or not local_app_data.is_absolute_path():
		return ""
	var request_path := local_app_data.path_join(
			"Job Hunter Team/host-runtime/instance-guard/request-%s.json" % request_token)
	var file := FileAccess.open(request_path, FileAccess.READ)
	if file == null or file.get_length() < 2 or file.get_length() > REQUEST_MAX_BYTES:
		return ""
	var raw := file.get_buffer(file.get_length())
	file.close()
	if raw.has(0) or raw.has(10) or raw.has(13):
		return ""
	var line := raw.get_string_from_utf8()
	var request: Variant = JSON.parse_string(line)
	if not request is Dictionary or JSON.stringify(request, "", true, false) != line \
			or int(request.get("desktop_pid", 0)) != OS.get_process_id() \
			or str(request.get("mode", "")) != "update" \
			or str(request.get("request_token", "")) != request_token \
			or str(request.get("source_sha256", "")) != SOURCE_SHA256:
		return ""
	return line


func _consume_heartbeats() -> void:
	while true:
		var newline := _heartbeat_bytes.find(10)
		if newline < 0:
			return
		var line := _heartbeat_bytes.slice(0, newline)
		_heartbeat_bytes = _heartbeat_bytes.slice(newline + 1)
		if line.get_string_from_ascii() != "ALIVE":
			_fail_closed("pipe_frame")
			return
		_last_heartbeat_msec = Time.get_ticks_msec()


func _drain_stderr() -> void:
	if not is_instance_valid(_stderr):
		return
	var chunk := _stderr.get_buffer(512)
	if chunk.is_empty():
		return
	_stderr_bytes.append_array(chunk)
	if _stderr_bytes.size() > STDERR_MAX_BYTES or _allowed:
		_fail_closed("guard_stderr")


func _fail_closed(code: String) -> void:
	if _failed:
		return
	_failed = true
	_allowed = false
	_close_pipes()
	printerr("WINDOWS-INSTANCE-GUARD FAIL code=", code)
	get_tree().quit(1)


func _close_pipes() -> void:
	if is_instance_valid(_stdio):
		_stdio.close()
	if is_instance_valid(_stderr):
		_stderr.close()
	_stdio = null
	_stderr = null


func _powershell_path() -> String:
	var root := OS.get_environment("SystemRoot").strip_edges().replace("\\", "/")
	if root.length() < 3 or root[1] != ":" or root[2] != "/" \
			or root.split("/").has("..") or "\n" in root or "\r" in root:
		return ""
	var path := root.path_join("System32/WindowsPowerShell/v1.0/powershell.exe")
	return path if FileAccess.file_exists(path) else ""


static func source_bytes_valid(raw: PackedByteArray, expected_sha256: String) -> bool:
	if raw.is_empty() or raw.size() >= SOURCE_MAX_BYTES or raw[-1] != 10 \
			or raw.has(0) or raw.has(13):
		return false
	for byte: int in raw:
		if byte > 127:
			return false
	var hashing := HashingContext.new()
	if hashing.start(HashingContext.HASH_SHA256) != OK \
			or hashing.update(raw) != OK:
		return false
	return hashing.finish().hex_encode() == expected_sha256


static func encoded_command(raw: PackedByteArray) -> String:
	var utf16le := PackedByteArray()
	utf16le.resize(raw.size() * 2)
	for index in raw.size():
		utf16le[index * 2] = raw[index]
		utf16le[index * 2 + 1] = 0
	var encoded := Marshalls.raw_to_base64(utf16le)
	return encoded if Marshalls.base64_to_raw(encoded) == utf16le else ""


static func command_utf16_length(path: String, args: PackedStringArray) -> int:
	# Limite conservativo: ogni argv puo richiedere due quote, piu il separatore.
	var total := path.length() + 1
	for arg: String in args:
		total += arg.length() + 3
	return total


static func _exact_keys(value: Dictionary, expected: Array) -> bool:
	if value.size() != expected.size():
		return false
	for key: String in expected:
		if not value.has(key):
			return false
	return true


static func _decimal(value: String) -> bool:
	if value.length() < 10 or value.length() > 20:
		return false
	for character: String in value:
		if character < "0" or character > "9":
			return false
	return true


static func _lower_hex(value: String, length: int) -> bool:
	if value.length() != length:
		return false
	for character: String in value:
		if not ((character >= "0" and character <= "9") \
				or (character >= "a" and character <= "f")):
			return false
	return true


static func _token(value: String, prefix: String, hex_length: int) -> bool:
	return value.begins_with(prefix) \
			and _lower_hex(value.substr(prefix.length()), hex_length)


static func _random_hex(bytes: int) -> String:
	return Crypto.new().generate_random_bytes(bytes).hex_encode()


static func _user_options() -> Dictionary:
	var out := {}
	for arg: String in OS.get_cmdline_user_args():
		if arg.begins_with("--") and "=" in arg:
			var pair := arg.substr(2).split("=", true, 1)
			out[pair[0]] = pair[1]
	return out
