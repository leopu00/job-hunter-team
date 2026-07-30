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
##   JHT_PROMO=office  breve totale dell'ufficio, poi la camera SPINGE
##                     dentro il reparto Research fino a due scrivanie:
##                     agenti grandi e vignette leggibili anche a 720p.
##   JHT_PROMO=dept    campo STRETTO sul reparto Scrittori, lenta carrellata
##                     fra due scrivanie: la fabbrica dei CV vista da vicino.
##   JHT_PROMO=chat    pagina chat a fumetti sullo Scout lead: la
##                     conversazione si scrive da sola, vignetta per vignetta,
##                     con il momento "sta scrivendo…" (contratto partial).
##
## Le targhe di stato sopra la testa ("AL LAVORO"…) non sono ancora
## localizzate: in una ripresa inglese stonerebbero, quindi la regia le
## spegne per la durata del ciak. Solo qui: il gioco vero non cambia.
##
## REGOLA D'ORO (feedback utente 30/07): «nel video si vede molto poco».
## La pianta intera vista da satellite non racconta niente: le persone sono
## alte pochi pixel e le vignette macchie bianche. Quindi il campo largo dura
## un attimo (giusto il senso del luogo) e la scena vive VICINA agli agenti:
## a zoom >= 2 una vignetta (font 14 world px) rende ~19 px sul montaggio
## 720p — leggibile su un telefono; a zoom 0.42 rendeva ~4 px: una macchia.

## Totale d'apertura: fit in LARGHEZZA (1920/3400), non in altezza — riempie
## il quadro senza bande nere ai lati; il centro y scende a 950 per tenere in
## campo i reparti, non il muro alto.
const OFFICE_WIDE_CENTER := Vector2(1700.0, 950.0)
const OFFICE_HOLD_SECONDS := 2.6
const OFFICE_PUSH_SECONDS := 3.6
const OFFICE_DRIFT_SECONDS := 6.8
## Meta della spinta: le DUE scrivanie occupate del Research (showroom:
## lead a desk 1, collega a desk 0 — sedute a ~(542,482) e ~(569,629),
## quasi in colonna: la stessa inquadratura regge il ritaglio verticale
## 9:16 del montaggio per cellulare). Il globo olografico (675..875,435..615)
## resta nel quadro a destra: è il landmark del reparto.
## Il centro y sta a ~520-530 e lo zoom sotto 2.05: la vignetta del collega
## in alto (bordo superiore a wy≈291) deve restare SOTTO il banner UI
## "SIMULATION — not real data" (schermo y 15..48) — al primo ciak, con
## centro 540..560 e zoom 2.1, il banner la copriva a metà (visto sui frame).
const OFFICE_CLOSE_CENTER := Vector2(660.0, 528.0)
const OFFICE_CLOSE_ZOOM := 1.95
const OFFICE_DRIFT_CENTER := Vector2(640.0, 520.0)
const OFFICE_DRIFT_ZOOM := 2.02

## [secondi, uid, testo] — broadcast ("all"): il fumetto non mostra
## destinatario (l'etichetta destinatario è ancora solo in italiano).
## SOLO agenti in campo: una vignetta fuori quadro è tempo sprecato. E UNA
## vignetta per agente: SpeechBubble tiene la prima per MIN_HOLD (60 s),
## una seconda finirebbe in coda senza mai apparire nel ciak.
const OFFICE_CHATTER := [
	[5.8, "scout-2", "Boards swept: 6 new roles, 4 remote in the EU."],
	[8.2, "scout-1", "Two look promising, sending them to Analysis."],
]

## Carrellata DENTRO la zona Scrittori (Rect2(320,1520,860,440)), stretta
## sulle due scrivanie occupate (sedute a ~(503,1666) e ~(523,1733), anche
## qui quasi in colonna per il ritaglio 9:16). Il bordo destro resta sotto
## x≈1420: la mensola "CV PRONTI" (etichetta non localizzata, da x≈1430)
## non entra mai in campo. Il centro y sta a ~1650 così la targa
## "APPLICATIONS" (wy≈1907) resta SOTTO il quadro: mezza targa tagliata al
## bordo è peggio di nessuna targa, e la pastiglia delle didascalie del
## montaggio vive proprio lì. Viewport del movie: 1920x1080, mezzo campo
## orizzontale = 960/zoom.
## NB (30/07, seconda tornata): il reparto è ora a "quadrante d'orologio"
## (sei scrivanie radiali attorno alla rosetta del tappeto). Le vecchie
## costanti (620,1640 z2.05→2.18) inquadravano il tappeto vuoto: ritarate
## empiricamente su una sonda statica — a z~1.8 entrano tutte e sei le
## scrivanie coi due Scrittori al lavoro, come nel girato approvato.
const DEPT_SECONDS := 9.0
const DEPT_FROM := Vector2(700.0, 1650.0)
const DEPT_TO := Vector2(715.0, 1660.0)
const DEPT_ZOOM_FROM := 1.80
const DEPT_ZOOM_TO := 1.92
const DEPT_CHATTER := [
	[1.6, "scrittore-1", "Cover letter drafted: one page, role-specific."],
	[4.4, "scrittore-2", "CV variant ready for the remote-first posting."],
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


## Breve totale (il senso del luogo) → SPINTA dentro il Research fino a due
## scrivanie, poi lenta deriva da vicino mentre gli agenti parlano. Tre tempi
## su un'unica tween parallela coi delay: ogni PropertyTweener parte dal
## valore corrente quando scatta, quindi le tappe si incatenano da sole.
func _office_clip() -> void:
	await get_tree().process_frame
	_dress_set_english()
	_silence_state_tags()
	var world: Rect2 = FurnitureDefs.WORLD
	var vp := get_viewport().get_visible_rect().size
	var z := vp.x / world.size.x  # fit in larghezza: niente bande ai lati
	var cam := _mount_camera(OFFICE_WIDE_CENTER, z)
	var tw := create_tween().set_parallel(true) \
			.set_ease(Tween.EASE_IN_OUT).set_trans(Tween.TRANS_SINE)
	var close := Vector2(OFFICE_CLOSE_ZOOM, OFFICE_CLOSE_ZOOM)
	tw.tween_property(cam, "zoom", close, OFFICE_PUSH_SECONDS) \
			.set_delay(OFFICE_HOLD_SECONDS)
	tw.tween_property(cam, "position", OFFICE_CLOSE_CENTER, OFFICE_PUSH_SECONDS) \
			.set_delay(OFFICE_HOLD_SECONDS)
	var drift := Vector2(OFFICE_DRIFT_ZOOM, OFFICE_DRIFT_ZOOM)
	var after_push := OFFICE_HOLD_SECONDS + OFFICE_PUSH_SECONDS
	tw.tween_property(cam, "zoom", drift, OFFICE_DRIFT_SECONDS) \
			.set_delay(after_push)
	tw.tween_property(cam, "position", OFFICE_DRIFT_CENTER, OFFICE_DRIFT_SECONDS) \
			.set_delay(after_push)
	for line in OFFICE_CHATTER:
		_bubble_at(float(line[0]), str(line[1]), str(line[2]))


## Campo stretto sul reparto Scrittori: lenta carrellata fra due scrivanie
## con leggera spinta in avanti — il soggetto resta grande per tutto il ciak.
func _dept_clip() -> void:
	await get_tree().process_frame
	_dress_set_english()
	_silence_state_tags()
	var cam := _mount_camera(DEPT_FROM, DEPT_ZOOM_FROM)
	var tw := create_tween().set_parallel(true) \
			.set_ease(Tween.EASE_IN_OUT).set_trans(Tween.TRANS_SINE)
	tw.tween_property(cam, "position", DEPT_TO, DEPT_SECONDS)
	tw.tween_property(cam, "zoom",
			Vector2(DEPT_ZOOM_TO, DEPT_ZOOM_TO), DEPT_SECONDS)
	for line in DEPT_CHATTER:
		_bubble_at(float(line[0]), str(line[1]), str(line[2]))


## La pagina a fumetti che si scrive da sola: storia pubblicata dalla porta
## vera del bus (publish_agent_chat), una vignetta alla volta.
func _chat_clip() -> void:
	await get_tree().process_frame
	_dress_set_english()
	# Anche qui: le targhe di stato ("AL LAVORO") sono solo in italiano e
	# restano leggibili dietro la pagina chat semi-trasparente — via.
	_silence_state_tags()
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
