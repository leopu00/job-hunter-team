extends SceneTree
## Contratto UI del pairing browser-first: il processo resta nascosto, l'URL
## completo apre il browser una volta, il fallback copia davvero il link e gli
## esiti terminali non lasciano la modale appesa.


class FakeBrowserTerminal extends EmbeddedTerminal:
	var browser_result: Error = OK
	var opened_urls: Array[String] = []
	var copied_text := ""

	func _shell_open(uri: String) -> Error:
		opened_urls.append(uri)
		return browser_result

	func _clipboard_set(text: String) -> void:
		copied_text = text


func _init() -> void:
	_run.call_deferred()


func _event_line(event: Dictionary) -> String:
	return EmbeddedTerminal.CLOUD_UI_PREFIX + JSON.stringify(event)


func _spec(events: Array[Dictionary], keep_alive := false) -> Dictionary:
	var lines := PackedStringArray()
	for event in events:
		lines.append(_event_line(event))
	if OS.get_name() == "Windows":
		var statements := PackedStringArray()
		for line in lines:
			# Gli eventi non contengono apostrofi; il protocollo produzione usa
			# JSON.stringify e il selftest mantiene lo stesso frame byte-per-byte.
			statements.append("[Console]::Error.WriteLine('%s')" % line)
		if keep_alive:
			statements.append("Start-Sleep -Seconds 30")
		return {
			"path": "powershell.exe",
			"args": PackedStringArray(["-NoProfile", "-NonInteractive", "-Command",
					"; ".join(statements)]),
			"cloud_pairing": true,
		}
	var command := ""
	for line in lines:
		command += "printf '%s\\n' >&2; " % line
	if keep_alive:
		command += "sleep 30"
	return {
		"path": "/bin/sh",
		"args": PackedStringArray(["-c", command]),
		"cloud_pairing": true,
	}


func _wait_until(predicate: Callable, attempts := 120) -> bool:
	for _i in attempts:
		if predicate.call():
			return true
		await create_timer(0.025).timeout
	return false


func _run() -> void:
	var failures: Array[String] = []
	var check := func(condition: bool, message: String) -> void:
		if not condition:
			failures.append(message)

	var url := "https://jobhunterteam.ai/cli-link?code=TEST-1234"
	var raw := "docker banner\r\n" + _event_line({
		"event": "ready", "url": url, "expires_in": 600}) + "\r\n" \
		+ _event_line({"event": "paired", "token_name": "desktop-test"}) + "\r\n" \
		+ EmbeddedTerminal.CLOUD_UI_PREFIX + "{\"event\":\"partial"
	var parsed := EmbeddedTerminal._cloud_pairing_events(raw)
	check.call(parsed.size() == 2, "parser accetta frame incompleto o perde frame completi")
	check.call(str(parsed[0].get("url", "")) == url, "parser altera URL completo")
	for forbidden in ["device_code", "user_code", "token", "user_id"]:
		check.call(not parsed[0].has(forbidden) and not parsed[1].has(forbidden),
				"evento UI espone " + forbidden)

	var success := FakeBrowserTerminal.new("cloud", _spec([
		{"event": "ready", "url": url, "expires_in": 600},
		{"event": "paired", "token_name": "desktop-test"},
	]))
	root.add_child(success)
	check.call(await _wait_until(func() -> bool: return success._cloud_paired),
			"pairing completato non aggiorna la UI")
	check.call(success._cloud_browser_attempts == 1 and success.opened_urls == [url],
			"URL non aperto automaticamente una volta: %s" % JSON.stringify(success.opened_urls))
	check.call(success._cloud_state.text == UIStrings.t("cloud_pairing.paired"),
			"successo non visibile al ritorno dal browser")
	check.call(success._output == null, "il pairing mostra ancora il terminale")
	success.close()

	var fallback := FakeBrowserTerminal.new("cloud", _spec([
		{"event": "ready", "url": url, "expires_in": 600},
	], true))
	fallback.browser_result = FAILED
	root.add_child(fallback)
	check.call(await _wait_until(func() -> bool:
		return fallback._cloud_browser_attempts == 1),
			"fallimento browser non rilevato")
	check.call(fallback._cloud_fallback.visible and fallback._cloud_link.text == url,
			"fallimento browser non mostra il link fallback")
	fallback._copy_cloud_pairing_url()
	check.call(fallback.copied_text == url, "COPIA LINK non copia l'URL completo")
	var fallback_copy_ok := fallback.copied_text == url
	fallback.close()

	var consumed := FakeBrowserTerminal.new("cloud", _spec([
		{"event": "ready", "url": url, "expires_in": 600},
		{"event": "already_used"},
	]))
	root.add_child(consumed)
	check.call(await _wait_until(func() -> bool:
		return consumed._cloud_terminal_event),
			"link consumato lascia il flusso pendente")
	check.call(consumed._cloud_retry.visible \
			and consumed._cloud_state.text == UIStrings.t("cloud_pairing.already_used"),
			"link consumato non offre rigenerazione esplicita")
	consumed.close()

	var ok := failures.is_empty()
	print("CLOUD-PAIRING-TEST ", "PASS" if ok else "FAIL", " ",
			JSON.stringify({"failures": failures, "browser_attempts": 1,
					"fallback_copy": fallback_copy_ok}))
	quit(0 if ok else 1)
