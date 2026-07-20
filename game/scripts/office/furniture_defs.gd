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
	# ── Supporto operativo, lato OVEST degli Scorer ──
	# Il Mantenitore lavora a una console tecnica frontale: monitor, utensili,
	# ricambi e sedia sono un unico composito quando la postazione è occupata.
	{"id": "maintainer_workbench", "kind": "maintainer_workbench",
			# 215 px porta il corpo dipinto a ~127 px: la stessa altezza del
			# Dottore seduto. Centro e baseline restano invariati.
			"rect": Rect2(668, 960, 215, 93), "facing": "down",
			"registry_key": "core:mantenitore"},
	{"id": "maintainer_parts", "kind": "nc_boxes", "rect": Rect2(548, 1015, 72, 60)},
	{"id": "maintainer_cabinet", "kind": "nc_filing_cabinet", "rect": Rect2(910, 935, 58, 92)},

	# Il Dottore ha un'identità autonoma: poltrona clinica frontale (non il
	# Mentor), banco con strumenti e cassettiera. Anche qui seduta+agente
	# diventano un solo elemento grafico durante il lavoro.
	{"id": "doctor_lab_desk", "kind": "lab_bench", "rect": Rect2(490, 1190, 220, 90)},
	{"id": "doctor_drawers", "kind": "nc_drawer_unit", "rect": Rect2(712, 1265, 52, 68)},
	{"id": "doctor_armchair", "kind": "doctor_armchair",
			"rect": Rect2(780, 1230, 140, 133), "facing": "down",
			"registry_key": "core:dottore"},

	# ── Area comune (ex zona Scorer): lounge del Mentor ──
	{"id": "coffee_table", "kind": "table_low", "rect": Rect2(2410, 1195, 90, 45)},
	# Poltrona frontale, riportata alla scala originale dell'ufficio: 110 px,
	# come gli altri arredi individuali. L'arte occupata include Mentor+libro.
	# Il canvas contiene margini per le gambe: 140 px di rect producono una
	# sagoma effettiva di ~104 px, allineata alla scala degli agenti in piedi.
	{"id": "mentor_armchair", "kind": "mentor_armchair", "rect": Rect2(2655, 1117, 140, 133),
			"facing": "down", "registry_key": "core:mentor"},
	{"id": "lamp", "kind": "lamp", "rect": Rect2(2290, 1060, 44, 44)},
	{"id": "plant_a", "kind": "plant", "rect": Rect2(2440, 1035, 56, 56)},

	# Bacheca e libreria seguono la lounge.
	{"id": "corkboard", "kind": "corkboard", "rect": Rect2(2520, 995, 150, 34)},
	{"id": "bookshelf", "kind": "shelf_h", "rect": Rect2(2720, 970, 280, 70)},
	# Un solo elemento operativo sulla parete nord: la stampante condivisa.
	# Il nuovo sprite verticale sostituisce il vecchio blockout e tutto il
	# gruppo decorativo (bar, dispenser, scatole, cestino e orologio).
	# Scala reale: ~110 cm, circa due terzi dell'altezza di un agente. Il
	# gruppo è sulla parete nord, appena fuori dal varco orientale Scout.
	{"id": "printer", "kind": "printer", "rect": Rect2(1218, 185, 95, 70)},
	{"id": "plant_printer", "kind": "plant_palm", "rect": Rect2(1330, 190, 110, 100)},

	# ── Centro: l'ologramma della ricerca ──
	{"id": "hologram", "kind": "hologram", "rect": Rect2(1200, 700, 200, 180)},

	# ── Direzione, fascia nord: Capitano e Tesoriere guardano in camera ──
	{"id": "desk_coordinator", "kind": "captain_desk", "rect": Rect2(1365, 500, 260, 108),
			"facing": "down", "registry_key": "core:coordinatore"},
	# Il canvas del Budgeteer contiene una sagoma più piena: 280 px rendono
	# l'agente alto ~149 px, uguale ai ~150 px del Capitano. Centro e baseline
	# restano fermi, si riduce l'intero composito senza spostarlo.
	{"id": "desk_sentinella", "kind": "budgeteer_desk", "rect": Rect2(1765, 513, 280, 95),
			"facing": "down", "registry_key": "core:sentinella"},

	# ── Area comune: lavagna score board ──
	{"id": "blackboard", "kind": "blackboard", "rect": Rect2(3070, 1030, 56, 260)},
	{"id": "plant_c", "kind": "plant", "rect": Rect2(3030, 1340, 56, 56)},

	# ── Verde sparso (reparti e corridoi, mai sulla nav principale) ──
	# Fuori dalla proiezione del tavolo Scrittori → Critici e sopra la
	# vetrata: la chioma non deve più spuntare attraverso il piano.
	{"id": "plant_palm_a", "kind": "plant_palm", "rect": Rect2(760, 1370, 56, 56)},
	{"id": "plant_monstera_a", "kind": "plant_monstera", "rect": Rect2(2200, 820, 56, 56)},
	{"id": "plant_shelf_a", "kind": "plant_shelf", "rect": Rect2(2340, 960, 90, 50)},
	{"id": "plant_monstera_b", "kind": "plant_monstera", "rect": Rect2(2378, 764, 56, 56)},
	{"id": "plant_palm_b", "kind": "plant_palm", "rect": Rect2(1230, 1900, 56, 56)},
	# Lontana dal varco scorer: a y=1455 chiudeva il passaggio tra desk 5
	# e vetrata, isolando la postazione dalla componente A* principale.
	{"id": "plant_monstera_c", "kind": "plant_monstera", "rect": Rect2(3090, 1700, 56, 56)},
	{"id": "plant_palm_c", "kind": "plant_palm", "rect": Rect2(302, 1436, 56, 56)},

	# ── Reception all'uscita sud, tra Scrittori e Critici ──
	# La texture occupata integra Assistente+sedia+scrivania in un solo elemento
	# frontale; quando si alza resta visibile la stessa postazione vuota.
	{"id": "desk_assistant", "kind": "assistant_desk",
			"rect": Rect2(1550, 1800, 230, 100), "facing": "down",
			"registry_key": "core:assistente"},

	# Tavolino revisione sul bordo ovest: il centro dell'anello resta libero
	# per le sei sedie rivolte all'interno e per i viaggi della pipeline.
	{"id": "critici_center", "kind": "critici_center", "rect": Rect2(2160, 1840, 120, 100)},

	{"id": "plant_b", "kind": "plant", "rect": Rect2(1950, 860, 56, 56)},

	# ── Ciclo grafica 11/07: "aggiungete, aggiungete, aggiungete" ──
	# Props ufficio classico, kind nc_* (PNG in arrivo da dev-art con lo
	# stesso nome: si vestono da soli, intanto blockout).
	# Lavagne bianche: una per reparto, appoggiate alle vetrate/pareti.
	# La lavagna Scout è stata rimossa: copriva il tavolo Scout → Analisti e
	# rendeva il punto di consegna illeggibile dalla camera principale.
	{"id": "wb_analisti", "kind": "nc_whiteboard", "rect": Rect2(2340, 706, 150, 34)},
	{"id": "wb_scorer", "kind": "nc_whiteboard", "rect": Rect2(1640, 856, 150, 34)},
	{"id": "wb_scrittori", "kind": "nc_whiteboard", "rect": Rect2(380, 1414, 150, 34)},
	# Sul lato sud della vetrata: a y=1446 tagliava l'unica riga A* tra
	# scorer:5 e l'apertura occidentale della parete condivisa.
	{"id": "wb_critici", "kind": "nc_whiteboard", "rect": Rect2(2160, 1510, 150, 34)},
	# Scatoloni e schedari: l'ufficio vive
	{"id": "boxes_critici", "kind": "nc_boxes", "rect": Rect2(3060, 1920, 80, 66)},
	{"id": "boxes_scrittori", "kind": "nc_boxes", "rect": Rect2(1100, 1900, 80, 66)},
	{"id": "filing_lab", "kind": "nc_filing_cabinet", "rect": Rect2(3080, 250, 70, 110)},
	{"id": "filing_coord", "kind": "nc_filing_cabinet", "rect": Rect2(2950, 1175, 70, 110)},
	# Dettagli: appendiabiti all'entrata sud, cestini e cassettiere a fianco
	# delle scrivanie. La fascia nord della stampante resta intenzionalmente
	# pulita e leggibile.
	{"id": "coat_rack", "kind": "nc_coat_rack", "rect": Rect2(1500, 1780, 50, 50)},
	{"id": "bin_scout", "kind": "nc_waste_bin", "rect": Rect2(400, 778, 40, 40)},
	{"id": "drawer_scout", "kind": "nc_drawer_unit", "rect": Rect2(330, 758, 60, 72)},
	{"id": "drawer_scorer", "kind": "nc_drawer_unit", "rect": Rect2(940, 920, 60, 72)},
	# Fuori dall'anello radiale: a (774,1545) intersecava la postazione
	# Scrittori delle ore 12 e ne falsava collisione e lettura prospettica.
	{"id": "drawer_scrittori", "kind": "nc_drawer_unit", "rect": Rect2(250, 1840, 60, 72)},
	# in coda da dev-art (post-reset Codex): footprint già pronti
	{"id": "dartboard", "kind": "nc_dartboard", "rect": Rect2(254, 1010, 36, 36)},
	{"id": "wall_art", "kind": "nc_wall_art", "rect": Rect2(2040, 150, 90, 60)},
	{"id": "sideboard", "kind": "nc_sideboard", "rect": Rect2(1830, 1815, 180, 70)},
]
# Rimossi dal layout: sofa e sala relax; i reparti hanno postazioni proprie
# in DepartmentDefs (lab_bench, lab_shelf, shelf_right, desk_scout, desk_pod,
# desk_scorer).

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
