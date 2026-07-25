class_name WorldText
## Il TESTO del mondo resta leggibile a QUALUNQUE scala di rendering: targhe di
## stato, vignette di parlato, messaggi sopra la testa degli agenti.
##
## Il profilo a risoluzione ridotta (Game.render_scale) disegna il mondo su meno
## pixel. Sui disegni la grana è il prezzo accettato; sul testo no: a scala 0.6
## "AL LAVORO" diventava una macchia grigia (screenshot di controllo, 25/07), e
## la leggibilità del testo è un vincolo di prodotto, non una preferenza da
## barattare con gli fps.
##
## Il rimedio è compensare la scala: chi è marchiato qui disegna con un font (e
## un riquadro) ingranditi di 1/scala. A scala 0.6 una targa da 11pt si disegna
## a 18pt e finisce su ~18 pixel di dettaglio, gli stessi che aveva a
## risoluzione piena — a schermo occupa più spazio, ma è il compromesso giusto
## verso chi gioca su una macchina che arranca. È la stessa medicina che
## TerminalTheme.text_boost() già dà agli schermi piccoli.
##
## Perché non un palcoscenico separato a risoluzione piena: il culling per
## visibility_layer disegna un CanvasItem solo se ANCHE tutti i suoi genitori
## condividono il layer, e queste targhe sono figlie degli agenti, che vivono
## nel mondo ridotto — marcare solo le targhe le fa sparire (provato), marcare
## anche i genitori ci riporta l'intero mondo a risoluzione piena. Tirarle fuori
## dalla gerarchia (RemoteTransform2D verso un CanvasLayer) funzionerebbe, ma
## metterebbe il ciclo di vita di ogni vignetta a carico nostro proprio mentre
## gli agenti nascono e muoiono a raffica: il primo bug sono bolle fantasma
## sopra l'ufficio.
##
## Sta in una classe globale e non nell'autoload Game per la stessa ragione di
## GfxProfile: i selftest headless girano con `godot --script`, dove gli autoload
## non esistono e un riferimento a `Game` fa fallire la compilazione dell'intero
## grafo di dipendenze.

const GROUP := "world_text"

## Fattore di compensazione: 1.0 a risoluzione piena, 1/scala sotto.
static var _boost := 1.0


## Comunicata da Office a ogni cambio di scala del mondo, calibrazione inclusa.
static func set_world_scale(scale: float) -> void:
	var wanted := 1.0 / clampf(scale, 0.25, 1.0)
	if is_equal_approx(wanted, _boost):
		return
	_boost = wanted
	var loop := Engine.get_main_loop()
	var tree := loop as SceneTree
	if tree == null:
		return
	for node in tree.get_nodes_in_group(GROUP):
		if node.has_method("refresh_world_text"):
			node.call("refresh_world_text")


static func boost() -> float:
	return _boost


## Registra il nodo fra i testi del mondo e lo porta subito alla misura giusta:
## una vignetta che nasce ad ufficio già calibrato non deve restare indietro.
static func mark(item: CanvasItem) -> void:
	item.add_to_group(GROUP)
	if item.has_method("refresh_world_text"):
		item.call("refresh_world_text")
