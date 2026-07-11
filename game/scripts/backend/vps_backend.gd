class_name VpsBackend
extends BackendAdapter
## Backend REALE: parla via SSH con una VPS del team (container Docker
## `jht`, stato in /jht_home). Legge, non scrive: l'app osserva il team.
##
## Ciclo: start() → CONNECTING → handshake ssh → CONNECTED → poll del
## roster (sessioni tmux nel container = agenti attivi) finché stop().
## Tutto l'I/O vive in un Thread; verso il bus solo call_deferred.

const POLL_SECS := 8.0
const SSH_TIMEOUT := 8

var _ip := ""
var _key := ""
var _user := "root"
var _thread: Thread
var _stop := false


func start(config: Dictionary) -> void:
	_ip = str(config.get("ip", "")).strip_edges()
	_key = str(config.get("key_path", "")).strip_edges()
	_user = str(config.get("user", "root")).strip_edges()
	bus.publish_state(BackendBus.CONNECTING, "handshake ssh con %s…" % _ip)
	_stop = false
	_thread = Thread.new()
	_thread.start(_run)


func stop() -> void:
	_stop = true
	if _thread and _thread.is_started():
		_thread.wait_to_finish()
	_thread = null


## ── Thread di I/O ─────────────────────────────────────────────────────

func _run() -> void:
	# handshake: la VPS risponde e il container jht esiste?
	var probe := _ssh("echo JHT_OK; docker inspect jht --format {{.State.Status}}")
	if _stop:
		return
	if probe["code"] != 0 or not probe["out"].contains("JHT_OK"):
		_deferred_state(BackendBus.ERROR, _short_error(probe))
		return
	if not probe["out"].contains("running"):
		_deferred_state(BackendBus.ERROR, "container jht non in esecuzione")
		return
	_deferred_state(BackendBus.CONNECTED, _ip)

	# poll del roster finché non ci fermano
	var failures := 0
	while not _stop:
		var res := _ssh("docker exec jht tmux ls -F '#{session_name}' 2>/dev/null || true")
		if _stop:
			return
		if res["code"] == 0:
			if failures > 0:
				failures = 0
				_deferred_state(BackendBus.CONNECTED, _ip)
			bus.call_deferred("publish_agents", _parse_roster(res["out"]))
		else:
			failures += 1
			if failures >= 2:  # un blip singolo non è un guasto
				_deferred_state(BackendBus.ERROR, _short_error(res))
		_sleep(POLL_SECS)


## Un giro di ssh non interattivo. Ritorna {code, out} (stdout+stderr).
func _ssh(remote_cmd: String) -> Dictionary:
	var out: Array = []
	var code := OS.execute("ssh", [
		"-i", _key,
		"-o", "BatchMode=yes",
		"-o", "IdentitiesOnly=yes",
		"-o", "ConnectTimeout=%d" % SSH_TIMEOUT,
		"-o", "StrictHostKeyChecking=accept-new",
		"%s@%s" % [_user, _ip],
		remote_cmd,
	], out, true)
	return {"code": code, "out": "\n".join(PackedStringArray(out))}


## Sessioni tmux → snapshot roster per il contratto agents_updated.
## CAPITANO → coordinatore; "scout-2" → slug scout, name "Scout 2";
## i core tengono il proprio nome. status oggi è sempre "working":
## la distinzione fine arriverà da /jht_home quando servirà.
static func _parse_roster(raw: String) -> Array:
	var agents: Array = []
	for line in raw.split("\n"):
		var session := line.strip_edges()
		if session == "" or session.contains(" "):
			continue
		var base := session.to_lower().replace("-worker", "")
		var num := ""
		var parts := base.split("-")
		if parts.size() > 1 and parts[-1].is_valid_int():
			num = parts[-1]
			base = "-".join(parts.slice(0, parts.size() - 1))
		var slug := "coordinatore" if base == "capitano" else base
		var name := slug.capitalize()
		if num != "":
			name += " " + num
		agents.append({
			"slug": slug, "role": slug, "name": name,
			"active": true, "status": "working", "desk_hint": "",
		})
	return agents


func _deferred_state(state: int, detail: String) -> void:
	bus.call_deferred("publish_state", state, detail)


## La riga utile dell'errore ssh, senza sommergere la UI.
static func _short_error(res: Dictionary) -> String:
	for line in str(res["out"]).split("\n"):
		var l := line.strip_edges()
		if l != "" and not l.begins_with("Warning:"):
			return l.left(120)
	return "ssh fallita (exit %s)" % res["code"]


## Sonno interrompibile: reagisce a stop() entro ~0.2s.
func _sleep(secs: float) -> void:
	var waited := 0.0
	while waited < secs and not _stop:
		OS.delay_msec(200)
		waited += 0.2
