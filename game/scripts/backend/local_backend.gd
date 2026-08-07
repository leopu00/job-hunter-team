class_name LocalBackend
extends VpsBackend
## Backend del container locale. Riusa integralmente il contratto e i parser
## del backend VPS, sostituendo soltanto il trasporto SSH con comandi eseguiti
## sul computer dell'utente. In questo modo onboarding, chat, profilo, roster,
## posizioni e telemetria non hanno due implementazioni divergenti.


func start(_config: Dictionary) -> void:
	live = true
	_runtime_labels = UIStrings.vps_presentation_snapshot()
	_ip = UIStrings.t("backend.this_computer")
	_stop = false
	bus.publish_state(BackendBus.CONNECTING, UIStrings.t("backend.local_connecting"))
	_thread = Thread.new()
	_thread.start(_run)


## Esegue una command line interna al backend invocando docker DIRETTAMENTE
## con argv, senza NESSUNA shell host. Su Windows la shell locale sarebbe
## PowerShell 5.1, che non parla POSIX: `1>&2` è "riservato per utilizzi
## futuri" (i messaggi chat che "sparivano nel matrix", Leone 23/07) e
## l'output delle command native viene ricodificato nel codepage OEM
## corrompendo accenti ed emoji. I comandi ereditati da VpsBackend sono
## tutti `docker …` con quoting POSIX a apici singoli: _docker_argv li
## rimappa in argv e gli apici non attraversano mai una shell.
## Silenzio massimo tollerato da un comando docker prima di considerarlo
## perso. Generoso: su hardware lento un exec può metterci parecchio a
## partire, ma se per mezzo minuto non arriva un byte non arriverà più.
const STALL_MS := 30000

## Indice dello script di uno `sh -lc <script>` / `sh -c <script>` o di un
## `python3 -c <script>`, -1 per gli altri comandi corti. I due casi vanno
## poi rediretti con sintassi DIVERSA: anteporre `exec >...` al codice Python
## lo rende invalido e faceva sparire soltanto gli snapshot posizioni.
static func _script_arg_index(argv: PackedStringArray) -> int:
	for i in argv.size() - 1:
		if i == 0 or (argv[i] != "-lc" and argv[i] != "-c"):
			continue
		var runner := str(argv[i - 1]).get_file()
		if runner in ["sh", "bash"] or runner.begins_with("python"):
			return i + 1
	return -1


static func _redirected_script(argv: PackedStringArray, script_at: int,
		name: String) -> String:
	var runner := str(argv[script_at - 2]).get_file() if script_at >= 2 else ""
	if runner.begins_with("python"):
		# La redirezione vive nel processo Python: niente shell host/container e
		# stdout UTF-8 identico su macOS, Linux e Windows.
		return ("import sys;_jht_out=open('/jht_home/%s','w',encoding='utf-8');" \
				+ "sys.stdout=_jht_out;sys.stderr=_jht_out;%s") % [name, argv[script_at]]
	return "exec >/jht_home/%s 2>&1; %s" % [name, argv[script_at]]


static var _exec_seq := 0

## Esecuzione SENZA pipe: l'output viene rediretto dentro il container su un
## file del bind mount ~/.jht, che il gioco poi legge dal disco dell'host.
##
## Perché non i pipe: su Windows la lettura di un pipe BLOCCA il thread
## finché non arrivano byte o il figlio non chiude. Col container occupato e
## uno storico grande, il gioco riempiva stdout, restava fermo su una stderr
## muta e il poll non tornava più — niente agenti reali, niente chat, e
## all'uscita l'intera finestra appesa perché stop() aspetta quel thread
## (T440s, 25/07: il gioco si è chiuso nell'istante in cui è stato ucciso il
## docker rimasto in volo). Nessun timeout nel ciclo di lettura può salvare
## una situazione simile: il thread non arriva nemmeno a controllarlo.
##
## Senza pipe restiamo invece padroni del tempo — `is_process_running` non
## blocca mai — e per giunta il file torna in UTF-8 pulito, senza il codepage
## OEM che corrompeva accenti ed emoji.
func _run_via_file(argv: PackedStringArray, script_at: int,
		prefix: String) -> Dictionary:
	_exec_seq += 1
	var name := ".jht-exec-%d.out" % _exec_seq
	var host_path := _local_jht_home().path_join(name)
	var patched := argv.duplicate()
	patched[script_at] = _redirected_script(argv, script_at, name)
	var pid := OS.create_process("docker", patched, false)
	if pid <= 0:
		return {"code": -1, "out": "processo docker non avviabile"}
	var started := Time.get_ticks_msec()
	while OS.is_process_running(pid):
		if _stop:
			OS.kill(pid)
			DirAccess.remove_absolute(host_path)
			return {"code": -1, "out": ""}
		if Time.get_ticks_msec() - started > STALL_MS:
			OS.kill(pid)
			DirAccess.remove_absolute(host_path)
			return {"code": -1, "out": "comando docker senza risposta per %ds: %s"
					% [STALL_MS / 1000, argv[script_at].left(60)]}
		OS.delay_msec(20)
	var out := ""
	if FileAccess.file_exists(host_path):
		out = FileAccess.get_file_as_string(host_path)
		DirAccess.remove_absolute(host_path)
	return {"code": OS.get_process_exit_code(pid), "out": prefix + out}


## ~/.jht sull'host: l'altra faccia del bind mount /jht_home.
static func _local_jht_home() -> String:
	var home := OS.get_environment("JHT_HOME")
	if home != "":
		return home.rstrip("/\\")
	home = OS.get_environment("USERPROFILE") if OS.get_name() == "Windows" \
			else OS.get_environment("HOME")
	return home.rstrip("/\\").path_join(".jht")

func _ssh(command: String) -> Dictionary:
	# Il probe di _run è l'unico comando non-docker: si emula l'echo.
	var prefix := ""
	if command.begins_with("echo JHT_OK; "):
		command = command.trim_prefix("echo JHT_OK; ")
		prefix = "JHT_OK\n"
	var argv := _docker_argv(command)
	if argv.is_empty():
		return {"code": -1,
				"out": "comando host non disponibile in locale: " + command.left(60)}
	# Gli exec con script (poll, query, tutto ciò che può produrre parecchio
	# output) passano dal bind mount invece che dai pipe: vedi _run_via_file.
	var script_at := _script_arg_index(argv)
	if script_at >= 0:
		return _run_via_file(argv, script_at, prefix)
	# MAI OS.execute: su Windows decodifica lo stdout del figlio col codepage
	# ANSI (cp1252), corrompendo accenti ed emoji delle risposte agente
	# (à→Ã, 👋→ðŸ'‹ — onboarding Codex, Leone 24/07). Come _ssh_stdin_file,
	# leggiamo i byte grezzi dal pipe e li decodifichiamo UTF-8 a mano, così il
	# testo del container arriva intatto. read_stderr dell'ex-OS.execute =
	# drenare anche il pipe stderr e concatenarlo.
	var proc := OS.execute_with_pipe("docker", argv, true)
	if proc.is_empty():
		return {"code": -1, "out": "processo docker non avviabile"}
	var stdout_pipe: FileAccess = proc["stdio"]
	var stderr_pipe: FileAccess = proc["stderr"]
	var pid := int(proc["pid"])
	var output_bytes := PackedByteArray()
	var started := Time.get_ticks_msec()
	var last_data := started
	# Un read corto NON è EOF (stesso fix del trasporto SSH, 19/07): si legge
	# finché il processo vive, poi si svuota il residuo dei pipe.
	while true:
		var chunk := stdout_pipe.get_buffer(65536)
		output_bytes.append_array(chunk)
		var echunk := stderr_pipe.get_buffer(65536)
		output_bytes.append_array(echunk)
		if chunk.size() > 0 or echunk.size() > 0:
			last_data = Time.get_ticks_msec()
		if chunk.size() == 0 and echunk.size() == 0:
			if not OS.is_process_running(pid):
				break
			# Uscita in corso: stop() fa wait_to_finish() sul thread del poll;
			# se restiamo appesi qui su un docker exec in volo, l'INTERA finestra
			# si freeza finché l'exec non finisce (Leone 24/07). Molliamo:
			# uccidiamo il processo ed usciamo subito.
			if _stop:
				OS.kill(pid)
				break
			# Un docker che non parla più è un docker che non parlerà mai: il
			# CLI resta vivo a CPU zero e il thread del poll con lui, quindi
			# roster, chat e agenti reali non arrivano MAI al gioco — l'utente
			# vede lo showroom per sempre e crede che il team non sia partito
			# (T440s, 25/07). Meglio troncare e riprovare al giro dopo.
			if Time.get_ticks_msec() - last_data > STALL_MS:
				OS.kill(pid)
				stdout_pipe.close()
				stderr_pipe.close()
				return {"code": -1, "out": "comando docker senza risposta per %ds: %s"
						% [STALL_MS / 1000, command.left(70)]}
			OS.delay_msec(5)
	stdout_pipe.close()
	stderr_pipe.close()
	while OS.is_process_running(pid) and not _stop:
		OS.delay_msec(5)
	return {"code": OS.get_process_exit_code(pid),
			"out": prefix + output_bytes.get_string_from_utf8()}


## Versione locale del pipe binario usato per upload, script Python e tmux
## load-buffer. stdout viene riversato su stderr COME NEL trasporto SSH, ma
## il redirect vive nella sh del container (PowerShell 5.1 non ha 1>&2):
## così stdin si può chiudere (EOF per python3/tee) continuando a drenare
## l'output dal pipe stderr separato.
func _ssh_stdin_file(local_file: String, command: String) -> Dictionary:
	var exec_prefix := "docker exec -i jht "
	if not command.begins_with(exec_prefix):
		return {"code": -1,
				"out": "comando host non disponibile in locale: " + command.left(60)}
	var payload := FileAccess.get_file_as_bytes(local_file)
	if payload.is_empty() and FileAccess.get_open_error() != OK:
		return {"code": -1, "out": "file temporaneo non leggibile"}
	var args := PackedStringArray(["exec", "-i", "jht", "sh", "-c",
			command.trim_prefix(exec_prefix) + " 1>&2"])
	var process := OS.execute_with_pipe("docker", args, true)
	if process.is_empty():
		return {"code": -1, "out": "processo locale non avviabile"}
	var stdio: FileAccess = process["stdio"]
	var stderr: FileAccess = process["stderr"]
	stdio.store_buffer(payload)
	stdio.close()
	# Un read corto NON è EOF (stesso fix del trasporto SSH, 19/07): si
	# legge finché il processo vive, poi si svuota il residuo del pipe.
	var pid := int(process["pid"])
	var output_bytes := PackedByteArray()
	while true:
		var chunk := stderr.get_buffer(65536)
		output_bytes.append_array(chunk)
		if chunk.size() == 0:
			if not OS.is_process_running(pid):
				break
			# Uscita in corso: non tenere appesa la UI sul join (vedi _ssh).
			if _stop:
				OS.kill(pid)
				break
			OS.delay_msec(5)
	stderr.close()
	while OS.is_process_running(pid) and not _stop:
		OS.delay_msec(5)
	return {"code": OS.get_process_exit_code(pid),
			"out": output_bytes.get_string_from_utf8()}


## `docker <resto>` → argv per OS.execute, rispettando i blocchi a apici
## singoli POSIX (diventano UN argomento, apici esclusi). I comandi del
## backend non contengono mai l'escape '\'' né doppi apici: la grammatica
## qui è deliberatamente solo quella che VpsBackend produce.
static func _docker_argv(command: String) -> PackedStringArray:
	if not command.begins_with("docker "):
		return PackedStringArray()
	var rest := command.trim_prefix("docker ")
	var args := PackedStringArray()
	var current := ""
	var quoted := false
	var pending := false  # un '' esplicito produce un argomento vuoto
	for i in rest.length():
		var ch := rest[i]
		if ch == "'":
			quoted = not quoted
			pending = true
		elif ch == " " and not quoted:
			if pending or current != "":
				args.append(current)
			current = ""
			pending = false
		else:
			current += ch
	if pending or current != "":
		args.append(current)
	return args
