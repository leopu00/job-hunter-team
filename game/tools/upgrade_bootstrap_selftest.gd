extends SceneTree
## Self-test del bootstrap upgrade per host che hanno ancora jht v0.3.3.
## Esecuzione: godot --headless --path game --script res://tools/upgrade_bootstrap_selftest.gd
##
## Quel wrapper accetta `upgrade --check --json` ma lo ignora: fa pull + up e
## non emette il frame JSON. Questo test non simula Docker: verifica che il
## client non possa costruire quel lancio legacy e che consegni sempre il
## wrapper reale al dispatcher production temporaneo, validato prima di girare.

var _fails: Array[String] = []
var _service: GDScript
const JSON_FRAME := "{\"ok\":true,\"changed\":false,\"phase\":\"check\",\"previous\":{\"version\":\"0.3.3\",\"image\":\"sha256:old\"},\"current\":{\"version\":\"0.3.3\",\"image\":\"sha256:old\"},\"restartRequired\":false,\"message\":\"Controllo completato\",\"rolledBack\":false}"


func _init() -> void:
	create_timer(30.0).timeout.connect(func() -> void:
		print("UPGRADE-BOOTSTRAP-TEST FAIL [timeout]")
		quit(2))
	process_frame.connect(_run, CONNECT_ONE_SHOT)


func _check(what: String, ok: bool, detail := "") -> void:
	if not ok:
		_fails.append(what + ("" if detail == "" else " — " + detail))


func _run() -> void:
	_service = load("res://scripts/setup/setup_service.gd")
	_check("setup service caricabile", _service != null)
	if _service != null:
		_posix_contract()
		_vps_contract()
		_windows_contract()
		if OS.get_name() != "Windows":
			_posix_bootstrap_e2e_contract()
	if _fails.is_empty():
		print("UPGRADE-BOOTSTRAP-TEST PASS")
		quit(0)
		return
	for failure in _fails:
		push_error("[upgrade-bootstrap] " + failure)
	print("UPGRADE-BOOTSTRAP-TEST FAIL (%d problemi)" % _fails.size())
	quit(1)


func _posix_contract() -> void:
	var legacy := "/tmp/jht legacy;not-run"
	var check_command := str(_service._posix_upgrade_bootstrap_command(legacy, true))
	var apply_command := str(_service._posix_upgrade_bootstrap_command(legacy, false))
	var quoted_legacy := str(_service._shell_quote(legacy))
	var raw := str(_service.UPGRADE_BOOTSTRAP_RAW_BASE)
	_check("posix: bootstrap in temp", check_command.contains("JHT_BOOTSTRAP=\"$(mktemp "),
			check_command)
	_check("posix: download production wrapper", check_command.contains(
			"curl -fsSL '" + raw + "/scripts/jht-wrapper.sh' -o \"$JHT_BOOTSTRAP\""),
			check_command)
	_check("posix: wrapper validato prima dell'esecuzione",
			check_command.contains("bash -n \"$JHT_BOOTSTRAP\""), check_command)
	_check("posix: rifiuta un wrapper senza protocollo atomico", check_command.contains(
			"grep -Eq '^[[:space:]]*JHT_UPGRADE_PROTOCOL=1([[:space:]]|$)'"), check_command)
	_check("posix: raw production fissato", check_command.contains(
			"JHT_RAW_BASE='" + raw + "'"), check_command)
	_check("posix: target reale passato al wrapper", check_command.contains(
			"JHT_WRAPPER_PATH=" + quoted_legacy + " bash \"$JHT_BOOTSTRAP\""),
			check_command)
	_check("posix: check conserva le opzioni JSON", check_command.ends_with(
			"upgrade --check --json"), check_command)
	_check("posix: check non può invocare il legacy", not check_command.contains(
			quoted_legacy + " upgrade --check --json"), check_command)
	_check("posix: apply usa la stessa catena", apply_command.ends_with("upgrade --json")
			and not apply_command.contains("--check"), apply_command)


func _vps_contract() -> void:
	var check_command := str(_service._vps_upgrade_check_command())
	var apply_command := str(_service._vps_upgrade_command())
	_check("vps: localizza il wrapper host", check_command.contains(
			"JHT_BIN=\"$(command -v jht 2>/dev/null || true)\""), check_command)
	_check("vps: non esegue mai il wrapper storico", not check_command.contains(
			"exec \"$JHT_BIN\" upgrade") and not apply_command.contains(
			"exec \"$JHT_BIN\" upgrade"), check_command)
	_check("vps: bootstrap punta al wrapper originale", check_command.contains(
			"JHT_WRAPPER_PATH=\"$JHT_BIN\" bash \"$JHT_BOOTSTRAP\""), check_command)
	_check("vps: check è ancora check JSON", check_command.ends_with(
			"upgrade --check --json"), check_command)
	_check("vps: apply è distinto dal check", apply_command.ends_with("upgrade --json")
			and not apply_command.contains("--check"), apply_command)


func _windows_contract() -> void:
	var shim := "C:\\JHT Root\\jht.cmd"
	var target := str(_service._windows_wrapper_target(shim))
	var command := str(_service._windows_upgrade_bootstrap_command(target, true))
	var raw := str(_service.UPGRADE_BOOTSTRAP_RAW_BASE)
	var expected_target := shim.get_base_dir().path_join("jht.ps1")
	_check("windows: lo shim aggiorna jht.ps1", target == expected_target, target)
	_check("windows: download production wrapper", command.contains(
			"Invoke-WebRequest -UseBasicParsing -Uri '" + raw + "/scripts/jht-wrapper.ps1'"), command)
	_check("windows: wrapper validato prima dell'esecuzione", command.contains(
			"[scriptblock]::Create((Get-Content -LiteralPath $tmp -Raw))"), command)
	_check("windows: rifiuta un wrapper senza protocollo atomico", command.contains(
			"Select-String -Path $tmp -Pattern '^\\s*\\$JHT_UPGRADE_PROTOCOL\\s*=\\s*1\\s*$'"), command)
	_check("windows: raw e target reale ereditati dal figlio", command.contains(
			"$env:JHT_RAW_BASE='" + raw + "'; $env:JHT_WRAPPER_PATH="
			+ str(_service._powershell_quote(target))), command)
	_check("windows: stdout JSON resta isolato", command.contains(
			"1>$out 2>$err") and command.contains("[Console]::Out.Write"), command)
	_check("windows: temp sempre rimosso", command.contains("finally { Remove-Item"), command)
	_check("windows: check conserva le opzioni JSON", command.contains(
			"-File $tmp upgrade --check --json"), command)


## Non dipende dalla rete né da Docker: il finto curl rende disponibile un
## wrapper production minimale. Target e raw sono già verificati dalla seam
## statica sopra; qui il comando costruito dal client deve lasciare stdout
## invariato (un solo JSON). Cambiando soltanto il file scaricato in uno senza
## marker, il wrapper non deve partire.
func _posix_bootstrap_e2e_contract() -> void:
	var root := OS.get_cache_dir().path_join(
			"jht-upgrade-bootstrap-%d" % int(Time.get_ticks_usec()))
	var bin := root.path_join("bin")
	var fixture := root.path_join("production-wrapper.sh")
	var without_marker := root.path_join("without-marker.sh")
	var legacy_target := root.path_join("jht-v0.3.3")
	DirAccess.make_dir_recursive_absolute(bin)
	_write_file(fixture, "\n".join(PackedStringArray([
		"#!/usr/bin/env bash",
		"set -eu",
		"JHT_UPGRADE_PROTOCOL=1",
		"printf '%s\\n' '" + JSON_FRAME + "'",
	])) + "\n")
	_write_file(without_marker, "#!/usr/bin/env bash\nprintf '%s\\n' '" + JSON_FRAME + "'\n")
	var good_curl := bin.path_join("curl-good")
	var stale_curl := bin.path_join("curl-without-marker")
	_write_file(good_curl, _curl_fixture_body(fixture))
	_write_file(stale_curl, _curl_fixture_body(without_marker))
	OS.execute("/bin/chmod", PackedStringArray(["+x", good_curl, stale_curl]))
	var command := str(_service._posix_upgrade_bootstrap_command(legacy_target, true))
	# Il command è identico a quello live, salvo l'eseguibile curl assoluto:
	# evita che la CI contatti production (il cui commit può cambiare durante il
	# run) e rende la fixture veramente offline.
	var good_command := command.replace("curl -fsSL",
			str(_service._shell_quote(good_curl)) + " -fsSL")
	var success := _run_bootstrap_fixture(good_command)
	_check("posix e2e: marked wrapper succeeds",
			bool(success.get("ok", false)), str(success))
	# _run_upgrade_json accetta soltanto un frame JSON, senza log aggiunti e con
	# exit code coerente: un suo successo prova il contratto stdout reale, non
	# una versione tollerante del parser nel test.
	_check("posix e2e: stdout is exactly one valid JSON result",
			str(success.get("phase", "")) == "check"
			and not bool(success.get("protocol_error", false)), str(success))
	var stale_command := command.replace("curl -fsSL",
			str(_service._shell_quote(stale_curl)) + " -fsSL")
	var rejected := _run_bootstrap_fixture(stale_command)
	_check("posix e2e: wrapper without marker fails before execution",
			not bool(rejected.get("ok", true))
			and bool(rejected.get("protocol_error", false)), str(rejected))


func _write_file(path: String, body: String) -> void:
	var file := FileAccess.open(path, FileAccess.WRITE)
	file.store_string(body)
	file.close()


func _curl_fixture_body(source: String) -> String:
	return "\n".join(PackedStringArray([
		"#!/bin/sh",
		"set -eu",
		"out=''",
		"for argument in \"$@\"; do out=\"$argument\"; done",
		"[ -n \"$out\" ]",
		"cp " + str(_service._shell_quote(source)) + " \"$out\"",
	])) + "\n"


func _run_bootstrap_fixture(command: String) -> Dictionary:
	return _service._run_upgrade_json("/bin/bash", PackedStringArray(["-c", command]))
