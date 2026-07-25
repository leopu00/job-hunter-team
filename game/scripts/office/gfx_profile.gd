class_name GfxProfile
## Marchio della scenografia "di lusso": quello che il profilo ridotto spegne
## su una macchina che arranca. Sta qui e non nell'autoload Game perché i
## selftest headless girano con `godot --script`, dove gli autoload non
## esistono: un riferimento diretto a `Game` da un nodo di scena fa fallire la
## compilazione dell'intero grafo di dipendenze (pipeline_queue_selftest
## appeso, 25/07). Una classe globale invece compila sempre.

const GROUP := "gfx_luxury"


## Registra il nodo fra gli spegnibili e lo mette subito nello stato giusto.
static func mark(item: CanvasItem) -> void:
	item.add_to_group(GROUP)
	item.visible = not low()


## Profilo attivo, letto dall'autoload solo se c'è davvero.
static func low() -> bool:
	var game := _game()
	return game != null and bool(game.low_gfx)


static func _game() -> Node:
	var loop := Engine.get_main_loop()
	var tree := loop as SceneTree
	if tree == null or tree.root == null:
		return null
	return tree.root.get_node_or_null("Game")
