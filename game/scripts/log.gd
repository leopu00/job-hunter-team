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
	_file = FileAccess.open("user://jht-game.log", FileAccess.WRITE)
	info("boot", "log aperto — versione %s, %s" % [
		ProjectSettings.get_setting("application/config/version", "dev"),
		OS.get_name(),
	])
	info("boot", "file di log: %s" % ProjectSettings.globalize_path("user://jht-game.log"))

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
