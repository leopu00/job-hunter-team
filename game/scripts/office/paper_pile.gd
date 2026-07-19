class_name PaperPile
extends Node2D
## La pila di fogli sulla scrivania (ciclo grafica 11/07): quando un agente
## torna da stampante/inbox in modalità carry, i fogli si ACCUMULANO qui.
## Contratto quantitativo: una posizione in coda = un fascicolo visibile.
## Le code grandi non formano più una torre fino al soffitto: oltre quaranta
## documenti nasce una nuova risma sul tavolo, fino a dodici risme. Se la coda
## supera la capienza nominale, tutte le risme crescono insieme.
##
## GLES3: texture su Sprite2D figlio, primitive _draw solo su self e solo
## in modalità blockout — mai le due cose sullo stesso CanvasItem.

const SHEET_TEX := "res://assets/gen-art/furniture/paper_pile_1.png"
const SHEETS_PER_STACK := 40
const MAX_STACKS := 12
const STACK_COLUMNS := 6
const WIDTH := 38.0
const SHEET_RISE := 1.05
const STACK_X_GAP := 32.0
const STACK_Y_GAP := 30.0

## Le pile degli INBOX di reparto, registrate da office.gd: il flusso
## dei fogli si vede end-to-end (il ritiro svuota l'inbox a monte, la
## sosta all'inbox di casa lo rifornisce). Ripulito a ogni _ready scena.
static var inbox: Dictionary = {}

var count := 0
## Se > 0: media in secondi tra un foglio "arrivato da solo" e l'altro
## (l'upstream digitale che finisce in stampa). Solo per gli inbox.
var restock := 0.0
var _restock_timer := 0.0
## Modalità DATI VERI (missione pipeline 20:1x): la pila insegue un
## target proporzionale al contatore reale della sua fase — un foglio
## alla volta, così il cambiamento si vede. -1 = comportamento simulato.
var _target := -1
var _drift_timer := 0.0
var _sync_hold := 0.0
var _sheet_texture: Texture2D
var _sheets: Array[Sprite2D] = []
var _highlighted := false

## Bersaglio preciso della risma, distinto dalla vaschetta e dalla zona
## reparto. Le coordinate ricevute dalla FreeCamera sono world/global.
func hit_by(point: Vector2) -> bool:
	var tower := _max_stack_height() * SHEET_RISE
	return Rect2(global_position - Vector2(105, 44 + tower),
			Vector2(210, 92 + tower)).has_point(point)

func set_highlight(on: bool) -> void:
	if _highlighted == on:
		return
	_highlighted = on
	for sheet in _sheets:
		sheet.modulate = Color(0.72, 1.0, 0.82) if on else Color.WHITE
	queue_redraw()

static func inbox_at(point: Vector2) -> String:
	for dept_id in inbox:
		var pile: PaperPile = inbox[dept_id]
		if is_instance_valid(pile) and pile.hit_by(point):
			return str(dept_id)
	return ""

static func highlight_inbox(dept_id: String) -> void:
	for key in inbox:
		var pile: PaperPile = inbox[key]
		if is_instance_valid(pile):
			pile.set_highlight(str(key) == dept_id)

## Aggancia la pila al dato vero: spegne il restock finto. I take/add
## dei viaggi restano il teatro del flusso; il drift riporta sempre la
## pila al livello che i contatori reali dicono.
func set_target(n: int, immediate := false, hold_seconds := 0.0) -> void:
	_target = maxi(0, n)
	restock = 0.0
	_sync_hold = maxf(_sync_hold, hold_seconds)
	if immediate:
		count = _target
		_sync_hold = 0.0
		_refresh()
	set_process(true)

func _init(world_position: Vector2) -> void:
	position = world_position
	z_index = 1

func _ready() -> void:
	_restock_timer = restock
	if ResourceLoader.exists(SHEET_TEX):
		_sheet_texture = load(SHEET_TEX)
	_refresh()

func _process(delta: float) -> void:
	if _target >= 0:
		if _sync_hold > 0.0:
			_sync_hold -= delta
			return
		_drift_timer -= delta
		if _drift_timer <= 0.0 and count != _target:
			# Il riallineamento resta osservabile ma raggiunge anche code grandi
			# in pochi secondi, non dopo minuti.
			_drift_timer = randf_range(0.08, 0.16)
			count += signi(_target - count)
			_refresh()
		elif count == _target:
			set_process(false)
		return
	if restock <= 0.0:
		set_process(false)
		return
	_restock_timer -= delta
	if _restock_timer <= 0.0:
		_restock_timer = restock * randf_range(0.7, 1.3)
		add_sheets(1)

func add_sheets(n: int) -> void:
	count = maxi(0, count + n)
	_refresh()

func take_sheet() -> void:
	take_sheets(1)

func take_sheets(n: int) -> void:
	count = maxi(0, count - n)
	_refresh()

func debug_snapshot() -> Dictionary:
	return {"count": count, "target": _target, "visual_sheets": _sheets.size(),
			"visual_stacks": _stack_sizes().size()}

func _stack_sizes() -> Array[int]:
	if count <= 0:
		return []
	var stack_count := mini(MAX_STACKS,
			int(ceil(float(count) / float(SHEETS_PER_STACK))))
	var sizes: Array[int] = []
	var remaining := count
	for _i in stack_count:
		var amount := mini(SHEETS_PER_STACK, remaining)
		sizes.append(amount)
		remaining -= amount
	# Oltre 480 documenti il tavolo resta di dimensione fisica finita: il
	# surplus viene distribuito uniformemente, così nessuna singola torre
	# torna a crescere da sola fino al soffitto.
	var cursor := 0
	while remaining > 0:
		var addition := mini(remaining, stack_count)
		for i in addition:
			sizes[(cursor + i) % stack_count] += 1
		remaining -= addition
		cursor = (cursor + addition) % stack_count
	return sizes

func _stack_base(index: int, total: int) -> Vector2:
	var row := index / STACK_COLUMNS
	var col := index % STACK_COLUMNS
	var rows := int(ceil(float(total) / float(STACK_COLUMNS)))
	var row_count := mini(STACK_COLUMNS, total - row * STACK_COLUMNS)
	var x := (float(col) - float(row_count - 1) / 2.0) * STACK_X_GAP
	var y := (float(row) - float(rows - 1) / 2.0) * STACK_Y_GAP
	return Vector2(x, y)

func _max_stack_height() -> float:
	var maximum := 0
	for amount in _stack_sizes():
		maximum = maxi(maximum, amount)
	return float(maximum)

func _refresh() -> void:
	# Esattamente un nodo-foglio per posizione: la silhouette e il numero
	# raccontano la stessa quantità, anche per una coda da centinaia di job.
	var visible_count := count
	while _sheets.size() < visible_count:
		var sheet := Sprite2D.new()
		sheet.texture = _sheet_texture
		add_child(sheet)
		_sheets.append(sheet)
	while _sheets.size() > visible_count:
		var removed: Sprite2D = _sheets.pop_back()
		removed.queue_free()
	if _sheet_texture:
		var scale_factor: float = WIDTH / _sheet_texture.get_width()
		var stack_sizes := _stack_sizes()
		var sheet_i := 0
		for stack_i in stack_sizes.size():
			var base := _stack_base(stack_i, stack_sizes.size())
			for level in stack_sizes[stack_i]:
				var sheet: Sprite2D = _sheets[sheet_i]
				sheet.texture = _sheet_texture
				sheet.scale = Vector2.ONE * scale_factor
				sheet.position = base + Vector2(
						sin(float(sheet_i) * 2.17) * 1.2,
						-float(level) * SHEET_RISE)
				sheet.rotation = sin(float(sheet_i) * 1.31) * 0.012
				sheet.modulate = Color(0.72, 1.0, 0.82) \
						if _highlighted else Color.WHITE
				sheet_i += 1
	queue_redraw()

func _draw() -> void:
	var tower := _max_stack_height() * SHEET_RISE
	if _highlighted:
		draw_rect(Rect2(Vector2(-105, -44 - tower), Vector2(210, 92 + tower)),
				Color(Palette.GREEN, 0.14))
		draw_rect(Rect2(Vector2(-105, -44 - tower), Vector2(210, 92 + tower)),
				Palette.GREEN, false, 2.0)
	if count <= 0:
		return
	# Numero esatto sempre leggibile: la forma dà l'allarme a colpo d'occhio,
	# la cifra elimina qualsiasi ambiguità quantitativa.
	var label: String = str(count)
	var label_size: Vector2 = ThemeDB.fallback_font.get_string_size(label,
			HORIZONTAL_ALIGNMENT_LEFT, -1, 13)
	var label_pos := Vector2(92, -tower - 28)
	draw_rect(Rect2(label_pos - Vector2(5, 14), label_size + Vector2(10, 7)),
			Color(0.04, 0.04, 0.06, 0.94))
	draw_rect(Rect2(label_pos - Vector2(5, 14), label_size + Vector2(10, 7)),
			Palette.GREEN, false, 1.2)
	draw_string(ThemeDB.fallback_font, label_pos, label,
			HORIZONTAL_ALIGNMENT_LEFT, -1, 13, Palette.GREEN)
