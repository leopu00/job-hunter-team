class_name DepartmentDressing
extends Node2D
## Veste grafica dei 5 reparti: tinta a pavimento nel colore del reparto,
## brackets a L agli angoli (linguaggio terminale del brand), targa col nome
## e usura pittorica seedata. Legge tutto da DepartmentDefs; va aggiunta
## SOPRA il pavimento e SOTTO il World y-sortato (niente collisioni).

const BRACKET_LEN := 46.0
const BRACKET_W := 3.0

var _font: Font
var _font_small: Font

func _init() -> void:
	# Niente z_index: a pari z vale l'ordine dei figli in office.gd
	# (OfficeFloor → questo → World y-sortato). Con z -1 finiva SOTTO il
	# pavimento e spariva.
	_font = load(TerminalTheme.FONT_XBOLD)
	_font_small = load(TerminalTheme.FONT_MEDIUM)

func _draw() -> void:
	for dept_id in DepartmentDefs.DEPT_ORDER:
		var dept: Dictionary = DepartmentDefs.DEPARTMENTS[dept_id]
		_draw_zone(dept_id, dept["zone"], dept["color"],
				DepartmentDefs.display_name(dept_id), DepartmentDefs.display_tagline(dept_id))

func _draw_zone(dept_id: String, zone: Rect2, col: Color, dname: String, tagline: String) -> void:
	# tinta a pavimento: tre passate che rientrano, il bordo sfuma morbido
	for i in 3:
		var r := zone.grow(-8.0 * i)
		draw_rect(r, Color(col.r, col.g, col.b, 0.030))
	# usura pittorica: chiazze seedate per reparto, mai pattern regolare
	var rng := RandomNumberGenerator.new()
	rng.seed = hash(dept_id)
	for i in 14:
		var p := Vector2(
			rng.randf_range(zone.position.x + 24, zone.end.x - 24),
			rng.randf_range(zone.position.y + 24, zone.end.y - 24))
		draw_set_transform(p, rng.randf_range(0, TAU), Vector2(1.0, rng.randf_range(0.3, 0.6)))
		var dark := rng.randf() < 0.5
		var c := Color(0, 0, 0, rng.randf_range(0.03, 0.07)) if dark \
				else Color(col.r, col.g, col.b, rng.randf_range(0.02, 0.05))
		draw_circle(Vector2.ZERO, rng.randf_range(18.0, 64.0), c)
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	# brackets a L ai quattro angoli, nel colore del reparto
	var bc := Color(col.r, col.g, col.b, 0.42)
	for corner in [
		[zone.position, Vector2.RIGHT, Vector2.DOWN],
		[Vector2(zone.end.x, zone.position.y), Vector2.LEFT, Vector2.DOWN],
		[Vector2(zone.position.x, zone.end.y), Vector2.RIGHT, Vector2.UP],
		[zone.end, Vector2.LEFT, Vector2.UP],
	]:
		var o: Vector2 = corner[0]
		draw_line(o, o + corner[1] * BRACKET_LEN, bc, BRACKET_W)
		draw_line(o, o + corner[2] * BRACKET_LEN, bc, BRACKET_W)
	# targa del reparto in basso a sinistra della zona: le postazioni nuove
	# sbordano in alto e coprivano le targhe messe all'angolo superiore
	# (il vetro del lab copriva comunque quella degli Analisti).
	var name_pos := Vector2(zone.position.x + 18, zone.end.y - 34)
	var upper := dname.to_upper()
	draw_string(_font, name_pos + Vector2(1, 1), upper,
			HORIZONTAL_ALIGNMENT_LEFT, -1, 26, Color(0, 0, 0, 0.55))
	draw_string(_font, name_pos, upper,
			HORIZONTAL_ALIGNMENT_LEFT, -1, 26, Color(col.r, col.g, col.b, 0.90))
	draw_string(_font_small, name_pos + Vector2(0, 24), tagline,
			HORIZONTAL_ALIGNMENT_LEFT, -1, 15, Color(Palette.DIM.r, Palette.DIM.g, Palette.DIM.b, 0.85))
