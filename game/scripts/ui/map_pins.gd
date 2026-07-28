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

## true solo quando la coordinata è l'EDIFICIO: office-geocoding scrive
## office_verified=1 quando ha via e civico, e 0 quando ha ripiegato sul
## centro città (con office_address = "<città>, <paese>"). Snapshot senza
## la colonna — showroom, mock, test — sono centroidi di città anche loro:
## la colonna assente non è una verifica, quindi resta approssimata.
static func is_exact(p: Dictionary) -> bool:
	if p.get("office_lat") == null or p.get("office_lon") == null:
		return false
	var v: Variant = p.get("office_verified")
	return v != null and int(v) == 1

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
	var clusters := {}
	var no_coords: Array = []
	for p in BackendBus.positions:
		if not passes(p, filters):
			continue
		var coord := coord_of(p)
		if coord == Vector2.INF:
			no_coords.append(p)
			continue
		var city := str(p.get("loc_city", "?") if p.get("loc_city") else "?")
		var country := str(p.get("loc_country", "")
				if p.get("loc_country") else UIStrings.t("pos.uncategorized"))
		var exact := is_exact(p)
		var key := "%s|%s" % [city, country]
		if exact:
			key += "|%.5f,%.5f" % [coord.x, coord.y]
		if not clusters.has(key):
			clusters[key] = {"key": key, "city": city, "country": country,
					"lonlat": coord, "exact": exact,
					"count": 0, "best": null, "positions": []}
		var c: Dictionary = clusters[key]
		c["count"] += 1
		c["positions"].append(p)
		if p.get("total_score") != null:
			var sc := float(p["total_score"])
			if c["best"] == null or sc > float(c["best"]):
				c["best"] = sc
	# dentro ogni città: prima gli score alti (l'ordine della scheda)
	for key in clusters:
		(clusters[key]["positions"] as Array).sort_custom(
				func(a: Dictionary, b: Dictionary) -> bool:
					return _score_of(a) > _score_of(b))
	return {"clusters": clusters.values(), "no_coords": no_coords}

static func _score_of(p: Dictionary) -> float:
	return float(p["total_score"]) if p.get("total_score") != null else -1.0
