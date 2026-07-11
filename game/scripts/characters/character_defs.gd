class_name CharacterDefs
## Roster degli agenti in scena. AGENTS tiene i "lead" (uno per ruolo, con
## dialoghi) e i core fuori reparto; l'organico completo per la scena viene
## da spawn_list(): lead + lavoratori generati sulle postazioni dei reparti
## (DEPT_ROLES). Le posizioni sono coordinate mondo (vedi DepartmentDefs).

const GEN := "res://assets/characters/gen/"
const SHEETS := "res://assets/characters/sheets/"

const AGENTS := {
	"coordinatore": {
		"name": "Il Coordinatore",
		"spot": Vector2(545, 856),  # DAVANTI al desk (schermo verso camera)
		"facing": "up",
		# il giro dei reparti: passa a controllare gli inbox, come i C-tick
		"wander": [Vector2(1790, 1390), Vector2(2690, 790), Vector2(1965, 1400),
				Vector2(1120, 1740), Vector2(2690, 1825), Vector2(1300, 930)],
		"chatter": [
			"ricalibro il ritmo del team…",
			"il weekly è al 64%, tutto in linea",
			"nessun collo di bottiglia oggi",
		],
	},
	"scout": {
		"name": "Lo Scout",
		"dept": "scout",
		"desk": 1,
		"chatter": [
			"sto scansionando LinkedIn…",
			"3 board visitate nell'ultima ora",
			"c'è una pagina careers nuova…",
		],
	},
	"analista": {
		"name": "L'Analista",
		"dept": "analisti",
		"desk": 1,  # seduta centrale del bench a muro (il tavolo lungo)
		"chatter": [
			"verifico lo stipendio probabile…",
			"questo annuncio ha dati mancanti",
			"incrocio le fonti sulla sede…",
		],
	},
	"scorer": {
		"name": "Lo Scorer",
		"dept": "scorer",
		"desk": 1,  # il desk_wide col monitor curvo
		"chatter": [
			"sto pesando i requisiti…",
			"score in coda: 1 posizione",
			"profilo vs annuncio: 85% di copertura",
		],
	},
	"scrittore": {
		"name": "Lo Scrittore",
		"dept": "scrittori",
		"desk": 1,
		"chatter": [
			"questo CV merita un attacco migliore…",
			"due righe in meno, il doppio del peso",
			"su misura, mai fotocopie",
		],
	},
	"critico": {
		"name": "Il Critico",
		"dept": "critici",
		"desk": 0,
		"chatter": [
			"chi ha scritto questa frase? riscrivila",
			"un refuso qui costa un colloquio",
			"approvato. sorprendentemente.",
		],
	},
	"mentor": {
		"name": "Il Mentor",
		"spot": Vector2(740, 480),
		"wander": [Vector2(470, 620), Vector2(1090, 330), Vector2(1300, 960)],
		"chatter": [
			"un buon colloquio è una conversazione",
			"i numeri raccontano i risultati",
			"respira: la ricerca è una maratona",
		],
	},
	"assistente": {
		"name": "L'Assistente",
		"spot": Vector2(1665, 1936),  # DAVANTI al desk all'entrata sud
		"facing": "up",
		"wander": [Vector2(850, 1250), Vector2(1490, 320), Vector2(1965, 1400)],
		"chatter": [
			"l'onboarding è completo",
			"se hai dubbi, chiedi pure a me",
			"tengo io il registro del team",
		],
	},
	# one-shot/on-demand del sistema reale (roster barto li pubblica:
	# senza un posto in scena sparivano con un warn — la scena deve
	# mostrare TUTTI gli attivi veri)
	"mantenitore": {
		"name": "Il Mantenitore",
		"spot": Vector2(860, 330),
		"wander": [Vector2(1727, 300), Vector2(2690, 790), Vector2(1120, 1740)],
		"chatter": [
			"container sani, disco ok",
			"aggiorno le dipendenze…",
			"backup verificato, tutto al suo posto",
		],
	},
	"dottore": {
		"name": "Il Dottore",
		"spot": Vector2(420, 320),
		"wander": [Vector2(1790, 1390), Vector2(1965, 1400), Vector2(2690, 1825)],
		"chatter": [
			"visita di controllo agli agenti…",
			"contesto in salute, nessun sintomo di burn",
			"prescrivo un refresh leggero",
		],
	},
	"sentinella": {
		"name": "La Sentinella",
		"spot": Vector2(1490, 320),
		# watchdog del team: la sua ronda tocca tutti gli angoli della box
		"wander": [Vector2(2690, 790), Vector2(2690, 1825), Vector2(1120, 1740),
				Vector2(470, 620), Vector2(1090, 330), Vector2(1965, 1400)],
		"chatter": [
			"ronda: processi tutti vivi",
			"bridge attivo, heartbeat regolare",
			"nessun flap nelle sessioni",
		],
	},
}

## Organico dei reparti oltre ai lead: quali postazioni riempiono i
## lavoratori generati. TUTTE le sedie tranne quella del lead (missione
## pipeline 20:1x, "più scrivanie dove serve"): il roster VPS arriva a
## 5-6 istanze per ruolo e ogni istanza reale deve trovare posto —
## l'ufficio respira comunque, in scena c'è solo chi è attivo davvero.
const DEPT_ROLES := {
	"scout": {"slug": "scout", "label": "Scout", "workers": [0, 2, 3, 4, 5]},
	"analisti": {"slug": "analista", "label": "Analista", "workers": [0, 2, 3, 4, 5]},
	"scorer": {"slug": "scorer", "label": "Scorer", "workers": [0, 2, 3, 4, 5]},
	"scrittori": {"slug": "scrittore", "label": "Scrittore", "workers": [0, 2, 3, 4, 5]},
	"critici": {"slug": "critico", "label": "Critico", "workers": [1, 2, 3, 4, 5]},
}

static var _spawn_cache: Array = []

## L'organico completo della scena: un Dictionary per agente con
## slug (ruolo: sheet/dialoghi/chatter), name, spot e — per chi è in
## reparto — dept + desk. I lavoratori condividono ruolo e chatter del lead.
static func spawn_list() -> Array:
	if not _spawn_cache.is_empty():
		return _spawn_cache
	for slug in AGENTS:
		var def: Dictionary = AGENTS[slug].duplicate(true)
		def["slug"] = slug
		def["lead"] = true
		if def.has("dept"):
			def["spot"] = _desk_spot_of(def["dept"], def["desk"])
		_spawn_cache.append(def)
	for dept_id in DEPT_ROLES:
		var role: Dictionary = DEPT_ROLES[dept_id]
		var n := 2
		for desk_i in role["workers"]:
			_spawn_cache.append({
				"slug": role["slug"],
				"name": "%s %02d" % [role["label"], n],
				"dept": dept_id,
				"desk": desk_i,
				"lead": false,
				"spot": _desk_spot_of(dept_id, desk_i),
				"chatter": AGENTS[role["slug"]]["chatter"],
			})
			n += 1
	return _spawn_cache

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
## mai SVG in scena): la sentinella usa il camice tecnico del maintainer
## finché imagegen non riapre e le genera un foglio dedicato.
const SHEET_LOANS := {
	"sentinella": "maintainer",
	"mantenitore": "maintainer",  # il camice è davvero il suo
	"dottore": "mentor",  # look da consigliere finché non ha un foglio suo
}

static func make_rig(slug: String, variant := "a") -> Node2D:
	var sheet_path := SHEETS + slug + "_" + variant + ".png"
	if not ResourceLoader.exists(sheet_path) and SHEET_LOANS.has(slug):
		sheet_path = SHEETS + SHEET_LOANS[slug] + "_" + variant + ".png"
	if ResourceLoader.exists(sheet_path):
		var rig := SpriteSheetRig.new()
		# foglio seduto opzionale (4x3, vedi SIT_TRACKS): se manca, il rig
		# degrada "sit" a work da solo
		var sit_path := SHEETS + slug + "_sit.png"
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
