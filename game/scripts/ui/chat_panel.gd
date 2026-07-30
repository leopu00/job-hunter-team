class_name ChatPanel
extends CanvasLayer
## Conversazione BIDIREZIONALE con un agente del team: dal click sull'agente
## si apre questa pagina, l'utente scrive e il messaggio parte sul canale
## REALE del team ([CHAT] via tmux nel pane dell'agente, contratto BackendBus).
## La conversazione arriva su agent_chat_updated come storia completa: si
## ridisegna da zero, i messaggi partial sono checkpoint "sta lavorando".
##
## Da qui in avanti il pannello è solo il GUSCIO: tiene il canale (apertura,
## invio, attesa, storia, scelte suggerite, onboarding guidato) e delega
## l'impaginazione a ComicChat, che disegna la pagina a fumetti — ritratto a
## destra, vignette al centro, barra di input in basso.
##
## Perché guscio + vista e non un file solo: il canale ha una decina di
## sorgenti di verità intrecciate (BackendBus, ScriptedOnboarding,
## SetupService) e non si monta in headless senza un backend; la vista invece
## sì, ed è quella che il self-test deve poter guardare. Tagliare qui rende
## verificabile la parte che si vede — vignette, ordine, colori, scroll.

signal closed

var _slug := ""           # uid di gioco (es. "coordinatore", "scout-2")
var _display_name := ""
var _roster: Array = []   # [{slug, name}] per lo switcher
var _view: ComicChat
var _backend_messages: Array = []
var _live_choices: Array = []
var _setup_signature := ""
var _closing := false

func _init(slug: String, display_name: String, roster: Array = []) -> void:
	_slug = slug
	_display_name = display_name
	_roster = roster
	layer = 40
	add_to_group("camera_blocking_overlay")

func _ready() -> void:
	BackendBus.mark_chat_read(_slug)
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.theme = TerminalTheme.get_theme()
	add_child(root)
	# Un Control sotto un CanvasLayer prende la misura dal viewport solo
	# quando il viewport la cambia: se non succede mai — headless, o finestra
	# che nasce già della misura giusta — resta largo zero e tutta la pagina
	# con lui. Gliela diamo noi, e poi la teniamo aggiornata.
	root.size = get_viewport().get_visible_rect().size
	get_viewport().size_changed.connect(func() -> void:
		if is_instance_valid(root):
			root.size = get_viewport().get_visible_rect().size)
	var dim := ColorRect.new()
	dim.color = Color(Palette.VOID.r, Palette.VOID.g, Palette.VOID.b, 0.88)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	dim.gui_input.connect(func(event: InputEvent) -> void:
		if event is InputEventMouseButton and event.pressed \
				and event.button_index in [MOUSE_BUTTON_LEFT, MOUSE_BUTTON_RIGHT]:
			close())
	root.add_child(dim)

	_view = ComicChat.new(_slug, _display_name, _roster)
	root.add_child(_view)
	_view.send_requested.connect(_send_text)
	_view.close_requested.connect(func() -> void: close())
	_view.switch_requested.connect(_switch_to)

	_render_conversation()
	# una sola conversazione aperta alla volta: mentre la pagina vive, ogni
	# agent_chat_updated è per noi (l'agent del segnale è il nome del sistema
	# reale, es. "capitano" per il coordinatore)
	BackendBus.agent_chat_updated.connect(_on_updated)
	BackendBus.user_chat_sent.connect(_on_sent)
	BackendBus.chat_waiting_changed.connect(_on_waiting)
	ScriptedOnboarding.conversation_changed.connect(_on_scripted_changed)
	ScriptedOnboarding.action_requested.connect(_on_scripted_action)
	SetupService.status_changed.connect(_on_setup_status_changed)
	# Apri la conversazione lato backend: SENZA questo il backend non fa il
	# fetch della history da chat.jsonl → la chat grande restava vuota e a
	# riapertura spariva anche il messaggio dell'utente (Leone 24/07). Come il
	# wizard, open_agent_chat triggera agent_chat_updated con lo storico.
	BackendBus.open_agent_chat(_slug)
	_refresh_chat_mode()
	if BackendBus.chat_waiting.has(_slug):
		_on_waiting(_slug, true)  # attesa già in corso da prima
	_view.focus_input()
	Sfx.play_blip()

## Cambio conversazione dallo switcher: si chiude il canale corrente,
## si apre quello del nuovo agente; la storia arriva da sola sul solito
## agent_chat_updated (una sola conversazione aperta alla volta).
func _switch_to(slug: String, display_name: String) -> void:
	if slug == _slug:
		return
	BackendBus.close_agent_chat()
	_slug = slug
	# Apri la conversazione del nuovo agente → fetch della sua history
	# (vedi _ready): al cambio agente lo storico si ricarica (Leone 24/07).
	BackendBus.open_agent_chat(_slug)
	BackendBus.mark_chat_read(_slug)
	_display_name = display_name
	_view.set_agent(_slug, _display_name)
	_view.set_waiting(false)
	_backend_messages.clear()
	_live_choices.clear()
	_refresh_chat_mode()
	if BackendBus.chat_waiting.has(_slug):
		_on_waiting(_slug, true)
	_view.focus_input()
	Sfx.play_blip()

## Cartella ritratto dal uid di gioco. Resta qui perché il wizard la usa per
## il ritratto dell'Assistente prima che esista una pagina di chat.
static func _portrait_slug(slug: String) -> String:
	return ComicChat.portrait_slug(slug)

func _on_updated(agent: String, messages: Array) -> void:
	if ScriptedOnboarding.normalize_agent(agent) \
			!= ScriptedOnboarding.normalize_agent(_slug):
		return
	_backend_messages = messages.duplicate(true)
	_live_choices = _latest_live_choices(_backend_messages)
	_render_conversation()
	_render_choices()
	# il ritratto reagisce all'ultima battuta dell'agente (crossfade
	# emozione; se il ruolo non ha quella faccia resta sul neutro)
	if not messages.is_empty() \
			and str(messages[-1].get("role", "")) != "user":
		_view.set_mood("caldo")

func _on_sent(_agent: String, ok: bool, error: String) -> void:
	if not ok:
		_view.append_notice("⚠ " + error, Palette.RED)

func _on_waiting(agent: String, waiting: bool) -> void:
	if agent != _slug and not agent.begins_with(_slug):
		return
	_view.set_waiting(waiting)


func _refresh_chat_mode() -> void:
	_setup_signature = _chat_mode_signature()
	var guided := ScriptedOnboarding.supports(_slug) \
			and ScriptedOnboarding.use_scripted_chat(_slug)
	var live_text := ScriptedOnboarding.live_text_available(_slug) \
			if ScriptedOnboarding.supports(_slug) else (\
			ScriptedOnboarding.provider_authenticated() \
			and bool(SetupService.status.get("container_running", false)) \
			and BackendBus.can_chat_with(_slug))
	_view.input.editable = live_text
	_view.send_button.disabled = not live_text
	_view.input.placeholder_text = UIStrings.t("guided.free_placeholder" if live_text \
			else "guided.choice_placeholder")
	if guided:
		_view.warn.text = UIStrings.t("guided.offline_note")
		_view.warn.visible = true
	elif ScriptedOnboarding.provider_authenticated() and not live_text:
		_view.warn.text = UIStrings.t("guided.agent_unavailable")
		_view.warn.visible = true
	else:
		_view.warn.text = UIStrings.t("chat.besteffort")
		_view.warn.visible = not BackendBus.chat_replies(_slug)
	_render_choices()
	if live_text:
		BackendBus.open_agent_chat(_slug)
	_render_conversation()


func _render_conversation() -> void:
	var shown: Array = []
	if ScriptedOnboarding.supports(_slug) and ScriptedOnboarding.use_scripted_chat(_slug):
		shown.append_array(ScriptedOnboarding.messages(_slug))
	shown.append_array(_backend_messages)
	_view.render(shown)


func _render_choices() -> void:
	for child in _view.choices.get_children():
		child.queue_free()
	var guided := ScriptedOnboarding.supports(_slug) \
			and ScriptedOnboarding.use_scripted_chat(_slug)
	var options: Array = ScriptedOnboarding.options(_slug) if guided \
			else _live_choices
	if options.is_empty():
		return
	_view.choices.add_child(TerminalTheme.label(UIStrings.t(
			"guided.choose" if guided else "guided.ai_suggestions"),
			12, Palette.MUTED, "medium"))
	for option in options:
		var entry: Dictionary = option if option is Dictionary \
				else {"label": str(option), "value": str(option)}
		var button := Button.new()
		button.text = "› " + str(entry.get("label", ""))
		button.alignment = HORIZONTAL_ALIGNMENT_LEFT
		button.add_theme_font_size_override("font_size", 14)
		button.add_theme_color_override("font_color", Palette.GREEN)
		button.pressed.connect(func() -> void:
			if guided:
				ScriptedOnboarding.choose(_slug, str(entry.get("id", "")))
			else:
				_send_text(str(entry.get("value", entry.get("label", ""))))
			Sfx.play_tick())
		_view.choices.add_child(button)


## Suggerimenti REALI: sono accettati soltanto sull'ultima risposta completa
## dell'agente e spariscono appena l'utente invia una battuta successiva.
## Il formato additivo del JSONL è {choices:[{label,value}, ...]}.
static func _latest_live_choices(messages: Array) -> Array:
	if messages.is_empty():
		return []
	var last: Variant = messages[-1]
	if not last is Dictionary or str(last.get("role", "")) == "user" \
			or bool(last.get("partial", false)) or not bool(last.get("done", true)):
		return []
	var raw: Variant = last.get("choices", [])
	if not raw is Array:
		return []
	var out: Array = []
	for item in raw:
		var label := str(item.get("label", "") if item is Dictionary else item).strip_edges()
		var value := str(item.get("value", label) if item is Dictionary else item).strip_edges()
		if not label.is_empty() and not value.is_empty() and out.size() < 5:
			out.append({"label": label.left(120), "value": value.left(1000)})
	return out


func _on_scripted_changed(agent: String) -> void:
	if ScriptedOnboarding.normalize_agent(agent) != ScriptedOnboarding.normalize_agent(_slug):
		return
	_refresh_chat_mode()

func _on_setup_status_changed(_status: Dictionary) -> void:
	# Il login provider è un cambio di regime immediato: nessuna scelta authored
	# deve sopravvivere nella pagina già aperta.
	if _chat_mode_signature() != _setup_signature:
		_refresh_chat_mode()

func _chat_mode_signature() -> String:
	return "%s|%s|%s" % [
		str(ScriptedOnboarding.provider_authenticated()),
		str(bool(SetupService.status.get("container_running", false))),
		str(BackendBus.can_chat_with(_slug)),
	]


func _on_scripted_action(action: String, payload: Dictionary) -> void:
	if action == "open_section":
		close(false)
	elif action == "open_scripted_chat":
		var agent := str(payload.get("agent", "assistente"))
		# il nome sull'intestazione è lo stesso che l'utente legge in scena
		# e nella colonna delle chat: uno solo, e nella sua lingua
		_switch_to(agent, CharacterDefs.role_name(agent))

func _send_text(text: String) -> void:
	if text.strip_edges().is_empty() or not _view.input.editable:
		return
	_live_choices.clear()
	_render_choices()
	BackendBus.send_user_chat(_slug, text)
	Sfx.play_tick()

func close(sound := true) -> void:
	if _closing:
		return
	_closing = true
	BackendBus.close_agent_chat()
	if sound:
		Sfx.play_back()
	closed.emit()
	queue_free()

func _unhandled_key_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo \
			and event.keycode == KEY_ESCAPE:
		get_viewport().set_input_as_handled()
		close()
