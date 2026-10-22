extends SceneTree
## Il pin della mappa e il livello di precisione del luogo (location_precision).
## Esecuzione: godot --headless --path game --script res://tools/location_precision_selftest.gd
##
## Solo `address` (via e civico) e' l'edificio: un pin all'indirizzo. Una via
## senza civico, un quartiere, una citta', un paese o il remoto NON lo sono,
## anche con le coordinate. Una riga senza livello (o con un livello che questa
## versione non conosce) vale il flag di prima, office_verified, che la
## migrazione rende vero solo per `address`. Senza coordinate nessun pin.
## Poi la mappa (MapPins.build_from): il pin «≈ citta'» sta sulla citta', mai
## sulla coordinata di una sua riga; una coordinata condivisa da tre aziende o
## piu' non e' un ufficio; e la scheda dice il livello vero.

const COORDS := {"office_lat": 41.9028, "office_lon": 12.4964}

var _failed: Array = []

func _row(extra: Dictionary) -> Dictionary:
	var row := {"id": 1, "loc_city": "Roma", "loc_country": "Italy", "company": "Acme"}
	row.merge(extra, true)
	return row

func _check(what: String, ok: bool, got: Variant = null) -> void:
	if not ok:
		_failed.append("%s (%s)" % [what, str(got)])

# MapPins dipende da MapView e SimBadge, che usano l'autoload BackendBus: un
# riferimento statico compilerebbe la catena prima degli autoload. Si carica al
# primo frame, come promo_sign_layer_selftest.
func _init() -> void:
	process_frame.connect(_run, CONNECT_ONE_SHOT)

func _run() -> void:
	var pins: GDScript = load("res://scripts/ui/map_pins.gd")
	var map_view: GDScript = load("res://scripts/ui/map_view.gd")
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
		# un livello fuori dall'insieme chiuso vale come non classificato (G4, come il web)
		["livello sconosciuto, office_verified=1",
				_row(COORDS.merged({"location_precision": "building", "office_verified": 1})), true],
		["livello vuoto, office_verified=1",
				_row(COORDS.merged({"location_precision": "", "office_verified": 1})), true],
		["livello sconosciuto, office_verified=0",
				_row(COORDS.merged({"location_precision": "building", "office_verified": 0})), false],
	]
	for c in cases:
		var got: bool = pins.is_exact(c[1])
		_check("is_exact " + str(c[0]), got == bool(c[2]), got)

	# G2: il pin «≈ citta'» sta sulla citta' del gazetteer, non sulla prima riga
	# (qui un ufficio di «Roma» geocodato a Dubai, la riga piu' recente)
	var rome: Array = [
		_row({"id": 11, "office_lat": 25.2048, "office_lon": 55.2708, "location_precision": "city"}),
		_row({"id": 12, "office_lat": 41.8902, "office_lon": 12.4922, "location_precision": "street"}),
		_row({"id": 13, "location_precision": "city"}),
	]
	var built: Dictionary = pins.build_from(rome, {})
	var clusters: Array = built["clusters"]
	_check("Roma: un solo pin «≈»", clusters.size() == 1 and not bool(clusters[0]["exact"]), clusters.size())
	if clusters.size() == 1:
		_check("Roma: il pin sta sulla citta' del gazetteer",
				(clusters[0]["lonlat"] as Vector2).is_equal_approx(map_view._city_coord("Roma")), clusters[0]["lonlat"])
		_check("Roma: tre posizioni nel pin", int(clusters[0]["count"]) == 3, clusters[0]["count"])
	# una citta' fuori dal gazetteer: la mediana, che un outlier non sposta
	var town: Array = [
		_row({"id": 21, "loc_city": "Pomezia", "office_lat": 25.2, "office_lon": 55.3, "location_precision": "city"}),
		_row({"id": 22, "loc_city": "Pomezia", "office_lat": 41.67, "office_lon": 12.50, "location_precision": "city"}),
		_row({"id": 23, "loc_city": "Pomezia", "office_lat": 41.68, "office_lon": 12.51, "location_precision": "district"}),
	]
	built = pins.build_from(town, {})
	clusters = built["clusters"]
	_check("Pomezia: un solo pin", clusters.size() == 1, clusters.size())
	if clusters.size() == 1:
		_check("Pomezia: la mediana delle coordinate",
				(clusters[0]["lonlat"] as Vector2).is_equal_approx(Vector2(12.51, 41.67)), clusters[0]["lonlat"])
	# un indirizzo esatto resta alla sua coordinata
	built = pins.build_from([_row(COORDS.merged({"location_precision": "address"}))], {})
	clusters = built["clusters"]
	_check("address: pin alla sua coordinata", clusters.size() == 1 and bool(clusters[0]["exact"])
			and (clusters[0]["lonlat"] as Vector2).is_equal_approx(Vector2(12.4964, 41.9028)), clusters)

	# G3: la stessa coordinata per tre aziende diverse e' il geocode della citta'
	var shared := []
	for i in 3:
		shared.append(_row(COORDS.merged({"id": 30 + i, "company": "Company %d" % i,
				"location_precision": "address"})))
	built = pins.build_from(shared, {})
	clusters = built["clusters"]
	_check("tre aziende sulla stessa coordinata: un pin «≈», nessuno esatto",
			clusters.size() == 1 and not bool(clusters[0]["exact"]), clusters.size())
	# anche quando un filtro ne lascia passare una sola
	built = pins.build_from(shared, {"company": {"Company 0": true}})
	clusters = built["clusters"]
	_check("filtro su un'azienda: resta non esatta", clusters.size() == 1 and not bool(clusters[0]["exact"]),
			clusters.size())
	# due aziende, o tre posizioni della stessa azienda: un ufficio vero (lo
	# stesso edificio, quindi un pin esatto con le sue posizioni)
	built = pins.build_from(shared.slice(0, 2), {})
	clusters = built["clusters"]
	_check("due aziende: un pin esatto con due posizioni",
			clusters.size() == 1 and bool(clusters[0]["exact"]) and int(clusters[0]["count"]) == 2, clusters.size())
	var same_company := []
	for i in 3:
		same_company.append(_row(COORDS.merged({"id": 40 + i, "location_precision": "address"})))
	built = pins.build_from(same_company, {})
	clusters = built["clusters"]
	_check("tre posizioni della stessa azienda: un pin esatto",
			clusters.size() == 1 and bool(clusters[0]["exact"]) and int(clusters[0]["count"]) == 3, clusters.size())

	# G5: il testo accanto all'indirizzo dice il livello
	var tags := {
		"address": "pos.office_verified", "street": "pos.office_street",
		"district": "pos.office_district", "city": "pos.office_approx",
		"country": "pos.office_rough", "remote": "pos.office_rough",
	}
	for level in tags:
		var key: String = pins.office_tag_key(_row(COORDS.merged({"location_precision": level})))
		_check("etichetta di " + level, key == tags[level], key)
	var generic: Dictionary = pins.generic_coords(shared)
	var shared_key: String = pins.office_tag_key(shared[0], generic)
	_check("etichetta di un indirizzo su una coordinata generica", shared_key == "pos.office_approx", shared_key)
	for key in tags.values():
		_check("chiave nel dizionario: " + key, UIStrings.t(key) != key, UIStrings.t(key))

	var ok := _failed.is_empty()
	print("LOCATION-PRECISION-TEST ", "PASS" if ok else "FAIL " + JSON.stringify(_failed))
	quit(0 if ok else 1)
