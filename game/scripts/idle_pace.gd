class_name IdlePace
extends Node
## Ritmo di disegno quando nessuno sta guardando.
##
## Questa è un'applicazione fatta per restare aperta mentre il team lavora,
## anche di notte, e fino a qui disegnava a ritmo pieno pure con la finestra in
## secondo piano o minimizzata: sul ThinkPad T440s era il processo che
## consumava PIÙ CPU della macchina — 37,3% contro ~8% per ciascuno dei cinque
## agenti che stava guardando, 75 °C con load 1,3 su 4 core (notte del 26/07).
## Non è mai stato un problema di prestazioni: è il costo A RIPOSO.
##
## Dove va il tempo (misurato il 28/07, macOS ARM, scena ufficio a 1280x720,
## 30 s di misura dopo 12 s di warmup, CPU dal delta di `ps -o time`):
##   ufficio SENZA rendering (--headless, main loop a 60)   3,8% di CPU
##   ufficio CON rendering    (finestra, 60 fps, 755 draw)  31,8% di CPU
## Sette ottavi del conto sono i fotogrammi disegnati, non la logica di scena:
## il numero di fotogrammi è quindi la leva giusta, ed è l'unica che li tocca
## tutti insieme (le draw call sono il mestiere di [JHT-PIXEL-MODE]).
##
## Due cose che questo nodo NON tocca, per costruzione:
##  - il PRIMO PIANO. Finché la finestra ha il focus qui non si scrive niente:
##    `Engine.max_fps` resta esattamente il valore che ci avrebbe messo il
##    profilo grafico, e al ritorno si rimette quello, non un 60 di comodo.
##  - il TEAM. Il polling del backend non passa dal main loop: vive nei thread
##    di VpsBackend e LocalBackend, che dormono con `OS.delay_msec` e misurano
##    i timeout con `Time.get_ticks_msec()`. `Engine.max_fps` governa il ritmo
##    del main loop e nient'altro — nessun `ssh` e nessun `docker exec`
##    rallenta o scade prima perché il gioco disegna di meno.

## Stati distinguibili della finestra. Minimizzata può permettersi molto meno
## di "in secondo piano ma visibile": nel primo caso non c'è nemmeno un pixel
## da guardare, nel secondo qualcuno può tenere l'ufficio in un angolo dello
## schermo e vederlo muovere.
enum Pace { FOREGROUND, BACKGROUND, MINIMIZED }

## Tetti di fotogrammi al secondo per stato. 10 fps in secondo piano restano
## movimento leggibile a chi tiene la finestra di lato; 3 fps da minimizzata
## sono il minimo che lascia il main loop abbastanza sveglio da accorgersi del
## click che riporta su la finestra (un giro ogni 333 ms) e da smaltire i
## `call_deferred` con cui i thread del backend consegnano il roster.
const FPS := {
	Pace.BACKGROUND: 10,
	Pace.MINIMIZED: 3,
}

## Ogni quanto si ricontrolla se la finestra, oltre che senza focus, è anche
## finita in icona. Gira SOLO fuori dal primo piano.
const PROBE_EVERY := 1.0

var _pace: int = Pace.FOREGROUND
## Tetti in vigore in primo piano, ripresi alla lettera al ritorno. Si
## rileggono a ogni uscita dal primo piano e non si assumono mai: il profilo
## grafico ridotto gira già a 30 fps (`Game.set_low_gfx`), e restituire 60 a
## chi ne aveva 30 sarebbe un peggioramento travestito da ripristino.
var _full_fps := 0
var _full_steps := 0
var _probe: Timer = null
var _enabled := false
## `JHT_IDLE_PACE_FORCE=background|minimized` inchioda lo stato: serve a
## misurare il risparmio senza dover contendere il focus a chi sta lavorando
## sulla macchina. Fuori dalla misura è vuoto.
var _forced := ""


func _enter_tree() -> void:
	# Il ritmo va governato anche a gioco in pausa: il menu di pausa aperto e
	# la finestra mandata dietro sono esattamente la notte tipo.
	process_mode = Node.PROCESS_MODE_ALWAYS
	_forced = OS.get_environment("JHT_IDLE_PACE_FORCE").strip_edges()
	_enabled = _forced != "" or _should_run()


func _ready() -> void:
	if not _enabled:
		return
	if _forced != "":
		_set_pace(Pace.MINIMIZED if _forced == "minimized" else Pace.BACKGROUND)
		return
	_probe = Timer.new()
	_probe.wait_time = PROBE_EVERY
	_probe.process_mode = Node.PROCESS_MODE_ALWAYS
	_probe.timeout.connect(_probe_window)
	add_child(_probe)


## Il gioco sta disegnando a ritmo ridotto in questo momento. Lo chiede la
## calibrazione grafica, che senza questa domanda leggerebbe i 10 fps del
## secondo piano come una macchina che arranca.
func throttled() -> bool:
	return _pace != Pace.FOREGROUND


func pace() -> int:
	return _pace


## Tetto fps per uno stato, dato quello in vigore in primo piano. Non si sale
## MAI sopra il tetto pieno: è un freno, non un acceleratore.
static func fps_for(pace_state: int, full_fps: int) -> int:
	if not FPS.has(pace_state):
		return full_fps
	var capped := int(FPS[pace_state])
	if full_fps > 0:  # 0 = nessun tetto
		capped = mini(capped, full_fps)
	return capped


## Quanti passi di fisica per frame servono perché il TEMPO DI GIOCO non si
## dilati al ritmo ridotto.
##
## È la trappola non ovvia di tutta la voce: sotto i 7,5 fps un frame deve
## smaltire più degli 8 passi che il motore concede di default, e il tempo in
## eccesso non viene rimandato — viene BUTTATO. La scena finirebbe davvero al
## rallentatore (a 3 fps girerebbe al 40% del tempo reale) e chi riprende il
## focus troverebbe l'ufficio indietro di minuti: esattamente la "scena
## stantia" che questo lavoro deve evitare. Si alza il tetto dei passi, non si
## cambia la cadenza: 60 tick al secondo restano 60, e la fisica costa uguale
## a prima (era già dentro il 3,8% del profilo senza rendering).
static func physics_steps_for(fps: int, ticks: int, full_steps: int) -> int:
	if fps <= 0 or ticks <= 0:
		return full_steps
	# +1 di margine: un frame che arriva lungo non deve perdere tempo di gioco.
	return maxi(full_steps, ceili(float(ticks) / float(fps)) + 1)


func _should_run() -> bool:
	if OS.get_environment("JHT_IDLE_PACE") == "off":
		return false
	# Gli shot di verifica vivono APPOSTA in una finestra senza focus
	# (JHT_SHOT_QUIET, vedi tools/run.sh): rallentarla cambierebbe sotto i
	# piedi le condizioni di uno strumento che serve a guardare, non a
	# risparmiare — e su macOS il present di una finestra non in primo piano è
	# già abbastanza delicato di suo.
	if OS.get_environment("JHT_SHOT") != "":
		return false
	# Headless non disegna: non c'è niente da rallentare, e i selftest devono
	# girare al ritmo di sempre.
	return DisplayServer.get_name() != "headless"


func _notification(what: int) -> void:
	if not _enabled or _forced != "":
		return
	match what:
		NOTIFICATION_APPLICATION_FOCUS_OUT:
			_set_pace(Pace.MINIMIZED if _minimized() else Pace.BACKGROUND)
			if _probe != null:
				_probe.start()
		NOTIFICATION_APPLICATION_FOCUS_IN:
			if _probe != null:
				_probe.stop()
			_set_pace(Pace.FOREGROUND)
		NOTIFICATION_WM_CLOSE_REQUEST:
			# L'uscita ordinata alza un velo e parla col container: deve girare
			# a ritmo pieno anche se la richiesta arriva a finestra minimizzata.
			if _probe != null:
				_probe.stop()
			_set_pace(Pace.FOREGROUND)


## Senza focus si può SEMPRE finire in icona, e la minimizzazione non ha una
## notifica propria: si guarda lo stato della finestra una volta al secondo.
func _probe_window() -> void:
	if _pace == Pace.FOREGROUND:
		return
	_set_pace(Pace.MINIMIZED if _minimized() else Pace.BACKGROUND)


## Senza un vero server grafico non esiste una finestra da minimizzare, ma
## `window_get_mode()` risponde lo stesso — e risponde MINIMIZED. Senza questa
## guardia il ramo headless del self-test scendeva al ritmo più basso appena
## perso il focus: sbagliato lì, e sbagliato ovunque il display server sia
## finto.
func _minimized() -> bool:
	if DisplayServer.get_name() == "headless":
		return false
	return DisplayServer.window_get_mode() == DisplayServer.WINDOW_MODE_MINIMIZED


func _set_pace(pace_state: int) -> void:
	if pace_state == _pace:
		return
	if _pace == Pace.FOREGROUND:
		_full_fps = Engine.max_fps
		_full_steps = Engine.max_physics_steps_per_frame
	_pace = pace_state
	if pace_state == Pace.FOREGROUND:
		# Ripristino nella stessa iterazione in cui arriva il focus: il tempo
		# di attesa di fine frame lo rilegge subito, quindi il fotogramma
		# successivo arriva entro ~16 ms e non alla scadenza del ritmo lento.
		Engine.max_fps = _full_fps
		Engine.max_physics_steps_per_frame = _full_steps
		_log("finestra in primo piano: ritmo pieno (%d fps)" % _full_fps)
		return
	var fps := fps_for(pace_state, _full_fps)
	Engine.max_fps = fps
	Engine.max_physics_steps_per_frame = physics_steps_for(
			fps, Engine.physics_ticks_per_second, _full_steps)
	_log("finestra %s: disegno a %d fps (era %d)"
			% [name_of(pace_state), fps, _full_fps])


static func name_of(pace_state: int) -> String:
	match pace_state:
		Pace.BACKGROUND:
			return "in secondo piano"
		Pace.MINIMIZED:
			return "minimizzata"
	return "in primo piano"


## L'autoload `Log` si cerca a runtime e non si nomina: un riferimento diretto
## da uno script con `class_name` fa fallire la compilazione dei selftest
## headless lanciati con `godot --script`, dove gli autoload non ci sono
## (stessa ragione di GfxProfile).
func _log(msg: String) -> void:
	var tree := Engine.get_main_loop() as SceneTree
	if tree == null or tree.root == null:
		return
	var logger := tree.root.get_node_or_null("Log")
	if logger != null and logger.has_method("info"):
		logger.info("perf", msg)
