extends SceneTree
## Regressione P0 delle camminate in ripresa: la traslazione del corpo non
## puo' superare la cadenza dei sei cel e una nuova tratta deve aprire sul
## contatto, non su un frame casuale. Non modifica ne' giudica il disegno dei
## fogli: l'operatore conserva la proprieta' dell'arte.
##
## Esecuzione:
##   godot --headless --path game --script res://tools/walk_cycle_selftest.gd

const SpriteSheetRigScript = preload("res://scripts/characters/sprite_sheet_rig.gd")

var _fails: Array[String] = []


func _init() -> void:
	process_frame.connect(_run, CONNECT_ONE_SHOT)


func _run() -> void:
	_check("walk a velocita' di riferimento conserva 10 fps",
			is_equal_approx(SpriteSheetRigScript.walk_fps_for_speed(10.0, 75.0), 10.0))
	_check("walk ordinario adegua il ciclo a 150 px/s",
			is_equal_approx(SpriteSheetRigScript.walk_fps_for_speed(10.0, 150.0), 20.0))
	_check("pipeline veloce si ferma sotto i 30 fps del girato",
			is_equal_approx(SpriteSheetRigScript.walk_fps_for_speed(10.0, 185.0), 24.0))
	_check("un passo lento non degrada sotto la cadenza disegnata",
			is_equal_approx(SpriteSheetRigScript.walk_fps_for_speed(10.0, 1.0), 10.0))

	var rig: SpriteSheetRig = SpriteSheetRigScript.new()
	rig.setup(load("res://assets/characters/sheets/scout_a.png"))
	rig._t = 7.3
	rig.set_motion("side", false, "walk")
	_check("una tratta nuova parte dal frame di contatto", rig._sprite.frame == 5 * 6)
	rig.set_walk_speed(150.0)
	_check("il rig applica la cadenza alla tratta", is_equal_approx(rig._fps, 20.0))
	rig._t = 0.21
	rig._update_frame()
	rig.set_motion("up", false, "walk")
	_check("cambiare direzione non riavvia il passo", is_equal_approx(rig._t, 0.21))
	_check("a 20 fps il cambio direzione conserva la posa F04",
			rig._sprite.frame == 4 * 6 + 4, str(rig._sprite.frame))
	_check("a 20 fps il cambio direzione conserva la cadenza", is_equal_approx(rig._fps, 20.0))
	rig.set_walk_speed(185.0)
	rig._t = 0.21
	rig._update_frame()
	rig.set_motion("side", true, "walk")
	_check("a 24 fps flip e cambio direzione conservano la posa F05",
			rig._sprite.frame == 5 * 6 + 5, str(rig._sprite.frame))
	_check("a 24 fps flip e cambio direzione conservano la cadenza", is_equal_approx(rig._fps, 24.0))
	rig.set_motion("side", true, "carry")
	_check("walk a carry conserva fase e cadenza", rig._sprite.frame == 11 * 6 + 5 \
			and is_equal_approx(rig._fps, 24.0), str(rig._sprite.frame))
	rig.set_motion("side", true, "walk")
	rig._t = 5.1 / 24.0
	rig._update_frame()
	_check("a 24 fps il ciclo arriva a F05", rig._sprite.frame == 5 * 6 + 5,
			str(rig._sprite.frame))
	rig._t = 6.1 / 24.0
	rig._update_frame()
	_check("la chiusura F05 a F00 non salta pose", rig._sprite.frame == 5 * 6,
			str(rig._sprite.frame))
	rig.free()

	var agent_source := FileAccess.get_file_as_string("res://scripts/characters/agent_npc.gd")
	_check("AgentNPC inoltra al rig la velocita' fisica reale",
			agent_source.contains("rig.set_walk_speed(velocity.length())"))
	if _fails.is_empty():
		print("WALK-CYCLE-TEST PASS")
		quit(0)
	else:
		print("WALK-CYCLE-TEST FAIL ", _fails)
		quit(1)


func _check(what: String, ok: bool, detail := "") -> void:
	if not ok:
		_fails.append(what + ("" if detail == "" else " — " + detail))
