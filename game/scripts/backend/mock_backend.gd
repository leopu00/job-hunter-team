class_name MockBackend
extends BackendAdapter
## Simulatore locale del backend team (contratto BackendAdapter): permette
## di sviluppare e testare la scena viva — roster attivo, chat a fumetti,
## stati di connessione — senza una VPS. È anche il riferimento vivo del
## contratto che VpsBackend deve eguagliare: stessi eventi, stessi campi.
## Si monta con BackendBus.set_backend(MockBackend.new()) (JHT_BACKEND_TEST=1).

var _running := false

## Roster simulato: parte un sottoinsieme realistico del team (i W dinamici
## si accendono e spengono durante la sessione, come sulla VPS vera).
var _roster: Array = [
	{"slug": "coordinatore", "uid": "coordinatore-1", "role": "coordinatore", "name": "Coordinatore", "active": true, "status": "working", "desk_hint": ""},
	{"slug": "scout", "uid": "scout-1", "role": "scout", "name": "Scout Lead", "active": true, "status": "working", "desk_hint": ""},
	{"slug": "scout", "uid": "scout-2", "role": "scout", "name": "Scout 02", "active": true, "status": "working", "desk_hint": ""},
	{"slug": "analista", "uid": "analista-1", "role": "analista", "name": "Analista Lead", "active": true, "status": "working", "desk_hint": ""},
	{"slug": "analista", "uid": "analista-2", "role": "analista", "name": "Analista 02", "active": true, "status": "idle", "desk_hint": ""},
	{"slug": "scorer", "uid": "scorer-1", "role": "scorer", "name": "Scorer Lead", "active": true, "status": "working", "desk_hint": ""},
	{"slug": "critico", "uid": "critico-1", "role": "critico", "name": "Critico Lead", "active": true, "status": "working", "desk_hint": ""},
	{"slug": "scrittore", "uid": "scrittore-1", "role": "scrittore", "name": "Scrittore Lead", "active": true, "status": "working", "desk_hint": ""},
	{"slug": "mentor", "uid": "mentor-1", "role": "mentor", "name": "Mentor", "active": true, "status": "working", "desk_hint": ""},
	{"slug": "assistente", "uid": "assistente-1", "role": "assistente", "name": "Assistente", "active": true, "status": "working", "desk_hint": ""},
]

## Chat plausibile per ruolo: [from, to, testo]. "all" = broadcast,
## "user" = messaggio all'utente (fumetto "→ te").
const CHATTER := [
	["scout-1", "all", "3 board visitate: 6 posizioni nuove, 2 senior backend a Berlino, il resto remoto EU."],
	["scout-2", "coordinatore-1", "LinkedIn rallenta le risposte, passo alla board successiva e riprovo tra un'ora."],
	["scout-1", "coordinatore-1", "Quota città prioritaria al 32%: entro il cap, continuo sul remoto."],
	["analista-1", "all", "Profilate 4 aziende: due scale-up fintech, una consultancy, una product house."],
	["analista-2", "scorer-1", "Ti ho messo in coda 3 posizioni analizzate: manca solo il salary range di una."],
	["scorer-1", "all", "Score medio della mattinata 71: la migliore è a 88, stack match quasi pieno."],
	["scorer-1", "user", "Trovata una posizione a 88/100: stack pieno, remoto, salary sopra la tua mediana."],
	["critico-1", "all", "Recensione CV: 8/10, PASS. Registro coerente, taglio le due ripetizioni e chiudo."],
	["coordinatore-1", "all", "Weekly al 64%: pacing regolare, nessun intervento necessario."],
	["coordinatore-1", "scout-2", "Riprendi il giro delle board: la coda analisti è quasi vuota."],
	["mentor-1", "user", "Consiglio del giorno: nelle candidature remote EU cita il fuso e la disponibilità overlap."],
	["assistente-1", "user", "Ho archiviato 2 notifiche e aggiornato il registro candidature."],
	["coordinatore-1", "user", "Il team è a regime: 6 nuove posizioni oggi, 3 in analisi, 1 in scrittura."],
]

## Transizioni di stato simulate (contratto bus.transitions: righe del
## registro con by_agent per-istanza): la pipeline completa di una
## posizione, così la scena reagisce con l'agente giusto — la scrittura
## CV deve accendere la stampante.
## Stati e firme come nel jobs.db VERO (SELECT DISTINCT sulla VPS:
## to_state ∈ new/checked/scored/writing/ready/excluded, by_agent
## per-istanza "scout-2"): il mock deve recitare il sistema reale.
const TRANSITIONS := [
	{"by_agent": "scout-2", "from_state": null, "to_state": "new", "title": "Senior Backend Engineer", "company": "TechNova"},
	{"by_agent": "analista-1", "from_state": "new", "to_state": "checked", "title": "Senior Backend Engineer", "company": "TechNova"},
	{"by_agent": "scorer-1", "from_state": "checked", "to_state": "scored", "title": "Senior Backend Engineer", "company": "TechNova"},
	{"by_agent": "scout-1", "from_state": null, "to_state": "new", "title": "Staff Platform Engineer", "company": "Cloudreef"},
	{"by_agent": "scrittore-1", "from_state": "scored", "to_state": "writing", "title": "Senior Backend Engineer", "company": "TechNova"},
	{"by_agent": "scrittore-1", "from_state": "writing", "to_state": "ready", "title": "Senior Backend Engineer", "company": "TechNova"},
]

## Eventi di roster ciclici: i worker dinamici vanno e vengono, e i
## nuovi stati della missione pipeline si vedono tutti — throttle breve
## (attesa seduta), throttle lungo (dado ricreazione), killed (esce
## dalla porta). op: spawn | despawn | status; applicati in sequenza.
const ROSTER_EVENTS := [
	{"op": "status", "slug": "analista-2", "status": "working"},
	{"op": "status", "slug": "scout-2", "status": "throttled", "throttle_secs": 240.0},
	{"op": "spawn", "slug": "scout-3", "role": "scout", "name": "Scout 03"},
	{"op": "status", "slug": "scout-2", "status": "working"},
	{"op": "status", "slug": "scorer-1", "status": "throttled", "throttle_secs": 45.0},
	{"op": "despawn", "slug": "scout-2"},
	{"op": "spawn", "slug": "scrittore-2", "role": "scrittore", "name": "Scrittore 02"},
	{"op": "status", "slug": "scorer-1", "status": "working"},
	{"op": "spawn", "slug": "scout-2", "role": "scout", "name": "Scout 02"},
	{"op": "status", "slug": "scout-3", "status": "killed"},
	{"op": "despawn", "slug": "scout-3"},
	{"op": "despawn", "slug": "scrittore-2"},
	{"op": "status", "slug": "analista-2", "status": "idle"},
]

func start(_config: Dictionary) -> void:
	_running = true
	_apply_scenario(OS.get_environment("JHT_SIM_STATE"))
	_boot()

func stop() -> void:
	_running = false

func _boot() -> void:
	bus.publish_state(BackendBus.CONNECTING, "simulatore locale")
	await _sleep(0.9)
	if not _running:
		return
	bus.publish_state(BackendBus.CONNECTED, "VPS simulata (mock)")
	bus.publish_agents(_published_roster())
	# baseline del registro attività (contratto: transitions sul bus
	# PRIMA di positions_updated) — le reazioni partono dal refresh dopo
	bus.transitions = []
	bus.publish_positions([])
	if OS.get_environment("JHT_SIM_STATE") != "":
		return  # scenario fotografico deterministico: nessun evento casuale
	_chat_loop()
	_roster_loop()
	_transitions_loop()

## Scenari deterministici per l'audit stato→corpo. Lo snapshot contiene
## ESCLUSIVAMENTE gli agenti che devono esistere nella scena.
func _apply_scenario(scenario: String) -> void:
	if scenario == "":
		return
	match scenario:
		"working":
			_roster = [_sim("scout-1", "scout", "working", 0.0, "turno in corso")]
		"idle":
			_roster = [_sim("analista-1", "analista", "idle", 0.0,
					"sessione attiva, nessun turno in corso")]
		"paused":
			_roster = [_sim("scorer-1", "scorer", "paused", 0.0,
					"in attesa di ripresa")]
		"throttle_short":
			_roster = [_sim("scrittore-1", "scrittore", "throttled", 45.0,
					"pacing: pausa temporizzata")]
		"throttle_long":
			_roster = [_sim("critico-1", "critico", "throttled", 240.0,
					"pacing: pausa temporizzata")]
		"mixed":
			_roster = [
				_sim("scout-1", "scout", "working", 0.0, "turno in corso"),
				_sim("analista-1", "analista", "idle", 0.0, "nessun turno in corso"),
				_sim("scorer-1", "scorer", "paused", 0.0, "in attesa di ripresa"),
				_sim("scrittore-1", "scrittore", "throttled", 45.0, "pacing"),
				_sim("critico-1", "critico", "throttled", 240.0, "pacing"),
			]
		"writers_pair":
			# Audit grafico deterministico delle prime due postazioni:
			# lead→desk 1 diagonale, seconda istanza→desk 0 laterale.
			_roster = [
				_sim("scrittore-1", "scrittore", "working", 0.0, "CV in scrittura"),
				_sim("scrittore-2", "scrittore", "working", 0.0, "lettera in scrittura"),
			]
		"all_seated":
			# Audit grafico completo: sei istanze per ciascun reparto, una per
			# postazione, tutte ferme al desk per controllare i 30 compositi.
			_roster = []
			for role in ["scout", "analista", "scorer", "scrittore", "critico"]:
				for i in range(1, 7):
					_roster.append(_sim("%s-%d" % [role, i], role, "working", 0.0,
							"audit seduta"))
		"minimal":
			_roster = [_sim("mentor-1", "mentor", "idle", 0.0, "in attesa")]
		_:
			_roster = []

func _sim(uid: String, role: String, status: String, throttle: float, detail: String) -> Dictionary:
	return {"slug": role, "uid": uid, "role": role, "name": role.capitalize(),
			"active": true, "status": status, "desk_hint": "",
			"throttle_secs": throttle, "throttle_total": throttle,
			"activity_detail": detail}

## Un fumetto ogni 5-11 secondi, pescando dal pool ma SOLO fra chi è
## attivo in scena (un despawnato non parla).
func _chat_loop() -> void:
	var i := randi() % CHATTER.size()
	while _running:
		await _sleep(randf_range(5.0, 11.0))
		if not _running:
			return
		for _try in CHATTER.size():
			i = (i + 1) % CHATTER.size()
			var line: Array = CHATTER[i]
			if _is_active(line[0]):
				bus.publish_chat({
					"ts": Time.get_datetime_string_from_system(),
					"from": line[0], "to": line[1], "text": line[2],
				})
				break

## Un evento di roster ogni 20-35 secondi: spawn/despawn/status,
## poi snapshot COMPLETO sul bus (contratto: mai delta).
func _roster_loop() -> void:
	var i := 0
	while _running:
		await _sleep(randf_range(20.0, 35.0))
		if not _running:
			return
		var ev: Dictionary = ROSTER_EVENTS[i % ROSTER_EVENTS.size()]
		i += 1
		match ev["op"]:
			"spawn":
				if not _is_active(ev["slug"]):
					_roster.append({"slug": ev["role"], "uid": ev["slug"], "role": ev["role"],
							"name": ev["name"], "active": true,
							"status": "working", "desk_hint": ""})
			"despawn":
				for a in _roster:
					if a["uid"] == ev["slug"]:
						_roster.erase(a)
						break
			"status":
				for a in _roster:
					if a["uid"] == ev["slug"]:
						a["status"] = ev["status"]
						a["throttle_secs"] = ev.get("throttle_secs", 0.0)
						break
		bus.publish_agents(_published_roster())


## Copia del roster pronta per il bus, coi cognomi già dentro il nome —
## esattamente quello che VpsBackend._parse_roster consegna con la VPS
## accesa. Il mock è il riferimento vivo di quel contratto: se qui gli
## agenti restassero "Scout 02" lo showroom mostrerebbe un ufficio diverso
## da quello vero, e i cognomi si vedrebbero solo a VPS accesa.
##
## Si compone sulla copia e mai su `_roster`: la lista di lavoro resta la
## sorgente, il nome resta un fatto di presentazione.
func _published_roster() -> Array:
	var out := _roster.duplicate(true)
	for a: Dictionary in out:
		a["name"] = AgentNames.display_name(
				str(a.get("uid", a.get("slug", ""))), str(a.get("name", "")))
	return out

## Una transizione nuova in testa al registro ogni 12-20 secondi (la
## prima presto, per vederla subito nei test), poi refresh come farebbe
## il poll del jobs.db vero: transitions sul bus + positions_updated.
func _transitions_loop() -> void:
	var i := 0
	var pos_id := 4200
	while _running:
		await _sleep(6.0 if i == 0 else randf_range(12.0, 20.0))
		if not _running:
			return
		var t: Dictionary = TRANSITIONS[i % TRANSITIONS.size()].duplicate()
		i += 1
		if t["to_state"] == "new":
			pos_id += 1
		t["position_id"] = pos_id
		t["ts"] = Time.get_datetime_string_from_system()
		bus.transitions.push_front(t)
		bus.publish_positions(bus.positions)

## ── Chat bidirezionale simulata (contratto open/send/close) ──────────
## Stesso giro del canale vero: open → snapshot, send → eco utente +
## checkpoint "sta lavorando" (partial) + risposta finale (done).

## Chiavi = uid di GIOCO (contratto 1053f1ce: il bus non traduce più
## in "capitano"); il fallback copre ogni altro agente del roster.
const REPLIES := {
	"coordinatore-1": "Ricevuto. Il team è a regime: pacing regolare, nessun collo di bottiglia. Ti aggiorno al prossimo tick.",
	"assistente-1": "Ricevuto! Lo segno subito nel registro del team.",
	"mentor-1": "Buona domanda: parliamone. Intanto ricorda che la ricerca è una maratona.",
}

var _chat_agent := ""
var _chat_msgs: Array = []
var _terminal_agent := ""
var _terminal_generation := 0

func open_chat(agent: String) -> void:
	_chat_agent = agent
	# Onboarding: l'assistente accoglie per primo (nel sistema vero il
	# welcome arriva dal boot dell'agente; qui lo recita il mock).
	if _profile_watch and agent.begins_with("assistente") and _chat_msgs.is_empty():
		_chat_msgs.append({"role": "assistant", "text": WIZ_REPLIES[0],
				"ts": Time.get_unix_time_from_system(), "done": true})
	bus.publish_agent_chat(agent, _chat_msgs.duplicate(true))

func close_chat() -> void:
	_chat_agent = ""

func open_terminal(agent: String) -> void:
	_terminal_agent = agent
	_terminal_generation += 1
	_mock_terminal_loop(agent, _terminal_generation)

func close_terminal() -> void:
	_terminal_agent = ""
	_terminal_generation += 1

var _coord_state := {
	"maintenance": {"enabled": false, "stop_search": false,
		"discard_expired_rotating": true, "cv_min_score": 90,
		"pre_check_liveness_for_cv": true},
	"enrichment": {"economy": false, "logo_enabled": true,
		"logo_min_score": 70, "geocode_enabled": true,
		"geocode_min_score": 65, "geocode_non_remote_only": true,
		"recheck_enabled": true, "recheck_min_score": 65,
		"recheck_older_days": 14},
	"queue_counts": {"new": 8, "analysis": 23, "scored": 41,
		"geocode": 17, "logos": 12, "recheck": 29, "expired": 6},
	"directives": [
		{"id": 1, "body": "Dai priorità alle posizioni AI Engineering remote UE.",
			"kind": "strategy", "status": "active"},
	],
}
var _coord_next_directive := 2

func fetch_coordinator_state() -> void:
	bus.publish_coordinator_state(_coord_state.duplicate(true))

func save_coordinator_settings(settings: Dictionary) -> void:
	_coord_state["maintenance"] = settings.get("maintenance", {}).duplicate(true)
	_coord_state["enrichment"] = settings.get("enrichment", {}).duplicate(true)
	bus.publish_coordinator_action("save", true, "")
	bus.publish_coordinator_state(_coord_state.duplicate(true))

func add_team_directive(body: String, kind: String) -> void:
	var row := {"id": _coord_next_directive, "body": body.strip_edges(),
		"kind": kind, "status": "active"}
	_coord_next_directive += 1
	(_coord_state["directives"] as Array).append(row)
	bus.publish_coordinator_action("directive_add", true, "")
	bus.publish_coordinator_state(_coord_state.duplicate(true))

func archive_team_directive(directive_id: int) -> void:
	var active: Array = []
	for row: Dictionary in _coord_state["directives"]:
		if int(row.get("id", 0)) != directive_id:
			active.append(row)
	_coord_state["directives"] = active
	bus.publish_coordinator_action("directive_archive", true, "")
	bus.publish_coordinator_state(_coord_state.duplicate(true))

## Deroga alla spesa nello showroom: nessun flag su disco, una scadenza
## simulata in memoria. Serve perché l'interruttore si comporti come quello
## vero — compreso lo scorrere del tempo residuo — senza che chi sta ancora
## configurando il prodotto veda un comando morto.
var _burn_deadline_msec := 0

func _burn_payload() -> Dictionary:
	var left := maxf(0.0, (_burn_deadline_msec - Time.get_ticks_msec()) / 1000.0)
	return {"readable": true, "supported": true, "active": left > 0.0,
		"state": "active" if left > 0.0 else "off",
		"remaining_sec": int(left), "never_yields": BurnMode.NEVER_YIELDS,
		"default_hours": BurnMode.DEFAULT_HOURS, "max_hours": BurnMode.MAX_HOURS}

func fetch_burn_intent() -> void:
	bus.publish_burn_intent(_burn_payload())

func set_burn_intent(active: bool, hours: float) -> void:
	# Stesso clamp del modulo Python: nello showroom non deve esistere una
	# durata che sulla macchina vera verrebbe rifiutata.
	var h := clampf(hours, 0.25, float(BurnMode.MAX_HOURS))
	_burn_deadline_msec = int(Time.get_ticks_msec() + h * 3600.0 * 1000.0) \
			if active else 0
	bus.publish_burn_intent_action(active, true, "")
	bus.publish_burn_intent(_burn_payload())

func _mock_terminal_loop(agent: String, generation: int) -> void:
	var lines := PackedStringArray([
		"$ tmux attach -t %s" % agent.to_upper(),
		"Job Hunter Team · sessione agente attiva",
		"────────────────────────────────────────────────────────────",
		"[09:41:02] carico il contesto e controllo la coda assegnata",
		"[09:41:05] jobs.db: snapshot ricevuto, 12 elementi candidati",
		"[09:41:07] applico i vincoli del profilo e le regole di pacing",
	])
	if OS.get_environment("JHT_AGENT_UI_TEST") == "1":
		for i in range(1, 141):
			lines.append("[%03d] riga storica della sessione per test scrollback" % i)
	var tick := 0
	while _running and _terminal_agent == agent and generation == _terminal_generation:
		bus.publish_agent_terminal(agent, "\n".join(lines), "")
		await _sleep(1.8)
		tick += 1
		lines.append("[%s] tick %02d · %s" % [
				Time.get_time_string_from_system(), tick,
				["analisi in corso", "verifica completata", "attendo il prossimo evento"][tick % 3]])
		if lines.size() > 80:
			lines.remove_at(3)

func send_chat(agent: String, text: String) -> void:
	_chat_msgs.append({"role": "user", "text": text,
			"ts": Time.get_unix_time_from_system(), "done": true})
	bus.user_chat_sent.emit(agent, true, "")
	_publish_chat_state(agent)
	_mock_reply(agent)

func _mock_reply(agent: String) -> void:
	await _sleep(randf_range(1.0, 2.0))
	if not _running or _chat_agent != agent:
		return
	_chat_msgs.append({"role": "assistant", "text": "ci sto lavorando…",
			"ts": Time.get_unix_time_from_system(), "partial": true})
	_publish_chat_state(agent)
	await _sleep(randf_range(2.0, 3.0))
	if not _running or _chat_agent != agent:
		return
	# il checkpoint intermedio viene sostituito dalla risposta vera
	_chat_msgs.pop_back()
	var reply: String = REPLIES.get(agent, "Ricevuto.")
	# Onboarding: la risposta segue il passo del profilo (e lo avanza),
	# così la conversazione col mock ricalca il flusso dell'assistente vero.
	if _profile_watch and agent.begins_with("assistente"):
		_wiz_advance(1)
		reply = WIZ_REPLIES[mini(_wiz_step, WIZ_REPLIES.size() - 1)]
	var response := {"role": "assistant", "text": reply,
			"ts": Time.get_unix_time_from_system(), "done": true}
	if agent.begins_with("assistente") or agent.begins_with("coordinatore") \
			or agent.begins_with("capitano") or agent.begins_with("mentor"):
		response["choices"] = [
			{"label": "Approfondiamo questo punto", "value": "Approfondiamo questo punto"},
			{"label": "Mostrami il prossimo passo", "value": "Mostrami il prossimo passo"},
		]
	_chat_msgs.append(response)
	_publish_chat_state(agent)

## Il mock è il riferimento vivo del contratto: pubblica dalla PORTA del bus
## (publish_agent_chat), non emettendo il segnale a mano. Emettendolo a mano
## saltava il pezzo che spegne l'attesa quando la risposta arriva — coi
## puntini "sta rispondendo" accesi per sempre, che è proprio il difetto che
## il VpsBackend non ha (usa la porta) e che nessuno vedeva in simulazione.
func _publish_chat_state(agent: String) -> void:
	if _chat_agent == agent:
		bus.publish_agent_chat(agent, _chat_msgs.duplicate(true))

## ── Onboarding simulato (wizard senza VPS) ───────────────────────────
## Contratto opzionale dell'adapter (open_profile_watch / ensure_assistant
## / upload_document) come sul backend vero. Il profilo si riempie a passi
## deterministici: ogni messaggio all'assistente vale 1 passo, un upload
## CV ne vale 2; a 4 passi il profilo è completo (ready). Così il flusso
## intero si prova in un paio di minuti, senza rete.

const WIZ_READY_STEP := 4

const WIZ_REPLIES := [
	"Benvenuto! Sono l'Assistente: costruiamo insieme il tuo profilo. Raccontami che ruolo cerchi e da dove parti — oppure carica direttamente il CV.",
	"Perfetto, lo segno sul badge. Mi dici anche località, anni di esperienza e le lingue che parli?",
	"Ottimo, il profilo prende forma: mancano solo le competenze principali. Se carichi il CV le estraggo io.",
	"Ci siamo: il tuo badge è completo. Quando vuoi, entra in ufficio — il team ti aspetta.",
]

## Tappe del profilo finto: a ogni passo si aggiungono campi, come farebbe
## l'assistente vero scrivendo il candidate_profile.yml.
const WIZ_PROFILE_STEPS := [
	{},
	{"name": "Mario Rossi", "target_role": "Project Manager"},
	{"location": "Firenze, IT", "experience_years": "5",
			"languages": ["Italiano C2", "Inglese B2"], "email": "mario@example.com"},
	{"seniority_target": "mid", "skills": ["Team leadership", "Budgeting"]},
	{"skills": ["Team leadership", "Budgeting", "Public speaking"]},
]

var _profile_watch := false
var _wiz_step := 0

## Storico usage sintetico ma plausibile: curva 5h a dente di sega sui
## reset, weekly che cresce nella settimana, consumi per-agente con
## turni alternati. Deterministico (seed dal bucket): stessi grafici a
## ogni apertura, niente sfarfallio da showroom.
func fetch_usage_history(from_ts: float, to_ts: float, bucket_sec: int) -> void:
	var data := {"ok": true, "sentinel": [], "meter": [], "throttle": [],
			"agents": {}}
	var names := ["scout-1", "scout-2", "analista-1", "scorer-1",
			"scrittore-1", "critico-1", "capitano", "sentinella"]
	var series: Array = []
	var totals := {}
	var t := floorf(from_ts / bucket_sec) * bucket_sec
	while t <= to_ts:
		var day_phase := fposmod(t, 86400.0) / 86400.0
		var five_h := fposmod(t, 18000.0) / 18000.0     # reset ogni 5h
		var week_phase := fposmod(t, 604800.0) / 604800.0
		# di notte il team dorme (working hours): consumo quasi zero
		var awake := 1.0 if day_phase > 0.33 and day_phase < 0.95 else 0.08
		var wobble := 0.5 + 0.5 * sin(t / 3600.0 * 2.1) * sin(t / 7200.0)
		data["sentinel"].append({"t": t,
				"usage": roundf(five_h * 62.0 * awake * 100.0) / 100.0,
				"weekly": roundf(week_phase * 78.0 * 100.0) / 100.0,
				"velocity": roundf((14.0 + 18.0 * wobble) * awake * 100.0) / 100.0,
				"velocity_ideal": 20.0,
				"projection": roundf(five_h * 80.0 * awake * 100.0) / 100.0})
		if wobble > 0.93 and awake > 0.5:
			data["throttle"].append({"t": t, "throttle_s": 600.0, "pauses": 2})
		data["meter"].append({"t": t,
				"weighted_kt": roundf(five_h * 92000.0 * awake / 10.0) / 100.0,
				"events": int(five_h * 4000.0 * awake)})
		var row := {"t": t}
		for i in names.size():
			# turni sfalsati: ogni agente ha la sua onda di attività
			var mine := 0.5 + 0.5 * sin(t / 5400.0 + float(i) * 1.7)
			if mine * awake > 0.42:
				var kt := roundf(mine * awake * (26.0 + 14.0 * float(i % 3)) * 100.0) / 100.0
				row[names[i]] = kt
				totals[names[i]] = float(totals.get(names[i], 0.0)) + kt
		series.append(row)
		t += bucket_sec
	data["agents"] = {"names": names, "series": series, "totals_kt": totals}
	var query := {"from_ts": from_ts, "to_ts": to_ts, "bucket_sec": bucket_sec}
	_deliver_usage_history.call_deferred(query, data)

func _deliver_usage_history(query: Dictionary, data: Dictionary) -> void:
	await _sleep(0.4)   # un filo di latenza: lo stato "carico…" si vede
	if _running:
		bus.publish_usage_history(query, data)

## Scheda agente: storico sintetico del ruolo, stesso contratto del VPS.
func fetch_agent_history(agent: String, from_ts: float, to_ts: float,
		bucket_sec: int) -> void:
	var series := {"tokens_kt": [], "pct_5h": [], "pct_weekly": [],
			"throttle_s": [], "db_actions": [], "cpu_agent_pct": [],
			"ram_agent_mb": [], "cpu_pct": [], "ram_pct": []}
	var t := floorf(from_ts / bucket_sec) * bucket_sec
	while t <= to_ts:
		var day_phase := fposmod(t, 86400.0) / 86400.0
		var awake := 1.0 if day_phase > 0.33 and day_phase < 0.95 else 0.05
		var wave := (0.5 + 0.5 * sin(t / 4700.0 + float(agent.hash() % 7))) * awake
		var kt := roundf(wave * 42.0 * 100.0) / 100.0
		if kt > 0.5:
			series["tokens_kt"].append({"t": t, "v": kt})
			series["pct_5h"].append({"t": t, "v": roundf(kt / 30.0 * 1000.0) / 1000.0})
			series["pct_weekly"].append({"t": t, "v": roundf(kt / 30.0 * 26.4) / 1000.0})
		if wave > 0.8:
			series["throttle_s"].append({"t": t, "v": 300.0})
		if wave > 0.45 and int(t / bucket_sec) % 3 == 0:
			series["db_actions"].append({"t": t, "v": 1 + int(wave * 3.0)})
		series["cpu_agent_pct"].append({"t": t, "v": roundf(wave * 45.0 * 10.0) / 10.0})
		series["ram_agent_mb"].append({"t": t, "v": roundf((420.0 + 300.0 * wave) * 10.0) / 10.0})
		series["cpu_pct"].append({"t": t, "v": roundf((12.0 + 60.0 * wave) * 10.0) / 10.0})
		series["ram_pct"].append({"t": t, "v": roundf((38.0 + 20.0 * wave) * 10.0) / 10.0})
		t += bucket_sec
	var query := {"agent": agent, "from_ts": from_ts, "to_ts": to_ts,
			"bucket_sec": bucket_sec}
	_deliver_agent_history.call_deferred(query, {"ok": true, "agent": agent,
			"ratio_kt_per_pct": 30.0, "weekly_per_5h_pct": 2.64,
			"series": series})

func _deliver_agent_history(query: Dictionary, data: Dictionary) -> void:
	await _sleep(0.4)
	if _running:
		bus.publish_agent_history(query, data)

func open_profile_watch() -> void:
	_profile_watch = true
	_publish_profile_status()

func close_profile_watch() -> void:
	_profile_watch = false

func ensure_assistant() -> void:
	pass  # nel mock l'assistente è già nel roster

func upload_document(local_path: String) -> void:
	bus.document_uploaded.emit(true,
			"/jht_user/allegati/" + local_path.get_file(), "")
	_wiz_advance(2)

func _wiz_advance(steps: int) -> void:
	_wiz_step = mini(_wiz_step + steps, WIZ_READY_STEP)
	_publish_profile_status()

func _publish_profile_status() -> void:
	if not _profile_watch:
		return
	var profile := {"name": "", "email": "", "target_role": "", "location": "",
			"experience_years": "", "seniority_target": "",
			"skills": [], "languages": []}
	for i in range(mini(_wiz_step, WIZ_PROFILE_STEPS.size() - 1) + 1):
		profile.merge(WIZ_PROFILE_STEPS[i], true)
	var required := {
		"name": str(profile["name"]) != "",
		"email": str(profile["email"]) != "",
		"target_role": str(profile["target_role"]) != "",
		"location": str(profile["location"]) != "",
		"experience_years": str(profile["experience_years"]) != "",
		"seniority_target": str(profile["seniority_target"]) != "",
		"skills": (profile["skills"] as Array).size() >= 2,
		"languages": (profile["languages"] as Array).size() >= 1,
	}
	bus.publish_profile_status({"profile": profile, "required": required,
			"ready": _wiz_step >= WIZ_READY_STEP})

func _is_active(slug: String) -> bool:
	for a in _roster:
		if a["uid"] == slug and a.get("active", true):
			return true
	return false

func _sleep(seconds: float) -> void:
	await bus.get_tree().create_timer(seconds).timeout
