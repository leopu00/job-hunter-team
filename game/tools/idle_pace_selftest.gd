extends SceneTree
## Contratto del ritmo di disegno a riposo (scripts/idle_pace.gd).
##
## Le tre promesse che questo test tiene ferme:
##  1. in primo piano non si tocca NIENTE, e al ritorno si rimette il tetto che
##     c'era — non un 60 di comodo (chi ha il profilo ridotto gira a 30);
##  2. il freno è un freno: non alza mai i fps sopra il tetto in vigore;
##  3. a ritmo ridotto il TEMPO DI GIOCO non si dilata — i passi di fisica per
##     frame crescono quanto basta a coprire l'intervallo, altrimenti il motore
##     butta il tempo in eccesso e la scena rallenta per davvero.

const IdlePaceScript = preload("res://scripts/idle_pace.gd")

var _failures: Array[String] = []


func _init() -> void:
	var was_fps := Engine.max_fps
	var was_steps := Engine.max_physics_steps_per_frame

	_check_policy()
	_check_transitions(60, 8)
	# Profilo grafico ridotto: il primo piano vale 30 fps e va restituito così.
	_check_transitions(30, 8)
	_check_notifications()

	Engine.max_fps = was_fps
	Engine.max_physics_steps_per_frame = was_steps

	if _failures.is_empty():
		print("IDLE-PACE-TEST PASS")
		quit(0)
		return
	for failure in _failures:
		push_error("[idle-pace-test] " + failure)
	print("IDLE-PACE-TEST FAIL")
	quit(1)


func _check_policy() -> void:
	_assert(IdlePaceScript.fps_for(IdlePaceScript.Pace.FOREGROUND, 60) == 60,
			"il primo piano non ha tetto proprio")
	_assert(IdlePaceScript.fps_for(IdlePaceScript.Pace.BACKGROUND, 60) == 10,
			"secondo piano a 10 fps")
	_assert(IdlePaceScript.fps_for(IdlePaceScript.Pace.MINIMIZED, 60) == 3,
			"minimizzata a 3 fps")
	_assert(IdlePaceScript.fps_for(IdlePaceScript.Pace.MINIMIZED, 60)
			< IdlePaceScript.fps_for(IdlePaceScript.Pace.BACKGROUND, 60),
			"minimizzata deve costare meno del secondo piano visibile")
	# Freno, mai acceleratore: con un tetto pieno più basso del nostro vince
	# il più basso dei due.
	_assert(IdlePaceScript.fps_for(IdlePaceScript.Pace.BACKGROUND, 5) == 5,
			"il freno ha alzato i fps sopra il tetto in vigore")

	# Tempo di gioco: 60 tick al secondo devono entrare tutti nel frame.
	_assert(IdlePaceScript.physics_steps_for(3, 60, 8) >= 20,
			"a 3 fps servono almeno 20 passi di fisica per frame")
	_assert(IdlePaceScript.physics_steps_for(10, 60, 8) == 8,
			"a 10 fps gli 8 passi di default bastano già")
	_assert(IdlePaceScript.physics_steps_for(0, 60, 8) == 8,
			"senza tetto fps si lascia il default")


func _check_transitions(full_fps: int, full_steps: int) -> void:
	Engine.max_fps = full_fps
	Engine.max_physics_steps_per_frame = full_steps
	var pace = IdlePaceScript.new()
	root.add_child(pace)

	_assert(not pace.throttled(), "si nasce in primo piano")
	_assert(Engine.max_fps == full_fps,
			"il solo esistere ha cambiato il tetto del primo piano")

	pace._set_pace(IdlePaceScript.Pace.BACKGROUND)
	_assert(pace.throttled(), "secondo piano non segnalato come ridotto")
	_assert(Engine.max_fps == mini(10, full_fps),
			"secondo piano: max_fps %d con tetto pieno %d" % [Engine.max_fps, full_fps])

	pace._set_pace(IdlePaceScript.Pace.MINIMIZED)
	_assert(Engine.max_fps == mini(3, full_fps),
			"minimizzata: max_fps %d" % Engine.max_fps)
	_assert(Engine.max_physics_steps_per_frame
			>= ceili(float(Engine.physics_ticks_per_second) / float(maxi(1, Engine.max_fps))),
			"minimizzata: la fisica non copre il frame, il tempo di gioco si dilata")

	pace._set_pace(IdlePaceScript.Pace.FOREGROUND)
	_assert(not pace.throttled(), "ritorno in primo piano non registrato")
	_assert(Engine.max_fps == full_fps,
			"al ritorno il tetto è %d invece di %d" % [Engine.max_fps, full_fps])
	_assert(Engine.max_physics_steps_per_frame == full_steps,
			"al ritorno i passi di fisica sono %d invece di %d"
			% [Engine.max_physics_steps_per_frame, full_steps])

	pace.free()


## Il nodo vive SOTTO l'autoload Game, non è l'autoload: se le notifiche di
## focus non scendessero fino ai figli non scatterebbe mai niente, e il gioco
## continuerebbe a disegnare a ritmo pieno esattamente come prima. Qui si
## propaga la notifica dalla radice come fa SceneTree e si guarda il tetto fps.
func _check_notifications() -> void:
	Engine.max_fps = 60
	Engine.max_physics_steps_per_frame = 8
	var host := Node.new()
	root.add_child(host)
	var pace = IdlePaceScript.new()
	host.add_child(pace)
	# Headless si disattiva da solo (non c'è niente da disegnare): per questa
	# prova serve acceso, ed è l'unico modo di provarla senza un window manager.
	pace._enabled = true

	root.propagate_notification(Node.NOTIFICATION_APPLICATION_FOCUS_OUT)
	_assert(pace.throttled(), "la perdita di focus non è arrivata al nodo")
	_assert(Engine.max_fps == 10,
			"perdita di focus: max_fps %d invece di 10" % Engine.max_fps)

	root.propagate_notification(Node.NOTIFICATION_APPLICATION_FOCUS_IN)
	_assert(not pace.throttled(), "il ritorno del focus non è arrivato al nodo")
	_assert(Engine.max_fps == 60,
			"ritorno del focus: max_fps %d invece di 60" % Engine.max_fps)

	# Uscita a finestra non in primo piano: il velo di spegnimento e il dialogo
	# col container devono girare a ritmo pieno.
	root.propagate_notification(Node.NOTIFICATION_APPLICATION_FOCUS_OUT)
	root.propagate_notification(Node.NOTIFICATION_WM_CLOSE_REQUEST)
	_assert(Engine.max_fps == 60,
			"chiusura da finestra dietro: si esce a %d fps" % Engine.max_fps)

	host.free()


func _assert(condition: bool, message: String) -> void:
	if not condition:
		_failures.append(message)
