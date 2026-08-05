extends Node
## Autoload `Game`: stato globale, profilo giocatore, cambio scena, pausa.

enum State { TITLE, WIZARD, OFFICE }

const SCENE_TITLE := "res://scenes/title.tscn"
const SCENE_WIZARD := "res://scenes/wizard.tscn"
const SCENE_OFFICE := "res://scenes/office.tscn"

## Flag locale "onboarding completato": deciso dal wizard quando il
## backend dichiara il profilo ready (o l'utente entra con profilo già
## completo). Solo UX di routing: la verità sul profilo resta nel
## candidate_profile.yml del backend.
const ONBOARDING_CFG := "user://onboarding.cfg"

var state: State = State.TITLE
## True mentre un dialogo a ritratti è aperto (blocca movimento e pausa-rapida).
var dialogue_active := false

var _pause_menu: Node = null

func _enter_tree() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	# Cap FPS a 60 + vsync. Con Vulkan il present in vsync (FIFO) è fluido e non
	# blocca il resto del desktop come faceva OpenGL; niente tearing.
	Engine.max_fps = 60
	DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_ENABLED)
	_register_inputs()
	# Geometria finestra applicata prima del primo frame: niente flash della
	# finestra 1920x1080 dichiarata in project.godot.
	# JHT_WINDOWED=1 avvia in finestra (comodo per test/screenshot).
	_apply_fullscreen(OS.get_environment("JHT_WINDOWED") != "1")
	# JHT_SHOT_QUIET=1 (shot di verifica, workflow Leone 18:3x): finestra
	# DISCRETA — mai il focus, parcheggiata nell'angolo in basso a destra.
	# Visibile quel minimo che serve a macOS per non congelare il present
	# (una finestra del tutto occlusa smette di renderizzare).
	if OS.get_environment("JHT_SHOT_QUIET") == "1":
		DisplayServer.window_set_flag(DisplayServer.WINDOW_FLAG_NO_FOCUS, true)
		var usable := DisplayServer.screen_get_usable_rect()
		var wsize := DisplayServer.window_get_size()
		DisplayServer.window_set_position(
				usable.position + usable.size - wsize - Vector2i(8, 8))

func _ready() -> void:
	RenderingServer.set_default_clear_color(Palette.VOID)
	load_gfx_profile()
	# Il costo a riposo: dopo load_gfx_profile, così il tetto fps che si
	# ripristina al ritorno del focus è già quello del profilo scelto.
	_idle_pace = IdlePace.new()
	add_child(_idle_pace)
	# Shot-quiet: la finestrella resta cliccabile anche senza focus — un
	# click VERO dell'utente al lavoro può aprire pannelli e falsare lo
	# shot (successo: pagina Mentor aperta da sola in uno sweep). Sordi
	# a mouse e tastiera per tutta la durata dello shot.
	if OS.get_environment("JHT_SHOT_QUIET") == "1":
		get_viewport().gui_disable_input = true
	# Il dialogo di uscita si apre solo su richiesta di chiusura e solo con
	# agenti vivi: senza questa scorciatoia non e' fotografabile, e le tre
	# scelte sono proprio la cosa da guardare a schermo (le didascalie vanno
	# a capo in modo diverso in ogni lingua). Roster finto: serve la forma,
	# non il contenuto.
	if OS.get_environment("JHT_EXIT_DIALOG") == "1":
		_open_shutdown_dialog_for_shot.call_deferred()
	# Scorciatoia per i test: JHT_SCENE=office|wizard salta il boot.
	if OS.get_environment("JHT_SCENE") == "office":
		goto_office.call_deferred()
	elif OS.get_environment("JHT_SCENE") == "wizard":
		goto_wizard.call_deferred()

## Il gioco che "si frizza" senza esserlo: il 25/07 girava a 34 fps e non
## rispondeva a mouse né tastiera. Un rendering vivo esclude il blocco del main
## thread e lascia il focus come sospettato — ma senza traccia nel log resta
## un'ipotesi. Da qui in avanti la perdita di focus si vede nel log.
func _notification(what: int) -> void:
	match what:
		NOTIFICATION_APPLICATION_FOCUS_OUT:
			Log.info("input", "finestra ha perso il focus")
		NOTIFICATION_APPLICATION_FOCUS_IN:
			Log.info("input", "finestra ha ripreso il focus")
		NOTIFICATION_WM_CLOSE_REQUEST:
			Log.info("input", "chiusura richiesta dal window manager")
			quit_game()


## Uscita SEMPRE da qui: chiudere la finestra decide anche cosa ne è del team.
## Gli agenti girano nel container, non nel gioco, e continuavano a lavorare —
## consumando token — con la finestra chiusa e nessun avviso (25/07). Da allora
## si chiede; dal 28/07 una delle risposte possibili è "lasciali lavorare".
var _quitting := false
var _quit_done := false
var _shutdown_task := -1

## Chiedere prima di interrompere: se ci sono agenti al lavoro l'utente decide
## se farli chiudere in ordine (il Capitano fa annotare a tutti dove erano
## arrivati) o troncare. Senza agenti attivi non c'è niente da chiedere.
var _shutdown_dialog: Node = null

## Apre il dialogo di uscita con un roster finto, per fotografarlo (JHT_EXIT_DIALOG=1).
## Non passa da quit_game(): li' un roster vuoto uscirebbe subito senza chiedere.
func _open_shutdown_dialog_for_shot() -> void:
	if _shutdown_dialog != null:
		return
	_shutdown_dialog = load("res://scripts/ui/shutdown_dialog.gd").new(
			["scout-1", "analista-1", "scorer-1", "capitano"])
	_shutdown_dialog.chosen.connect(_on_shutdown_choice)
	get_tree().root.add_child(_shutdown_dialog)


func quit_game() -> void:
	if _quitting or _shutdown_dialog != null:
		return
	var agents := SetupService.active_agents()
	if agents.is_empty():
		_do_quit()
		return
	close_pause()
	_shutdown_dialog = load("res://scripts/ui/shutdown_dialog.gd").new(agents)
	_shutdown_dialog.chosen.connect(_on_shutdown_choice)
	get_tree().root.add_child(_shutdown_dialog)


func _on_shutdown_choice(mode: String) -> void:
	if is_instance_valid(_shutdown_dialog):
		_shutdown_dialog.queue_free()
	_shutdown_dialog = null
	if mode == HeadlessSession.MODE_CANCEL:
		return
	# "graceful": il team si è già fermato da sé, resta da spegnere il container;
	# "forced": shutdown_team() ferma prima gli agenti e poi il container;
	# "detach": non si esegue NIENTE — la finestra se ne va e loro restano al
	# lavoro, come quando li avvia la CLI e il comando esce.
	HeadlessSession.record_exit(mode == HeadlessSession.MODE_DETACH)
	_do_quit(HeadlessSession.stops_team(mode))


func _do_quit(stop_team := true) -> void:
	if _quitting:
		return
	_quitting = true
	get_tree().paused = false
	_show_loading(UIStrings.t("pause.shutdown" if stop_team else "pause.detaching"))
	# Lo stop passa da docker e blocca per qualche secondo: in un thread, così
	# il velo arriva a schermo invece di congelarsi a metà.
	var task := func() -> void:
		var setup := get_node_or_null("/root/SetupService")
		if stop_team and setup != null and setup.has_method("shutdown_team"):
			setup.call("shutdown_team")
		call_deferred("_quit_now")
	_shutdown_task = WorkerThreadPool.add_task(task)
	# Rete di sicurezza: se docker non risponde non si resta in ostaggio del velo.
	await get_tree().create_timer(20.0).timeout
	_quit_now()


## Uscire NON è solo chiamare quit(): il thread di spegnimento può essere
## ancora dentro `docker stop`, e distruggergli l'albero sotto i piedi fa
## abortire il processo (SIGABRT "corrupted size vs. prev_size", ThinkPad
## 26/07 — il team si fermava correttamente, ma il gioco moriva male invece
## di chiudersi). Lo si aspetta sempre, anche quando è la rete di sicurezza
## dei 20 secondi a portarci qui.
func _quit_now() -> void:
	if _quit_done:
		return
	_quit_done = true
	if _shutdown_task != -1:
		WorkerThreadPool.wait_for_task_completion(_shutdown_task)
		_shutdown_task = -1
	if is_inside_tree():
		get_tree().quit()


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("quit_game"):
		Log.info("input", "uscita richiesta da tastiera")
		quit_game()
		return
	if event.is_action_pressed("fullscreen"):
		toggle_fullscreen()
		return
	if event.is_action_pressed("pause") and not dialogue_active:
		if get_tree().paused:
			close_pause()
		elif state != State.TITLE:
			open_pause()

# ── Calibrazione grafica automatica ──────────────────────────────────
## Dopo 5 secondi di ufficio si misura il framerate per 10 secondi: sotto
## soglia si passa al profilo ridotto. Il cap a 30fps da solo non serviva a
## nulla — chi sta a 20 non lo tocca mai: quello che conta è togliere lavoro
## al renderer. Su GL compatibility il costo sta nelle draw call, e la
## scenografia pura (spigoli del tesseract, ologramma, pile di fogli, ciclo
## giorno/notte, fumo della stampante) ne vale 85 su 822 — misurate con
## JHT_CENSUS prima e dopo. È un -10%, non la soluzione: il grosso resta nei
## mobili (308) e negli agenti (254). Ma è l'unico taglio che non tocca né il
## gioco né la leggibilità del testo (garantita da text_boost), e su hardware
## capace non cambia nulla. Il resto del guadagno arriva dalla scala del mondo
## (render_scale, sotto): meno pixel da riempire a parità di scena. Le due
## leve si applicano insieme e continuano ad adattarsi mentre si gioca.
const GFX_CONFIG := "user://graphics.cfg"

signal gfx_profile_changed(low: bool)

var low_gfx := false
var _gfx_time := 0.0
var _gfx_fps_sum := 0.0
var _gfx_samples := 0
var _gfx_done := false
## Scala del mondo attualmente imposta dalla calibrazione (1.0 = nativo).
var _applied_scale := 1.0
var _watch_time := 0.0
var _watch_fps_sum := 0.0
var _watch_samples := 0
## Ritmo di disegno a finestra non in primo piano (vedi scripts/idle_pace.gd).
var _idle_pace: IdlePace = null


## I profili offerti in Impostazioni → Grafica. "auto" non è in elenco: è
## l'assenza di scelta, cioè la calibrazione che decide e continua ad adattarsi.
## Le due leve viaggiano in coppia — quanti pixel disegnare e quanta
## scenografia — perché è la coppia a fare la differenza percepita.
const CHOICES := {
	"full": {"scale": 1.0, "luxury": true},
	"balanced": {"scale": 0.85, "luxury": true},
	"performance": {"scale": 0.6, "luxury": false},
}
const CHOICE_AUTO := "auto"

signal graphics_choice_changed(mode: String)

var _language_settings_test_started := false


## Scala a cui il mondo si sta disegnando in questo momento (1.0 = nativo). In
## automatico cambia mentre si gioca: il pannello Grafica la mostra perché è il
## dato che spiega cosa si vede a schermo.
func world_scale() -> float:
	return _applied_scale


## Profilo scelto dall'utente, o "auto" se non ha mai scelto. È l'unica cosa che
## COMANDA su calibrazione e sorveglianza: chi ha deciso non vuole ritrovarsi il
## gioco che gli cambia la grafica sotto le mani mezzo minuto dopo.
##
## Il valore è tenuto in memoria: lo chiede la sorveglianza a OGNI frame, e
## rileggere un file dal disco sessanta volte al secondo — in codice che esiste
## per far girare meglio il gioco — sarebbe una beffa. Il file cambia solo da
## set_graphics_choice, che aggiorna anche questa copia.
static var _choice_cache := ""

static func graphics_choice() -> String:
	if _choice_cache != "":
		return _choice_cache
	_choice_cache = CHOICE_AUTO
	var cfg := ConfigFile.new()
	if cfg.load(GFX_CONFIG) == OK:
		var mode := str(cfg.get_value("graphics", "mode", CHOICE_AUTO))
		if CHOICES.has(mode):
			_choice_cache = mode
	return _choice_cache


## Scala di rendering del MONDO: 1.0 = nativo, 0.75 = tre quarti di lato,
## 0.5 = metà (un quarto dei pixel). Il mondo finisce in un SubViewport
## ingrandito con filtro nearest, così la grana resta netta invece di
## sfocarsi. La UI non passa di qui e resta sempre a risoluzione piena; il testo
## dentro il mondo si ingrandisce per compensare (WorldText).
## Precedenza: JHT_PIXEL (test) → scelta dell'utente → ultima calibrazione.
static func render_scale() -> float:
	var forced := OS.get_environment("JHT_PIXEL").strip_edges()
	if forced.is_valid_float():
		return _as_scale(forced.to_float())
	var chosen := graphics_choice()
	if chosen != CHOICE_AUTO:
		return float(CHOICES[chosen]["scale"])
	var cfg := ConfigFile.new()
	if cfg.load(GFX_CONFIG) == OK:
		# In automatico la scala misurata l'ultima volta vale come punto di
		# partenza: senza memoria l'utente si rivede i 15 secondi di lag a ogni
		# avvio, esattamente come succedeva col profilo scenografia.
		var saved := float(cfg.get_value("graphics", "render_scale", 0.0))
		if saved > 0.0:
			return clampf(saved, 0.25, 1.0)
	return 1.0  # mai misurato: decide la calibrazione a runtime


## Accetta sia la scala (0.75) sia il vecchio divisore intero (2 → 0.5),
## così i comandi di test già in giro continuano a funzionare.
static func _as_scale(value: float) -> float:
	if value > 1.0:
		return clampf(1.0 / value, 0.25, 1.0)
	return clampf(value, 0.25, 1.0)


## Scala del mondo e profilo scenografia vivono nello STESSO file: si legge
## sempre prima di scrivere, altrimenti salvare una delle due cancella l'altra
## (e al riavvio si torna al profilo pieno senza motivo apparente).
static func set_render_scale(value: float) -> void:
	var cfg := ConfigFile.new()
	cfg.load(GFX_CONFIG)
	cfg.set_value("graphics", "render_scale", clampf(value, 0.25, 1.0))
	cfg.save(GFX_CONFIG)


## Il profilo scelto la prima volta vale anche ai riavvii successivi: senza
## memoria l'utente si rivedrebbe i primi 15 secondi di lag ogni volta.
func load_gfx_profile() -> void:
	# La scala di partenza è quella che la scena applicherà davvero (scelta
	# dell'utente, o l'ultima misurata): tenerne conto qui è ciò che permette
	# alla sorveglianza di sapere da dove si sta muovendo. Senza, si crede a
	# risoluzione piena e non restituisce mai definizione a chi ha cambiato
	# computer da quando quella misura è stata scritta.
	_applied_scale = render_scale()
	if OS.get_environment("JHT_LOW_GFX") == "1":  # TEST-AUTO
		set_low_gfx(true, false)
		_gfx_done = true
		return
	var chosen := graphics_choice()
	if chosen != CHOICE_AUTO:
		# Scelta esplicita: si applica e non si discute più (la calibrazione è
		# già disinnescata in _process; la scala l'ha già presa render_scale).
		set_low_gfx(not bool(CHOICES[chosen]["luxury"]), false)
		_gfx_done = true
		return
	var cfg := ConfigFile.new()
	if cfg.load(GFX_CONFIG) != OK:
		return
	if bool(cfg.get_value("graphics", "low", false)):
		set_low_gfx(true, false)
		_gfx_done = true  # già deciso: non rimisurare


## Impostazioni → Grafica: l'utente ha scelto. Si salva, si applica subito alla
## scena viva e — se ha scelto "auto" — si rimette in moto la calibrazione da
## zero, riportando intanto il gioco al profilo pieno: è il punto di partenza
## onesto per una nuova misura.
func set_graphics_choice(mode: String) -> void:
	var chosen := mode if CHOICES.has(mode) else CHOICE_AUTO
	_choice_cache = chosen
	var cfg := ConfigFile.new()
	cfg.load(GFX_CONFIG)  # scala e profilo scenografia stanno nello stesso file
	cfg.set_value("graphics", "mode", chosen)
	if chosen == CHOICE_AUTO:
		# Via anche le misure vecchie: restano di una macchina che magari non è
		# più questa (chi copia ~/.jht su un altro computer si porta dietro il
		# profilo, non la ragione per cui era stato scelto). Il controllo
		# `has_section_key` non è pignoleria: cancellare una chiave che non c'è
		# stampa un errore nel log e sporca le diagnostiche.
		for stale in ["render_scale", "low"]:
			if cfg.has_section_key("graphics", stale):
				cfg.erase_section_key("graphics", stale)
		cfg.save(GFX_CONFIG)
		set_low_gfx(false, false)
		_apply_world_scale(1.0)
		_gfx_time = 0.0
		_gfx_fps_sum = 0.0
		_gfx_samples = 0
		_gfx_done = false  # si rimisura, da adesso
		Log.info("perf", "profilo grafico: automatico, nuova calibrazione in corso")
	else:
		cfg.save(GFX_CONFIG)
		set_low_gfx(not bool(CHOICES[chosen]["luxury"]), false)
		_apply_world_scale(float(CHOICES[chosen]["scale"]))
		_gfx_done = true  # comanda la scelta: né calibrazione né sorveglianza
		Log.info("perf", "profilo grafico scelto: %s (mondo al %d%%)"
				% [chosen, int(float(CHOICES[chosen]["scale"]) * 100.0)])
	graphics_choice_changed.emit(chosen)


func set_low_gfx(low: bool, persist := true) -> void:
	if low_gfx == low:
		return
	low_gfx = low
	Engine.max_fps = 30 if low else 60
	apply_gfx_profile()
	gfx_profile_changed.emit(low)
	if persist:
		var cfg := ConfigFile.new()
		cfg.load(GFX_CONFIG)  # la scala del mondo sta nello stesso file
		cfg.set_value("graphics", "low", low)
		cfg.save(GFX_CONFIG)


## Applica il profilo alla scena viva. Va richiamata anche dopo un cambio
## scena: i nodi scenografici nuovi nascono visibili.
func apply_gfx_profile() -> void:
	var tree := get_tree()
	if tree == null:
		return
	for node in tree.get_nodes_in_group(GfxProfile.GROUP):
		var item := node as CanvasItem
		if item != null:
			item.visible = not low_gfx


func _process(delta: float) -> void:
	if state != State.OFFICE:
		return
	if DisplayServer.get_name() == "headless" \
			or OS.get_environment("JHT_SHOT") != "":
		_gfx_done = true
		return
	# A ritmo ridotto i fps non dicono più niente sulla macchina: sono quelli
	# che abbiamo imposto noi. Calibrazione e sorveglianza restano ferme —
	# senza questa riga i 10 fps del secondo piano verrebbero letti come "il
	# computer arranca", il mondo si pixelerebbe da solo mentre nessuno guarda
	# e la misura finirebbe pure su disco (render_scale in AUTO).
	if _idle_pace != null and _idle_pace.throttled():
		return
	if _gfx_done:
		_watch_framerate(delta)
		return
	# Scelta esplicita (Impostazioni → Grafica, o JHT_PIXEL nei banchi di prova):
	# la calibrazione non deve nemmeno partire. Bloccavo solo la sorveglianza
	# continua, e la prima misura sovrascriveva comunque il valore chiesto — il
	# banco di prova del 25/07 ha misurato tre profili "forzati" che erano tutti
	# finiti sullo stesso gradino deciso dalla calibrazione.
	if _graphics_forced():
		_gfx_done = true
		_applied_scale = Game.render_scale()
		return
	_gfx_time += delta
	if _gfx_time < 5.0:
		return
	_gfx_fps_sum += Engine.get_frames_per_second()
	_gfx_samples += 1
	if _gfx_time >= 15.0 and _gfx_samples > 0:
		_gfx_done = true
		var avg := _gfx_fps_sum / _gfx_samples
		if avg < 24.0:
			# Le due leve vanno insieme, perché nessuna da sola basta: il
			# profilo ridotto spegne la scenografia di lusso (85 draw call su
			# 822, misurate con JHT_CENSUS) e il mondo passa a risoluzione
			# ridotta, che è l'unica cosa che sposta davvero i fps su una
			# macchina che ne fa 8 (T440s, 24/07). Il cap a 30 da solo era un
			# placebo: chi sta a 20 non lo tocca mai.
			set_low_gfx(true)
			Log.info("perf",
					"calibrazione: fps medio %.0f → profilo ridotto (scenografia off)" % avg)
			_set_scale(_scale_for_fps(avg), avg)
		else:
			Log.info("perf", "calibrazione: fps medio %.0f → profilo pieno" % avg)


## Scala per la prima calibrazione. Il primo gradino è LEGGERO (85%: la
## grana si nota appena e la GPU ha già un quarto di lavoro in meno) e si
## scende solo quanto serve — fino al 60% per le macchine che arrancano
## davvero. Sopra i 24 fps non si tocca niente: su un computer capace non
## ha senso pixelare (indicazione di Leone, 25/07).
static func _scale_for_fps(fps: float) -> float:
	if fps >= 24.0:
		return 1.0
	if fps >= 18.0:
		return 0.85
	if fps >= 12.0:
		return 0.7
	return 0.6


## Una misura sola all'ingresso non basta: l'ufficio si riempie di agenti,
## la macchina si scalda, arrivano altri programmi. Il profilo continua ad
## adattarsi — scende quando il gioco arranca, e risale quando c'è margine,
## così chi ha comprato un computer nuovo non resta pixelato per sempre.
## Una scelta manuale dell'utente (o JHT_PIXEL) blocca tutto: comanda lei.
## Vale anche per JHT_LOW_GFX: un profilo forzato dall'ambiente serve a
## MISURARE, e se la sorveglianza gli muove la scala sotto i piedi il banco di
## prova finisce per confrontare tutte le varianti sullo stesso gradino (è
## esattamente l'errore visto il 25/07).
func _watch_framerate(delta: float) -> void:
	if _graphics_forced():
		return
	_watch_time += delta
	_watch_fps_sum += Engine.get_frames_per_second()
	_watch_samples += 1
	if _watch_time < 12.0 or _watch_samples == 0:
		return
	var avg := _watch_fps_sum / _watch_samples
	_watch_time = 0.0
	_watch_fps_sum = 0.0
	_watch_samples = 0
	var cap := float(Engine.max_fps if Engine.max_fps > 0 else 60)
	if avg < 20.0 and _applied_scale > 0.6:
		# Ancora in affanno: un gradino più giù, senza mai scendere sotto il
		# minimo leggibile.
		_set_scale(maxf(0.6, _applied_scale - 0.15), avg)
	elif avg >= cap * 0.95 and _applied_scale < 1.0:
		# Il tetto è saturo con margine: si può restituire definizione. La
		# soglia asimmetrica (scendere a 20, risalire solo al 95% del cap)
		# evita il ping-pong fra due gradini.
		_set_scale(minf(1.0, _applied_scale + 0.15), avg)


## Il profilo è deciso da qualcuno che non è la calibrazione — la scelta salvata
## in Impostazioni, o una variabile d'ambiente di prova. In tutti questi casi
## calibrazione e sorveglianza stanno a guardare.
static func _graphics_forced() -> bool:
	return graphics_choice() != CHOICE_AUTO \
			or OS.get_environment("JHT_PIXEL").strip_edges() != "" \
			or OS.get_environment("JHT_LOW_GFX") == "1"


func _set_scale(scale: float, measured: float) -> void:
	if is_equal_approx(scale, _applied_scale):
		return
	_apply_world_scale(scale)
	# In automatico la misura si ricorda, così il prossimo avvio parte già dal
	# gradino giusto invece di rifare i 15 secondi di lag.
	if graphics_choice() == CHOICE_AUTO:
		set_render_scale(scale)
	Log.info("perf", "profilo grafico: %d fps misurati → mondo al %d%%"
			% [int(measured), int(scale * 100.0)])


## Porta la scala alla scena viva. La scena è l'unica a sapere come si fa (il
## palcoscenico a risoluzione ridotta è roba sua); qui si tiene solo il valore
## corrente, che serve alla sorveglianza per sapere da dove si muove.
func _apply_world_scale(scale: float) -> void:
	_applied_scale = scale
	var tree := get_tree()
	if tree == null:
		return
	var scene := tree.current_scene
	if scene != null and scene.has_method("set_render_scale"):
		scene.call("set_render_scale", scale)

# ── Navigazione fra scene ─────────────────────────────────────────────

func goto_title() -> void:
	Log.info("scene", "→ TITLE")
	state = State.TITLE
	get_tree().change_scene_to_file(SCENE_TITLE)

func goto_wizard() -> void:
	Log.info("scene", "→ WIZARD")
	state = State.WIZARD
	_change_scene_with_veil(SCENE_WIZARD)

func goto_office() -> void:
	Log.info("scene", "→ OFFICE")
	state = State.OFFICE
	_change_scene_with_veil(SCENE_OFFICE)

## Velo "CARICAMENTO…" sopra tutto durante i cambi scena pesanti: su
## hardware lento l'ufficio impiega secondi a costruirsi e uno schermo
## nero muto sembra un crash (feedback Leone, test Windows 20/07).
var _loading_veil: CanvasLayer = null

## Un cambio scena alla volta: sul ThinkPad il passo 03 del setup non portava
## al wizard e l'utente ha cliccato nove volte, accodando nove cambi scena
## sovrapposti — ognuno col suo velo e i suoi await (25/07). Il primo click
## comanda, gli altri non fanno danni.
var _scene_change_busy := false

func _change_scene_with_veil(path: String) -> void:
	if _scene_change_busy:
		Log.info("scene", "cambio verso %s ignorato: uno è già in corso" % path)
		return
	_scene_change_busy = true
	_show_loading()
	# Due frame: il velo deve arrivare DAVVERO a schermo prima che il
	# caricamento blocchi il main thread.
	await get_tree().process_frame
	await get_tree().process_frame
	# L'esito NON era guardato da nessuno: una scena che non si carica lasciava
	# l'utente dov'era, in silenzio, con il solo velo a lampeggiare.
	var err := get_tree().change_scene_to_file(path)
	if err != OK:
		Log.error("scene", "cambio scena %s FALLITO (errore %d)" % [path, err])
	# Il cambio scena è deferred: dopo due frame la nuova scena ha
	# completato _ready e sta renderizzando.
	await get_tree().process_frame
	await get_tree().process_frame
	var landed := get_tree().current_scene.scene_file_path \
			if get_tree().current_scene != null else "(nessuna)"
	if landed != path:
		Log.error("scene", "dopo il cambio la scena attiva è %s, non %s"
				% [landed, path])
	_hide_loading()
	_scene_change_busy = false

func _show_loading(message := "CARICAMENTO…") -> void:
	if _loading_veil:
		return
	_loading_veil = CanvasLayer.new()
	_loading_veil.layer = 90
	var rect := ColorRect.new()
	rect.color = Palette.VOID
	rect.set_anchors_preset(Control.PRESET_FULL_RECT)
	_loading_veil.add_child(rect)
	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	_loading_veil.add_child(center)
	var box := VBoxContainer.new()
	box.alignment = BoxContainer.ALIGNMENT_CENTER
	box.add_theme_constant_override("separation", 14)
	center.add_child(box)
	var label := Label.new()
	label.text = message
	label.add_theme_font_size_override("font_size", 26)
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(label)
	var bar := ProgressBar.new()
	bar.custom_minimum_size = Vector2(320, 10)
	bar.show_percentage = false
	bar.indeterminate = true
	box.add_child(bar)
	get_tree().root.add_child(_loading_veil)

func _hide_loading() -> void:
	if _loading_veil:
		_loading_veil.queue_free()
		_loading_veil = null

## ── Onboarding: flag di routing (title → wizard solo al primo giro) ──

func onboarding_done() -> bool:
	# TEST-AUTO: JHT_ONBOARDING=1 forza il wizard anche se già completato
	if OS.get_environment("JHT_ONBOARDING") == "1":
		return false
	var cfg := ConfigFile.new()
	return cfg.load(ONBOARDING_CFG) == OK \
			and bool(cfg.get_value("onboarding", "done", false))

func mark_onboarding_done() -> void:
	var cfg := ConfigFile.new()
	cfg.set_value("onboarding", "done", true)
	cfg.save(ONBOARDING_CFG)


# ── Aspetto interfaccia ─────────────────────────────────────────────

func set_ui_theme(requested: String) -> void:
	if requested not in [Palette.MODE_DARK, Palette.MODE_LIGHT]:
		return
	if not Palette.set_mode(requested):
		return
	TerminalTheme.reset()
	RenderingServer.set_default_clear_color(Palette.VOID)
	Log.info("ui", "tema interfaccia → %s" % requested)
	_reload_ui_theme.call_deferred()


func set_ui_language(requested: String) -> void:
	if not UIStrings.set_lang(requested):
		return
	# Tutti gli override testuali nascono insieme ai Control. Ricostruire la
	# scena evita una UI a metà lingua e mantiene vivi autoload, backend e stato.
	_reload_ui_language.call_deferred()


## Chiamato dall'autotest dell'ufficio. Il flag resta sull'autoload mentre la
## scena viene ricostruita, quindi il test non si riavvia in un loop.
func language_settings_selftest() -> void:
	if _language_settings_test_started:
		return
	_language_settings_test_started = true
	set_ui_language("de")


func _reload_ui_language() -> void:
	if not get_tree().current_scene:
		return
	var err := get_tree().reload_current_scene()
	if err != OK:
		Log.warn("ui", "reload lingua fallito: %s" % error_string(err))
		return
	await get_tree().process_frame
	await get_tree().process_frame
	var sidebars := get_tree().get_nodes_in_group("game_sidebar")
	if not sidebars.is_empty():
		sidebars[0].open_section("language")
	if OS.get_environment("JHT_LANGUAGE_SETTINGS_TEST") == "1":
		await get_tree().process_frame
		var ok := UIStrings.lang == "de" \
			and get_tree().current_scene != null \
			and get_tree().current_scene.scene_file_path == SCENE_OFFICE \
			and not sidebars.is_empty()
		print("LANGUAGE-SETTINGS-TEST %s" % ("PASS" if ok else "FAIL"))
		get_tree().quit(0 if ok else 1)


func _reload_ui_theme() -> void:
	# Gli override colore vengono creati insieme ai controlli. Ricostruire la
	# scena corrente applica il cambio a ogni finestra senza lasciare widget
	# metà dark e metà light; gli autoload e la connessione VPS restano vivi.
	if get_tree().current_scene:
		var err := get_tree().reload_current_scene()
		if err != OK:
			Log.warn("ui", "reload tema fallito: %s" % error_string(err))
			return
		# Il giocatore resta nello stesso punto delle impostazioni dopo il cambio,
		# anziché dover riaprire menu e pagina Aspetto.
		await get_tree().process_frame
		await get_tree().process_frame
		var sidebars := get_tree().get_nodes_in_group("game_sidebar")
		if not sidebars.is_empty():
			sidebars[0].open_section("appearance")

# ── Pausa ─────────────────────────────────────────────────────────────

func open_pause() -> void:
	if _pause_menu:
		return
	_pause_menu = load("res://scripts/ui/pause_menu.gd").new()
	get_tree().root.add_child(_pause_menu)
	get_tree().paused = true
	Sfx.play_back()

func close_pause() -> void:
	if _pause_menu:
		_pause_menu.queue_free()
		_pause_menu = null
	get_tree().paused = false

## Fullscreen nativo (MODE_FULLSCREEN, il borderless multiwindow di Godot).
## MAI il trucco "borderless a misura schermo": Godot 4.7 su Windows lo rileva
## e marca la finestra EXCLUSIVE_FULLSCREEN, flag che resta incastrato anche
## dopo il resize (finestra dietro le altre, present esclusivo, lag).
## Lo stato lo teniamo noi in _fullscreen: il getter Window.mode non è affidabile.
var _fullscreen := false

func is_fullscreen() -> bool:
	return _fullscreen

func toggle_fullscreen() -> void:
	_apply_fullscreen(not _fullscreen)

func _apply_fullscreen(on: bool) -> void:
	_fullscreen = on
	var win := get_window()
	if on:
		win.mode = Window.MODE_FULLSCREEN
	else:
		win.mode = Window.MODE_WINDOWED
		# Il cambio di modo su Windows è asincrono: se size/position si impostano
		# nello stesso frame, il ripristino del rect pre-fullscreen le sovrascrive
		# e la finestra resta grande quanto lo schermo. Geometria al frame dopo.
		await get_tree().process_frame
		# 90% dello schermo, mai più grande del monitor, centrata sul monitor corrente.
		var scr := win.current_screen
		var sp := DisplayServer.screen_get_position(scr)
		var ss := DisplayServer.screen_get_size(scr)
		var target := Vector2i(mini(1600, int(ss.x * 0.9)), mini(900, int(ss.y * 0.9)))
		# TEST-AUTO: JHT_WIN_SIZE=1366x768 replica la finestra di uno schermo
		# specifico (repro bug di scala tipo "bordi su tre lati").
		var forced := OS.get_environment("JHT_WIN_SIZE")
		if forced.contains("x"):
			target = Vector2i(int(forced.get_slice("x", 0)), int(forced.get_slice("x", 1)))
		win.size = target
		win.position = sp + (ss - target) / 2

# ── Input map via codice (niente sezione [input] nel project.godot) ──

func _register_inputs() -> void:
	_add_key_action("move_left", [KEY_A, KEY_LEFT])
	_add_key_action("move_right", [KEY_D, KEY_RIGHT])
	_add_key_action("move_up", [KEY_W, KEY_UP])
	_add_key_action("move_down", [KEY_S, KEY_DOWN])
	_add_key_action("registry", [KEY_TAB])
	_add_key_action("pause", [KEY_ESCAPE])
	_add_key_action("fullscreen", [KEY_F11])
	# Uscita d'emergenza con la combinazione che ogni desktop conosce. ESC apre
	# un menu e richiede poi un click: se il gioco smette di ricevere il mouse
	# (o l'ha perso il compositore) non basta. Questa chiude e basta.
	_add_key_action("quit_game", [KEY_Q], true)

func _add_key_action(action: String, keys: Array, with_ctrl := false) -> void:
	if InputMap.has_action(action):
		return
	InputMap.add_action(action)
	for k in keys:
		var ev := InputEventKey.new()
		ev.physical_keycode = k
		if with_ctrl:
			# su macOS il modificatore di sistema è Cmd, altrove Ctrl
			ev.command_or_control_autoremap = true
		InputMap.action_add_event(action, ev)
