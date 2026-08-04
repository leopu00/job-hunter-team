class_name SpeechBubble
extends Node2D
## Vignetta di PARLATO sopra la testa di un agente: rende visibile la chat
## reale del team (tmux sulla VPS) come fumetti. Distinta dallo StatusBubble
## (che mostra lo stato): multi-linea con word-wrap, coda FIFO per le
## raffiche, riga destinatario quando il messaggio non è un broadcast.

const FONT_SIZE := 14     # leggibile anche a zoom medio (ordine 03:3x)
const TO_SIZE := 12
const PAD := Vector2(9, 6)
const MAX_TEXT_W := 220.0
const LINE_GAP := 3.0
const GAP_BETWEEN := 0.3  # respiro tra due messaggi in coda
# Un minuto minimo per messaggio rende inevitabile una coda lunga durante i
# burst del team reale. Quattro elementi perdevano quasi subito comunicazioni;
# 32 copre una raffica intensa senza lasciare una backlog illimitata in RAM.
const MAX_QUEUE := 32
const MAX_CHARS := 140    # mai più pannelli che coprono interi reparti
const MIN_HOLD := 60.0    # la chat vera resta leggibile almeno un minuto

var _queue: Array = []           # [{text, to_label}]
var _lines := PackedStringArray()
var _to_label := ""
var _speaker_label := ""
var _alpha := 0.0
var _target_alpha := 0.0
var _hold := 0.0                 # tempo di lettura residuo del messaggio corrente
var _gap := 0.0
var _font: Font
var _font_med: Font
var _current_text := ""
var _dropped := 0
# Corpi effettivi: sotto scala 1 compensati da text_boost per restare
# leggibili sugli schermi 1366x768 (feedback Leone 22/07).
var _fs := FONT_SIZE
var _to_fs := TO_SIZE
var _max_w := MAX_TEXT_W
var _boost := 1.0  # compensazione della scala di rendering del mondo
var _layout_offset := Vector2.ZERO
var _layout_target := Vector2.ZERO

func _ready() -> void:
	_font = load(TerminalTheme.FONT_REGULAR)
	_font_med = load(TerminalTheme.FONT_MEDIUM)
	z_index = 60  # sopra gli StatusBubble: il parlato vince sullo stato
	# Registrandosi il nodo riceve subito la misura giusta per la scala in corso.
	WorldText.mark(self)  # la chat del team si legge sempre, a ogni risoluzione

## Rimisura la vignetta quando cambia la scala del mondo. Il testo già a schermo
## va ri-mandato a capo: la larghezza massima è cresciuta con lui, e senza
## rifare il wrap le righe resterebbero spezzate come prima — mezza vignetta
## vuota e frasi tronche.
func refresh_world_text() -> void:
	_boost = WorldText.boost()
	var boost := TerminalTheme.text_boost() * _boost
	_fs = int(round(FONT_SIZE * boost))
	_to_fs = int(round(TO_SIZE * boost))
	_max_w = MAX_TEXT_W * boost
	if not _current_text.is_empty():
		_lines = _wrap(_current_text)
	queue_redraw()

## Accoda un messaggio. to_label: "" = broadcast, altrimenti il nome
## del destinatario mostrato come riga "→ <nome>" sopra il testo.
func say(text: String, to_label := "") -> void:
	var clean := text.strip_edges()
	if clean.is_empty():
		return
	if clean.length() > MAX_CHARS:
		clean = clean.left(MAX_CHARS - 1).strip_edges() + "…"
	_queue.append({"text": clean, "to_label": to_label})
	while _queue.size() > MAX_QUEUE:
		_queue.pop_front()
		_dropped += 1

func clear_now() -> void:
	_queue.clear()
	_hold = 0.0
	_target_alpha = 0.0

func set_speaker_label(value: String) -> void:
	_speaker_label = value.strip_edges().left(36)
	queue_redraw()

func is_speaking() -> bool:
	# Include il breve fade-out: lo stato ordinario non deve ricomparire sotto
	# una vignetta ancora visibile, nemmeno per uno o due frame.
	return _hold > 0.0 or not _queue.is_empty() or _alpha > 0.02

## Stato osservabile per self-test e diagnostica. Non altera il timer e non
## espone i nodi di rendering ai chiamanti.
func debug_snapshot() -> Dictionary:
	return {
		"queue_depth": _queue.size(),
		"queue_capacity": MAX_QUEUE,
		"current_text": _current_text,
		"hold_sec": _hold,
		"min_hold_sec": MIN_HOLD,
		"alpha": _alpha,
		"target_alpha": _target_alpha,
		"dropped": _dropped,
		# misure del testo: il selftest della leggibilità verifica che crescano
		# con la scala del mondo senza cambiare l'impaginazione
		"lines": _lines.size(),
		"font_size": _fs,
		"max_width": _max_w,
		"layout_offset": _layout_offset,
		"speaker_label": _speaker_label,
	}

## Contratto col layout dell'ufficio. La box base non include l'offset già
## assegnato, così il packing riparte sempre dall'ancoraggio naturale e non
## accumula spostamenti a ogni passaggio.
func layout_visible() -> bool:
	return not _lines.is_empty() and (_alpha > 0.01 or _target_alpha > 0.01)

func layout_rect_global(include_current_offset := false) -> Rect2:
	if not layout_visible():
		return Rect2()
	var local := _bubble_rect(false)
	if include_current_offset:
		local.position += _layout_offset
	var a := to_global(local.position)
	var b := to_global(local.end)
	var top_left := Vector2(minf(a.x, b.x), minf(a.y, b.y))
	return Rect2(top_left, Vector2(absf(b.x - a.x), absf(b.y - a.y)))

func set_layout_offset(value: Vector2, immediate := false) -> void:
	if value.is_equal_approx(_layout_target) \
			and (not immediate or value.is_equal_approx(_layout_offset)):
		return
	_layout_target = value
	if immediate:
		_layout_offset = value
	queue_redraw()

func _process(delta: float) -> void:
	var previous_offset := _layout_offset
	_layout_offset = _layout_offset.move_toward(_layout_target, delta * 520.0)
	if not _layout_offset.is_equal_approx(previous_offset):
		queue_redraw()
	if _hold > 0.0:
		_hold -= delta
		if _hold <= 0.0:
			_target_alpha = 0.0
	elif not _queue.is_empty():
		# aspetta che il fumetto precedente sia svanito, più un respiro
		if _alpha <= 0.02:
			_gap -= delta
			if _gap <= 0.0:
				_next_message()
	var prev := _alpha
	_alpha = move_toward(_alpha, _target_alpha, delta * 7.0)
	if _alpha != prev:
		queue_redraw()

func _next_message() -> void:
	var m: Dictionary = _queue.pop_front()
	_current_text = str(m["text"])
	_lines = _wrap(_current_text)
	_to_label = m["to_label"]
	# la chat REALE va letta con calma: hold lungo, mai sotto MIN_HOLD
	# (ordine 03:3x: vignette simultanee, nessuna corsa a leggerle)
	_hold = maxf(MIN_HOLD, 2.2 + _current_text.length() * 0.05)
	_gap = GAP_BETWEEN
	_target_alpha = 1.0
	queue_redraw()

## Word-wrap a parole entro MAX_TEXT_W (spezza le parole-monstre).
func _wrap(text: String) -> PackedStringArray:
	var out := PackedStringArray()
	var line := ""
	for word in text.split(" ", false):
		while _width(word) > _max_w:  # parola più larga della vignetta
			if line != "":
				out.append(line)
				line = ""
			var cut := word.length()
			while cut > 1 and _width(word.left(cut)) > _max_w:
				cut -= 1
			out.append(word.left(cut))
			word = word.substr(cut)
		var probe := word if line.is_empty() else line + " " + word
		if _width(probe) > _max_w:
			out.append(line)
			line = word
		else:
			line = probe
	if line != "":
		out.append(line)
	return out

func _width(s: String) -> float:
	return _font.get_string_size(s, HORIZONTAL_ALIGNMENT_LEFT, -1, _fs).x

func _draw() -> void:
	if _alpha <= 0.01 or _lines.is_empty():
		return
	var box := _bubble_rect(true)
	box.position += _layout_offset
	# Tutte le quote della vignetta seguono il testo (_boost): riquadro, codino,
	# interlinea e respiro crescono insieme al corpo, così la forma è identica a
	# qualunque scala di rendering del mondo — solo più grande dove serve.
	var pad := PAD * _boost
	var gap := LINE_GAP * _boost
	var bg := Color(Palette.CARD.r, Palette.CARD.g, Palette.CARD.b, 0.96 * _alpha)
	var border := Color(Palette.GREEN.r, Palette.GREEN.g, Palette.GREEN.b, 0.75 * _alpha)
	draw_rect(box, bg)
	draw_rect(box, border, false, 1.0 * _boost)
	var tail_w := 5.0 * _boost
	var tail_h := 7.0 * _boost
	var tail_x := _layout_offset.x
	var tail := PackedVector2Array([
		Vector2(tail_x - tail_w, box.end.y), Vector2(tail_x + tail_w, box.end.y),
		Vector2(tail_x, box.end.y + tail_h),
	])
	draw_colored_polygon(tail, bg)
	draw_line(Vector2(tail_x - tail_w, box.end.y),
			Vector2(tail_x, box.end.y + tail_h), border, 1.0 * _boost)
	draw_line(Vector2(tail_x + tail_w, box.end.y),
			Vector2(tail_x, box.end.y + tail_h), border, 1.0 * _boost)
	var pen := box.position + pad
	var header := _header_text()
	if header != "":
		pen.y += _font_med.get_height(_to_fs) - 3.0 * _boost
		draw_string(_font_med, pen, header,
				HORIZONTAL_ALIGNMENT_LEFT, -1, _to_fs,
				Color(Palette.GREEN.r, Palette.GREEN.g, Palette.GREEN.b, _alpha))
		pen.y += 5.0 * _boost
	for l in _lines:
		pen.y += _font.get_height(_fs) - 3.0 * _boost
		draw_string(_font, pen, l, HORIZONTAL_ALIGNMENT_LEFT, -1, _fs,
				Color(Palette.BRIGHT.r, Palette.BRIGHT.g, Palette.BRIGHT.b, _alpha))
		pen.y += gap - 2.0 * _boost


func _bubble_rect(include_slide: bool) -> Rect2:
	var pad := PAD * _boost
	var gap := LINE_GAP * _boost
	var line_h := _font.get_height(_fs) + gap
	var w := 0.0
	for line in _lines:
		w = maxf(w, _width(line))
	var header_h := 0.0
	var header := _header_text()
	if header != "":
		header_h = _font_med.get_height(_to_fs) + 2.0 * _boost
		w = maxf(w, _font_med.get_string_size(header,
				HORIZONTAL_ALIGNMENT_LEFT, -1, _to_fs).x)
	var h := _lines.size() * line_h - gap + header_h
	var box := Rect2(Vector2(-w / 2.0 - pad.x,
			-h - pad.y * 2.0 - 12.0 * _boost),
			Vector2(w + pad.x * 2.0, h + pad.y * 2.0))
	if include_slide:
		box.position.y += (1.0 - _alpha) * 5.0 * _boost
	return box


func _header_text() -> String:
	if _speaker_label == "":
		return "→ " + _to_label if _to_label != "" else ""
	return _speaker_label.to_upper() + ("  →  " + _to_label if _to_label != "" else "")
