class_name AgentAuraRing
extends Node2D
## Aura di reparto persistente sotto ogni agente. Vive separata dal rig:
## anche quando il corpo seduto viene sostituito dall'arte composita della
## scrivania, l'identita visiva dell'agente resta leggibile.

var accent := Palette.GREEN
var hovered := false
var _phase := 0.0


func setup(color: Color) -> void:
	accent = color
	queue_redraw()


func set_hovered(on: bool) -> void:
	if hovered == on:
		return
	hovered = on
	queue_redraw()


func _process(delta: float) -> void:
	_phase += delta
	# Sul profilo low-spec l'aura statica viene rasterizzata una volta sola:
	# 16 agenti × quattro primitive antialiasate costavano 129 draw call e
	# continuavano a ritessellarsi anche senza interazione. L'hover resta vivo
	# perché è feedback diretto del mouse.
	if GfxProfile.low() and not hovered:
		return
	# Il respiro a riposo e quasi impercettibile; in hover diventa un segnale
	# intenzionale, senza lampeggi aggressivi nell'ufficio pieno.
	# Cadenza a riposo 4 Hz: l'onda (sin a 1.7 rad/s) resta fluida, ma le 16
	# aure non ri-tessellano più i loro archi a ~8 Hz l'una (iGPU T440s).
	if hovered or fmod(_phase, 0.25) < delta:
		queue_redraw()


func _draw() -> void:
	var wave := 0.5 + 0.5 * sin(_phase * (4.8 if hovered else 1.7))
	if GfxProfile.low() and not hovered:
		# Identità di reparto conservata con due primitive, senza i tre anelli di
		# glow. È deliberatamente stabile: niente redraw periodici a riposo.
		draw_set_transform(Vector2.ZERO, 0.0, Vector2(1.0, 0.46))
		draw_circle(Vector2.ZERO, 31.0,
				Color(accent.r, accent.g, accent.b, 0.10))
		draw_arc(Vector2.ZERO, 34.0, 0.0, TAU, 20,
				Color(accent.r, accent.g, accent.b, 0.72), 3.2, true)
		return
	# Anche al minimo zoom il tratto deve restare sopra i due pixel percepiti:
	# la vecchia aura da 2 world-pixel e alpha 0.24 spariva sul tappeto. Lo
	# stato base ora e gia un neon leggibile; l'hover aggiunge dimensione,
	# spessore e luminosita, non ne costituisce piu l'unica visibilita.
	var alpha := (0.90 + wave * 0.10) if hovered else (0.66 + wave * 0.10)
	var radius := 38.0 if hovered else 34.0
	var width := 5.4 if hovered else 4.0
	draw_set_transform(Vector2.ZERO, 0.0, Vector2(1.0, 0.46))
	# Alone morbido + nucleo sottile. Il riempimento rende l'aura riconoscibile
	# anche sulle texture delle scrivanie, ma resta abbastanza trasparente da
	# non coprirne l'illustrazione.
	draw_circle(Vector2.ZERO, radius - 2.0,
			Color(accent.r, accent.g, accent.b, 0.15 if hovered else 0.075))
	draw_arc(Vector2.ZERO, radius, 0.0, TAU, 28,
			Color(accent.r, accent.g, accent.b, alpha), width, true)
	draw_arc(Vector2.ZERO, radius - 5.0, 0.0, TAU, 28,
			Color(accent.r, accent.g, accent.b, alpha * 0.42),
			2.2 if hovered else 1.6, true)
	draw_arc(Vector2.ZERO, radius + 5.0, 0.0, TAU, 28,
			Color(accent.r, accent.g, accent.b, alpha * (0.52 if hovered else 0.36)),
			12.0 if hovered else 8.0, true)
