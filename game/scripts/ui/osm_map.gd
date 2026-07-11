class_name OsmMap
extends Control
## La mappa piatta della vista Mappa, rifatta sull'esperienza del
## JobsGlobe della web privata (seconda bocciatura di Leone sul tema):
## basemap CARTO dark_all — lo stesso look del dark-matter che usa il
## web — e zoom FLUIDO: frazionale, animato, ancorato al cursore, fino
## al livello strada. Le tile viaggiano con User-Agent identificativo
## e restano in cache su disco (user://tiles) e in memoria.

const TILE := 256.0
const TILE_URL := "https://%s.basemaps.cartocdn.com/dark_all/%d/%d/%d.png"
const SUBDOMAINS := ["a", "b", "c", "d"]
const USER_AGENT := "User-Agent: JHT-desktop-prototype/0.1 (+https://github.com/leopu00/job-hunter-team)"
const CACHE_DIR := "user://tiles/carto"
const MAX_INFLIGHT := 8
const ZOOM_MIN := 2.0
const ZOOM_MAX := 16.0     # street level, come il volo su città del web
const TILE_Z_MAX := 16
const ZOOM_SPEED := 9.0    # lerp/s dell'animazione di zoom
const NO_COORDS_MAX := 5

signal zoomed_out          # sotto ZOOM_MIN: chi ospita può tornare al globo

## Vista: centro in coordinate mercator NORMALIZZATE (0..1) + zoom
## frazionale. L'animazione insegue _target_*.
var center := Vector2(0.53, 0.35)   # ~ Europa
var zoom_f := 4.0
var _target_center := Vector2(0.53, 0.35)
var _target_zoom := 4.0

var _tiles := {}
var _inflight := {}
var _queue: Array = []
var _pins: Array = []
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
	if OS.get_environment("JHT_MAP_ZOOM") != "":
		zoom_f = clampf(float(OS.get_environment("JHT_MAP_ZOOM")), ZOOM_MIN, ZOOM_MAX)
		_target_zoom = zoom_f

func _process(delta: float) -> void:
	# zoom/center animati: l'inseguimento morbido è la fluidità chiesta
	if absf(zoom_f - _target_zoom) > 0.001 or center.distance_to(_target_center) > 0.000001:
		var t := clampf(delta * ZOOM_SPEED, 0.0, 1.0)
		zoom_f = lerpf(zoom_f, _target_zoom, t)
		center = center.lerp(_target_center, t)
		queue_redraw()

## ── Proiezione (mercator normalizzato 0..1) ──────────────────────────

static func lonlat_to_norm(lonlat: Vector2) -> Vector2:
	var lat_rad := deg_to_rad(clampf(lonlat.y, -85.05, 85.05))
	return Vector2((lonlat.x + 180.0) / 360.0,
			(1.0 - log(tan(lat_rad) + 1.0 / cos(lat_rad)) / PI) / 2.0)

static func norm_to_lonlat(n: Vector2) -> Vector2:
	return Vector2(n.x * 360.0 - 180.0,
			rad_to_deg(atan(sinh(PI * (1.0 - 2.0 * n.y)))))

func _scale() -> float:
	return TILE * pow(2.0, zoom_f)  # pixel per "mondo intero"

func _to_screen(norm: Vector2) -> Vector2:
	return size / 2.0 + (norm - center) * _scale()

func _screen_to_norm(screen: Vector2) -> Vector2:
	return center + (screen - size / 2.0) / _scale()

## ── Tiles ─────────────────────────────────────────────────────────────

func _tile_texture(z: int, x: int, y: int) -> Texture2D:
	var key := "%d/%d/%d" % [z, x, y]
	if _tiles.has(key):
		return _tiles[key]
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
		var sub: String = SUBDOMAINS[(int(parts[1]) + int(parts[2])) % SUBDOMAINS.size()]
		var url := TILE_URL % [sub, int(parts[0]), int(parts[1]), int(parts[2])]
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

## ── Pin (cluster per città, come il web) ─────────────────────────────

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
		_pins.append({"norm": lonlat_to_norm(c["coord"]), "count": int(c["count"]),
				"score": int(c["best"]),
				"label": "%s (%d)" % [city, c["count"]] if c["count"] > 1 else city})
	queue_redraw()

## ── Input ─────────────────────────────────────────────────────────────

func _gui_input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		if event.button_index == MOUSE_BUTTON_WHEEL_UP and event.pressed:
			_zoom_at(0.6, event.position)
		elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN and event.pressed:
			_zoom_at(-0.6, event.position)
		elif event.button_index == MOUSE_BUTTON_LEFT:
			if event.pressed:
				_dragging = not _click_pin(event.position)
			else:
				_dragging = false
	elif event is InputEventMouseMotion and _dragging:
		center -= event.relative / _scale()
		center.y = clampf(center.y, 0.0, 1.0)
		_target_center = center
		queue_redraw()
	elif event is InputEventMagnifyGesture:
		_zoom_at(log(event.factor) / log(2.0) * 1.5, event.position)
	elif event is InputEventPanGesture:
		center += event.delta * 20.0 / _scale()
		center.y = clampf(center.y, 0.0, 1.0)
		_target_center = center
		queue_redraw()

## Zoom fluido ancorato: il punto sotto il cursore resta fermo.
func _zoom_at(delta_z: float, anchor: Vector2) -> void:
	var new_target := clampf(_target_zoom + delta_z, ZOOM_MIN, ZOOM_MAX)
	if delta_z < 0.0 and _target_zoom <= ZOOM_MIN + 0.01:
		zoomed_out.emit()  # sotto il minimo: chi ospita torna al globo
		return
	# centro target tale che l'ancora resti sul punto attuale
	var anchor_norm := _screen_to_norm(anchor)
	var scale_new := TILE * pow(2.0, new_target)
	_target_center = anchor_norm - (anchor - size / 2.0) / scale_new
	_target_center.y = clampf(_target_center.y, 0.0, 1.0)
	_target_zoom = new_target

## Click su un pin → vola sulla città (come il click sui cluster web).
func _click_pin(pos: Vector2) -> bool:
	for pin in _pins:
		if _to_screen(pin["norm"]).distance_to(pos) < 16.0:
			_target_center = pin["norm"]
			_target_zoom = clampf(maxf(_target_zoom + 2.5, 11.0), ZOOM_MIN, ZOOM_MAX)
			return true
	return false

## Vola a una posizione (per il passaggio dal globo alla mappa).
func fly_to(lonlat: Vector2, z: float) -> void:
	center = lonlat_to_norm(lonlat)
	_target_center = center
	zoom_f = clampf(z, ZOOM_MIN, ZOOM_MAX)
	_target_zoom = zoom_f
	queue_redraw()

## ── Rendering ─────────────────────────────────────────────────────────

func _draw() -> void:
	draw_rect(Rect2(Vector2.ZERO, size), Color(0.045, 0.05, 0.075))
	# livello tile intero più vicino allo zoom frazionale, scalato
	var base_z := clampi(int(floor(zoom_f + 0.35)), 0, TILE_Z_MAX)
	var n := 1 << base_z
	var tile_px := _scale() / float(n)   # dimensione a schermo di una tile
	var tl := _screen_to_norm(Vector2.ZERO) * n
	var br := _screen_to_norm(size) * n
	for x in range(int(floor(tl.x)), int(ceil(br.x)) + 1):
		for y in range(maxi(0, int(floor(tl.y))), mini(n - 1, int(ceil(br.y))) + 1):
			var wx := posmod(x, n)
			var pos := _to_screen(Vector2(float(x) / n, float(y) / n))
			var rect := Rect2(pos, Vector2(tile_px + 0.6, tile_px + 0.6))
			var tex := _tile_texture(base_z, wx, y)
			if tex:
				draw_texture_rect(tex, rect, false)
			else:
				# scala la tile del livello sopra: niente buchi neri
				var parent := _tile_texture(maxi(0, base_z - 1), wx >> 1, y >> 1)
				if parent:
					var sub := Rect2(Vector2(wx % 2, y % 2) * TILE / 2.0,
							Vector2(TILE / 2.0, TILE / 2.0))
					draw_texture_rect_region(parent, rect, sub)
				else:
					draw_rect(rect, Color(0.07, 0.08, 0.11))
	# pin
	var font := TerminalTheme.get_theme().default_font
	for pin in _pins:
		var pos := _to_screen(pin["norm"])
		if pos.x < -60 or pos.x > size.x + 60 or pos.y < -60 or pos.y > size.y + 60:
			continue
		var col: Color = Palette.MINT if pin["score"] >= 70 else Palette.YELLOW
		draw_circle(pos, 6.5, Color(0, 0, 0, 0.6))
		draw_circle(pos, 5.0, col)
		draw_arc(pos, 10.0, 0, TAU, 24, Color(col.r, col.g, col.b, 0.7), 2.0)
		var text := "%s  [%d]" % [pin["label"], pin["score"]]
		var tsize := font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, 14)
		draw_rect(Rect2(pos + Vector2(14, -9), tsize + Vector2(10, 6)),
				Color(0.04, 0.05, 0.07, 0.85))
		draw_string(font, pos + Vector2(19, 5), text,
				HORIZONTAL_ALIGNMENT_LEFT, -1, 14, Palette.BRIGHT)
	# attribuzione (Carto richiede OSM + CARTO) e hint
	draw_rect(Rect2(Vector2(size.x - 210, size.y - 22), Vector2(210, 22)),
			Color(0.04, 0.05, 0.07, 0.8))
	draw_string(font, Vector2(size.x - 202, size.y - 7), "© OpenStreetMap © CARTO",
			HORIZONTAL_ALIGNMENT_LEFT, -1, 11, Palette.DIM)
	draw_string(font, Vector2(12, size.y - 7), UIStrings.t("map.hint"),
			HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Palette.DIM)
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
