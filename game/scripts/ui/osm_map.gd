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
const MAX_INFLIGHT := 12
const TILE_REQUEST_TIMEOUT := 10.0
const ZOOM_MIN := 2.0
const ZOOM_MAX := 16.0     # street level, come il volo su città del web
const TILE_Z_MAX := 16
const ZOOM_SPEED := 9.0    # lerp/s dell'animazione di zoom
const AUTO_CITY_ZOOM := 8.0 # il click apre la scheda senza un salto a livello strada
const NO_COORDS_MAX := 5

signal zoomed_out          # sotto ZOOM_MIN: chi ospita può tornare al globo
signal open_position(pid: int)  # click su una posizione della scheda pin

## Vista: centro in coordinate mercator NORMALIZZATE (0..1) + zoom
## frazionale. L'animazione insegue _target_*.
var center := Vector2(0.53, 0.35)   # ~ Europa
var zoom_f := 4.0
var _target_center := Vector2(0.53, 0.35)
var _target_zoom := 4.0

var _tiles := {}
var _inflight := {}
var _queue: Array = []
var _target_tile_signature := ""
var _pins: Array = []       # cluster di MapPins + "norm" precalcolato
var _no_coords: Array = []  # righe già formattate per il box in alto
var _dragging := false
var _hover_key := ""
var _selected_key := ""     # pin con la scheda aperta
var _card: PanelContainer   # la scheda (vignette del web) del pin selezionato
var _card_signature := ""   # per non ricostruirla a ogni snapshot uguale
var _cluster_cache: Array = []
var _cluster_cache_zoom := -1
var _pins_revision := 0
var _cluster_cache_revision := -1

## Filtri condivisi con la vista Mappa (riferimento di WorldMap).
var filters := {}

func _ready() -> void:
	custom_minimum_size = Vector2(0, 520)
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	size_flags_vertical = Control.SIZE_EXPAND_FILL
	clip_contents = true
	mouse_filter = Control.MOUSE_FILTER_STOP
	# Le tile vengono scelte al livello superiore e ridotte: il filtro lineare
	# è nitido e non richiede di generare mipmap costose per ogni risposta.
	texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR
	DirAccess.make_dir_recursive_absolute(CACHE_DIR)
	_rebuild_pins()
	BackendBus.positions_updated.connect(func(_l: Array) -> void: _rebuild_pins())
	resized.connect(func() -> void:
		_target_tile_signature = ""
		queue_redraw())
	if OS.get_environment("JHT_MAP_ZOOM") != "":
		zoom_f = clampf(float(OS.get_environment("JHT_MAP_ZOOM")), ZOOM_MIN, ZOOM_MAX)
		_target_zoom = zoom_f

func _process(delta: float) -> void:
	# Prepara subito le sole tile della destinazione. La vecchia implementazione
	# accodava ogni livello attraversato dall'animazione e lasciava la vista
	# finale in fondo a centinaia di richieste ormai inutili.
	_ensure_target_tiles()
	# zoom/center animati: l'inseguimento morbido è la fluidità chiesta
	if absf(zoom_f - _target_zoom) > 0.001 or center.distance_to(_target_center) > 0.000001:
		var t := clampf(delta * ZOOM_SPEED, 0.0, 1.0)
		zoom_f = lerpf(zoom_f, _target_zoom, t)
		center = center.lerp(_target_center, t)
		queue_redraw()
	if is_instance_valid(_card):
		_place_card()

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

func _tile_texture(z: int, x: int, y: int,
		request_if_missing := true) -> Texture2D:
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
	if request_if_missing and not _inflight.has(key) and not _queue.has(key):
		_queue.append(key)
		_pump_queue()
	return null

## Mantiene corta la coda e dà precedenza al centro della vista di arrivo.
## Un margine di una tile rende immediato anche il primo piccolo pan.
func _ensure_target_tiles() -> void:
	if size.x < 2.0 or size.y < 2.0:
		return
	var z := clampi(int(ceil(_target_zoom)), 0, TILE_Z_MAX)
	var n := 1 << z
	var scale := TILE * pow(2.0, _target_zoom)
	var tl := (_target_center - size / (2.0 * scale)) * n
	var br := (_target_center + size / (2.0 * scale)) * n
	var center_tile := _target_center * n
	var signature := "%d:%d:%d:%d:%d:%d" % [z, floori(center_tile.x),
			floori(center_tile.y), roundi(_target_zoom * 4.0),
			roundi(size.x / TILE), roundi(size.y / TILE)]
	if signature == _target_tile_signature:
		return
	_target_tile_signature = signature
	_queue.clear() # elimina livelli/zone che non sono più la destinazione
	var wanted: Array = []
	for x in range(int(floor(tl.x)) - 1, int(ceil(br.x)) + 2):
		for y in range(maxi(0, int(floor(tl.y)) - 1),
				mini(n - 1, int(ceil(br.y)) + 1) + 1):
			var wx := posmod(x, n)
			wanted.append({"x": wx, "y": y,
					"distance": Vector2(float(x), float(y)).distance_squared_to(center_tile)})
	wanted.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		return float(a["distance"]) < float(b["distance"]))
	for tile in wanted:
		_tile_texture(z, int(tile["x"]), int(tile["y"]), true)

func _pump_queue() -> void:
	while _inflight.size() < MAX_INFLIGHT and not _queue.is_empty():
		var key: String = _queue.pop_front()
		var parts := key.split("/")
		var req := HTTPRequest.new()
		req.timeout = TILE_REQUEST_TIMEOUT
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
			var parts := key.split("/")
			# Il body è già PNG: scriverlo direttamente evita una seconda codifica
			# sincrona sul thread grafico per ogni tile.
			var file := FileAccess.open("%s/%s_%s_%s.png" % [
					CACHE_DIR, parts[0], parts[1], parts[2]], FileAccess.WRITE)
			if file:
				file.store_buffer(body)
			_tiles[key] = ImageTexture.create_from_image(img)
			queue_redraw()
	_pump_queue()

## ── Pin (cluster per città, come il web) ─────────────────────────────

func _rebuild_pins() -> void:
	var built := MapPins.build(filters)
	_pins = built["clusters"]
	_no_coords.clear()
	for p in built["no_coords"]:
		var where := str(p.get("loc_city", "") if p.get("loc_city") else "")
		if where == "":
			where = str(p.get("loc_country", "") if p.get("loc_country") else "?")
		_no_coords.append("%s — %s · %s" % [str(p.get("title", "?")).left(44),
				str(p.get("company", "?")), where])
	for pin in _pins:
		pin["norm"] = lonlat_to_norm(pin["lonlat"])
		# Un pin su un civico verificato porta il nome dell'azienda: è un
		# edificio, e chiamarlo col nome della città lo renderebbe identico
		# al pin del centro. Quello approssimato tiene la città e lo dichiara
		# con "≈", perché la targhetta si legge anche senza cliccare.
		var base := str(pin["city"])
		if bool(pin.get("exact", false)):
			var company: Variant = (pin["positions"][0] as Dictionary).get("company")
			if company != null and str(company).strip_edges() != "":
				base = str(company)
		else:
			base = "≈ " + base
		pin["label"] = "%s (%d)" % [base, int(pin["count"])] \
				if int(pin["count"]) > 1 else base
		pin["is_cluster"] = false
		pin["source_count"] = 1
	_pins_revision += 1
	_cluster_cache_zoom = -1
	# TEST-AUTO: JHT_MAP_PIN=<città> seleziona quel pin appena esiste
	# (lo snapshot VPS arriva async: riprova a ogni rebuild finché c'è)
	var want := OS.get_environment("JHT_MAP_PIN")
	if want != "" and _selected_key == "":
		for pin in _pins:
			if str(pin["city"]).to_lower() == want.to_lower():
				_target_center = pin["norm"]
				_target_zoom = maxf(_target_zoom, 10.0)
				_selected_key = str(pin["key"])
				break
	_rebuild_card()  # il pin selezionato può essere cambiato/sparito
	queue_redraw()

func _find_pin(key: String) -> Dictionary:
	for pin in _pins:
		if str(pin["key"]) == key:
			return pin
	return {}

## Clustering progressivo ispirato alla mappa web:
##   zoom 2–4  → paese;
##   zoom 5–9  → celle geografiche sempre più piccole;
##   zoom 10+  → singole città.
## Il bucket usa coordinate-mondo, non lo schermo: trascinare non fa saltare
## i gruppi. Si ricostruisce solo quando cambia livello intero o snapshot.
func _display_pins() -> Array:
	var z := clampi(int(floor(zoom_f)), int(ZOOM_MIN), int(ZOOM_MAX))
	if _cluster_cache_zoom == z and _cluster_cache_revision == _pins_revision:
		return _cluster_cache
	_cluster_cache_zoom = z
	_cluster_cache_revision = _pins_revision
	_cluster_cache = []
	if z >= 10:
		_cluster_cache = _pins.duplicate()
		return _cluster_cache
	var groups := {}
	if z <= 4:
		for pin in _pins:
			var key := "country:" + str(pin.get("country", "?"))
			if not groups.has(key):
				groups[key] = []
			(groups[key] as Array).append(pin)
	else:
		var world_scale := TILE * pow(2.0, z)
		var cell_px := 140.0 - float(z - 5) * 20.0
		for pin in _pins:
			var norm: Vector2 = pin["norm"]
			var cell := Vector2i(floori(norm.x * world_scale / cell_px),
					floori(norm.y * world_scale / cell_px))
			var key := "near:%d:%d:%d" % [z, cell.x, cell.y]
			if not groups.has(key):
				groups[key] = []
			(groups[key] as Array).append(pin)
	var keys: Array = groups.keys()
	keys.sort()
	for key in keys:
		var members: Array = groups[key]
		if members.size() == 1:
			_cluster_cache.append(members[0])
		else:
			_cluster_cache.append(_merge_cluster(members, str(key), z <= 4))
	return _cluster_cache

func _merge_cluster(members: Array, key: String, country_level: bool) -> Dictionary:
	var count := 0
	var best: Variant = null
	var positions: Array = []
	var weighted_y := 0.0
	var circle := Vector2.ZERO
	for pin in members:
		var weight := maxf(1.0, float(pin["count"]))
		count += int(pin["count"])
		positions.append_array(pin["positions"])
		if pin["best"] != null and (best == null or float(pin["best"]) > float(best)):
			best = pin["best"]
		var norm: Vector2 = pin["norm"]
		var angle := norm.x * TAU
		circle += Vector2(cos(angle), sin(angle)) * weight
		weighted_y += norm.y * weight
	var norm_x := atan2(circle.y, circle.x) / TAU
	if norm_x < 0.0:
		norm_x += 1.0
	var norm := Vector2(norm_x, weighted_y / maxf(1.0, float(count)))
	var cluster_label := "%s · %d" % [str(members[0].get("country", "?")), count] \
			if country_level else UIStrings.t("map.cluster") % [count, members.size()]
	return {
		"key": key, "city": cluster_label, "country": members[0].get("country", ""),
		"lonlat": norm_to_lonlat(norm), "norm": norm, "count": count,
		"best": best, "positions": positions, "label": cluster_label,
		"is_cluster": true, "source_count": members.size(),
	}

## ── La scheda del pin: le posizioni della città, cliccabili ──────────
## (la vignette/popup del JobsGlobe web: titolo, azienda, score, apri →)

func _rebuild_card() -> void:
	var pin := _find_pin(_selected_key)
	if pin.is_empty():
		_selected_key = ""
		_card_signature = ""
		if is_instance_valid(_card):
			_card.queue_free()
			_card = null
		return
	# ricostruisci solo se il contenuto è cambiato davvero: lo snapshot
	# periodico del bus non deve far lampeggiare la scheda sotto il mouse
	var ids: Array = []
	for p in pin["positions"]:
		ids.append(int(p.get("id", 0)))
	var signature := "%s·%s" % [_selected_key, str(ids)]
	if signature == _card_signature and is_instance_valid(_card):
		return
	_card_signature = signature
	if is_instance_valid(_card):
		_card.queue_free()
	_card = PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(Palette.PANEL.r, Palette.PANEL.g, Palette.PANEL.b, 0.96)
	sb.border_color = Palette.BORDER_GLOW
	sb.set_border_width_all(TerminalTheme.hairline())
	sb.content_margin_left = 12
	sb.content_margin_right = 12
	sb.content_margin_top = 8
	sb.content_margin_bottom = 8
	_card.add_theme_stylebox_override("panel", sb)
	_card.mouse_filter = Control.MOUSE_FILTER_STOP
	add_child(_card)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 4)
	_card.add_child(box)
	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", 10)
	box.add_child(head)
	var title := TerminalTheme.label(
			"%s · %d" % [str(pin["city"]).to_upper(), int(pin["count"])],
			15, Palette.WHITE, "bold")
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(title)
	var close := Button.new()
	close.flat = true
	close.text = "✕"
	close.add_theme_font_size_override("font_size", 14)
	close.add_theme_color_override("font_color", Palette.MUTED)
	close.add_theme_color_override("font_hover_color", Palette.RED)
	close.pressed.connect(func() -> void:
		_selected_key = ""
		Sfx.play_back()
		_rebuild_card()
		queue_redraw())
	head.add_child(close)
	# L'anello vuoto va spiegato una volta, qui: il pin è il centro città,
	# non l'ingresso di un ufficio. L'indirizzo vero, quando esiste, sta
	# nella scheda della singola posizione.
	if not bool(pin.get("is_cluster", false)) and not bool(pin.get("exact", false)):
		box.add_child(TerminalTheme.label(UIStrings.t("map.pin_approx"), 11, Palette.MUTED))
	var positions: Array = pin["positions"]
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	scroll.vertical_scroll_mode = ScrollContainer.SCROLL_MODE_AUTO
	# La scheda del web consente di raggiungere ogni risultato. Qui la lista
	# resta compatta ma scorre per intero: mai più “altre 6” senza accesso.
	var max_list_height := maxf(120.0, minf(420.0, size.y - 150.0))
	scroll.custom_minimum_size = Vector2(0,
			minf(max_list_height, maxf(42.0, positions.size() * 38.0)))
	box.add_child(scroll)
	var rows := VBoxContainer.new()
	rows.add_theme_constant_override("separation", 4)
	rows.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	scroll.add_child(rows)
	for p in positions:
		var pid := int(p.get("id", 0))
		# Un solo bersaglio cliccabile per tutta la riga: non devi centrare
		# esattamente il titolo; score, testo, freccia e spazio vuoto aprono
		# tutti la stessa scheda completa della posizione.
		var row_btn := Button.new()
		row_btn.flat = true
		row_btn.custom_minimum_size = Vector2(500, 34)
		row_btn.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		row_btn.tooltip_text = UIStrings.t("queue.open_position")
		row_btn.set_meta("position_id", pid)
		row_btn.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
		var hover := StyleBoxFlat.new()
		hover.bg_color = Color(Palette.GREEN.r, Palette.GREEN.g, Palette.GREEN.b, 0.10)
		hover.border_color = Color(Palette.GREEN.r, Palette.GREEN.g, Palette.GREEN.b, 0.35)
		hover.set_border_width_all(TerminalTheme.hairline())
		row_btn.add_theme_stylebox_override("hover", hover)
		row_btn.add_theme_stylebox_override("pressed", hover.duplicate())
		row_btn.pressed.connect(func() -> void:
			Sfx.play_tick()
			open_position.emit(pid))
		rows.add_child(row_btn)
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 10)
		row.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		row.offset_left = 7
		row.offset_right = -7
		row.mouse_filter = Control.MOUSE_FILTER_IGNORE
		row_btn.add_child(row)
		var score_v: Variant = p.get("total_score")
		var score := TerminalTheme.label(
				"—" if score_v == null else str(int(score_v)), 15,
				MapPins.score_color(score_v), "bold")
		score.custom_minimum_size = Vector2(34, 0)
		score.mouse_filter = Control.MOUSE_FILTER_IGNORE
		row.add_child(score)
		var position_title := TerminalTheme.label("%s — %s" % [
				str(p.get("title", "?")).left(40),
				str(p.get("company", "?")).left(22)], 14, Palette.BRIGHT)
		position_title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		position_title.clip_text = true
		position_title.mouse_filter = Control.MOUSE_FILTER_IGNORE
		row.add_child(position_title)
		var arrow := TerminalTheme.label("›", 18, Palette.GREEN, "bold")
		arrow.mouse_filter = Control.MOUSE_FILTER_IGNORE
		row.add_child(arrow)
	box.add_child(TerminalTheme.label(UIStrings.t("map.card_hint_all")
			% positions.size(), 11, Palette.DIM))
	_place_card()

## La scheda insegue il suo pin (come il popup riproiettato del web).
func _place_card() -> void:
	var pin := _find_pin(_selected_key)
	if pin.is_empty() or not is_instance_valid(_card):
		return
	var pos := _to_screen(pin["norm"]) + Vector2(18, -24)
	_card.position = pos.clamp(Vector2(8, 8),
			(size - _card.size - Vector2(8, 8)).max(Vector2(8, 8)))

## Selezione dall'esterno (il click su un pin del globo atterra qui).
func select_key(key: String) -> void:
	_selected_key = key
	_card_signature = ""
	_rebuild_card()
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
	elif event is InputEventMouseMotion:
		if _dragging:
			center -= event.relative / _scale()
			center.y = clampf(center.y, 0.0, 1.0)
			_target_center = center
			queue_redraw()
		else:
			var hover := _pin_near(event.position)
			var key := str(hover.get("key", ""))
			mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND \
					if key != "" else Control.CURSOR_ARROW
			if key != _hover_key:
				_hover_key = key
				queue_redraw()
	elif event is InputEventMagnifyGesture:
		_zoom_at(log(event.factor) / log(2.0) * 1.5, event.position)
	elif event is InputEventPanGesture:
		center -= event.delta * 20.0 / _scale()
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

func _pin_near(pos: Vector2) -> Dictionary:
	var best := {}
	var best_d := 16.0
	for pin in _display_pins():
		var d := _to_screen(pin["norm"]).distance_to(pos)
		if d < best_d:
			best_d = d
			best = pin
	return best

## Click su un pin → vola sulla città E apre la sua scheda (il popup
## del web). Click sul vuoto con la scheda aperta → la chiude.
func _click_pin(pos: Vector2) -> bool:
	var pin := _pin_near(pos)
	if pin.is_empty():
		if _selected_key != "":
			_selected_key = ""
			_rebuild_card()
			queue_redraw()
		return false
	Sfx.play_tick()
	_target_center = pin["norm"]
	if bool(pin.get("is_cluster", false)):
		_selected_key = ""
		_rebuild_card()
		# Un gruppo-paese salta direttamente al livello regionale; un gruppo
		# di prossimità avanza di due livelli. Al click successivo emergeranno
		# città sempre più precise, fino alla scheda finale.
		_target_zoom = clampf(5.2 if _target_zoom < 5.0 \
				else maxf(_target_zoom + 2.0, float(_cluster_cache_zoom + 2)),
				ZOOM_MIN, ZOOM_MAX)
		queue_redraw()
		return true
	# La scheda è già utile senza arrivare automaticamente al livello strada.
	# Mantieni eventuali zoom manuali più ravvicinati, ma da panoramica fermati
	# a un livello regionale/cittadino rapido da caricare.
	_target_zoom = clampf(maxf(_target_zoom, AUTO_CITY_ZOOM), ZOOM_MIN, ZOOM_MAX)
	select_key(str(pin["key"]))
	return true

## Vola a una posizione (per il passaggio dal globo alla mappa).
func fly_to(lonlat: Vector2, z: float) -> void:
	center = lonlat_to_norm(lonlat)
	_target_center = center
	zoom_f = clampf(z, ZOOM_MIN, ZOOM_MAX)
	_target_zoom = zoom_f
	queue_redraw()

## Zoom animato verso un livello, ancorato al centro (post-atterraggio).
func zoom_to(z: float) -> void:
	_target_zoom = clampf(z, ZOOM_MIN, ZOOM_MAX)

## Passo di zoom per il widget +/− della vista Mappa.
func zoom_step(dz: float) -> void:
	_zoom_at(dz, size / 2.0)

## PANORAMICA: inquadra tutti i pin visibili (il fitBounds del web).
func fit_all() -> void:
	if _pins.is_empty():
		fly_to(Vector2(10.0, 47.0), 4.0)  # l'Europa del boot
		return
	var lo := Vector2.INF
	var hi := -Vector2.INF
	for pin in _pins:
		lo = lo.min(pin["norm"] as Vector2)
		hi = hi.max(pin["norm"] as Vector2)
	_target_center = (lo + hi) / 2.0
	var extent := (hi - lo).max(Vector2(0.0005, 0.0005))
	# scala tale che l'estensione occupi ~70% della vista
	var zx := log(size.x * 0.7 / (TILE * extent.x)) / log(2.0)
	var zy := log(size.y * 0.7 / (TILE * extent.y)) / log(2.0)
	_target_zoom = clampf(minf(zx, zy), ZOOM_MIN, 12.0)

## ── Rendering ─────────────────────────────────────────────────────────

func _draw() -> void:
	draw_rect(Rect2(Vector2.ZERO, size), Color(0.045, 0.05, 0.075))
	# livello tile intero più vicino allo zoom frazionale, scalato
	# Scegli il livello superiore e riducilo: ingrandire una tile del livello
	# precedente era la causa delle etichette e delle strade sfocate.
	var base_z := clampi(int(ceil(zoom_f)), 0, TILE_Z_MAX)
	var n := 1 << base_z
	var tile_px := _scale() / float(n)   # dimensione a schermo di una tile
	var tl := _screen_to_norm(Vector2.ZERO) * n
	var br := _screen_to_norm(size) * n
	for x in range(int(floor(tl.x)), int(ceil(br.x)) + 1):
		for y in range(maxi(0, int(floor(tl.y))), mini(n - 1, int(ceil(br.y))) + 1):
			var wx := posmod(x, n)
			var pos := _to_screen(Vector2(float(x) / n, float(y) / n))
			var rect := Rect2(pos, Vector2(tile_px + 0.6, tile_px + 0.6))
			if not _draw_cached_tile_or_ancestor(rect, base_z, wx, y):
				draw_rect(rect, Color(0.07, 0.08, 0.11))
	# pin: prima tutti i punti, poi le targhette SENZA sovrapposizioni
	# (priorità agli score alti — il web clusterizza, noi decolliidiamo)
	var font := TerminalTheme.get_theme().default_font
	var by_score := _display_pins().duplicate()
	by_score.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		return float(a["best"] if a["best"] != null else -1.0) \
				> float(b["best"] if b["best"] != null else -1.0))
	var used_rects: Array = []
	for pin in by_score:
		var pos := _to_screen(pin["norm"])
		if pos.x < -60 or pos.x > size.x + 60 or pos.y < -60 or pos.y > size.y + 60:
			continue
		var col := MapPins.score_color(pin["best"])
		var pr := 5.0 + 1.2 * clampf(log(float(pin["count"]) + 1.0) / log(2.0), 0.0, 4.0)
		# Disco pieno = civico verificato. Anello vuoto = centro città: stessa
		# scala e stesso colore (lo score non cambia), ma il cerchio non ha un
		# centro perché il dato non ce l'ha. I gruppi di prossimità restano
		# pieni: aggregano località, non un indirizzo.
		var approx := not bool(pin.get("is_cluster", false)) \
				and not bool(pin.get("exact", false))
		draw_circle(pos, pr + 1.5, Color(0, 0, 0, 0.6))
		if approx:
			draw_arc(pos, pr - 1.0, 0, TAU, 24, col, 2.0)
		else:
			draw_circle(pos, pr, col)
		draw_arc(pos, pr + 5.0, 0, TAU, 24,
				Color(col.r, col.g, col.b, 0.3 if approx else 0.7), 2.0)
		if str(pin["key"]) == _selected_key:
			draw_arc(pos, pr + 9.0, 0, TAU, 32, Palette.WHITE, 2.0)
		elif str(pin["key"]) == _hover_key:
			draw_arc(pos, pr + 9.0, 0, TAU, 32,
					Color(Palette.WHITE.r, Palette.WHITE.g, Palette.WHITE.b, 0.5), 1.5)
		var text := str(pin["label"])
		if not bool(pin.get("is_cluster", false)) and pin["best"] != null:
			text += "  [%d]" % int(pin["best"])
		var tsize := font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, 14)
		var label_rect := Rect2(pos + Vector2(14, -9), tsize + Vector2(10, 6))
		var collides := false
		for r in used_rects:
			if r.intersects(label_rect):
				collides = true
				break
		if collides:
			continue  # il punto resta, la targhetta cede il posto
		used_rects.append(label_rect)
		draw_rect(label_rect, Color(0.04, 0.05, 0.07, 0.85))
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
				UIStrings.t("map.no_coords") % _no_coords.size(),
				HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Palette.MUTED)
		for i in shown:
			draw_string(font, Vector2(16, y0 + 17 + 18.0 * i), "· " + str(_no_coords[i]),
					HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Palette.DIM)
		if _no_coords.size() > shown:
			draw_string(font, Vector2(16, y0 + 17 + 18.0 * shown),
					"… +%d" % (_no_coords.size() - shown),
					HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Palette.DIM)

## Disegna la tile esatta, oppure la porzione corrispondente del migliore
## antenato già in RAM/disco. Durante un salto di zoom la cartografia resta
## quindi visibile (temporaneamente più morbida) invece di diventare vuota.
func _draw_cached_tile_or_ancestor(rect: Rect2, z: int, x: int, y: int) -> bool:
	for ancestor_z in range(z, -1, -1):
		var levels := z - ancestor_z
		var factor := 1 << levels
		var tex := _tile_texture(ancestor_z, x >> levels, y >> levels, false)
		if tex == null:
			continue
		if levels == 0:
			draw_texture_rect(tex, rect, false)
		else:
			var region_size := TILE / float(factor)
			var sub := Rect2(Vector2(x % factor, y % factor) * region_size,
					Vector2(region_size, region_size))
			draw_texture_rect_region(tex, rect, sub)
		return true
	return false
