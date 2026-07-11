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
##         status: String ("working"|"idle"|"paused", default "working"),
##         desk_hint: String ("" se il backend non sa dove siede) }
##     È SEMPRE lo snapshot completo del roster, non un delta: chi non
##     c'è più va despawnato.
##   chat_message(msg)
##     msg = { ts: String ISO 8601, from: String, to: String, text: String }
##     from/to sono slug agente, oppure "user" oppure "all".

signal connection_changed(state: int, detail: String)
signal agents_updated(agents: Array)
signal chat_message(msg: Dictionary)
## Aggiunta post-contratto (annunciata in chat, additiva): snapshot
## completo delle posizioni dal jobs.db della VPS, per le viste web
## migrate (elenco+filtri, dettaglio, mappa). Righe = SELECT del
## VpsBackend, campi con i nomi delle colonne reali.
signal positions_updated(positions: Array)

## Conversazione utente ↔ agente (chat bidirezionale). messages = tail
## di chat.jsonl dell'agente: [{role: "user"|"assistant", text, ts,
## partial?}] in ordine cronologico. Emesso a ogni poll finché una
## conversazione è aperta con open_agent_chat().
signal agent_chat_updated(agent: String, messages: Array)
## Esito dell'invio di send_user_chat (ok=false → error leggibile).
signal user_chat_sent(agent: String, ok: bool, error: String)
## Esito di create_position_ticket (l'unica scrittura remota autorizzata
## da Leone, gate 1 dell'11/07: sì ai ticket verso il team, no alle
## azioni che scrivono direttamente sul jobs.db).
signal ticket_created(position_id: int, ok: bool, error: String)
## live_settings è arrivata/cambiata (config team + usage reali).
signal live_settings_updated(settings: Dictionary)

enum { DISCONNECTED, CONNECTING, CONNECTED, ERROR }

const CONFIG_PATH := "user://vps.cfg"

var state: int = DISCONNECTED
var state_detail := ""
var agents: Array = []       # ultimo snapshot pubblicato (per chi arriva tardi)
var positions: Array = []    # ultimo snapshot posizioni (idem)
var transitions: Array = []  # ultime ~80 transizioni di stato (registro team)
## Config team + usage reali (solo campi safe), per sezione della
## sidebar: {provider|hours|email|advanced: [[etichetta, valore], …],
## usage: {window_h, per_agent_kt, generated_at}}.
var live_settings: Dictionary = {}
var chat_log: Array = []     # ultimi messaggi (fumetti di dev1 + vista Chat)
const CHAT_LOG_MAX := 200

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
	if OS.get_environment("JHT_NOVPS") == "1":
		return
	var cfg := load_vps_config()
	if OS.get_environment("JHT_VPS_IP") != "":
		cfg = {
			"ip": OS.get_environment("JHT_VPS_IP"),
			"key_path": OS.get_environment("JHT_VPS_KEY"),
		}
	if str(cfg.get("ip", "")) != "" and str(cfg.get("key_path", "")) != "":
		set_backend(VpsBackend.new(), cfg)


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
	if _backend:
		_backend.bus = self
		_backend.start(config)

func disconnect_backend() -> void:
	set_backend(null)

## Dati VERI in arrivo dalla VPS? (per il badge SIMULAZIONE / LIVE)
func is_live() -> bool:
	return state == CONNECTED and _backend != null and _backend.live

## ── Chat bidirezionale utente ↔ agente ───────────────────────────────

## Slug di gioco → agente chattabile del sistema reale (il protocollo
## [CHAT] è supportato da Capitano e Assistente).
const CHATTABLE := {"coordinatore": "capitano", "assistente": "assistente"}

func can_chat_with(slug: String) -> bool:
	return CHATTABLE.has(slug) and _backend != null

## Apre/chiude la conversazione: finché è aperta il backend polla il
## chat.jsonl dell'agente e pubblica agent_chat_updated.
func open_agent_chat(slug: String) -> void:
	if _backend and CHATTABLE.has(slug):
		_backend.open_chat(CHATTABLE[slug])

func close_agent_chat() -> void:
	if _backend:
		_backend.close_chat()

## Invia il messaggio dell'utente all'agente reale (async: l'esito
## arriva su user_chat_sent, la risposta su agent_chat_updated).
func send_user_chat(slug: String, text: String) -> void:
	if _backend and CHATTABLE.has(slug):
		_backend.send_chat(CHATTABLE[slug], text)


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
	}

func save_vps_config(ip: String, key_path: String) -> void:
	var cfg := ConfigFile.new()
	cfg.set_value("vps", "ip", ip)
	cfg.set_value("vps", "key_path", key_path)
	cfg.save(CONFIG_PATH)


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
	agents_updated.emit(list)

func publish_chat(msg: Dictionary) -> void:
	Log.debug("backend", "chat %s→%s: %s" % [msg.get("from", "?"),
			msg.get("to", "?"), str(msg.get("text", "")).left(60)])
	chat_log.append(msg)
	while chat_log.size() > CHAT_LOG_MAX:
		chat_log.pop_front()
	chat_message.emit(msg)

func publish_positions(list: Array) -> void:
	positions = list
	Log.debug("backend", "posizioni: %d dal jobs.db" % list.size())
	positions_updated.emit(list)

func publish_settings(settings: Dictionary) -> void:
	live_settings = settings
	Log.debug("backend", "config live: %s" % ", ".join(settings.keys()))
	live_settings_updated.emit(settings)
