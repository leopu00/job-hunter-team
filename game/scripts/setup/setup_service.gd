extends Node
## Stato e azioni del primo setup. L'ufficio non viene mai bloccato: questo
## servizio espone i tre prerequisiti che rendono operativo il team locale.

signal status_changed(status: Dictionary)
signal action_changed(action: String, running: bool, message: String, ok: bool)
## La UI del gioco ospita il processo in una console modale. Il servizio non
## deve mai aprire Terminal.app/cmd/xterm fuori dall'applicazione.
signal terminal_requested(context: String, spec: Dictionary)

const PROVIDERS := {
	"claude": {
		"name": "Claude Code", "vendor": "Anthropic · Claude Pro / Max",
		"config_id": "claude", "install_id": "claude",
		"subscribe": "https://claude.com/pricing",
	},
	"codex": {
		"name": "Codex", "vendor": "OpenAI · ChatGPT Plus / Pro",
		"config_id": "openai", "install_id": "codex",
		"subscribe": "https://chatgpt.com/pricing",
	},
	"kimi": {
		"name": "Kimi", "vendor": "Moonshot · Kimi paid plan",
		"config_id": "kimi", "install_id": "kimi",
		"subscribe": "https://www.kimi.com/membership/pricing",
	},
}

const AUTH_PATHS := {
	"claude": [".claude/.credentials.json", ".claude/credentials.json",
			".config/claude/credentials.json", ".config/claude/auth.json"],
	"codex": [".codex/auth.json", ".codex/credentials.json",
			".config/codex/credentials.json"],
	"kimi": [".kimi/credentials/kimi-code.json",
			".config/kimi-cli/credentials.json", ".kimi/kimi.json",
			".kimi/config.json", ".kimi/credentials.json",
			".config/kimi/config.json"],
}

var status := {
	"docker_available": false, "docker_running": false,
	"container_exists": false, "container_running": false,
	"container_state": "missing", "active_provider": "",
	"provider_authenticated": false, "provider_auth_match": "",
	"profile_ready": false, "team_running": false,
	"ready": false, "completed": 0,
}

var _probe_running := false
var _action_running := false
var _timer: Timer


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	terminal_requested.connect(_show_embedded_terminal)
	_timer = Timer.new()
	_timer.wait_time = 3.0
	_timer.autostart = true
	_timer.timeout.connect(refresh)
	add_child(_timer)
	BackendBus.profile_status_updated.connect(_on_profile_status)
	BackendBus.connection_changed.connect(_on_backend_connection)
	refresh()


func _show_embedded_terminal(context: String, spec: Dictionary) -> void:
	# Ospitato dall'autoload: il terminale funziona anche quando il comando
	# parte da una conversazione scripted e nessun pannello Impostazioni è
	# aperto. Una sola console interattiva alla volta.
	for existing in get_tree().get_nodes_in_group("embedded_terminal"):
		if is_instance_valid(existing):
			existing.queue_free()
	var terminal := EmbeddedTerminal.new(context, spec)
	get_tree().root.add_child(terminal)


func refresh() -> void:
	if _probe_running or _action_running:
		return
	_probe_running = true
	WorkerThreadPool.add_task(_probe)


func _probe() -> void:
	var next := _probe_host(_jht_home())
	# Alcuni self-test Godot chiudono l'albero subito dopo l'assert mentre il
	# probe Docker è ancora nel worker. Non accodare callback su un autoload
	# già smontato durante il teardown.
	if is_instance_valid(self) and not is_queued_for_deletion():
		call_deferred("_apply_probe", next)


func _apply_probe(next: Dictionary) -> void:
	_probe_running = false
	if BackendBus.is_live():
		# In modalità VPS il container vive dall'altra parte di SSH: non deve
		# risultare "spento" solo perché sul portatile non esiste un jht locale.
		next["remote"] = true
		next["docker_available"] = true
		next["docker_running"] = true
		next["container_exists"] = true
		next["container_running"] = true
		next["container_state"] = "running · VPS"
		next["team_running"] = not BackendBus.agents.is_empty()
		var remote_provider := _ui_provider_id(str(
				BackendBus.live_settings.get("active_provider", "")))
		if remote_provider != "":
			next["active_provider"] = remote_provider
			next["provider_authenticated"] = bool(
					BackendBus.live_settings.get("provider_auth_ready", false))
			next["provider_auth_match"] = "VPS" \
					if next["provider_authenticated"] else ""
	# Il backend conosce anche il caso checklist completa senza ready.flag.
	if bool(BackendBus.profile_status.get("ready", false)):
		next["profile_ready"] = true
	_finalize(next)
	status = next
	status_changed.emit(status.duplicate(true))
	if bool(status.get("container_running", false)) \
			and BackendBus.state == BackendBus.DISCONNECTED:
		BackendBus.connect_local_backend()


func _finalize(next: Dictionary) -> void:
	var completed := 0
	completed += 1 if bool(next.get("container_running", false)) else 0
	completed += 1 if bool(next.get("provider_authenticated", false)) else 0
	completed += 1 if bool(next.get("profile_ready", false)) else 0
	next["completed"] = completed
	next["ready"] = completed == 3


func _on_profile_status(_profile: Dictionary, _required: Dictionary, ready: bool) -> void:
	if bool(status.get("profile_ready", false)) == ready:
		return
	status["profile_ready"] = ready
	_finalize(status)
	status_changed.emit(status.duplicate(true))


func _on_backend_connection(state: int, _detail: String) -> void:
	if state == BackendBus.CONNECTED:
		BackendBus.open_profile_watch()
	refresh()


static func _jht_home() -> String:
	var home := OS.get_environment("JHT_HOME")
	if home != "":
		return home.rstrip("/\\")
	home = OS.get_environment("USERPROFILE") if OS.get_name() == "Windows" \
			else OS.get_environment("HOME")
	return home.rstrip("/\\").path_join(".jht")


static func _run(path: String, args: PackedStringArray) -> Dictionary:
	var output: Array = []
	var code := OS.execute(path, args, output, true)
	return {"code": code, "out": "\n".join(PackedStringArray(output)).strip_edges()}


static func _probe_host(home: String) -> Dictionary:
	var d := {
		"docker_available": false, "docker_running": false,
		"container_exists": false, "container_running": false,
		"container_state": "missing", "active_provider": "",
		"provider_authenticated": false, "provider_auth_match": "",
		"profile_ready": FileAccess.file_exists(home.path_join("profile/ready.flag")),
		"team_running": false,
	}
	var version := _run("docker", PackedStringArray(["version", "--format",
			"{{.Client.Version}}|{{.Server.Version}}"] ))
	d["docker_available"] = version["code"] != -1
	d["docker_running"] = version["code"] == 0
	if d["docker_running"]:
		var inspect := _run("docker", PackedStringArray(["inspect", "jht",
				"--format", "{{.State.Status}}"] ))
		d["container_exists"] = inspect["code"] == 0
		if inspect["code"] == 0:
			d["container_state"] = str(inspect["out"]).strip_edges()
			d["container_running"] = d["container_state"] == "running"
		if d["container_running"]:
			var tmux := _run("docker", PackedStringArray(["exec", "jht", "tmux",
					"list-sessions", "-F", "#{session_name}"] ))
			d["team_running"] = tmux["code"] == 0 and str(tmux["out"]) != ""
	var config := _read_json(home.path_join("jht.config.json"))
	var active := _ui_provider_id(str(config.get("active_provider", "")))
	d["active_provider"] = active
	if active != "":
		var match := auth_match(active, home)
		d["provider_auth_match"] = match
		d["provider_authenticated"] = match != ""
	return d


static func _read_json(path: String) -> Dictionary:
	if not FileAccess.file_exists(path):
		return {}
	var value: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	return value if value is Dictionary else {}


static func _ui_provider_id(value: String) -> String:
	match value.strip_edges().to_lower():
		"claude", "anthropic": return "claude"
		"codex", "openai": return "codex"
		"kimi", "moonshot": return "kimi"
	return ""


static func auth_match(provider: String, home: String) -> String:
	for rel in AUTH_PATHS.get(provider, []):
		var path := home.path_join(rel)
		if not FileAccess.file_exists(path):
			continue
		var f := FileAccess.open(path, FileAccess.READ)
		if f != null and f.get_length() > 0:
			f.close()
			return rel
		if f != null:
			f.close()
	return ""


func select_provider(provider: String) -> void:
	if not PROVIDERS.has(provider) or _action_running:
		return
	_start_action("provider", _do_select_provider.bind(provider, _vps_config()))


func _do_select_provider(provider: String, vps: Dictionary) -> Dictionary:
	if not vps.is_empty():
		var remote := _run_ssh(vps, "docker exec jht node /app/cli/bin/jht.js " \
				+ "providers use " + str(PROVIDERS[provider]["install_id"]))
		return {"ok": remote["code"] == 0,
				"message": "Provider selezionato sulla VPS: " \
				+ str(PROVIDERS[provider]["name"]) if remote["code"] == 0 \
				else "Selezione provider fallita: " + str(remote["out"]).right(240)}
	var home := _jht_home()
	DirAccess.make_dir_recursive_absolute(home)
	var path := home.path_join("jht.config.json")
	var config := _read_json(path)
	var config_id := str(PROVIDERS[provider]["config_id"])
	config["active_provider"] = config_id
	var providers: Dictionary = config.get("providers", {}) \
			if config.get("providers", {}) is Dictionary else {}
	var provider_config: Dictionary = providers.get(config_id, {}) \
			if providers.get(config_id, {}) is Dictionary else {}
	provider_config["auth_method"] = "subscription"
	providers[config_id] = provider_config
	config["providers"] = providers
	var tmp := path + ".game-tmp"
	var f := FileAccess.open(tmp, FileAccess.WRITE)
	if f == null:
		return {"ok": false, "message": "config non scrivibile"}
	f.store_string(JSON.stringify(config, "  ") + "\n")
	f.close()
	var err := DirAccess.rename_absolute(tmp, path)
	return {"ok": err == OK,
			"message": "Provider selezionato: " + str(PROVIDERS[provider]["name"])
			if err == OK else "impossibile salvare il provider"}


func start_container() -> void:
	if _action_running:
		return
	_start_action("container", _do_start_container)


func stop_container() -> void:
	if _action_running:
		return
	_start_action("container", _do_stop_container.bind(_vps_config()))


static func _do_stop_container(vps: Dictionary) -> Dictionary:
	var result := _run_ssh(vps, "docker stop jht") if not vps.is_empty() \
			else _run("docker", PackedStringArray(["stop", "jht"]))
	return {"ok": result["code"] == 0,
			"message": "Container JHT fermato" if result["code"] == 0 \
			else "Arresto container fallito: " + str(result.get("out", "")).right(220)}


## Flusso "ATTIVA CONTAINER" (porting della logica desktop Electron,
## regola detect-first): daemon giù → avvia il runtime installato e POLLA
## finché risponde (2s × 120s, progresso a video) → `docker start jht` →
## container assente → compose imbarcato + `compose up` nel terminale
## visibile (il pull dell'immagine GHCR è lungo: l'utente deve vederlo).
func _do_start_container() -> Dictionary:
	Log.call_deferred("info", "setup", "attiva container: probe del daemon Docker")
	var daemon := _run("docker", PackedStringArray(["version", "--format",
			"{{.Server.Version}}"] ))
	if daemon["code"] != 0:
		var launch := _launch_docker_runtime()
		if not bool(launch["ok"]):
			return launch
		_progress("container", str(launch["message"]))
		var waited := 0
		while waited < 120:
			OS.delay_msec(2000)
			waited += 2
			daemon = _run("docker", PackedStringArray(["version", "--format",
					"{{.Server.Version}}"] ))
			if daemon["code"] == 0:
				break
			_progress("container", "Avvio di Docker in corso… (%ds)" % waited)
		if daemon["code"] != 0:
			Log.call_deferred("warn", "setup", "docker non risponde dopo 120s")
			return {"ok": false, "message": "Docker non risponde dopo 2 minuti. " \
					+ "Aprilo manualmente (al primo avvio chiede di accettare i termini), poi riprova."}
		Log.call_deferred("info", "setup", "daemon Docker pronto (%ds)" % waited)
	var start := _run("docker", PackedStringArray(["start", "jht"] ))
	if start["code"] == 0:
		Log.call_deferred("info", "setup", "container jht avviato")
		return {"ok": true, "message": "Container JHT attivo"}
	# Il container non esiste ancora: prima attivazione via compose.
	var compose := _ensure_compose_file()
	if compose == "":
		return {"ok": false, "message": "Impossibile preparare il runtime in ~/.jht/runtime"}
	_ensure_host_dirs()
	Log.call_deferred("info", "setup", "prima attivazione: compose up da " + compose)
	call_deferred("_open_compose_terminal", compose)
	return {"ok": true, "message": "Prima attivazione: scarico l'immagine del team nel " \
			+ "terminale. Al termine la spia CONTAINER diventa verde da sola."}


static func _find_compose_file() -> String:
	var candidates := [
		_jht_home().path_join("runtime/docker-compose.yml"),
		ProjectSettings.globalize_path("res://../docker-compose.yml"),
	]
	var user_data := OS.get_user_data_dir().get_base_dir()
	candidates.append(user_data.path_join("app-payload/docker-compose.yml"))
	for path in candidates:
		if FileAccess.file_exists(path):
			return path
	return ""


## Il compose di produzione è image-only (GHCR): basta scriverlo su disco,
## niente payload da spedire. Copia funzionale di /docker-compose.yml.
const RUNTIME_COMPOSE := """# Job Hunter Team — runtime container (scritto dal gioco)
# Copia funzionale di docker-compose.yml del repo (image-only, GHCR).
services:
  jht:
    image: ${JHT_IMAGE:-ghcr.io/leopu00/jht:latest}
    container_name: jht
    command: ["pid1"]
    environment:
      - HOME=/jht_home
      - JHT_HOME=/jht_home
      - JHT_USER_DIR=/jht_user
      - JHT_HOST_TYPE=${JHT_HOST_TYPE:-}
      - JHT_LANG=${JHT_LANG:-en}
      - JHT_USER_TZ=${JHT_USER_TZ:-UTC}
      - IS_CONTAINER=1
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
      - OPENAI_API_KEY=${OPENAI_API_KEY:-}
      - MOONSHOT_API_KEY=${MOONSHOT_API_KEY:-}
      - NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL:-}
      - NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}
      - NEXT_PUBLIC_JHT_DEPLOY=${NEXT_PUBLIC_JHT_DEPLOY:-local}
      - WATCHPACK_POLLING=true
      - CHOKIDAR_USEPOLLING=true
      - TURBOPACK_WATCH_POLL=true
    volumes:
      - ${HOME}/.jht:/jht_home
      - ${HOME}/Documents/Job Hunter Team:/jht_user
    ports:
      - "127.0.0.1:3000:3000"
    stdin_open: true
    tty: true
    restart: unless-stopped
"""


static func _ensure_compose_file() -> String:
	var found := _find_compose_file()
	if found != "":
		return found
	var path := _jht_home().path_join("runtime/docker-compose.yml")
	DirAccess.make_dir_recursive_absolute(path.get_base_dir())
	var f := FileAccess.open(path, FileAccess.WRITE)
	if f == null:
		return ""
	f.store_string(RUNTIME_COMPOSE)
	f.close()
	return path


static func _ensure_host_dirs() -> void:
	# I bind-mount del compose: creati dall'app, non dal daemon (che su
	# alcune piattaforme li creerebbe con owner sbagliato).
	DirAccess.make_dir_recursive_absolute(_jht_home())
	var docs := OS.get_environment("USERPROFILE") if OS.get_name() == "Windows" \
			else OS.get_environment("HOME")
	DirAccess.make_dir_recursive_absolute(
			docs.rstrip("/\\").path_join("Documents/Job Hunter Team"))


func _open_compose_terminal(compose: String) -> void:
	var inner := "docker compose -f " + _local_quote(compose) + " up -d jht"
	var command := inner
	if OS.get_name() == "Windows":
		# ${HOME} nel compose non esiste nell'ambiente Windows: iniettato qui.
		command = "set \"HOME=%USERPROFILE%\" && " + inner
	terminal_requested.emit("container-setup", embedded_terminal_spec(
			"Prima attivazione del container",
			"Scarico l'immagine del team (qualche GB, dipende dalla rete). " \
			+ "Quando il comando termina puoi chiudere la console: la checklist si aggiorna da sola.",
			command))


const DOCKER_DESKTOP_WIN := "C:/Program Files/Docker/Docker/Docker Desktop.exe"

## Avvia il runtime Docker installato (mai installarne uno se un altro può
## già rispondere — regola detect-first, ADR-0006). Ritorna ok=false con
## istruzioni quando non c'è nulla da avviare.
static func _launch_docker_runtime() -> Dictionary:
	match OS.get_name():
		"Windows":
			if not FileAccess.file_exists(DOCKER_DESKTOP_WIN):
				return {"ok": false, "message": "Docker Desktop non è installato. " \
						+ "Usa INSTALLA / RIPARA RUNTIME qui sotto."}
			OS.create_process(DOCKER_DESKTOP_WIN, PackedStringArray())
			return {"ok": true, "message": "Docker Desktop avviato: attendo il motore…"}
		"macOS":
			if _run("colima", PackedStringArray(["version"] ))["code"] != -1:
				OS.create_process("colima", PackedStringArray(["start"]))
				return {"ok": true, "message": "Colima avviato: attendo il motore…"}
			if DirAccess.dir_exists_absolute("/Applications/Docker.app"):
				OS.create_process("open", PackedStringArray(["-a", "Docker"]))
				return {"ok": true, "message": "Docker Desktop avviato: attendo il motore…"}
			return {"ok": false, "message": "Nessun runtime Docker trovato. " \
					+ "Usa INSTALLA / RIPARA RUNTIME qui sotto."}
		_:
			return {"ok": false, "message": "Il servizio Docker è spento. " \
					+ "Avvialo con: sudo systemctl start docker"}


## Progresso intermedio di un'azione, emesso dal worker thread.
func _progress(action: String, message: String) -> void:
	call_deferred("emit_signal", "action_changed", action, true, message, true)


func install_provider(provider: String) -> void:
	if not PROVIDERS.has(provider) or _action_running:
		return
	_start_action("install", _do_install_provider.bind(provider, _vps_config()))


func _do_install_provider(provider: String, vps: Dictionary) -> Dictionary:
	var install_id := str(PROVIDERS[provider]["install_id"])
	var res := _run_ssh(vps, "docker exec -e IS_CONTAINER=1 jht node " \
			+ "/app/cli/bin/jht.js providers update " + install_id) \
			if not vps.is_empty() else _run("docker", PackedStringArray([
					"exec", "-e", "IS_CONTAINER=1", "jht", "node",
					"/app/cli/bin/jht.js", "providers", "update", install_id]))
	return {"ok": res["code"] == 0,
			"message": "%s installato" % PROVIDERS[provider]["name"] \
			if res["code"] == 0 else "Installazione fallita: " + str(res["out"]).right(240)}


func open_provider_login(provider: String) -> void:
	if not PROVIDERS.has(provider):
		return
	terminal_requested.emit("provider:" + provider,
			provider_login_spec(provider, _vps_config()))
	action_changed.emit("login", false,
			"Console di login aperta dentro Job Hunter Team", true)


func logout_provider(provider: String) -> void:
	if _action_running or not PROVIDERS.has(provider):
		return
	_start_action("provider", _do_logout_provider.bind(provider, _vps_config()))


static func _do_logout_provider(provider: String, vps: Dictionary) -> Dictionary:
	var paths: Array = AUTH_PATHS.get(provider, [])
	var result := {"code": 0, "out": ""}
	if vps.is_empty():
		for rel in paths:
			var path := _jht_home().path_join(str(rel))
			if FileAccess.file_exists(path):
				var err := DirAccess.remove_absolute(path)
				if err != OK:
					result = {"code": -1, "out": "impossibile rimuovere " + str(rel)}
	else:
		var remote_paths := PackedStringArray()
		for rel in paths:
			remote_paths.append("/jht_home/" + str(rel))
		result = _run_ssh(vps, "docker exec jht rm -f " + " ".join(remote_paths))
	return {"ok": result["code"] == 0,
			"message": "Sessione %s rimossa" % PROVIDERS[provider]["name"] \
			if result["code"] == 0 else "Logout fallito: " + str(result.get("out", "")).right(220)}


## Specifica argv per la console incorporata. `script` crea una PTY vera su
## macOS/Linux, necessaria ai menu raw-mode di Claude e Kimi. stdout viene
## portato sul pipe stderr: stdin resta interattivo tramite execute_with_pipe.
static func provider_login_spec(provider: String, vps: Dictionary = {}) -> Dictionary:
	return embedded_terminal_spec(str(PROVIDERS.get(provider, {}).get("name", provider)),
			_provider_terminal_hint(provider), _provider_login_command(provider, vps))


## Costruttore comune per qualunque comando tecnico ospitato nel gioco.
static func embedded_terminal_spec(title: String, hint: String, command: String) -> Dictionary:
	var path := "/bin/sh"
	var args := PackedStringArray()
	match OS.get_name():
		"macOS":
			args = PackedStringArray(["-lc", "script -q /dev/null /bin/sh -lc " \
					+ _shell_quote(command) + " 1>&2"])
		"Windows":
			path = "cmd.exe"
			# ConPTY non è ancora esposto da Godot: il device flow Codex resta
			# pienamente interattivo; Claude/Kimi ricevono comunque stdin.
			args = PackedStringArray(["/d", "/s", "/c", command + " 1>&2"])
		_:
			args = PackedStringArray(["-lc", "script -qefc " \
					+ _shell_quote(command) + " /dev/null 1>&2"])
	return {
		"path": path,
		"args": args,
		"title": title,
		"hint": hint,
	}


func open_technical_terminal(context: String, title: String, hint: String,
		container_args: PackedStringArray) -> void:
	var vps := _vps_config()
	var pieces := PackedStringArray(["docker", "exec",
			_exec_tty_flags(not vps.is_empty()), "jht"])
	for arg in container_args:
		# via VPS parsa la sh remota (POSIX); in locale la shell di piattaforma
		pieces.append(_shell_quote(arg) if not vps.is_empty() else _local_quote(arg))
	var inner := " ".join(pieces)
	var command := inner
	if not vps.is_empty():
		var key := VpsBackend.expand_user_path(str(vps.get("key_path", "")))
		var target := "root@" + str(vps.get("ip", ""))
		command = "ssh -tt -i " + _local_quote(key) + " " \
				+ _local_quote(target) + " " + _local_quote(inner)
	terminal_requested.emit(context, embedded_terminal_spec(title, hint, command))


func open_cloud_login() -> void:
	open_technical_terminal("cloud", "Account e cloud",
			"Apri il link, inserisci il codice e approva questo dispositivo. Il pairing prosegue automaticamente.",
			PackedStringArray(["node", "/app/cli/bin/jht.js", "cloud", "login"]))


func open_cloud_command(command: String) -> void:
	var supported := ["status", "push", "pull-profile", "disable"]
	if not supported.has(command):
		return
	open_technical_terminal("cloud:" + command, "Cloud · " + command,
			"Il comando gira nel container del team; puoi chiudere la console quando termina.",
			PackedStringArray(["node", "/app/cli/bin/jht.js", "cloud", command]))


func open_doctor() -> void:
	open_technical_terminal("doctor", "Diagnostica JHT",
			"Controllo completo di configurazione, dipendenze, provider e agenti.",
			PackedStringArray(["node", "/app/cli/bin/jht.js", "doctor"]))


func open_runtime_install() -> void:
	Log.info("setup", "installa runtime richiesto (%s)" % OS.get_name())
	if OS.get_name() == "Windows":
		# Niente bash su Windows: winget se c'è (gestisce lui il prompt UAC),
		# altrimenti la pagina ufficiale di download nel browser.
		var command := "where winget >nul 2>&1 && " \
				+ "(winget install -e --id Docker.DockerDesktop " \
				+ "--accept-package-agreements --accept-source-agreements) || " \
				+ "(echo winget non disponibile: apro la pagina di download di Docker Desktop... " \
				+ "& start https://www.docker.com/products/docker-desktop/)"
		terminal_requested.emit("runtime-install", embedded_terminal_spec(
				"Installazione Docker Desktop",
				"Conferma l'autorizzazione di Windows se appare. Al termine avvia Docker Desktop " \
				+ "una prima volta (accetta i termini), poi torna qui e premi ATTIVA CONTAINER.",
				command))
		return
	var command := "curl -fsSL https://jobhunterteam.ai/install.sh | " \
			+ "JHT_SKIP_ONBOARD=1 bash"
	terminal_requested.emit("runtime-install", embedded_terminal_spec(
			"Installazione runtime JHT",
			"L'installazione resta dentro il gioco. Potrebbe chiedere la password amministratore del computer.",
			command))


static func default_vps_key_path() -> String:
	return _jht_home().path_join("ssh/id_ed25519")


func generate_vps_key() -> void:
	if _action_running:
		return
	_start_action("vps-key", _do_generate_vps_key)


static func _do_generate_vps_key() -> Dictionary:
	var path := default_vps_key_path()
	if FileAccess.file_exists(path) and FileAccess.file_exists(path + ".pub"):
		return {"ok": true, "message": "Chiave SSH già disponibile: " + path}
	DirAccess.make_dir_recursive_absolute(path.get_base_dir())
	var result := _run("ssh-keygen", PackedStringArray([
		"-t", "ed25519", "-N", "", "-C", "job-hunter-team", "-f", path]))
	return {"ok": result["code"] == 0,
			"message": "Chiave SSH creata: " + path if result["code"] == 0 \
			else "Creazione chiave fallita: " + str(result["out"]).right(220)}


func open_vps_install(ip: String, key_path: String) -> void:
	var clean_ip := ip.strip_edges()
	var key := VpsBackend.expand_user_path(key_path)
	if clean_ip == "" or not FileAccess.file_exists(key):
		action_changed.emit("vps-install", false,
				"Inserisci l'IP e genera/seleziona una chiave SSH prima di installare", false)
		return
	var remote := "curl -fsSL https://jobhunterteam.ai/install.sh | " \
			+ "JHT_SKIP_ONBOARD=1 bash"
	var command := "ssh -tt -i " + _local_quote(key) \
			+ " -o StrictHostKeyChecking=accept-new " + _local_quote("root@" + clean_ip) \
			+ " " + _local_quote(remote)
	terminal_requested.emit("vps-install", embedded_terminal_spec(
			"Installa JHT sulla VPS",
			"Installazione remota completa. Al termine chiudi la console e premi Connetti.",
			command))


func email_status() -> Dictionary:
	if BackendBus.is_live():
		return BackendBus.live_settings.get("email_account", {})
	var data := _read_json(_jht_home().path_join("credentials/email_monitor.json"))
	return {"configured": str(data.get("user", "")) != "",
			"email": str(data.get("user", "")),
			"host": str(data.get("imap_host", ""))}


func cloud_status() -> Dictionary:
	if BackendBus.is_live():
		return BackendBus.live_settings.get("cloud_account", {})
	var data := _read_json(_jht_home().path_join("cloud.json"))
	return {"configured": bool(data.get("enabled", false)) \
			and str(data.get("token", "")) != "",
			"base_url": str(data.get("base_url", "")),
			"user_id": str(data.get("user_id", "")),
			"token_name": str(data.get("token_name", ""))}


func telegram_status() -> Dictionary:
	if BackendBus.is_live():
		return BackendBus.live_settings.get("telegram_bots", {})
	var config := _read_json(_jht_home().path_join("jht.config.json"))
	var channels: Dictionary = config.get("channels", {}) \
			if config.get("channels", {}) is Dictionary else {}
	var telegram: Dictionary = channels.get("telegram", {}) \
			if channels.get("telegram", {}) is Dictionary else {}
	var bots: Dictionary = telegram.get("bots", {}) \
			if telegram.get("bots", {}) is Dictionary else {}
	var out := {}
	for role in ["assistente", "capitano", "mentor"]:
		var bot: Dictionary = bots.get(role, {}) if bots.get(role, {}) is Dictionary else {}
		out[role] = {
			"configured": str(bot.get("bot_token", "")) != "",
			"chat_ready": str(bot.get("chat_id", "")) != "",
		}
	return out


func save_telegram_bot(role: String, token: String, chat_id: String) -> void:
	if _action_running or not role in ["assistente", "capitano", "mentor"]:
		return
	var clean_token := token.strip_edges()
	var re := RegEx.new()
	re.compile("^[0-9]+:[A-Za-z0-9_-]{20,}$")
	if re.search(clean_token) == null:
		action_changed.emit("telegram", false,
				"Token BotFather non valido per " + role.capitalize(), false)
		return
	_start_action("telegram", _do_save_telegram_bot.bind(
			role, clean_token, chat_id.strip_edges(), _vps_config()))


func delete_telegram_bot(role: String) -> void:
	if _action_running or not role in ["assistente", "capitano", "mentor"]:
		return
	_start_action("telegram", _do_delete_telegram_bot.bind(role, _vps_config()))


const TELEGRAM_SAVE_PY := """
import json, os, sys, urllib.parse, urllib.request
p = json.load(sys.stdin)
role, token, chat_id = p['role'], p['token'], str(p.get('chat_id') or '')
def call(method, query=''):
    url = 'https://api.telegram.org/bot' + urllib.parse.quote(token, safe=':') + '/' + method + query
    with urllib.request.urlopen(url, timeout=12) as response:
        return json.loads(response.read().decode('utf-8'))
try:
    me = call('getMe')
    if not me.get('ok'):
        raise RuntimeError(me.get('description') or 'getMe failed')
    if not chat_id:
        updates = call('getUpdates', '?timeout=2&limit=20')
        for update in reversed(updates.get('result') or []):
            message = update.get('message') or update.get('edited_message') or {}
            chat = message.get('chat') or {}
            if chat.get('id') is not None:
                chat_id = str(chat['id'])
                break
    if not chat_id:
        raise RuntimeError('Apri il bot, premi Start e riprova: chat non ancora rilevata')
    path = '/jht_home/jht.config.json'
    try:
        config = json.load(open(path))
    except Exception:
        config = {}
    channels = config.setdefault('channels', {})
    telegram = channels.setdefault('telegram', {})
    bots = telegram.setdefault('bots', {})
    bots[role] = {'bot_token': token, 'chat_id': chat_id}
    os.makedirs(os.path.dirname(path), exist_ok=True)
    temp = path + '.game-tmp'
    with open(temp, 'w') as output:
        json.dump(config, output, ensure_ascii=False, indent=2)
        output.write('\\n')
    os.replace(temp, path)
    print(json.dumps({'ok': True, 'username': me['result'].get('username', ''),
                      'chat_id': chat_id}), file=sys.stderr)
except Exception as exc:
    print(json.dumps({'ok': False, 'error': str(exc)}), file=sys.stderr)
    raise SystemExit(2)
"""


const TELEGRAM_DELETE_PY := """
import json, os, sys
role = json.load(sys.stdin)['role']
path = '/jht_home/jht.config.json'
try:
    config = json.load(open(path))
except Exception:
    config = {}
bots = (((config.get('channels') or {}).get('telegram') or {}).get('bots') or {})
bots.pop(role, None)
temp = path + '.game-tmp'
with open(temp, 'w') as output:
    json.dump(config, output, ensure_ascii=False, indent=2)
    output.write('\\n')
os.replace(temp, path)
print(json.dumps({'ok': True}), file=sys.stderr)
"""


static func _do_save_telegram_bot(role: String, token: String, chat_id: String,
		vps: Dictionary) -> Dictionary:
	var payload := JSON.stringify({"role": role, "token": token, "chat_id": chat_id})
	var command := "docker exec -i jht python3 -c " + _shell_quote(TELEGRAM_SAVE_PY)
	var result := _run_ssh_stdin(vps, command, payload.to_utf8_buffer()) \
			if not vps.is_empty() else _run_stdin_stderr("docker", PackedStringArray([
					"exec", "-i", "jht", "python3", "-c", TELEGRAM_SAVE_PY]),
					payload.to_utf8_buffer())
	var parsed: Variant = JSON.parse_string(str(result.get("out", "")).strip_edges())
	if result["code"] != 0 or not parsed is Dictionary or not bool(parsed.get("ok", false)):
		var reason := str(parsed.get("error", "")) if parsed is Dictionary \
				else str(result.get("out", "")).right(240)
		return {"ok": false, "message": "Telegram: " + reason}
	return {"ok": true, "message": "@%s collegato a %s · chat %s" % [
			str(parsed.get("username", "bot")), role.capitalize(),
			str(parsed.get("chat_id", ""))]}


static func _do_delete_telegram_bot(role: String, vps: Dictionary) -> Dictionary:
	var payload := JSON.stringify({"role": role})
	var command := "docker exec -i jht python3 -c " + _shell_quote(TELEGRAM_DELETE_PY)
	var result := _run_ssh_stdin(vps, command, payload.to_utf8_buffer()) \
			if not vps.is_empty() else _run_stdin_stderr("docker", PackedStringArray([
					"exec", "-i", "jht", "python3", "-c", TELEGRAM_DELETE_PY]),
					payload.to_utf8_buffer())
	return {"ok": result["code"] == 0,
			"message": "Bot %s rimosso" % role.capitalize() if result["code"] == 0 \
			else "Rimozione bot fallita: " + str(result.get("out", "")).right(220)}


func save_email(email: String, password: String) -> void:
	if _action_running:
		return
	var clean_email := email.strip_edges()
	var clean_password := password.replace(" ", "").strip_edges()
	if not _valid_email(clean_email) or clean_password.length() < 8:
		action_changed.emit("email", false,
				"Inserisci un indirizzo valido e una app password di almeno 8 caratteri", false)
		return
	_start_action("email", _do_save_email.bind(clean_email, clean_password, _vps_config()))


func delete_email() -> void:
	if _action_running:
		return
	_start_action("email", _do_delete_email.bind(_vps_config()))


static func _valid_email(value: String) -> bool:
	var re := RegEx.new()
	return re.compile("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$") == OK \
			and re.search(value) != null


static func _email_host(email: String) -> String:
	var domain := email.get_slice("@", 1).to_lower()
	var known := {
		"gmail.com": "imap.gmail.com", "googlemail.com": "imap.gmail.com",
		"outlook.com": "outlook.office365.com", "hotmail.com": "outlook.office365.com",
		"live.com": "outlook.office365.com", "yahoo.com": "imap.mail.yahoo.com",
		"icloud.com": "imap.mail.me.com", "me.com": "imap.mail.me.com",
		"gmx.com": "imap.gmx.com", "gmx.net": "imap.gmx.net",
		"gmx.de": "imap.gmx.net", "mail.com": "imap.mail.com",
		"email.com": "imap.mail.com", "yandex.com": "imap.yandex.com",
		"yandex.ru": "imap.yandex.ru",
	}
	return str(known.get(domain, "imap." + domain))


static func _do_save_email(email: String, password: String, vps: Dictionary) -> Dictionary:
	var payload := JSON.stringify({
		"imap_host": _email_host(email), "imap_port": 993, "user": email,
		"password": password, "folder": "INBOX", "from_filters": [],
		"savedAt": int(Time.get_unix_time_from_system() * 1000.0),
	}, "  ") + "\n"
	var saved := {"code": -1, "out": ""}
	if vps.is_empty():
		var dir := _jht_home().path_join("credentials")
		DirAccess.make_dir_recursive_absolute(dir)
		var path := dir.path_join("email_monitor.json")
		var tmp := path + ".game-tmp"
		var file := FileAccess.open(tmp, FileAccess.WRITE)
		if file != null:
			file.store_string(payload)
			file.close()
			if FileAccess.file_exists(path):
				DirAccess.remove_absolute(path)
			var err := DirAccess.rename_absolute(tmp, path)
			if err == OK:
				if OS.get_name() != "Windows":
					_run("chmod", PackedStringArray(["600", path]))
				saved = {"code": 0, "out": ""}
	else:
		var python := "import sys,json,os;d=json.load(sys.stdin);" \
				+ "p='/jht_home/credentials/email_monitor.json';" \
				+ "os.makedirs(os.path.dirname(p),exist_ok=True);t=p+'.tmp';" \
				+ "open(t,'w').write(json.dumps(d,ensure_ascii=False,indent=2)+'\\n');" \
				+ "os.chmod(t,0o600);os.replace(t,p)"
		var remote := "docker exec -i jht python3 -c " + _shell_quote(python)
		saved = _run_ssh_stdin(vps, remote, payload.to_utf8_buffer())
	if saved["code"] != 0:
		return {"ok": false, "message": "Salvataggio email fallito: " + str(saved["out"]).right(220)}
	# Verifica reale IMAP attraverso la stessa skill usata dallo Scout.
	var check_cmd := "docker exec jht python3 /app/shared/skills/email_monitor.py count"
	var checked := _run_ssh(vps, check_cmd) if not vps.is_empty() else _run(
			"docker", PackedStringArray(["exec", "jht", "python3",
			"/app/shared/skills/email_monitor.py", "count"]))
	return {"ok": checked["code"] == 0,
			"message": "Casella verificata e salvata: " + email if checked["code"] == 0 \
			else "Credenziali salvate, ma la verifica IMAP è fallita: " + str(checked["out"]).right(220)}


static func _do_delete_email(vps: Dictionary) -> Dictionary:
	var result := {"code": 0, "out": ""}
	if vps.is_empty():
		var path := _jht_home().path_join("credentials/email_monitor.json")
		if FileAccess.file_exists(path):
			var err := DirAccess.remove_absolute(path)
			result["code"] = 0 if err == OK else -1
	else:
		result = _run_ssh(vps,
				"docker exec jht rm -f /jht_home/credentials/email_monitor.json")
	return {"ok": result["code"] == 0,
			"message": "Casella email rimossa" if result["code"] == 0 \
			else "Rimozione email fallita: " + str(result["out"]).right(220)}


static func _run_stdin_stderr(path: String, args: PackedStringArray,
		payload: PackedByteArray) -> Dictionary:
	var process := OS.execute_with_pipe(path, args, true)
	if process.is_empty():
		return {"code": -1, "out": path + " non avviabile"}
	var stdio: FileAccess = process["stdio"]
	var stderr: FileAccess = process["stderr"]
	stdio.store_buffer(payload)
	stdio.close()
	var output := PackedByteArray()
	while true:
		var chunk := stderr.get_buffer(65536)
		output.append_array(chunk)
		if chunk.size() < 65536:
			break
	stderr.close()
	var pid := int(process["pid"])
	while OS.is_process_running(pid):
		OS.delay_msec(5)
	return {"code": OS.get_process_exit_code(pid),
			"out": output.get_string_from_utf8()}


static func _run_ssh_stdin(vps: Dictionary, command: String,
		payload: PackedByteArray) -> Dictionary:
	var key := VpsBackend.expand_user_path(str(vps.get("key_path", "")))
	var target := "root@" + str(vps.get("ip", ""))
	var process := OS.execute_with_pipe("ssh", PackedStringArray([
		"-i", key, "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes",
		"-o", "ConnectTimeout=8", "-o", "StrictHostKeyChecking=accept-new",
		target, command + " 1>&2"]), true)
	if process.is_empty():
		return {"code": -1, "out": "ssh non avviabile"}
	var stdio: FileAccess = process["stdio"]
	var stderr: FileAccess = process["stderr"]
	stdio.store_buffer(payload)
	stdio.close()
	var output := PackedByteArray()
	while true:
		var chunk := stderr.get_buffer(65536)
		output.append_array(chunk)
		if chunk.size() < 65536:
			break
	stderr.close()
	var pid := int(process["pid"])
	while OS.is_process_running(pid):
		OS.delay_msec(5)
	return {"code": OS.get_process_exit_code(pid),
			"out": output.get_string_from_utf8()}


static func _provider_login_command(provider: String, vps: Dictionary = {}) -> String:
	var flags := _exec_tty_flags(not vps.is_empty())
	var inner := ""
	match provider:
		"codex": inner = "docker exec %s jht codex login --device-auth" % flags
		"kimi": inner = "docker exec %s jht kimi --yolo" % flags
		_: inner = "docker exec %s jht claude --dangerously-skip-permissions" % flags
	if vps.is_empty():
		if OS.get_name() == "Windows":
			# cmd.exe non ha printf: niente banner, dritto al comando.
			return inner
		return "printf '\\nJHT — login con abbonamento (console interna)\\n\\n'; " + inner
	var key := VpsBackend.expand_user_path(str(vps.get("key_path", "")))
	var target := "root@" + str(vps.get("ip", ""))
	var command := "ssh -tt -i " + _local_quote(key) + " " \
			+ _local_quote(target) + " " + _local_quote(inner)
	if OS.get_name() != "Windows":
		command = "printf '\\nJHT — login con abbonamento (console interna)\\n\\n'; " \
				+ command
	return command


static func _provider_terminal_hint(provider: String) -> String:
	match provider:
		"codex":
			return "Apri il link mostrato, accedi a ChatGPT e inserisci il codice dispositivo."
		"kimi":
			return "Nel prompt Kimi digita /login, scegli Kimi Code e completa il login nel browser."
		_:
			return "Nel menu Claude scegli Login with subscription e completa l'accesso nel browser."


static func _shell_quote(value: String) -> String:
	return "'" + value.replace("'", "'\\''") + "'"


## Quota per la shell LOCALE che ospita il comando. Su Windows è cmd.exe, che
## non interpreta gli apici singoli POSIX: arrivano letterali al figlio (il
## "CreateFile ...\'C:\..." visto da Leone il 22/07). I doppi apici invece
## attraversano intatti sia OS.execute (wrap esterno senza escape degli apici
## interni) sia cmd /s /c (che spoglia solo la coppia più esterna).
static func _local_quote(value: String) -> String:
	if OS.get_name() == "Windows":
		return "\"" + value.replace("\"", "") + "\""
	return _shell_quote(value)


## `docker exec` locale su Windows: stdin del figlio è una pipe, non un TTY,
## e `-t` fallirebbe con "the input device is not a TTY". Via `ssh -tt` il
## TTY remoto esiste sempre, quindi lì `-it` resta valido.
static func _exec_tty_flags(remote: bool) -> String:
	return "-i" if OS.get_name() == "Windows" and not remote else "-it"


func open_subscription(provider: String) -> void:
	if PROVIDERS.has(provider):
		OS.shell_open(str(PROVIDERS[provider]["subscribe"]))


func start_team() -> void:
	if _action_running:
		return
	if not bool(status.get("ready", false)):
		action_changed.emit("team", false,
				"Completa container, provider e profilo prima di attivare il team", false)
		return
	_start_action("team", _do_start_team.bind(_vps_config()))


func stop_team() -> void:
	if _action_running:
		return
	_start_action("team", _do_stop_team.bind(_vps_config()))


func control_agent(role: String, restart: bool) -> void:
	var normalized := "capitano" if role == "coordinatore" else role
	if _action_running or not normalized in ["capitano", "scout", "analista",
			"scorer", "scrittore", "critico", "assistente", "mentor", "sentinella"]:
		return
	_start_action("agent", _do_control_agent.bind(normalized, restart, _vps_config()))


func _do_start_team(vps: Dictionary) -> Dictionary:
	var res := _run_ssh(vps, "docker exec jht node /app/cli/bin/jht.js team start") \
			if not vps.is_empty() else _run("docker", PackedStringArray([
					"exec", "jht", "node", "/app/cli/bin/jht.js", "team", "start"] ))
	return {"ok": res["code"] == 0,
			"message": "Team avviato: gli agenti arriveranno in ufficio" \
			if res["code"] == 0 else "Avvio team fallito: " + str(res["out"]).right(240)}


static func _do_stop_team(vps: Dictionary) -> Dictionary:
	var result := _run_cli(vps, PackedStringArray(["team", "stop", "--all"]))
	return {"ok": result["code"] == 0,
			"message": "Team fermato (Assistente mantenuto disponibile)" \
			if result["code"] == 0 else "Arresto team fallito: " + str(result.get("out", "")).right(240)}


static func _do_control_agent(role: String, restart: bool, vps: Dictionary) -> Dictionary:
	var stopped := _run_cli(vps, PackedStringArray(["team", "stop", role]))
	# Fermare un ruolo già inattivo non deve impedire un riavvio esplicito.
	if not restart:
		return {"ok": stopped["code"] == 0,
				"message": "%s fermato" % role.capitalize() if stopped["code"] == 0 \
				else "Arresto agente fallito: " + str(stopped.get("out", "")).right(220)}
	var started := _run_cli(vps, PackedStringArray(["team", "start", role]))
	return {"ok": started["code"] == 0,
			"message": "%s riavviato" % role.capitalize() if started["code"] == 0 \
			else "Riavvio agente fallito: " + str(started.get("out", "")).right(220)}


static func _run_cli(vps: Dictionary, args: PackedStringArray) -> Dictionary:
	if vps.is_empty():
		var local := PackedStringArray(["exec", "jht", "node", "/app/cli/bin/jht.js"])
		local.append_array(args)
		return _run("docker", local)
	var command := "docker exec jht node /app/cli/bin/jht.js"
	for arg in args:
		command += " " + _shell_quote(arg)
	return _run_ssh(vps, command)


func _start_action(action: String, callable: Callable) -> void:
	_action_running = true
	Log.info("setup", "azione avviata: " + action)
	action_changed.emit(action, true, "operazione in corso…", true)
	WorkerThreadPool.add_task(_run_action.bind(action, callable))


func _run_action(action: String, callable: Callable) -> void:
	var result: Dictionary = callable.call()
	call_deferred("_finish_action", action, result)


func _finish_action(action: String, result: Dictionary) -> void:
	_action_running = false
	Log.info("setup", "azione %s → %s: %s" % [action,
			"ok" if bool(result.get("ok", false)) else "FALLITA",
			str(result.get("message", ""))])
	action_changed.emit(action, false, str(result.get("message", "")),
			bool(result.get("ok", false)))
	refresh()


func _vps_config() -> Dictionary:
	return BackendBus.load_vps_config() if BackendBus.is_live() else {}


static func _run_ssh(vps: Dictionary, command: String) -> Dictionary:
	var key := VpsBackend.expand_user_path(str(vps.get("key_path", "")))
	var target := "root@" + str(vps.get("ip", ""))
	return _run("ssh", PackedStringArray(["-i", key, "-o", "BatchMode=yes",
			"-o", "IdentitiesOnly=yes", "-o", "ConnectTimeout=8",
			"-o", "StrictHostKeyChecking=accept-new", target, command]))
