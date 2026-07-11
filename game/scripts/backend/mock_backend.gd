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
	{"slug": "coordinatore-1", "role": "coordinatore", "name": "Coordinatore", "active": true, "status": "working", "desk_hint": ""},
	{"slug": "scout-1", "role": "scout", "name": "Scout Lead", "active": true, "status": "working", "desk_hint": ""},
	{"slug": "scout-2", "role": "scout", "name": "Scout 02", "active": true, "status": "working", "desk_hint": ""},
	{"slug": "analista-1", "role": "analista", "name": "Analista Lead", "active": true, "status": "working", "desk_hint": ""},
	{"slug": "analista-2", "role": "analista", "name": "Analista 02", "active": true, "status": "idle", "desk_hint": ""},
	{"slug": "scorer-1", "role": "scorer", "name": "Scorer Lead", "active": true, "status": "working", "desk_hint": ""},
	{"slug": "critico-1", "role": "critico", "name": "Critico Lead", "active": true, "status": "working", "desk_hint": ""},
	{"slug": "mentor-1", "role": "mentor", "name": "Mentor", "active": true, "status": "working", "desk_hint": ""},
	{"slug": "assistente-1", "role": "assistente", "name": "Assistente", "active": true, "status": "working", "desk_hint": ""},
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

## Eventi di roster ciclici: i worker dinamici vanno e vengono.
## op: spawn | despawn | status; il ciclo li applica in sequenza.
const ROSTER_EVENTS := [
	{"op": "status", "slug": "analista-2", "status": "working"},
	{"op": "spawn", "slug": "scout-3", "role": "scout", "name": "Scout 03"},
	{"op": "despawn", "slug": "scout-2"},
	{"op": "status", "slug": "scorer-1", "status": "idle"},
	{"op": "spawn", "slug": "scrittore-1", "role": "scrittore", "name": "Scrittore Lead"},
	{"op": "status", "slug": "scorer-1", "status": "working"},
	{"op": "spawn", "slug": "scout-2", "role": "scout", "name": "Scout 02"},
	{"op": "despawn", "slug": "scout-3"},
	{"op": "despawn", "slug": "scrittore-1"},
	{"op": "status", "slug": "analista-2", "status": "idle"},
]

func start(_config: Dictionary) -> void:
	_running = true
	_boot()

func stop() -> void:
	_running = false

func _boot() -> void:
	bus.publish_state(BackendBus.CONNECTING, "simulatore locale")
	await _sleep(0.9)
	if not _running:
		return
	bus.publish_state(BackendBus.CONNECTED, "VPS simulata (mock)")
	bus.publish_agents(_roster.duplicate(true))
	_chat_loop()
	_roster_loop()

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
					_roster.append({"slug": ev["slug"], "role": ev["role"],
							"name": ev["name"], "active": true,
							"status": "working", "desk_hint": ""})
			"despawn":
				for a in _roster:
					if a["slug"] == ev["slug"]:
						_roster.erase(a)
						break
			"status":
				for a in _roster:
					if a["slug"] == ev["slug"]:
						a["status"] = ev["status"]
						break
		bus.publish_agents(_roster.duplicate(true))

## ── Chat bidirezionale simulata (contratto open/send/close) ──────────
## Stesso giro del canale vero: open → snapshot, send → eco utente +
## checkpoint "sta lavorando" (partial) + risposta finale (done).

const REPLIES := {
	"capitano": "Ricevuto. Il team è a regime: pacing regolare, nessun collo di bottiglia. Ti aggiorno al prossimo tick.",
	"assistente": "Ricevuto! Lo segno subito nel registro del team.",
}

var _chat_agent := ""
var _chat_msgs: Array = []

func open_chat(agent: String) -> void:
	_chat_agent = agent
	bus.agent_chat_updated.emit(agent, _chat_msgs.duplicate(true))

func close_chat() -> void:
	_chat_agent = ""

func send_chat(agent: String, text: String) -> void:
	_chat_msgs.append({"role": "user", "text": text,
			"ts": Time.get_datetime_string_from_system(), "done": true})
	bus.user_chat_sent.emit(agent, true, "")
	_publish_chat_state(agent)
	_mock_reply(agent)

func _mock_reply(agent: String) -> void:
	await _sleep(randf_range(1.0, 2.0))
	if not _running or _chat_agent != agent:
		return
	_chat_msgs.append({"role": "assistant", "text": "ci sto lavorando…",
			"ts": Time.get_datetime_string_from_system(), "partial": true})
	_publish_chat_state(agent)
	await _sleep(randf_range(2.0, 3.0))
	if not _running or _chat_agent != agent:
		return
	# il checkpoint intermedio viene sostituito dalla risposta vera
	_chat_msgs.pop_back()
	_chat_msgs.append({"role": "assistant",
			"text": REPLIES.get(agent, "Ricevuto."),
			"ts": Time.get_datetime_string_from_system(), "done": true})
	_publish_chat_state(agent)

func _publish_chat_state(agent: String) -> void:
	if _chat_agent == agent:
		bus.agent_chat_updated.emit(agent, _chat_msgs.duplicate(true))

func _is_active(slug: String) -> bool:
	for a in _roster:
		if a["slug"] == slug and a.get("active", true):
			return true
	return false

func _sleep(seconds: float) -> void:
	await bus.get_tree().create_timer(seconds).timeout
