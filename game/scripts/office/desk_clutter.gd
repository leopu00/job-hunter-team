class_name DeskClutter
extends Node2D
## Micro-prop sul piano delle scrivanie ("fate elementi grafici SOPRA
## altri elementi grafici", ciclo grafica 11/07): tazza, post-it,
## cancelleria, cornice foto, lampada. Scelta e posa DETERMINISTICHE
## per postazione (seed da reparto+indice): gli screenshot restano
## confrontabili tra run e nessun mobile "cambia arredo" al riavvio.
## Ogni prop che ancora non esiste in gen-art viene semplicemente
## saltato: il piano si riempie da solo a ogni consegna di dev-art.

const DIR := "res://assets/gen-art/furniture/"
const PROPS := [
	{"kind": "mp_mug", "w": 24.0},
	{"kind": "mp_postits", "w": 28.0},
	{"kind": "mp_stationery", "w": 32.0},
	{"kind": "mp_photo_frame", "w": 22.0},
	{"kind": "nc_desk_lamp", "w": 36.0},  # di dev-art, dedup in chat
]
## Slot sul piano (frazioni della size del desk), scelti lontani
## dall'angolo della PaperPile (+0.26) e dal centro (monitor).
const SLOTS := [Vector2(-0.30, 0.12), Vector2(-0.06, -0.24), Vector2(0.33, -0.20)]

func _init(desk_rect: Rect2, seed_text: String) -> void:
	position = desk_rect.get_center()
	z_index = 1  # i prop stanno SUL piano, sopra la texture del mobile
	var rng := RandomNumberGenerator.new()
	rng.seed = hash(seed_text)
	var avail: Array = []
	for p in PROPS:
		if ResourceLoader.exists(DIR + p["kind"] + ".png"):
			avail.append(p)
	if avail.is_empty():
		return
	var n := rng.randi_range(1, mini(3, avail.size()))
	var slots := SLOTS.duplicate()
	for i in n:
		var p: Dictionary = avail.pop_at(rng.randi() % avail.size())
		var slot: Vector2 = slots.pop_at(rng.randi() % slots.size())
		var tex: Texture2D = load(DIR + p["kind"] + ".png")
		var spr := Sprite2D.new()
		spr.texture = tex
		spr.position = Vector2(desk_rect.size.x * slot.x, desk_rect.size.y * slot.y)
		spr.scale = Vector2.ONE * (p["w"] / tex.get_width())
		add_child(spr)
