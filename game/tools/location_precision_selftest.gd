extends SceneTree
## Il pin della mappa e il livello di precisione del luogo (location_precision).
## Esecuzione: godot --headless --path game --script res://tools/location_precision_selftest.gd
##
## Solo `address` (via e civico) e' l'edificio: un pin all'indirizzo. Una via
## senza civico, un quartiere, una citta', un paese o il remoto NON lo sono,
## anche con le coordinate. Una riga senza livello vale il flag di prima,
## office_verified, che la migrazione rende vero solo per `address`. Senza
## coordinate nessun livello fa un pin.

const COORDS := {"office_lat": 41.9028, "office_lon": 12.4964}

func _row(extra: Dictionary) -> Dictionary:
	var row := {"id": 1, "loc_city": "Roma", "loc_country": "Italy"}
	row.merge(extra, true)
	return row

# MapPins dipende da MapView e SimBadge, che usano l'autoload BackendBus: un
# riferimento statico compilerebbe la catena prima degli autoload. Si carica al
# primo frame, come promo_sign_layer_selftest.
func _init() -> void:
	process_frame.connect(_run, CONNECT_ONE_SHOT)

func _run() -> void:
	var pins: GDScript = load("res://scripts/ui/map_pins.gd")
	var cases: Array = [
		# [descrizione, riga, atteso]
		["address con coordinate", _row(COORDS.merged({"location_precision": "address"})), true],
		["street con coordinate", _row(COORDS.merged({"location_precision": "street"})), false],
		["district con coordinate", _row(COORDS.merged({"location_precision": "district"})), false],
		["city con coordinate", _row(COORDS.merged({"location_precision": "city"})), false],
		["country con coordinate", _row(COORDS.merged({"location_precision": "country"})), false],
		["remote con coordinate", _row(COORDS.merged({"location_precision": "remote"})), false],
		# il livello decide anche contro un flag rimasto vero
		["street con office_verified=1",
				_row(COORDS.merged({"location_precision": "street", "office_verified": 1})), false],
		["address senza coordinate", _row({"location_precision": "address"}), false],
		["address con una sola coordinata",
				_row({"office_lat": 41.9, "location_precision": "address"}), false],
		# senza livello: il flag di prima
		["senza livello, office_verified=1", _row(COORDS.merged({"office_verified": 1})), true],
		["senza livello, office_verified=0", _row(COORDS.merged({"office_verified": 0})), false],
		["senza livello ne' flag (snapshot vecchio)", _row(COORDS), false],
		["livello null, office_verified=1",
				_row(COORDS.merged({"location_precision": null, "office_verified": 1})), true],
	]
	var failed: Array = []
	for c in cases:
		var got: bool = pins.is_exact(c[1])
		if got != bool(c[2]):
			failed.append("%s: %s invece di %s" % [c[0], got, c[2]])
	var ok := failed.is_empty()
	print("LOCATION-PRECISION-TEST ", "PASS" if ok else "FAIL " + JSON.stringify(failed))
	quit(0 if ok else 1)
