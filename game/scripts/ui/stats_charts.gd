class_name StatsCharts
extends VBoxContainer
## I grafici linked della dashboard web (DashboardLinkedCharts) sui dati
## VERI: tipi, score, paesi, città, stipendi — ogni grafico è filtro e
## vista insieme (cross-filter). Regola del web mantenuta: ogni grafico
## è scoped dai filtri delle ALTRE dimensioni, mai dalla propria, così
## selezionare una barra non fa sparire le sue sorelle.

signal open_position(id: int)

## Stesse costanti del web (DashboardLinkedCharts.tsx).
const SCORE_BIN := 5
const SALARY_BIN := 20000.0
const SALARY_MIN_EUR := 10000.0
const SALARY_MAX_EUR := 300000.0
const CITY_MAX := 12       # città mostrate (il web scrolla, noi tagliamo)
const MATCH_MAX := 8       # posizioni elencate sotto i grafici
const BAR_W := 220.0       # larghezza massima della barra

## Selezioni per dimensione (vuoto = dimensione non attiva). Vivono nel
## nodo: sopravvivono ai refresh del bus, si azzerano riaprendo la vista.
var _sel := {
	"family": [], "country": [], "city": [], "score": [], "salary": [],
}

func _ready() -> void:
	size_flags_horizontal = Control.SIZE_EXPAND_FILL
	add_theme_constant_override("separation", 12)
	_rebuild()
	BackendBus.positions_updated.connect(func(_l: Array) -> void:
		if is_instance_valid(self):
			_rebuild())
	# TEST-AUTO: JHT_STATS_TOGGLE="dim:chiave" attiva un filtro all'avvio
	# (es. "country:Germany", "score:80") per gli shot del cross-filter.
	var tog := OS.get_environment("JHT_STATS_TOGGLE")
	if tog.contains(":"):
		var dim := tog.split(":")[0]
		var key := tog.substr(dim.length() + 1)
		if _sel.has(dim):
			_toggle(dim, int(key) if ["score", "salary"].has(dim) else key)


## ── Chiavi canoniche (identiche al web: cross-filter coerente) ────────

static func _family_key(p: Dictionary) -> String:
	var v := str(p.get("role_family", "") if p.get("role_family") != null else "").strip_edges()
	return v if v != "" else UIStrings.t("pos.uncategorized")

static func _country_key(p: Dictionary) -> String:
	var v := str(p.get("loc_country", "") if p.get("loc_country") != null else "").strip_edges()
	return v if v != "" else UIStrings.t("stats.no_country")

static func _city_key(p: Dictionary) -> String:
	var city := str(p.get("loc_city", "") if p.get("loc_city") != null else "").strip_edges()
	return _country_key(p) + "|" + (city if city != "" else "~")

## Punto medio del range stipendio SEMPRE in EUR (il binning non deve
## dipendere dalla valuta): estimated se c'è, altrimenti declared.
## -1.0 = assente, tasso mancante o fuori sanity (come il web).
static func _salary_eur(p: Dictionary) -> float:
	var lo: Variant = p.get("salary_estimated_min")
	var hi: Variant = p.get("salary_estimated_max")
	var cur := str(p.get("salary_estimated_currency", "") if p.get("salary_estimated_currency") != null else "")
	if lo == null and hi == null:
		lo = p.get("salary_declared_min")
		hi = p.get("salary_declared_max")
		cur = str(p.get("salary_declared_currency", "") if p.get("salary_declared_currency") != null else "")
	var v: float
	if lo != null and hi != null:
		v = (float(lo) + float(hi)) / 2.0
	elif lo != null:
		v = float(lo)
	elif hi != null:
		v = float(hi)
	else:
		return -1.0
	var eur := BackendBus.to_eur(v, cur)
	if eur < SALARY_MIN_EUR or eur >= SALARY_MAX_EUR:
		return -1.0
	return eur


## ── Predicati cross-filter (mirror del web) ───────────────────────────

## L'universo attivo: mai le escluse.
func _rows() -> Array:
	var out: Array = []
	for p in SimBadge.visible_positions():
		if str(p.get("status", "")) != "excluded":
			out.append(p)
	return out

func _pass(p: Dictionary, exclude: String) -> bool:
	if exclude != "family" and not _sel["family"].is_empty() \
			and not _sel["family"].has(_family_key(p)):
		return false
	# paese+città sono UNA dimensione location (OR fra loro, come il web)
	if exclude != "location":
		var loc_active: bool = not _sel["country"].is_empty() or not _sel["city"].is_empty()
		if loc_active and not _sel["city"].has(_city_key(p)) \
				and not _sel["country"].has(_country_key(p)):
			return false
	if exclude != "score" and not _sel["score"].is_empty():
		var s: Variant = p.get("total_score")
		if s == null or float(s) <= 0.0:
			return false
		var hit := false
		for lo in _sel["score"]:
			if float(s) >= float(lo) and float(s) < float(lo) + SCORE_BIN:
				hit = true
				break
		if not hit:
			return false
	if exclude != "salary" and not _sel["salary"].is_empty():
		var v := _salary_eur(p)
		if v < 0.0:
			return false
		var hit_s := false
		for lo in _sel["salary"]:
			if v >= float(lo) and v < float(lo) + SALARY_BIN:
				hit_s = true
				break
		if not hit_s:
			return false
	return true

## Gerarchia paese→città: la lista Città è ristretta ai paesi scelti.
func _pass_selected_country(p: Dictionary) -> bool:
	return _sel["country"].is_empty() or _sel["country"].has(_country_key(p))

func _active_count() -> int:
	var n := 0
	for dim in _sel:
		n += _sel[dim].size()
	return n


## ── Costruzione ───────────────────────────────────────────────────────

func _toggle(dim: String, key: Variant) -> void:
	if _sel[dim].has(key):
		_sel[dim].erase(key)
	else:
		_sel[dim].append(key)
	_rebuild()

func _rebuild() -> void:
	for child in get_children():
		child.queue_free()
	var rows := _rows()
	if rows.is_empty():
		add_child(TerminalTheme.label(UIStrings.t("stats.need_vps"), 14, Palette.DIM))
		return

	# barra filtri attivi + azzera
	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", 14)
	add_child(head)
	var act := _active_count()
	head.add_child(TerminalTheme.label(
			UIStrings.t("stats.filters") % act if act > 0
			else UIStrings.t("stats.hint"), 13,
			Palette.YELLOW if act > 0 else Palette.DIM))
	if act > 0:
		var reset := Button.new()
		reset.flat = true
		reset.text = UIStrings.t("stats.reset")
		reset.add_theme_font_size_override("font_size", 13)
		reset.add_theme_color_override("font_color", Palette.RED)
		reset.pressed.connect(func() -> void:
			for dim in _sel:
				_sel[dim].clear()
			_rebuild())
		head.add_child(reset)

	# due colonne: sinistra tipi/paesi/città, destra score/stipendi/match
	var cols := HBoxContainer.new()
	cols.add_theme_constant_override("separation", 36)
	cols.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	add_child(cols)
	var left := VBoxContainer.new()
	left.add_theme_constant_override("separation", 12)
	left.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	cols.add_child(left)
	var right := VBoxContainer.new()
	right.add_theme_constant_override("separation", 12)
	right.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	cols.add_child(right)

	_block_families(left, rows)
	_block_countries(left, rows)
	_block_cities(left, rows)
	_block_score(right, rows)
	_block_salary(right, rows)
	_block_matches(right, rows)

## Il donut dei tipi: archi proporzionali + legenda cliccabile accanto.
class DonutChart:
	extends Control
	var slices: Array = []  # [{count: int, color: Color, selected: bool}]

	func _init() -> void:
		custom_minimum_size = Vector2(150, 150)

	func _draw() -> void:
		var total := 0
		for s in slices:
			total += int(s["count"])
		if total == 0:
			return
		var center := size / 2.0
		var radius := minf(center.x, center.y) - 16.0
		var start := -PI / 2.0
		for s in slices:
			var sweep := TAU * float(s["count"]) / float(total)
			var col: Color = s["color"]
			if not bool(s["selected"]):
				col = Color(col.r, col.g, col.b, 0.45)
			# -0.02 di respiro fra le fette: si leggono come spicchi
			draw_arc(center, radius, start + 0.02, start + sweep - 0.02,
					maxi(8, int(sweep * 24.0)), col, 26.0, true)
			start += sweep

## Tipi (role_family) — donut come sul web; scope: location+score+salary.
func _block_families(into: VBoxContainer, rows: Array) -> void:
	var counts := {}
	for p in rows:
		if _pass(p, "family"):
			counts[_family_key(p)] = int(counts.get(_family_key(p), 0)) + 1
	into.add_child(TerminalTheme.label(UIStrings.t("stats.types"),
			14, Palette.MUTED, "medium"))
	if counts.is_empty():
		into.add_child(TerminalTheme.label(UIStrings.t("stats.empty"), 13, Palette.DIM))
		return
	var keys: Array = counts.keys()
	keys.sort_custom(func(a: Variant, b: Variant) -> bool:
		return int(counts[a]) > int(counts[b]))
	var any_sel: bool = not _sel["family"].is_empty()
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 20)
	into.add_child(row)
	var donut := DonutChart.new()
	var legend := VBoxContainer.new()
	legend.add_theme_constant_override("separation", 2)
	legend.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	for i in keys.size():
		var k: Variant = keys[i]
		var colors := Palette.accent_cycle()
		var color: Color = colors[i % colors.size()]
		var selected: bool = _sel["family"].has(k)
		donut.slices.append({"count": int(counts[k]), "color": color,
				"selected": selected or not any_sel})
		var btn := Button.new()
		btn.flat = true
		btn.alignment = HORIZONTAL_ALIGNMENT_LEFT
		btn.clip_text = true
		btn.text = "%s %s%s  ·  %d" % ["▰" if selected or not any_sel else "▱",
				"▸ " if selected else "", str(k), int(counts[k])]
		btn.add_theme_font_size_override("font_size", 13)
		btn.add_theme_color_override("font_color",
				color if selected or not any_sel else Palette.DIM)
		btn.add_theme_color_override("font_hover_color", Palette.MINT)
		btn.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
		var key: Variant = k
		btn.pressed.connect(func() -> void: _toggle("family", key))
		legend.add_child(btn)
	row.add_child(donut)
	row.add_child(legend)

## Paesi — scope: family + score + salary (location esclusa).
func _block_countries(into: VBoxContainer, rows: Array) -> void:
	var counts := {}
	for p in rows:
		if _pass(p, "location"):
			counts[_country_key(p)] = int(counts.get(_country_key(p), 0)) + 1
	var plain := func(k: Variant) -> String: return str(k)
	_bar_block(into, UIStrings.t("stats.countries"), counts, "country", plain)

## Città — scope: family + score + salary + paesi scelti (gerarchia).
func _block_cities(into: VBoxContainer, rows: Array) -> void:
	var counts := {}
	var no_city := 0
	for p in rows:
		if not _pass(p, "location") or not _pass_selected_country(p):
			continue
		var city := str(p.get("loc_city", "") if p.get("loc_city") != null else "").strip_edges()
		if city == "":
			no_city += 1
			continue
		counts[_city_key(p)] = int(counts.get(_city_key(p), 0)) + 1
	var city_label := func(k: Variant) -> String:
		var parts := str(k).split("|")
		return "%s · %s" % [parts[1], parts[0]]
	_bar_block(into, UIStrings.t("stats.cities"), counts, "city", city_label, CITY_MAX)
	if no_city > 0:
		into.add_child(TerminalTheme.label(
				UIStrings.t("stats.no_city") % no_city, 13, Palette.DIM))

## Score in fasce da 5 — scope: location + family + salary.
func _block_score(into: VBoxContainer, rows: Array) -> void:
	var counts := {}
	for p in rows:
		if not _pass(p, "score"):
			continue
		var s: Variant = p.get("total_score")
		if s == null or float(s) <= 0.0:
			continue
		var lo := int(floor(float(s) / SCORE_BIN) * SCORE_BIN)
		counts[lo] = int(counts.get(lo, 0)) + 1
	var bin_label := func(k: Variant) -> String:
		return "%d–%d" % [int(k), int(k) + SCORE_BIN]
	_bar_block(into, UIStrings.t("stats.scores"), counts, "score", bin_label, 0, true)

## Stipendi in fasce da 20k EUR — scope: family + location + score.
func _block_salary(into: VBoxContainer, rows: Array) -> void:
	var counts := {}
	for p in rows:
		if not _pass(p, "salary"):
			continue
		var v := _salary_eur(p)
		if v < 0.0:
			continue
		var lo := int(floor(v / SALARY_BIN) * SALARY_BIN)
		counts[lo] = int(counts.get(lo, 0)) + 1
	var band_label := func(k: Variant) -> String:
		return "%dk–%dk €" % [int(int(k) / 1000.0), int((int(k) + SALARY_BIN) / 1000.0)]
	_bar_block(into, UIStrings.t("stats.salaries"), counts, "salary", band_label, 0, true)

## Le posizioni che passano TUTTI i filtri: conteggio + prime N cliccabili.
func _block_matches(into: VBoxContainer, rows: Array) -> void:
	var matches: Array = []
	for p in rows:
		if _pass(p, ""):
			matches.append(p)
	into.add_child(TerminalTheme.label(
			UIStrings.t("stats.matches") % matches.size(), 14, Palette.MUTED, "medium"))
	for i in mini(matches.size(), MATCH_MAX):
		var p: Dictionary = matches[i]
		var score_v: Variant = p.get("total_score")
		var btn := Button.new()
		btn.flat = true
		btn.alignment = HORIZONTAL_ALIGNMENT_LEFT
		btn.clip_text = true
		btn.text = "%s  %s — %s" % ["—" if score_v == null else str(int(score_v)),
				str(p.get("title", "?")), str(p.get("company", "?"))]
		btn.add_theme_font_size_override("font_size", 13)
		btn.add_theme_color_override("font_color", Palette.BASE)
		btn.add_theme_color_override("font_hover_color", Palette.GREEN)
		btn.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
		var pid := int(p.get("id", 0))
		btn.pressed.connect(func() -> void: open_position.emit(pid))
		into.add_child(btn)
	if matches.size() > MATCH_MAX:
		into.add_child(TerminalTheme.label(
				UIStrings.t("common.more") % (matches.size() - MATCH_MAX), 13, Palette.DIM))

## Un blocco di barre orizzontali cliccabili: titolo + una riga per voce
## (etichetta, barra proporzionale, conteggio). numeric_keys ordina per
## chiave (fasce), altrimenti per conteggio decrescente come il web.
func _bar_block(into: VBoxContainer, title: String, counts: Dictionary,
		dim: String, labeler: Callable, cap := 0, numeric_keys := false) -> void:
	into.add_child(TerminalTheme.label(title, 14, Palette.MUTED, "medium"))
	if counts.is_empty():
		into.add_child(TerminalTheme.label(UIStrings.t("stats.empty"), 13, Palette.DIM))
		return
	var keys: Array = counts.keys()
	if numeric_keys:
		keys.sort()
	else:
		keys.sort_custom(func(a: Variant, b: Variant) -> bool:
			return int(counts[a]) > int(counts[b]))
	if cap > 0 and keys.size() > cap:
		keys = keys.slice(0, cap)
	var max_count := 1
	for k in keys:
		max_count = maxi(max_count, int(counts[k]))
	for k in keys:
		var selected: bool = _sel[dim].has(k)
		var row := HBoxContainer.new()
		row.add_theme_constant_override("separation", 10)
		into.add_child(row)
		var btn := Button.new()
		btn.flat = true
		btn.alignment = HORIZONTAL_ALIGNMENT_LEFT
		btn.clip_text = true
		btn.text = ("▸ " if selected else "") + labeler.call(k)
		btn.custom_minimum_size = Vector2(240, 0)
		btn.add_theme_font_size_override("font_size", 13)
		btn.add_theme_color_override("font_color",
				Palette.GREEN if selected else Palette.BASE)
		btn.add_theme_color_override("font_hover_color", Palette.MINT)
		btn.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
		var key: Variant = k
		btn.pressed.connect(func() -> void: _toggle(dim, key))
		row.add_child(btn)
		var bar := ColorRect.new()
		bar.color = Palette.GREEN if selected else Palette.BORDER_GLOW
		bar.custom_minimum_size = Vector2(
				maxf(3.0, BAR_W * float(counts[k]) / float(max_count)), 12)
		bar.size_flags_vertical = Control.SIZE_SHRINK_CENTER
		row.add_child(bar)
		row.add_child(TerminalTheme.label(str(counts[k]), 13, Palette.MUTED))
