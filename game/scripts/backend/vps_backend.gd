class_name VpsBackend
extends BackendAdapter
## Backend REALE: parla via SSH con una VPS del team (container Docker
## `jht`, stato in /jht_home). Legge, non scrive: l'app osserva il team.
## Eccezioni autorizzate da Leone: la chat utente↔agente e il TICKET
## utente→team (gate 1 dell'11/07) — mai scritture dirette sui dati.
##
## Ciclo: start() → CONNECTING → handshake ssh → CONNECTED → poll del
## roster (sessioni tmux nel container = agenti attivi) finché stop().
## Tutto l'I/O vive in un Thread; verso il bus solo call_deferred.

const POLL_SECS := 8.0
const SSH_TIMEOUT := 8
const CHAT_MARK := "---JHT-CHAT---"
const THROTTLE_MARK := "---JHT-THROTTLE---"


## Known-hosts dedicato per singolo server. SetupService lo popola da
## ssh-keyscan PRIMA del primo login; tutti i trasporti successivi usano
## StrictHostKeyChecking=yes, quindi un cambio chiave diventa un errore netto.
static func known_hosts_path(host: String) -> String:
	var root := OS.get_environment("JHT_HOME")
	if root == "":
		root = (OS.get_environment("USERPROFILE") if OS.get_name() == "Windows" \
				else OS.get_environment("HOME")).path_join(".jht")
	return root.path_join("ssh/known_hosts/" + host.sha256_text())


static func ensure_known_host(host: String) -> Dictionary:
	var path := known_hosts_path(host)
	if FileAccess.file_exists(path):
		return {"ok": true, "path": path}
	var output: Array = []
	var code := OS.execute("ssh-keyscan", ["-T", "5", "-t", "ed25519", host],
			output, true)
	var raw := "\n".join(PackedStringArray(output)).strip_edges()
	if code != 0 or raw == "":
		return {"ok": false, "message": UIStrings.t("vps.ssh.host_key_unavailable")}
	DirAccess.make_dir_recursive_absolute(path.get_base_dir())
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		return {"ok": false, "message": UIStrings.t("vps.ssh.known_hosts_unwritable")}
	file.store_string(raw + "\n")
	file.close()
	if OS.get_name() != "Windows":
		OS.execute("chmod", ["600", path])
	return {"ok": true, "path": path}


## Cartella dei payload spediti al container: file `.py` (e il compose `.yml`)
## VERI, non stringhe cieche dentro GDScript. Così hanno evidenziazione,
## formatter e soprattutto un test — `tools/python_payload_syntax_test.py` li
## compila tutti, non più solo quelli che rispettano una convenzione di nome.
const PAYLOAD_DIR := "res://scripts/backend/payloads/"

## Legge un payload dal pacchetto. Quello che torna è una stringa identica a
## com'era la `const`: i `%d`/`%s` restano SEGNAPOSTO GDScript e il chiamante
## continua ad applicare `%` prima di spedire lo script — la sostituzione non
## è cambiata, è cambiato solo da dove arriva il testo.
##
## ⚠️ Export: i `.py`/`.yml` non sono risorse Godot, quindi finiscono nel
## pacchetto solo grazie a `include_filter` in export_presets.cfg. Se ne
## uscissero, qui arriverebbe una stringa vuota e il gioco esportato
## smetterebbe di parlare con la VPS senza che un test locale se ne accorga:
## per questo l'assenza è un errore rumoroso e non un silenzio.
static func payload(name: String) -> String:
	var text := FileAccess.get_file_as_string(PAYLOAD_DIR + name)
	if text.strip_edges() == "":
		push_error("payload assente dal pacchetto: " + name)
	return text


## Stato EFFETTIVO del turno, non semplice presenza tmux. Le tre TUI
## supportate mostrano un marker di interrupt mentre il modello/tool sta
## lavorando; quando il composer è fermo il marker sparisce. In dubbio si
## ritorna idle: è meglio un falso fermo che inventare lavoro e movimento.
static var AGENT_ACTIVITY_PY := payload("agent_activity.py")

## Roster, chat e throttle in UN solo giro ssh e UNA sola docker exec: la
## catena POSIX (;, 2>/dev/null) vive in un blocco a apici singoli parsato
## dalla sh DENTRO il container. Vincolo Windows: in locale il trasporto è
## PowerShell 5.1, che di quella sintassi non capisce niente (2>/dev/null
## diventa il file C:\dev\null — l'"Out-File: impossibile trovare una parte
## del percorso" del test Leone 23/07); un blocco a apici singoli invece lo
## attraversa come argomento unico. tmux ls resta in formato default e il
## nome sessione si estrae dai ':'.
## `exec 2>&1` sta DENTRO gli apici, cioè dentro la sh del container: il
## redirect non deve mai finire alla shell dell'host (su Windows sarebbe
## PowerShell 5.1, che scriverebbe un file chiamato `1`). Un solo flusso da
## leggere significa che il lettore non può restare fermo su stderr mentre
## il container riempie stdout — era metà del blocco del poll (25/07).
const POLL_CMD := "docker exec jht sh -lc 'exec 2>&1; tmux ls 2>/dev/null; echo ---JHT-CHAT---; " \
		# Un team in modalita intensiva puo produrre molte righe fra due poll,
		# ma 500 righe di messaggi del bridge (2 KB l'una) sono quasi un mega
		# riversato in una pipe che su Windows ne regge poche decine: il poll
		# si piantava e il gioco non vedeva mai gli agenti reali (T440s,
		# 25/07). 120 righe restano molto piu del necessario — c'e comunque il
		# cursore a timestamp che scarta quelle gia viste.
		+ "tail -n 120 /jht_home/logs/messages.jsonl 2>/dev/null; " \
		+ "echo ---JHT-THROTTLE---; " \
		# true finale: su un'install fresca throttle-events.jsonl non esiste
		# ancora e l'exit 1 del tail verrebbe scambiato per un guasto del
		# trasporto (2 giri → badge ERROR). code!=0 ora significa solo
		# docker/ssh rotti davvero.
		+ "tail -n 60 /jht_home/logs/throttle-events.jsonl 2>/dev/null; true'"

## Snapshot posizioni dal jobs.db (stesso dataset leggero dei facets del
## web), letto con python3 nel container (sqlite3 CLI assente).
##
## ⚠️ GOTCHA OS.execute (macOS): gli argomenti vengono re-wrappati in
## una sh -c con quoting naive — doppi apici, $, # e newline DENTRO un
## argomento si corrompono SEMPRE. Ricetta obbligata per i comandi
## remoti: solo apici singoli, una riga sola, e le stringhe che
## servirebbero allo script python passate via sys.argv.
const POSITIONS_PY := "import sys,sqlite3,json; db=sqlite3.connect(sys.argv[1]); " \
		+ "db.row_factory=sqlite3.Row; q=lambda s: [dict(r) for r in db.execute(s)]; " \
		+ "print(json.dumps(dict(p=q(sys.argv[2]),h=q(sys.argv[3]),t=q(sys.argv[4])," \
		+ "tr=q(sys.argv[5]))))"
## La lista serve i facet, il dettaglio tutto il resto (mai jd_text: enorme).
const POSITIONS_SELECT := "SELECT p.id,p.title,p.company,p.status,p.role_family," \
		+ "p.loc_country,p.loc_city,p.work_mode,p.source,p.url,p.jd_summary," \
		+ "p.found_by,p.found_at,p.last_checked,p.deadline,p.is_open,p.created_at," \
		+ "p.write_requested,p.geocode_requested,p.recheck_requested," \
		+ "p.user_excluded_reason,p.user_excluded_note," \
		+ "p.salary_declared_min,p.salary_declared_max,p.salary_declared_currency," \
		+ "p.salary_estimated_min,p.salary_estimated_max,p.salary_estimated_currency," \
		+ "p.office_lat,p.office_lon,p.office_address,p.office_verified," \
		+ "s.total_score,s.stack_match,s.remote_fit,s.salary_fit,s.experience_fit," \
		+ "s.strategic_fit,s.scored_by,s.scored_at,s.notes AS score_notes," \
		+ "a.critic_score,a.critic_verdict,a.critic_notes,a.written_by,a.written_at," \
		+ "a.status AS application_status,a.cv_path,a.cv_pdf_path,a.cl_path,a.cl_pdf_path," \
		+ "a.reviewed_by,a.critic_reviewed_at,a.applied_at " \
		+ "FROM positions p LEFT JOIN scores s ON s.position_id=p.id " \
		+ "LEFT JOIN applications a ON a.position_id=p.id " \
		+ "ORDER BY p.created_at DESC"
const HIGHLIGHTS_SELECT := "SELECT position_id,type,text FROM position_highlights ORDER BY id"
const TICKETS_SELECT := "SELECT position_id,request_text,kind,status,assigned_agent," \
		+ "response_text,created_at FROM position_tickets ORDER BY id"
## Il registro attività del team (/team/log del web): chi ha fatto cosa,
## con attribuzione per-istanza (scout-2, scorer-1...).
const TRANSITIONS_SELECT := "SELECT t.position_id,t.from_state,t.to_state,t.ts," \
		+ "t.by_agent,p.title,p.company FROM position_state_transitions t " \
		+ "LEFT JOIN positions p ON p.id=t.position_id ORDER BY t.id DESC LIMIT 80"

const POSITIONS_EVERY := 4  # giri di poll tra due letture del jobs.db
const SETTINGS_EVERY := 8   # config/usage cambiano raramente
const METRICS_EVERY := 1    # dashboard VPS: un campione ogni ~8 secondi

## Metriche host + container, lette sulla VPS senza privilegi aggiuntivi e
## senza scritture. Il doppio campione /proc/stat rende la CPU percentuale.
static var HOST_METRICS_PY := payload("host_metrics.py")

## RSS per sessione tmux (pane + intero albero discendenti) e serie token
## reali già prodotte dal token-meter della VPS.
static var AGENT_METRICS_PY := payload("agent_metrics.py")

## Storico usage in un solo round-trip: serie della sentinella (usage%
## 5h + weekly, append-only da luglio), token-meter.csv (token pesati,
## campione ogni 30s) e ricostruzione per-agente dai log CLI (la stessa
## skill del pacing, /app/shared/skills). Filtro e downsampling avvengono
## QUI sulla VPS: il gioco riceve al massimo qualche centinaio di bucket,
## mai i file interi. Placeholder: %d from_ts, %d to_ts, %d bucket_sec.
static var USAGE_HISTORY_PY := payload("usage_history.py")

## Storico del SINGOLO RUOLO per la scheda agente: token per bucket
## (tutte le istanze del ruolo), conversione in % delle finestre 5h e
## weekly (ratio EMA del token-meter + window-ratio-meter), pause del
## pacing, azioni sul jobs.db (transizioni + eventi scrittore/critico
## dalle applications) e cpu/ram del CONTAINER da vitals.jsonl come
## contesto (telemetria per-agente storica: non esiste, vedi report
## 19/07). Placeholder: %d from, %d to, %d bucket, '%s' ruolo (validato
## [a-z0-9-] dal chiamante — mai testo libero qui dentro).
static var AGENT_HISTORY_PY := payload("agent_history.py")

## Config team + usage REALI, già in forma di coppie [etichetta, valore]
## per le sezioni della sidebar. SOLO campi safe: mai chiavi/credenziali.
static var SETTINGS_PY := payload("settings.py")

## Le TUI fullscreen (in particolare Claude) usano l'alternate screen:
## tmux vede soltanto l'altezza corrente della pane e history_size resta 0,
## anche con capture-pane -S -. Lo storico visibile nel terminale e invece
## persistito dal provider in JSONL. Ne costruiamo una vista testuale
## read-only, limitata ma profonda, da anteporre alla pane live.
##
## Non esportiamo i blocchi `thinking` riservati del provider: la vista
## replica l'attivita osservabile (testo, tool e relativi output), proprio
## come il terminale, senza trasformarsi in un canale interattivo.
static var TERMINAL_HISTORY_PY := payload("terminal_history.py")

## Snapshot per la console del Coordinatore: legge soltanto file di policy e
## jobs.db. Le query sono contatori operativi, non modificano le posizioni.
static var COORDINATOR_STATE_PY := payload("coordinator_state.py")

## Payload validato e scritto atomicamente nei due file canonici. Il JSON
## arriva base64 nello script (mai interpolato in una shell).
static var COORDINATOR_SAVE_PY := payload("coordinator_save.py")

static var COORDINATOR_DIRECTIVE_PY := payload("coordinator_directive.py")

## Stato della deroga agli automatismi di spesa. Non reimplementa nulla:
## interroga shared/skills/burn_intent.py, che è il punto unico di verità
## letto anche dai bridge e dal prompt del Capitano.
##
## `remaining_sec` invece dell'orario di scadenza: fra host e container il
## fuso può differire, mentre un delta in secondi non richiede che i due
## parlino la stessa lingua sui timestamp.
##
## `never_yields`, `default_hours` e `max_hours` viaggiano col dato perché
## l'avviso all'utente li NOMINA: se un giorno la lista cambia nel modulo
## Python, l'avviso cambia con lei senza aspettare una release del gioco.
static var BURN_INTENT_PY := payload("burn_intent.py")

## Concessione/revoca. Passa da grant()/revoke() del modulo, così scrittura
## atomica, clamp delle ore e riga di audit restano dove sono già testati:
## il gioco pilota la deroga, non ne tiene una seconda copia.
static var BURN_INTENT_SET_PY := payload("burn_intent_set.py")

var _ip := ""
var _key := ""
var _user := "root"
var _thread: Thread
var _stop := false
var _last_chat_ts := ""
var _worker_tasks: Array[int] = []
var _worker_tasks_mutex := Mutex.new()
## Risolto sul main thread prima di avviare poll e worker. I thread leggono
## soltanto questa copia e non inizializzano mai i cataloghi lazy.
var _runtime_labels: Dictionary = {}
## Conversazione utente↔agente aperta ("capitano"/"assistente", "" = no).
var _convo_agent := ""
## Sessione osservata dalla vista attività interna (mai interattiva).
var _terminal_agent := ""
var _terminal_history_agent := ""
var _terminal_history_text := ""
var _terminal_history_loaded := false
var _terminal_history_tick := 0


func start(config: Dictionary) -> void:
	live = true  # dati veri: spegne il badge SIMULAZIONE quando connesso
	_runtime_labels = UIStrings.vps_presentation_snapshot()
	_ip = str(config.get("ip", "")).strip_edges()
	_key = expand_user_path(str(config.get("key_path", "")))
	# Config salvata prima del campo utente (o campo lasciato vuoto): root,
	# il default storico e quello di Hetzner.
	_user = str(config.get("user", "root")).strip_edges()
	if _user == "":
		_user = "root"
	if not FileAccess.file_exists(_key):
		bus.publish_state(BackendBus.ERROR,
				UIStrings.t("vps.ssh.key_missing") % _key)
		return
	var ssh_version: Array = []
	if OS.execute("ssh", ["-V"], ssh_version, true) == -1:
		bus.publish_state(BackendBus.ERROR,
				UIStrings.t("vps.ssh.client_missing"))
		return
	var pinned := ensure_known_host(_ip)
	if not bool(pinned.get("ok", false)):
		bus.publish_state(BackendBus.ERROR, str(pinned.get("message",
				UIStrings.t("vps.ssh.fingerprint_failed"))))
		return
	bus.publish_state(BackendBus.CONNECTING, UIStrings.t("vps.ssh.connecting") % _ip)
	_stop = false
	_thread = Thread.new()
	_thread.start(_run)


func stop() -> void:
	_stop = true
	if _thread and _thread.is_started():
		_thread.wait_to_finish()
	_thread = null
	# Le scritture one-shot (chat/profilo/orari/ticket) vivono nel pool
	# globale: se il backend viene distrutto prima del join, possono ancora
	# dereferenziare `bus` durante il teardown dell'engine.
	_worker_tasks_mutex.lock()
	var pending := _worker_tasks.duplicate()
	_worker_tasks.clear()
	_worker_tasks_mutex.unlock()
	for task_id: int in pending:
		WorkerThreadPool.wait_for_task_completion(task_id)


## Espande soltanto un vero prefisso home. Su Windows HOME spesso non
## esiste: USERPROFILE e' la sorgente nativa (C:/Users/...).
static func expand_user_path(path: String, home_override: String = "") -> String:
	var value := path.strip_edges()
	if not (value.begins_with("~/") or value.begins_with("~\\")):
		return value
	var home := home_override
	if home == "":
		home = OS.get_environment("USERPROFILE") if OS.get_name() == "Windows" \
				else OS.get_environment("HOME")
	if home == "":
		home = OS.get_environment("HOME") if OS.get_name() == "Windows" \
				else OS.get_environment("USERPROFILE")
	if home == "":
		return value
	return home.rstrip("/\\").path_join(value.substr(2))


func _queue_worker(callable: Callable) -> void:
	if _stop:
		return
	# Un task completato conserva il proprio slot finche non viene waited.
	# Reap opportunistico: le sessioni lunghe con molta chat non accumulano ID.
	var completed: Array[int] = []
	_worker_tasks_mutex.lock()
	for i in range(_worker_tasks.size() - 1, -1, -1):
		var old_id := _worker_tasks[i]
		if WorkerThreadPool.is_task_completed(old_id):
			completed.append(old_id)
			_worker_tasks.remove_at(i)
	_worker_tasks_mutex.unlock()
	for old_id: int in completed:
		WorkerThreadPool.wait_for_task_completion(old_id)
	var task_id := WorkerThreadPool.add_task(callable)
	_worker_tasks_mutex.lock()
	_worker_tasks.append(task_id)
	_worker_tasks_mutex.unlock()


## ── Thread di I/O ─────────────────────────────────────────────────────

func _run() -> void:
	# handshake: la VPS risponde e il container jht esiste?
	# Apici singoli attorno al template Go: senza, su Windows PowerShell
	# (_ssh → powershell -Command) interpreta {{.State.Status}} come
	# script-block e corrompe l'intero `docker inspect` → probe in ERROR,
	# backend mai CONNECTED, badge SIMULAZIONE e chat scartata in local.
	# Gli apici singoli sono innocui e portabili (sh li rispetta uguale).
	var probe := _ssh("echo JHT_OK; docker inspect jht --format '{{.State.Status}}'")
	if _stop:
		return
	if probe["code"] != 0 or not probe["out"].contains("JHT_OK"):
		_deferred_state(BackendBus.ERROR, _short_error(probe))
		return
	if not probe["out"].contains("running"):
		_deferred_state_key(BackendBus.ERROR, "backend.container_not_running")
		return
	_deferred_state(BackendBus.CONNECTED, _ip)

	# poll di roster + chat (+ posizioni, più raro) finché non ci fermano
	var failures := 0
	var tick := 0
	while not _stop:
		var res := _ssh(POLL_CMD)
		if _stop:
			return
		if res["code"] == 0:
			if failures > 0:
				failures = 0
				_deferred_state(BackendBus.CONNECTED, _ip)
			var parts: PackedStringArray = str(res["out"]).split(CHAT_MARK)
			var chat_raw := ""
			var throttle_raw := ""
			if parts.size() > 1:
				var tail: PackedStringArray = parts[1].split(THROTTLE_MARK)
				chat_raw = tail[0]
				if tail.size() > 1:
					throttle_raw = tail[1]
			var activity := {}
			var activity_res := _ssh_python(AGENT_ACTIVITY_PY)
			if OS.get_environment("JHT_ROSTER_TRACE") == "1":
				print("ACTIVITY-TRACE code=", activity_res["code"], " out=",
						str(activity_res["out"]).left(2000))
			if activity_res["code"] == 0:
				activity = _smooth_activity(_parse_activity(str(activity_res["out"])))
			var roster := _parse_roster(parts[0], _parse_throttles(throttle_raw),
					activity, _runtime_labels)
			# mappa uid → sessione tmux per la chat (dict nuovo assegnato
			# in blocco: niente stati intermedi visti dagli altri thread)
			var sessions := {}
			for a in roster:
				sessions[a["uid"]] = a["session"]
			_agent_sessions = sessions
			bus.call_deferred("publish_agents", roster)
			if chat_raw != "":
				_ingest_chat(chat_raw)
		else:
			failures += 1
			if failures >= 2:  # un blip singolo non è un guasto
				_deferred_state(BackendBus.ERROR, _short_error(res))
		if tick % POSITIONS_EVERY == 0:
			_fetch_positions()
		if tick % SETTINGS_EVERY == 0:
			_fetch_settings()
		if tick % METRICS_EVERY == 0:
			_fetch_metrics()
		if _convo_agent != "":
			_fetch_convo(_convo_agent)
		if _terminal_agent != "":
			_fetch_terminal(_terminal_agent)
		if _profile_watch:
			_fetch_profile_status()
		tick += 1
		# con una conversazione aperta il giro accorcia: la risposta
		# dell'agente deve comparire in fretta, non dopo 8 secondi
		_sleep(2.5 if (_convo_agent != "" or _terminal_agent != "") else POLL_SECS)


## jobs.db → positions_updated: snapshot completo con highlights e
## ticket già agganciati per posizione (la vista filtra e naviga locale).
func _fetch_positions() -> void:
	var res := _ssh("docker exec -i jht python3 -c '" + POSITIONS_PY \
			+ "' /jht_home/jobs.db '" + POSITIONS_SELECT + "' '" \
			+ HIGHLIGHTS_SELECT + "' '" + TICKETS_SELECT + "' '" \
			+ TRANSITIONS_SELECT + "'")
	if _stop or res["code"] != 0:
		if not _stop:
			Log.call_deferred("debug", "backend", "fetch posizioni KO: code=%s %s" % [
					res["code"], str(res["out"]).left(120)])
		return
	var raw := str(res["out"]).strip_edges()
	# stdout può avere righe di warning attorno: il JSON è la riga con {
	for line in raw.split("\n"):
		if line.begins_with("{"):
			var data: Variant = JSON.parse_string(line)
			if data is Dictionary:
				# transitions vanno sul bus PRIMA del segnale: le viste
				# le leggono al positions_updated (unico tick dati)
				bus.set_deferred("transitions", data.get("tr", []))
				bus.call_deferred("publish_positions", _assemble_positions(data))
			return

## jht.config.json + usage table → BackendBus.live_settings (le sezioni
## config della sidebar e la pagina Utilizzo mostrano il reale).
func _fetch_settings() -> void:
	var res := _ssh_python(SETTINGS_PY)
	if _stop or res["code"] != 0:
		return
	for line in str(res["out"]).split("\n"):
		if line.begins_with("{"):
			var data: Variant = JSON.parse_string(line)
			if data is Dictionary:
				bus.call_deferred("publish_settings", data)
			return

func _fetch_metrics() -> void:
	var res := _ssh_host_python(HOST_METRICS_PY)
	if _stop or res["code"] != 0:
		return
	for line in str(res["out"]).split("\n"):
		if line.begins_with("{"):
			var data: Variant = JSON.parse_string(line)
			if data is Dictionary:
				var agent_res := _ssh_python(AGENT_METRICS_PY)
				if agent_res["code"] == 0:
					for agent_line in str(agent_res["out"]).split("\n"):
						if agent_line.begins_with("{"):
							var agent_data: Variant = JSON.parse_string(agent_line)
							if agent_data is Dictionary:
								data.merge(agent_data, true)
							break
				bus.call_deferred("publish_telemetry", data)
			return


## Unisce le tre SELECT: highlights e ticket dentro la loro posizione.
static func _assemble_positions(data: Dictionary) -> Array:
	var by_id := {}
	var rows: Array = data.get("p", [])
	for p in rows:
		p["highlights"] = []
		p["tickets"] = []
		by_id[p["id"]] = p
	for h in data.get("h", []):
		if by_id.has(h.get("position_id")):
			by_id[h["position_id"]]["highlights"].append(h)
	for t in data.get("t", []):
		if by_id.has(t.get("position_id")):
			by_id[t["position_id"]]["tickets"].append(t)
	return rows


## Coda di messages.jsonl → chat_message sul bus, solo il nuovo rispetto
## al cursore (ts ISO UTC: il confronto lessicografico è cronologico).
## Il primo giro stabilisce soltanto il cursore: lo storico non deve
## esplodere in una parete di fumetti appena si apre l'ufficio.
func _ingest_chat(raw: String) -> void:
	var msgs: Array = []
	for line in raw.split("\n"):
		if line.strip_edges() == "":
			continue
		var d: Variant = JSON.parse_string(line)
		if d == null or not (d is Dictionary):
			continue
		var m := _to_chat_msg(d)
		if not m.is_empty() and str(m["ts"]) > _last_chat_ts:
			msgs.append(m)
	if msgs.is_empty():
		return
	if _last_chat_ts == "":
		_last_chat_ts = str(msgs[-1]["ts"])
		return
	_last_chat_ts = str(msgs[-1]["ts"])
	for m in msgs:
		bus.call_deferred("publish_chat", m)


## Una riga di messages.jsonl → il contratto {ts, from, to, text}.
## Scarta il rumore non-agente (tick del bridge/pacing senza mittente).
## Il testo è COMPLETO (body quando c'è, mai troncato: feedback Leone
## 21:2x): chi ha vincoli di spazio (i fumetti) accorcia da sé.
static func _to_chat_msg(d: Dictionary) -> Dictionary:
	var from := _uid_norm(str(d.get("from", "")))
	if from == "" or from == "pacing" or from == "bridge":
		return {}
	var to := _uid_norm(str(d.get("to", "")))
	if to == "":
		to = _uid_norm(str(d.get("session", "")))
	var text := str(d.get("body", "")).strip_edges()
	if text == "":
		text = str(d.get("preview", "")).strip_edges()
	if text == "":
		return {}
	# messages.jsonl conserva spesso anche l'envelope umano nel body:
	# "[@a -> @b] [INFO] contenuto". From/to/type sono gia campi JSON;
	# rimuoverli dal fumetto lascia spazio al messaggio vero.
	if text.begins_with("[@"):
		var close := text.find("]")
		if close >= 0:
			text = text.substr(close + 1).strip_edges()
	if text.begins_with("["):
		var type_close := text.find("]")
		if type_close >= 0:
			text = text.substr(type_close + 1).strip_edges()
	return {"ts": str(d.get("ts", "")), "from": from, "to": to, "text": text}


## Nomi del sistema reale → UID del gioco (capitano → coordinatore).
## Il suffisso -worker e parte dell'identita d'istanza: SENTINELLA e
## SENTINELLA-WORKER possono essere vive insieme e devono restare due avatar.
static func _uid_norm(name: String) -> String:
	var s := name.strip_edges().to_lower()
	return "coordinatore" if s == "capitano" else s


## ── Chat bidirezionale utente ↔ agente ───────────────────────────────
## Invio = il canale della desktop app: persist del messaggio utente in
## chat.jsonl + payload [@utente -> @<agent>] [CHAT] consegnato alla tmux
## dell'agente con jht-tmux-send (busy-wait + verify + submit). Il testo
## NON attraversa mai una shell come argomento (gotcha OS.execute):
## viaggia su file temporaneo locale, arriva via stdin e diventa argomento
## solo nella sh DENTRO il container ("$msg").
## Chat 1-a-1 con OGNI agente del roster: l'uid del gioco si risolve in
## directory (/jht_home/agents/<dir>/) e sessione tmux raw dal poll.

var _agent_sessions := {}  # uid → nome sessione tmux (dal roster)

## uid del gioco → directory dell'agente sotto /jht_home/agents/
## (il coordinatore del gioco è il capitano del sistema reale).
static func _agent_dir(uid: String) -> String:
	return "capitano" if uid == "coordinatore" else uid

func _agent_session(uid: String) -> String:
	return str(_agent_sessions.get(uid, _agent_dir(uid).to_upper()))

func open_chat(agent: String) -> void:
	_convo_agent = agent

func close_chat() -> void:
	_convo_agent = ""

func open_terminal(agent: String) -> void:
	_terminal_agent = agent
	_terminal_history_agent = agent
	_terminal_history_text = ""
	_terminal_history_loaded = false
	_terminal_history_tick = 0
	# Primo frame senza attendere la fine dell'eventuale sleep del poll.
	_queue_worker(_fetch_terminal.bind(agent))

func close_terminal() -> void:
	_terminal_agent = ""
	_terminal_history_agent = ""
	_terminal_history_text = ""
	_terminal_history_loaded = false
	_terminal_history_tick = 0

func _fetch_terminal(agent: String) -> void:
	if _stop or agent == "" or agent != _terminal_agent:
		return
	_terminal_history_tick += 1
	# Lo storico provider e molto piu profondo della pane ma non serve
	# rileggerne megabyte a ogni frame: prima apertura + refresh ~1/minuto.
	if not _terminal_history_loaded or _terminal_history_tick >= 24:
		var history := _fetch_terminal_history(agent)
		if _stop or agent != _terminal_agent:
			return
		_terminal_history_agent = agent
		_terminal_history_text = history
		_terminal_history_loaded = true
		_terminal_history_tick = 0
	var session := _agent_session(agent)
	if not _safe_tmux_session(session):
		_terminal_result(agent, "", _ui_text(_runtime_labels,
				"vps.terminal.invalid_session"))
		return
	# `-S -` legge tutto lo scrollback disponibile (lo stesso contratto della
	# dashboard privata quando l'utente chiede la vista top). Non usiamo -e:
	# niente sequenze ANSI nella UI e, soprattutto, nessuna send-keys o
	# paste-buffer.
	# Base64 nasce dentro il container: alcune TUI lasciano celle NUL nella
	# pane e farle attraversare direttamente OS.execute costringe Godot a
	# decodificarle come testo, producendo warning e caratteri sostitutivi.
	var res := _ssh("docker exec jht sh -lc 'tmux capture-pane -p -S - -t " \
			+ session + " | base64'")
	if _stop or agent != _terminal_agent:
		return
	if res["code"] != 0:
		_terminal_result(agent, "", _short_error(res))
		return
	var encoded := str(res["out"]).replace("\n", "").replace("\r", "")
	var raw := Marshalls.base64_to_raw(encoded)
	var clean := PackedByteArray()
	for byte in raw:
		if byte != 0:
			clean.append(byte)
	var content := clean.get_string_from_utf8()
	if content.length() > 500000:
		content = _ui_text(_runtime_labels, "vps.terminal.output_omitted") \
				+ "\n" + content.right(500000)
	var combined := content
	if _terminal_history_agent == agent and _terminal_history_text != "":
		combined = "── " + _ui_text(_runtime_labels, "vps.terminal.history_heading") \
				+ " ─────────────────────────────\n\n" \
				+ _terminal_history_text \
				+ "\n\n── " + _ui_text(_runtime_labels, "vps.terminal.live_heading") \
				+ " ──────────────────────────────\n\n" \
				+ content
	_terminal_result(agent, combined, "")

func _fetch_terminal_history(agent: String) -> String:
	var agent_dir := _agent_dir(agent)
	if not _safe_tmux_session(agent_dir):
		return ""
	var encoded_agent := Marshalls.utf8_to_base64(agent_dir)
	var res := _ssh_python(TERMINAL_HISTORY_PY % encoded_agent)
	if res["code"] != 0:
		return ""
	for line in str(res["out"]).split("\n"):
		if not line.begins_with("{"):
			continue
		var parsed: Variant = JSON.parse_string(line)
		if not (parsed is Dictionary) or not bool(parsed.get("ok", false)):
			return ""
		var payload := str(parsed.get("text_b64", ""))
		if payload == "":
			return ""
		return Marshalls.base64_to_raw(payload).get_string_from_utf8()
	return ""

static func _safe_tmux_session(session: String) -> bool:
	if session == "" or session.length() > 96:
		return false
	for code in session.to_ascii_buffer():
		var c := int(code)
		if not ((c >= 48 and c <= 57) or (c >= 65 and c <= 90) \
				or (c >= 97 and c <= 122) or c in [45, 46, 95]):
			return false
	return true

func _terminal_result(agent: String, text: String, error: String) -> void:
	bus.call_deferred("publish_agent_terminal", agent, text, error)


## ── Console operativa del Coordinatore ──────────────────────────────

func fetch_coordinator_state() -> void:
	_queue_worker(_do_fetch_coordinator_state)

func _do_fetch_coordinator_state() -> void:
	var res := _ssh_python(COORDINATOR_STATE_PY)
	if _stop:
		return
	var parsed := _json_result(res)
	if parsed.is_empty() or not bool(parsed.get("ok", false)):
		bus.call_deferred("publish_coordinator_action", "load", false,
				_short_error(res, _runtime_labels) if res["code"] != 0 \
				else _ui_text(_runtime_labels, "vps.coordinator.unreadable"))
		return
	bus.call_deferred("publish_coordinator_state", parsed)

func save_coordinator_settings(settings: Dictionary) -> void:
	_queue_worker(_do_save_coordinator_settings.bind(settings.duplicate(true)))

func _do_save_coordinator_settings(settings: Dictionary) -> void:
	var payload := Marshalls.utf8_to_base64(JSON.stringify(settings))
	var res := _ssh_python(COORDINATOR_SAVE_PY % payload)
	if _stop:
		return
	var parsed := _json_result(res)
	var ok: bool = res["code"] == 0 and bool(parsed.get("ok", false))
	bus.call_deferred("publish_coordinator_action", "save", ok,
			"" if ok else _short_error(res))
	if not ok:
		return
	_do_fetch_coordinator_state()
	# I file sono enforcement a codice; questo messaggio sveglia inoltre il
	# Capitano e gli fa ricalcolare subito assegnazioni e code. La modalità
	# viaggia nel testo perché il Capitano non debba dedurla dal diff dei file.
	var mode := str((settings.get("maintenance", {}) as Dictionary).get(
			"mode", ""))
	var mode_note := "" if mode == "" else "Modalità di lavoro: " + mode + ". "
	_do_send_chat("coordinatore",
			"Impostazioni operative aggiornate dalla console. " + mode_note \
			+ "Rileggi " \
			+ "/jht_home/profile/capitano-maintenance.json (se presente) e " \
			+ "/jht_home/profile/enrichment-policy.json; applicale ora e " \
			+ "ribilancia il team rispettando budget e code.")

func add_team_directive(body: String, kind: String) -> void:
	var clean := body.strip_edges()
	if clean == "" or clean.length() > 2000:
		bus.publish_coordinator_action("directive_add", false,
				UIStrings.t("vps.directive.invalid"))
		return
	_queue_worker(_do_team_directive.bind({"action": "add", "body": clean,
			"kind": kind}))

func archive_team_directive(directive_id: int) -> void:
	if directive_id <= 0:
		bus.publish_coordinator_action("directive_archive", false,
				UIStrings.t("vps.directive.id_invalid"))
		return
	_queue_worker(_do_team_directive.bind({"action": "archive", "id": directive_id}))

func _do_team_directive(action: Dictionary) -> void:
	var payload := Marshalls.utf8_to_base64(JSON.stringify(action))
	var res := _ssh_python(COORDINATOR_DIRECTIVE_PY % payload)
	if _stop:
		return
	var parsed := _json_result(res)
	var ok: bool = res["code"] == 0 and bool(parsed.get("ok", false))
	var action_name := "directive_add" if str(action.get("action")) == "add" \
			else "directive_archive"
	bus.call_deferred("publish_coordinator_action", action_name, ok,
			"" if ok else _short_error(res))
	if not ok:
		return
	_do_fetch_coordinator_state()
	_do_send_chat("coordinatore",
			"La bacheca permanente del team è cambiata. Esegui " \
			+ "python3 /app/shared/skills/team_directives.py active, " \
			+ "poi applica le direttive attive.")


## ── Deroga a termine agli automatismi di spesa ──────────────────────
##
## Un solo percorso per le due macchine: `_ssh_python` scrive lo script su
## `docker exec -i jht python3 -`, e LocalBackend sostituisce SOLO il
## trasporto (`_ssh_stdin_file` con docker diretto invece di ssh). Da qui in
## giù locale e VPS eseguono lo stesso identico Python nello stesso
## container, come già fanno console del Coordinatore, bacheca e ticket.

func fetch_burn_intent() -> void:
	_queue_worker(_do_fetch_burn_intent)

func _do_fetch_burn_intent() -> void:
	var res := _ssh_python(BURN_INTENT_PY)
	if _stop:
		return
	var parsed := _json_result(res)
	if parsed.is_empty() or not bool(parsed.get("ok", false)):
		# Fail-closed di sola lettura: non sapere non è "deroga spenta".
		bus.call_deferred("publish_burn_intent", {"readable": false,
				"error": _short_error(res, _runtime_labels) if res["code"] != 0 \
						else _ui_text(_runtime_labels, "vps.burn.unreadable")})
		return
	parsed["readable"] = true
	bus.call_deferred("publish_burn_intent", parsed)

func set_burn_intent(active: bool, hours: float) -> void:
	_queue_worker(_do_set_burn_intent.bind(active, hours))

func _do_set_burn_intent(active: bool, hours: float) -> void:
	var payload := Marshalls.utf8_to_base64(JSON.stringify({
			"active": active, "hours": hours}))
	var res := _ssh_python(BURN_INTENT_SET_PY % payload)
	if _stop:
		return
	var parsed := _json_result(res)
	var ok: bool = res["code"] == 0 and bool(parsed.get("ok", false))
	bus.call_deferred("publish_burn_intent_action", active, ok,
			"" if ok else _short_error(res))
	if not ok:
		return
	# Si rilegge SEMPRE il flag appena scritto: l'interruttore deve mostrare
	# ciò che il team leggerà, non ciò che l'utente ha chiesto. Se il clamp
	# ha ridotto le ore, o se il file non è dove pensiamo, si vede subito.
	_do_fetch_burn_intent()
	# I bridge rileggono il flag da soli al prossimo tick (≤5 min). Questo
	# messaggio serve a un'altra cosa: con gli automatismi sospesi l'unica
	# sorveglianza rimasta è il Capitano, e deve saperlo ADESSO — nella notte
	# del 27/07 una deroga tecnica non arrivata agli agenti fu annullata in
	# buona fede da chi seguiva correttamente il proprio prompt.
	if active:
		_do_send_chat("coordinatore",
				"L'utente ha concesso una deroga A TERMINE agli automatismi " \
				+ "di spesa dal pannello. Esegui " \
				+ "python3 /app/shared/skills/burn_intent.py status: finché " \
				+ "risulta attiva sospendi daily-halt, gate orario, " \
				+ "WORKER_FLOOR e ladder, e non rimetterli a posto. Restano " \
				+ "attivi weekly-halt, host_agent_cap, SC-09 e freeze_team. " \
				+ "Senza gli automatismi la sorveglianza è tua: ferma tu un " \
				+ "agente che consuma senza produrre.")
	else:
		_do_send_chat("coordinatore",
				"L'utente ha revocato la deroga agli automatismi di spesa. " \
				+ "Verifica con python3 /app/shared/skills/burn_intent.py " \
				+ "status e torna al pacing predefinito.")

static func _json_result(res: Dictionary) -> Dictionary:
	if int(res.get("code", -1)) != 0:
		return {}
	for line in str(res.get("out", "")).split("\n"):
		if not line.begins_with("{"):
			continue
		var parsed: Variant = JSON.parse_string(line)
		if parsed is Dictionary:
			return parsed
	return {}

func send_chat(agent: String, text: String) -> void:
	if text.strip_edges() == "":
		return
	# thread one-shot: 3 giri ssh non devono congelare né la UI né il poll
	_queue_worker(_do_send_chat.bind(agent, text.strip_edges(), ""))

func send_chat_with_context(agent: String, text: String, context: String) -> void:
	if text.strip_edges() == "":
		return
	_queue_worker(_do_send_chat.bind(agent, text.strip_edges(), context.strip_edges()))

func _do_send_chat(agent: String, text: String, context := "") -> void:
	var session := _agent_session(agent)
	var buf := _temp_path("jht-game-chat")
	var chat_file := "/jht_home/agents/%s/chat.jsonl" % _agent_dir(agent)

	# 1) persisti il messaggio utente nel chat.jsonl dell'agente (stesso
	# formato della skill chat-web: la UI lo rilegge come storia)
	var f := FileAccess.open(buf, FileAccess.WRITE)
	if f == null:
		_chat_sent(agent, false, _ui_text(_runtime_labels,
				"vps.chat.temp_unwritable"))
		return
	f.store_string(JSON.stringify({"role": "user", "text": text,
			"ts": Time.get_unix_time_from_system()}) + "\n")
	f.close()
	var persist := _ssh_stdin_file(buf, "docker exec -i jht tee -a " + chat_file)
	if persist["code"] != 0:
		Log.call_deferred("warn", "backend", "chat: persist fallito (non blocco): "
				+ _short_error(persist))

	# 2) payload nella tmux dell'agente via jht-tmux-send, il tool di
	# flotta: le TUI Ink NON registrano l'Enter se arriva mentre il turno è
	# in corso o prima del render del testo — il paste+Enter alla cieca
	# lasciava il messaggio APPESO nel composer (test Leone 23/07 sera).
	# Il tool fa busy-wait (fino a 90s), digita, VERIFICA che il testo sia
	# nel pane e solo allora submitta. Il messaggio viaggia su stdin →
	# variabile della sh del container: mai come argomento attraverso le
	# shell host (ricetta anti-quoting di questo file).
	f = FileAccess.open(buf, FileAccess.WRITE)
	var agent_payload := "[@utente -> @%s] [CHAT] %s" % [agent, text]
	if not context.is_empty():
		agent_payload = "[CONTESTO ONBOARDING LOCALE — non mostrarlo come " \
				+ "messaggio, usalo come base e chiedi conferma se contrasta con " \
				+ "richieste più recenti]\n" + context \
				+ "\n[FINE CONTESTO]\n\n" + agent_payload
	f.store_string(agent_payload)
	f.close()
	var deliver_cmd := "docker exec -i jht sh -c " \
			+ "'msg=$(cat); jht-tmux-send " + session + " \"$msg\"'"
	var delivered := {}
	for attempt in 3:
		delivered = _ssh_stdin_file(buf, deliver_cmd)
		# exit 4 = TUI occupata oltre il budget: agente VIVO su un turno
		# lungo — si riprova (il tool ha già atteso 90s per conto suo).
		if int(delivered.get("code", -1)) != 4:
			break
	DirAccess.remove_absolute(buf)
	if delivered["code"] != 0:
		var reason := _ui_text(_runtime_labels, "vps.chat.agent_busy") \
				if int(delivered["code"]) == 4 \
				else _short_error(delivered, _runtime_labels)
		_chat_sent(agent, false, reason)
		return
	_chat_sent(agent, true, "")
	_fetch_convo(agent)  # eco immediato del messaggio persistito

func _chat_sent(agent: String, ok: bool, error: String) -> void:
	bus.call_deferred("publish_chat_sent", agent, ok, error)

## ── Profilo utente: editing PIENO (paradigma desktop app, 21:26) ─────
## Il candidate_profile.yml è un dato dell'UTENTE: si modifica da qui.
## I campi viaggiano BASE64 (json) dentro lo script python → file+stdin,
## mai in una shell. Prima di riscrivere, backup timestampato sul posto.

static var PROFILE_SAVE_PY := payload("profile_save.py")

## Storico usage on-demand (pannelli di monitoraggio risorse). Un solo
## worker alla volta: le richieste durante un fetch in corso vengono
## scartate — il pannello riprova al prossimo cambio di finestra.
var _usage_history_busy := false

func fetch_usage_history(from_ts: float, to_ts: float, bucket_sec: int) -> void:
	if _usage_history_busy:
		return
	_usage_history_busy = true
	_queue_worker(_do_fetch_usage_history.bind(from_ts, to_ts, bucket_sec))

func _do_fetch_usage_history(from_ts: float, to_ts: float, bucket_sec: int) -> void:
	var query := {"from_ts": from_ts, "to_ts": to_ts, "bucket_sec": bucket_sec}
	var res := _ssh_python(USAGE_HISTORY_PY % [int(from_ts), int(to_ts), bucket_sec])
	_usage_history_busy = false
	if _stop:
		return
	if res["code"] == 0:
		for line in str(res["out"]).split("\n"):
			if line.begins_with("{"):
				var data: Variant = JSON.parse_string(line)
				if data is Dictionary:
					bus.call_deferred("publish_usage_history", query, data)
					return
	bus.call_deferred("publish_usage_history", query,
			{"ok": false, "error": _short_error(res)})

var _agent_history_busy := false
## Richiesta arrivata mentre il worker era occupato: si tiene SOLO
## l'ultima (è la finestra corrente) e parte appena il giro si libera.
## Prima veniva scartata in silenzio e il grafico restava sotto il velo
## di caricamento finché qualcosa non lo ritriggava.
var _agent_history_next := {}

## Ruolo SEMPRE validato prima dell'interpolazione nello script python:
## niente testo libero dentro il payload remoto.
func fetch_agent_history(agent: String, from_ts: float, to_ts: float,
		bucket_sec: int) -> void:
	var query := {"agent": agent, "from_ts": from_ts, "to_ts": to_ts,
			"bucket_sec": bucket_sec}
	var re := RegEx.create_from_string("^[a-z0-9-]{1,40}$")
	if re.search(agent) == null:
		bus.call_deferred("publish_agent_history", query,
				{"ok": false, "error": UIStrings.t("vps.history.role_invalid")})
		return
	if _agent_history_busy:
		_agent_history_next = query
		return
	_agent_history_busy = true
	_queue_worker(_do_fetch_agent_history.bind(query))

func _do_fetch_agent_history(query: Dictionary) -> void:
	var res := _ssh_python(AGENT_HISTORY_PY % [int(query["from_ts"]),
			int(query["to_ts"]), int(query["bucket_sec"]),
			str(query["agent"])])
	_agent_history_busy = false
	if _stop:
		return
	var payload: Dictionary = {"ok": false, "error": _short_error(res)}
	if res["code"] == 0:
		for line in str(res["out"]).split("\n"):
			if line.begins_with("{"):
				var data: Variant = JSON.parse_string(line)
				if data is Dictionary:
					payload = data
					break
	bus.call_deferred("publish_agent_history", query, payload)
	if not _agent_history_next.is_empty():
		var next: Dictionary = _agent_history_next
		_agent_history_next = {}
		fetch_agent_history(str(next["agent"]), float(next["from_ts"]),
				float(next["to_ts"]), int(next["bucket_sec"]))

func save_profile(fields: Dictionary) -> void:
	_queue_worker(_do_save_profile.bind(fields))

func _do_save_profile(fields: Dictionary) -> void:
	var b64 := Marshalls.utf8_to_base64(JSON.stringify(fields))
	var res := _ssh_python(PROFILE_SAVE_PY % b64)
	var ok: bool = res["code"] == 0 and str(res["out"]).contains("\"ok\": true")
	bus.call_deferred("emit_signal", "profile_saved", ok,
			"" if ok else _short_error(res))
	if ok:
		_fetch_settings()  # il profilo aggiornato rientra subito in vista


## ── Onboarding in-game (wizard: il badge si compila con l'assistente) ─
## Stato del profilo = STESSA semantica di GET /api/profile del web:
## ready = ready.flag esiste OPPURE tutti i campi required ok. La
## checklist required replica web/lib/profile-completion.ts (2026-06-06):
## name, email, target_role, location, experience_years,
## seniority_target, ≥2 skill, ≥1 lingua. Chi SCRIVE il profilo resta
## l'agente assistente: il gioco osserva e basta, come la pagina web.

static var PROFILE_STATUS_PY := payload("profile_status.py")

var _profile_watch := false

func open_profile_watch() -> void:
	_profile_watch = true

func close_profile_watch() -> void:
	_profile_watch = false

func _fetch_profile_status() -> void:
	var res := _ssh_python(PROFILE_STATUS_PY)
	if _stop or res["code"] != 0:
		return
	for line in str(res["out"]).split("\n"):
		if line.begins_with("{"):
			var d: Variant = JSON.parse_string(line)
			if d is Dictionary:
				bus.call_deferred("publish_profile_status", d)
			return

## Avvio idempotente dell'assistente (equivalente di POST
## /api/assistente/start): se la sessione ASSISTENTE non c'è, lancia
## start-agent.sh dentro il container. Il || e il detach (setsid -f al
## posto di docker -d) vivono nella sh del container, dentro apici
## singoli: PowerShell 5.1 (trasporto locale Windows) non ha || e senza
## questo blocco l'assistente non partiva MAI in locale (Leone 23/07).
func ensure_assistant() -> void:
	_queue_worker(_do_ensure_assistant)

func _do_ensure_assistant() -> void:
	_ssh("docker exec jht sh -lc 'tmux has-session -t ASSISTENTE 2>/dev/null " \
			+ "|| setsid -f bash /app/.launcher/start-agent.sh assistente'")

## Upload CV/documenti nella drop-zone del container (/jht_user/allegati,
## stessa destinazione di POST /api/assistente/upload). Il file viaggia
## binario su stdin di OpenSSH → tee nel container: mai in una shell come
## argomento. Vincoli identici alla route web: estensioni note, max 10MB.

const UPLOAD_DIR := "/jht_user/allegati"
const UPLOAD_MAX_BYTES := 10 * 1024 * 1024
const UPLOAD_EXTS := ["pdf", "doc", "docx", "txt", "md", "png", "jpg",
		"jpeg", "csv", "xlsx", "xls", "json", "yaml", "yml"]

const PRESENTATION_ERROR_KEYS := {
	"percorso fuori dalle aree dati": "vps.artifact.path_outside",
	"file non trovato sul container": "vps.artifact.file_missing",
	"file oltre i 10 MB": "vps.upload.file_too_large",
	"posizione inesistente": "vps.ticket.position_missing",
}

const ACTIVITY_DETAIL_KEYS := {
	"tool in esecuzione": "vps.activity.tool",
	"elaborazione": "vps.activity.thinking",
	"turno in corso": "vps.activity.working",
	"in attesa di ripresa": "vps.activity.paused",
	"sessione attiva, nessun turno in corso": "vps.activity.idle",
	"pane non osservabile": "vps.activity.pane_unavailable",
	"stato non osservato": "vps.activity.unobserved",
	"sessione attiva, stato non osservato": "vps.activity.session_unobserved",
	"pacing: pausa temporizzata": "vps.activity.throttled",
}

const PRESENTATION_ENGLISH := {
	"vps.upload.file_missing": "file not found: %s",
	"vps.upload.extension_denied": "extension not allowed: .%s",
	"vps.upload.file_unreadable": "file cannot be read",
	"vps.upload.file_too_large": "file exceeds 10 MB",
	"vps.response_unreadable": "unreadable response from the VPS",
	"vps.artifact.path_outside": "path is outside the data areas",
	"vps.artifact.file_missing": "file not found in the container",
	"vps.ticket.position_missing": "position does not exist",
	"vps.ssh.failed": "SSH failed (exit %s)",
	"vps.terminal.invalid_session": "invalid tmux session name",
	"vps.terminal.output_omitted": "… earlier output omitted …",
	"vps.terminal.history_heading": "SESSION HISTORY",
	"vps.terminal.live_heading": "LIVE TMUX PANE",
	"vps.coordinator.unreadable": "coordinator state could not be read",
	"vps.burn.unreadable": "override state could not be read",
	"vps.chat.temp_unwritable": "temporary file cannot be written",
	"vps.chat.agent_busy": "the agent has been busy for several minutes; try again shortly",
	"vps.activity.unobserved": "state not observed",
	"vps.activity.working": "turn in progress",
	"vps.activity.session_unobserved": "active session, state not observed",
	"vps.activity.throttled": "pacing: timed pause",
	"vps.activity.tool": "tool running",
	"vps.activity.thinking": "thinking",
	"vps.activity.paused": "waiting to resume",
	"vps.activity.idle": "active session, no turn in progress",
	"vps.activity.pane_unavailable": "pane unavailable",
}

func upload_document(local_path: String) -> void:
	_queue_worker(_do_upload_document.bind(local_path,
			UIStrings.vps_presentation_snapshot()))

func _do_upload_document(local_path: String, labels: Dictionary) -> void:
	if not FileAccess.file_exists(local_path):
		_doc_uploaded(false, "", _ui_text(labels, "vps.upload.file_missing") % local_path)
		return
	var ext := local_path.get_extension().to_lower()
	if not UPLOAD_EXTS.has(ext):
		_doc_uploaded(false, "", _ui_text(labels, "vps.upload.extension_denied") % ext)
		return
	var f := FileAccess.open(local_path, FileAccess.READ)
	if f == null:
		_doc_uploaded(false, "", _ui_text(labels, "vps.upload.file_unreadable"))
		return
	var size := f.get_length()
	f.close()
	if size > UPLOAD_MAX_BYTES:
		_doc_uploaded(false, "", _ui_text(labels, "vps.upload.file_too_large"))
		return
	var safe := _safe_filename(local_path.get_file())
	var remote := UPLOAD_DIR + "/" + safe
	var mk := _ssh("docker exec jht mkdir -p " + UPLOAD_DIR)
	if mk["code"] != 0:
		_doc_uploaded(false, "", _short_error(mk, labels))
		return
	# >/dev/null dentro la sh del container: al livello host sarebbe un
	# redirect PowerShell verso il file C:\dev\null (Windows locale).
	var res := _ssh_stdin_file(local_path,
			"docker exec -i jht sh -lc 'tee " + remote + " >/dev/null'")
	if res["code"] != 0:
		_doc_uploaded(false, "", _short_error(res, labels))
		return
	_doc_uploaded(true, remote, "")

func _doc_uploaded(ok: bool, remote_path: String, error: String) -> void:
	bus.call_deferred("emit_signal", "document_uploaded", ok, remote_path, error)

## Nome file sicuro per il viaggio in shell remota: solo [A-Za-z0-9._-],
## il resto diventa _ (stessa igiene della route web di upload).
static func _safe_filename(name: String) -> String:
	var out := ""
	for i in name.length():
		var c := name[i]
		var code := c.unicode_at(0)
		var is_ok: bool = (code >= 48 and code <= 57) \
				or (code >= 65 and code <= 90) or (code >= 97 and code <= 122) \
				or c == "." or c == "_" or c == "-"
		out += c if is_ok else "_"
	out = out.lstrip(".")
	# Questo valore entra nel path remoto e nel payload dell'agente: deve essere
	# stabile e indipendente dalla lingua. Solo la presentazione viene tradotta.
	return out if out != "" else "document"


## ── Documenti prodotti (anteprima CV in-game) ────────────────────────
## Lettura on-demand di un file registrato in cv_path/cl_path. Il path
## arriva dal jobs.db ma resta input non fidato per la shell (gotcha
## OS.execute): viaggia BASE64 dentro lo script python, e il contenuto
## torna BASE64 (regge anche i pdf binari). Solo le aree dati note del
## container, mai il filesystem libero.

const ARTIFACT_MAX_BYTES := 10 * 1024 * 1024  # stesso tetto dell'upload

static var ARTIFACT_PY := payload("artifact.py")

func fetch_artifact(path: String) -> void:
	# thread one-shot: un pdf da qualche centinaio di KB non deve
	# congelare né la UI né il giro di poll
	_queue_worker(_do_fetch_artifact.bind(path, UIStrings.vps_presentation_snapshot()))

func _do_fetch_artifact(path: String, labels: Dictionary) -> void:
	var res := _ssh_python(ARTIFACT_PY % [Marshalls.utf8_to_base64(path),
			ARTIFACT_MAX_BYTES])
	var ok := false
	var data := PackedByteArray()
	var err := ""
	if res["code"] != 0:
		err = _short_error(res, labels)
	else:
		err = _ui_text(labels, "vps.response_unreadable")
		for line in str(res["out"]).split("\n"):
			if not line.begins_with("{"):
				continue
			var d: Variant = JSON.parse_string(line)
			if d is Dictionary:
				ok = bool(d.get("ok", false))
				err = _present_error(str(d.get("error", "")), labels)
				if ok:
					data = Marshalls.base64_to_raw(str(d.get("b64", "")))
			break
	bus.call_deferred("publish_artifact", path, ok, data, err)


## ── Orari di lavoro: editing PIENO (paradigma desktop app) ───────────
## working_hours vive in jht.config.json: si aggiorna SOLO quella
## sezione (load→update→dump preserva tutto il resto, credenziali
## incluse — che non lasciano mai il container), con backup prima.

static var HOURS_SAVE_PY := payload("hours_save.py")

func save_working_hours(wh: Dictionary) -> void:
	_queue_worker(_do_save_hours.bind(wh))

func _do_save_hours(wh: Dictionary) -> void:
	var b64 := Marshalls.utf8_to_base64(JSON.stringify(wh))
	var res := _ssh_python(HOURS_SAVE_PY % b64)
	var ok: bool = res["code"] == 0 and str(res["out"]).contains("\"ok\": true")
	bus.call_deferred("emit_signal", "hours_saved", ok,
			"" if ok else _short_error(res))
	if ok:
		_fetch_settings()


## ── Ticket utente→team (gate 1: l'unica scrittura sul jobs.db) ───────
## Stesso INSERT della route /api/positions/[id]/ticket del web: ticket
## 'open' kind 'custom' su position_tickets, che il Capitano nota e
## smista (ticket.py list-open). Il testo utente è velenoso per la shell
## (gotcha OS.execute) → viaggia BASE64 dentro lo script python, che a
## sua volta arriva al container via file+stdin: niente quoting, mai.

const TICKET_MAX_LEN := 2000  # stesso limite della route web

static var TICKET_PY := payload("ticket.py")

func create_ticket(position_id: int, text: String) -> void:
	var t := text.strip_edges().left(TICKET_MAX_LEN)
	if t == "" or position_id <= 0:
		return
	# thread one-shot: l'INSERT remoto non deve congelare UI né poll
	_queue_worker(_do_create_ticket.bind(position_id, t,
			UIStrings.vps_presentation_snapshot()))

func _do_create_ticket(position_id: int, text: String, labels: Dictionary) -> void:
	var res := _ssh_python(TICKET_PY % [Marshalls.utf8_to_base64(text), position_id])
	var ok := false
	var err := ""
	if res["code"] != 0:
		err = _short_error(res, labels)
	else:
		err = _ui_text(labels, "vps.response_unreadable")
		for line in str(res["out"]).split("\n"):
			if line.begins_with("{"):
				var d: Variant = JSON.parse_string(line)
				if d is Dictionary:
					ok = bool(d.get("ok", false))
					err = _present_error(str(d.get("error", "")), labels)
				break
	bus.call_deferred("emit_signal", "ticket_created", position_id, ok, err)
	if ok:
		_fetch_positions()  # il ticket nuovo compare subito nel dettaglio


## Tail del chat.jsonl dell'agente → publish_agent_chat (storia completa
## recente, la UI ridisegna da zero: niente cursori da tenere in sync;
## il bus spegne l'indicatore di attesa quando vede la risposta).
func _fetch_convo(agent: String) -> void:
	var res := _ssh("docker exec jht tail -n 120 /jht_home/agents/%s/chat.jsonl"
			% _agent_dir(agent))
	if _stop or res["code"] != 0:
		return
	var msgs: Array = []
	for line in str(res["out"]).split("\n"):
		if not line.begins_with("{"):
			continue
		var d: Variant = JSON.parse_string(line)
		if d is Dictionary and str(d.get("text", "")) != "":
			msgs.append(d)
	bus.call_deferred("publish_agent_chat", agent, msgs)

## File temporaneo locale in una directory scrivibile su ogni OS: il
## /tmp hardcodato non esiste su Windows (FileAccess.open → null).
static func _temp_path(stem: String) -> String:
	return OS.get_cache_dir().path_join(
			"%s-%d-%d.tmp" % [stem, OS.get_process_id(), Time.get_ticks_usec()])

## Esegue uno script python DENTRO il container passandolo via stdin
## (python3 -): nessun limite di quoting, script multi-linea liberi.
func _ssh_python(script: String) -> Dictionary:
	var buf := _temp_path("jht-game-py")
	var f := FileAccess.open(buf, FileAccess.WRITE)
	if f == null:
		return {"code": -1, "out": "file temporaneo non scrivibile"}
	f.store_string(script)
	f.close()
	var res := _ssh_stdin_file(buf, "docker exec -i jht python3 -")
	DirAccess.remove_absolute(buf)
	return res

## Come _ssh_python, ma sul sistema host della VPS: serve per /proc,
## filesystem root e docker stats, invisibili dall'interno del container.
func _ssh_host_python(script: String) -> Dictionary:
	var buf := _temp_path("jht-game-host-py")
	var f := FileAccess.open(buf, FileAccess.WRITE)
	if f == null:
		return {"code": -1, "out": "file temporaneo non scrivibile"}
	f.store_string(script)
	f.close()
	var res := _ssh_stdin_file(buf, "python3 -")
	DirAccess.remove_absolute(buf)
	return res


## Invia un file sullo stdin di OpenSSH senza passare da cmd.exe/bash.
## I path della chiave e della cache possono contenere spazi (tipico su
## Windows); argv + pipe evita sia rotture di quoting sia command injection.
## Lo stdout remoto viene rediretto sul pipe stderr separato, cosi possiamo
## chiudere stdin (EOF per `python3 -`) e continuare a raccogliere l'output.
func _ssh_stdin_file(local_file: String, remote_cmd: String) -> Dictionary:
	var payload := FileAccess.get_file_as_bytes(local_file)
	if payload.is_empty() and FileAccess.get_open_error() != OK:
		return {"code": -1, "out": "file temporaneo non leggibile"}
	var args := PackedStringArray([
		"-i", _key,
		"-o", "BatchMode=yes",
		"-o", "IdentitiesOnly=yes",
		"-o", "ConnectTimeout=%d" % SSH_TIMEOUT,
		"-o", "StrictHostKeyChecking=yes",
		"-o", "UserKnownHostsFile=" + known_hosts_path(_ip),
		"%s@%s" % [_user, _ip],
		remote_cmd + " 1>&2",
	])
	var process := OS.execute_with_pipe("ssh", args, true)
	if process.is_empty():
		return {"code": -1, "out": "client OpenSSH non avviabile"}
	var stdio: FileAccess = process["stdio"]
	var stderr: FileAccess = process["stderr"]
	stdio.store_buffer(payload)
	stdio.close()  # EOF: python3/tee/tmux possono terminare
	# get_as_text() usa get_length(), che sui pipe vale 0: leggere a blocchi
	# drena davvero il canale e impedisce anche il deadlock su output grandi.
	# Un read corto NON è EOF: il produttore può essere solo più lento del
	# reader (JSON troncati "Unterminated string" coi b64 dell'anteprima
	# CV, 19/07). Si legge finché il processo vive, poi si svuota il
	# residuo: a scrittore morto read torna 0 solo a pipe davvero vuoto.
	var pid := int(process["pid"])
	var output_bytes := PackedByteArray()
	while true:
		var chunk := stderr.get_buffer(65536)
		output_bytes.append_array(chunk)
		if chunk.size() == 0:
			if not OS.is_process_running(pid):
				break
			OS.delay_msec(5)
	stderr.close()
	while OS.is_process_running(pid):
		OS.delay_msec(5)
	return {"code": OS.get_process_exit_code(pid),
			"out": output_bytes.get_string_from_utf8()}


## Un giro di ssh non interattivo. Ritorna {code, out} (stdout+stderr).
## Il remote_cmd deve rispettare la ricetta anti-quoting (vedi sopra).
func _ssh(remote_cmd: String) -> Dictionary:
	var out: Array = []
	var code := OS.execute("ssh", [
		"-i", _key,
		"-o", "BatchMode=yes",
		"-o", "IdentitiesOnly=yes",
		"-o", "ConnectTimeout=%d" % SSH_TIMEOUT,
		"-o", "StrictHostKeyChecking=yes",
		"-o", "UserKnownHostsFile=" + known_hosts_path(_ip),
		"%s@%s" % [_user, _ip],
		remote_cmd,
	], out, true)
	return {"code": code, "out": "\n".join(PackedStringArray(out))}


## throttle-events.jsonl (start/end del pacing reale) → throttle ATTIVI
## per istanza: {uid: {left: sec rimanenti, total: sec richiesti}}.
## Le righe sono in ordine: per ogni agente conta l'ULTIMO evento — uno
## start senza end la cui finestra copre "adesso" è un throttle in corso.
static func _parse_throttles(raw: String) -> Dictionary:
	var last := {}  # uid → ultimo evento
	for line in raw.split("\n"):
		if not line.begins_with("{"):
			continue
		var d: Variant = JSON.parse_string(line)
		if d is Dictionary and str(d.get("agent", "")) != "":
			last[_uid_norm(str(d["agent"]))] = d
	var now := Time.get_unix_time_from_system()
	var active := {}
	for uid in last:
		var ev: Dictionary = last[uid]
		if str(ev.get("event", "")) != "start":
			continue
		var total := float(ev.get("applied_sec", 0.0))
		var until := float(ev.get("ts_unix", 0.0)) + total
		if until > now:
			active[uid] = {"left": until - now, "total": total}
	return active

## stdout dello script attività → sessione tmux → {status, detail}.
## Warning esterni vengono ignorati: vale soltanto una riga JSON oggetto.
## Isteresi anti-flicker (falsi idle 03:5x): un 'working' scade a 'idle'
## solo dopo 2 poll consecutivi senza marker — la barra della TUI può
## nascondere il marker nell'attimo della cattura anche a metà turno.
## 'unknown' (cattura fallita) mantiene sempre l'ultimo stato osservato.
## Vive nel thread di poll: nessun accesso concorrente.
var _last_status := {}
var _last_detail := {}
var _idle_strikes := {}

func _smooth_activity(activity: Dictionary) -> Dictionary:
	var out := {}
	for session in activity:
		var obs: Dictionary = activity[session]
		var status := str(obs.get("status", "idle"))
		var prev := str(_last_status.get(session, ""))
		if status == "unknown":
			obs = {"status": prev if prev != "" else "idle",
					"detail": str(_last_detail.get(session, "stato non osservato"))}
		elif status == "idle" and prev == "working":
			var strikes := int(_idle_strikes.get(session, 0)) + 1
			if strikes < 2:
				_idle_strikes[session] = strikes
				obs = {"status": "working",
						"detail": str(_last_detail.get(session, "turno in corso"))}
			else:
				_idle_strikes[session] = 0
		else:
			_idle_strikes[session] = 0
		out[session] = obs
		_last_status[session] = str(obs.get("status", "idle"))
		_last_detail[session] = str(obs.get("detail", ""))
	return out

static func _parse_activity(raw: String) -> Dictionary:
	for line in raw.split("\n"):
		if not line.begins_with("{"):
			continue
		var data: Variant = JSON.parse_string(line)
		if data is Dictionary:
			return data
	return {}

## Sessioni tmux (formato default "NOME: 1 windows …") → snapshot roster
## per il contratto agents_updated. CAPITANO → coordinatore; "scout-2" →
## slug scout, name "Scout 2", uid "scout-2" (chiave per-istanza, la
## stessa dei throttle e delle transitions). status dall'osservazione del
## pane: working solo col marker TUI di turno in corso, altrimenti idle;
## throttled prevale quando c'è una pausa del pacing reale —
## la scelta seduto-vs-ricreazione è della scena, sulla stima
## throttle_secs (secondi RIMANENTI; throttle_total = durata piena).
## Un agente killato non compare proprio: despawn = uscita dalla porta.
static func _parse_roster(raw: String, throttles: Dictionary = {},
		activity: Dictionary = {}, labels: Dictionary = {}) -> Array:
	var agents: Array = []
	for line in raw.split("\n"):
		if not line.contains(":"):
			continue
		var session := line.split(":")[0].strip_edges()
		if session == "" or session.contains(" "):
			continue
		var uid := _uid_norm(session)
		# Il ruolo decide sprite/postazione; l'UID decide quale processo e
		# quale vignetta. Un worker specializzato condivide il ruolo base.
		var base := uid.trim_suffix("-worker")
		var num := ""
		var parts := base.split("-")
		if parts.size() > 1:
			var suffix: String = parts[parts.size() - 1]
			if suffix.is_valid_int():
				num = suffix
				base = "-".join(parts.slice(0, parts.size() - 1))
			elif suffix.begins_with("s") and suffix.substr(1).is_valid_int():
				# Sub-agenti temporanei (critico-s1, ...): UID distinto,
				# stesso ruolo/postazioni del reparto padre.
				num = suffix.to_upper()
				base = "-".join(parts.slice(0, parts.size() - 1))
		var slug := base
		var name := slug.capitalize()
		if num != "":
			name += " " + num
		elif uid.ends_with("-worker"):
			name += " Worker"
		# Il cognome è funzione dell'uid, come la scrivania e il volto: qui
		# entra UNA volta e da qui raggiunge ogni pannello che mostra
		# `name` (scheda agente, elenco VPS, targa dei dialoghi, risorse).
		# L'uid resta intero dentro l'etichetta, e chi non ha un cognome —
		# i sub-agenti `critico-s1`, i `-worker` — tiene esattamente il nome
		# che aveva prima.
		name = AgentNames.display_name(uid, name)
		var observed: Dictionary = activity.get(session, activity.get(uid, {}))
		var status := str(observed.get("status", "idle"))
		if status not in ["working", "idle", "paused"]:
			status = "idle"
		var detail := _activity_detail(str(observed.get("detail",
				"sessione attiva, stato non osservato")), labels)
		var t_left := 0.0
		var t_total := 0.0
		if throttles.has(uid):
			t_left = float(throttles[uid]["left"])
			t_total = float(throttles[uid]["total"])
			status = "throttled"
			detail = _activity_detail("pacing: pausa temporizzata", labels)
		agents.append({
			"slug": slug, "role": slug, "name": name, "uid": uid,
			"session": session,  # nome tmux RAW: serve alla chat 1-a-1
			"active": true, "status": status, "desk_hint": "",
			"activity_detail": detail,
			"throttle_secs": t_left, "throttle_total": t_total,
		})
	return agents


static func _activity_detail(raw: String, labels: Dictionary) -> String:
	var key := str(ACTIVITY_DETAIL_KEYS.get(raw, ""))
	return _ui_text(labels, key) if key != "" else raw


func _deferred_state(state: int, detail: String) -> void:
	bus.call_deferred("publish_state", state, detail)


func _deferred_state_key(state: int, key: String, args: Array = []) -> void:
	bus.call_deferred("publish_state_key", state, key, args)


## La riga utile dell'errore ssh, senza sommergere la UI.
static func _short_error(res: Dictionary, labels: Dictionary = {}) -> String:
	for line in str(res["out"]).split("\n"):
		var l := line.strip_edges()
		if l != "" and not l.begins_with("Warning:"):
			return _present_error(l.left(120), labels)
	return _ui_text(labels, "vps.ssh.failed") % res["code"]


static func _present_error(raw: String, labels: Dictionary = {}) -> String:
	var key := str(PRESENTATION_ERROR_KEYS.get(raw, ""))
	return _ui_text(labels, key) if key != "" else raw


static func _ui_text(labels: Dictionary, key: String) -> String:
	var value := str(labels.get(key, ""))
	return value if value != "" and value != key else str(PRESENTATION_ENGLISH[key])


## Sonno interrompibile: reagisce a stop() entro ~0.2s.
func _sleep(secs: float) -> void:
	var waited := 0.0
	while waited < secs and not _stop:
		OS.delay_msec(200)
		waited += 0.2
