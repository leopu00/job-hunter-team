class_name ComicBubble
extends MarginContainer
## Vignetta da fumetto per la chat 1-a-1 con un agente.
##
## Due lati, due code. La vignetta dell'AGENTE ha la coda a destra, perché a
## destra c'è il suo ritratto: la punta parte dall'altezza della testa e si
## allarga scendendo verso il corpo della vignetta, come nei fumetti. Quella
## dell'UTENTE è speculare — coda a sinistra — così a colpo d'occhio si sa chi
## parla senza leggere l'etichetta.
##
## Il colore della vignetta dell'agente NON segue il tema: bianca col testo
## nero, sempre (richiesta esplicita dell'utente 2026-07-28). È il foglio
## stampato del fumetto, e un fumetto non cambia carta quando si spegne la
## luce. Solo la vignetta dell'utente prende un colore dalla Palette e quindi
## si adatta a dark/light.
##
## Il fondo è disegnato con draw_* (stessa scelta di scripts/characters/
## speech_bubble.gd, che è la vignetta sopra la testa degli agenti in
## ufficio); il testo invece resta un RichTextLabel figlio, perché arriva in
## markdown dagli agenti e il word-wrap lo deve fare il motore.

## Punta della coda: quanto sporge oltre il bordo della vignetta.
const TAIL_LEN := 26.0
## Base della coda sul bordo: è la parte "larga" attaccata al corpo.
const TAIL_BASE := 30.0
## Quanto in basso comincia la coda rispetto al bordo superiore: la punta
## nasce all'altezza della testa del personaggio, non a metà vignetta.
const TAIL_TOP := 22.0
const RADIUS := 14.0
const BORDER_W := 2.0
const PAD_X := 20
const PAD_Y := 14

## Vignetta dell'agente: bianco carta e inchiostro nero, in ogni tema.
const PAPER := Color("#ffffff")
const INK := Color("#101014")

var mine := false          # true = l'ha scritta l'utente (coda a sinistra)
var partial := false       # checkpoint "sto lavorando": vignetta smorzata
var _bg := PAPER
var _border := INK
var _body: RichTextLabel


## text: il corpo del messaggio (markdown degli agenti); is_user: chi parla.
func _init(text: String, is_user: bool, is_partial := false) -> void:
	mine = is_user
	partial = is_partial
	if mine:
		# Vignetta dell'utente: distinta e tema-aware. In dark la menta della
		# Palette schiarita fa da carta colorata, in light si scurisce da sé
		# (Palette.MINT cambia col tema) e resta contrastata sull'inchiostro.
		_bg = Palette.MINT.lerp(Color.WHITE, 0.62) if not Palette.is_light() \
				else Palette.MINT.lerp(Color.WHITE, 0.80)
		_border = Palette.MINT.lerp(INK, 0.55)
	if partial:
		_bg = _bg.lerp(Palette.CARD, 0.28)
	# Il testo non entra mai nella fascia della coda: il lato che la ospita
	# paga TAIL_LEN di margine in più.
	add_theme_constant_override("margin_left", PAD_X + (int(TAIL_LEN) if mine else 0))
	add_theme_constant_override("margin_right", PAD_X + (0 if mine else int(TAIL_LEN)))
	add_theme_constant_override("margin_top", PAD_Y)
	add_theme_constant_override("margin_bottom", PAD_Y)
	mouse_filter = Control.MOUSE_FILTER_PASS
	_body = TerminalTheme.markdown_label(text, 16, INK)
	_body.mouse_filter = Control.MOUSE_FILTER_PASS
	add_child(_body)


func _ready() -> void:
	resized.connect(queue_redraw)


## Il testo mostrato, senza markup: serve al self-test per verificare che
## l'ordine delle vignette sia quello della storia.
func text() -> String:
	return _body.get_parsed_text() if _body else ""


## Stato osservabile: colori e verso della coda, cioè esattamente le due cose
## che distinguono la vignetta dell'agente da quella dell'utente.
func debug_snapshot() -> Dictionary:
	return {
		"mine": mine,
		"partial": partial,
		"bg": _bg.to_html(false),
		"fg": INK.to_html(false),
		"tail_dir": -1 if mine else 1,
		"text": text(),
	}


func _draw() -> void:
	var box := Rect2(Vector2.ZERO, size)
	# La coda esce dal riquadro: il corpo si restringe di TAIL_LEN dal lato
	# giusto, così la punta cade dentro il rettangolo del controllo e non
	# viene tagliata dal contenitore.
	if mine:
		box.position.x += TAIL_LEN
		box.size.x -= TAIL_LEN
	else:
		box.size.x -= TAIL_LEN
	var sb := StyleBoxFlat.new()
	sb.bg_color = _bg
	sb.border_color = _border
	sb.set_border_width_all(int(BORDER_W))
	sb.set_corner_radius_all(int(RADIUS))
	draw_style_box(sb, box)
	_draw_tail(box)


## La coda: un triangolo con la BASE sul bordo della vignetta e la PUNTA
## verso il personaggio. Base larga TAIL_BASE, punta a TAIL_LEN di distanza.
## Il bordo si ridisegna sui due lati obliqui e la base viene "ricucita" col
## colore di fondo, altrimenti si vedrebbe la riga del riquadro attraversare
## la coda.
func _draw_tail(box: Rect2) -> void:
	var edge_x := box.position.x if mine else box.end.x
	var tip_x := edge_x - TAIL_LEN if mine else edge_x + TAIL_LEN
	var top := box.position.y + TAIL_TOP
	# Su una vignetta bassa (una parola sola) la base non può sfondare
	# l'angolo arrotondato, ma non può nemmeno rovesciarsi: resta un
	# triangolo, solo più piccolo.
	var bottom := maxf(top + 10.0, minf(top + TAIL_BASE, box.end.y - RADIUS))
	var tip_y := top + 4.0
	var tri := PackedVector2Array([
		Vector2(edge_x, top), Vector2(edge_x, bottom), Vector2(tip_x, tip_y),
	])
	draw_colored_polygon(tri, _bg)
	draw_line(Vector2(edge_x, top), Vector2(tip_x, tip_y), _border, BORDER_W)
	draw_line(Vector2(edge_x, bottom), Vector2(tip_x, tip_y), _border, BORDER_W)
	# ricucitura: copre il tratto di bordo del riquadro coperto dalla coda
	draw_line(Vector2(edge_x, top + BORDER_W), Vector2(edge_x, bottom - BORDER_W),
			_bg, BORDER_W * 1.6)
