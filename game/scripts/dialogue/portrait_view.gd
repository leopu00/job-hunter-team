class_name PortraitView
extends Control
## Ritratto animato da dialogo: layer base + posa + espressione.
## Mai statico (dossier §2): slide-in con settle alla Hades, respiro
## sinusoidale, micro-tilt, transizione 100-200ms a ogni battuta.

const DIR := "res://assets/characters/gen/portraits/"
## Ritratti pittorici full-image (gen-art, uno per emozione): se presenti
## per lo slug, vincono sul sistema a layer SVG.
const GEN_DIR := "res://assets/gen-art/portraits/"
const SIZE := Vector2(560, 760)

var _slug := ""
var _full_mode := false
var _base: TextureRect
var _pose: TextureRect
var _face: TextureRect
var _face_old: TextureRect
var _cur_pose := ""
var _cur_face := ""
var _t := 0.0

func _ready() -> void:
	custom_minimum_size = SIZE
	pivot_offset = Vector2(SIZE.x / 2.0, SIZE.y)  # respira "dai piedi"
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_base = _layer()
	_pose = _layer()
	_face_old = _layer()
	_face = _layer()

func setup(slug: String) -> void:
	_slug = slug
	_cur_pose = ""
	_cur_face = ""
	# exists() è true anche col solo .import: la modalità pittorica va attivata
	# solo se il PNG carica davvero, altrimenti si usano i ritratti SVG.
	var full_path := GEN_DIR + slug + "/full_neutro.png"
	_full_mode = (load(full_path) if ResourceLoader.exists(full_path) else null) != null
	if _full_mode:
		_base.texture = null
		_pose.texture = null
	else:
		_base.texture = load(DIR + slug + "/base.svg")

func has_face(face: String) -> bool:
	return ResourceLoader.exists(DIR + _slug + "/face_%s.svg" % face)

func has_pose(pose: String) -> bool:
	return ResourceLoader.exists(DIR + _slug + "/pose_%s.svg" % pose)

## Cambia posa/espressione con micro-transizione (chiamata a ogni battuta).
func set_state(pose: String, face: String) -> void:
	if _full_mode:
		_set_full(face)
		return
	if not has_pose(pose):
		pose = "a"
	if not has_face(face):
		face = "neutro" if has_face("neutro") else face
	if pose != _cur_pose:
		_cur_pose = pose
		_pose.texture = load(DIR + _slug + "/pose_%s.svg" % pose)
		_pose.position.x = 14.0
		_pose.modulate.a = 0.4
		var tw := create_tween()
		tw.set_parallel()
		tw.tween_property(_pose, "position:x", 0.0, 0.16) \
				.set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
		tw.tween_property(_pose, "modulate:a", 1.0, 0.12)
	if face != _cur_face:
		_cur_face = face
		_face_old.texture = _face.texture
		_face_old.modulate.a = 1.0 if _face.texture else 0.0
		_face.texture = load(DIR + _slug + "/face_%s.svg" % face)
		_face.modulate.a = 0.0
		var tw := create_tween()
		tw.set_parallel()
		tw.tween_property(_face, "modulate:a", 1.0, 0.14)
		tw.tween_property(_face_old, "modulate:a", 0.0, 0.14)
	# piccolo "settle" a ogni battuta
	var settle := create_tween()
	position.y += 5.0
	settle.tween_property(self, "position:y", position.y - 5.0, 0.18) \
			.set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)

## Modalità pittorica: un'immagine intera per emozione, crossfade al cambio.
func _set_full(face: String) -> void:
	var path := GEN_DIR + _slug + "/full_%s.png" % face
	if not ResourceLoader.exists(path):
		path = GEN_DIR + _slug + "/full_neutro.png"
	if face != _cur_face:
		_cur_face = face
		_face_old.texture = _face.texture
		_face_old.modulate.a = 1.0 if _face.texture else 0.0
		_face.texture = load(path)
		_face.modulate.a = 0.0
		var tw := create_tween()
		tw.set_parallel()
		tw.tween_property(_face, "modulate:a", 1.0, 0.16)
		tw.tween_property(_face_old, "modulate:a", 0.0, 0.16)
	var settle := create_tween()
	position.y += 5.0
	settle.tween_property(self, "position:y", position.y - 5.0, 0.18) \
			.set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)

## Ingresso alla Hades: slide dal bordo destro con settle.
func enter_anim() -> void:
	var target_x := position.x
	position.x = target_x + 140.0
	modulate.a = 0.0
	var tw := create_tween()
	tw.set_parallel()
	tw.tween_property(self, "position:x", target_x, 0.28) \
			.set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	tw.tween_property(self, "modulate:a", 1.0, 0.2)

func _process(delta: float) -> void:
	_t += delta
	# respiro 1-2px + micro-tilt continui: il ritratto non è mai fermo
	scale.y = 1.0 + 0.006 * sin(_t * TAU / 3.4)
	scale.x = 1.0 + 0.003 * sin(_t * TAU / 3.4 + PI)
	rotation = 0.004 * sin(_t * TAU / 7.0)

func _layer() -> TextureRect:
	var tr := TextureRect.new()
	tr.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	tr.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT
	tr.set_anchors_preset(Control.PRESET_FULL_RECT)
	tr.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(tr)
	return tr
