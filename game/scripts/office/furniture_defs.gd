class_name FurnitureDefs
## Layout dell'ufficio (mondo 2560×1440), ispirato a web/public/the-box.png.
## Ogni voce: id univoco, kind (per il visual), rect in coordinate mondo.
## I rect sono anche gli ostacoli di collisione/navigazione.

## Espanso a SUD per i 5 reparti e a EST per il layout largo (feedback
## live 11/07: "allargate l'ufficio"): la fila nord è invariata, le
## zone/scrivanie dei reparti vivono in DepartmentDefs. Il margine NORD
## sale a -420: fascia cielo per lo skyline esterno (DayNight).
const WORLD := Rect2(0, -420, 3400, 2560)
const FLOOR := Rect2(240, 140, 2920, 1860)

## Zona lab racchiusa da vetri interni (visual + collisioni sottili).
## Spostato all'angolo NE del pavimento largo: casa dei 6 Analisti.
const LAB_WALL_V := Rect2(2300, 140, 12, 606)     # parete verticale
const LAB_WALL_H1 := Rect2(2300, 740, 330, 12)    # tratto sx della parete bassa
const LAB_WALL_H2 := Rect2(2750, 740, 410, 12)    # tratto dx (in mezzo: porta)

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
	{"id": "plant_monstera_a", "kind": "plant_monstera", "rect": Rect2(2200, 820, 56, 56)},
	{"id": "plant_shelf_a", "kind": "plant_shelf", "rect": Rect2(860, 186, 90, 50)},
	{"id": "plant_monstera_b", "kind": "plant_monstera", "rect": Rect2(2378, 764, 56, 56)},
	{"id": "plant_palm_b", "kind": "plant_palm", "rect": Rect2(1230, 1900, 56, 56)},
	{"id": "plant_monstera_c", "kind": "plant_monstera", "rect": Rect2(3090, 1455, 56, 56)},
	{"id": "plant_palm_c", "kind": "plant_palm", "rect": Rect2(302, 1436, 56, 56)},

	# ── Corridoio sud, tra Scrittori e Critici ──
	{"id": "desk_assistant", "kind": "desk", "rect": Rect2(1550, 1800, 230, 100)},

	# tavolino revisione al centro dell'anello dei Critici (dado=6)
	{"id": "critici_center", "kind": "critici_center", "rect": Rect2(2590, 1690, 120, 100)},

	{"id": "plant_b", "kind": "plant", "rect": Rect2(1950, 860, 56, 56)},

	# ── Ciclo grafica 11/07: "aggiungete, aggiungete, aggiungete" ──
	# Props ufficio classico, kind nc_* (PNG in arrivo da dev-art con lo
	# stesso nome: si vestono da soli, intanto blockout).
	# Lavagne bianche: una per reparto, appoggiate alle vetrate/pareti.
	{"id": "wb_scout", "kind": "nc_whiteboard", "rect": Rect2(1640, 856, 150, 34)},
	{"id": "wb_analisti", "kind": "nc_whiteboard", "rect": Rect2(2340, 706, 150, 34)},
	{"id": "wb_scorer", "kind": "nc_whiteboard", "rect": Rect2(2050, 1446, 150, 34)},
	{"id": "wb_scrittori", "kind": "nc_whiteboard", "rect": Rect2(380, 1414, 150, 34)},
	{"id": "wb_critici", "kind": "nc_whiteboard", "rect": Rect2(2800, 1446, 150, 34)},
	# Sala relax: calcio balilla accanto al ping-pong (reference)
	{"id": "rec_foosball", "kind": "nc_foosball", "rect": Rect2(430, 1165, 150, 90)},
	# Scatoloni e schedari: l'ufficio vive
	{"id": "boxes_printer", "kind": "nc_boxes", "rect": Rect2(1800, 200, 80, 66)},
	{"id": "boxes_critici", "kind": "nc_boxes", "rect": Rect2(3060, 1900, 80, 66)},
	{"id": "boxes_scrittori", "kind": "nc_boxes", "rect": Rect2(1100, 1900, 80, 66)},
	{"id": "filing_lab", "kind": "nc_filing_cabinet", "rect": Rect2(3080, 250, 70, 110)},
	{"id": "filing_coord", "kind": "nc_filing_cabinet", "rect": Rect2(680, 700, 70, 110)},
	# Dettagli: appendiabiti all'entrata sud, orologio a muro, cestini,
	# cassettiere a fianco delle scrivanie
	{"id": "coat_rack", "kind": "nc_coat_rack", "rect": Rect2(1500, 1780, 50, 50)},
	{"id": "wall_clock", "kind": "nc_wall_clock", "rect": Rect2(1260, 150, 60, 60)},
	{"id": "bin_printer", "kind": "nc_waste_bin", "rect": Rect2(1640, 250, 40, 40)},
	{"id": "bin_scout", "kind": "nc_waste_bin", "rect": Rect2(1240, 1120, 40, 40)},
	{"id": "drawer_scout", "kind": "nc_drawer_unit", "rect": Rect2(1214, 1092, 60, 72)},
	{"id": "drawer_scorer", "kind": "nc_drawer_unit", "rect": Rect2(2100, 1058, 60, 72)},
	{"id": "drawer_scrittori", "kind": "nc_drawer_unit", "rect": Rect2(774, 1545, 60, 72)},
	# in coda da dev-art (post-reset Codex): footprint già pronti
	{"id": "dartboard", "kind": "nc_dartboard", "rect": Rect2(254, 1010, 36, 36)},
	{"id": "wall_art", "kind": "nc_wall_art", "rect": Rect2(2040, 150, 90, 60)},
	{"id": "sideboard", "kind": "nc_sideboard", "rect": Rect2(1830, 1815, 180, 70)},
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
