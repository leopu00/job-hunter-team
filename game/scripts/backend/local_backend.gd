class_name LocalBackend
extends VpsBackend
## Backend del container locale. Riusa integralmente il contratto e i parser
## del backend VPS, sostituendo soltanto il trasporto SSH con comandi eseguiti
## sul computer dell'utente. In questo modo onboarding, chat, profilo, roster,
## posizioni e telemetria non hanno due implementazioni divergenti.


func start(_config: Dictionary) -> void:
	live = true
	_ip = "questo computer"
	_stop = false
	bus.publish_state(BackendBus.CONNECTING, "collegamento al container locale…")
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
	# Un read corto NON è EOF (stesso fix del trasporto SSH, 19/07): si legge
	# finché il processo vive, poi si svuota il residuo dei pipe.
	while true:
		var chunk := stdout_pipe.get_buffer(65536)
		output_bytes.append_array(chunk)
		var echunk := stderr_pipe.get_buffer(65536)
		output_bytes.append_array(echunk)
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
