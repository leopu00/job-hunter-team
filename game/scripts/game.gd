extends Node
## Autoload `Game`: stato globale, profilo giocatore, cambio scena, pausa.

enum State { TITLE, WIZARD, OFFICE }

const SCENE_TITLE := "res://scenes/title.tscn"
const SCENE_WIZARD := "res://scenes/wizard.tscn"
const SCENE_OFFICE := "res://scenes/office.tscn"

var state: State = State.TITLE
## True mentre un dialogo a ritratti è aperto (blocca movimento e pausa-rapida).
var dialogue_active := false

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
	_register_inputs()

func _ready() -> void:
	# Scorciatoia per i test: JHT_SCENE=office|wizard|title salta il boot.
	var target := OS.get_environment("JHT_SCENE")
	if target == "office":
		goto_office.call_deferred()
	elif target == "wizard":
		goto_wizard.call_deferred()

func _unhandled_input(event: InputEvent) -> void:
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

func toggle_fullscreen() -> void:
	var win := get_window()
	if win.mode == Window.MODE_FULLSCREEN or win.mode == Window.MODE_EXCLUSIVE_FULLSCREEN:
		win.mode = Window.MODE_WINDOWED
		win.size = Vector2i(1600, 900)
		win.move_to_center()
	else:
		win.mode = Window.MODE_FULLSCREEN

# ── Input map via codice (niente sezione [input] nel project.godot) ──

func _register_inputs() -> void:
	_add_key_action("move_left", [KEY_A, KEY_LEFT])
	_add_key_action("move_right", [KEY_D, KEY_RIGHT])
	_add_key_action("move_up", [KEY_W, KEY_UP])
	_add_key_action("move_down", [KEY_S, KEY_DOWN])
	_add_key_action("interact", [KEY_E])
	_add_key_action("pause", [KEY_ESCAPE])

func _add_key_action(action: String, keys: Array) -> void:
	if InputMap.has_action(action):
		return
	InputMap.add_action(action)
	for k in keys:
		var ev := InputEventKey.new()
		ev.physical_keycode = k
		InputMap.action_add_event(action, ev)
