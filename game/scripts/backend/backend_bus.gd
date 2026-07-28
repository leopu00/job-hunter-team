extends Node
## Autoload `BackendBus`: l'unico canale PUSH fra il backend del team e le
## scene. Le viste pull (liste, pannelli) continuano a passare da TeamData;
## qui viaggia ciò che ACCADE: connessione, roster attivo, messaggi di chat.
##
## Contratto congelato con dev1 (11/07) — non cambiare firme senza accordo:
##   connection_changed(state, detail)
##     state ∈ DISCONNECTED|CONNECTING|CONNECTED|ERROR (int, costanti sotto)
##   agents_updated(agents)
##     agents = Array di Dictionary:
##       { slug: String, role: String, name: String, active: bool,
##         status: String ("working"|"idle"|"paused"; default prudente idle),
##         desk_hint: String ("" se il backend non sa dove siede) }
##     È SEMPRE lo snapshot completo del roster, non un delta: chi non
##     c'è più va despawnato.
##     Estensione ADDITIVA (missione pipeline 11/07, nomi allineati al
##     consumer di dev1 fdb3623a):
##       uid: String — chiave per-istanza ("scout-2"), la stessa di
##         by_agent nelle transitions e dei throttle del pacing.
##       status guadagna "throttled" (pausa del pacing REALE in corso)
##         e "killed" (solo mock: dal vivo l'agente sparisce e basta);
##         throttle_secs alimenta il countdown, senza movimento casuale.
##       throttle_secs: float, stima secondi RIMANENTI di throttle;
##       throttle_total: float, durata piena richiesta dal pacing.
##     Agente sparito dal roster = killato/fermato: despawn con USCITA
##     dalla porta (non è più in ufficio).
##   chat_message(msg)
##     msg = { ts: String ISO 8601, from: String, to: String, text: String }
##     from/to sono slug agente, oppure "user" oppure "all".

signal connection_changed(state: int, detail: String)
signal agents_updated(agents: Array)
signal chat_message(msg: Dictionary)
## Messaggi diretti all'utente non ancora aperti nella chat 1-a-1.
## La mappa usa il ruolo canonico (coordinatore/assistente/mentor), così un
## riavvio del worker con uid diverso non perde il badge della conversazione.
signal chat_unread_changed(unread: Dictionary)
## Aggiunta post-contratto (annunciata in chat, additiva): snapshot
## completo delle posizioni dal jobs.db della VPS, per le viste web
## migrate (elenco+filtri, dettaglio, mappa). Righe = SELECT del
## VpsBackend, campi con i nomi delle colonne reali.
signal positions_updated(positions: Array)
## Estensione ADDITIVA (27/07): il backend attivo è CAMBIATO — collegata
## un'altra macchina, o staccata quella corrente. Tutto ciò che una vista
## tiene in mano descrive la macchina precedente e va buttato: con un box
## per beta tester quei numeri sono il lavoro di UN ALTRO utente. Emesso da
## set_backend() con le cache del bus già svuotate e prima che il nuovo
## adapter parta, così chi ascolta si risemina nello stesso frame del
## cambio e non esiste un fotogramma coi conteggi del box precedente.
signal backend_reset()

## Conversazione utente ↔ agente (chat bidirezionale). messages = tail
## di chat.jsonl dell'agente: [{role: "user"|"assistant", text, ts,
## partial?}] in ordine cronologico. Emesso a ogni poll finché una
## conversazione è aperta con open_agent_chat().
signal agent_chat_updated(agent: String, messages: Array)
## Esito dell'invio di send_user_chat (ok=false → error leggibile).
signal user_chat_sent(agent: String, ok: bool, error: String)
## Snapshot della pane tmux di un agente, esclusivamente osservabile.
## `error` e vuoto durante il flusso regolare; nessun metodo del bus inoltra
## input o tasti alla sessione osservata.
signal agent_terminal_updated(agent: String, text: String, error: String)
## Console operativa del Coordinatore. state contiene maintenance,
## enrichment, directives e queue_counts; action_done copre save/add/archive.
signal coordinator_state_updated(state: Dictionary)
signal coordinator_action_done(action: String, ok: bool, error: String)
## Deroga a termine agli automatismi di spesa (shared/skills/burn_intent.py).
## `state` è il payload LETTO dal flag più `readable`/`received_msec`: chi lo
## consuma passa da BurnMode.state_for() e non deduce mai nulla dal click.
signal burn_intent_updated(state: Dictionary)
signal burn_intent_action_done(active: bool, ok: bool, error: String)
## Esito di create_position_ticket (l'unica scrittura remota autorizzata
## da Leone, gate 1 dell'11/07: sì ai ticket verso il team, no alle
## azioni che scrivono direttamente sul jobs.db).
signal ticket_created(position_id: int, ok: bool, error: String)
## Esito del salvataggio del profilo utente (paradigma desktop app:
## i DATI UTENTE si modificano da qui; il jobs.db resta via ticket).
signal profile_saved(ok: bool, error: String)
## Estensione ADDITIVA (missione ONBOARDING in-game, 18/07): stato del
## candidate_profile.yml + gate `ready` per il wizard. profile = vista
## piatta dei campi (name, email, target_role, location,
## experience_years, seniority_target, skills[], languages[]);
## required = {campo: bool} con la STESSA checklist del web
## (lib/profile-completion.ts); ready = ready.flag esiste OPPURE tutti
## i required ok — identico a GET /api/profile del web.
signal profile_status_updated(profile: Dictionary, required: Dictionary, ready: bool)
## Esito dell'upload di un documento utente (CV) verso la drop-zone
## allegati del container (/jht_user/allegati): il wizard poi passa il
## path remoto all'assistente dentro il messaggio chat, come il web.
signal document_uploaded(ok: bool, remote_path: String, error: String)
## Esito del salvataggio degli orari di lavoro (working_hours).
signal hours_saved(ok: bool, error: String)
## Contenuto di un documento prodotto dal team (CV/cover letter, md o
## pdf), letto on-demand dal filesystem del container per l'anteprima
## in-game. data = bytes del file (utf-8 per gli md, binari per i pdf).
signal artifact_fetched(path: String, ok: bool, data: PackedByteArray, error: String)
## live_settings è arrivata/cambiata (config team + usage reali).
signal live_settings_updated(settings: Dictionary)
## Telemetria infrastrutturale VPS/container, campionata via SSH. Il campione
## include anche agent_cpu {uid: cpu_pct} e agent_vitals_age_s dal daemon
## agent-vitals: è la fonte live del LED sugli agenti in ufficio.
signal telemetry_updated(sample: Dictionary, history: Array)
## Storico usage on-demand (finestre di monitoraggio risorse). query è
## l'eco della richiesta {from_ts, to_ts, bucket_sec}; data = {ok, error,
## sentinel: [{t, usage, weekly, velocity, velocity_ideal, projection}, …],
## meter: [{t, weighted_kt, events}, …],
## throttle: [{t, throttle_s, pauses}, …]  (eventi pausa del pacing),
## agents: {names: [String], series: [{t, <agente>: kT_delta}, …],
##          totals_kt: {<agente>: kT}}} — t sempre unix epoch UTC.
signal usage_history_updated(query: Dictionary, data: Dictionary)
## Storico del singolo RUOLO (scheda agente): query = {agent, from_ts,
## to_ts, bucket_sec}; data = {ok, error, agent, series: {tokens_kt|
## pct_5h|pct_weekly|throttle_s|db_actions|cpu_pct|ram_pct: [{t, v}, …]}}.
## pct_* = delta usage% della sentinella × fetta token del ruolo nel
## bucket; cpu/ram sono del CONTAINER (contesto): lo storico per-agente
## di cpu/ram non esiste sulla VPS.
signal agent_history_updated(query: Dictionary, data: Dictionary)

enum { DISCONNECTED, CONNECTING, CONNECTED, ERROR }

const CONFIG_PATH := "user://vps.cfg"

var state: int = DISCONNECTED
var state_detail := ""
var agents: Array = []       # ultimo snapshot pubblicato (per chi arriva tardi)
var positions: Array = []    # ultimo snapshot posizioni (idem)
var positions_are_demo := false
var transitions: Array = []  # ultime ~80 transizioni di stato (registro team)
## Config team + usage reali (solo campi safe), per sezione della
## sidebar: {provider|hours|email|advanced: [[etichetta, valore], …],
## usage: {window_h, per_agent_kt, generated_at}}.
var live_settings: Dictionary = {}
var telemetry: Dictionary = {}
var telemetry_history: Array = []
## Ultimo storico usage ricevuto (cache per chi riapre il pannello) e
## l'eco della query che l'ha prodotto.
var usage_history: Dictionary = {}
var usage_history_query: Dictionary = {}
var coordinator_state: Dictionary = {}
## Ultima lettura del flag di deroga alla spesa. Vuoto = mai letto: NON è
## "spenta", ed è per questo che l'interruttore parte da "stato sconosciuto".
var burn_intent: Dictionary = {}
var chat_log: Array = []     # ultimi messaggi (fumetti di dev1 + vista Chat)
const CHAT_LOG_MAX := 200
var chat_unread: Dictionary = {}  # ruolo canonico -> conteggio non letto
var _open_chat_role := ""

## Tassi di cambio "unità per 1 EUR" (stessa fonte del web: Frankfurter,
## dati BCE, nessuna chiave). Vuoto finché il fetch non risponde o se
## si è offline: chi formatta fa fallback alla valuta originale.
var fx_rates: Dictionary = {}
signal fx_rates_updated

var _backend: BackendAdapter


## Una VPS già configurata si ricollega da sola all'avvio (il "collega
## una volta, poi pensa a tutto il gioco" chiesto dal design). TEST-AUTO:
## JHT_VPS_IP/JHT_VPS_KEY forzano una config, JHT_NOVPS=1 spegne tutto
## (per gli shot grafici che non devono toccare la rete).
func _ready() -> void:
	_fetch_fx_rates()
	# TEST-AUTO: JHT_THROTTLE_TEST=1 valida il parse throttle→status con
	# eventi sintetici (la modalità godot -s non compila gli autoload,
	# quindi il test vive qui dentro al boot).
	if OS.get_environment("JHT_THROTTLE_TEST") == "1":
		_self_test_throttle()
	if OS.get_environment("JHT_VPS_CONTRACT_TEST") == "1":
		_self_test_vps_contract()
	if OS.get_environment("JHT_CHAT_NOTIFICATION_TEST") == "1":
		_self_test_chat_notifications.call_deferred()
	if OS.get_environment("JHT_NOVPS") == "1":
		return
	var cfg := load_vps_config()
	if OS.get_environment("JHT_VPS_IP") != "":
		cfg = {
			"ip": OS.get_environment("JHT_VPS_IP"),
			"key_path": OS.get_environment("JHT_VPS_KEY"),
			"user": OS.get_environment("JHT_VPS_USER"),
		}
	if str(cfg.get("ip", "")) != "" and str(cfg.get("key_path", "")) != "":
		set_backend(VpsBackend.new(), cfg)
	elif _local_container_running():
		# Primo avvio locale: l'ufficio resta subito visibile e adotta il
		# container se era già attivo. Se viene acceso più tardi dalla pagina
		# Attivazione, SetupService chiama connect_local_backend().
		set_backend(LocalBackend.new())


func _local_container_running() -> bool:
	var out: Array = []
	return OS.execute("docker", ["inspect", "jht", "--format",
			"{{.State.Running}}"], out, true) == 0 \
			and "true" in "\n".join(PackedStringArray(out)).to_lower()


func connect_local_backend() -> void:
	if state == CONNECTED and _backend is LocalBackend:
		return
	if _local_container_running():
		set_backend(LocalBackend.new())

func _self_test_vps_contract() -> void:
	var roster: Array = VpsBackend._parse_roster(
			"SENTINELLA: 1 windows\nSENTINELLA-WORKER: 1 windows\nSCOUT-2: 1 windows\nCRITICO-S1: 1 windows\n")
	var uids: Array = roster.map(func(a: Dictionary) -> String: return str(a["uid"]))
	var roles: Array = roster.map(func(a: Dictionary) -> String: return str(a["role"]))
	var msg: Dictionary = VpsBackend._to_chat_msg({
		"ts": "2026-07-13T03:00:00Z", "from": "sentinella-worker",
		"to": "scout-2", "body": "[@sentinella-worker -> @scout-2] [INFO] controllo completato",
	})
	var ok: bool = uids == ["sentinella", "sentinella-worker", "scout-2", "critico-s1"] \
			and roles == ["sentinella", "sentinella", "scout", "critico"] \
			and msg.get("from") == "sentinella-worker" \
			and msg.get("to") == "scout-2" \
			and msg.get("text") == "controllo completato" \
			and VpsBackend.expand_user_path("~/keys/id", "/home/Jane Doe") \
					== "/home/Jane Doe/keys/id" \
			and VpsBackend.expand_user_path("/tmp/a~b", "/home/test") == "/tmp/a~b" \
			and VpsBackend.known_hosts_path("203.0.113.10") \
					!= VpsBackend.known_hosts_path("203.0.113.11") \
			and VpsBackend._safe_tmux_session("SCOUT-2") \
			and not VpsBackend._safe_tmux_session("SCOUT-2; send-keys C-c")
	# Trasporto locale: docker via argv diretto, mai una shell host (su
	# Windows sarebbe PowerShell 5.1, che non parla POSIX).
	ok = ok and LocalBackend._docker_argv(
			"docker exec jht sh -lc 'tmux ls 2>/dev/null; echo ---X---'") \
			== PackedStringArray(["exec", "jht", "sh", "-lc",
					"tmux ls 2>/dev/null; echo ---X---"]) \
			and LocalBackend._docker_argv(
					"docker inspect jht --format '{{.State.Status}}'") \
			== PackedStringArray(["inspect", "jht", "--format", "{{.State.Status}}"]) \
			and LocalBackend._docker_argv("python3 -").is_empty()
	print("VPS-CONTRACT-TEST ", "PASS " if ok else "FAIL ",
			JSON.stringify({"uids": uids, "roles": roles, "msg": msg}))


## Al quit il thread ssh del backend va JOINATO: lasciarlo vivo mentre
## l'engine smonta gli autoload produce segfault in cleanup e ObjectDB
## leak (visto negli shot con VPS attiva, 12/07).
func _exit_tree() -> void:
	if _backend:
		_backend.stop()
		_backend = null


## ── Multi-valuta (feature del web: salari confrontabili in EUR) ──────

func _fetch_fx_rates() -> void:
	var req := HTTPRequest.new()
	add_child(req)
	req.request_completed.connect(func(_r: int, code: int, _h: PackedStringArray,
			body: PackedByteArray) -> void:
		req.queue_free()
		if code != 200:
			return
		var data: Variant = JSON.parse_string(body.get_string_from_utf8())
		if data is Dictionary and data.get("rates") is Dictionary:
			fx_rates = data["rates"]
			Log.info("backend", "tassi BCE caricati: %d valute" % fx_rates.size())
			fx_rates_updated.emit())
	if req.request("https://api.frankfurter.dev/v1/latest") != OK:
		req.queue_free()

## Eventi sintetici → status attesi: throttle attivo → "throttled" coi
## secondi giusti, scaduto/chiuso → "working", CAPITANO → coordinatore.
func _self_test_throttle() -> void:
	var now := Time.get_unix_time_from_system()
	var raw := ""
	for ev in [
		{"event": "start", "agent": "analista-2", "applied_sec": 300.0, "ts_unix": now - 30.0},
		{"event": "start", "agent": "scout-1", "applied_sec": 60.0, "ts_unix": now - 10.0},
		{"event": "start", "agent": "scorer-1", "applied_sec": 120.0, "ts_unix": now - 500.0},
		{"event": "start", "agent": "CAPITANO", "applied_sec": 300.0, "ts_unix": now - 20.0},
		{"event": "end", "agent": "CAPITANO", "applied_sec": 300.0, "ts_unix": now - 5.0},
	]:
		raw += JSON.stringify(ev) + "\n"
	var roster := "ANALISTA-2: 1 windows\nscout-1: 1 windows\nscorer-1: 1 windows\nCAPITANO: 1 windows\n"
	var activity := {
		"ANALISTA-2": {"status": "working", "detail": "turno in corso"},
		"scout-1": {"status": "idle", "detail": "nessun turno"},
		"scorer-1": {"status": "working", "detail": "turno in corso"},
		"CAPITANO": {"status": "paused", "detail": "in attesa"},
	}
	var got := {}
	for a in VpsBackend._parse_roster(roster, VpsBackend._parse_throttles(raw), activity):
		got[a["uid"]] = [a["status"], a["throttle_secs"], a["throttle_total"]]
	var ok: bool = str(got.get("analista-2", [""])[0]) == "throttled" \
			and absf(float(got["analista-2"][1]) - 270.0) < 3.0 \
			and str(got.get("scout-1", [""])[0]) == "throttled" \
			and absf(float(got["scout-1"][1]) - 50.0) < 3.0 \
			and str(got.get("scorer-1", [""])[0]) == "working" \
			and str(got.get("coordinatore", [""])[0]) == "paused"
	print("THROTTLE-TEST ", "PASS " if ok else "FAIL ", JSON.stringify(got))


## ── Pipeline reale (missione SIMULAZIONE PIPELINE, 11/07) ────────────
## I contatori delle 5 fasi della dashboard, calcolati dallo snapshot
## corrente: la scena proporziona pile di fogli e flussi su QUESTI
## numeri, senza duplicare la logica di mapping status→fase.
## cv_ready = scritte col PASS del critico (la sezione output).
func pipeline_counts() -> Dictionary:
	var c := {"to_analyze": 0, "analyzed": 0, "with_score": 0,
			"to_write": 0, "written": 0, "cv_ready": 0}
	for p in positions:
		# Le quattro pile fisiche sono OUTPUT completati: ciò che è claimed o
		# in lavorazione vive invece sulla scrivania dell'agente.
		if PipelineQueueDefs.matches("scout", p):
			c["to_analyze"] += 1
		elif PipelineQueueDefs.matches("analisti", p):
			c["analyzed"] += 1
		elif PipelineQueueDefs.matches("scorer", p):
			c["with_score"] += 1
		elif PipelineQueueDefs.matches("scrittori", p):
			c["written"] += 1
		elif PipelineQueueDefs.matches("critici", p):
			c["cv_ready"] += 1
		# KPI dashboard separato dalla pila: mostra anche il lavoro già claimed.
		var status := str(p.get("status", ""))
		var requested := int(p.get("write_requested", 0)
				if p.get("write_requested") != null else 0) == 1
		if (status == "scored" and requested) or status == "writing":
			c["to_write"] += 1
	return c


## KPI di testata (HUD e dashboard): trovate oggi, score medio, totale.
## Fonte unica, così HUD e viste non possono divergere.
func kpi_summary() -> Dictionary:
	var today := Time.get_date_string_from_system(true)  # UTC come found_at
	var found_today := 0
	var score_sum := 0.0
	var score_n := 0
	for p in positions:
		if str(p.get("found_at", "")).begins_with(today):
			found_today += 1
		if p.get("total_score") != null:
			score_sum += float(p["total_score"])
			score_n += 1
	return {"found_today": found_today,
			"avg_score": int(round(score_sum / maxf(1.0, score_n))),
			"total": positions.size()}


## Converte un importo in EUR; ritorna -1.0 se il tasso manca.
func to_eur(amount: float, currency: String) -> float:
	var cur := currency.strip_edges().to_upper()
	if cur == "EUR" or cur == "":
		return amount
	if fx_rates.has(cur) and float(fx_rates[cur]) > 0.0:
		return amount / float(fx_rates[cur])
	return -1.0


## ── Lato scene ───────────────────────────────────────────────────────

## Collega la sorgente eventi (MockBackend, VpsBackend). Sostituisce
## l'eventuale backend attivo. config passa dritta a start().
func set_backend(backend: BackendAdapter, config: Dictionary = {}) -> void:
	if _backend:
		_backend.stop()
		publish_state(DISCONNECTED, "")
	_backend = backend
	_onboarding_context_hashes.clear()
	_reset_connection_snapshots()
	if _backend:
		_backend.bus = self
		_backend.start(config)


## Niente di ciò che ha pubblicato un backend sopravvive al successivo.
## L'ufficio continuava a disegnare la pipeline della macchina precedente
## perché queste cache restavano intatte: misurato il 27/07 su un box appena
## creato (14 posizioni nel suo jobs.db) con la pila dello Scorer ferma sulle
## 694 righe `scored` del box di prima. Con un box per beta tester quello è
## il lavoro di un altro utente, non un difetto grafico.
##
## Le posizioni fittizie dello showroom sono l'unica cosa che resta: non
## vengono da nessuna macchina, e sparirebbero lasciando l'ufficio vuoto a
## chi sta ancora configurando il prodotto.
func _reset_connection_snapshots() -> void:
	transitions = []
	telemetry = {}
	telemetry_history = []
	live_settings = {}
	coordinator_state = {}
	# Cambiata la macchina, la deroga letta prima non dice più nulla di
	# questo team: meglio "non lo so" di un residuo che sembra fresco.
	burn_intent = {}
	usage_history = {}
	usage_history_query = {}
	profile_status = {}
	chat_log = []
	if not positions_are_demo:
		positions = []
	# Attese di risposta appese a una sessione che non c'è più: senza lo
	# spegnimento esplicito la chat resterebbe con l'indicatore acceso.
	for agent in chat_waiting.keys():
		chat_waiting_changed.emit(str(agent), false)
	chat_waiting = {}
	clear_chat_unread()
	positions_updated.emit(positions)
	# backend_reset per ULTIMO: chi lo usa per riseminare deve trovare il bus
	# già svuotato e gli altri segnali già consegnati.
	backend_reset.emit()

func disconnect_backend() -> void:
	set_backend(null)

## Dati VERI in arrivo dal team? (per il badge SIMULAZIONE / LIVE)
func is_live() -> bool:
	return state == CONNECTED and _backend != null and _backend.live


## Il team gira su una macchina remota o qui? Il badge in alto diceva
## "DATI REALI — VPS" anche col container sul computer dell'utente, che è
## una bugia sullo schermo (Leone, 26/07).
func is_remote() -> bool:
	return _backend != null and not (_backend is LocalBackend)

## ── Chat bidirezionale utente ↔ agente ───────────────────────────────
## Chat 1-a-1 con OGNI agente del roster (paradigma desktop app): il
## backend risolve uid → sessione tmux e directory chat.jsonl. La
## RISPOSTA persistita è garantita solo per chi ha la skill chat-web
## nel proprio prompt (verificato sulla VPS: capitano, assistente,
## mentor); gli altri ricevono il messaggio ma potrebbero rispondere
## solo a schermo nel terminale del team — la UI lo dice.
const REPLY_CAPABLE := ["coordinatore", "assistente", "mentor"]

## In attesa di risposta: uid → ts unix dell'invio. La UI mostra
## l'indicatore di caricamento su chat_waiting_changed.
var chat_waiting := {}
var _onboarding_context_hashes := {}
signal chat_waiting_changed(agent: String, waiting: bool)

func can_chat_with(slug_or_uid: String) -> bool:
	if _backend == null:
		return false
	for a in agents:
		if str(a.get("uid", a.get("slug", ""))) == slug_or_uid \
				or str(a.get("slug", "")) == slug_or_uid:
			return true
	return false

## La risposta in chat è garantita dal protocollo dell'agente?
## (REPLY_CAPABLE elenca RUOLI: dall'uid istanza si torna al ruolo base,
## altrimenti "coordinatore-1" non matchava mai — fix dev1 annunciato)
func chat_replies(slug_or_uid: String) -> bool:
	return REPLY_CAPABLE.has(_chat_role(slug_or_uid))

## Ruolo stabile della conversazione: gli uid per istanza e il nome VPS
## `capitano` convergono tutti sulla stessa chat del Coordinatore.
func _chat_role(slug_or_uid: String) -> String:
	var clean := slug_or_uid.strip_edges().to_lower()
	if clean == "capitano" or clean.begins_with("capitano-"):
		return "coordinatore"
	for role in REPLY_CAPABLE:
		if clean == role or clean.begins_with(role + "-"):
			return role
	return clean.split("-")[0]

func chat_unread_count(slug_or_uid: String) -> int:
	return int(chat_unread.get(_chat_role(slug_or_uid), 0))

func total_chat_unread() -> int:
	var total := 0
	for count in chat_unread.values():
		total += int(count)
	return total

func mark_chat_read(slug_or_uid: String) -> void:
	var role := _chat_role(slug_or_uid)
	if not chat_unread.has(role):
		return
	chat_unread.erase(role)
	chat_unread_changed.emit(chat_unread.duplicate())

## Utile anche per il cambio profilo e per i test: non altera lo storico.
func clear_chat_unread() -> void:
	if chat_unread.is_empty():
		return
	chat_unread.clear()
	chat_unread_changed.emit({})

func _self_test_chat_notifications() -> void:
	clear_chat_unread()
	publish_chat({"ts": "1", "from": "scout-1", "to": "user",
			"text": "rumore non interattivo"})
	var filtered := total_chat_unread() == 0
	publish_chat({"ts": "2", "from": "capitano", "to": "user",
			"text": "decisione"})
	publish_chat({"ts": "3", "from": "mentor-1", "to": "user",
			"text": "consiglio"})
	var canonical := chat_unread_count("coordinatore-9") == 1 \
			and total_chat_unread() == 2
	mark_chat_read("coordinatore")
	var selective := chat_unread_count("capitano") == 0 \
			and chat_unread_count("mentor") == 1
	var tag := AgentStateTag.new()
	add_child(tag)
	tag.set_state("working", 0.0)
	tag.show_message("messaggio da mentor", 0.1)
	var message_label := tag.debug_label() == "MESSAGGIO DA MENTOR"
	tag.set_suppressed(true)
	tag.set_state("idle", 0.0)
	var suppressed := tag.debug_suppressed() and not tag.visible
	tag.set_suppressed(false)
	tag._process(0.2)
	var restored := tag.debug_label() == "IN ATTESA"
	var ok := filtered and canonical and selective and message_label \
			and suppressed and restored
	print("CHAT-NOTIFICATION-TEST ", "PASS" if ok else "FAIL", " ",
			JSON.stringify({"filtered": filtered, "canonical": canonical,
				"selective": selective, "message_label": message_label,
				"suppressed": suppressed, "restored": restored}))
	clear_chat_unread()
	get_tree().quit(0 if ok else 1)

## slug generico ("scout") → uid della prima istanza attiva ("scout-2");
## un uid passa invariato.
func _chat_uid(slug_or_uid: String) -> String:
	for a in agents:
		if str(a.get("uid", "")) == slug_or_uid:
			return slug_or_uid
	for a in agents:
		if str(a.get("slug", "")) == slug_or_uid:
			return str(a.get("uid", slug_or_uid))
	return slug_or_uid

## Apre/chiude la conversazione: finché è aperta il backend polla il
## chat.jsonl dell'agente e pubblica publish_agent_chat.
func open_agent_chat(slug: String) -> void:
	_open_chat_role = _chat_role(slug)
	mark_chat_read(slug)
	if _backend:
		_backend.open_chat(_chat_uid(slug))

func close_agent_chat() -> void:
	_open_chat_role = ""
	if _backend:
		_backend.close_chat()

## Apre/chiude una vista read-only sulla tmux dell'agente. Un solo viewer
## alla volta e sufficiente per l'UI e mantiene leggero il polling remoto.
func open_agent_terminal(slug_or_uid: String) -> void:
	if _backend and can_chat_with(slug_or_uid):
		_backend.open_terminal(_chat_uid(slug_or_uid))

func close_agent_terminal() -> void:
	if _backend:
		_backend.close_terminal()

func publish_agent_terminal(agent: String, text: String, error := "") -> void:
	agent_terminal_updated.emit(agent, text, error)


## ── Console del Coordinatore ────────────────────────────────────────

func request_coordinator_state() -> void:
	if _backend:
		_backend.fetch_coordinator_state()
	else:
		coordinator_action_done.emit("load", false, "backend non collegato")

func save_coordinator_settings(settings: Dictionary) -> void:
	if _backend:
		_backend.save_coordinator_settings(settings)
	else:
		coordinator_action_done.emit("save", false, "backend non collegato")

func add_team_directive(body: String, kind := "order") -> void:
	if _backend:
		_backend.add_team_directive(body, kind)
	else:
		coordinator_action_done.emit("directive_add", false, "backend non collegato")

func archive_team_directive(directive_id: int) -> void:
	if _backend:
		_backend.archive_team_directive(directive_id)
	else:
		coordinator_action_done.emit("directive_archive", false, "backend non collegato")

func publish_coordinator_state(next: Dictionary) -> void:
	coordinator_state = next
	coordinator_state_updated.emit(next)

func publish_coordinator_action(action: String, ok: bool, error := "") -> void:
	coordinator_action_done.emit(action, ok, error)


## ── Deroga a termine agli automatismi di spesa ──────────────────────

## Intervallo minimo fra due letture del flag. La pagina dell'agente si
## ricostruisce a ogni giro del roster: senza questo guard ogni rebuild
## sparerebbe un giro SSH, come già evita AgentHistoryChart con la sua cache.
## Il conto alla rovescia intanto scorre da solo, sul delta ricevuto.
const BURN_INTENT_MIN_INTERVAL_MSEC := 20000
var _burn_intent_asked_msec := -BURN_INTENT_MIN_INTERVAL_MSEC

func request_burn_intent(force := false) -> void:
	var now := Time.get_ticks_msec()
	if not force and now - _burn_intent_asked_msec < BURN_INTENT_MIN_INTERVAL_MSEC:
		return
	_burn_intent_asked_msec = now
	if _backend:
		_backend.fetch_burn_intent()
	else:
		# Senza backend NON si dice "spenta": si dice "non leggibile". Il
		# freno potrebbe essere sospeso su una macchina che non stiamo
		# guardando, e mostrarlo come off sarebbe la bugia peggiore.
		publish_burn_intent({"readable": false, "error": "backend non collegato"})

func set_burn_intent(active: bool, hours: float) -> void:
	if _backend:
		_backend.set_burn_intent(active, hours)
	else:
		burn_intent_action_done.emit(active, false, "backend non collegato")

func publish_burn_intent(state: Dictionary) -> void:
	var next := state.duplicate(true)
	# Il momento della lettura viaggia col dato: la scadenza si conta da lì,
	# non dall'orologio del gioco (host e container possono non concordare).
	next["received_msec"] = Time.get_ticks_msec()
	burn_intent = next
	burn_intent_updated.emit(next)

func publish_burn_intent_action(active: bool, ok: bool, error := "") -> void:
	burn_intent_action_done.emit(active, ok, error)

## Invia il messaggio dell'utente all'agente reale (async: l'esito
## arriva su user_chat_sent, la risposta su agent_chat_updated).
func send_user_chat(slug: String, text: String) -> void:
	if _backend and can_chat_with(slug):
		var uid := _chat_uid(slug)
		chat_waiting[uid] = Time.get_unix_time_from_system()
		chat_waiting_changed.emit(uid, true)
		var context := ScriptedOnboarding.llm_context_text()
		var context_hash := hash(context)
		# Il profilo non appare come una finta battuta dell'utente: viene
		# consegnato fuori banda una volta, e ancora solo se cambia.
		if not context.strip_edges().is_empty() \
				and int(_onboarding_context_hashes.get(uid, 0)) != context_hash:
			_onboarding_context_hashes[uid] = context_hash
			_backend.send_chat_with_context(uid, text, context)
		else:
			_backend.send_chat(uid, text)

## Il backend pubblica la conversazione da qui: spegne l'attesa quando
## la risposta dell'agente (successiva all'invio) è arrivata.
func publish_agent_chat(agent: String, messages: Array) -> void:
	if chat_waiting.has(agent) and not messages.is_empty():
		var last: Dictionary = messages[messages.size() - 1]
		if str(last.get("role", "")) == "assistant" \
				and float(last.get("ts", 0.0)) >= float(chat_waiting[agent]):
			chat_waiting.erase(agent)
			chat_waiting_changed.emit(agent, false)
	agent_chat_updated.emit(agent, messages)

## Invio fallito → niente più attesa (la UI toglie l'indicatore).
func publish_chat_sent(agent: String, ok: bool, error: String) -> void:
	if not ok and chat_waiting.has(agent):
		chat_waiting.erase(agent)
		chat_waiting_changed.emit(agent, false)
	user_chat_sent.emit(agent, ok, error)


## ── Onboarding (wizard in-game: il badge si compila con l'assistente) ─
## Il wizard apre il "watch" del profilo: finché è aperto il backend
## rilegge candidate_profile.yml + ready.flag a ogni giro di poll e
## pubblica profile_status_updated. Metodi opzionali dell'adapter
## (has_method), stesso pattern di save_profile.

## Ultimo stato profilo pubblicato ({profile, required, ready}), per
## chi si abbona dopo il primo giro.
var profile_status: Dictionary = {}

func open_profile_watch() -> void:
	if _backend and _backend.has_method("open_profile_watch"):
		_backend.open_profile_watch()

func close_profile_watch() -> void:
	if _backend and _backend.has_method("close_profile_watch"):
		_backend.close_profile_watch()

## Avvia l'agente assistente sul backend se non è già vivo (equivalente
## di POST /api/assistente/start del web). Idempotente.
func ensure_assistant() -> void:
	if _backend and _backend.has_method("ensure_assistant"):
		_backend.ensure_assistant()

## Carica un documento locale (CV…) nella drop-zone allegati del
## container. Esito su document_uploaded.
func upload_user_document(local_path: String) -> void:
	if _backend and _backend.has_method("upload_document"):
		_backend.upload_document(local_path)
	else:
		document_uploaded.emit(false, "", "backend non collegato")

## Il backend pubblica lo stato profilo da qui (thread → call_deferred).
func publish_profile_status(status: Dictionary) -> void:
	profile_status = status
	profile_status_updated.emit(status.get("profile", {}),
			status.get("required", {}), bool(status.get("ready", false)))


## ── Profilo utente (editing pieno: paradigma desktop app) ────────────

func save_user_profile(fields: Dictionary) -> void:
	if _backend and _backend.has_method("save_profile"):
		_backend.save_profile(fields)
	else:
		profile_saved.emit(false, "backend non collegato")

func save_working_hours(wh: Dictionary) -> void:
	if _backend and _backend.has_method("save_working_hours"):
		_backend.save_working_hours(wh)
	else:
		hours_saved.emit(false, "backend non collegato")


## ── Storico usage (finestre di monitoraggio risorse) ─────────────────

## Chiede al backend lo storico usage per [from_ts, to_ts] (unix UTC)
## aggregato per bucket_sec. Risposta asincrona su usage_history_updated;
## il backend può impiegare secondi (ricostruzione per-agente dai log CLI).
func request_usage_history(from_ts: float, to_ts: float, bucket_sec: int) -> void:
	var query := {"from_ts": from_ts, "to_ts": to_ts, "bucket_sec": bucket_sec}
	if _backend and _backend.has_method("fetch_usage_history"):
		_backend.fetch_usage_history(from_ts, to_ts, bucket_sec)
	else:
		usage_history_updated.emit(query,
				{"ok": false, "error": "backend non collegato"})

## Il backend risponde da qui (thread → call_deferred).
func publish_usage_history(query: Dictionary, data: Dictionary) -> void:
	usage_history_query = query
	usage_history = data
	usage_history_updated.emit(query, data)

## Storico del singolo ruolo per la scheda agente. agent = slug di
## ruolo minuscolo ([a-z0-9-]); risposta su agent_history_updated.
func request_agent_history(agent: String, from_ts: float, to_ts: float,
		bucket_sec: int) -> void:
	var query := {"agent": agent, "from_ts": from_ts, "to_ts": to_ts,
			"bucket_sec": bucket_sec}
	if _backend and _backend.has_method("fetch_agent_history"):
		_backend.fetch_agent_history(agent, from_ts, to_ts, bucket_sec)
	else:
		agent_history_updated.emit(query,
				{"ok": false, "error": "backend non collegato"})

func publish_agent_history(query: Dictionary, data: Dictionary) -> void:
	agent_history_updated.emit(query, data)


## ── Documenti prodotti (anteprima CV in-game) ────────────────────────

## Chiede al backend i bytes di un documento registrato in cv_path/
## cl_path (lettura pura, come il resto dell'osservazione). Esito su
## artifact_fetched; il path fa da chiave di correlazione per la UI.
func fetch_artifact(path: String) -> void:
	var clean := path.strip_edges()
	if _backend and _backend.has_method("fetch_artifact") and clean != "":
		_backend.fetch_artifact(clean)
	else:
		artifact_fetched.emit(clean, false, PackedByteArray(),
				"backend non collegato")

## Il backend pubblica il documento da qui (thread → call_deferred).
func publish_artifact(path: String, ok: bool, data: PackedByteArray,
		error: String) -> void:
	artifact_fetched.emit(path, ok, data, error)


## ── Ticket utente→team ───────────────────────────────────────────────

## Apre un ticket sulla posizione (async: esito su ticket_created; la
## lista ticket si aggiorna col prossimo snapshot posizioni).
func create_position_ticket(position_id: int, text: String) -> void:
	if _backend and position_id > 0 and text.strip_edges() != "":
		_backend.create_ticket(position_id, text.strip_edges())


## ── Configurazione VPS (voce Impostazioni → Collega VPS) ─────────────

func load_vps_config() -> Dictionary:
	var cfg := ConfigFile.new()
	if cfg.load(CONFIG_PATH) != OK:
		return {}
	return {
		"ip": cfg.get_value("vps", "ip", ""),
		"key_path": cfg.get_value("vps", "key_path", ""),
		# Le config salvate prima che il campo esistesse non hanno "user":
		# vuoto vale root, l'unico utente che il gioco sapesse usare.
		"user": cfg.get_value("vps", "user", ""),
	}

func save_vps_config(ip: String, key_path: String, user := "") -> void:
	var cfg := ConfigFile.new()
	cfg.set_value("vps", "ip", ip)
	cfg.set_value("vps", "key_path", key_path)
	cfg.set_value("vps", "user", user)
	cfg.save(CONFIG_PATH)


## Il passaggio VPS -> locale deve essere persistente: `disconnect_backend()`
## da solo stacca soltanto il processo corrente e al boot successivo _ready()
## rilegge IP/chiave. Rimuoviamo invece la scelta salvata e adottiamo il
## container locale, se è già attivo.
func clear_vps_config() -> void:
	var cfg := ConfigFile.new()
	cfg.set_value("vps", "ip", "")
	cfg.set_value("vps", "key_path", "")
	cfg.set_value("vps", "user", "")
	cfg.save(CONFIG_PATH)


func switch_to_local_backend() -> void:
	clear_vps_config()
	set_backend(null)
	connect_local_backend()


## ── Lato backend (solo gli adapter chiamano i publish_*) ─────────────

func publish_state(new_state: int, detail := "") -> void:
	if new_state == state and detail == state_detail:
		return
	state = new_state
	state_detail = detail
	Log.info("backend", "stato connessione → %d (%s)" % [state, detail])
	connection_changed.emit(state, detail)

func publish_agents(list: Array) -> void:
	agents = list
	Log.debug("backend", "roster: %d agenti attivi" % list.size())
	if OS.get_environment("JHT_ROSTER_TRACE") == "1":
		var trace: Array = []
		for a in list:
			trace.append({"uid": a.get("uid", ""), "status": a.get("status", ""),
					"detail": a.get("activity_detail", ""),
					"throttle": a.get("throttle_secs", 0.0)})
		print("ROSTER-TRACE ", JSON.stringify(trace))
	agents_updated.emit(list)

func publish_telemetry(sample: Dictionary) -> void:
	telemetry = sample
	telemetry_history.append(sample.duplicate(true))
	while telemetry_history.size() > 120:
		telemetry_history.pop_front()
	telemetry_updated.emit(telemetry, telemetry_history)

func publish_chat(msg: Dictionary) -> void:
	Log.debug("backend", "chat %s→%s: %s" % [msg.get("from", "?"),
			msg.get("to", "?"), str(msg.get("text", "")).left(60)])
	chat_log.append(msg)
	while chat_log.size() > CHAT_LOG_MAX:
		chat_log.pop_front()
	var from_role := _chat_role(str(msg.get("from", "")))
	if str(msg.get("to", "")).to_lower() == "user" \
			and REPLY_CAPABLE.has(from_role) and from_role != _open_chat_role:
		chat_unread[from_role] = int(chat_unread.get(from_role, 0)) + 1
		chat_unread_changed.emit(chat_unread.duplicate())
	chat_message.emit(msg)

func publish_positions(list: Array) -> void:
	positions_are_demo = false
	positions = list
	Log.debug("backend", "posizioni: %d dal jobs.db" % list.size())
	positions_updated.emit(list)

func show_demo_positions() -> void:
	if positions_are_demo and not positions.is_empty():
		return
	positions_are_demo = true
	positions = DemoPositions.build()
	Log.info("backend", "showroom: %d posizioni fittizie" % positions.size())
	positions_updated.emit(positions)

func clear_demo_positions() -> void:
	if not positions_are_demo:
		return
	positions_are_demo = false
	positions = []
	positions_updated.emit(positions)

func publish_settings(settings: Dictionary) -> void:
	live_settings = settings
	Log.debug("backend", "config live: %s" % ", ".join(settings.keys()))
	live_settings_updated.emit(settings)
