class_name SidebarIcon
extends Control
## Icone della navigazione disegnate a vettori, MAI emoji.
##
## Le emoji dipendono dai font di sistema: su Linux (Ubuntu 24.04) fontconfig
## risolve 16 dei 25 glifi della sidebar su NotoColorEmoji.ttf — bitmap CBDT che
## Godot non rende — e a schermo restavano rettangoli vuoti; passavano solo i
## codepoint coperti da DejaVu Sans e Noto Sans Symbols2 (live-test ThinkPad
## Linux, 24/07). Disegnandole qui la resa è identica su ogni OS.
##
## Tutte le forme vivono in uno spazio normalizzato 0..1 scalato sul lato corto
## del Control: cambiare `size` cambia solo la scala, mai le proporzioni.

const BASE_SIZE := 18.0
const DOCKER_MARK_DARK: Texture2D = preload("res://assets/icons/docker-mark-white.svg")
const DOCKER_MARK_LIGHT: Texture2D = preload("res://assets/icons/docker-mark-ocean-blue.svg")
const TELEGRAM_LOGO: Texture2D = preload("res://assets/icons/telegram.svg")

var icon_id: String = "":
	set(value):
		icon_id = value
		queue_redraw()

var color: Color = Color.WHITE:
	set(value):
		color = value
		queue_redraw()


func _init(id: String = "", col: Color = Color.WHITE) -> void:
	icon_id = id
	color = col
	# l'icona sta dentro il Button della voce: non deve mangiarne i click
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	# Il marchio Docker ha un minimo di 24 px previsto dal media kit ufficiale.
	custom_minimum_size = Vector2(24.0, 24.0) if id in ["container", "plane"] else Vector2(BASE_SIZE, BASE_SIZE)


func _draw() -> void:
	var s := minf(size.x, size.y)
	if s <= 0.0:
		return
	var w := maxf(1.0, s / 13.0)
	match icon_id:
		"bolt":
			_poly([Vector2(0.60, 0.06), Vector2(0.24, 0.56), Vector2(0.46, 0.56),
					Vector2(0.40, 0.94), Vector2(0.78, 0.44), Vector2(0.54, 0.44)],
					s, w, true)
		"users":
			_circle(Vector2(0.34, 0.30), 0.15, s, w)
			_arc(Vector2(0.34, 0.78), 0.26, PI, TAU, s, w)
			_arc(Vector2(0.72, 0.32), 0.12, -PI * 0.5, PI * 0.5, s, w)
			_arc(Vector2(0.72, 0.78), 0.22, PI * 1.5, TAU, s, w)
		"robot":
			_rect(Vector2(0.16, 0.32), Vector2(0.84, 0.84), s, w)
			_line(Vector2(0.50, 0.32), Vector2(0.50, 0.18), s, w)
			_dot(Vector2(0.50, 0.13), 0.07, s)
			_dot(Vector2(0.34, 0.52), 0.06, s)
			_dot(Vector2(0.66, 0.52), 0.06, s)
			_line(Vector2(0.36, 0.70), Vector2(0.64, 0.70), s, w)
		"chart-down":
			_axes(s, w)
			_poly([Vector2(0.24, 0.28), Vector2(0.44, 0.50), Vector2(0.58, 0.40),
					Vector2(0.84, 0.70)], s, w)
			_poly([Vector2(0.62, 0.70), Vector2(0.84, 0.70), Vector2(0.84, 0.48)],
					s, w)
		"chart-up":
			_axes(s, w)
			_poly([Vector2(0.24, 0.70), Vector2(0.44, 0.48), Vector2(0.58, 0.58),
					Vector2(0.84, 0.26)], s, w)
			_poly([Vector2(0.62, 0.26), Vector2(0.84, 0.26), Vector2(0.84, 0.48)],
					s, w)
		"flame":
			_poly([Vector2(0.50, 0.06), Vector2(0.74, 0.36), Vector2(0.70, 0.50),
					Vector2(0.80, 0.64), Vector2(0.68, 0.86), Vector2(0.50, 0.94),
					Vector2(0.32, 0.86), Vector2(0.20, 0.64), Vector2(0.34, 0.40)],
					s, w, true)
			_arc(Vector2(0.50, 0.72), 0.14, 0.0, TAU, s, w)
		"chat":
			_rect(Vector2(0.10, 0.16), Vector2(0.90, 0.70), s, w)
			_poly([Vector2(0.28, 0.70), Vector2(0.28, 0.92), Vector2(0.50, 0.70)],
					s, w)
			_dot(Vector2(0.34, 0.43), 0.05, s)
			_dot(Vector2(0.50, 0.43), 0.05, s)
			_dot(Vector2(0.66, 0.43), 0.05, s)
		"bell":
			_arc(Vector2(0.50, 0.50), 0.28, PI, TAU, s, w)
			_line(Vector2(0.22, 0.50), Vector2(0.22, 0.72), s, w)
			_line(Vector2(0.78, 0.50), Vector2(0.78, 0.72), s, w)
			_line(Vector2(0.12, 0.72), Vector2(0.88, 0.72), s, w)
			_arc(Vector2(0.50, 0.74), 0.10, 0.0, PI, s, w)
			_line(Vector2(0.50, 0.16), Vector2(0.50, 0.22), s, w)
		"dashboard":
			_rect(Vector2(0.10, 0.10), Vector2(0.46, 0.52), s, w)
			_rect(Vector2(0.54, 0.10), Vector2(0.90, 0.34), s, w)
			_rect(Vector2(0.10, 0.60), Vector2(0.46, 0.90), s, w)
			_rect(Vector2(0.54, 0.42), Vector2(0.90, 0.90), s, w)
		"target":
			_circle(Vector2(0.50, 0.50), 0.40, s, w)
			_circle(Vector2(0.50, 0.50), 0.22, s, w)
			_dot(Vector2(0.50, 0.50), 0.08, s)
		"bars":
			_line(Vector2(0.10, 0.88), Vector2(0.90, 0.88), s, w)
			_rect(Vector2(0.16, 0.52), Vector2(0.34, 0.88), s, w)
			_rect(Vector2(0.41, 0.28), Vector2(0.59, 0.88), s, w)
			_rect(Vector2(0.66, 0.44), Vector2(0.84, 0.88), s, w)
		"inbox":
			_rect(Vector2(0.10, 0.36), Vector2(0.90, 0.86), s, w)
			_poly([Vector2(0.10, 0.36), Vector2(0.50, 0.64), Vector2(0.90, 0.36)],
					s, w)
			_line(Vector2(0.50, 0.06), Vector2(0.50, 0.26), s, w)
			_poly([Vector2(0.40, 0.18), Vector2(0.50, 0.28), Vector2(0.60, 0.18)],
					s, w)
		"map":
			_poly([Vector2(0.08, 0.24), Vector2(0.36, 0.12), Vector2(0.64, 0.26),
					Vector2(0.92, 0.14), Vector2(0.92, 0.76), Vector2(0.64, 0.88),
					Vector2(0.36, 0.74), Vector2(0.08, 0.86)], s, w, true)
			_line(Vector2(0.36, 0.12), Vector2(0.36, 0.74), s, w)
			_line(Vector2(0.64, 0.26), Vector2(0.64, 0.88), s, w)
		"activity":
			for i in 3:
				var y := 0.24 + 0.26 * i
				_dot(Vector2(0.18, y), 0.07, s)
				_line(Vector2(0.36, y), Vector2(0.88, y), s, w)
		"server":
			_rect(Vector2(0.10, 0.16), Vector2(0.90, 0.44), s, w)
			_rect(Vector2(0.10, 0.56), Vector2(0.90, 0.84), s, w)
			_dot(Vector2(0.24, 0.30), 0.06, s)
			_dot(Vector2(0.24, 0.70), 0.06, s)
			_line(Vector2(0.44, 0.30), Vector2(0.78, 0.30), s, w)
			_line(Vector2(0.44, 0.70), Vector2(0.78, 0.70), s, w)
		"doc":
			_poly([Vector2(0.20, 0.08), Vector2(0.62, 0.08), Vector2(0.82, 0.30),
					Vector2(0.82, 0.92), Vector2(0.20, 0.92)], s, w, true)
			_poly([Vector2(0.62, 0.08), Vector2(0.62, 0.30), Vector2(0.82, 0.30)],
					s, w)
			_line(Vector2(0.32, 0.50), Vector2(0.70, 0.50), s, w)
			_line(Vector2(0.32, 0.68), Vector2(0.70, 0.68), s, w)
		"clock":
			_circle(Vector2(0.50, 0.50), 0.40, s, w)
			_line(Vector2(0.50, 0.50), Vector2(0.50, 0.26), s, w)
			_line(Vector2(0.50, 0.50), Vector2(0.68, 0.60), s, w)
		"chip":
			_rect(Vector2(0.28, 0.28), Vector2(0.72, 0.72), s, w)
			_rect(Vector2(0.42, 0.42), Vector2(0.58, 0.58), s, w)
			for t in [0.40, 0.60]:
				_line(Vector2(t, 0.28), Vector2(t, 0.12), s, w)
				_line(Vector2(t, 0.72), Vector2(t, 0.88), s, w)
				_line(Vector2(0.28, t), Vector2(0.12, t), s, w)
				_line(Vector2(0.72, t), Vector2(0.88, t), s, w)
		"container":
			_draw_docker_mark(s)
		"plane":
			_draw_square_brand(TELEGRAM_LOGO, s)
		"user":
			_circle(Vector2(0.50, 0.32), 0.20, s, w)
			_arc(Vector2(0.50, 0.94), 0.32, PI, TAU, s, w)
		"envelope":
			_rect(Vector2(0.08, 0.24), Vector2(0.92, 0.78), s, w)
			_poly([Vector2(0.08, 0.24), Vector2(0.50, 0.56), Vector2(0.92, 0.24)],
					s, w)
		"contrast":
			_circle(Vector2(0.50, 0.50), 0.40, s, w)
			_half_disc(Vector2(0.50, 0.50), 0.40, s)
		"display":
			# schermo su piedistallo: la grafica del mondo, non il tema della UI
			_rect(Vector2(0.10, 0.16), Vector2(0.90, 0.68), s, w)
			_line(Vector2(0.50, 0.68), Vector2(0.50, 0.84), s, w)
			_line(Vector2(0.30, 0.86), Vector2(0.70, 0.86), s, w)
		"globe":
			_circle(Vector2(0.50, 0.50), 0.40, s, w)
			_line(Vector2(0.10, 0.50), Vector2(0.90, 0.50), s, w)
			_ellipse(Vector2(0.50, 0.50), 0.17, 0.40, s, w)
		"power":
			# interruttore: arco aperto in alto + asta centrale
			_arc(Vector2(0.50, 0.56), 0.34, PI * 0.75, PI * 2.25, s, w)
			_line(Vector2(0.50, 0.10), Vector2(0.50, 0.46), s, w)
		"gear":
			_circle(Vector2(0.50, 0.50), 0.18, s, w)
			for i in 8:
				var a := TAU * i / 8.0
				var dir := Vector2(cos(a), sin(a))
				_line(Vector2(0.50, 0.50) + dir * 0.28,
						Vector2(0.50, 0.50) + dir * 0.44, s, w * 1.4)
		"search":
			# lente: il mestiere degli Scout (al posto dell'emoji 🔍)
			_circle(Vector2(0.42, 0.42), 0.26, s, w)
			_line(Vector2(0.62, 0.62), Vector2(0.90, 0.90), s, w)
		"pen":
			# matita in diagonale: gli Scrittori (al posto di ✍)
			_poly([Vector2(0.62, 0.12), Vector2(0.88, 0.38), Vector2(0.36, 0.90),
					Vector2(0.10, 0.90), Vector2(0.10, 0.64)], s, w, true)
			_line(Vector2(0.52, 0.22), Vector2(0.78, 0.48), s, w)
		"scale":
			# bilancia: i Critici giudicano (al posto di 🧐)
			_line(Vector2(0.50, 0.14), Vector2(0.50, 0.80), s, w)
			_line(Vector2(0.18, 0.26), Vector2(0.82, 0.26), s, w)
			_line(Vector2(0.34, 0.88), Vector2(0.66, 0.88), s, w)
			_line(Vector2(0.18, 0.26), Vector2(0.18, 0.44), s, w)
			_line(Vector2(0.82, 0.26), Vector2(0.82, 0.44), s, w)
			_arc(Vector2(0.18, 0.44), 0.13, 0.0, PI, s, w)
			_arc(Vector2(0.82, 0.44), 0.13, 0.0, PI, s, w)
		"compass":
			# bussola: Capitano e Coordinatore fanno rotta (al posto di 🧭)
			_circle(Vector2(0.50, 0.50), 0.40, s, w)
			_poly([Vector2(0.64, 0.32), Vector2(0.44, 0.44), Vector2(0.36, 0.68),
					Vector2(0.56, 0.56)], s, w, true)
		"shield":
			# scudo: la Sentinella (al posto di 🛡)
			_poly([Vector2(0.50, 0.08), Vector2(0.86, 0.22), Vector2(0.86, 0.52),
					Vector2(0.50, 0.92), Vector2(0.14, 0.52), Vector2(0.14, 0.22)],
					s, w, true)
		"grad":
			# tocco accademico: il Mentor (al posto di 🎓)
			_poly([Vector2(0.50, 0.14), Vector2(0.92, 0.36), Vector2(0.50, 0.58),
					Vector2(0.08, 0.36)], s, w, true)
			_line(Vector2(0.92, 0.36), Vector2(0.92, 0.58), s, w)
			_dot(Vector2(0.92, 0.63), 0.05, s)
			_arc(Vector2(0.50, 0.80), 0.24, PI, TAU, s, w)
		"medcross":
			# croce medica: il Dottore (al posto di 🩺)
			_circle(Vector2(0.50, 0.50), 0.40, s, w)
			_line(Vector2(0.50, 0.30), Vector2(0.50, 0.70), s, w)
			_line(Vector2(0.30, 0.50), Vector2(0.70, 0.50), s, w)
		"bug":
			# Scarabeo di profilo: corpo, testa, dorso e tre paia di zampe.
			# Il glifo 🐞 sarebbe stato un rettangolo vuoto su Linux.
			_circle(Vector2(0.50, 0.58), 0.26, s, w)
			_arc(Vector2(0.50, 0.30), 0.13, PI, TAU, s, w)
			_line(Vector2(0.50, 0.32), Vector2(0.50, 0.84), s, w)
			_line(Vector2(0.41, 0.20), Vector2(0.34, 0.09), s, w)
			_line(Vector2(0.59, 0.20), Vector2(0.66, 0.09), s, w)
			for dy in [-0.14, 0.02, 0.18]:
				_line(Vector2(0.26, 0.58 + dy), Vector2(0.10, 0.52 + dy), s, w)
				_line(Vector2(0.74, 0.58 + dy), Vector2(0.90, 0.52 + dy), s, w)
		_:
			# id sconosciuto: cerchietto neutro, mai un rettangolo vuoto
			_circle(Vector2(0.50, 0.50), 0.30, s, w)


## ── primitive in spazio normalizzato ──────────────────────────────────────

func _line(a: Vector2, b: Vector2, s: float, w: float) -> void:
	draw_line(a * s, b * s, color, w, true)


func _draw_docker_mark(s: float) -> void:
	# Le due varianti sono file ufficiali invariati del media kit. Il rect usa
	# un solo fattore di scala, quindi preserva sempre le proporzioni del marchio.
	var mark := DOCKER_MARK_LIGHT if Palette.is_light() else DOCKER_MARK_DARK
	var mark_height := s * float(mark.get_height()) / float(mark.get_width())
	draw_texture_rect(mark, Rect2(0.0, (s - mark_height) * 0.5, s, mark_height), false)


func _draw_square_brand(brand: Texture2D, s: float) -> void:
	# Il file SVG ufficiale resta invariato: nessuna tinta, filtro o effetto.
	draw_texture_rect(brand, Rect2(0.0, 0.0, s, s), false)


func _poly(pts: Array, s: float, w: float, closed: bool = false) -> void:
	var out := PackedVector2Array()
	for p: Vector2 in pts:
		out.append(p * s)
	if closed and out.size() > 1:
		out.append(out[0])
	draw_polyline(out, color, w, true)


func _rect(a: Vector2, b: Vector2, s: float, w: float) -> void:
	draw_rect(Rect2(a * s, (b - a) * s), color, false, w, true)


func _circle(c: Vector2, r: float, s: float, w: float) -> void:
	draw_arc(c * s, r * s, 0.0, TAU, 32, color, w, true)


func _arc(c: Vector2, r: float, from: float, to: float, s: float, w: float) -> void:
	draw_arc(c * s, r * s, from, to, 24, color, w, true)


func _dot(c: Vector2, r: float, s: float) -> void:
	draw_circle(c * s, r * s, color)


## Metà destra piena: la sola icona che vive di contrasto (tema chiaro/scuro).
func _half_disc(c: Vector2, r: float, s: float) -> void:
	var pts := PackedVector2Array()
	for i in 17:
		var a := -PI * 0.5 + PI * i / 16.0
		pts.append((c + Vector2(cos(a), sin(a)) * r) * s)
	draw_colored_polygon(pts, color)


func _ellipse(c: Vector2, rx: float, ry: float, s: float, w: float) -> void:
	var pts := PackedVector2Array()
	for i in 33:
		var a := TAU * i / 32.0
		pts.append((c + Vector2(cos(a) * rx, sin(a) * ry)) * s)
	draw_polyline(pts, color, w, true)


## Assi cartesiani condivisi dalle due icone di andamento.
func _axes(s: float, w: float) -> void:
	_poly([Vector2(0.12, 0.10), Vector2(0.12, 0.88), Vector2(0.90, 0.88)], s, w)
