class_name UpdateNotice
extends PanelContainer
## "C'è una versione più recente", detto senza fermare nessuno.
##
## L'aggiornamento è la notizia più facile da trasformare in molestia: una
## finestra modale che si mette davanti al lavoro viene chiusa di riflesso, e la
## volta in cui conta davvero — quella che sistema il bug per cui l'utente stava
## per disinstallare — la chiuderà allo stesso modo.
##
## Quindi la stessa forma delle altre due fasce dell'ufficio (`budget_notice.gd`,
## `headless_notice.gd`): una riga sotto il badge dei dati, il colore che dice di
## che si tratta, e la possibilità di ignorarla. Con una differenza sola, che è
## il motivo per cui esiste: qui si può anche rispondere.

var _label: Label
var _act: Button
var _later: Button
## Chiusa con "più tardi": per questa sessione non si rifà vedere. Al prossimo
## avvio il ritmo di un controllo al giorno decide da solo se riproporla.
var _dismissed := false


func _ready() -> void:
	visible = false
	var margin := MarginContainer.new()
	margin.add_theme_constant_override("margin_left", 16)
	margin.add_theme_constant_override("margin_right", 16)
	margin.add_theme_constant_override("margin_top", 6)
	margin.add_theme_constant_override("margin_bottom", 6)
	add_child(margin)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 14)
	margin.add_child(row)
	_label = TerminalTheme.label("", 15, Palette.BLUE, "bold")
	row.add_child(_label)
	_act = Button.new()
	_act.add_theme_color_override("font_color", Palette.BLUE)
	_act.pressed.connect(_on_act)
	row.add_child(_act)
	_later = Button.new()
	_later.text = UIStrings.t("update.later")
	_later.add_theme_color_override("font_color", Palette.MUTED)
	_later.pressed.connect(func() -> void:
		_dismissed = true
		visible = false)
	row.add_child(_later)
	UpdateService.state_changed.connect(_refresh)
	_refresh(UpdateService.state())


## Terza fascia, sotto quella del budget (56) e quella del rientro (98): le tre
## non si sovrappongono mai.
func _notification(what: int) -> void:
	if what == NOTIFICATION_RESIZED and is_inside_tree():
		position = Vector2((get_parent_area_size().x - size.x) / 2.0, 140)


func _refresh(state: Dictionary) -> void:
	var phase := str(state.get("phase", ""))
	# Un aggiornamento appena installato si dice comunque: l'utente lo ha
	# chiesto lui, e la riga è la risposta alla sua richiesta.
	if _dismissed and phase != UpdateService.PHASE_DONE:
		return
	var latest := str(state.get("latest", ""))
	var acting := false
	var closable := false
	match phase:
		UpdateService.PHASE_AVAILABLE:
			_label.text = UIStrings.t("update.available") % [latest,
					str(state.get("current", ""))]
			_act.text = UIStrings.t("update.install" if bool(state.get("can_install", false))
					else "update.open_page")
			acting = true
			closable = true
		UpdateService.PHASE_DOWNLOADING:
			_label.text = UIStrings.t("update.downloading") % int(state.get("progress", 0))
		UpdateService.PHASE_INSTALLING:
			_label.text = UIStrings.t("update.installing")
		UpdateService.PHASE_DONE:
			_label.text = UIStrings.t("update.installed") % latest
			_act.text = UIStrings.t("update.restart")
			acting = true
		UpdateService.PHASE_FAILED:
			# Fallito non vuol dire perso: resta la strada che l'utente avrebbe
			# comunque, cioè la pagina da cui scaricare a mano.
			_label.text = UIStrings.t("update.failed") \
					% UIStrings.t(str(state.get("error", "")))
			_act.text = UIStrings.t("update.open_page")
			acting = true
			closable = true
		_:
			visible = false
			return
	_act.visible = acting
	_later.visible = closable
	_paint(Palette.RED if phase == UpdateService.PHASE_FAILED else Palette.BLUE)
	visible = true


func _paint(color: Color) -> void:
	_label.add_theme_color_override("font_color", color)
	_act.add_theme_color_override("font_color", color)
	var style := StyleBoxFlat.new()
	style.bg_color = Color(Palette.PANEL.r, Palette.PANEL.g, Palette.PANEL.b, 0.95)
	style.border_color = Color(color.r, color.g, color.b, 0.85)
	style.set_border_width_all(TerminalTheme.hairline())
	add_theme_stylebox_override("panel", style)


func _on_act() -> void:
	match UpdateService.phase:
		UpdateService.PHASE_AVAILABLE:
			UpdateService.install()
		UpdateService.PHASE_DONE:
			UpdateService.restart()
		_:
			UpdateService.open_release_page()
