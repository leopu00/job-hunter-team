class_name FurnitureDefs
## Layout dell'ufficio (mondo 2560×1440), ispirato a web/public/the-box.png.
## Ogni voce: id univoco, kind (per il visual), rect in coordinate mondo.
## I rect sono anche gli ostacoli di collisione/navigazione.

## Espanso a SUD per i 5 reparti (M-reparti): la fila nord (lounge, coffee,
## lab) è invariata, le zone/scrivanie dei reparti vivono in DepartmentDefs.
const WORLD := Rect2(0, 0, 2560, 2140)
const FLOOR := Rect2(240, 140, 2200, 1860)

## Zona lab racchiusa da vetri interni (visual + collisioni sottili).
## Allungata a sud: il lab è la casa dei 6 Analisti (DepartmentDefs).
const LAB_WALL_V := Rect2(1794, 140, 12, 606)     # parete verticale
const LAB_WALL_H1 := Rect2(1794, 740, 262, 12)    # tratto sx della parete bassa
const LAB_WALL_H2 := Rect2(2156, 740, 284, 12)    # tratto dx (in mezzo: porta)

const ITEMS := [
	# ── Lounge (alto-sx): la zona del Mentor ──
	{"id": "sofa", "kind": "sofa", "rect": Rect2(330, 300, 300, 110)},
	{"id": "coffee_table", "kind": "table_low", "rect": Rect2(390, 480, 180, 80)},
	{"id": "armchair", "kind": "armchair", "rect": Rect2(690, 330, 110, 100)},
	{"id": "lamp", "kind": "lamp", "rect": Rect2(300, 214, 44, 44)},
	{"id": "plant_a", "kind": "plant", "rect": Rect2(630, 204, 56, 56)},

	# ── Parete alta: bacheca-indagine, libreria e angolo caffè ──
	{"id": "corkboard", "kind": "corkboard", "rect": Rect2(730, 150, 150, 34)},
	{"id": "bookshelf", "kind": "shelf_h", "rect": Rect2(950, 190, 280, 70)},
	{"id": "coffee_bar", "kind": "coffee", "rect": Rect2(1400, 190, 200, 80)},
	{"id": "water_cooler", "kind": "water_cooler", "rect": Rect2(1602, 196, 54, 54)},
	# stampante condivisa sulla parete nord, tra coffee e lab: la meta dei
	# viaggi "vado a stampare" di tutti i reparti (spot in DepartmentDefs).
	{"id": "printer", "kind": "printer", "rect": Rect2(1672, 190, 110, 78)},

	# ── Centro: l'ologramma della ricerca ──
	{"id": "hologram", "kind": "hologram", "rect": Rect2(1200, 700, 200, 180)},

	# ── Sinistra: lavagna score board + Coordinatore ──
	{"id": "blackboard", "kind": "blackboard", "rect": Rect2(252, 640, 56, 260)},
	{"id": "desk_coordinator", "kind": "desk", "rect": Rect2(430, 720, 230, 100)},
	{"id": "plant_c", "kind": "plant", "rect": Rect2(296, 930, 56, 56)},

	# ── Sala relax (fascia ovest, sotto la lounge): footprint per gli asset
	# amb_* di dev-art (rec_sofa/arcade/pingpong/kitchenette); il vetro
	# divisorio ha la porta verso il corridoio (gap 1140..1240).
	{"id": "rec_kitchenette", "kind": "kitchenette", "rect": Rect2(620, 1000, 230, 80)},
	{"id": "rec_sofa", "kind": "rec_sofa", "rect": Rect2(330, 1040, 260, 100)},
	{"id": "rec_bookshelf", "kind": "bookshelf_tall", "rect": Rect2(258, 1160, 56, 180)},
	{"id": "rec_arcade", "kind": "rec_arcade", "rect": Rect2(350, 1290, 84, 66)},
	{"id": "rec_pingpong", "kind": "rec_pingpong", "rect": Rect2(600, 1170, 240, 130)},
	{"id": "rec_glass_a", "kind": "glass_divider", "rect": Rect2(930, 980, 12, 160)},
	{"id": "rec_glass_b", "kind": "glass_divider", "rect": Rect2(930, 1240, 12, 160)},

	# ── Verde sparso (reparti e corridoi, mai sulla nav principale) ──
	{"id": "plant_palm_a", "kind": "plant_palm", "rect": Rect2(958, 1420, 56, 56)},
	{"id": "plant_monstera_a", "kind": "plant_monstera", "rect": Rect2(1712, 892, 56, 56)},
	{"id": "plant_shelf_a", "kind": "plant_shelf", "rect": Rect2(860, 186, 90, 50)},
	{"id": "plant_monstera_b", "kind": "plant_monstera", "rect": Rect2(2378, 764, 56, 56)},
	{"id": "plant_palm_b", "kind": "plant_palm", "rect": Rect2(1040, 1894, 56, 56)},
	{"id": "plant_monstera_c", "kind": "plant_monstera", "rect": Rect2(2384, 1444, 56, 56)},
	{"id": "plant_palm_c", "kind": "plant_palm", "rect": Rect2(302, 1436, 56, 56)},

	# ── Corridoio sud, tra Scrittori e Critici ──
	# isola condivisa: tavolo lungo da 5 posti (asset dev-art, facing down)
	{"id": "long_table", "kind": "long_table", "rect": Rect2(1100, 1510, 600, 110), "facing": "down"},
	{"id": "desk_assistant", "kind": "desk", "rect": Rect2(1180, 1740, 230, 100)},

	{"id": "plant_b", "kind": "plant", "rect": Rect2(2360, 1240, 56, 56)},
]
# Rimossi (i reparti hanno postazioni proprie in DepartmentDefs): lab_bench,
# lab_shelf, shelf_right, desk_scout, desk_pod, desk_scorer.

static func get_rect(id: String) -> Rect2:
	for item in ITEMS:
		if item["id"] == id:
			return item["rect"]
	push_error("FurnitureDefs: id sconosciuto " + id)
	return Rect2()

## Tutti gli ostacoli per collisioni e pathfinding.
static func obstacles() -> Array:
	var out: Array = []
	for item in ITEMS:
		out.append(item["rect"])
	out.append(LAB_WALL_V)
	out.append(LAB_WALL_H1)
	out.append(LAB_WALL_H2)
	return out
