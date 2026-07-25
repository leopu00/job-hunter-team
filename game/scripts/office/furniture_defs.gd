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

const ITEMS := [
	# ── Supporto operativo, lato OVEST degli Scorer ──
	# Il Mantenitore lavora a una console tecnica frontale: monitor, utensili,
	# ricambi e sedia sono un unico composito quando la postazione è occupata.
	{"id": "maintainer_workbench", "kind": "maintainer_workbench",
			# Ingrandita rispetto ai ricambi: la console deve restare chiaramente
			# il mobile principale, mentre le scatole sono un accessorio minuto.
			"rect": Rect2(580, 900, 245, 106), "facing": "down",
			"registry_key": "core:mantenitore"},
	{"id": "maintainer_parts", "kind": "nc_boxes", "rect": Rect2(510, 930, 45, 38)},
	{"id": "maintainer_cabinet", "kind": "nc_filing_cabinet", "rect": Rect2(980, 875, 58, 92)},

	# Il Dottore ha un'identità autonoma: poltrona clinica frontale (non il
	# Mentor), banco con strumenti e cassettiera. Anche qui seduta+agente
	# diventano un solo elemento grafico durante il lavoro.
	{"id": "doctor_lab_desk", "kind": "lab_bench", "rect": Rect2(490, 1160, 220, 90)},
	{"id": "doctor_drawers", "kind": "nc_drawer_unit", "rect": Rect2(720, 1182, 52, 68)},
	{"id": "doctor_armchair", "kind": "doctor_armchair",
			"rect": Rect2(780, 1200, 140, 133), "facing": "down",
			"registry_key": "core:dottore"},

	# ── Area comune (ex zona Scorer): lounge del Mentor ──
	{"id": "coffee_table", "kind": "table_low", "rect": Rect2(2410, 1195, 90, 45)},
	# Poltrona frontale, riportata alla scala originale dell'ufficio: 110 px,
	# come gli altri arredi individuali. L'arte occupata include Mentor+libro.
	# Il canvas contiene margini per le gambe: 140 px di rect producono una
	# sagoma effettiva di ~104 px, allineata alla scala degli agenti in piedi.
	{"id": "mentor_armchair", "kind": "mentor_armchair", "rect": Rect2(2760, 1117, 140, 133),
			"facing": "down", "registry_key": "core:mentor"},
	{"id": "lamp", "kind": "lamp", "rect": Rect2(2700, 1090, 44, 44)},
	{"id": "plant_a", "kind": "plant", "rect": Rect2(2750, 1035, 56, 56)},

	# La bacheca è appesa alla vetrata (nessuna collisione sul pavimento); la
	# libreria più larga dà peso alla parete della lounge.
	{"id": "corkboard", "kind": "corkboard", "rect": Rect2(2990, 865, 150, 34),
			"non_blocking": true},
	{"id": "bookshelf", "kind": "shelf_h", "rect": Rect2(2580, 950, 360, 90)},
	# Un solo elemento operativo sulla parete nord: la stampante condivisa.
	# Il nuovo sprite verticale sostituisce il vecchio blockout e tutto il
	# gruppo decorativo (bar, dispenser, scatole, cestino e orologio).
	# Scala reale: ~110 cm, circa due terzi dell'altezza di un agente. Il
	# gruppo è sulla parete nord, appena fuori dal varco orientale Scout.
	{"id": "printer", "kind": "printer", "rect": Rect2(1218, 185, 95, 70)},
	{"id": "plant_printer", "kind": "plant_palm", "rect": Rect2(1330, 190, 110, 100)},

	# ── Centro del tappeto Scout: l'ologramma della ricerca ──
	# L'asse X coincide col tappeto; l'asse Y è rialzato per centrare la base
	# luminosa sull'ornamento prospettico, che visivamente cade sopra il centro.
	{"id": "hologram", "kind": "hologram", "rect": Rect2(675, 435, 200, 180)},

	# ── Direzione, fascia nord: Capitano e Tesoriere guardano in camera ──
	{"id": "desk_coordinator", "kind": "captain_desk", "rect": Rect2(1365, 455, 260, 108),
			"facing": "down", "registry_key": "core:coordinatore"},
	# Il canvas del Budgeteer contiene una sagoma più piena: 280 px rendono
	# l'agente alto ~149 px, uguale ai ~150 px del Capitano. Centro e baseline
	# restano fermi, si riduce l'intero composito senza spostarlo.
	{"id": "desk_sentinella", "kind": "budgeteer_desk", "rect": Rect2(1765, 513, 280, 95),
			"facing": "down", "registry_key": "core:sentinella"},

	# ── Area comune: lavagna score board ──
	{"id": "blackboard", "kind": "blackboard", "rect": Rect2(2950, 1050, 56, 260)},
	{"id": "plant_c", "kind": "plant", "rect": Rect2(3030, 1340, 56, 56)},

	# ── Verde sparso (reparti e corridoi, mai sulla nav principale) ──
	# Fuori dalla proiezione del tavolo Scrittori → Critici e sopra la
	# vetrata: la chioma non deve più spuntare attraverso il piano.
	{"id": "plant_palm_a", "kind": "plant_palm", "rect": Rect2(760, 1370, 56, 56)},
	{"id": "plant_monstera_a", "kind": "plant_monstera", "rect": Rect2(2765, 235, 56, 56)},
	{"id": "plant_shelf_a", "kind": "plant_shelf", "rect": Rect2(2470, 960, 90, 50)},
	{"id": "plant_monstera_b", "kind": "plant_monstera", "rect": Rect2(2225, 250, 56, 56)},
	# A destra della postazione assistente Scrittori, senza invadere la credenza.
	{"id": "plant_palm_b", "kind": "plant_palm", "rect": Rect2(1790, 1725, 56, 56)},
	# Nell'angolo nord-est dei Critici, vicino all'incontro tra vetrata e bordo.
	{"id": "plant_monstera_c", "kind": "plant_monstera", "rect": Rect2(3080, 1515, 56, 56)},
	{"id": "plant_palm_c", "kind": "plant_palm", "rect": Rect2(302, 1436, 56, 56)},

	# ── Reception all'uscita sud, tra Scrittori e Critici ──
	# La texture occupata integra Assistente+sedia+scrivania in un solo elemento
	# frontale; quando si alza resta visibile la stessa postazione vuota.
	{"id": "desk_assistant", "kind": "assistant_desk",
			"rect": Rect2(1550, 1800, 230, 100), "facing": "down",
			"registry_key": "core:assistente"},

	# Tavolino revisione sul bordo ovest: il centro dell'anello resta libero
	# per le sei sedie rivolte all'interno e per i viaggi della pipeline.
	{"id": "critici_center", "kind": "critici_center", "rect": Rect2(2107.5, 1877.5, 75, 62.5)},

	{"id": "plant_b", "kind": "plant", "rect": Rect2(1950, 860, 56, 56)},

	# ── Ciclo grafica 11/07: "aggiungete, aggiungete, aggiungete" ──
	# Props ufficio classico, kind nc_* (PNG in arrivo da dev-art con lo
	# stesso nome: si vestono da soli, intanto blockout).
	# Lavagne bianche: una per reparto, appoggiate alle vetrate/pareti.
	# La lavagna Scout è stata rimossa: copriva il tavolo Scout → Analisti e
	# rendeva il punto di consegna illeggibile dalla camera principale.
	# Le due lavagne prima sparse tra Analisti e Scorer ora incorniciano la
	# postazione del Capitano dalla parete nord. La seconda è specchiata per
	# evitare l'effetto copia-incolla e mantenere il centro visivo libero.
	{"id": "wb_analisti", "kind": "nc_whiteboard", "rect": Rect2(1255, 400, 150, 34)},
	{"id": "wb_scorer", "kind": "nc_whiteboard", "rect": Rect2(1585, 400, 150, 34),
			"flip_h": true},
	{"id": "wb_scrittori", "kind": "nc_whiteboard", "rect": Rect2(290, 1160, 150, 34)},
	# Scatoloni ridotti alla scala degli agenti e schedario della lounge.
	{"id": "boxes_critici", "kind": "nc_boxes", "rect": Rect2(3000, 1945, 50, 41)},
	{"id": "boxes_scrittori", "kind": "nc_boxes", "rect": Rect2(1115, 1925, 50, 41)},
	{"id": "filing_coord", "kind": "nc_filing_cabinet", "rect": Rect2(2445, 910, 70, 110)},
	# Dettagli: appendiabiti all'entrata sud, cestini e cassettiere a fianco
	# delle scrivanie. La fascia nord della stampante resta intenzionalmente
	# pulita e leggibile.
	{"id": "coat_rack", "kind": "nc_coat_rack", "rect": Rect2(1500, 1780, 50, 50)},
	{"id": "bin_scout", "kind": "nc_waste_bin", "rect": Rect2(1175, 215, 26, 26)},
	{"id": "drawer_scout", "kind": "nc_drawer_unit", "rect": Rect2(605, 640, 42, 50)},
	# Cassettiera degli Scrittori, a destra della lavagna e fuori dal tappeto.
	{"id": "drawer_scrittori", "kind": "nc_drawer_unit", "rect": Rect2(380, 1425, 60, 72)},
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
		if not bool(item.get("non_blocking", false)):
			out.append(item["rect"])
	return out
