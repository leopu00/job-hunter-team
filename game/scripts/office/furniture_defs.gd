class_name FurnitureDefs
## Layout dell'ufficio (mondo 2560×1440), ispirato a web/public/the-box.png.
## Ogni voce: id univoco, kind (per il visual), rect in coordinate mondo.
## I rect sono anche gli ostacoli di collisione/navigazione.

const WORLD := Rect2(0, 0, 2560, 1440)
const FLOOR := Rect2(240, 140, 2200, 1190)

## Zona lab racchiusa da vetri interni (visual + collisioni sottili).
const LAB_WALL_V := Rect2(1794, 140, 12, 460)     # parete verticale
const LAB_WALL_H1 := Rect2(1794, 594, 262, 12)    # tratto sx della parete bassa
const LAB_WALL_H2 := Rect2(2156, 594, 284, 12)    # tratto dx (in mezzo: porta)

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
	{"id": "water_cooler", "kind": "water_cooler", "rect": Rect2(1625, 196, 54, 54)},
	{"id": "plant_c", "kind": "plant", "rect": Rect2(1700, 204, 56, 56)},

	# ── Lab (alto-dx, dentro i vetri): l'Analista ──
	{"id": "lab_bench", "kind": "lab_bench", "rect": Rect2(1950, 330, 330, 110)},
	{"id": "lab_shelf", "kind": "shelf_v", "rect": Rect2(2330, 200, 60, 220)},

	# ── Centro: l'ologramma della ricerca ──
	{"id": "hologram", "kind": "hologram", "rect": Rect2(1200, 700, 200, 180)},

	# ── Sinistra: lavagna score board + Coordinatore ──
	{"id": "blackboard", "kind": "blackboard", "rect": Rect2(252, 640, 56, 260)},
	{"id": "desk_coordinator", "kind": "desk", "rect": Rect2(430, 720, 230, 100)},

	# ── Basso-sx: l'Assistente vicino all'entrata ──
	{"id": "desk_assistant", "kind": "desk", "rect": Rect2(480, 1120, 230, 100)},

	# ── Basso-centro: pod Scout ──
	{"id": "desk_scout", "kind": "desk", "rect": Rect2(1080, 1060, 250, 110)},
	{"id": "desk_pod", "kind": "desk", "rect": Rect2(1450, 1060, 250, 110)},

	# ── Destra: postazione Scorer col monitor curvo ──
	{"id": "desk_scorer", "kind": "desk_wide", "rect": Rect2(1980, 1000, 320, 120)},
	{"id": "shelf_right", "kind": "shelf_v", "rect": Rect2(2340, 680, 60, 230)},
	{"id": "plant_b", "kind": "plant", "rect": Rect2(2360, 1240, 56, 56)},
]

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
