extends SceneTree
## Contratto minimo della console incorporata: output progressivo, stdin e
## riconoscimento URL devono funzionare senza Terminal.app/node-pty/Electron.


func _init() -> void:
	_run.call_deferred()


func _run() -> void:
	var command := "printf 'Apri https://example.com/device\\nCodice: TEST-123\\n' 1>&2; " \
			+ "IFS= read -r answer; printf 'ricevuto:%s\\n' \"$answer\" 1>&2"
	var terminal := EmbeddedTerminal.new("test", {
		"path": "/bin/sh", "args": PackedStringArray(["-lc", command]),
		"title": "Terminal self-test", "hint": "test",
	})
	root.add_child(terminal)
	for _i in 40:
		if terminal._pid > 0:
			break
		await create_timer(0.05).timeout
	terminal._send("OK\n")
	await create_timer(0.5).timeout
	var all_bytes: PackedByteArray = terminal._raw_bytes.duplicate()
	all_bytes.append_array(terminal._pending_bytes)
	var visible := terminal._terminal_text(all_bytes.get_string_from_utf8())
	var ok := visible.contains("https://example.com/device") \
			and visible.contains("ricevuto:OK")
	var pid := terminal._pid
	# Il provider deve chiudersi automaticamente solo quando la checklist
	# conferma le credenziali del provider corretto.
	terminal.provider = "provider:codex"
	ok = ok and not terminal._matching_auth_ready({
		"active_provider": "kimi", "provider_authenticated": true})
	terminal._on_setup_status({
		"active_provider": "codex", "provider_authenticated": true})
	await create_timer(1.1).timeout
	ok = ok and not is_instance_valid(terminal)
	print("EMBEDDED-TERMINAL-TEST ", "PASS" if ok else "FAIL",
			" pid=", pid, " output=", visible, " auto_auth_close=", ok)
	quit(0 if ok else 1)
