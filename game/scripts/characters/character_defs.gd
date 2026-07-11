class_name CharacterDefs
## Roster degli agenti in scena: nome pubblico, postazione, mete di
## vagabondaggio e righe di chiacchiera ambientale (status bubble).
## Le posizioni sono coordinate mondo (vedi FurnitureDefs).

const GEN := "res://assets/characters/gen/"
const SHEETS := "res://assets/characters/sheets/"

## Varianti avatar giocatore (usate dal rig e dal wizard M4).
const PLAYER_BASES := ["a", "b", "c"]
const PLAYER_HAIR_STYLES := ["short", "long", "curly"]
const PLAYER_HAIR_COLORS := [Color("#2b2018"), Color("#6b4a2a"), Color("#b8863b"), Color("#8a8a92")]
const PLAYER_OUTFIT_COLORS := [Color("#3d5a4a"), Color("#3a4258"), Color("#5a4a58"), Color("#4a4438")]

const AGENTS := {
	"coordinatore": {
		"name": "Il Coordinatore",
		"spot": Vector2(545, 706),
		"wander": [Vector2(360, 950), Vector2(1490, 320), Vector2(1300, 960)],
		"chatter": [
			"ricalibro il ritmo del team…",
			"il weekly è al 64%, tutto in linea",
			"nessun collo di bottiglia oggi",
		],
	},
	"scout": {
		"name": "Lo Scout",
		"spot": Vector2(1361, 978),  # postazione r1c2 del reparto Scout
		"wander": [Vector2(1000, 320), Vector2(1490, 320), Vector2(1600, 1250)],
		"chatter": [
			"sto scansionando LinkedIn…",
			"3 board visitate nell'ultima ora",
			"c'è una pagina careers nuova…",
		],
	},
	"analista": {
		"name": "L'Analista",
		"spot": Vector2(1933, 214),  # postazione r1c1 del lab Analisti
		"wander": [Vector2(1900, 520), Vector2(2100, 680)],
		"chatter": [
			"verifico lo stipendio probabile…",
			"questo annuncio ha dati mancanti",
			"incrocio le fonti sulla sede…",
		],
	},
	"scorer": {
		"name": "Lo Scorer",
		"spot": Vector2(2164, 970),  # il desk_wide col monitor curvo
		"wander": [Vector2(2320, 1200), Vector2(1300, 960)],
		"chatter": [
			"sto pesando i requisiti…",
			"score in coda: 1 posizione",
			"profilo vs annuncio: 85% di copertura",
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
		"spot": Vector2(1295, 1726),  # desk all'entrata sud (corridoio)
		"wander": [Vector2(850, 1250), Vector2(1490, 320)],
		"chatter": [
			"l'onboarding è completo",
			"se hai dubbi, chiedi pure a me",
			"tengo io il registro del team",
		],
	},
}

## Factory del rig: spritesheet pittorico se esiste (docs/SPRITES.md),
## altrimenti il vecchio rig a parti SVG. I chiamanti usano solo
## set_motion(facing, flipped, mode), identica su entrambi i rig.
static func make_rig(slug: String, variant := "a") -> Node2D:
	var sheet_path := SHEETS + slug + "_" + variant + ".png"
	if ResourceLoader.exists(sheet_path):
		var rig := SpriteSheetRig.new()
		rig.setup(load(sheet_path))
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

## Texture + tinte del rig giocatore a partire dal profilo (Game.profile).
static func player_textures(profile: Dictionary) -> Dictionary:
	var base: String = PLAYER_BASES[clampi(profile["base"], 0, PLAYER_BASES.size() - 1)]
	var style: String = PLAYER_HAIR_STYLES[clampi(profile["hair"], 0, PLAYER_HAIR_STYLES.size() - 1)]
	var d := GEN + "player/"
	return {
		"head_front": load(d + "head_%s_front.svg" % base),
		"head_side": load(d + "head_%s_side.svg" % base),
		"head_back": load(d + "head_%s_back.svg" % base),
		"torso_front": load(d + "torso_%s_front.svg" % base),
		"torso_side": load(d + "torso_%s_side.svg" % base),
		"leg_front": load(d + "leg_front.svg"),
		"leg_side": load(d + "leg_side.svg"),
		"hair_front": load(d + "hair_%s_front.svg" % style),
		"hair_side": load(d + "hair_%s_side.svg" % style),
		"hair_back": load(d + "hair_%s_back.svg" % style),
		"jacket_front": load(d + "jacket_front.svg"),
		"jacket_side": load(d + "jacket_side.svg"),
		"hair_tint": PLAYER_HAIR_COLORS[clampi(profile["hair_color"], 0, PLAYER_HAIR_COLORS.size() - 1)],
		"jacket_tint": PLAYER_OUTFIT_COLORS[clampi(profile["outfit"], 0, PLAYER_OUTFIT_COLORS.size() - 1)],
	}
