extends Node
## Regression end-to-end del percorso fotografato su Windows con locale EN.
##
## Non basta cercare le cinque frasi storiche nei cataloghi: i dettagli del
## backend mock, il roster e la chat del Coordinatore arrivano alla UI tramite
## il bus e possono bypassare UIStrings pur lasciando la parita' 7/7 verde.
## Questo test avvia il backend usato da setup/showroom, osserva gli stessi
## payload consegnati alle scene e percorre una risposta completa del
## Coordinatore, incluso il checkpoint transitorio.

const SETUP_EXPECTED := {
	"common.loading": "LOADING…",
	"coord.loading": "LOADING…",
	"dept.agent_status.waiting": "WAITING",
	"setup.action.plan_saved": "Subscription saved",
	"setup.action.in_progress": "Operation in progress…",
	"office.ready_cvs_count": "READY CVS  3",
}

const FORBIDDEN_ITALIAN := [
	"caricamento", "in attesa", "cv pronti", "abbonamento registrato",
	"operazione in corso", "simulatore locale", "turno in corso",
	"ci sto lavorando", "ricevuto", "approfondiamo", "carico il contesto",
	"snapshot ricevuto", "elementi candidati", "riga storica",
	"analisi in corso", "attendo il prossimo evento", "recensione cv",
	"registro coerente",
]

var _failures: Array[String] = []
var _observed: Array[String] = []
var _latest_chat: Array = []
var _terminal := ""
func _ready() -> void:
	call_deferred("_run")


func _run() -> void:
	var previous_lang := UIStrings.lang
	UIStrings.lang = "en"
	BackendBus.connection_changed.connect(_on_connection)
	BackendBus.agent_chat_updated.connect(_on_chat)
	BackendBus.agent_terminal_updated.connect(_on_terminal)

	for key in SETUP_EXPECTED:
		var got := UIStrings.t(key) % 3 if key == "office.ready_cvs_count" \
				else UIStrings.t(key)
		_observed.append(got)
		_check(got == SETUP_EXPECTED[key], "%s = %s" % [key, got])

	BackendBus.set_backend(MockBackend.new())
	var connected := await _wait_for(func() -> bool:
		return BackendBus.state == BackendBus.CONNECTED, 5.0)
	_check(connected, "il backend mock non ha raggiunto CONNECTED")
	var state_detail := BackendBus.state_detail
	_check(state_detail == UIStrings.t("backend.mock_connected"),
			"dettaglio CONNECTED fuori catalogo: " + state_detail)

	var allowed_activity := {}
	for key in ["vps.activity.working", "vps.activity.idle",
			"vps.activity.paused", "vps.activity.throttled",
			"vps.activity.unobserved"]:
		allowed_activity[UIStrings.t(key)] = true
	for agent: Dictionary in BackendBus.agents:
		var detail := str(agent.get("activity_detail", ""))
		_observed.append(detail)
		_check(allowed_activity.has(detail), "activity_detail non localizzato: " + detail)

	BackendBus.open_agent_terminal("coordinatore")
	await _wait_for(func() -> bool: return _terminal != "", 2.0)
	_check(_terminal != "", "terminale mock non pubblicato")

	BackendBus.open_agent_chat("coordinatore")
	BackendBus.send_user_chat("coordinatore", "How is the team doing?")
	var answered := await _wait_for(func() -> bool:
		if _latest_chat.is_empty():
			return false
		var last: Dictionary = _latest_chat[-1]
		return str(last.get("role", "")) == "assistant" \
				and bool(last.get("done", false)), 12.0)
	_check(answered, "il Coordinatore mock non ha completato la risposta")
	if answered:
		var last: Dictionary = _latest_chat[-1]
		_check(str(last.get("text", "")).begins_with("Got it. The team"),
				"risposta Coordinatore fuori locale EN: " + str(last.get("text", "")))
		for choice: Dictionary in last.get("choices", []):
			_observed.append(str(choice.get("label", "")))
			_observed.append(str(choice.get("value", "")))

	# Pool e onboarding sono altre due sorgenti mostrate dallo stesso adapter.
	# Sono inclusi nel census anche se il timer casuale non li emette in questo
	# singolo run: il percorso bus/chat sopra resta l'oracolo causale.
	for row: Array in MockBackend.CHATTER:
		_observed.append(str(row[2]))
	for reply in MockBackend.WIZ_REPLIES:
		_observed.append(str(reply))
	_observed.append(_terminal)

	for value in _observed:
		var lowered := value.to_lower()
		for forbidden in FORBIDDEN_ITALIAN:
			_check(not lowered.contains(forbidden),
					"literal italiano visibile `%s` in `%s`" % [forbidden, value])

	BackendBus.disconnect_backend()
	_finish(previous_lang)


func _finish(previous_lang: String) -> void:
	UIStrings.lang = previous_lang
	var ok := _failures.is_empty()
	print("ENGLISH-SETUP-TEAM-TEST ", "PASS" if ok else "FAIL", " ",
			JSON.stringify({"failures": _failures, "surfaces": _observed.size()}))
	for failure in _failures:
		push_error("[english-setup-team] " + failure)
	get_tree().quit(0 if ok else 1)


func _on_connection(_state: int, detail: String) -> void:
	if detail != "":
		_observed.append(detail)


func _on_chat(_agent: String, messages: Array) -> void:
	_latest_chat = messages.duplicate(true)
	for message: Dictionary in messages:
		var text := str(message.get("text", ""))
		if text != "" and not _observed.has(text):
			_observed.append(text)


func _on_terminal(_agent: String, text: String, error: String) -> void:
	if error == "" and text != "":
		_terminal = text


func _wait_for(condition: Callable, timeout: float) -> bool:
	var deadline := Time.get_ticks_msec() + int(timeout * 1000.0)
	while Time.get_ticks_msec() < deadline:
		if bool(condition.call()):
			return true
		await get_tree().process_frame
	return bool(condition.call())


func _check(condition: bool, detail: String) -> void:
	if not condition:
		_failures.append(detail)
