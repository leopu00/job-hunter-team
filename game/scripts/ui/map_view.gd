class_name MapView
extends Control
## La mappa delle offerte con i pin, migrata dalla vista map della
## dashboard web: carta geografica vera (countries.geojson, lo stesso
## dataset del globo MapLibre del web) proiettata equirettangolare,
## pin per città/coordinate con score colorato. Usata dalla sezione
## Mappa della sidebar e dal click sul mappamondo.

const GEOJSON_PATH := "res://assets/data/countries.geojson"

## Bounding box Europa: lon -12..32, lat 34..62 (equirettangolare).
const LON_MIN := -12.0
const LON_MAX := 32.0
const LAT_MIN := 34.0
const LAT_MAX := 62.0

## Poligoni dei paesi già proiettati in coordinate normalizzate 0..1
## (statici: il geojson si parsa UNA volta per sessione, non per vista).
static var _land: Array = []

## Coordinate delle città: servono sia al mock sia come FALLBACK per i
## dati veri — il geocode del team è on-demand e quasi nessuna posizione
## ha office_lat/lon, ma loc_city c'è sempre. Nomi IT/EN come arrivano
## dal DB (lookup case-insensitive in _city_coord).
const CITY_COORDS := {
	"Amburgo": Vector2(9.99, 53.55), "Hamburg": Vector2(9.99, 53.55),
	"Milano": Vector2(9.19, 45.46), "Milan": Vector2(9.19, 45.46),
	"Berlino": Vector2(13.40, 52.52), "Berlin": Vector2(13.40, 52.52),
	"Amsterdam": Vector2(4.90, 52.37),
	"Londra": Vector2(-0.13, 51.51), "London": Vector2(-0.13, 51.51),
	"Parigi": Vector2(2.35, 48.86), "Paris": Vector2(2.35, 48.86),
	"Madrid": Vector2(-3.70, 40.42),
	"Roma": Vector2(12.50, 41.90), "Rome": Vector2(12.50, 41.90),
	"Vienna": Vector2(16.37, 48.21), "Wien": Vector2(16.37, 48.21),
	"Zurigo": Vector2(8.54, 47.38), "Zurich": Vector2(8.54, 47.38),
	"Firenze": Vector2(11.26, 43.77), "Florence": Vector2(11.26, 43.77),
	"Torino": Vector2(7.69, 45.07), "Turin": Vector2(7.69, 45.07),
	"Bologna": Vector2(11.34, 44.49),
	"Lisbona": Vector2(-9.14, 38.72), "Lisbon": Vector2(-9.14, 38.72),
	"Porto": Vector2(-8.61, 41.15),
	"Budapest": Vector2(19.04, 47.50),
	"Praga": Vector2(14.42, 50.09), "Prague": Vector2(14.42, 50.09),
	"Varsavia": Vector2(21.01, 52.23), "Warsaw": Vector2(21.01, 52.23),
	"Cracovia": Vector2(19.94, 50.06), "Krakow": Vector2(19.94, 50.06),
	"Copenaghen": Vector2(12.57, 55.68), "Copenhagen": Vector2(12.57, 55.68),
	"Stoccolma": Vector2(18.07, 59.33), "Stockholm": Vector2(18.07, 59.33),
	"Oslo": Vector2(10.75, 59.91),
	"Helsinki": Vector2(24.94, 60.17),
	"Tallinn": Vector2(24.75, 59.44),
	"Riga": Vector2(24.11, 56.95),
	"Vilnius": Vector2(25.28, 54.69),
	"Dublino": Vector2(-6.26, 53.35), "Dublin": Vector2(-6.26, 53.35),
	"Bucarest": Vector2(26.10, 44.43), "Bucharest": Vector2(26.10, 44.43),
	"Barcellona": Vector2(2.17, 41.39), "Barcelona": Vector2(2.17, 41.39),
	"Valencia": Vector2(-0.38, 39.47),
	"Monaco di Baviera": Vector2(11.58, 48.14), "Munich": Vector2(11.58, 48.14),
	"Francoforte": Vector2(8.68, 50.11), "Frankfurt": Vector2(8.68, 50.11),
	"Colonia": Vector2(6.96, 50.94), "Cologne": Vector2(6.96, 50.94),
	"Stoccarda": Vector2(9.18, 48.78), "Stuttgart": Vector2(9.18, 48.78),
	"Dusseldorf": Vector2(6.78, 51.23), "Düsseldorf": Vector2(6.78, 51.23),
	"Lipsia": Vector2(12.37, 51.34), "Leipzig": Vector2(12.37, 51.34),
	"Ginevra": Vector2(6.14, 46.20), "Geneva": Vector2(6.14, 46.20),
	"Basilea": Vector2(7.59, 47.56), "Basel": Vector2(7.59, 47.56),
	"Bruxelles": Vector2(4.35, 50.85), "Brussels": Vector2(4.35, 50.85),
	"Anversa": Vector2(4.40, 51.22), "Antwerp": Vector2(4.40, 51.22),
	"Rotterdam": Vector2(4.48, 51.92),
	"Eindhoven": Vector2(5.47, 51.44),
	"Lussemburgo": Vector2(6.13, 49.61), "Luxembourg": Vector2(6.13, 49.61),
	"Atene": Vector2(23.73, 37.98), "Athens": Vector2(23.73, 37.98),
	"Lubiana": Vector2(14.51, 46.06), "Ljubljana": Vector2(14.51, 46.06),
	"Zagabria": Vector2(15.98, 45.81), "Zagreb": Vector2(15.98, 45.81),
	"Bratislava": Vector2(17.11, 48.15),
}

var _pins: Array = []  # [{pos_norm: Vector2, label: String, score: int}]
## Posizioni SENZA coordinate (né geocode né città nota): per decisione
## di Leone (gate 1, 11/07) niente geocode dall'app e niente pin
## forzati — si mostrano comunque, in una lista sotto la mappa.
var _no_coords: Array = []  # righe di testo già formattate
const NO_COORDS_MAX := 6

func _ready() -> void:
	custom_minimum_size = Vector2(0, 480)
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	size_flags_vertical = Control.SIZE_EXPAND_FILL
	clip_contents = true  # i poligoni fuori vista non sbordano dal pannello
	_load_land()
	_rebuild_pins()
	BackendBus.positions_updated.connect(func(_l: Array) -> void: _rebuild_pins())
	resized.connect(queue_redraw)

## countries.geojson → array di ring normalizzati 0..1 nella vista.
## Tiene solo i ring che intersecano il box (il resto del mondo è fuori).
static func _load_land() -> void:
	if not _land.is_empty():
		return
	var f := FileAccess.open(GEOJSON_PATH, FileAccess.READ)
	if f == null:
		return
	var geo: Variant = JSON.parse_string(f.get_as_text())
	if geo == null:
		return
	var view := Rect2(LON_MIN, LAT_MIN, LON_MAX - LON_MIN, LAT_MAX - LAT_MIN)
	for feat in geo.get("features", []):
		var geom: Dictionary = feat.get("geometry", {})
		var polys: Array = []
		match geom.get("type", ""):
			"Polygon":
				polys = [geom.get("coordinates", [])]
			"MultiPolygon":
				polys = geom.get("coordinates", [])
		for poly in polys:
			if poly.is_empty():
				continue
			var ring: Array = poly[0]  # solo il ring esterno: è una silhouette
			var pts := PackedVector2Array()
			var bounds := Rect2()
			for i in ring.size():
				var lon := float(ring[i][0])
				var lat := float(ring[i][1])
				var pt := Vector2(lon, lat)
				bounds = Rect2(pt, Vector2.ZERO) if i == 0 else bounds.expand(pt)
				pts.append(Vector2(
						(lon - LON_MIN) / (LON_MAX - LON_MIN),
						1.0 - (lat - LAT_MIN) / (LAT_MAX - LAT_MIN)))
			if bounds.intersects(view) and pts.size() >= 3:
				# le coastline sono concave: draw_colored_polygon (fan)
				# le romperebbe — triangolazione precomputata una volta
				var idx := Geometry2D.triangulate_polygon(pts)
				_land.append({"pts": pts, "idx": idx})

## LIVE e DEMO usano la sorgente corrispondente; UNAVAILABLE resta vuoto.
func _rebuild_pins() -> void:
	_pins.clear()
	_no_coords.clear()
	var data_state := SimBadge.current_state()
	var visible_positions := SimBadge.visible_positions()
	if not visible_positions.is_empty():
		var clusters := {}  # città → {coord, count, best_score}
		for p in visible_positions:
			var coord := Vector2.INF
			if p.get("office_lat") != null and p.get("office_lon") != null:
				coord = Vector2(float(p["office_lon"]), float(p["office_lat"]))
			else:
				coord = _city_coord(str(p.get("loc_city", "") if p.get("loc_city") else ""))
			if coord == Vector2.INF or coord.x < LON_MIN or coord.x > LON_MAX \
					or coord.y < LAT_MIN or coord.y > LAT_MAX:
				var where := str(p.get("loc_city", "") if p.get("loc_city") else "")
				if where == "":
					where = str(p.get("loc_country", "") if p.get("loc_country") else "?")
				_no_coords.append("%s — %s · %s" % [str(p.get("title", "?")).left(48),
						str(p.get("company", "?")), where])
				continue
			var city := str(p.get("loc_city", "?"))
			if not clusters.has(city):
				clusters[city] = {"coord": coord, "count": 0, "best": 0}
			clusters[city]["count"] += 1
			var sc := int(p.get("total_score") if p.get("total_score") != null else 0)
			clusters[city]["best"] = maxi(clusters[city]["best"], sc)
		for city in clusters:
			var c: Dictionary = clusters[city]
			_pins.append({
				"pos_norm": Vector2(
					(c["coord"].x - LON_MIN) / (LON_MAX - LON_MIN),
					1.0 - (c["coord"].y - LAT_MIN) / (LAT_MAX - LAT_MIN)),
				"label": "%s (%d)" % [city, c["count"]] if c["count"] > 1 else city,
				"score": int(c["best"]),
			})
	elif data_state == SimBadge.DataState.DEMO:
		for p in TeamData.positions_today():
			var city: String = str(p.get("location", "")).split(" · ")[0]
			var c := _city_coord(city)
			if c == Vector2.INF:
				Log.debug("ui", "mappa: città senza coordinate: " + city)
				continue
			_pins.append({
				"pos_norm": Vector2(
					(c.x - LON_MIN) / (LON_MAX - LON_MIN),
					1.0 - (c.y - LAT_MIN) / (LAT_MAX - LAT_MIN)),
				"label": "%s — %s" % [p.get("company", "?"), city],
				"score": int(p.get("score", 0)),
			})
	queue_redraw()

static func _city_coord(city: String) -> Vector2:
	if city == "":
		return Vector2.INF
	for known: String in CITY_COORDS:
		if known.nocasecmp_to(city) == 0:
			return CITY_COORDS[known]
	return Vector2.INF

func _draw() -> void:
	var r := Rect2(Vector2.ZERO, size)
	draw_rect(r, Palette.DEEP)
	draw_rect(r, Palette.BORDER_GLOW, false, 1.0)
	# griglia di meridiani/paralleli, jitter zero: è uno strumento
	var step := 60.0
	var x := step
	while x < r.size.x:
		draw_line(Vector2(x, 0), Vector2(x, r.size.y), Color(Palette.BORDER.r, Palette.BORDER.g, Palette.BORDER.b, 0.32), 1.0)
		x += step
	var y := step
	while y < r.size.y:
		draw_line(Vector2(0, y), Vector2(r.size.x, y), Color(Palette.BORDER.r, Palette.BORDER.g, Palette.BORDER.b, 0.32), 1.0)
		y += step
	# la terra sotto i pin: silhouette dei paesi dal geojson del web
	var fill := PackedColorArray([Palette.ROW])
	for land: Dictionary in _land:
		var ring: PackedVector2Array = land["pts"]
		var scaled := PackedVector2Array()
		scaled.resize(ring.size())
		for i in ring.size():
			scaled[i] = ring[i] * r.size
		var idx: PackedInt32Array = land["idx"]
		if not idx.is_empty():
			RenderingServer.canvas_item_add_triangle_array(
					get_canvas_item(), idx, scaled, fill)
		var outline := scaled.duplicate()
		outline.append(scaled[0])
		draw_polyline(outline, Palette.BORDER_GLOW, 1.0)
	# pin: anello + punto + targhetta company/città + score
	var font := TerminalTheme.get_theme().default_font
	for pin in _pins:
		var pos: Vector2 = pin["pos_norm"] * r.size
		var col: Color = Palette.MINT if pin["score"] >= 70 else Palette.YELLOW
		draw_circle(pos, 5.0, col)
		draw_arc(pos, 10.0, 0, TAU, 24, Color(col.r, col.g, col.b, 0.5), 1.5)
		draw_arc(pos, 15.0, 0, TAU, 24, Color(col.r, col.g, col.b, 0.2), 1.0)
		var text := "%s  [%d]" % [pin["label"], pin["score"]]
		draw_string(font, pos + Vector2(20, 5), text,
				HORIZONTAL_ALIGNMENT_LEFT, -1, 15, Palette.BRIGHT)
	if _pins.is_empty():
		draw_string(font, Vector2(24, 40), UIStrings.t("map.none_today"),
				HORIZONTAL_ALIGNMENT_LEFT, -1, 16, Palette.DIM)
	# le posizioni senza coordinate esistono comunque: lista in basso,
	# niente pin inventati (il geocode è del team, non dell'app)
	if not _no_coords.is_empty():
		var shown := mini(_no_coords.size(), NO_COORDS_MAX)
		var y0 := r.size.y - 16.0 - 18.0 * shown - (18.0 if _no_coords.size() > shown else 0.0)
		# in basso a destra (Mediterraneo orientale: quasi solo mare, non
		# copre pin), con un velo dietro: sotto passano coste e griglia
		var x0 := r.size.x - 632.0
		draw_rect(Rect2(x0 - 12, y0 - 26, 632, r.size.y - y0 + 20),
				Color(Palette.PANEL.r, Palette.PANEL.g, Palette.PANEL.b, 0.94))
		draw_string(font, Vector2(x0, y0 - 8), UIStrings.t("map.no_coords") % _no_coords.size(),
				HORIZONTAL_ALIGNMENT_LEFT, -1, 13, Palette.MUTED)
		for i in shown:
			draw_string(font, Vector2(x0, y0 + 12 + 18.0 * i), "· " + str(_no_coords[i]),
					HORIZONTAL_ALIGNMENT_LEFT, -1, 13, Palette.DIM)
		if _no_coords.size() > shown:
			draw_string(font, Vector2(x0, y0 + 12 + 18.0 * shown),
					UIStrings.t("common.more") % (_no_coords.size() - shown),
					HORIZONTAL_ALIGNMENT_LEFT, -1, 13, Palette.DIM)
