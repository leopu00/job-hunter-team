class_name SectionPanel
extends CanvasLayer
## Pannello di una sezione della sidebar (scheletro): titolo + placeholder.
## Il contenuto vero arriva sezione per sezione con la migrazione dalla
## desktop app. Si chiude con la ✕ o ricliccando la voce in sidebar.

signal closed
## Chiesto un salto a un'altra sezione (es. box pipeline → positions):
## chi ospita il pannello (la sidebar) decide come aprirla.
signal navigate(section: String)

## Filtro status da applicare al prossimo pannello positions (i box
## della pipeline pre-filtrano come i link del web). Consumato al build.
static var pending_status: Array = []
## Dettaglio da aprire al prossimo pannello positions (click su una
## posizione da un'altra sezione, es. grafici stats). Consumato al build.
static var pending_detail := 0
## Pagina agente da aprire al prossimo pannello agents (click sulla
## card di un agente in scena → scheda con i suoi grafici). Slug di
## RUOLO, come _agent_detail. Consumato al build.
static var pending_agent := ""

var section := ""
var _sidebar_width := 0.0

func _init(p_section: String, sidebar_width: float) -> void:
	section = p_section
	_sidebar_width = sidebar_width
	layer = 19  # sotto la sidebar: la linguetta resta cliccabile
	add_to_group("camera_blocking_overlay")

func _ready() -> void:
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.theme = TerminalTheme.get_theme()
	add_child(root)

	var holder := MarginContainer.new()
	holder.set_anchors_preset(Control.PRESET_FULL_RECT)
	holder.add_theme_constant_override("margin_left", int(_sidebar_width) + 24)
	holder.add_theme_constant_override("margin_right", 120)
	holder.add_theme_constant_override("margin_top", 40)
	holder.add_theme_constant_override("margin_bottom", 60)
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(holder)

	var panel := BracketPanel.new()
	holder.add_child(panel)
	var margin := MarginContainer.new()
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 26)
	panel.add_child(margin)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 12)
	margin.add_child(box)

	_build_breadcrumb(box)
	var title_row := HBoxContainer.new()
	box.add_child(title_row)
	var title := TerminalTheme.label(
			SidebarDefs.title_for(section).to_upper(), 24, Palette.WHITE, "xbold")
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	title_row.add_child(title)
	var close_btn := Button.new()
	close_btn.flat = true
	close_btn.text = "✕"
	close_btn.add_theme_font_size_override("font_size", 20)
	close_btn.add_theme_color_override("font_color", Palette.MUTED)
	close_btn.add_theme_color_override("font_hover_color", Palette.RED)
	close_btn.pressed.connect(func() -> void: closed.emit())
	title_row.add_child(close_btn)

	box.add_child(HSeparator.new())
	_build_tabs(box)
	_content = VBoxContainer.new()
	_content.add_theme_constant_override("separation", 10)
	_content.size_flags_vertical = Control.SIZE_EXPAND_FILL
	box.add_child(_content)
	# TEST-AUTO: JHT_POS_DETAIL=<id> apre il dettaglio di quella posizione
	# appena lo snapshot arriva (il refresh del bus rientra da solo);
	# JHT_AGENT_PAGE=<slug> apre la pagina del singolo agente.
	if section == "positions" and OS.get_environment("JHT_POS_DETAIL") != "":
		_pos_detail_id = int(OS.get_environment("JHT_POS_DETAIL"))
	if section == "positions" and pending_detail != 0:
		_pos_detail_id = pending_detail
		pending_detail = 0
	if section == "agents" and OS.get_environment("JHT_AGENT_PAGE") != "":
		_agent_detail = OS.get_environment("JHT_AGENT_PAGE")
		_build("agent")
		return
	if section == "agents" and pending_agent != "":
		_agent_detail = pending_agent
		pending_agent = ""
		_build("agent")
		return
	_build("detail" if _pos_detail_id != 0 else "")


## Briciola di ritorno per le pagine di configurazione: in sidebar non hanno
## più una riga propria, quindi senza questo link chi ci arriva da Impostazioni
## (o da un passo dell'onboarding) non ha una strada indietro che non sia
## chiudere la finestra e ricominciare.
func _build_breadcrumb(parent: VBoxContainer) -> void:
	if not SidebarDefs.is_settings_section(section):
		return
	var row := HBoxContainer.new()
	parent.add_child(row)
	var back := Button.new()
	back.flat = true
	back.text = "‹  " + SidebarDefs.label_for(SidebarDefs.SETTINGS_HUB)
	back.add_theme_font_size_override("font_size", 13)
	back.add_theme_color_override("font_color", Palette.MUTED)
	back.add_theme_color_override("font_hover_color", Palette.GREEN)
	back.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
	back.pressed.connect(func() -> void: navigate.emit(SidebarDefs.SETTINGS_HUB))
	row.add_child(back)


## Le schede della finestra Monitoraggio. Ognuna è una sezione vera con il suo
## id: il salto passa da `navigate`, lo stesso segnale che la sidebar instrada
## per i link interni, così i deep-link continuano a valere.
func _build_tabs(parent: VBoxContainer) -> void:
	var tabs: Array = SidebarDefs.tabs_for(section)
	if tabs.is_empty():
		return
	# a capo automatico: cinque schede non stanno in riga su una finestra
	# stretta, e una scheda fuori dal bordo è una scheda che non esiste
	var row := HFlowContainer.new()
	row.add_theme_constant_override("h_separation", 4)
	row.add_theme_constant_override("v_separation", 4)
	parent.add_child(row)
	for id in tabs:
		row.add_child(_tab_button(str(id)))


func _tab_button(id: String) -> Button:
	var active := id == section
	var btn := Button.new()
	btn.text = SidebarDefs.label_for(id).to_upper()
	btn.add_theme_font_size_override("font_size", 12)
	btn.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
	for state in ["normal", "hover", "pressed", "disabled"]:
		btn.add_theme_stylebox_override(state, _tab_style(active,
				state == "hover"))
	btn.add_theme_color_override("font_color", Palette.BASE)
	btn.add_theme_color_override("font_hover_color", Palette.WHITE)
	btn.add_theme_color_override("font_disabled_color", Palette.GREEN)
	if active:
		# la scheda corrente non naviga: ricliccarla ricostruirebbe la
		# finestra buttando via filtri e scroll
		btn.disabled = true
	else:
		btn.pressed.connect(func() -> void: navigate.emit(id))
	return btn


static func _tab_style(active: bool, hover: bool) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(Palette.ROW.r, Palette.ROW.g, Palette.ROW.b,
			1.0 if active else (0.7 if hover else 0.0))
	sb.set_border_width_all(0)
	sb.border_width_bottom = 2
	sb.border_color = Palette.GREEN if active else Color(0, 0, 0, 0)
	sb.content_margin_left = 12
	sb.content_margin_right = 12
	sb.content_margin_top = 6
	sb.content_margin_bottom = 5
	return sb


var _content: VBoxContainer

## Contenuto per sezione: le viste migrate hanno il loro builder, le altre
## mostrano il placeholder finché non vengono portate dalla desktop app.
var _current_page := ""

func _build(page := "") -> void:
	_current_page = page
	for child in _content.get_children():
		child.queue_free()
	match section:
		"activation":
			_build_activation()
		"stats":
			if page == "usage":
				_build_usage()
			else:
				_build_stats()
		"map":
			# l'esperienza mappa del web privato: globo → mappa piatta,
			# filtri cross e schede pin che aprono il dettaglio posizione
			if BackendBus.positions_are_demo:
				_content.add_child(TerminalTheme.label(
						UIStrings.t("demo.map"),
						13, Palette.YELLOW, "medium"))
			var wm := WorldMap.new()
			wm.open_position.connect(func(pid: int) -> void:
				pending_detail = pid
				navigate.emit("positions"))
			_content.add_child(wm)
		"team":
			_build_team()
		"agents":
			if page == "agent" and _agent_detail != "":
				_build_agent_page()
			else:
				_build_agents()
		"agent_metrics":
			_build_agent_metrics()
		"usage_history":
			_content.add_child(UsageHistoryView.new())
		"usage_agents":
			_content.add_child(AgentUsageView.new())
		"activity":
			_build_activity()
		"apps":
			_build_apps()
		"dashboard":
			_build_dashboard()
		"notifs":
			_build_notifs()
		"chat":
			_build_chat()
		"settings":
			_build_settings_hub()
		"vps":
			_build_vps()
		"positions":
			if page == "detail" and _pos_detail_id != 0:
				_build_pos_detail()
			else:
				_build_positions()
		"language":
			_build_language()
		"appearance":
			_build_appearance()
		"graphics":
			_build_graphics()
		"profile":
			_build_profile()
		"hours":
			_build_hours()
		"docker":
			_build_container_setup()
		"provider":
			_build_provider_setup()
		"telegram":
			_build_telegram()
		"account":
			_build_account()
		"email":
			_build_email()
		"advanced":
			_build_advanced()
		"feedback":
			if page == "preview":
				_build_feedback_preview()
			else:
				_build_feedback()
		_:
			_build_placeholder()

## Sezioni config: coppie etichetta/valore, SOLA LETTURA — in linea col
## modello desktop-first. Con la VPS collegata mostrano la config VERA
## del team (campi safe da jht.config.json), altrimenti il mock.
func _build_config() -> void:
	if not BackendBus.live_settings_updated.is_connected(_on_config_refresh):
		BackendBus.live_settings_updated.connect(_on_config_refresh)
	var rows: Array = []
	if BackendBus.is_live():
		# connessi: mostra la config VERA — mai il mock spacciato per reale
		rows = BackendBus.live_settings.get(section, [])
		if rows.is_empty():
			_content.add_child(TerminalTheme.label(
					UIStrings.t("config.incoming") if BackendBus.live_settings.is_empty()
					else UIStrings.t("config.not_exposed"), 14, Palette.DIM))
			return
	else:
		rows = TeamData.settings().get(section, [])
	if rows.is_empty():
		_build_placeholder()
		return
	for pair in rows:
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 12)
		_content.add_child(row)
		var lbl := TerminalTheme.label(str(pair[0]), 14, Palette.MUTED, "medium")
		lbl.custom_minimum_size = Vector2(220, 0)
		row.add_child(lbl)
		# a capo automatico: un valore lungo (es. lista skill) non deve
		# allargare il pannello oltre lo schermo
		var val := TerminalTheme.label(str(pair[1]), 16, Palette.BRIGHT)
		val.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		val.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(val)
	_content.add_child(HSeparator.new())
	_content.add_child(TerminalTheme.label(
			UIStrings.t("common.readonly_desktop"), 13, Palette.DIM))


## Il raccoglitore delle dodici pagine di configurazione: riquadri raggruppati
## per cosa si sta configurando, non un secondo elenco verticale. Ogni riquadro
## apre la sezione VERA (stesso id di prima) passando da `navigate`.
func _build_settings_hub() -> void:
	for group in SidebarDefs.SETTINGS_GROUPS:
		_content.add_child(TerminalTheme.label(
				UIStrings.t(str(group["key"])).to_upper(), 12, Palette.DIM, "medium"))
		var grid := HFlowContainer.new()
		grid.add_theme_constant_override("h_separation", 8)
		grid.add_theme_constant_override("v_separation", 8)
		_content.add_child(grid)
		for item in group["items"]:
			grid.add_child(_settings_tile(str(item["id"]), str(item["icon"])))
		_content.add_child(HSeparator.new())
	_content.add_child(TerminalTheme.label(
			UIStrings.t("common.readonly_desktop"), 13, Palette.DIM))


func _settings_tile(id: String, icon_id: String) -> Button:
	var btn := Button.new()
	btn.alignment = HORIZONTAL_ALIGNMENT_LEFT
	btn.text = SidebarDefs.label_for(id)
	btn.custom_minimum_size = Vector2(236, 42)
	btn.add_theme_font_size_override("font_size", 15)
	btn.add_theme_color_override("font_color", Palette.BASE)
	btn.add_theme_color_override("font_hover_color", Palette.WHITE)
	btn.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
	btn.add_theme_stylebox_override("normal", _tile_style(false))
	btn.add_theme_stylebox_override("hover", _tile_style(true))
	btn.add_theme_stylebox_override("pressed", _tile_style(true))
	btn.pressed.connect(func() -> void: navigate.emit(id))
	# L'icona è un figlio ancorato a metà altezza: resta ferma a sinistra
	# qualunque sia la lunghezza dell'etichetta tradotta (stesso schema della
	# sidebar), e non intercetta i click.
	var icon := SidebarIcon.new(icon_id, Palette.MUTED)
	icon.anchor_top = 0.5
	icon.anchor_bottom = 0.5
	icon.offset_left = 12
	icon.offset_right = 30
	icon.offset_top = -9
	icon.offset_bottom = 9
	btn.add_child(icon)
	btn.mouse_entered.connect(func() -> void: icon.color = Palette.GREEN)
	btn.mouse_exited.connect(func() -> void: icon.color = Palette.MUTED)
	return btn


static func _tile_style(hover: bool) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(Palette.ROW.r, Palette.ROW.g, Palette.ROW.b,
			0.9 if hover else 0.35)
	sb.set_border_width_all(TerminalTheme.hairline())
	sb.border_color = Palette.GREEN if hover else Palette.BORDER_GLOW
	sb.content_margin_left = 38
	sb.content_margin_right = 12
	sb.content_margin_top = 8
	sb.content_margin_bottom = 8
	return sb


# ── Servizi tecnici migrati dalla desktop app ───────────────────────

func _build_account() -> void:
	_listen_setup()
	if not BackendBus.live_settings_updated.is_connected(_on_account_settings_refresh):
		BackendBus.live_settings_updated.connect(_on_account_settings_refresh)
	var cloud: Dictionary = SetupService.cloud_status()
	var configured := bool(cloud.get("configured", false))
	_content.add_child(TerminalTheme.label(
			UIStrings.t("account.intro"),
			14, Palette.MUTED))
	_content.add_child(HSeparator.new())
	_setup_state_row(UIStrings.t("account.cloud"), configured,
			UIStrings.t("account.linked") if configured else UIStrings.t("account.local_mode"))
	if configured:
		_setup_state_row(UIStrings.t("account.device"), true,
				str(cloud.get("token_name", "")) if str(cloud.get("token_name", "")) != "" \
				else UIStrings.t("account.device_paired"))
		_setup_state_row(UIStrings.t("account.server"), true, str(cloud.get("base_url", "—")))
	var actions := HBoxContainer.new()
	actions.add_theme_constant_override("separation", 10)
	_content.add_child(actions)
	var login := Button.new()
	login.text = UIStrings.t("account.login_again") if configured \
			else UIStrings.t("account.login")
	login.disabled = not bool(SetupService.status.get("container_running", false))
	login.add_theme_color_override("font_color", Palette.GREEN)
	login.pressed.connect(SetupService.open_cloud_login.bind(true))
	actions.add_child(login)
	var other_login := Button.new()
	other_login.text = UIStrings.t("account.other_account")
	other_login.disabled = not bool(SetupService.status.get("container_running", false))
	other_login.pressed.connect(SetupService.open_cloud_login.bind(false))
	actions.add_child(other_login)
	for entry in [["account.status", "status"], ["account.sync_now", "push"],
			["account.pull_profile", "pull-profile"]]:
		var button := Button.new()
		button.text = UIStrings.t(str(entry[0]))
		button.disabled = not configured
		button.pressed.connect(SetupService.open_cloud_command.bind(str(entry[1])))
		actions.add_child(button)
	if configured:
		var disable := Button.new()
		disable.text = UIStrings.t("account.disable_sync")
		disable.add_theme_color_override("font_color", Palette.RED)
		disable.pressed.connect(_confirm_cloud_disable)
		_content.add_child(disable)
	var recovery := HBoxContainer.new()
	recovery.add_theme_constant_override("separation", 10)
	_content.add_child(recovery)
	var restore := Button.new()
	restore.text = UIStrings.t("account.restore")
	restore.disabled = not configured
	restore.add_theme_color_override("font_color", Palette.YELLOW)
	restore.pressed.connect(SetupService.open_cloud_command.bind("restore"))
	recovery.add_child(restore)
	var manage := Button.new()
	manage.text = UIStrings.t("account.manage_devices")
	manage.pressed.connect(func() -> void:
		OS.shell_open("https://jobhunterteam.ai/settings/cloud-sync"))
	recovery.add_child(manage)
	_content.add_child(TerminalTheme.label(
			UIStrings.t("account.privacy_note"),
			12, Palette.DIM))
	_setup_message = TerminalTheme.label("", 13, Palette.DIM)
	_content.add_child(_setup_message)


func _confirm_cloud_disable() -> void:
	var dialog := ConfirmationDialog.new()
	dialog.title = UIStrings.t("account.disable_title")
	dialog.dialog_text = UIStrings.t("account.disable_body")
	dialog.ok_button_text = UIStrings.t("account.disable_ok")
	dialog.confirmed.connect(SetupService.open_cloud_command.bind("disable"))
	dialog.canceled.connect(dialog.queue_free)
	dialog.confirmed.connect(dialog.queue_free)
	add_child(dialog)
	dialog.popup_centered(Vector2i(620, 260))


func _on_account_settings_refresh(_settings: Dictionary) -> void:
	if section == "account" and is_instance_valid(_content):
		_build()


func _build_email() -> void:
	_listen_setup()
	if not BackendBus.live_settings_updated.is_connected(_on_email_settings_refresh):
		BackendBus.live_settings_updated.connect(_on_email_settings_refresh)
	var state: Dictionary = SetupService.email_status()
	var configured := bool(state.get("configured", false))
	_content.add_child(TerminalTheme.label(
			UIStrings.t("email.intro"),
			14, Palette.MUTED))
	_content.add_child(HSeparator.new())
	_setup_state_row(UIStrings.t("email.status"), configured,
			UIStrings.t("email.configured") + str(state.get("email", "")) if configured \
			else UIStrings.t("email.none"))
	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 18)
	grid.add_theme_constant_override("v_separation", 10)
	_content.add_child(grid)
	grid.add_child(TerminalTheme.label(UIStrings.t("email.address"), 13, Palette.MUTED, "medium"))
	var email := LineEdit.new()
	email.text = str(state.get("email", ""))
	email.placeholder_text = "nome.jht@gmail.com"
	email.custom_minimum_size = Vector2(560, 0)
	grid.add_child(email)
	grid.add_child(TerminalTheme.label(UIStrings.t("email.app_password"), 13, Palette.MUTED, "medium"))
	var password := LineEdit.new()
	password.secret = true
	password.placeholder_text = UIStrings.t("email.password_ph")
	password.custom_minimum_size = Vector2(560, 0)
	grid.add_child(password)
	var note := TerminalTheme.label(
			UIStrings.t("email.note"),
			12, Palette.YELLOW)
	note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_content.add_child(note)
	var actions := HBoxContainer.new()
	actions.add_theme_constant_override("separation", 10)
	_content.add_child(actions)
	var save := Button.new()
	save.text = UIStrings.t("email.save")
	save.disabled = not bool(SetupService.status.get("container_running", false))
	save.add_theme_color_override("font_color", Palette.GREEN)
	save.pressed.connect(func() -> void:
		SetupService.save_email(email.text, password.text)
		password.clear())
	actions.add_child(save)
	var remove := Button.new()
	remove.text = UIStrings.t("email.remove")
	remove.disabled = not configured
	remove.add_theme_color_override("font_color", Palette.RED)
	remove.pressed.connect(SetupService.delete_email)
	actions.add_child(remove)
	var help := Button.new()
	help.text = UIStrings.t("email.help")
	help.pressed.connect(func() -> void:
		OS.shell_open("https://support.google.com/accounts/answer/185833"))
	actions.add_child(help)
	_setup_message = TerminalTheme.label("", 13, Palette.DIM)
	_content.add_child(_setup_message)


func _build_telegram() -> void:
	_listen_setup()
	var states: Dictionary = SetupService.telegram_status()
	_content.add_child(TerminalTheme.label(
			UIStrings.t("tg.intro"),
			14, Palette.MUTED))
	var actions := HBoxContainer.new()
	actions.add_theme_constant_override("separation", 10)
	_content.add_child(actions)
	var botfather := Button.new()
	botfather.text = UIStrings.t("tg.botfather")
	botfather.pressed.connect(func() -> void: OS.shell_open("https://t.me/BotFather"))
	actions.add_child(botfather)
	var guide := TerminalTheme.label(
			UIStrings.t("tg.guide"),
			12, Palette.YELLOW)
	guide.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	guide.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	actions.add_child(guide)
	_content.add_child(HSeparator.new())
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_content.add_child(scroll)
	var list := VBoxContainer.new()
	list.add_theme_constant_override("separation", 12)
	list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(list)
	var details := {
		"assistente": UIStrings.t("tg.role_assistente"),
		"capitano": UIStrings.t("tg.role_capitano"),
		"mentor": UIStrings.t("tg.role_mentor"),
	}
	for role in ["assistente", "capitano", "mentor"]:
		var state: Dictionary = states.get(role, {}) \
				if states.get(role, {}) is Dictionary else {}
		var panel := BracketPanel.new()
		list.add_child(panel)
		var pad := MarginContainer.new()
		for side in ["left", "right", "top", "bottom"]:
			pad.add_theme_constant_override("margin_" + side, 14)
		panel.add_child(pad)
		var col := VBoxContainer.new()
		col.add_theme_constant_override("separation", 8)
		pad.add_child(col)
		var head := HBoxContainer.new()
		col.add_child(head)
		head.add_child(TerminalTheme.label(role.to_upper(), 17, Palette.WHITE, "bold"))
		var role_detail := TerminalTheme.label("  ·  " + str(details[role]), 13, Palette.MUTED)
		role_detail.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		head.add_child(role_detail)
		head.add_child(TerminalTheme.label(
				UIStrings.t("tg.configured") if bool(state.get("configured", false)) \
				else UIStrings.t("tg.to_link"), 13,
				Palette.GREEN if bool(state.get("configured", false)) else Palette.YELLOW,
				"medium"))
		var fields := HBoxContainer.new()
		fields.add_theme_constant_override("separation", 10)
		col.add_child(fields)
		var token := LineEdit.new()
		token.secret = true
		token.placeholder_text = UIStrings.t("tg.token_ph")
		token.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		fields.add_child(token)
		var chat_id := LineEdit.new()
		chat_id.placeholder_text = UIStrings.t("tg.chat_id_ph")
		chat_id.custom_minimum_size = Vector2(360, 0)
		fields.add_child(chat_id)
		var save := Button.new()
		save.text = UIStrings.t("tg.save")
		save.disabled = not bool(SetupService.status.get("container_running", false))
		save.add_theme_color_override("font_color", Palette.GREEN)
		save.pressed.connect(func() -> void:
			SetupService.save_telegram_bot(role, token.text, chat_id.text)
			token.clear())
		fields.add_child(save)
		if bool(state.get("configured", false)):
			var remove := Button.new()
			remove.text = UIStrings.t("tg.remove")
			remove.add_theme_color_override("font_color", Palette.RED)
			remove.pressed.connect(SetupService.delete_telegram_bot.bind(role))
			fields.add_child(remove)
	_setup_message = TerminalTheme.label("", 13, Palette.DIM)
	_content.add_child(_setup_message)


func _on_email_settings_refresh(_settings: Dictionary) -> void:
	if section == "email" and is_instance_valid(_content):
		_build()


func _build_advanced() -> void:
	_listen_setup()
	_content.add_child(TerminalTheme.label(
			UIStrings.t("advanced.intro"),
			14, Palette.MUTED))
	_content.add_child(HSeparator.new())
	var actions := HBoxContainer.new()
	actions.add_theme_constant_override("separation", 10)
	_content.add_child(actions)
	var doctor := Button.new()
	doctor.text = UIStrings.t("advanced.doctor")
	doctor.disabled = not bool(SetupService.status.get("container_running", false))
	doctor.add_theme_color_override("font_color", Palette.GREEN)
	doctor.pressed.connect(SetupService.open_doctor)
	actions.add_child(doctor)
	var setup := Button.new()
	setup.text = UIStrings.t("advanced.review_setup")
	setup.pressed.connect(func() -> void: navigate.emit("activation"))
	actions.add_child(setup)
	var install := Button.new()
	install.text = UIStrings.t("advanced.reinstall")
	install.pressed.connect(SetupService.open_runtime_install)
	actions.add_child(install)
	# Seconda porta d'ingresso: chi ha un problema apre la diagnostica prima
	# di cercare un modulo di segnalazione, ed è qui che va incontrato.
	var report := Button.new()
	report.text = UIStrings.t("feedback.send")
	report.pressed.connect(func() -> void: navigate.emit("feedback"))
	actions.add_child(report)
	var files := HBoxContainer.new()
	files.add_theme_constant_override("separation", 10)
	_content.add_child(files)
	var open_data := Button.new()
	open_data.text = UIStrings.t("advanced.open_data")
	open_data.pressed.connect(func() -> void:
		OS.shell_open(SetupService._jht_home()))
	files.add_child(open_data)
	var open_log := Button.new()
	open_log.text = UIStrings.t("advanced.open_log")
	open_log.pressed.connect(func() -> void:
		OS.shell_open(ProjectSettings.globalize_path("user://jht-game.log").get_base_dir()))
	files.add_child(open_log)
	# Niente pulsante "dashboard web locale": la UI browser su localhost:3000
	# è stata ritirata con la native desktop migration — tutta l'interazione
	# local/VPS vive nel gioco; il browser serve solo il cloud (con login).
	_content.add_child(HSeparator.new())
	_content.add_child(TerminalTheme.label(
			UIStrings.t("advanced.version") % [
					ProjectSettings.get_setting("application/config/version", "dev"),
					SetupService._jht_home()], 12, Palette.DIM))
	_build_update_block()
	_setup_message = TerminalTheme.label("", 13, Palette.DIM)
	_content.add_child(_setup_message)


## L'interruttore dell'aggiornamento automatico, accanto al numero di versione:
## è lì che si guarda quando ci si chiede "sono aggiornato?", ed è lì che deve
## esserci la risposta e il modo di spegnere la domanda.
func _build_update_block() -> void:
	_content.add_child(HSeparator.new())
	_content.add_child(TerminalTheme.label(UIStrings.t("update.section"), 13,
			Palette.BRIGHT, "bold"))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	_content.add_child(row)
	row.add_child(TerminalTheme.label(UIStrings.t("update.auto"), 13, Palette.BASE))
	var auto_switch := CheckButton.new()
	auto_switch.button_pressed = UpdateService.enabled()
	row.add_child(auto_switch)
	var check_now := Button.new()
	check_now.text = UIStrings.t("update.check_now")
	check_now.disabled = not auto_switch.button_pressed
	check_now.pressed.connect(func() -> void: UpdateService.check(true))
	row.add_child(check_now)
	auto_switch.toggled.connect(func(on: bool) -> void:
		UpdateService.set_enabled(on)
		check_now.disabled = not on)
	var hint := TerminalTheme.label(UIStrings.t("update.auto_hint"), 12, Palette.DIM)
	hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_content.add_child(hint)
	# Cosa succede quando si accetta, che è diverso a seconda del sistema: su
	# macOS il pacchetto è firmato e il gioco può sostituirsi da solo, altrove
	# l'aggiornamento apre la pagina della release e si ferma lì.
	var how := TerminalTheme.label(UIStrings.t("update.signed"
			if UpdateCheck.can_self_install(OS.get_name()) else "update.manual_only"),
			12, Palette.DIM)
	how.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_content.add_child(how)
	var status := TerminalTheme.label("", 13, Palette.MUTED, "medium")
	status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_content.add_child(status)
	status.text = _update_line(UpdateService.state())
	UpdateService.state_changed.connect(func(state: Dictionary) -> void:
		if is_instance_valid(status):
			status.text = _update_line(state))


## Dice sempre qualcosa: "mai controllato" è un'informazione, una riga vuota è
## un dubbio — e il dubbio su un aggiornamento porta l'utente a cercarlo a mano.
func _update_line(state: Dictionary) -> String:
	match str(state.get("phase", "")):
		UpdateService.PHASE_CHECKING:
			return UIStrings.t("update.checking")
		UpdateService.PHASE_AVAILABLE:
			return UIStrings.t("update.available") % [str(state.get("latest", "")),
					str(state.get("current", ""))]
		UpdateService.PHASE_DOWNLOADING:
			return UIStrings.t("update.downloading") % int(state.get("progress", 0))
		UpdateService.PHASE_INSTALLING:
			return UIStrings.t("update.installing")
		UpdateService.PHASE_DONE:
			return UIStrings.t("update.installed") % str(state.get("latest", ""))
		UpdateService.PHASE_FAILED:
			return UIStrings.t("update.failed") % UIStrings.t(str(state.get("error", "")))
		UpdateService.PHASE_CURRENT:
			return UIStrings.t("update.current") % str(state.get("current", ""))
	var last := float(state.get("last_check", 0.0))
	if last <= 0.0:
		return UIStrings.t("update.never")
	# L'ora locale: un orario UTC in una riga di stato è un piccolo enigma.
	var bias := int(Time.get_time_zone_from_system().get("bias", 0)) * 60
	return UIStrings.t("update.last") % Time.get_datetime_string_from_unix_time(
			int(last) + bias, true)


# ── Segnalazione di un problema ──────────────────────────────────────
#
# Il canale con cui un utente ci racconta un bug. Il template GitHub chiede
# `tmux capture-pane`, la versione di Docker e quale ruolo agente ha fallito:
# domande giuste per uno sviluppatore, impossibili per la persona a cui
# abbiamo promesso che non avrebbe mai aperto un terminale. Qui il costo per
# l'utente sono tre frasi, e tutto il resto lo raccoglie il gioco.

## I campi sopravvivono al passaggio all'anteprima e ritorno: farglieli
## riscrivere sarebbe il modo più veloce per non ricevere più segnalazioni.
var _fb_form := {"doing": "", "happened": "", "expected": "", "contact": ""}
var _fb_include_logs := true
var _fb_include_container := true
var _fb_status: Label
var _fb_redaction: Label
var _fb_send: Button

const FB_FIELDS := [
	["doing", "feedback.q_doing", "feedback.ph_doing", 60],
	["happened", "feedback.q_happened", "feedback.ph_happened", 90],
	["expected", "feedback.q_expected", "feedback.ph_expected", 60],
]


func _build_feedback() -> void:
	_listen_feedback()
	var intro := TerminalTheme.label(UIStrings.t("feedback.intro"), 14, Palette.MUTED)
	intro.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_content.add_child(intro)
	_content.add_child(HSeparator.new())

	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_content.add_child(scroll)
	var list := VBoxContainer.new()
	list.add_theme_constant_override("separation", 10)
	list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(list)

	for field in FB_FIELDS:
		var key := str(field[0])
		list.add_child(TerminalTheme.label(
				UIStrings.t(str(field[1])), 13, Palette.MUTED, "medium"))
		var edit := TextEdit.new()
		edit.text = str(_fb_form[key])
		edit.placeholder_text = UIStrings.t(str(field[2]))
		edit.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
		edit.custom_minimum_size = Vector2(0, int(field[3]))
		edit.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		edit.text_changed.connect(func() -> void:
			_fb_form[key] = edit.text
			_refresh_feedback_send())
		list.add_child(edit)

	list.add_child(TerminalTheme.label(
			UIStrings.t("feedback.q_contact"), 13, Palette.MUTED, "medium"))
	var contact := LineEdit.new()
	contact.text = str(_fb_form["contact"])
	contact.placeholder_text = UIStrings.t("feedback.ph_contact")
	contact.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	contact.text_changed.connect(func(value: String) -> void:
		_fb_form["contact"] = value)
	list.add_child(contact)
	var contact_hint := TerminalTheme.label(
			UIStrings.t("feedback.contact_hint"), 12, Palette.DIM)
	contact_hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	list.add_child(contact_hint)

	list.add_child(HSeparator.new())
	var attach := HBoxContainer.new()
	attach.add_theme_constant_override("separation", 18)
	list.add_child(attach)
	attach.add_child(_fb_toggle("feedback.attach_diag", _fb_include_logs,
			func(on: bool) -> void:
				_fb_include_logs = on
				_collect_feedback_preview()))
	attach.add_child(_fb_toggle("feedback.attach_container", _fb_include_container,
			func(on: bool) -> void:
				_fb_include_container = on
				_collect_feedback_preview()))

	_fb_redaction = TerminalTheme.label(
			UIStrings.t("feedback.collecting"), 12, Palette.YELLOW)
	_fb_redaction.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	list.add_child(_fb_redaction)

	var actions := HBoxContainer.new()
	actions.add_theme_constant_override("separation", 10)
	_content.add_child(actions)
	_fb_send = Button.new()
	_fb_send.text = UIStrings.t("feedback.send")
	_fb_send.add_theme_color_override("font_color", Palette.GREEN)
	_fb_send.pressed.connect(_submit_feedback)
	actions.add_child(_fb_send)
	# "Vedi cosa stai inviando" non è un vezzo: è ciò che rende il consenso
	# reale invece che una casella spuntata al buio.
	var preview := Button.new()
	preview.text = UIStrings.t("feedback.preview_btn")
	preview.pressed.connect(func() -> void: _build("preview"))
	actions.add_child(preview)
	var folder := Button.new()
	folder.text = UIStrings.t("feedback.open_folder")
	folder.pressed.connect(FeedbackService.open_reports_folder)
	actions.add_child(folder)

	_fb_status = TerminalTheme.label("", 13, Palette.DIM)
	_fb_status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_content.add_child(_fb_status)
	_refresh_feedback_send()
	_refresh_feedback_redaction()
	_collect_feedback_preview()


## Quel che l'utente sta per spedire, per esteso e in sola lettura. Nessuna
## sorpresa: questo testo è letteralmente il corpo che parte.
func _build_feedback_preview() -> void:
	_listen_feedback()
	var note := TerminalTheme.label(UIStrings.t("feedback.preview_title"), 14, Palette.MUTED)
	note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_content.add_child(note)
	var back := Button.new()
	back.text = UIStrings.t("feedback.back")
	back.pressed.connect(func() -> void: _build())
	_content.add_child(back)
	_content.add_child(HSeparator.new())
	var body := TextEdit.new()
	body.editable = false
	body.text = FeedbackService.preview_markdown if FeedbackService.preview_markdown != "" \
			else UIStrings.t("feedback.collecting")
	body.wrap_mode = TextEdit.LINE_WRAPPING_BOUNDARY
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	body.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_content.add_child(body)


func _fb_toggle(key: String, value: bool, on_change: Callable) -> CheckBox:
	var box := CheckBox.new()
	box.text = UIStrings.t(key)
	box.button_pressed = value
	box.toggled.connect(on_change)
	return box


func _listen_feedback() -> void:
	if not FeedbackService.preview_changed.is_connected(_on_feedback_preview):
		FeedbackService.preview_changed.connect(_on_feedback_preview)
	if not FeedbackService.submit_changed.is_connected(_on_feedback_submit):
		FeedbackService.submit_changed.connect(_on_feedback_submit)


func _collect_feedback_preview() -> void:
	FeedbackService.build_preview(_fb_include_logs, _fb_include_container)


## Il racconto di cosa è successo è l'unico campo davvero necessario: senza
## quello non c'è segnalazione, con quello si parte anche se il resto è vuoto.
func _refresh_feedback_send() -> void:
	if not is_instance_valid(_fb_send):
		return
	var ready := str(_fb_form["happened"]).strip_edges().length() >= 10
	_fb_send.disabled = not ready
	# Il colore segue lo stato: un pulsante verde acceso che non risponde al
	# click si legge come un bug del gioco, proprio nella schermata in cui si
	# chiede fiducia all'utente. Serve l'override di font_disabled_color e non
	# di font_color: il tema terminale colora di verde ANCHE i pulsanti
	# disabilitati, quindi senza questa riga lo stato non si vedrebbe.
	_fb_send.add_theme_color_override("font_color", Palette.GREEN)
	_fb_send.add_theme_color_override("font_disabled_color", Palette.MUTED)


func _refresh_feedback_redaction() -> void:
	if not is_instance_valid(_fb_redaction):
		return
	var counts: Dictionary = FeedbackService.preview_counts
	var total := 0
	for key in counts:
		total += int(counts[key])
	_fb_redaction.text = UIStrings.t("feedback.redacted_none") if total == 0 \
			else UIStrings.t("feedback.redacted_count") % total


func _submit_feedback() -> void:
	FeedbackService.submit(_fb_form, _fb_include_logs, _fb_include_container)


func _on_feedback_preview(running: bool, _markdown: String, _counts: Dictionary) -> void:
	if section != "feedback" or not is_instance_valid(_fb_redaction):
		return
	if running:
		_fb_redaction.text = UIStrings.t("feedback.collecting")
		return
	_refresh_feedback_redaction()


func _on_feedback_submit(running: bool, ok: bool, message: String, ticket: String) -> void:
	if section != "feedback" or not is_instance_valid(_fb_status):
		return
	_fb_status.text = message
	if not ticket.is_empty():
		_fb_status.text += "  ·  " + UIStrings.t("feedback.ticket") % ticket
	# Anche quando l'invio fallisce l'utente non resta a mani vuote: la copia
	# su disco esiste già e gliela indichiamo.
	if not running and not ok and FeedbackService.last_saved_path != "":
		_fb_status.text += "\n" + UIStrings.t("feedback.saved_copy") \
				% FeedbackService.last_saved_path
	_fb_status.add_theme_color_override("font_color",
			Palette.DIM if running else (Palette.GREEN if ok else Palette.YELLOW))
	if is_instance_valid(_fb_send):
		_fb_send.disabled = running
	if not running and ok:
		# Inviata: si azzera il modulo, così un secondo invio accidentale non
		# rispedisce lo stesso racconto.
		for key in _fb_form:
			_fb_form[key] = ""


# ── Attivazione iniziale (ufficio aperto, lavoro sotto gate) ─────────

var _setup_message: Label
## Specchio locale di SetupService.busy(): serve a ricostruire il pannello UNA
## volta quando un'azione parte o finisce (i progressi intermedi arrivano ogni
## ~1.5s e non devono rifare la UI, solo aggiornare la riga di stato).
var _setup_busy_ui := false
## Ultimo messaggio d'azione, per non perderlo quando il pannello si ricostruisce
## a metà operazione (cambio fase, avvio azione).
var _action_note := ""
var _action_note_color: Color = Palette.DIM
## Le azioni di setup che i pannelli attivazione/docker/provider/team sanno
## rappresentare coi loro pulsanti: al loro avvio/fine il pannello va ridisegnato.
const SETUP_ACTIONS := ["container", "team", "provider", "plan", "install"]
const SETUP_SECTIONS := ["activation", "docker", "provider", "team"]

func _listen_setup() -> void:
	if not SetupService.status_changed.is_connected(_on_setup_refresh):
		SetupService.status_changed.connect(_on_setup_refresh)
	if not SetupService.action_changed.is_connected(_on_setup_action):
		SetupService.action_changed.connect(_on_setup_action)
	if not SetupService.phase_changed.is_connected(_on_setup_phase):
		SetupService.phase_changed.connect(_on_setup_phase)
	_setup_busy_ui = SetupService.busy()


func _build_activation() -> void:
	_listen_setup()
	var s: Dictionary = SetupService.status
	_content.add_child(TerminalTheme.label(
			UIStrings.t("setup.intro"), 16, Palette.BASE))
	_content.add_child(TerminalTheme.label(
			UIStrings.t("setup.office_open"), 13, Palette.MUTED))
	var guided := HBoxContainer.new()
	guided.add_theme_constant_override("separation", 10)
	_content.add_child(guided)
	var guided_label := TerminalTheme.label(
			UIStrings.t("setup.tour_progress") % ScriptedOnboarding.completed_count(),
			13, Palette.MINT, "medium")
	guided_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	guided.add_child(guided_label)
	for entry in [["assistente", "setup.tour_assistant"],
			["coordinatore", "setup.tour_coordinator"], ["mentor", "setup.tour_mentor"]]:
		var label := UIStrings.t(str(entry[1]))
		var chat := Button.new()
		chat.text = ("✓ " if ScriptedOnboarding.is_complete(str(entry[0])) else "▶ ") + label
		chat.add_theme_color_override("font_color", Palette.GREEN)
		chat.pressed.connect(func() -> void:
			add_child(ChatPanel.new(str(entry[0]), label.capitalize())))
		guided.add_child(chat)
	var progress := HBoxContainer.new()
	progress.add_theme_constant_override("separation", 12)
	_content.add_child(progress)
	# Il passo 01 non è "accendi un container": è DOVE vive il team. Chi ha una
	# VPS la usa come casa degli agenti e tiene questa finestra come specchio;
	# la scelta esisteva solo sepolta in Impostazioni → Collega VPS, e
	# nell'onboarding non compariva affatto (Leone, 26/07).
	var on_vps: bool = BackendBus.is_remote() and BackendBus.is_live()
	_setup_gate(progress, "01", UIStrings.t("setup.where"),
			bool(s.get("container_running", false)) or on_vps,
			UIStrings.t("setup.where_vps") if on_vps
			else (UIStrings.t("setup.where_local") if bool(s.get("container_running", false))
			else UIStrings.t("setup.where_todo")), "docker")
	# Passi che il team connesso non ha saputo raccontare: si dicono ignoti. Il
	# valore di questo computer non è una risposta — su una VPS è di un'altra
	# macchina, e nel caso peggiore di un'altra persona.
	var unknown: Array = s.get("unknown_steps", [])
	_setup_gate(progress, "02", UIStrings.t("setup.provider"),
			bool(s.get("provider_authenticated", false))
					and bool(s.get("plan_ready", false)),
			_provider_status_text(s), "provider", unknown.has("provider"))
	_setup_gate(progress, "03", UIStrings.t("setup.profile"),
			bool(s.get("profile_ready", false)),
			UIStrings.t("setup.remote_unknown") if unknown.has("profile")
			else (UIStrings.t("setup.profile_ok") if bool(s.get("profile_ready", false))
			else UIStrings.t("setup.profile_todo")), "profile", unknown.has("profile"))
	# Quarto passo, obbligatorio come gli altri: senza finestre di lavoro il
	# team macina a ogni ora del giorno e il conto arriva dopo.
	_setup_gate(progress, "04", UIStrings.t("setup.hours"),
			bool(s.get("hours_ready", false)),
			UIStrings.t("setup.remote_unknown") if unknown.has("hours")
			else (UIStrings.t("setup.hours_ok") if bool(s.get("hours_ready", false))
			else UIStrings.t("setup.hours_todo")), "hours", unknown.has("hours"))
	_content.add_child(HSeparator.new())
	var bottom := HBoxContainer.new()
	bottom.add_theme_constant_override("separation", 14)
	_content.add_child(bottom)
	var summary := TerminalTheme.label(
			UIStrings.t("setup.progress") % int(s.get("completed", 0)),
			15, Palette.GREEN if bool(s.get("ready", false)) else Palette.YELLOW,
			"bold")
	summary.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	summary.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	bottom.add_child(summary)
	var start := Button.new()
	# Tre stati, tre etichette: attivo (●), avvio in corso (◌, mentre il
	# comando gira), pronto da premere (▶). Prima il pulsante restava "ATTIVA
	# IL TEAM" anche durante l'avvio e non diceva se il click era passato.
	if bool(s.get("team_running", false)):
		start.text = UIStrings.t("setup.team_running")
	elif SetupService.busy() and SetupService.current_action == "team":
		start.text = UIStrings.t("setup.team_starting")
	else:
		start.text = UIStrings.t("setup.start_team")
	start.disabled = not bool(s.get("ready", false)) \
			or bool(s.get("team_running", false)) or SetupService.busy()
	start.add_theme_font_size_override("font_size", 17)
	start.add_theme_color_override("font_color", Palette.GREEN)
	start.pressed.connect(SetupService.start_team)
	bottom.add_child(start)
	_setup_message = TerminalTheme.label("", 13, Palette.DIM)
	_content.add_child(_setup_message)
	_restore_action_note()


func _setup_gate(parent: HBoxContainer, number: String, title: String,
		done: bool, detail: String, destination: String,
		unknown := false) -> void:
	var panel := BracketPanel.new()
	panel.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	panel.custom_minimum_size = Vector2(260, 180)
	parent.add_child(panel)
	var pad := MarginContainer.new()
	for side in ["left", "right", "top", "bottom"]:
		pad.add_theme_constant_override("margin_" + side, 16)
	panel.add_child(pad)
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 8)
	pad.add_child(col)
	# Terzo stato accanto a fatto (✓) e da fare (○): il valore vive sulla
	# macchina connessa e non siamo riusciti a leggerlo. Dirlo con uno degli
	# altri due sarebbe inventarlo.
	var tint: Color = Palette.DIM if unknown \
			else (Palette.GREEN if done else Palette.YELLOW)
	col.add_child(TerminalTheme.label(
			number + "  " + ("?" if unknown else ("✓" if done else "○")),
			14, tint, "bold"))
	col.add_child(TerminalTheme.label(title.to_upper(), 19, Palette.WHITE, "bold"))
	var body := TerminalTheme.label(detail, 13, Palette.MUTED)
	body.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	col.add_child(body)
	var open := Button.new()
	open.text = UIStrings.t("setup.review") if done else UIStrings.t("setup.configure")
	open.add_theme_color_override("font_color", tint)
	open.pressed.connect(func() -> void:
		if destination == "profile":
			Game.goto_wizard()
		else:
			navigate.emit(destination))
	col.add_child(open)


func _provider_status_text(s: Dictionary) -> String:
	if (s.get("unknown_steps", []) as Array).has("provider"):
		return UIStrings.t("setup.remote_unknown")
	var id := str(s.get("active_provider", ""))
	if id == "":
		return UIStrings.t("setup.provider_todo")
	var name := str(SetupService.PROVIDERS.get(id, {}).get("name", id))
	if not bool(s.get("provider_authenticated", false)):
		return UIStrings.t("setup.provider_login") % name
	if not bool(s.get("plan_ready", false)):
		return UIStrings.t("setup.plan_todo") % name
	return UIStrings.t("setup.provider_ok") % name


func _build_container_setup() -> void:
	_listen_setup()
	var s: Dictionary = SetupService.status
	# L'attivazione è UN pulsante ma un processo a più fasi: motore Docker →
	# immagine → container → team. Le righe qui sotto sono quella filiera,
	# nell'ordine in cui succede davvero, e durante l'attivazione la fase in
	# corso è marcata ◌: l'utente vede A CHE PUNTO è, non solo che "qualcosa
	# gira" (feedback 30/07).
	var busy := SetupService.busy() and SetupService.current_action == "container"
	var phase: String = SetupService.action_phase if busy else ""
	_content.add_child(TerminalTheme.label(UIStrings.t("setup.container_lead"),
			15, Palette.BASE))
	_content.add_child(HSeparator.new())
	_setup_phase_row(UIStrings.t("setup.phase_engine"),
			_phase_state(bool(s.get("docker_running", false)), phase == "engine"),
			UIStrings.t("setup.phase_running") if phase == "engine"
			else (UIStrings.t("setup.docker_ready") if bool(s.get("docker_running", false))
			else UIStrings.t("setup.docker_missing")))
	_setup_phase_row(UIStrings.t("setup.phase_image"),
			_phase_state(str(s.get("image_id", "")) != "" or bool(s.get("remote", false)),
					phase == "image"),
			UIStrings.t("setup.phase_running") if phase == "image"
			else (UIStrings.t("setup.image_ready") if str(s.get("image_id", "")) != ""
					or bool(s.get("remote", false))
			else UIStrings.t("setup.image_missing")))
	_setup_phase_row(UIStrings.t("setup.phase_container"),
			_phase_state(bool(s.get("container_running", false)), phase == "container"),
			UIStrings.t("setup.phase_running") if phase == "container"
			else str(s.get("container_state", "missing")))
	# Runtime obsoleto: il container gira su un'immagine diversa da quella
	# scaricata. Senza questa riga l'utente resta su una versione vecchia
	# senza avere modo di accorgersene.
	if bool(s.get("container_exists", false)) and not bool(s.get("remote", false)):
		_setup_phase_row(UIStrings.t("setup.runtime_version"),
				"warn" if bool(s.get("runtime_stale", false)) else "done",
				UIStrings.t("setup.runtime_stale") if bool(s.get("runtime_stale", false))
				else UIStrings.t("setup.runtime_current"))
	var team_phase := SetupService.busy() and SetupService.current_action == "team"
	_setup_phase_row(UIStrings.t("setup.phase_team"),
			_phase_state(bool(s.get("team_running", false)), team_phase),
			UIStrings.t("setup.phase_running") if team_phase
			else (UIStrings.t("setup.team_on") if bool(s.get("team_running", false))
			else UIStrings.t("setup.team_stopped")))
	_content.add_child(HSeparator.new())
	var actions := HBoxContainer.new()
	actions.add_theme_constant_override("separation", 12)
	_content.add_child(actions)
	# UN pulsante che fa la cosa giusta. "ATTIVA CONTAINER" già accende Docker
	# se è spento, crea il container se manca e scarica l'immagine: gli altri
	# comandi erano riparazioni messe in fila come se fossero alternative, e
	# costringevano l'utente a scegliere fra opzioni che non deve conoscere
	# (Leone, 25/07). Ora compaiono SOLO nel caso in cui servono davvero.
	# Mentre l'azione gira il pulsante LO DICE e non è premibile: prima restava
	# identico e muto, e l'utente non sapeva se ripremere (feedback 30/07).
	var start := Button.new()
	if busy:
		start.text = UIStrings.t("setup.container_busy")
		start.disabled = true
	elif bool(s.get("container_running", false)):
		start.text = UIStrings.t("setup.container_recheck")
		start.pressed.connect(SetupService.refresh)
	else:
		start.text = UIStrings.t("setup.container_start")
		start.pressed.connect(SetupService.start_container)
	start.disabled = start.disabled or SetupService.busy()
	start.add_theme_font_size_override("font_size", 16)
	start.add_theme_color_override("font_color", Palette.GREEN)
	actions.add_child(start)
	# Docker assente: senza motore non si accende niente, e questa è l'unica
	# azione sensata da offrire.
	if not bool(s.get("docker_available", false)) and not bool(s.get("remote", false)):
		var install := Button.new()
		install.text = UIStrings.t("setup.docker_install")
		install.disabled = SetupService.busy()
		install.add_theme_color_override("font_color", Palette.YELLOW)
		install.pressed.connect(SetupService.open_runtime_install)
		actions.add_child(install)
	# Versione vecchia: lo dice la riga di stato qui sopra, il pulsante la ripara.
	if bool(s.get("runtime_stale", false)) and bool(s.get("docker_running", false)) \
			and not bool(s.get("remote", false)):
		var update := Button.new()
		update.text = UIStrings.t("setup.runtime_update")
		update.disabled = SetupService.busy()
		update.add_theme_color_override("font_color", Palette.YELLOW)
		update.pressed.connect(SetupService.update_runtime)
		actions.add_child(update)
	_setup_message = TerminalTheme.label("", 13, Palette.DIM)
	_content.add_child(_setup_message)
	_restore_action_note()
	_content.add_child(HSeparator.new())
	# Riga sotto, con un peso diverso: navigazione (piatta, a sinistra) e
	# azione distruttiva (rossa, isolata a destra). Prima FERMA CONTAINER
	# stava in mezzo alla fila, spalla a spalla con ATTIVA e con lo stesso
	# peso visivo: un click di troppo e il container era giù.
	var footer := HBoxContainer.new()
	footer.add_theme_constant_override("separation", 12)
	_content.add_child(footer)
	var back := Button.new()
	back.flat = true
	back.text = UIStrings.t("setup.back_overview")
	back.add_theme_color_override("font_color", Palette.MUTED)
	back.pressed.connect(func() -> void: navigate.emit("activation"))
	footer.add_child(back)
	# La seconda strada, alla pari della prima: il team può vivere su una VPS e
	# questa finestra restare lo specchio da cui lo si guarda. Prima esisteva
	# solo in Impostazioni, fuori dal percorso di setup.
	if not bool(s.get("remote", false)):
		var to_vps := Button.new()
		to_vps.flat = true
		to_vps.text = UIStrings.t("setup.use_vps")
		to_vps.add_theme_color_override("font_color", Palette.BLUE)
		to_vps.pressed.connect(func() -> void: navigate.emit("vps"))
		footer.add_child(to_vps)
	var spacer := Control.new()
	spacer.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	footer.add_child(spacer)
	if bool(s.get("container_running", false)):
		var stop := Button.new()
		stop.text = UIStrings.t("setup.container_stop")
		stop.disabled = SetupService.busy()
		stop.add_theme_color_override("font_color", Palette.RED)
		stop.pressed.connect(SetupService.stop_container)
		footer.add_child(stop)


## Una riga della filiera di attivazione. Quattro stati, quattro letture:
## ✓ fatto (verde) · ◌ in corso adesso (giallo) · ○ ancora da fare (spento)
## · ⚠ richiede attenzione (giallo). Niente emoji: glifi del font mono.
const PHASE_GLYPHS := {"done": "✓", "active": "◌", "pending": "○", "warn": "⚠"}

static func _phase_state(done: bool, active: bool) -> String:
	if active:
		return "active"
	return "done" if done else "pending"


func _setup_phase_row(label_text: String, state: String, detail: String) -> void:
	var tint: Color = Palette.GREEN if state == "done" \
			else (Palette.YELLOW if state in ["active", "warn"] else Palette.DIM)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 14)
	_content.add_child(row)
	row.add_child(TerminalTheme.label(
			str(PHASE_GLYPHS.get(state, "○")), 15, tint))
	var label := TerminalTheme.label(label_text, 15,
			Palette.BRIGHT if state != "pending" else Palette.MUTED, "medium")
	label.custom_minimum_size = Vector2(220, 0)
	row.add_child(label)
	var value := TerminalTheme.label(detail, 14,
			Palette.YELLOW if state == "active" else Palette.MUTED)
	value.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(value)


## Riga di stato binaria (account, email): ● verde/giallo + dettaglio.
func _setup_state_row(label_text: String, ok: bool, detail: String) -> void:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 14)
	_content.add_child(row)
	row.add_child(TerminalTheme.label("●", 15, Palette.GREEN if ok else Palette.YELLOW))
	var label := TerminalTheme.label(label_text, 15, Palette.BRIGHT, "medium")
	label.custom_minimum_size = Vector2(220, 0)
	row.add_child(label)
	var value := TerminalTheme.label(detail, 14, Palette.MUTED)
	value.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(value)


## Rimette nella riga di stato l'ultimo messaggio d'azione dopo una
## ricostruzione del pannello: senza, il cambio fase cancellava il progresso
## del pull a metà download.
func _restore_action_note() -> void:
	if SetupService.busy() and _action_note != "" \
			and is_instance_valid(_setup_message):
		_setup_message.text = _action_note
		_setup_message.add_theme_color_override("font_color", _action_note_color)


func _build_provider_setup() -> void:
	_listen_setup()
	var s: Dictionary = SetupService.status
	_content.add_child(TerminalTheme.label(UIStrings.t("setup.provider_lead"),
			15, Palette.BASE))
	_content.add_child(TerminalTheme.label(UIStrings.t("setup.provider_note"),
			13, Palette.YELLOW))
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_content.add_child(scroll)
	var list := VBoxContainer.new()
	list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	list.add_theme_constant_override("separation", 10)
	scroll.add_child(list)
	for provider in ["claude", "codex", "kimi"]:
		_provider_card(list, provider, s)
	_setup_message = TerminalTheme.label("", 13, Palette.DIM)
	_content.add_child(_setup_message)
	_restore_action_note()


func _provider_card(parent: VBoxContainer, provider: String, s: Dictionary) -> void:
	var meta: Dictionary = SetupService.PROVIDERS[provider]
	var active := str(s.get("active_provider", "")) == provider
	var match := SetupService.auth_match(provider, SetupService._jht_home())
	var authed := bool(s.get("provider_authenticated", false)) \
			if active and bool(s.get("remote", false)) else match != ""
	var panel := BracketPanel.new()
	parent.add_child(panel)
	var pad := MarginContainer.new()
	for side in ["left", "right", "top", "bottom"]:
		pad.add_theme_constant_override("margin_" + side, 14)
	panel.add_child(pad)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 16)
	pad.add_child(row)
	row.add_child(TerminalTheme.label("●", 16,
			Palette.GREEN if authed else Palette.YELLOW))
	var text_col := VBoxContainer.new()
	text_col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(text_col)
	text_col.add_child(TerminalTheme.label(str(meta["name"]) \
			+ (UIStrings.t("setup.provider_active") if active else ""), 18,
			Palette.GREEN if active else Palette.WHITE, "bold"))
	text_col.add_child(TerminalTheme.label(str(meta["vendor"]), 13, Palette.MUTED))
	text_col.add_child(TerminalTheme.label(
			UIStrings.t("setup.provider_connected") if authed \
			else UIStrings.t("setup.provider_disconnected"), 13,
			Palette.MINT if authed else Palette.YELLOW))
	var actions := VBoxContainer.new()
	actions.custom_minimum_size = Vector2(250, 0)
	actions.add_theme_constant_override("separation", 5)
	row.add_child(actions)
	if not active:
		var choose := Button.new()
		choose.text = UIStrings.t("setup.provider_choose")
		choose.disabled = SetupService.busy()
		choose.pressed.connect(SetupService.select_provider.bind(provider))
		actions.add_child(choose)
	else:
		var login := Button.new()
		login.text = UIStrings.t("setup.provider_relogin") if authed \
				else UIStrings.t("setup.provider_subscription_login")
		login.disabled = not bool(s.get("container_running", false))
		login.add_theme_color_override("font_color", Palette.GREEN)
		login.pressed.connect(SetupService.open_provider_login.bind(provider))
		actions.add_child(login)
		# Pulsante spento senza spiegazione = pulsante rotto: se il container è
		# giù si dice PERCHÉ il login non è premibile e cosa fare prima.
		if not bool(s.get("container_running", false)):
			var why := TerminalTheme.label(
					UIStrings.t("setup.provider_needs_container"), 11, Palette.YELLOW)
			why.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
			actions.add_child(why)
		# Login fatto ma non ancora visto: serve RIGUARDARE, non rifare. Il
		# pulsante di sopra reinstalla il CLI e riapre la console da capo —
		# usarlo per "controlla di nuovo" costa minuti e riporta al punto di
		# partenza (Leone, 26/07).
		if not authed:
			var recheck := Button.new()
			recheck.text = UIStrings.t("setup.provider_recheck")
			recheck.disabled = not bool(s.get("container_running", false))
			recheck.pressed.connect(func() -> void:
				recheck.text = UIStrings.t("setup.provider_rechecking")
				SetupService.refresh())
			actions.add_child(recheck)
		# Niente pulsante "INSTALLA / AGGIORNA CLI" accanto: faceva la PRIMA
		# METÀ di questo. Dal 24/07 il comando di login è
		# `providers update <id> && <cli> login`, cioè installa o aggiorna e poi
		# entra — quel secondo pulsante è rimasto lì a chiedere all'utente una
		# distinzione che non esiste più (Leone, 25/07).
		if authed:
			var logout := Button.new()
			logout.text = UIStrings.t("setup.provider_logout")
			logout.add_theme_color_override("font_color", Palette.RED)
			logout.pressed.connect(SetupService.logout_provider.bind(provider))
			actions.add_child(logout)
	var subscribe := Button.new()
	subscribe.text = UIStrings.t("setup.provider_subscribe")
	subscribe.flat = true
	subscribe.pressed.connect(SetupService.open_subscription.bind(provider))
	actions.add_child(subscribe)
	if active:
		var hint_key := "setup.login_hint_" + provider
		var hint := TerminalTheme.label(UIStrings.t(hint_key), 12, Palette.DIM)
		hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		text_col.add_child(hint)
		if authed:
			_plan_picker(text_col, provider, s)


## Quale abbonamento hai. Non è una curiosità statistica: è il numero da cui
## il Capitano ricava quanti agenti accendere il primo giorno. Senza, il team
## parte in prima marcia e l'utente — che guarda l'ufficio per dieci minuti e
## vede comparire una posizione — conclude che l'applicazione è rotta.
func _plan_picker(col: VBoxContainer, provider: String, s: Dictionary) -> void:
	var plans := SetupService.plans_for(provider)
	if plans.is_empty():
		col.add_child(TerminalTheme.label(UIStrings.t("setup.plan_unavailable"),
				12, Palette.YELLOW))
		return
	var chosen := str(s.get("active_plan", "")) \
			if str(s.get("active_provider", "")) == provider else ""
	col.add_child(TerminalTheme.label(UIStrings.t("setup.plan_question"), 13,
			Palette.MINT if chosen != "" else Palette.YELLOW, "bold"))
	# I piani vanno A CAPO invece di allargare la scheda: con cinque tagli in
	# fila (Kimi) la riga spingeva il pannello oltre il bordo dello schermo e
	# gli ultimi non erano nemmeno raggiungibili (Leone, 26/07).
	var row := HFlowContainer.new()
	row.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_theme_constant_override("h_separation", 6)
	row.add_theme_constant_override("v_separation", 4)
	col.add_child(row)
	for entry in plans:
		if not (entry is Dictionary):
			continue
		var plan: Dictionary = entry
		var plan_id := str(plan.get("id", ""))
		var button := Button.new()
		# "39 $/mese" → "39$": nel pulsante conta il taglio, non l'unità.
		var price := str(plan.get("price", "")).split(" ")[0]
		button.text = str(plan.get("label", plan_id)) if price in ["", "0"] \
				else "%s %s$" % [str(plan.get("label", plan_id)), price]
		button.toggle_mode = true
		button.button_pressed = plan_id == chosen
		if plan_id == chosen:
			button.add_theme_color_override("font_color", Palette.GREEN)
		button.pressed.connect(SetupService.select_plan.bind(provider, plan_id))
		row.add_child(button)


func _on_setup_refresh(_status: Dictionary) -> void:
	if is_instance_valid(_content) and section in ["activation", "provider", "docker"]:
		_build()


func _on_setup_action(action: String, running: bool, message: String, ok: bool) -> void:
	# Generare la chiave ne cambia il fingerprint senza toccare il percorso:
	# senza questo il pannello resterebbe su "non disponibile" fino a riaprirlo.
	if action == "vps-key" and not running:
		_refresh_vps_fingerprint()
	_action_note = ("◌ " if running else ("✓ " if ok else "⚠ ")) + message
	_action_note_color = Palette.YELLOW if running \
			else (Palette.GREEN if ok else Palette.RED)
	# Avvio o fine di un'azione di setup: i pulsanti devono cambiare stato
	# (disabilitati + etichetta "in corso") SUBITO, non al prossimo probe.
	# Solo al fronte di salita/discesa: i progressi intermedi arrivano ogni
	# ~1.5s durante il pull e ricostruire la UI a quel ritmo la renderebbe
	# incliccabile.
	if action in SETUP_ACTIONS and section in SETUP_SECTIONS \
			and running != _setup_busy_ui:
		_setup_busy_ui = running
		_build(_current_page)
	if not is_instance_valid(_setup_message):
		return
	_setup_message.text = _action_note
	_setup_message.add_theme_color_override("font_color", _action_note_color)


## Cambio fase dell'attivazione (motore → immagine → container): il pannello
## Docker sposta il marcatore ◌ sulla riga giusta. Succede tre volte per
## attivazione, il costo della ricostruzione è irrilevante.
func _on_setup_phase(_action: String, _phase: String) -> void:
	if section == "docker" and is_instance_valid(_content):
		_build(_current_page)

# ── Sistema VPS / container ──────────────────────────────────────────

var _metric_values := {}
var _metric_bars := {}
var _cpu_chart: SystemMetricChart
var _ram_chart: SystemMetricChart

func _build_system_dashboard() -> void:
	if not BackendBus.telemetry_updated.is_connected(_on_telemetry_updated):
		BackendBus.telemetry_updated.connect(_on_telemetry_updated)
	_content.add_child(TerminalTheme.label(UIStrings.t("sys.title"), 18, Palette.BRIGHT, "bold"))
	_content.add_child(TerminalTheme.label(
			UIStrings.t("sys.subtitle"), 13, Palette.MUTED))
	_content.add_child(HSeparator.new())
	_metric_row("cpu_pct", "CPU HOST", Palette.GREEN)
	_metric_row("ram_pct", "RAM HOST", Palette.BLUE)
	_metric_row("swap_pct", "SWAP", Palette.PURPLE)
	_metric_row("disk_pct", UIStrings.t("sys.disk"), Palette.YELLOW)
	_metric_row("container_cpu_pct", "CPU CONTAINER", Palette.MINT)
	_metric_row("container_mem_pct", "RAM CONTAINER", Palette.MINT)
	var charts := HBoxContainer.new()
	charts.add_theme_constant_override("separation", 12)
	_content.add_child(charts)
	_cpu_chart = SystemMetricChart.new("cpu_pct", UIStrings.t("sys.cpu_host_history"), Palette.GREEN)
	_ram_chart = SystemMetricChart.new("ram_pct", UIStrings.t("sys.ram_host_history"), Palette.BLUE)
	charts.add_child(_cpu_chart)
	charts.add_child(_ram_chart)
	_content.add_child(HSeparator.new())
	for key_label in [
		["container_status", "sys.container_status"], ["container_mem", "sys.container_mem"],
		["container_restarts", "sys.restarts"], ["load1", "sys.load1"],
		["uptime_s", "sys.uptime"], ["rx_bytes", "sys.rx"],
		["tx_bytes", "sys.tx"],
	]:
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 12)
		_content.add_child(row)
		var lbl := TerminalTheme.label(UIStrings.t(str(key_label[1])), 13, Palette.MUTED, "medium")
		lbl.custom_minimum_size = Vector2(220, 0)
		row.add_child(lbl)
		var value := TerminalTheme.label("—", 15, Palette.BRIGHT)
		row.add_child(value)
		_metric_values[key_label[0]] = value
	_refresh_telemetry(BackendBus.telemetry, BackendBus.telemetry_history)

func _metric_row(key: String, label_text: String, col: Color) -> void:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	_content.add_child(row)
	var lbl := TerminalTheme.label(label_text, 13, Palette.MUTED, "medium")
	lbl.custom_minimum_size = Vector2(170, 0)
	row.add_child(lbl)
	var bar := ProgressBar.new()
	bar.min_value = 0
	bar.max_value = 100
	bar.show_percentage = false
	bar.custom_minimum_size = Vector2(360, 14)
	bar.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var fill := StyleBoxFlat.new()
	fill.bg_color = Color(col.r, col.g, col.b, 0.78)
	bar.add_theme_stylebox_override("fill", fill)
	row.add_child(bar)
	var value := TerminalTheme.label("—", 14, col, "medium")
	value.custom_minimum_size = Vector2(70, 0)
	value.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	row.add_child(value)
	_metric_bars[key] = bar
	_metric_values[key] = value

func _on_telemetry_updated(sample: Dictionary, history: Array) -> void:
	_refresh_telemetry(sample, history)

func _refresh_telemetry(sample: Dictionary, history: Array) -> void:
	if sample.is_empty():
		return
	for key in _metric_bars:
		var v := float(sample.get(key, 0.0))
		if is_instance_valid(_metric_bars[key]):
			_metric_bars[key].value = v
		if is_instance_valid(_metric_values.get(key)):
			_metric_values[key].text = "%.1f%%" % v
	_set_metric_text("container_status", str(sample.get("container_status", "—")).to_upper())
	_set_metric_text("container_mem", str(sample.get("container_mem", "—")))
	_set_metric_text("container_restarts", str(sample.get("container_restarts", 0)))
	_set_metric_text("load1", str(sample.get("load1", "—")))
	_set_metric_text("uptime_s", _fmt_uptime(float(sample.get("uptime_s", 0.0))))
	_set_metric_text("rx_bytes", _fmt_bytes(float(sample.get("rx_bytes", 0.0))))
	_set_metric_text("tx_bytes", _fmt_bytes(float(sample.get("tx_bytes", 0.0))))
	if is_instance_valid(_cpu_chart): _cpu_chart.set_history(history)
	if is_instance_valid(_ram_chart): _ram_chart.set_history(history)

func _set_metric_text(key: String, text: String) -> void:
	if is_instance_valid(_metric_values.get(key)):
		_metric_values[key].text = text

static func _fmt_bytes(n: float) -> String:
	for unit in ["B", "KB", "MB", "GB", "TB"]:
		if n < 1024.0 or unit == "TB": return "%.1f %s" % [n, unit]
		n /= 1024.0
	return "—"

static func _fmt_uptime(seconds: float) -> String:
	var total := int(seconds)
	return "%d g  %02d:%02d" % [total / 86400, (total / 3600) % 24, (total / 60) % 60]

# ── Risorse per singolo agente ───────────────────────────────────────

var _agent_metric_rows := {}
var _agent_metric_roster_signature := ""
var _agent_metric_freshness: Label
var _agent_token_total_header: Label
var _agent_token_bucket_header: Label

func _build_agent_metrics() -> void:
	if not BackendBus.telemetry_updated.is_connected(_on_agent_metrics_updated):
		BackendBus.telemetry_updated.connect(_on_agent_metrics_updated)
	if not BackendBus.agents_updated.is_connected(_on_agent_metrics_roster):
		BackendBus.agents_updated.connect(_on_agent_metrics_roster)
	_content.add_child(TerminalTheme.label(UIStrings.t("metrics.title"), 18,
			Palette.BRIGHT, "bold"))
	_content.add_child(TerminalTheme.label(
			UIStrings.t("metrics.subtitle"),
			13, Palette.MUTED))
	_agent_metric_freshness = TerminalTheme.label(UIStrings.t("metrics.freshness_wait"),
			12, Palette.DIM, "medium")
	_content.add_child(_agent_metric_freshness)
	var header := HBoxContainer.new()
	header.add_theme_constant_override("separation", 10)
	_content.add_child(header)
	for spec in [["metrics.col_agent", 170], ["RAM", 84], ["metrics.col_ram_history", 180],
			["TOKEN", 100], ["TOKEN / BUCKET", 180]]:
		var lbl := TerminalTheme.label(UIStrings.t(str(spec[0])), 12, Palette.DIM, "medium")
		lbl.custom_minimum_size = Vector2(spec[1], 0)
		header.add_child(lbl)
		if spec[0] == "TOKEN":
			_agent_token_total_header = lbl
		elif spec[0] == "TOKEN / BUCKET":
			_agent_token_bucket_header = lbl
	_content.add_child(HSeparator.new())
	_agent_metric_rows.clear()
	_agent_metric_roster_signature = _agent_roster_signature(BackendBus.agents)
	for a in BackendBus.agents:
		var session := str(a.get("session", a.get("uid", "?"))).to_lower()
		# La serie appartiene all'istanza, non al ruolo: sentinella-worker non
		# deve duplicare artificialmente i token di sentinella.
		var token_key := session
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 10)
		_content.add_child(row)
		var name := TerminalTheme.label(str(a.get("name", session)), 14, Palette.BRIGHT, "medium")
		name.custom_minimum_size = Vector2(170, 0)
		row.add_child(name)
		var ram := TerminalTheme.label("—", 13, Palette.BLUE)
		ram.custom_minimum_size = Vector2(84, 0)
		row.add_child(ram)
		var ram_chart := AgentMetricSparkline.new(session, "ram", Palette.BLUE)
		row.add_child(ram_chart)
		var tokens := TerminalTheme.label("—", 13, Palette.GREEN)
		tokens.custom_minimum_size = Vector2(100, 0)
		row.add_child(tokens)
		var token_chart := AgentMetricSparkline.new(token_key, "tokens", Palette.GREEN)
		row.add_child(token_chart)
		_agent_metric_rows[session] = {"ram": ram, "tokens": tokens,
				"ram_chart": ram_chart, "token_chart": token_chart,
				"token_key": token_key}
	_refresh_agent_metrics(BackendBus.telemetry, BackendBus.telemetry_history)

func _on_agent_metrics_updated(sample: Dictionary, history: Array) -> void:
	_refresh_agent_metrics(sample, history)

func _on_agent_metrics_roster(_list: Array) -> void:
	var signature := _agent_roster_signature(_list)
	if section == "agent_metrics" and is_instance_valid(_content) \
			and signature != _agent_metric_roster_signature:
		_build()

static func _agent_roster_signature(list: Array) -> String:
	var sessions: PackedStringArray = []
	for agent in list:
		sessions.append(str(agent.get("session", agent.get("uid", "?"))).to_lower())
	sessions.sort()
	return "|".join(sessions)

func _refresh_agent_metrics(sample: Dictionary, history: Array) -> void:
	if sample.is_empty(): return
	var ram_map: Dictionary = sample.get("agent_ram", {})
	var token_series: Array = sample.get("token_series", [])
	_refresh_agent_metric_metadata(sample)
	for session in _agent_metric_rows:
		var widgets: Dictionary = _agent_metric_rows[session]
		var ram_bytes := float(ram_map.get(session, 0.0))
		if is_instance_valid(widgets["ram"]):
			widgets["ram"].text = _fmt_bytes(ram_bytes)
		var total := 0.0
		var has_token_data := false
		for bucket in token_series:
			if bucket.has(widgets["token_key"]):
				has_token_data = true
				total += float(bucket[widgets["token_key"]])
		if is_instance_valid(widgets["tokens"]):
			widgets["tokens"].text = "%.1fk" % total if has_token_data else "—"
		if is_instance_valid(widgets["ram_chart"]):
			widgets["ram_chart"].set_data(history, sample)
		if is_instance_valid(widgets["token_chart"]):
			widgets["token_chart"].set_data(history, sample)

func _refresh_agent_metric_metadata(sample: Dictionary) -> void:
	var window_h := float(sample.get("window_h", 0.0))
	var bucket_sec := int(sample.get("bucket_sec", 0))
	if is_instance_valid(_agent_token_total_header):
		_agent_token_total_header.text = UIStrings.t("metrics.tokens_window") \
				% _metric_window_text(window_h)
	if is_instance_valid(_agent_token_bucket_header):
		_agent_token_bucket_header.text = UIStrings.t("metrics.tokens_bucket") \
				% _metric_bucket_text(bucket_sec)
	if not is_instance_valid(_agent_metric_freshness):
		return
	var generated := str(sample.get("generated_at", "")).strip_edges()
	if generated == "":
		_agent_metric_freshness.text = UIStrings.t("metrics.no_source")
		_agent_metric_freshness.add_theme_color_override("font_color", Palette.RED)
		return
	# Il producer usa ISO-8601 UTC con microsecondi; il parser Godot vuole
	# la parte calendario senza frazioni/offset.
	var generated_unix := Time.get_unix_time_from_datetime_string(generated.left(19))
	var age_sec := maxi(0, int(Time.get_unix_time_from_system() - generated_unix))
	var stale_after := maxi(900, bucket_sec * 3)
	var stamp := generated.replace("T", " ").left(19) + " UTC"
	if age_sec > stale_after:
		_agent_metric_freshness.text = UIStrings.t("metrics.stale") % [
				stamp, _metric_age_text(age_sec)]
		_agent_metric_freshness.add_theme_color_override("font_color", Palette.RED)
	else:
		_agent_metric_freshness.text = UIStrings.t("metrics.updated") % [
				stamp, _metric_age_text(age_sec)]
		_agent_metric_freshness.add_theme_color_override("font_color", Palette.MINT)

static func _metric_window_text(hours: float) -> String:
	if hours <= 0.0: return "?"
	if hours < 1.0: return "%d MIN" % int(round(hours * 60.0))
	if is_equal_approx(hours, round(hours)):
		return "%dH" % int(round(hours))
	return "%.1fH" % hours

static func _metric_bucket_text(seconds: int) -> String:
	if seconds <= 0: return "BUCKET"
	if seconds % 60 == 0: return "%d MIN" % (seconds / 60)
	return "%d S" % seconds

static func _metric_age_text(seconds: int) -> String:
	if seconds < 60: return "%d s" % seconds
	if seconds < 3600: return "%d min" % (seconds / 60)
	return "%d h %02d min" % [seconds / 3600, (seconds / 60) % 60]

## Gli ORARI DI LAVORO del team: editabili QUI, con feedback DINAMICO
## (feedback Leone 21:3x): cambi le finestre e vedi subito le ore
## attive, la stima approssimativa di posizioni/giorno (rate storico
## degli ultimi 7 giorni) e il budget riproporzionato.
var _hours_tz: LineEdit
var _hours_windows: Array = []   # working copy [{days, start, end}]
var _hours_estimate_lbl: Label
var _hours_status: Label
var _hours_save_btn: Button
var _hours_loaded := false

## Giorni della settimana: chiave che va nel config (mon…sun) ed etichetta
## di una lettera per i sette pulsanti.
const HOURS_DAYS := [["mon", "L"], ["tue", "M"], ["wed", "M"], ["thu", "G"],
		["fri", "V"], ["sat", "S"], ["sun", "D"]]

## Punti di partenza in un click. Chi apre questa pagina la prima volta non
## ha un'opinione sugli orari: ne ha una sul MODO in cui vuole lavorare.
const HOURS_PRESETS := {
	"office": [{"days": "mon, tue, wed, thu, fri", "start": "09:00", "end": "18:00"}],
	"evening": [{"days": "mon, tue, wed, thu, fri", "start": "18:00", "end": "23:00"},
			{"days": "sat, sun", "start": "10:00", "end": "20:00"}],
	"always": [{"days": "mon, tue, wed, thu, fri, sat, sun",
			"start": "00:00", "end": "00:00"}],
}


func _build_hours() -> void:
	if not BackendBus.hours_saved.is_connected(_on_hours_saved):
		BackendBus.hours_saved.connect(_on_hours_saved)
	# Senza team acceso non c'è dove scrivere gli orari: dirlo, invece di
	# mostrare una pagina vuota che sembra rotta.
	if not BackendBus.is_live():
		_content.add_child(TerminalTheme.label(UIStrings.t("hours.intro"),
				14, Palette.MUTED))
		var warn := TerminalTheme.label(UIStrings.t("hours.need_team"),
				14, Palette.YELLOW)
		warn.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		_content.add_child(warn)
		var back := Button.new()
		back.text = UIStrings.t("setup.back_overview")
		back.flat = true
		back.pressed.connect(func() -> void: navigate.emit("activation"))
		_content.add_child(back)
		return
	var raw: Dictionary = BackendBus.live_settings.get("hours_raw", {})
	if not _hours_loaded:
		_hours_windows = []
		for w in raw.get("windows", []):
			_hours_windows.append({"days": ", ".join(PackedStringArray(w.get("days", []))),
					"start": str(w.get("start", "09:00")), "end": str(w.get("end", "18:00"))})
		# Prima volta: si parte da una proposta, non dal foglio bianco. La
		# pagina usciva di qui senza disegnare niente quando le finestre non
		# esistevano ancora — cioè proprio quando il passo 04 le chiede.
		if _hours_windows.is_empty():
			for w in HOURS_PRESETS["office"]:
				_hours_windows.append(w.duplicate())
		_hours_loaded = true
	_content.add_child(TerminalTheme.label(UIStrings.t("hours.intro"), 14, Palette.MUTED))
	if raw.is_empty():
		var first := TerminalTheme.label(UIStrings.t("hours.first_time"), 13, Palette.MINT)
		first.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		_content.add_child(first)
	var tz_row := HBoxContainer.new()
	tz_row.add_theme_constant_override("separation", 12)
	_content.add_child(tz_row)
	var tz_lbl := TerminalTheme.label(UIStrings.t("hours.tz"), 14, Palette.MUTED, "medium")
	tz_lbl.custom_minimum_size = Vector2(220, 0)
	tz_row.add_child(tz_lbl)
	_hours_tz = LineEdit.new()
	_hours_tz.text = str(raw.get("timezone", "Europe/Rome"))
	_hours_tz.custom_minimum_size = Vector2(280, 0)
	tz_row.add_child(_hours_tz)
	var preset_lbl := TerminalTheme.label(UIStrings.t("hours.presets"),
			13, Palette.MUTED, "medium")
	_content.add_child(preset_lbl)
	var preset_row := HFlowContainer.new()
	preset_row.add_theme_constant_override("h_separation", 6)
	preset_row.add_theme_constant_override("v_separation", 4)
	_content.add_child(preset_row)
	for entry in [["office", "hours.preset_office"], ["evening", "hours.preset_evening"],
			["always", "hours.preset_always"]]:
		var preset := Button.new()
		preset.text = UIStrings.t(str(entry[1]))
		preset.pressed.connect(func() -> void:
			_hours_windows = []
			for w in HOURS_PRESETS[str(entry[0])]:
				_hours_windows.append(w.duplicate())
			_build())
		preset_row.add_child(preset)
	_content.add_child(TerminalTheme.label(UIStrings.t("hours.windows"),
			14, Palette.MUTED, "medium"))
	for i in _hours_windows.size():
		var w: Dictionary = _hours_windows[i]
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 10)
		_content.add_child(row)
		# I giorni sono sette pulsanti, non una riga da compilare: "mon, tue,
		# wed" era una sintassi da ricordare dentro un passo obbligatorio.
		var day_box := HBoxContainer.new()
		day_box.add_theme_constant_override("separation", 2)
		day_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(day_box)
		var win_for_days: Dictionary = w
		for day_def in HOURS_DAYS:
			var key := str(day_def[0])
			var toggle := Button.new()
			toggle.text = str(day_def[1])
			toggle.toggle_mode = true
			toggle.custom_minimum_size = Vector2(34, 0)
			toggle.button_pressed = _hours_has_day(win_for_days, key)
			toggle.tooltip_text = key
			if toggle.button_pressed:
				toggle.add_theme_color_override("font_color", Palette.GREEN)
			toggle.pressed.connect(func() -> void:
				_hours_toggle_day(win_for_days, key)
				_build())
			day_box.add_child(toggle)
		var start := LineEdit.new()
		start.text = str(w["start"])
		start.custom_minimum_size = Vector2(100, 0)
		row.add_child(start)
		row.add_child(TerminalTheme.label("→", 14, Palette.DIM))
		var end := LineEdit.new()
		end.text = str(w["end"])
		end.custom_minimum_size = Vector2(100, 0)
		row.add_child(end)
		var win: Dictionary = w
		var sync := func() -> void:
			win["start"] = start.text
			win["end"] = end.text
			_refresh_hours_estimate()
		start.text_changed.connect(func(_t: String) -> void: sync.call())
		end.text_changed.connect(func(_t: String) -> void: sync.call())
		var rm := Button.new()
		rm.flat = true
		rm.text = "✕"
		rm.add_theme_color_override("font_color", Palette.RED)
		var idx := i
		rm.pressed.connect(func() -> void:
			_hours_windows.remove_at(idx)
			_build())
		row.add_child(rm)
	var add := Button.new()
	add.flat = true
	add.text = UIStrings.t("hours.add")
	add.add_theme_color_override("font_color", Palette.GREEN)
	add.alignment = HORIZONTAL_ALIGNMENT_LEFT
	add.pressed.connect(func() -> void:
		_hours_windows.append({"days": "mon, tue, wed, thu, fri",
				"start": "09:00", "end": "18:00"})
		_build())
	_content.add_child(add)
	_content.add_child(HSeparator.new())
	_hours_estimate_lbl = TerminalTheme.label("", 14, Palette.YELLOW)
	_hours_estimate_lbl.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_content.add_child(_hours_estimate_lbl)
	_refresh_hours_estimate()
	_hours_save_btn = Button.new()
	_hours_save_btn.text = UIStrings.t("hours.save")
	_hours_save_btn.add_theme_font_size_override("font_size", 16)
	_hours_save_btn.add_theme_color_override("font_color", Palette.GREEN)
	_hours_save_btn.pressed.connect(_save_hours)
	_content.add_child(_hours_save_btn)
	_hours_status = TerminalTheme.label("", 13, Palette.DIM)
	_content.add_child(_hours_status)

## I giorni di una finestra restano una stringa "mon, tue" perché è il
## formato che il salvataggio e la stima già parlano: i pulsanti scrivono lì.
static func _hours_day_list(win: Dictionary) -> Array:
	var out: Array = []
	for d in str(win.get("days", "")).split(","):
		var day := d.strip_edges().to_lower()
		if day != "" and not out.has(day):
			out.append(day)
	return out


static func _hours_has_day(win: Dictionary, day: String) -> bool:
	return _hours_day_list(win).has(day)


## Accende o spegne un giorno mantenendo l'ordine della settimana, così la
## riga non si rimescola sotto le dita a ogni click.
static func _hours_toggle_day(win: Dictionary, day: String) -> void:
	var current := _hours_day_list(win)
	if current.has(day):
		current.erase(day)
	else:
		current.append(day)
	var ordered: Array = []
	for day_def in HOURS_DAYS:
		if current.has(str(day_def[0])):
			ordered.append(str(day_def[0]))
	win["days"] = ", ".join(PackedStringArray(ordered))


## Ore attive/settimana di una lista finestre del form.
static func _hours_per_week(windows: Array) -> float:
	var total := 0.0
	for w in windows:
		var days := 0
		for d in str(w["days"]).split(","):
			if d.strip_edges() != "":
				days += 1
		var s := _hhmm(str(w["start"]))
		var e := _hhmm(str(w["end"]))
		if e <= s:
			e += 24.0  # attraversa la mezzanotte (o end 00:00 = 24:00)
		total += (e - s) * days
	return total

static func _hhmm(t: String) -> float:
	var parts := t.strip_edges().split(":")
	if parts.size() < 2:
		return 0.0
	return float(parts[0].to_int()) + float(parts[1].to_int()) / 60.0

## La stima dinamica: rate storico (posizioni degli ultimi 7 giorni per
## ora attiva del config corrente) proiettato sulle ore del form.
func _refresh_hours_estimate() -> void:
	if not is_instance_valid(_hours_estimate_lbl):
		return
	var cur_raw: Dictionary = BackendBus.live_settings.get("hours_raw", {})
	var cur_windows: Array = []
	for w in cur_raw.get("windows", []):
		cur_windows.append({"days": ", ".join(PackedStringArray(w.get("days", []))),
				"start": str(w.get("start", "")), "end": str(w.get("end", ""))})
	var cur_h := maxf(1.0, _hours_per_week(cur_windows))
	var new_h := _hours_per_week(_hours_windows)
	var week_ago := Time.get_unix_time_from_system() - 7 * 86400
	var found7 := 0
	for p in BackendBus.positions:
		var ts := Time.get_unix_time_from_datetime_string(
				str(p.get("found_at", "")).left(19))
		if ts > 0 and float(ts) >= week_ago:
			found7 += 1
	var rate := float(found7) / cur_h          # posizioni per ora attiva
	var est_day := rate * new_h / 7.0
	_hours_estimate_lbl.text = UIStrings.t("hours.estimate") % [
			new_h, est_day, int(round(new_h / cur_h * 100.0))]

func _save_hours() -> void:
	var windows: Array = []
	for w in _hours_windows:
		var days: Array = []
		for d in str(w["days"]).split(","):
			var day := d.strip_edges().to_lower()
			if ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].has(day):
				days.append(day)
		if days.is_empty() or not str(w["start"]).contains(":") \
				or not str(w["end"]).contains(":"):
			_hours_status.text = UIStrings.t("hours.invalid")
			_hours_status.add_theme_color_override("font_color", Palette.RED)
			return
		windows.append({"days": days, "start": str(w["start"]).strip_edges(),
				"end": str(w["end"]).strip_edges()})
	_hours_save_btn.disabled = true
	_hours_status.text = UIStrings.t("prof.saving")
	_hours_status.add_theme_color_override("font_color", Palette.DIM)
	BackendBus.save_working_hours({
		"timezone": _hours_tz.text.strip_edges(), "windows": windows})

func _on_hours_saved(ok: bool, error: String) -> void:
	if not is_instance_valid(_hours_status):
		return
	_hours_status.text = UIStrings.t("hours.saved") if ok \
			else UIStrings.t("prof.save_err") % error
	_hours_status.add_theme_color_override("font_color",
			Palette.MINT if ok else Palette.RED)
	if is_instance_valid(_hours_save_btn):
		_hours_save_btn.disabled = false
	if ok:
		_hours_loaded = false  # al prossimo build ricarica dal config vero

## Il PROFILO dell'utente: editabile QUI (paradigma desktop app 21:26).
## I campi arrivano da profile_raw (chiavi vere del candidate_profile),
## il salvataggio riscrive il yml sulla VPS con backup. Offline: mock.
const PROFILE_FIELDS := [
	["name", "prof.name"], ["email", "prof.email"],
	["target_role", "prof.target_role"],
	["location", "prof.location"], ["experience_years", "prof.experience"],
	["seniority_target", "prof.seniority"], ["industry", "prof.industry"],
	["nationality", "prof.nationality"], ["languages", "prof.languages"],
]

var _prof_edits := {}
var _prof_status: Label

func _build_profile() -> void:
	if not BackendBus.live_settings_updated.is_connected(_on_profile_refresh):
		BackendBus.live_settings_updated.connect(_on_profile_refresh)
	if not BackendBus.profile_saved.is_connected(_on_profile_saved):
		BackendBus.profile_saved.connect(_on_profile_saved)
	var raw: Dictionary = BackendBus.live_settings.get("profile_raw", {})
	if not BackendBus.is_live():
		_build_profile_setup()
		return
	if raw.is_empty():
		raw = ScriptedOnboarding.profile_draft()
	_prof_edits.clear()
	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 18)
	grid.add_theme_constant_override("v_separation", 10)
	_content.add_child(grid)
	for f in PROFILE_FIELDS:
		var lbl := TerminalTheme.label(UIStrings.t(f[1]), 14, Palette.MUTED, "medium")
		lbl.custom_minimum_size = Vector2(220, 0)
		grid.add_child(lbl)
		var edit := LineEdit.new()
		edit.text = str(raw.get(f[0], ""))
		edit.custom_minimum_size = Vector2(560, 0)
		edit.add_theme_font_size_override("font_size", 15)
		grid.add_child(edit)
		_prof_edits[f[0]] = edit
	# skill su riga intera, salario su tre campi affiancati
	_content.add_child(TerminalTheme.label(UIStrings.t("prof.skills"),
			14, Palette.MUTED, "medium"))
	var skills := LineEdit.new()
	skills.text = str(raw.get("skills_primary", ""))
	skills.add_theme_font_size_override("font_size", 15)
	skills.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_content.add_child(skills)
	_prof_edits["skills_primary"] = skills
	var sal_row := HBoxContainer.new()
	sal_row.add_theme_constant_override("separation", 12)
	_content.add_child(sal_row)
	sal_row.add_child(TerminalTheme.label(UIStrings.t("prof.salary"),
			14, Palette.MUTED, "medium"))
	for sf in ["salary_min", "salary_max", "salary_currency"]:
		var e := LineEdit.new()
		e.text = str(raw.get(sf, ""))
		e.custom_minimum_size = Vector2(120 if sf != "salary_currency" else 70, 0)
		e.add_theme_font_size_override("font_size", 15)
		sal_row.add_child(e)
		_prof_edits[sf] = e
	_content.add_child(HSeparator.new())
	var save := Button.new()
	save.text = UIStrings.t("prof.save")
	save.add_theme_font_size_override("font_size", 16)
	save.add_theme_color_override("font_color", Palette.GREEN)
	save.pressed.connect(func() -> void:
		var fields := {}
		for key in _prof_edits:
			fields[key] = _prof_edits[key].text.strip_edges()
		save.disabled = true
		_prof_status.text = UIStrings.t("prof.saving")
		_prof_status.add_theme_color_override("font_color", Palette.DIM)
		ScriptedOnboarding.remember_profile_fields(fields)
		BackendBus.save_user_profile(ScriptedOnboarding.enrich_profile_fields(fields)))
	_content.add_child(save)
	_prof_status = TerminalTheme.label("", 13, Palette.DIM)
	_content.add_child(_prof_status)
	_prof_save_btn = save

var _prof_save_btn: Button


func _build_profile_setup() -> void:
	_listen_setup()
	var ready := bool(SetupService.status.get("profile_ready", false))
	_content.add_child(TerminalTheme.label(
			UIStrings.t("setup.profile_ready_lead") if ready \
			else UIStrings.t("setup.profile_lead"), 16,
			Palette.GREEN if ready else Palette.BASE))
	var note := TerminalTheme.label(UIStrings.t("setup.profile_body"), 14, Palette.MUTED)
	note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_content.add_child(note)
	_content.add_child(HSeparator.new())
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	_content.add_child(row)
	var assistant := Button.new()
	assistant.text = UIStrings.t("setup.profile_open")
	assistant.disabled = not bool(SetupService.status.get("container_running", false)) \
			or not bool(SetupService.status.get("provider_authenticated", false))
	assistant.add_theme_font_size_override("font_size", 16)
	assistant.add_theme_color_override("font_color", Palette.GREEN)
	assistant.pressed.connect(Game.goto_wizard)
	row.add_child(assistant)
	var activation := Button.new()
	activation.text = UIStrings.t("setup.back_overview")
	activation.pressed.connect(func() -> void: navigate.emit("activation"))
	row.add_child(activation)
	if assistant.disabled and not ready:
		_content.add_child(TerminalTheme.label(
				UIStrings.t("setup.profile_requires"), 13, Palette.YELLOW))

## Il refresh periodico non deve cancellare quello che stai scrivendo:
## si ricostruisce solo se nessun campo del form ha il focus.
func _on_profile_refresh(_settings: Dictionary) -> void:
	if section != "profile" or not is_instance_valid(_content):
		return
	for key in _prof_edits:
		var e: LineEdit = _prof_edits[key]
		if is_instance_valid(e) and e.has_focus():
			return
	_build()

func _on_profile_saved(ok: bool, error: String) -> void:
	if not is_instance_valid(_prof_status):
		return
	_prof_status.text = UIStrings.t("prof.saved") if ok \
			else UIStrings.t("prof.save_err") % error
	_prof_status.add_theme_color_override("font_color",
			Palette.MINT if ok else Palette.RED)
	if is_instance_valid(_prof_save_btn):
		_prof_save_btn.disabled = false


## Impostazioni → Aspetto: preferenza solo locale. Il cambio ricostruisce la
## scena corrente, quindi raggiunge anche popup e override colore già creati.
func _build_appearance() -> void:
	_content.add_child(TerminalTheme.label(
			UIStrings.t("appearance.intro"), 14, Palette.MUTED))
	_content.add_child(HSeparator.new())
	var current := TerminalTheme.label(
			UIStrings.t("appearance.current") % UIStrings.t(
					"appearance.light" if Palette.is_light() else "appearance.dark"),
			16, Palette.BRIGHT, "bold")
	_content.add_child(current)
	var choices := HBoxContainer.new()
	choices.add_theme_constant_override("separation", 16)
	_content.add_child(choices)
	for spec in [
		[Palette.MODE_LIGHT, "☀", "appearance.light", "appearance.light_desc"],
		[Palette.MODE_DARK, "◐", "appearance.dark", "appearance.dark_desc"],
	]:
		var selected: bool = Palette.mode == spec[0]
		var button := Button.new()
		button.text = "%s  %s%s\n%s" % [spec[1],
				UIStrings.t(spec[2]).to_upper(), "  ✓" if selected else "",
				UIStrings.t(spec[3])]
		button.alignment = HORIZONTAL_ALIGNMENT_LEFT
		button.custom_minimum_size = Vector2(360, 104)
		button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		button.add_theme_font_size_override("font_size", 15)
		button.add_theme_color_override("font_color",
				Palette.GREEN if selected else Palette.BASE)
		button.add_theme_color_override("font_disabled_color", Palette.GREEN)
		button.disabled = selected
		var requested := str(spec[0])
		button.pressed.connect(func() -> void: Game.set_ui_theme(requested))
		choices.add_child(button)
	_content.add_child(HSeparator.new())
	_content.add_child(TerminalTheme.label(
			UIStrings.t("appearance.note"), 13, Palette.DIM))


## Impostazioni → Grafica: qui l'utente prende il comando sul compromesso fra
## resa e fluidità. Finché non sceglie decide la calibrazione (e continua ad
## adattarsi mentre gioca); appena scegli, la tua scelta vince e non viene più
## rivista — è la ragione per cui questo pannello esiste: su una macchina lenta
## il gioco che ti cambia la grafica da solo, ogni tanto, è peggio del lag.
func _build_graphics() -> void:
	_content.add_child(_wrapped_label(UIStrings.t("gfx.intro"), 14, Palette.MUTED))
	_content.add_child(HSeparator.new())
	var mode := Game.graphics_choice()
	_content.add_child(TerminalTheme.label(
			UIStrings.t("gfx.current") % UIStrings.t("gfx." + _graphics_key(mode)),
			16, Palette.BRIGHT, "bold"))
	# Cosa sta girando ADESSO: in automatico non coincide con la scelta, ed è
	# proprio il dato che serve a chi sta valutando se prendere il comando.
	_content.add_child(TerminalTheme.label(
			UIStrings.t("gfx.state") % [int(round(Game.world_scale() * 100.0)),
					UIStrings.t("gfx.scenery_off" if Game.low_gfx else "gfx.scenery_on")],
			14, Palette.MUTED))
	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 16)
	grid.add_theme_constant_override("v_separation", 12)
	_content.add_child(grid)
	for spec in [
		[Game.CHOICE_AUTO, "auto"], ["full", "full"],
		["balanced", "balanced"], ["performance", "performance"],
	]:
		var value := str(spec[0])
		var key := str(spec[1])
		var selected: bool = mode == value
		var button := Button.new()
		button.text = "%s%s\n%s" % [UIStrings.t("gfx." + key).to_upper(),
				"  ✓" if selected else "", UIStrings.t("gfx." + key + "_desc")]
		button.alignment = HORIZONTAL_ALIGNMENT_LEFT
		button.custom_minimum_size = Vector2(360, 92)
		button.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		button.add_theme_font_size_override("font_size", 15)
		button.add_theme_color_override("font_color",
				Palette.GREEN if selected else Palette.BASE)
		button.add_theme_color_override("font_disabled_color", Palette.GREEN)
		button.disabled = selected
		button.pressed.connect(func() -> void:
			Game.set_graphics_choice(value)
			_build())  # riapre col profilo nuovo già evidenziato
		grid.add_child(button)
	_content.add_child(HSeparator.new())
	_content.add_child(_wrapped_label(UIStrings.t("gfx.note"), 13, Palette.DIM))


## Riga di prosa che va a capo dentro il pannello. Serve davvero: una Label
## senza autowrap allarga il contenitore fino alla lunghezza della frase e si
## porta dietro il pannello, che finisce fuori dallo schermo — bordo destro e
## pulsante di chiusura compresi (visto negli shot del 25/07).
func _wrapped_label(text: String, size: int, color: Color) -> Label:
	var label := TerminalTheme.label(text, size, color)
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return label


## "auto" non sta fra i CHOICES di Game (è l'assenza di scelta) ma ha la sua
## voce in elenco: qui le due nomenclature si incontrano.
func _graphics_key(mode: String) -> String:
	return mode if Game.CHOICES.has(mode) else "auto"

## Impostazioni → Lingua: le 7 lingue del web. Il cambio si applica
## subito a ciò che viene (ri)costruito; la scena intorno si aggiorna
## man mano che i pannelli si riaprono.
func _build_language() -> void:
	_content.add_child(TerminalTheme.label(UIStrings.t("lang.intro"), 14, Palette.MUTED))
	for l in UIStrings.LANGS:
		var selected: bool = UIStrings.lang == l
		var btn := Button.new()
		btn.flat = true
		btn.alignment = HORIZONTAL_ALIGNMENT_LEFT
		btn.text = ("▸ " if selected else "  ") + str(UIStrings.LANGS[l])
		btn.add_theme_font_size_override("font_size", 16)
		btn.add_theme_color_override("font_color",
				Palette.GREEN if selected else Palette.BASE)
		btn.add_theme_color_override("font_hover_color", Palette.MINT)
		btn.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
		var code := str(l)
		btn.pressed.connect(func() -> void:
			UIStrings.set_lang(code)
			_build())
		_content.add_child(btn)
	_content.add_child(HSeparator.new())
	_content.add_child(TerminalTheme.label(UIStrings.t("lang.note"), 13, Palette.DIM))

# ── Posizioni: la pagina positions del web privato, dati veri ────────

## Stessi colori-fase della pipeline web (status → colore), risolti a runtime
## perché gli accenti hanno una variante a contrasto alto nel tema light.
static func _pos_status_color(status: String, fallback: Color) -> Color:
	return {
		"new": Palette.MUTED, "checked": Palette.BLUE, "scored": Palette.PURPLE,
		"writing": Palette.YELLOW, "review": Palette.ORANGE, "ready": Palette.MINT,
		"applied": Palette.GREEN, "response": Palette.BLUE, "excluded": Palette.RED,
	}.get(status, fallback)
const POS_STATUS_ORDER := ["new", "checked", "scored", "writing", "review",
		"ready", "applied", "response", "excluded"]
const POS_PAGE_SIZES := [25, 50, 100, 200]

## Filtri attivi (menu → set di valori). Persistono finché il pannello vive.
var _pos_filters := {
	"status": {}, "role_family": {}, "loc_country": {}, "work_mode": {},
}
var _pos_filters_open := false
var _pos_page := 1
var _pos_page_size := 50

## Cross-filtering come sul web: ogni menu conta le posizioni
## filtrate da TUTTI GLI ALTRI gruppi, la lista le filtra da tutti.
func _build_positions() -> void:
	if not pending_status.is_empty():
		var chosen := {}
		for st in pending_status:
			chosen[st] = true
		_pos_filters["status"] = chosen
		pending_status = []
		_pos_page = 1
	var all: Array = BackendBus.positions
	if all.is_empty():
		_content.add_child(TerminalTheme.label(UIStrings.t("pos.need_vps"),
				15, Palette.MUTED))
		if not BackendBus.positions_updated.is_connected(_on_positions_refresh):
			BackendBus.positions_updated.connect(_on_positions_refresh)
		return
	if not BackendBus.positions_updated.is_connected(_on_positions_refresh):
		BackendBus.positions_updated.connect(_on_positions_refresh)
	if BackendBus.positions_are_demo:
		var demo_note := TerminalTheme.label(
				UIStrings.t("demo.positions"),
				13, Palette.YELLOW, "medium")
		demo_note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		_content.add_child(demo_note)

	var visible_rows := _pos_filtered(all, "")
	var active_filters := _pos_active_filter_count()
	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", 16)
	_content.add_child(head)
	var count := TerminalTheme.label(UIStrings.t("pos.count")
			% [all.size(), visible_rows.size()], 15, Palette.MINT, "medium")
	count.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(count)
	var filters_btn := Button.new()
	filters_btn.text = UIStrings.t("pos.filters_hide") if _pos_filters_open \
			else UIStrings.t("pos.filters") % active_filters
	filters_btn.add_theme_font_size_override("font_size", 13)
	filters_btn.add_theme_color_override("font_color",
			Palette.GREEN if _pos_filters_open or active_filters > 0 else Palette.BASE)
	filters_btn.pressed.connect(func() -> void:
		_pos_filters_open = not _pos_filters_open
		Sfx.play_tick()
		_build())
	head.add_child(filters_btn)
	if active_filters > 0:
		var clear := Button.new()
		clear.text = UIStrings.t("pos.clear")
		clear.add_theme_font_size_override("font_size", 13)
		clear.add_theme_color_override("font_color", Palette.RED)
		clear.pressed.connect(func() -> void:
			for key in _pos_filters:
				_pos_filters[key] = {}
			_pos_page = 1
			_build())
		head.add_child(clear)

	if _pos_filters_open:
		var filter_bar := HFlowContainer.new()
		filter_bar.add_theme_constant_override("h_separation", 10)
		filter_bar.add_theme_constant_override("v_separation", 8)
		_content.add_child(filter_bar)
		_pos_filter_menu(filter_bar, "status", UIStrings.t("pos.f_status"), all)
		_pos_filter_menu(filter_bar, "role_family", UIStrings.t("pos.f_family"), all)
		_pos_filter_menu(filter_bar, "work_mode", UIStrings.t("pos.f_mode"), all)
		_pos_filter_menu(filter_bar, "loc_country", UIStrings.t("pos.f_country"), all)
	_content.add_child(HSeparator.new())

	if visible_rows.is_empty():
		_content.add_child(TerminalTheme.label(UIStrings.t("pos.no_match"),
				15, Palette.DIM))
		return
	var page_count := maxi(1, int(ceil(float(visible_rows.size()) / _pos_page_size)))
	_pos_page = clampi(_pos_page, 1, page_count)
	var start := (_pos_page - 1) * _pos_page_size
	var end := mini(start + _pos_page_size, visible_rows.size())

	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.custom_minimum_size = Vector2(0, 300)
	_content.add_child(scroll)
	var list := VBoxContainer.new()
	list.add_theme_constant_override("separation", 6)
	list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(list)
	for p in visible_rows.slice(start, end):
		list.add_child(_pos_row(p))
	_pos_pagination(start, end, visible_rows.size(), page_count)

func _on_positions_refresh(_list: Array) -> void:
	if section == "positions" and is_instance_valid(_content):
		# lo snapshot nuovo non deve buttarti fuori dal dettaglio aperto,
		# né cancellare il ticket che stai scrivendo o aspettando
		if is_instance_valid(_ticket_input) and (_ticket_input.text.strip_edges() != ""
				or (is_instance_valid(_ticket_send) and _ticket_send.disabled)):
			return
		_build("detail" if _pos_detail_id != 0 else "")

func _on_dash_refresh(_list: Array) -> void:
	if section != "dashboard" or not is_instance_valid(_content):
		return
	# non azzerare i filtri che l'utente ha scelto nei grafici: coi
	# filtri attivi i charts si aggiornano da soli, il resto aspetta
	for c in _content.get_children():
		if c is ScrollContainer and c.get_child_count() > 0 \
				and c.get_child(0) is StatsCharts and c.get_child(0)._active_count() > 0:
			return
	_build()

## Il primo snapshot posizioni rimpiazza mock/placeholder coi grafici
## veri; una volta montati, StatsCharts si aggiorna da sé (e non va
## ricostruito: azzererebbe i filtri scelti). Mai mentre sei su Utilizzo.
func _on_stats_refresh(_list: Array) -> void:
	if section == "stats" and _current_page == "" and is_instance_valid(_content) \
			and _content.get_child_count() > 0 and not (_content.get_child(0) is ScrollContainer):
		_build()

func _on_agents_refresh(_list: Array) -> void:
	if section == "agents" and is_instance_valid(_content):
		_build("agent" if _agent_detail != "" else "")

var _agent_detail := ""

func _on_agent_page_refresh(_settings: Dictionary) -> void:
	if section == "agents" and _agent_detail != "" and is_instance_valid(_content):
		_build("agent")

## La pagina del singolo agente (/team/<slug> del web): stato live,
## consumo nella finestra, le SUE ultime transizioni. Tutto dal bus.
func _build_agent_page() -> void:
	_listen_setup()
	# refresh anche entrando qui direttamente (senza passare dalla lista)
	if not BackendBus.agents_updated.is_connected(_on_agents_refresh):
		BackendBus.agents_updated.connect(_on_agents_refresh)
	if not BackendBus.live_settings_updated.is_connected(_on_agent_page_refresh):
		BackendBus.live_settings_updated.connect(_on_agent_page_refresh)
	var agent := {}
	for a in BackendBus.agents:
		if str(a.get("slug", "")) == _agent_detail:
			agent = a
			break
	var back := Button.new()
	back.flat = true
	back.text = UIStrings.t("agents.back")
	back.add_theme_font_size_override("font_size", 14)
	back.add_theme_color_override("font_color", Palette.MUTED)
	back.add_theme_color_override("font_hover_color", Palette.GREEN)
	back.alignment = HORIZONTAL_ALIGNMENT_LEFT
	back.pressed.connect(func() -> void:
		_agent_detail = ""
		Sfx.play_back()
		_build())
	_content.add_child(back)

	var slug := _agent_detail
	var title_row := HBoxContainer.new()
	title_row.add_theme_constant_override("separation", 14)
	_content.add_child(title_row)
	title_row.add_child(TerminalTheme.label(ROLE_EMOJI.get(slug, "●"), 22, Palette.GREEN))
	title_row.add_child(TerminalTheme.label(
			str(agent.get("name", slug.capitalize())), 22, Palette.WHITE, "xbold"))
	title_row.add_child(TerminalTheme.label(
			str(agent.get("status", "offline")) if not agent.is_empty()
					else UIStrings.t("agents.not_active"),
			15, Palette.MINT if not agent.is_empty() else Palette.DIM, "medium"))
	if not agent.is_empty():
		var restart := Button.new()
		restart.text = UIStrings.t("agents.restart")
		restart.add_theme_color_override("font_color", Palette.YELLOW)
		restart.pressed.connect(SetupService.control_agent.bind(slug, true))
		title_row.add_child(restart)
		var stop := Button.new()
		stop.text = UIStrings.t("agents.stop")
		stop.add_theme_color_override("font_color", Palette.RED)
		stop.pressed.connect(SetupService.control_agent.bind(slug, false))
		title_row.add_child(stop)
	# la chat con l'agente si apre DA QUI (paradigma desktop app)
	if BackendBus.can_chat_with(slug) or ScriptedOnboarding.supports(slug):
		var chat_btn := Button.new()
		chat_btn.text = UIStrings.t("agent.chat")
		chat_btn.add_theme_font_size_override("font_size", 14)
		chat_btn.add_theme_color_override("font_color", Palette.GREEN)
		var display := str(agent.get("name", slug.capitalize()))
		chat_btn.pressed.connect(func() -> void:
			add_child(ChatPanel.new(slug, display)))
		title_row.add_child(chat_btn)
		if not BackendBus.chat_replies(slug):
			title_row.add_child(TerminalTheme.label(
					UIStrings.t("agents.chat_besteffort"), 12, Palette.DIM))
	_content.add_child(HSeparator.new())
	_setup_message = TerminalTheme.label("", 13, Palette.DIM)
	_content.add_child(_setup_message)

	# consumo dell'agente nella finestra usage (tutte le sue istanze)
	var usage: Dictionary = BackendBus.live_settings.get("usage", {})
	var per_agent: Dictionary = usage.get("per_agent_kt", {})
	var kt := 0.0
	var real := "capitano" if slug == "coordinatore" else slug
	for key in per_agent:
		if str(key).split("-")[0] == real:
			kt += float(per_agent[key])
	_kpi_row(UIStrings.t("agents.consumption") % str(usage.get("window_h", "?")),
			"%.1f kt" % kt, Palette.MINT)

	# le sue transizioni recenti (tutte le istanze del ruolo)
	var mine: Array = []
	for t in BackendBus.transitions:
		var by := str(t.get("by_agent", "") if t.get("by_agent") else "")
		if by.split("-")[0] == real:
			mine.append(t)
	_kpi_row(UIStrings.t("agents.registry_actions"), str(mine.size()), Palette.BRIGHT)
	# Le deroghe che l'utente concede al team stanno sulla pagina di CHI ne
	# diventa responsabile: tolti gli automatismi, l'unica sorveglianza che
	# resta sul consumo è il Coordinatore.
	if slug == "coordinatore":
		_content.add_child(HSeparator.new())
		_build_burn_mode()
	_content.add_child(HSeparator.new())
	# il grafico storico del ruolo (token, quote finestre, throttle,
	# azioni db, contesto container) — si autogestisce con cache: i
	# rebuild live della pagina non rifanno il giro SSH
	_content.add_child(AgentHistoryChart.new(real))
	_content.add_child(HSeparator.new())
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_content.add_child(scroll)
	var list := VBoxContainer.new()
	list.add_theme_constant_override("separation", 8)
	list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(list)
	list.add_child(TerminalTheme.label(UIStrings.t("agent.activity"),
			14, Palette.MUTED, "medium"))
	if mine.is_empty():
		list.add_child(TerminalTheme.label(
				UIStrings.t("agents.no_transitions"), 14, Palette.DIM))
	for t in mine.slice(0, 30):
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 14)
		list.add_child(row)
		var when := TerminalTheme.label(str(t.get("ts", "")).left(16), 13, Palette.DIM)
		when.custom_minimum_size = Vector2(140, 0)
		row.add_child(when)
		# Chi ha mosso la posizione: cognome davanti, uid tecnico dietro. La
		# riga è larga e l'uid serve a chi poi va a cercare quell'agente nei
		# log, quindi qui ci sta la forma completa.
		var who := TerminalTheme.label(
				AgentNames.display_name(str(t.get("by_agent", "?"))), 13, Palette.MINT)
		who.custom_minimum_size = Vector2(200, 0)
		row.add_child(who)
		var what := TerminalTheme.label("%s — %s" % [str(t.get("title", "?")),
				str(t.get("company", ""))], 14, Palette.BASE)
		what.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		what.clip_text = true
		row.add_child(what)
		var to_st := str(t.get("to_state", "?"))
		row.add_child(TerminalTheme.label("→ " + to_st, 13,
				_pos_status_color(to_st, Palette.MUTED), "medium"))

	# le sue COMUNICAZIONI nel team (i core non lavorano posizioni, ma
	# parlano: senza questo blocco la pagina di Assistente/Mentor è vuota)
	var talks: Array = []
	for m in BackendBus.chat_log:
		if str(m.get("from", "")) == slug or str(m.get("to", "")) == slug:
			talks.append(m)
	list.add_child(HSeparator.new())
	list.add_child(TerminalTheme.label(UIStrings.t("agents.comms"),
			14, Palette.MUTED, "medium"))
	if talks.is_empty():
		list.add_child(TerminalTheme.label(UIStrings.t("agents.no_comms"),
				14, Palette.DIM))
	for i in range(maxi(0, talks.size() - 15), talks.size()):
		var m: Dictionary = talks[i]
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 14)
		list.add_child(row)
		var when := TerminalTheme.label(
				str(m.get("ts", "")).replace("T", " ").left(16), 13, Palette.DIM)
		when.custom_minimum_size = Vector2(140, 0)
		row.add_child(when)
		# Due nomi sulla stessa cella: qui vale il solo cognome, altrimenti la
		# colonna raddoppia per ripetere due volte il ruolo che si legge già
		# dal contesto.
		var who := TerminalTheme.label("%s → %s"
				% [AgentNames.short_name(str(m.get("from", "?"))),
						AgentNames.short_name(str(m.get("to", "?")))],
				13, Palette.MINT, "medium")
		who.custom_minimum_size = Vector2(210, 0)
		row.add_child(who)
		row.add_child(_pos_paragraph(str(m.get("text", ""))))

## ── Modalità operative: la deroga a termine agli automatismi di spesa ──
##
## Finora esisteva solo come `jht burn on` da terminale. Il prodotto non
## chiede mai all'utente di aprire una shell — le dipendenze si installano
## in-app, il team si comanda dall'app — quindi la deroga vive qui, e da qui
## pilota lo STESSO shared/skills/burn_intent.py che leggono i bridge e il
## prompt del Capitano. Nessuna seconda implementazione, nessuna seconda
## verità: il gioco chiede e rilegge, non decide.

var _burn_toggle: CheckButton
var _burn_hours: SpinBox
var _burn_state_lbl: Label
## Durata scelta dall'utente, tenuta fuori dai widget: la pagina si
## ricostruisce a ogni giro del roster e la scelta non deve azzerarsi
## sotto le dita di chi la sta impostando.
var _burn_hours_choice := BurnMode.DEFAULT_HOURS
## true mentre siamo NOI a riallineare l'interruttore allo stato letto:
## senza, ogni rilettura riaprirebbe da sola il dialogo di conferma.
var _burn_syncing := false
## true fra la richiesta e la risposta del container: finché dura, lo stato
## a schermo non è né quello vecchio né quello nuovo, e non va riscritto.
var _burn_pending := false

func _build_burn_mode() -> void:
	if not BackendBus.burn_intent_updated.is_connected(_on_burn_intent):
		BackendBus.burn_intent_updated.connect(_on_burn_intent)
	if not BackendBus.burn_intent_action_done.is_connected(_on_burn_action):
		BackendBus.burn_intent_action_done.connect(_on_burn_action)

	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", 14)
	_content.add_child(head)
	head.add_child(TerminalTheme.label("▰ " + UIStrings.t("burn.section"),
			14, Palette.YELLOW, "bold"))
	var head_desc := TerminalTheme.label(UIStrings.t("burn.section_desc"),
			11, Palette.DIM)
	head_desc.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head_desc.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	head.add_child(head_desc)

	var card := PanelContainer.new()
	var style := StyleBoxFlat.new()
	style.bg_color = Palette.CARD
	style.border_color = Palette.BORDER
	style.set_border_width_all(TerminalTheme.hairline())
	style.content_margin_left = 16
	style.content_margin_right = 16
	style.content_margin_top = 14
	style.content_margin_bottom = 14
	card.add_theme_stylebox_override("panel", style)
	_content.add_child(card)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 8)
	card.add_child(box)

	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	box.add_child(row)
	var title := TerminalTheme.label(UIStrings.t("burn.title"), 15,
			Palette.BRIGHT, "bold")
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(title)
	row.add_child(TerminalTheme.label(UIStrings.t("burn.duration"), 12,
			Palette.MUTED))
	_burn_hours = SpinBox.new()
	_burn_hours.min_value = 1
	_burn_hours.max_value = BurnMode.MAX_HOURS
	_burn_hours.step = 1
	_burn_hours.value = _burn_hours_choice
	_burn_hours.suffix = "h"
	_burn_hours.custom_minimum_size = Vector2(104, 0)
	_burn_hours.value_changed.connect(func(v: float) -> void:
		_burn_hours_choice = int(v))
	row.add_child(_burn_hours)
	_burn_toggle = CheckButton.new()
	_burn_toggle.tooltip_text = UIStrings.t("burn.title")
	_burn_toggle.toggled.connect(_on_burn_toggled)
	row.add_child(_burn_toggle)

	_burn_state_lbl = TerminalTheme.label("", 13, Palette.MUTED, "medium")
	box.add_child(_burn_state_lbl)
	var desc := TerminalTheme.label(UIStrings.t("burn.desc"), 12, Palette.BASE)
	desc.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	box.add_child(desc)
	# Il numero misurato sta QUI e non solo nell'avviso: è la risposta alla
	# domanda che uno si fa dopo aver attivato ("perché non sta al 100%?"),
	# e chi la legge prima decide sapendo cosa comprare.
	var measured := TerminalTheme.label(UIStrings.t("burn.desc_measured"), 11,
			Palette.DIM)
	measured.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	box.add_child(measured)

	# Il tempo scorre anche a pagina ferma. Il residuo si aggiorna da solo sul
	# delta già ricevuto, e ogni tanto si torna a CHIEDERE: la deroga può
	# essere scaduta o essere stata revocata dal Capitano mentre guardavamo.
	var tick := Timer.new()
	tick.wait_time = 5.0
	tick.autostart = true
	tick.timeout.connect(func() -> void:
		BackendBus.request_burn_intent()
		_refresh_burn_state())
	_content.add_child(tick)

	if _burn_pending:
		_burn_state_lbl.text = "◌ " + UIStrings.t("burn.sending")
	else:
		_refresh_burn_state()
	BackendBus.request_burn_intent()

## Lo stato a schermo viene SEMPRE dal flag riletto, mai dal click: la deroga
## scade da sola e il Capitano può revocarla, quindi un interruttore che
## ricorda l'ultima intenzione dell'utente mente entro cinque ore.
func _refresh_burn_state() -> void:
	if not is_instance_valid(_burn_state_lbl):
		return
	if _burn_pending:
		return
	var st := BurnMode.state_for(BackendBus.burn_intent)
	var state := str(st["state"])
	var active := state == BurnMode.STATE_ACTIVE
	_burn_syncing = true
	_burn_toggle.button_pressed = active
	_burn_syncing = false
	_burn_toggle.disabled = state == BurnMode.STATE_UNSUPPORTED
	_burn_hours.max_value = int(st["max_hours"])
	# A deroga concessa la durata è già scritta nel flag: cambiarla qui non
	# sposterebbe la scadenza, e un campo che non fa nulla è una bugia.
	_burn_hours.editable = not active and not _burn_toggle.disabled
	var text := ""
	var color := Palette.MUTED
	match state:
		BurnMode.STATE_ACTIVE:
			var left := BurnMode.remaining_text(int(st["remaining_sec"]))
			var pattern := UIStrings.t("burn.state_soon") \
					if bool(st["expiring_soon"]) else UIStrings.t("burn.state_active")
			text = "✓ " + (pattern % left)
			color = Palette.YELLOW if bool(st["expiring_soon"]) else Palette.GREEN
		BurnMode.STATE_OFF:
			text = "○ " + UIStrings.t("burn.state_off")
		BurnMode.STATE_UNSUPPORTED:
			text = "? " + UIStrings.t("burn.state_unsupported")
			color = Palette.DIM
		_:
			text = "? " + UIStrings.t("burn.state_unknown")
			color = Palette.DIM
	_burn_state_lbl.text = text
	_burn_state_lbl.add_theme_color_override("font_color", color)

func _on_burn_toggled(pressed: bool) -> void:
	if _burn_syncing:
		return
	# Rimettere un freno non ha bisogno di essere confermato: la conferma
	# serve a chi lo toglie.
	if not pressed:
		_burn_apply(false)
		return
	var st := BurnMode.state_for(BackendBus.burn_intent)
	# La durata che l'avviso PROMETTE e quella che viene poi scritta devono
	# essere lo stesso numero, anche se il campo non ha ancora perso il fuoco.
	_burn_hours_choice = int(_burn_hours.value)
	var hours := _burn_hours_choice
	var dialog := ConfirmationDialog.new()
	dialog.title = UIStrings.t("burn.confirm_title")
	# I nomi dei freni che restano in piedi non sono una parafrasi: arrivano
	# da NEVER_YIELDS di burn_intent.py, passando dal container.
	dialog.dialog_text = UIStrings.t("burn.confirm_body") % [str(hours),
			str(int(st["max_hours"])),
			", ".join(PackedStringArray(st["never_yields"]))]
	dialog.ok_button_text = UIStrings.t("burn.confirm_ok") % str(hours)
	dialog.confirmed.connect(func() -> void: _burn_apply(true))
	# Annullare deve far RISALIRE l'interruttore: lasciarlo giù direbbe che
	# la deroga è attiva quando sul disco non c'è nulla.
	dialog.canceled.connect(_refresh_burn_state)
	dialog.canceled.connect(dialog.queue_free)
	dialog.confirmed.connect(dialog.queue_free)
	add_child(dialog)
	dialog.popup_centered(Vector2i(780, 440))

func _burn_apply(active: bool) -> void:
	_burn_pending = true
	if is_instance_valid(_burn_state_lbl):
		_burn_state_lbl.text = "◌ " + UIStrings.t("burn.sending")
		_burn_state_lbl.add_theme_color_override("font_color", Palette.YELLOW)
	BackendBus.set_burn_intent(active, float(_burn_hours_choice))

func _on_burn_intent(_state: Dictionary) -> void:
	_refresh_burn_state()

func _on_burn_action(_active: bool, ok: bool, error: String) -> void:
	_burn_pending = false
	if not is_instance_valid(_burn_state_lbl):
		return
	# Anche in caso di successo non si scrive "fatto": il backend rilegge il
	# flag subito dopo, ed è quella lettura a comandare l'interruttore.
	_refresh_burn_state()
	if not ok:
		_burn_state_lbl.text = "? " + UIStrings.t("burn.failed") % error
		_burn_state_lbl.add_theme_color_override("font_color", Palette.RED)

func _on_config_refresh(_settings: Dictionary) -> void:
	if is_instance_valid(_content) and section in ["hours",
			"provider", "docker", "account", "email", "appearance", "language",
			"advanced"]:
		_build()

## Posizioni filtrate da tutti i gruppi tranne `skip` (cross-filter).
func _pos_filtered(all: Array, skip: String) -> Array:
	var out: Array = []
	for p in all:
		var ok := true
		for key in _pos_filters:
			if key == skip:
				continue
			var chosen: Dictionary = _pos_filters[key]
			if chosen.is_empty():
				continue
			if not chosen.has(_pos_value(p, key)):
				ok = false
				break
		if ok:
			out.append(p)
	return out

func _pos_value(p: Dictionary, key: String) -> String:
	var v := str(p.get(key, ""))
	return v if v != "" and v != "<null>" else UIStrings.t("pos.uncategorized")

func _pos_active_filter_count() -> int:
	var total := 0
	for key in _pos_filters:
		total += (_pos_filters[key] as Dictionary).size()
	return total

## Menu compatto multiselezione: conserva il cross-filtering del web senza
## occupare tre righe di chip (i valori compaiono solo quando si apre il menu).
func _pos_filter_menu(parent: Control, key: String, title: String, all: Array) -> void:
	var pool := _pos_filtered(all, key)
	var counts := {}
	for p in pool:
		var v := _pos_value(p, key)
		counts[v] = int(counts.get(v, 0)) + 1
	var values: Array = counts.keys()
	if key == "status":  # ordine di pipeline, non alfabetico
		var ordered: Array = []
		for st in POS_STATUS_ORDER:
			if counts.has(st):
				ordered.append(st)
		for v in values:
			if not POS_STATUS_ORDER.has(v):
				ordered.append(v)
		values = ordered
	else:
		values.sort()

	var chosen: Dictionary = _pos_filters[key]
	var summary := UIStrings.t("pos.all")
	if chosen.size() == 1:
		summary = str(chosen.keys()[0])
	elif chosen.size() > 1:
		summary = UIStrings.t("pos.selected") % chosen.size()
	var menu := MenuButton.new()
	menu.text = "%s  ·  %s" % [title, summary]
	menu.custom_minimum_size = Vector2(230, 34)
	menu.clip_text = true
	menu.add_theme_font_size_override("font_size", 13)
	menu.add_theme_color_override("font_color",
			Palette.GREEN if not chosen.is_empty() else Palette.BASE)
	parent.add_child(menu)
	var popup := menu.get_popup()
	popup.add_check_item(UIStrings.t("pos.all") + "  (%d)" % pool.size(), 0)
	popup.set_item_checked(0, chosen.is_empty())
	popup.add_separator()
	for i in values.size():
		var value := str(values[i])
		popup.add_check_item("%s  (%d)" % [value, counts[value]], i + 1)
		popup.set_item_checked(popup.item_count - 1, chosen.has(value))
	popup.id_pressed.connect(func(id: int) -> void:
		if id == 0:
			chosen.clear()
		elif id - 1 < values.size():
			var value := str(values[id - 1])
			if chosen.has(value):
				chosen.erase(value)
			else:
				chosen[value] = true
		_pos_page = 1
		Sfx.play_tick()
		_build())

func _pos_pagination(start: int, end: int, total: int, page_count: int) -> void:
	var footer := HBoxContainer.new()
	footer.add_theme_constant_override("separation", 8)
	_content.add_child(footer)
	var range_label := TerminalTheme.label(UIStrings.t("pos.range") % [
			start + 1, end, total], 13, Palette.MUTED, "medium")
	range_label.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	footer.add_child(range_label)
	footer.add_child(TerminalTheme.label(UIStrings.t("pos.rows"), 12, Palette.DIM, "medium"))
	for size in POS_PAGE_SIZES:
		var size_btn := Button.new()
		size_btn.text = str(size)
		size_btn.flat = true
		size_btn.add_theme_font_size_override("font_size", 13)
		size_btn.add_theme_color_override("font_color",
				Palette.GREEN if size == _pos_page_size else Palette.MUTED)
		var selected_size: int = size
		size_btn.pressed.connect(func() -> void:
			_pos_page_size = selected_size
			_pos_page = 1
			Sfx.play_tick()
			_build())
		footer.add_child(size_btn)
	var previous := Button.new()
	previous.text = UIStrings.t("pos.previous")
	previous.disabled = _pos_page <= 1
	previous.add_theme_font_size_override("font_size", 13)
	previous.pressed.connect(func() -> void:
		_pos_page -= 1
		Sfx.play_tick()
		_build())
	footer.add_child(previous)
	var page_label := TerminalTheme.label(UIStrings.t("pos.page") % [
			_pos_page, page_count], 13, Palette.BRIGHT, "medium")
	page_label.custom_minimum_size = Vector2(120, 0)
	page_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	footer.add_child(page_label)
	var next := Button.new()
	next.text = UIStrings.t("pos.next")
	next.disabled = _pos_page >= page_count
	next.add_theme_font_size_override("font_size", 13)
	next.pressed.connect(func() -> void:
		_pos_page += 1
		Sfx.play_tick()
		_build())
	footer.add_child(next)

## Una posizione in lista, tabellare full-width come la pagina web:
## score | titolo — azienda (espande) | famiglia | luogo | salario | stato.
func _pos_row(p: Dictionary) -> Control:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 14)
	var score_v: Variant = p.get("total_score")
	var score_txt := "—" if score_v == null else str(int(score_v))
	var score_col: Color = Palette.DIM if score_v == null \
			else (Palette.MINT if int(score_v) >= 70 else Palette.YELLOW)
	var score := TerminalTheme.label(score_txt, 17, score_col, "bold")
	score.custom_minimum_size = Vector2(44, 0)
	row.add_child(score)
	# il titolo apre la pagina della posizione (come sul web)
	var title_btn := Button.new()
	title_btn.flat = true
	title_btn.text = "%s — %s" % [_pos_value(p, "title"), _pos_value(p, "company")]
	title_btn.add_theme_font_size_override("font_size", 15)
	title_btn.add_theme_color_override("font_color", Palette.BRIGHT)
	title_btn.add_theme_color_override("font_hover_color", Palette.GREEN)
	title_btn.alignment = HORIZONTAL_ALIGNMENT_LEFT
	title_btn.clip_text = true
	title_btn.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	title_btn.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
	var pid := int(p.get("id", 0))
	title_btn.pressed.connect(func() -> void:
		_pos_detail_id = pid
		Sfx.play_tick()
		_build("detail"))
	row.add_child(title_btn)
	var family := TerminalTheme.label(_pos_value(p, "role_family"), 13, Palette.MUTED)
	family.custom_minimum_size = Vector2(220, 0)
	family.clip_text = true
	row.add_child(family)
	var place := TerminalTheme.label("%s · %s" % [
			str(p.get("loc_city", "") if p.get("loc_city") else "—"),
			_pos_value(p, "loc_country")], 13, Palette.MUTED)
	place.custom_minimum_size = Vector2(200, 0)
	place.clip_text = true
	row.add_child(place)
	var est: bool = p.get("salary_estimated_min") != null
	var s_min: Variant = p.get("salary_estimated_min") if est else p.get("salary_declared_min")
	var s_max: Variant = p.get("salary_estimated_max") if est else p.get("salary_declared_max")
	var cur_v: Variant = p.get("salary_estimated_currency") if est \
			else p.get("salary_declared_currency")
	var s_cur := str(cur_v) if cur_v != null else "EUR"
	var sal := "—" if s_min == null and s_max == null \
			else _fmt_salary_eur(s_min, s_max, s_cur)
	var sal_lbl := TerminalTheme.label(sal, 13,
			Palette.BASE if sal != "—" else Palette.DIM)
	sal_lbl.custom_minimum_size = Vector2(110, 0)
	row.add_child(sal_lbl)
	var st := _pos_value(p, "status")
	var st_lbl := TerminalTheme.label(st, 13,
			_pos_status_color(st, Palette.MUTED), "medium")
	st_lbl.custom_minimum_size = Vector2(90, 0)
	row.add_child(st_lbl)
	# aria a destra: la scrollbar non deve coprire lo stato
	var pad := Control.new()
	pad.custom_minimum_size = Vector2(14, 0)
	row.add_child(pad)
	return row

# ── Dettaglio posizione (la pagina del web privato) ───────────────────

## Pesi del breakdown come sul web: fattore → massimo.
const SCORE_WEIGHTS := [
	["stack_match", "Stack", 40], ["remote_fit", "Remote", 25],
	["salary_fit", "Salary", 20], ["experience_fit", "Experience", 10],
	["strategic_fit", "Strategic", 15],
]
static func _verdict_color(verdict: String) -> Color:
	return {"PASS": Palette.GREEN, "NEEDS_WORK": Palette.YELLOW,
			"REJECT": Palette.RED}.get(verdict, Palette.MUTED)

var _pos_detail_id := 0

func _build_pos_detail() -> void:
	var p := {}
	for row in BackendBus.positions:
		if int(row.get("id", 0)) == _pos_detail_id:
			p = row
			break
	if p.is_empty():
		_build_positions()
		return

	var back := Button.new()
	back.flat = true
	back.text = UIStrings.t("pos.back")
	back.add_theme_font_size_override("font_size", 14)
	back.add_theme_color_override("font_color", Palette.MUTED)
	back.add_theme_color_override("font_hover_color", Palette.GREEN)
	back.alignment = HORIZONTAL_ALIGNMENT_LEFT
	back.pressed.connect(func() -> void:
		_pos_detail_id = 0
		Sfx.play_back()
		_build())
	_content.add_child(back)

	# scroll unico: il dettaglio è lungo
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.custom_minimum_size = Vector2(0, 540)
	_content.add_child(scroll)
	# TEST-AUTO: JHT_SCROLL_END=1 porta lo scroll in fondo (per gli shot
	# delle sezioni basse del dettaglio: ticket, esclusioni)
	if OS.get_environment("JHT_SCROLL_END") == "1":
		scroll.get_v_scroll_bar().changed.connect(func() -> void:
			scroll.scroll_vertical = int(scroll.get_v_scroll_bar().max_value))
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 10)
	box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(box)

	# ── intestazione ──
	box.add_child(TerminalTheme.label(_pos_value(p, "title"), 22, Palette.WHITE, "xbold"))
	var sub := HBoxContainer.new()
	sub.add_theme_constant_override("separation", 14)
	box.add_child(sub)
	sub.add_child(TerminalTheme.label(_pos_value(p, "company"), 16, Palette.BRIGHT, "medium"))
	sub.add_child(TerminalTheme.label("%s · %s · %s" % [
			str(p.get("loc_city", "") if p.get("loc_city") else "—"),
			_pos_value(p, "loc_country"), _pos_value(p, "work_mode")],
			14, Palette.MUTED))
	var st := _pos_value(p, "status")
	sub.add_child(TerminalTheme.label(st, 14,
			_pos_status_color(st, Palette.MUTED), "bold"))
	# L'indirizzo che gli Analisti hanno faticato a trovare vive SOLO qui,
	# accanto a città e paese: è la stessa informazione, alla sua massima
	# precisione. Con office_verified=0 il team ha ripiegato sul centro città
	# e lo dice — è anche la ragione per cui il pin sulla mappa è vuoto.
	var addr_v: Variant = p.get("office_address")
	var addr := str(addr_v).strip_edges() if addr_v != null else ""
	if addr != "" and addr != "<null>":
		var exact := MapPins.is_exact(p)
		var tag := UIStrings.t("pos.office_verified") if exact \
				else UIStrings.t("pos.office_approx")
		var arow := HBoxContainer.new()
		arow.add_theme_constant_override("separation", 10)
		box.add_child(arow)
		arow.add_child(TerminalTheme.label(UIStrings.t("pos.office_address"),
				13, Palette.MUTED, "medium"))
		arow.add_child(TerminalTheme.label(addr, 14,
				Palette.BASE if exact else Palette.MUTED))
		arow.add_child(TerminalTheme.label(tag, 12,
				Palette.MINT if exact else Palette.DIM, "medium"))
	if p.get("found_by"):
		box.add_child(TerminalTheme.label(UIStrings.t("pos.found") % [
				str(p["found_by"]), str(p.get("found_at", "")).left(10)], 13, Palette.DIM))
	if p.get("url"):
		# il link all'annuncio si APRE davvero, nel browser di sistema
		var link := Button.new()
		link.flat = true
		link.alignment = HORIZONTAL_ALIGNMENT_LEFT
		link.clip_text = true
		link.text = "↗ " + str(p["url"])
		link.add_theme_font_size_override("font_size", 13)
		link.add_theme_color_override("font_color", Palette.BLUE)
		link.add_theme_color_override("font_hover_color", Palette.MINT)
		link.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
		link.tooltip_text = UIStrings.t("pos.open_url")
		var url := str(p["url"])
		link.pressed.connect(func() -> void: OS.shell_open(url))
		box.add_child(link)
	var open_v: Variant = p.get("is_open")
	if open_v != null:
		box.add_child(TerminalTheme.label(
				UIStrings.t("pos.open_yes") if int(open_v) == 1 else UIStrings.t("pos.open_no"),
				13, Palette.MINT if int(open_v) == 1 else Palette.RED))
	box.add_child(HSeparator.new())

	# ── stipendio (stima del team se c'è, altrimenti il dichiarato) ──
	var est: bool = p.get("salary_estimated_min") != null or p.get("salary_estimated_max") != null
	var s_min: Variant = p.get("salary_estimated_min") if est else p.get("salary_declared_min")
	var s_max: Variant = p.get("salary_estimated_max") if est else p.get("salary_declared_max")
	if s_min != null or s_max != null:
		var cur := str(p.get("salary_estimated_currency") if est \
				else p.get("salary_declared_currency"))
		if cur == "" or cur == "<null>":
			cur = "EUR"
		var rng := _fmt_salary_eur(s_min, s_max, cur)
		if cur.to_upper() != "EUR":
			rng += "  (%s–%s %s)" % [_fmt_k(s_min), _fmt_k(s_max), cur]
		var srow := HBoxContainer.new()
		srow.add_theme_constant_override("separation", 12)
		box.add_child(srow)
		var slbl := TerminalTheme.label(UIStrings.t("pos.salary"), 14, Palette.MUTED, "medium")
		slbl.custom_minimum_size = Vector2(220, 0)
		srow.add_child(slbl)
		srow.add_child(TerminalTheme.label(rng, 17, Palette.MINT, "bold"))
		srow.add_child(TerminalTheme.label(
				UIStrings.t("pos.salary_estimated") if est else UIStrings.t("pos.salary_declared"),
				13, Palette.DIM))

	# ── riassunto annuncio ──
	if p.get("jd_summary"):
		box.add_child(TerminalTheme.label(UIStrings.t("pos.summary"), 14, Palette.MUTED, "medium"))
		box.add_child(_pos_paragraph(str(p["jd_summary"])))
	box.add_child(HSeparator.new())

	# ── score breakdown pesato ──
	if p.get("total_score") != null:
		box.add_child(TerminalTheme.label(
				UIStrings.t("pos.score_title") % int(p["total_score"]), 17,
				Palette.MINT if int(p["total_score"]) >= 70 else Palette.YELLOW, "bold"))
		for w in SCORE_WEIGHTS:
			var val: Variant = p.get(w[0])
			if val == null:
				continue
			var wrow := HBoxContainer.new()
			wrow.add_theme_constant_override("separation", 12)
			box.add_child(wrow)
			var wl := TerminalTheme.label("%s (su %d)" % [w[1], w[2]], 13, Palette.MUTED)
			wl.custom_minimum_size = Vector2(220, 0)
			wrow.add_child(wl)
			var bar := ProgressBar.new()
			bar.custom_minimum_size = Vector2(220, 12)
			bar.max_value = float(w[2])
			bar.value = float(val)
			bar.show_percentage = false
			bar.modulate = Palette.GREEN
			wrow.add_child(bar)
			wrow.add_child(TerminalTheme.label("%d/%d" % [int(val), w[2]],
					13, Palette.BRIGHT, "medium"))
		if p.get("score_notes"):
			box.add_child(TerminalTheme.label(UIStrings.t("pos.score_rationale"),
					13, Palette.MUTED, "medium"))
			box.add_child(_pos_paragraph(str(p["score_notes"])))
		if p.get("scored_by"):
			box.add_child(TerminalTheme.label("— %s · %s" % [str(p["scored_by"]),
					str(p.get("scored_at", "")).left(10)], 12, Palette.DIM))
	else:
		box.add_child(TerminalTheme.label(UIStrings.t("pos.score_none"), 14, Palette.DIM))
	box.add_child(HSeparator.new())

	# ── voto del critico (0-10, distinto dallo score) ──
	if p.get("critic_score") != null:
		var crow := HBoxContainer.new()
		crow.add_theme_constant_override("separation", 14)
		box.add_child(crow)
		crow.add_child(TerminalTheme.label(
				UIStrings.t("pos.critic_title") % float(p["critic_score"]),
				16, Palette.BRIGHT, "bold"))
		var verdict := str(p.get("critic_verdict", ""))
		if verdict != "" and verdict != "<null>":
			crow.add_child(TerminalTheme.label(verdict, 15,
					_verdict_color(verdict), "bold"))
		if p.get("critic_notes"):
			box.add_child(_pos_paragraph(str(p["critic_notes"])))
	else:
		box.add_child(TerminalTheme.label(UIStrings.t("pos.critic_none"), 14, Palette.DIM))
	box.add_child(HSeparator.new())

	# ── punti chiave ──
	var highlights: Array = p.get("highlights", [])
	if not highlights.is_empty():
		box.add_child(TerminalTheme.label(UIStrings.t("pos.highlights"), 14,
				Palette.MUTED, "medium"))
		for h in highlights:
			var kind := str(h.get("type", ""))
			var good := kind.containsn("pro") or kind.containsn("plus") or kind.containsn("match")
			var bad := kind.containsn("con") or kind.containsn("minus") or kind.containsn("risk")
			var hrow := HBoxContainer.new()
			hrow.add_theme_constant_override("separation", 10)
			box.add_child(hrow)
			hrow.add_child(TerminalTheme.label("▲" if good else ("▼" if bad else "•"), 13,
					Palette.GREEN if good else (Palette.RED if bad else Palette.MUTED)))
			hrow.add_child(_pos_paragraph(str(h.get("text", ""))))
		box.add_child(HSeparator.new())

	# ── esclusione utente ──
	if p.get("user_excluded_reason"):
		box.add_child(TerminalTheme.label(UIStrings.t("pos.excluded_title"), 14,
				Palette.RED, "bold"))
		var reason := str(p["user_excluded_reason"])
		if p.get("user_excluded_note"):
			reason += " — " + str(p["user_excluded_note"])
		box.add_child(_pos_paragraph(reason))
		box.add_child(HSeparator.new())

	# ── stato delle azioni on-demand (per ora sola lettura) ──
	box.add_child(TerminalTheme.label(UIStrings.t("pos.actions"), 14,
			Palette.MUTED, "medium"))
	for act in [["pos.act_write", "write_requested"],
			["pos.act_geocode", "geocode_requested"],
			["pos.act_recheck", "recheck_requested"]]:
		var requested := int(p.get(act[1], 0) if p.get(act[1]) != null else 0) == 1
		var arow := HBoxContainer.new()
		arow.add_theme_constant_override("separation", 12)
		box.add_child(arow)
		var al := TerminalTheme.label(UIStrings.t(act[0]), 14, Palette.BASE)
		al.custom_minimum_size = Vector2(280, 0)
		arow.add_child(al)
		arow.add_child(TerminalTheme.label(
				UIStrings.t("pos.act_requested") if requested else UIStrings.t("pos.act_not_requested"),
				13, Palette.YELLOW if requested else Palette.DIM, "medium"))
	box.add_child(TerminalTheme.label(UIStrings.t("pos.act_note"), 12, Palette.DIM))
	box.add_child(HSeparator.new())

	# ── ticket col team ──
	box.add_child(TerminalTheme.label(UIStrings.t("pos.tickets"), 14,
			Palette.MUTED, "medium"))
	var tickets: Array = p.get("tickets", [])
	if tickets.is_empty():
		box.add_child(TerminalTheme.label(UIStrings.t("pos.ticket_none"), 13, Palette.DIM))
	for t in tickets:
		var trow := HBoxContainer.new()
		trow.add_theme_constant_override("separation", 12)
		box.add_child(trow)
		trow.add_child(TerminalTheme.label("[%s]" % str(t.get("status", "?")), 13,
				Palette.MINT if str(t.get("status")) == "resolved" else Palette.YELLOW, "medium"))
		trow.add_child(_pos_paragraph(str(t.get("request_text", ""))))
		if t.get("response_text"):
			box.add_child(_pos_paragraph("↳ " + str(t["response_text"])))
	_build_ticket_form(box, int(p.get("id", 0)))

## Form "nuovo ticket": la richiesta utente→team, l'unica scrittura
## remota autorizzata (gate 1). L'esito arriva su ticket_created; la
## lista sopra si aggiorna col fetch posizioni che il backend rilancia.
func _build_ticket_form(box: VBoxContainer, pid: int) -> void:
	if not BackendBus.is_live():
		box.add_child(TerminalTheme.label(UIStrings.t("pos.ticket_need_vps"),
				12, Palette.DIM))
		return
	if not BackendBus.ticket_created.is_connected(_on_ticket_created):
		BackendBus.ticket_created.connect(_on_ticket_created)
	var form := HBoxContainer.new()
	form.add_theme_constant_override("separation", 10)
	box.add_child(form)
	_ticket_input = LineEdit.new()
	_ticket_input.placeholder_text = UIStrings.t("pos.ticket_placeholder")
	_ticket_input.max_length = 2000
	_ticket_input.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	form.add_child(_ticket_input)
	_ticket_send = Button.new()
	_ticket_send.text = UIStrings.t("pos.ticket_send")
	form.add_child(_ticket_send)
	_ticket_status = TerminalTheme.label("", 12, Palette.DIM)
	box.add_child(_ticket_status)
	var submit := func() -> void:
		var txt: String = _ticket_input.text.strip_edges()
		if txt == "" or _ticket_send.disabled:
			return
		_ticket_send.disabled = true
		_ticket_status.text = UIStrings.t("pos.ticket_sending")
		_ticket_status.add_theme_color_override("font_color", Palette.DIM)
		BackendBus.create_position_ticket(pid, txt)
	_ticket_send.pressed.connect(submit)
	_ticket_input.text_submitted.connect(func(_t: String) -> void: submit.call())
	# TEST-AUTO: JHT_TICKET_TEST=<testo> invia un ticket appena il form
	# esiste (una volta sola), per verificare il canale con lo shot.
	if OS.get_environment("JHT_TICKET_TEST") != "" and not _ticket_test_done:
		_ticket_test_done = true
		_ticket_input.text = OS.get_environment("JHT_TICKET_TEST")
		submit.call_deferred()

static var _ticket_test_done := false

var _ticket_input: LineEdit
var _ticket_send: Button
var _ticket_status: Label

func _on_ticket_created(_pid: int, ok: bool, error: String) -> void:
	if not is_instance_valid(_ticket_status):
		return
	if ok:
		_ticket_status.text = UIStrings.t("pos.ticket_ok")
		_ticket_status.add_theme_color_override("font_color", Palette.MINT)
		if is_instance_valid(_ticket_input):
			_ticket_input.text = ""
	else:
		_ticket_status.text = UIStrings.t("pos.ticket_err") % error
		_ticket_status.add_theme_color_override("font_color", Palette.RED)
	if is_instance_valid(_ticket_send):
		_ticket_send.disabled = false

## Paragrafo a capo automatico con il grassetto Markdown prodotto dal team.
func _pos_paragraph(text: String) -> RichTextLabel:
	return TerminalTheme.markdown_label(text, 14, Palette.BASE)

static func _fmt_k(v: Variant) -> String:
	if v == null:
		return "?"
	return "%dk" % int(round(float(v) / 1000.0)) if float(v) >= 1000.0 else str(int(v))

## Range salariale in EUR quando il tasso c'è (multi-valuta come sul
## web, tassi BCE), altrimenti valuta originale esplicitata.
static func _fmt_salary_eur(s_min: Variant, s_max: Variant, cur: String) -> String:
	var c := cur.strip_edges().to_upper()
	if c == "" or c == "<NULL>":
		c = "EUR"
	if c == "EUR":
		return "%s–%s" % [_fmt_k(s_min), _fmt_k(s_max)]
	var lo := -1.0 if s_min == null else BackendBus.to_eur(float(s_min), c)
	var hi := -1.0 if s_max == null else BackendBus.to_eur(float(s_max), c)
	if lo >= 0.0 or hi >= 0.0:
		return "~%s–%s €" % [_fmt_k(lo if lo >= 0.0 else null),
				_fmt_k(hi if hi >= 0.0 else null)]
	return "%s–%s %s" % [_fmt_k(s_min), _fmt_k(s_max), c]

# ── Impostazioni → Collega VPS ────────────────────────────────────────

var _vps_ip: LineEdit
var _vps_user: LineEdit
var _vps_key: LineEdit
var _vps_state_lbl: Label
var _vps_fingerprint_lbl: Label
var _vps_agents_box: VBoxContainer

## Il form del PRIMO PASSO backend: IP + chiave SSH → VpsBackend reale.
## Stato e roster arrivano live dal BackendBus (il collegamento resta
## vivo anche a pannello chiuso: vive nell'autoload, non qui).
func _build_vps() -> void:
	_listen_setup()
	_content.add_child(TerminalTheme.label(UIStrings.t("vps.intro"), 15, Palette.MUTED))
	_content.add_child(TerminalTheme.label(
			UIStrings.t("vps.steps"),
			13, Palette.MINT, "medium"))
	_content.add_child(HSeparator.new())
	_content.add_child(TerminalTheme.label(UIStrings.t("vps.key_section"), 15,
			Palette.BRIGHT, "bold"))
	var cfg: Dictionary = BackendBus.load_vps_config()

	_vps_key = _vps_input(UIStrings.t("vps.key"), cfg.get("key_path", ""),
			"~/.ssh/id_ed25519")
	if _vps_key.text == "" and FileAccess.file_exists(SetupService.default_vps_key_path()):
		_vps_key.text = SetupService.default_vps_key_path()
	var browse := Button.new()
	browse.text = UIStrings.t("vps.key_browse")
	browse.add_theme_font_size_override("font_size", 14)
	browse.add_theme_color_override("font_color", Palette.MUTED)
	browse.pressed.connect(_browse_vps_key)
	_vps_key.get_parent().add_child(browse)
	var generate := Button.new()
	generate.text = UIStrings.t("vps.key_generate")
	generate.pressed.connect(func() -> void:
		_vps_key.text = SetupService.default_vps_key_path()
		_refresh_vps_fingerprint()
		SetupService.generate_vps_key())
	_vps_key.get_parent().add_child(generate)
	var copy_public := Button.new()
	copy_public.text = UIStrings.t("vps.key_copy")
	copy_public.pressed.connect(func() -> void:
		SetupService.copy_vps_public_key(_vps_key.text))
	_vps_key.get_parent().add_child(copy_public)
	var reveal := Button.new()
	reveal.text = UIStrings.t("vps.key_open")
	reveal.pressed.connect(func() -> void:
		SetupService.reveal_vps_key(_vps_key.text))
	_vps_key.get_parent().add_child(reveal)
	_vps_fingerprint_lbl = TerminalTheme.label("", 12, Palette.DIM)
	_content.add_child(_vps_fingerprint_lbl)
	_content.add_child(TerminalTheme.label(UIStrings.t("vps.key_note"), 12, Palette.DIM))
	# Il campo cambia significato appena cambia la chiave: va ricalcolato sul
	# testo di adesso, non su quello con cui il pannello è stato costruito.
	_vps_key.text_changed.connect(func(_t: String) -> void: _refresh_vps_fingerprint())
	_refresh_vps_fingerprint()

	_content.add_child(HSeparator.new())
	_content.add_child(TerminalTheme.label(UIStrings.t("vps.destination"), 15,
			Palette.BRIGHT, "bold"))
	_vps_ip = _vps_input(UIStrings.t("vps.ip"), cfg.get("ip", ""), "203.0.113.10")
	# Solo Hetzner consegna root: OVH e AWS aprono su `ubuntu`, Google Cloud e
	# Azure sul nome dell'account. Campo vuoto = root, come prima.
	_vps_user = _vps_input(UIStrings.t("vps.user"), cfg.get("user", ""), "root")
	_content.add_child(TerminalTheme.label(
			UIStrings.t("vps.user_note"),
			12, Palette.DIM))
	_content.add_child(TerminalTheme.label(
			UIStrings.t("vps.fingerprint_note"),
			12, Palette.DIM))

	var actions := HBoxContainer.new()
	actions.add_theme_constant_override("separation", 16)
	_content.add_child(actions)
	var connect_btn := Button.new()
	connect_btn.text = UIStrings.t("vps.connect_existing")
	connect_btn.add_theme_font_size_override("font_size", 16)
	connect_btn.add_theme_color_override("font_color", Palette.GREEN)
	connect_btn.pressed.connect(_connect_vps)
	actions.add_child(connect_btn)
	var disconnect_btn := Button.new()
	disconnect_btn.text = UIStrings.t("vps.disconnect")
	disconnect_btn.add_theme_font_size_override("font_size", 16)
	disconnect_btn.add_theme_color_override("font_color", Palette.MUTED)
	# Una disconnessione richiesta dall'utente deve sopravvivere al riavvio;
	# altrimenti vps.cfg ricollegherebbe silenziosamente la stessa VPS al boot.
	disconnect_btn.pressed.connect(func() -> void: BackendBus.switch_to_local_backend())
	actions.add_child(disconnect_btn)
	var test_ssh := Button.new()
	test_ssh.text = UIStrings.t("vps.verify_ssh")
	test_ssh.add_theme_color_override("font_color", Palette.MINT)
	test_ssh.pressed.connect(func() -> void:
		SetupService.test_vps_connection(_vps_ip.text, _vps_key.text,
				_vps_user.text))
	actions.add_child(test_ssh)
	var install := Button.new()
	install.text = UIStrings.t("vps.prepare")
	install.add_theme_color_override("font_color", Palette.YELLOW)
	install.pressed.connect(func() -> void:
		SetupService.provision_vps(_vps_ip.text, _vps_key.text,
				_vps_user.text))
	actions.add_child(install)
	var console_install := Button.new()
	console_install.text = UIStrings.t("vps.advanced")
	console_install.flat = true
	console_install.pressed.connect(func() -> void:
		SetupService.open_vps_install(_vps_ip.text, _vps_key.text,
				_vps_user.text))
	_content.add_child(console_install)

	_vps_state_lbl = TerminalTheme.label("", 16, Palette.MUTED, "medium")
	_content.add_child(_vps_state_lbl)
	_setup_message = TerminalTheme.label("", 13, Palette.DIM)
	_content.add_child(_setup_message)
	_content.add_child(HSeparator.new())
	_content.add_child(TerminalTheme.label(UIStrings.t("vps.migration_title"),
			15, Palette.BRIGHT, "bold"))
	_content.add_child(TerminalTheme.label(
			UIStrings.t("vps.migration_desc"),
			12, Palette.MUTED))
	var migration := HFlowContainer.new()
	migration.add_theme_constant_override("separation", 12)
	_content.add_child(migration)
	var source_mode := OptionButton.new()
	source_mode.add_item(UIStrings.t("vps.source_local"), 0)
	source_mode.add_item(UIStrings.t("vps.source_saved"), 1)
	source_mode.custom_minimum_size.x = 330
	migration.add_child(source_mode)
	var migrate := Button.new()
	migrate.text = UIStrings.t("vps.migrate_to_vps")
	migrate.add_theme_color_override("font_color", Palette.YELLOW)
	migrate.pressed.connect(func() -> void:
		_confirm_vps_migration("vps" if source_mode.selected == 1 else "local"))
	migration.add_child(migrate)
	var migrate_local := Button.new()
	migrate_local.text = UIStrings.t("vps.migrate_to_local")
	migrate_local.disabled = str(cfg.get("ip", "")) == "" \
			or str(cfg.get("key_path", "")) == ""
	migrate_local.add_theme_color_override("font_color", Palette.BLUE)
	migrate_local.pressed.connect(_confirm_local_migration)
	migration.add_child(migrate_local)
	_content.add_child(TerminalTheme.label(
			UIStrings.t("vps.migration_note"),
			12, Palette.DIM))
	_content.add_child(HSeparator.new())
	_content.add_child(TerminalTheme.label(UIStrings.t("vps.agents_live"),
			14, Palette.MUTED, "medium"))
	_vps_agents_box = VBoxContainer.new()
	_vps_agents_box.add_theme_constant_override("separation", 6)
	_content.add_child(_vps_agents_box)

	BackendBus.connection_changed.connect(_on_vps_state)
	BackendBus.agents_updated.connect(_on_vps_agents)
	_on_vps_state(BackendBus.state, BackendBus.state_detail)
	_on_vps_agents(BackendBus.agents)


func _confirm_vps_migration(source_mode: String) -> void:
	var dialog := ConfirmationDialog.new()
	dialog.title = UIStrings.t("vps.confirm_vps_title")
	dialog.dialog_text = (UIStrings.t("vps.confirm_source_local") \
			if source_mode == "local" else UIStrings.t("vps.confirm_source_vps")) \
			+ "\n\n" + UIStrings.t("vps.confirm_body")
	dialog.ok_button_text = UIStrings.t("vps.confirm_vps_ok")
	dialog.confirmed.connect(func() -> void:
		SetupService.migrate_to_vps(_vps_ip.text, _vps_key.text, source_mode,
				_vps_user.text))
	dialog.canceled.connect(dialog.queue_free)
	dialog.confirmed.connect(dialog.queue_free)
	add_child(dialog)
	dialog.popup_centered(Vector2i(700, 300))


func _confirm_local_migration() -> void:
	var dialog := ConfirmationDialog.new()
	dialog.title = UIStrings.t("vps.confirm_local_title")
	dialog.dialog_text = UIStrings.t("vps.confirm_local_body")
	dialog.ok_button_text = UIStrings.t("vps.confirm_local_ok")
	dialog.confirmed.connect(SetupService.migrate_to_local)
	dialog.canceled.connect(dialog.queue_free)
	dialog.confirmed.connect(dialog.queue_free)
	add_child(dialog)
	dialog.popup_centered(Vector2i(700, 300))

func _vps_input(label_text: String, value: String, placeholder: String) -> LineEdit:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	_content.add_child(row)
	var lbl := TerminalTheme.label(label_text, 14, Palette.MUTED, "medium")
	lbl.custom_minimum_size = Vector2(220, 0)
	row.add_child(lbl)
	var edit := LineEdit.new()
	edit.text = value
	edit.placeholder_text = placeholder
	edit.custom_minimum_size = Vector2(360, 0)
	edit.add_theme_font_size_override("font_size", 15)
	row.add_child(edit)
	return edit

func _browse_vps_key() -> void:
	var dlg := FileDialog.new()
	dlg.file_mode = FileDialog.FILE_MODE_OPEN_FILE
	dlg.access = FileDialog.ACCESS_FILESYSTEM
	dlg.use_native_dialog = true
	dlg.show_hidden_files = true
	# Assegnare .text da codice non emette text_changed: il ricalcolo va chiesto.
	dlg.file_selected.connect(func(path: String) -> void:
		_vps_key.text = path
		_refresh_vps_fingerprint())
	add_child(dlg)
	dlg.popup_centered()

## Il fingerprint esiste per essere confrontato con quello mostrato dal provider:
## se restasse quello della chiave precedente il controllo anti-MITM darebbe una
## conferma falsa, che è peggio del non averlo. Quindi si rilegge sempre dalla
## chiave selezionata adesso — senza cache, perché lo stesso percorso cambia
## fingerprint appena la chiave viene (ri)generata — e quando non è calcolabile
## (campo vuoto, .pub assente, ssh-keygen non disponibile) lo dichiara.
func _refresh_vps_fingerprint() -> void:
	if not is_instance_valid(_vps_fingerprint_lbl) or not is_instance_valid(_vps_key):
		return
	# Campo vuoto: vps_key_info() ripiegherebbe sulla chiave di default, e il
	# pannello mostrerebbe il fingerprint di una chiave che l'utente non ha scelto.
	var key_path := _vps_key.text.strip_edges()
	var fingerprint := ""
	if key_path != "":
		var key_info := SetupService.vps_key_info(key_path)
		fingerprint = str(key_info.get("fingerprint", ""))
	_vps_fingerprint_lbl.text = ("Fingerprint: " + fingerprint) if fingerprint != "" \
			else UIStrings.t("vps.key_fingerprint_none")
	_vps_fingerprint_lbl.add_theme_color_override("font_color",
			Palette.DIM if fingerprint != "" else Palette.YELLOW)

func _connect_vps() -> void:
	var ip := _vps_ip.text.strip_edges()
	var key := VpsBackend.expand_user_path(_vps_key.text)
	if ip == "" or key == "":
		_vps_state_lbl.text = "● " + UIStrings.t("vps.missing_fields")
		_vps_state_lbl.add_theme_color_override("font_color", Palette.YELLOW)
		return
	var user := _vps_user.text.strip_edges()
	BackendBus.save_vps_config(ip, key, user)
	BackendBus.set_backend(VpsBackend.new(),
			{"ip": ip, "key_path": key, "user": user})

func _on_vps_state(state: int, detail: String) -> void:
	if not is_instance_valid(_vps_state_lbl):
		return
	match state:
		BackendBus.CONNECTED:
			_vps_state_lbl.text = "● %s — %s" % [UIStrings.t("vps.state_connected"), detail]
			_vps_state_lbl.add_theme_color_override("font_color", Palette.GREEN)
		BackendBus.CONNECTING:
			_vps_state_lbl.text = "◌ %s %s" % [UIStrings.t("vps.state_connecting"), detail]
			_vps_state_lbl.add_theme_color_override("font_color", Palette.YELLOW)
		BackendBus.ERROR:
			_vps_state_lbl.text = "▲ %s: %s" % [UIStrings.t("vps.state_error"), detail]
			_vps_state_lbl.add_theme_color_override("font_color", Palette.RED)
		_:
			_vps_state_lbl.text = "○ " + UIStrings.t("vps.state_disconnected")
			_vps_state_lbl.add_theme_color_override("font_color", Palette.MUTED)

func _on_vps_agents(agents: Array) -> void:
	if not is_instance_valid(_vps_agents_box):
		return
	for child in _vps_agents_box.get_children():
		child.queue_free()
	if agents.is_empty():
		_vps_agents_box.add_child(TerminalTheme.label(
				UIStrings.t("vps.agents_none"), 14, Palette.DIM))
		return
	for a in agents:
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 12)
		_vps_agents_box.add_child(row)
		row.add_child(TerminalTheme.label("●", 13, Palette.GREEN))
		var name_lbl := TerminalTheme.label(str(a.get("name", a.get("slug", "?"))),
				15, Palette.BRIGHT)
		name_lbl.custom_minimum_size = Vector2(220, 0)
		row.add_child(name_lbl)
		row.add_child(TerminalTheme.label(str(a.get("status", "working")), 14, Palette.MINT))

func _build_placeholder() -> void:
	_content.add_child(TerminalTheme.label(
			UIStrings.t("section.migrating"), 16, Palette.DIM))
	_content.add_child(TerminalTheme.label(
			UIStrings.t("section.migrating_body")
			% SidebarDefs.label_for(section), 15, Palette.MUTED))

# ── Team / Agenti / Attività / Candidature / Dashboard ────────────────

## Il team per reparto: organico e postazioni libere, più i core.
## Reparto della scena → slug ruolo del sistema reale.
const DEPT_ROLE := {"scout": "scout", "analisti": "analista", "scorer": "scorer",
		"scrittori": "scrittore", "critici": "critico"}

func _build_team() -> void:
	if not BackendBus.agents_updated.is_connected(_on_team_refresh):
		BackendBus.agents_updated.connect(_on_team_refresh)
	_listen_setup()
	if not bool(SetupService.status.get("ready", false)):
		var banner := Button.new()
		banner.text = UIStrings.t("setup.team_locked") % int(
				SetupService.status.get("completed", 0))
		banner.alignment = HORIZONTAL_ALIGNMENT_LEFT
		banner.add_theme_font_size_override("font_size", 15)
		banner.add_theme_color_override("font_color", Palette.YELLOW)
		banner.pressed.connect(func() -> void: navigate.emit("activation"))
		_content.add_child(banner)
		_content.add_child(HSeparator.new())
	var controls := HBoxContainer.new()
	controls.add_theme_constant_override("separation", 10)
	_content.add_child(controls)
	var running := not BackendBus.agents.is_empty() or bool(
			SetupService.status.get("team_running", false))
	var team_busy := SetupService.busy() and SetupService.current_action == "team"
	var primary := Button.new()
	# Mentre il comando gira l'etichetta dice COSA sta succedendo (avvio o
	# arresto, dedotto dallo stato di partenza) e il pulsante non è premibile.
	if team_busy:
		primary.text = UIStrings.t("setup.team_stopping") if running \
				else UIStrings.t("setup.team_starting")
	else:
		primary.text = UIStrings.t("team.stop") if running else UIStrings.t("team.start")
	primary.disabled = (not bool(SetupService.status.get("ready", false)) \
			and not running) or SetupService.busy()
	primary.add_theme_color_override("font_color", Palette.RED if running else Palette.GREEN)
	primary.pressed.connect(SetupService.stop_team if running else SetupService.start_team)
	controls.add_child(primary)
	var setup := Button.new()
	setup.text = UIStrings.t("team.setup")
	setup.pressed.connect(func() -> void: navigate.emit("activation"))
	controls.add_child(setup)
	_setup_message = TerminalTheme.label("", 13, Palette.DIM)
	_setup_message.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	controls.add_child(_setup_message)
	_restore_action_note()
	_content.add_child(HSeparator.new())
	for dept_id in DepartmentDefs.DEPT_ORDER:
		var dept: Dictionary = DepartmentDefs.DEPARTMENTS[dept_id]
		var occupied := 0
		if not BackendBus.agents.is_empty():
			# postazioni = agenti VERI del ruolo attivi in questo momento
			for a in BackendBus.agents:
				if str(a.get("slug", "")) == str(DEPT_ROLE.get(dept_id, "")):
					occupied += 1
		else:
			for i in (dept["desks"] as Array).size():
				if CharacterDefs.desk_occupant_name(dept_id, i) != "":
					occupied += 1
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 12)
		_content.add_child(row)
		row.add_child(TerminalTheme.label("▮", 16, dept["color"], "bold"))
		var name_lbl := TerminalTheme.label(dept["name"], 17, Palette.BRIGHT, "medium")
		name_lbl.custom_minimum_size = Vector2(160, 0)
		row.add_child(name_lbl)
		row.add_child(TerminalTheme.label(UIStrings.t("team.desks") % [occupied,
				(dept["desks"] as Array).size()], 15, Palette.MUTED))
		var tag := TerminalTheme.label(dept["tagline"], 14, Palette.DIM)
		tag.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		tag.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		row.add_child(tag)
	_content.add_child(HSeparator.new())
	# i tre nomi vengono da role.* invece che dalla riga tradotta: erano
	# rimasti in italiano in tutte e 7 le lingue, e composti così non
	# possono più divergere da quello che si legge in scena
	_content.add_child(TerminalTheme.label(UIStrings.t("team.core") % [
			CharacterDefs.role_name("coordinatore"),
			CharacterDefs.role_name("mentor"),
			CharacterDefs.role_name("assistente")], 15, Palette.MUTED))

## Tutti gli agenti in scena con stato del ruolo. Con la VPS collegata:
## il roster VERO (sessioni tmux attive), aggiornato a ogni poll.
func _build_agents() -> void:
	if not BackendBus.agents_updated.is_connected(_on_agents_refresh):
		BackendBus.agents_updated.connect(_on_agents_refresh)
	if not BackendBus.agents.is_empty():
		_content.add_child(TerminalTheme.label(
				UIStrings.t("agents.active_count") % BackendBus.agents.size(),
				14, Palette.MUTED, "medium"))
		for a in BackendBus.agents:
			var row := HBoxContainer.new()
			row.add_theme_constant_override("separation", 12)
			_content.add_child(row)
			var slug := str(a.get("slug", "?"))
			row.add_child(TerminalTheme.label(ROLE_EMOJI.get(slug, "●"), 14, Palette.GREEN))
			# il nome apre la pagina dell'agente (come /team/<slug> sul web)
			var name_btn := Button.new()
			name_btn.flat = true
			name_btn.text = str(a.get("name", slug))
			name_btn.add_theme_font_size_override("font_size", 16)
			name_btn.add_theme_color_override("font_color", Palette.BRIGHT)
			name_btn.add_theme_color_override("font_hover_color", Palette.GREEN)
			name_btn.alignment = HORIZONTAL_ALIGNMENT_LEFT
			name_btn.custom_minimum_size = Vector2(220, 0)
			name_btn.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
			name_btn.pressed.connect(func() -> void:
				_agent_detail = slug
				Sfx.play_tick()
				_build("agent"))
			row.add_child(name_btn)
			var st := TerminalTheme.label(str(a.get("status", "working")), 14, Palette.MINT)
			st.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			st.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
			row.add_child(st)
		return
	for def in CharacterDefs.spawn_list():
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 12)
		_content.add_child(row)
		var dept_id: String = def.get("dept", "")
		var color: Color = DepartmentDefs.DEPARTMENTS[dept_id]["color"] \
				if dept_id != "" else Palette.MUTED
		row.add_child(TerminalTheme.label("●", 13, color))
		var name_lbl := TerminalTheme.label(def["name"], 16,
				Palette.BRIGHT if def.get("lead", false) else Palette.BASE,
				"medium" if def.get("lead", false) else "")
		name_lbl.custom_minimum_size = Vector2(220, 0)
		row.add_child(name_lbl)
		var status: Dictionary = TeamData.agent_status().get(def["slug"], {})
		var st := TerminalTheme.label(
				status.get("status", UIStrings.t("agents.status_default")), 14, Palette.MINT)
		st.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		st.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
		row.add_child(st)

## Emoji-ruolo per l'attribuzione per-istanza (scout-2, scorer-1…).
const ROLE_EMOJI := {
	"scout": "🔍", "analista": "🧠", "scorer": "🎯", "scrittore": "✍",
	"critico": "🧐", "capitano": "🧭", "coordinatore": "🧭", "sentinella": "🛡",
	"assistente": "📋", "mentor": "🎓", "dottore": "🩺", "mantenitore": "🔧",
}

## Feed attività: il registro transizioni VERO quando la VPS è collegata
## (chi ha fatto cosa, con l'istanza), altrimenti il mock.
func _build_activity() -> void:
	if not BackendBus.positions_updated.is_connected(_on_activity_refresh):
		BackendBus.positions_updated.connect(_on_activity_refresh)
	var transitions: Array = BackendBus.transitions
	if not transitions.is_empty():
		var scroll := ScrollContainer.new()
		scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
		scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
		scroll.custom_minimum_size = Vector2(0, 520)
		_content.add_child(scroll)
		var list := VBoxContainer.new()
		list.add_theme_constant_override("separation", 8)
		list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		scroll.add_child(list)
		for t in transitions:
			var row := HBoxContainer.new()
			row.add_theme_constant_override("separation", 14)
			list.add_child(row)
			var when := TerminalTheme.label(str(t.get("ts", "")).left(16), 13, Palette.DIM)
			when.custom_minimum_size = Vector2(140, 0)
			row.add_child(when)
			var by := str(t.get("by_agent", "?") if t.get("by_agent") else "?")
			var base := by.split("-")[0]
			var who := TerminalTheme.label("%s %s"
					% [ROLE_EMOJI.get(base, "•"), AgentNames.display_name(by)],
					13, Palette.MINT, "medium")
			who.custom_minimum_size = Vector2(210, 0)
			row.add_child(who)
			var title_lbl := TerminalTheme.label("%s — %s" % [
					str(t.get("title", "?")), str(t.get("company", ""))], 14, Palette.BASE)
			title_lbl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			title_lbl.clip_text = true
			row.add_child(title_lbl)
			var from_st := str(t.get("from_state", "") if t.get("from_state") else "—")
			row.add_child(TerminalTheme.label(from_st, 13,
					_pos_status_color(from_st, Palette.DIM)))
			row.add_child(TerminalTheme.label("→", 13, Palette.DIM))
			var to_st := str(t.get("to_state", "?"))
			row.add_child(TerminalTheme.label(to_st, 13,
					_pos_status_color(to_st, Palette.MUTED), "medium"))
			var pad := Control.new()
			pad.custom_minimum_size = Vector2(14, 0)
			row.add_child(pad)
		return
	for slug in ["scout", "analista", "scorer", "scrittore", "critico", "coordinatore"]:
		for entry in TeamData.agent_activity(slug):
			var row := HBoxContainer.new()
			row.add_theme_constant_override("separation", 14)
			_content.add_child(row)
			var when := TerminalTheme.label(entry["when"], 13, Palette.DIM)
			when.custom_minimum_size = Vector2(80, 0)
			row.add_child(when)
			# Ramo offline: la riga è del lead del ruolo, che è l'istanza 1.
			var who := TerminalTheme.label(
					AgentNames.display_name(slug), 13, Palette.MUTED)
			who.custom_minimum_size = Vector2(160, 0)
			row.add_child(who)
			row.add_child(TerminalTheme.label(entry["text"], 14, Palette.BASE))

func _on_activity_refresh(_list: Array) -> void:
	if section == "activity" and is_instance_valid(_content):
		_build()

func _on_team_refresh(_list: Array) -> void:
	if section == "team" and is_instance_valid(_content):
		_build()

## Candidature a stadi (stessi dati del registro TAB).
## Stadi reali di una candidatura (status del jobs.db → etichetta).
const APP_STAGES := {"ready": "apps.ready", "applied": "apps.applied",
		"response": "apps.response"}

func _build_apps() -> void:
	if not BackendBus.positions_updated.is_connected(_on_apps_refresh):
		BackendBus.positions_updated.connect(_on_apps_refresh)
	# con la VPS: le candidature VERE (CV pronti, inviate, con risposta)
	if not BackendBus.positions.is_empty():
		var rows: Array = []
		for p in BackendBus.positions:
			if APP_STAGES.has(str(p.get("status", ""))):
				rows.append(p)
		if rows.is_empty():
			_content.add_child(TerminalTheme.label(UIStrings.t("apps.empty_live"),
					15, Palette.DIM))
			return
		for p in rows:
			var row := HBoxContainer.new()
			row.add_theme_constant_override("separation", 14)
			_content.add_child(row)
			var score_v: Variant = p.get("total_score")
			row.add_child(TerminalTheme.label(
					"—" if score_v == null else str(int(score_v)), 18,
					Palette.MINT if score_v != null and float(score_v) >= 70.0
					else Palette.YELLOW, "bold"))
			var btn := Button.new()
			btn.flat = true
			btn.alignment = HORIZONTAL_ALIGNMENT_LEFT
			btn.clip_text = true
			btn.text = "%s — %s" % [str(p.get("title", "?")), str(p.get("company", "?"))]
			btn.add_theme_font_size_override("font_size", 15)
			btn.add_theme_color_override("font_color", Palette.BRIGHT)
			btn.add_theme_color_override("font_hover_color", Palette.GREEN)
			btn.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
			btn.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			var pid := int(p.get("id", 0))
			btn.pressed.connect(func() -> void:
				pending_detail = pid
				navigate.emit("positions"))
			row.add_child(btn)
			var status := str(p.get("status", ""))
			row.add_child(TerminalTheme.label(UIStrings.t(APP_STAGES[status]), 14,
					_pos_status_color(status, Palette.MUTED), "medium"))
			var verdict := str(p.get("critic_verdict", "")
					if p.get("critic_verdict") != null else "")
			if verdict != "":
				row.add_child(TerminalTheme.label(verdict, 13,
						_verdict_color(verdict), "bold"))
		return
	var apps: Array = TeamData.applications()
	if apps.is_empty():
		_content.add_child(TerminalTheme.label(UIStrings.t("registry.empty"), 15, Palette.DIM))
	var names: Array = []
	for i in 4:  # gli stessi stadi del registro TAB
		names.append(UIStrings.t("registry.stage_%d" % i))
	for app in apps:
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 14)
		_content.add_child(row)
		var score := TerminalTheme.label(str(app["score"]), 18,
				Palette.MINT if app["score"] >= 70 else Palette.YELLOW, "bold")
		score.custom_minimum_size = Vector2(44, 0)
		row.add_child(score)
		var title_lbl := TerminalTheme.label("%s — %s" % [app["title"], app["company"]],
				15, Palette.BRIGHT)
		title_lbl.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(title_lbl)
		var stage: int = app["stage"]
		row.add_child(TerminalTheme.label(names[clampi(stage, 0, 3)], 14,
				Palette.GREEN if stage >= 2 else Palette.MUTED, "medium"))

func _on_apps_refresh(_list: Array) -> void:
	if section == "apps" and is_instance_valid(_content):
		_build()

## Dashboard: pipeline e KPI reali (se la VPS è collegata) o il mock.
func _build_dashboard() -> void:
	if not BackendBus.positions_updated.is_connected(_on_dash_refresh):
		BackendBus.positions_updated.connect(_on_dash_refresh)
	_build_dash_pipeline()
	if not BackendBus.positions.is_empty():
		var kpi: Dictionary = BackendBus.kpi_summary()
		_kpi_row(UIStrings.t("kpi.positions_today"), str(kpi["found_today"]), Palette.MINT)
		_kpi_row(UIStrings.t("kpi.avg_score"), str(kpi["avg_score"]), Palette.MINT)
		_kpi_row(UIStrings.t("kpi.positions_total"), str(kpi["total"]), Palette.BRIGHT)
		_content.add_child(HSeparator.new())
		# i grafici linked del web VIVONO nella dashboard (feedback
		# Leone 21:2x: "dashboard senza grafici"), cross-filter incluso
		var scroll := ScrollContainer.new()
		scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
		scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
		scroll.custom_minimum_size = Vector2(0, 380)
		_content.add_child(scroll)
		var charts := StatsCharts.new()
		charts.open_position.connect(func(pid: int) -> void:
			pending_detail = pid
			navigate.emit("positions"))
		scroll.add_child(charts)
		return
	var s: Dictionary = TeamData.summary()
	_kpi_row(UIStrings.t("kpi.positions_today"), str(s.get("positions_today", 0)), Palette.MINT)
	_kpi_row(UIStrings.t("kpi.avg_score"), str(s.get("avg_score", 0)), Palette.MINT)
	_bar_row(UIStrings.t("kpi.budget_used"), s.get("budget_used_pct", 0.0), Palette.GREEN)
	_content.add_child(HSeparator.new())
	_content.add_child(TerminalTheme.label(UIStrings.t("kpi.positions_list"),
			14, Palette.MUTED, "medium"))
	for p in TeamData.positions_today():
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 14)
		_content.add_child(row)
		var score := TerminalTheme.label(str(p["score"]), 18,
				Palette.MINT if p["score"] >= 70 else Palette.YELLOW, "bold")
		score.custom_minimum_size = Vector2(44, 0)
		row.add_child(score)
		var text_col := VBoxContainer.new()
		text_col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row.add_child(text_col)
		text_col.add_child(TerminalTheme.label("%s — %s" % [p["title"], p["company"]],
				15, Palette.BRIGHT))
		text_col.add_child(TerminalTheme.label("%s · %s" % [p["location"], p["salary"]],
				13, Palette.MUTED))

## La pipeline a 5 box del dashboard web (flusso reale 2026-06-07):
## Da analizzare → Analizzate → Con lo score → Da scrivere → Scritte.
## Ogni box conta dallo snapshot vero e apre le posizioni pre-filtrate.
func _build_dash_pipeline() -> void:
	if BackendBus.positions.is_empty():
		return
	# il mapping status→fase vive in UN posto solo (lo usa anche la
	# scena per il flusso fisico dei fogli)
	var counts: Dictionary = BackendBus.pipeline_counts()
	var boxes := [
		["to_analyze", "dash.pl_to_analyze", Palette.MUTED, ["new"]],
		["analyzed", "dash.pl_analyzed", Palette.BLUE, ["checked"]],
		["with_score", "dash.pl_with_score", Palette.PURPLE, ["scored"]],
		["to_write", "dash.pl_to_write", Palette.YELLOW, ["scored", "writing", "review"]],
		["written", "dash.pl_written", Palette.MINT, ["ready"]],
	]
	_content.add_child(TerminalTheme.label(UIStrings.t("dash.pipeline"), 14,
			Palette.MUTED, "medium"))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	_content.add_child(row)
	for i in boxes.size():
		var b: Array = boxes[i]
		if i > 0:
			row.add_child(TerminalTheme.label("▸", 16, Palette.DIM))
		var btn := Button.new()
		var color: Color = b[2]
		btn.custom_minimum_size = Vector2(150, 64)
		var sb := StyleBoxFlat.new()
		sb.bg_color = Color(color.r, color.g, color.b, 0.10)
		sb.border_color = Color(color.r, color.g, color.b, 0.55)
		sb.set_border_width_all(TerminalTheme.hairline())
		btn.add_theme_stylebox_override("normal", sb)
		var hover := sb.duplicate()
		hover.border_color = color
		btn.add_theme_stylebox_override("hover", hover)
		btn.add_theme_stylebox_override("pressed", hover.duplicate())
		btn.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
		btn.text = "%d\n%s" % [counts[b[0]], UIStrings.t(b[1])]
		btn.add_theme_font_size_override("font_size", 15)
		btn.add_theme_color_override("font_color", color)
		var statuses: Array = b[3]
		btn.pressed.connect(func() -> void:
			pending_status = statuses
			Sfx.play_tick()
			navigate.emit("positions"))
		row.add_child(btn)
	_content.add_child(TerminalTheme.label(UIStrings.t("dash.pl_hint"), 12, Palette.DIM))
	_content.add_child(HSeparator.new())

## Notifiche recenti del team. Con la VPS: gli eventi VERI che contano
## per l'utente — ticket risolti/in lavorazione e i traguardi della
## pipeline (valutata, CV scritto, inviata, risposta) dalle transizioni.
const NOTIF_STATES := {"scored": "notifs.scored", "ready": "notifs.cv_ready",
		"applied": "notifs.applied", "response": "notifs.response"}
const NOTIF_MAX := 15

func _build_notifs() -> void:
	if not BackendBus.positions_updated.is_connected(_on_notifs_refresh):
		BackendBus.positions_updated.connect(_on_notifs_refresh)
	if not BackendBus.positions.is_empty():
		var items: Array = []  # {ts, icon, color, text}
		for t_pos in BackendBus.positions:
			for t in t_pos.get("tickets", []):
				var status := str(t.get("status", ""))
				var req := str(t.get("request_text", "")).left(70)
				if status == "resolved":
					items.append({"ts": str(t.get("created_at", "")), "icon": "✔",
							"color": Palette.MINT,
							"text": UIStrings.t("notifs.ticket_resolved") % req})
				elif status == "assigned":
					items.append({"ts": str(t.get("created_at", "")), "icon": "●",
							"color": Palette.YELLOW,
							"text": UIStrings.t("notifs.ticket_assigned") % req})
		for tr in BackendBus.transitions:
			var to := str(tr.get("to_state", ""))
			if not NOTIF_STATES.has(to):
				continue
			var what := "%s — %s" % [str(tr.get("title", "?")), str(tr.get("company", "?"))]
			items.append({"ts": str(tr.get("ts", "")), "icon": "●",
					"color": _pos_status_color(to, Palette.GREEN),
					"text": UIStrings.t(NOTIF_STATES[to]) % what})
		items.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
			return str(a["ts"]) > str(b["ts"]))
		if items.is_empty():
			_content.add_child(TerminalTheme.label(UIStrings.t("notifs.empty"),
					15, Palette.DIM))
			return
		for i in mini(items.size(), NOTIF_MAX):
			var n: Dictionary = items[i]
			var row := HBoxContainer.new()
			row.add_theme_constant_override("separation", 14)
			_content.add_child(row)
			row.add_child(TerminalTheme.label(str(n["icon"]), 14, n["color"]))
			var when := TerminalTheme.label(
					str(n["ts"]).replace("T", " ").left(16), 13, Palette.DIM)
			when.custom_minimum_size = Vector2(130, 0)
			row.add_child(when)
			var txt := TerminalTheme.label(str(n["text"]), 15, Palette.BASE)
			txt.clip_text = true
			txt.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			row.add_child(txt)
		return
	for n in TeamData.notifications():
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 14)
		_content.add_child(row)
		var warn: bool = n.get("level", "info") == "warn"
		row.add_child(TerminalTheme.label("▲" if warn else "●", 14,
				Palette.YELLOW if warn else Palette.GREEN))
		var when := TerminalTheme.label(n["when"], 13, Palette.DIM)
		when.custom_minimum_size = Vector2(80, 0)
		row.add_child(when)
		row.add_child(TerminalTheme.label(n["text"], 15, Palette.BASE))

func _on_notifs_refresh(_list: Array) -> void:
	if section == "notifs" and is_instance_valid(_content):
		_build()

## Chat del team: con la VPS collegata i messaggi VERI che gli agenti
## si scambiano (stesso flusso dei fumetti), altrimenti il mock.
func _build_chat() -> void:
	if not BackendBus.chat_message.is_connected(_on_teamchat_refresh):
		BackendBus.chat_message.connect(_on_teamchat_refresh)
	var live: Array = BackendBus.chat_log
	if not live.is_empty():
		var scroll := ScrollContainer.new()
		scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
		scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
		scroll.custom_minimum_size = Vector2(0, 480)
		_content.add_child(scroll)
		var list := VBoxContainer.new()
		list.add_theme_constant_override("separation", 8)
		list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		scroll.add_child(list)
		for msg in live:
			var row := HBoxContainer.new()
			row.add_theme_constant_override("separation", 12)
			list.add_child(row)
			var when := TerminalTheme.label(
					str(msg.get("ts", "")).replace("T", " ").left(16), 13, Palette.DIM)
			when.custom_minimum_size = Vector2(130, 0)
			row.add_child(when)
			var base := str(msg.get("from", "?")).split("-")[0]
			# Mittente e destinatario nella stessa cella: solo cognomi.
			var who := TerminalTheme.label("%s %s → %s" % [ROLE_EMOJI.get(base, "•"),
					AgentNames.short_name(str(msg.get("from", "?"))),
					AgentNames.short_name(str(msg.get("to", "?")))],
					13, Palette.MINT, "medium")
			who.custom_minimum_size = Vector2(230, 0)
			row.add_child(who)
			var txt := _pos_paragraph(str(msg.get("text", "")))
			row.add_child(txt)
			var pad := Control.new()
			pad.custom_minimum_size = Vector2(14, 0)
			row.add_child(pad)
		scroll.set_deferred("scroll_vertical", 999999)  # parte dal fondo
		return
	for msg in TeamData.chat():
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 12)
		_content.add_child(row)
		var when := TerminalTheme.label(msg["when"], 13, Palette.DIM)
		when.custom_minimum_size = Vector2(56, 0)
		row.add_child(when)
		var who := TerminalTheme.label(
				AgentNames.display_name(str(msg["from"])), 14, Palette.MINT, "medium")
		who.custom_minimum_size = Vector2(180, 0)
		row.add_child(who)
		row.add_child(TerminalTheme.label(msg["text"], 15, Palette.BASE))
	_content.add_child(HSeparator.new())
	_content.add_child(TerminalTheme.label(
			UIStrings.t("common.readonly_chat"), 13, Palette.DIM))

func _on_teamchat_refresh(_msg: Dictionary) -> void:
	if section == "chat" and is_instance_valid(_content):
		_build()

# ── Statistiche + pagina Utilizzo ─────────────────────────────────────

func _build_stats() -> void:
	# con la VPS collegata: i grafici cross-filter del web sui dati veri
	# (mai il mock spacciato per reale)
	if not BackendBus.positions_updated.is_connected(_on_stats_refresh):
		BackendBus.positions_updated.connect(_on_stats_refresh)
	if BackendBus.is_live() and BackendBus.positions.is_empty():
		_content.add_child(TerminalTheme.label(
				UIStrings.t("common.data_incoming"), 14, Palette.DIM))
		return
	if not BackendBus.positions.is_empty():
		var scroll := ScrollContainer.new()
		scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
		scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
		scroll.custom_minimum_size = Vector2(0, 540)
		_content.add_child(scroll)
		var charts := StatsCharts.new()
		charts.open_position.connect(func(pid: int) -> void:
			pending_detail = pid
			navigate.emit("positions"))
		scroll.add_child(charts)
		var usage_link := Button.new()
		usage_link.text = UIStrings.t("usage.open")
		usage_link.add_theme_font_size_override("font_size", 16)
		usage_link.add_theme_color_override("font_color", Palette.GREEN)
		usage_link.pressed.connect(func() -> void: _build("usage"))
		_content.add_child(usage_link)
		return
	var s: Dictionary = TeamData.summary()
	var streak: Dictionary = TeamData.streak()
	_kpi_row(UIStrings.t("kpi.positions_today"), str(s.get("positions_today", 0)), Palette.MINT)
	_kpi_row(UIStrings.t("kpi.avg_score"), str(s.get("avg_score", 0)), Palette.MINT)
	_kpi_row(UIStrings.t("kpi.streak"), UIStrings.t("kpi.streak_value")
			% [streak.get("days", 0), streak.get("freezes", 0)], Palette.ORANGE)
	_bar_row(UIStrings.t("kpi.budget_used"), s.get("budget_used_pct", 0.0), Palette.GREEN)
	_content.add_child(HSeparator.new())
	# candidature per stadio
	var stages := [0, 0, 0, 0]
	for app in TeamData.applications():
		stages[clampi(int(app["stage"]), 0, 3)] += 1
	_content.add_child(TerminalTheme.label(UIStrings.t("kpi.apps_by_stage"),
			14, Palette.MUTED, "medium"))
	var names: Array = []
	for i in 4:  # gli stessi stadi del registro TAB
		names.append(UIStrings.t("registry.stage_%d" % i))
	for i in 4:
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 12)
		_content.add_child(row)
		var lbl := TerminalTheme.label(names[i], 14, Palette.BASE)
		lbl.custom_minimum_size = Vector2(120, 0)
		row.add_child(lbl)
		row.add_child(TerminalTheme.label("▰".repeat(stages[i]) if stages[i] > 0 else "—",
				16, Palette.GREEN if i >= 2 else Palette.BASE, "bold"))
		row.add_child(TerminalTheme.label(str(stages[i]), 14, Palette.MUTED))
	_content.add_child(HSeparator.new())
	var usage_btn := Button.new()
	usage_btn.text = UIStrings.t("usage.open")
	usage_btn.add_theme_font_size_override("font_size", 16)
	usage_btn.add_theme_color_override("font_color", Palette.GREEN)
	usage_btn.pressed.connect(func() -> void: _build("usage"))
	_content.add_child(usage_btn)

func _build_usage() -> void:
	# con la VPS collegata: consumo VERO per agente (kt nella finestra)
	var live: Dictionary = BackendBus.live_settings.get("usage", {})
	if not live.is_empty():
		_content.add_child(TerminalTheme.label(UIStrings.t("usage.title_window")
				% str(live.get("window_h", "?")), 16, Palette.WHITE, "bold"))
		var per_agent: Dictionary = live.get("per_agent_kt", {})
		if per_agent.is_empty():
			_content.add_child(TerminalTheme.label(
					UIStrings.t("usage.none"), 14, Palette.DIM))
		var keys: Array = per_agent.keys()
		keys.sort()
		for agent in keys:
			var row := HBoxContainer.new()
			row.add_theme_constant_override("separation", 12)
			_content.add_child(row)
			var base := str(agent).split("-")[0]
			var lbl := TerminalTheme.label("%s %s"
					% [ROLE_EMOJI.get(base, "•"), AgentNames.display_name(str(agent))],
					14, Palette.BASE)
			lbl.custom_minimum_size = Vector2(270, 0)
			row.add_child(lbl)
			row.add_child(TerminalTheme.label("%.1f kt" % float(per_agent[agent]),
					15, Palette.MINT, "bold"))
		_content.add_child(TerminalTheme.label(UIStrings.t("common.updated")
				% str(live.get("generated_at", "")).left(16), 12, Palette.DIM))
		_content.add_child(HSeparator.new())
		var back_live := Button.new()
		back_live.text = UIStrings.t("usage.back")
		back_live.add_theme_font_size_override("font_size", 16)
		back_live.add_theme_color_override("font_color", Palette.MUTED)
		back_live.pressed.connect(func() -> void: _build())
		_content.add_child(back_live)
		return
	var u: Dictionary = TeamData.usage()
	_content.add_child(TerminalTheme.label(UIStrings.t("usage.title"), 16, Palette.WHITE, "bold"))
	_kpi_row(UIStrings.t("kpi.provider"), str(u.get("provider", "—")), Palette.BRIGHT)
	_kpi_row(UIStrings.t("kpi.actions_today"), str(u.get("actions_today", 0)), Palette.MINT)
	_kpi_row(UIStrings.t("kpi.actions_week"), str(u.get("actions_week", 0)), Palette.MINT)
	_kpi_row(UIStrings.t("kpi.tokens_today"), str(u.get("tokens_today", "—")), Palette.MINT)
	_bar_row(UIStrings.t("kpi.quota_week"), u.get("quota_week_pct", 0.0), Palette.YELLOW)
	_bar_row(UIStrings.t("kpi.budget_used"), u.get("budget_used_pct", 0.0), Palette.GREEN)
	_content.add_child(HSeparator.new())
	var back := Button.new()
	back.text = UIStrings.t("usage.back")
	back.add_theme_font_size_override("font_size", 16)
	back.add_theme_color_override("font_color", Palette.MUTED)
	back.pressed.connect(func() -> void: _build())
	_content.add_child(back)

func _kpi_row(label_text: String, value: String, value_color: Color) -> void:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	_content.add_child(row)
	var lbl := TerminalTheme.label(label_text, 14, Palette.MUTED, "medium")
	lbl.custom_minimum_size = Vector2(220, 0)
	row.add_child(lbl)
	row.add_child(TerminalTheme.label(value, 18, value_color, "bold"))

func _bar_row(label_text: String, pct: float, color: Color) -> void:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	_content.add_child(row)
	var lbl := TerminalTheme.label(label_text, 14, Palette.MUTED, "medium")
	lbl.custom_minimum_size = Vector2(220, 0)
	row.add_child(lbl)
	var bar := ProgressBar.new()
	bar.custom_minimum_size = Vector2(220, 16)
	bar.max_value = 1.0
	bar.value = pct
	bar.show_percentage = false
	bar.modulate = color
	row.add_child(bar)
	row.add_child(TerminalTheme.label("%d%%" % int(pct * 100), 14, color, "bold"))
