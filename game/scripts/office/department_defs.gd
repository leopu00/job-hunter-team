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

const DEPARTMENTS := {
	"scout": {
		"name": "Scout",
		"tagline": "Trovano le posizioni là fuori",
		"color": Color("#00e87a"),
		"zone": Rect2(1000, 960, 880, 520),
		"inbox": Vector2(1790, 1390),
		# Anello radiale sul tappeto Scout; indice 0..5 = ore 10,8,12,6,2,4.
		"desks": [
			{"rect": Rect2(1064, 1012, 170, 78), "kind": "scout_a", "facing": "left", "tex_facing": "left", "seat_offset": Vector2(-26, -2)},
			{"rect": Rect2(1106, 1228, 170, 78), "kind": "scout_a", "facing": "left", "tex_facing": "down_left", "seat_offset": Vector2(-41, -71)},
			{"rect": Rect2(1370, 958, 170, 78), "kind": "scout_a", "facing": "up", "tex_facing": "up"},
			{"rect": Rect2(1370, 1301, 170, 78), "kind": "scout_a", "facing": "down", "tex_facing": "down", "integrated_chair": true, "front_occlusion": 0.72},
			{"rect": Rect2(1676, 1012, 170, 78), "kind": "scout_a", "facing": "right", "tex_facing": "right", "seat_offset": Vector2(26, -2)},
			{"rect": Rect2(1634, 1228, 170, 78), "kind": "scout_a", "facing": "right", "tex_facing": "down_right", "seat_offset": Vector2(41, -71)},
		],
	},
	"analisti": {
		"name": "Analisti",
		"tagline": "Arricchiscono e verificano i dati",
		"color": Color("#4d9fff"),
		"zone": Rect2(2312, 150, 848, 580),  # il lab di vetro, angolo NE
		"inbox": Vector2(2690, 790),  # fuori dalla porta del lab
		# Anello radiale adattato al tappeto più stretto del laboratorio.
		"desks": [
			{"rect": Rect2(2405, 293, 170, 78), "kind": "analisti_a", "facing": "left", "tex_facing": "left", "seat_offset": Vector2(-26, -2)},
			{"rect": Rect2(2430, 468, 170, 78), "kind": "analisti_a", "facing": "left", "tex_facing": "down_left", "seat_offset": Vector2(-41, -71)},
			{"rect": Rect2(2650, 249, 170, 78), "kind": "analisti_a", "facing": "up", "tex_facing": "up"},
			{"rect": Rect2(2650, 527, 170, 78), "kind": "analisti_a", "facing": "down", "tex_facing": "down", "integrated_chair": true, "front_occlusion": 0.72},
			{"rect": Rect2(2895, 293, 170, 78), "kind": "analisti_a", "facing": "right", "tex_facing": "right", "seat_offset": Vector2(26, -2)},
			{"rect": Rect2(2870, 468, 170, 78), "kind": "analisti_a", "facing": "right", "tex_facing": "down_right", "seat_offset": Vector2(41, -71)},
		],
	},
	"scorer": {
		"name": "Scorer",
		"tagline": "Pesano il match profilo↔annuncio",
		"color": Color("#f5c518"),
		"zone": Rect2(1950, 960, 1210, 470),
		"inbox": Vector2(1965, 1400),
		# Anello radiale ampio; il deposito resta sul bordo ovest del reparto.
		"desks": [
			# scorer_a_side nasce con la sedia a sinistra, al contrario degli
			# altri reparti: scambiamo solo il verso della texture laterale.
			{"rect": Rect2(2136, 1025, 170, 78), "kind": "scorer_a", "facing": "left", "tex_facing": "right", "seat_offset": Vector2(-26, -2)},
			{"rect": Rect2(2182, 1268, 170, 78), "kind": "scorer_a", "facing": "left", "tex_facing": "down_left", "seat_offset": Vector2(-41, -71)},
			{"rect": Rect2(2480, 964, 170, 78), "kind": "scorer_a", "facing": "up", "tex_facing": "up"},
			{"rect": Rect2(2480, 1350, 170, 78), "kind": "scorer_a", "facing": "down", "tex_facing": "down", "integrated_chair": true, "front_occlusion": 0.78},
			{"rect": Rect2(2825, 1025, 170, 78), "kind": "scorer_a", "facing": "right", "tex_facing": "left", "seat_offset": Vector2(26, -2)},
			{"rect": Rect2(2778, 1268, 170, 78), "kind": "scorer_a", "facing": "right", "tex_facing": "down_right", "seat_offset": Vector2(41, -71)},
		],
	},
	"scrittori": {
		"name": "Scrittori",
		"tagline": "Preparano CV e lettere su misura",
		"color": Color("#a855f7"),
		"zone": Rect2(320, 1520, 860, 440),
		"inbox": Vector2(1120, 1740),
		# Sei spicchi radiali sul tappeto, come un quadrante d'orologio.
		# Ogni agente guarda verso l'ESTERNO: ore 12=schiena, ore 6=viso,
		# i quattro intermedi usano le viste laterali disponibili. Gli indici
		# storici restano nello stesso spicchio (in particolare desk 3, usata
		# da Scrittore 4, resta alle ore 6) per non spostare gli UID live.
		"desks": [
			# indice 0..5 = ore 10, 8, 12, 6, 2, 4
			{"rect": Rect2(345, 1584, 170, 78), "kind": "scrittori_a", "facing": "left", "tex_facing": "left", "seat_offset": Vector2(-26, -2), "seated_art": "res://assets/gen-art/furniture/scrittori_a_side_seated.png"},
			{"rect": Rect2(380, 1768, 170, 78), "kind": "scrittori_a", "facing": "left", "tex_facing": "down_left", "seat_offset": Vector2(-41, -71), "seated_art": "res://assets/gen-art/furniture/scrittori_a_diag_down_seated_v2.png"},
			# Le postazioni 12/6 rientrano entrambe sul tappeto mantenendo
			# l'asse verticale e la vista retro/frontale richiesta.
			{"rect": Rect2(605, 1538, 170, 78), "kind": "scrittori_a", "facing": "up", "tex_facing": "up"},
			{"rect": Rect2(605, 1830, 170, 78), "kind": "scrittori_a", "facing": "down", "tex_facing": "down", "integrated_chair": true, "front_occlusion": 0.62},
			{"rect": Rect2(865, 1584, 170, 78), "kind": "scrittori_a", "facing": "right", "tex_facing": "right", "seat_offset": Vector2(26, -2)},
			{"rect": Rect2(830, 1768, 170, 78), "kind": "scrittori_a", "facing": "right", "tex_facing": "down_right", "seat_offset": Vector2(41, -71)},
		],
	},
	"critici": {
		"name": "Critici",
		"tagline": "Revisionano ogni riga prima dell'invio",
		"color": Color("#ff4560"),
		"zone": Rect2(2150, 1520, 1010, 440),
		"inbox": Vector2(3100, 1820),  # deposito sul bordo est, fuori dall'anello
		# Anello radiale con il centro sgombro per sedie, corpi e percorsi.
		"desks": [
			{"rect": Rect2(2309, 1580, 170, 78), "kind": "critici_a", "facing": "left", "tex_facing": "left", "seat_offset": Vector2(-26, -2)},
			{"rect": Rect2(2351, 1796, 170, 78), "kind": "critici_a", "facing": "left", "tex_facing": "down_left", "seat_offset": Vector2(-41, -71)},
			{"rect": Rect2(2615, 1526, 170, 78), "kind": "critici_a", "facing": "up", "tex_facing": "up"},
			{"rect": Rect2(2615, 1869, 170, 78), "kind": "critici_a", "facing": "down", "tex_facing": "down", "integrated_chair": true, "front_occlusion": 0.80},
			{"rect": Rect2(2921, 1580, 170, 78), "kind": "critici_a", "facing": "right", "tex_facing": "right", "seat_offset": Vector2(26, -2)},
			{"rect": Rect2(2879, 1796, 170, 78), "kind": "critici_a", "facing": "right", "tex_facing": "down_right", "seat_offset": Vector2(41, -71)},
		],
	},
}

## Vetrate dei reparti (reference Codex, ciclo grafica 11/07): pannelli
## PARZIALI di vetro con varchi larghi, mai gabbie chiuse. Regole nav
## (celle 32px, margine 16): vetro ad almeno ~95px dalle scrivanie e
## varchi >=160px, o si torna agli "agenti incastrati". La linea a
## y=1480 è CONDIVISA: sud degli Scorer e nord dei Critici insieme.
## Il lab degli Analisti ha già i suoi vetri (LAB_WALL_* in
## FurnitureDefs). Visual: _glass_line in OfficeFloor, stesso stile lab.
const GLASS_WALLS := [
	# Scout: nord (varco centrale verso l'ologramma) + est (varco sud
	# verso l'inbox); sud e ovest aperti sui corridoi
	Rect2(1030, 896, 260, 12),
	Rect2(1600, 896, 260, 12),
	Rect2(1904, 976, 12, 264),
	# linea condivisa Scorer/Critici con porta larga al centro
	Rect2(1990, 1480, 460, 12),
	Rect2(2660, 1480, 490, 12),
	# Scrittori: nord (varco verso la sala relax) + est (porta sud)
	Rect2(360, 1448, 340, 12),
	Rect2(860, 1448, 300, 12),
	Rect2(1204, 1560, 12, 160),
	# Critici: ovest con porta sud
	Rect2(2126, 1500, 12, 260),
]

## POI condivisi dei behavior: mete dei viaggi "si vede che lavorano".
## "spot" = dove l'agente si ferma (punto camminabile davanti al prop).
const POIS := {
	"printer": {"rect": Rect2(1672, 190, 110, 78), "spot": Vector2(1727, 300)},
	"coffee": {"spot": Vector2(1500, 310)},
	"water_cooler": {"spot": Vector2(1635, 300)},
	"hologram": {"spot": Vector2(1300, 930)},
	# sala relax a ovest (pausa vera: divano/arcade/ping-pong)
	"rec_room": {"spot": Vector2(520, 1200)},
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
