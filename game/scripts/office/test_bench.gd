class_name TestBench
extends Node2D
## Il banco-test degli ANALISTI (missione pipeline 3/3): il tavolo lungo
## a muro nord del lab vestito da postazione di verifica — bobine di
## nastro colorate e fogli di lavoro. Gli analisti ci vanno a testare in
## piedi quando lavorano (viaggio dedicato in AgentNPC), altrimenti
## scrivono il report alla scrivania. Primitive _draw (gotcha GLES3).

const TABLE := Rect2(2430, 180, 600, 110)  # = long_table in FurnitureDefs
const SPOOLS := [
	[Vector2(60, -8), Color("#3fd0c9")],   # teal
	[Vector2(150, 4), Color("#ffb45c")],   # ambra
	[Vector2(245, -12), Color("#c86bd8")], # magenta tenue
	[Vector2(340, 0), Color("#7fffb2")],   # mint
	[Vector2(455, -6), Color("#4d9fff")],  # blu
]

func _init() -> void:
	position = TABLE.position + Vector2(40, TABLE.size.y * 0.42)
	z_index = 1  # sul piano del tavolo

## Dove ci si mette a testare: davanti al banco, sparsi sulla lunghezza.
static func work_spot() -> Vector2:
	return Vector2(randf_range(TABLE.position.x + 60, TABLE.end.x - 60),
			TABLE.end.y + 36.0)

func _draw() -> void:
	for s in SPOOLS:
		var p: Vector2 = s[0]
		var c: Color = s[1]
		# corpo della bobina (cilindro in 3/4: rettangolo + ellissi)
		draw_rect(Rect2(p + Vector2(-9, -12), Vector2(18, 14)), c.darkened(0.35))
		draw_set_transform(p + Vector2(0, 2), 0.0, Vector2(1.0, 0.45))
		draw_circle(Vector2.ZERO, 9.0, c.darkened(0.25))
		draw_set_transform(p + Vector2(0, -12), 0.0, Vector2(1.0, 0.45))
		draw_circle(Vector2.ZERO, 9.0, c)
		draw_circle(Vector2.ZERO, 3.4, Color(0.12, 0.12, 0.14))
		draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	# fogli di lavoro sparsi fra le bobine
	for i in 4:
		var fp := Vector2(105 + i * 95, 6 + sin(i * 2.1) * 4.0)
		draw_set_transform(fp, sin(i * 1.3) * 0.12, Vector2.ONE)
		draw_rect(Rect2(Vector2(-11, -7), Vector2(22, 14)),
				Color(0.94, 0.93, 0.88))
		draw_rect(Rect2(Vector2(-11, -7), Vector2(22, 14)),
				Color(0.55, 0.55, 0.6, 0.7), false, 1.0)
		draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
