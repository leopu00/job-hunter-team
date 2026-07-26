extends SceneTree
## La selezione col mouse nella console DEVE sopravvivere all'output.
##
## Durante il login l'utente trascina il mouse sopra un URL per copiarlo, ma il
## CLI continua a scrivere: ogni pezzo di output riscriveva l'intero testo e la
## selezione spariva prima che potesse finirla (Leone, 25/07). Qui si riproduce
## esattamente quel gesto — premi, trascini, e nel frattempo arriva altro
## output — e si pretende che alla fine la selezione ci sia ancora e contenga
## quello che l'utente ha coperto col mouse.

const URL := "https://www.kimi.com/code/authorize_device?user_code=WXTU-CN97"


func _init() -> void:
	_run.call_deferred()


func _run() -> void:
	var terminal = load("res://scripts/ui/embedded_terminal.gd").new("test", {
		"path": "/bin/sh",
		"args": PackedStringArray(["-lc", "sleep 30"]),
		"title": "Selection self-test", "hint": "test",
	})
	root.add_child(terminal)
	await process_frame
	await process_frame

	# Schermata tipica del login, con l'URL su una riga sua.
	terminal._screen.feed("Select a platform:\n  1. Kimi Code\n" + URL + "\nWaiting...\n")
	terminal._flush_pending_output()
	await process_frame

	var output: RichTextLabel = terminal._output
	var failures: Array[String] = []
	if not output.text.contains(URL):
		failures.append("l'URL non è finito a schermo")

	# Gesto reale: premo sull'output, trascino, e MENTRE trascino arriva altro
	# output dal CLI (è il caso che rompeva tutto).
	var press := InputEventMouseButton.new()
	press.button_index = MOUSE_BUTTON_LEFT
	press.pressed = true
	terminal._on_output_gui_input(press)
	if not terminal._selection_locked():
		failures.append("il testo non si congela quando premo il mouse")

	var before := output.text
	terminal._screen.feed("altra riga di output che arriva mentre selezioni\n")
	terminal._flush_pending_output()
	await process_frame
	if output.text != before:
		failures.append("il testo è cambiato sotto il cursore durante il trascinamento")

	# Rilascio: da qui l'output in coda può tornare a scorrere.
	var release := InputEventMouseButton.new()
	release.button_index = MOUSE_BUTTON_LEFT
	release.pressed = false
	terminal._on_output_gui_input(release)
	await process_frame
	if terminal._selection_locked():
		failures.append("resta congelato anche dopo aver rilasciato")
	if not output.text.contains("altra riga di output"):
		failures.append("l'output arrivato durante la selezione non è più comparso")

	# E il testo copiabile in blocco deve contenere l'URL per intero.
	if not terminal._screen.text().contains(URL):
		failures.append("COPIA TESTO non conterrebbe l'URL")

	terminal.close()
	if failures.is_empty():
		print("TERMINAL-SELECTION-TEST PASS")
		quit(0)
		return
	for failure in failures:
		push_error("[terminal-selection] " + failure)
	print("TERMINAL-SELECTION-TEST FAIL ", JSON.stringify(failures))
	quit(1)
