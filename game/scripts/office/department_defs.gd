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
## DISPOSIZIONI vengono dalla REGOLA DEL DADO (feedback live 11/07, tiri
## in chat; il dado vale SOLO dove Leone non si è espresso): Scout = isole
## a coppie faccia-a-faccia, Analisti = tavolo lungo a muro nel lab
## (angolo NE) + laterali, Scorer = diagonale a scala, Scrittori = ferro
## di cavallo aperto a est, Critici = anello con centro libero.
## Catena del valore: Scout → Analisti → Scorer → Scrittori → Critici.

const DEPT_ORDER := ["scout", "analisti", "scorer", "scrittori", "critici"]

const DEPARTMENTS := {
	"scout": {
		"name": "Scout",
		"tagline": "Trovano le posizioni là fuori",
		"color": Color("#00e87a"),
		"zone": Rect2(1000, 960, 880, 520),
		"inbox": Vector2(1790, 1390),
		# dado=2: tre isole a coppie, colleghi faccia a faccia.
		# desk 1 = STANDING DESK (dado 16:10: d6=5->una sola, d5=1 d6=2):
		# il Lead Scout lavora in piedi, tutti gli altri siedono.
		"desks": [
			{"rect": Rect2(1040, 1000, 170, 78), "kind": "scout_a", "facing": "down", "tex_facing": "up"},
			{"rect": Rect2(1040, 1086, 170, 78), "kind": "scout_a", "facing": "up", "standing": true},
			{"rect": Rect2(1380, 1180, 170, 78), "kind": "scout_b", "facing": "down", "seat_sink": 70.0},
			{"rect": Rect2(1380, 1266, 170, 78), "kind": "scout_a", "facing": "up"},
			{"rect": Rect2(1700, 1000, 170, 78), "kind": "scout_a", "facing": "down", "tex_facing": "up"},
			{"rect": Rect2(1700, 1086, 170, 78), "kind": "scout_a", "facing": "up"},
		],
	},
	"analisti": {
		"name": "Analisti",
		"tagline": "Arricchiscono e verificano i dati",
		"color": Color("#4d9fff"),
		"zone": Rect2(2312, 150, 848, 580),  # il lab di vetro, angolo NE
		"inbox": Vector2(2690, 790),  # fuori dalla porta del lab
		# Il TAVOLO LUNGO è DI QUESTO reparto (parola di Leone batte il dado
		# sul tavolone condiviso; poi d6=5 tavolo a muro, d5=2 analisti):
		# bench a muro nord del lab, 3 sedute di spalle (kind "none" = la
		# seduta è dell'item long_table in FurnitureDefs, niente visual
		# proprio) + 3 scrivanie laterali del vecchio ferro di cavallo.
		"desks": [
			{"rect": Rect2(2430, 180, 200, 110), "kind": "none", "facing": "up"},
			{"rect": Rect2(2630, 180, 200, 110), "kind": "none", "facing": "up"},
			{"rect": Rect2(2830, 180, 200, 110), "kind": "none", "facing": "up"},
			{"rect": Rect2(2360, 380, 170, 78), "kind": "analisti_a", "facing": "right"},
			{"rect": Rect2(2360, 560, 170, 78), "kind": "analisti_a", "facing": "right"},
			{"rect": Rect2(2890, 380, 170, 78), "kind": "analisti_a", "facing": "left"},
		],
	},
	"scorer": {
		"name": "Scorer",
		"tagline": "Pesano il match profilo↔annuncio",
		"color": Color("#f5c518"),
		"zone": Rect2(1950, 960, 1210, 470),
		"inbox": Vector2(1965, 1400),
		# dado=4: diagonale a scala verso sud-est, monitor curvo al centro
		"desks": [
			{"rect": Rect2(1980, 980, 170, 78), "kind": "scorer_a", "facing": "down", "seat_sink": 70.0},
			{"rect": Rect2(2180, 1052, 170, 78), "kind": "scorer_b", "facing": "down", "seat_sink": 70.0},
			{"rect": Rect2(2360, 1116, 290, 110), "kind": "desk_wide", "facing": "down", "seat_sink": 78.0},
			{"rect": Rect2(2680, 1196, 170, 78), "kind": "scorer_a", "facing": "down", "seat_sink": 70.0},
			{"rect": Rect2(2880, 1268, 170, 78), "kind": "scorer_b", "facing": "down", "seat_sink": 70.0},
			{"rect": Rect2(2980, 1340, 170, 78), "kind": "scorer_a", "facing": "up"},
		],
	},
	"scrittori": {
		"name": "Scrittori",
		"tagline": "Preparano CV e lettere su misura",
		"color": Color("#a855f7"),
		"zone": Rect2(320, 1520, 860, 440),
		"inbox": Vector2(1120, 1740),
		# dado=3: ferro di cavallo aperto verso l'ufficio (est)
		"desks": [
			{"rect": Rect2(350, 1560, 170, 78), "kind": "scrittori_a", "facing": "left", "tex_facing": "right"},
			{"rect": Rect2(350, 1740, 170, 78), "kind": "scrittori_a", "facing": "left", "tex_facing": "right"},
			{"rect": Rect2(600, 1545, 170, 78), "kind": "scrittori_b", "facing": "down"},
			{"rect": Rect2(600, 1830, 170, 78), "kind": "scrittori_a", "facing": "up"},
			{"rect": Rect2(860, 1545, 170, 78), "kind": "scrittori_a", "facing": "down"},
			{"rect": Rect2(860, 1830, 170, 78), "kind": "scrittori_a", "facing": "up"},
		],
	},
	"critici": {
		"name": "Critici",
		"tagline": "Revisionano ogni riga prima dell'invio",
		"color": Color("#ff4560"),
		"zone": Rect2(2150, 1520, 1010, 440),
		"inbox": Vector2(2690, 1825),  # accanto al tavolino centrale
		# dado=6: anello rivolto al centro (spazio per un pezzo di dev-art)
		"desks": [
			{"rect": Rect2(2480, 1550, 170, 78), "kind": "critici_a", "facing": "down", "seat_sink": 64.0},
			{"rect": Rect2(2740, 1550, 170, 78), "kind": "critici_b", "facing": "down", "seat_sink": 64.0},
			{"rect": Rect2(2280, 1690, 170, 78), "kind": "critici_a", "facing": "right"},
			{"rect": Rect2(2950, 1690, 170, 78), "kind": "critici_a", "facing": "left"},
			{"rect": Rect2(2480, 1850, 170, 78), "kind": "critici_a", "facing": "up"},
			{"rect": Rect2(2740, 1850, 170, 78), "kind": "critici_a", "facing": "up"},
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
