class_name SpeechBubbleLayout
extends RefCounted
## Packing deterministico delle vignette nel mondo.
##
## Le vignette partono tutte dal proprio ancoraggio naturale sopra la testa.
## Se due riquadri si intersecano, si provano prima corsie orizzontali e poi
## livelli più alti. Le aree delle teste sono ostacoli allo stesso modo: il
## testo non può più coprire un altro agente né essere spinto fuori camera.

const GAP := 10.0
const MAX_STEPS := 128
# Una sola corsia per lato: oltre, il collegamento con la testa diventerebbe
# una riga lunga attraverso il reparto. Il messaggio successivo sale di livello.
const LANES := [0, -1, 1]


## items: [{id, anchor: Vector2, rect: Rect2}]. `rect` è la box globale alla
## quota naturale. Ritorna id → offset da applicare al disegno.
static func arrange(raw_items: Array, avoid: Array, bounds := Rect2()) -> Dictionary:
	var items := raw_items.duplicate(true)
	items.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		var aa: Vector2 = a.get("anchor", (a["rect"] as Rect2).get_center())
		var bb: Vector2 = b.get("anchor", (b["rect"] as Rect2).get_center())
		if not is_equal_approx(aa.y, bb.y):
			return aa.y < bb.y
		if not is_equal_approx(aa.x, bb.x):
			return aa.x < bb.x
		return str(a["id"]) < str(b["id"])
	)
	var placed: Array[Rect2] = []
	var result := {}
	for item: Dictionary in items:
		var base: Rect2 = item["rect"]
		var current := base
		var found := false
		# La corsia dipende dalla larghezza reale: testi ingranditi dal profilo
		# low-spec conservano quindi la stessa separazione in pixel visibili.
		var stride := maxf(90.0, base.size.x * 0.75)
		var level_step := base.size.y + GAP
		for level in 12:
			for lane in LANES:
				var candidate := Rect2(base.position + Vector2(
						float(lane) * stride, -float(level) * level_step), base.size)
				if _is_clear(candidate, avoid, placed, bounds):
					current = candidate
					found = true
					break
			if found:
				break
		# Fallback per raffiche patologiche: meglio una pila molto alta che due
		# testi uno sopra l'altro. Il limite evita loop su geometrie corrotte.
		var steps := 0
		while not found and steps < MAX_STEPS:
			steps += 1
			var blocker := _first_intersection(current, avoid)
			if blocker.size == Vector2.ZERO:
				blocker = _first_intersection(current, placed)
			if blocker.size == Vector2.ZERO:
				break
			current.position.y += minf(-1.0,
					blocker.position.y - GAP - current.end.y)
		result[item["id"]] = current.position - base.position
		placed.append(current)
	return result


static func _is_clear(rect: Rect2, avoid: Array, placed: Array[Rect2],
		bounds: Rect2) -> bool:
	if bounds.size != Vector2.ZERO and not bounds.encloses(rect):
		return false
	return _first_intersection(rect, avoid).size == Vector2.ZERO \
			and _first_intersection(rect, placed).size == Vector2.ZERO


static func _first_intersection(rect: Rect2, obstacles: Array) -> Rect2:
	for raw in obstacles:
		var obstacle: Rect2 = raw
		if rect.intersects(obstacle):
			return obstacle
	return Rect2()
