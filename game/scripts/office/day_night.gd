class_name DayNight
extends Node2D
## Ciclo giorno/notte legato all'ORA LOCALE dell'utente (JHT_HOUR=0..23
## per i test). Col buio: esterno nero e lampade interne accese; col
## giorno: esterno chiaro, lampade spente e luce che entra dalle vetrate.
## Transizioni morbide ad alba (5→9) e tramonto (17→21). Refresh ogni 30s.
##
## Va aggiunto subito dopo OfficeFloor/DepartmentDressing: disegna la
## fascia ESTERNA alla box, e ciò che viene dopo di lui (mondo, maintainer)
## deve restarci sopra. Possiede l'unico CanvasModulate della scena.

const DAY_CM := Color(0.98, 0.98, 1.0)
## La notte deve VEDERSI (rifinitura 19:3x): prima 0.76/0.77/0.92 era
## quasi il giorno; ora scena notturna blu e scura, e le lampade emergono.
const NIGHT_CM := Color(0.60, 0.63, 0.84)
const NIGHT_LAMP_BOOST := 2.0  # le pozze raddoppiano col buio pieno
const DAY_OUT := Color("#3d4453")    # fuori c'è luce (grigio-azzurro)
const NIGHT_OUT := Color("#060608")  # fuori è notte fonda

const WARM := Color("#ffb45c")
const COOL := Color("#4d9fff")
const MINT := Color("#7fffb2")
const DAYLIGHT := Color("#cfe4ff")

## Lampade interne: [pos, raggio, colore, alpha di base] — accese col buio.
const LAMPS := [
	[Vector2(2640, 1170), 280.0, WARM, 0.20],   # tappeto/lounge del Mentor
	[Vector2(2860, 1010), 210.0, WARM, 0.13],   # libreria area comune
	[Vector2(1265, 225), 230.0, COOL, 0.13],    # stampante condivisa
	[Vector2(1495, 515), 250.0, WARM, 0.17],    # desk Coordinatore
	[Vector2(1905, 560), 270.0, MINT, 0.14],    # desk Tesoriere multi-schermo
	[Vector2(1295, 1790), 250.0, WARM, 0.15],   # desk Assistente (entrata)
	[Vector2(775, 560), 300.0, WARM, 0.15],     # reparto Scout nord-ovest
	[Vector2(2115, 430), 280.0, MINT, 0.12],    # lab Analisti (luce fredda)
	[Vector2(1455, 1172), 290.0, WARM, 0.15],   # reparto Scorer centrale
	[Vector2(670, 1680), 290.0, WARM, 0.15],    # reparto Scrittori
	[Vector2(2080, 1680), 290.0, WARM, 0.15],   # reparto Critici
	[Vector2(1300, 780), 330.0, MINT, 0.13],    # ologramma
]

## Fuori dalla box: TINTA UNITA (ordine di Leone, test 16:10: via il
## bokeh, "luci strane") — il VOID slate di OfficeFloor fa da fondo e
## la box la definiscono vetrata perimetrale + spigoli tesseract.

var _cm: CanvasModulate
var _lamps: Array = []      # [[LightPool, alpha_base], …]
var _day_wash: Array = []   # luce dalle vetrate, accesa di giorno
var _clock := 0.0

func _ready() -> void:
	# scenografia: il profilo ridotto la spegne in blocco
	GfxProfile.mark(self)
	if OS.get_environment("JHT_NOFX") == "1":  # TEST-AUTO
		return
	_cm = CanvasModulate.new()
	add_child(_cm)
	add_child(ScreenGrade.new())
	for spec in LAMPS:
		var pool := LightPool.new(spec[0], spec[1], spec[2], spec[3])
		add_child(pool)
		_lamps.append([pool, spec[3]])
	# neon perimetrale della box: fascino notturno, resta col buio
	var f := FurnitureDefs.FLOOR
	for wash in [
		LightPool.new(Vector2(f.get_center().x, f.position.y), 1150.0, COOL, 0.05, 0.10),
		LightPool.new(Vector2(f.get_center().x, f.end.y), 1150.0, COOL, 0.05, 0.10),
	]:
		add_child(wash)
		_lamps.append([wash, 0.05])
	# luce del giorno dalle vetrate: lame larghe e fredde da nord e dai lati
	for spec in [
		[Vector2(f.get_center().x, f.position.y + 60), 1250.0, 0.10, 0.35],
		[Vector2(f.position.x + 40, f.get_center().y), 700.0, 0.07, 0.9],
		[Vector2(f.end.x - 40, f.get_center().y), 700.0, 0.07, 0.9],
	]:
		var wash := LightPool.new(spec[0], spec[1], DAYLIGHT, spec[2], spec[3])
		add_child(wash)
		_day_wash.append([wash, spec[2]])
	_apply()

func _process(delta: float) -> void:
	_clock += delta
	if _clock >= 30.0:
		_clock = 0.0
		_apply()

## 0 = pieno giorno, 1 = notte fonda; dall'ora locale (o JHT_HOUR).
static func darkness() -> float:
	var hour := float(Time.get_time_dict_from_system()["hour"]) \
			+ float(Time.get_time_dict_from_system()["minute"]) / 60.0
	var env := OS.get_environment("JHT_HOUR")
	if env != "":
		hour = float(env)
	if hour >= 21.0 or hour < 5.0:
		return 1.0
	if hour >= 9.0 and hour < 17.0:
		return 0.0
	if hour < 9.0:
		return 1.0 - (hour - 5.0) / 4.0  # alba: si accende il giorno
	return (hour - 17.0) / 4.0           # tramonto: cala il buio

func _apply() -> void:
	var d := darkness()
	if _cm:
		_cm.color = DAY_CM.lerp(NIGHT_CM, d)
	for e in _lamps:
		e[0].modulate.a = e[1] * d * NIGHT_LAMP_BOOST
		e[0].visible = d > 0.03
	for e in _day_wash:
		e[0].modulate.a = e[1] * (1.0 - d)
		e[0].visible = d < 0.97
	queue_redraw()
	Log.debug("scene", "giorno/notte: darkness=%.2f" % d)

## L'esterno della box: 4 fasce fra il mondo e il pavimento.
func _draw() -> void:
	var d := darkness()
	var out := DAY_OUT.lerp(NIGHT_OUT, d)
	var w := FurnitureDefs.WORLD
	var f := FurnitureDefs.FLOOR
	draw_rect(Rect2(w.position, Vector2(w.size.x, f.position.y - w.position.y)), out)
	draw_rect(Rect2(Vector2(w.position.x, f.end.y), Vector2(w.size.x, w.end.y - f.end.y)), out)
	draw_rect(Rect2(Vector2(w.position.x, f.position.y), Vector2(f.position.x - w.position.x, f.size.y)), out)
	draw_rect(Rect2(Vector2(f.end.x, f.position.y), Vector2(w.end.x - f.end.x, f.size.y)), out)
