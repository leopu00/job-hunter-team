extends Node
## Stato e azioni del primo setup. L'ufficio non viene mai bloccato: questo
## servizio espone i tre prerequisiti che rendono operativo il team locale.

const PullProgressState := preload("res://scripts/setup/pull_progress_state.gd")

signal status_changed(status: Dictionary)
signal action_changed(action: String, running: bool, message: String, ok: bool)
## Stato causale dell'avvio team. Vive nel servizio, non nel pannello: un
## rebuild della UI non può cancellare fallimento o recupero in corso.
signal team_start_state_changed(state: Dictionary)
## Fase dell'azione lunga in corso ("engine" → "image" → "container", "team").
## L'attivazione è un processo a più fasi dietro UN pulsante: senza questo
## segnale la UI sa solo che "qualcosa gira", non a che punto è — e l'utente
## non sa se aspettare o ripremere (feedback 30/07).
signal phase_changed(action: String, phase: String)
## Avanzamento STRUTTURATO del pull dell'immagine (byte scaricati/totali per
## livello, dallo stream di `docker compose pull`). Il messaggio testuale di
## action_changed non basta a una barra: serve il numero, non la frase.
## fraction è -1.0 finché docker non ha dichiarato nessuna dimensione — la UI
## in quel caso NON deve inventare una percentuale.
signal pull_progress(info: Dictionary)
## La UI del gioco ospita il processo in una console modale. Il servizio non
## deve mai aprire Terminal.app/cmd/xterm fuori dall'applicazione.
signal terminal_requested(context: String, spec: Dictionary)

const TeamStartStateModel := preload("res://scripts/setup/team_start_state.gd")
const TEAM_WATCHDOG_LOG := "/jht_home/logs/agent-watchdog.log"
const TEAM_START_STATE_PATH := "user://team_start_state.json"
const EMPTY_SHA256 := "e3b0c44298fc1c149afbf4c8996fb924" \
		+ "27ae41e4649b934ca495991b7852b855"

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
const DEFAULT_RUNTIME_IMAGE := "ghcr.io/leopu00/jht:0.3.9"
## Un host 0.3.3 interpreta anche `upgrade --check --json` come pull + up.
## Perciò l'app non invoca mai direttamente il wrapper trovato sull'host: prima
## avvia una copia temporanea del dispatcher production che conosce il
## protocollo JSON e gli indica il wrapper reale da aggiornare atomically.
const UPGRADE_BOOTSTRAP_RAW_BASE := "https://raw.githubusercontent.com/leopu00/job-hunter-team/production"
const UPGRADE_BOOTSTRAP_COMMIT_API := "https://api.github.com/repos/leopu00/job-hunter-team/commits/production"
const UPGRADE_BOOTSTRAP_PROTOCOL := "1"
const UPGRADE_BOOTSTRAP_HOST_RUNTIME_PROTOCOL := "1"

var status := {
	"docker_available": false, "docker_running": false,
	"container_exists": false, "container_running": false,
	"container_state": "missing", "active_provider": "",
	"provider_authenticated": false, "provider_auth_match": "",
	"active_plan": "", "plan_ready": false,
	"profile_ready": false, "team_running": false,
	"ready": false, "completed": 0,
	"image_id": "", "container_image_id": "", "runtime_stale": false,
	# Prima del primo probe non sappiamo ancora quali motori ci sono. La UI
	# legge "nessuno" e tiene spento «ATTIVA CONTAINER»: spegnere un pulsante
	# per mezzo secondo è un difetto minore che offrirlo e farlo fallire.
	"runtimes": PackedStringArray(), "runtime_choice": "", "runtime_selected": "",
}

var _probe_running := false
var _action_running := false
## Nome dell'azione in corso ("" quando il servizio è fermo) e sua fase
## corrente: sono lo stato che i pannelli leggono per disegnare i pulsanti
## nel modo giusto (disabilitato + etichetta di avanzamento) invece di
## lasciarli premibili e muti mentre il worker lavora.
var current_action := ""
var action_phase := ""
## Quando sono partite l'azione e la fase corrente (Time.get_ticks_msec) e
## l'ultimo avanzamento pull ricevuto: un pannello ricostruito a metà pull
## riparte da qui invece che da una barra vuota.
var action_started_ms := 0
var phase_started_ms := 0
var last_pull := {}
## Ultimo responso atomico di `jht upgrade --json`. Resta separato dallo
## stato Docker: il wrapper host ha gia' ricreato e verificato il container,
## quindi il gioco deve soltanto mostrarne l'esito, mai dedurre un deploy.
var last_upgrade := {}
## Cache soltanto di sessione del controllo esplicito aggiornamenti. Non entra
## in `status`: un check non cambia il runtime e non deve fingersi un probe
## del container. La sidebar la usa per il badge, mai per avviare un polling.
var last_upgrade_check := {}
## Stato separato da `_action_running`: il comando può essere finito mentre il
## watchdog sta ancora recuperando CAPITANO. Esposto come snapshot per i
## consumer UI, che verranno collegati dopo la fusione dei rami concorrenti.
var team_start_state := TeamStartStateModel.new()
## Sostituibile dagli oracle che attraversano `_finish_action`: il test deve
## provare la persistenza reale senza toccare l'eventuale tentativo dell'utente.
var _team_start_state_path := TEAM_START_STATE_PATH
var _timer: Timer


## L'azione lunga è in corso: i pulsanti che avviano azioni devono dirlo
## (il guard su _action_running scarta il click, ma senza feedback l'utente
## non può saperlo).
func busy() -> bool:
	return _action_running


func team_start_snapshot() -> Dictionary:
	return team_start_state.snapshot().duplicate(true)


func _persist_team_start_state() -> void:
	var phase := str(team_start_state.phase)
	if phase in [TeamStartStateModel.IDLE, TeamStartStateModel.RUNNING]:
		_remove_team_start_state_at(_team_start_state_path)
		return
	if not _write_team_start_state_at(
			team_start_state, _team_start_state_path):
		Log.warn("setup", "impossibile salvare lo stato causale dell'avvio team")


func _restore_team_start_state() -> void:
	if not FileAccess.file_exists(_team_start_state_path):
		return
	if not _read_team_start_state_at(team_start_state,
			_team_start_state_path, Time.get_ticks_msec()):
		team_start_state.fail_restore(Time.get_ticks_msec())
		_persist_team_start_state()


## Helper con path esplicito: il selftest ricrea davvero un secondo modello
## dallo stesso file senza toccare lo stato dell'utente che esegue il gate.
static func _write_team_start_state_at(model: RefCounted, path: String) -> bool:
	var target := ProjectSettings.globalize_path(path)
	DirAccess.make_dir_recursive_absolute(target.get_base_dir())
	var temporary := "%s.tmp-%d" % [target, OS.get_process_id()]
	var file := FileAccess.open(temporary, FileAccess.WRITE)
	if file == null:
		return false
	file.store_string(JSON.stringify(model.persistent_snapshot()) + "\n")
	file.flush()
	file.close()
	if not JhtFs._replace_file(temporary, target):
		DirAccess.remove_absolute(temporary)
		return false
	return true


static func _read_team_start_state_at(model: RefCounted, path: String,
		now_ms: int) -> bool:
	var file := FileAccess.open(ProjectSettings.globalize_path(path), FileAccess.READ)
	if file == null:
		return false
	var parsed: Variant = JSON.parse_string(file.get_as_text())
	file.close()
	return parsed is Dictionary and model.restore(parsed, now_ms)


static func _remove_team_start_state_at(path: String) -> bool:
	var target := ProjectSettings.globalize_path(path)
	return not FileAccess.file_exists(target) \
			or DirAccess.remove_absolute(target) == OK


func _ready() -> void:
	if not WindowsInstanceGuard.normal_work_allowed():
		return
	process_mode = Node.PROCESS_MODE_ALWAYS
	if OS.get_environment("JHT_VPS_SETUP_TEST") == "1":
		_self_test_vps_setup.call_deferred()
		return
	_restore_team_start_state()
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
			or not runtime_command.contains("$HOME/.local/bin/jht") \
			or not runtime_command.contains("JHT_HOST_RUNTIME_PROTOCOL=1") \
			or not runtime_command.contains("JHT_UPGRADE_PROTOCOL=1") \
			or runtime_command.contains("\"$JHT_BIN\" up") \
			or not runtime_command.contains("JHT_WRAPPER_PATH=\"$JHT_BIN\" bash \"$JHT_BOOTSTRAP\""):
		failures.append("rilevamento wrapper VPS incompleto")
	# Un wrapper legacy con il solo protocollo upgrade non deve essere mai
	# eseguito: migrazione e rollback condividono esattamente questo gate.
	var legacy_bin := test_root.path_join("bin")
	var legacy_jht := legacy_bin.path_join("jht")
	var legacy_sentinel := test_root.path_join("legacy-vps-wrapper-ran")
	DirAccess.make_dir_recursive_absolute(legacy_bin)
	_test_write(legacy_jht, "#!/usr/bin/env bash\nJHT_UPGRADE_PROTOCOL=1\ntouch " \
			+ _shell_quote(legacy_sentinel) + "\n")
	var secure_fixture := legacy_bin.path_join("secure-bootstrap")
	_test_write(secure_fixture, "#!/usr/bin/env bash\nJHT_UPGRADE_PROTOCOL=1\n" \
			+ "JHT_HOST_RUNTIME_PROTOCOL=1\nexit 0\n")
	var fake_curl := legacy_bin.path_join("curl")
	_test_write(fake_curl, "#!/usr/bin/env bash\nset -eu\nurl='' out=''\n" \
			+ "while [ \"$#\" -gt 0 ]; do case \"$1\" in -o) out=$2; shift 2;; -*) shift;; *) url=$1; shift;; esac; done\n" \
			+ "case \"$url\" in */commits/production) printf '{\\n  \"sha\": \"cccccccccccccccccccccccccccccccccccccccc\"\\n}\\n' > \"$out\";; " \
			+ "*) cp " + _shell_quote(secure_fixture) + " \"$out\";; esac\n")
	_run("chmod", PackedStringArray(["700", legacy_jht]))
	_run("chmod", PackedStringArray(["700", fake_curl, secure_fixture]))
	# OS.execute ricompone gli argomenti di `bash -c` tramite la shell su macOS:
	# un comando ricco di virgolette perderebbe il confine del singolo argv.
	# Uno script sintetico mantiene il test fedele a ciò che riceve SSH.
	var probe_script := test_root.path_join("probe-vps-runtime.sh")
	_test_write(probe_script, "#!/usr/bin/env bash\nPATH=" \
			+ _shell_quote(legacy_bin) + ":/usr/bin:/bin\n" + runtime_command + "\n")
	_run("chmod", PackedStringArray(["700", probe_script]))
	var legacy_probe := _run("bash", PackedStringArray([probe_script]))
	if legacy_probe.get("code", 1) != 0 \
			or FileAccess.file_exists(legacy_sentinel):
		failures.append("bootstrap VPS non isola il wrapper legacy: " \
				+ str(legacy_probe.get("out", "")).strip_edges().right(400))

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
	if apply_script.contains("cp -a /root/.jht/runtime"):
		failures.append("runtime legacy copiato nella migrazione VPS")
	if not apply_script.contains("JHT_HOST_RUNTIME_PROTOCOL=1"):
		failures.append("migrazione VPS puo invocare wrapper legacy")
	var rollback_script := _rollback_vps_destination_script("12345")
	if not rollback_script.contains("JHT_HOST_RUNTIME_PROTOCOL=1") \
			or rollback_script.contains("cp -a /root/.jht/runtime"):
		failures.append("rollback VPS puo consumare runtime o wrapper legacy")
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
	if not bool(altrui.get("container_running", false)) \
			or not bool(altrui.get("remote", false)):
		failures.append("Docker locale assente nasconde il container VPS raggiungibile")
	# Controtest showroom: tutti e quattro i fatti arrivano dal probe remoto,
	# mentre il dizionario di partenza riproduce Docker locale indisponibile.
	var remoto_pronto := {"docker_available": false, "docker_running": false,
			"container_exists": false, "container_running": false,
			"active_provider": "", "provider_authenticated": false,
			"plan_ready": false, "profile_ready": false, "hours_ready": false}
	_apply_vps_probe(remoto_pronto, {"config_read": true,
			"active_provider": "openai", "providers": {"openai": {"plan": "pro"}},
			"team": {"working_hours": {"windows": [{"days": [1],
			"start": "09:00", "end": "17:00"}]}},
			"auth": {"codex": ".codex/auth.json"}, "ready": true})
	_finalize(remoto_pronto)
	if not bool(remoto_pronto.get("ready", false)) \
			or int(remoto_pronto.get("completed", 0)) != 4:
		failures.append("setup VPS completo non fa uscire dallo showroom")
	if str(remoto_pronto.get("active_provider", "")) != "codex" \
			or not bool(remoto_pronto.get("provider_authenticated", false)):
		failures.append("provider o login VPS persi dopo setup remoto")
	# VPS che non risponde: nessun valore, e nessuno preso in prestito dal disco.
	var muta := {"provider_authenticated": true, "plan_ready": true,
			"container_running": true, "profile_ready": true, "hours_ready": true}
	_apply_vps_probe(muta, {})
	for step in ["provider", "profile", "hours"]:
		if not _is_unknown(muta, str(step)):
			failures.append("passo senza risposta dalla VPS non marcato ignoto: " + str(step))
	_finalize(muta)
	if bool(muta.get("ready", false)) or int(muta.get("completed", 0)) != 0:
		failures.append("checklist data per fatta su valori mai letti")
	if bool(muta.get("container_running", false)) or not bool(muta.get("remote", false)):
		failures.append("VPS muta ricade sul container Docker locale")
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
	if _tmux_has_operational_team("ASSISTENTE\nDOTTORE\nMANTENITORE\n"):
		failures.append("sessione tecnica scambiata per team operativo")
	if not _tmux_has_operational_team("ASSISTENTE\nCAPITANO\n"):
		failures.append("Capitano attivo non riconosciuto come team operativo")
	if _agents_have_operational_team([{"role": "assistente", "active": true}]):
		failures.append("Assistente remoto scambiato per team operativo")
	if not _agents_have_operational_team([
			{"role": "coordinatore", "active": true}]):
		failures.append("Coordinatore remoto non riconosciuto come team operativo")

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
	var start_probe := team_start_state.snapshot()
	WorkerThreadPool.add_task(_probe.bind(_connected_vps(), start_probe))


func _probe(vps: Dictionary, start_probe: Dictionary) -> void:
	var next := _probe_host(_jht_home())
	# Passi 02/03/04 chiesti ALLA MACCHINA CONNESSA, sullo stesso trasporto del
	# passo 01. Blocca solo questo worker, mai il thread della UI.
	if not vps.is_empty():
		next["vps_probe"] = _probe_vps(vps)
	var cursor := int(start_probe.get("watchdog_cursor", -1))
	var identity := str(start_probe.get("watchdog_identity", ""))
	var fingerprint := str(start_probe.get("watchdog_fingerprint", ""))
	var deadline := int(start_probe.get("recovery_deadline_ms", 0))
	if cursor >= 0 and deadline > Time.get_ticks_msec():
		next["team_watchdog_delta"] = _watchdog_log_delta(
				vps, cursor, identity, fingerprint)
	next["team_start_attempt"] = int(start_probe.get("attempt", -1))
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
	if BackendBus.is_remote():
		# La scelta della macchina è già una fonte di autorità: finché la
		# VPS non risponde, lo stato resta ignoto e NON ricade sul Docker di
		# questo portatile. La finestra fra `set_backend()` e CONNECTED era il
		# difetto della prima segnalazione reale: setup remoto riuscito, Docker
		# locale assente, checklist ferma a 3/4 e showroom ancora visibile.
		_mark_remote_runtime(next, false)
		if BackendBus.is_live():
			_mark_remote_runtime(next, true)
			next["team_running"] = _agents_have_operational_team(BackendBus.agents)
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
	var watchdog_delta := str(next.get("team_watchdog_delta", ""))
	var observed_attempt := int(next.get("team_start_attempt", -1))
	next.erase("team_watchdog_delta")
	next.erase("team_start_attempt")
	status = next
	if team_start_state.observe(observed_attempt,
			bool(status.get("team_running", false)), watchdog_delta,
			Time.get_ticks_msec()):
		_persist_team_start_state()
		team_start_state_changed.emit(team_start_snapshot())
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
		# La scelta nasce sul desktop e vale per il team che quel desktop
		# controlla. LocalBackend condivide già lo stesso bind JhtFs; sulla VPS
		# serve consegnare esplicitamente il medesimo artefatto canonico.
		if BackendBus.is_live() and BackendBus.is_remote():
			BackendBus.save_ui_language(UIStrings.lang)
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
	var code := OS.execute(_bin(path), args, output, true)
	return {"code": code, "out": "\n".join(PackedStringArray(output)).strip_edges()}


## Cartelle di binari che il PATH di una app con interfaccia può non contenere.
## Un'app macOS aperta dal Finder (o dal DMG) eredita il PATH minimo di
## launchd — /usr/bin:/bin:/usr/sbin:/sbin — mentre Homebrew installa `docker`
## e `colima` in /opt/homebrew/bin (Apple Silicon) o /usr/local/bin (Intel):
## nessuna delle due è lì dentro. È il difetto O-13b visto dall'operatore, che
## aveva Colima ACCESO e si sentiva proporre INSTALLA DOCKER. Lo stesso PATH
## esplicito lo aggiunge già il comando d'installazione
## (_posix_runtime_install_command): qui vale anche per rilevare e lanciare.
const DEFAULT_EXTRA_BIN_DIRS: Array[String] = [
	"/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin",
]
## Sostituibile dai selftest: su una macchina di sviluppo un "PATH senza
## docker" non esisterebbe più, e il caso «runtime assente» — la schermata che
## deve comparire a chi arriva senza motore — resterebbe non verificabile.
static var extra_bin_dirs: Array[String] = DEFAULT_EXTRA_BIN_DIRS.duplicate()


## Le cartelle in cui cercare un comando: quelle del PATH, poi quelle che la
## shell dell'utente avrebbe e la app no. L'ordine conta: il PATH dell'utente
## vince sempre sulle aggiunte.
static func _search_dirs() -> PackedStringArray:
	var windows := OS.get_name() == "Windows"
	var dirs := PackedStringArray()
	for dir in OS.get_environment("PATH").split(";" if windows else ":", false):
		if not dirs.has(String(dir)):
			dirs.append(String(dir))
	if not windows:
		for dir in extra_bin_dirs:
			if not dirs.has(String(dir)):
				dirs.append(String(dir))
	return dirs


## Il comando risolto in percorso pieno, quando si riesce. Serve perché
## OS.execute/create_process ereditano il PATH del processo, NON quello
## aumentato di _which: senza questo passaggio il probe "vede"
## /opt/homebrew/bin/docker e poi lancia un `docker` che l'app non trova.
## Un percorso già esplicito passa intatto.
static func _bin(name: String) -> String:
	if name.contains("/") or name.contains("\\"):
		return name
	var resolved := _which(name)
	return resolved if resolved != "" else name


## Cerca `exe` fra le cartelle del PATH, come farebbe la shell. Ritorna il
## percorso pieno, o "" se non c'è.
##
## Perché guardare il filesystem: su POSIX OS.execute passa dalla shell, e per
## un comando inesistente la shell esce 127 — MAI il -1 che il probe assumeva
## (misurato su macOS, Godot 4.7: code=127, stderr "sh: docker: command not
## found"). Ma 127 da solo non basta a dichiarare "assente": è lo stesso numero
## che restituirebbe un docker PRESENTE che esce 127, e il testo d'errore della
## shell cambia con la shell e col locale — non è un contratto. L'esistenza del
## file nel PATH invece distingue i due casi senza interpretare né numeri né
## messaggi: è il criterio meno ambiguo che Godot mette a disposizione.
static func _which(exe: String) -> String:
	var windows := OS.get_name() == "Windows"
	# Su Windows il comando è un file con estensione (docker.exe); .cmd/.bat
	# coprono gli shim. Su POSIX il nome è nudo.
	var names := PackedStringArray([exe + ".exe", exe + ".cmd", exe + ".bat"]) \
			if windows else PackedStringArray([exe])
	for dir in _search_dirs():
		for name in names:
			var candidate := String(dir).path_join(String(name))
			if not FileAccess.file_exists(candidate):
				continue
			# Su POSIX un file nel PATH senza bit di esecuzione non è un
			# comando: la shell risponderebbe "permission denied" (126).
			if windows or (FileAccess.get_unix_permissions(candidate)
					& (FileAccess.UNIX_EXECUTE_OWNER | FileAccess.UNIX_EXECUTE_GROUP
					| FileAccess.UNIX_EXECUTE_OTHER)) != 0:
				return candidate
	return ""


## L'eseguibile esiste su questa macchina? Due prove, in quest'ordine:
## 1) il file nel PATH (_which) — prova diretta, indipendente dai codici;
## 2) in subordine, la prova comportamentale: `probe_code` è l'esito di un
##    lancio vero. 0 o un codice "suo" dicono che QUALCOSA ha risposto anche
##    se il PATH scan lo mancasse (shim esotici) — è la rete che impedisce a
##    questo cambio di regredire il ramo Windows, dove -1 = lancio fallito
##    funzionava già. Restano esclusi i due codici che la shell POSIX usa per
##    conto proprio: 127 (comando non trovato) e 126 (trovato ma non
##    eseguibile) — con un binario davvero presente li scavalca la prova 1.
static func _exec_present(exe: String, probe_code: int) -> bool:
	return _which(exe) != "" \
			or (probe_code != -1 and probe_code != 126 and probe_code != 127)


static func runtime_image() -> String:
	var custom := OS.get_environment("JHT_IMAGE").strip_edges()
	return custom if custom != "" else DEFAULT_RUNTIME_IMAGE


# ── Motori container: quali ci sono, e quale usare ──────────────────────────
#
# `docker` NON è un runtime: è il client, e su macOS parla indifferentemente
# con Docker Desktop o con Colima. Confondere le due domande — «c'è un client?»
# e «c'è un motore che posso accendere?» — è la radice di O-13: il pulsante
# partiva da `docker version` e, al primo errore, proponeva di installare
# Docker a chi aveva Colima installato e persino avviato.

const RUNTIME_COLIMA := "colima"
const RUNTIME_DOCKER_DESKTOP := "docker-desktop"
## Il daemon di sistema di Linux: c'è o non c'è, e si accende con systemd —
## non lo lancia l'app, ma resta un runtime presente da distinguere dal nulla.
const RUNTIME_DOCKER_SERVICE := "docker-service"
## La scelta esplicita dell'utente fra i motori installati. Sta in user:// come
## tema e lingua: è una preferenza di QUESTA installazione del gioco, non un
## dato del team, e ~/.jht appartiene al container (uid diverso).
const RUNTIME_CHOICE_CFG := "user://container_runtime.cfg"


## I motori container INSTALLATI su questa macchina, in ordine di preferenza.
## Si chiede al filesystem, mai a `docker version`: motore spento e motore
## assente sono due stati diversi con due schermate diverse, e appiattirli è
## proprio ciò che mostrava INSTALLA DOCKER a chi non ne aveva bisogno.
static func installed_runtimes() -> PackedStringArray:
	var found := PackedStringArray()
	match OS.get_name():
		"Windows":
			if FileAccess.file_exists(DOCKER_DESKTOP_WIN):
				found.append(RUNTIME_DOCKER_DESKTOP)
		"macOS":
			if _which("colima") != "":
				found.append(RUNTIME_COLIMA)
			if DirAccess.dir_exists_absolute("/Applications/Docker.app"):
				found.append(RUNTIME_DOCKER_DESKTOP)
		_:
			if _which("docker") != "":
				found.append(RUNTIME_DOCKER_SERVICE)
	return found


## Il motore scelto dall'utente, se ne ha scelto uno ed è ancora installato.
static func runtime_choice() -> String:
	var cfg := ConfigFile.new()
	if cfg.load(RUNTIME_CHOICE_CFG) != OK:
		return ""
	return str(cfg.get_value("runtime", "engine", ""))


## Il motore da accendere adesso. Con UNO installato non c'è niente da
## chiedere; con due la scelta è dell'utente (Docker Desktop e Colima non sono
## intercambiabili: VM, risorse e licenza sono diverse) e questa funzione la
## rispetta. La preferenza caduta — motore disinstallato — non blocca nulla:
## si ricade sul primo disponibile invece di dichiarare l'assenza.
##
## `chosen` è esplicito perché la regola si possa provare senza toccare la
## preferenza vera di chi sviluppa: il valore di default resta quella su disco.
static func selected_runtime(installed: PackedStringArray,
		chosen := runtime_choice()) -> String:
	if installed.is_empty():
		return ""
	return chosen if installed.has(chosen) else installed[0]


## Su questa macchina non c'è NIENTE da accendere? È la domanda che spegne
## «ATTIVA CONTAINER» invece di lasciarlo premibile per finire in errore
## (O-13a). In modalità VPS il motore vive dall'altra parte di SSH: non è
## un'assenza, è un altro computer.
static func runtime_missing(s: Dictionary) -> bool:
	if bool(s.get("remote", false)):
		return false
	return (s.get("runtimes", PackedStringArray()) as PackedStringArray).is_empty()


## Registra la scelta del motore. Solo un motore davvero installato: una
## preferenza per qualcosa che non c'è produrrebbe un avvio che fallisce e
## nessuna spiegazione utile.
func choose_runtime(id: String) -> void:
	if id != "" and not installed_runtimes().has(id):
		return
	var cfg := ConfigFile.new()
	cfg.set_value("runtime", "engine", id)
	cfg.save(RUNTIME_CHOICE_CFG)
	status["runtime_choice"] = id
	status["runtime_selected"] = selected_runtime(
			status.get("runtimes", PackedStringArray()))
	Log.info("setup", "motore container scelto: " + (id if id != "" else "automatico"))
	status_changed.emit(status.duplicate(true))


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
	# I motori installati si contano PRIMA di interrogare il daemon: distinguono
	# «spegni il pulsante e spiega perché» da «offri di installare», e nessuna
	# delle due risposte sta dentro `docker version`.
	d["runtimes"] = installed_runtimes()
	d["runtime_choice"] = runtime_choice()
	d["runtime_selected"] = selected_runtime(d["runtimes"])
	# Presenza e stato del motore sono DUE domande, e le risponde chi le sa:
	# la presenza il filesystem (_exec_present), lo stato del daemon il codice
	# d'uscita di `docker version` (0 = attivo, altro = installato ma spento).
	# Il vecchio `code != -1` valeva solo su Windows: su POSIX un docker
	# assente esce 127 via shell, mai -1, quindi docker_available restava true
	# e INSTALLA DOCKER — l'unica strada per chi arriva senza motore — non
	# compariva mai su macOS e Linux.
	var version := _run("docker", PackedStringArray(["version", "--format",
			"{{.Client.Version}}|{{.Server.Version}}"] ))
	d["docker_available"] = _exec_present("docker", int(version["code"]))
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
			d["team_running"] = tmux["code"] == 0 \
					and _tmux_has_operational_team(str(tmux["out"]))
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


## L'Assistente e' autorizzato a vivere durante l'onboarding del profilo; anche
## Dottore/Mantenitore sono sessioni tecniche, non il team operativo richiesto
## dall'utente. Il Capitano nasce soltanto dal vero `team start` e ne e' quindi
## il marker minimo affidabile. "Qualunque tmux" faceva apparire TEAM ATTIVO e
## disabilitava il pulsante mentre il setup era ancora 1/4.
static func _tmux_has_operational_team(raw: String) -> bool:
	for session in raw.split("\n", false):
		if str(session).strip_edges() == "CAPITANO":
			return true
	return false


static func _agents_have_operational_team(agents: Array) -> bool:
	for value in agents:
		if not (value is Dictionary):
			continue
		var agent := value as Dictionary
		var role := str(agent.get("role", "")).strip_edges().to_lower()
		if role in ["capitano", "coordinatore"] \
				and bool(agent.get("active", true)):
			return true
	return false


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
static var CHECKLIST_PY := VpsBackend.payload("checklist.py")


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
	# Questo metodo viene chiamato soltanto quando la modalità selezionata è
	# VPS. Anche una risposta vuota deve quindi cancellare il probe host locale:
	# "non so cosa c'è sulla VPS" non significa "usa Docker su questo Mac".
	_mark_remote_runtime(next, not remote.is_empty())
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


## Applica lo stato runtime della macchina remota senza consultare mai Docker
## locale. Un probe checklist non vuoto arriva soltanto dopo un `docker exec`
## remoto riuscito, quindi attesta sia SSH sia container; vuoto resta ignoto.
static func _mark_remote_runtime(next: Dictionary, running: bool) -> void:
	next["remote"] = true
	next["docker_available"] = running
	next["docker_running"] = running
	next["container_exists"] = running
	next["container_running"] = running
	next["container_state"] = "running · VPS" if running else "unknown · VPS"
	if not running:
		next["team_running"] = false


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
				"message": UIStrings.t("setup.action.provider_selected_vps") \
				% str(PROVIDERS[provider]["name"]) if remote["code"] == 0 \
				else UIStrings.t("setup.action.provider_select_failed") \
				% str(remote["out"]).right(240)}
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
			return {"ok": true, "message": UIStrings.t("setup.action.provider_selected")
					% str(PROVIDERS[provider]["name"])}
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
		return {"ok": true, "message": UIStrings.t("setup.action.provider_selected")
				% str(PROVIDERS[provider]["name"])}
	if JhtFs.host_home_blocked():
		return {"ok": false, "message": UIStrings.t("setup.action.provider_data_locked")}
	return {"ok": false, "message": UIStrings.t("setup.action.provider_save_failed")}


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
		return {"ok": false, "message": UIStrings.t("setup.action.plan_save_failed")}
	return {"ok": true, "message": UIStrings.t("setup.action.plan_saved")}


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
			"message": UIStrings.t("setup.action.container_stopped") \
			if result["code"] == 0 else UIStrings.t("setup.action.container_stop_failed") \
			% str(result.get("out", "")).right(220)}


## Flusso "ATTIVA CONTAINER" (porting della logica desktop Electron,
## regola detect-first): inventario dei motori installati → daemon giù → avvia
## il motore SCELTO e POLLA finché risponde (2s × 120s, progresso a video) →
## container assente → compose imbarcato + `compose up` nel terminale
## visibile (il pull dell'immagine GHCR è lungo: l'utente deve vederlo).
##
## L'inventario viene PRIMA del daemon, e non è un dettaglio d'ordine: partire
## da `docker version` significa leggere ogni errore del client come "non c'è
## niente", ed è così che l'app offriva INSTALLA DOCKER a chi aveva Colima
## installato e acceso (O-13b). Chi non ha alcun motore lo scopre qui, con la
## frase giusta, invece che dopo due minuti di attesa.
func _do_start_container() -> Dictionary:
	Log.call_deferred("info", "setup", "attiva container: inventario dei motori")
	_set_phase("engine")
	var installed := installed_runtimes()
	if installed.is_empty() and _which("docker") == "":
		Log.call_deferred("warn", "setup", "nessun motore container installato")
		return {"ok": false, "message": UIStrings.t("setup.runtime.missing")}
	var daemon := _run("docker", PackedStringArray(["version", "--format",
			"{{.Server.Version}}"] ))
	if daemon["code"] != 0:
		var engine := selected_runtime(installed)
		Log.call_deferred("info", "setup", "daemon giù, avvio il motore: "
				+ (engine if engine != "" else "nessuno"))
		var launch := _launch_docker_runtime(engine)
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
			_progress("container", UIStrings.t("setup.action.docker_starting") % waited)
		if daemon["code"] != 0:
			Log.call_deferred("warn", "setup", "docker non risponde dopo 120s")
			return {"ok": false, "message": UIStrings.t("setup.action.docker_timeout")}
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
			return {"ok": true, "message": UIStrings.t("setup.action.container_running")}
		return {"ok": false, "message": UIStrings.t("setup.action.runtime_prepare_failed")}
	_ensure_host_dirs()
	Log.call_deferred("info", "setup", "attivazione: pull + compose up da " + compose)
	_set_phase("image")
	var pull := _compose_stream(compose, PackedStringArray(["pull", "jht"]),
			UIStrings.t("setup.action.checking_updates"))
	if not bool(pull["ok"]):
		Log.call_deferred("warn", "setup",
				"pull immagine fallito, proseguo con la copia locale: "
				+ str(pull.get("tail", "")).right(200))
		_progress("container", UIStrings.t("setup.action.pull_fallback"))
	_set_phase("container")
	return _compose_up_with_progress(compose)


## Aggiornamento esplicito del runtime. Il deploy e' posseduto dal wrapper
## host: journal, lock, pull, rollback e verifica devono avere UNA sola
## implementazione, quindi questa UI non invoca mai docker/compose direttamente.
func update_runtime() -> void:
	if _action_running:
		return
	_start_action("upgrade", _do_update_runtime.bind(_vps_config()),
			UIStrings.t("setup.upgrade_running"))


static func _do_update_runtime(vps: Dictionary) -> Dictionary:
	return _run_vps_upgrade(vps) if not vps.is_empty() else _run_local_upgrade()


## Il badge Docker viene aggiornato SOLO da un gesto esplicito dell'utente.
## Questo comando chiede al wrapper host una fotografia della candidate image:
## non promuove, non riavvia e non interroga Docker direttamente.
func check_runtime_update() -> void:
	if _action_running:
		return
	_start_action("upgrade-check", _do_check_runtime_update.bind(_vps_config()),
			UIStrings.t("setup.runtime_check_running"))


static func _do_check_runtime_update(vps: Dictionary) -> Dictionary:
	return _run_vps_upgrade_check(vps) if not vps.is_empty() else _run_local_upgrade_check()


## Stato piccolo e serializzabile per il badge della sidebar. `changed` e' il
## SOLO segnale di update disponibile: restartRequired appartiene all'apply e
## puo' essere valorizzato anche da un check senza che ci sia una promozione.
func runtime_update_check_state() -> String:
	if _action_running and current_action == "upgrade-check":
		return "checking"
	if last_upgrade_check.is_empty():
		return "unknown"
	if not bool(last_upgrade_check.get("ok", false)):
		return "error"
	return "available" if bool(last_upgrade_check.get("changed", false)) else "current"


## Il protocollo di upgrade e' volutamente stretto: stdout e' una sola riga
## JSON finale. Qualunque log extra o risultato incoerente resta un errore
## sicuro, anziche' trasformare diagnostica non strutturata in uno stato UI.
static func parse_upgrade_result(stdout: String, exit_code: int) -> Dictionary:
	var frame := stdout.replace("\r\n", "\n")
	if frame.ends_with("\n"):
		frame = frame.left(-1)
	if frame == "" or frame.contains("\n") or frame != frame.strip_edges():
		return _upgrade_protocol_failure()
	var parsed: Variant = JSON.parse_string(frame)
	if not (parsed is Dictionary) or not _upgrade_result_shape_valid(parsed):
		return _upgrade_protocol_failure()
	var result: Dictionary = parsed.duplicate(true)
	if (exit_code == 0) != bool(result["ok"]):
		return _upgrade_protocol_failure()
	return result


static func _upgrade_result_shape_valid(result: Dictionary) -> bool:
	for key in ["ok", "changed", "restartRequired", "rolledBack"]:
		if not result.has(key) or not (result[key] is bool):
			return false
	for key in ["phase", "message"]:
		if not result.has(key) or not (result[key] is String):
			return false
	if not str(result["phase"]) in ["preflight", "pull", "activate", "verify",
			"commit", "complete", "recovery", "unexpected", "check"]:
		return false
	for key in ["previous", "current"]:
		if not result.has(key) or not (result[key] is Dictionary):
			return false
		var version: Variant = result[key].get("version")
		var image: Variant = result[key].get("image")
		if not (version is String) or not (image is String):
			return false
	return true


static func _upgrade_protocol_failure() -> Dictionary:
	return {"ok": false, "changed": false, "phase": "unexpected",
			"previous": {"version": "", "image": ""},
			"current": {"version": "", "image": ""},
			"restartRequired": false, "message": "", "rolledBack": false,
			"protocol_error": true}


static func _host_jht_path() -> String:
	var found := _which("jht")
	if found != "":
		return found
	var home := OS.get_environment("USERPROFILE") if OS.get_name() == "Windows" \
			else OS.get_environment("HOME")
	var candidates := PackedStringArray()
	if OS.get_name() == "Windows":
		candidates = PackedStringArray([home.path_join(".local/bin/jht.cmd"),
				home.path_join(".local/bin/jht.ps1")])
	else:
		candidates = PackedStringArray([home.path_join(".local/bin/jht"), "/usr/local/bin/jht"])
	for candidate in candidates:
		if FileAccess.file_exists(candidate):
			return candidate
	return ""


static func _run_local_upgrade() -> Dictionary:
	var jht := _host_jht_path()
	if jht == "":
		return _upgrade_protocol_failure()
	return _run_local_bootstrap_upgrade(jht, false)


static func _run_local_upgrade_check() -> Dictionary:
	var jht := _host_jht_path()
	if jht == "":
		return _upgrade_protocol_failure()
	return _run_local_bootstrap_upgrade(jht, true)


## 0.3.3 non ha un controllo versione sicuro: il suo dispatcher ignora le
## opzioni e promuove subito il runtime. Il bootstrap è quindi anche il primo
## byte che eseguiamo, sia per check sia per apply. `JHT_WRAPPER_PATH` resta
## l'originale: il wrapper production aggiorna proprio quello (e compose), non
## la copia in /tmp. `JHT_RAW_BASE` fissato evita un vecchio override di shell
## verso un branch inatteso durante un'azione di release.
static func _run_local_bootstrap_upgrade(jht: String, check_only: bool) -> Dictionary:
	if OS.get_name() == "Windows":
		return _run_windows_bootstrap_upgrade(jht, check_only)
	var bash := _which("bash")
	if bash == "":
		return _upgrade_protocol_failure()
	return _run_upgrade_json(bash, PackedStringArray(["-c",
			_posix_upgrade_bootstrap_command(jht, check_only)]))


static func _upgrade_arguments(check_only: bool) -> String:
	return "upgrade --check --json" if check_only else "upgrade --json"


## Il comando non ha output proprio: curl e la validazione sono silenziosi e
## solo il wrapper production stampa l'unico frame JSON che parse_upgrade_result
## accetta. Il trap rimuove il bootstrap anche quando la validazione o il
## wrapper falliscono.
static func _posix_upgrade_bootstrap_command(wrapper_path: String,
		check_only: bool) -> String:
	return _posix_upgrade_bootstrap_with_target(
				"JHT_WRAPPER_PATH=" + _shell_quote(wrapper_path), check_only)


static func _posix_upgrade_bootstrap_with_target(wrapper_target: String,
		check_only: bool) -> String:
	return "set -e; JHT_BOOTSTRAP=\"$(mktemp \"${TMPDIR:-/tmp}/jht-wrapper.XXXXXX\")\"; " \
			+ "JHT_RELEASE_META=\"$(mktemp \"${TMPDIR:-/tmp}/jht-release.XXXXXX\")\"; " \
			+ "cleanup() { rm -f \"$JHT_BOOTSTRAP\" \"$JHT_RELEASE_META\"; }; trap cleanup EXIT HUP INT TERM; " \
			+ "curl -fsSL " + _shell_quote(UPGRADE_BOOTSTRAP_COMMIT_API) + " -o \"$JHT_RELEASE_META\"; " \
			+ "JHT_RELEASE_SHA=\"$(sed -n 's/^[[:space:]]*\"sha\": \"\\([0-9a-fA-F]\\{40\\}\\)\".*/\\1/p' \"$JHT_RELEASE_META\" | head -n 1)\"; " \
			+ "printf '%s' \"$JHT_RELEASE_SHA\" | grep -Eq '^[0-9a-fA-F]{40}$'; " \
			+ "JHT_ATTESTED_RAW_BASE=\"https://raw.githubusercontent.com/leopu00/job-hunter-team/$JHT_RELEASE_SHA\"; " \
			+ "curl -fsSL \"$JHT_ATTESTED_RAW_BASE/scripts/jht-wrapper.sh\" -o \"$JHT_BOOTSTRAP\"; " \
			+ "bash -n \"$JHT_BOOTSTRAP\"; " \
			+ "grep -Eq " + _shell_quote("^[[:space:]]*JHT_UPGRADE_PROTOCOL=" \
					+ UPGRADE_BOOTSTRAP_PROTOCOL + "([[:space:]]|$)") \
			+ " \"$JHT_BOOTSTRAP\"; " \
			+ "grep -Eq " + _shell_quote("^[[:space:]]*JHT_HOST_RUNTIME_PROTOCOL=" \
					+ UPGRADE_BOOTSTRAP_HOST_RUNTIME_PROTOCOL + "([[:space:]]|$)") \
			+ " \"$JHT_BOOTSTRAP\"; " \
			+ "JHT_RAW_BASE=\"$JHT_ATTESTED_RAW_BASE\" JHT_ALLOW_LEGACY_WRAPPER_MIGRATION=1 " \
			+ wrapper_target + " bash \"$JHT_BOOTSTRAP\" " + _upgrade_arguments(check_only)


## L'installer Windows espone jht.cmd come shim, ma il file che il wrapper
## production deve sostituire è sempre il vicino jht.ps1. Un .cmd senza quel
## target non è un'installazione riconoscibile: falliamo chiusi invece di
## invocare un vecchio dispatcher che potrebbe promuovere durante il check.
static func _windows_wrapper_target(jht: String) -> String:
	var lower := jht.to_lower()
	if lower.ends_with(".cmd") or lower.ends_with(".bat"):
		return jht.get_base_dir().path_join("jht.ps1")
	return jht if lower.ends_with(".ps1") else ""


static func _run_windows_bootstrap_upgrade(jht: String, check_only: bool) -> Dictionary:
	var wrapper_path := _windows_wrapper_target(jht)
	if wrapper_path == "" or not FileAccess.file_exists(wrapper_path):
		return _upgrade_protocol_failure()
	var powershell := _which("pwsh")
	if powershell == "":
		powershell = _which("powershell")
	if powershell == "":
		return _upgrade_protocol_failure()
	return _run_upgrade_json(powershell, PackedStringArray(["-NoProfile",
			"-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command",
			_windows_upgrade_bootstrap_command(wrapper_path, check_only)]))


static func _powershell_quote(value: String) -> String:
	return "'" + value.replace("'", "''") + "'"


## Il dispatcher PowerShell termina il proprio processo con `exit`: lo
## eseguiamo quindi in un processo figlio, catturiamo esattamente stdout/stderr
## e soltanto dopo rimuoviamo la copia temporanea. Così il JSON non viene
## contaminato né il bootstrap resta in %TEMP%.
static func _windows_upgrade_bootstrap_command(wrapper_path: String,
		check_only: bool) -> String:
	var target := _powershell_quote(wrapper_path)
	var commit_api := _powershell_quote(UPGRADE_BOOTSTRAP_COMMIT_API)
	return "$ErrorActionPreference='Stop'; $code=1; " \
			+ "$base=Join-Path ([IO.Path]::GetTempPath()) ('jht-upgrade-'+[guid]::NewGuid().ToString('N')); " \
			+ "$tmp=$base+'.ps1'; $out=$base+'.out'; $err=$base+'.err'; " \
			+ "try { $meta=Invoke-RestMethod -UseBasicParsing -Uri " + commit_api + "; " \
			+ "$sha=[string]$meta.sha; if ($sha -notmatch '^[0-9a-fA-F]{40}$') { throw 'Release host non attestabile' }; " \
			+ "$rawBase='https://raw.githubusercontent.com/leopu00/job-hunter-team/'+$sha; " \
			+ "Invoke-WebRequest -UseBasicParsing -Uri ($rawBase+'/scripts/jht-wrapper.ps1') -OutFile $tmp; " \
			+ "[scriptblock]::Create((Get-Content -LiteralPath $tmp -Raw)) | Out-Null; " \
			+ "if (-not (Select-String -Path $tmp -Pattern '^\\s*\\$JHT_UPGRADE_PROTOCOL\\s*=\\s*" \
			+ UPGRADE_BOOTSTRAP_PROTOCOL + "\\s*$' -Quiet)) { throw 'Wrapper upgrade senza protocollo atomico' }; " \
			+ "if (-not (Select-String -Path $tmp -Pattern '^\\s*\\$JHT_HOST_RUNTIME_PROTOCOL\\s*=\\s*" \
			+ UPGRADE_BOOTSTRAP_HOST_RUNTIME_PROTOCOL + "\\s*$' -Quiet)) { throw 'Wrapper upgrade senza runtime host protetto' }; " \
			+ "$env:JHT_RAW_BASE=$rawBase; $env:JHT_ALLOW_LEGACY_WRAPPER_MIGRATION='1'; " \
			+ "$env:JHT_WRAPPER_PATH=" + target + "; " \
			+ "$engine=Join-Path $PSHOME 'pwsh.exe'; " \
			+ "if (-not (Test-Path -LiteralPath $engine)) { $engine=Join-Path $PSHOME 'powershell.exe' }; " \
			+ "& $engine -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $tmp " \
			+ _upgrade_arguments(check_only) + " 1>$out 2>$err; $code=$LASTEXITCODE; " \
			+ "if (Test-Path -LiteralPath $out) { [Console]::Out.Write([IO.File]::ReadAllText($out)) }; " \
			+ "if (Test-Path -LiteralPath $err) { [Console]::Error.Write([IO.File]::ReadAllText($err)) }; " \
			+ "} finally { Remove-Item -LiteralPath $tmp,$out,$err -Force -ErrorAction SilentlyContinue }; exit $code"


static func _vps_upgrade_command() -> String:
	return _vps_upgrade_bootstrap_command(false)


static func _run_vps_upgrade(vps: Dictionary) -> Dictionary:
	return _run_upgrade_json("ssh", _ssh_args(vps, _vps_upgrade_command()))


static func _vps_upgrade_check_command() -> String:
	return _vps_upgrade_bootstrap_command(true)


static func _vps_upgrade_bootstrap_command(check_only: bool) -> String:
	return "JHT_BIN=\"$(command -v jht 2>/dev/null || true)\"; " \
			+ "[ -n \"$JHT_BIN\" ] || JHT_BIN=\"$HOME/.local/bin/jht\"; " \
			+ "[ -x \"$JHT_BIN\" ] || exit 127; " \
			+ _posix_upgrade_bootstrap_with_target("JHT_WRAPPER_PATH=\"$JHT_BIN\"",
					check_only)


static func _run_vps_upgrade_check(vps: Dictionary) -> Dictionary:
	return _run_upgrade_json("ssh", _ssh_args(vps, _vps_upgrade_check_command()))


## A differenza di _run, conserva stdout e stderr separati: stderr e' solo
## diagnostica del wrapper/SSH e non puo' contaminare il singolo frame JSON.
## Il worker drena sempre entrambi i pipe per non bloccare un upgrade lungo.
static func _run_upgrade_json(path: String, args: PackedStringArray) -> Dictionary:
	if path == "":
		return _upgrade_protocol_failure()
	var process := OS.execute_with_pipe(path, args, false)
	if process.is_empty():
		return _upgrade_protocol_failure()
	var stdio: FileAccess = process["stdio"]
	var stderr: FileAccess = process["stderr"]
	var stdout := PackedByteArray()
	var stdout_overflow := false
	var pid := int(process["pid"])
	while OS.is_process_running(pid):
		var out_chunk: PackedByteArray = stdio.get_buffer(65536)
		if out_chunk.size() > 0:
			if stdout.size() + out_chunk.size() > 32768:
				stdout_overflow = true
			else:
				stdout.append_array(out_chunk)
		# stderr e' intenzionalmente scartato: il contratto lascia li' i log.
		stderr.get_buffer(65536)
		OS.delay_msec(20)
	# Drain finale: l'ultimo frame puo' arrivare dopo l'exit del processo.
	for _attempt in 3:
		var out_chunk: PackedByteArray = stdio.get_buffer(65536)
		if out_chunk.size() > 0:
			if stdout.size() + out_chunk.size() > 32768:
				stdout_overflow = true
			else:
				stdout.append_array(out_chunk)
		stderr.get_buffer(65536)
		OS.delay_msec(20)
	stdio.close()
	stderr.close()
	return _upgrade_protocol_failure() if stdout_overflow \
			else parse_upgrade_result(stdout.get_string_from_utf8(),
					OS.get_process_exit_code(pid))


## Dove vive il file compose. NON in `~/.jht`: quella cartella diventa del
## container al primo avvio, e da lì in poi riscriverla è "Impossibile
## preparare il runtime" — il muro contro cui è finito il primo avvio pulito
## del 26/07. Vive nella cartella dell'applicazione, che è nostra per
## definizione; i volumi dentro al file sono path assoluti, quindi la sua
## posizione non cambia nulla per docker. Il vecchio percorso sotto ~/.jht
## non e' mai letto: il container puo' scriverlo tramite /jht_home.
static func compose_home_path() -> String:
	return ProjectSettings.globalize_path("user://runtime/docker-compose.yml")


static func _find_compose_file() -> String:
	var candidates := [
		compose_home_path(),
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
static var RUNTIME_COMPOSE := VpsBackend.payload("runtime_compose.yml")


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
			UIStrings.t("setup.action.image_downloading"))
	if not bool(run.get("spawned", false)):
		return {"ok": false, "message": UIStrings.t("setup.action.compose_start_failed")}
	var state := _run("docker", PackedStringArray(["inspect", "jht",
			"--format", "{{.State.Status}}"]))
	if state["code"] == 0 and str(state["out"]).contains("running"):
		Log.call_deferred("info", "setup", "attivazione completata: container attivo")
		return {"ok": true, "message": UIStrings.t("setup.action.container_running")}
	Log.call_deferred("warn", "setup", "compose fallito: " + str(run.get("tail", "")).right(400))
	return {"ok": false, "message": UIStrings.t("setup.action.container_start_failed") \
			% str(run.get("tail", "")).strip_edges().right(260)}


## Esegue un sottocomando compose in background riportando il progresso del
## pull nel pannello. Prova PRIMA `--progress json` — flag GLOBALE di compose,
## va prima del sottocomando — perché è l'unica modalità che dichiara i byte
## totali per livello: su pipe non-TTY la modalità plain stampa SOLO i byte
## scaricati («<id> Downloading 12.5MB», misurato su Docker 29.6.1/compose
## v5.3.0: zero righe col totale su 6599), quindi lì una percentuale non
## esiste. Le versioni di compose senza il flag muoiono subito con "unknown
## flag": si rilancia in modalità testo, che resta il ripiego.
## L'esito non guarda l'exit code (leggerlo dopo il reap logga falsi errori
## su macOS): chi chiama verifica lo stato reale — il container per `up`,
## l'id dell'immagine per `pull` — e qui si segnala solo se il processo è
## partito e se lo stream contiene errori. Gira nel worker dell'azione: i
## delay non toccano il main thread.
func _compose_stream(compose: String, args: PackedStringArray,
		lead: String) -> Dictionary:
	if OS.get_name() == "Windows" and OS.get_environment("HOME") == "":
		# ${HOME} nel compose non esiste nell'ambiente Windows: i processi
		# figli ereditano l'ambiente del gioco.
		OS.set_environment("HOME", OS.get_environment("USERPROFILE"))
	_progress("container", lead)
	var argv := PackedStringArray(["compose", "--progress", "json", "-f", compose])
	argv.append_array(args)
	var streamed := _stream_compose(argv, true)
	if bool(streamed.get("unknown_flag", false)):
		Log.call_deferred("info", "setup",
				"compose senza --progress json: ripiego sul parser testuale")
		argv = PackedStringArray(["compose", "-f", compose])
		argv.append_array(args)
		streamed = _stream_compose(argv, false)
	return streamed


## Spawn e lettura dei pipe di UN processo compose; json_mode sceglie il
## parser delle righe, tutto il resto (drain finale, timeout, tick UI) è
## identico nelle due modalità.
func _stream_compose(argv: PackedStringArray, json_mode: bool) -> Dictionary:
	var process := OS.execute_with_pipe(_bin("docker"), argv, false)
	if process.is_empty():
		return {"ok": false, "spawned": false,
				"tail": UIStrings.t("setup.action.compose_unavailable")}
	var stdio: FileAccess = process["stdio"]
	var stderr: FileAccess = process["stderr"]
	var pid := int(process["pid"])
	var pending := ""
	var tail := ""            # ultime righe complete, per il messaggio d'errore
	var layers := {}          # id livello → ultima riga di stato vista
	# id livello → {got, total} in MB, SOLO byte di download. I byte di
	# "Extracting" sono DECOMPRESSI: sommarli ai conteggi di download
	# gonfierebbe la barra. Vedi _parse_json_pull_line/_parse_text_pull_line.
	var layer_bytes := {}
	var high_water_bytes := {}
	var observer := PullProgressState.new()
	var last_material_ms := Time.get_ticks_msec()
	# "Mai emesso": il primo avanzamento parte col primo dato utile, non
	# dopo il primo intervallo (ticks_msec riparte da zero a ogni avvio: 0
	# qui NON significa "tanto tempo fa").
	var last_ui_ms := -100000
	var pending_ui := false
	var pending_advanced := false
	var observed_state := {}
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
			var lines: PackedStringArray = pending.split("\n")
			pending = lines[lines.size() - 1]
			for i in lines.size() - 1:
				var line := lines[i].strip_edges()
				if line == "":
					continue
				tail += line + "\n"
				if tail.length() > 1200:
					tail = tail.right(1200)
				if json_mode:
					_parse_json_pull_line(line, layers, layer_bytes)
				else:
					_parse_text_pull_line(line, layers, layer_bytes)
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
			OS.delay_msec(80)

		_merge_layer_byte_high_water(high_water_bytes, layer_bytes)
		var event: Dictionary = observer.observe(layers, high_water_bytes)
		observed_state = event["state"]
		if bool(event["changed"]):
			pending_ui = true
			pending_advanced = pending_advanced or bool(event["advanced"])
		last_material_ms = _material_deadline(last_material_ms,
				Time.get_ticks_msec(), bool(event["advanced"]))
		if _pull_stalled(last_material_ms, Time.get_ticks_msec()):
			OS.kill(pid)
			var stalled_phase := str(observed_state.get("phase", "unknown"))
			Log.call_deferred("warn", "setup",
					"compose made no material progress for 3 minutes (phase %s); stopped"
					% stalled_phase)
			return {"ok": false, "spawned": true, "timeout": true,
					"tail": UIStrings.t("setup.action.download_timeout")}
		if pending_ui and Time.get_ticks_msec() - last_ui_ms > 1500 \
				and not observed_state.is_empty():
			last_ui_ms = Time.get_ticks_msec()
			var info := _pull_progress_info(
					layers, high_water_bytes, observed_state)
			info["advanced"] = pending_advanced
			_progress("container", _pull_progress_text(
					layers, high_water_bytes, observed_state))
			call_deferred("_apply_pull_progress", info)
			pending_ui = false
			pending_advanced = false
	# L'ultimo stato VERO arriva sempre alla barra: senza questa emissione lo
	# stato finale (tipicamente il 100%) resterebbe indietro di un tick.
	if not observed_state.is_empty():
		var final_info := _pull_progress_info(
				layers, high_water_bytes, observed_state)
		final_info["advanced"] = pending_advanced
		call_deferred("_apply_pull_progress", final_info)
	# `--progress json` sconosciuto: i compose meno recenti muoiono subito con
	# "unknown flag: --progress" (verificato su compose reale). Non è un
	# errore del pull: è il segnale di rilanciare in modalità testo.
	if json_mode and tail.to_lower().contains("unknown flag"):
		return {"ok": false, "spawned": true, "unknown_flag": true, "tail": tail}
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


## Le dimensioni nelle righe di stato testuali: "12.3MB/456.7MB" (docker meno
## recenti, col totale) oppure "12.3MB" da solo (docker moderni su pipe
## non-TTY, che il totale non lo stampano MAI).
static var SIZES_PAIR_RE := RegEx.create_from_string(
		"([0-9.]+)\\s*([kKmMgG]?i?B)/([0-9.]+)\\s*([kKmMgG]?i?B)")
static var SIZE_RE := RegEx.create_from_string("([0-9.]+)\\s*([kKmMgG]?i?B)")


## Una riga di `docker compose --progress json`: un evento JSON per riga, coi
## byte VERI in `current`/`total`. Le righe senza `parent_id` sono l'immagine
## intera ("Pulling"/"Pulled"), non un livello. Stesse cautele del testo: i
## byte di "Extracting" sono DECOMPRESSI e non entrano nei conteggi di
## download; a "Download complete"/"Extracting"/"Pull complete" il livello si
## blocca sul suo totale.
static func _parse_json_pull_line(line: String, layers: Dictionary,
		layer_bytes: Dictionary) -> void:
	if not line.begins_with("{"):
		return
	var parsed: Variant = JSON.parse_string(line)
	if not (parsed is Dictionary):
		return
	var evt: Dictionary = parsed
	var id := str(evt.get("id", ""))
	if id == "" or not evt.has("parent_id"):
		return
	var text := str(evt.get("text", ""))
	layers[id] = (text + " " + str(evt.get("details", ""))).strip_edges()
	var lower := text.to_lower()
	if lower == "downloading":
		var total := float(evt.get("total", 0))
		if total > 0.0:
			layer_bytes[id] = {"got": float(evt.get("current", 0)) / 1048576.0,
					"total": total / 1048576.0}
	elif layer_bytes.has(id) and (lower.contains("complete")
			or lower.begins_with("extracting") or lower.begins_with("verifying")):
		layer_bytes[id]["got"] = layer_bytes[id]["total"]


## Una riga di stato in modalità testo: "<id> <stato> [dimensioni]". Sui
## docker moderni le righe "Downloading" NON portano mai il totale (misurato:
## 0 su 6599 in un pull reale su pipe non-TTY): si tiene comunque il conteggio
## dei byte scaricati (total=0), così la UI può dire "X MB scaricati a Y MB/s"
## invece di restare muta — percentuale ed ETA restano onestamente assenti.
## Il formato "x/y" dei docker meno recenti resta riconosciuto.
static func _parse_text_pull_line(line: String, layers: Dictionary,
		layer_bytes: Dictionary) -> void:
	var parts: PackedStringArray = line.split(" ", false, 1)
	if parts.size() != 2 or not parts[0].is_valid_hex_number():
		return
	layers[parts[0]] = parts[1]
	var status := parts[1].to_lower()
	if status.begins_with("downloading"):
		var pair := SIZES_PAIR_RE.search(parts[1])
		if pair != null:
			layer_bytes[parts[0]] = {
				"got": _to_mb(pair.get_string(1), pair.get_string(2)),
				"total": _to_mb(pair.get_string(3), pair.get_string(4)),
			}
			return
		var single := SIZE_RE.search(parts[1])
		if single != null:
			var entry: Dictionary = layer_bytes.get(parts[0],
					{"got": 0.0, "total": 0.0})
			entry["got"] = _to_mb(single.get_string(1), single.get_string(2))
			layer_bytes[parts[0]] = entry
	elif layer_bytes.has(parts[0]) and (status.contains("complete")
			or status.begins_with("extracting")
			or status.begins_with("verifying")):
		# Download del livello finito: col totale noto ci si blocca lì; senza
		# totale si tiene l'ultimo conteggio visto ("Download complete 0B"
		# azzererebbe byte realmente scaricati).
		if float(layer_bytes[parts[0]]["total"]) > 0.0:
			layer_bytes[parts[0]]["got"] = layer_bytes[parts[0]]["total"]


## Riassunto leggibile del pull: parti completate e byte scaricati (col
## totale accanto solo quando i livelli l'hanno davvero dichiarato).
static func _pull_progress_text(layers: Dictionary, layer_bytes: Dictionary,
		state := {}) -> String:
	var info := _pull_progress_info(layers, layer_bytes, state)
	var phase := str(info["phase"])
	var text := UIStrings.t("setup.progress_pull_stage") % [
		UIStrings.t("setup.pull_phase_" + phase),
		int(info["done_layers"]), int(info["layers"]),
	]
	if float(info["fraction"]) >= 0.0:
		text += " · %.0f/%.0f MB" % [float(info["got_mb"]), float(info["total_mb"])]
	elif float(info["got_mb"]) > 0.0:
		text += UIStrings.t("setup.action.mb_downloaded") % float(info["got_mb"])
	return text + "…"


## Il dato VERO su cui poggia la barra: byte di download acquisiti/totali dei
## livelli. La percentuale esiste SOLO se OGNI livello tracciato ha dichiarato
## il suo totale (modalità JSON, o i vecchi docker col formato "x/y"): con un
## totale parziale sarebbe gonfiata, e senza totali (docker moderni in
## modalità testo) fraction resta -1.0 — la UI mostra i byte scaricati e il
## rate misurato, non una percentuale inventata. Il totale può CRESCERE
## mentre docker scopre le dimensioni degli altri livelli: è il dato reale,
## non un difetto da mascherare.
static func _pull_progress_info(layers: Dictionary, layer_bytes: Dictionary,
		state := {}) -> Dictionary:
	var got := 0.0
	var total := 0.0
	var total_known := not layer_bytes.is_empty()
	for id in layer_bytes:
		got += float(layer_bytes[id]["got"])
		var layer_total := float(layer_bytes[id]["total"])
		total += layer_total
		if layer_total <= 0.0:
			total_known = false
	var classified: Dictionary = state if not state.is_empty() \
			else PullProgressState.classify(layers)
	return {
		"got_mb": got, "total_mb": total,
		"fraction": clampf(got / total, 0.0, 1.0) \
				if total_known and total > 0.0 else -1.0,
		"layers": int(classified["total"]),
		"done_layers": int(classified["done"]),
		"phase": str(classified["phase"]),
	}


## I parser conservano l'ultima riga, ma Docker puo ristamparne una vecchia.
## Il consumer riceve solo massimi per-layer: byte e totale non regrediscono.
static func _merge_layer_byte_high_water(high_water: Dictionary,
		observed: Dictionary) -> void:
	for raw_id: Variant in observed:
		var id := str(raw_id)
		var current: Dictionary = observed[raw_id]
		var previous: Dictionary = high_water.get(id,
				{"got": 0.0, "total": 0.0})
		high_water[id] = {
			"got": maxf(float(previous["got"]), float(current.get("got", 0.0))),
			"total": maxf(float(previous["total"]),
					float(current.get("total", 0.0))),
		}


static func _pull_stalled(last_material_ms: int, now_ms: int) -> bool:
	return now_ms - last_material_ms > 180000


static func _material_deadline(last_material_ms: int, now_ms: int,
		advanced: bool) -> int:
	return now_ms if advanced else last_material_ms


static func _to_mb(value: String, unit: String) -> float:
	var v := value.to_float()
	match unit.to_lower().left(1):
		"g": return v * 1024.0
		"k": return v / 1024.0
		"m": return v
		_: return v / 1048576.0


const DOCKER_DESKTOP_WIN := "C:/Program Files/Docker/Docker/Docker Desktop.exe"

## Accende il motore GIÀ SCELTO (mai installarne uno se un altro può già
## rispondere — regola detect-first, ADR-0006). Chi decide quale sia è
## selected_runtime(), che rispetta la preferenza dell'utente: qui si esegue e
## basta. Ritorna ok=false con istruzioni quando non c'è nulla da avviare.
static func _launch_docker_runtime(runtime: String) -> Dictionary:
	match runtime:
		RUNTIME_DOCKER_DESKTOP:
			if OS.get_name() == "Windows":
				if not FileAccess.file_exists(DOCKER_DESKTOP_WIN):
					return {"ok": false,
							"message": UIStrings.t("setup.runtime.desktop_missing")}
				OS.create_process(DOCKER_DESKTOP_WIN, PackedStringArray())
			else:
				OS.create_process(_bin("open"), PackedStringArray(["-a", "Docker"]))
			return {"ok": true, "message": UIStrings.t("setup.runtime.desktop_starting")}
		RUNTIME_COLIMA:
			# Percorso pieno: `colima` vive in /opt/homebrew/bin, che una app
			# aperta dal Finder non ha nel PATH. Prima il create_process
			# falliva in silenzio e la UI annunciava "Colima avviato" a vuoto.
			OS.create_process(_bin("colima"), PackedStringArray(["start"]))
			return {"ok": true, "message": UIStrings.t("setup.runtime.colima_starting")}
		RUNTIME_DOCKER_SERVICE:
			# Il daemon di sistema non lo accende l'app: chiederebbe una
			# password di root dentro un gioco. Si dice il comando e basta.
			return {"ok": false, "message": UIStrings.t("setup.runtime.service_stopped") \
					% "sudo systemctl start docker"}
	return {"ok": false, "message": UIStrings.t("setup.runtime.missing")}


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
			"message": UIStrings.t("setup.action.provider_installed") \
			% PROVIDERS[provider]["name"] if res["code"] == 0 \
			else UIStrings.t("setup.action.provider_install_failed") % str(res["out"]).right(240)}


func open_provider_login(provider: String) -> void:
	if not PROVIDERS.has(provider):
		return
	terminal_requested.emit("provider:" + provider,
			provider_login_spec(provider, _vps_config()))
	action_changed.emit("login", false,
			UIStrings.t("setup.action.login_console_opened"), true)


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
				result = {"code": -1, "out": UIStrings.t("common.remove_failed") % str(rel)}
	else:
		var remote_paths := PackedStringArray()
		for rel in paths:
			remote_paths.append("/jht_home/" + str(rel))
		result = _run_ssh(vps, "docker exec jht rm -f " + " ".join(remote_paths))
	return {"ok": result["code"] == 0,
			"message": UIStrings.t("setup.action.provider_removed") \
			% PROVIDERS[provider]["name"] if result["code"] == 0 \
			else UIStrings.t("setup.action.provider_remove_failed") \
			% str(result.get("out", "")).right(220)}


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

## Il pipe interattivo di Godot viene raccolto quando arriva EOF: a quel punto
## su macOS chiedere l'exit code al PID produce il falso errore "not a child".
## Il guscio scrive quindi l'esito come OSC (invisibile nel renderer terminale)
## prima di uscire; EmbeddedTerminal lo legge dai byte grezzi e può distinguere
## davvero successo e fallimento.
static func _with_exit_report(command: String, token: String) -> String:
	# Il comando gira in una subshell: anche un suo `exit N` non può saltare il
	# report del wrapper esterno. fd3 è il canale di controllo verso Godot e
	# viene chiuso nel figlio: il comando ospitato non può falsificarlo.
	return ("( exec 3>&-; %s\n); _jht_exit=$?; " \
			+ "printf '\\033]1337;JHTExit=%s:%%s\\007' \"$_jht_exit\" >&3; " \
			+ "exit \"$_jht_exit\"") % [command, token]


## Windows non espone l'exit code del processo raccolto da Godot. PowerShell è
## il wrapper ESTERNO: il comando cmd viaggia in UTF-8 base64, così nessun
## parser prima del cmd interno consuma `!`, percento o virgolette. Dopo cmd,
## $LASTEXITCODE è l'unica fonte dell'esito; PowerShell scrive l'OSC e termina
## con lo stesso codice.
static func _with_windows_exit_report(command: String, token: String) -> String:
	var encoded := Marshalls.utf8_to_base64(command)
	return ("$jht_command = [Text.Encoding]::UTF8.GetString(" \
			+ "[Convert]::FromBase64String('%s')); " \
			+ "$jht_hosted = '( ' + $jht_command + ' ) 1>&2'; " \
			+ "& $env:COMSPEC /d /s /c $jht_hosted; " \
			+ "$jht_exit = [int]$LASTEXITCODE; " \
			+ "[Console]::Out.Write([char]27 + ']1337;JHTExit=%s:' " \
			+ "+ $jht_exit + [char]7); exit $jht_exit") % [encoded, token]


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
	var exit_report_token := Crypto.new().generate_random_bytes(16).hex_encode()
	match OS.get_name():
		"macOS":
			args = PackedStringArray(["-lc", "3>&1 script -q /dev/null /bin/sh -lc " \
					+ _shell_quote(_with_pty_size(
							_with_exit_report(command, exit_report_token))) + " 1>&2"])
		"Windows":
			path = "powershell.exe"
			# ConPTY non è ancora esposto da Godot: il device flow Codex resta
			# pienamente interattivo; Claude/Kimi ricevono comunque stdin.
			args = PackedStringArray(["-NoProfile", "-NonInteractive", "-Command",
					_with_windows_exit_report(command, exit_report_token)])
		_:
			args = PackedStringArray(["-lc", "3>&1 script -qefc " \
					+ _shell_quote(_with_pty_size(
							_with_exit_report(command, exit_report_token))) \
					+ " /dev/null 1>&2"])
	return {
		"path": path,
		"args": args,
		"title": title,
		"hint": hint,
		"reports_exit": true,
		"exit_report_token": exit_report_token,
	}


func open_technical_terminal(context: String, title: String, hint: String,
		container_args: PackedStringArray, spec_overrides: Dictionary = {}) -> void:
	var vps := _vps_config()
	var command := ""
	if vps.is_empty():
		command = _local_container_exec(" ".join(_posix_quoted(container_args)))
	else:
		var pieces := PackedStringArray(["docker", "exec", "-it", "jht"])
		pieces.append_array(_posix_quoted(container_args))
		var inner := " ".join(pieces)
		var key := VpsBackend.expand_user_path(str(vps.get("key_path", "")))
		var target := _ssh_target(vps)
		command = "ssh -tt -i " + _local_quote(key) + " " \
				+ _local_quote(target) + " " + _local_quote(inner)
	var terminal_spec := embedded_terminal_spec(title, hint, command)
	terminal_spec.merge(spec_overrides, true)
	terminal_requested.emit(context, terminal_spec)


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
	# La modale può chiudersi appena riceve `paired`: un auto-push ancora in
	# corso verrebbe ucciso insieme al processo nascosto. Il normale sync del
	# team riparte dalla config appena salvata; questa corsia termina al pairing.
	open_technical_terminal("cloud", UIStrings.t("setup.cloud_login_title"),
			UIStrings.t("setup.cloud_login_google_hint") if prefer_google else \
			UIStrings.t("setup.cloud_login_hint"),
			PackedStringArray(["node", "/app/cli/bin/jht.js", "cloud", "login",
					"--ui-json", "--no-push"]),
			{"cloud_pairing": true, "prefer_google": prefer_google})


func open_cloud_command(command: String) -> void:
	var supported := ["status", "push", "pull-profile", "restore", "disable"]
	if not supported.has(command):
		return
	open_technical_terminal("cloud:" + command, "Cloud · " + command,
			UIStrings.t("setup.term.cloud_command_hint"),
			PackedStringArray(["node", "/app/cli/bin/jht.js", "cloud", command]))


func open_doctor() -> void:
	open_technical_terminal("doctor", UIStrings.t("setup.term.doctor_title"),
			UIStrings.t("setup.term.doctor_hint"),
			PackedStringArray(["node", "/app/cli/bin/jht.js", "doctor"]))


func open_runtime_install() -> void:
	Log.info("setup", "installa runtime richiesto (%s)" % OS.get_name())
	if OS.get_name() == "Windows":
		# Niente bash su Windows: winget se c'è (gestisce lui il prompt UAC),
		# altrimenti la pagina ufficiale di download nel browser.
		# `if` separa davvero assenza e fallimento: un errore di winget non deve
		# cadere nel fallback browser e trasformarsi in un falso exit 0.
		var command := "where winget >nul 2>&1 & if errorlevel 1 " \
				+ "(echo " + UIStrings.t("setup.term.winget_missing") + " " \
				+ "& start \"\" https://www.docker.com/products/docker-desktop/) else " \
				+ "(winget install -e --id Docker.DockerDesktop " \
				+ "--accept-package-agreements --accept-source-agreements)"
		terminal_requested.emit("runtime-install", embedded_terminal_spec(
				UIStrings.t("setup.term.runtime_windows_title"),
				UIStrings.t("setup.term.runtime_windows_hint"),
				command))
		return
	var command := _posix_runtime_install_command()
	terminal_requested.emit("runtime-install", embedded_terminal_spec(
			UIStrings.t("setup.term.runtime_title"),
			UIStrings.t("setup.term.runtime_hint"),
			command))


## Scaricare prima su file lascia stdin collegato alla PTY incorporata. Con il
## vecchio `curl | bash`, Homebrew vedeva invece una pipe, passava da solo in
## modalità non interattiva e sudo non poteva chiedere la password. Il PATH
## esplicito copre inoltre le app macOS lanciate da Finder, che non ereditano
## /opt/homebrew/bin pur avendo già Homebrew installato.
static func _posix_runtime_install_command() -> String:
	return "export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH; " \
			+ "jht_installer=\"$(mktemp \"${TMPDIR:-/tmp}/jht-install.XXXXXX\")\" && " \
			+ "trap 'rm -f \"$jht_installer\"; exit 129' HUP && " \
			+ "trap 'rm -f \"$jht_installer\"; exit 130' INT && " \
			+ "trap 'rm -f \"$jht_installer\"; exit 143' TERM && " \
			+ "curl -fsSL https://jobhunterteam.ai/install.sh -o \"$jht_installer\" && " \
			+ "JHT_SKIP_ONBOARD=1 /bin/bash \"$jht_installer\"; " \
			+ "_jht_install_code=$?; " \
			+ "trap - HUP INT TERM; " \
			+ "[ -z \"${jht_installer:-}\" ] || rm -f \"$jht_installer\"; " \
			+ "(exit \"$_jht_install_code\")"


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
				UIStrings.t("vps.action.public_key_missing"), false)
		return
	DisplayServer.clipboard_set(str(info["public_key"]))
	action_changed.emit("vps-key", false,
			UIStrings.t("vps.action.public_key_copied"), true)


func reveal_vps_key(key_path := "") -> void:
	var info := vps_key_info(key_path)
	DirAccess.make_dir_recursive_absolute(str(info["directory"]))
	OS.shell_show_in_file_manager(str(info["public_path"]), true)
	action_changed.emit("vps-key", false,
			UIStrings.t("vps.action.key_folder_opened") % str(info["directory"]), true)


func generate_vps_key() -> void:
	if _action_running:
		return
	_start_action("vps-key", _do_generate_vps_key)


static func _do_generate_vps_key() -> Dictionary:
	var path := default_vps_key_path()
	if FileAccess.file_exists(path) and FileAccess.file_exists(path + ".pub"):
		var existing := vps_key_info(path)
		return {"ok": true, "message": UIStrings.t("vps.action.key_available") \
				% str(existing.get("fingerprint", path))}
	DirAccess.make_dir_recursive_absolute(path.get_base_dir())
	var result := {"code": 0, "out": ""}
	if FileAccess.file_exists(path):
		# Recupera la .pub senza rigenerare o sovrascrivere una privata valida.
		result = _run("ssh-keygen", PackedStringArray(["-y", "-f", path]))
		if result["code"] == 0:
			var public_file := FileAccess.open(path + ".pub", FileAccess.WRITE)
			if public_file == null:
				return {"ok": false, "message": UIStrings.t("vps.action.write_failed") \
						% (path + ".pub")}
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
			"message": UIStrings.t("vps.action.key_created") \
			% str(info.get("fingerprint", path)) \
			if result["code"] == 0 \
			else UIStrings.t("vps.action.key_create_failed") % str(result["out"]).right(220)}


## L'utente SSH dipende dal provider: Hetzner consegna root, OVH e AWS
## `ubuntu`, Google Cloud e Azure il nome dell'account. Campo vuoto — e
## configurazioni salvate prima che il campo esistesse — valgono root.
static func _ssh_user(user: String) -> String:
	var clean := user.strip_edges()
	return clean if clean != "" else "root"


## Destinazione `utente@host` per ssh/scp. Prima era "root@" cablato in sette
## punti e una VPS OVH rispondeva solo "Permission denied (publickey)".
static func _ssh_target(vps: Dictionary) -> String:
	return _ssh_user(str(vps.get("user", ""))) + "@" + str(vps.get("ip", ""))


static func _vps_credentials(ip: String, key_path: String,
		user := "") -> Dictionary:
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
	var clean_user := _ssh_user(user)
	var user_re := RegEx.new()
	# Nome utente POSIX: lo stesso motivo per cui l'host è validato, dato che
	# finisce dentro comandi ssh/scp composti come testo.
	user_re.compile("^[A-Za-z0-9._][A-Za-z0-9._-]{0,31}$")
	if user_re.search(clean_user) == null:
		return {}
	return {"ip": clean_ip, "key_path": key, "user": clean_user}


func test_vps_connection(ip: String, key_path: String, user := "") -> void:
	if _action_running:
		return
	var target := _vps_credentials(ip, key_path, user)
	if target.is_empty():
		action_changed.emit("vps-test", false,
				UIStrings.t("vps.action.invalid_credentials"), false)
		return
	_start_action("vps-test", _do_test_vps_connection.bind(target))


static func _do_test_vps_connection(target: Dictionary) -> Dictionary:
	var pinned := _pin_vps_host(str(target.get("ip", "")))
	if not bool(pinned.get("ok", false)):
		return pinned
	# Non serve essere root: serve poter installare il runtime e parlare con
	# Docker. Root (Hetzner), sudo senza password (l'utente ubuntu di OVH e
	# AWS) o un utente già nel gruppo docker valgono tutti come "sì".
	var result := _run_ssh(target,
			"printf 'JHT_SSH_OK '; uname -srm; test \"$(id -u)\" = 0 " \
			+ "|| sudo -n true 2>/dev/null || docker info >/dev/null 2>&1")
	var fingerprint := str(pinned.get("fingerprint", ""))
	return {"ok": result["code"] == 0,
			"message": UIStrings.t("vps.action.ssh_verified") \
			% str(result["out"]).strip_edges() \
			+ ((" · HOST " + fingerprint) if fingerprint != "" else "") \
			if result["code"] == 0 else UIStrings.t("vps.action.ssh_unavailable") \
			% str(result.get("out", "")).strip_edges().right(260)}


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
		return {"ok": false, "message": UIStrings.t("vps.action.host_key_read_failed")}
	var path := VpsBackend.known_hosts_path(host)
	if FileAccess.file_exists(path):
		var previous := _host_key_material(FileAccess.get_file_as_string(path))
		if previous != material:
			return {"ok": false, "message": UIStrings.t("vps.action.host_key_changed")}
	else:
		DirAccess.make_dir_recursive_absolute(path.get_base_dir())
		if not _write_text(path, str(scan.get("out", "")).strip_edges() + "\n"):
			return {"ok": false, "message": UIStrings.t("vps.action.fingerprint_save_failed")}
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


func provision_vps(ip: String, key_path: String, user := "") -> void:
	if _action_running:
		return
	var target := _vps_credentials(ip, key_path, user)
	if target.is_empty():
		action_changed.emit("vps-provision", false,
				UIStrings.t("vps.action.destination_invalid"), false)
		return
	_start_action("vps-provision", _do_provision_vps.bind(target))


static func _vps_prepare_runtime_command() -> String:
	# L'installer mette il wrapper in /usr/local/bin quando gira come root e in
	# ~/.local/bin per utenti normali. Non assumere uno dei due percorsi: una VPS
	# Hetzner nuova usa root e il vecchio hardcoding faceva fallire il primo up.
	return "set -e; export JHT_SKIP_ONBOARD=1; " \
			+ "JHT_BIN=\"$(command -v jht 2>/dev/null || true)\"; " \
			+ "[ -n \"$JHT_BIN\" ] || JHT_BIN=\"$HOME/.local/bin/jht\"; " \
			+ "if [ ! -x \"$JHT_BIN\" ]; then " \
			+ "curl -fsSL https://jobhunterteam.ai/install.sh | bash; " \
			+ "JHT_BIN=\"$(command -v jht 2>/dev/null || true)\"; " \
			+ "[ -n \"$JHT_BIN\" ] || JHT_BIN=\"$HOME/.local/bin/jht\"; fi; " \
			+ "[ -x \"$JHT_BIN\" ] && [ ! -L \"$JHT_BIN\" ]; " \
			+ "JHT_BIN_REAL=\"$(cd -P \"$(dirname \"$JHT_BIN\")\" && printf '%s/%s' \"$(pwd -P)\" \"$(basename \"$JHT_BIN\")\")\"; " \
			+ "[ \"$JHT_BIN\" = \"$JHT_BIN_REAL\" ]; " \
			+ "case \"$JHT_BIN_REAL\" in \"$HOME/.jht\"|\"$HOME/.jht/\"*|\"$HOME/Documents/Job Hunter Team\"|\"$HOME/Documents/Job Hunter Team/\"*) exit 1;; esac; " \
			+ _posix_upgrade_bootstrap_with_target("JHT_WRAPPER_PATH=\"$JHT_BIN\"", false)


func _do_provision_vps(target: Dictionary) -> Dictionary:
	_progress("vps-provision", UIStrings.t("vps.action.verifying_access"))
	var check := _do_test_vps_connection(target)
	if not bool(check["ok"]):
		return check
	_progress("vps-provision", UIStrings.t("vps.action.installing_runtime"))
	var command := _vps_prepare_runtime_command() + " && " \
			+ "test \"$(docker inspect jht --format '{{.State.Running}}')\" = true && " \
			+ "grep -q '^JHT_HOST_TYPE=vps' \"$HOME/.jht/host.env\""
	var result := _run_ssh(target, command)
	if result["code"] != 0:
		return {"ok": false, "message": UIStrings.t("vps.action.setup_failed") \
				% str(result.get("out", "")).strip_edges().right(300)}
	return {"ok": true, "message": UIStrings.t("vps.action.ready"),
			"activate_vps": target}


func migrate_to_vps(ip: String, key_path: String, source_mode: String,
		user := "") -> void:
	if _action_running:
		return
	var target := _vps_credentials(ip, key_path, user)
	if target.is_empty():
		action_changed.emit("vps-migrate", false,
				UIStrings.t("vps.action.migration_destination_invalid"), false)
		return
	var source := BackendBus.load_vps_config() if source_mode == "vps" else {}
	if source_mode == "vps":
		source = _vps_credentials(str(source.get("ip", "")),
				str(source.get("key_path", "")), str(source.get("user", "")))
		if source.is_empty():
			action_changed.emit("vps-migrate", false,
					UIStrings.t("vps.action.source_missing"), false)
			return
		if str(source["ip"]) == str(target["ip"]):
			action_changed.emit("vps-migrate", false,
					UIStrings.t("vps.action.same_source_destination"), false)
			return
	_start_action("vps-migrate", _do_migrate_to_vps.bind(target, source_mode, source))


## Percorso inverso, assente nella prima versione: la VPS salvata è la
## sorgente, il runtime Docker di questo computer è la destinazione.
func migrate_to_local() -> void:
	if _action_running:
		return
	var source := BackendBus.load_vps_config()
	source = _vps_credentials(str(source.get("ip", "")),
			str(source.get("key_path", "")), str(source.get("user", "")))
	if source.is_empty():
		action_changed.emit("vps-migrate", false,
				UIStrings.t("vps.action.source_missing"), false)
		return
	_start_action("vps-migrate", _do_migrate_to_local.bind(source))


func _do_migrate_to_vps(target: Dictionary, source_mode: String,
		source: Dictionary) -> Dictionary:
	var check := _do_test_vps_connection(target)
	if not bool(check["ok"]):
		return check
	_progress("vps-migrate", UIStrings.t("vps.action.preparing_destination"))
	var provision := _run_ssh(target,
			_vps_prepare_runtime_command() + " && " \
			+ "test \"$(docker inspect jht --format '{{.State.Running}}')\" = true")
	if provision["code"] != 0:
		return {"ok": false, "message": UIStrings.t("vps.action.destination_prepare_failed") \
				% str(provision.get("out", "")).right(280)}
	var target_team_probe := _run_ssh(target,
			"docker exec jht tmux list-sessions -F '#{session_name}' 2>/dev/null")
	var target_team_was_running: bool = target_team_probe["code"] == 0 \
			and str(target_team_probe.get("out", "")).strip_edges() != ""

	var stamp := str(int(Time.get_unix_time_from_system()))
	var archive_name := "jht-migration-" + stamp + ".tar.gz"
	var local_archive := OS.get_cache_dir().path_join(archive_name)
	_progress("vps-migrate", UIStrings.t("vps.action.snapshot_source"))
	var captured := _capture_migration_source(source_mode, source,
			archive_name, local_archive)
	if not bool(captured.get("ok", false)):
		return captured

	_progress("vps-migrate", UIStrings.t("vps.action.transferring"))
	var upload := _scp_upload(target, local_archive, "/tmp/" + archive_name)
	if upload["code"] != 0:
		DirAccess.remove_absolute(local_archive)
		_restore_migration_source(source_mode, source,
				bool(captured.get("container_was_running", false)),
				bool(captured.get("team_was_running", false)))
		return {"ok": false, "message": UIStrings.t("vps.action.transfer_failed") \
				% str(upload.get("out", "")).strip_edges().right(280)}

	_progress("vps-migrate", UIStrings.t("vps.action.verifying_transfer"))
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
		return {"ok": false, "message": UIStrings.t("vps.action.apply_failed") \
				% [remote_backup, str(apply.get("out", "")).right(220)]}

	if bool(captured.get("team_was_running", false)):
		_progress("vps-migrate", UIStrings.t("vps.action.restarting_team"))
		var team_start := _run_ssh(target,
				"docker exec jht node /app/cli/bin/jht.js team start >/dev/null 2>&1 && " \
				+ "for i in $(seq 1 15); do docker exec jht tmux list-sessions " \
				+ "-F '#{session_name}' 2>/dev/null | grep -q . && exit 0; sleep 2; done; exit 1")
		if team_start["code"] != 0:
			_rollback_vps_destination(target, stamp, target_team_was_running)
			_restore_migration_source(source_mode, source,
					bool(captured.get("container_was_running", false)),
					bool(captured.get("team_was_running", false)))
			return {"ok": false, "message": UIStrings.t("vps.action.team_start_failed") \
					% remote_backup}

	# Commit del single-source handoff: se non riusciamo a disarmare la vecchia
	# origine, ripristiniamo davvero la destinazione invece di dichiarare un
	# successo con due writer potenziali.
	var handoff := _archive_source_cloud(source_mode, source, stamp)
	if not bool(handoff.get("ok", false)):
		_rollback_vps_destination(target, stamp, target_team_was_running)
		_restore_migration_source(source_mode, source,
				bool(captured.get("container_was_running", false)),
				bool(captured.get("team_was_running", false)))
		return {"ok": false, "message": UIStrings.t("vps.action.handoff_failed") \
				% str(handoff.get("message", UIStrings.t("common.unknown_error")))}
	_cleanup_vps_transaction(target, stamp)
	return {"ok": true,
			"message": UIStrings.t("vps.action.migration_complete") % remote_backup,
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
	_progress("vps-migrate", UIStrings.t("vps.action.downloading_snapshot"))
	var captured := _capture_migration_source("vps", source,
			archive_name, local_archive)
	if not bool(captured.get("ok", false)):
		return captured
	_progress("vps-migrate", UIStrings.t("vps.action.applying_local"))
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
		return {"ok": false, "message": UIStrings.t("vps.action.handoff_failed") \
				% str(handoff.get("message", UIStrings.t("common.unknown_error")))}
	_commit_local_destination(applied)
	return {"ok": true,
			"message": UIStrings.t("vps.action.local_migration_complete") \
				% str(applied.get("backup", "")), "activate_local": true}


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
		return {"ok": false, "message": UIStrings.t("vps.action.snapshot_failed") \
				% str(created.get("out", "")).strip_edges().right(280)}
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
		return {"ok": false, "message": UIStrings.t("vps.action.snapshot_checksum_invalid")}
	return {"ok": true, "sha256": actual_sha,
			"container_was_running": container_was_running,
			"team_was_running": team_was_running}


static func _validate_migration_archive(path: String) -> Dictionary:
	if not _file_nonempty(path):
		return {"ok": false, "message": UIStrings.t("vps.action.snapshot_unreadable")}
	var listing := _run("tar", PackedStringArray(["-tzf", path]))
	if listing["code"] != 0:
		return {"ok": false, "message": UIStrings.t("vps.action.snapshot_corrupt") \
				% str(listing.get("out", "")).right(220)}
	var has_jht := false
	var has_payload := false
	for raw: String in str(listing.get("out", "")).split("\n"):
		var name := raw.strip_edges().trim_prefix("./")
		if name == "":
			continue
		if name.begins_with("/") or name.split("/").has(".."):
			return {"ok": false, "message": UIStrings.t("vps.action.snapshot_unsafe_path")}
		if name == ".jht" or name.begins_with(".jht/"):
			has_jht = true
		if name in [".jht/jobs.db", ".jht/jht.config.json"] \
				or name.begins_with(".jht/profile/"):
			has_payload = true
		if name == ".jht/host.env" or name.begins_with(".jht/ssh/") \
				or name.begins_with(".jht/runtime/"):
			return {"ok": false, "message": UIStrings.t("vps.action.snapshot_reserved_files")}
	if not has_jht or not has_payload:
		return {"ok": false, "message": UIStrings.t("vps.action.snapshot_invalid_team")}
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
	var script := _rollback_vps_destination_script(stamp)
	_run_ssh(target, "bash -lc " + _shell_quote(script))
	if team_was_running:
		_run_ssh(target,
				"docker exec jht node /app/cli/bin/jht.js team start >/dev/null 2>&1 || true")


static func _rollback_vps_destination_script(stamp: String) -> String:
	var old_jht := "/root/.jht.migration-old-" + stamp
	var old_docs := "/root/Documents/Job Hunter Team.migration-old-" + stamp
	var stage := "/root/.jht-migration-stage-" + stamp
	return "set -u; if [ -d " + _shell_quote(old_jht) + " ]; then " \
			+ "docker stop jht >/dev/null 2>&1 || true; rm -rf -- /root/.jht; " \
			+ "mv " + _shell_quote(old_jht) + " /root/.jht; " \
			+ "if [ -d " + _shell_quote(old_docs) + " ]; then rm -rf -- " \
			+ "\"/root/Documents/Job Hunter Team\"; mv " + _shell_quote(old_docs) \
			+ " \"/root/Documents/Job Hunter Team\"; fi; " \
			+ _vps_prepare_runtime_command() + " >/dev/null 2>&1 || true; fi; " \
			+ "rm -rf -- " + _shell_quote(stage)


static func _cleanup_vps_transaction(target: Dictionary, stamp: String) -> void:
	var script := "rm -rf -- " + _shell_quote("/root/.jht.migration-old-" + stamp) \
			+ " " + _shell_quote("/root/Documents/Job Hunter Team.migration-old-" + stamp) \
			+ " " + _shell_quote("/root/.jht-migration-stage-" + stamp)
	_run_ssh(target, script)


func _prepare_local_migration_target() -> Dictionary:
	var daemon := _run("docker", PackedStringArray(["version", "--format",
			"{{.Server.Version}}"] ))
	if daemon["code"] != 0:
		var launch := _launch_docker_runtime(selected_runtime(installed_runtimes()))
		if not bool(launch.get("ok", false)):
			return launch
		_progress("vps-migrate", str(launch.get("message",
				UIStrings.t("setup.action.docker_starting") % 0)))
		for waited in range(2, 122, 2):
			OS.delay_msec(2000)
			daemon = _run("docker", PackedStringArray(["version", "--format",
					"{{.Server.Version}}"] ))
			if daemon["code"] == 0:
				break
			_progress("vps-migrate", UIStrings.t("setup.action.docker_starting") % waited)
	if daemon["code"] != 0:
		return {"ok": false, "message": UIStrings.t("vps.action.local_docker_unavailable")}
	var compose := _ensure_compose_file()
	if compose == "":
		return {"ok": false, "message": UIStrings.t("vps.action.local_runtime_prepare_failed")}
	_ensure_host_dirs()
	var pull := _compose_stream(compose, PackedStringArray(["pull", "jht"]),
			UIStrings.t("vps.action.preparing_local_image"))
	if not bool(pull.get("ok", false)) and _local_runtime_image_id() == "":
		return {"ok": false, "message": UIStrings.t("vps.action.runtime_image_unavailable") \
				% str(pull.get("tail", "")).right(220)}
	return {"ok": true}


## La migrazione verifica se il pull ha almeno lasciato un'immagine locale
## utilizzabile. Non e' il percorso di upgrade: quello passa solo dal wrapper.
static func _local_runtime_image_id() -> String:
	var found := _run("docker", PackedStringArray(["image", "inspect",
			runtime_image(), "--format", "{{.Id}}"] ))
	return str(found["out"]).strip_edges() if found["code"] == 0 else ""


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
		return {"ok": false, "message": UIStrings.t("vps.action.local_extract_failed") \
				% str(extracted.get("out", "")).right(220)}
	if not FileAccess.file_exists(staged_jht.path_join("jobs.db")) \
			and not FileAccess.file_exists(staged_jht.path_join("jht.config.json")) \
			and not DirAccess.dir_exists_absolute(staged_jht.path_join("profile")):
		_remove_tree(stage)
		return {"ok": false, "message": UIStrings.t("vps.action.extracted_team_invalid")}
	DirAccess.make_dir_recursive_absolute(staged_docs)
	# Le chiavi appartengono alla macchina destinazione. Il vecchio runtime
	# sotto .jht e invece input container-writable: non viene mai copiato; il
	# compose host autorevole vive fuori dal bind in user://runtime.
	for rel in ["ssh"]:
		var src := home.path_join(".jht/" + rel)
		if DirAccess.dir_exists_absolute(src):
			var copied := _copy_tree(src, staged_jht.path_join(rel))
			if copied != OK:
				_remove_tree(stage)
				return {"ok": false, "message": UIStrings.t("vps.action.preserve_failed") \
						% (".jht/" + rel)}
	var host_env := _local_host_env(home.path_join(".jht/host.env"))
	if not _write_text(staged_jht.path_join("host.env"), host_env):
		_remove_tree(stage)
		return {"ok": false, "message": UIStrings.t("vps.action.local_mode_failed")}

	var backup_dir := home.path_join(".jht-migration-backups")
	DirAccess.make_dir_recursive_absolute(backup_dir)
	var backup := backup_dir.path_join("jht-before-migration-" + stamp + ".tar.gz")
	var backed_up := _create_local_destination_backup(backup)
	if backed_up["code"] != 0 or not _file_nonempty(backup):
		_remove_tree(stage)
		return {"ok": false, "message": UIStrings.t("vps.action.local_backup_failed") \
				% str(backed_up.get("out", "")).right(220)}
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
		return {"ok": false, "message": UIStrings.t("vps.action.protect_data_failed")}
	tx["jht_moved"] = true
	if DirAccess.dir_exists_absolute(current_docs) \
			and DirAccess.rename_absolute(current_docs, old_docs) != OK:
		_rollback_local_destination(tx, true)
		return {"ok": false, "message": UIStrings.t("vps.action.protect_documents_failed")}
	tx["docs_moved"] = DirAccess.dir_exists_absolute(old_docs)
	if DirAccess.rename_absolute(staged_jht, current_jht) != OK:
		_rollback_local_destination(tx, true)
		return {"ok": false, "message": UIStrings.t("vps.action.activate_data_failed")}
	tx["jht_activated"] = true
	DirAccess.make_dir_recursive_absolute(current_docs.get_base_dir())
	if DirAccess.rename_absolute(staged_docs, current_docs) != OK:
		_rollback_local_destination(tx, true)
		return {"ok": false, "message": UIStrings.t("vps.action.activate_documents_failed")}
	tx["docs_activated"] = true

	var started := _do_start_container()
	if not bool(started.get("ok", false)):
		_rollback_local_destination(tx, true)
		return {"ok": false, "message": UIStrings.t("vps.action.migrated_runtime_start_failed") \
				% str(started.get("message", ""))}
	var checked := _validate_local_migration_target()
	if not bool(checked.get("ok", false)):
		_rollback_local_destination(tx, true)
		return checked
	if team_was_running:
		# Ripristino interno alla transazione di migrazione: non appartiene a un
		# tentativo UI e il suo frame non viene consegnato a _finish_action.
		var team := _do_start_team({}, -1)
		if not bool(team.get("ok", false)):
			_rollback_local_destination(tx, true)
			return {"ok": false, "message": UIStrings.t("vps.action.local_team_restart_failed")}
	tx["ok"] = true
	return tx


static func _validate_local_migration_target() -> Dictionary:
	var running := _run("docker", PackedStringArray([
			"inspect", "jht", "--format", "{{.State.Running}}"] ))
	if running["code"] != 0 or str(running.get("out", "")).strip_edges() != "true":
		return {"ok": false, "message": UIStrings.t("vps.action.migrated_container_inactive")}
	if FileAccess.file_exists(_jht_home().path_join("jobs.db")):
		var py := "import sqlite3,sys; c=sqlite3.connect('/jht_home/jobs.db'); " \
				+ "sys.exit(0 if c.execute('pragma integrity_check').fetchone()[0]=='ok' else 1)"
		var integrity := _run("docker", PackedStringArray([
				"exec", "jht", "python3", "-c", py]))
		if integrity["code"] != 0:
			return {"ok": false, "message": UIStrings.t("vps.action.migrated_database_invalid")}
	var host_env := FileAccess.get_file_as_string(_jht_home().path_join("host.env"))
	if not host_env.contains("JHT_HOST_TYPE=local"):
		return {"ok": false, "message": UIStrings.t("vps.action.migrated_runtime_not_local")}
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
			"message": UIStrings.t("vps.action.archive_failed") % cloud if err != OK else ""}


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
		return {"code": -1, "out": UIStrings.t("vps.action.no_local_data")}
	return _run("tar", args)


static func _scp_download(source: Dictionary, remote: String, local: String) -> Dictionary:
	var key := VpsBackend.expand_user_path(str(source.get("key_path", "")))
	var known := VpsBackend.known_hosts_path(str(source.get("ip", "")))
	return _run("scp", PackedStringArray(["-i", key, "-o", "BatchMode=yes",
			"-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=yes",
			"-o", "UserKnownHostsFile=" + known,
			_ssh_target(source) + ":" + remote, local]))


static func _scp_upload(target: Dictionary, local: String, remote: String) -> Dictionary:
	var key := VpsBackend.expand_user_path(str(target.get("key_path", "")))
	var known := VpsBackend.known_hosts_path(str(target.get("ip", "")))
	return _run("scp", PackedStringArray(["-i", key, "-o", "BatchMode=yes",
			"-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=yes",
			"-o", "UserKnownHostsFile=" + known,
			local, _ssh_target(target) + ":" + remote]))


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


func open_vps_install(ip: String, key_path: String, user := "") -> void:
	var target := _vps_credentials(ip, key_path, user)
	if target.is_empty():
		action_changed.emit("vps-install", false,
				UIStrings.t("vps.action.install_destination_missing"), false)
		return
	var remote := _vps_prepare_runtime_command()
	var key := str(target["key_path"])
	var clean_ip := str(target["ip"])
	var known := VpsBackend.known_hosts_path(clean_ip)
	var command := "ssh -tt -i " + _local_quote(key) \
			+ " -o StrictHostKeyChecking=yes -o UserKnownHostsFile=" \
			+ _local_quote(known) + " " + _local_quote(_ssh_target(target)) \
			+ " " + _local_quote(remote)
	terminal_requested.emit("vps-install", embedded_terminal_spec(
			UIStrings.t("vps.action.install_title"),
			UIStrings.t("vps.action.install_hint"),
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
				UIStrings.t("tg.action.invalid_token") % CharacterDefs.role_name(role), false)
		return
	_start_action("telegram", _do_save_telegram_bot.bind(
			role, clean_token, chat_id.strip_edges(), _vps_config()))


func delete_telegram_bot(role: String) -> void:
	if _action_running or not role in ["assistente", "capitano", "mentor"]:
		return
	_start_action("telegram", _do_delete_telegram_bot.bind(role, _vps_config()))


static var TELEGRAM_SAVE_PY := VpsBackend.payload("telegram_save.py")


static var TELEGRAM_DELETE_PY := VpsBackend.payload("telegram_delete.py")


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
		return {"ok": false, "message": UIStrings.t("tg.action.failed") % reason}
	return {"ok": true, "message": UIStrings.t("tg.action.connected") % [
			str(parsed.get("username", "bot")), CharacterDefs.role_name(role),
			str(parsed.get("chat_id", ""))]}


static func _do_delete_telegram_bot(role: String, vps: Dictionary) -> Dictionary:
	var payload := JSON.stringify({"role": role})
	var command := "docker exec -i jht python3 -c " + _shell_quote(TELEGRAM_DELETE_PY)
	var result := _run_ssh_stdin(vps, command, payload.to_utf8_buffer()) \
			if not vps.is_empty() else _run_stdin_stderr("docker", PackedStringArray([
					"exec", "-i", "jht", "python3", "-c", TELEGRAM_DELETE_PY]),
					payload.to_utf8_buffer())
	return {"ok": result["code"] == 0,
			"message": UIStrings.t("tg.action.removed") % CharacterDefs.role_name(role) \
			if result["code"] == 0 else UIStrings.t("tg.action.remove_failed") \
			% str(result.get("out", "")).right(220)}


func save_email(email: String, password: String) -> void:
	if _action_running:
		return
	var clean_email := email.strip_edges()
	var clean_password := password.replace(" ", "").strip_edges()
	if not _valid_email(clean_email) or clean_password.length() < 8:
		action_changed.emit("email", false,
				UIStrings.t("email.action.invalid_credentials"), false)
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
			saved = {"code": -1, "out": UIStrings.t("email.action.data_folder_unwritable")}
	else:
		var python := "import sys,json,os;d=json.load(sys.stdin);" \
				+ "p='/jht_home/credentials/email_monitor.json';" \
				+ "os.makedirs(os.path.dirname(p),exist_ok=True);t=p+'.tmp';" \
				+ "open(t,'w').write(json.dumps(d,ensure_ascii=False,indent=2)+'\\n');" \
				+ "os.chmod(t,0o600);os.replace(t,p)"
		var remote := "docker exec -i jht python3 -c " + _shell_quote(python)
		saved = _run_ssh_stdin(vps, remote, payload.to_utf8_buffer())
	if saved["code"] != 0:
		return {"ok": false, "message": UIStrings.t("email.action.save_failed") \
				% str(saved["out"]).right(220)}
	# Verifica reale IMAP attraverso la stessa skill usata dallo Scout.
	var check_cmd := "docker exec jht python3 /app/shared/skills/email_monitor.py count"
	var checked := _run_ssh(vps, check_cmd) if not vps.is_empty() else _run(
			"docker", PackedStringArray(["exec", "jht", "python3",
			"/app/shared/skills/email_monitor.py", "count"]))
	return {"ok": checked["code"] == 0,
			"message": UIStrings.t("email.action.saved") % email \
			if checked["code"] == 0 else UIStrings.t("email.action.verify_failed") \
			% str(checked["out"]).right(220)}


static func _do_delete_email(vps: Dictionary) -> Dictionary:
	var result := {"code": 0, "out": ""}
	if vps.is_empty():
		result["code"] = 0 if JhtFs.remove("credentials/email_monitor.json") else -1
	else:
		result = _run_ssh(vps,
				"docker exec jht rm -f /jht_home/credentials/email_monitor.json")
	return {"ok": result["code"] == 0,
			"message": UIStrings.t("email.action.removed") if result["code"] == 0 \
			else UIStrings.t("email.action.remove_failed") % str(result["out"]).right(220)}


static func _run_stdin_stderr(path: String, args: PackedStringArray,
		payload: PackedByteArray) -> Dictionary:
	var process := OS.execute_with_pipe(path, args, true)
	if process.is_empty():
		return {"code": -1, "out": UIStrings.t("common.command_unavailable") % path}
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
	var target := _ssh_target(vps)
	var process := OS.execute_with_pipe("ssh", PackedStringArray([
		"-i", key, "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes",
		"-o", "ConnectTimeout=8", "-o", "StrictHostKeyChecking=yes",
		"-o", "UserKnownHostsFile=" + known,
		target, command + " 1>&2"]), true)
	if process.is_empty():
		return {"code": -1, "out": UIStrings.t("common.command_unavailable") % "ssh"}
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
		return "printf '\\n%s\\n\\n'; " % UIStrings.t("setup.term.subscription_banner") \
				+ _local_container_exec(tool)
	var inner := "docker exec -it jht " + tool
	var key := VpsBackend.expand_user_path(str(vps.get("key_path", "")))
	var target := _ssh_target(vps)
	var command := "ssh -tt -i " + _local_quote(key) + " " \
			+ _local_quote(target) + " " + _local_quote(inner)
	if OS.get_name() != "Windows":
		command = "printf '\\n%s\\n\\n'; " % UIStrings.t("setup.term.subscription_banner") \
				+ command
	return command


static func _provider_terminal_hint(provider: String) -> String:
	match provider:
		"codex":
			return UIStrings.t("setup.login_hint_codex")
		"kimi":
			return UIStrings.t("setup.login_hint_kimi")
		_:
			return UIStrings.t("setup.login_hint_claude")


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
				UIStrings.t("team.action.not_ready"), false)
		return
	team_start_state.begin(Time.get_ticks_msec())
	_persist_team_start_state()
	team_start_state_changed.emit(team_start_snapshot())
	_start_action("team", _do_start_team.bind(
			_vps_config(), team_start_state.attempt))


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


func _do_start_team(vps: Dictionary, start_attempt: int) -> Dictionary:
	_set_phase("team")
	# Offset E identità PRIMA del comando: soltanto un append allo stesso file
	# può attestare che il watchdog sta recuperando QUESTO tentativo. Un log
	# ruotato e ricresciuto oltre l'offset non è la stessa osservazione.
	var watchdog_boundary := _watchdog_log_boundary(vps)
	var res := _run_ssh(vps, "docker exec jht node /app/cli/bin/jht.js team start") \
			if not vps.is_empty() else _run("docker", PackedStringArray([
					"exec", "jht", "node", "/app/cli/bin/jht.js", "team", "start"] ))
	return {"ok": res["code"] == 0,
			"team_operation": "start", "command_output": str(res.get("out", "")),
			"team_start_attempt": start_attempt,
			"watchdog_cursor": int(watchdog_boundary.get("cursor", -1)),
			"watchdog_identity": str(watchdog_boundary.get("identity", "")),
			"watchdog_fingerprint": str(
					watchdog_boundary.get("fingerprint", "")),
			"message": UIStrings.t("team.action.started") if res["code"] == 0 \
			else UIStrings.t("team.action.start_failed") % str(res["out"]).right(240)}


static func _do_stop_team(vps: Dictionary) -> Dictionary:
	var result := _run_cli(vps, PackedStringArray(["team", "stop", "--all"]))
	return {"ok": result["code"] == 0, "team_operation": "stop",
			"message": UIStrings.t("team.action.stopped") if result["code"] == 0 \
			else UIStrings.t("team.action.stop_failed") % str(result.get("out", "")).right(240)}


static func _do_control_agent(role: String, restart: bool, vps: Dictionary) -> Dictionary:
	var stopped := _run_cli(vps, PackedStringArray(["team", "stop", role]))
	# Fermare un ruolo già inattivo non deve impedire un riavvio esplicito.
	if not restart:
		return {"ok": stopped["code"] == 0,
				"message": UIStrings.t("agents.action.stopped") \
				% CharacterDefs.role_name(role) if stopped["code"] == 0 \
				else UIStrings.t("agents.action.stop_failed") \
				% str(stopped.get("out", "")).right(220)}
	var started := _run_cli(vps, PackedStringArray(["team", "start", role]))
	return {"ok": started["code"] == 0,
			"message": UIStrings.t("agents.action.restarted") \
			% CharacterDefs.role_name(role) if started["code"] == 0 \
			else UIStrings.t("agents.action.restart_failed") \
			% str(started.get("out", "")).right(220)}


static func _run_cli(vps: Dictionary, args: PackedStringArray) -> Dictionary:
	if vps.is_empty():
		var local := PackedStringArray(["exec", "jht", "node", "/app/cli/bin/jht.js"])
		local.append_array(args)
		return _run("docker", local)
	var command := "docker exec jht node /app/cli/bin/jht.js"
	for arg in args:
		command += " " + _shell_quote(arg)
	return _run_ssh(vps, command)


## Esegue argv costanti dentro al runtime scelto. Il percorso remoto quota ogni
## argomento separatamente; nessun dato utente entra negli script qui sotto.
static func _run_container(vps: Dictionary, args: PackedStringArray) -> Dictionary:
	if vps.is_empty():
		var local := PackedStringArray(["exec", "jht"])
		local.append_array(args)
		return _run("docker", local)
	var command := "docker exec jht"
	for arg in args:
		command += " " + _shell_quote(arg)
	return _run_ssh(vps, command)


## Byte, identità e hash del prefisso già presenti prima dello start.
## L'hash è necessario oltre all'inode: copytruncate conserva l'inode e può
## ricrescere oltre il vecchio offset. Gli script evitano `$` perché su POSIX
## Godot interpola gli argv di OS.execute nella shell host prima di passarli a
## `docker exec`; il confine deve essere misurato soltanto nel container.
static func _watchdog_log_boundary(vps: Dictionary) -> Dictionary:
	var path := _shell_quote(TEAM_WATCHDOG_LOG)
	var script := "if [ -f " + path + " ]; then " \
			+ "stat -c '%s %d:%i' " + path + " || exit 5; " \
			+ "sha256sum " + path + " || exit 6; " \
			+ "else printf '0 missing\\n" + EMPTY_SHA256 + "  -\\n'; fi"
	var result := _run_container(vps, PackedStringArray(["sh", "-c", script]))
	var raw := str(result.get("out", "")).strip_edges()
	var lines := raw.split("\n", false)
	var header := PackedStringArray() if lines.is_empty() \
			else str(lines[0]).split(" ", false)
	var digest := PackedStringArray() if lines.size() <= 1 \
			else str(lines[1]).split(" ", false)
	if int(result.get("code", -1)) != 0 or header.size() != 2 \
			or digest.is_empty() or not str(header[0]).is_valid_int() \
			or str(header[1]) == "" or str(digest[0]).length() != 64:
		return {"cursor": -1, "identity": "", "fingerprint": ""}
	return {"cursor": maxi(int(header[0]), 0),
			"identity": str(header[1]), "fingerprint": str(digest[0])}


## Legge soltanto l'append successivo al cursor e ne limita il volume. Se il
## file è stato troncato/ruotato, il rapporto causale è perso: ritorno vuoto,
## quindi mai `recovering` per deduzione.
static func _watchdog_log_delta(vps: Dictionary, cursor: int,
		identity: String, fingerprint: String) -> String:
	if cursor < 0 or identity == "" or fingerprint.length() != 64:
		return ""
	var first_byte := cursor + 1
	var path := _shell_quote(TEAM_WATCHDOG_LOG)
	var script := "[ -f " + path + " ] || { [ " + _shell_quote(identity) \
			+ " = missing ] && exit 0; exit 4; }; " \
			+ "{ [ " + _shell_quote(identity) + " = missing ] || " \
			+ "stat -c '%d:%i' " + path + " | grep -Fqx -- " \
			+ _shell_quote(identity) + "; } || exit 5; " \
			+ "head -c " + str(cursor) + " " + path \
			+ " | sha256sum | grep -Fq -- " \
			+ _shell_quote(fingerprint + "  -") + " || exit 6; " \
			+ "tail -c +" + str(first_byte) + " " + path + " | tail -c 16384"
	var result := _run_container(vps, PackedStringArray(["sh", "-c", script]))
	return str(result.get("out", "")) if int(result.get("code", -1)) == 0 else ""


func _start_action(action: String, callable: Callable, start_message := "") -> void:
	_action_running = true
	current_action = action
	action_phase = ""
	action_started_ms = Time.get_ticks_msec()
	phase_started_ms = action_started_ms
	last_pull = {}
	Log.info("setup", "azione avviata: " + action)
	action_changed.emit(action, true, UIStrings.t("setup.action.in_progress") \
			if str(start_message) == "" else start_message, true)
	WorkerThreadPool.add_task(_run_action.bind(action, callable))


## Fase corrente dell'azione, annunciata DAL worker: sicura da chiamare da un
## thread (l'emit avviene deferred sul main). La fase resta valida finché
## l'azione non ne dichiara un'altra o non termina.
func _set_phase(phase: String) -> void:
	call_deferred("_apply_phase", phase)


func _apply_phase(phase: String) -> void:
	action_phase = phase
	phase_started_ms = Time.get_ticks_msec()
	# Fase nuova, contatore nuovo: i byte del pull non descrivono la fase
	# successiva e una barra piena ereditata mentirebbe.
	last_pull = {}
	phase_changed.emit(current_action, phase)


## Avanzamento pull ricevuto dal worker (deferred): memorizzato per i pannelli
## ricostruiti a metà azione, poi annunciato a chi ascolta.
func _apply_pull_progress(info: Dictionary) -> void:
	last_pull = info
	pull_progress.emit(info)


func _run_action(action: String, callable: Callable) -> void:
	var result: Dictionary = callable.call()
	call_deferred("_finish_action", action, result)


func _finish_action(action: String, result: Dictionary) -> void:
	_action_running = false
	current_action = ""
	action_phase = ""
	last_pull = {}
	var team_start_pending_confirmation := false
	if action == "team" and str(result.get("team_operation", "")) == "start":
		if team_start_state.finish_command(
				int(result.get("team_start_attempt", -1)),
				bool(result.get("ok", false)),
				str(result.get("command_output", "")),
				int(result.get("watchdog_cursor", -1)),
				str(result.get("watchdog_identity", "")),
				str(result.get("watchdog_fingerprint", "")),
				Time.get_ticks_msec()):
			_persist_team_start_state()
			team_start_state_changed.emit(team_start_snapshot())
			# Exit 0 attesta soltanto il comando. Finché il probe non osserva
			# CAPITANO, anche il log/action signal deve restare neutro: il verde
			# "Team avviato" sarebbe un esito che nessuno ha ancora misurato.
			team_start_pending_confirmation = bool(result.get("ok", false))
	elif action == "team" and str(result.get("team_operation", "")) == "stop" \
			and bool(result.get("ok", false)):
		team_start_state.stopped(Time.get_ticks_msec())
		_persist_team_start_state()
		team_start_state_changed.emit(team_start_snapshot())
	if action == "upgrade":
		last_upgrade = result.duplicate(true)
		result["message"] = _upgrade_ui_message(result)
	elif action == "upgrade-check":
		last_upgrade_check = result.duplicate(true)
		result["message"] = _upgrade_check_ui_message(result)
	if team_start_pending_confirmation:
		result["message"] = UIStrings.t("team.start_waiting")
	Log.info("setup", "azione %s → %s: %s" % [action,
			"ok" if bool(result.get("ok", false)) else "FALLITA",
			str(result.get("message", ""))])
	action_changed.emit(action, false, str(result.get("message", "")),
			bool(result.get("ok", false)))
	if bool(result.get("ok", false)) and result.get("activate_vps") is Dictionary:
		var target: Dictionary = result["activate_vps"]
		BackendBus.save_vps_config(str(target.get("ip", "")),
				str(target.get("key_path", "")), str(target.get("user", "")))
		BackendBus.set_backend(VpsBackend.new(), target)
	elif bool(result.get("ok", false)) and bool(result.get("activate_local", false)):
		BackendBus.switch_to_local_backend()
	refresh()


## Solo qui, sul main thread, il responso strutturato diventa testo UI. Il
## backend ha gia' svolto restart/verify: restartRequired e' informazione per
## l'utente, non un ordine al gioco di eseguire un secondo riavvio.
func _upgrade_ui_message(result: Dictionary) -> String:
	if bool(result.get("protocol_error", false)):
		return UIStrings.t("setup.upgrade_protocol_error")
	var lines := PackedStringArray()
	var phase := str(result.get("phase", ""))
	if phase != "":
		lines.append(UIStrings.t("setup.upgrade_phase") % phase)
	var message := str(result.get("message", "")).strip_edges()
	if message != "":
		lines.append(message)
	var current: Dictionary = result.get("current", {})
	var version := str(current.get("version", "")).strip_edges()
	if version != "":
		lines.append(UIStrings.t("setup.upgrade_current") % version)
	if bool(result.get("rolledBack", false)):
		lines.append(UIStrings.t("setup.upgrade_rolled_back"))
	if bool(result.get("restartRequired", false)):
		lines.append(UIStrings.t("setup.upgrade_restart_required"))
	return "\n".join(lines) if not lines.is_empty() \
			else UIStrings.t("setup.upgrade_protocol_error")


## Il check mostra solo il suo esito sicuro e non espone `current.image`: per
## contratto quello puo' essere la candidate scaricata, non la versione attiva.
func _upgrade_check_ui_message(result: Dictionary) -> String:
	if bool(result.get("protocol_error", false)):
		return UIStrings.t("setup.runtime_check_error")
	if not bool(result.get("ok", false)):
		var failure := str(result.get("message", "")).strip_edges()
		return failure if failure != "" else UIStrings.t("setup.runtime_check_error")
	return UIStrings.t("setup.runtime_check_available") \
			if bool(result.get("changed", false)) else UIStrings.t("setup.runtime_check_current")


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
	# ⚠️ NON TRADURRE: questo non è testo dell'interfaccia, è un ORDINE che il
	# Capitano ESEGUE leggendolo. Gli agenti del prodotto girano in italiano;
	# riscriverlo in inglese cambierebbe il COMPORTAMENTO — nel migliore dei
	# casi l'ordine non viene riconosciuto e la chiusura pulita non parte.
	# Riconoscibile dalla busta `[@mittente -> @destinatario]`: dove la vedi,
	# vale la stessa regola. Il censimento della copy (O-07) lo salta apposta,
	# e tests/test_shutdown_timeout_contract.py asserisce su questo testo.
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
##
## `OS.execute` qui non va usato: se Docker Desktop smette di rispondere il
## worker non torna più e game.gd, che deve attenderlo prima di smontare gli
## autoload, resta per sempre sul velo di chiusura. Tre budget da 5 secondi
## tengono l'intera sequenza sotto la rete di sicurezza dei 20 secondi.
const SHUTDOWN_COMMAND_TIMEOUT_MS := 5000


static func _run_shutdown_command(argv: PackedStringArray) -> Dictionary:
	var pid := OS.create_process(_bin("docker"), argv, false)
	if pid <= 0:
		return {"code": -1, "timeout": false}
	var started := Time.get_ticks_msec()
	while OS.is_process_running(pid):
		if Time.get_ticks_msec() - started >= SHUTDOWN_COMMAND_TIMEOUT_MS:
			OS.kill(pid)
			return {"code": -1, "timeout": true}
		OS.delay_msec(20)
	return {"code": OS.get_process_exit_code(pid), "timeout": false}


func shutdown_team() -> void:
	for argv: PackedStringArray in shutdown_commands(_vps_config()):
		var res := _run_shutdown_command(argv)
		var suffix := " (timeout %ds)" % (SHUTDOWN_COMMAND_TIMEOUT_MS / 1000) \
				if bool(res.get("timeout", false)) else ""
		Log.call_deferred("info", "setup", "spegnimento: docker %s → %d%s"
				% [" ".join(argv), res["code"], suffix])


func _vps_config() -> Dictionary:
	return BackendBus.load_vps_config() if BackendBus.is_remote() else {}


static func _run_ssh(vps: Dictionary, command: String) -> Dictionary:
	return _run("ssh", _ssh_args(vps, command))


static func _ssh_args(vps: Dictionary, command: String) -> PackedStringArray:
	var key := VpsBackend.expand_user_path(str(vps.get("key_path", "")))
	var known := VpsBackend.known_hosts_path(str(vps.get("ip", "")))
	var target := _ssh_target(vps)
	return PackedStringArray(["-i", key, "-o", "BatchMode=yes",
			"-o", "IdentitiesOnly=yes", "-o", "ConnectTimeout=8",
			"-o", "StrictHostKeyChecking=yes",
			"-o", "UserKnownHostsFile=" + known, target, command])
