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
## Il pavimento è largo (240,140→3160,2000, vedi FurnitureDefs) e le
## DISPOSIZIONI: ogni reparto usa lo stesso anello a sei spicchi validato
## per gli Scrittori. Le sedie sono sempre sul lato INTERNO del tappeto e
## gli agenti guardano verso l'esterno (ore 12/2/4/6/8/10). Gli indici
## restano nello stesso ordine storico 10/8/12/6/2/4, così il desk assegnato
## a ciascun UID non cambia quando il backend reale ricostruisce il roster.
## Catena del valore: Scout → Analisti → Scorer → Scrittori → Critici.

const DEPT_ORDER := ["scout", "analisti", "scorer", "scrittori", "critici"]
const HANDOFF_DEPTS := ["scout", "analisti", "scorer", "scrittori"]
# Ingombro A* delle GAMBE, non dell'intera illustrazione alta 145 px. Usare
# tutto il canvas saldava i tavoli a vetrate e desk vicini, creando muri
# invisibili e deviazioni enormi pur con molto pavimento libero davanti.
const HANDOFF_SIZE := Vector2(190, 60)

const DEPARTMENTS := {
	"scout": {
		"name": "Research",
		"tagline": "Finds relevant opportunities for you.",
		"color": Color("#00e87a"),
		"zone": Rect2(320, 348, 880, 520),
		# Tavolo Scout → Analisti: più vicino all'ologramma e appena più in
		# alto, ma senza toccarne l'ingombro. Il ritiro avviene dal basso.
		"inbox": Vector2(1080, 800),
		# Gli Scout consegnano dal fianco destro, in asse con la porta est;
		# gli Analisti ritirano dal basso attraverso la porta sud.
		"inbox_drop_access": Vector2(1240, 800),
		"inbox_pickup_access": Vector2(1100, 920),
		# Anello radiale nell'angolo nord-ovest; indice 0..5 = ore 10,8,12,6,2,4.
		"desks": [
			{"rect": Rect2(384, 400, 170, 78), "kind": "scout_a", "facing": "left", "tex_facing": "left", "seat_offset": Vector2(-26, -2), "seated_art": "res://assets/gen-art/furniture/occupied/scout_b_side_seated_v3.png"},
			{"rect": Rect2(426, 616, 170, 78), "kind": "scout_a", "facing": "left", "tex_facing": "down_left", "seat_offset": Vector2(-41, -71)},
			{"rect": Rect2(690, 346, 170, 78), "kind": "scout_a", "facing": "up", "tex_facing": "up", "seated_art": "res://assets/gen-art/furniture/occupied/scout_c_up_seated_v3.png"},
			{"rect": Rect2(690, 689, 170, 78), "kind": "scout_a", "facing": "down", "tex_facing": "down", "integrated_chair": true, "front_occlusion": 0.72, "seated_art": "res://assets/gen-art/furniture/occupied/scout_d_down_seated_v3.png"},
			# Arretrate dal vetro est: prima il margine delle sedie invadeva il
			# varco e costringeva gli Scout a tagliare tutto il tappeto.
			{"rect": Rect2(956, 400, 170, 78), "kind": "scout_a", "facing": "right", "tex_facing": "right", "seat_offset": Vector2(26, -2), "seated_art": "res://assets/gen-art/furniture/occupied/scout_e_side_seated_v3.png"},
			# Sollevata di 56 px: prima desk e tavolo di consegna si saldavano
			# con i rispettivi margini nav e chiudevano la corsia orientale.
			{"rect": Rect2(914, 560, 170, 78), "kind": "scout_a", "facing": "right", "tex_facing": "down_right", "seat_offset": Vector2(41, -71), "seated_art": "res://assets/gen-art/furniture/occupied/scout_f_diag_down_seated_v3.png"},
		],
	},
	"analisti": {
		"name": "Analysis",
		"tagline": "Turns listings into clear decisions.",
		"color": Color("#4d9fff"),
		"zone": Rect2(2232, 150, 848, 580),  # lab rientrato dal bordo est
		# Più vicino alle scrivanie, ma spostato a destra del varco centrale:
		# salire in asse col portale isolerebbe nuovamente il laboratorio.
		"inbox": Vector2(2800, 850),
		"inbox_drop_access": Vector2(2640, 850),
		"inbox_pickup_access": Vector2(2960, 850),
		# Anello radiale allargato insieme al tappeto: riempie il laboratorio
		# senza toccare vetri, schedario o varco meridionale.
		"desks": [
			# Cinquanta pixel più interne: il fianco delle sedie non invade più
			# la porta ovest usata per il ritiro dal reparto Ricerca.
			{"rect": Rect2(2336, 278, 170, 78), "kind": "analisti_a", "facing": "left", "tex_facing": "left", "seat_offset": Vector2(-26, -2), "seated_art": "res://assets/gen-art/furniture/occupied/analisti_b_side_seated_v3.png"},
			{"rect": Rect2(2365, 480, 170, 78), "kind": "analisti_a", "facing": "left", "tex_facing": "down_left", "seat_offset": Vector2(-41, -71)},
			{"rect": Rect2(2570, 227, 170, 78), "kind": "analisti_a", "facing": "up", "tex_facing": "up", "seated_art": "res://assets/gen-art/furniture/occupied/analisti_c_up_seated_v3.png"},
			{"rect": Rect2(2570, 548, 170, 78), "kind": "analisti_a", "facing": "down", "tex_facing": "down", "integrated_chair": true, "front_occlusion": 0.72, "seated_art": "res://assets/gen-art/furniture/occupied/analisti_d_down_seated_v3.png"},
			{"rect": Rect2(2854, 278, 170, 78), "kind": "analisti_a", "facing": "right", "tex_facing": "right", "seat_offset": Vector2(26, -2), "seated_art": "res://assets/gen-art/furniture/occupied/analisti_e_side_seated_v3.png"},
			{"rect": Rect2(2825, 480, 170, 78), "kind": "analisti_a", "facing": "right", "tex_facing": "down_right", "seat_offset": Vector2(41, -71), "seated_art": "res://assets/gen-art/furniture/occupied/analisti_f_diag_down_seated_v3.png"},
		],
	},
	"scorer": {
		"name": "Compatibility",
		"tagline": "Gauges how well each role fits you.",
		"color": Color("#f5c518"),
		"zone": Rect2(1140, 840, 1120, 640),
		# Tavolo Scorer → Scrittori al centro esatto del nuovo tappeto. Gli
		# accessi laterali evitano sia il desk ore 6 sia le pile sul piano.
		"inbox": Vector2(1700, 1120),
		"inbox_drop_access": Vector2(1550, 1120),
		"inbox_pickup_access": Vector2(1850, 1120),
		# Anello ampliato e centrato sull'asse dell'intero ufficio.
		"desks": [
			# scorer_a_side nasce con la sedia a sinistra, al contrario degli
			# altri reparti: scambiamo solo il verso della texture laterale.
			{"rect": Rect2(1263, 942, 170, 78), "kind": "scorer_a", "facing": "left", "tex_facing": "right", "seat_offset": Vector2(-26, -2), "seated_art": "res://assets/gen-art/furniture/occupied/scorer_b_side_seated_v3.png"},
			{"rect": Rect2(1312, 1190, 170, 78), "kind": "scorer_a", "facing": "left", "tex_facing": "down_left", "seat_offset": Vector2(-41, -71)},
			{"rect": Rect2(1615, 880, 170, 78), "kind": "scorer_a", "facing": "up", "tex_facing": "up", "seated_art": "res://assets/gen-art/furniture/occupied/scorer_c_up_seated_v3.png"},
			{"rect": Rect2(1615, 1274, 170, 78), "kind": "scorer_a", "facing": "down", "tex_facing": "down", "integrated_chair": true, "front_occlusion": 0.78, "seated_art": "res://assets/gen-art/furniture/occupied/scorer_d_down_seated_v3.png"},
			{"rect": Rect2(1967, 942, 170, 78), "kind": "scorer_a", "facing": "right", "tex_facing": "left", "seat_offset": Vector2(26, -2), "seated_art": "res://assets/gen-art/furniture/occupied/scorer_e_side_seated_v3.png"},
			{"rect": Rect2(1918, 1190, 170, 78), "kind": "scorer_a", "facing": "right", "tex_facing": "down_right", "seat_offset": Vector2(41, -71), "seated_art": "res://assets/gen-art/furniture/occupied/scorer_f_diag_down_seated_v3.png"},
		],
	},
	"scrittori": {
		"name": "Applications",
		"tagline": "Tailors each application to you and the role.",
		"color": Color("#a855f7"),
		"zone": Rect2(320, 1520, 860, 440),
		# Tavolo Scrittori → Critici riportato verso il reparto Scrittori,
		# lasciando comunque un varco netto dalla vetrata verticale.
		"inbox": Vector2(1080, 1560),
		# Dentro la porta orientale, ma sotto il margine della vetrata nord.
		"inbox_drop_access": Vector2(1100, 1625),
		"inbox_pickup_access": Vector2(1250, 1560),
		# Sei spicchi radiali sul tappeto, come un quadrante d'orologio.
		# Ogni agente guarda verso l'ESTERNO: ore 12=schiena, ore 6=viso,
		# i quattro intermedi usano le viste laterali disponibili. Gli indici
		# storici restano nello stesso spicchio (in particolare desk 3, usata
		# da Scrittore 4, resta alle ore 6) per non spostare gli UID live.
		"desks": [
			# indice 0..5 = ore 10, 8, 12, 6, 2, 4
			{"rect": Rect2(345, 1584, 170, 78), "kind": "scrittori_a", "facing": "left", "tex_facing": "left", "seat_offset": Vector2(-26, -2), "seated_art": "res://assets/gen-art/furniture/occupied/scrittori_b_side_seated_v3.png"},
			# Sollevata di 48 px: fra il retro della sedia e il vetro sud
			# rimane ora una corsia completa, non una tasca A* senza uscita.
			{"rect": Rect2(380, 1720, 170, 78), "kind": "scrittori_a", "facing": "left", "tex_facing": "down_left", "seat_offset": Vector2(-41, -71), "seated_art": "res://assets/gen-art/furniture/scrittori_a_diag_down_seated_v2.png"},
			# Le postazioni 12/6 rientrano entrambe sul tappeto mantenendo
			# l'asse verticale e la vista retro/frontale richiesta.
			{"rect": Rect2(605, 1538, 170, 78), "kind": "scrittori_a", "facing": "up", "tex_facing": "up", "seated_art": "res://assets/gen-art/furniture/occupied/scrittori_c_up_seated_v3.png"},
			{"rect": Rect2(605, 1830, 170, 78), "kind": "scrittori_a", "facing": "down", "tex_facing": "down", "integrated_chair": true, "front_occlusion": 0.62, "seated_art": "res://assets/gen-art/furniture/occupied/scrittori_d_down_seated_v3.png"},
			{"rect": Rect2(865, 1584, 170, 78), "kind": "scrittori_a", "facing": "right", "tex_facing": "right", "seat_offset": Vector2(26, -2), "seated_art": "res://assets/gen-art/furniture/occupied/scrittori_e_side_seated_v3.png"},
			{"rect": Rect2(830, 1768, 170, 78), "kind": "scrittori_a", "facing": "right", "tex_facing": "down_right", "seat_offset": Vector2(41, -71), "seated_art": "res://assets/gen-art/furniture/occupied/scrittori_f_diag_down_seated_v3.png"},
		],
	},
	"critici": {
		"name": "Quality check",
		"tagline": "Reviews every detail before you decide.",
		"color": Color("#ff4560"),
		"zone": Rect2(2075, 1520, 1010, 440),
		"inbox": Vector2(3025, 1820),  # deposito sul bordo est, fuori dall'anello
		"inbox_access": Vector2(3055, 1755),
		# Anello radiale con il centro sgombro per sedie, corpi e percorsi.
		"desks": [
			{"rect": Rect2(2234, 1580, 170, 78), "kind": "critici_a", "facing": "left", "tex_facing": "left", "seat_offset": Vector2(-26, -2)},
			{"rect": Rect2(2276, 1796, 170, 78), "kind": "critici_a", "facing": "left", "tex_facing": "down_left", "seat_offset": Vector2(-41, -71), "seated_art": "res://assets/gen-art/furniture/occupied/critici_b_diag_down_seated_v3.png"},
			{"rect": Rect2(2540, 1526, 170, 78), "kind": "critici_a", "facing": "up", "tex_facing": "up", "seated_art": "res://assets/gen-art/furniture/occupied/critici_c_up_seated_v3.png"},
			{"rect": Rect2(2540, 1815, 170, 78), "kind": "critici_a", "facing": "down", "tex_facing": "down", "integrated_chair": true, "front_occlusion": 0.80, "seated_art": "res://assets/gen-art/furniture/occupied/critici_d_down_seated_v3.png"},
			{"rect": Rect2(2846, 1580, 170, 78), "kind": "critici_a", "facing": "right", "tex_facing": "right", "seat_offset": Vector2(26, -2), "seated_art": "res://assets/gen-art/furniture/occupied/critici_e_side_seated_v3.png"},
			{"rect": Rect2(2804, 1796, 170, 78), "kind": "critici_a", "facing": "right", "tex_facing": "down_right", "seat_offset": Vector2(41, -71), "seated_art": "res://assets/gen-art/furniture/occupied/critici_f_diag_down_seated_v3.png"},
		],
	},
}

## Vetrate interne scelte sulla planimetria completa dell'ufficio. Sono solo
## segmenti orizzontali: l'assenza di un segmento equivale esplicitamente ad
## assenza di vetro. Il footprint da 12 px è centrato sulla linea annotata.
const GLASS_WALLS := [
	# Fascia nord: Ricerca, direzione e Analisi.
	Rect2(242.0, 206.5, 984.0, 12.0),
	Rect2(1406.5, 282.0, 613.5, 12.0),
	Rect2(2236.5, 182.5, 925.5, 12.0),
	# Fascia centrale: bordi inferiori Ricerca/Analisi e bordo nord Scorer.
	Rect2(242.0, 861.5, 816.0, 12.0),
	Rect2(1366.0, 826.5, 684.0, 12.0),
	Rect2(2347.0, 893.5, 821.0, 12.0),
	# Separazione orizzontale dell'area operativa occidentale.
	Rect2(241.0, 1142.5, 807.5, 12.0),
	# Uscita sud dello Scorer: il vuoto fra i due tratti è la porta.
	Rect2(1240.0, 1389.0, 343.0, 12.0),
	Rect2(1809.5, 1389.0, 375.0, 12.0),
	# Bordi superiori dei due reparti meridionali.
	Rect2(240.0, 1462.5, 798.0, 12.0),
	Rect2(2308.5, 1484.0, 856.0, 12.0),
	# Bordi inferiori dei due reparti meridionali.
	Rect2(318.0, 1946.0, 857.5, 12.0),
	Rect2(2074.5, 1951.0, 956.5, 12.0),
]

## POI condivisi dei behavior: mete dei viaggi "si vede che lavorano".
## "spot" = dove l'agente si ferma (punto camminabile davanti al prop).
const POIS := {
	"printer": {"rect": Rect2(1218, 185, 95, 70), "spot": Vector2(1265, 300)},
	# Lato ovest del globo, nel corridoio libero tra le scrivanie Scout.
	"hologram": {"spot": Vector2(625, 560)},
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

## Il layout cade in inglese quando manca una chiave: e' la lingua di default
## del gioco e impedisce che una targa italiana riaffiori in una ripresa. Ogni
## superficie visibile passa comunque da UIStrings quando esiste una scelta.
static func display_name(dept_id: String) -> String:
	return _localized(dept_id, "name")


static func display_tagline(dept_id: String) -> String:
	return _localized(dept_id, "tagline")


static func _localized(dept_id: String, field: String) -> String:
	var fallback := str(DEPARTMENTS.get(dept_id, {}).get(field, dept_id))
	var key := "dept.%s.%s" % [dept_id, field]
	var translated := UIStrings.t(key)
	return fallback if translated == key else translated

## Punto camminabile davanti alla pila. La pila resta ferma e leggibile:
## l'agente si affianca alla vaschetta invece di attraversarla o coprirla.
static func handoff_spot(dept_id: String, pickup := false) -> Vector2:
	var def: Dictionary = DEPARTMENTS[dept_id]
	var key := "inbox_pickup_access" if pickup else "inbox_drop_access"
	return def.get(key, def.get("inbox_access", def["inbox"]))

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
	# Gli agenti si fermano al punto d'accesso e non attraversano i tavoli di
	# consegna: la sagoma entra nella stessa griglia A* delle scrivanie.
	for dept_id in HANDOFF_DEPTS:
		var base: Vector2 = DEPARTMENTS[dept_id]["inbox"]
		out.append(Rect2(base - Vector2(HANDOFF_SIZE.x / 2.0, HANDOFF_SIZE.y),
				HANDOFF_SIZE))
	return out

## Il reparto sotto un punto del mondo ("" se nessuno). Per il click.
static func department_at(point: Vector2) -> String:
	for dept_id in DEPT_ORDER:
		if (DEPARTMENTS[dept_id]["zone"] as Rect2).has_point(point):
			return dept_id
	return ""
