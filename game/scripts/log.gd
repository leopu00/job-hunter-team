extends Node
## Autoload `Log`: log di gioco chiari e greppabili, su stdout E su file
## (`user://jht-game.log`, sovrascritto a ogni avvio). Formato:
## [HH:MM:SS.mmm] [LIVELLO] [categoria] messaggio
##
## Convenzioni categoria: boot, scene, camera, dept, agent, ui, test.
## `JHT_LOG=debug` abilita anche il livello debug (di default tace).

var _file: FileAccess
var _debug_on := false

func _enter_tree() -> void:
	_debug_on = OS.get_environment("JHT_LOG") == "debug"
	# La sessione precedente sopravvive in .prev.log: dopo un crash il log
	# corrente riparte vuoto e la diagnosi andrebbe persa (crash Docker 21/07).
	var live := ProjectSettings.globalize_path("user://jht-game.log")
	if FileAccess.file_exists(live):
		DirAccess.rename_absolute(live,
				ProjectSettings.globalize_path("user://jht-game.prev.log"))
	_file = FileAccess.open("user://jht-game.log", FileAccess.WRITE)
	info("boot", "log aperto — versione %s, %s" % [
		ProjectSettings.get_setting("application/config/version", "dev"),
		OS.get_name(),
	])
	info("boot", "file di log: %s" % ProjectSettings.globalize_path("user://jht-game.log"))

func _ready() -> void:
	# GPU e driver reali (smaschera i fallback software: llvmpipe/WARP = lag).
	info("boot", "video: %s — %s" % [
		RenderingServer.get_video_adapter_name(),
		RenderingServer.get_video_adapter_api_version(),
	])
	# Battito perf ogni 30s: leggibile via SSH dal log per diagnosi remota.
	var t := Timer.new()
	t.wait_time = 30.0
	t.timeout.connect(_log_perf)
	add_child(t)
	t.start()

func _log_perf() -> void:
	info("perf", "fps=%d frame_ms=%.1f draw_calls=%d nodes=%d mem_mb=%.0f" % [
		Engine.get_frames_per_second(),
		Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0,
		Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME),
		Performance.get_monitor(Performance.OBJECT_NODE_COUNT),
		Performance.get_monitor(Performance.MEMORY_STATIC) / 1048576.0,
	])

func info(cat: String, msg: String) -> void:
	_write("INFO", cat, msg)

func warn(cat: String, msg: String) -> void:
	_write("WARN", cat, msg)
	push_warning("[%s] %s" % [cat, msg])

func error(cat: String, msg: String) -> void:
	_write("ERROR", cat, msg)
	push_error("[%s] %s" % [cat, msg])

func debug(cat: String, msg: String) -> void:
	if _debug_on:
		_write("DEBUG", cat, msg)

func _write(level: String, cat: String, msg: String) -> void:
	var t := Time.get_time_dict_from_system()
	var ms := Time.get_ticks_msec() % 1000
	var line := "[%02d:%02d:%02d.%03d] [%s] [%s] %s" % [
		t["hour"], t["minute"], t["second"], ms, level, cat, msg]
	print(line)
	if _file:
		_file.store_line(line)
		_file.flush()
