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

## Immagine di runtime. Il compose usa la stessa variabile: chi vuole provare
## un tag diverso esporta JHT_IMAGE e l'app resta coerente con il container.
const DEFAULT_RUNTIME_IMAGE := "ghcr.io/leopu00/jht:latest"

var status := {
	"docker_available": false, "docker_running": false,
	"container_exists": false, "container_running": false,
	"container_state": "missing", "active_provider": "",
	"provider_authenticated": false, "provider_auth_match": "",
	"active_plan": "", "plan_ready": false,
	"profile_ready": false, "team_running": false,
	"ready": false, "completed": 0,
	"image_id": "", "container_image_id": "", "runtime_stale": false,
}

var _probe_running := false
var _action_running := false
var _timer: Timer


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	if OS.get_environment("JHT_VPS_SETUP_TEST") == "1":
		_self_test_vps_setup.call_deferred()
		return
	terminal_requested.connect(_show_embedded_terminal)
	# Su VPS il jht.config.json non è su questo disco: le finestre di lavoro
	# arrivano con le impostazioni live pubblicate dal backend.
	BackendBus.live_settings_updated.connect(_on_live_settings)
	_timer = Timer.new()
	_timer.wait_time = 3.0
	_timer.autostart = true
	_timer.timeout.connect(refresh)
	add_child(_timer)
	BackendBus.profile_status_updated.connect(_on_profile_status)
	BackendBus.connection_changed.connect(_on_backend_connection)
	refresh()


func _self_test_vps_setup() -> void:
	var failures: Array[String] = []
	var old_home := OS.get_environment("HOME")
	var old_profile := OS.get_environment("USERPROFILE")
	var old_jht := OS.get_environment("JHT_HOME")
	var test_root := OS.get_cache_dir().path_join(
			"jht-vps-selftest-" + str(int(Time.get_ticks_usec())))
	DirAccess.make_dir_recursive_absolute(test_root.path_join(".jht/ssh"))
	DirAccess.make_dir_recursive_absolute(test_root.path_join(".jht/runtime"))
	DirAccess.make_dir_recursive_absolute(
			test_root.path_join("Documents/Job Hunter Team"))
	OS.set_environment("HOME", test_root)
	OS.set_environment("USERPROFILE", test_root)
	OS.set_environment("JHT_HOME", test_root.path_join(".jht"))
	_test_write(test_root.path_join(".jht/keep.json"), "{\"ok\":true}\n")
	_test_write(test_root.path_join(".jht/jht.config.json"), "{\"version\":4}\n")
	_test_write(test_root.path_join(".jht/host.env"), "JHT_HOST_TYPE=local\n")
	_test_write(test_root.path_join(".jht/ssh/never-copy"), "PRIVATE\n")
	_test_write(test_root.path_join(".jht/runtime/compose.yml"), "runtime\n")
	_test_write(test_root.path_join("Documents/Job Hunter Team/cv.md"), "CV\n")

	var generated := _do_generate_vps_key()
	if not bool(generated.get("ok", false)):
		failures.append("generazione Ed25519 fallita")
	var key := vps_key_info()
	if not bool(key.get("private_exists", false)):
		failures.append("chiave privata assente")
	if not str(key.get("public_key", "")).begins_with("ssh-ed25519 "):
		failures.append("chiave pubblica non valida")
	if not _vps_credentials("host con spazi", str(key.get("path", ""))).is_empty():
		failures.append("hostname pericoloso accettato")
	if _vps_credentials("203.0.113.10", str(key.get("path", ""))).is_empty():
		failures.append("IPv4 e chiave valide rifiutate")
	var runtime_command := _vps_prepare_runtime_command()
	if not runtime_command.contains("command -v jht") \
			or not runtime_command.contains("$HOME/.local/bin/jht"):
		failures.append("rilevamento wrapper VPS incompleto")

	var archive := test_root.path_join("migration.tar.gz")
	var packed := _create_local_migration_archive(archive)
	if packed.get("code", -1) != 0 or not FileAccess.file_exists(archive):
		failures.append("snapshot migrazione non creato: " + str(packed.get("out", "")))
	else:
		var listing := _run("tar", PackedStringArray(["-tzf", archive]))
		var names := str(listing.get("out", ""))
		if not names.contains(".jht/keep.json"):
			failures.append("config non inclusa")
		if not names.contains("Documents/Job Hunter Team/cv.md"):
			failures.append("documenti non inclusi")
		if names.contains(".jht/ssh/"):
			failures.append("chiavi SSH private incluse")
		if names.contains(".jht/runtime/"):
			failures.append("runtime incluso")
		if names.contains(".jht/host.env"):
			failures.append("host.env locale incluso")
		var validated := _validate_migration_archive(archive)
		if not bool(validated.get("ok", false)):
			failures.append("snapshot valido rifiutato: " + str(validated.get("message", "")))
		if FileAccess.get_sha256(archive) == "":
			failures.append("checksum snapshot assente")
	var apply_script := _remote_apply_script("migration.tar.gz", "12345",
			"0123456789abcdef", "/root/backup.tar.gz")
	for required in ["set -eu", "sha256sum", ".jht-migration-stage-12345",
			"test -s \"$BACKUP\"", "pragma integrity_check"]:
		if not apply_script.contains(required):
			failures.append("transazione remota senza garanzia: " + required)
	if apply_script.contains("tar czf \"$BACKUP\" \"$@\" || true"):
		failures.append("errore backup destinazione ignorato")
	var local_env := _local_host_env(test_root.path_join(".jht/host.env"))
	if not local_env.begins_with("JHT_HOST_TYPE=local\n") \
			or local_env.count("JHT_HOST_TYPE=") != 1:
		failures.append("host.env locale non normalizzato")
	# Rollback filesystem: il vecchio stato deve tornare integralmente e i
	# file presenti soltanto nella destinazione nuova devono sparire.
	var tx_root := test_root.path_join("tx")
	var current_jht := tx_root.path_join(".jht")
	var current_docs := tx_root.path_join("Documents/Job Hunter Team")
	var tx_old_jht := tx_root.path_join(".jht.migration-old-1")
	var tx_old_docs := tx_root.path_join("Documents/Job Hunter Team.migration-old-1")
	DirAccess.make_dir_recursive_absolute(current_jht)
	DirAccess.make_dir_recursive_absolute(current_docs)
	DirAccess.make_dir_recursive_absolute(tx_old_jht)
	DirAccess.make_dir_recursive_absolute(tx_old_docs)
	_test_write(current_jht.path_join("new-only"), "new")
	_test_write(current_docs.path_join("new-only"), "new")
	_test_write(tx_old_jht.path_join("old-only"), "old")
	_test_write(tx_old_docs.path_join("old-only"), "old")
	_rollback_local_destination({"current_jht": current_jht,
			"current_docs": current_docs, "old_jht": tx_old_jht,
			"old_docs": tx_old_docs, "stage": "", "jht_moved": true,
			"docs_moved": true, "jht_activated": true,
			"docs_activated": true, "old_container_running": false}, false)
	if not FileAccess.file_exists(current_jht.path_join("old-only")) \
			or FileAccess.file_exists(current_jht.path_join("new-only")) \
			or not FileAccess.file_exists(current_docs.path_join("old-only")):
		failures.append("rollback locale non ripristina lo stato precedente")
	# Spegnimento in uscita: in locale ferma agenti E container, sulla VPS mai.
	var local_shutdown := shutdown_commands({})
	if local_shutdown.size() != 3:
		failures.append("in locale servono stop agenti, stop assistente e stop container")
	else:
		var flat := ""
		for argv: PackedStringArray in local_shutdown:
			flat += " ".join(argv) + "|"
		if not flat.contains("team stop --all"):
			failures.append("manca lo stop degli agenti")
		if not flat.contains("team stop assistente"):
			failures.append("l'Assistente resterebbe acceso")
		if not flat.contains("stop jht"):
			failures.append("il container resterebbe acceso")
	if not shutdown_commands({"ip": "1.2.3.4", "key_path": "~/k"}).is_empty():
		failures.append("su VPS il team NON va spento")

	# ── Abbonamento: il passo 02 non è finito finché non lo sappiamo ──────
	var cfg := {"active_provider": "kimi",
			"providers": {"kimi": {"auth_method": "subscription"}}}
	if _declared_plan(cfg, "kimi") != "":
		failures.append("piano inventato quando l'utente non l'ha dichiarato")
	cfg["providers"]["kimi"]["plan"] = "allegretto"
	if _declared_plan(cfg, "kimi") != "allegretto":
		failures.append("piano dichiarato non riletto")
	# Codex vive sotto `openai` nella config ma resta `codex` nella UI: se la
	# corrispondenza si rompe, il passo resta rosso su un piano già scelto.
	var cfg_codex := {"active_provider": "openai",
			"providers": {"openai": {"plan": "pro"}}}
	if _declared_plan(cfg_codex, "codex") != "pro":
		failures.append("piano di Codex non riconosciuto sotto openai")

	# ── Su VPS la checklist deve guardare LA VPS ─────────────────────────
	# Lo scenario misurato il 27/07: box remoto configurato per davvero e, su
	# questo portatile, un `~/.jht` che è di un'altra installazione. Il probe
	# locale dice tutt'altro dal remoto su ognuno dei tre passi, e deve perdere.
	var altrui := {"active_provider": "claude", "provider_authenticated": true,
			"provider_auth_match": ".claude/.credentials.json", "active_plan": "",
			"plan_ready": false, "profile_ready": true, "hours_ready": true}
	_apply_vps_probe(altrui, {"config_read": true, "active_provider": "moonshot",
			"providers": {"kimi": {"plan": "allegretto"}},
			"team": {"working_hours": {"windows": []}},
			"auth": {"kimi": ".kimi/credentials/kimi-code.json"}, "ready": false})
	if str(altrui.get("active_provider", "")) != "kimi":
		failures.append("provider della VPS ignorato a favore di quello locale")
	if not bool(altrui.get("plan_ready", false)):
		failures.append("abbonamento dichiarato sulla VPS letto come assente")
	if bool(altrui.get("profile_ready", false)):
		failures.append("profilo di questo computer spacciato per quello della VPS")
	if bool(altrui.get("hours_ready", false)):
		failures.append("orari di questo computer spacciati per quelli della VPS")
	if not bool(altrui.get("provider_authenticated", false)):
		failures.append("login presente sulla VPS non riconosciuto")
	# VPS che non risponde: nessun valore, e nessuno preso in prestito dal disco.
	var muta := {"provider_authenticated": true, "plan_ready": true,
			"container_running": true, "profile_ready": true, "hours_ready": true}
	_apply_vps_probe(muta, {})
	for step in ["provider", "profile", "hours"]:
		if not _is_unknown(muta, str(step)):
			failures.append("passo senza risposta dalla VPS non marcato ignoto: " + str(step))
	_finalize(muta)
	if bool(muta.get("ready", false)) or int(muta.get("completed", 0)) != 1:
		failures.append("checklist data per fatta su valori mai letti")
	_mark_known(muta, "hours")
	if _is_unknown(muta, "hours"):
		failures.append("valore arrivato dal team che resta ignoto")
	if not CHECKLIST_PY.contains("/jht_home"):
		failures.append("la sonda remota non guarda i dati del team remoto")

	var gated := {"container_running": true, "provider_authenticated": true,
			"profile_ready": true, "hours_ready": true, "plan_ready": false}
	_finalize(gated)
	if bool(gated.get("ready", false)):
		failures.append("setup dichiarato pronto senza abbonamento")
	gated["plan_ready"] = true
	_finalize(gated)
	if not bool(gated.get("ready", false)):
		failures.append("setup completo non riconosciuto come pronto")

	# ── La cartella dati è del team: nessuno la tocca alle spalle ────────
	# Tre bug diversi in una giornata (config non scrivibile, runtime non
	# creabile, login mai rilevato) erano lo stesso bug: il gioco che tratta
	# `~/.jht` come roba sua mentre appartiene al container. La regola vale
	# solo se resta vera nel tempo, quindi la si verifica invece di ricordarla.
	var sorgente := FileAccess.get_file_as_string(
			"res://scripts/setup/setup_service.gd")
	# I termini si compongono a pezzi, altrimenti il controllo troverebbe
	# sé stesso e fallirebbe sempre.
	var casa := "_jht_home()"
	for vietato in ["FileAccess.open(" + casa, "_read_json(" + casa,
			"DirAccess.remove_absolute(" + casa]:
		if sorgente.contains(vietato):
			failures.append("accesso diretto alla cartella del team: " + vietato)
	# Il compose NON deve tornare in `~/.jht`: è il file che serve PRIMA che
	# il container esista, e da lì in poi quella cartella non è più nostra.
	if not compose_home_path().contains("runtime"):
		failures.append("il compose ha perso la sua cartella")
	if compose_home_path().contains("/.jht/"):
		failures.append("il compose è tornato nella cartella del team")

	# ── Login: il comando lo manda il programma, non l'utente ────────────
	for id in ["claude", "kimi"]:
		if str(provider_login_spec(id).get("send_command", "")) != "/login":
			failures.append("manca il comando di login per " + id)
	if str(provider_login_spec("codex").get("send_command", "")) != "":
		failures.append("Codex non ha una TUI da sbloccare: niente comando")

	_restore_test_env("HOME", old_home)
	_restore_test_env("USERPROFILE", old_profile)
	_restore_test_env("JHT_HOME", old_jht)
	if failures.is_empty():
		print("VPS-SETUP-TEST PASS")
		get_tree().quit(0)
		return
	for failure in failures:
		push_error("[vps-setup-test] " + failure)
	print("VPS-SETUP-TEST FAIL")
	get_tree().quit(1)


static func _test_write(path: String, content: String) -> void:
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file != null:
		file.store_string(content)
		file.close()


static func _restore_test_env(name: String, value: String) -> void:
	if value == "":
		OS.unset_environment(name)
	else:
		OS.set_environment(name, value)


func _show_embedded_terminal(context: String, spec: Dictionary) -> void:
	# Ospitato dall'autoload: il terminale funziona anche quando il comando
	# parte da una conversazione scripted e nessun pannello Impostazioni è
	# aperto. Una sola console interattiva alla volta.
	for existing in get_tree().get_nodes_in_group("embedded_terminal"):
		if is_instance_valid(existing):
			existing.close()  # kill del processo figlio incluso, non solo l'UI
	var terminal := EmbeddedTerminal.new(context, spec)
	get_tree().root.add_child(terminal)


func refresh() -> void:
	if _probe_running or _action_running:
		return
	_probe_running = true
	# La VPS si legge sul thread principale (BackendBus non è thread-safe) e
	# viaggia col task: il worker non deve chiedere al bus com'è connesso.
	WorkerThreadPool.add_task(_probe.bind(_connected_vps()))


func _probe(vps: Dictionary) -> void:
	var next := _probe_host(_jht_home())
	# Passi 02/03/04 chiesti ALLA MACCHINA CONNESSA, sullo stesso trasporto del
	# passo 01. Blocca solo questo worker, mai il thread della UI.
	if not vps.is_empty():
		next["vps_probe"] = _probe_vps(vps)
	# Alcuni self-test Godot chiudono l'albero subito dopo l'assert mentre il
	# probe Docker è ancora nel worker. Non accodare callback su un autoload
	# già smontato durante il teardown.
	if is_instance_valid(self) and not is_queued_for_deletion():
		call_deferred("_apply_probe", next)


func _apply_probe(next: Dictionary) -> void:
	_probe_running = false
	# SOLO in modalità VPS. Col container locale questo blocco sovrascriveva
	# il probe — appena letto dal disco — con `live_settings`, che il backend
	# rinfresca un tick ogni otto: sceglievi Kimi, il file cambiava subito, e
	# la scheda restava sul provider di prima finché il fetch non passava. Da
	# fuori sembrava che il pulsante non facesse niente (Leone, 26/07).
	if BackendBus.is_remote() and BackendBus.is_live():
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
	# Ultima parola alla macchina connessa: quello che arriva da lì sovrascrive
	# sia il disco locale sia i valori rimasti sul bus da una connessione prima.
	if next.has("vps_probe"):
		_apply_vps_probe(next, next["vps_probe"])
		next.erase("vps_probe")
	_finalize(next)
	status = next
	status_changed.emit(status.duplicate(true))
	if bool(status.get("container_running", false)) \
			and BackendBus.state == BackendBus.DISCONNECTED:
		BackendBus.connect_local_backend()
	# Login appena rilevato (o già presente) con container acceso: l'assistente
	# parte da solo in background, così il passo profilo trova subito il suo
	# interlocutore invece di un team spento (feedback Leone 23/07). La
	# chiamata è idempotente: ha il guard tmux has-session dentro.
	if bool(status.get("container_running", false)) \
			and not bool(status.get("remote", false)) \
			and bool(status.get("provider_authenticated", false)):
		BackendBus.ensure_assistant()


## Gli orari sono il quarto passo, ed è obbligatorio: decidono QUANDO il team
## consuma l'abbonamento. Chi parte senza sceglierli si ritrova gli agenti che
## lavorano a tutte le ore, e lo scopre dal conto (Leone, 26/07). Il pannello
## esisteva già, ma solo in Impostazioni: nessuno ci passava prima di avviare.
func _finalize(next: Dictionary) -> void:
	var completed := 0
	completed += 1 if bool(next.get("container_running", false)) else 0
	# Il passo provider è verde solo con login FATTO e abbonamento DICHIARATO:
	# sono la stessa domanda ("con che account lavora il team, e quanto può
	# spendere"), spezzarla in due passi allungherebbe il setup senza aggiungere
	# una decisione.
	completed += 1 if bool(next.get("provider_authenticated", false)) \
			and bool(next.get("plan_ready", false)) else 0
	completed += 1 if bool(next.get("profile_ready", false)) else 0
	completed += 1 if bool(next.get("hours_ready", false)) else 0
	next["completed"] = completed
	next["ready"] = completed == 4


## Orari letti dal team remoto: stessa verità del probe locale, altra sorgente.
func _on_live_settings(settings: Dictionary) -> void:
	if not BackendBus.is_remote():
		return
	var wh: Variant = settings.get("hours_raw", {})
	var ready := wh is Dictionary and (wh as Dictionary).get("windows", []) is Array \
			and not ((wh as Dictionary).get("windows", []) as Array).is_empty()
	if bool(status.get("hours_ready", false)) == ready \
			and not _is_unknown(status, "hours"):
		return
	_mark_known(status, "hours")
	status["hours_ready"] = ready
	_finalize(status)
	status_changed.emit(status.duplicate(true))


func _on_profile_status(_profile: Dictionary, _required: Dictionary, ready: bool) -> void:
	if bool(status.get("profile_ready", false)) == ready \
			and not _is_unknown(status, "profile"):
		return
	_mark_known(status, "profile")
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


static func runtime_image() -> String:
	var custom := OS.get_environment("JHT_IMAGE").strip_edges()
	return custom if custom != "" else DEFAULT_RUNTIME_IMAGE


## Il container è acceso adesso? Serve a decidere chi scrive nei dati del team:
## quando c'è, comanda lui (vedi _do_select_provider).
static func _container_is_running() -> bool:
	var state := _run("docker", PackedStringArray(["inspect", "jht",
			"--format", "{{.State.Running}}"]))
	return state["code"] == 0 and str(state["out"]).strip_edges() == "true"


static func _probe_host(home: String) -> Dictionary:
	var d := {
		"docker_available": false, "docker_running": false,
		"container_exists": false, "container_running": false,
		"container_state": "missing", "active_provider": "",
		"provider_authenticated": false, "provider_auth_match": "",
		"active_plan": "", "plan_ready": false,
		"profile_ready": FileAccess.file_exists(home.path_join("profile/ready.flag")),
		"team_running": false,
		"image_id": "", "container_image_id": "", "runtime_stale": false,
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
		# Runtime obsoleto: il container gira su un'immagine diversa da quella
		# scaricata come :latest. Confronto locale (nessuna rete): dice se un
		# pull già fatto aspetta solo la ricreazione del container.
		var local_image := _run("docker", PackedStringArray(["image", "inspect",
				runtime_image(), "--format", "{{.Id}}"] ))
		if local_image["code"] == 0:
			d["image_id"] = str(local_image["out"]).strip_edges()
		if d["container_exists"]:
			var used := _run("docker", PackedStringArray(["inspect", "jht",
					"--format", "{{.Image}}"] ))
			if used["code"] == 0:
				d["container_image_id"] = str(used["out"]).strip_edges()
		d["runtime_stale"] = d["image_id"] != "" \
				and d["container_image_id"] != "" \
				and d["image_id"] != d["container_image_id"]
		if d["container_running"]:
			var tmux := _run("docker", PackedStringArray(["exec", "jht", "tmux",
					"list-sessions", "-F", "#{session_name}"] ))
			d["team_running"] = tmux["code"] == 0 and str(tmux["out"]) != ""
	var config := _read_json(home.path_join("jht.config.json"))
	d["hours_ready"] = _has_working_hours(config)
	var active := _ui_provider_id(str(config.get("active_provider", "")))
	d["active_provider"] = active
	if active != "":
		var match := auth_match(active, home)
		d["provider_auth_match"] = match
		d["provider_authenticated"] = match != ""
		d["active_plan"] = _declared_plan(config, active)
		d["plan_ready"] = str(d["active_plan"]) != ""
	return d


## Quale abbonamento ha l'utente. Il provider da solo non basta: un piano da
## 19$ e uno da 199$ sono lo stesso `active_provider` con capacita di lavoro
## 30 volte diverse, e il Capitano ci dimensiona sopra il roster del primo
## avvio. Finche non lo sa, o parte in prima marcia (e l'utente crede che
## l'app sia rotta) o strafa (e gli brucia la finestra il primo giorno).
static func _declared_plan(config: Dictionary, ui_provider: String) -> String:
	var providers: Variant = config.get("providers", {})
	if not (providers is Dictionary):
		return ""
	var config_id := str(PROVIDERS.get(ui_provider, {}).get("config_id", ui_provider))
	for key in [config_id, ui_provider]:
		var entry: Variant = (providers as Dictionary).get(key, {})
		if entry is Dictionary:
			var plan := str((entry as Dictionary).get("plan", "")).strip_edges()
			if plan != "":
				return plan
	return ""


## Finestre di lavoro dichiarate? Il team senza orari lavora sempre.
static func _has_working_hours(config: Dictionary) -> bool:
	var team_cfg: Variant = config.get("team", {})
	if not (team_cfg is Dictionary):
		return false
	var wh: Variant = (team_cfg as Dictionary).get("working_hours", {})
	if not (wh is Dictionary):
		return false
	var windows: Variant = (wh as Dictionary).get("windows", [])
	return windows is Array and not (windows as Array).is_empty()


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


## Il login è stato fatto? La domanda va posta a CHI POSSIEDE i dati.
##
## I CLI salvano le credenziali con permessi 600 sotto l'utente del container
## (uid 1001), e su Linux i bind mount non rimappano gli uid: il gioco gira
## come l'utente (1000) e su quel file prende "Permission denied". Leggendolo
## da fuori il login risultava NON fatto per sempre — l'utente entrava in
## Kimi, la console gli rispondeva, e la spunta verde non arrivava mai
## (ThinkPad, 26/07). Quando il container è acceso è lui a rispondere; la
## lettura diretta resta per il caso "provider già autenticato e container
## ancora spento".
static func auth_match(provider: String, _home: String = "") -> String:
	return JhtFs.first_with_content(AUTH_PATHS.get(provider, []))


## ── La checklist guarda la macchina a cui è connessa ───────────────────
##
## Col team su una VPS i passi 02, 03 e 04 leggevano il `~/.jht` di QUESTO
## computer. Sul portatile di chi installa quel file c'è quasi sempre — è di
## una prova, o di un altro tester — e il risultato misurato il 27/07 è
## doppio: un box con l'abbonamento dichiarato restava rosso su "manca
## l'abbonamento" (il piano locale è null) e il profilo di un'ALTRA persona,
## rimasto in `~/.jht/profile/`, passava per quello del box. Quindi una VPS
## configurata bene non arrivava mai a 4/4, e insieme la checklist certificava
## dati di qualcun altro.
##
## Da qui in avanti, quando c'è una VPS connessa, ogni sonda passa dalla stessa
## SSH del passo 01. E quello che non si riesce a leggere di là resta IGNOTO:
## mai verde, e mai sostituito col valore di questo disco — un ripiego
## silenzioso qui non peggiora l'informazione, la falsifica.
const CHECKLIST_PY := """
import json, os
AUTH = %s
HOME = '/jht_home'
try:
    c = json.load(open(HOME + '/jht.config.json'))
except Exception:
    c = None
out = {'config_read': isinstance(c, dict)}
if not isinstance(c, dict):
    c = {}
out['active_provider'] = str(c.get('active_provider') or '')
declared = c.get('providers') if isinstance(c.get('providers'), dict) else {}
out['providers'] = dict((k, {'plan': str((v or {}).get('plan') or '')})
                        for k, v in declared.items() if isinstance(v, dict))
team = c.get('team') if isinstance(c.get('team'), dict) else {}
out['team'] = {'working_hours': team.get('working_hours') or {}}
auth = {}
for name, paths in AUTH.items():
    for rel in paths:
        full = HOME + '/' + rel
        if os.path.isfile(full) and os.path.getsize(full) > 0:
            auth[name] = rel
            break
out['auth'] = auth
print(json.dumps(out))
"""


## Una sola andata e ritorno per i tre passi. Il profilo usa lo STESSO script
## del backend (ready.flag oppure campi obbligatori completi): due copie della
## stessa regola divergerebbero, e il passo 03 direbbe cose diverse a seconda
## di chi guarda. Dizionario vuoto = non abbiamo saputo niente.
static func _probe_vps(vps: Dictionary) -> Dictionary:
	var payload := (CHECKLIST_PY % JSON.stringify(AUTH_PATHS)) \
			+ VpsBackend.PROFILE_STATUS_PY
	var res := _run_ssh(vps, "docker exec jht python3 -c " + _shell_quote(payload))
	if res["code"] != 0:
		return {}
	var remote := {}
	for line in str(res["out"]).split("\n"):
		if not line.begins_with("{"):
			continue
		var parsed: Variant = JSON.parse_string(line)
		if parsed is Dictionary:
			remote.merge(parsed as Dictionary, true)
	return remote


## Quello che si è letto sulla macchina connessa sostituisce quello letto qui,
## nei passi 02/03/04. Le risposte si interpretano con le STESSE funzioni del
## percorso locale: il payload ha la forma della config proprio per questo.
static func _apply_vps_probe(next: Dictionary, remote: Dictionary) -> void:
	var unknown: Array = []
	if bool(remote.get("config_read", false)):
		var active := _ui_provider_id(str(remote.get("active_provider", "")))
		var auth: Variant = remote.get("auth", {})
		var found := ""
		if active != "" and auth is Dictionary:
			found = str((auth as Dictionary).get(active, ""))
		next["active_provider"] = active
		next["provider_auth_match"] = found
		next["provider_authenticated"] = found != ""
		next["active_plan"] = _declared_plan(remote, active)
		next["plan_ready"] = str(next["active_plan"]) != ""
		next["hours_ready"] = _has_working_hours(remote)
	else:
		next["active_provider"] = ""
		next["provider_auth_match"] = ""
		next["provider_authenticated"] = false
		next["active_plan"] = ""
		next["plan_ready"] = false
		next["hours_ready"] = false
		unknown.append("provider")
		unknown.append("hours")
	if remote.has("ready"):
		next["profile_ready"] = bool(remote["ready"])
	else:
		next["profile_ready"] = false
		unknown.append("profile")
	next["unknown_steps"] = unknown


## Passo che nessuno ha saputo raccontare: la UI lo mostra come tale invece di
## disegnarlo verde o rosso, e `_finalize` non lo conta come fatto.
static func _is_unknown(state: Dictionary, step: String) -> bool:
	var unknown: Variant = state.get("unknown_steps", [])
	return unknown is Array and (unknown as Array).has(step)


## Un valore appena arrivato DAL team (mai da questo disco) chiude il suo passo.
static func _mark_known(state: Dictionary, step: String) -> void:
	if not _is_unknown(state, step):
		return
	var unknown: Array = state["unknown_steps"]
	unknown.erase(step)
	state["unknown_steps"] = unknown


## La VPS a cui il gioco è attaccato ADESSO, o {} se il team vive qui. È lo
## stesso "sì" del passo 01: connessione viva verso una macchina remota.
func _connected_vps() -> Dictionary:
	if not (BackendBus.is_remote() and BackendBus.is_live()):
		return {}
	var vps := BackendBus.load_vps_config()
	return vps if str(vps.get("ip", "")).strip_edges() != "" else {}


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
	# Quando il container c'è, la configurazione la scrive LUI: è il proprietario
	# dei dati in /jht_home, esattamente come nel ramo VPS qui sopra. Su Linux i
	# bind mount non rimappano gli uid: l'entrypoint trova /jht_home non
	# scrivibile da `jht`, ne fa chown -R, e da quel momento la cartella è di
	# uid 1001 mentre il gioco gira come 1000 — ogni scrittura dall'host muore
	# con "config non scrivibile" (primo avvio pulito sul ThinkPad, 25/07).
	# La scrittura diretta resta come ripiego per chi sceglie il provider prima
	# di aver mai acceso il container.
	var install_id := str(PROVIDERS[provider]["install_id"])
	if _container_is_running():
		var used := _run("docker", PackedStringArray(["exec", "jht", "node",
				"/app/cli/bin/jht.js", "providers", "use", install_id]))
		if used["code"] == 0:
			return {"ok": true, "message": "Provider selezionato: "
					+ str(PROVIDERS[provider]["name"])}
		Log.warn("setup", "providers use nel container fallito (%d): %s"
				% [used["code"], str(used["out"]).strip_edges().right(200)])

	var config := JhtFs.read_json("jht.config.json")
	var config_id := str(PROVIDERS[provider]["config_id"])
	config["active_provider"] = config_id
	var providers: Dictionary = config.get("providers", {}) \
			if config.get("providers", {}) is Dictionary else {}
	var provider_config: Dictionary = providers.get(config_id, {}) \
			if providers.get(config_id, {}) is Dictionary else {}
	provider_config["auth_method"] = "subscription"
	providers[config_id] = provider_config
	config["providers"] = providers
	if JhtFs.write_json("jht.config.json", config):
		return {"ok": true, "message": "Provider selezionato: "
				+ str(PROVIDERS[provider]["name"])}
	if JhtFs.host_home_blocked():
		return {"ok": false, "message": "la cartella dati appartiene al team e "
				+ "il container è spento: accendilo dal passo 01 e riprova"}
	return {"ok": false, "message": "impossibile salvare il provider"}


## ── Abbonamento ────────────────────────────────────────────────────────
## Quanto grande può essere il team dipende dal PIANO, non dal provider. La
## tabella dei piani vive nel container (shared/skills/plan_registry.py) e
## qui non si duplica: una seconda copia nel gioco divergerebbe al primo
## cambio di listino, e il Capitano userebbe quella sbagliata per il roster.
var _plans_cache := {}

func plans_for(provider: String) -> Array:
	if not PROVIDERS.has(provider):
		return []
	var config_id := str(PROVIDERS[provider]["config_id"])
	if _plans_cache.has(config_id):
		return _plans_cache[config_id]
	var out := _plan_registry(["list", config_id, "--json"], _vps_config())
	if out == "":
		return []
	var parsed: Variant = JSON.parse_string(out)
	if not (parsed is Dictionary):
		return []
	var plans: Variant = (parsed as Dictionary).get(config_id, [])
	if not (plans is Array):
		return []
	_plans_cache[config_id] = plans
	return plans


func select_plan(provider: String, plan_id: String) -> void:
	if not PROVIDERS.has(provider) or _action_running:
		return
	_start_action("plan", _do_select_plan.bind(provider, plan_id, _vps_config()))


func _do_select_plan(provider: String, plan_id: String,
		vps: Dictionary) -> Dictionary:
	var config_id := str(PROVIDERS[provider]["config_id"])
	var out := _plan_registry(["set", config_id + ":" + plan_id], vps)
	if out == "":
		return {"ok": false, "message": "abbonamento non salvato — "
				+ "il container deve essere acceso (passo 01)"}
	return {"ok": true, "message": "Abbonamento registrato"}


## Esegue plan_registry.py dentro il container (locale o VPS). Stringa vuota
## = non ci siamo riusciti; il chiamante non deve inventare un ripiego, il
## piano lo dichiara l'utente e basta.
func _plan_registry(args: Array, vps: Dictionary) -> String:
	var argv := PackedStringArray(["exec", "jht", "python3",
			"/app/shared/skills/plan_registry.py"])
	for a in args:
		argv.append(str(a))
	if not vps.is_empty():
		var joined := " ".join(PackedStringArray(args))
		var remote := _run_ssh(vps, "docker exec jht python3 "
				+ "/app/shared/skills/plan_registry.py " + joined)
		return str(remote["out"]).strip_edges() if remote["code"] == 0 else ""
	var local := _run("docker", argv)
	return str(local["out"]).strip_edges() if local["code"] == 0 else ""


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
	# Attivazione via compose SEMPRE, anche quando il container esiste già: è
	# l'unico percorso che aggiorna il runtime. `docker start` da solo lascia
	# l'utente su un'immagine vecchia per sempre — il gioco si aggiorna con
	# l'installer, il container no, e nessuno se ne accorge (24/07). Il pull
	# non è fatale: offline si riparte con l'immagine già scaricata.
	var compose := _ensure_compose_file()
	if compose == "":
		# Senza compose resta solo l'avvio secco del container esistente.
		var fallback := _run("docker", PackedStringArray(["start", "jht"] ))
		if fallback["code"] == 0:
			Log.call_deferred("info", "setup", "container jht avviato (senza compose)")
			return {"ok": true, "message": "Container JHT attivo"}
		return {"ok": false, "message": "Impossibile preparare il runtime in ~/.jht/runtime"}
	_ensure_host_dirs()
	Log.call_deferred("info", "setup", "attivazione: pull + compose up da " + compose)
	var pull := _compose_stream(compose, PackedStringArray(["pull", "jht"]),
			"Controllo aggiornamenti del team…")
	if not bool(pull["ok"]):
		Log.call_deferred("warn", "setup",
				"pull immagine fallito, proseguo con la copia locale: "
				+ str(pull.get("tail", "")).right(200))
		_progress("container", "Aggiornamento non riuscito: uso l'immagine già scaricata…")
	return _compose_up_with_progress(compose)


## Aggiornamento esplicito del runtime: scarica l'immagine più recente e
## ricrea il container solo se serve (compose lo fa da sé quando l'immagine
## referenziata cambia). Il bind-mount ~/.jht resta intatto: nessun dato perso.
func update_runtime() -> void:
	if _action_running:
		return
	_start_action("container", _do_update_runtime)


func _do_update_runtime() -> Dictionary:
	var daemon := _run("docker", PackedStringArray(["version", "--format",
			"{{.Server.Version}}"] ))
	if daemon["code"] != 0:
		return {"ok": false, "message": "Docker non risponde: avvia prima il runtime."}
	var compose := _ensure_compose_file()
	if compose == "":
		return {"ok": false, "message": "Impossibile preparare il runtime in ~/.jht/runtime"}
	_ensure_host_dirs()
	var before := _local_image_id()
	var pull := _compose_stream(compose, PackedStringArray(["pull", "jht"]),
			"Cerco una versione più recente del team…")
	if not bool(pull["ok"]):
		return {"ok": false, "message": "Aggiornamento non riuscito: " \
				+ str(pull.get("tail", "")).strip_edges().right(200)}
	var after := _local_image_id()
	var recreated := _compose_up_with_progress(compose)
	if not bool(recreated["ok"]):
		return recreated
	return {"ok": true, "message": "Runtime aggiornato: il team gira sulla versione più recente." \
			if after != before else "Runtime già aggiornato: nessuna versione più recente."}


static func _local_image_id() -> String:
	var found := _run("docker", PackedStringArray(["image", "inspect",
			runtime_image(), "--format", "{{.Id}}"] ))
	return str(found["out"]).strip_edges() if found["code"] == 0 else ""


## Dove vive il file compose. NON in `~/.jht`: quella cartella diventa del
## container al primo avvio, e da lì in poi riscriverla è "Impossibile
## preparare il runtime" — il muro contro cui è finito il primo avvio pulito
## del 26/07. Vive nella cartella dell'applicazione, che è nostra per
## definizione; i volumi dentro al file sono path assoluti, quindi la sua
## posizione non cambia nulla per docker. Il vecchio percorso resta letto
## per chi ce l'ha già.
static func compose_home_path() -> String:
	return ProjectSettings.globalize_path("user://runtime/docker-compose.yml")


static func _find_compose_file() -> String:
	var candidates := [
		compose_home_path(),
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
      # CLI dei provider FUORI dal bind-mount: su Windows ~/.jht e' C:\
      # vista da WSL2 e scriverci costa ~158x (misurato: 200 file piccoli
      # = 11.209 ms contro 71 ms sul disco del container). npm e uv ne
      # creano decine di migliaia, ed e' il motivo per cui installare un
      # provider su Windows richiedeva un'attesa interminabile mentre su
      # Linux bastava mezzo minuto.
      - NPM_CONFIG_PREFIX=/opt/jht-deps/npm-global
      - NPM_CONFIG_CACHE=/opt/jht-deps/npm-cache
      - UV_TOOL_DIR=/opt/jht-deps/uv-tools
      - UV_TOOL_BIN_DIR=/opt/jht-deps/bin
      - UV_CACHE_DIR=/opt/jht-deps/uv-cache
      - PATH=/app/agents/_tools:/opt/jht-deps/bin:/opt/jht-deps/npm-global/bin:/opt/jht-deps/python/bin:/jht_home/.npm-global/bin:/jht_home/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/local/games:/usr/games
    volumes:
      - ${HOME}/.jht:/jht_home
      - ${HOME}/Documents/Job Hunter Team:/jht_user
      # Volume Docker: sul disco della VM, non sul mount dell'host.
      - jht-deps:/opt/jht-deps
    # Nessuna porta esposta: la dashboard browser su localhost e' stata
    # ritirata — l'interazione locale passa dal gioco (docker exec).
    stdin_open: true
    tty: true
    restart: unless-stopped

volumes:
  jht-deps:
"""


static func _ensure_compose_file() -> String:
	var found := _find_compose_file()
	if found != "":
		return found
	var path := compose_home_path()
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


## `docker compose up -d` senza shell né console: spawn diretto con pipe e
## progresso del pull riportato nel pannello via _progress. Il successo si
## verifica sullo stato del container (docker inspect), non sull'exit code
## (leggerlo dopo il reap logga falsi errori su macOS). Gira nel worker
## dell'azione: i delay non toccano il main thread.
func _compose_up_with_progress(compose: String) -> Dictionary:
	var run := _compose_stream(compose, PackedStringArray(["up", "-d", "jht"]),
			"Scarico l'immagine del team (qualche GB, dipende dalla rete)…")
	if not bool(run.get("spawned", false)):
		return {"ok": false, "message": "Impossibile avviare docker compose"}
	var state := _run("docker", PackedStringArray(["inspect", "jht",
			"--format", "{{.State.Status}}"]))
	if state["code"] == 0 and str(state["out"]).contains("running"):
		Log.call_deferred("info", "setup", "attivazione completata: container attivo")
		return {"ok": true, "message": "Container JHT attivo"}
	Log.call_deferred("warn", "setup", "compose fallito: " + str(run.get("tail", "")).right(400))
	return {"ok": false, "message": "Attivazione del container fallita: " \
			+ str(run.get("tail", "")).strip_edges().right(260)}


## Esegue un sottocomando compose in background riportando il progresso del
## pull nel pannello. L'esito non guarda l'exit code (leggerlo dopo il reap
## logga falsi errori su macOS): chi chiama verifica lo stato reale — il
## container per `up`, l'id dell'immagine per `pull` — e qui si segnala solo
## se il processo è partito e se lo stream contiene errori. Gira nel worker
## dell'azione: i delay non toccano il main thread.
func _compose_stream(compose: String, args: PackedStringArray,
		lead: String) -> Dictionary:
	if OS.get_name() == "Windows" and OS.get_environment("HOME") == "":
		# ${HOME} nel compose non esiste nell'ambiente Windows: i processi
		# figli ereditano l'ambiente del gioco.
		OS.set_environment("HOME", OS.get_environment("USERPROFILE"))
	_progress("container", lead)
	# Niente --progress: su pipe (non-TTY) compose è già in modalità plain e
	# il flag non esiste nelle versioni meno recenti.
	var argv := PackedStringArray(["compose", "-f", compose])
	argv.append_array(args)
	var process := OS.execute_with_pipe("docker", argv, false)
	if process.is_empty():
		return {"ok": false, "spawned": false, "tail": "docker compose non eseguibile"}
	var stdio: FileAccess = process["stdio"]
	var stderr: FileAccess = process["stderr"]
	var pid := int(process["pid"])
	var sizes := RegEx.new()
	sizes.compile("([0-9.]+)\\s*([kKmMgG]?i?B)/([0-9.]+)\\s*([kKmMgG]?i?B)")
	var pending := ""
	var tail := ""            # ultime righe complete, per il messaggio d'errore
	var layers := {}          # id livello → ultima riga di stato vista
	var last_output_ms := Time.get_ticks_msec()
	var last_ui_ms := 0
	while true:
		var got_data := false
		for pipe: FileAccess in [stdio, stderr]:
			if pipe == null:
				continue
			var chunk: PackedByteArray = pipe.get_buffer(65536)
			if chunk.size() > 0:
				got_data = true
				pending += chunk.get_string_from_utf8()
		if got_data:
			last_output_ms = Time.get_ticks_msec()
			var lines: PackedStringArray = pending.split("\n")
			pending = lines[lines.size() - 1]
			for i in lines.size() - 1:
				var line := lines[i].strip_edges()
				if line == "":
					continue
				tail += line + "\n"
				if tail.length() > 1200:
					tail = tail.right(1200)
				var parts: PackedStringArray = line.split(" ", false, 1)
				if parts.size() == 2 and parts[0].is_valid_hex_number():
					layers[parts[0]] = parts[1]
		else:
			if not OS.is_process_running(pid):
				# Drain finale: il processo può uscire con dati ancora in coda
				# nei pipe (tipicamente la riga d'errore che ci serve).
				for _attempt in 3:
					for pipe: FileAccess in [stdio, stderr]:
						if pipe == null:
							continue
						var rest: PackedByteArray = pipe.get_buffer(65536)
						if rest.size() > 0:
							pending += rest.get_string_from_utf8()
					OS.delay_msec(30)
				if pending.strip_edges() != "":
					tail += pending.strip_edges() + "\n"
				break
			if Time.get_ticks_msec() - last_output_ms > 180000:
				OS.kill(pid)
				Log.call_deferred("warn", "setup", "compose fermo da 3 minuti, interrotto")
				return {"ok": false, "spawned": true, "timeout": true,
						"tail": "Il download non procede da 3 minuti. " \
						+ "Controlla la connessione e riprova; se persiste apri Docker Desktop " \
						+ "e verifica che il motore sia attivo."}
			OS.delay_msec(80)
		if Time.get_ticks_msec() - last_ui_ms > 1500 and not layers.is_empty():
			last_ui_ms = Time.get_ticks_msec()
			_progress("container", _pull_progress_text(layers, sizes))
	return {"ok": not _stream_failed(tail), "spawned": true, "tail": tail}


## Euristica d'errore sullo stream: compose stampa "Error response from daemon",
## "failed to", "no such host"… L'exit code non è affidabile qui (vedi sopra).
static func _stream_failed(tail: String) -> bool:
	var lower := tail.to_lower()
	for marker in ["error", "errore", "failed", "cannot connect", "no such host",
			"denied", "not found", "timeout"]:
		if lower.contains(marker):
			return true
	return false


## Riassunto leggibile del pull: parti completate e byte scaricati/totali
## quando docker li espone nelle righe di stato.
static func _pull_progress_text(layers: Dictionary, sizes: RegEx) -> String:
	var done := 0
	var got_bytes := 0.0
	var total_bytes := 0.0
	for id in layers:
		var status := str(layers[id]).to_lower()
		if status.contains("complete") or status.contains("already exists") \
				or status.contains("exists"):
			done += 1
		var found := sizes.search(str(layers[id]))
		if found != null:
			got_bytes += _to_mb(found.get_string(1), found.get_string(2))
			total_bytes += _to_mb(found.get_string(3), found.get_string(4))
	var text := "Scarico l'immagine del team: %d/%d parti" % [done, layers.size()]
	if total_bytes > 0.0:
		text += " · %.0f/%.0f MB" % [got_bytes, total_bytes]
	return text + "…"


static func _to_mb(value: String, unit: String) -> float:
	var v := value.to_float()
	match unit.to_lower().left(1):
		"g": return v * 1024.0
		"k": return v / 1024.0
		"m": return v
		_: return v / 1048576.0


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
			if not JhtFs.remove(str(rel)):
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
	var spec := embedded_terminal_spec(
			str(PROVIDERS.get(provider, {}).get("name", provider)),
			_provider_terminal_hint(provider), _provider_login_command(provider, vps))
	spec["send_command"] = _provider_tui_login(provider)
	return spec


## Il comando da battere DENTRO la TUI del provider per aprire il login.
## Claude e Kimi partono in chat e aspettano `/login`; Codex fa già tutto
## dalla riga di comando, quindi non ha niente da mandare. Scriverlo a mano
## è l'unico pezzo di questa schermata che chiedeva all'utente di sapere
## qualcosa: diventa un pulsante, e la casella di testo resta per il codice
## di verifica, che è l'unica cosa che solo lui può conoscere.
static func _provider_tui_login(provider: String) -> String:
	return "" if provider == "codex" else "/login"


## Griglia della pty ospitata: DEVE combaciare con TermScreen del renderer.
const PTY_ROWS := 40
const PTY_COLS := 120


## Senza `stty` la pty aperta da `script` nasce 0×0 — misurato sia su macOS
## sia su Ubuntu 24.04, e `docker exec -it` propaga quello 0×0 dentro al
## container. Un TUI che non sa quante righe ha non le può riscrivere: invece
## di ridisegnare in place accoda ogni frame, e nel login Claude comparivano i
## resti della schermata precedente sopra quella nuova (ThinkPad Linux, 24/07).
## Su Windows la stessa misura viaggia dentro il container (_local_container_exec),
## dove la pty la crea `script` perché Godot non espone ConPTY.
static func _with_pty_size(command: String) -> String:
	return "stty rows %d cols %d 2>/dev/null; " % [PTY_ROWS, PTY_COLS] + command


## Costruttore comune per qualunque comando tecnico ospitato nel gioco.
static func embedded_terminal_spec(title: String, hint: String, command: String) -> Dictionary:
	var path := "/bin/sh"
	var args := PackedStringArray()
	match OS.get_name():
		"macOS":
			args = PackedStringArray(["-lc", "script -q /dev/null /bin/sh -lc " \
					+ _shell_quote(_with_pty_size(command)) + " 1>&2"])
		"Windows":
			path = "cmd.exe"
			# ConPTY non è ancora esposto da Godot: il device flow Codex resta
			# pienamente interattivo; Claude/Kimi ricevono comunque stdin.
			args = PackedStringArray(["/d", "/s", "/c", command + " 1>&2"])
		_:
			args = PackedStringArray(["-lc", "script -qefc " \
					+ _shell_quote(_with_pty_size(command)) + " /dev/null 1>&2"])
	return {
		"path": path,
		"args": args,
		"title": title,
		"hint": hint,
	}


func open_technical_terminal(context: String, title: String, hint: String,
		container_args: PackedStringArray) -> void:
	var vps := _vps_config()
	var command := ""
	if vps.is_empty():
		command = _local_container_exec(" ".join(_posix_quoted(container_args)))
	else:
		var pieces := PackedStringArray(["docker", "exec", "-it", "jht"])
		pieces.append_array(_posix_quoted(container_args))
		var inner := " ".join(pieces)
		var key := VpsBackend.expand_user_path(str(vps.get("key_path", "")))
		var target := "root@" + str(vps.get("ip", ""))
		command = "ssh -tt -i " + _local_quote(key) + " " \
				+ _local_quote(target) + " " + _local_quote(inner)
	terminal_requested.emit(context, embedded_terminal_spec(title, hint, command))


static func _posix_quoted(args: PackedStringArray) -> PackedStringArray:
	var quoted := PackedStringArray()
	for arg in args:
		quoted.append(_shell_quote(arg))
	return quoted


## `docker exec` locale per la console incorporata. Su Windows Godot non ha
## ConPTY: senza TTY i CLI raw-mode partono in modalità batch (Claude:
## "Input must be provided ... when using --print", test Leone 23/07). La
## PTY si crea DENTRO il container con `script` (util-linux, presente
## nell'immagine): il comando viene parsato dalla sh del container, quindi
## arriva già POSIX-quotato e passa a script come UNICO argomento tra
## doppi apici (che cmd.exe e il CRT di docker attraversano intatti).
## Su macOS/Linux la PTY host-side la crea già embedded_terminal_spec.
static func _local_container_exec(posix_command: String) -> String:
	if OS.get_name() == "Windows":
		# stty allinea la pty alla griglia del renderer della console
		# incorporata (TermScreen.ROWS): i TUI impaginano su quella misura.
		return "docker exec -i -e TERM=xterm-256color jht script -qec \"" \
				+ _with_pty_size(posix_command) + "\" /dev/null"
	return "docker exec -it jht " + posix_command


func open_cloud_login(prefer_google := false) -> void:
	open_technical_terminal("cloud", "Account e cloud",
			("Apri il link, scegli ACCEDI CON GOOGLE, inserisci il codice e approva questo dispositivo. " \
			+ "Il pairing prosegue automaticamente.") if prefer_google else \
			"Apri il link, accedi all'account, inserisci il codice e approva questo dispositivo. Il pairing prosegue automaticamente.",
			PackedStringArray(["node", "/app/cli/bin/jht.js", "cloud", "login"]))


func open_cloud_command(command: String) -> void:
	var supported := ["status", "push", "pull-profile", "restore", "disable"]
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


static func vps_key_info(key_path := "") -> Dictionary:
	var path := VpsBackend.expand_user_path(
			key_path if key_path.strip_edges() != "" else default_vps_key_path())
	var pub := path + ".pub"
	var public_key := FileAccess.get_file_as_string(pub).strip_edges() \
			if FileAccess.file_exists(pub) else ""
	var fingerprint := ""
	if public_key != "":
		var fp := _run("ssh-keygen", PackedStringArray(["-lf", pub]))
		if fp["code"] == 0:
			fingerprint = str(fp["out"]).strip_edges()
	return {
		"path": path, "public_path": pub, "directory": path.get_base_dir(),
		"private_exists": FileAccess.file_exists(path),
		"public_exists": public_key != "", "public_key": public_key,
		"fingerprint": fingerprint,
	}


func copy_vps_public_key(key_path := "") -> void:
	var info := vps_key_info(key_path)
	if str(info.get("public_key", "")) == "":
		action_changed.emit("vps-key", false,
				"Chiave pubblica assente: genera prima la chiave SSH", false)
		return
	DisplayServer.clipboard_set(str(info["public_key"]))
	action_changed.emit("vps-key", false,
			"Chiave pubblica copiata: incollala nella sezione SSH Keys di Hetzner", true)


func reveal_vps_key(key_path := "") -> void:
	var info := vps_key_info(key_path)
	DirAccess.make_dir_recursive_absolute(str(info["directory"]))
	OS.shell_show_in_file_manager(str(info["public_path"]), true)
	action_changed.emit("vps-key", false,
			"Cartella della chiave aperta: " + str(info["directory"]), true)


func generate_vps_key() -> void:
	if _action_running:
		return
	_start_action("vps-key", _do_generate_vps_key)


static func _do_generate_vps_key() -> Dictionary:
	var path := default_vps_key_path()
	if FileAccess.file_exists(path) and FileAccess.file_exists(path + ".pub"):
		var existing := vps_key_info(path)
		return {"ok": true, "message": "Chiave SSH già disponibile · " \
				+ str(existing.get("fingerprint", path))}
	DirAccess.make_dir_recursive_absolute(path.get_base_dir())
	var result := {"code": 0, "out": ""}
	if FileAccess.file_exists(path):
		# Recupera la .pub senza rigenerare o sovrascrivere una privata valida.
		result = _run("ssh-keygen", PackedStringArray(["-y", "-f", path]))
		if result["code"] == 0:
			var public_file := FileAccess.open(path + ".pub", FileAccess.WRITE)
			if public_file == null:
				return {"ok": false, "message": "Impossibile scrivere " + path + ".pub"}
			public_file.store_string(str(result["out"]).strip_edges() \
					+ " job-hunter-team\n")
			public_file.close()
	else:
		result = _run("ssh-keygen", PackedStringArray([
				"-t", "ed25519", "-N", "", "-C", "job-hunter-team", "-f", path]))
	if result["code"] == 0 and OS.get_name() != "Windows":
		_run("chmod", PackedStringArray(["600", path]))
	var info := vps_key_info(path)
	return {"ok": result["code"] == 0,
			"message": "Chiave SSH creata · " + str(info.get("fingerprint", path)) \
			if result["code"] == 0 \
			else "Creazione chiave fallita: " + str(result["out"]).right(220)}


static func _vps_credentials(ip: String, key_path: String) -> Dictionary:
	var clean_ip := ip.strip_edges()
	var key := VpsBackend.expand_user_path(key_path.strip_edges())
	if clean_ip == "" or key == "" or not FileAccess.file_exists(key):
		return {}
	var host_re := RegEx.new()
	# Il trasporto attuale usa la sintassi scp host:path: finché non viene
	# aggiunto il bracket IPv6 esplicito accettiamo IPv4 o hostname DNS.
	host_re.compile("^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$")
	if host_re.search(clean_ip) == null:
		return {}
	return {"ip": clean_ip, "key_path": key}


func test_vps_connection(ip: String, key_path: String) -> void:
	if _action_running:
		return
	var target := _vps_credentials(ip, key_path)
	if target.is_empty():
		action_changed.emit("vps-test", false,
				"IP/hostname non valido o chiave privata non trovata", false)
		return
	_start_action("vps-test", _do_test_vps_connection.bind(target))


static func _do_test_vps_connection(target: Dictionary) -> Dictionary:
	var pinned := _pin_vps_host(str(target.get("ip", "")))
	if not bool(pinned.get("ok", false)):
		return pinned
	var result := _run_ssh(target,
			"printf 'JHT_SSH_OK '; uname -srm; test \"$(id -u)\" = 0")
	var fingerprint := str(pinned.get("fingerprint", ""))
	return {"ok": result["code"] == 0,
			"message": "SSH verificato · " + str(result["out"]).strip_edges() \
			+ ((" · HOST " + fingerprint) if fingerprint != "" else "") \
			if result["code"] == 0 else "SSH non disponibile: " \
			+ str(result.get("out", "")).strip_edges().right(260)}


static func _vps_host_fingerprint(host: String) -> String:
	var scan := _vps_host_scan(host)
	if scan["code"] != 0 or str(scan["out"]).strip_edges() == "":
		return ""
	var temp := OS.get_cache_dir().path_join(
			"jht-host-key-" + str(int(Time.get_ticks_usec())))
	var file := FileAccess.open(temp, FileAccess.WRITE)
	if file == null:
		return ""
	file.store_string(str(scan["out"]) + "\n")
	file.close()
	var fingerprint := _run("ssh-keygen", PackedStringArray(["-lf", temp]))
	DirAccess.remove_absolute(temp)
	if fingerprint["code"] != 0:
		return ""
	var parts := str(fingerprint["out"]).strip_edges().split(" ", false)
	return str(parts[1]) if parts.size() > 1 else str(fingerprint["out"]).strip_edges()


static func _vps_host_scan(host: String) -> Dictionary:
	return _run("ssh-keyscan", PackedStringArray(["-T", "5", "-t", "ed25519", host]))


static func _pin_vps_host(host: String) -> Dictionary:
	var scan := _vps_host_scan(host)
	var material := _host_key_material(str(scan.get("out", "")))
	if scan["code"] != 0 or material == "":
		return {"ok": false, "message": "Impossibile leggere la chiave host SSH"}
	var path := VpsBackend.known_hosts_path(host)
	if FileAccess.file_exists(path):
		var previous := _host_key_material(FileAccess.get_file_as_string(path))
		if previous != material:
			return {"ok": false, "message": "CHIAVE HOST SSH CAMBIATA: collegamento rifiutato"}
	else:
		DirAccess.make_dir_recursive_absolute(path.get_base_dir())
		if not _write_text(path, str(scan.get("out", "")).strip_edges() + "\n"):
			return {"ok": false, "message": "Impossibile salvare il fingerprint SSH"}
		if OS.get_name() != "Windows":
			_run("chmod", PackedStringArray(["600", path]))
	return {"ok": true, "fingerprint": _fingerprint_for_known_host(path)}


static func _host_key_material(raw: String) -> String:
	for line: String in raw.split("\n"):
		if line.begins_with("#") or line.strip_edges() == "":
			continue
		var parts := line.strip_edges().split(" ", false)
		if parts.size() >= 3:
			return str(parts[1]) + " " + str(parts[2])
	return ""


static func _fingerprint_for_known_host(path: String) -> String:
	var fingerprint := _run("ssh-keygen", PackedStringArray(["-lf", path]))
	if fingerprint["code"] != 0:
		return ""
	var parts := str(fingerprint.get("out", "")).strip_edges().split(" ", false)
	return str(parts[1]) if parts.size() > 1 else str(fingerprint.get("out", "")).strip_edges()


func provision_vps(ip: String, key_path: String) -> void:
	if _action_running:
		return
	var target := _vps_credentials(ip, key_path)
	if target.is_empty():
		action_changed.emit("vps-provision", false,
				"Inserisci un IP valido e genera/seleziona la chiave SSH", false)
		return
	_start_action("vps-provision", _do_provision_vps.bind(target))


static func _vps_prepare_runtime_command() -> String:
	# L'installer mette il wrapper in /usr/local/bin quando gira come root e in
	# ~/.local/bin per utenti normali. Non assumere uno dei due percorsi: una VPS
	# Hetzner nuova usa root e il vecchio hardcoding faceva fallire il primo up.
	return "export JHT_SKIP_ONBOARD=1; " \
			+ "JHT_BIN=\"$(command -v jht 2>/dev/null || true)\"; " \
			+ "[ -n \"$JHT_BIN\" ] || JHT_BIN=\"$HOME/.local/bin/jht\"; " \
			+ "if [ ! -x \"$JHT_BIN\" ]; then " \
			+ "curl -fsSL https://jobhunterteam.ai/install.sh | bash; " \
			+ "JHT_BIN=\"$(command -v jht 2>/dev/null || true)\"; " \
			+ "[ -n \"$JHT_BIN\" ] || JHT_BIN=\"$HOME/.local/bin/jht\"; fi; " \
			+ "[ -x \"$JHT_BIN\" ] && \"$JHT_BIN\" up"


func _do_provision_vps(target: Dictionary) -> Dictionary:
	_progress("vps-provision", "Verifico accesso SSH e privilegi root…")
	var check := _do_test_vps_connection(target)
	if not bool(check["ok"]):
		return check
	_progress("vps-provision", "Installo il runtime e preparo il container sulla VPS…")
	var command := _vps_prepare_runtime_command() + " && " \
			+ "test \"$(docker inspect jht --format '{{.State.Running}}')\" = true && " \
			+ "grep -q '^JHT_HOST_TYPE=vps' \"$HOME/.jht/host.env\""
	var result := _run_ssh(target, command)
	if result["code"] != 0:
		return {"ok": false, "message": "Setup VPS fallito: " \
				+ str(result.get("out", "")).strip_edges().right(300)}
	return {"ok": true, "message": "VPS pronta e collegamento salvato",
			"activate_vps": target}


func migrate_to_vps(ip: String, key_path: String, source_mode: String) -> void:
	if _action_running:
		return
	var target := _vps_credentials(ip, key_path)
	if target.is_empty():
		action_changed.emit("vps-migrate", false,
				"Destinazione non valida: controlla IP e chiave SSH", false)
		return
	var source := BackendBus.load_vps_config() if source_mode == "vps" else {}
	if source_mode == "vps":
		source = _vps_credentials(str(source.get("ip", "")),
				str(source.get("key_path", "")))
		if source.is_empty():
			action_changed.emit("vps-migrate", false,
					"Nessuna VPS sorgente salvata da cui migrare", false)
			return
		if str(source["ip"]) == str(target["ip"]):
			action_changed.emit("vps-migrate", false,
					"Sorgente e destinazione coincidono", false)
			return
	_start_action("vps-migrate", _do_migrate_to_vps.bind(target, source_mode, source))


## Percorso inverso, assente nella prima versione: la VPS salvata è la
## sorgente, il runtime Docker di questo computer è la destinazione.
func migrate_to_local() -> void:
	if _action_running:
		return
	var source := BackendBus.load_vps_config()
	source = _vps_credentials(str(source.get("ip", "")),
			str(source.get("key_path", "")))
	if source.is_empty():
		action_changed.emit("vps-migrate", false,
				"Nessuna VPS sorgente salvata da cui migrare", false)
		return
	_start_action("vps-migrate", _do_migrate_to_local.bind(source))


func _do_migrate_to_vps(target: Dictionary, source_mode: String,
		source: Dictionary) -> Dictionary:
	var check := _do_test_vps_connection(target)
	if not bool(check["ok"]):
		return check
	_progress("vps-migrate", "Preparo il runtime sulla nuova VPS…")
	var provision := _run_ssh(target,
			_vps_prepare_runtime_command() + " && " \
			+ "test \"$(docker inspect jht --format '{{.State.Running}}')\" = true")
	if provision["code"] != 0:
		return {"ok": false, "message": "Preparazione destinazione fallita: " \
				+ str(provision.get("out", "")).right(280)}
	var target_team_probe := _run_ssh(target,
			"docker exec jht tmux list-sessions -F '#{session_name}' 2>/dev/null")
	var target_team_was_running: bool = target_team_probe["code"] == 0 \
			and str(target_team_probe.get("out", "")).strip_edges() != ""

	var stamp := str(int(Time.get_unix_time_from_system()))
	var archive_name := "jht-migration-" + stamp + ".tar.gz"
	var local_archive := OS.get_cache_dir().path_join(archive_name)
	_progress("vps-migrate", "Fermo la sorgente e creo uno snapshot coerente…")
	var captured := _capture_migration_source(source_mode, source,
			archive_name, local_archive)
	if not bool(captured.get("ok", false)):
		return captured

	_progress("vps-migrate", "Trasferisco dati, profilo, configurazione e login…")
	var upload := _scp_upload(target, local_archive, "/tmp/" + archive_name)
	if upload["code"] != 0:
		DirAccess.remove_absolute(local_archive)
		_restore_migration_source(source_mode, source,
				bool(captured.get("container_was_running", false)),
				bool(captured.get("team_was_running", false)))
		return {"ok": false, "message": "Trasferimento fallito: " \
				+ str(upload.get("out", "")).strip_edges().right(280)}

	_progress("vps-migrate", "Verifico il trasferimento e applico in modo atomico…")
	var remote_backup := "/root/jht-before-migration-" + stamp + ".tar.gz"
	var apply := _run_ssh(target, "bash -lc " + _shell_quote(
			_remote_apply_script(archive_name, stamp,
					str(captured.get("sha256", "")), remote_backup)))
	DirAccess.remove_absolute(local_archive)
	if apply["code"] != 0:
		_rollback_vps_destination(target, stamp, target_team_was_running)
		_restore_migration_source(source_mode, source,
				bool(captured.get("container_was_running", false)),
				bool(captured.get("team_was_running", false)))
		return {"ok": false, "message": "Applicazione migrazione fallita. Backup: " \
				+ remote_backup + " · " + str(apply.get("out", "")).right(220)}

	if bool(captured.get("team_was_running", false)):
		_progress("vps-migrate", "Riavvio il team sulla nuova VPS…")
		var team_start := _run_ssh(target,
				"docker exec jht node /app/cli/bin/jht.js team start >/dev/null 2>&1 && " \
				+ "for i in $(seq 1 15); do docker exec jht tmux list-sessions " \
				+ "-F '#{session_name}' 2>/dev/null | grep -q . && exit 0; sleep 2; done; exit 1")
		if team_start["code"] != 0:
			_rollback_vps_destination(target, stamp, target_team_was_running)
			_restore_migration_source(source_mode, source,
					bool(captured.get("container_was_running", false)),
					bool(captured.get("team_was_running", false)))
			return {"ok": false, "message": "Dati trasferiti, ma avvio agenti fallito. " \
					+ "La sorgente è stata ripristinata; backup destinazione: " + remote_backup}

	# Commit del single-source handoff: se non riusciamo a disarmare la vecchia
	# origine, ripristiniamo davvero la destinazione invece di dichiarare un
	# successo con due writer potenziali.
	var handoff := _archive_source_cloud(source_mode, source, stamp)
	if not bool(handoff.get("ok", false)):
		_rollback_vps_destination(target, stamp, target_team_was_running)
		_restore_migration_source(source_mode, source,
				bool(captured.get("container_was_running", false)),
				bool(captured.get("team_was_running", false)))
		return {"ok": false, "message": "Handoff cloud non completato: " \
				+ str(handoff.get("message", "errore sconosciuto"))}
	_cleanup_vps_transaction(target, stamp)
	return {"ok": true,
			"message": "Migrazione completata · backup destinazione: " + remote_backup,
			"activate_vps": target}


func _do_migrate_to_local(source: Dictionary) -> Dictionary:
	var check := _do_test_vps_connection(source)
	if not bool(check.get("ok", false)):
		return check
	var prepared := _prepare_local_migration_target()
	if not bool(prepared.get("ok", false)):
		return prepared
	var stamp := str(int(Time.get_unix_time_from_system()))
	var archive_name := "jht-migration-" + stamp + ".tar.gz"
	var local_archive := OS.get_cache_dir().path_join(archive_name)
	_progress("vps-migrate", "Fermo la VPS e scarico uno snapshot coerente…")
	var captured := _capture_migration_source("vps", source,
			archive_name, local_archive)
	if not bool(captured.get("ok", false)):
		return captured
	_progress("vps-migrate", "Creo il backup locale e applico in modo atomico…")
	var applied := _apply_archive_to_local(local_archive, stamp,
			bool(captured.get("team_was_running", false)))
	DirAccess.remove_absolute(local_archive)
	if not bool(applied.get("ok", false)):
		_restore_migration_source("vps", source,
				bool(captured.get("container_was_running", false)),
				bool(captured.get("team_was_running", false)))
		return applied
	var handoff := _archive_source_cloud("vps", source, stamp)
	if not bool(handoff.get("ok", false)):
		_rollback_local_destination(applied, true)
		_restore_migration_source("vps", source,
				bool(captured.get("container_was_running", false)),
				bool(captured.get("team_was_running", false)))
		return {"ok": false, "message": "Handoff cloud non completato: " \
				+ str(handoff.get("message", "errore sconosciuto"))}
	_commit_local_destination(applied)
	return {"ok": true,
			"message": "Migrazione sul computer completata · backup: " \
				+ str(applied.get("backup", "")), "activate_local": true}


## Cattura un'unica fotografia della sorgente, la valida e ne conserva il
## checksum end-to-end. Il chiamante è responsabile del riavvio in caso KO.
static func _capture_migration_source(source_mode: String, source: Dictionary,
		archive_name: String, local_archive: String) -> Dictionary:
	var container_was_running := false
	var team_was_running := false
	var created := {"code": 0, "out": ""}
	var expected_sha := ""
	if source_mode == "vps":
		var container := _run_ssh(source,
				"docker inspect jht --format '{{.State.Running}}' 2>/dev/null")
		container_was_running = container["code"] == 0 \
				and str(container.get("out", "")).strip_edges() == "true"
		var team := _run_ssh(source,
				"docker exec jht tmux list-sessions -F '#{session_name}' 2>/dev/null")
		team_was_running = team["code"] == 0 \
				and str(team.get("out", "")).strip_edges() != ""
		var remote_archive := "/tmp/" + archive_name
		var script := "set -eu; docker stop jht >/dev/null 2>&1 || true; " \
				+ "cd /root; set --; [ -d .jht ] && set -- \"$@\" .jht; " \
				+ "[ -d \"Documents/Job Hunter Team\" ] && " \
				+ "set -- \"$@\" \"Documents/Job Hunter Team\"; " \
				+ "[ \"$#\" -gt 0 ]; tar czf " + remote_archive \
				+ " --exclude='.jht/ssh' --exclude='.jht/runtime' " \
				+ "--exclude='.jht/host.env' \"$@\"; " \
				+ "test -s " + remote_archive + "; sha256sum " + remote_archive \
				+ " | awk '{print $1}'"
		created = _run_ssh(source, "bash -lc " + _shell_quote(script))
		if created["code"] == 0:
			expected_sha = str(created.get("out", "")).strip_edges().split("\n")[-1]
			created = _scp_download(source, remote_archive, local_archive)
		_run_ssh(source, "rm -f " + remote_archive)
	else:
		var team := _run("docker", PackedStringArray([
				"exec", "jht", "tmux", "list-sessions", "-F", "#{session_name}"]))
		team_was_running = team["code"] == 0 \
				and str(team.get("out", "")).strip_edges() != ""
		var container := _run("docker", PackedStringArray([
				"inspect", "jht", "--format", "{{.State.Running}}"] ))
		container_was_running = container["code"] == 0 \
				and str(container.get("out", "")).contains("true")
		if container_was_running:
			_run("docker", PackedStringArray(["stop", "jht"]))
		created = _create_local_migration_archive(local_archive)
	if created["code"] != 0:
		if FileAccess.file_exists(local_archive):
			DirAccess.remove_absolute(local_archive)
		_restore_migration_source(source_mode, source, container_was_running,
				team_was_running)
		return {"ok": false, "message": "Snapshot sorgente fallito: " \
				+ str(created.get("out", "")).strip_edges().right(280)}
	var valid := _validate_migration_archive(local_archive)
	if not bool(valid.get("ok", false)):
		DirAccess.remove_absolute(local_archive)
		_restore_migration_source(source_mode, source, container_was_running,
				team_was_running)
		return valid
	var actual_sha := FileAccess.get_sha256(local_archive)
	if actual_sha == "" or (expected_sha != "" and actual_sha != expected_sha):
		DirAccess.remove_absolute(local_archive)
		_restore_migration_source(source_mode, source, container_was_running,
				team_was_running)
		return {"ok": false, "message": "Checksum snapshot non valido"}
	return {"ok": true, "sha256": actual_sha,
			"container_was_running": container_was_running,
			"team_was_running": team_was_running}


static func _validate_migration_archive(path: String) -> Dictionary:
	if not _file_nonempty(path):
		return {"ok": false, "message": "Snapshot vuoto o non leggibile"}
	var listing := _run("tar", PackedStringArray(["-tzf", path]))
	if listing["code"] != 0:
		return {"ok": false, "message": "Snapshot corrotto: " \
				+ str(listing.get("out", "")).right(220)}
	var has_jht := false
	var has_payload := false
	for raw: String in str(listing.get("out", "")).split("\n"):
		var name := raw.strip_edges().trim_prefix("./")
		if name == "":
			continue
		if name.begins_with("/") or name.split("/").has(".."):
			return {"ok": false, "message": "Snapshot contiene un percorso non sicuro"}
		if name == ".jht" or name.begins_with(".jht/"):
			has_jht = true
		if name in [".jht/jobs.db", ".jht/jht.config.json"] \
				or name.begins_with(".jht/profile/"):
			has_payload = true
		if name == ".jht/host.env" or name.begins_with(".jht/ssh/") \
				or name.begins_with(".jht/runtime/"):
			return {"ok": false, "message": "Snapshot include file host riservati"}
	if not has_jht or not has_payload:
		return {"ok": false, "message": "Snapshot non contiene un team JHT valido"}
	return {"ok": true}


static func _remote_apply_script(archive_name: String, stamp: String,
		sha256: String, backup: String) -> String:
	var archive := "/tmp/" + archive_name
	var stage := "/root/.jht-migration-stage-" + stamp
	var old_jht := "/root/.jht.migration-old-" + stamp
	var old_docs := "/root/Documents/Job Hunter Team.migration-old-" + stamp
	return "set -eu; ARCH=" + _shell_quote(archive) + "; STAGE=" \
			+ _shell_quote(stage) + "; BACKUP=" + _shell_quote(backup) + "; " \
			+ "test \"$(sha256sum \"$ARCH\" | awk '{print $1}')\" = " \
			+ _shell_quote(sha256) + "; rm -rf -- \"$STAGE\"; mkdir -p \"$STAGE\"; " \
			+ "tar tzf \"$ARCH\" >/dev/null; tar xzf \"$ARCH\" -C \"$STAGE\" --no-same-owner; " \
			+ "test -d \"$STAGE/.jht\"; " \
			+ "test -f \"$STAGE/.jht/jobs.db\" -o -f \"$STAGE/.jht/jht.config.json\" " \
			+ "-o -d \"$STAGE/.jht/profile\"; " \
			+ "mkdir -p \"$STAGE/Documents/Job Hunter Team\"; " \
			+ "[ ! -d /root/.jht/ssh ] || cp -a /root/.jht/ssh \"$STAGE/.jht/ssh\"; " \
			+ "[ ! -d /root/.jht/runtime ] || cp -a /root/.jht/runtime \"$STAGE/.jht/runtime\"; " \
			+ "printf 'JHT_HOST_TYPE=vps\\n' > \"$STAGE/.jht/host.env\"; " \
			+ "cd /root; set --; [ -d .jht ] && set -- \"$@\" .jht; " \
			+ "[ -d \"Documents/Job Hunter Team\" ] && set -- \"$@\" \"Documents/Job Hunter Team\"; " \
			+ "if [ \"$#\" -gt 0 ]; then tar czf \"$BACKUP\" \"$@\"; " \
			+ "else tar czf \"$BACKUP\" --files-from /dev/null; fi; test -s \"$BACKUP\"; chmod 600 \"$BACKUP\"; " \
			+ "docker stop jht >/dev/null 2>&1 || true; rm -rf -- " \
			+ _shell_quote(old_jht) + " " + _shell_quote(old_docs) + "; " \
			+ "mv /root/.jht " + _shell_quote(old_jht) + "; " \
			+ "mv \"/root/Documents/Job Hunter Team\" " + _shell_quote(old_docs) + "; " \
			+ "mv \"$STAGE/.jht\" /root/.jht; " \
			+ "mv \"$STAGE/Documents/Job Hunter Team\" \"/root/Documents/Job Hunter Team\"; " \
			+ "chown -R 1001:1001 /root/.jht \"/root/Documents/Job Hunter Team\"; " \
			+ "chmod 600 /root/.jht/cloud.json 2>/dev/null || true; " \
			+ _vps_prepare_runtime_command() + "; " \
			+ "test \"$(docker inspect jht --format '{{.State.Running}}')\" = true; " \
			+ "grep -q '^JHT_HOST_TYPE=vps' /root/.jht/host.env; " \
			+ "if [ -f /root/.jht/jobs.db ]; then docker exec jht python3 -c " \
			+ _shell_quote("import sqlite3,sys; c=sqlite3.connect('/jht_home/jobs.db'); sys.exit(0 if c.execute('pragma integrity_check').fetchone()[0]=='ok' else 1)") \
			+ "; fi; rm -f \"$ARCH\""


static func _rollback_vps_destination(target: Dictionary, stamp: String,
		team_was_running: bool = false) -> void:
	var old_jht := "/root/.jht.migration-old-" + stamp
	var old_docs := "/root/Documents/Job Hunter Team.migration-old-" + stamp
	var stage := "/root/.jht-migration-stage-" + stamp
	var script := "set -u; if [ -d " + _shell_quote(old_jht) + " ]; then " \
			+ "docker stop jht >/dev/null 2>&1 || true; rm -rf -- /root/.jht; " \
			+ "mv " + _shell_quote(old_jht) + " /root/.jht; " \
			+ "if [ -d " + _shell_quote(old_docs) + " ]; then rm -rf -- " \
			+ "\"/root/Documents/Job Hunter Team\"; mv " + _shell_quote(old_docs) \
			+ " \"/root/Documents/Job Hunter Team\"; fi; " \
			+ _vps_prepare_runtime_command() + " >/dev/null 2>&1 || true; fi; " \
			+ "rm -rf -- " + _shell_quote(stage)
	_run_ssh(target, "bash -lc " + _shell_quote(script))
	if team_was_running:
		_run_ssh(target,
				"docker exec jht node /app/cli/bin/jht.js team start >/dev/null 2>&1 || true")


static func _cleanup_vps_transaction(target: Dictionary, stamp: String) -> void:
	var script := "rm -rf -- " + _shell_quote("/root/.jht.migration-old-" + stamp) \
			+ " " + _shell_quote("/root/Documents/Job Hunter Team.migration-old-" + stamp) \
			+ " " + _shell_quote("/root/.jht-migration-stage-" + stamp)
	_run_ssh(target, script)


func _prepare_local_migration_target() -> Dictionary:
	var daemon := _run("docker", PackedStringArray(["version", "--format",
			"{{.Server.Version}}"] ))
	if daemon["code"] != 0:
		var launch := _launch_docker_runtime()
		if not bool(launch.get("ok", false)):
			return launch
		_progress("vps-migrate", str(launch.get("message", "Avvio Docker…")))
		for waited in range(2, 122, 2):
			OS.delay_msec(2000)
			daemon = _run("docker", PackedStringArray(["version", "--format",
					"{{.Server.Version}}"] ))
			if daemon["code"] == 0:
				break
			_progress("vps-migrate", "Avvio di Docker in corso… (%ds)" % waited)
	if daemon["code"] != 0:
		return {"ok": false, "message": "Docker locale non risponde"}
	var compose := _ensure_compose_file()
	if compose == "":
		return {"ok": false, "message": "Impossibile preparare il runtime locale"}
	_ensure_host_dirs()
	var pull := _compose_stream(compose, PackedStringArray(["pull", "jht"]),
			"Preparo l'immagine del team sul computer…")
	if not bool(pull.get("ok", false)) and _local_image_id() == "":
		return {"ok": false, "message": "Immagine runtime non disponibile: " \
				+ str(pull.get("tail", "")).right(220)}
	return {"ok": true}


func _apply_archive_to_local(archive: String, stamp: String,
		team_was_running: bool) -> Dictionary:
	var home := _host_home()
	var stage := home.path_join(".jht-migration-stage-" + stamp)
	var staged_jht := stage.path_join(".jht")
	var staged_docs := stage.path_join("Documents/Job Hunter Team")
	_remove_tree(stage)
	DirAccess.make_dir_recursive_absolute(stage)
	var extracted := _run("tar", PackedStringArray(["-xzf", archive, "-C", stage]))
	if extracted["code"] != 0 or not DirAccess.dir_exists_absolute(staged_jht):
		_remove_tree(stage)
		return {"ok": false, "message": "Estrazione locale fallita: " \
				+ str(extracted.get("out", "")).right(220)}
	if not FileAccess.file_exists(staged_jht.path_join("jobs.db")) \
			and not FileAccess.file_exists(staged_jht.path_join("jht.config.json")) \
			and not DirAccess.dir_exists_absolute(staged_jht.path_join("profile")):
		_remove_tree(stage)
		return {"ok": false, "message": "Lo snapshot estratto non contiene un team valido"}
	DirAccess.make_dir_recursive_absolute(staged_docs)
	# Il runtime e le chiavi appartengono alla macchina destinazione, non alla
	# sorgente. Si preservano fuori dallo snapshot prima dello swap atomico.
	for rel in ["ssh", "runtime"]:
		var src := home.path_join(".jht/" + rel)
		if DirAccess.dir_exists_absolute(src):
			var copied := _copy_tree(src, staged_jht.path_join(rel))
			if copied != OK:
				_remove_tree(stage)
				return {"ok": false, "message": "Impossibile preservare .jht/" + rel}
	var host_env := _local_host_env(home.path_join(".jht/host.env"))
	if not _write_text(staged_jht.path_join("host.env"), host_env):
		_remove_tree(stage)
		return {"ok": false, "message": "Impossibile impostare la modalità locale"}

	var backup_dir := home.path_join(".jht-migration-backups")
	DirAccess.make_dir_recursive_absolute(backup_dir)
	var backup := backup_dir.path_join("jht-before-migration-" + stamp + ".tar.gz")
	var backed_up := _create_local_destination_backup(backup)
	if backed_up["code"] != 0 or not _file_nonempty(backup):
		_remove_tree(stage)
		return {"ok": false, "message": "Backup locale fallito: " \
				+ str(backed_up.get("out", "")).right(220)}
	if OS.get_name() != "Windows":
		_run("chmod", PackedStringArray(["600", backup]))

	var current_jht := home.path_join(".jht")
	var current_docs := home.path_join("Documents/Job Hunter Team")
	var old_jht := home.path_join(".jht.migration-old-" + stamp)
	var old_docs := home.path_join("Documents/Job Hunter Team.migration-old-" + stamp)
	var old_running := _container_is_running()
	var old_team_probe := _run("docker", PackedStringArray([
			"exec", "jht", "tmux", "list-sessions", "-F", "#{session_name}"]))
	var old_team_running: bool = old_team_probe["code"] == 0 \
			and str(old_team_probe.get("out", "")).strip_edges() != ""
	if old_running:
		_run("docker", PackedStringArray(["stop", "jht"]))
	_remove_tree(old_jht)
	_remove_tree(old_docs)
	var tx := {"ok": false, "stage": stage, "old_jht": old_jht,
			"old_docs": old_docs, "current_jht": current_jht,
			"current_docs": current_docs, "backup": backup,
			"old_container_running": old_running,
			"old_team_running": old_team_running, "jht_moved": false,
			"docs_moved": false, "jht_activated": false, "docs_activated": false}
	if DirAccess.rename_absolute(current_jht, old_jht) != OK:
		_remove_tree(stage)
		return {"ok": false, "message": "Impossibile mettere al sicuro ~/.jht"}
	tx["jht_moved"] = true
	if DirAccess.dir_exists_absolute(current_docs) \
			and DirAccess.rename_absolute(current_docs, old_docs) != OK:
		_rollback_local_destination(tx, true)
		return {"ok": false, "message": "Impossibile mettere al sicuro i documenti"}
	tx["docs_moved"] = DirAccess.dir_exists_absolute(old_docs)
	if DirAccess.rename_absolute(staged_jht, current_jht) != OK:
		_rollback_local_destination(tx, true)
		return {"ok": false, "message": "Impossibile attivare i dati migrati"}
	tx["jht_activated"] = true
	DirAccess.make_dir_recursive_absolute(current_docs.get_base_dir())
	if DirAccess.rename_absolute(staged_docs, current_docs) != OK:
		_rollback_local_destination(tx, true)
		return {"ok": false, "message": "Impossibile attivare i documenti migrati"}
	tx["docs_activated"] = true

	var started := _do_start_container()
	if not bool(started.get("ok", false)):
		_rollback_local_destination(tx, true)
		return {"ok": false, "message": "Avvio del runtime migrato fallito: " \
				+ str(started.get("message", ""))}
	var checked := _validate_local_migration_target()
	if not bool(checked.get("ok", false)):
		_rollback_local_destination(tx, true)
		return checked
	if team_was_running:
		var team := _do_start_team({})
		if not bool(team.get("ok", false)):
			_rollback_local_destination(tx, true)
			return {"ok": false, "message": "Dati integri, ma riavvio team locale fallito"}
	tx["ok"] = true
	return tx


static func _validate_local_migration_target() -> Dictionary:
	var running := _run("docker", PackedStringArray([
			"inspect", "jht", "--format", "{{.State.Running}}"] ))
	if running["code"] != 0 or str(running.get("out", "")).strip_edges() != "true":
		return {"ok": false, "message": "Il container locale migrato non è attivo"}
	if FileAccess.file_exists(_jht_home().path_join("jobs.db")):
		var py := "import sqlite3,sys; c=sqlite3.connect('/jht_home/jobs.db'); " \
				+ "sys.exit(0 if c.execute('pragma integrity_check').fetchone()[0]=='ok' else 1)"
		var integrity := _run("docker", PackedStringArray([
				"exec", "jht", "python3", "-c", py]))
		if integrity["code"] != 0:
			return {"ok": false, "message": "Il database migrato non supera integrity_check"}
	var host_env := FileAccess.get_file_as_string(_jht_home().path_join("host.env"))
	if not host_env.contains("JHT_HOST_TYPE=local"):
		return {"ok": false, "message": "Il runtime migrato non è in modalità locale"}
	return {"ok": true}


static func _create_local_destination_backup(path: String) -> Dictionary:
	var home := _host_home()
	var args := PackedStringArray(["-czf", path, "-C", home])
	if DirAccess.dir_exists_absolute(home.path_join(".jht")):
		args.append(".jht")
	if DirAccess.dir_exists_absolute(home.path_join("Documents/Job Hunter Team")):
		args.append("Documents/Job Hunter Team")
	if args.size() == 4:
		# tar portabile per una destinazione realmente vuota.
		args.append("--files-from")
		args.append("/dev/null" if OS.get_name() != "Windows" else "NUL")
	return _run("tar", args)


static func _archive_source_cloud(source_mode: String, source: Dictionary,
		stamp: String) -> Dictionary:
	if source_mode == "vps":
		var archived := "/root/.jht/cloud.json.migrated-" + stamp
		var result := _run_ssh(source, "set -eu; if [ -f /root/.jht/cloud.json ]; " \
				+ "then mv /root/.jht/cloud.json " + archived + "; " \
				+ "test -f " + archived + " && test ! -f /root/.jht/cloud.json; fi")
		return {"ok": result["code"] == 0,
				"message": str(result.get("out", "")).right(220)}
	var cloud := _jht_home().path_join("cloud.json")
	if not FileAccess.file_exists(cloud):
		return {"ok": true}
	var archived := cloud + ".migrated-" + stamp
	var err := DirAccess.rename_absolute(cloud, archived)
	return {"ok": err == OK and FileAccess.file_exists(archived) \
			and not FileAccess.file_exists(cloud),
			"message": "impossibile archiviare " + cloud if err != OK else ""}


static func _rollback_local_destination(tx: Dictionary, restore_container: bool) -> void:
	if restore_container:
		_run("docker", PackedStringArray(["stop", "jht"]))
	var current_jht := str(tx.get("current_jht", ""))
	var current_docs := str(tx.get("current_docs", ""))
	var old_jht := str(tx.get("old_jht", ""))
	var old_docs := str(tx.get("old_docs", ""))
	if bool(tx.get("jht_activated", false)):
		_remove_tree(current_jht)
	if bool(tx.get("jht_moved", false)) and old_jht != "" \
			and DirAccess.dir_exists_absolute(old_jht):
		DirAccess.rename_absolute(old_jht, current_jht)
	if bool(tx.get("docs_activated", false)):
		_remove_tree(current_docs)
	if bool(tx.get("docs_moved", false)) and old_docs != "" \
			and DirAccess.dir_exists_absolute(old_docs):
		DirAccess.rename_absolute(old_docs, current_docs)
	_remove_tree(str(tx.get("stage", "")))
	if restore_container and bool(tx.get("old_container_running", false)):
		_run("docker", PackedStringArray(["start", "jht"]))
		if bool(tx.get("old_team_running", false)):
			_run("docker", PackedStringArray(["exec", "jht", "node",
					"/app/cli/bin/jht.js", "team", "start"]))


static func _commit_local_destination(tx: Dictionary) -> void:
	_remove_tree(str(tx.get("old_jht", "")))
	_remove_tree(str(tx.get("old_docs", "")))
	_remove_tree(str(tx.get("stage", "")))


static func _host_home() -> String:
	return (OS.get_environment("USERPROFILE") if OS.get_name() == "Windows" \
			else OS.get_environment("HOME")).rstrip("/\\")


static func _local_host_env(existing_path: String) -> String:
	var lines := PackedStringArray()
	if FileAccess.file_exists(existing_path):
		for raw: String in FileAccess.get_file_as_string(existing_path).split("\n"):
			if raw.strip_edges() != "" and not raw.begins_with("JHT_HOST_TYPE="):
				lines.append(raw)
	var output := PackedStringArray(["JHT_HOST_TYPE=local"])
	output.append_array(lines)
	return "\n".join(output) + "\n"


static func _write_text(path: String, content: String) -> bool:
	DirAccess.make_dir_recursive_absolute(path.get_base_dir())
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		return false
	file.store_string(content)
	file.close()
	return true


static func _copy_tree(source: String, destination: String) -> Error:
	if not DirAccess.dir_exists_absolute(source):
		return OK
	var made := DirAccess.make_dir_recursive_absolute(destination)
	if made != OK:
		return made
	var directory := DirAccess.open(source)
	if directory == null:
		return DirAccess.get_open_error()
	directory.list_dir_begin()
	var entry := directory.get_next()
	while entry != "":
		if entry != "." and entry != "..":
			# SSH e runtime appartengono alla destinazione. Non seguiamo link:
			# potrebbero uscire dall'albero e copiare dati arbitrari nel backup.
			if directory.is_link(entry):
				directory.list_dir_end()
				return ERR_LINK_FAILED
			var source_entry := source.path_join(entry)
			var destination_entry := destination.path_join(entry)
			var copied := OK
			if directory.current_is_dir():
				copied = _copy_tree(source_entry, destination_entry)
			else:
				copied = DirAccess.copy_absolute(source_entry, destination_entry)
			if copied != OK:
				directory.list_dir_end()
				return copied
		entry = directory.get_next()
	directory.list_dir_end()
	return OK


static func _file_nonempty(path: String) -> bool:
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		return false
	var size := file.get_length()
	file.close()
	return size > 0


static func _remove_tree(path: String) -> void:
	# Solo directory transazionali risolte esplicitamente dai chiamanti; niente
	# glob o variabili shell. Su file/symlink basta remove_absolute.
	if path == "":
		return
	if FileAccess.file_exists(path) and not DirAccess.dir_exists_absolute(path):
		DirAccess.remove_absolute(path)
		return
	if not DirAccess.dir_exists_absolute(path):
		return
	var directory := DirAccess.open(path)
	if directory == null:
		return
	directory.list_dir_begin()
	var entry := directory.get_next()
	while entry != "":
		if entry != "." and entry != "..":
			var child := path.path_join(entry)
			if directory.current_is_dir() and not directory.is_link(entry):
				_remove_tree(child)
			else:
				DirAccess.remove_absolute(child)
		entry = directory.get_next()
	directory.list_dir_end()
	DirAccess.remove_absolute(path)


static func _create_local_migration_archive(path: String) -> Dictionary:
	var home := _host_home()
	var args := PackedStringArray(["-czf", path, "-C", home,
			"--exclude=.jht/ssh", "--exclude=.jht/runtime",
			"--exclude=.jht/host.env"])
	if DirAccess.dir_exists_absolute(home.path_join(".jht")):
		args.append(".jht")
	if DirAccess.dir_exists_absolute(home.path_join("Documents/Job Hunter Team")):
		args.append("Documents/Job Hunter Team")
	if args.size() == 7:
		return {"code": -1, "out": "nessun dato JHT trovato sul computer"}
	return _run("tar", args)


static func _scp_download(source: Dictionary, remote: String, local: String) -> Dictionary:
	var key := VpsBackend.expand_user_path(str(source.get("key_path", "")))
	var known := VpsBackend.known_hosts_path(str(source.get("ip", "")))
	return _run("scp", PackedStringArray(["-i", key, "-o", "BatchMode=yes",
			"-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=yes",
			"-o", "UserKnownHostsFile=" + known,
			"root@" + str(source.get("ip", "")) + ":" + remote, local]))


static func _scp_upload(target: Dictionary, local: String, remote: String) -> Dictionary:
	var key := VpsBackend.expand_user_path(str(target.get("key_path", "")))
	var known := VpsBackend.known_hosts_path(str(target.get("ip", "")))
	return _run("scp", PackedStringArray(["-i", key, "-o", "BatchMode=yes",
			"-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=yes",
			"-o", "UserKnownHostsFile=" + known,
			local, "root@" + str(target.get("ip", "")) + ":" + remote]))


static func _restore_migration_source(source_mode: String, source: Dictionary,
		container_was_running: bool, team_was_running: bool) -> void:
	if not container_was_running:
		return
	if source_mode == "vps":
		_run_ssh(source, "docker start jht >/dev/null 2>&1 || true")
		if team_was_running:
			_run_ssh(source,
					"docker exec jht node /app/cli/bin/jht.js team start >/dev/null 2>&1 || true")
	else:
		_run("docker", PackedStringArray(["start", "jht"]))
		if team_was_running:
			_run("docker", PackedStringArray(["exec", "jht", "node",
					"/app/cli/bin/jht.js", "team", "start"]))


func open_vps_install(ip: String, key_path: String) -> void:
	var target := _vps_credentials(ip, key_path)
	if target.is_empty():
		action_changed.emit("vps-install", false,
				"Inserisci l'IP e genera/seleziona una chiave SSH prima di installare", false)
		return
	var remote := _vps_prepare_runtime_command()
	var key := str(target["key_path"])
	var clean_ip := str(target["ip"])
	var known := VpsBackend.known_hosts_path(clean_ip)
	var command := "ssh -tt -i " + _local_quote(key) \
			+ " -o StrictHostKeyChecking=yes -o UserKnownHostsFile=" \
			+ _local_quote(known) + " " + _local_quote("root@" + clean_ip) \
			+ " " + _local_quote(remote)
	terminal_requested.emit("vps-install", embedded_terminal_spec(
			"Installa JHT sulla VPS",
			"Installazione remota completa, incluso l'avvio del container. Al termine chiudi la console e premi Collega.",
			command))


func email_status() -> Dictionary:
	if BackendBus.is_live():
		return BackendBus.live_settings.get("email_account", {})
	var data := JhtFs.read_json("credentials/email_monitor.json")
	return {"configured": str(data.get("user", "")) != "",
			"email": str(data.get("user", "")),
			"host": str(data.get("imap_host", ""))}


func cloud_status() -> Dictionary:
	if BackendBus.is_live():
		return BackendBus.live_settings.get("cloud_account", {})
	var data := JhtFs.read_json("cloud.json")
	return {"configured": bool(data.get("enabled", false)) \
			and str(data.get("token", "")) != "",
			"base_url": str(data.get("base_url", "")),
			"user_id": str(data.get("user_id", "")),
			"token_name": str(data.get("token_name", ""))}


func telegram_status() -> Dictionary:
	if BackendBus.is_live():
		return BackendBus.live_settings.get("telegram_bots", {})
	var config := JhtFs.read_json("jht.config.json")
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
		const EMAIL_CRED := "credentials/email_monitor.json"
		if JhtFs.write_text(EMAIL_CRED, payload):
			JhtFs.chmod(EMAIL_CRED, "600")  # è una password: non resta leggibile a tutti
			saved = {"code": 0, "out": ""}
		else:
			saved = {"code": -1, "out": "cartella dati non scrivibile"}
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
		result["code"] = 0 if JhtFs.remove("credentials/email_monitor.json") else -1
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
	var known := VpsBackend.known_hosts_path(str(vps.get("ip", "")))
	var target := "root@" + str(vps.get("ip", ""))
	var process := OS.execute_with_pipe("ssh", PackedStringArray([
		"-i", key, "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes",
		"-o", "ConnectTimeout=8", "-o", "StrictHostKeyChecking=yes",
		"-o", "UserKnownHostsFile=" + known,
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
	var login := ""
	match provider:
		"codex": login = "codex login --device-auth"
		"kimi": login = "kimi --yolo"
		_: login = "claude --dangerously-skip-permissions"
	# Il CLI del provider NON è baked nell'immagine (install lazily in
	# /jht_home/.npm-global). Il login DEVE partire SOLO a CLI installato,
	# altrimenti "sh: claude: not found" (Leone 24/07). Prependiamo l'install
	# idempotente (progress a video) e col `&&` il login: install→login in
	# un'unica sessione, ordine garantito.
	# `sh -c` (NON `-lc`): la login shell sourcerebbe /etc/profile e RESETTA il
	# PATH a /usr/local/bin:/usr/bin:/bin, buttando via /jht_home/.npm-global/bin
	# dove claude è appena stato installato → "claude: not found" (verificato
	# live 24/07). `sh -c` eredita il PATH del container (ENV Dockerfile), che
	# include .npm-global/bin.
	var install_id := str(PROVIDERS.get(provider, {}).get("install_id", provider))
	var tool := "sh -c 'node /app/cli/bin/jht.js providers update " \
			+ install_id + " && " + login + "'"
	if vps.is_empty():
		if OS.get_name() == "Windows":
			# cmd.exe non ha printf: niente banner, dritto al comando.
			return _local_container_exec(tool)
		return "printf '\\nJHT — login con abbonamento (console interna)\\n\\n'; " \
				+ _local_container_exec(tool)
	var inner := "docker exec -it jht " + tool
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
			return "Nel menu Claude scegli Login with subscription. Se il browser non si apre: " \
					+ "COPIA LINK qui sotto e incollalo nel browser. Poi copia il codice dal browser, " \
					+ "premi INCOLLA e Invio; se non risponde, premi INVIO una seconda volta."


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
	if bool(result.get("ok", false)) and result.get("activate_vps") is Dictionary:
		var target: Dictionary = result["activate_vps"]
		BackendBus.save_vps_config(str(target.get("ip", "")),
				str(target.get("key_path", "")))
		BackendBus.set_backend(VpsBackend.new(), target)
	elif bool(result.get("ok", false)) and bool(result.get("activate_local", false)):
		BackendBus.switch_to_local_backend()
	refresh()


## Comandi di spegnimento da eseguire quando l'utente chiude il gioco.
##
## In LOCALE si ferma tutto: gli agenti vivono nel container sul computer
## dell'utente e continuavano a lavorare — e a consumare token — a finestra
## chiusa, senza che nulla lo dicesse (Leone se n'è accorto dal traffico di
## rete, 25/07). Prima uno stop pulito degli agenti, che così salvano il loro
## stato, poi il container.
##
## Su VPS non si tocca NIENTE: là il team deve girare anche a gioco chiuso, è
## esattamente il motivo per cui esiste una macchina remota.
static func shutdown_commands(vps: Dictionary) -> Array:
	if not vps.is_empty():
		return []
	var cli := PackedStringArray(["exec", "jht", "node", "/app/cli/bin/jht.js"])
	var stop_all := cli.duplicate()
	stop_all.append_array(PackedStringArray(["team", "stop", "--all"]))
	var stop_assistant := cli.duplicate()
	# `team stop --all` preserva l'Assistente di proposito (è quello della chat):
	# in uscita va chiuso anche lui, altrimenti resta un processo vivo.
	stop_assistant.append_array(PackedStringArray(["team", "stop", "assistente"]))
	return [stop_all, stop_assistant, PackedStringArray(["stop", "jht"])]


## Flag che il Capitano crea quando TUTTI hanno chiuso in ordine: è il segnale
## che il gioco può spegnere il container e uscire senza troncare lavoro.
const SHUTDOWN_READY_FLAG := "/jht_home/.shutdown-ready.flag"

## Sessioni tmux vive nel container: sono gli agenti che l'utente vedrebbe
## interrompere chiudendo la finestra. Vuoto se il container non risponde.
static func active_agents() -> PackedStringArray:
	var res := _run("docker", PackedStringArray(["exec", "jht", "tmux",
			"list-sessions", "-F", "#{session_name}"]))
	if res["code"] != 0:
		return PackedStringArray()
	var names := PackedStringArray()
	for line: String in str(res["out"]).split("\n"):
		var name := line.strip_edges()
		if name != "":
			names.append(name)
	return names


## Chiede al Capitano di chiudere la giornata come si deve: ogni agente scrive
## sulla propria agenda a che punto era, così alla riapertura si riprende invece
## di ricominciare. Il gioco non ferma nessuno da sé — aspetta il flag.
static func request_graceful_shutdown() -> bool:
	_run("docker", PackedStringArray(["exec", "jht", "rm", "-f",
			SHUTDOWN_READY_FLAG]))
	var order := "[@utente -> @capitano] [SHUTDOWN] L'utente sta chiudendo " \
			+ "l'applicazione. Usa la skill graceful-shutdown: fai annotare a " \
			+ "ogni agente lo stato del lavoro in corso sulla propria agenda, " \
			+ "poi fermali uno a uno e infine crea il flag " \
			+ SHUTDOWN_READY_FLAG + " che chiude l'applicazione."
	var res := _run("docker", PackedStringArray(["exec", "jht",
			"jht-tmux-send", "CAPITANO", order]))
	Log.call_deferred("info", "setup", "ordine di chiusura al Capitano → %d"
			% res["code"])
	return res["code"] == 0


## Il Capitano ha finito? Il flag è l'unica prova che accettiamo.
static func graceful_shutdown_ready() -> bool:
	return _run("docker", PackedStringArray(["exec", "jht", "test", "-f",
			SHUTDOWN_READY_FLAG]))["code"] == 0


## Esegue lo spegnimento. Bloccante: la chiama un thread, non il main loop.
func shutdown_team() -> void:
	for argv: PackedStringArray in shutdown_commands(_vps_config()):
		var res := _run("docker", argv)
		Log.call_deferred("info", "setup", "spegnimento: docker %s → %d"
				% [" ".join(argv), res["code"]])


func _vps_config() -> Dictionary:
	return BackendBus.load_vps_config() if BackendBus.is_live() else {}


static func _run_ssh(vps: Dictionary, command: String) -> Dictionary:
	var key := VpsBackend.expand_user_path(str(vps.get("key_path", "")))
	var known := VpsBackend.known_hosts_path(str(vps.get("ip", "")))
	var target := "root@" + str(vps.get("ip", ""))
	return _run("ssh", PackedStringArray(["-i", key, "-o", "BatchMode=yes",
			"-o", "IdentitiesOnly=yes", "-o", "ConnectTimeout=8",
			"-o", "StrictHostKeyChecking=yes",
			"-o", "UserKnownHostsFile=" + known, target, command]))
