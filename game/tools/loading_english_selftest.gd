extends SceneTree
## Contratto del frame più breve e più facile da perdere in una ripresa: il
## velo fra due scene. Viene costruito dal vero autoload Game, non da una copia
## del widget, e deve partire in inglese anche senza preferenze dell'utente.
##
## Con JHT_LOADING_SHOT=/path/frame.png salva anche il viewport renderizzato,
## così il gate testuale e l'audit visuale osservano esattamente lo stesso nodo.

var _failures: Array[String] = []


func _init() -> void:
	process_frame.connect(_run, CONNECT_ONE_SHOT)


func _run() -> void:
	UIStrings.set_lang(UIStrings.DEFAULT_LANG, false)
	var game := root.get_node_or_null("Game")
	_check("autoload Game disponibile", game != null)
	if game == null:
		print("LOADING-ENGLISH-TEST FAIL ", _failures)
		quit(1)
		return
	game.call("_show_loading")
	await process_frame
	await process_frame
	var veil: CanvasLayer = game.get("_loading_veil")
	var labels := veil.find_children("*", "Label", true, false)
	_check("un'etichetta nel velo", labels.size() == 1, str(labels.size()))
	if labels.size() == 1:
		_check("frame di default inglese",
				str(labels[0].text) == "LOADING…", str(labels[0].text))
	var shot := OS.get_environment("JHT_LOADING_SHOT")
	if shot != "":
		await process_frame
		var image := root.get_texture().get_image()
		_check("frame renderizzato non vuoto", not image.is_empty())
		_check("frame inglese salvato", image.save_png(shot) == OK, shot)
	game.call("_hide_loading")
	if _failures.is_empty():
		print("LOADING-ENGLISH-TEST PASS")
		quit(0)
		return
	print("LOADING-ENGLISH-TEST FAIL ", _failures)
	quit(1)


func _check(what: String, ok: bool, detail := "") -> void:
	if not ok:
		_failures.append(what + ("" if detail == "" else " — " + detail))
