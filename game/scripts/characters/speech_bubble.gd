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
var _alpha := 0.0
var _target_alpha := 0.0
var _hold := 0.0                 # tempo di lettura residuo del messaggio corrente
var _gap := 0.0
var _font: Font
var _font_med: Font
var _current_text := ""
var _dropped := 0

func _ready() -> void:
	_font = load(TerminalTheme.FONT_REGULAR)
	_font_med = load(TerminalTheme.FONT_MEDIUM)
	z_index = 60  # sopra gli StatusBubble: il parlato vince sullo stato

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

func is_speaking() -> bool:
	return _hold > 0.0 or not _queue.is_empty()

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
	}

func _process(delta: float) -> void:
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
		while _width(word) > MAX_TEXT_W:  # parola più larga della vignetta
			if line != "":
				out.append(line)
				line = ""
			var cut := word.length()
			while cut > 1 and _width(word.left(cut)) > MAX_TEXT_W:
				cut -= 1
			out.append(word.left(cut))
			word = word.substr(cut)
		var probe := word if line.is_empty() else line + " " + word
		if _width(probe) > MAX_TEXT_W:
			out.append(line)
			line = word
		else:
			line = probe
	if line != "":
		out.append(line)
	return out

func _width(s: String) -> float:
	return _font.get_string_size(s, HORIZONTAL_ALIGNMENT_LEFT, -1, FONT_SIZE).x

func _draw() -> void:
	if _alpha <= 0.01 or _lines.is_empty():
		return
	var line_h := _font.get_height(FONT_SIZE) + LINE_GAP
	var w := 0.0
	for l in _lines:
		w = maxf(w, _width(l))
	var to_h := 0.0
	if _to_label != "":
		to_h = _font_med.get_height(TO_SIZE) + 2.0
		w = maxf(w, _font_med.get_string_size("→ " + _to_label,
				HORIZONTAL_ALIGNMENT_LEFT, -1, TO_SIZE).x)
	var h := _lines.size() * line_h - LINE_GAP + to_h
	var box := Rect2(Vector2(-w / 2.0 - PAD.x, -h - PAD.y * 2.0 - 12.0),
			Vector2(w + PAD.x * 2.0, h + PAD.y * 2.0))
	box.position.y += (1.0 - _alpha) * 5.0  # slide-in come lo StatusBubble
	var bg := Color(Palette.CARD.r, Palette.CARD.g, Palette.CARD.b, 0.96 * _alpha)
	var border := Color(Palette.GREEN.r, Palette.GREEN.g, Palette.GREEN.b, 0.75 * _alpha)
	draw_rect(box, bg)
	draw_rect(box, border, false, 1.0)
	var tail := PackedVector2Array([
		Vector2(-5, box.end.y), Vector2(5, box.end.y), Vector2(0, box.end.y + 7),
	])
	draw_colored_polygon(tail, bg)
	draw_line(Vector2(-5, box.end.y), Vector2(0, box.end.y + 7), border, 1.0)
	draw_line(Vector2(5, box.end.y), Vector2(0, box.end.y + 7), border, 1.0)
	var pen := box.position + Vector2(PAD.x, PAD.y)
	if _to_label != "":
		pen.y += _font_med.get_height(TO_SIZE) - 3.0
		draw_string(_font_med, pen, "→ " + _to_label,
				HORIZONTAL_ALIGNMENT_LEFT, -1, TO_SIZE,
				Color(Palette.MUTED.r, Palette.MUTED.g, Palette.MUTED.b, _alpha))
		pen.y += 5.0
	for l in _lines:
		pen.y += _font.get_height(FONT_SIZE) - 3.0
		draw_string(_font, pen, l, HORIZONTAL_ALIGNMENT_LEFT, -1, FONT_SIZE,
				Color(Palette.BRIGHT.r, Palette.BRIGHT.g, Palette.BRIGHT.b, _alpha))
		pen.y += LINE_GAP - 2.0
