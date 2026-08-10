class_name GameSidebar
extends CanvasLayer
## Sidebar stile desktop-app dentro il gioco: stessi gruppi/voci/ordine
## della app (SidebarDefs), veste terminale del gioco. Ogni voce apre un
## SectionPanel; il contenuto vero delle sezioni arriverà con la migrazione.
## Si apre/chiude con il bottone-linguetta ≡ in alto a sinistra.

const WIDTH := 232.0

signal chat_requested

var _drawer: Control
var _panel: SectionPanel
var _buttons := {}  # id sezione → Button
var _icons := {}  # id sezione → SidebarIcon (segue il colore del testo)
var _open := false
var _setup_cta: Button
var _setup_cta_icon: SidebarIcon
var _tab: Button
## Controllo Docker compatto nell'header: mantiene la sidebar a quattordici
## righe anche a 1280×720, ma porta lo stato runtime nel primo punto visibile.
var _docker_button: Button
var _docker_icon: SidebarIcon
var _docker_badge: Label
## Uscita dal giro guidato, in cima al cassetto. Vive QUI e non solo nella
## to-do list del tour perché il cassetto aperto copre la to-do list (layer 20
## contro 15): chi apriva il menu per cercare una via d'uscita si nascondeva
## da solo l'unico pulsante che ce l'aveva (O-14).
var _exit_tour: Button

func _init() -> void:
	layer = 20

func _ready() -> void:
	add_to_group("game_sidebar")
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.theme = TerminalTheme.get_theme()
	add_child(root)

	# Il primo avvio non sequestra l'utente in un wizard: l'ufficio è subito
	# esplorabile. Questo CTA resta visibile finché i tre prerequisiti non sono
	# completi e porta alla checklist senza nascondere il mondo di gioco.
	_setup_cta = Button.new()
	_setup_cta.set_anchors_preset(Control.PRESET_CENTER_TOP)
	# Il badge di verità (SIMULAZIONE / DATI REALI) occupa la prima riga in
	# alto al centro. A y=18 questo CTA lo copriva perfettamente: l'utente
	# vedeva KPI demo e agenti "AL LAVORO" senza l'unica etichetta che diceva
	# che non erano dati reali. La checklist vive nella seconda riga.
	_setup_cta.position = Vector2(-190, 58)
	_setup_cta.custom_minimum_size = Vector2(380, 44)
	_setup_cta.add_theme_font_size_override("font_size", 14)
	_setup_cta.add_theme_color_override("font_color", Palette.YELLOW)
	_setup_cta.pressed.connect(_open_activation)
	# Il fulmine è l'icona vettoriale della sidebar, non il glifo ⚡: i
	# pittogrammi dipendono dai font di sistema (regola: niente emoji nella
	# UI di prodotto). Figlio ancorato a sinistra, testo allineato dopo.
	_setup_cta.alignment = HORIZONTAL_ALIGNMENT_LEFT
	for state in ["normal", "hover", "pressed", "disabled"]:
		# Dal tema condiviso, non dal Button (fuori dall'albero risolverebbe
		# il tema di default): stesso stile, solo il margine per l'icona.
		var sb: StyleBox = TerminalTheme.get_theme() \
				.get_stylebox(state, "Button").duplicate()
		sb.content_margin_left = 44
		_setup_cta.add_theme_stylebox_override(state, sb)
	_setup_cta_icon = SidebarIcon.new("bolt", Palette.YELLOW)
	_setup_cta_icon.anchor_top = 0.5
	_setup_cta_icon.anchor_bottom = 0.5
	_setup_cta_icon.offset_left = 16
	_setup_cta_icon.offset_right = 34
	_setup_cta_icon.offset_top = -9
	_setup_cta_icon.offset_bottom = 9
	_setup_cta.add_child(_setup_cta_icon)
	root.add_child(_setup_cta)
	SetupService.status_changed.connect(_on_setup_status)
	SetupService.action_changed.connect(_on_setup_action)
	ScriptedOnboarding.action_requested.connect(_on_guided_action)
	_on_setup_status(SetupService.status)

	_drawer = PanelContainer.new()
	var style := StyleBoxFlat.new()
	style.bg_color = Color(Palette.PANEL.r, Palette.PANEL.g, Palette.PANEL.b, 0.96)
	style.border_color = Palette.BORDER_GLOW
	style.set_border_width_all(TerminalTheme.hairline())
	_drawer.add_theme_stylebox_override("panel", style)
	_drawer.custom_minimum_size = Vector2(WIDTH, 0)
	_drawer.set_anchors_preset(Control.PRESET_LEFT_WIDE)
	_drawer.visible = false
	root.add_child(_drawer)

	# Linguetta apre il cassetto. Da aperto si nasconde (il cassetto la
	# coprirebbe rendendo il menu impossibile da chiudere — Windows 22/07):
	# la chiusura sta nell'header del cassetto, mai coperta da altri pannelli.
	_tab = Button.new()
	_tab.text = "≡"
	_tab.add_theme_font_size_override("font_size", 26)
	_tab.add_theme_color_override("font_color", Palette.GREEN)
	_tab.add_theme_color_override("font_hover_color", Palette.MINT)
	var tab_style := StyleBoxFlat.new()
	tab_style.bg_color = Color(Palette.PANEL.r, Palette.PANEL.g, Palette.PANEL.b, 0.92)
	tab_style.border_color = Palette.BORDER_GLOW
	tab_style.set_border_width_all(TerminalTheme.hairline())
	tab_style.content_margin_left = 12
	tab_style.content_margin_right = 12
	tab_style.content_margin_top = 4
	tab_style.content_margin_bottom = 6
	var tab_hover := tab_style.duplicate()
	tab_hover.border_color = Palette.GREEN
	_tab.add_theme_stylebox_override("normal", tab_style)
	_tab.add_theme_stylebox_override("hover", tab_hover)
	_tab.add_theme_stylebox_override("pressed", tab_hover.duplicate())
	# Il menu e' raggiungibile con Tab anche quando il mouse non e' disponibile.
	# Non cancellare il focus: senza bordo il cursore da tastiera esiste, ma
	# l'utente non puo' sapere dove si trova.
	_tab.add_theme_stylebox_override("focus", tab_hover.duplicate())
	_tab.position = Vector2(10, 150)
	_tab.pressed.connect(toggle)
	root.add_child(_tab)

	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	_drawer.add_child(scroll)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 2)
	box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(box)

	var brand := TerminalTheme.label("JOB HUNTER TEAM", 15, Palette.WHITE, "xbold")
	brand.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	brand.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var brand_row := HBoxContainer.new()
	brand_row.add_child(brand)
	# Docker e' una destinazione diretta, non una quindicesima riga da far
	# finire sotto lo scroll su schermi bassi. Il check resta invece un pulsante
	# esplicito del pannello Docker: questo click naviga e non avvia rete.
	_docker_button = Button.new()
	_docker_button.flat = true
	_docker_button.tooltip_text = UIStrings.t("side.docker")
	# 24 px di marchio ufficiale + 4 px di area libera su ciascun lato.
	_docker_button.custom_minimum_size = Vector2(32, 32)
	_docker_button.pressed.connect(func() -> void: _select("docker"))
	_docker_icon = SidebarIcon.new("container", Palette.DIM)
	_docker_icon.set_anchors_preset(Control.PRESET_CENTER)
	_docker_icon.offset_left = -12
	_docker_icon.offset_right = 12
	_docker_icon.offset_top = -12
	_docker_icon.offset_bottom = 12
	_docker_button.add_child(_docker_icon)
	_docker_badge = Label.new()
	_docker_badge.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_docker_badge.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_docker_badge.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	_docker_badge.add_theme_font_size_override("font_size", 11)
	_docker_badge.anchor_left = 1.0
	_docker_badge.anchor_top = 0.0
	_docker_badge.anchor_right = 1.0
	_docker_badge.anchor_bottom = 0.0
	_docker_badge.offset_left = -8
	_docker_badge.offset_top = -4
	_docker_badge.offset_right = 4
	_docker_badge.offset_bottom = 8
	_docker_button.add_child(_docker_badge)
	brand_row.add_child(_docker_button)
	# Uscita a portata di mouse SEMPRE: la voce in fondo a Impostazioni finisce
	# sotto lo scroll su schermi bassi, e in fullscreen su Wayland non esiste
	# nemmeno la X della finestra.
	var quit_btn := Button.new()
	quit_btn.flat = true
	quit_btn.tooltip_text = UIStrings.t("pause.quit")
	quit_btn.custom_minimum_size = Vector2(26, 26)
	quit_btn.pressed.connect(func() -> void: Game.open_pause())
	var quit_icon := SidebarIcon.new("power", Palette.DIM)
	quit_icon.set_anchors_preset(Control.PRESET_CENTER)
	quit_icon.offset_left = -9
	quit_icon.offset_right = 9
	quit_icon.offset_top = -9
	quit_icon.offset_bottom = 9
	quit_btn.add_child(quit_icon)
	quit_btn.mouse_entered.connect(func() -> void: quit_icon.color = Palette.RED)
	quit_btn.mouse_exited.connect(func() -> void: quit_icon.color = Palette.DIM)
	brand_row.add_child(quit_btn)
	var close_btn := Button.new()
	close_btn.flat = true
	close_btn.text = "‹"
	close_btn.tooltip_text = UIStrings.t("side.close_menu")
	close_btn.add_theme_font_size_override("font_size", 22)
	close_btn.add_theme_color_override("font_color", Palette.DIM)
	close_btn.add_theme_color_override("font_hover_color", Palette.WHITE)
	close_btn.pressed.connect(toggle)
	brand_row.add_child(close_btn)
	var brand_pad := MarginContainer.new()
	for side in ["top", "bottom"]:
		brand_pad.add_theme_constant_override("margin_" + side, 14)
	brand_pad.add_theme_constant_override("margin_right", 10)
	brand_pad.add_child(brand_row)
	box.add_child(brand_pad)
	_exit_tour = Button.new()
	_exit_tour.text = UIStrings.t("tour.exit")
	_exit_tour.flat = true
	_exit_tour.alignment = HORIZONTAL_ALIGNMENT_LEFT
	_exit_tour.add_theme_font_size_override("font_size", 13)
	_exit_tour.add_theme_color_override("font_color", Palette.YELLOW)
	_exit_tour.add_theme_color_override("font_hover_color", Palette.WHITE)
	_exit_tour.pressed.connect(Game.exit_guided_onboarding)
	var exit_pad := MarginContainer.new()
	exit_pad.add_theme_constant_override("margin_left", 10)
	exit_pad.add_theme_constant_override("margin_bottom", 6)
	exit_pad.add_child(_exit_tour)
	box.add_child(exit_pad)
	TourGuide.changed.connect(_refresh_exit_tour)
	ScriptedOnboarding.dismissed.connect(_refresh_exit_tour)
	_refresh_exit_tour()
	_refresh_docker_button(SetupService.status)

	# TEST-AUTO: JHT_SIDEBAR=1 apre il cassetto al boot (per gli screenshot);
	# JHT_SECTION=<id> apre anche il pannello di quella sezione. Un solo
	# toggle: due deferred (JHT_SIDEBAR + JHT_SECTION valutati a _open ancora
	# false) aprivano e richiudevano il cassetto nello stesso frame.
	var sec := OS.get_environment("JHT_SECTION")
	if OS.get_environment("JHT_SIDEBAR") == "1" or sec != "":
		toggle.call_deferred()
	if sec != "":
		_select.call_deferred(sec)

	for group in SidebarDefs.GROUPS:
		var gt := TerminalTheme.label(
				SidebarDefs.group_title(group).to_upper(), 12, Palette.DIM, "medium")
		var gt_pad := MarginContainer.new()
		gt_pad.add_theme_constant_override("margin_left", 14)
		gt_pad.add_theme_constant_override("margin_top", 12)
		gt_pad.add_theme_constant_override("margin_bottom", 4)
		gt_pad.add_child(gt)
		box.add_child(gt_pad)
		for item in group["items"]:
			box.add_child(_nav_button(item))
	BackendBus.chat_unread_changed.connect(func(_unread: Dictionary) -> void:
		_refresh_chat_badges())
	_refresh_chat_badges()

## L'uscita compare finché il giro guidato è in corso e sparisce quando è
## chiuso: a giro finito sarebbe una voce che non fa niente.
func _refresh_exit_tour() -> void:
	if not is_instance_valid(_exit_tour):
		return
	var visible_now := TourGuide.active() and not ScriptedOnboarding.is_dismissed()
	# Il margine è il padre del pulsante: nasconderlo evita che resti una
	# banda vuota in cima al menu a giro chiuso.
	var row := _exit_tour.get_parent()
	if row is Control:
		(row as Control).visible = visible_now


func toggle() -> void:
	_open = not _open
	_drawer.visible = _open
	_tab.visible = not _open
	if not _open:
		_close_panel()
	_refresh_chat_badges()
	Sfx.play_tick()


## API pubblica usata dal cambio tema e dall'onboarding: apre il cassetto e
## mostra direttamente la sezione richiesta senza simulare click.
func open_section(section: String) -> void:
	if not _open:
		toggle()
	_select(section)

## Colonna dell'icona vettoriale: il testo parte dopo, sempre allineato.
const ICON_X := 14.0
const ICON_SIZE := 18.0

## Stile riga di navigazione: sfondo pieno, accento verde a sinistra.
## `bg_alpha` 0 = trasparente (normal); `accent` accende la barra 3px.
static func _row_style(bg: Color, bg_alpha: float, accent: bool) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(bg.r, bg.g, bg.b, bg_alpha)
	sb.set_border_width_all(0)
	if accent:
		sb.border_width_left = 3
		sb.border_color = Palette.GREEN
	sb.content_margin_left = ICON_X + ICON_SIZE + 8.0
	sb.content_margin_right = 10
	sb.content_margin_top = 7
	sb.content_margin_bottom = 7
	return sb

func _nav_button(item: Dictionary) -> Control:
	var btn := Button.new()
	btn.alignment = HORIZONTAL_ALIGNMENT_LEFT
	btn.text = SidebarDefs.nav_label(item)
	btn.add_theme_font_size_override("font_size", 16)
	btn.add_theme_font_override("font", load(TerminalTheme.FONT_MEDIUM))
	btn.add_theme_color_override("font_color", Palette.BASE)
	btn.add_theme_color_override("font_hover_color", Palette.WHITE)
	btn.add_theme_color_override("font_pressed_color", Palette.GREEN)
	btn.add_theme_stylebox_override("normal", _row_style(Palette.ROW, 0.0, false))
	btn.add_theme_stylebox_override("hover", _row_style(Palette.ROW, 0.85, true))
	btn.add_theme_stylebox_override("pressed", _row_style(Palette.DEEP, 1.0, true))
	# Stesso segnale verde dell'hover: Tab deve essere un percorso visibile,
	# non soltanto tecnicamente funzionante.
	btn.add_theme_stylebox_override("focus", _row_style(Palette.ROW, 0.85, true))
	btn.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	btn.pressed.connect(func() -> void: _select(item["id"]))
	btn.set_meta("label", SidebarDefs.nav_label(item))
	_buttons[item["id"]] = btn

	# L'icona è un figlio ancorato a metà altezza del Button: resta ferma a
	# sinistra qualunque sia la lunghezza dell'etichetta tradotta, e non
	# intercetta i click (mouse_filter IGNORE nel costruttore).
	var icon := SidebarIcon.new(str(item["icon"]), Palette.BASE)
	icon.anchor_top = 0.5
	icon.anchor_bottom = 0.5
	icon.offset_left = ICON_X
	icon.offset_right = ICON_X + ICON_SIZE
	icon.offset_top = -ICON_SIZE * 0.5
	icon.offset_bottom = ICON_SIZE * 0.5
	btn.add_child(icon)
	_icons[item["id"]] = icon

	var pad := MarginContainer.new()
	pad.add_theme_constant_override("margin_left", 8)
	pad.add_theme_constant_override("margin_right", 8)
	pad.add_child(btn)
	return pad

## Apre (o richiude, se già attiva) la sezione richiesta.
func _select(section: String) -> void:
	if section == "chat":
		_close_panel()
		chat_requested.emit()
		return
	if section == "quit":
		# Passa dal menu pausa invece di chiudere di colpo: la stessa schermata
		# di ESC, raggiunta però col mouse. Chi ha cliccato per sbaglio esce da
		# lì con "Riprendi".
		_close_panel()
		Game.open_pause()
		return
	if _panel and _panel.section == section:
		_close_panel()
		return
	_close_panel()
	_panel = SectionPanel.new(section, WIDTH)
	add_child(_panel)
	_panel.closed.connect(_close_panel)
	_panel.navigate.connect(_select)  # es. box pipeline → positions filtrate
	_set_active(section)
	Sfx.play_blip()

func _close_panel() -> void:
	if _panel:
		_panel.queue_free()
		_panel = null
	_set_active("")

func _set_active(section: String) -> void:
	# Le sezioni-scheda (Monitoraggio) e le pagine di configurazione non hanno
	# più una riga propria: resta accesa quella che le ospita, altrimenti
	# aprendo "Docker" la colonna sembrava non avere nulla di selezionato.
	var host := SidebarDefs.nav_host(section) if section != "" else ""
	for id in _buttons:
		var b: Button = _buttons[id]
		var active: bool = (id == host)
		var unread: bool = id == "chat" and BackendBus.total_chat_unread() > 0
		var tint: Color = Palette.GREEN if active \
				else (Palette.YELLOW if unread else Palette.BASE)
		b.add_theme_color_override("font_color", tint)
		if _icons.has(id):
			_icons[id].color = tint
		# la voce attiva tiene sfondo e barra accento anche fuori hover
		b.add_theme_stylebox_override("normal",
				_row_style(Palette.DEEP, 1.0, true) if active
				else _row_style(Palette.ROW, 0.0, false))

func _refresh_chat_badges() -> void:
	var total := BackendBus.total_chat_unread()
	if _tab:
		_tab.text = "≡  ● %d" % total if total > 0 else "≡"
		_tab.add_theme_color_override("font_color",
				Palette.YELLOW if total > 0 else Palette.GREEN)
	if _buttons.has("chat"):
		var btn: Button = _buttons["chat"]
		btn.text = "%s%s" % [btn.get_meta("label"),
				"  ● %d" % total if total > 0 else ""]
	_set_active(_panel.section if _panel else "")


func _open_activation() -> void:
	if not _open:
		toggle()
	_select("activation")


func _on_setup_status(status: Dictionary) -> void:
	var ready := bool(status.get("ready", false))
	var running := bool(status.get("team_running", false))
	if is_instance_valid(_setup_cta):
		_setup_cta.visible = not (ready and running)
		_setup_cta.text = UIStrings.t("setup.ready_to_start") if ready \
				else UIStrings.t("setup.cta") % int(status.get("completed", 0))
		_setup_cta.add_theme_color_override("font_color",
				Palette.GREEN if ready else Palette.YELLOW)
	if is_instance_valid(_setup_cta_icon):
		_setup_cta_icon.color = Palette.GREEN if ready else Palette.YELLOW
	_refresh_docker_button(status)


func _on_setup_action(action: String, _running: bool, _message: String, _ok: bool) -> void:
	if action == "upgrade-check":
		_refresh_docker_button(SetupService.status)


## La salute runtime e la disponibilita' update sono due assi diversi: il
## badge e' giallo soltanto dopo un check esplicito con changed=true. Un check
## fallito non si trasforma mai in una falsa segnalazione di aggiornamento.
static func docker_sidebar_state(status: Dictionary, check_state: String) -> Dictionary:
	var runtime := "active"
	if not bool(status.get("docker_available", false)) and not bool(status.get("remote", false)):
		runtime = "unreachable"
	elif not bool(status.get("docker_running", false)) and not bool(status.get("remote", false)):
		runtime = "unreachable"
	elif not bool(status.get("container_running", false)):
		runtime = "stopped"
	var badge := check_state if check_state in ["checking", "available", "error"] else ""
	return {"runtime": runtime, "badge": badge}


func _refresh_docker_button(status: Dictionary) -> void:
	if not is_instance_valid(_docker_button) or not is_instance_valid(_docker_icon):
		return
	var check_state := SetupService.runtime_update_check_state()
	var view := docker_sidebar_state(status, check_state)
	var runtime := str(view["runtime"])
	var status_key := "setup.docker_ready"
	var tint := Palette.GREEN
	if runtime == "unreachable":
		status_key = "setup.docker_missing"
		tint = Palette.RED
	elif runtime == "stopped":
		status_key = "setup.container_todo"
		tint = Palette.YELLOW
	_docker_icon.color = tint
	var check_key := "setup.runtime_check_current"
	if check_state == "checking":
		check_key = "setup.runtime_check_busy"
	elif check_state == "available":
		check_key = "setup.runtime_check_available"
	elif check_state == "error":
		check_key = "setup.runtime_check_error"
	elif check_state == "unknown":
		check_key = "setup.runtime_check_unknown"
	_docker_button.tooltip_text = UIStrings.t("side.docker") + " · " \
			+ UIStrings.t(status_key) + " · " + UIStrings.t(check_key)
	if not is_instance_valid(_docker_badge):
		return
	var badge := str(view["badge"])
	_docker_badge.visible = badge != ""
	_docker_badge.text = "◌" if badge == "checking" else ("!" if badge == "error" else "●")
	_docker_badge.add_theme_color_override("font_color",
			Palette.YELLOW if badge in ["checking", "available"] else Palette.RED)


func _on_guided_action(action: String, payload: Dictionary) -> void:
	if OS.get_environment("JHT_GUIDED_TEST") == "1":
		return
	if action == "open_section":
		if not _open:
			toggle()
		_select(str(payload.get("section", "activation")))
	# Il passaggio Assistente → Coordinatore → Mentor nasce sempre da una chat
	# già aperta: è ChatPanel a riusare la stessa finestra. Gestirlo anche qui
	# creerebbe due overlay sovrapposti.
