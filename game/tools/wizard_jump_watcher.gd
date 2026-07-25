extends Node
## Guardiano del passo 03 del setup: dall'ufficio si chiede il wizard e la
## scena DEVE cambiare. Vive su /root apposta, così sopravvive alla scena che
## sta osservando (JHT_WIZARD_JUMP_TEST=1 dalla scena office).


func _ready() -> void:
	await get_tree().create_timer(1.0).timeout
	var before := _scene_path()
	Game.goto_wizard()
	for _i in 20:
		await get_tree().process_frame
	var after := _scene_path()
	var ok := after == Game.SCENE_WIZARD
	print("WIZARD-JUMP-TEST ", "PASS" if ok else "FAIL", " ",
			JSON.stringify({"prima": before, "dopo": after}))
	get_tree().quit(0 if ok else 1)


func _scene_path() -> String:
	var scene := get_tree().current_scene
	return scene.scene_file_path if scene != null else ""
