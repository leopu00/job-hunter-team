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
