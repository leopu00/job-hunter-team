class_name DepartmentDefs
## I 5 reparti della box: zone cliccabili, postazioni fisse (fino a 6 per
## reparto) e POI condivisi dei flussi di lavoro. Fonte di verità del layout
## dei reparti: la logica usa zone/rect/spot, la veste grafica mappa
## kind→texture (vedi FurnitureNode.GEN_ART).
##
## Convenzioni:
## - desk "facing" = verso della scrivania; l'agente siede COERENTE al
##   mobile (recensione R2): "down" sta dietro e guarda in camera,
##   "up" sta davanti di spalle, "left"/"right" siedono di fianco rivolti
##   nel verso del mobile. desk_spot() calcola il punto esatto.
## - kind desk_a..desk_f = varianti visive (scrivanie non tutte uguali,
##   ufficio caotico-creativo); desk_wide = monitor ultrawide dello Scorer.
##   Footprint 170×78 dal rapporto sprite (contratto proporzioni con
##   dev-art). Finché una variante non ha texture, blockout procedurale.
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
			{"rect": Rect2(1040, 1006, 170, 78), "kind": "scout_a", "facing": "down"},
			{"rect": Rect2(1272, 990, 170, 78), "kind": "scout_b", "facing": "down"},
			{"rect": Rect2(1496, 1012, 170, 78), "kind": "desk_d", "facing": "left"},
			{"rect": Rect2(1030, 1240, 170, 78), "kind": "desk_e", "facing": "up"},
			{"rect": Rect2(1262, 1228, 170, 78), "kind": "scout_a", "facing": "down"},
			{"rect": Rect2(1498, 1246, 170, 78), "kind": "scout_b", "facing": "down"},
		],
	},
	"analisti": {
		"name": "Analisti",
		"tagline": "Arricchiscono e verificano i dati",
		"color": Color("#4d9fff"),
		"zone": Rect2(1806, 150, 620, 580),  # il lab di vetro
		"inbox": Vector2(2106, 790),  # fuori dalla porta del lab
		"desks": [
			{"rect": Rect2(1848, 228, 170, 78), "kind": "analisti_a", "facing": "down"},
			{"rect": Rect2(2132, 214, 170, 78), "kind": "analisti_b", "facing": "down"},
			{"rect": Rect2(1840, 402, 170, 78), "kind": "desk_a", "facing": "right"},
			{"rect": Rect2(2146, 392, 170, 78), "kind": "analisti_a", "facing": "down"},
			{"rect": Rect2(1852, 570, 170, 78), "kind": "analisti_b", "facing": "down"},
			{"rect": Rect2(2128, 562, 170, 78), "kind": "analisti_a", "facing": "down"},
		],
	},
	"scorer": {
		"name": "Scorer",
		"tagline": "Pesano il match profilo↔annuncio",
		"color": Color("#f5c518"),
		"zone": Rect2(1740, 960, 680, 470),
		"inbox": Vector2(1735, 1445),
		"desks": [
			{"rect": Rect2(1776, 1004, 170, 78), "kind": "scorer_a", "facing": "down"},
			{"rect": Rect2(2010, 986, 290, 110), "kind": "desk_wide", "facing": "down"},
			{"rect": Rect2(1770, 1238, 170, 78), "kind": "scorer_b", "facing": "down"},
			{"rect": Rect2(2012, 1230, 170, 78), "kind": "desk_c", "facing": "up"},
			{"rect": Rect2(2238, 1248, 170, 78), "kind": "scorer_a", "facing": "down"},
			{"rect": Rect2(1908, 1334, 170, 78), "kind": "desk_b", "facing": "up"},
		],
	},
	"scrittori": {
		"name": "Scrittori",
		"tagline": "Preparano CV e lettere su misura",
		"color": Color("#a855f7"),
		"zone": Rect2(320, 1480, 700, 430),
		"inbox": Vector2(1060, 1700),
		"desks": [
			{"rect": Rect2(352, 1524, 170, 78), "kind": "scrittori_a", "facing": "down"},
			{"rect": Rect2(586, 1512, 170, 78), "kind": "scrittori_b", "facing": "down"},
			{"rect": Rect2(816, 1530, 170, 78), "kind": "desk_f", "facing": "right"},
			{"rect": Rect2(346, 1758, 170, 78), "kind": "scrittori_a", "facing": "down"},
			{"rect": Rect2(580, 1746, 170, 78), "kind": "desk_e", "facing": "up"},
			{"rect": Rect2(812, 1764, 170, 78), "kind": "scrittori_b", "facing": "down"},
		],
	},
	"critici": {
		"name": "Critici",
		"tagline": "Revisionano ogni riga prima dell'invio",
		"color": Color("#ff4560"),
		"zone": Rect2(1740, 1480, 680, 430),
		"inbox": Vector2(1700, 1700),
		"desks": [
			{"rect": Rect2(1772, 1522, 170, 78), "kind": "critici_a", "facing": "down"},
			{"rect": Rect2(2004, 1510, 170, 78), "kind": "desk_c", "facing": "left"},
			{"rect": Rect2(2228, 1528, 170, 78), "kind": "critici_b", "facing": "down"},
			{"rect": Rect2(1766, 1756, 170, 78), "kind": "critici_a", "facing": "down"},
			{"rect": Rect2(2010, 1748, 170, 78), "kind": "critici_b", "facing": "down"},
			{"rect": Rect2(2224, 1766, 170, 78), "kind": "desk_d", "facing": "up"},
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
	# isola condivisa nel corridoio sud (tavolo lungo, 5 posti lato camera)
	"long_table": {"spot": Vector2(1400, 1660)},
}

## La catena del valore dei fogli: chi ritira dall'inbox di chi.
## (Gli Analisti passano dagli Scout a prendere il raccolto, ecc.
## Gli Scout non ritirano: producono — vanno in stampa più spesso.)
const FETCH_FROM := {
	"analisti": "scout",
	"scorer": "analisti",
	"scrittori": "scorer",
	"critici": "scrittori",
}

## Dove sta l'agente assegnato alla scrivania, coerente col verso del
## mobile (vedi convenzioni in testa).
static func desk_spot(desk: Dictionary) -> Vector2:
	var r: Rect2 = desk["rect"]
	match desk.get("facing", "down"):
		"up":
			return Vector2(r.get_center().x, r.end.y + 24)
		"left":
			return Vector2(r.end.x + 14, r.end.y + 6)
		"right":
			return Vector2(r.position.x - 14, r.end.y + 6)
		_:
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
