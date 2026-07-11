class_name BackendAdapter
extends RefCounted
## Contratto fra il BackendBus e una sorgente di eventi del team.
## Un adapter NON parla con le scene: spinge gli eventi sul bus chiamando
## i suoi publish_* (vedi backend_bus.gd). Implementazioni previste:
##   MockBackend (dev1) — simulatore locale, per sviluppare senza VPS
##   VpsBackend  (dev2) — SSH reale verso la VPS del team

var bus: Node  # il BackendBus, iniettato da set_backend()


## Avvia la sorgente (connessioni, timer, polling). Deve portare il bus
## a CONNECTED via bus.publish_state() quando i dati iniziano a fluire.
func start(_config: Dictionary) -> void:
	pass


## Ferma tutto e libera le risorse. Il bus pubblica DISCONNECTED da sé.
func stop() -> void:
	pass
