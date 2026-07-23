class_name DeptRugs
extends Node2D
## Tappeti persiani rettangolari dei reparti: cinque illustrazioni coordinate,
## ciascuna costruita sulle sfumature del proprio reparto. Vivono sotto il
## World: mobili e agenti ci camminano sopra, senza collisioni.
##
## Il vecchio tappeto ellittico resta tra gli asset come storico/fallback: non
## viene piu' usato nella scena ordinaria, ma un checkout privo di uno dei nuovi
## PNG continua a mostrare un pavimento leggibile invece di lasciare un buco.

const LEGACY_TEX := "res://assets/gen-art/furniture/nc_rug_dept.png"
const RUG_DIR := "res://assets/gen-art/furniture/dept-rugs"
# Il tappeto deve arredare, non competere con le postazioni: la trasparenza lo
# fonde con il marmo e il tono neutro smorza insieme saturazione e contrasto.
const PERSIAN_FLOOR_TONE := Color(0.82, 0.82, 0.82, 0.72)

## [centro visivo, dimensione resa sul pavimento, texture dedicata]. La
## dimensione X/Y e' esplicita: i PNG contengono gia' la fuga prospettica e
## qui diamo a ciascun tappeto la profondita' necessaria al suo anello.
## Candidature passa da 800 a 980 world-pixel: il bordo ora abbraccia anche
## le due coppie di tavoli laterali e ha lo stesso respiro degli altri reparti.
const RUGS := {
	"scout": [Vector2(775, 560), Vector2(940, 410), RUG_DIR + "/persian_scout.png"],
	# Il laboratorio riempie meglio la propria campata; gli Scorer occupano
	# davvero l'asse centrale del pavimento (FLOOR center.x = 1700).
	"analisti": [Vector2(2655, 430), Vector2(880, 400), RUG_DIR + "/persian_analisti.png"],
	"scorer": [Vector2(1700, 1120), Vector2(1080, 500), RUG_DIR + "/persian_scorer.png"],
	"scrittori": [Vector2(690, 1726), Vector2(980, 440), RUG_DIR + "/persian_scrittori.png"],
	"critici": [Vector2(2625, 1740), Vector2(940, 430), RUG_DIR + "/persian_critici.png"],
}

func _ready() -> void:
	for dept_id in RUGS:
		var spec: Array = RUGS[dept_id]
		var tex_path := str(spec[2])
		var uses_legacy := not ResourceLoader.exists(tex_path)
		if uses_legacy:
			tex_path = LEGACY_TEX
		if not ResourceLoader.exists(tex_path):
			continue
		var tex: Texture2D = load(tex_path)
		var spr := Sprite2D.new()
		spr.name = "PersianRug_%s" % dept_id
		spr.texture = tex
		# Linear filtering evita che il fit molto ridotto renda ogni arabesco
		# un bordo tagliente: mobili e personaggi restano il piano piu' nitido.
		spr.texture_filter = CanvasItem.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
		spr.position = spec[0]
		var display_size: Vector2 = spec[1]
		spr.scale = Vector2(display_size.x / tex.get_width(),
				display_size.y / tex.get_height())
		if uses_legacy:
			var col: Color = DepartmentDefs.DEPARTMENTS[dept_id]["color"]
			spr.modulate = Color(col.lerp(Color(1, 1, 1), 0.45), 0.85)
		else:
			# Le palette sono dipinte nell'asset; questa modulazione le porta sul
			# piano del pavimento senza cancellarne l'identita' di reparto.
			spr.modulate = PERSIAN_FLOOR_TONE
		add_child(spr)
