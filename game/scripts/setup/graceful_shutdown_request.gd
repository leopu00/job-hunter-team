extends RefCounted
## Send the order through an injected command runner; exit zero is the acknowledgement.

static func request(run: Callable, ready_flag: String) -> bool:
	var cleared: Dictionary = run.call("docker", PackedStringArray([
			"exec", "jht", "rm", "-f", ready_flag]))
	if int(cleared.get("code", -1)) != 0:
		report("shutdown.not_delivered")
		return false
	var order := "[@utente -> @capitano] [SHUTDOWN] L'utente sta chiudendo " \
			+ "l'applicazione. Usa la skill graceful-shutdown: fai annotare a " \
			+ "ogni agente lo stato del lavoro in corso sulla propria agenda, " \
			+ "poi fermali uno a uno e infine crea il flag " \
			+ ready_flag + " che chiude l'applicazione."
	var result: Dictionary = run.call("docker", PackedStringArray([
			"exec", "jht", "jht-tmux-send", "CAPITANO", order]))
	if int(result.get("code", -1)) != 0:
		report("shutdown.not_delivered")
		return false
	return true


static func report(code: String) -> void:
	var line := "%s: %s" % [code, UIStrings.t(code)]
	Log.warn("shutdown", line)
	var path := "user://runtime.log"
	var mode := FileAccess.READ_WRITE if FileAccess.file_exists(path) else FileAccess.WRITE
	var file := FileAccess.open(path, mode)
	if file == null:
		Log.warn("shutdown", "delivery_state_unavailable: runtime.log")
		return
	file.seek_end()
	file.store_line(line)
	file.flush()
