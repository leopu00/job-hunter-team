class_name UsageLoadingVeil
extends Control
## Velo di caricamento per i grafici usage: copre il grafico ospite con
## uno scrim scuro e un'etichetta pulsante, così "sto caricando" si vede
## sul grafico stesso e non in un angolo (feedback Leone 19/07).
## Uso: UsageLoadingVeil.cover(chart) → veil.done() quando i dati arrivano.

var _dots := 0
var _timer: Timer
var _font: Font

static func cover(host: Control) -> UsageLoadingVeil:
	var veil := UsageLoadingVeil.new()
	host.add_child(veil)
	return veil

func _init() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP  # niente hover/click sotto il velo
	z_index = 10

func _ready() -> void:
	_font = load(TerminalTheme.FONT_MEDIUM)
	_timer = Timer.new()
	_timer.wait_time = 0.35
	_timer.timeout.connect(func() -> void:
		_dots = (_dots + 1) % 4
		queue_redraw())
	add_child(_timer)
	_timer.start()

func done() -> void:
	queue_free()

func _draw() -> void:
	draw_rect(Rect2(Vector2.ZERO, size), Color(0.02, 0.022, 0.03, 0.78))
	if not _font:
		return
	# il centraggio usa SOLO il testo base: i puntini si aggiungono a
	# destra senza spostare la scritta (feedback Leone: niente jitter)
	var text := UIStrings.t("usage.loading_veil")
	var w := _font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, 16).x
	var pos := Vector2((size.x - w) / 2.0, size.y / 2.0 - 4.0)
	draw_string(_font, pos, text, HORIZONTAL_ALIGNMENT_LEFT, -1, 16, Palette.GREEN)
	draw_string(_font, pos + Vector2(w, 0), ".".repeat(_dots),
			HORIZONTAL_ALIGNMENT_LEFT, -1, 16, Palette.GREEN)
	# barra di attività sotto la scritta: un segmento che scorre
	var bar_w := minf(220.0, size.x * 0.4)
	var bx := (size.x - bar_w) / 2.0
	var by := size.y / 2.0 + 14.0
	draw_rect(Rect2(Vector2(bx, by), Vector2(bar_w, 3.0)),
			Color(1, 1, 1, 0.08))
	var seg := bar_w * 0.3
	var travel := bar_w - seg
	var t := float(Time.get_ticks_msec() % 1200) / 1200.0
	draw_rect(Rect2(Vector2(bx + travel * t, by), Vector2(seg, 3.0)),
			Palette.GREEN)

func _process(_delta: float) -> void:
	queue_redraw()  # la barra scorre fluida finché il velo è vivo
