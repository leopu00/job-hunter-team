extends Node2D
## La box: pavimento, mobili, luci, navigazione e agenti al lavoro.
## Nessun personaggio-utente: si osserva con la FreeCamera e si clicca
## su agenti e reparti. Il layout vive in FurnitureDefs + DepartmentDefs,
## il roster in CharacterDefs.

var nav := NavGrid.new()
var world: Node2D
var agents: Array[AgentNPC] = []
var _hover_agent: AgentNPC
var _team_hud: TeamHud
var _camera: FreeCamera

func _ready() -> void:
	add_child(OfficeFloor.new())
	add_child(DepartmentDressing.new())  # tinte/targhe dei 5 reparti (dev-art)
	add_child(DeptRugs.new())  # tappetoni tondi colore-reparto (reference)
	# giorno/notte sull'ora locale: esterno, lampade e luce dalle finestre.
	# Va qui, PRIMA di mondo e maintainer, che devono disegnarsi sopra.
	add_child(DayNight.new())
	if OS.get_environment("JHT_ONLYFLOOR") == "1":  # TEST-AUTO
		var c := Camera2D.new()
		c.position = Vector2(1300, 750)
		add_child(c)
		c.make_current()
		return

	world = Node2D.new()
	world.name = "World"
	world.y_sort_enabled = true
	add_child(world)
	# la porta dell'ufficio (perimetro sud, accanto all'entrata): da qui
	# escono gli agenti killati/fermati — missione pipeline 20:1x
	world.add_child(ExitDoor.new(EXIT_DOOR))
	# lo scaffale dei CV PRONTI accanto alla porta (sezione output 3/3)
	world.add_child(OutputShelf.new())
	world.add_child(_invisible_wall(OutputShelf.RECT))
	# bobine e fogli sul banco-test degli analisti (tavolo lungo del lab)
	world.add_child(TestBench.new())

	for item in FurnitureDefs.ITEMS:
		if item["kind"] == "hologram":
			world.add_child(Hologram.new(item["rect"]))
			world.add_child(_invisible_wall(item["rect"]))
		else:
			world.add_child(FurnitureNode.new(item))

	# postazioni dei 5 reparti: stesso FurnitureNode dei mobili, kind variati;
	# facing passa al visual (texture orientate _down/_side/_up, dev-art).
	# kind "none" = seduta di un mobile condiviso (es. il tavolo lungo degli
	# Analisti): conta per spot/ostacoli ma il visual è l'item in FurnitureDefs.
	for d in DepartmentDefs.all_desks():
		# micro-prop sul piano (anche sulle sedute del tavolo lungo)
		world.add_child(DeskClutter.new(d["rect"], "%s:%d" % [d["dept"], d["index"]]))
		if d["kind"] == "none":
			continue
		world.add_child(FurnitureNode.new({
			"id": "desk_%s_%d" % [d["dept"], d["index"]],
			"kind": d["kind"],
			"rect": d["rect"],
			"facing": d.get("facing", "down"),
		}))

	for r in [FurnitureDefs.LAB_WALL_V, FurnitureDefs.LAB_WALL_H1, FurnitureDefs.LAB_WALL_H2]:
		world.add_child(_invisible_wall(r))
	# vetrate dei reparti: collisioni sottili, il visual è in OfficeFloor
	for r in DepartmentDefs.GLASS_WALLS:
		world.add_child(_invisible_wall(r))
	_add_perimeter_walls()

	nav.build(FurnitureDefs.FLOOR, FurnitureDefs.obstacles()
			+ DepartmentDefs.obstacles() + DepartmentDefs.GLASS_WALLS
			+ [OutputShelf.RECT])

	# i macchinari si animano quando qualcuno li usa (ping da AgentNPC)
	world.add_child(PrinterFx.new(FurnitureDefs.get_rect("printer")))
	world.add_child(CoffeeFx.new(FurnitureDefs.get_rect("coffee_bar")))
	match OS.get_environment("JHT_FX"):  # TEST-AUTO: effetto forzato
		"printer":
			PrinterFx.ping(20.0)
		"coffee":
			CoffeeFx.ping(20.0)

	# pile degli inbox di reparto: il ritiro le svuota, le soste le
	# riforniscono, e un restock lento simula l'upstream che stampa.
	PaperPile.inbox = {}
	for dept_id in DepartmentDefs.DEPT_ORDER:
		var inbox_pos: Vector2 = DepartmentDefs.DEPARTMENTS[dept_id]["inbox"]
		var p := PaperPile.new(Rect2(inbox_pos - Vector2(28, 16), Vector2(56, 32)))
		# gli Scout producono e basta: il loro inbox si riempie più svelto
		p.restock = 90.0 if DepartmentDefs.FETCH_FROM.has(dept_id) else 45.0
		p.add_sheets(randi_range(1, 6))
		world.add_child(p)
		PaperPile.inbox[dept_id] = p

	# Ambientazione pre-backend SOBRIA (ordine Leone 18:0x): solo lead e
	# core, niente folla. L'organico completo resta nel pool: coi dati
	# veri la scena mostra esattamente chi è attivo sulla VPS.
	for def in CharacterDefs.spawn_list():
		if not def.get("lead", false):
			continue
		var agent := AgentNPC.new()
		world.add_child(agent)
		agent.setup(def, nav)
		agents.append(agent)

	add_child(TesseractEdges.new())  # gli spigoli blu della box (trasparenti)
	add_child(Sfx.make_ambient_hum())

	_camera = FreeCamera.new()
	add_child(_camera)
	_camera.clicked.connect(_on_world_click)

	if OS.get_environment("JHT_OVERVIEW") == "1":  # TEST-AUTO: tutta la box in un frame
		var ov := Camera2D.new()
		ov.position = FurnitureDefs.WORLD.get_center()
		var vp := get_viewport_rect().size
		var z := minf(vp.x / FurnitureDefs.WORLD.size.x, vp.y / FurnitureDefs.WORLD.size.y)
		ov.zoom = Vector2(z, z)
		add_child(ov)
		ov.make_current()

	_add_hud()
	add_child(GameSidebar.new())  # sidebar stile desktop-app (linguetta ≡)

	Log.info("scene", "ufficio pronto: %d agenti, %d postazioni reparto, mondo %v" % [
			agents.size(), DepartmentDefs.all_desks().size(), FurnitureDefs.WORLD.size])

	# TEST-AUTO: JHT_DEPT=<id> apre il pannello di quel reparto all'avvio;
	# JHT_CARD=<slug> apre la scheda del primo agente con quel ruolo.
	var dept_test := OS.get_environment("JHT_DEPT")
	if dept_test != "" and DepartmentDefs.DEPARTMENTS.has(dept_test):
		_open_dept(dept_test)
	var card_test := OS.get_environment("JHT_CARD")
	if card_test != "":
		for a in agents:
			if a.slug == card_test:
				_open_agent_card(a)
				break
	# TEST-AUTO: JHT_SEARCH=<query> apre la GlobalSearch precompilata
	# (il refresh con le posizioni vere arriva col primo snapshot)
	var search_test := OS.get_environment("JHT_SEARCH")
	if search_test != "":
		_toggle_search()
		_search.set_query.call_deferred(search_test)
		BackendBus.positions_updated.connect(func(_l: Array) -> void:
			if _search:
				_search.set_query(search_test))

	# La scena vive sul BackendBus: roster reale → spawn/despawn,
	# chat del team → fumetti. Se un backend è già connesso (snapshot
	# presente), la scena si allinea subito.
	BackendBus.agents_updated.connect(sync_agents)
	BackendBus.chat_message.connect(_on_chat_message)
	BackendBus.positions_updated.connect(_on_transitions)
	if not BackendBus.agents.is_empty():
		sync_agents(BackendBus.agents)
	if not BackendBus.transitions.is_empty():
		_on_transitions([])  # snapshot già sul bus: assorbito come baseline

	# TEST-AUTO: JHT_BACKEND_TEST=1 monta il simulatore (MockBackend):
	# connessione, roster che va e viene, chat a fumetti — senza VPS.
	if OS.get_environment("JHT_BACKEND_TEST") == "1":
		BackendBus.set_backend(MockBackend.new())

	# TEST-AUTO: JHT_CHAT=<ruolo> apre il pannello chat col primo agente
	# di quel ruolo e invia un messaggio di prova (eco + risposta mock).
	if OS.get_environment("JHT_CHAT") != "":
		_chat_selftest(OS.get_environment("JHT_CHAT"))

	# TEST-AUTO: JHT_THROTTLE_TEST=1 forza subito i nuovi stati della
	# missione pipeline: un agente in ricreazione (throttle lungo) e uno
	# che esce dalla porta, senza aspettare il ciclo eventi del mock.
	if OS.get_environment("JHT_THROTTLE_TEST") == "1":
		_throttle_selftest()

	# TEST-AUTO: JHT_SHOT=path.png → screenshot dopo un secondo e chiude.
	# Con JHT_OVERVIEW=1 permette a noi agenti di verificare il layout da soli.
	var shot := OS.get_environment("JHT_SHOT")
	if shot != "":
		_take_shot(shot)

func _on_chat_message(msg: Dictionary) -> void:
	deliver_chat(msg.get("from", ""), msg.get("to", "all"), msg.get("text", ""))

## Aspetta che il backend abbia popolato la scena, poi apre la chat e
## scrive: il giro completo utente→canale→risposta si vede da solo.
func _chat_selftest(role: String) -> void:
	await get_tree().create_timer(2.5).timeout
	for a in agents:
		if a.slug == role or a.uid.begins_with(role):
			_open_chat(a)
			await get_tree().create_timer(0.5).timeout
			BackendBus.send_user_chat(a.slug, "Come procede il lavoro?")
			return

## Forza i due comportamenti nuovi sul roster corrente (vedi _ready).
func _throttle_selftest() -> void:
	await get_tree().create_timer(4.0).timeout
	if agents.size() < 2:
		return
	agents[1].set_throttle(240.0)
	agents[1].set_backend_status("throttled")
	_despawn_agent(agents[agents.size() - 1])
	Log.info("test", "throttle selftest: %s in ricreazione, uno alla porta"
			% agents[1].uid)

func _take_shot(path: String) -> void:
	# JHT_SHOT_DELAY=N ritarda lo scatto: utile per fotografare la
	# simulazione a regime (viaggi in corso) e scovare ingorghi.
	var delay := 1.2
	var delay_env := OS.get_environment("JHT_SHOT_DELAY")
	if delay_env != "":
		delay = maxf(0.5, float(delay_env))
	await get_tree().create_timer(delay).timeout
	var img := get_viewport().get_texture().get_image()
	img.save_png(path)
	Log.info("test", "JHT_SHOT salvato: " + path)
	get_tree().quit()

func _process(_delta: float) -> void:
	_update_hover()

var _registry: RegistryPanel
var _search: GlobalSearch

func _unhandled_input(event: InputEvent) -> void:
	if Game.dialogue_active:
		return
	# GlobalSearch del web: Cmd/Ctrl+K apre la ricerca sulle posizioni
	if event is InputEventKey and event.pressed and event.keycode == KEY_K \
			and (event.meta_pressed or event.ctrl_pressed):
		_toggle_search()
		get_viewport().set_input_as_handled()
		return
	if event.is_action_pressed("registry"):
		if _registry:
			_registry.queue_free()
			_registry = null
			Sfx.play_back()
		else:
			_registry = RegistryPanel.new()
			add_child(_registry)

func _toggle_search() -> void:
	if _search:
		_search.queue_free()
		_search = null
		Sfx.play_back()
		return
	_search = GlobalSearch.new()
	add_child(_search)
	Sfx.play_blip()
	_search.closed.connect(func() -> void:
		if _search:
			_search.queue_free()
			_search = null)
	_search.open_position.connect(func(id: int) -> void:
		_search.queue_free()
		_search = null
		# apre la sezione positions direttamente sul dettaglio
		var panel := SectionPanel.new("positions", 24.0)
		panel._pos_detail_id = id
		add_child(panel)
		panel.closed.connect(panel.queue_free))

var _dept_panel: DepartmentPanel
var _agent_card: AgentCard

## Click "pulito" dalla FreeCamera: agente > bacheca > reparto.
func _on_world_click(target: Vector2) -> void:
	if Game.dialogue_active:
		return
	if _registry or _dept_panel or _agent_card or _chat_panel:
		return  # con un pannello aperto, il mondo non riceve click
	for agent in agents:
		if agent.hit_by(target):
			_open_agent_card(agent)
			return
	if FurnitureDefs.get_rect("corkboard").grow(30).has_point(target):
		_registry = RegistryPanel.new()
		add_child(_registry)
		return
	# il mappamondo apre la mappa delle offerte coi pin (vista web migrata)
	if FurnitureDefs.get_rect("hologram").grow(24).has_point(target):
		Log.info("ui", "mappa offerte aperta dal mappamondo")
		var map_panel := SectionPanel.new("map", 24.0)
		add_child(map_panel)
		map_panel.closed.connect(map_panel.queue_free)
		return
	var dept := DepartmentDefs.department_at(target)
	if dept != "":
		_open_dept(dept)

func _open_dept(dept: String) -> void:
	Log.info("dept", "pannello reparto aperto: " + dept)
	_dept_panel = DepartmentPanel.new(dept)
	add_child(_dept_panel)
	_dept_panel.closed.connect(func() -> void: _dept_panel = null)

# ── Hover col mouse (evidenzia l'agente cliccabile) ───────────────────

func _update_hover() -> void:
	var best: AgentNPC = null
	if not Game.dialogue_active:
		var mouse := get_global_mouse_position()
		for agent in agents:
			if agent.hit_by(mouse):
				best = agent
				break
	if best != _hover_agent:
		if _hover_agent:
			_hover_agent.set_highlight(false)
		_hover_agent = best
		if _hover_agent:
			_hover_agent.set_highlight(true)
			Sfx.play_tick()

## Scheda "chi è / cosa ha fatto"; da lì si passa al dialogo.
func _open_agent_card(agent: AgentNPC) -> void:
	Log.info("agent", "scheda aperta: %s (%s)" % [agent.display_name, agent.slug])
	agent.start_talk()  # si ferma e guarda in camera mentre lo esamini
	_agent_card = AgentCard.new(agent)
	add_child(_agent_card)
	_agent_card.talk_requested.connect(func() -> void: _start_talk(agent))
	_agent_card.chat_requested.connect(func() -> void: _open_chat(agent))
	_agent_card.closed.connect(func() -> void:
		_agent_card = null
		# l'agente può essersi dissolto (despawn backend) a scheda aperta
		if is_instance_valid(agent) and not agent.is_dissolving() \
				and not Game.dialogue_active:
			agent.end_talk())

var _chat_panel: ChatPanel

## Chat REALE con l'agente: si apre con lo slug di gioco, il bus lo
## traduce nel nome del sistema reale (coordinatore → capitano).
func _open_chat(agent: AgentNPC) -> void:
	Log.info("chat", "pannello chat aperto con " + agent.slug)
	_chat_panel = ChatPanel.new(agent.slug, agent.display_name)
	add_child(_chat_panel)
	_chat_panel.closed.connect(func() -> void:
		_chat_panel = null
		if is_instance_valid(agent) and not agent.is_dissolving():
			agent.end_talk())

func _start_talk(agent: AgentNPC) -> void:
	if Game.dialogue_active:
		return
	Log.info("agent", "dialogo aperto con " + agent.slug)
	agent.start_talk()
	var ui := DialogueUI.new()
	add_child(ui)
	ui.open(agent.slug, agent.display_name, "")
	ui.closed.connect(func() -> void:
		if is_instance_valid(agent) and not agent.is_dissolving():
			agent.end_talk())

# ── Roster dinamico dal backend (missione backend-integration) ────────
# In modalità backend la scena mostra SOLO gli agenti attivi sulla VPS:
# sync_agents() confronta lo stato con la scena e materializza/dissolve.

var _desk_pool: Dictionary = {}  # role -> Array di def libere (postazioni)
var _backend_mode := false
var _unplaced_roles: Dictionary = {}  # ruoli senza postazione già segnalati

## Applica lo snapshot del backend (contratto BackendBus.agents_updated):
## list = [{slug: uid univoco, role, name, active, status}].
func sync_agents(list: Array) -> void:
	if not _backend_mode:
		_enter_backend_mode()
	var wanted := {}
	for item in list:
		# un killed è di fatto fuori squadra: esce dalla porta come chi
		# sparisce dal roster (missione pipeline 20:1x)
		if item.get("active", true) and str(item.get("status", "")) != "killed":
			wanted[item["slug"]] = item
	for agent in agents.duplicate():
		if not wanted.has(agent.uid):
			_despawn_agent(agent)
		else:
			# throttle PRIMA dello status: la scelta seduto-vs-ricreazione
			# al cambio di stato legge la durata già aggiornata
			agent.set_throttle(float(wanted[agent.uid].get("throttle_secs", 0.0)))
			agent.set_backend_status(wanted[agent.uid].get("status", "working"))
			wanted.erase(agent.uid)
	for item_uid in wanted:
		_spawn_backend_agent(wanted[item_uid])

## Recapita un messaggio della chat di team come fumetto (contratto
## BackendBus.chat_message): from/to sono uid agente, "user" o "all".
func deliver_chat(from_uid: String, to_uid: String, text: String) -> void:
	for agent in agents:
		if agent.uid == from_uid and not agent.is_dissolving():
			var to_label := ""
			match to_uid:
				"all":
					to_label = ""
				"user":
					to_label = "te"
				_:
					to_label = _name_of(to_uid)
			agent.say(text, to_label)
			return

func _name_of(uid: String) -> String:
	for agent in agents:
		if agent.uid == uid:
			return agent.display_name
	return uid

## ── Scena reattiva al registro attività ──────────────────────────────

## La porta d'uscita (perimetro sud, presso l'entrata/Assistente) e il
## punto interno dove gli agenti in uscita camminano prima di svanire.
const EXIT_DOOR := Vector2(1300, 2000)
const EXIT_SPOT := Vector2(1300, 1952)

const MAX_TR_REACTIONS := 6   # per refresh: il resto resta solo nel registro
const TR_REACT_GAP := 2.4     # secondi fra due reazioni (non un coro)

## Gli stati VERI del jobs.db (SELECT DISTINCT to_state sulla VPS) come
## frase parlata; uno stato nuovo cade sul generico "%s → stato".
const TR_PHRASES := {
	"new": "Nuova posizione: %s",
	"checked": "Verificata: %s",
	"scored": "Valutata: %s",
	"writing": "CV in scrittura: %s",
	"ready": "CV pronto: %s",
	"excluded": "Esclusa: %s",
}
## Stati che accendono la stampante dell'ufficio (lavoro sul CV).
const TR_PRINT := ["writing", "ready"]

var _tr_seen: Dictionary = {}
var _tr_baseline := false

## Fase della pipeline → inbox di reparto: la pila fisica mostra il
## contatore VERO (missione pipeline 2/3). L'inbox di un reparto è ciò
## che ha PRODOTTO e che il reparto a valle viene a ritirare.
const PILE_PHASE := {
	"scout": "to_analyze",
	"analisti": "analyzed",
	"scorer": "with_score",
	"scrittori": "to_write",
	"critici": "written",
}

## Contatore reale → fogli visibili: scala in radice (i numeri veri
## arrivano a decine) col cap della pila; 0 resta 0.
static func _pile_visual(n: int) -> int:
	if n <= 0:
		return 0
	return mini(int(ceil(sqrt(float(n)) * 1.9)), PaperPile.MAX_SHEETS)

func _sync_piles() -> void:
	var counts: Dictionary = BackendBus.pipeline_counts()
	for dept_id in PILE_PHASE:
		if PaperPile.inbox.has(dept_id):
			PaperPile.inbox[dept_id].set_target(
					_pile_visual(int(counts[PILE_PHASE[dept_id]])))
	OutputShelf.set_ready(int(counts["cv_ready"]))
	Log.debug("scene", "pile agganciate ai counts: %s" % str(counts))

## Le transizioni di stato REALI muovono la scena: a ogni refresh del
## jobs.db (BackendBus.transitions è già aggiornato quando arriva
## positions_updated) quelle mai viste diventano reazioni dell'agente
## che le ha firmate. Il primo snapshot fa solo da baseline: lo storico
## non va recitato all'avvio.
func _on_transitions(_positions: Array) -> void:
	# con uno snapshot VERO le pile seguono i contatori reali; senza
	# posizioni (mock/offline) resta il teatro simulato del restock
	if not BackendBus.positions.is_empty():
		_sync_piles()
	var fresh: Array = []
	for t in BackendBus.transitions:
		var key := "%s|%s|%s|%s" % [str(t.get("position_id", "")),
				str(t.get("ts", "")), str(t.get("to_state", "")),
				str(t.get("by_agent", ""))]
		if _tr_seen.has(key):
			continue
		_tr_seen[key] = true
		fresh.append(t)
	if not _tr_baseline:
		_tr_baseline = true
		return
	fresh.reverse()  # il registro è DESC: si recita in ordine cronologico
	if fresh.size() > MAX_TR_REACTIONS:
		fresh = fresh.slice(fresh.size() - MAX_TR_REACTIONS)
	var delay := 0.0
	for t in fresh:
		var tt: Dictionary = t
		get_tree().create_timer(delay).timeout.connect(func() -> void:
			_react_to_transition(tt))
		delay += TR_REACT_GAP

## L'agente giusto reagisce — per-istanza (by_agent "scout-2" → uid
## "scout-2" in scena) o, se quell'istanza non c'è, un collega dello
## stesso ruolo. Fumetto con la posizione lavorata + pulse del corpo;
## una scrittura CV accende la stampante.
func _react_to_transition(t: Dictionary) -> void:
	var by := str(t.get("by_agent", "") if t.get("by_agent") else "")
	if by == "":
		return
	var actor: AgentNPC = null
	for agent in agents:
		if agent.uid == by:
			actor = agent
			break
	if actor == null:
		var base := by.split("-")[0]
		for agent in agents:
			if agent.uid != "" and agent.uid.split("-")[0] == base:
				actor = agent
				break
	if actor == null or actor.is_dissolving():
		return
	var to_st := str(t.get("to_state", "") if t.get("to_state") else "?")
	var what := str(t.get("title", "") if t.get("title") else "")
	var company := str(t.get("company", "") if t.get("company") else "")
	if what != "" and company != "":
		what += " · " + company
	elif what == "":
		what = company if company != "" else "posizione #%s" % str(t.get("position_id", "?"))
	if TR_PHRASES.has(to_st):
		actor.say(TR_PHRASES[to_st] % what)
	else:
		actor.say("%s → %s" % [what, to_st])
	actor.react_to_work(to_st in TR_PRINT)
	Log.debug("scene", "reazione %s: %s → %s" % [by, what, to_st])

## Primo snapshot backend: le postazioni tornano nel pool e il roster
## locale di ambientazione lascia la scena — comanda lo stato reale.
func _enter_backend_mode() -> void:
	_backend_mode = true
	_desk_pool = {}
	for def in CharacterDefs.spawn_list():
		var role: String = def["slug"]
		if not _desk_pool.has(role):
			_desk_pool[role] = []
		_desk_pool[role].append(def)
	for agent in agents.duplicate():
		if agent.uid == "":
			_despawn_agent(agent, false, false)
	Log.info("backend", "modalità backend: in scena solo gli agenti attivi")

func _despawn_agent(agent: AgentNPC, refill_pool := true, via_door := true) -> void:
	agents.erase(agent)
	if _hover_agent == agent:
		_hover_agent = null
	# se l'utente lo stava esaminando, la scheda si chiude con lui
	if _agent_card and _agent_card.get("_agent") == agent:
		_agent_card.close(false)
	if refill_pool and agent.has_meta("def"):
		var def: Dictionary = agent.get_meta("def")
		var role: String = def["slug"]
		# il lead rientra in testa: alla riattivazione riprende il suo posto
		if def.get("lead", false):
			_desk_pool[role].push_front(def)
		else:
			_desk_pool[role].append(def)
	# un agente fermato ESCE dalla porta (missione pipeline 20:1x); il
	# dissolve tesseract resta per gli sfollamenti tecnici di massa
	if via_door:
		agent.exit_through(EXIT_SPOT)
	else:
		agent.dissolve()

func _spawn_backend_agent(item: Dictionary) -> void:
	var role: String = item.get("role", "")
	var pool: Array = _desk_pool.get(role, [])
	if pool.is_empty():
		if not _unplaced_roles.has(role):  # es. sentinella: nessun posto in scena
			_unplaced_roles[role] = true
			Log.warn("backend", "nessuna postazione libera per il ruolo " + role)
		return
	var def: Dictionary = pool.pop_front()
	var live := def.duplicate(true)
	if item.get("name", "") != "":
		live["name"] = item["name"]
	var agent := AgentNPC.new()
	world.add_child(agent)
	agent.setup(live, nav)
	agent.uid = item["slug"]
	agent.set_meta("def", def)
	agent.set_backend_status(item.get("status", "working"))
	agent.materialize()
	agents.append(agent)

# ── Costruzione scena ─────────────────────────────────────────────────

func _invisible_wall(r: Rect2) -> StaticBody2D:
	var body := StaticBody2D.new()
	body.position = Vector2(r.get_center().x, r.end.y)
	var shape := CollisionShape2D.new()
	var box := RectangleShape2D.new()
	box.size = r.size
	shape.shape = box
	shape.position = Vector2(0, -r.size.y / 2.0)
	body.add_child(shape)
	return body

func _add_perimeter_walls() -> void:
	var f := FurnitureDefs.FLOOR
	var t := 60.0
	var rects := [
		Rect2(f.position.x - t, f.position.y - t, f.size.x + t * 2, t),
		Rect2(f.position.x - t, f.end.y, f.size.x + t * 2, t),
		Rect2(f.position.x - t, f.position.y, t, f.size.y),
		Rect2(f.end.x, f.position.y, t, f.size.y),
	]
	for r in rects:
		add_child(_invisible_wall(r))

func _add_hud() -> void:
	var hud := CanvasLayer.new()
	hud.layer = 10
	add_child(hud)
	var theme_root := Control.new()
	theme_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	theme_root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	theme_root.theme = TerminalTheme.get_theme()
	hud.add_child(theme_root)
	_team_hud = TeamHud.new()
	theme_root.add_child(_team_hud)
	theme_root.add_child(SimBadge.new())  # SIMULAZIONE vs DATI REALI
	var hint := TerminalTheme.label(
			UIStrings.t("office.camera_hint"),
			15, Palette.DIM)
	hint.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	hint.position = Vector2(-hint.size.x / 2.0, -30)
	hint.grow_horizontal = Control.GROW_DIRECTION_BOTH
	hint.grow_vertical = Control.GROW_DIRECTION_BEGIN
	hud.add_child(hint)

