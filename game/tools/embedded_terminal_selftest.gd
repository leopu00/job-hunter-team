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
	var setup_script: GDScript = load("res://scripts/setup/setup_service.gd")
	var spec: Dictionary
	if is_windows:
		spec = setup_script.embedded_terminal_spec("Terminal self-test", "test",
				"echo Apri https://example.com/device & set /p x=")
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
	if is_windows:
		for _i in 120:
			if terminal._finished:
				break
			await create_timer(0.05).timeout
	var all_bytes: PackedByteArray = terminal._raw_bytes.duplicate()
	all_bytes.append_array(terminal._pending_bytes)
	var visible := terminal._terminal_text(all_bytes.get_string_from_utf8())
	var ok := visible.contains("https://example.com/device")
	if not is_windows:
		ok = ok and visible.contains("ricevuto:OK")
	else:
		ok = ok and terminal._finished
		ok = ok and terminal._status.text == UIStrings.t("term.status_cmd_done")
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
	# Fallimento reale del comando: il wrapper POSIX comunica il codice con
	# un OSC invisibile. La console deve dichiarare l'errore, mostrare una via
	# di riprova e non usare mai il vecchio CTA auto-certificante "HO FINITO".
	var exit_token := "0123456789abcdef"
	ok = ok and EmbeddedTerminal._exit_code_from_raw(
			"prima\u001b]1337;JHTExit=%s:23\u0007dopo" % exit_token,
			exit_token) == 23
	# Un marker formalmente valido ma appartenente a un altro processo non può
	# anticipare/falsificare l'esito del wrapper di questa console.
	ok = ok and EmbeddedTerminal._exit_code_from_raw(
			"\u001b]1337;JHTExit=deadbeef:0\u0007", exit_token) == -1
	ok = ok and EmbeddedTerminal._exit_code_from_raw(
			"\u001b]1337;JHTExit=deadbeef:0\u0007" \
			+ "\u001b]1337;JHTExit=%s:23\u0007" % exit_token,
			exit_token) == 23
	var early_report := "\u001b]1337;JHTExit=%s:0\u0007" % exit_token
	ok = ok and EmbeddedTerminal._exit_code_from_raw(
			early_report + "\u001b]1337;JHTExit=%s:23\u0007" % exit_token,
			exit_token) == 23
	ok = ok and EmbeddedTerminal._exit_code_from_raw("nessun report", exit_token) == -1
	var windows_wrapper: String = setup_script._with_windows_exit_report(
			"echo literal!value!", exit_token)
	ok = ok and windows_wrapper.contains("call set \"JHT_EXIT_CODE=%%errorlevel%%\"")
	ok = ok and windows_wrapper.contains("echo literal!value!")
	ok = ok and windows_wrapper.contains("[Console]::Out.Write")
	ok = ok and not windows_wrapper.contains("!errorlevel!")
	var failure_command := "cmd.exe /d /c exit 23" if is_windows \
			else "exit 23"
	var failure := EmbeddedTerminal.new("runtime-install",
			setup_script.embedded_terminal_spec("Runtime self-test", "test",
					failure_command))
	root.add_child(failure)
	for _i in 120:
		if failure._finished:
			break
		await create_timer(0.05).timeout
	await create_timer(0.1).timeout
	var failure_status := failure._status.text
	ok = ok and failure._finished
	ok = ok and failure._status.text == UIStrings.t("term.status_cmd_failed") % 23
	ok = ok and failure._done.text == UIStrings.t("term.close_retry")
	ok = ok and failure._output.text.contains(UIStrings.t("term.runtime_install_failed"))
	ok = ok and not failure._done.text.contains("HO FINITO")
	failure.close()
	print("EMBEDDED-TERMINAL-TEST ", "PASS" if ok else "FAIL",
			" pid=", pid, " output=", visible, " auto_auth_close=", ok,
			" failure_status=", failure_status,
			" process_exited=", failure._process_exited,
			" captured_exit=", failure._captured_exit_code())
	quit(0 if ok else 1)
