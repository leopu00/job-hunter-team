extends SceneTree
## Oracle causale #129: comando, watchdog e probe CAPITANO devono restare
## osservazioni distinte. Esecuzione:
## godot --headless --path game --script res://tools/team_start_state_selftest.gd

const State := preload("res://scripts/setup/team_start_state.gd")

var _fails: Array[String] = []


func _check(label: String, ok: bool, detail := "") -> void:
	if not ok:
		_fails.append(label + ("" if detail == "" else " — " + detail))


func _init() -> void:
	create_timer(30.0).timeout.connect(func() -> void:
		print("TEAM-START-STATE-TEST FAIL [timeout]")
		quit(2))
	process_frame.connect(_run, CONNECT_ONE_SHOT)


func _run() -> void:
	_partial_failure_and_recovery()
	_stale_probe_and_timeout()
	_success_requires_runtime_observation()
	if OS.get_name() != "Windows":
		await _watchdog_cursor_boundary()
	if _fails.is_empty():
		print("TEAM-START-STATE-TEST PASS")
		quit(0)
	else:
		print("TEAM-START-STATE-TEST FAIL ", _fails)
		quit(1)


func _partial_failure_and_recovery() -> void:
	var state := State.new()
	state.begin(1_000)
	var attempt := state.attempt
	state.finish_command(false,
			"✓ MENTOR started\n✗ CAPITANO — provider boot failed\nResult: 1 started, 6 errors",
			420, 2_000)
	_check("fallimento distinto", state.phase == State.FAILED, state.phase)
	_check("causa essenziale conservata",
			state.cause.contains("CAPITANO") and state.cause.contains("failed"),
			state.cause)
	_check("cursor conservato", state.watchdog_cursor == 420)

	# Una riga vecchia non arriva qui: SetupService legge solo dopo il cursor.
	# Senza una riga nuova la semplice attesa non inventa recovering.
	state.observe(attempt, false, "", 20_000)
	_check("silenzio non e recupero", state.phase == State.FAILED, state.phase)
	var watchdog := "[now] agent capitano: session CAPITANO is inactive — relaunching via jht team start"
	state.observe(attempt, false, watchdog, 31_000)
	_check("tentativo watchdog e recupero", state.phase == State.RECOVERING,
			state.phase)
	state.observe(attempt, true, watchdog, 34_000)
	_check("solo CAPITANO conclude running", state.phase == State.RUNNING,
			state.phase)


func _stale_probe_and_timeout() -> void:
	var state := State.new()
	state.begin(10)
	var old_attempt := state.attempt
	state.finish_command(false, "CAPITANO failed", 10, 20)
	state.begin(30)
	state.finish_command(false, "CAPITANO failed again", 80, 40)
	var fresh_attempt := state.attempt
	var watchdog := "agent capitano: session CAPITANO is inactive — relaunching via jht team start"
	state.observe(old_attempt, false, watchdog, 50)
	_check("probe vecchio ignorato", state.phase == State.FAILED, state.phase)
	state.observe(fresh_attempt, false, watchdog, 60)
	_check("probe corrente accettato", state.phase == State.RECOVERING,
			state.phase)
	state.observe(fresh_attempt, false, "", 40 + State.RECOVERY_TIMEOUT_MS)
	_check("recovery ha limite finito", state.phase == State.FAILED, state.phase)
	_check("timeout azionabile", state.error_code == "recovery_timeout",
			state.error_code)


func _success_requires_runtime_observation() -> void:
	var state := State.new()
	state.begin(100)
	var attempt := state.attempt
	state.finish_command(true, "CAPITANO started", 0, 200)
	_check("exit zero resta starting", state.phase == State.STARTING, state.phase)
	state.observe(attempt, false, "", 200 + State.CONFIRM_TIMEOUT_MS)
	_check("assenza CAPITANO fallisce", state.phase == State.FAILED, state.phase)
	_check("causa osservativa", state.error_code == "captain_not_observed",
			state.error_code)
	state.observe(attempt, true, "", 200 + State.RECOVERY_TIMEOUT_MS + 1)
	_check("CAPITANO tardivo resta autoritativo", state.phase == State.RUNNING,
			state.phase)


## Prova il seam VERO usato da SetupService: il cursor esclude la riga stale,
## l'append successivo è leggibile e una rotazione/troncatura fallisce chiusa.
func _watchdog_cursor_boundary() -> void:
	# Il vero autoload sonda Docker ogni 3 s. Lo fermiamo durante la sostituzione
	# del PATH, altrimenti il suo probe concorrente userebbe lo stub del test.
	var live_service := root.get_node_or_null("SetupService")
	var restart_timer := false
	if live_service != null and live_service._timer != null:
		restart_timer = not live_service._timer.is_stopped()
		live_service._timer.stop()
		while live_service._probe_running:
			await create_timer(0.02).timeout
	var service: GDScript = load("res://scripts/setup/setup_service.gd")
	_check("SetupService caricabile", service != null and service.can_instantiate())
	if service == null:
		return
	var root_dir := OS.get_cache_dir().path_join(
			"jht-team-start-state-%d" % int(Time.get_ticks_usec()))
	var bin_dir := root_dir.path_join("bin")
	var log_path := root_dir.path_join("watchdog.log")
	DirAccess.make_dir_recursive_absolute(bin_dir)
	_write(log_path, "stale line\n")
	var docker := bin_dir.path_join("docker")
	var quoted_log := log_path.replace("'", "'\\''")
	_write(docker, ("""#!/bin/sh
script="$5"
log='%s'
if printf '%%s' "$script" | grep -q 'tail -c'; then
  cursor=$(printf '%%s' "$script" | sed -n 's/.*-ge \\([0-9][0-9]*\\).*/\\1/p')
  first=$(printf '%%s' "$script" | sed -n 's/.*tail -c +\\([0-9][0-9]*\\).*/\\1/p')
  size=$(wc -c < "$log") || exit 5
  [ "$size" -ge "$cursor" ] || exit 6
  tail -c +"$first" "$log" | tail -c 16384
  exit $?
fi
wc -c < "$log"
""") % quoted_log)
	OS.execute("/bin/chmod", PackedStringArray(["+x", docker]))
	var old_path := OS.get_environment("PATH")
	OS.set_environment("PATH", bin_dir + ":/usr/bin:/bin")
	var cursor := int(service._watchdog_log_cursor({}))
	_check("cursor conta lo stale", cursor == "stale line\n".length(), str(cursor))
	_append(log_path, "[now] agent capitano: session CAPITANO is inactive — relaunching via jht team start\n")
	var delta := str(service._watchdog_log_delta({}, cursor))
	_check("delta esclude stale", not delta.contains("stale line"), delta)
	_check("delta attesta il watchdog", State.watchdog_attempted(delta), delta)
	_write(log_path, "x")
	_check("troncatura fail-closed",
			str(service._watchdog_log_delta({}, cursor)) == "")
	OS.set_environment("PATH", old_path)
	if restart_timer and live_service != null and live_service._timer != null:
		live_service._timer.start()


func _write(path: String, body: String) -> void:
	var file := FileAccess.open(path, FileAccess.WRITE)
	file.store_string(body)
	file.close()


func _append(path: String, body: String) -> void:
	var file := FileAccess.open(path, FileAccess.READ_WRITE)
	file.seek_end()
	file.store_string(body)
	file.close()
