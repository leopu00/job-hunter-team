class_name Palette
## Design token JHT — unica fonte dei colori di gioco.
## Il mondo isometrico mantiene la propria illuminazione; questi token vestono
## l'interfaccia (finestre, sidebar, dialoghi e grafici) in dark oppure light.
## La preferenza è locale al gioco e viene applicata prima della prima scena.

const MODE_DARK := "dark"
const MODE_LIGHT := "light"
const CONFIG_PATH := "user://appearance.cfg"

static var mode := MODE_DARK

# Sfondi
static var VOID := Color("#060608")
static var DEEP := Color("#0c0c10")
static var PANEL := Color("#111116")
static var CARD := Color("#16161d")
static var ROW := Color("#1a1a22")

# Bordi
static var BORDER := Color("#252530")
static var BORDER_GLOW := Color("#2e2e3d")

# Testo
static var DIM := Color("#4a4a5e")
static var MUTED := Color("#7a7a96")
static var BASE := Color("#b8b8d0")
static var BRIGHT := Color("#e0e0f0")
static var WHITE := Color("#f0f0fa")
static var GRID := Color(1.0, 1.0, 1.0, 0.018)

# Accenti: in light diventano più profondi, così testo e indicatori restano
# leggibili sul bianco (gli accenti neon originali non superano il contrasto).
static var GREEN := Color("#00e87a")
static var MINT := Color("#7fffb2")
static var YELLOW := Color("#f5c518")
static var BLUE := Color("#4d9fff")
static var RED := Color("#ff4560")
static var ORANGE := Color("#ff8c42")
static var PURPLE := Color("#a855f7")


static func _static_init() -> void:
	var requested := OS.get_environment("JHT_THEME").to_lower()
	if requested not in [MODE_DARK, MODE_LIGHT]:
		var cfg := ConfigFile.new()
		if cfg.load(CONFIG_PATH) == OK:
			requested = str(cfg.get_value("ui", "theme", MODE_DARK)).to_lower()
	_apply(MODE_LIGHT if requested == MODE_LIGHT else MODE_DARK)


static func set_mode(requested: String, persist := true) -> bool:
	requested = requested.to_lower()
	if requested not in [MODE_DARK, MODE_LIGHT]:
		return false
	var changed := requested != mode
	_apply(requested)
	if persist:
		var cfg := ConfigFile.new()
		cfg.set_value("ui", "theme", mode)
		cfg.save(CONFIG_PATH)
	return changed


static func is_light() -> bool:
	return mode == MODE_LIGHT


static func accent_cycle() -> Array[Color]:
	return [GREEN, BLUE, PURPLE, YELLOW, ORANGE, RED, MINT]


static func _apply(requested: String) -> void:
	mode = requested
	if requested == MODE_LIGHT:
		VOID = Color("#eef3f0")
		DEEP = Color("#ffffff")
		PANEL = Color("#fbfdfc")
		CARD = Color("#f3f6f4")
		ROW = Color("#e7eeea")
		BORDER = Color("#c8d3cd")
		BORDER_GLOW = Color("#a9bbb1")
		DIM = Color("#65736c")
		MUTED = Color("#4f5d56")
		BASE = Color("#34423b")
		BRIGHT = Color("#202b25")
		WHITE = Color("#101713")
		GRID = Color(0.04, 0.10, 0.07, 0.055)
		GREEN = Color("#007a46")
		MINT = Color("#18794e")
		YELLOW = Color("#8a6500")
		BLUE = Color("#185fa8")
		RED = Color("#bd2943")
		ORANGE = Color("#a84f12")
		PURPLE = Color("#7040aa")
	else:
		VOID = Color("#060608")
		DEEP = Color("#0c0c10")
		PANEL = Color("#111116")
		CARD = Color("#16161d")
		ROW = Color("#1a1a22")
		BORDER = Color("#252530")
		BORDER_GLOW = Color("#2e2e3d")
		DIM = Color("#4a4a5e")
		MUTED = Color("#7a7a96")
		BASE = Color("#b8b8d0")
		BRIGHT = Color("#e0e0f0")
		WHITE = Color("#f0f0fa")
		GRID = Color(1.0, 1.0, 1.0, 0.018)
		GREEN = Color("#00e87a")
		MINT = Color("#7fffb2")
		YELLOW = Color("#f5c518")
		BLUE = Color("#4d9fff")
		RED = Color("#ff4560")
		ORANGE = Color("#ff8c42")
		PURPLE = Color("#a855f7")
