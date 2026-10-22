class_name MapPins
## La logica condivisa dei pin della vista Mappa (globo + piatta):
## cluster per città CON la lista delle posizioni dentro (per la scheda
## al click, come la vignette del web), filtri cross come la pagina
## /map della web privata e la scala colore SOLO-VERDE di score-color.ts.

## Le fasce di score dei filtri (id → etichetta), stesse soglie della
## score distribution del web. "none" = senza punteggio.
const SCORE_BANDS := [["85", "85+"], ["70", "70–84"], ["50", "50–69"], ["0", "<50"]]

## Copia di web/lib/score-color.ts: verde smorto → verde vivo.
const SCORE_STOPS := [
	[0.0, Color8(184, 214, 196)],
	[40.0, Color8(143, 202, 168)],
	[70.0, Color8(52, 201, 127)],
	[100.0, Color8(0, 232, 122)],
]

static func score_color(score: Variant) -> Color:
	if score == null:
		return Color8(150, 180, 165)  # verde-grigio neutro
	var s := clampf(float(score), 0.0, 100.0)
	for i in SCORE_STOPS.size() - 1:
		var s0 := float(SCORE_STOPS[i][0])
		var s1 := float(SCORE_STOPS[i + 1][0])
		if s >= s0 and s <= s1:
			return (SCORE_STOPS[i][1] as Color).lerp(
					SCORE_STOPS[i + 1][1] as Color, (s - s0) / (s1 - s0))
	return SCORE_STOPS[SCORE_STOPS.size() - 1][1]

static func score_band(p: Dictionary) -> String:
	var v: Variant = p.get("total_score")
	if v == null:
		return "none"
	var s := float(v)
	if s >= 85.0:
		return "85"
	if s >= 70.0:
		return "70"
	if s >= 50.0:
		return "50"
	return "0"

## Valore di filtro di una posizione per una dimensione.
static func value_of(p: Dictionary, key: String) -> String:
	if key == "score":
		return score_band(p)
	var v := str(p.get(key, "") if p.get(key) != null else "")
	return v if v != "" and v != "<null>" else UIStrings.t("pos.uncategorized")

## true se la posizione passa tutti i gruppi di filtro tranne `skip`
## (skip = "" → tutti; il cross-filter dei conteggi salta il proprio).
static func passes(p: Dictionary, filters: Dictionary, skip := "") -> bool:
	for key in filters:
		if key == skip:
			continue
		var chosen: Dictionary = filters[key]
		if chosen.is_empty():
			continue
		if not chosen.has(value_of(p, key)):
			return false
	return true

static func coord_of(p: Dictionary) -> Vector2:
	if p.get("office_lat") != null and p.get("office_lon") != null:
		return Vector2(float(p["office_lon"]), float(p["office_lat"]))
	return MapView._city_coord(str(p.get("loc_city", "") if p.get("loc_city") else ""))

## I livelli di precisione del luogo (location_precision): lo stesso insieme
## chiuso del CHECK della migrazione 095 e di web/lib/city-coords.ts.
const LEVELS := ["address", "street", "district", "city", "country", "remote"]

## Quante aziende diverse sulla stessa coordinata la rendono generica (il
## geocode del centro di una città, non un ufficio): come
## GENERIC_COORD_MIN_COMPANIES del web.
const GENERIC_COORD_MIN_COMPANIES := 3

## Il livello con cui leggere una riga: quello scritto, se è dell'insieme
## chiuso; altrimenti (assente, o un valore che questa versione non conosce)
## quello che la migrazione dà: coordinate e office_verified=1 → address,
## coordinate senza flag vero → city, nessuna coordinata → "".
static func level_of(p: Dictionary) -> String:
	var level: Variant = p.get("location_precision")
	if level != null and LEVELS.has(str(level)):
		return str(level)
	if p.get("office_lat") == null or p.get("office_lon") == null:
		return ""
	var v: Variant = p.get("office_verified")
	return "address" if v != null and int(v) == 1 else "city"

## true solo quando la coordinata è l'EDIFICIO: il livello `address` (via e
## civico). Una via senza civico, un quartiere, una città, un paese o il
## remoto non lo sono. Snapshot senza livello né flag (showroom, mock, test)
## sono centroidi di città: la colonna assente non è una verifica.
static func is_exact(p: Dictionary) -> bool:
	if p.get("office_lat") == null or p.get("office_lon") == null:
		return false
	return level_of(p) == "address"

static func coord_key(p: Dictionary) -> String:
	return "%.4f|%.4f" % [float(p["office_lat"]), float(p["office_lon"])]

## Le coordinate condivise da GENERIC_COORD_MIN_COMPANIES aziende diverse o
## più: un pin lì non è un ufficio, anche se la riga dice `address`.
static func generic_coords(rows: Array) -> Dictionary:
	var companies := {}
	for p in rows:
		if p.get("office_lat") == null or p.get("office_lon") == null:
			continue
		var key := coord_key(p)
		if not companies.has(key):
			companies[key] = {}
		companies[key][str(p.get("company", "") if p.get("company") else "").strip_edges().to_lower()] = true
	var generic := {}
	for key in companies:
		if (companies[key] as Dictionary).size() >= GENERIC_COORD_MIN_COMPANIES:
			generic[key] = true
	return generic

## Esatta sulla mappa: is_exact e una coordinata non generica.
static func is_exact_among(p: Dictionary, generic: Dictionary) -> bool:
	return is_exact(p) and not generic.has(coord_key(p))

## La chiave del testo accanto all'indirizzo, nella scheda della posizione.
static func office_tag_key(p: Dictionary, generic: Dictionary = {}) -> String:
	if is_exact_among(p, generic):
		return "pos.office_verified"
	match level_of(p):
		"street":
			return "pos.office_street"
		"district":
			return "pos.office_district"
		"country", "remote":
			return "pos.office_rough"
	return "pos.office_approx"

static func _median(xs: Array) -> float:
	var sorted := xs.duplicate()
	sorted.sort()
	var m := sorted.size() >> 1
	return float(sorted[m]) if sorted.size() % 2 == 1 \
			else (float(sorted[m - 1]) + float(sorted[m])) / 2.0

## Cluster per città delle posizioni filtrate. Ogni cluster porta le SUE
## posizioni (la scheda al click naviga da lì): {key, city, lonlat, exact,
## count, best (score max, null se nessuno), positions}. Le posizioni
## senza coordinate finiscono in no_coords (dizionari interi).
##
## Un ufficio verificato NON va nel mucchio della sua città: prende un pin
## per indirizzo (chiave con la coordinata), mentre tutte le posizioni
## approssimate della città restano in UN solo pin sul centro. È l'opposto
## della griglia nord di resolveCityPins sul web, e volutamente: là le righe
## non hanno NESSUNA coordinata e lo slot in griglia è un'etichetta di
## comodo, qui la coordinata esiste ed è vera per un civico, condivisa per
## il centro città — spargere pin attorno al centroide inventerebbe civici
## che il team non ha mai geocodificato.
static func build(filters: Dictionary) -> Dictionary:
	return build_from(SimBadge.visible_positions(), filters)

## Il pin «≈ città» (le posizioni non esatte) sta sulla città, mai sulla
## coordinata di una sua riga: quella può essere una via, un quartiere o un
## ufficio geocodato altrove («Roma» a Dubai). Prima la città del gazetteer
## (MapView.CITY_COORDS), se no la mediana delle coordinate del gruppo, come il
## centro città del web. Le coordinate generiche contano su TUTTE le righe,
## prima dei filtri: un filtro non rende esatto un geocode di città.
static func build_from(rows: Array, filters: Dictionary) -> Dictionary:
	var clusters := {}
	var no_coords: Array = []
	var generic := generic_coords(rows)
	for p in rows:
		if not passes(p, filters):
			continue
		var coord := coord_of(p)
		if coord == Vector2.INF:
			no_coords.append(p)
			continue
		var city := str(p.get("loc_city", "?") if p.get("loc_city") else "?")
		var country := str(p.get("loc_country", "")
				if p.get("loc_country") else UIStrings.t("pos.uncategorized"))
		var exact := is_exact_among(p, generic)
		var key := "%s|%s" % [city, country]
		if exact:
			key += "|%.5f,%.5f" % [coord.x, coord.y]
		if not clusters.has(key):
			clusters[key] = {"key": key, "city": city, "country": country,
					"lonlat": coord, "exact": exact,
					"count": 0, "best": null, "positions": [], "_coords": []}
		var c: Dictionary = clusters[key]
		c["count"] += 1
		c["positions"].append(p)
		c["_coords"].append(coord)
		if p.get("total_score") != null:
			var sc := float(p["total_score"])
			if c["best"] == null or sc > float(c["best"]):
				c["best"] = sc
	for key in clusters:
		var c: Dictionary = clusters[key]
		var coords: Array = c["_coords"]
		c.erase("_coords")
		if not bool(c["exact"]):
			var known := MapView._city_coord(str(c["city"]))
			if known != Vector2.INF:
				c["lonlat"] = known
			else:
				c["lonlat"] = Vector2(_median(coords.map(func(v: Vector2) -> float: return v.x)),
						_median(coords.map(func(v: Vector2) -> float: return v.y)))
		# dentro ogni città: prima gli score alti (l'ordine della scheda)
		(c["positions"] as Array).sort_custom(
				func(a: Dictionary, b: Dictionary) -> bool:
					return _score_of(a) > _score_of(b))
	return {"clusters": clusters.values(), "no_coords": no_coords}

static func _score_of(p: Dictionary) -> float:
	return float(p["total_score"]) if p.get("total_score") != null else -1.0
