class_name DeptRugs
extends Node2D
## Il tappetone tondo di ogni reparto (reference Codex): UNA sola texture
## neutra di dev-art (nc_rug_dept.png, ellittica grigia) tinta via
## modulate col colore del reparto — stessa resa del reference senza
## cinque asset quasi uguali. Vive sotto il World: mobili e agenti ci
## camminano sopra, niente collisioni.

const TEX := "res://assets/gen-art/furniture/nc_rug_dept.png"

## Centro visivo del gruppo scrivanie e larghezza resa del tappeto.
const RUGS := {
	"scout": [Vector2(775, 560), 940.0],
	"analisti": [Vector2(2735, 430), 760.0],
	"scorer": [Vector2(1455, 1172), 940.0],
	"scrittori": [Vector2(690, 1726), 800.0],
	"critici": [Vector2(2700, 1740), 940.0],
}

func _ready() -> void:
	if not ResourceLoader.exists(TEX):
		return
	var tex: Texture2D = load(TEX)
	for dept_id in RUGS:
		var spec: Array = RUGS[dept_id]
		var spr := Sprite2D.new()
		spr.texture = tex
		spr.position = spec[0]
		spr.scale = Vector2.ONE * (spec[1] / tex.get_width())
		var col: Color = DepartmentDefs.DEPARTMENTS[dept_id]["color"]
		spr.modulate = Color(col.lerp(Color(1, 1, 1), 0.45), 0.85)
		add_child(spr)
