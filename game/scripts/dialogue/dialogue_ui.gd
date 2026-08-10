class_name DialogueUI
extends CanvasLayer
## Dialogo focalizzato: ritratto grande in primo piano a destra + vignette
## in sequenza (pattern Going Under): ogni battuta è una vignetta; le
## precedenti salgono e si attenuano. Typewriter, scelte 1-9, ESC chiude.

signal closed
## Nodo con campo "action" raggiunto: il regista (tour) traduce la scelta
## narrativa in effetti reali (preferenze salvate, pagine da aprire).
signal action_triggered(action: String)

const TYPE_SPEED := 42.0          # caratteri al secondo
const MAX_OLD_VIGNETTES := 2

var _slug := ""
var _display_name := ""
var _tree_id := ""
var _tree: Dictionary
var _node_id := ""
var _portrait: PortraitView
var _stack: VBoxContainer         # vignette: le vecchie sopra, la corrente in fondo
var _current_text: RichTextLabel
var _current_panel: BracketPanel
var _choices_box: VBoxContainer
var _hint: Label
var _root: Control

var _full_text := ""
var _visible_chars := 0.0
var _typing := false
var _tick_accum := 0

func open(slug: String, display_name: String, tree_id := "") -> void:
	_slug = slug
	_display_name = display_name
	_tree_id = tree_id if not tree_id.is_empty() else slug
	_tree = Dialogues.TREES.get(_tree_id, {})
	layer = 60
	Game.dialogue_active = true
	# Chi deve poter chiudere il dialogo dall'esterno (l'uscita dal giro
	# guidato) lo trova da qui invece di tenerne un riferimento.
	add_to_group(&"dialogue_ui")

	_root = Control.new()
	_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	_root.theme = TerminalTheme.get_theme()
	add_child(_root)

	# oscuramento morbido del mondo
	var dim := ColorRect.new()
	dim.color = Color(Palette.VOID.r, Palette.VOID.g, Palette.VOID.b, 0.55)
	dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	_root.add_child(dim)

	# ritratto in primo piano a destra
	_portrait = PortraitView.new()
	_portrait.position = Vector2(1920 - 560 - 90, 1080 - 760 + 40)
	_root.add_child(_portrait)
	_portrait.setup(slug)
	_portrait.enter_anim()

	# targa nome sotto il ritratto
	var name_plate := BracketPanel.new()
	name_plate.position = Vector2(1920 - 560 - 90 + 120, 1080 - 74)
	_root.add_child(name_plate)
	var name_label := TerminalTheme.label(display_name.to_upper(), 22, Palette.GREEN, "bold")
	name_plate.add_child(name_label)

	# colonna vignette a sinistra
	var col := MarginContainer.new()
	col.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
	col.position = Vector2(70, 0)
	col.grow_vertical = Control.GROW_DIRECTION_BEGIN
	col.grow_horizontal = Control.GROW_DIRECTION_END
	_root.add_child(col)
	_stack = VBoxContainer.new()
	_stack.custom_minimum_size = Vector2(1080, 0)
	_stack.add_theme_constant_override("separation", 10)
	_stack.alignment = BoxContainer.ALIGNMENT_END
	col.add_child(_stack)
	col.anchor_top = 1.0
	col.offset_top = -940.0
	col.offset_bottom = -56.0

	_hint = TerminalTheme.label(
			UIStrings.t("hud.dialogue_next") + "   " + UIStrings.t("hud.dialogue_skip"),
			14, Palette.DIM)
	_hint.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
	_hint.position = Vector2(74, -34)
	_hint.grow_vertical = Control.GROW_DIRECTION_BEGIN
	_root.add_child(_hint)

	Sfx.play_confirm()
	_goto("start")
	if OS.get_environment("JHT_DIALOGUE_INSTANT") == "1":
		_finish_typing()

func _goto(id: String) -> void:
	if not _tree.has(id):
		_close()
		return
	_node_id = id
	var node: Dictionary = _tree[id]
	if node.has("action"):
		action_triggered.emit(str(node["action"]))
	var parsed := Dialogues.parse_emotion(node["text"])
	var emo: String = parsed[0]
	var text: String = Dialogues.resolve_placeholders(parsed[1], TeamData)
	_portrait.set_state(node.get("pose", _portrait._cur_pose if _portrait._cur_pose else "a"), emo)
	_push_vignette(text)

## Crea la vignetta della battuta corrente e attenua le precedenti.
func _push_vignette(text: String) -> void:
	_clear_choices()
	if _current_panel:
		_age_vignette(_current_panel)
	_current_panel = BracketPanel.new()
	_current_panel.bracket_color = Palette.GREEN
	var inner := MarginContainer.new()
	for side in ["left", "right", "top", "bottom"]:
		inner.add_theme_constant_override("margin_" + side, 16)
	_current_panel.add_child(inner)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 6)
	inner.add_child(box)
	var who := TerminalTheme.label(_display_name.to_upper(), 15, Palette.MINT, "bold")
	box.add_child(who)
	_current_text = RichTextLabel.new()
	_current_text.bbcode_enabled = false
	_current_text.fit_content = true
	_current_text.scroll_active = false
	_current_text.add_theme_font_size_override("normal_font_size", 21)
	_current_text.text = text
	_current_text.custom_minimum_size = Vector2(1020, 0)
	box.add_child(_current_text)
	_choices_box = VBoxContainer.new()
	_choices_box.add_theme_constant_override("separation", 6)
	box.add_child(_choices_box)
	_stack.add_child(_current_panel)
	# slide-in della vignetta
	_current_panel.modulate.a = 0.0
	var tw := _current_panel.create_tween()
	tw.tween_property(_current_panel, "modulate:a", 1.0, 0.15)
	# typewriter
	_full_text = text
	_visible_chars = 0.0
	_current_text.visible_characters = 0
	_typing = true
	# pota la storia
	while _stack.get_child_count() > MAX_OLD_VIGNETTES + 1:
		_stack.get_child(0).queue_free()
		await get_tree().process_frame

## Una vignetta appena superata: più piccola, più spenta.
func _age_vignette(panel: BracketPanel) -> void:
	panel.bracket_color = Palette.BORDER_GLOW
	var tw := panel.create_tween()
	tw.set_parallel()
	tw.tween_property(panel, "modulate", Color(0.75, 0.75, 0.85, 0.45), 0.25)
	tw.tween_property(panel, "scale", Vector2(0.96, 0.96), 0.25)

func _process(delta: float) -> void:
	if _typing:
		_visible_chars += delta * TYPE_SPEED
		var n := int(_visible_chars)
		if n != _current_text.visible_characters:
			_tick_accum += n - _current_text.visible_characters
			if _tick_accum >= 3:
				_tick_accum = 0
				Sfx.play_tick()
			_current_text.visible_characters = n
		if n >= _full_text.length():
			_finish_typing()

func _finish_typing() -> void:
	_typing = false
	_current_text.visible_characters = -1
	var node: Dictionary = _tree[_node_id]
	if node.has("choices"):
		_show_choices(node["choices"])

func _show_choices(choices: Array) -> void:
	for i in choices.size():
		var choice: Dictionary = choices[i]
		var b := Button.new()
		b.text = "%d · %s" % [i + 1, choice["text"]]
		b.alignment = HORIZONTAL_ALIGNMENT_LEFT
		b.pressed.connect(func() -> void:
			Sfx.play_blip()
			ScriptedOnboarding.record_dialogue_choice(_tree_id, _node_id,
					str(choice.get("text", "")), str(choice.get("next", "")))
			_goto(choice["next"]))
		_choices_box.add_child(b)
	if _choices_box.get_child_count() > 0:
		(_choices_box.get_child(0) as Button).grab_focus()

func _clear_choices() -> void:
	if _choices_box:
		for child in _choices_box.get_children():
			child.queue_free()

func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("pause"):
		_close()
		_root.get_viewport().set_input_as_handled()
		return
	var node: Dictionary = _tree.get(_node_id, {})
	var has_choices: bool = node.has("choices")
	if event is InputEventKey and event.pressed and has_choices and not _typing:
		var idx := -1
		match event.physical_keycode:
			KEY_1: idx = 0
			KEY_2: idx = 1
			KEY_3: idx = 2
			KEY_4: idx = 3
			KEY_5: idx = 4
			KEY_6: idx = 5
			KEY_7: idx = 6
			KEY_8: idx = 7
			KEY_9: idx = 8
		if idx >= 0 and idx < node["choices"].size():
			Sfx.play_blip()
			var choice: Dictionary = node["choices"][idx]
			ScriptedOnboarding.record_dialogue_choice(_tree_id, _node_id,
					str(choice.get("text", "")), str(choice.get("next", "")))
			_goto(choice["next"])
			return
	var advance: bool = event.is_action_pressed("ui_accept") \
			or event.is_action_pressed("interact") \
			or (event is InputEventMouseButton and event.pressed \
				and event.button_index == MOUSE_BUTTON_LEFT)
	if not advance:
		return
	if _typing:
		_visible_chars = _full_text.length()
		return
	if has_choices:
		return  # bisogna scegliere
	if node.has("next"):
		_goto(node["next"])
	else:
		_close()

## Chiusura chiesta da fuori (uscita dal giro guidato): stessa strada del
## congedo normale, così `dialogue_active` torna falso una volta sola.
func close_now() -> void:
	_close()


func _close() -> void:
	Game.dialogue_active = false
	Sfx.play_back()
	closed.emit()
	queue_free()
