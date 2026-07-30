class_name CharacterDefs
## Roster degli agenti in scena. AGENTS tiene i "lead" (uno per ruolo, con
## dialoghi) e i core fuori reparto; l'organico completo per la scena viene
## da spawn_list(): lead + lavoratori generati sulle postazioni dei reparti
## (DEPT_ROLES). Le posizioni sono coordinate mondo (vedi DepartmentDefs).

const GEN := "res://assets/characters/gen/"
const SHEETS := "res://assets/characters/sheets/"

## I "name" qui dentro sono l'italiano di riferimento: a schermo va sempre
## role_name(slug), che li cerca nei dizionari delle 7 lingue.
const AGENTS := {
	"coordinatore": {
		"name": "Il Coordinatore",
		"spot": Vector2(1495, 441),  # dietro il desk, volto verso la camera
		"facing": "down",
		"workstation_key": "core:coordinatore",
		# il giro dei reparti: passa a controllare gli inbox, come i C-tick
		"wander": [Vector2(1320, 620), Vector2(1660, 650), Vector2(1110, 778),
				Vector2(2690, 790), Vector2(1790, 1390), Vector2(1120, 1740),
				Vector2(2690, 1825), Vector2(1300, 930)],
		"chatter": [
			"controllo che tutti abbiano un incarico…",
			"il lavoro di oggi procede bene",
			"nessun reparto ha bisogno di aiuto",
		],
	},
	"scout": {
		"name": "Il Ricercatore",
		"dept": "scout",
		"desk": 1,
		"chatter": [
			"sto cercando nuove opportunità…",
			"ho trovato tre aziende interessanti",
			"questa azienda ha appena pubblicato un'offerta…",
		],
	},
	"analista": {
		"name": "L'Analista",
		"dept": "analisti",
		"desk": 1,  # seduta centrale del bench a muro (il tavolo lungo)
		"chatter": [
			"studio meglio questa opportunità…",
			"qui mancano alcune informazioni",
			"controllo dove si trova davvero la sede…",
		],
	},
	"scorer": {
		"name": "Il Consulente",
		"dept": "scorer",
		"desk": 1,  # il desk_wide col monitor curvo
		"chatter": [
			"confronto questa offerta con i suoi desideri…",
			"questa opportunità sembra promettente",
			"qui competenze e condizioni combaciano bene",
		],
	},
	"scrittore": {
		"name": "Il Redattore",
		"dept": "scrittori",
		"desk": 1,
		"chatter": [
			"questa candidatura merita un inizio migliore…",
			"due righe in meno, il doppio del peso",
			"su misura, mai fotocopie",
		],
	},
	"critico": {
		"name": "Il Revisore",
		"dept": "critici",
		"desk": 0,
		"chatter": [
			"questa frase non è abbastanza chiara: riscrivila",
			"un refuso qui costa un colloquio",
			"approvato. sorprendentemente.",
		],
	},
	"mentor": {
		"name": "Il Mentor",
		# Il punto d'accesso resta sotto la poltrona e navigabile; l'offset porta
		# il centro logico nel composito frontale senza ingrandire il personaggio.
		"spot": Vector2(2830, 1274),
		"facing": "down",
		"seat_offset": Vector2(0, -24),
		"workstation_key": "core:mentor",
		# Ordine intenzionale della passeggiata: prende un volume, controlla la
		# lavagna e torna a leggere. AgentNPC percorre entrambe le tappe.
		# Punti liberi sul lato sud della lounge: seguono la nuova posizione di
		# libreria, poltrona e lavagna senza intrappolare il Mentor fra gli arredi.
		"wander": [Vector2(2550, 1260), Vector2(2920, 1320)],
		"chatter": [
			"un buon colloquio è una conversazione",
			"i numeri raccontano i risultati",
			"respira: la ricerca è una maratona",
		],
	},
	"assistente": {
		"name": "L'Assistente",
		# Reception accanto all'uscita: seduta frontale, senza dare le spalle.
		"spot": Vector2(1665, 1786),
		"facing": "down",
		"workstation_key": "core:assistente",
		"wander": [Vector2(1110, 778), Vector2(1490, 320), Vector2(1790, 1390)],
		"chatter": [
			"la presentazione dell'ufficio è completa",
			"se hai dubbi, chiedi pure a me",
			"tengo io il registro del team",
		],
	},
	# one-shot/on-demand del sistema reale (roster barto li pubblica:
	# senza un posto in scena sparivano con un warn — la scena deve
	# mostrare TUTTI gli attivi veri)
	"mantenitore": {
		"name": "Il Mantenitore",
		# Reparto tecnico sul lato ovest degli Scorer, opposto al Mentor.
		"spot": Vector2(702.5, 899),
		"facing": "down",
		"workstation_key": "core:mantenitore",
		"wander": [Vector2(1727, 300), Vector2(590, 1090), Vector2(950, 1070)],
		"chatter": [
			"gli strumenti dell'ufficio sono in ordine",
			"preparo gli aggiornamenti…",
			"backup verificato, tutto al suo posto",
		],
	},
	"dottore": {
		"name": "Il Dottore",
		# Poltrona clinica e strumenti sul lato ovest degli Scorer.
		"spot": Vector2(850, 1186),
		"facing": "down",
		"workstation_key": "core:dottore",
		"wander": [Vector2(1110, 778), Vector2(1790, 1390), Vector2(2690, 1825)],
		"chatter": [
			"visita di controllo agli agenti…",
			"la squadra è in salute",
			"prescrivo una breve pausa e poi si riparte",
		],
	},
	"sentinella": {
		"name": "Il Tesoriere",
		"spot": Vector2(1905, 499),  # postazione multi-schermo frontale
		"facing": "down",
		"workstation_key": "core:sentinella",
		# watchdog del team: la sua ronda tocca tutti gli angoli della box
		"wander": [Vector2(1710, 650), Vector2(2110, 650), Vector2(2690, 790),
				Vector2(2690, 1825), Vector2(1120, 1740), Vector2(775, 820),
				Vector2(2600, 1120), Vector2(1790, 1390)],
		"chatter": [
			"ronda completata: tutto in ordine",
			"l'ufficio lavora regolarmente",
			"nessun problema durante il turno",
		],
	},
}

## Organico dei reparti oltre ai lead: quali postazioni riempiono i
## lavoratori generati. TUTTE le sedie tranne quella del lead (missione
## pipeline 20:1x, "più scrivanie dove serve"): il roster VPS arriva a
## 5-6 istanze per ruolo e ogni istanza reale deve trovare posto —
## l'ufficio respira comunque, in scena c'è solo chi è attivo davvero.
const DEPT_ROLES := {
	"scout": {"slug": "scout", "label": "Ricercatore", "workers": [0, 2, 3, 4, 5]},
	"analisti": {"slug": "analista", "label": "Analista", "workers": [0, 2, 3, 4, 5]},
	"scorer": {"slug": "scorer", "label": "Consulente", "workers": [0, 2, 3, 4, 5]},
	"scrittori": {"slug": "scrittore", "label": "Redattore", "workers": [0, 2, 3, 4, 5]},
	"critici": {"slug": "critico", "label": "Revisore", "workers": [1, 2, 3, 4, 5]},
}

## Identità visiva stabile per postazione. Il lead resta sempre `a`; le altre
## cinque sedie ricevono `b`..`f`. Tenere la mappa per desk (e non per ordine
## di spawn) evita che una persona cambi volto quando varia il roster live.
const VARIANT_BY_DESK := {
	"scout": {0: "b", 1: "a", 2: "c", 3: "d", 4: "e", 5: "f"},
	"analisti": {0: "b", 1: "a", 2: "c", 3: "d", 4: "e", 5: "f"},
	"scorer": {0: "b", 1: "a", 2: "c", 3: "d", 4: "e", 5: "f"},
	"scrittori": {0: "b", 1: "a", 2: "c", 3: "d", 4: "e", 5: "f"},
	"critici": {0: "a", 1: "b", 2: "c", 3: "d", 4: "e", 5: "f"},
}

## Il nome di scena del ruolo, nella lingua dell'interfaccia.
##
## I nomi qui sopra restano l'italiano di RIFERIMENTO (una costante non può
## chiamare t(), e serve comunque una rete quando la chiave manca), ma la
## targhetta che l'utente legge passa dai dizionari come tutto il resto:
## finché non lo faceva, la colonna delle chat restava in italiano dentro
## un'interfaccia inglese.
static func role_name(slug: String) -> String:
	return _localized("role." + slug, str(AGENTS.get(slug, {}).get("name", slug)))


## Nome del collega numerato di un reparto ("Ricercatore 02"): forma breve,
## senza articolo, perché il numero le sta subito dietro.
static func worker_name(dept_id: String, number: int) -> String:
	var role: Dictionary = DEPT_ROLES[dept_id]
	return "%s %02d" % [_localized("role_short." + str(role["slug"]),
			str(role["label"])), number]


## t() restituisce la CHIAVE quando non la conosce: una targhetta con scritto
## "role.scout" è peggio di una targhetta in italiano, quindi qui la chiave
## non tradotta ripiega sul nome di riferimento.
static func _localized(key: String, fallback: String) -> String:
	var translated: String = UIStrings.t(key)
	return fallback if translated == key else translated


static var _spawn_cache: Array = []
## Lingua con cui la cache è stata costruita: i nomi ci sono dentro, e il
## cambio lingua da Impostazioni non riavvia il gioco.
static var _spawn_cache_lang := ""

## L'organico completo della scena: un Dictionary per agente con
## slug (ruolo: sheet/dialoghi/chatter), name, spot e — per chi è in
## reparto — dept + desk. I lavoratori condividono ruolo e chatter del lead.
static func spawn_list() -> Array:
	if not _spawn_cache.is_empty() and _spawn_cache_lang == UIStrings.lang:
		return _spawn_cache
	_spawn_cache = []
	_spawn_cache_lang = UIStrings.lang
	for slug in AGENTS:
		var def: Dictionary = AGENTS[slug].duplicate(true)
		def["slug"] = slug
		def["name"] = role_name(slug)
		def["lead"] = true
		if def.has("dept"):
			def["variant"] = VARIANT_BY_DESK[def["dept"]][def["desk"]]
			def["spot"] = _desk_spot_of(def["dept"], def["desk"])
		_spawn_cache.append(def)
	for dept_id in DEPT_ROLES:
		var role: Dictionary = DEPT_ROLES[dept_id]
		var n := 2
		for desk_i in role["workers"]:
			_spawn_cache.append({
				"slug": role["slug"],
				"variant": VARIANT_BY_DESK[dept_id][desk_i],
				"name": worker_name(dept_id, n),
				"dept": dept_id,
				"desk": desk_i,
				"lead": false,
				"spot": _desk_spot_of(dept_id, desk_i),
				"chatter": AGENTS[role["slug"]]["chatter"],
			})
			n += 1
	return _spawn_cache

## Cast del primo avvio: tutti i ruoli fondamentali e due volti per reparto
## (lead + un collega). Fa percepire un ufficio vivo senza fingere che trenta
## processi reali siano già attivi.
static func showroom_list() -> Array:
	var out: Array = []
	var depts := {}
	for def in spawn_list():
		if def.get("lead", false):
			out.append(def)
			if str(def.get("dept", "")) != "":
				depts[str(def["dept"])] = 1
		elif str(def.get("dept", "")) != "" \
				and int(depts.get(str(def["dept"]), 0)) < 2:
			out.append(def)
			depts[str(def["dept"])] = 2
	return out

## Nome di chi occupa la postazione `index` del reparto ("" se libera).
static func desk_occupant_name(dept_id: String, index: int) -> String:
	for def in spawn_list():
		if def.get("dept", "") == dept_id and def.get("desk", -1) == index:
			return def["name"]
	return ""

## Slug (ruolo) di chi occupa la postazione, per lo status TeamData.
static func desk_occupant_slug(dept_id: String, index: int) -> String:
	for def in spawn_list():
		if def.get("dept", "") == dept_id and def.get("desk", -1) == index:
			return def["slug"]
	return ""

static func _desk_spot_of(dept_id: String, index: int) -> Vector2:
	return DepartmentDefs.desk_spot(DepartmentDefs.DEPARTMENTS[dept_id]["desks"][index])

## Factory del rig: spritesheet pittorico se esiste (docs/SPRITES.md),
## altrimenti il vecchio rig a parti SVG. I chiamanti usano solo
## set_motion(facing, flipped, mode), identica su entrambi i rig.
## Ruoli senza sheet proprio che vestono quello di un altro (pittorico,
## mai SVG in scena). La Sentinella/Tesoriere ha ora un foglio dedicato.
const SHEET_LOANS := {
	"mantenitore": "maintainer",  # il camice è davvero il suo
}

static func make_rig(slug: String, variant := "a") -> Node2D:
	var sheet_slug := str(SHEET_LOANS.get(slug, slug))
	var sheet_path := SHEETS + sheet_slug + "_" + variant + ".png"
	# Le varianti vengono consegnate reparto per reparto: fino a quando un
	# foglio non esiste, la scena resta funzionante usando l'identità `a`.
	if not ResourceLoader.exists(sheet_path):
		sheet_path = SHEETS + sheet_slug + "_a.png"
	if ResourceLoader.exists(sheet_path):
		var rig := SpriteSheetRig.new()
		# foglio seduto opzionale (4x3, vedi SIT_TRACKS): se manca, il rig
		# degrada "sit" a work da solo
		var sit_path := SHEETS + sheet_slug + "_" + variant + "_sit.png"
		if not ResourceLoader.exists(sit_path):
			sit_path = SHEETS + sheet_slug + "_sit.png"
		var sit: Texture2D = load(sit_path) if ResourceLoader.exists(sit_path) else null
		rig.setup(load(sheet_path), sit)
		return rig
	# fallback SVG; per slug senza asset (ruoli nuovi) si presta lo scout
	var svg_slug := slug if ResourceLoader.exists(GEN + slug + "/head_front.svg") else "scout"
	var legacy := CharacterRig.new()
	legacy.setup(agent_textures(svg_slug))
	return legacy

## Texture del rig per un agente del roster.
static func agent_textures(slug: String) -> Dictionary:
	var base := GEN + slug + "/"
	var t := {
		"head_front": load(base + "head_front.svg"),
		"head_side": load(base + "head_side.svg"),
		"head_back": load(base + "head_back.svg"),
		"torso_front": load(base + "torso_front.svg"),
		"torso_side": load(base + "torso_side.svg"),
	}
	if ResourceLoader.exists(base + "leg_front.svg"):
		t["leg_front"] = load(base + "leg_front.svg")
		t["leg_side"] = load(base + "leg_side.svg")
	return t
