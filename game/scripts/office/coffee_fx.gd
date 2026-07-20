class_name CoffeeFx
extends Node2D
## Vapore sopra l'angolo caffè quando qualcuno è davvero in pausa
## (ping dal leg caffè di AgentNPC, stesso pattern di PrinterFx).
## Solo primitive _draw (gotcha GLES3).

static var instance: CoffeeFx

var _busy := 0.0
var _was_busy := false
var _t := 0.0

func _init(bar_rect: Rect2) -> void:
	# lo sprite della macchina si estende ben sopra il rect di appoggio:
	# il vapore parte dall'altezza del beccuccio, non dal pavimento
	position = Vector2(bar_rect.get_center().x, bar_rect.position.y - 50)
	z_index = 1
	instance = self

## Qualcuno si è versato un caffè: vapore per la durata della pausa.
static func ping(secs: float) -> void:
	if instance:
		instance._busy = maxf(instance._busy, secs)
		instance.set_process(true)

func _process(delta: float) -> void:
	_t += delta
	if _busy > 0.0:
		_busy -= delta
		_was_busy = true
		queue_redraw()
	elif _was_busy:
		_was_busy = false
		queue_redraw()  # un ultimo frame per pulire il vapore
	else:
		set_process(false)  # a riposo dorme: lo risveglia il prossimo ping

func _draw() -> void:
	if _busy <= 0.0:
		return
	# tre volute sfasate che salgono e svaniscono: la camera è lontana,
	# quindi raggio/alpha generosi o il vapore sparisce a scala di gioco
	for i in 3:
		var k := fmod(_t * 0.6 + i * 0.33, 1.0)
		var p := Vector2(sin((_t + i * 2.1) * 2.4) * 8.0 + (i - 1) * 16.0,
				-14.0 - k * 58.0)
		draw_circle(p, 7.0 + k * 7.0, Color(0.95, 0.95, 1.0, 0.7 * (1.0 - k * 0.85)))
