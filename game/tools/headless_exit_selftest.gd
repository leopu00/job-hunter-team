extends SceneTree
## Self-test headless della terza via all'uscita: "esci dalla finestra, il team
## continua". Esecuzione:
##   godot --headless --path game --script res://tools/headless_exit_selftest.gd
##
## Quattro contratti, e nessuno dei quattro si vede aprendo il gioco:
##
##  1. QUALE uscita ferma il team. È una riga sola, e sbagliarla non rompe
##     niente a schermo: il gioco si chiude uguale. L'utente lo scopre la
##     mattina dopo, dal lavoro non fatto — o dalla bolletta, se succede il
##     contrario e il container resta acceso quando non doveva.
##  2. Che le vie offerte restino TRE. Una scelta che sparisce dal dialogo non
##     lascia traccia da nessuna parte: si torna ai due soli modi di uscire di
##     prima, che spengono entrambi, e nessun test se ne accorge.
##  3. COSA si dice al ritorno. Il saluto "hanno lavorato senza di te" deve
##     comparire solo quando è vero: senza marcatore, con l'ufficio vuoto o con
##     un marcatore fossile è una bugia, e una bugia sullo schermo costa la
##     fiducia in tutto il resto.
##  4. Che l'uscita continui ad ASPETTARE il thread di spegnimento. Il 26/07
##     sul ThinkPad distruggere l'albero mentre il thread era dentro
##     `docker stop` faceva abortire il processo (SIGABRT, "corrupted size vs.
##     prev_size"): il team si fermava bene e il gioco moriva male. Il rimedio
##     è una riga in game.gd, e una riga si cancella senza accorgersene.
##
## Due regole di stanza, la prima presa dal vicino (idle_pace_selftest, rosso
## solo-Windows con lo stesso codice 0xC0000005), la seconda pagata da questo
## file con un rosso tutto suo (run 30381042447, Windows x64):
##
##  - si parte da `call_deferred`, mai da `_init`: dentro `_init` il main loop
##    non è ancora inizializzato, e quanto sia venuto su cambia da piattaforma
##    a piattaforma;
##  - non si tocca MAI la lingua globale per leggere una traduzione. Vedi
##    `_check_greeting_formats`: costava l'intero processo.

const GAME_GD := "res://scripts/game.gd"
const DIALOG_GD := "res://scripts/ui/shutdown_dialog.gd"
const SETUP_GD := "res://scripts/setup/setup_service.gd"
## L'attesa del thread: senza questa chiamata torna l'abort del 26/07.
const AWAIT_CALL := "WorkerThreadPool.wait_for_task_completion(_shutdown_task)"

const ORA := 1785000000.0

var _fails: Array[String] = []


func _init() -> void:
	call_deferred("_run")


func _run() -> void:
	# Il testo dipende dalla lingua: si fissa l'italiano, altrimenti il test
	# passa o fallisce a seconda di come ha lasciato lang.cfg chi ha giocato.
	# È l'UNICA scrittura su `lang`, e vale "it": il ramo italiano di t() legge
	# la costante S e si ferma lì, senza svegliare la cache dei dizionari.
	UIStrings.lang = "it"
	_check_modes()
	_check_dialog_offers_three_ways()
	_check_greeting()
	_check_duration()
	_check_greeting_formats()
	_check_shutdown_still_awaited()
	_check_shutdown_is_bounded()

	if _fails.is_empty():
		print("HEADLESS-EXIT-TEST PASS")
		quit(0)
		return
	for fail in _fails:
		push_error("[headless-exit] " + fail)
	print("HEADLESS-EXIT-TEST FAIL (%d problemi)" % _fails.size())
	quit(1)


func _check(name: String, condition: bool, detail: String = "") -> void:
	if not condition:
		_fails.append("%s — %s" % [name, detail])


## Il bivio dell'uscita, modo per modo. `detach` è l'unico che NON deve
## spegnere niente; `cancel` non esce affatto e non ferma nessuno.
func _check_modes() -> void:
	var attesi := {
		HeadlessSession.MODE_GRACEFUL: true,
		HeadlessSession.MODE_FORCED: true,
		HeadlessSession.MODE_DETACH: false,
		HeadlessSession.MODE_CANCEL: false,
	}
	for mode: String in attesi:
		_check("modo %s" % mode,
				HeadlessSession.stops_team(mode) == bool(attesi[mode]),
				"stops_team=%s, atteso %s"
				% [HeadlessSession.stops_team(mode), attesi[mode]])
	# I tre modi di uscita sono distinti: due nomi uguali farebbero collassare
	# due scelte diverse sullo stesso comportamento.
	var nomi := [HeadlessSession.MODE_GRACEFUL, HeadlessSession.MODE_DETACH,
			HeadlessSession.MODE_FORCED, HeadlessSession.MODE_CANCEL]
	var visti := {}
	for n: String in nomi:
		visti[n] = true
	_check("modi distinti", visti.size() == nomi.size(),
			"due modi condividono lo stesso nome: %s" % [nomi])


## Il dialogo offre TUTTE E TRE le vie, più l'annulla. Una scelta che non
## compare non esiste: senza questo controllo il gioco resterebbe verde e
## l'utente si ritroverebbe davanti ai due soli modi di uscire di prima,
## entrambi che spengono.
##
## Il controllo è sul sorgente e non sul nodo costruito: shutdown_dialog.gd usa
## gli autoload (Sfx, SetupService), che sotto `godot --script` non esistono —
## istanziarlo qui non compilerebbe nemmeno. Che le chiavi citate esistano
## davvero lo garantisce il test di parità i18n, che le cerca nei sorgenti.
func _check_dialog_offers_three_ways() -> void:
	var src := FileAccess.get_file_as_string(DIALOG_GD)
	_check("shutdown_dialog.gd leggibile", src != "",
			"file vuoto o assente: " + DIALOG_GD)
	if src == "":
		return
	for key in ["shutdown.graceful", "shutdown.detach", "shutdown.forced",
			"shutdown.cancel"]:
		_check("il dialogo offre \"%s\"" % key, src.contains('"%s"' % key),
				"la voce non compare nel dialogo")
	for mode in [HeadlessSession.MODE_GRACEFUL, HeadlessSession.MODE_DETACH,
			HeadlessSession.MODE_FORCED, HeadlessSession.MODE_CANCEL]:
		_check("il dialogo può concludersi con %s" % mode,
				src.contains("MODE_" + mode.to_upper()),
				"nessun percorso emette questo modo")
	# Ogni via ha la sua riga di spiegazione, e sono tre righe DIVERSE:
	# copiarne una nell'altra fa sparire proprio la differenza che raccontano —
	# fra "chiudi in ordine" e "chiudi subito" la differenza è se gli agenti
	# fanno in tempo a salvare il punto in cui sono arrivati.
	var hints := {}
	for key in ["shutdown.graceful_hint", "shutdown.detach_hint",
			"shutdown.forced_hint"]:
		var hint := UIStrings.t(key)
		_check("la spiegazione %s ha un testo" % key,
				hint != key and hint.strip_edges() != "", "chiave senza testo")
		_check("la spiegazione %s è a schermo" % key, src.contains('"%s"' % key),
				"la stringa esiste ma il dialogo non la mostra")
		hints[hint] = true
	_check("le tre spiegazioni sono diverse fra loro", hints.size() == 3,
			"spiegazioni distinte trovate: %d" % hints.size())
	# Il budget che continua a scorrere è la ragione per cui uno sceglie di
	# fermare invece di staccare: deve essere detto nella riga della terza via,
	# non solo nel passo di conferma.
	_check("la terza via nomina il budget",
			UIStrings.t("shutdown.detach_hint").to_lower().contains("budget"),
			"shutdown.detach_hint non dice che la spesa continua")


func _check_greeting() -> void:
	var casi := [
		# [descrizione, marcatore, agenti vivi, adesso, atteso, secondi attesi]
		["uscito lasciandoli al lavoro, 7h fa, cinque in ufficio",
			ORA - 25200.0, 5, ORA, true, 25200],
		["mai staccato → niente da salutare",
			0.0, 5, ORA, false, 0],
		["staccato ma ufficio vuoto → il container e' stato fermato da fuori",
			ORA - 3600.0, 0, ORA, false, 0],
		["marcatore fossile (30 giorni) → tacere",
			ORA - 2592000.0, 4, ORA, false, 0],
		["orologio all'indietro → zero, non un numero negativo",
			ORA + 600.0, 4, ORA, true, 0],
		["appena al limite della settimana → si saluta ancora",
			ORA - float(HeadlessSession.MAX_AGE_S), 2, ORA, true,
			HeadlessSession.MAX_AGE_S],
	]
	for caso in casi:
		var stato := HeadlessSession.state_for(caso[1], caso[2], caso[3])
		if bool(stato["show"]) != bool(caso[4]):
			_fails.append("%s — show=%s invece di %s"
					% [caso[0], stato["show"], caso[4]])
		elif int(stato["seconds"]) != int(caso[5]):
			_fails.append("%s — %d secondi invece di %d"
					% [caso[0], stato["seconds"], caso[5]])


func _check_duration() -> void:
	var casi := [
		[0, "1 min"],        # meno di un minuto non e' "0 min"
		[30, "1 min"],
		[3540, "59 min"],
		[5400, "1h 30m"],
		[46800, "13h 0m"],
	]
	for caso in casi:
		var text := HeadlessSession.duration_text(int(caso[0]))
		_check("durata di %d s" % caso[0], text == str(caso[1]),
				"\"%s\" invece di \"%s\"" % [text, caso[1]])


## Il saluto si compone in tutte e sette le lingue senza saltare.
##
## È la riga che compare UNA volta sola, al rientro dopo una notte, e solo con
## un container vivo: nessun banco di prova headless la vede mai davvero. Se in
## una lingua il "%s" della durata diventasse un "%d", il gioco crollerebbe
## esattamente lì — nel momento in cui l'utente sta tornando a vedere se il
## team ha lavorato. Qui la si compone davvero, lingua per lingua.
##
## I dizionari si leggono dal loro file, come fa il test di parità, e finiscono
## in una variabile LOCALE. La prima versione girava invece la lingua globale
## (`UIStrings.lang = "de"`) e chiamava `t()`, che è l'unico modo di svegliare
## `UIStrings._translations()`: quella cache è una `static var` sullo script
## UIStrings, e ci parcheggia dentro i dizionari di sei ALTRI script, presi dal
## loro `get_script_constant_map()`. UIStrings sopravvive fino in fondo allo
## spegnimento del motore (le sue statiche lo trattengono: si vede col
## `--verbose`, "Resource still in use: res://scripts/ui_strings.gd"), i sei
## script prestatori no — e in quale ordine i due cadano non è la stessa cosa
## su ogni piattaforma. Su Windows finiva in ACCESS_VIOLATION dopo il PASS,
## unico test della suite a non arrivare al rapporto di chiusura del motore.
## Nessun altro self-test svegliava quella cache; nessuno la sveglierà più.
func _check_greeting_formats() -> void:
	var lingue := ["it"]
	for l in UIStrings.LANGS:
		if not lingue.has(l):
			lingue.append(l)
	for lang: String in lingue:
		var d := _dictionary_for(lang)
		if d.is_empty():
			_fails.append("dizionario %s illeggibile" % lang)
			continue
		if not d.has("headless.back") or not d.has("headless.dur_hour"):
			_fails.append("dizionario %s senza le chiavi del saluto" % lang)
			continue
		# Le stesse due composizioni che fa il gioco: prima la durata, poi la
		# riga che se la mangia dentro insieme al conteggio.
		var durata: String = str(d["headless.dur_hour"]) % [7, 30]
		var riga: String = str(d["headless.back"]) % [durata, 5]
		_check("saluto componibile in %s" % lang, riga.contains(durata),
				"la durata non compare in \"%s\"" % riga)
		_check("il conteggio compare in %s" % lang, riga.contains("5"),
				"quanti sono in ufficio non compare in \"%s\"" % riga)


## Il dizionario di una lingua, letto direttamente dal suo file e restituito a
## chi chiama: nessuna cache statica, nessuna lingua globale spostata. È il
## modo in cui i18n_parity_selftest legge gli stessi file, ed è verde su tutte
## e tre le piattaforme.
static func _dictionary_for(lang: String) -> Dictionary:
	if lang == "it":
		return UIStrings.S
	var path := "res://scripts/i18n/ui_%s.gd" % lang
	if not ResourceLoader.exists(path):
		return {}
	var script: GDScript = load(path)
	return script.get_script_constant_map().get("S", {})


## Contratto sul sorgente, non sul comportamento: il percorso di uscita chiama
## `quit()` e un test che lo esegue davvero si porta via il test stesso.
func _check_shutdown_still_awaited() -> void:
	var src := FileAccess.get_file_as_string(GAME_GD)
	_check("game.gd leggibile", src != "", "file vuoto o assente: " + GAME_GD)
	if src == "":
		return
	_check("il thread di spegnimento viene atteso", src.contains(AWAIT_CALL),
			"manca %s in game.gd: chiudere la finestra torna ad abortire il "
			% AWAIT_CALL + "processo se il thread e' dentro docker stop")
	# L'uscita staccata passa dallo STESSO _quit_now: se un domani nascesse una
	# seconda via d'uscita che chiama get_tree().quit() da sé, l'attesa non
	# varrebbe più per quella. Una sola quit() nel percorso di uscita.
	_check("una sola uscita dall'albero",
			src.count("get_tree().quit()") == 1,
			"in game.gd ci sono %d chiamate a get_tree().quit(): l'attesa del "
			% src.count("get_tree().quit()")
			+ "thread copre solo quella dentro _quit_now")
	# Che le altre due uscite fermino davvero agenti e container è già sotto
	# contratto altrove (il banco di prova dentro setup_service.gd controlla
	# `shutdown_commands`): qui basta sapere CHI le esegue.
	_check("lo spegnimento resta condizionato al modo scelto",
			src.contains("if stop_team and setup != null"),
			"in game.gd shutdown_team() non è più sotto stop_team: o si spegne "
			+ "sempre, o non si spegne mai")


## Il join del worker evita il crash, ma è sicuro soltanto se il worker ha un
## limite proprio. `OS.execute` non può essere cancellato: sul ThinkPad un
## client Docker bloccato ha superato anche la rete di sicurezza dei 20 s.
func _check_shutdown_is_bounded() -> void:
	var src := FileAccess.get_file_as_string(SETUP_GD)
	_check("setup_service.gd leggibile", src != "", "file vuoto o assente")
	if src == "":
		return
	var start := src.find("static func _run_shutdown_command")
	var end := src.find("func shutdown_team", start)
	var runner := src.substr(start, end - start) if start >= 0 and end > start else ""
	_check("runner di uscita dedicato", runner != "", "funzione assente")
	for seam in ["OS.create_process", "OS.is_process_running", "OS.kill(pid)",
			"SHUTDOWN_COMMAND_TIMEOUT_MS"]:
		_check("uscita interrompibile: " + seam, runner.contains(seam),
				"manca il seam nel runner")
	var shutdown_start := src.find("func shutdown_team")
	var vps_start := src.find("func _vps_config", shutdown_start)
	var shutdown := src.substr(shutdown_start, vps_start - shutdown_start) \
			if shutdown_start >= 0 and vps_start > shutdown_start else ""
	_check("shutdown non usa OS.execute", not shutdown.contains('_run("docker"'),
			"un comando di uscita può ancora bloccare il worker senza limite")
	_check("locale distinto dalla VPS",
			src.contains("BackendBus.is_remote() else {}"),
			"is_live() include anche LocalBackend e può saltare lo stop locale")
