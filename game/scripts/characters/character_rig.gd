class_name CharacterRig
extends Node2D
## Rig a layer per gli sprite in-world: gambe (swing), torso, testa (+ hair
## e giacca tintabili per il giocatore). Origine ai piedi. Le texture SVG
## sono importate a 2×: il rig lavora in pixel-texture e scala 0.5.

const ART_SCALE := 2.0     # svg/scale dell'import
# 0.5 = dimensione artistica 64×96; alzato a 0.7 per stare in proporzione
# con gli agenti a spritesheet (RIG_SCALE 0.85 su figure da 160px).
const RIG_SCALE := 0.7

## Animazione: "idle" respiro · "walk" camminata · "work" digitazione
var mode := "idle"
var facing := "down"       # down / up / side
var flipped := false

var _tex: Dictionary
var _has_legs := true
var _t := 0.0
var _phase_offset := 0.0

var _leg_l: Sprite2D
var _leg_r: Sprite2D
var _torso: Sprite2D
var _jacket: Sprite2D
var _head: Sprite2D
var _hair: Sprite2D

func setup(textures: Dictionary) -> void:
	_tex = textures
	_has_legs = textures.has("leg_front")
	_phase_offset = randf() * TAU
	scale = Vector2(RIG_SCALE, RIG_SCALE)

	if _has_legs:
		_leg_l = _make_sprite(Vector2(-6, -37), Vector2(-8, -1))
		_leg_r = _make_sprite(Vector2(6, -37), Vector2(-8, -1))
	_torso = _make_sprite(Vector2.ZERO, Vector2(-32, -94))
	if _tex.has("jacket_front"):
		_jacket = _make_sprite(Vector2.ZERO, Vector2(-32, -94))
		_jacket.modulate = _tex["jacket_tint"]
	_head = _make_sprite(Vector2.ZERO, Vector2(-32, -94))
	if _tex.has("hair_front"):
		_hair = _make_sprite(Vector2.ZERO, Vector2(-32, -94))
		_hair.modulate = _tex["hair_tint"]
	_apply_facing()

func set_motion(p_facing: String, p_flipped: bool, p_mode: String) -> void:
	if p_facing == facing and p_flipped == flipped and p_mode == mode:
		return
	facing = p_facing
	flipped = p_flipped
	mode = p_mode
	_apply_facing()

## Limite superiore opaco del rig legacy, nello spazio dell'AgentNPC. Anche
## qui si misura l'arte invece di assumere che tutti gli SVG abbiano gli
## stessi margini interni.
## Cache per facing: le texture cambiano solo con _apply_facing e
## get_image() è un readback GPU→CPU da non ripetere mai a regime.
var _top_cache := {}

func visual_top_y() -> float:
	var cache_key := facing + ("_f" if flipped else "")
	if _top_cache.has(cache_key):
		return _top_cache[cache_key]
	var result := _measure_top_y()
	_top_cache[cache_key] = result
	return result

func _measure_top_y() -> float:
	var top := INF
	for child in get_children():
		var sprite := child as Sprite2D
		if sprite == null or sprite.texture == null or not sprite.visible:
			continue
		var image := sprite.texture.get_image()
		if image == null or image.is_empty():
			continue
		var used := image.get_used_rect()
		if used.size == Vector2i.ZERO:
			continue
		var local_top := sprite.position.y + sprite.offset.y + float(used.position.y)
		top = minf(top, local_top * absf(scale.y))
	return top if is_finite(top) else -112.0

func _make_sprite(pos_art: Vector2, offset_art: Vector2) -> Sprite2D:
	var s := Sprite2D.new()
	s.centered = false
	s.position = pos_art * ART_SCALE
	s.offset = offset_art * ART_SCALE
	add_child(s)
	return s

func _apply_facing() -> void:
	var suffix := "side"
	if facing == "up":
		suffix = "back"
	elif facing == "down":
		suffix = "front"
	# lato: texture *_side; retro: testa *_back ma torso frontale (simmetrico)
	var torso_key := "torso_side" if facing == "side" else "torso_front"
	var head_key := "head_" + suffix
	var leg_key := "leg_side" if facing == "side" else "leg_front"
	_torso.texture = _tex[torso_key]
	_head.texture = _tex[head_key]
	if _jacket:
		_jacket.texture = _tex["jacket_side" if facing == "side" else "jacket_front"]
	if _hair:
		_hair.texture = _tex["hair_" + suffix]
	if _has_legs:
		_leg_l.texture = _tex[leg_key]
		_leg_r.texture = _tex[leg_key]
		# di lato le gambe si avvicinano all'asse e sforbiciano
		_leg_l.position.x = (-1.5 if facing == "side" else -6.0) * ART_SCALE
		_leg_r.position.x = (1.5 if facing == "side" else 6.0) * ART_SCALE
	scale.x = -RIG_SCALE if (facing == "side" and flipped) else RIG_SCALE

## Ombra a terra come SpriteSheetRig: stessa àncora visiva per i due rig.
func _draw() -> void:
	draw_set_transform(Vector2.ZERO, 0.0, Vector2(1.0, 0.38))
	for i in 3:
		draw_circle(Vector2.ZERO, 26.0 + i * 7.0, Color(0, 0, 0, 0.10 - i * 0.03))
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)

func _process(delta: float) -> void:
	_t += delta
	var ph := _t * TAU + _phase_offset
	var bob := 0.0
	match mode:
		"walk":
			var swing := sin(_t * 11.0)
			if _has_legs:
				_leg_l.rotation = swing * 0.55
				_leg_r.rotation = -swing * 0.55
			else:
				rotation = swing * 0.035  # la tunica ondeggia
			bob = -absf(swing) * 2.0 * ART_SCALE
		"work":
			if _has_legs:
				_leg_l.rotation = 0.0
				_leg_r.rotation = 0.0
			rotation = 0.0
			# digitazione: micro-bob veloce del busto
			bob = sin(_t * 16.0) * 0.7 * ART_SCALE
		"still":
			if _has_legs:
				_leg_l.rotation = 0.0
				_leg_r.rotation = 0.0
			rotation = 0.0
			bob = 0.0
		_:
			if _has_legs:
				_leg_l.rotation = 0.0
				_leg_r.rotation = 0.0
			rotation = 0.0
			bob = sin(ph * 0.35) * 0.8 * ART_SCALE  # respiro lento
	for s in [_torso, _jacket, _head, _hair]:
		if s:
			s.position.y = bob
	# la testa segue con un filo di ritardo (vita)
	if _head:
		_head.position.y = bob * 0.7
	if _hair:
		_hair.position.y = bob * 0.7
