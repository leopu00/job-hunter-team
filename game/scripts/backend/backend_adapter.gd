class_name BackendAdapter
extends RefCounted
## Contratto fra il BackendBus e una sorgente di eventi del team.
## Un adapter NON parla con le scene: spinge gli eventi sul bus chiamando
## i suoi publish_* (vedi backend_bus.gd). Implementazioni previste:
##   MockBackend (dev1) — simulatore locale, per sviluppare senza VPS
##   VpsBackend  (dev2) — SSH reale verso la VPS del team

var bus: Node  # il BackendBus, iniettato da set_backend()

## true solo per i backend con dati VERI (VpsBackend): il badge
## SIMULAZIONE del gioco si spegne quando l'adapter live è CONNECTED.
var live := false


## Avvia la sorgente (connessioni, timer, polling). Deve portare il bus
## a CONNECTED via bus.publish_state() quando i dati iniziano a fluire.
func start(_config: Dictionary) -> void:
	pass


## Ferma tutto e libera le risorse. Il bus pubblica DISCONNECTED da sé.
func stop() -> void:
	pass


## ── Chat bidirezionale (opzionale: il mock può simulare) ─────────────

## Tieni d'occhio la conversazione con l'agente (nome del sistema reale,
## es. "capitano") e pubblica bus.agent_chat_updated a ogni giro.
func open_chat(_agent: String) -> void:
	pass

func close_chat() -> void:
	pass

## Invia il messaggio dell'utente all'agente reale. Esito su
## bus.user_chat_sent(agent, ok, error).
func send_chat(_agent: String, _text: String) -> void:
	pass


## ── Stream terminale agente (sola lettura) ──────────────────────────

## Osserva il contenuto della pane tmux dell'agente. A differenza della
## console di login, questo contratto non espone deliberatamente alcun metodo
## di input: gli adapter possono soltanto pubblicare snapshot di testo.
func open_terminal(_agent: String) -> void:
	pass

func close_terminal() -> void:
	pass


## ── Console del Coordinatore ────────────────────────────────────────

## Legge modalità operativa, enrichment policy, code di manutenzione e
## bacheca persistente del team.
func fetch_coordinator_state() -> void:
	pass

## Salva soltanto le chiavi validate dal backend nei due file canonici:
## capitano-maintenance.json ed enrichment-policy.json.
func save_coordinator_settings(_settings: Dictionary) -> void:
	pass

## CRUD minimo della bacheca permanente (add/archive). Il testo non passa
## mai come argomento shell: gli adapter reali lo trasportano in base64/stdin.
func add_team_directive(_body: String, _kind: String) -> void:
	pass

func archive_team_directive(_directive_id: int) -> void:
	pass


## ── Ticket utente→team (l'unica scrittura remota autorizzata) ────────

## Apre un ticket 'open' sulla posizione: la richiesta che il
## Coordinatore smista sulla VPS. Esito su bus.ticket_created.
func create_ticket(_position_id: int, _text: String) -> void:
	pass
