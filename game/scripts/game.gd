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
	# Shot-quiet: la finestrella resta cliccabile anche senza focus — un
	# click VERO dell'utente al lavoro può aprire pannelli e falsare lo
	# shot (successo: pagina Mentor aperta da sola in uno sweep). Sordi
	# a mouse e tastiera per tutta la durata dello shot.
	if OS.get_environment("JHT_SHOT_QUIET") == "1":
		get_viewport().gui_disable_input = true
	# Scorciatoia per i test: JHT_SCENE=office|wizard salta il boot.
	if OS.get_environment("JHT_SCENE") == "office":
		goto_office.call_deferred()
	elif OS.get_environment("JHT_SCENE") == "wizard":
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
## capace non cambia nulla.
const GFX_CONFIG := "user://graphics.cfg"

signal gfx_profile_changed(low: bool)

var low_gfx := false
var _gfx_time := 0.0
var _gfx_fps_sum := 0.0
var _gfx_samples := 0
var _gfx_done := false


## Il profilo scelto la prima volta vale anche ai riavvii successivi: senza
## memoria l'utente si rivedrebbe i primi 15 secondi di lag ogni volta.
func load_gfx_profile() -> void:
	if OS.get_environment("JHT_LOW_GFX") == "1":  # TEST-AUTO
		set_low_gfx(true, false)
		_gfx_done = true
		return
	var cfg := ConfigFile.new()
	if cfg.load(GFX_CONFIG) != OK:
		return
	if bool(cfg.get_value("graphics", "low", false)):
		set_low_gfx(true, false)
		_gfx_done = true  # già deciso: non rimisurare


func set_low_gfx(low: bool, persist := true) -> void:
	if low_gfx == low:
		return
	low_gfx = low
	Engine.max_fps = 30 if low else 60
	apply_gfx_profile()
	gfx_profile_changed.emit(low)
	if persist:
		var cfg := ConfigFile.new()
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
	if _gfx_done or state != State.OFFICE:
		return
	if DisplayServer.get_name() == "headless" \
			or OS.get_environment("JHT_SHOT") != "":
		_gfx_done = true
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
			set_low_gfx(true)
			Log.info("perf",
					"calibrazione: fps medio %.0f → profilo ridotto (scenografia off)" % avg)
		else:
			Log.info("perf", "calibrazione: fps medio %.0f → profilo pieno" % avg)

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

func _change_scene_with_veil(path: String) -> void:
	_show_loading()
	# Due frame: il velo deve arrivare DAVVERO a schermo prima che il
	# caricamento blocchi il main thread.
	await get_tree().process_frame
	await get_tree().process_frame
	get_tree().change_scene_to_file(path)
	# Il cambio scena è deferred: dopo due frame la nuova scena ha
	# completato _ready e sta renderizzando.
	await get_tree().process_frame
	await get_tree().process_frame
	_hide_loading()

func _show_loading() -> void:
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
	label.text = "CARICAMENTO…"
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

func _add_key_action(action: String, keys: Array) -> void:
	if InputMap.has_action(action):
		return
	InputMap.add_action(action)
	for k in keys:
		var ev := InputEventKey.new()
		ev.physical_keycode = k
		InputMap.action_add_event(action, ev)
