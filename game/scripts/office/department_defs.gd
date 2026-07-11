class_name DepartmentDefs
## I 5 reparti della box: zone cliccabili, postazioni fisse (fino a 6 per
## reparto) e POI condivisi dei flussi di lavoro. Fonte di verità del layout
## dei reparti: la logica usa zone/rect/spot, la veste grafica mappa
## kind→texture (vedi FurnitureNode.GEN_ART).
##
## Convenzioni:
## - desk "facing" "down": l'agente sta DIETRO il rect (y = rect.y - 14) e
##   guarda in camera, la scrivania gli copre le gambe (Y-sort);
##   "up": sta DAVANTI (y = rect.end.y + 24), di spalle.
## - kind desk_a..desk_f = varianti visive (scrivanie non tutte uguali,
##   ufficio caotico-creativo); desk_wide = monitor ultrawide dello Scorer.
##   Finché una variante non ha texture, FurnitureNode disegna il blockout.
## - "inbox" = punto dove si accumulano i fogli del reparto: è la meta dei
##   flussi cross-reparto (es. gli Analisti ritirano dall'inbox degli Scout).
##
## Il mondo è 2560×2140 (FLOOR 240,140→2440,2000, vedi FurnitureDefs): la
## fila nord (lounge, coffee, lab di vetro) è invariata, lo spazio nuovo è
## a sud. Catena del valore in senso orario: Scout (centro) → Analisti
## (lab) → Scorer (destra) → Scrittori (basso-sx) → Critici (basso-dx).

const DEPT_ORDER := ["scout", "analisti", "scorer", "scrittori", "critici"]

const DEPARTMENTS := {
	"scout": {
		"name": "Scout",
		"tagline": "Trovano le posizioni là fuori",
		"color": Color("#00e87a"),
		"zone": Rect2(1000, 960, 700, 430),
		"inbox": Vector2(1640, 1365),
		"desks": [
			{"rect": Rect2(1032, 1004, 190, 85), "kind": "desk_b", "facing": "down"},
			{"rect": Rect2(1266, 992, 190, 85), "kind": "desk_a", "facing": "down"},
			{"rect": Rect2(1494, 1010, 190, 85), "kind": "desk_d", "facing": "down"},
			{"rect": Rect2(1024, 1238, 190, 85), "kind": "desk_e", "facing": "down"},
			{"rect": Rect2(1258, 1226, 190, 85), "kind": "desk_c", "facing": "down"},
			{"rect": Rect2(1500, 1244, 190, 85), "kind": "desk_f", "facing": "down"},
		],
	},
	"analisti": {
		"name": "Analisti",
		"tagline": "Arricchiscono e verificano i dati",
		"color": Color("#4d9fff"),
		"zone": Rect2(1806, 150, 620, 580),  # il lab di vetro
		"inbox": Vector2(2106, 790),  # fuori dalla porta del lab
		"desks": [
			{"rect": Rect2(1848, 228, 170, 75), "kind": "desk_c", "facing": "down"},
			{"rect": Rect2(2132, 214, 170, 75), "kind": "desk_f", "facing": "down"},
			{"rect": Rect2(1840, 402, 170, 75), "kind": "desk_a", "facing": "down"},
			{"rect": Rect2(2146, 392, 170, 75), "kind": "desk_d", "facing": "down"},
			{"rect": Rect2(1852, 570, 170, 75), "kind": "desk_b", "facing": "down"},
			{"rect": Rect2(2128, 562, 170, 75), "kind": "desk_e", "facing": "down"},
		],
	},
	"scorer": {
		"name": "Scorer",
		"tagline": "Pesano il match profilo↔annuncio",
		"color": Color("#f5c518"),
		"zone": Rect2(1740, 960, 680, 470),
		"inbox": Vector2(1735, 1445),
		"desks": [
			{"rect": Rect2(1772, 1002, 190, 85), "kind": "desk_a", "facing": "down"},
			{"rect": Rect2(2004, 984, 320, 120), "kind": "desk_wide", "facing": "down"},
			{"rect": Rect2(1766, 1236, 190, 85), "kind": "desk_e", "facing": "down"},
			{"rect": Rect2(2010, 1228, 190, 85), "kind": "desk_c", "facing": "down"},
			{"rect": Rect2(2226, 1246, 190, 85), "kind": "desk_f", "facing": "down"},
			{"rect": Rect2(1905, 1332, 190, 85), "kind": "desk_b", "facing": "up"},
		],
	},
	"scrittori": {
		"name": "Scrittori",
		"tagline": "Preparano CV e lettere su misura",
		"color": Color("#a855f7"),
		"zone": Rect2(320, 1480, 700, 430),
		"inbox": Vector2(1060, 1700),
		"desks": [
			{"rect": Rect2(352, 1524, 190, 85), "kind": "desk_d", "facing": "down"},
			{"rect": Rect2(584, 1512, 190, 85), "kind": "desk_b", "facing": "down"},
			{"rect": Rect2(814, 1530, 190, 85), "kind": "desk_f", "facing": "down"},
			{"rect": Rect2(344, 1758, 190, 85), "kind": "desk_a", "facing": "down"},
			{"rect": Rect2(578, 1746, 190, 85), "kind": "desk_e", "facing": "down"},
			{"rect": Rect2(808, 1764, 190, 85), "kind": "desk_c", "facing": "down"},
		],
	},
	"critici": {
		"name": "Critici",
		"tagline": "Revisionano ogni riga prima dell'invio",
		"color": Color("#ff4560"),
		"zone": Rect2(1740, 1480, 680, 430),
		"inbox": Vector2(1700, 1700),
		"desks": [
			{"rect": Rect2(1770, 1522, 190, 85), "kind": "desk_e", "facing": "down"},
			{"rect": Rect2(2002, 1510, 190, 85), "kind": "desk_c", "facing": "down"},
			{"rect": Rect2(2226, 1528, 190, 85), "kind": "desk_a", "facing": "down"},
			{"rect": Rect2(1764, 1756, 190, 85), "kind": "desk_f", "facing": "down"},
			{"rect": Rect2(2008, 1748, 190, 85), "kind": "desk_b", "facing": "down"},
			{"rect": Rect2(2222, 1766, 190, 85), "kind": "desk_d", "facing": "down"},
		],
	},
}

## POI condivisi dei behavior: mete dei viaggi "si vede che lavorano".
## "spot" = dove l'agente si ferma (punto camminabile davanti al prop).
const POIS := {
	"printer": {"rect": Rect2(1672, 190, 110, 78), "spot": Vector2(1727, 300)},
	"coffee": {"spot": Vector2(1500, 310)},
	"water_cooler": {"spot": Vector2(1635, 300)},
	"hologram": {"spot": Vector2(1300, 930)},
}

## Dove sta l'agente assegnato alla scrivania (vedi convenzioni in testa).
static func desk_spot(desk: Dictionary) -> Vector2:
	var r: Rect2 = desk["rect"]
	if desk.get("facing", "down") == "up":
		return Vector2(r.get_center().x, r.end.y + 24)
	return Vector2(r.get_center().x, r.position.y - 14)

## Tutte le scrivanie di tutti i reparti: [{dept, index, rect, kind, facing}].
static func all_desks() -> Array:
	var out: Array = []
	for dept_id in DEPT_ORDER:
		var desks: Array = DEPARTMENTS[dept_id]["desks"]
		for i in desks.size():
			var d: Dictionary = desks[i].duplicate()
			d["dept"] = dept_id
			d["index"] = i
			out.append(d)
	return out

## Ostacoli aggiuntivi per collisioni/pathfinding: le scrivanie dei reparti.
## (La stampante è un item di FurnitureDefs: il suo rect è già lì.)
static func obstacles() -> Array:
	var out: Array = []
	for d in all_desks():
		out.append(d["rect"])
	return out

## Il reparto sotto un punto del mondo ("" se nessuno). Per il click.
static func department_at(point: Vector2) -> String:
	for dept_id in DEPT_ORDER:
		if (DEPARTMENTS[dept_id]["zone"] as Rect2).has_point(point):
			return dept_id
	return ""
