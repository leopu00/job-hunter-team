extends Control
## Setup wizard in-game, guidato dall'Assistente (ritratto a destra, come
## nei dialoghi): avatar → "caricamento" CV (file picker vero, parsing
## finto) → nome team. Estetica console JHT.

enum Step { WELCOME, AVATAR, CV, TEAM }

const STEP_NAMES := ["wizard.step_welcome", "wizard.step_avatar", "wizard.step_cv", "wizard.step_team"]

var step: Step = Step.WELCOME

var _portrait: PortraitView
var _say_text: RichTextLabel
var _full_say := ""
var _visible_chars := 0.0
var _typing := false

var _panel: BracketPanel
var _content: VBoxContainer
var _footer: Label
var _next_btn: Button
var _back_btn: Button

var _preview_rig: CharacterRig
var _preview_facing := 0  # 0 down, 1 side, 2 up
var _cv_path := ""
var _parsing := false
var _team_edit: LineEdit

func _ready() -> void:
	theme = TerminalTheme.get_theme()
	set_anchors_preset(Control.PRESET_FULL_RECT)

	var bg := GridBackground.new()
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(bg)

	var title := TerminalTheme.label(UIStrings.t("wizard.title"), 26, Palette.WHITE, "xbold")
	title.position = Vector2(70, 44)
	add_child(title)
	var title_sub := TerminalTheme.label("// job hunter team", 16, Palette.GREEN)
	title_sub.position = Vector2(72, 84)
	add_child(title_sub)

	# ritratto dell'Assistente a destra
	_portrait = PortraitView.new()
	_portrait.position = Vector2(1920 - 560 - 90, 1080 - 760 + 40)
	add_child(_portrait)
	_portrait.setup("assistente")
	_portrait.enter_anim()
	var plate := BracketPanel.new()
	plate.position = Vector2(1920 - 560 - 90 + 140, 1080 - 74)
	add_child(plate)
	plate.add_child(TerminalTheme.label("L'ASSISTENTE", 20, Palette.GREEN, "bold"))

	# vignetta dell'Assistente (sopra il pannello passi)
	var say_panel := BracketPanel.new()
	say_panel.position = Vector2(70, 150)
	say_panel.custom_minimum_size = Vector2(1080, 0)
	add_child(say_panel)
	var say_margin := MarginContainer.new()
	for side in ["left", "right", "top", "bottom"]:
		say_margin.add_theme_constant_override("margin_" + side, 14)
	say_panel.add_child(say_margin)
	_say_text = RichTextLabel.new()
	_say_text.fit_content = true
	_say_text.scroll_active = false
	_say_text.custom_minimum_size = Vector2(1040, 54)
	_say_text.add_theme_font_size_override("normal_font_size", 20)
	say_margin.add_child(_say_text)

	# pannello contenuto del passo
	_panel = BracketPanel.new()
	_panel.position = Vector2(70, 300)
	_panel.custom_minimum_size = Vector2(1080, 520)
	add_child(_panel)
	var margin := MarginContainer.new()
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 26)
	_panel.add_child(margin)
	_content = VBoxContainer.new()
	_content.add_theme_constant_override("separation", 16)
	margin.add_child(_content)

	# barra di navigazione
	_back_btn = Button.new()
	_back_btn.text = UIStrings.t("wizard.back")
	_back_btn.position = Vector2(70, 860)
	_back_btn.pressed.connect(_go_back)
	add_child(_back_btn)
	_next_btn = Button.new()
	_next_btn.text = UIStrings.t("wizard.next")
	_next_btn.position = Vector2(1000, 860)
	_next_btn.pressed.connect(_go_next)
	add_child(_next_btn)

	_footer = TerminalTheme.label("", 15, Palette.DIM)
	_footer.position = Vector2(72, 1020)
	add_child(_footer)

	_enter_step(Step.WELCOME)

func _process(delta: float) -> void:
	if _typing:
		_visible_chars += delta * 46.0
		var n := int(_visible_chars)
		if n != _say_text.visible_characters:
			if n % 3 == 0:
				Sfx.play_tick()
			_say_text.visible_characters = n
		if n >= _full_say.length():
			_typing = false
			_say_text.visible_characters = -1

## L'Assistente parla: tag emozione inline → espressione del ritratto.
func _say(key: String, pose := "") -> void:
	var parsed := Dialogues.parse_emotion(UIStrings.t(key))
	if pose != "":
		_portrait.set_state(pose, parsed[0])
	else:
		_portrait.set_state(_portrait._cur_pose if _portrait._cur_pose else "a", parsed[0])
	_full_say = parsed[1]
	_say_text.text = _full_say
	_say_text.visible_characters = 0
	_visible_chars = 0.0
	_typing = true

# ── Navigazione fra i passi ───────────────────────────────────────────

func _enter_step(s: Step) -> void:
	step = s
	for child in _content.get_children():
		child.queue_free()
	_footer.text = UIStrings.t("wizard.step") % [int(step) + 1, STEP_NAMES.size()] \
			+ " · " + UIStrings.t(STEP_NAMES[int(step)])
	_back_btn.visible = step != Step.WELCOME
	_next_btn.visible = true
	_next_btn.text = UIStrings.t("wizard.done") if step == Step.TEAM else UIStrings.t("wizard.next")
	match step:
		Step.WELCOME:
			_say("wizard.say_welcome", "a")
			var center := CenterContainer.new()
			center.custom_minimum_size = Vector2(1020, 440)
			_content.add_child(center)
			var word_box := VBoxContainer.new()
			word_box.add_theme_constant_override("separation", 8)
			center.add_child(word_box)
			var word := TerminalTheme.label("JOB HUNTER TEAM", 54, Palette.WHITE, "xbold")
			word.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			word_box.add_child(word)
			var sub := TerminalTheme.label("// THE OFFICE — configurazione del tuo team", 18, Palette.GREEN)
			sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			word_box.add_child(sub)
		Step.AVATAR:
			_say("wizard.say_avatar", "b")
			_build_avatar_step()
		Step.CV:
			_say("wizard.say_cv", "b")
			_build_cv_step()
			_next_btn.visible = _cv_path != ""
		Step.TEAM:
			_say("wizard.say_team", "a")
			_build_team_step()

func _go_next() -> void:
	Sfx.play_confirm()
	match step:
		Step.WELCOME:
			_enter_step(Step.AVATAR)
		Step.AVATAR:
			_enter_step(Step.CV)
		Step.CV:
			_enter_step(Step.TEAM)
		Step.TEAM:
			_finish()

func _go_back() -> void:
	Sfx.play_back()
	if step > Step.WELCOME:
		_enter_step((step - 1) as Step)

func _finish() -> void:
	Game.profile["team_name"] = _team_edit.text.strip_edges()
	if Game.profile["team_name"].is_empty():
		Game.profile["team_name"] = UIStrings.t("wizard.team_default")
	_next_btn.visible = false
	_back_btn.visible = false
	_say("wizard.say_done", "a")
	get_tree().create_timer(2.6).timeout.connect(func() -> void:
		Game.goto_office())

# ── Passo avatar ──────────────────────────────────────────────────────

func _build_avatar_step() -> void:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 40)
	_content.add_child(row)

	# anteprima live a sinistra
	var preview := Panel.new()
	preview.custom_minimum_size = Vector2(360, 430)
	row.add_child(preview)
	var holder := Node2D.new()
	holder.position = Vector2(180, 390)
	holder.scale = Vector2(3.4, 3.4)
	preview.add_child(holder)
	_preview_rig = CharacterRig.new()
	_preview_rig.setup(CharacterDefs.player_textures(Game.profile))
	holder.add_child(_preview_rig)
	_apply_preview_facing()
	var turn := Button.new()
	turn.text = UIStrings.t("wizard.avatar_turn")
	turn.position = Vector2(115, 436)
	turn.pressed.connect(func() -> void:
		_preview_facing = (_preview_facing + 1) % 3
		Sfx.play_blip()
		_apply_preview_facing())
	preview.add_child(turn)

	# opzioni a destra
	var opts := VBoxContainer.new()
	opts.add_theme_constant_override("separation", 22)
	opts.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(opts)
	_add_cycle_row(opts, "wizard.avatar_base", "base", CharacterDefs.PLAYER_BASES.size())
	_add_cycle_row(opts, "wizard.avatar_hair", "hair", CharacterDefs.PLAYER_HAIR_STYLES.size())
	_add_swatch_row(opts, "wizard.avatar_hair_color", "hair_color", CharacterDefs.PLAYER_HAIR_COLORS)
	_add_swatch_row(opts, "wizard.avatar_outfit", "outfit", CharacterDefs.PLAYER_OUTFIT_COLORS)

func _add_cycle_row(parent: Node, label_key: String, field: String, count: int) -> void:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 14)
	parent.add_child(row)
	var lbl := TerminalTheme.label(UIStrings.t(label_key), 18, Palette.MUTED, "medium")
	lbl.custom_minimum_size = Vector2(260, 0)
	row.add_child(lbl)
	var prev := Button.new()
	prev.text = "◀"
	row.add_child(prev)
	var value := TerminalTheme.label("%d / %d" % [Game.profile[field] + 1, count], 18, Palette.WHITE, "bold")
	value.custom_minimum_size = Vector2(80, 0)
	value.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	row.add_child(value)
	var next := Button.new()
	next.text = "▶"
	row.add_child(next)
	var cycle := func(dir: int) -> void:
		Game.profile[field] = (Game.profile[field] + dir + count) % count
		value.text = "%d / %d" % [Game.profile[field] + 1, count]
		Sfx.play_blip()
		_refresh_preview()
	prev.pressed.connect(func() -> void: cycle.call(-1))
	next.pressed.connect(func() -> void: cycle.call(1))

func _add_swatch_row(parent: Node, label_key: String, field: String, colors: Array) -> void:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 14)
	parent.add_child(row)
	var lbl := TerminalTheme.label(UIStrings.t(label_key), 18, Palette.MUTED, "medium")
	lbl.custom_minimum_size = Vector2(260, 0)
	row.add_child(lbl)
	var group: Array[Button] = []
	for i in colors.size():
		var b := Button.new()
		b.custom_minimum_size = Vector2(52, 40)
		var sb := StyleBoxFlat.new()
		sb.bg_color = colors[i]
		sb.set_border_width_all(2)
		sb.border_color = Palette.GREEN if Game.profile[field] == i else Palette.BORDER
		b.add_theme_stylebox_override("normal", sb)
		b.add_theme_stylebox_override("hover", sb.duplicate())
		b.add_theme_stylebox_override("pressed", sb.duplicate())
		row.add_child(b)
		group.append(b)
		b.pressed.connect(func() -> void:
			Game.profile[field] = i
			Sfx.play_blip()
			for j in group.size():
				var st: StyleBoxFlat = group[j].get_theme_stylebox("normal")
				st.border_color = Palette.GREEN if j == i else Palette.BORDER
				group[j].add_theme_stylebox_override("normal", st)
			_refresh_preview())

func _refresh_preview() -> void:
	if not _preview_rig:
		return
	var holder := _preview_rig.get_parent()
	_preview_rig.queue_free()
	_preview_rig = CharacterRig.new()
	_preview_rig.setup(CharacterDefs.player_textures(Game.profile))
	holder.add_child(_preview_rig)
	_apply_preview_facing()

func _apply_preview_facing() -> void:
	var facing: String = ["down", "side", "up"][_preview_facing]
	_preview_rig.set_motion(facing, false, "idle")

# ── Passo CV ──────────────────────────────────────────────────────────

func _build_cv_step() -> void:
	var pick := Button.new()
	pick.text = UIStrings.t("wizard.cv_pick")
	_content.add_child(pick)
	var status := TerminalTheme.label(
			UIStrings.t("wizard.cv_none") if _cv_path.is_empty()
			else UIStrings.t("wizard.cv_loaded") % _cv_path.get_file(),
			17, Palette.MUTED)
	_content.add_child(status)
	var bar := ProgressBar.new()
	bar.custom_minimum_size = Vector2(0, 30)
	bar.max_value = 100.0
	bar.show_percentage = false
	bar.visible = false
	_content.add_child(bar)
	var log_label := TerminalTheme.label("", 16, Palette.GREEN)
	_content.add_child(log_label)

	pick.pressed.connect(func() -> void:
		if _parsing:
			return
		var dialog := FileDialog.new()
		dialog.file_mode = FileDialog.FILE_MODE_OPEN_FILE
		dialog.access = FileDialog.ACCESS_FILESYSTEM
		dialog.use_native_dialog = true
		dialog.filters = ["*.pdf,*.docx,*.doc,*.txt,*.md ; Curriculum"]
		add_child(dialog)
		dialog.file_selected.connect(func(path: String) -> void:
			_start_fake_parse(path, status, bar, log_label))
		dialog.popup_centered())

## Parsing simulato: barra + log divertente, nessuna lettura reale del file.
func _start_fake_parse(path: String, status: Label, bar: ProgressBar, log_label: Label) -> void:
	_parsing = true
	_cv_path = path
	Game.profile["cv_name"] = path.get_file()
	status.text = path.get_file()
	bar.visible = true
	bar.value = 0.0
	_next_btn.visible = false
	_say("wizard.say_cv_parsing", "b")
	var steps := 6
	for i in steps:
		log_label.text = "> " + UIStrings.t("wizard.parse_%d" % i)
		Sfx.play_tick()
		var tw := create_tween()
		tw.tween_property(bar, "value", (i + 1) * 100.0 / steps, 0.55) \
				.set_trans(Tween.TRANS_SINE)
		await tw.finished
		await get_tree().create_timer(randf_range(0.1, 0.4)).timeout
	_parsing = false
	status.text = UIStrings.t("wizard.cv_loaded") % path.get_file()
	_say("wizard.say_cv_done", "a")
	Sfx.play_confirm()
	_next_btn.visible = true

# ── Passo nome team ───────────────────────────────────────────────────

func _build_team_step() -> void:
	_content.add_child(TerminalTheme.label(UIStrings.t("wizard.team_label"), 18, Palette.MUTED, "medium"))
	_team_edit = LineEdit.new()
	_team_edit.placeholder_text = UIStrings.t("wizard.team_placeholder")
	_team_edit.text = Game.profile["team_name"]
	_team_edit.custom_minimum_size = Vector2(520, 54)
	_team_edit.add_theme_font_size_override("font_size", 24)
	_content.add_child(_team_edit)
	_team_edit.grab_focus.call_deferred()
	_team_edit.text_submitted.connect(func(_t: String) -> void: _go_next())
