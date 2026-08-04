extends SceneTree
## Contratto minimo della console incorporata: output progressivo, stdin e
## riconoscimento URL devono funzionare senza Terminal.app/node-pty/Electron.


## Trattiene il risultato di `execute_with_pipe` prima che la classe base possa
## pubblicare il PID. Il test riproduce così deterministicamente close-before-PID
## senza aggiungere hook di test al percorso di produzione.
class SpawnBarrierTerminal extends EmbeddedTerminal:
	var spawned_pid := -1
	var publish_gate := Semaphore.new()

	func _spawn_process() -> Dictionary:
		var process := super()
		spawned_pid = int(process.get("pid", -1))
		publish_gate.wait()
		return process


func _init() -> void:
	_run.call_deferred()


func _pid_exists(pid: int, is_windows: bool) -> bool:
	if pid <= 0:
		return false
	if is_windows:
		return OS.execute("powershell.exe", PackedStringArray([
				"-NoProfile", "-NonInteractive", "-Command",
				("if (Get-Process -Id %d -ErrorAction SilentlyContinue) { exit 0 } " \
						+ "else { exit 1 }") % pid])) == 0
	return OS.execute("/bin/sh", PackedStringArray([
			"-c", "kill -0 %d 2>/dev/null" % pid])) == 0


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
	var spec: Dictionary = setup_script.embedded_terminal_spec(
			"Terminal self-test", "test",
			"echo Apri https://example.com/device & set /p x=" if is_windows \
			else command)
	var terminal := EmbeddedTerminal.new("test", spec)
	root.add_child(terminal)
	for _i in 40:
		if terminal._pid > 0:
			break
		await create_timer(0.05).timeout
	terminal._send("OK\n")
	await create_timer(0.5).timeout
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
	# Il figlio conosce il token e invia subito un falso successo sul proprio
	# stdout, poi resta vivo: il gruppo Windows e fd3 POSIX devono confinare quel
	# marker sul pipe visibile. Solo il report di controllo finale (23) chiude la
	# console. Questo esercita l'arrivo incrementale sui due pipe, non solo il
	# parser su una stringa già completa.
	const TOKEN_PLACEHOLDER := "JHT_TEST_REPORT_TOKEN"
	var spoof_command := ("powershell.exe -NoProfile -NonInteractive -Command " \
			+ "\"[Console]::Out.Write([char]27 + ']1337;JHTExit=" \
			+ TOKEN_PLACEHOLDER + ":0' + [char]7); " \
			+ "Start-Sleep -Milliseconds 500; exit 23\"") if is_windows \
			else ("printf '\\033]1337;JHTExit=" + TOKEN_PLACEHOLDER \
			+ ":0\\007'; sleep 0.5; exit 23")
	var failure_spec: Dictionary = setup_script.embedded_terminal_spec(
			"Runtime self-test", "test", spoof_command)
	var failure_token := str(failure_spec.get("exit_report_token", ""))
	var failure_args := PackedStringArray(failure_spec.get("args", PackedStringArray()))
	for i in failure_args.size():
		failure_args[i] = failure_args[i].replace(TOKEN_PLACEHOLDER, failure_token)
	failure_spec["args"] = failure_args
	var failure := EmbeddedTerminal.new("runtime-install", failure_spec)
	root.add_child(failure)
	var spoof_report := "\u001b]1337;JHTExit=%s:0\u0007" % failure_token
	var saw_spoof_while_running := false
	for _i in 40:
		var failure_bytes: PackedByteArray = failure._raw_bytes.duplicate()
		failure_bytes.append_array(failure._pending_bytes)
		if failure_bytes.get_string_from_utf8().contains(spoof_report):
			saw_spoof_while_running = not failure._finished
			break
		await create_timer(0.025).timeout
	for _i in 120:
		if failure._finished:
			break
		await create_timer(0.05).timeout
	await create_timer(0.1).timeout
	var failure_status := failure._status.text
	ok = ok and saw_spoof_while_running
	ok = ok and failure._finished
	ok = ok and failure._status.text == UIStrings.t("term.status_cmd_failed") % 23
	ok = ok and failure._done.text == UIStrings.t("term.close_retry")
	ok = ok and failure._output.text.contains(UIStrings.t("term.runtime_install_failed"))
	ok = ok and not failure._done.text.contains("HO FINITO")
	var failure_process_exited := failure._process_exited
	var failure_captured_exit := failure._captured_exit_code()
	failure.close()
	# Protocollo troncato: il wrapper reale scrive un token diverso da quello
	# atteso, poi chiude entrambi i pipe. Senza un report autenticato la console
	# deve concludere in errore (-1), non restare INTERATTIVA per sempre.
	var missing_spec: Dictionary = setup_script.embedded_terminal_spec(
			"Missing report self-test", "test",
			"cmd.exe /d /c exit 0" if is_windows else "exit 0")
	missing_spec["exit_report_token"] = "report_that_will_never_arrive"
	var missing := EmbeddedTerminal.new("runtime-install", missing_spec)
	root.add_child(missing)
	for _i in 120:
		if missing._finished:
			break
		await create_timer(0.05).timeout
	var missing_status := missing._status.text
	ok = ok and missing._finished
	ok = ok and missing_status == UIStrings.t("term.status_cmd_failed") % -1
	ok = ok and missing._done.text == UIStrings.t("term.close_retry")
	missing._process_started()
	ok = ok and missing._status.text == missing_status
	missing.close()
	# Chiusura manuale durante un comando quiet: `_closing` ferma i reader, ma
	# non è una prova che il processo sia già uscito. Il PID deve essere ucciso
	# e non può essere saltato da un falso `_process_exited` del reader stderr.
	var close_spec := {
		"path": "powershell.exe" if is_windows else "/bin/sleep",
		"args": PackedStringArray(["-NoProfile", "-NonInteractive", "-Command",
				"Start-Sleep -Seconds 30"]) if is_windows \
				else PackedStringArray(["30"]),
		"title": "Close self-test",
		"hint": "test",
	}
	var close_terminal := EmbeddedTerminal.new("test", close_spec)
	root.add_child(close_terminal)
	for _i in 40:
		if close_terminal._pid > 0:
			break
		await create_timer(0.025).timeout
	var close_pid := close_terminal._pid
	close_terminal.close()
	var close_killed := false
	for _i in 40:
		if close_pid > 0 and not _pid_exists(close_pid, is_windows):
			close_killed = true
			break
		await create_timer(0.025).timeout
	if close_pid > 0 and not close_killed:
		OS.kill(close_pid)
	ok = ok and close_killed
	# Race deterministico: il processo esiste già, ma il worker non ha ancora
	# pubblicato `_pid`. `close()` non può ucciderlo subito; dopo la barriera è
	# il worker, osservando `_closing`, a ereditarne ownership e terminarlo.
	var early_close := SpawnBarrierTerminal.new("test", close_spec)
	root.add_child(early_close)
	for _i in 100:
		if early_close.spawned_pid > 0:
			break
		await create_timer(0.01).timeout
	var early_close_pid := early_close.spawned_pid
	var closed_before_publish := early_close_pid > 0 and early_close._pid <= 0
	early_close.close()
	early_close.publish_gate.post()
	var early_close_killed := false
	for _i in 80:
		if early_close_pid > 0 and not _pid_exists(early_close_pid, is_windows):
			early_close_killed = true
			break
		await create_timer(0.025).timeout
	if early_close_pid > 0 and not early_close_killed:
		OS.kill(early_close_pid)
	ok = ok and closed_before_publish and early_close_killed
	print("EMBEDDED-TERMINAL-TEST ", "PASS" if ok else "FAIL",
			" pid=", pid, " output=", visible, " auto_auth_close=", ok,
			" failure_status=", failure_status,
			" missing_status=", missing_status,
			" close_killed=", close_killed,
			" early_close_killed=", early_close_killed,
			" process_exited=", failure_process_exited,
			" captured_exit=", failure_captured_exit)
	quit(0 if ok else 1)
