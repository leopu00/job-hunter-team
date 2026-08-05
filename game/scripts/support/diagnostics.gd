class_name Diagnostics
## Fotografia della macchina e del runtime da allegare a una segnalazione.
##
## Regola di progetto: NON dipende dal container. I bug che fanno più male sono
## proprio quelli in cui il runtime non parte, e in quello scenario `jht doctor`
## non risponde — una diagnostica che si può raccogliere solo a container vivo è
## inutile esattamente quando serve. Qui ogni sonda è indipendente e degrada da
## sola: se Docker manca, "Docker: non installato" È il dato diagnostico.
##
## Tutto ciò che esce da qui è già passato dal Redactor. Nessun chiamante deve
## potersi dimenticare di ripulire: la sanificazione sta dentro `collect()`.
##
## `collect()` esegue processi esterni (docker) e legge file: va invocata da un
## Thread, mai dal main loop, o la finestra si pianta per la durata delle sonde.

## Cap sui log allegati. Si prende la CODA: il crash sta alla fine, e un bundle
## da decine di MB non lo apre né lo carica nessuno.
const MAX_LOG_LINES := 400
const MAX_LOG_CHARS := 120_000
const CONTAINER_LOG_LINES := 200


## Il bundle completo, già ripulito.
## `{"app":…, "system":…, "runtime":…, "logs":…, "redaction":{regola: quante}}`
static func collect(include_game_log := true, include_container_log := true,
		context: Dictionary = {}) -> Dictionary:
	var bundle := {
		"app": _app_section(),
		"system": _system_section(context),
		"runtime": _runtime_section(context),
		"logs": {},
	}
	if include_game_log:
		bundle["logs"]["game"] = _tail_file("user://jht-game.log")
		# Dopo un crash il log corrente riparte vuoto: la diagnosi vive nel
		# .prev.log, ed è proprio il caso in cui serve (vedi log.gd).
		var prev := _tail_file("user://jht-game.prev.log")
		if prev != "":
			bundle["logs"]["game_previous"] = prev
	if include_container_log:
		bundle["logs"]["container"] = _container_log()
	return _sanitize(bundle, context)


## Legge gli autoload solo dal main thread. `collect()` gira normalmente nel
## thread della segnalazione: interrogare lo SceneTree da lì fa fallire proprio
## il pannello che deve restare disponibile quando l'app ha un problema.
static func capture_context() -> Dictionary:
	var context := {"sensitive_terms": PackedStringArray()}
	var game := _autoload("Game")
	if game != null:
		context["low_gfx"] = bool(game.get("low_gfx"))
	var setup := _autoload("SetupService")
	if setup != null:
		context["setup_status"] = (setup.get("status") as Dictionary).duplicate(true)
	var bus := _autoload("BackendBus")
	if bus != null:
		context["backend_live"] = bool(bus.call("is_live"))
	var onboarding := _autoload("ScriptedOnboarding")
	if onboarding != null:
		var full := str(onboarding.call("player_full_name"))
		for part in full.split(" ", false):
			var clean := str(part).strip_edges()
			if clean.length() >= 3:
				context["sensitive_terms"].append(clean)
	return context


## I termini che identificano l'utente e vanno tolti dai log oltre alle regole
## strutturali: come si è presentato all'ingresso dell'ufficio.
static func sensitive_terms(context: Dictionary = {}) -> PackedStringArray:
	if context.has("sensitive_terms"):
		return context["sensitive_terms"]
	# I tool headless chiamano collect dal main thread e non costruiscono gli
	# autoload: nessun termine aggiuntivo è comunque un risultato sicuro.
	return PackedStringArray()


## Rendering leggibile del bundle: è sia l'anteprima che l'utente ispeziona
## prima di inviare, sia il corpo dell'issue che arriva a noi. Un solo formato
## per entrambi, così quello che vede è letteralmente quello che parte.
static func to_markdown(bundle: Dictionary) -> String:
	var out := ""
	for section in ["app", "system", "runtime"]:
		var data: Dictionary = bundle.get(section, {})
		if data.is_empty():
			continue
		out += "### %s\n\n" % section.capitalize()
		for key in data:
			out += "- **%s**: %s\n" % [key, str(data[key])]
		out += "\n"
	var logs: Dictionary = bundle.get("logs", {})
	for key in logs:
		var text := str(logs[key])
		if text.strip_edges() == "":
			continue
		out += "### Log: %s\n\n```text\n%s\n```\n\n" % [key, text]
	var redaction: Dictionary = bundle.get("redaction", {})
	if not redaction.is_empty():
		var parts := PackedStringArray()
		for key in redaction:
			parts.append("%s×%d" % [key, int(redaction[key])])
		out += "### Dati rimossi prima dell'invio\n\n%s\n" % ", ".join(parts)
	return out


# ── Sonde ────────────────────────────────────────────────────────────

static func _app_section() -> Dictionary:
	return {
		"versione": ProjectSettings.get_setting("application/config/version", "dev"),
		"motore": Engine.get_version_info().get("string", "?"),
		"lingua UI": UIStrings.lang,
		"sessione": "%d s" % int(Time.get_ticks_msec() / 1000.0),
		"debug build": OS.is_debug_build(),
	}


static func _system_section(context: Dictionary) -> Dictionary:
	var mem := OS.get_memory_info()
	var data := {
		"sistema": "%s %s" % [OS.get_name(), OS.get_version()],
		"processore": "%s (%d core)" % [OS.get_processor_name(),
				OS.get_processor_count()],
		"locale": OS.get_locale(),
		"RAM disponibile": "%.1f GB" % (float(mem.get("available", 0)) / 1073741824.0),
	}
	if OS.get_name() == "Linux":
		data["distribuzione"] = OS.get_distribution_name()
	# La GPU è la prima cosa da guardare sui report "va a scatti": un adapter
	# software (llvmpipe, WARP, SwiftShader) spiega da solo i 12 fps.
	data["video"] = "%s — %s" % [RenderingServer.get_video_adapter_name(),
			RenderingServer.get_video_adapter_api_version()]
	if DisplayServer.get_name() != "headless":
		data["schermo"] = "%s (finestra %s)" % [
				DisplayServer.screen_get_size(), DisplayServer.window_get_size()]
	if context.has("low_gfx"):
		data["grafica ridotta"] = bool(context["low_gfx"])
	return data


## Stato del runtime JHT visto dal lato host: quello che il gioco sa senza
## dover parlare col container.
static func _runtime_section(context: Dictionary) -> Dictionary:
	var data := {}
	if context.has("setup_status"):
		var status: Dictionary = context["setup_status"]
		for key in ["docker_available", "docker_running", "container_exists",
				"container_state", "container_running", "team_running",
				"active_provider", "provider_authenticated", "runtime_stale"]:
			data[key] = status.get(key, "?")
	else:
		# Senza autoload (selftest headless) le sonde base restano possibili.
		# Stesso criterio di setup_service._exec_present ma replicato SENZA
		# caricare quello script: questa sonda può girare prima che gli
		# autoload esistano, dove setup_service.gd non compila e la sua load
		# fallita resterebbe in cache per tutti (vedi pull_stream_selftest).
		# Il vecchio `code != -1` diceva "installato" anche su POSIX senza
		# docker: lì un comando assente esce 127 via shell (126 = trovato ma
		# non eseguibile), mai -1 — quello è solo il lancio fallito di Windows.
		var version := _run("docker", PackedStringArray(["version", "--format",
				"{{.Server.Version}}"]))
		var code := int(version.get("code", -1))
		data["docker_available"] = code != -1 and code != 126 and code != 127
		data["docker_running"] = code == 0
	if context.has("backend_live"):
		# MAI l'IP della VPS: identifica l'infrastruttura dell'utente. Il modo
		# di connessione basta a inquadrare il problema.
		data["backend"] = "VPS" if bool(context["backend_live"]) else "locale"
	data["cartella dati presente"] = DirAccess.dir_exists_absolute(_jht_home())
	var docker_version := _run("docker", PackedStringArray(["version", "--format",
			"{{.Client.Version}} / server {{.Server.Version}}"]))
	data["docker"] = str(docker_version.get("out", "")).strip_edges() \
			if int(docker_version.get("code", -1)) == 0 else "non disponibile"
	var containers := _run("docker", PackedStringArray(["ps", "-a", "--filter",
			"name=jht", "--format", "{{.Names}} {{.Status}} ({{.Image}})"]))
	if int(containers.get("code", -1)) == 0:
		var listing := str(containers.get("out", "")).strip_edges()
		data["container"] = listing if listing != "" else "nessuno"
	return data


static func _container_log() -> String:
	var logs := _run("docker", PackedStringArray(["logs", "--tail",
			str(CONTAINER_LOG_LINES), "jht"]))
	if int(logs.get("code", -1)) != 0:
		# Il fallimento è esso stesso diagnostico: dice che il container non
		# c'è o non risponde, che è metà della risposta su un bug di avvio.
		return "[log container non disponibili] " + str(logs.get("out", "")).strip_edges()
	return _tail_text(str(logs.get("out", "")))


# ── Utilità ──────────────────────────────────────────────────────────

## Ripulisce OGNI stringa del bundle e allega il rendiconto. Ricorsiva: nessun
## campo aggiunto in futuro può sfuggire alla redazione per dimenticanza.
static func _sanitize(bundle: Dictionary, context: Dictionary = {}) -> Dictionary:
	var terms := sensitive_terms(context)
	var counts := {}
	var clean: Dictionary = _sanitize_value(bundle, terms, counts)
	clean["redaction"] = counts
	return clean


static func _sanitize_value(value: Variant, terms: PackedStringArray,
		counts: Dictionary) -> Variant:
	if value is String:
		var report: Dictionary = Redactor.redact_with_report(value, terms)
		for key in report["counts"]:
			counts[key] = int(counts.get(key, 0)) + int(report["counts"][key])
		return report["text"]
	if value is Dictionary:
		var out := {}
		for key in value:
			out[key] = _sanitize_value(value[key], terms, counts)
		return out
	if value is Array:
		var arr := []
		for item in value:
			arr.append(_sanitize_value(item, terms, counts))
		return arr
	return value


static func _tail_file(path: String) -> String:
	if not FileAccess.file_exists(path):
		return ""
	var text := FileAccess.get_file_as_string(path)
	if text == "":
		return ""
	return _tail_text(text)


static func _tail_text(text: String) -> String:
	var lines := text.split("\n", false)
	var start := maxi(0, lines.size() - MAX_LOG_LINES)
	var kept := PackedStringArray()
	for i in range(start, lines.size()):
		kept.append(lines[i])
	var out := "\n".join(kept)
	if out.length() > MAX_LOG_CHARS:
		out = "[…troncato…]\n" + out.substr(out.length() - MAX_LOG_CHARS)
	if start > 0:
		out = "[…%d righe precedenti omesse…]\n" % start + out
	return out


static func _run(path: String, args: PackedStringArray) -> Dictionary:
	var output: Array = []
	var code := OS.execute(path, args, output, true)
	return {"code": code, "out": "\n".join(PackedStringArray(output))}


static func _jht_home() -> String:
	var home := OS.get_environment("JHT_HOME")
	if home != "":
		return home.rstrip("/\\")
	home = OS.get_environment("USERPROFILE") if OS.get_name() == "Windows" \
			else OS.get_environment("HOME")
	return home.rstrip("/\\").path_join(".jht")


## Gli autoload non esistono sotto `godot --script` (i selftest headless): si
## accede per nome e si accetta che manchino, invece di far esplodere il grafo
## di dipendenze con un riferimento diretto.
static func _autoload(node_name: String) -> Node:
	var tree := Engine.get_main_loop() as SceneTree
	if tree == null or tree.root == null:
		return null
	return tree.root.get_node_or_null(node_name)
