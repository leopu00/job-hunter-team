class_name MapGlobe
extends Control
## Il GLOBO della web privata (JobsGlobe con projection globe),
## replicato in 3D: sfera col mondo scuro Carto, trascini per ruotare,
## rotella/pinch per avvicinarti — oltre la soglia si "atterra" sulla
## mappa piatta (dive_in), esattamente come la transizione di MapLibre.
##
## La texture del mondo è la composita delle 16 tile Carto z2
## RIPROIETTATA da mercator a equirettangolare (riga per riga, via
## blit): generata una volta e cacheata su disco.

signal dive_in(lonlat: Vector2)  # zoom oltre soglia → mappa piatta qui
signal pin_clicked(pin: Dictionary)  # click su un pin → atterra su quella città

const GLOBE_TEX := "user://tiles/globe_dark.png"
const TILE_URL := "https://%s.basemaps.cartocdn.com/dark_all/2/%d/%d.png"
const SUBDOMAINS := ["a", "b", "c", "d"]
const USER_AGENT := "User-Agent: JHT-desktop-prototype/0.1 (+https://github.com/leopu00/job-hunter-team)"
const DIST_MAX := 3.1
const DIST_MIN := 1.55    # sotto: dive nella mappa piatta
const MERC_LAT_MAX := 85.05113
## Orientamento iniziale: Europa in vista (tarato a shot, 12/07).
const EUROPE_YAW := -195.0
const EUROPE_PITCH := -35.0

var _vp: SubViewport
var _pivot: Node3D          # yaw+pitch: ruotare il mondo, non la camera
var _sphere: MeshInstance3D
var _camera: Camera3D
var _distance := 2.6
var _dragging := false
var _drag_dist := 0.0       # per distinguere il click dal trascinamento
var _tiles_pending := 0
var _mercator: Image
var _pins: Array = []       # cluster di MapPins: {key, city, lonlat, count, best, positions}
var _hover_key := ""        # pin sotto il cursore (targhetta + cursore mano)

## Filtri condivisi con la vista Mappa (riferimento di WorldMap).
var filters := {}

func _ready() -> void:
	custom_minimum_size = Vector2(0, 520)
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	size_flags_vertical = Control.SIZE_EXPAND_FILL
	clip_contents = true
	mouse_filter = Control.MOUSE_FILTER_STOP
	_build_scene()
	_load_or_fetch_texture()
	_rebuild_pins()
	BackendBus.positions_updated.connect(func(_l: Array) -> void: _rebuild_pins())

func _build_scene() -> void:
	var holder := SubViewportContainer.new()
	holder.set_anchors_preset(Control.PRESET_FULL_RECT)
	holder.stretch = true
	holder.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(holder)
	_vp = SubViewport.new()
	_vp.transparent_bg = true
	_vp.msaa_3d = Viewport.MSAA_4X
	holder.add_child(_vp)
	_camera = Camera3D.new()
	_camera.position = Vector3(0, 0, _distance)
	_camera.fov = 40.0
	_vp.add_child(_camera)
	_pivot = Node3D.new()
	_vp.add_child(_pivot)
	_sphere = MeshInstance3D.new()
	var mesh := SphereMesh.new()
	mesh.radius = 1.0
	mesh.height = 2.0
	mesh.radial_segments = 96
	mesh.rings = 48
	_sphere.mesh = mesh
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.albedo_color = Color(0.14, 0.16, 0.2)  # in attesa della texture
	_sphere.material_override = mat
	_pivot.add_child(_sphere)
	# vista iniziale sull'Europa, come center [10, 45] del web
	# (JHT_GLOBE_YAW/PITCH per la taratura sperimentale negli shot)
	var yaw := float(OS.get_environment("JHT_GLOBE_YAW")) \
			if OS.get_environment("JHT_GLOBE_YAW") != "" else EUROPE_YAW
	var pitch := float(OS.get_environment("JHT_GLOBE_PITCH")) \
			if OS.get_environment("JHT_GLOBE_PITCH") != "" else EUROPE_PITCH
	_pivot.rotation.y = deg_to_rad(yaw)
	_pivot.rotation.x = deg_to_rad(pitch)
	# NB: niente set di _vp.size — con stretch=true lo gestisce il container

## ── Texture del mondo (Carto z2 → equirect) ──────────────────────────

func _load_or_fetch_texture() -> void:
	if FileAccess.file_exists(GLOBE_TEX):
		var img := Image.new()
		if img.load(GLOBE_TEX) == OK:
			_apply_texture(img)
			return
	DirAccess.make_dir_recursive_absolute("user://tiles")
	_mercator = Image.create(1024, 1024, false, Image.FORMAT_RGB8)
	_tiles_pending = 16
	for x in 4:
		for y in 4:
			var req := HTTPRequest.new()
			add_child(req)
			req.request_completed.connect(_on_tile.bind(x, y, req))
			var url := TILE_URL % [SUBDOMAINS[(x + y) % 4], x, y]
			if req.request(url, [USER_AGENT]) != OK:
				req.queue_free()
				_tiles_pending -= 1

func _on_tile(_r: int, code: int, _h: PackedStringArray, body: PackedByteArray,
		x: int, y: int, req: HTTPRequest) -> void:
	req.queue_free()
	if code == 200:
		var img := Image.new()
		if img.load_png_from_buffer(body) == OK:
			img.convert(Image.FORMAT_RGB8)
			_mercator.blit_rect(img, Rect2i(0, 0, 256, 256), Vector2i(x * 256, y * 256))
	_tiles_pending -= 1
	if _tiles_pending <= 0:
		_reproject_and_apply()

## mercator 1024×1024 → equirect 1024×512: una blit per riga.
func _reproject_and_apply() -> void:
	var eq := Image.create(1024, 512, false, Image.FORMAT_RGB8)
	eq.fill(Color(0.055, 0.06, 0.08))  # poli fuori mercator: colore mare
	for py in 512:
		var lat := 90.0 - (float(py) + 0.5) / 512.0 * 180.0
		if absf(lat) >= MERC_LAT_MAX:
			continue
		var lat_rad := deg_to_rad(lat)
		var merc_y := (1.0 - log(tan(lat_rad) + 1.0 / cos(lat_rad)) / PI) / 2.0
		var src_y := clampi(int(merc_y * 1024.0), 0, 1023)
		eq.blit_rect(_mercator, Rect2i(0, src_y, 1024, 1), Vector2i(0, py))
	eq.save_png(GLOBE_TEX)
	_apply_texture(eq)
	_mercator = Image.new()  # libera la composita

func _apply_texture(img: Image) -> void:
	var mat: StandardMaterial3D = _sphere.material_override
	mat.albedo_color = Color.WHITE
	mat.albedo_texture = ImageTexture.create_from_image(img)
	queue_redraw()

## ── Pin come marker emissivi sulla sfera ─────────────────────────────

## Offset di longitudine fra la texture equirect della SphereMesh e la
## formula xyz: tarato a shot sui pin europei (12/07). Cambia SOLO se
## cambia il mesh o il verso della texture.
const PIN_LON_OFFSET := -85.0

static func _lonlat_to_xyz(lonlat: Vector2) -> Vector3:
	var lat := deg_to_rad(lonlat.y)
	var lon := deg_to_rad(lonlat.x + PIN_LON_OFFSET \
			+ (float(OS.get_environment("JHT_PIN_OFF")) \
			if OS.get_environment("JHT_PIN_OFF") != "" else 0.0))
	return Vector3(-cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon))

func _rebuild_pins() -> void:
	_pins = MapPins.build(filters)["clusters"]
	for child in _pivot.get_children():
		if child != _sphere:
			child.queue_free()
	for pin in _pins:
		var dot := MeshInstance3D.new()
		var m := SphereMesh.new()
		# più posizioni nella città → punto più grande (i bouquet del web)
		var r := 0.011 + 0.0028 * clampf(log(float(pin["count"]) + 1.0) / log(2.0), 0.0, 4.0)
		m.radius = r
		m.height = r * 2.0
		dot.mesh = m
		var mat := StandardMaterial3D.new()
		mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		mat.albedo_color = MapPins.score_color(pin["best"])
		dot.material_override = mat
		dot.position = _lonlat_to_xyz(pin["lonlat"]) * 1.005
		_pivot.add_child(dot)
	queue_redraw()

## Proiezione a schermo di un pin, o INF se sull'emisfero nascosto.
func _project_pin(lonlat: Vector2) -> Vector2:
	var world := _pivot.transform * (_lonlat_to_xyz(lonlat) * 1.005)
	if world.z < 0.12 or _camera.is_position_behind(world):
		return Vector2.INF
	return _camera.unproject_position(world)

## Il pin più vicino al cursore (entro 18 px), {} se nessuno.
func _pin_at(pos: Vector2) -> Dictionary:
	var best := {}
	var best_d := 18.0
	for pin in _pins:
		var sp := _project_pin(pin["lonlat"])
		if sp == Vector2.INF:
			continue
		var d := sp.distance_to(pos)
		if d < best_d:
			best_d = d
			best = pin
	return best

## ── Input: ruota, zoom, dive ─────────────────────────────────────────

func _gui_input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		if event.button_index == MOUSE_BUTTON_WHEEL_UP and event.pressed:
			_zoom(-0.16)
		elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN and event.pressed:
			_zoom(0.16)
		elif event.button_index == MOUSE_BUTTON_LEFT:
			if event.pressed:
				_dragging = true
				_drag_dist = 0.0
			else:
				_dragging = false
				# click fermo (non fine trascinamento) su un pin → atterra lì
				if _drag_dist < 6.0:
					var pin := _pin_at(event.position)
					if not pin.is_empty():
						Sfx.play_tick()
						pin_clicked.emit(pin)
	elif event is InputEventMouseMotion:
		if _dragging:
			_drag_dist += event.relative.length()
			_pivot.rotation.y += event.relative.x * 0.005
			_pivot.rotation.x = clampf(_pivot.rotation.x + event.relative.y * 0.005,
					-1.2, 1.2)
			if _hover_key != "":
				_hover_key = ""
				queue_redraw()
		else:
			var hover := _pin_at(event.position)
			var key := str(hover.get("key", ""))
			mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND \
					if key != "" else Control.CURSOR_ARROW
			if key != _hover_key:
				_hover_key = key
				queue_redraw()
	elif event is InputEventMagnifyGesture:
		_zoom(-(event.factor - 1.0) * 0.9)
	elif event is InputEventPanGesture:
		_pivot.rotation.y += event.delta.x * 0.01
		_pivot.rotation.x = clampf(_pivot.rotation.x + event.delta.y * 0.01, -1.2, 1.2)

func _zoom(dd: float) -> void:
	_distance = clampf(_distance + dd * _distance, DIST_MIN, DIST_MAX)
	_camera.position.z = _distance
	if _distance <= DIST_MIN + 0.001:
		dive_in.emit(_center_lonlat())

## Passo di zoom per il widget +/− della vista Mappa.
func zoom_step(dd: float) -> void:
	_zoom(dd)

## PANORAMICA: inquadra tutti i pin — centro sul baricentro, distanza
## massima. Usa la relazione lon/lat↔yaw/pitch già tarata a shot.
func fit_overview() -> void:
	var yaw := EUROPE_YAW
	var pitch := EUROPE_PITCH
	if not _pins.is_empty():
		var c := Vector2.ZERO
		for pin in _pins:
			c += pin["lonlat"] as Vector2
		c /= float(_pins.size())
		yaw = -(c.x + 185.0)
		pitch = clampf(-c.y / 1.2, -68.0, 68.0)
	_pivot.rotation.y = deg_to_rad(yaw)
	_pivot.rotation.x = deg_to_rad(pitch)
	_distance = DIST_MAX * 0.85
	_camera.position.z = _distance
	queue_redraw()

## Il punto del mondo al centro dello schermo (per atterrare lì).
## Relazioni tarate a shot: lon_visibile = -yaw - 185, lat ≈ -pitch*1.2.
func _center_lonlat() -> Vector2:
	var lat := -rad_to_deg(_pivot.rotation.x) * 1.2
	var lon := -rad_to_deg(_pivot.rotation.y) - 185.0
	return Vector2(wrapf(lon, -180.0, 180.0), clampf(lat, -75.0, 75.0))

func _draw() -> void:
	# alone atmosferico dietro la sfera (il glow del globe web)
	var center_px := size / 2.0
	var r := size.y * 0.5 * (1.9 / _distance)
	for i in 5:
		draw_circle(center_px, r + 8.0 + i * 5.0,
				Color(0.3, 0.55, 0.9, 0.05 - i * 0.008))
	var font := TerminalTheme.get_theme().default_font
	# targhetta del pin sotto il cursore (l'hover del web)
	if _hover_key != "":
		for pin in _pins:
			if str(pin["key"]) != _hover_key:
				continue
			var sp := _project_pin(pin["lonlat"])
			if sp == Vector2.INF:
				break
			var text := "%s (%d)" % [str(pin["city"]), int(pin["count"])] \
					if int(pin["count"]) > 1 else str(pin["city"])
			if pin["best"] != null:
				text += "  [%d]" % int(pin["best"])
			var tsize := font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, 14)
			var rect := Rect2(sp + Vector2(14, -10), tsize + Vector2(12, 8))
			draw_rect(rect, Color(0.04, 0.05, 0.07, 0.9))
			draw_string(font, sp + Vector2(20, 5), text,
					HORIZONTAL_ALIGNMENT_LEFT, -1, 14, Palette.BRIGHT)
			break
	draw_string(font, Vector2(12, size.y - 7), UIStrings.t("map.globe_hint"),
			HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Palette.DIM)
	draw_rect(Rect2(Vector2(size.x - 210, size.y - 22), Vector2(210, 22)),
			Color(0.04, 0.05, 0.07, 0.8))
	draw_string(font, Vector2(size.x - 202, size.y - 7), "© OpenStreetMap © CARTO",
			HORIZONTAL_ALIGNMENT_LEFT, -1, 11, Palette.DIM)
