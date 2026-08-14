class_name TeamStartState
extends RefCounted
## Macchina a stati pura dell'avvio del team (#129).
##
## Il comando, il probe CAPITANO e il watchdog sono tre osservatori distinti:
## nessuno può dichiarare da solo più di ciò che ha visto. In particolare un
## exit 0 resta `starting` finché CAPITANO non è osservato, mentre
## `recovering` richiede una riga del watchdog successiva all'inizio del
## tentativo. Il chiamante esclude le righe vecchie usando `watchdog_cursor`.

const IDLE := "idle"
const STARTING := "starting"
const RUNNING := "running"
const FAILED := "failed"
const RECOVERING := "recovering"

## start-agent.sh ha già restituito, quindi CAPITANO deve comparire al primo
## probe utile. Quindici secondi lasciano cinque probe da 3 s senza mascherare
## un falso successo.
const CONFIRM_TIMEOUT_MS := 15_000
## agent-watchdog gira ogni 30 s. Sei tick coprono un tentativo lento e alcuni
## retry, ma danno un limite finito e documentato: dopo tre minuti la UI torna
## a `failed` con retry disponibile. Un CAPITANO osservato più tardi resta
## comunque autoritativo e porta a `running`.
const RECOVERY_TIMEOUT_MS := 180_000
const WATCHDOG_ATTEMPT := "agent capitano: session CAPITANO is inactive — relaunching via jht team start"

var phase := IDLE
var attempt := 0
var started_ms := 0
var command_finished := false
var confirm_deadline_ms := 0
var recovery_deadline_ms := 0
var watchdog_cursor := -1
var output := ""
var cause := ""
var error_code := ""


func begin(now_ms: int) -> void:
	attempt += 1
	phase = STARTING
	started_ms = now_ms
	command_finished = false
	confirm_deadline_ms = 0
	recovery_deadline_ms = 0
	watchdog_cursor = -1
	output = ""
	cause = ""
	error_code = ""


## L'exit code descrive il comando, non il runtime: anche `ok` attende il
## probe CAPITANO. In caso di errore la causa resta disponibile mentre il
## watchdog tenta il recupero e dopo un eventuale timeout.
func finish_command(ok: bool, raw_output: String, cursor: int,
		now_ms: int) -> void:
	command_finished = true
	watchdog_cursor = cursor
	output = _bounded_output(raw_output)
	confirm_deadline_ms = now_ms + CONFIRM_TIMEOUT_MS
	recovery_deadline_ms = now_ms + RECOVERY_TIMEOUT_MS
	if ok:
		phase = STARTING
		return
	phase = FAILED
	error_code = "bootstrap_failed"
	cause = _cause_line(output)


## Applica una osservazione dello stesso tentativo. Un probe partito prima di
## un retry porta l'attempt vecchio e viene ignorato integralmente.
func observe(observed_attempt: int, captain_running: bool,
		watchdog_delta: String, now_ms: int) -> bool:
	if observed_attempt != attempt:
		return false
	var before := snapshot()
	if captain_running:
		phase = RUNNING
		command_finished = true
		confirm_deadline_ms = 0
		recovery_deadline_ms = 0
		error_code = ""
		cause = ""
	elif phase in [STARTING, FAILED, RECOVERING]:
		var in_recovery_window := recovery_deadline_ms > 0 \
				and now_ms < recovery_deadline_ms
		if in_recovery_window and watchdog_attempted(watchdog_delta):
			phase = RECOVERING
		elif phase == STARTING and command_finished \
				and now_ms >= confirm_deadline_ms:
			phase = FAILED
			error_code = "captain_not_observed"
			if cause == "":
				cause = "CAPITANO was not observed after the start command"
		elif phase == RECOVERING and recovery_deadline_ms > 0 \
				and now_ms >= recovery_deadline_ms:
			phase = FAILED
			error_code = "recovery_timeout"
	return before != snapshot()


## Uno stop riuscito invalida anche i probe già in volo.
func stopped(now_ms: int) -> void:
	attempt += 1
	phase = IDLE
	started_ms = now_ms
	command_finished = true
	confirm_deadline_ms = 0
	recovery_deadline_ms = 0
	watchdog_cursor = -1
	output = ""
	cause = ""
	error_code = ""


func needs_watchdog_observation(now_ms: int) -> bool:
	return watchdog_cursor >= 0 and phase in [STARTING, FAILED, RECOVERING] \
			and recovery_deadline_ms > now_ms


func snapshot() -> Dictionary:
	return {
		"phase": phase,
		"attempt": attempt,
		"started_ms": started_ms,
		"command_finished": command_finished,
		"confirm_deadline_ms": confirm_deadline_ms,
		"recovery_deadline_ms": recovery_deadline_ms,
		"watchdog_cursor": watchdog_cursor,
		"output": output,
		"cause": cause,
		"error_code": error_code,
	}


static func watchdog_attempted(delta: String) -> bool:
	for raw_line in delta.split("\n", false):
		if str(raw_line).to_lower().contains(WATCHDOG_ATTEMPT.to_lower()):
			return true
	return false


static func _bounded_output(raw: String) -> String:
	var clean := raw.strip_edges()
	return clean.right(1200) if clean.length() > 1200 else clean


static func _cause_line(raw: String) -> String:
	var lines := raw.split("\n", false)
	# Prima le righe per-elemento: il summary "6 errors" quantifica ma non
	# spiega quale componente ha fallito né perché.
	for index in range(lines.size() - 1, -1, -1):
		var line := str(lines[index]).strip_edges()
		if line.contains("✗"):
			return line.right(320)
	for index in range(lines.size() - 1, -1, -1):
		var line := str(lines[index]).strip_edges()
		var lower := line.to_lower()
		if lower.contains("failed") or lower.contains("error") \
				or lower.contains("unable"):
			return line.right(320)
	return str(lines[-1]).strip_edges().right(320) if not lines.is_empty() \
			else "Team bootstrap failed"
