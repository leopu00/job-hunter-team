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


## Esegue una command line interna al backend. Le sole parti variabili che
## arrivano dall'utente (chat/profilo/ticket) non attraversano questa shell:
## viaggiano su stdin/base64 nei metodi ereditati da VpsBackend.
func _ssh(command: String) -> Dictionary:
	var out: Array = []
	var code := -1
	if OS.get_name() == "Windows":
		code = OS.execute("powershell.exe", ["-NoProfile", "-NonInteractive",
				"-Command", command], out, true)
	else:
		code = OS.execute("/bin/sh", ["-lc", command], out, true)
	return {"code": code, "out": "\n".join(PackedStringArray(out))}


## Versione locale del pipe binario usato per upload, script Python e tmux
## load-buffer. stdout viene riversato su stderr come nel trasporto SSH, così
## possiamo chiudere stdin e drenare l'output senza deadlock.
func _ssh_stdin_file(local_file: String, command: String) -> Dictionary:
	var payload := FileAccess.get_file_as_bytes(local_file)
	if payload.is_empty() and FileAccess.get_open_error() != OK:
		return {"code": -1, "out": "file temporaneo non leggibile"}
	var shell := "powershell.exe" if OS.get_name() == "Windows" else "/bin/sh"
	var args := PackedStringArray(["-NoProfile", "-NonInteractive", "-Command",
			command + " 1>&2"]) if OS.get_name() == "Windows" \
			else PackedStringArray(["-lc", command + " 1>&2"])
	var process := OS.execute_with_pipe(shell, args, true)
	if process.is_empty():
		return {"code": -1, "out": "processo locale non avviabile"}
	var stdio: FileAccess = process["stdio"]
	var stderr: FileAccess = process["stderr"]
	stdio.store_buffer(payload)
	stdio.close()
	var output_bytes := PackedByteArray()
	while true:
		var chunk := stderr.get_buffer(65536)
		output_bytes.append_array(chunk)
		if chunk.size() < 65536:
			break
	stderr.close()
	var pid := int(process["pid"])
	while OS.is_process_running(pid):
		OS.delay_msec(5)
	return {"code": OS.get_process_exit_code(pid),
			"out": output_bytes.get_string_from_utf8()}
