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

enum { DISCONNECTED, CONNECTING, CONNECTED, ERROR }

const CONFIG_PATH := "user://vps.cfg"

var state: int = DISCONNECTED
var state_detail := ""
var agents: Array = []  # ultimo snapshot pubblicato (per chi arriva tardi)

var _backend: BackendAdapter


## Una VPS già configurata si ricollega da sola all'avvio (il "collega
## una volta, poi pensa a tutto il gioco" chiesto dal design). TEST-AUTO:
## JHT_VPS_IP/JHT_VPS_KEY forzano una config, JHT_NOVPS=1 spegne tutto
## (per gli shot grafici che non devono toccare la rete).
func _ready() -> void:
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
	chat_message.emit(msg)
