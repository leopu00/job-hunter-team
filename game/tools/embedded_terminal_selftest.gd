extends SceneTree
## Contratto minimo della console incorporata: output progressivo, stdin e
## riconoscimento URL devono funzionare senza Terminal.app/node-pty/Electron.


func _init() -> void:
	_run.call_deferred()


func _run() -> void:
	var command := "printf 'Apri https://example.com/device\\nCodice: TEST-123\\n' 1>&2; " \
			+ "IFS= read -r answer; printf 'ricevuto:%s\\n' \"$answer\" 1>&2"
	# Godot non espone ConPTY su Windows: la pipe interattiva via `script`
	# non è riproducibile lì come su POSIX. Il path reale gira su cmd.exe
	# (vedi SetupService.embedded_terminal_spec). Su Windows esercitiamo
	# spawn cmd.exe + cattura output/URL + consumo stdin; l'eco "ricevuto:"
	# (che vorrebbe la delayed expansion di cmd) resta coperto dai leg POSIX.
	var is_windows := OS.get_name() == "Windows"
	var spec: Dictionary
	if is_windows:
		spec = {
			"path": "cmd.exe",
			"args": PackedStringArray(["/d", "/s", "/c",
					"echo Apri https://example.com/device 1>&2 & set /p x="]),
			"title": "Terminal self-test", "hint": "test",
		}
	else:
		spec = {
			"path": "/bin/sh", "args": PackedStringArray(["-lc", command]),
			"title": "Terminal self-test", "hint": "test",
		}
	var terminal := EmbeddedTerminal.new("test", spec)
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
	var ok := visible.contains("https://example.com/device")
	if not is_windows:
		ok = ok and visible.contains("ricevuto:OK")
	# Modello di schermo: il posizionamento colonna (ESC[nG, stile TUI
	# Claude) deve produrre spazi, non parole incollate; cursor-home + erase
	# sovrascrivono invece di accodare; il clear screen svuota davvero.
	ok = ok and terminal._terminal_text("Accessing\u001b[12Gworkspace:") \
			== "Accessing  workspace:"
	ok = ok and terminal._terminal_text(
			"riga1\r\nriga2\u001b[H\u001b[KRIGA1") == "RIGA1\nriga2"
	ok = ok and terminal._terminal_text("vecchia\u001b[2Jnuova") == "nuova"
	# URL spezzato dal wrap: le righe successive fatte solo di caratteri-URL
	# continuano il link; una riga qualunque lo chiude.
	terminal._detect_url(PackedStringArray([
		"Use the url below to sign in",
		"https://claude.com/oauth/authorize?code=true&sta",
		"te=abc123",
		"",
		"Esc to cancel",
	]))
	ok = ok and terminal._last_url \
			== "https://claude.com/oauth/authorize?code=true&state=abc123"
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
