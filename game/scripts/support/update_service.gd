extends Node
## Autoload `UpdateService`: l'unico punto da cui il gioco scopre che esiste una
## versione più recente di sé, e l'unico che può sostituirla.
##
## Chi ha installato la 0.3.0 è rimasto sulla 0.3.0 per sempre. I binari escono
## come asset di una Release, nessun avviso li segue, e ogni versione arrivava
## solo a chi tornava di sua iniziativa sulla pagina a riscaricare. Da qui in poi
## il gioco lo chiede una volta al giorno e lo dice con una fascia che si può
## ignorare — non con una finestra che si mette davanti al lavoro.
##
## Tre regole, in ordine di importanza.
##
## 1. NIENTE SI INSTALLA SENZA PROVA DI PROVENIENZA. Su macOS il pacchetto passa
##    da `codesign`, da Gatekeeper e da un requisito appuntato al team che ha
##    firmato la copia in esecuzione, PRIMA che il bundle venga toccato (vedi
##    `mac_updater.gd`). Windows dalla 0.3.6 usa un manifest RSA firmato con la
##    root incorporata e un helper locale protetto; Linux resta manuale.
## 2. NESSUNA RETE SE NON SERVE. Spento dall'utente, spento dall'ambiente, senza
##    finestra, in vetrina, o già controllato oggi: non parte nessuna richiesta.
##    Offline non è un errore da mostrare — è un giorno in cui non si controlla.
## 3. L'UTENTE DECIDE. Non si scarica niente prima che abbia detto di sì, e
##    niente si riavvia sotto le sue mani.

## L'unico segnale: la fascia e la pagina Impostazioni ridisegnano da qui.
signal state_changed(state: Dictionary)

const WindowsProtocol := preload("res://scripts/support/windows_update_protocol.gd")
const WindowsClient := preload("res://scripts/support/windows_update_client.gd")
const WindowsVerifier := preload("res://scripts/support/windows_update_verifier.gd")

const PHASE_IDLE := "idle"
const PHASE_CHECKING := "checking"
## C'è una versione più recente e l'utente non ha ancora deciso niente.
const PHASE_AVAILABLE := "available"
const PHASE_DEFERRED := "deferred"
const PHASE_DOWNLOADING := "downloading"
## Verifica della firma e sostituzione: un solo passo per chi guarda, perché
## fra la verifica e la sostituzione non c'è niente che l'utente possa fare.
const PHASE_INSTALLING := "installing"
const PHASE_DONE := "done"
const PHASE_READY := "ready"
const PHASE_EXIT_PREPARING := "exit_preparing"
const PHASE_FAILED := "failed"
const PHASE_RECOVERED := "recovered"
## Controllato: sei già all'ultima versione. Serve alla pagina Impostazioni, che
## a un "controlla adesso" deve rispondere qualcosa; la fascia resta invisibile.
const PHASE_CURRENT := "current"

const DOWNLOAD_DIR := "user://updates"
const WINDOWS_MANIFEST_MAX_BYTES := 65536
const WINDOWS_SIGNATURE_BYTES := 384
const WINDOWS_HELPER_MAX_BYTES := 4 * 1024 * 1024
const WINDOWS_DESKTOP_MAX_BYTES := 1024 * 1024 * 1024

const HEALTH_ACK_WRITTEN := "health_written"
const HEALTH_ACK_ENV_PARTIAL := "health_env_partial"
const HEALTH_ACK_NONCE_INVALID := "health_nonce_invalid"
const HEALTH_ACK_PATH_INVALID := "health_path_invalid"
const HEALTH_ACK_CAPABILITY_ABSENT := "health_capability_absent"
const HEALTH_ACK_JOURNAL_ABSENT := "health_journal_absent"
const HEALTH_ACK_JOURNAL_OPEN_FAILED := "health_journal_open_failed"
const HEALTH_ACK_JOURNAL_READ_FAILED := "health_journal_read_failed"
const HEALTH_ACK_JOURNAL_INVALID := "health_journal_invalid"
const HEALTH_ACK_PROCESS_INVALID := "health_process_invalid"
const HEALTH_ACK_FRAME_INVALID := "health_frame_invalid"
const HEALTH_ACK_CAPABILITY_OPEN_FAILED := "health_capability_open_failed"
const HEALTH_ACK_CAPABILITY_WRITE_FAILED := "health_capability_write_failed"
const HEALTH_ACK_CAPABILITY_FLUSH_FAILED := "health_capability_flush_failed"

var phase := PHASE_IDLE
var latest_version := ""
var release_page := UpdateCheck.RELEASES_PAGE
var asset_url := ""
var asset_bundle := {}
## Chiave UI dell'ultimo fallimento (vedi le costanti ERR_* di MacUpdater).
var error_key := ""
var progress := 0
## Epoch dell'ultimo controllo ANDATO A BUON FINE. Un tentativo fallito non si
## annota: chi era offline all'avvio riprova al lancio successivo invece di
## restare al buio per ventiquattro ore.
var last_check := 0.0
## "Piu tardi" e version-aware e sopravvive al riavvio. Non e mai trust: una
## versione diversa lo supera e nessun valore qui abilita l'installazione.
var deferred_version := ""
var defer_until := 0.0
var highest_committed_version := ""
var highest_committed_sequence := 0
var pending_nonce := ""
var pending_version := ""
var rolled_back := false

var _http: HTTPRequest
var _download: HTTPRequest
var _thread: Thread
var _zip_path := ""
## {"bundle":…, "anchor":…} della copia in esecuzione, calcolato una volta sola:
## costa due `codesign` e una prova di scrittura.
var _target := {}
var _target_ready := false
var _windows_plan := {}
var _windows_verified := {}
var _windows_instance := ""
var _check_manual := false
var _windows_health_started := ""


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	if _windows_health_protocol_requested():
		_run_windows_health_protocol.call_deferred()
		return
	if OS.get_name() == "Windows" \
			and OS.get_environment("JHT_UPDATE_HANDOFF_PATH").strip_edges() != "":
		_watch_windows_recovery_handoff.call_deferred()
	_start_normal_update_service()


func _start_normal_update_service() -> void:
	Game.mark_windows_health_normal_work("update")
	var cfg := ConfigFile.new()
	if cfg.load(UpdateCheck.CONFIG_PATH) == OK:
		last_check = float(cfg.get_value("update", "last_check", 0.0))
		deferred_version = str(cfg.get_value("update", "deferred_version", ""))
		defer_until = float(cfg.get_value("update", "defer_until", 0.0))
		highest_committed_version = str(cfg.get_value(
				"update", "highest_committed_version", ""))
		highest_committed_sequence = int(cfg.get_value(
				"update", "highest_committed_sequence", 0))
		pending_nonce = str(cfg.get_value("update", "pending_nonce", ""))
		pending_version = str(cfg.get_value("update", "pending_version", ""))
	_resume_windows_pending.call_deferred()
	# Mai direttamente da _ready: qui l'albero non è ancora completo, e questo
	# autoload interroga il DisplayServer e apre una connessione di rete.
	_boot.call_deferred()


func _windows_health_protocol_requested() -> bool:
	return OS.get_name() == "Windows" and (
			OS.get_environment("JHT_UPDATE_NONCE") != ""
			or OS.get_environment("JHT_UPDATE_HEALTH_PATH") != "")


func _run_windows_health_protocol() -> void:
	var code := await _write_windows_health_ack()
	print("WINDOWS-UPDATE-HEALTH code=", code)
	if code != HEALTH_ACK_WRITTEN:
		Game.complete_windows_health_boot(false)
		get_tree().quit(1)
		return
	Game.complete_windows_health_boot(true)
	_watch_windows_recovery_handoff.call_deferred()
	_start_normal_update_service()


func _watch_windows_recovery_handoff() -> void:
	var raw_path := OS.get_environment("JHT_UPDATE_HANDOFF_PATH").strip_edges() \
			.replace("\\", "/")
	var health_path := OS.get_environment("JHT_UPDATE_HEALTH_PATH").strip_edges() \
			.replace("\\", "/")
	if raw_path == "" or raw_path.get_file().to_lower() != "handoff.json":
		return
	var transaction := raw_path.get_base_dir()
	if health_path != "" and health_path.get_base_dir().to_lower() \
			!= transaction.to_lower():
		return
	var ready_path := transaction.path_join("ready.json")
	while is_inside_tree():
		await get_tree().create_timer(0.1).timeout
		var frame := WindowsClient.read_json(raw_path)
		var ready := WindowsClient.read_json(ready_path)
		var nonce := OS.get_environment("JHT_UPDATE_NONCE")
		if nonce == "":
			nonce = str(ready.get("nonce", ""))
		if WindowsProtocol.recovery_handoff_capability_path(raw_path, nonce) == "":
			continue
		var started := _windows_health_started
		if started == "":
			started = str(ready.get("handoff_started", ""))
		if WindowsProtocol.recovery_handoff_matches(frame, ready,
				nonce, OS.get_process_id(), started, OS.get_executable_path()):
			Game.detach_from_cli()
			return


func _boot() -> void:
	if pending_nonce != "" or phase != PHASE_IDLE:
		return
	# TEST-AUTO: JHT_UPDATE_NOTICE=<versione> mostra la fascia con quella
	# versione senza toccare la rete — è così che si fotografa (run.sh shot).
	var forced := OS.get_environment("JHT_UPDATE_NOTICE").strip_edges()
	if forced != "":
		latest_version = forced
		_set_phase(PHASE_AVAILABLE)
		return
	check(false)


# ── Il controllo ─────────────────────────────────────────────────────

## `manual` = chiesto dall'utente da Impostazioni. Salta il ritmo di una volta al
## giorno, non le altre condizioni: spento resta spento.
func check(manual: bool) -> void:
	if phase in [PHASE_CHECKING, PHASE_DOWNLOADING, PHASE_INSTALLING,
			PHASE_EXIT_PREPARING]:
		return
	var reason := UpdateCheck.skip_reason({
		"env": OS.get_environment("JHT_UPDATE_CHECK").strip_edges(),
		"enabled": enabled(),
		"headless": DisplayServer.get_name() == "headless",
		"showcase": _showcase(),
		"now": Time.get_unix_time_from_system(),
		"last_check": 0.0 if manual else last_check,
	})
	if reason != "":
		Log.debug("update", "controllo saltato: %s" % reason)
		return
	if _http == null:
		_http = HTTPRequest.new()
		_http.timeout = 10.0
		add_child(_http)
		_http.request_completed.connect(_on_checked)
	_check_manual = manual
	_set_phase(PHASE_CHECKING)
	var err := _http.request(UpdateCheck.API_LATEST, _headers())
	if err != OK:
		_check_manual = false
		Log.debug("update", "controllo non avviato: errore %d" % err)
		_set_phase(PHASE_IDLE)


## Il gioco è a schermo per mostrare altro: scatto di verifica, banco di prova,
## avvio dall'editor su una copia dei sorgenti. In nessuno di questi casi c'è
## qualcosa da aggiornare, e una fascia in mezzo sarebbe solo rumore.
func _showcase() -> bool:
	return OS.get_environment("JHT_NOVPS") == "1" \
			or OS.get_environment("JHT_SHOT") != "" \
			or OS.has_feature("editor")


func _on_checked(result: int, code: int, _headers: PackedStringArray,
		body: PackedByteArray) -> void:
	var manual := _check_manual
	_check_manual = false
	# Offline, DNS muto, GitHub che risponde 503: non è un errore dell'utente e
	# non gli si dice niente. Si riproverà al prossimo avvio.
	if result != HTTPRequest.RESULT_SUCCESS or code != 200:
		Log.debug("update", "nessuna risposta utile (esito %d, codice %d)" % [result, code])
		_set_phase(PHASE_IDLE)
		return
	var parsed: Variant = JSON.parse_string(body.get_string_from_utf8())
	var info := UpdateCheck.release_info(parsed if parsed is Dictionary else {})
	if info.is_empty():
		Log.debug("update", "risposta senza una release utilizzabile")
		_set_phase(PHASE_IDLE)
		return
	last_check = Time.get_unix_time_from_system()
	if not _save_cfg():
		_set_phase(PHASE_IDLE)
		return
	release_page = str(info["page"])
	if not UpdateCheck.is_newer(str(info["version"]), current_version()):
		latest_version = current_version()
		if deferred_version != "":
			deferred_version = ""
			defer_until = 0.0
			_save_cfg()
		Log.info("update", "nessun aggiornamento: %s è l'ultima" % current_version())
		_set_phase(PHASE_CURRENT)
		return
	latest_version = str(info["version"])
	asset_bundle = UpdateCheck.asset_bundle(info["assets"], OS.get_name(), latest_version)
	asset_url = str(asset_bundle.get("package", ""))
	if deferred_version != "" and (manual or deferred_version != latest_version):
		deferred_version = ""
		defer_until = 0.0
		if not _save_cfg():
			_set_phase(PHASE_IDLE)
			return
	Log.info("update", "disponibile la %s (in uso la %s)"
			% [latest_version, current_version()])
	_set_phase(PHASE_DEFERRED if UpdateCheck.defer_active(latest_version,
			deferred_version, defer_until, Time.get_unix_time_from_system()) \
			else PHASE_AVAILABLE)


# ── Cosa succede quando l'utente accetta ─────────────────────────────

## macOS usa Developer ID; Windows forward-only usa manifest RSA+helper locale.
## Dove manca un'autorità già installata si apre soltanto la pagina release.
func can_install() -> bool:
	if asset_url == "":
		return false
	if OS.get_name() == "Windows":
		var plan := WindowsClient.plan(OS.get_executable_path(),
				"0".repeat(WindowsProtocol.NONCE_HEX_LENGTH))
		return UpdateCheck.windows_forward_allowed(current_version(), latest_version,
				highest_committed_version, WindowsClient.installed_authority_ready(
						plan, current_version()),
				WindowsVerifier.production_ready())
	return not install_target().is_empty()


func install_target() -> Dictionary:
	if not _target_ready:
		_target_ready = true
		_target = MacUpdater.installable_bundle()
	return _target


func open_release_page() -> void:
	OS.shell_open(release_page if release_page != "" else UpdateCheck.RELEASES_PAGE)


## Nasconde soltanto QUESTA versione per un giorno. La scelta viene salvata dal
## servizio, non dal pannello, quindi un riavvio non la dimentica. Una release
## successiva non eredita mai il defer della precedente.
func defer() -> bool:
	if phase not in [PHASE_AVAILABLE, PHASE_READY] \
			or UpdateCheck.parse_version(latest_version).is_empty():
		return false
	var old_version := deferred_version
	var old_until := defer_until
	deferred_version = latest_version
	defer_until = Time.get_unix_time_from_system() + UpdateCheck.CHECK_EVERY_S
	if not _save_cfg():
		deferred_version = old_version
		defer_until = old_until
		return false
	_set_phase(PHASE_DEFERRED)
	return true


func dismiss() -> void:
	if phase in [PHASE_FAILED, PHASE_RECOVERED]:
		_set_phase(PHASE_IDLE)


func install() -> void:
	if phase == PHASE_DOWNLOADING or phase == PHASE_INSTALLING:
		return
	if not can_install():
		open_release_page()
		return
	if OS.get_name() == "Windows":
		_install_windows()
		return
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(DOWNLOAD_DIR))
	_zip_path = DOWNLOAD_DIR.path_join("job-hunter-team-%s.zip" % latest_version)
	if _download != null:
		_download.queue_free()
	_download = HTTPRequest.new()
	# Il pacchetto macOS pesa centinaia di megabyte: su una linea lenta sono
	# minuti, e un timeout lo taglierebbe a metà. Il thread tiene la finestra
	# viva mentre scende.
	_download.timeout = 0.0
	_download.use_threads = true
	_download.download_file = _zip_path
	add_child(_download)
	_download.request_completed.connect(_on_downloaded)
	progress = 0
	_set_phase(PHASE_DOWNLOADING)
	var err := _download.request(asset_url, _headers())
	if err != OK:
		_fail("update.err_download")
		return
	_watch_progress()


## Windows: prima manifest+firma, poi parsing; solo il piano autenticato decide
## quali byte scaricare. Il helper locale riverifica tutto in modo indipendente.
func _install_windows() -> void:
	_set_phase(PHASE_DOWNLOADING)
	progress = 0
	var transaction_nonce := WindowsClient.nonce()
	var plan := WindowsClient.plan(OS.get_executable_path(), transaction_nonce)
	if plan.is_empty() or not WindowsClient.installed_authority_ready(
			plan, current_version()):
		_fail("update.err_trust")
		return
	if DirAccess.make_dir_recursive_absolute(str(plan["transaction"])) != OK:
		_fail("update.err_helper")
		return
	if not await _download_exact(str(asset_bundle.get("manifest", "")),
			str(plan["candidate_manifest"]), WINDOWS_MANIFEST_MAX_BYTES) \
			or not await _download_exact(str(asset_bundle.get("signature", "")),
					str(plan["candidate_signature"]), WINDOWS_SIGNATURE_BYTES,
					WINDOWS_SIGNATURE_BYTES):
		WindowsClient.remove_staged(plan)
		_fail("update.err_download")
		return
	var raw_manifest := FileAccess.get_file_as_bytes(str(plan["candidate_manifest"]))
	var raw_signature := FileAccess.get_file_as_bytes(str(plan["candidate_signature"]))
	var verified := WindowsVerifier.verify_production(raw_manifest, raw_signature,
			WindowsClient.manifest_context(current_version(),
					highest_committed_version, highest_committed_sequence))
	if not bool(verified.get("ok", false)) \
			or str(verified.get("version", "")) != latest_version:
		WindowsClient.remove_staged(plan)
		_fail("update.err_trust")
		return
	progress = 10
	state_changed.emit(state())
	var artifacts: Dictionary = verified.get("artifacts", {})
	var helper_size := int(artifacts.get(WindowsVerifier.ROLE_HELPER, {}) \
			.get("size", 0))
	var desktop_size := int(artifacts.get(WindowsVerifier.ROLE_DESKTOP, {}) \
			.get("size", 0))
	if helper_size <= 0 or helper_size > WINDOWS_HELPER_MAX_BYTES \
			or desktop_size <= 0 or desktop_size > WINDOWS_DESKTOP_MAX_BYTES:
		WindowsClient.remove_staged(plan)
		_fail("update.err_trust")
		return
	if not await _download_exact(str(asset_bundle.get("helper", "")),
			str(plan["candidate_helper"]), helper_size, helper_size) \
			or not await _download_exact(str(asset_bundle.get("package", "")),
					str(plan["candidate"]), desktop_size, desktop_size):
		WindowsClient.remove_staged(plan)
		_fail("update.err_download")
		return
	_set_phase(PHASE_INSTALLING)
	if not WindowsClient.verify_staged(plan, verified):
		WindowsClient.remove_staged(plan)
		_fail("update.err_trust")
		return
	_windows_plan = plan
	_windows_verified = verified
	_windows_instance = WindowsClient.request_token("instance")
	if not await _verify_with_windows_helper():
		WindowsClient.remove_staged(plan)
		_windows_plan = {}
		_windows_verified = {}
		_fail("update.err_helper")
		return
	var old_pending := [pending_nonce, pending_version]
	pending_nonce = transaction_nonce
	pending_version = latest_version
	if not _save_cfg():
		pending_nonce = str(old_pending[0])
		pending_version = str(old_pending[1])
		WindowsClient.remove_staged(plan)
		_fail("update.err_helper")
		return
	_set_phase(PHASE_READY)


func _download_exact(url: String, destination: String, max_bytes: int,
		expected_bytes := 0) -> bool:
	if url.is_empty() or destination.is_empty() or max_bytes <= 0 \
			or expected_bytes < 0 or expected_bytes > max_bytes:
		return false
	DirAccess.remove_absolute(destination)
	var request := HTTPRequest.new()
	request.timeout = 0.0
	request.use_threads = true
	# Interrompe il trasferimento durante la ricezione: il controllo a valle non
	# basta, perche un peer ostile potrebbe altrimenti riempire disco/memoria
	# prima che firma e size autenticata vengano esaminate.
	request.body_size_limit = max_bytes
	request.download_file = destination
	add_child(request)
	var start := request.request(url, _headers())
	if start != OK:
		request.queue_free()
		return false
	var response: Array = await request.request_completed
	request.queue_free()
	var actual_size := -1
	if FileAccess.file_exists(destination):
		var file := FileAccess.open(destination, FileAccess.READ)
		if file != null:
			actual_size = file.get_length()
			file.close()
	var ok := int(response[0]) == HTTPRequest.RESULT_SUCCESS \
			and int(response[1]) == 200 \
			and WindowsClient.download_size_valid(
					actual_size, max_bytes, expected_bytes)
	if not ok:
		DirAccess.remove_absolute(destination)
	return ok


func _helper_expected(request_id: String) -> Dictionary:
	var executable := str(_windows_plan.get("target", "")).replace("\\", "/").to_lower()
	return {
		"nonce": str(_windows_plan.get("nonce", "")),
		"request_id": request_id,
		"instance_id": _windows_instance,
		"old_pid": OS.get_process_id(),
		"old_exe_path": executable,
		"handoff_exe_path": executable,
		"manifest_sha256": str(_windows_verified.get("manifest_sha256", "")),
		"candidate_sha256": str(_windows_verified.get("artifacts", {}) \
				.get(WindowsVerifier.ROLE_DESKTOP, {}).get("sha256", "")),
	}


func _verify_with_windows_helper() -> bool:
	if WindowsClient.installed_authority(
			_windows_plan, current_version()).is_empty():
		return false
	var request_id := WindowsClient.request_token("verify")
	var expected := _helper_expected(request_id)
	var argv := WindowsClient.helper_argv("Verify", _windows_plan,
			OS.get_process_id(), request_id, _windows_instance)
	if argv.is_empty():
		return false
	DirAccess.remove_absolute(str(_windows_plan["ready"]))
	DirAccess.remove_absolute(str(_windows_plan["result"]))
	# Riattesta immediatamente prima di -File: la verifica iniziale decide il
	# piano, questa seconda chiude il seam hash→launch sul helper installato.
	if WindowsClient.installed_authority(
			_windows_plan, current_version()).is_empty():
		return false
	var pid := OS.create_process(WindowsClient.powershell_path(), argv, false)
	if pid <= 0:
		return false
	var deadline := Time.get_ticks_msec() + 30000
	while Time.get_ticks_msec() < deadline:
		await get_tree().create_timer(0.1).timeout
		var ready := WindowsClient.read_json(str(_windows_plan["ready"]))
		var result := WindowsClient.read_json(str(_windows_plan["result"]))
		if not result.is_empty():
			return WindowsProtocol.ready_frame_matches(ready, expected) \
					and WindowsProtocol.result_frame_matches(result,
							str(_windows_plan["nonce"])) \
					and bool(result.get("ok", false)) \
					and str(result.get("code", "")) == "verified"
	return false


func _watch_progress() -> void:
	while phase == PHASE_DOWNLOADING and is_instance_valid(_download):
		await get_tree().create_timer(0.5).timeout
		if phase != PHASE_DOWNLOADING or not is_instance_valid(_download):
			return
		var total := _download.get_body_size()
		if total <= 0:
			continue
		var pct := int(clampf(float(_download.get_downloaded_bytes()) / float(total)
				* 100.0, 0.0, 100.0))
		if pct != progress:
			progress = pct
			state_changed.emit(state())


func _on_downloaded(result: int, code: int, _headers: PackedStringArray,
		_body: PackedByteArray) -> void:
	if result != HTTPRequest.RESULT_SUCCESS or code != 200:
		Log.warn("update", "scaricamento fallito (esito %d, codice %d)" % [result, code])
		_fail("update.err_download")
		return
	_set_phase(PHASE_INSTALLING)
	# Verifica e sostituzione bloccano per decine di secondi (ditto, codesign,
	# spctl, la prova di avvio): su un thread, così la finestra resta viva.
	_thread = Thread.new()
	_thread.start(_install_worker)


func _install_worker() -> void:
	var outcome := MacUpdater.install(
			ProjectSettings.globalize_path(_zip_path), install_target())
	call_deferred("_on_installed", outcome)


func _on_installed(outcome: Dictionary) -> void:
	_join_thread()
	# Il diario del thread arriva qui: MacUpdater non parla col log da solo
	# (vedi `MacUpdater.notes`), e senza queste righe una sostituzione andata
	# storta non lascerebbe traccia in una segnalazione.
	for line in MacUpdater.notes:
		Log.info("update", line)
	# L'archivio non serve più, in nessuno dei due esiti: sono centinaia di
	# megabyte nei dati dell'applicazione.
	DirAccess.remove_absolute(ProjectSettings.globalize_path(_zip_path))
	if not bool(outcome.get("ok", false)):
		_fail(str(outcome.get("error", "update.err_swap")))
		return
	_set_phase(PHASE_DONE)


## Riavvio chiesto dall'utente: parte l'istanza nuova, poi si chiude questa dalla
## porta normale — quella che chiede anche cosa fare del team.
func restart() -> void:
	if OS.get_name() == "Windows" and phase == PHASE_READY:
		Game.quit_game(_commit_windows_exit, _cancel_windows_exit)
		return
	var bundle := str(install_target().get("bundle", ""))
	if bundle == "":
		return
	var relaunch := func() -> bool:
		MacUpdater.relaunch(bundle)
		return true
	Game.quit_game(relaunch, Callable())


func _commit_windows_exit() -> bool:
	if _windows_plan.is_empty() or _windows_verified.is_empty() \
			or not WindowsClient.verify_staged(_windows_plan, _windows_verified) \
			or WindowsClient.installed_authority(
					_windows_plan, current_version()).is_empty():
		_fail("update.err_trust")
		return false
	_set_phase(PHASE_EXIT_PREPARING)
	var request_id := WindowsClient.request_token("apply")
	var expected := _helper_expected(request_id)
	var argv := WindowsClient.helper_argv("Apply", _windows_plan,
			OS.get_process_id(), request_id, _windows_instance)
	if argv.is_empty():
		_fail("update.err_helper")
		return false
	DirAccess.remove_absolute(str(_windows_plan["ready"]))
	DirAccess.remove_absolute(str(_windows_plan["result"]))
	if WindowsClient.installed_authority(
			_windows_plan, current_version()).is_empty():
		_fail("update.err_trust")
		return false
	if OS.create_process(WindowsClient.powershell_path(), argv, false) <= 0:
		_fail("update.err_helper")
		return false
	var deadline := Time.get_ticks_msec() + 30000
	while Time.get_ticks_msec() < deadline:
		await get_tree().create_timer(0.1).timeout
		var ready := WindowsClient.read_json(str(_windows_plan["ready"]))
		if WindowsProtocol.ready_frame_matches(ready, expected):
			return true
	_fail("update.err_helper")
	return false


func _cancel_windows_exit() -> void:
	if not _windows_plan.is_empty():
		_set_phase(PHASE_READY)


## Il journal e il floor restano del helper. Al boot il gioco consuma soltanto
## result exact, oppure ricostruisce READY riverificando firma e byte staged.
func _resume_windows_pending() -> void:
	if OS.get_name() != "Windows" or not WindowsProtocol.valid_nonce(pending_nonce) \
			or UpdateCheck.parse_version(pending_version).is_empty():
		return
	var plan := WindowsClient.plan(OS.get_executable_path(), pending_nonce)
	if plan.is_empty():
		return
	var result := WindowsClient.read_json(str(plan["result"]))
	if _consume_windows_result(result):
		return
	var journal_exists := FileAccess.file_exists(str(plan["journal"]))
	var helper_owns_handoff := OS.get_environment(
			"JHT_UPDATE_HANDOFF_PATH").strip_edges() != ""
	if helper_owns_handoff and journal_exists:
		# Un target avviato sospeso dal helper non deve gareggiare con il helper
		# che lo possiede ancora: prima consuma il result della stessa transazione.
		for _attempt in 175:
			await get_tree().create_timer(0.2).timeout
			result = WindowsClient.read_json(str(plan["result"]))
			if _consume_windows_result(result):
				return
	if current_version() == pending_version and journal_exists:
		# Il nuovo processo ha gia scritto health; il helper sta completando il
		# commit. Attendi la sua finestra, poi entra esplicitamente in Recover:
		# dopo un power loss il result puo non arrivare mai da solo.
		if not helper_owns_handoff:
			for _attempt in 175:
				await get_tree().create_timer(0.2).timeout
				result = WindowsClient.read_json(str(plan["result"]))
				if _consume_windows_result(result):
					return
		await _recover_windows(plan)
		return
	if WindowsClient.pending_boot_requires_recovery(current_version(),
			pending_version, journal_exists, result, pending_nonce):
		await _recover_windows(plan)
		return
	if current_version() == pending_version:
		_fail("update.err_health")
		return
	var raw_manifest := FileAccess.get_file_as_bytes(str(plan["candidate_manifest"]))
	var raw_signature := FileAccess.get_file_as_bytes(str(plan["candidate_signature"]))
	var verified := WindowsVerifier.verify_production(raw_manifest, raw_signature,
			WindowsClient.manifest_context(current_version(),
					highest_committed_version, highest_committed_sequence))
	if bool(verified.get("ok", false)) and str(verified.get("version", "")) == pending_version \
			and WindowsClient.verify_staged(plan, verified):
		latest_version = pending_version
		_windows_plan = plan
		_windows_verified = verified
		_windows_instance = WindowsClient.request_token("instance")
		_set_phase(PHASE_READY)
	elif journal_exists:
		await _recover_windows(plan)
	else:
		_fail("update.err_recovery")


func _recover_windows(plan: Dictionary) -> void:
	var candidate := WindowsClient.recovery_candidate_authority(plan, pending_version)
	if candidate.is_empty() \
			or not WindowsClient.recovery_authority_ready(plan, pending_version):
		_fail("update.err_recovery")
		return
	var request_id := WindowsClient.request_token("recover")
	var instance_id := WindowsClient.request_token("instance")
	_windows_plan = plan
	_windows_verified = candidate
	_windows_instance = instance_id
	var expected := _helper_expected(request_id)
	var argv := WindowsClient.helper_argv("Recover", plan, OS.get_process_id(),
			request_id, instance_id)
	# A prior Verify/Apply frame is not evidence about this Recover invocation.
	# Remove it before launch so an early non-zero helper exit cannot be consumed
	# as stale READY while the new authoritative result is still absent.
	var stale_result := str(plan["result"])
	DirAccess.remove_absolute(str(plan["ready"]))
	DirAccess.remove_absolute(stale_result)
	if FileAccess.file_exists(stale_result) \
			or DirAccess.dir_exists_absolute(stale_result):
		_fail("update.err_recovery")
		return
	if argv.is_empty() or not WindowsClient.recovery_authority_ready(
			plan, pending_version) or OS.create_process(
			WindowsClient.powershell_path(), argv, false) <= 0:
		_fail("update.err_recovery")
		return
	var deadline := Time.get_ticks_msec() + 45000
	while Time.get_ticks_msec() < deadline:
		await get_tree().create_timer(0.2).timeout
		var ready := WindowsClient.read_json(str(plan["ready"]))
		if WindowsProtocol.ready_frame_matches(ready, expected):
			# Il helper possiede ora PID+creation del caller e aspetta che questa
			# istanza esca. Il team resta vivo; il target recovery diventa l'unico
			# client soltanto dopo il teardown volontario di questo processo.
			Game.detach_from_cli()
			return
		var result := WindowsClient.read_json(str(plan["result"]))
		if _consume_windows_result(result):
			return
	_fail("update.err_recovery")


func _consume_windows_result(result: Dictionary) -> bool:
	if not WindowsProtocol.result_frame_matches(result, pending_nonce):
		return false
	var result_phase := str(result.get("phase", ""))
	if bool(result.get("ok", false)) and result_phase == "committed" \
			and current_version() == pending_version:
		highest_committed_version = current_version()
		highest_committed_sequence = WindowsVerifier.version_sequence(current_version())
		if not _clear_pending():
			_fail("update.err_recovery")
			return true
		_set_phase(PHASE_CURRENT)
		return true
	if result_phase in ["rollback", "recovered"]:
		rolled_back = bool(result.get("rolled_back", false)) or result_phase == "rollback"
		if not _clear_pending():
			_fail("update.err_recovery")
			return true
		_set_phase(PHASE_RECOVERED)
		return true
	if result_phase == "failed":
		_fail("update.err_recovery")
		return true
	return false


func _clear_pending() -> bool:
	var old_nonce := pending_nonce
	var old_version := pending_version
	pending_nonce = ""
	pending_version = ""
	if not _save_cfg():
		Log.warn("update", "impossibile chiudere lo stato pending")
		pending_nonce = old_nonce
		pending_version = old_version
		return false
	_windows_plan = {}
	_windows_verified = {}
	_windows_instance = ""
	return true


# ── L'interruttore ───────────────────────────────────────────────────

## Acceso di default, spegnibile in Impostazioni → Avanzate. `JHT_UPDATE_CHECK=0`
## lo spegne dall'esterno e vince su tutto: è la leva per chi distribuisce il
## gioco in un contesto in cui non deve andare in rete, e per i banchi di prova.
func enabled() -> bool:
	var cfg := ConfigFile.new()
	if cfg.load(UpdateCheck.CONFIG_PATH) != OK:
		return true
	return bool(cfg.get_value("update", "enabled", true))


func set_enabled(on: bool) -> void:
	var cfg := ConfigFile.new()
	cfg.load(UpdateCheck.CONFIG_PATH)
	cfg.set_value("update", "enabled", on)
	cfg.save(UpdateCheck.CONFIG_PATH)
	Log.info("update", "controllo automatico %s" % ("acceso" if on else "spento"))
	if not on and phase in [PHASE_AVAILABLE, PHASE_CURRENT, PHASE_FAILED]:
		_set_phase(PHASE_IDLE)
	else:
		state_changed.emit(state())


func current_version() -> String:
	return str(ProjectSettings.get_setting("application/config/version", "dev"))


func state() -> Dictionary:
	var deferred := UpdateCheck.defer_active(latest_version, deferred_version,
			defer_until, Time.get_unix_time_from_system())
	return {
		"phase": phase,
		"latest": latest_version,
		"current": current_version(),
		"page": release_page,
		"error": error_key,
		"progress": progress,
		"can_install": phase == PHASE_AVAILABLE and can_install(),
		"can_restart": phase == PHASE_READY,
		"deferred": deferred,
		"deferred_version": deferred_version,
		"defer_until": defer_until,
		"last_check": last_check,
		"rolled_back": rolled_back,
	}


func _headers() -> PackedStringArray:
	return PackedStringArray([
		"Accept: application/vnd.github+json",
		"X-GitHub-Api-Version: 2022-11-28",
		"User-Agent: jht-desktop/%s" % current_version(),
	])


func _set_phase(next: String) -> void:
	phase = next
	if next != PHASE_FAILED:
		error_key = ""
	state_changed.emit(state())


func _fail(key: String) -> void:
	error_key = key
	phase = PHASE_FAILED
	state_changed.emit(state())


func _save_cfg() -> bool:
	var cfg := ConfigFile.new()
	cfg.load(UpdateCheck.CONFIG_PATH)
	cfg.set_value("update", "last_check", last_check)
	cfg.set_value("update", "deferred_version", deferred_version)
	cfg.set_value("update", "defer_until", defer_until)
	cfg.set_value("update", "highest_committed_version", highest_committed_version)
	cfg.set_value("update", "highest_committed_sequence", highest_committed_sequence)
	cfg.set_value("update", "pending_nonce", pending_nonce)
	cfg.set_value("update", "pending_version", pending_version)
	var temporary := UpdateCheck.CONFIG_PATH + ".tmp"
	var error := cfg.save(temporary)
	if error != OK:
		Log.warn("update", "stato aggiornamenti non salvato: errore %d" % error)
		return false
	var absolute := ProjectSettings.globalize_path(UpdateCheck.CONFIG_PATH)
	var temp_absolute := ProjectSettings.globalize_path(temporary)
	var backup := absolute + ".bak"
	DirAccess.remove_absolute(backup)
	if FileAccess.file_exists(absolute) \
			and DirAccess.rename_absolute(absolute, backup) != OK:
		DirAccess.remove_absolute(temp_absolute)
		return false
	if DirAccess.rename_absolute(temp_absolute, absolute) != OK:
		if FileAccess.file_exists(backup):
			DirAccess.rename_absolute(backup, absolute)
		return false
	DirAccess.remove_absolute(backup)
	return true


## ACK di salute del processo NUOVO. Se uno dei due env di protocollo è
## presente, il bootstrap diventa obbligatorio: nessun errore può degradare a
## un avvio ordinario senza ACK. I codici sono deliberatamente path-free; il
## helper conserva l'autorità su percorso, owner, DACL, hash e process handle.
func _write_windows_health_ack() -> String:
	var raw_nonce := OS.get_environment("JHT_UPDATE_NONCE")
	var raw_path := OS.get_environment("JHT_UPDATE_HEALTH_PATH")
	if raw_nonce == "" or raw_path == "":
		return HEALTH_ACK_ENV_PARTIAL
	var nonce := raw_nonce.strip_edges()
	if nonce != raw_nonce or not WindowsProtocol.valid_nonce(nonce):
		return HEALTH_ACK_NONCE_INVALID
	var path := WindowsProtocol.health_capability_path(raw_path, nonce)
	if path == "":
		return HEALTH_ACK_PATH_INVALID
	if not DirAccess.dir_exists_absolute(path.get_base_dir()) \
			or not FileAccess.file_exists(path):
		return HEALTH_ACK_CAPABILITY_ABSENT

	# Il helper crea il candidato sospeso, annota PID/start-time nel proprio
	# journal protetto e soltanto dopo lo fa partire. Il processo nuovo non
	# inventa quel token dall'orologio: lo riecheggia; il helper lo confronta
	# comunque con la process handle e col path/hash misurati in proprio.
	var journal_path := path.get_base_dir().path_join("journal.json")
	if not FileAccess.file_exists(journal_path):
		return HEALTH_ACK_JOURNAL_ABSENT
	var journal_file := FileAccess.open(journal_path, FileAccess.READ)
	if journal_file == null:
		return HEALTH_ACK_JOURNAL_OPEN_FAILED
	var journal_text := journal_file.get_as_text()
	var journal_error := journal_file.get_error()
	journal_file.close()
	if journal_error != OK:
		return HEALTH_ACK_JOURNAL_READ_FAILED
	var journal_value: Variant = JSON.parse_string(journal_text)
	if not (journal_value is Dictionary):
		return HEALTH_ACK_JOURNAL_INVALID
	var journal: Dictionary = journal_value
	var candidate_pid_value: Variant = journal.get("candidate_pid")
	if typeof(candidate_pid_value) not in [TYPE_INT, TYPE_FLOAT]:
		return HEALTH_ACK_PROCESS_INVALID
	var candidate_pid := int(candidate_pid_value)
	if float(candidate_pid_value) != float(candidate_pid) \
			or candidate_pid != OS.get_process_id():
		return HEALTH_ACK_PROCESS_INVALID

	await get_tree().process_frame
	await get_tree().process_frame
	var executable := OS.get_executable_path()
	var digest := FileAccess.get_sha256(executable)
	var started := str(journal.get("candidate_started", ""))
	var frame := WindowsProtocol.health_frame(nonce, current_version(), executable,
			digest, candidate_pid, started)
	if frame.is_empty():
		return HEALTH_ACK_FRAME_INVALID
	_windows_health_started = started
	# Il helper precrea la capability con owner/DACL e identità già attestati.
	# Scrivere in-place preserva quell'identità; il processo candidato non può
	# sostituire il nodo privilegiato con un file materializzato dal checkout.
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		return HEALTH_ACK_CAPABILITY_OPEN_FAILED
	if not file.store_string(JSON.stringify(frame) + "\n"):
		file.close()
		return HEALTH_ACK_CAPABILITY_WRITE_FAILED
	file.flush()
	var flush_error := file.get_error()
	file.close()
	if flush_error != OK:
		return HEALTH_ACK_CAPABILITY_FLUSH_FAILED
	return HEALTH_ACK_WRITTEN


func _join_thread() -> void:
	if _thread != null and _thread.is_started():
		_thread.wait_to_finish()
	_thread = null


## Il thread va joinato prima che l'engine smonti gli autoload: lasciarlo vivo
## produce segfault in chiusura (stessa lezione del thread delle sonde di
## FeedbackService, e di quello SSH del backend il 12/07).
func _exit_tree() -> void:
	_join_thread()
