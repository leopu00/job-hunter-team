extends Node
## Autoload `Game`: stato globale, profilo giocatore, cambio scena, pausa.

enum State { TITLE, OFFICE }

const SCENE_TITLE := "res://scenes/title.tscn"
const SCENE_OFFICE := "res://scenes/office.tscn"

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
	# Shot-quiet: la finestrella resta cliccabile anche senza focus — un
	# click VERO dell'utente al lavoro può aprire pannelli e falsare lo
	# shot (successo: pagina Mentor aperta da sola in uno sweep). Sordi
	# a mouse e tastiera per tutta la durata dello shot.
	if OS.get_environment("JHT_SHOT_QUIET") == "1":
		get_viewport().gui_disable_input = true
	# Scorciatoia per i test: JHT_SCENE=office salta il boot.
	if OS.get_environment("JHT_SCENE") == "office":
		goto_office.call_deferred()

func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("fullscreen"):
		toggle_fullscreen()
		return
	if event.is_action_pressed("pause") and not dialogue_active:
		if get_tree().paused:
			close_pause()
		elif state != State.TITLE:
			open_pause()

# ── Navigazione fra scene ─────────────────────────────────────────────

func goto_title() -> void:
	Log.info("scene", "→ TITLE")
	state = State.TITLE
	get_tree().change_scene_to_file(SCENE_TITLE)

func goto_office() -> void:
	Log.info("scene", "→ OFFICE")
	state = State.OFFICE
	get_tree().change_scene_to_file(SCENE_OFFICE)

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

func _add_key_action(action: String, keys: Array) -> void:
	if InputMap.has_action(action):
		return
	InputMap.add_action(action)
	for k in keys:
		var ev := InputEventKey.new()
		ev.physical_keycode = k
		InputMap.action_add_event(action, ev)
