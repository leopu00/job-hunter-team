class_name TesseractEdges
extends Node2D
## I bordi della box in stile tesseract (ciclo grafica 11/07): la squadra
## vive in una scatola, e agli angoli del pavimento partono raggi di luce
## BLU che suggeriscono le pareti — molto trasparenti, l'interno deve
## restare ben visibile. Raggi lungo i due bordi + spigolo verticale che
## sale, con dissolvenza al progredire e una pulsazione lenta.
##
## Solo primitive _draw (niente texture qui: gotcha GLES3 batching) con
## blending additivo: sui pixel chiari il raggio si somma come luce.

const BLUE := Color(0.30, 0.62, 1.0)
const CYAN := Color(0.45, 0.85, 1.0)
const RAY_LEN := 360.0    # corsa dei raggi lungo i bordi del pavimento
const RISE_LEN := 480.0   # corsa dello spigolo verticale (sale dal piano)
const A_ROOT := 0.30      # alpha alla radice: "molto trasparente"
const STEPS := 9          # punti della polyline sfumata

var _t := 0.0

func _ready() -> void:
	z_index = 60  # sopra il mondo (l'alpha basso non copre l'interno)
	var mat := CanvasItemMaterial.new()
	mat.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD
	material = mat

func _process(delta: float) -> void:
	_t += delta
	queue_redraw()

func _draw() -> void:
	var f := FurnitureDefs.FLOOR
	var pulse := 0.80 + 0.20 * sin(_t * 1.4)
	var corners := [
		{"pos": f.position, "dirs": [Vector2.RIGHT, Vector2.DOWN]},
		{"pos": Vector2(f.end.x, f.position.y), "dirs": [Vector2.LEFT, Vector2.DOWN]},
		{"pos": f.end, "dirs": [Vector2.LEFT, Vector2.UP]},
		{"pos": Vector2(f.position.x, f.end.y), "dirs": [Vector2.RIGHT, Vector2.UP]},
	]
	for c in corners:
		var pos: Vector2 = c["pos"]
		# nodo d'angolo: un bagliore puntuale dove convergono gli spigoli
		draw_circle(pos, 10.0, Color(CYAN, A_ROOT * 0.8 * pulse))
		draw_circle(pos, 22.0, Color(BLUE, A_ROOT * 0.25 * pulse))
		for dir in c["dirs"]:
			_ray(pos, dir, RAY_LEN, BLUE, pulse)
		# lo spigolo verticale della scatola: sale sempre verso l'alto
		# (sui due angoli bassi attraversa l'interno: per questo l'alpha
		# è così basso — suggerisce, non copre)
		_ray(pos, Vector2.UP, RISE_LEN, CYAN, pulse * 0.9)

## Un raggio sfumato: polyline con alpha che muore verso la punta,
## doppio passaggio (alone largo + filo vivo).
func _ray(from: Vector2, dir: Vector2, length: float, tint: Color, pulse: float) -> void:
	var pts := PackedVector2Array()
	var core := PackedColorArray()
	var glow := PackedColorArray()
	for i in STEPS:
		var t := float(i) / float(STEPS - 1)
		pts.append(from + dir * length * t)
		var a := A_ROOT * pow(1.0 - t, 1.7) * pulse
		core.append(Color(tint, a))
		glow.append(Color(tint, a * 0.35))
	draw_polyline_colors(pts, glow, 16.0)
	draw_polyline_colors(pts, core, 4.5)
