class_name WorldMap
extends Control
## La vista Mappa completa, con l'esperienza del web privato: si parte
## dal GLOBO (JobsGlobe, projection globe) e avvicinandosi si atterra
## sulla mappa piatta a tiles; allontanandosi dal piatto si torna al
## globo. JHT_MAP_FLAT=1 / JHT_MAP_ZOOM=<z> aprono direttamente piatto
## (per gli shot).

var _globe: MapGlobe
var _flat: OsmMap

func _ready() -> void:
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	size_flags_vertical = Control.SIZE_EXPAND_FILL
	_globe = MapGlobe.new()
	_globe.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(_globe)
	_flat = OsmMap.new()
	_flat.set_anchors_preset(Control.PRESET_FULL_RECT)
	_flat.visible = false
	add_child(_flat)
	_globe.dive_in.connect(func(lonlat: Vector2) -> void:
		_flat.fly_to(lonlat, 4.5)
		_flat.visible = true
		_globe.visible = false)
	_flat.zoomed_out.connect(func() -> void:
		_globe.visible = true
		_flat.visible = false)
	if OS.get_environment("JHT_MAP_FLAT") == "1" \
			or OS.get_environment("JHT_MAP_ZOOM") != "":
		_globe.visible = false
		_flat.visible = true
