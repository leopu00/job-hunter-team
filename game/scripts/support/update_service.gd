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
##    `mac_updater.gd`). Windows e Linux non sono firmati: lì l'aggiornamento
##    apre la pagina della release e si ferma.
## 2. NESSUNA RETE SE NON SERVE. Spento dall'utente, spento dall'ambiente, senza
##    finestra, in vetrina, o già controllato oggi: non parte nessuna richiesta.
##    Offline non è un errore da mostrare — è un giorno in cui non si controlla.
## 3. L'UTENTE DECIDE. Non si scarica niente prima che abbia detto di sì, e
##    niente si riavvia sotto le sue mani.

## L'unico segnale: la fascia e la pagina Impostazioni ridisegnano da qui.
signal state_changed(state: Dictionary)

const PHASE_IDLE := "idle"
const PHASE_CHECKING := "checking"
## C'è una versione più recente e l'utente non ha ancora deciso niente.
const PHASE_AVAILABLE := "available"
const PHASE_DOWNLOADING := "downloading"
## Verifica della firma e sostituzione: un solo passo per chi guarda, perché
## fra la verifica e la sostituzione non c'è niente che l'utente possa fare.
const PHASE_INSTALLING := "installing"
const PHASE_DONE := "done"
const PHASE_FAILED := "failed"
## Controllato: sei già all'ultima versione. Serve alla pagina Impostazioni, che
## a un "controlla adesso" deve rispondere qualcosa; la fascia resta invisibile.
const PHASE_CURRENT := "current"

const DOWNLOAD_DIR := "user://updates"

var phase := PHASE_IDLE
var latest_version := ""
var release_page := UpdateCheck.RELEASES_PAGE
var asset_url := ""
## Chiave UI dell'ultimo fallimento (vedi le costanti ERR_* di MacUpdater).
var error_key := ""
var progress := 0
## Epoch dell'ultimo controllo ANDATO A BUON FINE. Un tentativo fallito non si
## annota: chi era offline all'avvio riprova al lancio successivo invece di
## restare al buio per ventiquattro ore.
var last_check := 0.0

var _http: HTTPRequest
var _download: HTTPRequest
var _thread: Thread
var _zip_path := ""
## {"bundle":…, "anchor":…} della copia in esecuzione, calcolato una volta sola:
## costa due `codesign` e una prova di scrittura.
var _target := {}
var _target_ready := false


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	var cfg := ConfigFile.new()
	if cfg.load(UpdateCheck.CONFIG_PATH) == OK:
		last_check = float(cfg.get_value("update", "last_check", 0.0))
	# Mai direttamente da _ready: qui l'albero non è ancora completo, e questo
	# autoload interroga il DisplayServer e apre una connessione di rete.
	_boot.call_deferred()


func _boot() -> void:
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
	if phase in [PHASE_CHECKING, PHASE_DOWNLOADING, PHASE_INSTALLING]:
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
	_set_phase(PHASE_CHECKING)
	var err := _http.request(UpdateCheck.API_LATEST, _headers())
	if err != OK:
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
	_save_cfg()
	release_page = str(info["page"])
	if not UpdateCheck.is_newer(str(info["version"]), current_version()):
		latest_version = current_version()
		Log.info("update", "nessun aggiornamento: %s è l'ultima" % current_version())
		_set_phase(PHASE_CURRENT)
		return
	latest_version = str(info["version"])
	asset_url = UpdateCheck.asset_url(info["assets"], OS.get_name())
	Log.info("update", "disponibile la %s (in uso la %s)"
			% [latest_version, current_version()])
	_set_phase(PHASE_AVAILABLE)


# ── Cosa succede quando l'utente accetta ─────────────────────────────

## Su macOS si scarica e si installa davvero; altrove si apre la pagina, perché
## quei binari non sono firmati e non esiste modo onesto di dimostrare che ciò
## che si è scaricato sia nostro.
func can_install() -> bool:
	return asset_url != "" and not install_target().is_empty()


func install_target() -> Dictionary:
	if not _target_ready:
		_target_ready = true
		_target = MacUpdater.installable_bundle()
	return _target


func open_release_page() -> void:
	OS.shell_open(release_page if release_page != "" else UpdateCheck.RELEASES_PAGE)


func install() -> void:
	if phase == PHASE_DOWNLOADING or phase == PHASE_INSTALLING:
		return
	if not can_install():
		open_release_page()
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
	var bundle := str(install_target().get("bundle", ""))
	if bundle != "":
		MacUpdater.relaunch(bundle)
	Game.quit_game()


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
	return {
		"phase": phase,
		"latest": latest_version,
		"current": current_version(),
		"page": release_page,
		"error": error_key,
		"progress": progress,
		"can_install": phase == PHASE_AVAILABLE and can_install(),
		"last_check": last_check,
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


func _save_cfg() -> void:
	var cfg := ConfigFile.new()
	cfg.load(UpdateCheck.CONFIG_PATH)
	cfg.set_value("update", "last_check", last_check)
	cfg.save(UpdateCheck.CONFIG_PATH)


func _join_thread() -> void:
	if _thread != null and _thread.is_started():
		_thread.wait_to_finish()
	_thread = null


## Il thread va joinato prima che l'engine smonti gli autoload: lasciarlo vivo
## produce segfault in chiusura (stessa lezione del thread delle sonde di
## FeedbackService, e di quello SSH del backend il 12/07).
func _exit_tree() -> void:
	_join_thread()
