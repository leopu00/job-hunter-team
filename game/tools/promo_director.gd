extends Node
## Regia delle riprese per il video di presentazione (JHT_PROMO=…), pensata
## per la Movie Maker mode di Godot (`--write-movie out.png --fixed-fps 30`):
## rendering fotogramma per fotogramma, deterministico, niente cattura schermo.
##
## Gira sulla scena ufficio in showroom (JHT_NOVPS=1, nessun backend): tutto
## ciò che appare è scenografia. Ogni testo mostrato è INVENTATO e in INGLESE
## (il video di presentazione è in inglese): nessun nome di persona reale,
## nessuna azienda di candidature vere, nessun dato dell'utente.
##
##   JHT_PROMO=office  overview dell'ufficio con lenta spinta della camera
##                     verso il centro; chiacchiericcio inglese fra i reparti.
##   JHT_PROMO=dept    campo stretto sul reparto Scrittori, carrellata lenta
##                     verso i Critici: la fabbrica dei CV vista da vicino.
##   JHT_PROMO=chat    pagina chat a fumetti sullo Scout lead: la
##                     conversazione si scrive da sola, vignetta per vignetta,
##                     con il momento "sta scrivendo…" (contratto partial).
##
## Le targhe di stato sopra la testa ("AL LAVORO"…) non sono ancora
## localizzate: in una ripresa inglese stonerebbero, quindi la regia le
## spegne per la durata del ciak. Solo qui: il gioco vero non cambia.

const OFFICE_PUSH_SECONDS := 11.5
const OFFICE_ZOOM_GAIN := 1.55
const OFFICE_END_CENTER := Vector2(1420.0, 980.0)

## [secondi, uid, testo] — broadcast ("all"): il fumetto non mostra
## destinatario (l'etichetta destinatario è ancora solo in italiano).
const OFFICE_CHATTER := [
	[0.9, "scout-1", "Boards swept: 6 new roles, 4 remote in the EU."],
	[3.1, "analista-1", "Posting parsed: stack, salary and visa notes extracted."],
	[5.3, "scorer-1", "Best match this morning: 88/100."],
	[7.5, "scrittore-1", "CV tailored for the platform role, off to review."],
	[9.3, "critico-1", "Blind review, round two: two fixes left."],
]

## Carrellata DENTRO la zona Scrittori (Rect2(320,1520,860,440)): il bordo
## destro resta sotto x≈1420 così la mensola "CV PRONTI" (etichetta da
## x≈1430, non ancora localizzata) non entra mai in campo. Il viewport del
## movie è quello di project.godot (1920x1080, mezzo campo = 960/zoom).
const DEPT_SECONDS := 7.5
const DEPT_FROM := Vector2(620.0, 1700.0)
const DEPT_TO := Vector2(780.0, 1730.0)
const DEPT_ZOOM := 1.5
const DEPT_CHATTER := [
	[0.8, "scrittore-1", "Cover letter drafted: one page, role-specific."],
	[3.6, "scrittore-2", "CV variant ready for the remote-first posting."],
]

const CHAT_AGENT := "scout-1"
## Passi della conversazione: [pausa_prima, role, testo, partial].
## `partial` è il checkpoint "sta scrivendo…": la vignetta successiva
## dello stesso agente lo sostituisce, come nel contratto del backend vero.
const CHAT_STEPS := [
	[0.7, "assistant", "Morning sweep done: 6 new roles, 4 of them remote (EU).", false],
	[1.5, "user", "Which one should I look at first?", false],
	[1.2, "assistant", "checking the scores…", true],
	[1.5, "assistant", "Platform Engineer at a fintech scale-up — 88/100 match. The tailored CV is already in review.", false],
	[1.7, "user", "Great. Prioritise remote roles this week, please.", false],
	[1.2, "assistant", "Done — remote-first from now on. I'll ping you when the review lands.", false],
]

## Insegne di passaggio fra reparti (HandoffStation): stesso doppiaggio
## delle targhe di tools/promo_dept_signs.gd, coerente reparto per reparto.
const HANDOFF_EN := {
	"scout": ["RESEARCH", "ANALYSIS"],
	"analisti": ["ANALYSIS", "COMPATIBILITY"],
	"scorer": ["COMPATIBILITY", "APPLICATIONS"],
	"scrittori": ["APPLICATIONS", "QUALITY CHECK"],
}

var _office: Node


func _ready() -> void:
	_office = get_parent()
	match OS.get_environment("JHT_PROMO"):
		"office":
			_office_clip.call_deferred()
		"dept":
			_dept_clip.call_deferred()
		"chat":
			_chat_clip.call_deferred()


## Overview → lenta spinta dentro l'ufficio, coi reparti che chiacchierano.
func _office_clip() -> void:
	await get_tree().process_frame
	_dress_set_english()
	_silence_state_tags()
	var world: Rect2 = FurnitureDefs.WORLD
	var vp := get_viewport().get_visible_rect().size
	var z := minf(vp.x / world.size.x, vp.y / world.size.y)
	var cam := _mount_camera(world.get_center(), z)
	var tw := create_tween().set_parallel(true) \
			.set_ease(Tween.EASE_IN_OUT).set_trans(Tween.TRANS_SINE)
	tw.tween_property(cam, "zoom",
			Vector2(z * OFFICE_ZOOM_GAIN, z * OFFICE_ZOOM_GAIN), OFFICE_PUSH_SECONDS)
	tw.tween_property(cam, "position", OFFICE_END_CENTER, OFFICE_PUSH_SECONDS)
	for line in OFFICE_CHATTER:
		_bubble_at(float(line[0]), str(line[1]), str(line[2]))


## Campo stretto sui reparti della scrittura: carrellata Scrittori → Critici.
func _dept_clip() -> void:
	await get_tree().process_frame
	_dress_set_english()
	_silence_state_tags()
	var cam := _mount_camera(DEPT_FROM, DEPT_ZOOM)
	var tw := create_tween().set_ease(Tween.EASE_IN_OUT).set_trans(Tween.TRANS_SINE)
	tw.tween_property(cam, "position", DEPT_TO, DEPT_SECONDS)
	for line in DEPT_CHATTER:
		_bubble_at(float(line[0]), str(line[1]), str(line[2]))


## La pagina a fumetti che si scrive da sola: storia pubblicata dalla porta
## vera del bus (publish_agent_chat), una vignetta alla volta.
func _chat_clip() -> void:
	await get_tree().process_frame
	_dress_set_english()
	var display := AgentNames.display_name(CHAT_AGENT)
	# NIENTE colonna roster: con al più una voce ComicChat non la mostra.
	# In lista finirebbero "Il Coordinatore" (nome proprio del brand, uguale
	# in tutte le lingue: scelta, non bug) ma anche "Ricercatore 02" e
	# simili — etichette dei worker da CharacterDefs.DEPT_ROLES che NON
	# passano dai dizionari i18n: un utente inglese le vede in italiano.
	# Gap del prodotto, segnalato a parte; il ciak inquadra solo la pagina.
	var panel := ChatPanel.new(CHAT_AGENT, display, [])
	_office.add_child(panel)
	var history: Array = []
	for step in CHAT_STEPS:
		await get_tree().create_timer(float(step[0])).timeout
		if not history.is_empty() \
				and bool((history[-1] as Dictionary).get("partial", false)):
			history.pop_back()
		var msg := {"role": str(step[1]), "text": str(step[2]),
				"ts": Time.get_unix_time_from_system()}
		if bool(step[3]):
			msg["partial"] = true
		else:
			msg["done"] = true
		history.append(msg)
		BackendBus.publish_agent_chat(CHAT_AGENT, history.duplicate(true))


func _mount_camera(at: Vector2, zoom: float) -> Camera2D:
	var cam := Camera2D.new()
	cam.position = at
	cam.zoom = Vector2(zoom, zoom)
	_office._stage.add_child(cam)
	cam.make_current()
	return cam


func _bubble_at(when: float, uid: String, text: String) -> void:
	await get_tree().create_timer(when).timeout
	BackendBus.publish_chat({"ts": Time.get_datetime_string_from_system(),
			"from": uid, "to": "all", "text": text})


func _silence_state_tags() -> void:
	for agent in _office.agents:
		if agent.state_tag:
			agent.state_tag.queue_free()
			agent.state_tag = null
	# La barra dei comandi camera in basso ("drag or WASD…") sta proprio
	# dove il montaggio appoggia le didascalie: via per la durata del ciak.
	var hint_text: String = UIStrings.t("office.camera_hint")
	for layer in _office.get_children():
		if layer is CanvasLayer:
			for child in layer.get_children():
				if child is Label and child.text == hint_text:
					child.visible = false


## Doppia in inglese le scritte di scena non ancora localizzate (targhe
## reparto, insegne di passaggio) e spegne il CTA del setup: il ciak mostra
## un ufficio già configurato. Tutto avviene solo su questa run.
func _dress_set_english() -> void:
	var stage: Node = _office._stage
	for child in stage.get_children():
		if child is DepartmentDressing:
			var index := child.get_index()
			var signs: Node2D = load("res://tools/promo_dept_signs.gd").new()
			stage.add_child(signs)
			stage.move_child(signs, index)
			child.queue_free()
			break
	for child in _office.world.get_children():
		if child is HandoffStation and HANDOFF_EN.has(child.dept):
			var pair: Array = HANDOFF_EN[child.dept]
			child.dept = str(pair[0])
			child.destination = str(pair[1])
			child.queue_redraw()
	for child in _office.get_children():
		if child is GameSidebar and is_instance_valid(child._setup_cta):
			# queue_free, non visible=false: SetupService pubblica lo stato in
			# asincrono e _on_setup_status lo riaccenderebbe a metà ripresa
			# (il guard is_instance_valid lì dentro copre il nodo rimosso).
			child._setup_cta.queue_free()
