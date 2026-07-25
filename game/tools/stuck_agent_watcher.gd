extends Node
## Verifica l'anti-incastro degli agenti (JHT_STUCK_TEST=<reparto>).
##
## Simula la condizione reale: l'agente è in viaggio e spinge, ma il corpo non
## si sposta di un pixel — quello che succede quando finisce contro una
## scrivania. Qui lo si inchioda DAVVERO, riportandolo al suo posto a ogni
## frame di fisica: la prima versione si limitava a guardarlo e passava anche
## col watchdog spento, cioè non provava niente (25/07).
##
## Il verdetto non è sulla posizione — che il test stesso tiene ferma — ma
## sullo stato: senza rete l'agente resta in TRIP per sempre; con la rete
## `_arrive_at_leg()` chiude la tratta e lo stato cambia.

const HOLD_S := 9.0  # due cicli di STUCK_AFTER più margine


func _ready() -> void:
	var dept := OS.get_environment("JHT_STUCK_TEST")
	await get_tree().create_timer(1.0).timeout
	var office := get_tree().current_scene
	var actor: AgentNPC = null
	for candidate in office.agents:
		if candidate.dept == dept:
			actor = candidate
			break
	if actor == null:
		print("STUCK-TEST FAIL nessun agente in ", dept)
		get_tree().quit(1)
		return
	actor.set_backend_status("working")
	actor.perform_pipeline_step(true)
	for _i in 4:
		await get_tree().physics_frame
	var travelling := actor.state == AgentNPC.S.TRIP
	var first_leg: Vector2 = actor._leg.get("target", Vector2.INF)
	var jail := actor.global_position
	var until := Time.get_ticks_msec() + int(HOLD_S * 1000.0)
	while Time.get_ticks_msec() < until:
		await get_tree().physics_frame
		actor.global_position = jail  # incastrato: non avanza di un pixel
	# Sbloccato = la tratta in cui era piantato è stata chiusa: o il viaggio è
	# finito, o è passato alla tappa dopo. Restare in TRIP non è di per sé un
	# fallimento — un viaggio ha più tappe.
	var current_leg: Vector2 = actor._leg.get("target", Vector2.INF)
	# Chiusa la tappa, l'agente può: finire il viaggio, passare alla successiva,
	# o fermarsi nella sosta prevista da quella tappa (stampante, inbox…).
	# Tutte e tre significano "non è più piantato".
	var freed := actor.state != AgentNPC.S.TRIP or current_leg != first_leg \
			or actor._pause > 0.0
	print("STUCK-TEST ", "PASS" if (travelling and freed) else "FAIL", " ",
			JSON.stringify({"partito": travelling, "tratta_chiusa": freed,
					"stato": actor.state}))
	get_tree().quit(0 if (travelling and freed) else 1)
