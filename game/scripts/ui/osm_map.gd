class_name OsmMap
extends Control
## La mappa VERA (feedback Leone 21:2x: "usate una mappa integrata,
## non un disegno"): tiles OpenStreetMap in proiezione Web Mercator,
## pan col drag, zoom con rotella/pinch ancorato al mouse, click su un
## pin di città → zoom lì. Le tile arrivano via HTTPS con User-Agent
## identificativo (policy OSM) e restano in cache su disco (user://)
## e in memoria: offline si vede ciò che è già stato visitato.

const TILE := 256
const TILE_URL := "https://tile.openstreetmap.org/%d/%d/%d.png"
const USER_AGENT := "User-Agent: JHT-desktop-prototype/0.1 (+https://github.com/leopu00/job-hunter-team)"
const CACHE_DIR := "user://tiles"
const MAX_INFLIGHT := 6     # gentilezza verso i tile server
const ZOOM_MIN := 3
const ZOOM_MAX := 12
const NO_COORDS_MAX := 5

## Vista: centro in lat/lon e zoom tile (int).
var center := Vector2(9.19, 46.5)  # (lon, lat) ~ Europa/Milano
var zoom := 4

var _tiles := {}       # "z/x/y" → Texture2D
var _inflight := {}    # "z/x/y" → HTTPRequest
var _queue: Array = [] # chiavi in attesa di uno slot
var _pins: Array = []  # {lonlat: Vector2, label: String, score: int, count: int}
var _no_coords: Array = []
var _dragging := false

func _ready() -> void:
	custom_minimum_size = Vector2(0, 520)
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	size_flags_vertical = Control.SIZE_EXPAND_FILL
	clip_contents = true
	mouse_filter = Control.MOUSE_FILTER_STOP
	DirAccess.make_dir_recursive_absolute(CACHE_DIR)
	_rebuild_pins()
	BackendBus.positions_updated.connect(func(_l: Array) -> void: _rebuild_pins())
	resized.connect(queue_redraw)
	# TEST-AUTO: JHT_MAP_ZOOM=<n> parte già zoomata (per gli shot)
	if OS.get_environment("JHT_MAP_ZOOM") != "":
		zoom = clampi(int(OS.get_environment("JHT_MAP_ZOOM")), ZOOM_MIN, ZOOM_MAX)

## ── Proiezione Web Mercator ──────────────────────────────────────────

## (lon, lat) → coordinate "mondo tile" (unità = tile) allo zoom z.
static func _world(lonlat: Vector2, z: int) -> Vector2:
	var n := float(1 << z)
	var lat_rad := deg_to_rad(clampf(lonlat.y, -85.05, 85.05))
	return Vector2(
		(lonlat.x + 180.0) / 360.0 * n,
		(1.0 - log(tan(lat_rad) + 1.0 / cos(lat_rad)) / PI) / 2.0 * n)

## coordinate mondo → pixel sullo schermo rispetto alla vista corrente.
func _to_screen(world: Vector2) -> Vector2:
	var c := _world(center, zoom)
	return size / 2.0 + (world - c) * TILE

func _screen_to_lonlat(screen: Vector2) -> Vector2:
	var c := _world(center, zoom)
	var w := c + (screen - size / 2.0) / TILE
	var n := float(1 << zoom)
	var lon := w.x / n * 360.0 - 180.0
	var lat := rad_to_deg(atan(sinh(PI * (1.0 - 2.0 * w.y / n))))
	return Vector2(lon, lat)

## ── Tiles ─────────────────────────────────────────────────────────────

func _tile_key(z: int, x: int, y: int) -> String:
	return "%d/%d/%d" % [z, x, y]

func _tile_texture(z: int, x: int, y: int) -> Texture2D:
	var key := _tile_key(z, x, y)
	if _tiles.has(key):
		return _tiles[key]
	# cache disco: sopravvive fra le sessioni, niente rete inutile
	var path := "%s/%d_%d_%d.png" % [CACHE_DIR, z, x, y]
	if FileAccess.file_exists(path):
		var img := Image.new()
		if img.load(path) == OK:
			var tex := ImageTexture.create_from_image(img)
			_tiles[key] = tex
			return tex
	if not _inflight.has(key) and not _queue.has(key):
		_queue.append(key)
		_pump_queue()
	return null

func _pump_queue() -> void:
	while _inflight.size() < MAX_INFLIGHT and not _queue.is_empty():
		var key: String = _queue.pop_front()
		var parts := key.split("/")
		var req := HTTPRequest.new()
		add_child(req)
		_inflight[key] = req
		req.request_completed.connect(_on_tile.bind(key, req))
		var url := TILE_URL % [int(parts[0]), int(parts[1]), int(parts[2])]
		if req.request(url, [USER_AGENT]) != OK:
			_inflight.erase(key)
			req.queue_free()

func _on_tile(_result: int, code: int, _headers: PackedStringArray,
		body: PackedByteArray, key: String, req: HTTPRequest) -> void:
	_inflight.erase(key)
	req.queue_free()
	if code == 200:
		var img := Image.new()
		if img.load_png_from_buffer(body) == OK:
			_tiles[key] = ImageTexture.create_from_image(img)
			var parts := key.split("/")
			img.save_png("%s/%s_%s_%s.png" % [CACHE_DIR, parts[0], parts[1], parts[2]])
			queue_redraw()
	_pump_queue()

## ── Pin (stessi cluster per città della vista precedente) ────────────

func _rebuild_pins() -> void:
	_pins.clear()
	_no_coords.clear()
	var clusters := {}
	for p in BackendBus.positions:
		var coord := Vector2.INF
		if p.get("office_lat") != null and p.get("office_lon") != null:
			coord = Vector2(float(p["office_lon"]), float(p["office_lat"]))
		else:
			coord = MapView._city_coord(str(p.get("loc_city", "")
					if p.get("loc_city") else ""))
		if coord == Vector2.INF:
			var where := str(p.get("loc_city", "") if p.get("loc_city") else "")
			if where == "":
				where = str(p.get("loc_country", "") if p.get("loc_country") else "?")
			_no_coords.append("%s — %s · %s" % [str(p.get("title", "?")).left(44),
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
		_pins.append({"lonlat": c["coord"], "count": int(c["count"]),
				"score": int(c["best"]),
				"label": "%s (%d)" % [city, c["count"]] if c["count"] > 1 else city})
	queue_redraw()

## ── Input: pan, zoom, click sui pin ──────────────────────────────────

func _gui_input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		if event.button_index == MOUSE_BUTTON_WHEEL_UP and event.pressed:
			_zoom_at(1, event.position)
		elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN and event.pressed:
			_zoom_at(-1, event.position)
		elif event.button_index == MOUSE_BUTTON_LEFT:
			if event.pressed:
				_dragging = true
				if _click_pin(event.position):
					_dragging = false
			else:
				_dragging = false
	elif event is InputEventMouseMotion and _dragging:
		var c := _world(center, zoom)
		center = _clamp_center(_unproject(c - event.relative / TILE))
		queue_redraw()
	elif event is InputEventMagnifyGesture:
		_zoom_at(1 if event.factor > 1.0 else -1, event.position)
	elif event is InputEventPanGesture:
		var c := _world(center, zoom)
		center = _clamp_center(_unproject(c + event.delta * 24.0 / TILE))
		queue_redraw()

func _unproject(world: Vector2) -> Vector2:
	var n := float(1 << zoom)
	return Vector2(world.x / n * 360.0 - 180.0,
			rad_to_deg(atan(sinh(PI * (1.0 - 2.0 * world.y / n)))))

static func _clamp_center(lonlat: Vector2) -> Vector2:
	return Vector2(clampf(lonlat.x, -180.0, 180.0), clampf(lonlat.y, -80.0, 80.0))

## Zoom ancorato al punto sotto il mouse (il punto resta fermo).
func _zoom_at(delta: int, anchor: Vector2) -> void:
	var new_zoom := clampi(zoom + delta, ZOOM_MIN, ZOOM_MAX)
	if new_zoom == zoom:
		return
	var before := _screen_to_lonlat(anchor)
	zoom = new_zoom
	# riposiziona il centro così che l'ancora torni sotto il mouse
	var w_anchor := _world(before, zoom)
	var w_center := w_anchor - (anchor - size / 2.0) / TILE
	center = _clamp_center(_unproject(w_center))
	queue_redraw()

## Click su un pin → centra e zooma sulla città. true se ha colpito.
func _click_pin(pos: Vector2) -> bool:
	for pin in _pins:
		if _to_screen(_world(pin["lonlat"], zoom)).distance_to(pos) < 16.0:
			center = pin["lonlat"]
			zoom = clampi(maxi(zoom + 2, 8), ZOOM_MIN, ZOOM_MAX)
			queue_redraw()
			return true
	return false

## ── Rendering ─────────────────────────────────────────────────────────

func _draw() -> void:
	draw_rect(Rect2(Vector2.ZERO, size), Color(0.08, 0.09, 0.12))
	var n := 1 << zoom
	var c := _world(center, zoom)
	var half := size / 2.0 / TILE
	for x in range(int(floor(c.x - half.x)), int(ceil(c.x + half.x)) + 1):
		for y in range(int(floor(c.y - half.y)), int(ceil(c.y + half.y)) + 1):
			if y < 0 or y >= n:
				continue
			var wx := posmod(x, n)  # wrap orizzontale del mondo
			var tex := _tile_texture(zoom, wx, y)
			var pos := _to_screen(Vector2(x, y))
			if tex:
				draw_texture_rect(tex, Rect2(pos, Vector2(TILE, TILE)), false,
						Color(0.82, 0.84, 0.9))  # velo freddo: coerente col tema
			else:
				draw_rect(Rect2(pos, Vector2(TILE, TILE)), Color(0.10, 0.11, 0.15))
	# pin sopra le tile
	var font := TerminalTheme.get_theme().default_font
	for pin in _pins:
		var pos := _to_screen(_world(pin["lonlat"], zoom))
		if pos.x < -40 or pos.x > size.x + 40 or pos.y < -40 or pos.y > size.y + 40:
			continue
		var col: Color = Palette.MINT if pin["score"] >= 70 else Palette.YELLOW
		draw_circle(pos, 6.0, Color(0, 0, 0, 0.55))
		draw_circle(pos, 5.0, col)
		draw_arc(pos, 10.0, 0, TAU, 24, Color(col.r, col.g, col.b, 0.7), 2.0)
		var text := "%s  [%d]" % [pin["label"], pin["score"]]
		var tsize := font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, 14)
		draw_rect(Rect2(pos + Vector2(14, -9), tsize + Vector2(10, 6)),
				Color(0.04, 0.05, 0.07, 0.82))
		draw_string(font, pos + Vector2(19, 5), text,
				HORIZONTAL_ALIGNMENT_LEFT, -1, 14, Palette.BRIGHT)
	# attribuzione obbligatoria OSM + hint
	draw_rect(Rect2(Vector2(size.x - 232, size.y - 24), Vector2(232, 24)),
			Color(0.04, 0.05, 0.07, 0.8))
	draw_string(font, Vector2(size.x - 224, size.y - 8),
			"© OpenStreetMap contributors", HORIZONTAL_ALIGNMENT_LEFT, -1, 12,
			Palette.DIM)
	draw_string(font, Vector2(12, size.y - 8), UIStrings.t("map.hint"),
			HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Palette.DIM)
	# posizioni senza coordinate: esistono comunque (gate 1)
	if not _no_coords.is_empty():
		var shown := mini(_no_coords.size(), NO_COORDS_MAX)
		var y0 := 26.0
		draw_rect(Rect2(8, 6, 600, 26 + 18.0 * (shown + (1 if _no_coords.size() > shown else 0))),
				Color(0.04, 0.05, 0.07, 0.85))
		draw_string(font, Vector2(16, y0),
				"SENZA COORDINATE (%d)" % _no_coords.size(),
				HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Palette.MUTED)
		for i in shown:
			draw_string(font, Vector2(16, y0 + 17 + 18.0 * i), "· " + str(_no_coords[i]),
					HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Palette.DIM)
		if _no_coords.size() > shown:
			draw_string(font, Vector2(16, y0 + 17 + 18.0 * shown),
					"… +%d" % (_no_coords.size() - shown),
					HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Palette.DIM)
