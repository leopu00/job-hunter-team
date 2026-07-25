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
## soglia si passa al profilo ridotto — cap a 30fps, che sui portatili
## deboli dà un ritmo stabile invece di oscillare tra 14 e 24. La
## leggibilità del testo non si tocca MAI (è garantita da text_boost).
## Su hardware capace non cambia nulla: grafica piena a 60fps.
var low_gfx := false
var _gfx_time := 0.0
var _gfx_fps_sum := 0.0
var _gfx_samples := 0
var _gfx_done := false

const PIXEL_CFG := "user://graphics.cfg"

## Scala di rendering del MONDO: 1.0 = nativo, 0.75 = tre quarti di lato,
## 0.5 = metà (un quarto dei pixel). Il mondo finisce in un SubViewport
## ingrandito con filtro nearest, così la grana resta netta invece di
## sfocarsi. La UI non passa di qui e resta sempre a risoluzione piena.
## Precedenza: JHT_PIXEL (test) → scelta dell'utente → calibrazione.
static func render_scale() -> float:
	var forced := OS.get_environment("JHT_PIXEL").strip_edges()
	if forced.is_valid_float():
		return _as_scale(forced.to_float())
	var cfg := ConfigFile.new()
	if cfg.load(PIXEL_CFG) == OK:
		var saved := float(cfg.get_value("graphics", "render_scale", 0.0))
		if saved > 0.0:
			return clampf(saved, 0.25, 1.0)
	return 1.0  # nessuna scelta salvata: decide la calibrazione a runtime


## Accetta sia la scala (0.75) sia il vecchio divisore intero (2 → 0.5),
## così i comandi di test già in giro continuano a funzionare.
static func _as_scale(value: float) -> float:
	if value > 1.0:
		return clampf(1.0 / value, 0.25, 1.0)
	return clampf(value, 0.25, 1.0)


static func set_render_scale(value: float) -> void:
	var cfg := ConfigFile.new()
	cfg.load(PIXEL_CFG)
	cfg.set_value("graphics", "render_scale", clampf(value, 0.25, 1.0))
	cfg.save(PIXEL_CFG)

## Scala attualmente imposta dalla calibrazione (1.0 = nessuna riduzione).
var _applied_scale := 1.0
var _watch_time := 0.0
var _watch_fps_sum := 0.0
var _watch_samples := 0

func _process(delta: float) -> void:
	if state != State.OFFICE:
		return
	if DisplayServer.get_name() == "headless" \
			or OS.get_environment("JHT_SHOT") != "":
		_gfx_done = true
		return
	if _gfx_done:
		_watch_framerate(delta)
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
			low_gfx = true
			Engine.max_fps = 30
			# Il cap da solo non toglie lavoro alla GPU: su una macchina che
			# fa 8 fps è un placebo (misurato su T440s, 24/07). Quello che
			# toglie lavoro davvero è rendere il mondo a risoluzione ridotta.
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
func _watch_framerate(delta: float) -> void:
	if OS.get_environment("JHT_PIXEL").strip_edges() != "":
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


func _set_scale(scale: float, measured: float) -> void:
	if is_equal_approx(scale, _applied_scale):
		return
	_applied_scale = scale
	var scene := get_tree().current_scene
	if scene != null and scene.has_method("set_render_scale"):
		scene.call("set_render_scale", scale)
	Log.info("perf", "profilo grafico: %d fps misurati → mondo al %d%%"
			% [int(measured), int(scale * 100.0)])

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
