extends Node
## Autoload `Game`: stato globale, profilo giocatore, cambio scena, pausa.

enum State { TITLE, WIZARD, OFFICE }

const SCENE_TITLE := "res://scenes/title.tscn"
const SCENE_WIZARD := "res://scenes/wizard.tscn"
const SCENE_OFFICE := "res://scenes/office.tscn"

var state: State = State.TITLE
## True mentre un dialogo a ritratti è aperto (blocca movimento e pausa-rapida).
var dialogue_active := false
## Alzato dal wizard: l'ufficio si apre con le porte dell'ascensore.
var arrive_via_elevator := false

## Profilo scelto nel wizard; solo in memoria, niente salvataggio (prototipo).
var profile := {
	"base": 0,          # indice corporatura avatar
	"hair": 0,          # indice taglio capelli
	"hair_color": 0,    # indice colore capelli
	"outfit": 0,        # indice colore abito
	"team_name": "",
	"cv_name": "",      # nome file del CV "caricato"
}

var _pause_menu: Node = null

func _enter_tree() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	# Cap FPS + vsync: senza limite il gioco rende a migliaia di fps e su GPU
	# integrata, in finestra, satura il compositor facendo laggare tutto il
	# desktop. 60 fps con vsync è fluido e non ruba risorse al resto del sistema.
	Engine.max_fps = 60
	DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_ENABLED)
	_register_inputs()

func _ready() -> void:
	# Il fullscreen dichiarato in project.godot non sempre attecchisce all'avvio
	# su Windows: lo forziamo a finestra pronta. JHT_WINDOWED=1 avvia in finestra
	# (comodo per i test/screenshot senza coprire lo schermo).
	if OS.get_environment("JHT_WINDOWED") != "1":
		_apply_fullscreen.call_deferred(true)

	# Scorciatoia per i test: JHT_SCENE=office|wizard|title salta il boot.
	var target := OS.get_environment("JHT_SCENE")
	if OS.get_environment("JHT_ELEVATOR") == "1":
		arrive_via_elevator = true
	if target == "office":
		goto_office.call_deferred()
	elif target == "wizard":
		goto_wizard.call_deferred()

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
	state = State.TITLE
	get_tree().change_scene_to_file(SCENE_TITLE)

func goto_wizard() -> void:
	if not ResourceLoader.exists(SCENE_WIZARD):
		goto_office()  # fallback finché il wizard non è implementato (M4)
		return
	state = State.WIZARD
	get_tree().change_scene_to_file(SCENE_WIZARD)

func goto_office() -> void:
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

func is_fullscreen() -> bool:
	var m := get_window().mode
	return m == Window.MODE_FULLSCREEN or m == Window.MODE_EXCLUSIVE_FULLSCREEN

func toggle_fullscreen() -> void:
	_apply_fullscreen(not is_fullscreen())

## Applica in modo deterministico finestra/schermo intero e riallinea lo stretch.
func _apply_fullscreen(on: bool) -> void:
	var win := get_window()
	if on:
		win.mode = Window.MODE_FULLSCREEN
	else:
		win.mode = Window.MODE_WINDOWED
		# 90% dello schermo, mai più grande del monitor, poi centrata.
		var screen := DisplayServer.screen_get_size(win.current_screen)
		var target := Vector2i(1600, 900)
		target.x = mini(target.x, int(screen.x * 0.9))
		target.y = mini(target.y, int(screen.y * 0.9))
		win.size = target
		win.move_to_center()

# ── Input map via codice (niente sezione [input] nel project.godot) ──

func _register_inputs() -> void:
	_add_key_action("move_left", [KEY_A, KEY_LEFT])
	_add_key_action("move_right", [KEY_D, KEY_RIGHT])
	_add_key_action("move_up", [KEY_W, KEY_UP])
	_add_key_action("move_down", [KEY_S, KEY_DOWN])
	_add_key_action("interact", [KEY_E])
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
