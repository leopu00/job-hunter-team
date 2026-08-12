class_name OfficeSelftests
extends Node
## I selftest e i ganci di test/preview dell'ufficio, fuori da `office.gd`.
##
## Vivono qui per due ragioni. La prima è che non sono gioco: nessun utente
## può eseguirli, e finché stavano dentro `office.gd` viaggiavano in ogni
## build di release. La seconda è che il loro dispatch aveva invaso `_ready()`,
## che è la funzione più letta del gioco: 451 righe di soli
## `if OS.get_environment("JHT_…")`.
##
## Il nodo nasce come figlio dell'ufficio SOLO se almeno una delle variabili
## qui sotto è valorizzata (vedi `armed()`), e i ganci si dichiarano in
## tabella invece che in una catena di `if`.
##
## ⚠️ I selftest chiamano membri privati di `office.gd` — `_open_dept`,
## `_find_agent`, `_agent_card`… — attraverso `office`. Non è una svista: la
## scena resta l'unico proprietario del suo stato, e questo file la osserva.

## L'ufficio osservato. Volutamente `Variant`: `office.gd` non ha `class_name`
## e i membri che i selftest interrogano sono privati, quindi la risoluzione
## deve restare dinamica.
var office: Variant

var _agent_ui_test_started := false
var _coordinator_test_started := false
var _traffic_demo_started := false

## Ganci a interruttore: scattano quando la variabile vale esattamente "1".
const FLAG_HOOKS := {
	"JHT_CENSUS": "_scene_census",
	"JHT_GFX_TEST": "_gfx_profile_selftest",
	"JHT_WIZARD_JUMP_TEST": "_wizard_jump_selftest",
	"JHT_WORLD_TEXT_TEST": "_world_text_selftest",
	"JHT_GRAPHICS_PANEL_TEST": "_graphics_panel_selftest",
	"JHT_LANGUAGE_SETTINGS_TEST": "_language_settings_selftest",
	"JHT_CAMERA_LOCK_TEST": "_camera_lock_selftest",
	"JHT_AGENT_FRAME_TEST": "_agent_frame_selftest",
	"JHT_POSITIONS_PANEL_TEST": "_positions_panel_selftest",
	"JHT_MAP_PANEL_TEST": "_map_panel_selftest",
	"JHT_USAGE_PANEL_TEST": "_usage_panel_selftest",
	"JHT_FEEDBACK_PANEL_TEST": "_feedback_panel_selftest",
	"JHT_TARGET_ROLE_CATEGORY_TEST": "_target_role_category_selftest",
	"JHT_GUIDED_TEST": "_guided_onboarding_selftest",
	"JHT_TOUR_TEST": "_tour_selftest",
	"JHT_TOUR_EXIT_TEST": "_tour_exit_selftest",
	"JHT_REGISTRY": "_arm_registry",
	"JHT_CV_SHELF": "_arm_cv_shelf",
	# il simulatore va montato PRIMA dei test che ne consumano gli eventi:
	# i ganci partono nell'ordine in cui sono elencati qui.
	"JHT_BACKEND_TEST": "_arm_mock_backend",
	"JHT_STATE_SELFTEST": "_state_selftest",
	"JHT_CHATMENU": "_arm_chat_menu",
	"JHT_CHAT_UI_TEST": "_chat_ui_selftest",
	"JHT_COMIC_CHAT_TEST": "_arm_comic_chat_selftest",
	"JHT_THROTTLE_TEST": "_throttle_selftest",
	"JHT_BACKEND_SWITCH_TEST": "_backend_switch_selftest",
	"JHT_SETUP_BUSY_TEST": "_setup_busy_selftest",
	"JHT_SETUP_GATING_TEST": "_setup_gating_selftest",
	"JHT_BUBBLE_LAYOUT_TEST": "_bubble_layout_selftest",
	"JHT_SIM_BADGE_TEST": "_sim_badge_selftest",
	"JHT_LIVE_PROFILE_TEST": "_live_profile_selftest",
}

## Ganci con argomento: scattano quando la variabile non è vuota, e il valore
## arriva al metodo (un ruolo, un reparto, un percorso).
const VALUE_HOOKS := {
	"JHT_STUCK_TEST": "_arm_stuck_watcher",
	"JHT_DEPT": "_arm_dept_panel",
	"JHT_CARD": "_arm_agent_card",
	"JHT_TOUR": "_arm_tour_talk",
	"JHT_PIPELINE_QUEUE": "_arm_pipeline_queue",
	"JHT_SEARCH": "_arm_search",
	"JHT_CHAT": "_arm_chat_send",
	"JHT_CHAT_VIEW": "_arm_chat_view",
	"JHT_GUIDED_CHAT": "_arm_guided_chat",
	"JHT_COMIC_CHAT": "_comic_chat_shot",
	"JHT_PIPELINE_TEST": "_force_pipeline_trip",
	"JHT_PIPELINE_FORCE_TEST": "_pipeline_force_selftest",
	"JHT_ENTRY_TEST": "_entry_selftest",
	"JHT_DOCTOR_TEST": "_doctor_selftest",
	"JHT_CORE_PATROL_TEST": "_force_core_patrol",
	"JHT_SHOT": "_take_shot",
}

## Variabili che non aprono niente in `_ready` ma servono a
## `on_agents_synced()`: contano comunque per far nascere il nodo, altrimenti
## l'ufficio non avrebbe nessuno a cui inoltrare lo snapshot del roster.
const SYNC_HOOK_ENV := ["JHT_THINKING", "JHT_AGENT_UI_TEST",
		"JHT_COORDINATOR_TEST", "JHT_COORDINATOR_PREVIEW", "JHT_TRAFFIC_DEMO"]


## Vero se l'ufficio deve nascere in modalità test/preview. È l'unica domanda
## che `office.gd` pone a questo file, e la pone prima che il nodo esista:
## per questo le tabelle sono `const` e portano il NOME del metodo.
static func armed() -> bool:
	for env_name: String in FLAG_HOOKS:
		if OS.get_environment(env_name) == "1":
			return true
	for env_name: String in VALUE_HOOKS:
		if OS.get_environment(env_name) != "":
			return true
	for env_name: String in SYNC_HOOK_ENV:
		if OS.get_environment(env_name) != "":
			return true
	return false


## Ogni gancio parte differito, come faceva la vecchia catena di `if`: quando
## questo `_ready` gira l'ufficio sta ancora costruendo i propri figli, e
## nessun selftest deve toccare l'albero prima che abbia finito.
func _ready() -> void:
	for env_name: String in FLAG_HOOKS:
		if OS.get_environment(env_name) == "1":
			Callable(self, FLAG_HOOKS[env_name]).call_deferred()
	for env_name: String in VALUE_HOOKS:
		var value := OS.get_environment(env_name)
		if value != "":
			Callable(self, VALUE_HOOKS[env_name]).call_deferred(value)


## Il cambio da Impostazioni deve ricostruire l'ufficio: tutte le superfici
## create al bootstrap (HUD, sidebar, popup) devono rileggere la nuova lingua.
func _language_settings_selftest() -> void:
	await get_tree().process_frame
	Game.language_settings_selftest()


func _sim_badge_selftest() -> void:
	await get_tree().process_frame
	await get_tree().process_frame
	var ok := true
	var cases := [
		[false, false, true],
		[false, true, true],
		[true, true, true],
		[true, false, false],
	]
	for case in cases:
		ok = ok and SimBadge.warning_needed(bool(case[0]), bool(case[1])) \
				== bool(case[2])
	var badges: Array[Node] = office.find_children("*", "SimBadge", true, false)
	if badges.size() == 1:
		var badge := badges[0] as SimBadge
		ok = ok and badge.visible
		badge._apply_state(true, false)
		ok = ok and not badge.visible
		badge._apply_state(true, true)
		ok = ok and badge.visible
		badge._refresh()
	else:
		ok = false
	print("SIM-BADGE-TEST %s" % ("PASS" if ok else "FAIL"))
	get_tree().quit(0 if ok else 1)


## Gate sanificato del profilo riprese: non presume che "connesso" basti,
## ma aspetta anche uno snapshot non-demo e verifica il frame realmente
## visibile. Non stampa contenuti o righe del profilo.
func _live_profile_selftest() -> void:
	var deadline := Time.get_ticks_msec() + 45000
	while Time.get_ticks_msec() < deadline:
		if BackendBus.is_live() and not BackendBus.positions_are_demo \
				and not BackendBus.positions.is_empty():
			break
		await get_tree().create_timer(0.1).timeout
	# Il nodo ufficio puo' essere gia' pronto mentre il loader globale copre
	# ancora tutto il viewport. Un PNG nero con "CARICAMENTO" passerebbe il
	# gate badge senza aver mai verificato il frame che finira' nel raw.
	var frame_deadline := Time.get_ticks_msec() + 10000
	while Time.get_ticks_msec() < frame_deadline \
			and _visible_ui_has_any_text(get_tree().root, ["CARICAMENTO", "LOADING"]):
		await get_tree().create_timer(0.1).timeout
	await get_tree().process_frame
	await get_tree().process_frame
	var badges: Array[Node] = office.find_children("*", "SimBadge", true, false)
	var badge_hidden := badges.size() == 1 and not (badges[0] as SimBadge).visible
	var forbidden_visible := _visible_ui_has_any_text(get_tree().root,
			["SIMULATION", "SIMULAZIONE", "DEMO MODE"])
	var loading_visible := _visible_ui_has_any_text(get_tree().root,
			["CARICAMENTO", "LOADING"])
	var frame_ok := true
	var frame_path := OS.get_environment("JHT_LIVE_PROFILE_FRAME")
	if frame_path != "":
		var image := get_viewport().get_texture().get_image()
		frame_ok = image.save_png(frame_path) == OK and FileAccess.file_exists(frame_path)
	var ok := BackendBus.state == BackendBus.CONNECTED and BackendBus.is_live() \
			and not BackendBus.positions_are_demo and not BackendBus.positions.is_empty() \
			and badge_hidden and not forbidden_visible and not loading_visible and frame_ok
	print(("LIVE-PROFILE-TEST %s connected=%s positions_live=%s badge_hidden=%s " \
			+ "forbidden_visible=%s loading_visible=%s frame=%s") % [
			"PASS" if ok else "FAIL", BackendBus.state == BackendBus.CONNECTED,
			not BackendBus.positions_are_demo and not BackendBus.positions.is_empty(),
			badge_hidden, forbidden_visible, loading_visible, frame_ok])
	get_tree().quit(0 if ok else 1)


func _visible_ui_has_any_text(node: Node, tokens: Array) -> bool:
	if node is CanvasItem and not (node as CanvasItem).is_visible_in_tree():
		return false
	var text := ""
	if node is Label:
		text = (node as Label).text
	elif node is Button:
		text = (node as Button).text
	elif node is RichTextLabel:
		text = (node as RichTextLabel).text
	elif node is LineEdit:
		text = (node as LineEdit).text
	var upper := text.to_upper()
	for token in tokens:
		if str(token) in upper:
			return true
	for child in node.get_children():
		if _visible_ui_has_any_text(child, tokens):
			return true
	return false


## Ganci che hanno bisogno del roster vero: `sync_agents` li richiama a ogni
## snapshot, perché l'istanza cercata può nascere molto dopo `_ready`.
func on_agents_synced() -> void:
	# Il roster backend arriva dopo _ready: il test-card va riprovato qui,
	# quando l'istanza richiesta esiste davvero.
	var card_test := OS.get_environment("JHT_CARD")
	if card_test != "" and office._agent_card == null:
		for a in office.agents:
			if a.slug == card_test or a.uid == card_test:
				office._open_agent_card(a)
				break
	# Preview/test della vista tmux: si apre solo dopo il roster vero/mock,
	# perché lo showroom non possiede sessioni da osservare.
	var thinking_test := OS.get_environment("JHT_THINKING")
	if thinking_test != "" and office._thinking_panel == null:
		for a in office.agents:
			if a.slug == thinking_test or a.uid == thinking_test:
				office._open_agent_thinking(a)
				break
	if OS.get_environment("JHT_AGENT_UI_TEST") == "1" \
			and office._thinking_panel != null and not _agent_ui_test_started:
		_agent_ui_test_started = true
		_agent_ui_selftest.call_deferred()
	var coordinator_preview := OS.get_environment("JHT_COORDINATOR_TEST") == "1" \
			or OS.get_environment("JHT_COORDINATOR_PREVIEW") == "1"
	if coordinator_preview and office._coordinator_panel == null:
		for a in office.agents:
			if a.slug == "coordinatore":
				office._open_coordinator_panel(a)
				break
	if OS.get_environment("JHT_COORDINATOR_TEST") == "1" \
			and office._coordinator_panel != null and not _coordinator_test_started:
		_coordinator_test_started = true
		_coordinator_selftest.call_deferred()
	if OS.get_environment("JHT_TRAFFIC_DEMO") == "1" \
			and not _traffic_demo_started and office.agents.size() >= 30:
		_traffic_demo_started = true
		_start_traffic_demo.call_deferred()


# ── Ganci di preview: aprono una vista e basta ───────────────────────────────

## TEST-AUTO: osservatore degli agenti bloccati. Il ruolo viaggia nel valore
## della variabile, ma a montare la sentinella basta che ci sia.
func _arm_stuck_watcher(_role: String) -> void:
	var stuck := Node.new()
	stuck.set_script(load("res://tools/stuck_agent_watcher.gd"))
	get_tree().root.add_child(stuck)


## TEST-AUTO: JHT_DEPT=<id> apre il pannello di quel reparto all'avvio.
func _arm_dept_panel(dept_id: String) -> void:
	if DepartmentDefs.DEPARTMENTS.has(dept_id):
		office._open_dept(dept_id)


## TEST-AUTO: JHT_CARD=<slug> apre la scheda del primo agente con quel ruolo.
func _arm_agent_card(slug: String) -> void:
	for a in office.agents:
		if a.slug == slug:
			office._open_agent_card(a)
			return


## TEST-AUTO: JHT_TOUR=<slug> avvia il dialogo con quell'agente.
func _arm_tour_talk(slug: String) -> void:
	for a in office.agents:
		if a.slug == slug:
			office._start_talk(a)
			return


## TEST-AUTO: JHT_REGISTRY=1 apre il registro candidature (TAB) — ritardato al
## primo snapshot così lo shot mostra i dati veri.
func _arm_registry() -> void:
	BackendBus.positions_updated.connect(func(_l: Array) -> void:
		if office._registry == null:
			office._registry = RegistryPanel.new()
			office.add_child(office._registry))


## TEST-AUTO: apre l'archivio dello scaffale quando arriva lo snapshot.
func _arm_cv_shelf() -> void:
	if not BackendBus.positions.is_empty():
		office._open_cv_shelf.call_deferred()
	else:
		BackendBus.positions_updated.connect(func(_l: Array) -> void:
			if office._cv_shelf_panel == null:
				office._open_cv_shelf())


## TEST-AUTO: apre una delle cinque code fisiche col primo snapshot.
func _arm_pipeline_queue(dept_id: String) -> void:
	if not DepartmentDefs.DEPT_ORDER.has(dept_id):
		return
	if not BackendBus.positions.is_empty():
		office._open_pipeline_queue.call_deferred(dept_id)
	else:
		BackendBus.positions_updated.connect(func(_l: Array) -> void:
			if office._queue_panel == null:
				office._open_pipeline_queue(dept_id))


## TEST-AUTO: JHT_SEARCH=<query> apre la GlobalSearch precompilata (il refresh
## con le posizioni vere arriva col primo snapshot).
func _arm_search(query: String) -> void:
	office._toggle_search()
	office._search.set_query.call_deferred(query)
	BackendBus.positions_updated.connect(func(_l: Array) -> void:
		if office._search:
			office._search.set_query(query))


## TEST-AUTO: JHT_BACKEND_TEST=1 monta il simulatore (MockBackend):
## connessione, roster che va e viene, chat a fumetti — senza VPS.
func _arm_mock_backend() -> void:
	BackendBus.set_backend(MockBackend.new())


## TEST-AUTO: JHT_CHAT=<ruolo> apre il pannello chat col primo agente di quel
## ruolo e invia un messaggio di prova (eco + risposta mock; con la VPS il
## messaggio parte DAVVERO verso l'agente reale).
func _arm_chat_send(role: String) -> void:
	_chat_selftest(role, true)


## JHT_CHAT_VIEW=<ruolo> apre solo il pannello senza inviare: per fotografare
## la risposta arrivata senza rimandare il messaggio. Resta subordinata a
## JHT_CHAT come l'`elif` che sostituisce — insieme aprivano una chat sola.
func _arm_chat_view(role: String) -> void:
	if OS.get_environment("JHT_CHAT") != "":
		return
	_chat_selftest(role, false)


## Preview/E2E del dialogo first-run anche senza backend o agente attivo.
func _arm_guided_chat(role: String) -> void:
	if not ScriptedOnboarding.supports(role):
		return
	office._chat_panel = ChatPanel.new(role, CharacterDefs.role_name(role),
			office._chat_roster())
	office.add_child(office._chat_panel)


## TEST-AUTO: JHT_CHATMENU=1 apre il menu delle chat 1-a-1 (tasto C).
func _arm_chat_menu() -> void:
	get_tree().create_timer(2.5).timeout.connect(office._open_chat_menu)


## TEST-AUTO: la pagina a fumetti si verifica da sé, in un nodo suo
## (tools/comic_chat_selftest.gd): il corpo del test è lungo quanto la feature.
func _arm_comic_chat_selftest() -> void:
	office.add_child(load("res://tools/comic_chat_selftest.gd").new())


## Regressione trackpad/overlay: una gesture consegnata direttamente alla
## camera non deve cambiare né pan né zoom finché il gruppo modal è attivo.
## Riproduce il passo 03 del setup: dall'ufficio si chiede il wizard e la scena
## DEVE cambiare. Sul ThinkPad il click su "Configura" lasciava l'utente in
## ufficio (log pieno di "→ WIZARD" senza mai un cambio, 25/07) e nessuno
## guardava il codice di ritorno di change_scene_to_file.
func _wizard_jump_selftest() -> void:
	# L'osservatore vive su root: se restasse figlio dell'ufficio morirebbe
	# proprio nel momento che deve giudicare, e il test non stamperebbe nulla
	# (primo tentativo, 25/07 — sembrava un blocco, era la coroutine liberata).
	var watcher := Node.new()
	watcher.set_script(load("res://tools/wizard_jump_watcher.gd"))
	get_tree().root.add_child(watcher)


## Il profilo ridotto deve spegnere DAVVERO la scenografia (per due anni ha
## solo alzato un flag che nessuno leggeva) e non deve toccare il resto.
func _gfx_profile_selftest() -> void:
	await get_tree().process_frame
	var result := {}
	var group := get_tree().get_nodes_in_group(GfxProfile.GROUP)
	result["scenografia_registrata"] = group.size() >= 4
	Game.set_low_gfx(true, false)
	await get_tree().process_frame
	var off := 0
	for node in group:
		if node is CanvasItem and not (node as CanvasItem).visible:
			off += 1
	result["spenta_con_profilo_ridotto"] = off == group.size()
	# i mobili e gli agenti restano: il profilo taglia scenografia, non gioco
	result["mobili_intatti"] = office.world != null and office.world.visible
	Game.set_low_gfx(false, false)
	await get_tree().process_frame
	var on := 0
	for node in group:
		if node is CanvasItem and (node as CanvasItem).visible:
			on += 1
	result["riaccesa_con_profilo_pieno"] = on == group.size()
	var ok := true
	for key in result:
		ok = ok and bool(result[key])
	print("GFX-PROFILE-TEST %s %s" % ["PASS" if ok else "FAIL",
			JSON.stringify(result)])
	get_tree().quit(0 if ok else 1)


## Impostazioni → Grafica: quello che l'utente sceglie deve arrivare al mondo
## SUBITO e restare. Il test passa dal pannello vero, premendo i bottoni veri:
## se un domani la scelta smette di comandare sulla calibrazione, cade qui.
func _graphics_panel_selftest() -> void:
	await get_tree().process_frame
	# Premere i bottoni veri vuol dire scrivere DAVVERO user://graphics.cfg,
	# che è di chi gioca e non del test: finito il giro il file va rimesso
	# com'era. Senza, questo test si porta via il profilo scelto dall'utente
	# e — se cade a metà — lascia in eredità un profilo ridotto a chi gira
	# dopo. È così che i tre pannelli sono finiti a passare solo quando
	# questo li precede.
	var gfx_backup := _read_user_file(Game.GFX_CONFIG)
	var result := {}
	var panel := SectionPanel.new("graphics", 24.0)
	office.add_child(panel)
	await get_tree().process_frame
	await get_tree().process_frame
	var labels := ""
	for node in panel.find_children("*", "Label", true, false):
		labels += (node as Label).text + "\n"
	var buttons := ""
	for node in panel.find_children("*", "Button", true, false):
		buttons += (node as Button).text + "\n"
	result["quattro_profili_in_elenco"] = buttons.contains(
			UIStrings.t("gfx.auto").to_upper()) \
			and buttons.contains(UIStrings.t("gfx.full").to_upper()) \
			and buttons.contains(UIStrings.t("gfx.balanced").to_upper()) \
			and buttons.contains(UIStrings.t("gfx.performance").to_upper())
	# In automatico il pannello deve dire cosa sta girando ADESSO, non solo che
	# la scelta è "automatico": senza la riga di stato l'utente non sa nulla.
	result["stato_corrente_mostrato"] = labels.contains(
			UIStrings.t("gfx.state") % [int(round(Game.world_scale() * 100.0)),
					UIStrings.t("gfx.scenery_off" if Game.low_gfx else "gfx.scenery_on")])

	_press_graphics_choice(panel, "gfx.performance")
	await get_tree().process_frame
	result["scelta_salvata"] = Game.graphics_choice() == "performance"
	result["scelta_applicata_al_mondo"] = is_equal_approx(Game.world_scale(), 0.6) \
			and is_equal_approx(office._render_scale, 0.6)
	result["scenografia_spenta"] = Game.low_gfx
	# La riga chiave: da qui in poi né la calibrazione né la sorveglianza
	# possono più toccare niente.
	result["calibrazione_disinnescata"] = Game._graphics_forced()
	# Il testo del mondo si è adeguato insieme alla scala.
	result["testo_compensato"] = is_equal_approx(WorldText.boost(), 1.0 / 0.6)
	# Riavvio simulato: rileggendo il profilo salvato la scala corrente deve
	# risultare quella scelta, non 1.0. Se qui torna 1.0 la sorveglianza crede
	# di essere a risoluzione piena e non restituisce più definizione a nessuno.
	Game.load_gfx_profile()
	result["scala_nota_dopo_riavvio"] = is_equal_approx(Game.world_scale(), 0.6)

	_press_graphics_choice(panel, "gfx.auto")
	await get_tree().process_frame
	result["ritorno_ad_automatico"] = Game.graphics_choice() == Game.CHOICE_AUTO \
			and not Game._graphics_forced()
	result["riparte_dal_profilo_pieno"] = not Game.low_gfx \
			and is_equal_approx(Game.world_scale(), 1.0)
	# La prossima calibrazione deve partire da zero: nel file non resta nessuna
	# misura vecchia da riapplicare al prossimo avvio. (Che _gfx_done torni
	# false non è verificabile headless: là la calibrazione è spenta per
	# principio, non c'è nessun framerate vero da misurare.)
	var cfg := ConfigFile.new()
	cfg.load(Game.GFX_CONFIG)
	result["nessuna_misura_residua"] = not cfg.has_section_key("graphics", "render_scale") \
			and not cfg.has_section_key("graphics", "low") \
			and str(cfg.get_value("graphics", "mode", "")) == Game.CHOICE_AUTO
	panel.queue_free()
	_write_user_file(Game.GFX_CONFIG, gfx_backup)
	var ok := true
	for key in result:
		ok = ok and bool(result[key])
	print("GRAPHICS-PANEL-TEST %s %s" % ["PASS" if ok else "FAIL",
			JSON.stringify(result)])
	get_tree().quit(0 if ok else 1)


## I pannelli di setup durante un'azione lunga: ogni pulsante spento deve dire
## PERCHÉ (la riga-ragione), la riga TEAM della filiera Docker resta
## informativa, e il pannello VPS si spegne/riaccende SUL POSTO senza perdere
## quello che l'utente ha scritto nei campi. È il contratto del feedback 30/07
## ("tutto grigio e muto durante il pull"): senza questo test tornerebbe in
## silenzio al primo refactor dei pannelli.
func _setup_busy_selftest() -> void:
	await get_tree().process_frame
	var result := {}
	var was_running: bool = SetupService._action_running
	var was_action: String = SetupService.current_action
	# ── Azione "container" in corso, iniettata nel servizio vero ────────
	SetupService._action_running = true
	SetupService.current_action = "container"
	var busy_note: String = UIStrings.t("setup.busy_note") \
			% UIStrings.t("setup.busy_container")
	for section in ["activation", "docker", "provider", "team"]:
		var panel := SectionPanel.new(str(section), 24.0)
		office.add_child(panel)
		await get_tree().process_frame
		result[str(section) + "_riga_ragione"] = \
				_panel_has_label(panel, busy_note)
		if section == "docker":
			result["docker_team_riga_informativa"] = _panel_has_label(panel,
					UIStrings.t("setup.team_row_info"))
			var primary := _panel_button(panel, UIStrings.t("setup.container_busy"))
			result["docker_primario_dice_in_corso"] = primary != null \
					and primary.disabled
		if section == "activation":
			var start := _panel_button(panel, UIStrings.t("setup.start_team"))
			result["attivazione_start_spento"] = start == null or start.disabled
		if section == "provider":
			var choose := _panel_button(panel, UIStrings.t("setup.provider_choose"))
			result["provider_scelta_spenta"] = choose == null or choose.disabled
		await _busy_shot("busy-" + str(section))
		panel.queue_free()
		await get_tree().process_frame
	# ── Pannello VPS: gating sul posto, campi preservati ─────────────────
	SetupService._action_running = false
	SetupService.current_action = ""
	var vps := SectionPanel.new("vps", 24.0)
	office.add_child(vps)
	await get_tree().process_frame
	var verify := _panel_button(vps, UIStrings.t("vps.verify_ssh"))
	var connect_btn := _panel_button(vps, UIStrings.t("vps.connect_existing"))
	result["vps_pulsanti_attivi_a_riposo"] = verify != null \
			and not verify.disabled and connect_btn != null \
			and not connect_btn.disabled
	vps._vps_ip.text = "203.0.113.7"
	SetupService._action_running = true
	SetupService.current_action = "vps-migrate"
	SetupService.action_changed.emit("vps-migrate", true, "in corso", true)
	await get_tree().process_frame
	result["vps_pulsanti_spenti_in_azione"] = verify.disabled \
			and connect_btn.disabled
	result["vps_riga_ragione_parlante"] = is_instance_valid(vps._vps_busy_hint) \
			and vps._vps_busy_hint.visible \
			and vps._vps_busy_hint.text.contains(UIStrings.t("setup.busy_vps"))
	result["vps_campo_ip_preservato"] = vps._vps_ip.text == "203.0.113.7"
	await _busy_shot("busy-vps")
	SetupService._action_running = false
	SetupService.current_action = ""
	SetupService.action_changed.emit("vps-migrate", false, "fatto", true)
	await get_tree().process_frame
	result["vps_pulsanti_riaccesi_a_fine"] = not verify.disabled \
			and not connect_btn.disabled and not vps._vps_busy_hint.visible
	vps.queue_free()
	await get_tree().process_frame
	# ── A riposo la riga-ragione NON deve esserci ────────────────────────
	var idle := SectionPanel.new("docker", 24.0)
	office.add_child(idle)
	await get_tree().process_frame
	result["docker_niente_ragione_a_riposo"] = not _panel_has_label(idle,
			UIStrings.t("setup.busy_container"))
	await _busy_shot("idle-docker")
	idle.queue_free()
	SetupService._action_running = was_running
	SetupService.current_action = was_action
	var ok := true
	for key in result:
		ok = ok and bool(result[key])
	print("SETUP-BUSY-TEST %s %s" % ["PASS" if ok else "FAIL",
			JSON.stringify(result)])
	get_tree().quit(0 if ok else 1)


## Scatto opzionale per l'audit visivo del test qui sopra (solo con finestra:
## headless non disegna). JHT_SETUP_BUSY_SHOTS=<cartella> per attivarlo.
func _busy_shot(name: String) -> void:
	var dir := OS.get_environment("JHT_SETUP_BUSY_SHOTS")
	if dir == "":
		return
	await get_tree().create_timer(0.4).timeout
	var img := get_viewport().get_texture().get_image()
	if img != null and not img.is_empty():
		img.save_png(dir.path_join(name + ".png"))


static func _panel_has_label(panel: Node, needle: String) -> bool:
	for node in panel.find_children("*", "Label", true, false):
		if (node as Label).text.contains(needle):
			return true
	return false


static func _panel_button(panel: Node, needle: String) -> Button:
	for node in panel.find_children("*", "Button", true, false):
		if (node as Button).text.contains(needle):
			return node
	return null


## Quanti pulsanti portano questa scritta. Serve dove la stessa etichetta
## compare più volte per disegno — i passi bloccati della checklist — e
## contarli è il solo modo di distinguere "uno solo" da "tutti".
static func _panel_button_count(panel: Node, needle: String) -> int:
	var found := 0
	for node in panel.find_children("*", "Button", true, false):
		if (node as Button).text.contains(needle):
			found += 1
	return found


## O-13 — i quattro difetti d'uso trovati dall'operatore sul setup macOS della
## v0.3.6, tutti nella stessa famiglia: la UI offre azioni che non possono
## riuscire, e tace sul perché.
##
## Le tre schermate del ticket, provate qui una per una:
##  · «runtime assente» → «ATTIVA CONTAINER» spento, motivo a schermo e
##    INSTALLA DOCKER come unica strada;
##  · «solo Colima» → motore riconosciuto, pulsante vivo e NESSUNA proposta di
##    installare Docker (il difetto raccontato: colima girava davvero);
##  · «step saltato» → il profilo non si apre col container spento.
##
## Lo stato si inietta in SetupService.status invece di dipendere dal computer
## che esegue il test: le tre schermate devono valere su un runner senza
## Docker come sulla macchina dell'operatore, che ha Colima acceso.
func _setup_gating_selftest() -> void:
	await get_tree().process_frame
	var result := {}
	var original: Dictionary = SetupService.status.duplicate(true)
	var colima: String = SetupService.RUNTIME_COLIMA
	var desktop: String = SetupService.RUNTIME_DOCKER_DESKTOP

	# ── (a) Nessun motore installato ────────────────────────────────────
	SetupService.status["remote"] = false
	SetupService.status["runtimes"] = PackedStringArray()
	SetupService.status["runtime_selected"] = ""
	SetupService.status["docker_available"] = false
	SetupService.status["docker_running"] = false
	SetupService.status["container_running"] = false
	var none := SectionPanel.new("docker", 24.0)
	office.add_child(none)
	await get_tree().process_frame
	var start := _panel_button(none, UIStrings.t("setup.container_start"))
	result["assente_attiva_spento"] = start != null and start.disabled
	result["assente_motivo_a_schermo"] = _panel_has_label(none,
			UIStrings.t("setup.container_needs_runtime"))
	result["assente_offre_installazione"] = _panel_button(none,
			UIStrings.t("setup.docker_install")) != null
	result["assente_nessuna_scelta_motore"] = not _panel_has_label(none,
			UIStrings.t("setup.runtime_choice"))
	none.queue_free()
	await get_tree().process_frame

	# ── (b) Solo Colima, installato ma spento ───────────────────────────
	SetupService.status["runtimes"] = PackedStringArray([colima])
	SetupService.status["runtime_selected"] = colima
	SetupService.status["docker_available"] = true
	var only_colima := SectionPanel.new("docker", 24.0)
	office.add_child(only_colima)
	await get_tree().process_frame
	start = _panel_button(only_colima, UIStrings.t("setup.container_start"))
	result["colima_attiva_premibile"] = start != null and not start.disabled
	# Il difetto O-13b in una riga: con un motore installato, "installa Docker"
	# è una proposta senza senso.
	result["colima_niente_installa_docker"] = _panel_button(only_colima,
			UIStrings.t("setup.docker_install")) == null
	result["colima_motore_nominato"] = _panel_has_label(only_colima,
			UIStrings.t("setup.runtime_installed_off")
			% UIStrings.t("setup.runtime_colima"))
	result["colima_nessuna_scelta_inutile"] = not _panel_has_label(only_colima,
			UIStrings.t("setup.runtime_choice"))
	only_colima.queue_free()
	await get_tree().process_frame

	# ── (c) Due motori: la scelta va CHIESTA ────────────────────────────
	SetupService.status["runtimes"] = PackedStringArray([colima, desktop])
	SetupService.status["runtime_selected"] = colima
	var both := SectionPanel.new("docker", 24.0)
	office.add_child(both)
	await get_tree().process_frame
	result["due_motori_scelta_offerta"] = _panel_has_label(both,
			UIStrings.t("setup.runtime_choice"))
	result["due_motori_colima_selezionabile"] = _panel_button(both,
			UIStrings.t("setup.runtime_colima")) != null
	result["due_motori_desktop_selezionabile"] = _panel_button(both,
			UIStrings.t("setup.runtime_docker_desktop")) != null
	both.queue_free()
	await get_tree().process_frame

	# ── (e) Gli step sono una catena, non quattro schede ─────────────────
	SetupService.status["provider_authenticated"] = false
	SetupService.status["plan_ready"] = false
	SetupService.status["profile_ready"] = false
	SetupService.status["unknown_steps"] = []
	var locked := SectionPanel.new("activation", 24.0)
	office.add_child(locked)
	await get_tree().process_frame
	# Container spento: 02, 03 e 04 sono bloccati, 01 no.
	result["catena_tre_passi_bloccati"] = _panel_button_count(locked,
			UIStrings.t("setup.gate_locked")) == 3
	result["catena_motivo_container"] = _panel_has_label(locked,
			UIStrings.t("setup.gate_needs_container"))
	# Il difetto raccontato dall'operatore: il profilo si apriva col container
	# ancora inesistente, e il colloquio finiva contro un interlocutore spento.
	var profile_gate := _panel_button(locked, UIStrings.t("setup.gate_locked"))
	result["catena_bloccato_non_premibile"] = profile_gate != null \
			and profile_gate.disabled
	locked.queue_free()
	await get_tree().process_frame

	# Container acceso: si sblocca SOLO il passo successivo.
	SetupService.status["container_running"] = true
	SetupService.status["docker_running"] = true
	var partial := SectionPanel.new("activation", 24.0)
	office.add_child(partial)
	await get_tree().process_frame
	result["catena_sblocca_uno_alla_volta"] = _panel_button_count(partial,
			UIStrings.t("setup.gate_locked")) == 2
	result["catena_motivo_provider"] = _panel_has_label(partial,
			UIStrings.t("setup.gate_needs_provider"))
	partial.queue_free()
	await get_tree().process_frame

	# Setup completo: nessun passo bloccato, nessuna spiegazione da dare.
	SetupService.status["provider_authenticated"] = true
	SetupService.status["plan_ready"] = true
	SetupService.status["profile_ready"] = true
	SetupService.status["hours_ready"] = true
	var open_all := SectionPanel.new("activation", 24.0)
	office.add_child(open_all)
	await get_tree().process_frame
	result["catena_completa_tutto_aperto"] = _panel_button_count(open_all,
			UIStrings.t("setup.gate_locked")) == 0
	open_all.queue_free()
	await get_tree().process_frame

	SetupService.status = original
	var ok := true
	for key in result:
		ok = ok and bool(result[key])
	print("SETUP-GATING-TEST %s %s" % ["PASS" if ok else "FAIL",
			JSON.stringify(result)])
	get_tree().quit(0 if ok else 1)


## Il contenuto grezzo di un file in `user://`, o un array vuoto se non c'è.
## Serve ai self-test che scrivono nella cartella dell'utente per rimetterla
## com'era: un test che lascia tracce cambia l'esito di quello dopo.
func _read_user_file(path: String) -> PackedByteArray:
	if not FileAccess.file_exists(path):
		return PackedByteArray()
	return FileAccess.get_file_as_bytes(path)


## Rimette il file com'era: byte identici, oppure di nuovo assente se prima
## non c'era (un file "vuoto ma presente" non è lo stesso stato di partenza).
func _write_user_file(path: String, data: PackedByteArray) -> void:
	if data.is_empty():
		DirAccess.remove_absolute(ProjectSettings.globalize_path(path))
		return
	var f := FileAccess.open(path, FileAccess.WRITE)
	if f != null:
		f.store_buffer(data)
		f.close()


## Premere il bottone di un profilo come farebbe l'utente. Il pannello si
## ricostruisce a ogni scelta, quindi i bottoni vanno ritrovati ogni volta.
func _press_graphics_choice(panel: SectionPanel, key: String) -> void:
	var wanted := UIStrings.t(key).to_upper()
	for node in panel.find_children("*", "Button", true, false):
		var button := node as Button
		if button.text.begins_with(wanted):
			button.pressed.emit()
			return


## Il testo del mondo resta leggibile a ogni scala di rendering: quando il mondo
## si disegna su meno pixel, targhe e vignette si ingrandiscono della stessa
## proporzione, così il dettaglio in pixel FISICI non cala mai. Qui si misura
## proprio quello, sui nodi vivi dell'ufficio.
func _world_text_selftest() -> void:
	await get_tree().process_frame
	var result := {}
	var tag: AgentStateTag = null
	var bubble: SpeechBubble = null
	for agent in office.agents:
		if agent.state_tag != null and agent.speech != null:
			tag = agent.state_tag
			bubble = agent.speech
			break
	if tag == null or bubble == null:
		print("WORLD-TEXT-TEST FAIL {\"agenti_con_targa\":false}")
		get_tree().quit(1)
		return
	bubble.say("Ho trovato tre posizioni nuove e le ho passate agli analisti")
	await get_tree().process_frame
	office.set_render_scale(1.0)
	await get_tree().process_frame
	var full: Dictionary = tag.debug_metrics()
	var full_bubble: Dictionary = bubble.debug_snapshot()
	result["scala_piena_senza_compensazione"] = is_equal_approx(
			float(full["boost"]), 1.0)

	office.set_render_scale(0.6)
	await get_tree().process_frame
	var low: Dictionary = tag.debug_metrics()
	var low_bubble: Dictionary = bubble.debug_snapshot()
	# 1/0.6 = 1.667: il corpo del testo cresce di tanto, quindi in pixel fisici
	# la targa conserva il dettaglio che aveva a risoluzione piena.
	result["compensazione_pari_alla_scala"] = is_equal_approx(
			float(low["boost"]), 1.0 / 0.6)
	result["targa_ingrandita"] = int(low["font_size"]) >= int(
			round(float(full["font_size"]) / 0.6)) - 1
	result["vignetta_ingrandita"] = int(low_bubble["font_size"]) >= int(
			round(float(full_bubble["font_size"]) / 0.6)) - 1
	# Il riquadro deve continuare a contenere la frase: se crescesse solo il
	# font, il testo uscirebbe dalla targa.
	result["riquadro_contiene_il_testo"] = float(low["box_width"]) \
			> float(low["text_width"])
	# Stessa impaginazione: la larghezza di wrap è cresciuta col font, quindi la
	# vignetta ha la stessa forma — più grande, non ricomposta.
	result["impaginazione_invariata"] = int(low_bubble["lines"]) \
			== int(full_bubble["lines"]) and int(low_bubble["lines"]) > 1
	result["wrap_ingrandito"] = float(low_bubble["max_width"]) \
			> float(full_bubble["max_width"])

	# Il ritorno al profilo pieno riporta il testo alla misura di sempre.
	office.set_render_scale(1.0)
	await get_tree().process_frame
	result["ritorno_a_scala_piena"] = is_equal_approx(
			float(tag.debug_metrics()["boost"]), 1.0) \
			and int(bubble.debug_snapshot()["font_size"]) == int(full_bubble["font_size"])
	var ok := true
	for key in result:
		ok = ok and bool(result[key])
	print("WORLD-TEXT-TEST %s %s" % ["PASS" if ok else "FAIL",
			JSON.stringify(result)])
	get_tree().quit(0 if ok else 1)


## Tre persone volutamente vicine e tre messaggi lunghi: è la regressione del
## burst reale in cui le vignette si dipingevano una sopra l'altra e sulle
## teste. Con JHT_SHOT il test resta vivo fino allo scatto visuale.
func _bubble_layout_selftest() -> void:
	await get_tree().process_frame
	if office.agents.size() < 3:
		print("BUBBLE-LAYOUT-TEST FAIL {\"agents\":false}")
		get_tree().quit(1)
		return
	var center := Vector2(1700, 920)
	var texts := [
		"Ho trovato nuove posizioni e le sto passando al reparto analisi.",
		"Controllo requisiti, stipendio e modalità di lavoro prima dello score.",
		"La prima opportunità è pronta: compatibilità alta e motivazione chiara.",
	]
	var actors: Array[AgentNPC] = []
	for i in 3:
		var actor: AgentNPC = office.agents[i]
		actor.start_talk()
		actor.position = center + Vector2((i - 1) * 105.0, 0)
		actor.say(texts[i])
		actors.append(actor)
	var cam := Camera2D.new()
	cam.position = center + Vector2(0, -135)
	cam.zoom = Vector2(1.55, 1.55)
	office._stage.add_child(cam)
	cam.make_current()
	for _frame in 6:
		await get_tree().process_frame
	office._layout_speech_bubbles(true)
	await get_tree().process_frame
	var rects: Array[Rect2] = []
	for actor in actors:
		rects.append(actor.speech.layout_rect_global(true))
	var bounds: Rect2 = office._speech_layout_bounds()
	var boxes_clear := true
	for i in rects.size():
		for j in range(i + 1, rects.size()):
			boxes_clear = boxes_clear and not rects[i].intersects(rects[j])
	var heads_clear := true
	var inside_bounds := true
	for rect in rects:
		inside_bounds = inside_bounds and bounds.encloses(rect)
		for agent in office.agents:
			heads_clear = heads_clear and not rect.intersects(
					office._speech_head_rect(agent))
	var lifted: bool = actors[1].speech.debug_snapshot()["layout_offset"] != Vector2.ZERO \
			or actors[2].speech.debug_snapshot()["layout_offset"] != Vector2.ZERO
	var named := true
	for actor in actors:
		named = named and not str(
				actor.speech.debug_snapshot()["speaker_label"]).is_empty()
	var ok: bool = boxes_clear and heads_clear and inside_bounds and lifted and named
	print("BUBBLE-LAYOUT-TEST %s %s" % ["PASS" if ok else "FAIL",
			JSON.stringify({"boxes_clear": boxes_clear, "heads_clear": heads_clear,
				"inside_bounds": inside_bounds, "lifted": lifted, "named": named})])
	if OS.get_environment("JHT_SHOT") == "":
		get_tree().quit(0 if ok else 1)


## Fotografia della scena costruita: quanti CanvasItem visibili, da quale ramo
## arrivano e — con la finestra aperta, non headless — quante draw call costa
## ciascun ramo. La misura è differenziale: si spegne un ramo, si guarda di
## quanto scende il contatore, si riaccende. È l'unico modo onesto di attribuire
## le draw call, che non stanno in rapporto 1:1 coi nodi.
## I rami si cercano sul palcoscenico dell'ufficio e non sulla scena: col
## profilo pixel il mondo vive dentro il SubViewport e da fuori si vedrebbe un
## solo figlio (PixelLayer).
func _scene_census() -> void:
	for _i in 5:
		await get_tree().process_frame
	Log.census(office._stage)
	var baseline := await _draw_calls()
	Log.info("census", "draw call totali: %d" % baseline)
	if baseline > 0:
		var costs := []
		for branch in office._stage.get_children():
			var item := branch as CanvasItem
			if item == null or not item.visible:
				continue
			item.visible = false
			var without := await _draw_calls()
			item.visible = true
			costs.append([_census_name(branch), baseline - without])
		costs.sort_custom(func(a: Array, b: Array) -> bool: return a[1] > b[1])
		for row in costs:
			Log.info("census", "  costo %-28s %4d draw call" % [row[0], row[1]])
		if office.world != null:
			await _census_group(office.world, baseline)
	get_tree().quit(0)


## Dentro il ramo più caro i figli sono centinaia: si spengono a gruppi
## omogenei (stesso script) per sapere quale famiglia di oggetti costa.
func _census_group(branch: Node, baseline: int) -> void:
	var groups := {}
	for child in branch.get_children():
		if child is CanvasItem:
			var key := _census_name(child)
			if not groups.has(key):
				groups[key] = []
			groups[key].append(child)
	var costs := []
	for key in groups:
		for node: CanvasItem in groups[key]:
			node.visible = false
		var without := await _draw_calls()
		for node: CanvasItem in groups[key]:
			node.visible = true
		costs.append([key, baseline - without, groups[key].size()])
	costs.sort_custom(func(a: Array, b: Array) -> bool: return a[1] > b[1])
	Log.info("census", "dentro %s:" % _census_name(branch))
	for row in costs:
		Log.info("census", "  %-26s %4d draw call su %3d nodi" % [row[0], row[1], row[2]])
	# `agent_npc` era il ramo più caro ma restava una scatola nera: corpo,
	# ombra, aura e tre indicatori finivano nello stesso numero. Misuriamo i
	# figli omologhi di tutti gli agenti insieme, così il profilo low-spec può
	# togliere decorazione senza sacrificare a intuito testo o stato reale.
	var agents: Array[CanvasItem] = []
	for nodes: Array in groups.values():
		for node: CanvasItem in nodes:
			if node is AgentNPC:
				agents.append(node)
	if not agents.is_empty():
		await _census_agent_parts(agents, baseline)


func _census_agent_parts(agents: Array[CanvasItem], baseline: int) -> void:
	var groups := {}
	for agent: CanvasItem in agents:
		for child in agent.get_children():
			if child is CanvasItem:
				var key := _census_name(child)
				if not groups.has(key):
					groups[key] = []
				groups[key].append(child)
	var costs := []
	for key in groups:
		for node: CanvasItem in groups[key]:
			node.visible = false
		var without := await _draw_calls()
		for node: CanvasItem in groups[key]:
			node.visible = true
		costs.append([key, baseline - without, groups[key].size()])
	costs.sort_custom(func(a: Array, b: Array) -> bool: return a[1] > b[1])
	Log.info("census", "dentro agent_npc:")
	for row in costs:
		Log.info("census", "    %-24s %4d draw call su %3d nodi" % [row[0], row[1], row[2]])


## I nodi creati da codice restano anonimi (@Node2D@41): il nome dello script
## è l'unica etichetta leggibile per attribuire il costo.
func _census_name(node: Node) -> String:
	var script: Script = node.get_script() as Script
	if script != null and script.resource_path != "":
		return script.resource_path.get_file().trim_suffix(".gd")
	if not node.name.begins_with("@"):
		return str(node.name)
	return node.get_class()


## Contatore stabilizzato: il monitor si aggiorna a fine frame, quindi va
## letto dopo che il ramo spento è davvero uscito dal rendering.
func _draw_calls() -> int:
	for _i in 3:
		await get_tree().process_frame
	return int(Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME))


func _camera_lock_selftest() -> void:
	var blocker := Node.new()
	office.add_child(blocker)
	blocker.add_to_group("camera_blocking_overlay")
	var before_pos: Vector2 = office._camera.position
	var before_zoom: Vector2 = office._camera.zoom
	var pan := InputEventPanGesture.new()
	pan.delta = Vector2(20, 15)
	office._camera._unhandled_input(pan)
	var wheel := InputEventMouseButton.new()
	wheel.button_index = MOUSE_BUTTON_WHEEL_UP
	wheel.pressed = true
	office._camera._unhandled_input(wheel)
	var ok: bool = office._camera.position.is_equal_approx(before_pos) \
			and office._camera.zoom.is_equal_approx(before_zoom)
	print("CAMERA-OVERLAY-LOCK-TEST ", "PASS" if ok else "FAIL")
	blocker.queue_free()
	get_tree().quit(0 if ok else 1)


## Regressione G-03: il primo frame della FreeCamera deve contenere teste e
## piedi del roster completo. Si esegue con JHT_ALL_SEATED_PREVIEW=1 per
## montare tutte le 36 postazioni reali, senza una regia/crop da screenshot.
func _agent_frame_selftest() -> void:
	await get_tree().process_frame
	# La matrice generale avvia i test in italiano per la retrocompatibilita'
	# delle altre asserzioni. Qui si prova deliberatamente il primo avvio: EN.
	UIStrings.set_lang(UIStrings.DEFAULT_LANG, false)
	var camera: FreeCamera = office._camera
	var half_view: Vector2 = office.get_viewport_rect().size / (2.0 * camera.zoom.x)
	var frame := Rect2(camera.position - half_view, half_view * 2.0)
	var safe_frame := frame.grow(-12.0)
	var failures: Array[String] = []
	if not camera.position.is_equal_approx(FurnitureDefs.FLOOR.get_center()):
		failures.append("camera non centrata sul pavimento operativo")
	if safe_frame.position.y > FurnitureDefs.FLOOR.position.y \
			or safe_frame.end.y < FurnitureDefs.FLOOR.end.y:
		failures.append("il pavimento operativo esce verticalmente dal frame iniziale")
	var expected_roster := CharacterDefs.spawn_list().size()
	if office.agents.size() != expected_roster:
		failures.append("roster %d invece di %d" % [office.agents.size(), expected_roster])
	for agent: AgentNPC in office.agents:
		var head_y := agent.global_position.y - 165.0
		if agent.rig != null and agent.rig.visible and agent.rig.has_method("visual_top_y"):
			head_y = agent.global_position.y + float(agent.rig.visual_top_y())
		if not safe_frame.has_point(Vector2(agent.global_position.x, head_y)) \
				or not safe_frame.has_point(agent.global_position):
			failures.append(str(agent.slug))
	var state_tag := AgentStateTag.new()
	var labels := {
		"idle": UIStrings.t("dept.agent_status.waiting"),
		"working": UIStrings.t("dept.agent_status.working"),
		"throttled": "THROTTLED  3:00",
		"paused": UIStrings.t("dept.agent_status.paused"),
		"resting": UIStrings.t("dept.agent_status.resting"),
	}
	for status: String in labels:
		state_tag.set_state(status, 180.0)
		if state_tag.debug_label() != labels[status]:
			failures.append("targa stato " + status)
	var ok := failures.is_empty()
	print("AGENT-FRAME-TEST %s %s" % ["PASS" if ok else "FAIL",
			JSON.stringify({"frame": frame, "agents": office.agents.size(),
			"failures": failures})])
	get_tree().quit(0 if ok else 1)


## First-run E2E senza rete: attraversa gli alberi scripted e monta il
## pannello chat reale: prima offline choice-only, poi live col mock e scelte
## contestuali prodotte dall'agente (mai sovrapposte al copione authored).
## E2E del tour accompagnato: benvenuto con saluto orario, catena delle
## tappe presentate dall'Assistente, preferenze reali dal Mentor, scelta
## runtime del Coordinatore che apre la pagina giusta, checklist finale.
func _tour_selftest() -> void:
	var failures: Array[String] = []
	var check := func(ok: bool, message: String) -> void:
		if not ok:
			failures.append(message)
	# La macchina che esegue il test può avere Docker e provider veri:
	# lo stato va forzato a "primo avvio" come nel selftest guidato.
	ScriptedOnboarding.set_provider_test_override(0)
	SetupService.status["provider_authenticated"] = false
	SetupService.status["container_running"] = false
	SetupService.status["profile_ready"] = false
	SetupService.status["ready"] = false
	office._on_setup_status_changed(SetupService.status)
	await get_tree().create_timer(0.6).timeout
	office._refresh_tour_markers()
	check.call(office._tour_enabled and TourGuide.active(), "tour non attivo")
	check.call(is_instance_valid(office._tour_tracker), "TourTracker assente")
	check.call(TourGuide.current_slug() == "assistente",
			"il tour non parte dall'Assistente")
	for stop in TourGuide.TALK_STEPS:
		check.call(Dialogues.TREES.has(str(TourGuide.scene_for(stop).get("tree", ""))),
				"albero di dialogo mancante per la tappa " + stop)
		if TourGuide.requires_staged_colleague(stop):
			var scene := TourGuide.scene_for(stop)
			check.call(str(scene.get("portrait", "")) == stop,
					"ritratto del collega errato per la tappa " + stop)
			# il confronto passa da role_name e non da una stringa italiana
			# scritta qui: con l'interfaccia in un'altra lingua un literal
			# non combacerebbe più e il controllo passerebbe sempre
			check.call(str(scene.get("name", ""))
							!= CharacterDefs.role_name("assistente"),
					"il reparto parla ancora con la voce dell'Assistente: " + stop)
	check.call(Dialogues.greeting() in ["Good morning", "Good afternoon", "Good evening"],
			"saluto orario fuori catalogo")
	# P0 English release surface: every authored dialogue node and choice must
	# be English, and the two lines approved for the launch tutorial must stay
	# exact. Dynamic placeholders are checked separately below.
	var italian_markers := ["Benvenuto", "Ciao", "Questo è", "Questa è",
			"l'ufficio", "la squadra", "opportunità", "candidatura",
			"Ricerca", "Analisi", "Compatibilità", "Candidature",
			"Controllo qualità", "Posso ", "Puoi ", "Andiamo", "Torna"]
	for tree_id in Dialogues.TREES:
		var dialogue_tree: Dictionary = Dialogues.TREES[tree_id]
		for node_id in dialogue_tree:
			var node: Dictionary = dialogue_tree[node_id]
			var authored: Array[String] = [str(node.get("text", ""))]
			for choice in node.get("choices", []):
				authored.append(str(choice.get("text", "")))
			for line in authored:
				for marker in italian_markers:
					check.call(not line.contains(marker),
							"testo italiano in %s/%s: %s" % [tree_id, node_id, line])
	check.call(str(Dialogues.TREES["tour_benvenuto"]["start"]["text"])
			== "[caldo] {greeting}{player}! Welcome to your office. From today, everyone you see here works for one person: you.",
			"apertura tour non coincide col copy approvato VIDEO")
	check.call(str(Dialogues.TREES["tour_benvenuto"]["n2"]["text"])
			== "[caldo] I’m the Assistant—your guide here. I can introduce the team, or you can explore on your own. Your call.",
			"presentazione Assistente non coincide col copy approvato VIDEO")
	var count_markers := func() -> Array:
		var visible_count := 0
		var marked_slugs := {}
		for a in office.agents:
			if a.quest_marker != null and a.quest_marker.visible:
				visible_count += 1
				marked_slugs[ScriptedOnboarding.normalize_agent(a.slug)] = true
		return [visible_count, marked_slugs]
	var markers: Array = count_markers.call()
	check.call(markers[1].size() == 1 and markers[1].has("assistente"),
			"marker non limitati all'Assistente (%d visibili)" % int(markers[0]))
	# ordine forzato: un incontro fuori sequenza non avanza il tour
	TourGuide.notify_talked("scout")
	check.call(TourGuide.step_index() == 0, "incontro fuori sequenza avanza il tour")
	# cattura le pagine aperte dalle azioni del tour (scelta runtime)
	var opened_sections: Array = []
	var capture := func(action: String, payload: Dictionary) -> void:
		if action == "open_section":
			opened_sections.append(str(payload.get("section", "")))
	ScriptedOnboarding.action_requested.connect(capture)
	# benvenuto: il click sull'Assistente apre tour_benvenuto
	var guide: AgentNPC = office._tour_guide_npc()
	check.call(guide != null, "Assistente assente dallo showroom")
	var find_dialogue := func() -> DialogueUI:
		var found: DialogueUI = null
		for child in office.get_children():
			if child is DialogueUI and not child.is_queued_for_deletion():
				found = child
		return found
	if guide:
		# Riproduce ONB-001 attraverso lo stesso dispatcher del click reale.
		# L'Assistente seduta vive nel composito della reception: volto e
		# diamante non coincidono col vecchio cerchio attorno ai piedi.
		var seated_face := guide.global_position + Vector2(0, -118)
		var marker_center := guide.quest_marker.global_position \
				if guide.quest_marker != null else Vector2.INF
		check.call(guide.hit_by(seated_face),
				"il volto visibile dell'Assistente non e' cliccabile")
		check.call(guide.quest_marker != null and guide.quest_marker.visible \
				and guide.hit_by(marker_center),
				"il diamante visibile dell'Assistente non e' cliccabile")
		var camera_hint: Control = office.find_child("CameraHint", true, false) as Control
		check.call(camera_hint != null \
				and camera_hint.mouse_filter == Control.MOUSE_FILTER_IGNORE,
				"l'hint della camera intercetta il click sulla reception")
		# Attraversa anche FreeCamera: la vecchia implementazione rileggeva il
		# cursore globale invece del pixel dell'evento e questo self-test falliva
		# senza spostare davvero il mouse della macchina che esegue Godot.
		var marker_screen: Vector2 = \
				office.get_viewport().get_canvas_transform() * marker_center
		var press := InputEventMouseButton.new()
		press.button_index = MOUSE_BUTTON_LEFT
		press.position = marker_screen
		press.pressed = true
		var release := InputEventMouseButton.new()
		release.button_index = MOUSE_BUTTON_LEFT
		release.position = marker_screen
		release.pressed = false
		office._camera._unhandled_input(press)
		# Riproduce la deriva fra i due eventi: la camera guidata può essere
		# ancora in movimento quando l'utente preme. Il target deve restare
		# quello campionato dal frame visibile al press.
		var camera_position: Vector2 = office._camera.position
		office._camera.position += Vector2(0, -300)
		office._camera.reset_smoothing()
		await get_tree().process_frame
		office._camera._unhandled_input(release)
		office._camera.position = camera_position
		office._camera.reset_smoothing()
		await get_tree().process_frame
		var welcome: DialogueUI = find_dialogue.call()
		check.call(welcome != null and welcome._tree.has("ready"),
				"un click sul diamante non apre tour_benvenuto")
		if welcome:
			welcome._close()
	# da qui la catena è automatica (in test-mode senza camminate): a ogni
	# chiusura la tappa avanza e si apre il dialogo successivo
	var expected := ["scout", "analista", "scorer", "scrittore", "critico",
			"dottore", "mentor", "coordinatore"]
	var visited: Array = []
	for _i in expected.size():
		await get_tree().process_frame
		await get_tree().process_frame
		var stop := TourGuide.current_slug()
		var ui: DialogueUI = find_dialogue.call()
		if ui == null:
			failures.append("dialogo della tappa non aperto: " + stop)
			break
		visited.append(stop)
		var scene := TourGuide.scene_for(stop)
		check.call(ui._tree == Dialogues.TREES.get(str(scene.get("tree", "")), {}),
				"albero sbagliato per la tappa " + stop)
		if TourGuide.requires_staged_colleague(stop):
			var colleague: AgentNPC = office._tour_host_npc(stop)
			check.call(office._tour_staged_host == colleague,
					"collega non messo in scena per la tappa " + stop)
			check.call(guide != null and str(guide.rig.facing) == "down" \
					and colleague != null and str(colleague.rig.facing) == "down",
					"personaggi non rivolti all'utente nella tappa " + stop)
		if stop == "mentor":
			# percorso adattivo: le scelte diventano preferenze salvate
			ui._goto("path_change")
			ui._goto("style_calm")
			ui._goto("cad_week")
		elif stop == "coordinatore":
			ui._goto("pick_vps")
		ui._close()
	check.call(visited == expected,
			"sequenza tappe errata: " + JSON.stringify(visited))
	var prefs := ScriptedOnboarding.preferences()
	check.call(prefs.get("career_priority", "") == "growth" \
			and prefs.get("search_style", "") == "cautious" \
			and prefs.get("mentor_cadence", "") == "weekly" \
			and prefs.get("runtime_location", "") == "vps",
			"le scelte del tour non diventano preferenze: " + JSON.stringify(prefs))
	check.call(TourGuide.in_launch_phase(), "fase di lancio non raggiunta")
	check.call(TourGuide.depts_visited() == 5, "conteggio reparti errato")
	await get_tree().process_frame
	check.call(office._tour_launch_opened and opened_sections.has("vps"),
			"la scelta VPS non apre la pagina VPS: " + JSON.stringify(opened_sections))
	ScriptedOnboarding.action_requested.disconnect(capture)
	# checklist verde → tour concluso e marker showroom ripristinati
	SetupService.status["ready"] = true
	TourGuide.notify_setup_status(SetupService.status)
	check.call(not TourGuide.active(), "tour non concluso a setup pronto")
	await get_tree().process_frame
	markers = count_markers.call()
	check.call(int(markers[0]) == office.agents.size(),
			"marker showroom non ripristinati a tour finito (%d)" % int(markers[0]))

	# ── Placeholder personali e stato Docker nei dialoghi ─────────────
	ScriptedOnboarding.set_player_name("Test", "Utente")
	check.call(Dialogues.resolve_placeholders("{greeting}{player}!", TeamData)
			.contains(", Test"), "il saluto non usa il nome dell'utente")
	check.call(TourGuide.invite_line().contains(", Test"),
			"l'invito del tour non usa il nome dell'utente")
	SetupService.status["docker_available"] = false
	SetupService.status["docker_running"] = false
	var no_docker := Dialogues.resolve_placeholders("{docker_line}", TeamData)
	SetupService.status["docker_available"] = true
	SetupService.status["docker_running"] = true
	var docker_on := Dialogues.resolve_placeholders("{docker_line}", TeamData)
	check.call(no_docker.contains("guided installation") \
			and docker_on.contains("team") and no_docker != docker_on,
			"la battuta del Coordinatore non segue lo stato Docker")

	# ── Giro libero: ordine sparso, alberi in prima persona ───────────
	TourGuide.reset_for_test()
	office._tour_launch_opened = false
	SetupService.status["ready"] = false
	check.call(TourGuide.active(), "reset per il giro libero fallito")
	# la scelta "giro libero" avviene DENTRO il benvenuto: prima la modalità,
	# poi la chiusura del dialogo (in guidato partirebbe la regia verso Scout)
	TourGuide.set_free_mode()
	TourGuide.notify_talked("assistente")
	check.call(TourGuide.mode() == "free", "modalità libera non attiva")
	check.call(TourGuide.pending_stops().size() == 8,
			"tappe pendenti errate in giro libero")
	for stop in ["critico", "scout", "mentor"]:
		check.call(TourGuide.stop_open(str(stop)),
				"tappa non apribile in giro libero: " + str(stop))
		check.call(Dialogues.TREES.has(str(TourGuide.scene_for(str(stop)).get("tree", ""))),
				"albero in prima persona mancante per " + str(stop))
	await get_tree().process_frame
	markers = count_markers.call()
	check.call(markers[1].size() == 8 and not markers[1].has("assistente"),
			"marker giro libero errati: " + JSON.stringify(markers[1].keys()))
	# ONB-002 usa soltanto i click nel mondo: attraversiamo i marker in ordine
	# sparso e chiudiamo ogni presentazione, senza pilotare direttamente lo
	# stato. Ogni chiusura deve consumare una sola tappa e liberare la seguente.
	var free_order := ["critico", "scout", "dottore", "mentor", "scorer",
			"analista", "scrittore", "coordinatore"]
	for stop in free_order:
		var host: AgentNPC = office._tour_host_npc(str(stop))
		var pending_before := TourGuide.pending_stops().size()
		check.call(host != null and host.quest_marker != null \
				and host.quest_marker.visible,
				"marker/host assente nel giro libero: " + str(stop))
		if host == null or host.quest_marker == null:
			continue
		var free_marker := host.quest_marker.global_position
		check.call(host.hit_by(free_marker),
				"marker non cliccabile nel giro libero: " + str(stop))
		office._on_world_click(free_marker)
		await get_tree().process_frame
		var free_ui: DialogueUI = find_dialogue.call()
		var expected_tree := str(TourGuide.scene_for(str(stop)).get("tree", ""))
		check.call(free_ui != null and free_ui._tree_id == expected_tree,
				"click libero non apre la presentazione di " + str(stop))
		check.call(office._dept_panel == null,
				"click libero cade sul pannello reparto per " + str(stop))
		if free_ui:
			free_ui._close()
		await get_tree().process_frame
		await get_tree().process_frame
		check.call(not TourGuide.stop_open(str(stop)) \
				and TourGuide.pending_stops().size() == pending_before - 1,
				"tappa libera non consumata una sola volta: " + str(stop))
		if stop != "coordinatore":
			check.call(not TourGuide.in_launch_phase(),
					"fase di lancio anticipata dopo " + str(stop))
	check.call(TourGuide.in_launch_phase(),
			"giro libero non arriva al lancio dopo il Coordinatore")
	check.call(TourGuide.depts_visited() == 5,
			"conteggio reparti errato in giro libero")

	# ── Teaser post-tour: team spento → l'agente invita al setup ──────
	TourGuide.finish()
	await get_tree().process_frame
	var writer: AgentNPC = office._tour_host_npc("scrittore")
	check.call(writer != null, "scrittore assente dallo showroom")
	if writer:
		office._start_talk(writer)
		await get_tree().process_frame
		var tease: DialogueUI = find_dialogue.call()
		check.call(tease != null and tease._tree_id == "tease_scrittore",
				"il post-tour senza setup non apre il teaser dello scrittore " \
				+ "(ui=%s tree=%s active=%s ready=%s)" % [
					str(tease != null),
					tease._tree_id if tease else "-",
					str(Game.dialogue_active),
					str(SetupService.status.get("ready", "?"))])
		if tease:
			tease._close()
	var ok := failures.is_empty()
	print("TOUR-TEST ", "PASS " if ok else "FAIL ",
			JSON.stringify({"failures": failures, "visited": visited}))
	await get_tree().create_timer(0.3).timeout
	get_tree().quit(0 if ok else 1)

## O-14 + WIN-TOUR-DRAWS-OVER-SETUP — «l'utente interrompe all'inizio,
## va dritto al setup e poi riprende dallo stesso punto».
##
## Il difetto non era che mancasse un pulsante: era che l'interruzione esisteva per
## il TOUR e non per il GIRO. Chi la premeva si fermava a metà — la regia
## taceva, ma le chat guidate continuavano a parlare e ad aprire pannelli
## sopra quello che stava facendo. Da qui i controlli sotto: dopo l'uscita si
## verifica che TACCIANO ANCHE LORO, ma senza marcare concluso il progresso:
## la ripresa deve riusare l'indice già persistito, non ricominciare.
##
## Gira con il TutorialHarness acceso, quindi scrive sul config sintetico:
## la persistenza è metà del contratto e va verificata su file vero, mai su
## quello della persona che sta usando il gioco.
func _tour_exit_selftest() -> void:
	var failures: Array[String] = []
	var check := func(ok: bool, message: String) -> void:
		if not ok:
			failures.append(message)
	# Primo avvio: né provider né container, come chi apre il gioco la prima
	# volta e vuole andare dritto alla configurazione.
	ScriptedOnboarding.set_provider_test_override(0)
	SetupService.status["provider_authenticated"] = false
	SetupService.status["container_running"] = false
	SetupService.status["profile_ready"] = false
	SetupService.status["ready"] = false
	office._on_setup_status_changed(SetupService.status)
	await get_tree().create_timer(0.6).timeout
	office._refresh_tour_markers()

	check.call(office._tour_enabled and TourGuide.active(),
			"il giro non è attivo: il test non starebbe provando nulla")
	check.call(not ScriptedOnboarding.is_dismissed(),
			"il giro risulta già chiuso prima di uscirne")
	check.call(TourGuide.current_slug() == "assistente",
			"l'uscita non viene provata all'INIZIO del giro")
	var guided_before := ScriptedOnboarding.use_scripted_chat("assistente")
	check.call(guided_before, "le chat guidate non sono attive prima dell'uscita")

	# Le azioni che aprivano pannelli da sole: dopo l'uscita non ne deve
	# partire più nessuna, ed è il motivo per cui si registrano da qui.
	var actions: Array[String] = []
	var capture := func(action: String, _payload: Dictionary) -> void:
		actions.append(action)
	ScriptedOnboarding.action_requested.connect(capture)

	# ── Il pulsante esiste ed è VISIBILE, non solo istanziato ─────────
	var sidebar: GameSidebar = null
	for child in office.get_children():
		if child is GameSidebar:
			sidebar = child
			break
	check.call(sidebar != null, "sidebar assente: l'uscita non ha una casa stabile")
	if sidebar:
		var exit_row: Control = sidebar._exit_tour.get_parent() as Control
		check.call(is_instance_valid(sidebar._exit_tour) and exit_row.visible,
				"il menu laterale non mostra l'uscita mentre il giro è in corso")
		check.call(sidebar._exit_tour.text != "" \
				and sidebar._exit_tour.text != "tour.exit",
				"l'uscita nel menu non è tradotta")
	check.call(is_instance_valid(office._tour_tracker),
			"la to-do list del tour, che ospita l'altro pulsante, non c'è")

	# ── L'uscita col TASTO, dal percorso vero ─────────────────────────
	# Chiamare exit_guided_onboarding() proverebbe la funzione, non la via
	# che l'utente ha davvero: qui passa dal ramo ESC di Game.
	var esc := InputEventKey.new()
	esc.keycode = KEY_ESCAPE
	esc.physical_keycode = KEY_ESCAPE
	esc.pressed = true
	Game._unhandled_input(esc)
	await get_tree().process_frame
	check.call(not get_tree().paused,
			"ESC ha messo in pausa invece di chiudere il giro")

	check.call(ScriptedOnboarding.is_dismissed(), "l'interruzione non silenzia il giro")
	check.call(not TourGuide.active(), "l'interruzione lascia attiva la regia")
	for agent in ScriptedOnboarding.AGENTS:
		check.call(not ScriptedOnboarding.use_scripted_chat(agent),
				"la chat guidata di %s parla ancora dopo l'uscita" % agent)
		check.call((ScriptedOnboarding.options(agent) as Array).is_empty(),
				"%s propone ancora opzioni guidate dopo l'uscita" % agent)

	# Nessun messaggio nuovo: il container che si accende è proprio l'evento
	# che faceva parlare il Coordinatore sopra il menu.
	var history_before := (ScriptedOnboarding.messages("coordinatore") as Array).size()
	SetupService.status["container_running"] = true
	SetupService.status["provider_authenticated"] = true
	ScriptedOnboarding._reconcile_with_status(SetupService.status)
	await get_tree().process_frame
	check.call((ScriptedOnboarding.messages("coordinatore") as Array).size() \
			== history_before,
			"un agente parla ancora a giro chiuso")
	check.call(actions.is_empty(),
			"a giro chiuso si aprono ancora pannelli da soli: " + JSON.stringify(actions))
	ScriptedOnboarding.action_requested.disconnect(capture)

	# ── Va dritto al setup: niente regia, niente marker che lo chiamano ──
	office._refresh_tour_markers()
	await get_tree().process_frame
	var tour_markers := 0
	for a in office.agents:
		if a.quest_marker != null and a.quest_marker.visible \
				and ScriptedOnboarding.normalize_agent(a.slug) == "assistente":
			tour_markers += 1
	check.call(TourGuide.step_index() == 0 and TourGuide.current_slug() == "assistente" \
			and not TourGuide.stop_open("scout"),
			"l'interruzione ha perso o avanzato la tappa persistita")
	check.call(tour_markers == 0 or not TourGuide.active(),
			"l'Assistente chiama ancora l'utente dopo l'uscita")
	# La configurazione è raggiungibile: è il punto dell'uscita.
	check.call(SetupService.status.has("ready"),
			"lo stato del setup non è consultabile dopo l'uscita")

	# ── Persiste al riavvio ──────────────────────────────────────────
	var cfg := ConfigFile.new()
	var saved := cfg.load(TutorialHarness.ONBOARDING_CFG) == OK \
			and bool(cfg.get_value("guided", "dismissed", false))
	check.call(saved, "l'interruzione non è finita su file: al riavvio riparte da sola")
	# Riavvio simulato: stato in memoria azzerato, ricaricato da file.
	ScriptedOnboarding._dismissed = false
	ScriptedOnboarding._load_state()
	check.call(ScriptedOnboarding.is_dismissed(),
			"l'interruzione non viene riletta al riavvio")
	var tour_cfg := ConfigFile.new()
	check.call(tour_cfg.load(TutorialHarness.TOUR_CFG) == OK \
			and not bool(tour_cfg.get_value("tour", "done", true)) \
			and int(tour_cfg.get_value("tour", "index", -1)) == 0,
			"l'interruzione ha scritto un completamento o perso l'indice su file")

	# ── Ripresa dal pulsante vero: stesso indice, tracker rimontato ─────
	if sidebar:
		var resume_row: Control = sidebar._exit_tour.get_parent() as Control
		check.call(resume_row.visible and sidebar._exit_tour.text != "" \
				and sidebar._exit_tour.text != "tour.resume",
				"la sidebar non offre la ripresa persistita")
		sidebar._exit_tour.pressed.emit()
		await get_tree().process_frame
		check.call(not ScriptedOnboarding.is_dismissed(),
				"il pulsante non riapre il gate del giro")
		check.call(TourGuide.active() and TourGuide.step_index() == 0 \
				and TourGuide.current_slug() == "assistente",
				"la ripresa non torna alla stessa tappa")
		check.call(is_instance_valid(office._tour_tracker),
				"la ripresa non rimonta il tracker")
		check.call(ScriptedOnboarding.use_scripted_chat("assistente"),
				"la ripresa non riattiva la chat guidata")
		var resumed_cfg := ConfigFile.new()
		check.call(resumed_cfg.load(TutorialHarness.ONBOARDING_CFG) == OK \
				and not bool(resumed_cfg.get_value("guided", "dismissed", true)),
				"la ripresa non è persistita: al riavvio tornerebbe in pausa")

	var ok := failures.is_empty()
	print("TOUR-EXIT-TEST ", "PASS " if ok else "FAIL ",
			JSON.stringify({"failures": failures}))
	await get_tree().create_timer(0.3).timeout
	get_tree().quit(0 if ok else 1)


func _target_role_category_selftest() -> void:
	await get_tree().process_frame
	var failures: Array[String] = []
	var check := func(ok: bool, message: String) -> void:
		if not ok:
			failures.append(message)
	UIStrings.set_lang("de", false)
	ScriptedOnboarding.set_provider_test_override(0)
	ScriptedOnboarding.reset_for_test()
	ScriptedOnboarding.choose("assistente", "start")
	var localized_label := UIStrings.t("onb.a.role.design")
	ScriptedOnboarding.choose("assistente", "design")

	var draft := ScriptedOnboarding.profile_draft()
	check.call(draft.get("target_role_category_id", "") == "design",
			"nuova scelta non conserva l'ID categoria")
	check.call(not draft.has("target_role"),
			"nuova scelta crea target_role dalla label")
	var specialty_options := ScriptedOnboarding.options("assistente")
	check.call(not specialty_options.is_empty() \
			and str(specialty_options[0].get("id", "")) == "specialist",
			"categoria design non apre le specialty generiche")
	ScriptedOnboarding.choose("assistente", "specialist")

	var model := ScriptedOnboarding.llm_context()
	var model_text := ScriptedOnboarding.llm_context_text()
	var role_answers: Array = []
	for answer in model.get("answers", []):
		if answer is Dictionary and str(answer.get("step", "")) == "role":
			role_answers.append(answer)
	check.call(model.get("schema_version", 0) == 3,
			"schema contesto non incrementato")
	check.call(role_answers.size() == 1 \
			and str(role_answers[0].get("value", "")) == "design",
			"risposta ruolo non strutturata")
	check.call(role_answers.size() == 1 \
			and not (role_answers[0] as Dictionary).has("label"),
			"label localizzata ancora nella risposta modello")
	check.call(model_text.contains("target_role_category_id: design") \
			and model_text.contains("target_specialty: specialist"),
			"prompt senza categoria o specialty canoniche")
	check.call(not model_text.contains(localized_label),
			"prompt contaminato dalla label localizzata")

	var enriched := ScriptedOnboarding.enrich_profile_fields({
		"target_role": "Senior Product Designer",
	})
	check.call(enriched.get("target_role", "") == "Senior Product Designer",
			"testo target_role libero modificato")
	check.call(enriched.get("target_role_category_id", "") == "design" \
			and enriched.get("target_specialty", "") == "specialist",
			"profilo strutturato senza gli ID canonici")

	# Il vecchio valore instrada in sola lettura, senza riscrivere il draft.
	ScriptedOnboarding.reset_for_test()
	ScriptedOnboarding._steps["assistente"] = "specialty"
	ScriptedOnboarding._draft["target_role"] = "Data / AI"
	var legacy_options := ScriptedOnboarding.options("assistente")
	var legacy_draft := ScriptedOnboarding.profile_draft()
	check.call(not legacy_options.is_empty() \
			and str(legacy_options[0].get("id", "")) == "data_science",
			"legacy non instrada le specialty data")
	check.call(legacy_draft.get("target_role", "") == "Data / AI",
			"target_role legacy modificato")
	check.call(not legacy_draft.has("target_role_category_id"),
			"target_role legacy migrato")

	var ok := failures.is_empty()
	print("TARGET-ROLE-CATEGORY-TEST ", "PASS" if ok else "FAIL ",
			"" if ok else JSON.stringify({"failures": failures}))
	get_tree().quit(0 if ok else 1)


func _guided_onboarding_selftest() -> void:
	var failures: Array[String] = []
	var original_setup := SetupService.status.duplicate(true)
	ScriptedOnboarding.set_provider_test_override(0)
	SetupService.status["provider_authenticated"] = false
	SetupService.status["container_running"] = false
	SetupService.status["ready"] = false
	office._on_setup_status_changed(SetupService.status)
	var check := func(ok: bool, message: String) -> void:
		if not ok:
			failures.append(message)
	var demo := DemoPositions.build()
	var families := {}
	for position in demo:
		families[str(position.get("role_family", ""))] = true
	check.call(demo.size() == 50 and families.size() >= 12,
			"catalogo showroom non contiene 50 ruoli trasversali")
	check.call(CharacterDefs.showroom_list().size() == 16,
			"roster showroom non contiene core + due persone per reparto")
	var marker_count := 0
	for showroom_agent in office.agents:
		if showroom_agent.quest_marker != null and showroom_agent.quest_marker.visible:
			marker_count += 1
	check.call(office.agents.size() == 16 and marker_count == 16 \
			and BackendBus.positions_are_demo and BackendBus.positions.size() == 50,
			"showroom offline non materializzato end-to-end")
	for role in ["coordinatore", "scout", "analista", "scorer", "scrittore",
			"critico", "mentor", "assistente", "mantenitore", "dottore", "sentinella"]:
		check.call(Dialogues.TREES.has(role), "dialogo showroom assente: " + role)
	var dialogue_agent: AgentNPC = null
	for candidate in office.agents:
		if candidate.slug == "assistente":
			dialogue_agent = candidate
			break
	if dialogue_agent:
		office._start_talk(dialogue_agent)
		await get_tree().process_frame
		var dialogue_ui: DialogueUI = null
		for child in office.get_children():
			if child is DialogueUI:
				dialogue_ui = child
				break
		check.call(dialogue_ui != null, "click showroom non apre DialogueUI")
		if dialogue_ui:
			dialogue_ui._finish_typing()
			check.call(dialogue_ui._choices_box.get_child_count() == 3,
					"dialogo showroom non rende le scelte")
			dialogue_ui._close()
			await get_tree().process_frame

	# P0 07/08 — setup incompleto, due persone dello stesso reparto. Il click
	# deve aprire comunque il dialogo authored con opzioni, ma il ritratto
	# segue l'istanza/postazione (scout-1 != scout-2) e resta identico quando
	# si torna sulla stessa persona. Prima office.gd passava sempre "scout".
	var original_tour_done := TourGuide._done
	TourGuide._done = true  # forza il ramo post-tour senza persistere stato
	var scouts: Array[AgentNPC] = []
	for candidate in office.agents:
		if candidate.slug == "scout":
			scouts.append(candidate)
	check.call(scouts.size() >= 2,
			"showroom senza setup non contiene due Scout cliccabili")
	var shown_portraits: Array[String] = []
	for i in mini(2, scouts.size()):
		var scout: AgentNPC = scouts[i]
		var expected_portrait := scout.dialogue_portrait_slug()
		check.call(expected_portrait == scout.dialogue_portrait_slug(),
				"lo stesso Scout cambia ritratto fra due risoluzioni")
		office._start_talk(scout)
		await get_tree().process_frame
		var scout_dialogue: DialogueUI = null
		for child in office.get_children():
			if child is DialogueUI:
				scout_dialogue = child
				break
		check.call(scout_dialogue != null,
				"click su %s non apre DialogueUI a setup incompleto" % scout.display_name)
		if scout_dialogue:
			shown_portraits.append(scout_dialogue._portrait._slug)
			check.call(scout_dialogue._portrait._slug == expected_portrait,
					"%s mostra %s invece del proprio %s" % [scout.display_name,
						scout_dialogue._portrait._slug, expected_portrait])
			check.call(scout_dialogue._tree_id == "tease_scout",
					"setup incompleto non usa il dialogo teaser dello Scout")
			scout_dialogue._finish_typing()
			check.call(scout_dialogue._choices_box.get_child_count() > 0,
					"%s parla ma non offre opzioni di risposta" % scout.display_name)
			scout_dialogue._close()
			await get_tree().process_frame
	TourGuide._done = original_tour_done
	shown_portraits.sort()
	check.call(shown_portraits == ["scout-1", "scout-2"],
			"due Scout dello showroom condividono il ritratto: %s" \
			% JSON.stringify(shown_portraits))
	ScriptedOnboarding.reset_for_test()
	check.call(ScriptedOnboarding.messages("assistente").size() == 1,
			"welcome Assistente assente")
	check.call(ScriptedOnboarding.options("assistente").size() == 3,
			"scelte Assistente errate")
	for choice in ["start", "software", "backend", "mid", "active", "adjacent",
			"remote_first", "europe", "depends", "permanent", "improve", "scaleup"]:
		ScriptedOnboarding.choose("assistente", choice)
	var draft := ScriptedOnboarding.profile_draft()
	check.call(draft.get("target_role_category_id") == "software",
			"ID categoria ruolo non raccolto")
	check.call(not draft.has("target_role"),
			"la label ruolo ha contaminato target_role")
	check.call(ScriptedOnboarding.preferences().get("target_specialty") == "backend",
			"ID specialty non raccolto")
	check.call(draft.get("experience_years") == "3", "esperienza non raccolta")
	check.call(draft.get("location") == "Europa", "località non raccolta")
	check.call(ScriptedOnboarding.options("assistente").size() == 3,
			"finale Assistente non raggiunto")
	var guided_actions: Array = []
	var capture_action := func(action: String, payload: Dictionary) -> void:
		guided_actions.append({"action": action, "payload": payload})
	ScriptedOnboarding.action_requested.connect(capture_action)
	ScriptedOnboarding.choose("coordinatore", "explain")
	check.call(ScriptedOnboarding.options("coordinatore").size() == 3,
			"spiegazione Coordinatore non torna alla scelta")
	ScriptedOnboarding.choose("coordinatore", "local")
	ScriptedOnboarding.choose("coordinatore", "ready")
	check.call(ScriptedOnboarding.options("coordinatore").size() == 4,
			"scelta provider Coordinatore non raggiunta")
	ScriptedOnboarding.choose("coordinatore", "compare")
	ScriptedOnboarding.choose("coordinatore", "codex")
	ScriptedOnboarding.choose("coordinatore", "login")
	check.call(not guided_actions.is_empty() \
			and str(guided_actions[-1].get("action", "")) == "open_section" \
			and str(guided_actions[-1].get("payload", {}).get("section", "")) == "docker",
			"gate container del Coordinatore non apre Docker")
	ScriptedOnboarding.choose("coordinatore", "check")
	ScriptedOnboarding.choose("coordinatore", "already")
	check.call(ScriptedOnboarding.options("coordinatore").size() == 5,
			"preferenze autonomia Coordinatore assenti")
	for choice in ["review_cv", "balanced", "contextual", "always"]:
		ScriptedOnboarding.choose("coordinatore", choice)
	check.call(ScriptedOnboarding.options("coordinatore").size() == 4,
			"canali opzionali del Coordinatore assenti")
	ScriptedOnboarding.choose("coordinatore", "telegram")
	check.call(str(guided_actions[-1].get("payload", {}).get("section", "")) == "telegram",
			"configurazione Telegram non raggiungibile dalla conversazione")
	ScriptedOnboarding.choose("coordinatore", "skip_channels")
	check.call(ScriptedOnboarding.options("coordinatore").size() == 4,
			"attivazione team non raggiunta dopo i canali")
	ScriptedOnboarding.action_requested.disconnect(capture_action)
	for choice in ["growth", "plateau", "balanced", "low", "steady",
			"analytical", "weekly", "culture", "done"]:
		ScriptedOnboarding.choose("mentor", choice)
	check.call(ScriptedOnboarding.is_complete("mentor"), "Mentor non completato")
	check.call(ScriptedOnboarding.preferences().get("mentor_cadence") == "weekly",
			"preferenza Mentor non salvata")

	# Percorsi alternativi: uscita non bloccante, VPS, cambio provider,
	# configurazioni opzionali e revisione delle preferenze del Mentor.
	ScriptedOnboarding.reset_for_test()
	guided_actions.clear()
	ScriptedOnboarding.action_requested.connect(capture_action)
	ScriptedOnboarding.choose("assistente", "later")
	check.call(ScriptedOnboarding.options("assistente").size() == 3,
			"esplora prima dovrebbe lasciare l'Assistente all'intro")
	ScriptedOnboarding.choose("assistente", "profile")
	check.call(not guided_actions.is_empty() \
			and str(guided_actions[-1].get("payload", {}).get("section", "")) == "profile",
			"profilo diretto Assistente non apre il modulo nativo")
	ScriptedOnboarding.choose("assistente", "complete_profile")
	check.call(ScriptedOnboarding.is_complete("assistente"),
			"profilo diretto non completa il percorso Assistente")
	ScriptedOnboarding.choose("coordinatore", "vps")
	check.call(str(guided_actions[-1].get("payload", {}).get("section", "")) == "vps",
			"ramo VPS Coordinatore non apre la pagina VPS")
	ScriptedOnboarding.choose("coordinatore", "ready")
	ScriptedOnboarding.choose("coordinatore", "kimi")
	ScriptedOnboarding.choose("coordinatore", "different")
	check.call(ScriptedOnboarding.options("coordinatore").size() == 4,
			"cambio provider non torna alla selezione")
	ScriptedOnboarding.choose("coordinatore", "claude")
	ScriptedOnboarding.choose("coordinatore", "check")
	ScriptedOnboarding.choose("coordinatore", "open_profile")
	for choice in ["observe", "minimal", "strict", "custom"]:
		ScriptedOnboarding.choose("coordinatore", choice)
	for section_choice in ["email", "cloud"]:
		ScriptedOnboarding.choose("coordinatore", section_choice)
	check.call(str(guided_actions[-1].get("payload", {}).get("section", "")) == "account",
			"ramo cloud non apre Account")
	ScriptedOnboarding.choose("coordinatore", "skip_channels")
	ScriptedOnboarding.choose("coordinatore", "overview")
	check.call(str(guided_actions[-1].get("payload", {}).get("section", "")) == "activation",
			"checklist Coordinatore non apre Attivazione")
	ScriptedOnboarding.choose("coordinatore", "mentor")
	check.call(str(guided_actions[-1].get("action", "")) == "open_scripted_chat" \
			and str(guided_actions[-1].get("payload", {}).get("agent", "")) == "mentor",
			"handoff Coordinatore-Mentor assente")
	for choice in ["salary", "curious", "ambitious", "high", "intensive",
			"direct", "milestones", "hours", "hours"]:
		ScriptedOnboarding.choose("mentor", choice)
	check.call(str(guided_actions[-1].get("payload", {}).get("section", "")) == "hours" \
			and not ScriptedOnboarding.is_complete("mentor"),
			"orari Mentor devono aprire la pagina senza chiudere il percorso")
	ScriptedOnboarding.choose("mentor", "restart")
	check.call(ScriptedOnboarding.options("mentor").size() == 7 \
			and ScriptedOnboarding.preferences().get("mentor_cadence", "") == "",
			"riavvio Mentor non azzera il percorso")
	ScriptedOnboarding.action_requested.disconnect(capture_action)

	# Monta la UI da zero e attiva davvero il primo Button: protegge anche da
	# regressioni nelle closure create dal ciclo delle risposte suggerite.
	ScriptedOnboarding.reset_for_test()
	var panel := ChatPanel.new("assistente", "Assistente")
	office.add_child(panel)
	await get_tree().process_frame
	await get_tree().process_frame
	check.call(panel._view.choices.get_child_count() >= 2, "bottoni guided non renderizzati")
	check.call(not panel._view.input.editable and panel._view.send_button.disabled,
			"testo libero acceso prima del provider")
	var pressed_first := false
	for child in panel._view.choices.get_children():
		if child is Button:
			(child as Button).pressed.emit()
			pressed_first = true
			break
	await get_tree().process_frame
	await get_tree().process_frame
	check.call(pressed_first and ScriptedOnboarding.options("assistente").size() == 7,
			"il primo bottone della chat non avanza al ruolo")
	for choice in ["software", "fullstack", "mid", "employed", "exact",
			"remote", "remote_only", "never", "employee", "market", "established"]:
		ScriptedOnboarding.choose("assistente", choice)
	draft = ScriptedOnboarding.profile_draft()
	check.call(ScriptedOnboarding.answers().size() >= 12,
			"le risposte onboarding non sono state strutturate")
	var role_context := ScriptedOnboarding.llm_context()
	var role_context_text := ScriptedOnboarding.llm_context_text()
	var role_answer := (role_context.get("answers", []) as Array).filter(
			func(item: Dictionary) -> bool: return str(item.get("step", "")) == "role")
	check.call(role_context_text.contains("target_role_category_id") \
			and role_context_text.contains("software") \
			and role_context_text.contains("fullstack") \
			and not role_context_text.contains(UIStrings.t("onb.a.role.software")) \
			and role_context.get("schema_version", 0) == 3 \
			and role_answer.size() == 1 \
			and not (role_answer[0] as Dictionary).has("label"),
			"contesto LLM onboarding incompleto")
	ScriptedOnboarding.remember_profile_fields({"name": "Ada Test",
			"email": "ada@example.com", "languages": "Italiano, English"})
	ScriptedOnboarding.record_dialogue_choice("tour_scout", "n2",
			"Posso indicare aziende o tipi di lavoro preferiti?", "sources")
	check.call(ScriptedOnboarding.llm_context_text().contains("Ada Test") \
			and ScriptedOnboarding.profile_draft().get("email", "") == "ada@example.com" \
			and ScriptedOnboarding.llm_context_text().contains("lavoro preferiti"),
			"dati del profilo nativo non sincronizzati nel contesto LLM")

	BackendBus.set_backend(MockBackend.new())
	await get_tree().create_timer(1.2).timeout
	SetupService.status["container_running"] = true
	SetupService.status["provider_authenticated"] = true
	ScriptedOnboarding.set_provider_test_override(1)
	panel._refresh_chat_mode()
	await get_tree().process_frame
	await get_tree().process_frame
	check.call(panel._view.input.editable and not panel._view.send_button.disabled,
			"testo libero non abilitato dopo provider + agente")
	check.call(panel._view.choices.get_child_count() == 0,
			"le risposte authored non spariscono dopo il login provider")
	panel._on_updated("assistente", [{"role": "assistant", "text": "Scegli tu.",
			"done": true, "choices": [
				{"label": "Controlla il profilo", "value": "Controlla il profilo"},
				{"label": "Mostra le posizioni", "value": "Mostra le posizioni"},
			]}])
	await get_tree().process_frame
	await get_tree().process_frame
	check.call(panel._view.choices.get_child_count() == 3,
			"risposte suggerite generate dall'agente non renderizzate")
	# Il modulo profilo deve esistere anche senza LLM e includere proprio i
	# campi che determinano il gate ready (email e lingue comprese).
	BackendBus._backend.live = true
	var profile_panel := SectionPanel.new("profile", 24.0)
	office.add_child(profile_panel)
	await get_tree().process_frame
	await get_tree().process_frame
	check.call(profile_panel._prof_edits.has("email"), "campo email assente dal profilo nativo")
	check.call(profile_panel._prof_edits.has("languages"), "campo lingue assente dal profilo nativo")
	check.call(SectionPanel._profile_field_text("languages", [
			{"language": "Italiano", "level": "madrelingua"},
			{"language": "Inglese", "level": "C1"},
		]) == "Italiano (madrelingua), Inglese (C1)",
			"le lingue strutturate vengono mostrate come dizionari interni")
	check.call(profile_panel._prof_edits.has("target_role") \
			and profile_panel._prof_edits["target_role"].text == "",
			"la categoria scripted ha contaminato il target_role libero")

	# Regressione 24/07 — provider GIÀ configurato e container ancora spento:
	# prima i dialoghi authored si spegnevano al solo vedere il token e la
	# chat viva non era disponibile, lasciando l'utente senza interlocutore.
	# Il criterio è il canale, non il token; e i passi già soddisfatti si
	# riconciliano invece di attendere un login che non arriverà mai.
	SetupService.status["container_running"] = false
	SetupService.status["provider_authenticated"] = true
	ScriptedOnboarding.set_provider_test_override(1)
	check.call(ScriptedOnboarding.use_scripted_chat("assistente") \
			and ScriptedOnboarding.use_scripted_chat("coordinatore"),
			"con container spento la chat guidata deve restare disponibile")
	check.call(not ScriptedOnboarding.live_text_available("coordinatore"),
			"senza container non può esistere testo libero verso l'agente reale")
	check.call(ScriptedOnboarding.story_mode(),
			"senza container l'ufficio deve restare in modalità racconto")
	ScriptedOnboarding._steps["coordinatore"] = "provider"
	ScriptedOnboarding._reconcile_with_status(SetupService.status)
	check.call(str(ScriptedOnboarding._steps["coordinatore"]) == "profile",
			"il passo provider va marcato fatto, non lasciato su un login impossibile")
	ScriptedOnboarding._steps["coordinatore"] = "runtime"
	SetupService.status["container_running"] = true
	ScriptedOnboarding._reconcile_with_status(SetupService.status)
	check.call(str(ScriptedOnboarding._steps["coordinatore"]) == "profile",
			"con runtime e provider pronti si arriva diretti al profilo")
	check.call(not ScriptedOnboarding.story_mode(),
			"con team operativo la modalità racconto deve chiudersi")

	# Pannello Docker: deve mostrare la versione del runtime e l'azione di
	# aggiornamento, altrimenti l'utente resta su un'immagine vecchia senza
	# nemmeno saperlo (il gioco si aggiorna con l'installer, il container no).
	SetupService.status["docker_running"] = true
	SetupService.status["docker_available"] = true
	SetupService.status["container_exists"] = true
	SetupService.status["runtime_stale"] = true
	var docker_panel := SectionPanel.new("docker", 24.0)
	office.add_child(docker_panel)
	await get_tree().process_frame
	await get_tree().process_frame
	var docker_labels := ""
	var docker_buttons := ""
	for node in docker_panel.find_children("*", "", true, false):
		if node is Label:
			docker_labels += (node as Label).text + "\n"
		elif node is Button:
			docker_buttons += (node as Button).text + "\n"
	check.call(docker_labels.contains(UIStrings.t("setup.runtime_stale")),
			"il pannello Docker non segnala il runtime da aggiornare")
	check.call(docker_buttons.contains(UIStrings.t("setup.runtime_update")),
			"il pannello Docker non offre l'aggiornamento del runtime")
	check.call(docker_buttons.contains(UIStrings.t("setup.runtime_check")),
			"il pannello Docker non offre il controllo esplicito aggiornamenti")
	# Il gioco non ricostruisce piu' pull/compose: il wrapper host e' l'unico
	# proprietario del deploy. stdout deve quindi essere UNA riga JSON finale;
	# l'exit code e il campo ok devono concordare prima che la UI dica successo.
	var upgrade_ok := SetupService.parse_upgrade_result(JSON.stringify({
		"ok": true, "changed": true, "phase": "complete",
		"previous": {"version": "1.0.0", "image": "sha256:old"},
		"current": {"version": "1.1.0", "image": "sha256:new"},
		"restartRequired": false, "message": "Aggiornamento completato",
		"rolledBack": false,
	}), 0)
	check.call(bool(upgrade_ok.get("ok", false))
			and str(upgrade_ok.get("current", {}).get("version", "")) == "1.1.0",
			"il risultato JSON valido dell'upgrade non espone la versione attiva")
	var upgrade_rollback := SetupService.parse_upgrade_result(JSON.stringify({
		"ok": false, "changed": false, "phase": "recovery",
		"previous": {"version": "1.0.0", "image": "sha256:old"},
		"current": {"version": "1.0.0", "image": "sha256:old"},
		"restartRequired": false, "message": "Ripristino completato",
		"rolledBack": true,
	}), 1)
	check.call(not bool(upgrade_rollback.get("ok", true))
			and bool(upgrade_rollback.get("rolledBack", false)),
			"il rollback host-side non viene dichiarato alla UI")
	var upgrade_check := SetupService.parse_upgrade_result(JSON.stringify({
		"ok": true, "changed": true, "phase": "check",
		"previous": {"version": "1.0.0", "image": "sha256:old"},
		"current": {"version": "1.0.0", "image": "sha256:candidate"},
		"restartRequired": false, "message": "Controllo completato",
		"rolledBack": false,
	}), 0)
	check.call(bool(upgrade_check.get("ok", false))
			and bool(upgrade_check.get("changed", false))
			and not bool(upgrade_check.get("restartRequired", true)),
			"il check host-side valido non espone la disponibilita di update")
	# Il badge Docker usa changed e basta: restartRequired non descrive una
	# promotion in un check e non deve mai accendere un falso update.
	var check_cache := SetupService.last_upgrade_check.duplicate(true)
	SetupService.last_upgrade_check = upgrade_check.duplicate(true)
	check.call(SetupService.runtime_update_check_state() == "available",
			"changed=true non accende il badge update della sidebar")
	var restart_only := upgrade_check.duplicate(true)
	restart_only["changed"] = false
	restart_only["restartRequired"] = true
	SetupService.last_upgrade_check = restart_only
	check.call(SetupService.runtime_update_check_state() == "current",
			"restartRequired senza changed accende il badge update")
	var check_error := upgrade_check.duplicate(true)
	check_error["ok"] = false
	check_error["changed"] = false
	SetupService.last_upgrade_check = check_error
	check.call(SetupService.runtime_update_check_state() == "error",
			"un check fallito non resta distinguibile dalla sidebar")
	SetupService.last_upgrade_check = check_cache
	var docker_active := GameSidebar.docker_sidebar_state({
		"docker_available": true, "docker_running": true,
		"container_running": true,
	}, "available")
	var docker_stopped := GameSidebar.docker_sidebar_state({
		"docker_available": true, "docker_running": true,
		"container_running": false,
	}, "current")
	var docker_unreachable := GameSidebar.docker_sidebar_state({
		"docker_available": false, "docker_running": false,
		"container_running": false,
	}, "error")
	check.call(str(docker_active.get("runtime", "")) == "active"
			and str(docker_active.get("badge", "")) == "available"
			and str(docker_stopped.get("runtime", "")) == "stopped"
			and str(docker_unreachable.get("runtime", "")) == "unreachable"
			and str(docker_unreachable.get("badge", "")) == "error",
			"gli stati Docker header non distinguono attivo, spento e non raggiungibile")
	var upgrade_bad_frame := SetupService.parse_upgrade_result(
			JSON.stringify(upgrade_ok) + "\nlog diagnostico", 0)
	check.call(bool(upgrade_bad_frame.get("protocol_error", false)),
			"stdout con piu' righe viene accettato come risposta upgrade")
	var upgrade_bad_exit := SetupService.parse_upgrade_result(JSON.stringify(upgrade_ok), 1)
	check.call(bool(upgrade_bad_exit.get("protocol_error", false)),
			"successo JSON e exit failure possono divergere")
	docker_panel.queue_free()

	# Scelta dell'abbonamento: i tagli devono andare A CAPO. Con cinque in
	# fila la scheda cresceva oltre il bordo dello schermo e gli ultimi non
	# erano raggiungibili (ThinkPad, 26/07). La cache si pre-popola qui: la
	# lista vera arriva dal container, che in un test headless non c'è.
	SetupService._plans_cache["kimi"] = [
		{"id": "adagio", "label": "Adagio (gratuito)", "price": "0"},
		{"id": "moderato", "label": "Moderato", "price": "19 $/mese"},
		{"id": "allegretto", "label": "Allegretto", "price": "39 $/mese"},
		{"id": "allegro", "label": "Allegro", "price": "99 $/mese"},
		{"id": "vivace", "label": "Vivace", "price": "199 $/mese"},
	]
	SetupService.status["active_provider"] = "kimi"
	SetupService.status["provider_authenticated"] = true
	# `remote` perché in locale la scheda si fida solo dei file di credenziali
	# sul disco, che in un test headless non esistono: il percorso remoto è
	# l'unico modo di arrivare al selettore senza inventare finti segreti.
	SetupService.status["remote"] = true
	SetupService.status["active_plan"] = "allegretto"
	var provider_panel := SectionPanel.new("provider", 24.0)
	office.add_child(provider_panel)
	await get_tree().process_frame
	await get_tree().process_frame
	var flow: HFlowContainer = null
	var plan_labels: Array[String] = []
	for node in provider_panel.find_children("*", "", true, false):
		if node is HFlowContainer:
			flow = node
			for child in (node as HFlowContainer).get_children():
				if child is Button:
					plan_labels.append((child as Button).text)
	check.call(flow != null, "i piani non sono in un contenitore che va a capo")
	check.call(plan_labels.size() == 5,
			"mostrati %d piani invece di 5" % plan_labels.size())
	var longest := 0
	for label in plan_labels:
		longest = maxi(longest, label.length())
	check.call(longest <= 24,
			"etichetta del piano troppo lunga (%d caratteri): allarga la scheda" % longest)
	provider_panel.queue_free()

	# ── Orari di lavoro ─────────────────────────────────────────────────
	# La pagina si costruiva solo se le finestre esistevano GIÀ: al primo
	# avvio — cioè quando il passo 04 le chiede — restava vuota (ThinkPad,
	# 26/07). Qui si verifica che dal foglio bianco esca comunque qualcosa
	# di valido, e che i punti di partenza siano salvabili così come sono.
	for preset_key in SectionPanel.HOURS_PRESETS.keys():
		for w: Dictionary in SectionPanel.HOURS_PRESETS[preset_key]:
			var giorni := SectionPanel._hours_day_list(w)
			check.call(not giorni.is_empty(),
					"il punto di partenza '%s' non ha giorni" % preset_key)
			for g: String in giorni:
				check.call(["mon", "tue", "wed", "thu", "fri", "sat", "sun"].has(g),
						"giorno non salvabile in '%s': %s" % [preset_key, g])
			check.call(str(w["start"]).contains(":") and str(w["end"]).contains(":"),
					"orari non salvabili in '%s'" % preset_key)
	check.call(SectionPanel._hours_day_list(
			SectionPanel.HOURS_PRESETS["always"][0]).size() == 7,
			"'sempre attivo' non copre tutta la settimana")

	# I sette pulsanti scrivono nello stesso campo che il salvataggio legge,
	# e la riga non deve rimescolarsi sotto le dita.
	var finestra := {"days": "mon, wed", "start": "09:00", "end": "18:00"}
	SectionPanel._hours_toggle_day(finestra, "tue")
	check.call(str(finestra["days"]) == "mon, tue, wed",
			"i giorni non restano in ordine di settimana: " + str(finestra["days"]))
	SectionPanel._hours_toggle_day(finestra, "mon")
	check.call(str(finestra["days"]) == "tue, wed",
			"il giorno spento non sparisce: " + str(finestra["days"]))
	check.call(not SectionPanel._hours_has_day(finestra, "mon"),
			"un giorno spento risulta ancora acceso")

	# Al primo avvio non esiste una baseline corrente: i 45h proposti non
	# possono diventare 4500% né proiettare lo showroom come storico reale.
	var first_estimate := SectionPanel._hours_estimate_values([], [
			{"days": "mon, tue, wed, thu, fri", "start": "09:00", "end": "18:00"}
	], 50)
	check.call(not bool(first_estimate["has_baseline"]),
			"il primo avvio inventa una baseline per la stima degli orari")
	check.call(is_equal_approx(float(first_estimate["new_hours"]), 45.0),
			"le ore proposte al primo avvio non sono 45")
	var rescaled := SectionPanel._hours_estimate_values([
			{"days": "mon, tue, wed, thu, fri", "start": "09:00", "end": "18:00"}
	], [
			{"days": "mon, tue, wed, thu, fri", "start": "09:00", "end": "18:00"}
	], 7)
	check.call(bool(rescaled["has_baseline"])
			and int(rescaled["budget_percent"]) == 100,
			"una finestra invariata non mantiene il budget al 100%")

	# ── Ogni agente al suo banco ────────────────────────────────────────
	# Il volto è legato alla sedia, e la sedia ora discende dal numero: due
	# Scout attivi mostravano sempre le stesse due facce perché si pescava in
	# ordine di arrivo, e i ritratti nuovi (banchi 3-6) non si vedevano mai.
	check.call(office._desk_index_from_uid("scout-5") == 4, "scout-5 non siede al quinto banco")
	check.call(office._desk_index_from_uid("analista-1") == 0, "analista-1 non siede al primo banco")
	check.call(office._desk_index_from_uid("capitano") == -1, "un ruolo core non ha un banco numerato")
	check.call(office._desk_index_from_uid("") == -1, "uid vuoto non deve scegliere un banco")

	var banchi: Array = []
	for i in 6:
		banchi.append({"desk": i, "slug": "scout"})
	var preso: Dictionary = office._take_desk_for(banchi, "scout-5")
	check.call(int(preso.get("desk", -1)) == 4,
			"scout-5 ha ricevuto il banco %s" % preso.get("desk", "?"))
	check.call(banchi.size() == 5, "il banco assegnato non è uscito dal giro")
	# Numero oltre le sedie disponibili: si ripiega, non si resta in piedi.
	var ripiego: Dictionary = office._take_desk_for(banchi, "scout-99")
	check.call(not ripiego.is_empty(), "nessun banco assegnato a un numero fuori scala")

	var ok := failures.is_empty()
	print("GUIDED-ONBOARDING-TEST ", "PASS " if ok else "FAIL ",
			JSON.stringify({"failures": failures, "draft": draft,
					"mentor": ScriptedOnboarding.preferences(),
					"instance_portraits": shown_portraits}))
	panel.close(false)
	profile_panel.queue_free()
	BackendBus.disconnect_backend()
	await get_tree().create_timer(1.1).timeout
	# Il click reale sopra ha avviato il tick procedurale: rilascia lo stream
	# dal player prima del quit headless, così il test resta leak-free.
	for player in Sfx._pool:
		player.stop()
		player.stream = null
	SetupService.status = original_setup
	ScriptedOnboarding.set_provider_test_override(-1)
	get_tree().quit(0 if ok else 1)

## Regressione della vista Posizioni dentro il boot normale (gli script `-s`
## non hanno gli autoload): pagine vere e filtri compatti, mai più slice a 40.
func _positions_panel_selftest() -> void:
	var rows: Array = []
	for i in 126:
		rows.append({
			"id": i + 1, "title": "Ruolo %03d" % (i + 1), "company": "Azienda",
			"status": "scored" if i % 2 == 0 else "checked",
			"total_score": 70 + i % 20,
			"role_family": "AI Engineering" if i % 3 == 0 else "Backend Engineering",
			"work_mode": "remote" if i % 2 == 0 else "hybrid",
			"loc_city": "Roma", "loc_country": "Italy",
		})
	BackendBus.positions = rows
	var panel := SectionPanel.new("positions", 24.0)
	office.add_child(panel)
	await get_tree().process_frame
	await get_tree().process_frame
	var ok := _ui_has_text(panel, "1–50 di 126") \
			and _ui_has_text(panel, "PAGINA 1 / 3") \
			and _ui_find_button(panel, "FILTRI (0)") != null \
			and _ui_count_class(panel, "MenuButton") == 0 \
			and _ui_count_meta(panel, "position_row") == 50 \
			and _ui_count_meta(panel, "position_status") == 50 \
			and _ui_count_position_buttons(panel) == 50
	var next := _ui_find_button(panel, "SUCCESSIVA ▶")
	ok = ok and next != null
	if next:
		next.pressed.emit()
		await get_tree().process_frame
		await get_tree().process_frame
		ok = ok and _ui_has_text(panel, "51–100 di 126") \
				and _ui_has_text(panel, "PAGINA 2 / 3")
	var size_25 := _ui_find_button(panel, "25")
	ok = ok and size_25 != null
	if size_25:
		size_25.pressed.emit()
		await get_tree().process_frame
		await get_tree().process_frame
		ok = ok and _ui_has_text(panel, "1–25 di 126") \
				and _ui_has_text(panel, "PAGINA 1 / 6") \
				and _ui_count_meta(panel, "position_row") == 25 \
				and _ui_count_position_buttons(panel) == 25
	var filters := _ui_find_button(panel, "FILTRI (0)")
	ok = ok and filters != null
	if filters:
		filters.pressed.emit()
		await get_tree().process_frame
		await get_tree().process_frame
		ok = ok and _ui_count_class(panel, "MenuButton") == 4
	# Audit manuale della toolbar espansa: lo shot autonomo chiuderà la run.
	if OS.get_environment("JHT_POSITIONS_FILTER_PREVIEW") == "1" \
			and OS.get_environment("JHT_SHOT") != "":
		print("POSITIONS-PANEL-TEST ", "PASS" if ok else "FAIL")
		return
	# Il contratto visuale non finisce alla lista: il dettaglio deve aprirsi
	# dalla card e conservare card/badge gerarchici, non tornare al foglio
	# piatto che rendeva indistinguibili identità, score e azioni.
	var first_position := _ui_find_position_button(panel, 1)
	ok = ok and first_position != null
	if first_position:
		first_position.pressed.emit()
		await get_tree().process_frame
		await get_tree().process_frame
		ok = ok and _ui_has_text(panel, "Ruolo 001") \
				and _ui_count_meta(panel, "position_card") >= 5 \
				and _ui_count_meta(panel, "position_badge") >= 2
	print("POSITIONS-PANEL-TEST ", "PASS" if ok else "FAIL")
	# Come gli altri audit visuali: con JHT_SHOT lascia la scena viva fino
	# allo scatto autonomo, così lo stesso scenario copre anche i frame.
	if OS.get_environment("JHT_SHOT") != "":
		return
	get_tree().quit(0 if ok else 1)

## Test/preview deterministico della mappa: 14 offerte coincidenti a Stoccolma
## devono essere tutte raggiungibili e i gesti devono seguire lo stesso asse.
func _map_panel_selftest() -> void:
	var rows: Array = []
	for i in 14:
		rows.append({
			"id": i + 1, "title": "Ruolo Stockholm %02d" % (i + 1),
			"company": "Azienda", "status": "scored", "total_score": 70 + i,
			"role_family": "AI Engineering", "work_mode": "remote",
			"loc_city": "Stockholm", "loc_country": "Sweden",
			"office_lat": 59.3293, "office_lon": 18.0686,
		})
	for extra in [
		{"city": "San Francisco", "country": "United States", "lat": 37.7749, "lon": -122.4194},
		{"city": "Sydney", "country": "Australia", "lat": -33.8688, "lon": 151.2093},
		{"city": "Tokyo", "country": "Japan", "lat": 35.6762, "lon": 139.6503},
		{"city": "Milano", "country": "Italy", "lat": 45.4642, "lon": 9.1900},
		{"city": "Bergamo", "country": "Italy", "lat": 45.6983, "lon": 9.6773},
		{"city": "Roma", "country": "Italy", "lat": 41.9028, "lon": 12.4964},
		{"city": "Torino", "country": "Italy", "lat": 45.0703, "lon": 7.6869},
	]:
		rows.append({
			"id": rows.size() + 1, "title": "Ruolo " + str(extra["city"]),
			"company": "Azienda", "status": "scored", "total_score": 78,
			"role_family": "AI Engineering", "work_mode": "remote",
			"loc_city": extra["city"], "loc_country": extra["country"],
			"office_lat": extra["lat"], "office_lon": extra["lon"],
		})
	BackendBus.positions = rows
	var panel := SectionPanel.new("map", 24.0)
	office.add_child(panel)
	await get_tree().process_frame
	await get_tree().process_frame
	var world := _ui_find_class_node(panel, "WorldMap") as WorldMap
	if world == null:
		print("MAP-PANEL-TEST FAIL no WorldMap")
		get_tree().quit(1)
		return
	var overview_zoom: float = world._flat._target_zoom
	if OS.get_environment("JHT_SHOT") != "" \
			and OS.get_environment("JHT_MAP_CLUSTER_PREVIEW") == "1":
		return
	world._flat.zoom_f = 4.0
	world._flat._target_zoom = 4.0
	var italy_cluster := {}
	for pin in world._flat._display_pins():
		if bool(pin.get("is_cluster", false)) and str(pin["label"]).begins_with("Italy"):
			italy_cluster = pin
			break
	var cluster_ok := not italy_cluster.is_empty() \
			and int(italy_cluster["source_count"]) == 4
	if cluster_ok:
		world._flat._click_pin(world._flat._to_screen(italy_cluster["norm"]))
		cluster_ok = world._flat._target_zoom > 5.0
	# Un pin isolato aperto dalla panoramica non deve più fare il vecchio
	# mega-zoom 11. La coda deve inoltre scartare una tile obsoleta e contenere
	# soltanto il livello della destinazione corrente.
	world._flat.zoom_f = 4.0
	world._flat._target_zoom = 4.0
	var single_pin := {}
	for pin in world._flat._display_pins():
		if str(pin.get("city", "")) == "San Francisco":
			single_pin = pin
			break
	var auto_zoom_ok := not single_pin.is_empty()
	if auto_zoom_ok:
		world._flat._click_pin(world._flat._to_screen(single_pin["norm"]))
		auto_zoom_ok = world._flat._target_zoom <= 8.01
	world._flat._queue.append("3/0/0")
	world._flat._target_tile_signature = ""
	world._flat._ensure_target_tiles()
	var target_prefix := "%d/" % int(ceil(world._flat._target_zoom))
	# La quantità giusta dipende dalla superficie del pannello: su viewport
	# grandi una soglia fissa di 100 bocciava 121 tile tutte corrette, senza
	# alcun livello obsoleto. Il margine coincide con una tile per lato più gli
	# arrotondamenti floor/ceil usati da `_ensure_target_tiles`.
	var tile_queue_cap := (ceili(world._flat.size.x / OsmMap.TILE) + 4) \
			* (ceili(world._flat.size.y / OsmMap.TILE) + 4)
	var tile_queue_ok := world._flat._queue.size() <= tile_queue_cap
	for queued_key in world._flat._queue:
		tile_queue_ok = tile_queue_ok and str(queued_key).begins_with(target_prefix)
	world._flat.fly_to(Vector2(18.0686, 59.3293), 10.0)
	world._flat.select_key("Stockholm|Sweden")
	await get_tree().process_frame
	# Con JHT_SHOT il medesimo scenario resta aperto per l'audit visivo.
	if OS.get_environment("JHT_SHOT") != "":
		return
	var card_count := _ui_count_position_buttons(panel)
	var hint_ok := _ui_has_text(panel,
			"14 posizioni · scorri l’elenco e clicca per aprire la scheda")
	var base_ok := card_count == 14 and hint_ok and world._flat.visible \
			and _ui_find_class_node(panel, "MapGlobe") == null \
			and overview_zoom < 5.0 and cluster_ok and auto_zoom_ok \
			and tile_queue_ok
	var ok := base_ok
	var flat_before: Vector2 = world._flat.center
	var pan := InputEventPanGesture.new()
	pan.delta = Vector2(2.0, 3.0)
	world._flat._gui_input(pan)
	ok = ok and world._flat.center.x < flat_before.x \
			and world._flat.center.y < flat_before.y
	# Percorso reale della sidebar: click riga → navigate("positions") con
	# pending_detail → nuovo SectionPanel già sulla descrizione completa.
	# Il dizionario è condiviso per riferimento con la lambda (gli scalari
	# catturati da GDScript non propagano l'assegnazione al chiamante).
	var route_state := {"section": ""}
	panel.navigate.connect(func(next_section: String) -> void:
		route_state["section"] = next_section)
	var open_btn := _ui_find_position_button(panel, 14)
	ok = ok and open_btn != null
	if open_btn:
		open_btn.pressed.emit()
		await get_tree().process_frame
		var route_ok := str(route_state["section"]) == "positions" \
				and SectionPanel.pending_detail == 14
		ok = ok and route_ok
		var detail_panel := SectionPanel.new("positions", 24.0)
		office.add_child(detail_panel)
		await get_tree().process_frame
		await get_tree().process_frame
		var detail_ok := detail_panel._current_page == "detail" \
				and detail_panel._pos_detail_id == 14 \
				and _ui_has_text(detail_panel, "Ruolo Stockholm 14")
		ok = ok and detail_ok
		if not ok:
			print("MAP-PANEL-TEST details base=", base_ok, " count=", card_count,
					" hint=", hint_ok, " cluster=", cluster_ok,
					" auto_zoom=", auto_zoom_ok, " tile_queue=", tile_queue_ok,
					" queue_cap=", tile_queue_cap,
					" queue=", world._flat._queue,
					" inflight=", world._flat._inflight.keys(),
					" route=", route_ok, " requested=", route_state["section"],
					" pending=", SectionPanel.pending_detail,
					" detail=", detail_ok, " page=", detail_panel._current_page,
					" id=", detail_panel._pos_detail_id)
	print("MAP-PANEL-TEST ", "PASS" if ok else "FAIL")
	get_tree().quit(0 if ok else 1)

## Regressione delle finestre di monitoraggio risorse: storico sintetico
## sul bus → finestra Usage con le tre quote e i controlli temporali,
## poi Consumi agenti con classifica/donut coerenti e isolamento a click.
func _usage_panel_selftest() -> void:
	var now := Time.get_unix_time_from_system()
	var sentinel: Array = []
	var meter: Array = []
	var rows: Array = []
	var t := now - 18000.0
	while t <= now:
		sentinel.append({"t": t, "usage": 40.0, "weekly": 60.0,
				"velocity": 12.0, "projection": 55.0, "throttle": 0.0})
		meter.append({"t": t, "weighted_kt": 5000.0, "events": 120})
		rows.append({"t": t, "critico": 30.0, "scout-1": 12.0})
		t += 300.0
	UsageRangeBar.span_idx = 0
	UsageRangeBar.to_ts = 0.0
	BackendBus.publish_usage_history(
			{"from_ts": now - 18000.0, "to_ts": now, "bucket_sec": 300},
			{"ok": true, "sentinel": sentinel, "meter": meter,
				"agents": {"names": ["critico", "scout-1"], "series": rows,
					"totals_kt": {"critico": 1830.0, "scout-1": 732.0}}})
	var panel := SectionPanel.new("usage_history", 24.0)
	office.add_child(panel)
	await get_tree().process_frame
	await get_tree().process_frame
	var chart := _ui_find_class_node(panel, "UsageChart") as UsageChart
	var history_ok := chart != null and chart._series.size() == 3 \
			and _ui_find_button(panel, "QUOTE %") != null \
			and _ui_find_button(panel, "5H") != null \
			and _ui_find_button(panel, "ORA") != null
	if history_ok:
		for s in chart._series:
			history_ok = history_ok and (s["points"] as Array).size() >= 60
	panel.queue_free()
	var agents_panel := SectionPanel.new("usage_agents", 24.0)
	office.add_child(agents_panel)
	await get_tree().process_frame
	await get_tree().process_frame
	var stacked := _ui_find_class_node(agents_panel, "UsageChart") as UsageChart
	var rank_btn := _ui_find_button(agents_panel, "critico")
	# 1830 / (1830+732) = 71%: classifica e donut concordano
	var agents_ok := stacked != null and stacked._series.size() == 2 \
			and rank_btn != null \
			and _ui_has_text(agents_panel, "critico · 71%")
	if rank_btn:
		rank_btn.pressed.emit()
		await get_tree().process_frame
		agents_ok = agents_ok and stacked._series.size() == 1
	agents_panel.queue_free()
	# deep-link dalla card: pending_agent → pagina agente col grafico
	# storico multi-asse (e i suoi interruttori TUTTE/NESSUNA)
	SectionPanel.pending_agent = "scout"
	var page_panel := SectionPanel.new("agents", 24.0)
	office.add_child(page_panel)
	await get_tree().process_frame
	await get_tree().process_frame
	var history := _ui_find_class_node(page_panel, "AgentHistoryChart")
	var page_ok := page_panel._current_page == "agent" \
			and page_panel._agent_detail == "scout" \
			and SectionPanel.pending_agent == "" \
			and history != null \
			and _ui_find_button(page_panel, UIStrings.t("agent.history_all")) != null
	var ok := history_ok and agents_ok and page_ok
	if not ok:
		print("USAGE-PANEL-TEST details history=", history_ok,
				" agents=", agents_ok, " page=", page_ok)
	print("USAGE-PANEL-TEST ", "PASS" if ok else "FAIL")
	get_tree().quit(0 if ok else 1)

## Sezione "Segnala un problema": il gate sul racconto, la persistenza dei
## campi attraverso l'anteprima e — la parte che conta — che l'anteprima mostri
## davvero il contenuto sanificato invece di una promessa.
func _feedback_panel_selftest() -> void:
	var panel := SectionPanel.new("feedback", 24.0)
	office.add_child(panel)
	await get_tree().process_frame
	await get_tree().process_frame
	var send := _ui_find_button(panel, UIStrings.t("feedback.send"))
	# Senza racconto non si invia: una segnalazione vuota costa a noi il triage
	# e all'utente la sensazione di aver scritto nel vuoto.
	var gate_ok := send != null and send.disabled
	panel._fb_form["happened"] = "la finestra resta ferma su collegamento"
	panel._refresh_feedback_send()
	gate_ok = gate_ok and send != null and not send.disabled
	var no_contact_control: bool = not _ui_has_text(panel,
			UIStrings.t("feedback.q_contact"))

	# La raccolta gira su un thread (docker, file): si attende l'esito.
	var collected := false
	for _i in 200:
		await get_tree().process_frame
		if FeedbackService.preview_markdown != "":
			collected = true
			break
	var preview_btn := _ui_find_button(panel, UIStrings.t("feedback.preview_btn"))
	var preview_ok := preview_btn != null
	if preview_btn:
		preview_btn.pressed.emit()
		await get_tree().process_frame
		await get_tree().process_frame
		preview_ok = preview_ok and panel._current_page == "preview"
		# Il body si cerca per proprietà e non per posizione: i figli della
		# pagina precedente vivono ancora un frame dopo queue_free(), e il
		# primo TextEdit dell'albero può essere un campo del modulo.
		var body: TextEdit = null
		for _i in 20:
			body = _ui_find_readonly_text(panel)
			if body != null:
				break
			await get_tree().process_frame
		preview_ok = preview_ok and body != null and body.text.contains("### App")
		# Il canarino della catena di redazione, come nel selftest headless.
		var user := OS.get_environment("USER")
		if body != null and user.length() >= 3:
			preview_ok = preview_ok and not body.text.contains(user)
		var back := _ui_find_button(panel, UIStrings.t("feedback.back"))
		preview_ok = preview_ok and back != null
		if back:
			back.pressed.emit()
			await get_tree().process_frame
			await get_tree().process_frame
	# Tornando indietro il racconto è ancora lì: farlo riscrivere sarebbe il
	# modo più rapido per non ricevere più segnalazioni.
	var persist_ok := str(panel._fb_form["happened"]).contains("collegamento")
	# Quattro invarianti del contratto privacy: il recapito non esce mai dal
	# desktop, i racconti hanno la stessa redazione dei log, l'anteprima è il
	# documento che verrà spedito e il contatore include anche ciò che l'utente
	# ha scritto, non solo gli allegati tecnici.
	var fake_token := "ghp" + "_ABCdefGHIjklMNOpqrSTUvwxYZ0123456789"
	var private_form := {
		"doing": "CV in /Users/mariorossi/CV_Mario_Rossi.pdf",
		"happened": "scrivi a user@example.com con token=" + fake_token,
		"expected": "nessun contatto o segreto deve lasciare il computer",
		"contact": "user@example.com", # client vecchio: deve essere ignorato
	}
	var private_bundle := {"redaction": {}, "logs": {}}
	var payload := FeedbackService._payload(private_form, private_bundle,
			"diagnostica senza dati personali")
	var payload_redaction: Dictionary = payload.get("redaction", {})
	var no_contact := not payload.has("contact") \
			and not JSON.stringify(payload).contains("user@example.com")
	var redacted_story := not JSON.stringify(payload).contains(fake_token) \
			and not JSON.stringify(payload).contains("mariorossi") \
			and int(payload.get("redaction", {}).size()) >= 3
	var exact_preview := FeedbackService._to_markdown(payload)
	var preview_matches_payload := exact_preview.contains("[email]") \
			and exact_preview.contains("[document].pdf") \
			and exact_preview.contains(UIStrings.t("feedback.report.redacted")) \
			and not exact_preview.contains("user@example.com") \
			and not exact_preview.contains(fake_token)
	var counts_include_story: bool = int(payload_redaction.get("email", 0)) > 0 \
			and not payload_redaction.is_empty()
	# JHT_FEEDBACK_SEND_TEST=1 spinge la segnalazione fino in fondo, contro
	# l'endpoint indicato da JHT_FEEDBACK_URL. Fuori da questo flag il test
	# resta offline: in CI non si esce sulla rete.
	var send_ok := true
	if OS.get_environment("JHT_FEEDBACK_SEND_TEST") == "1":
		panel._submit_feedback()
		var result: Array = await FeedbackService.submit_changed
		while bool(result[0]):  # running
			result = await FeedbackService.submit_changed
		send_ok = bool(result[1]) and str(result[3]) == "#4242" \
				and FeedbackService.last_saved_path != ""
		# Il test dimostra la copia locale, ma non lascia una falsa segnalazione
		# nella cartella reale dell'utente che ha lanciato la suite.
		if FeedbackService.last_saved_path != "":
			DirAccess.remove_absolute(FeedbackService.last_saved_path)
			FeedbackService.last_saved_path = ""
		if not send_ok:
			print("FEEDBACK-PANEL-TEST send esito=", result)
	var ok: bool = gate_ok and no_contact_control and collected and preview_ok and persist_ok and no_contact \
			and redacted_story and preview_matches_payload and counts_include_story and send_ok
	if not ok:
		print("FEEDBACK-PANEL-TEST details gate=", gate_ok, " collected=", collected,
				" preview=", preview_ok, " persist=", persist_ok,
				" no_contact_control=", no_contact_control,
				" no_contact=", no_contact, " redacted_story=", redacted_story,
				" preview_matches_payload=", preview_matches_payload,
				" counts_include_story=", counts_include_story)
	print("FEEDBACK-PANEL-TEST ", "PASS" if ok else "FAIL")
	get_tree().quit(0 if ok else 1)


## Il TextEdit in sola lettura dell'anteprima, distinguibile dai campi del
## modulo per la proprietà `editable` invece che per l'ordine nell'albero.
func _ui_find_readonly_text(node: Node) -> TextEdit:
	var edit := node as TextEdit
	if edit != null and not edit.editable and not edit.is_queued_for_deletion():
		return edit
	for child in node.get_children():
		var found := _ui_find_readonly_text(child)
		if found:
			return found
	return null


func _ui_has_text(node: Node, wanted: String) -> bool:
	if node is Label and node.text == wanted:
		return true
	for child in node.get_children():
		if _ui_has_text(child, wanted):
			return true
	return false

func _ui_find_button(node: Node, wanted: String) -> Button:
	if node is Button and node.text == wanted:
		return node
	for child in node.get_children():
		var found := _ui_find_button(child, wanted)
		if found:
			return found
	return null

func _ui_find_class_node(node: Node, type_name: String) -> Node:
	if node.get_class() == type_name or node.get_script() != null \
			and node.get_script().get_global_name() == type_name:
		return node
	for child in node.get_children():
		var found := _ui_find_class_node(child, type_name)
		if found:
			return found
	return null

func _ui_count_position_buttons(node: Node) -> int:
	var count := 1 if node is Button and node.has_meta("position_id") else 0
	for child in node.get_children():
		count += _ui_count_position_buttons(child)
	return count

func _ui_count_meta(node: Node, key: String) -> int:
	var count := 1 if node.has_meta(key) else 0
	for child in node.get_children():
		count += _ui_count_meta(child, key)
	return count

func _ui_find_position_button(node: Node, position_id: int) -> Button:
	if node is Button and int(node.get_meta("position_id", 0)) == position_id:
		return node
	for child in node.get_children():
		var found := _ui_find_position_button(child, position_id)
		if found:
			return found
	return null

func _ui_count_class(node: Node, type_name: String) -> int:
	var count := 1 if node.get_class() == type_name else 0
	for child in node.get_children():
		count += _ui_count_class(child, type_name)
	return count

func _force_pipeline_trip(test_dept: String) -> void:
	await get_tree().create_timer(0.8).timeout
	for agent in office.agents:
		if agent.dept == test_dept:
			agent.set_backend_status("working")
			agent.perform_pipeline_step()
			return

func _start_traffic_demo() -> void:
	await get_tree().create_timer(0.8).timeout
	for agent in office.agents:
		if agent.dept == "" or agent.is_dissolving():
			continue
		agent.set_backend_status("working")
		agent.perform_pipeline_step(true)
	Log.info("test", "traffic demo: %d agenti messi in viaggio" % office.agents.size())

func _force_core_patrol(role: String) -> void:
	await get_tree().create_timer(0.45).timeout
	var actor: AgentNPC = office._find_agent(role)
	if actor:
		actor.set_backend_status("working")
		actor.perform_patrol()

func _pipeline_force_selftest(test_dept: String) -> void:
	await get_tree().create_timer(0.8).timeout
	var actor: AgentNPC = null
	for candidate in office.agents:
		if candidate.dept == test_dept:
			actor = candidate
			break
	if actor == null:
		print("PIPELINE-FORCE-TEST FAIL no actor for ", test_dept)
		get_tree().quit(1)
		return
	actor.set_backend_status("idle")
	var baseline := int(actor.debug_snapshot().get("pipeline_trips", 0))
	actor.perform_pipeline_step(true)
	await get_tree().process_frame
	var deadline := Time.get_ticks_msec() + 60000
	var previous := actor.global_position
	var max_step := 0.0
	while int(actor.debug_snapshot().get("pipeline_trips", 0)) < baseline + 1 \
			and Time.get_ticks_msec() < deadline:
		await get_tree().physics_frame
		var step := actor.global_position.distance_to(previous)
		max_step = maxf(max_step, step)
		previous = actor.global_position
	# Consenti alla posa seduta e alla maschera collisione di stabilizzarsi.
	for _i in 3:
		await get_tree().physics_frame
	var snap := actor.debug_snapshot()
	var ok := int(snap.get("pipeline_trips", 0)) == baseline + 1 \
			and int(snap.get("pending_pipeline", -1)) == 0 \
			and int(snap.get("state", -1)) == AgentNPC.S.WORK \
			and not bool(snap.get("forced_trip", true)) \
			and int(snap.get("collision_mask", -1)) == 0 \
			# Il cambio seduto/in piedi può spostare fino a ~100 px; qualunque
			# salto maggiore rivela un teletrasporto fra pila e scrivania.
			and max_step < 130.0 \
			and actor.global_position.distance_to(
					snap.get("work_position", Vector2.INF)) < 1.0
	snap["max_frame_step"] = max_step
	print("PIPELINE-FORCE-TEST ", "PASS" if ok else "FAIL", " ", JSON.stringify(snap))
	get_tree().quit(0 if ok else 1)

func _entry_selftest(role: String) -> void:
	await get_tree().create_timer(0.8).timeout
	var actor: AgentNPC = office._find_agent(role)
	if actor == null:
		print("ENTRY-CONTINUITY-TEST FAIL no actor for ", role)
		get_tree().quit(1)
		return
	actor.set_backend_status("idle")
	actor.enter_through(office.ENTRY_SPOT)
	await get_tree().physics_frame
	var started_at_door := actor.global_position.distance_to(office.ENTRY_SPOT) < 60.0 \
			and bool(actor.debug_snapshot().get("entering", false))
	var previous := actor.global_position
	var max_step := 0.0
	var deadline := Time.get_ticks_msec() + 45000
	while bool(actor.debug_snapshot().get("entering", false)) \
			and Time.get_ticks_msec() < deadline:
		await get_tree().physics_frame
		max_step = maxf(max_step, actor.global_position.distance_to(previous))
		previous = actor.global_position
	var snap := actor.debug_snapshot()
	var ok := started_at_door and max_step < 130.0 \
			and not bool(snap.get("entering", true)) \
			and bool(snap.get("desk_pose", false)) \
			and actor.global_position.distance_to(
					snap.get("work_position", Vector2.INF)) < 1.0
	snap["max_frame_step"] = max_step
	print("ENTRY-CONTINUITY-TEST ", "PASS" if ok else "FAIL", " ",
			JSON.stringify(snap))
	get_tree().quit(0 if ok else 1)

func _doctor_selftest(target_ref: String) -> void:
	await get_tree().create_timer(0.8).timeout
	var doctor: AgentNPC = office._find_agent("dottore")
	var target: AgentNPC = office._find_agent(target_ref)
	if doctor and target:
		# Passa dallo stesso ingresso dei messaggi VPS: il test copre anche
		# risoluzione uid/ruolo e dispatch chat-driven, non solo il movimento.
		office.deliver_chat("dottore", target_ref, "Controllo contesto e carico operativo.")
		await get_tree().process_frame
	if doctor and target and bool(doctor.debug_snapshot().get("forced_trip", false)):
		doctor.set_backend_status("idle")  # la visita deve comunque concludersi
		target.set_backend_status("idle")
		Log.info("test", "visita Dottore → %s avviata in idle" % target_ref)
		var deadline := Time.get_ticks_msec() + 45000
		while is_instance_valid(doctor) \
				and bool(doctor.debug_snapshot().get("forced_trip", false)) \
				and Time.get_ticks_msec() < deadline:
			await get_tree().process_frame
		if not is_instance_valid(doctor):
			print("SIMULATION-DOCTOR-TEST FAIL doctor freed before return")
			get_tree().quit(1)
			return
		var snap := doctor.debug_snapshot()
		var ok := not bool(snap.get("forced_trip", true)) \
				# Il Dottore ora rientra seduto nel composito della poltrona: la
				# posizione di lavoro include l'offset del sedile, come i reparti.
				and doctor.global_position.distance_to(
						snap.get("work_position", Vector2.INF)) < 1.0 \
				and int(snap.get("state", -1)) == AgentNPC.S.WORK \
				and int(snap.get("investigations", 0)) == 1
		print("SIMULATION-DOCTOR-TEST ", "PASS" if ok else "FAIL", " ",
				JSON.stringify(snap))
		get_tree().quit(0 if ok else 1)
	else:
		Log.warn("test", "visita Dottore non avviata: target=" + target_ref)
		get_tree().quit(1)

## Aspetta che il backend abbia popolato la scena, poi apre la chat e
## (se send) scrive: il giro utente→canale→risposta si vede da solo.
func _chat_selftest(role: String, send: bool) -> void:
	await get_tree().create_timer(2.5).timeout
	for a in office.agents:
		if a.slug == role or a.uid.begins_with(role):
			office._open_chat(a)
			if send:
				await get_tree().create_timer(0.5).timeout
				BackendBus.send_user_chat(a.slug, "Come procede il lavoro?")
			return

## Apre la pagina a fumetti su una conversazione seminata, per lo screenshot.
## Il mock serve a rendere l'agente "conversabile" (can_chat_with); le battute
## le scriviamo noi, perché una foto deve mostrare la forma della pagina —
## vignette dell'agente e dell'utente, code opposte, ritratto — non l'esito
## casuale di un mock.
func _comic_chat_shot(role: String) -> void:
	if BackendBus.state == BackendBus.DISCONNECTED:
		BackendBus.set_backend(MockBackend.new())
	await get_tree().create_timer(1.5).timeout
	var uid := role
	for a in BackendBus.agents:
		if str(a.get("slug", "")) == role:
			uid = str(a.get("uid", role))
			break
	var display := role.capitalize()
	for a in BackendBus.agents:
		if str(a.get("uid", "")) == uid:
			display = str(a.get("name", display))
	office._chat_panel = ChatPanel.new(uid, display, office._chat_roster())
	office.add_child(office._chat_panel)
	office._chat_panel.closed.connect(func() -> void: office._chat_panel = null)
	await get_tree().process_frame
	BackendBus.publish_agent_chat(uid, [
		{"role": "assistant", "done": true,
			"text": "Ho finito il giro delle board: sei posizioni nuove, quattro remote in UE."},
		{"role": "user", "done": true,
			"text": "Ottimo. Puoi concentrarti sulle remote?"},
		{"role": "assistant", "done": true,
			"text": "Fatto: da adesso do priorità alle remote e passo le altre all'Analista."},
	])


func _chat_ui_selftest() -> void:
	await get_tree().process_frame
	BackendBus.clear_chat_unread()
	BackendBus.publish_chat({"ts": "ui-1", "from": "coordinatore",
			"to": "user", "text": "Aggiornamento per te"})
	await get_tree().process_frame
	var sidebar: GameSidebar
	for child in office.get_children():
		if child is GameSidebar:
			sidebar = child
			break
	var badge_ok := sidebar != null and "1" in sidebar._tab.text
	office._open_chat_menu()
	await get_tree().process_frame
	# Il menu elenca ESATTAMENTE il roster conversabile della scena. Il numero
	# fisso "3" non va più bene: dal 2026-07-28 anche i ruoli operativi hanno
	# la skill di risposta, e un numero scritto a mano avrebbe solo detto
	# quanti erano il giorno in cui il test è stato scritto. Quello che conta
	# è che il menu e il roster non divergano, e che un WORKER ci sia davvero.
	var expected_roster: Array = office._chat_roster()
	var has_worker := false
	for entry: Dictionary in expected_roster:
		if BackendBus._chat_role(str(entry.get("slug", ""))) == "scout":
			has_worker = true
	var menu_ok: bool = office._chat_menu != null \
			and office._chat_menu._agents.size() == expected_roster.size() \
			and has_worker
	var coordinator: AgentNPC = office._find_agent("coordinatore")
	if office._chat_menu:
		office._chat_menu.close(false)
	await get_tree().process_frame
	if coordinator:
		office._open_chat(coordinator)
	await get_tree().process_frame
	var read_ok := BackendBus.chat_unread_count("capitano") == 0 \
			and office._chat_panel != null
	if office._chat_panel:
		office._chat_panel.close(false)
	await get_tree().process_frame
	var close_ok := office._chat_panel == null
	office._toggle_chat_access()
	await get_tree().process_frame
	var reopen_ok := office._chat_menu != null
	office._toggle_chat_access()
	await get_tree().process_frame
	var toggle_close_ok := office._chat_menu == null
	if coordinator:
		office.deliver_chat("coordinatore", "user", "Aggiornamento per te")
	await get_tree().process_frame
	var overlap_ok := coordinator != null \
			and coordinator.state_tag.debug_suppressed() \
			and not coordinator.state_tag.visible
	var assistant: AgentNPC = office._find_agent("assistente")
	if coordinator and assistant:
		office.deliver_chat("coordinatore", "assistente", "Passaggio completato")
	var received_ok := assistant != null \
			and assistant.state_tag.debug_label().begins_with(
					UIStrings.t("office.message_from").split("%s")[0])
	var ok: bool = badge_ok and menu_ok and read_ok and close_ok and reopen_ok \
			and toggle_close_ok and overlap_ok and received_ok
	print("CHAT-UI-TEST ", "PASS" if ok else "FAIL", " ", JSON.stringify({
			"badge": badge_ok, "menu": menu_ok, "read": read_ok,
			"close": close_ok, "reopen": reopen_ok,
			"toggle_close": toggle_close_ok, "overlap": overlap_ok,
			"received": received_ok}))
	BackendBus.clear_chat_unread()
	get_tree().quit(0 if ok else 1)

## Forza i due comportamenti nuovi sul roster corrente (vedi _ready).
func _throttle_selftest() -> void:
	await get_tree().create_timer(4.0).timeout
	if office.agents.size() < 2:
		return
	office.agents[1].set_throttle(240.0)
	office.agents[1].set_backend_status("throttled")
	office._despawn_agent(office.agents[office.agents.size() - 1])
	Log.info("test", "throttle selftest: %s in ricreazione, uno alla porta"
			% office.agents[1].uid)

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

## Test end-to-end del contratto visivo, dentro la scena vera: presenza,
## motion track e velocità per i quattro stati backend.
func _state_selftest() -> void:
	var sample := [
		{"uid": "scout-test", "slug": "scout", "role": "scout", "name": "Scout test",
				"active": true, "status": "working", "activity_detail": "turno"},
		{"uid": "analista-test", "slug": "analista", "role": "analista", "name": "Analista test",
				"active": true, "status": "idle", "activity_detail": "attesa"},
		{"uid": "scorer-test", "slug": "scorer", "role": "scorer", "name": "Scorer test",
				"active": true, "status": "paused", "activity_detail": "pausa"},
		{"uid": "scrittore-test", "slug": "scrittore", "role": "scrittore", "name": "Scrittore test",
				"active": true, "status": "throttled", "throttle_secs": 180.0,
				"activity_detail": "pacing"},
	]
	office.sync_agents(sample)
	await get_tree().process_frame
	var by := {}
	for a in office.agents:
		by[a.uid] = a.debug_snapshot()
	var ok: bool = office.agents.size() == 4 \
			and str(by.get("scout-test", {}).get("motion", "")) == "sit" \
			and str(by.get("analista-test", {}).get("motion", "")) == "sit_idle" \
			and str(by.get("scorer-test", {}).get("motion", "")) == "sit_idle" \
			and str(by.get("scrittore-test", {}).get("motion", "")) == "sit_idle"
	for snap in by.values():
		ok = ok and float(snap.get("speed", -1.0)) == 0.0
	# Snapshot completo successivo: chi non compare viene rimosso subito
	# dall'array di scena; non può restare sul divano o in corridoio.
	office.sync_agents([sample[1]])
	await get_tree().process_frame
	ok = ok and office.agents.size() == 1 and office.agents[0].uid == "analista-test"
	print("SIMULATION-STATE-TEST ", "PASS" if ok else "FAIL", " ", JSON.stringify(by))

func _agent_ui_selftest() -> void:
	await get_tree().create_timer(2.2).timeout
	var colors := {}
	var auras_ok: bool = not office.agents.is_empty()
	var ground_layer_ok: bool = not office.agents.is_empty()
	for agent in office.agents:
		auras_ok = auras_ok and agent.aura != null and agent.aura.visible
		ground_layer_ok = ground_layer_ok and agent.aura != null \
				and not agent.aura.z_as_relative and agent.aura.z_index == -1 \
				and agent.rig.z_index == 0
		if agent.dept != "" and agent.aura:
			colors[agent.dept] = agent.aura.accent.to_html(false)
	var readonly_ok: bool = office._thinking_panel != null \
			and office._thinking_panel.find_children("*", "LineEdit", true, false).is_empty()
	var stream_ok := office._thinking_panel != null \
			and str(office._thinking_panel._output.text).contains("sessione agente attiva")
	var scroll_lock_ok := false
	if office._thinking_panel != null:
		var scroll_bar: VScrollBar = office._thinking_panel._output.get_v_scroll_bar()
		office._thinking_panel._scroll_guard = false
		scroll_bar.value = 0.0
		await get_tree().process_frame
		var before_scroll := scroll_bar.value
		var extra := str(office._thinking_panel._output.text) + "\nnuovo tick live"
		office._thinking_panel._on_terminal_updated(
				office._thinking_panel._agent_key, extra, "")
		await get_tree().process_frame
		await get_tree().process_frame
		scroll_lock_ok = not office._thinking_panel._follow_tail \
				and is_equal_approx(scroll_bar.value, before_scroll)
	var hover_ok := false
	if not office.agents.is_empty() and office.agents[0].aura:
		office.agents[0].set_highlight(true)
		hover_ok = office.agents[0].aura.hovered
		office.agents[0].set_highlight(false)
	var cpu_threshold_ok := false
	var cpu_blink_ok := false
	var cpu_mapping_ok := false
	var cpu_stale_ok := false
	if not office.agents.is_empty():
		var probe: AgentNPC = office.agents[0]
		probe.set_cpu_activity(AgentStateTag.CPU_ACTIVE_THRESHOLD, true)
		var at_threshold: Dictionary = probe.state_tag.debug_cpu_led()
		probe.set_cpu_activity(AgentStateTag.CPU_ACTIVE_THRESHOLD + 0.1, true)
		var above_threshold: Dictionary = probe.state_tag.debug_cpu_led()
		var lit_before := bool(above_threshold.get("lit", false))
		probe.state_tag._process(0.5)
		var lit_after := bool(probe.state_tag.debug_cpu_led().get("lit", true))
		cpu_threshold_ok = not bool(at_threshold.get("active", true)) \
				and bool(above_threshold.get("active", false))
		cpu_blink_ok = lit_before and not lit_after
		office._on_agent_cpu_telemetry({"agent_cpu": {"capitano": 25.0},
				"agent_vitals_age_s": 0.0}, [])
		var captain: AgentNPC = office._find_agent("coordinatore")
		cpu_mapping_ok = captain != null \
				and bool(captain.state_tag.debug_cpu_led().get("active", false))
		office._on_agent_cpu_telemetry({"agent_cpu": {"capitano": 50.0},
				"agent_vitals_age_s": office.AGENT_CPU_STALE_AFTER + 1.0}, [])
		cpu_stale_ok = captain != null \
				and not bool(captain.state_tag.debug_cpu_led().get("active", true))
	var ok: bool = auras_ok and ground_layer_ok and colors.size() >= 5 \
			and readonly_ok and stream_ok \
			and scroll_lock_ok and hover_ok and cpu_threshold_ok \
			and cpu_blink_ok and cpu_mapping_ok and cpu_stale_ok
	print("AGENT-UI-TEST ", "PASS" if ok else "FAIL", " ", JSON.stringify({
		"departments": colors, "auras": auras_ok, "readonly": readonly_ok,
		"ground_layer": ground_layer_ok, "stream": stream_ok,
		"scroll_lock": scroll_lock_ok, "hover": hover_ok,
		"cpu_threshold": cpu_threshold_ok, "cpu_blink": cpu_blink_ok,
		"cpu_mapping": cpu_mapping_ok, "cpu_stale": cpu_stale_ok,
	}))
	get_tree().quit(0 if ok else 1)

func _coordinator_selftest() -> void:
	await get_tree().create_timer(0.3).timeout
	var panel_ok: bool = office._coordinator_panel != null \
			and office._coordinator_panel.is_in_group("camera_blocking_overlay")
	var navigation_ok := false
	var chat_ok := false
	var thinking_ok := false
	if panel_ok:
		office._coordinator_panel._show_view(1)
		await get_tree().process_frame
		navigation_ok = office._coordinator_panel._tabs.current_tab == 1 \
				and office._coordinator_panel._monitor_built \
				and _ui_find_class_node(office._coordinator_panel,
						"AgentHistoryChart") != null
		office._coordinator_panel._open_chat()
		await get_tree().process_frame
		chat_ok = office._coordinator_panel._chat_panel != null \
				and office._coordinator_panel._chat_panel.layer == 70
		if chat_ok:
			office._coordinator_panel._chat_panel.close(false)
		await get_tree().process_frame
		office._coordinator_panel._open_thinking()
		await get_tree().process_frame
		thinking_ok = office._coordinator_panel._thinking_panel != null \
				and office._coordinator_panel._thinking_panel.layer == 70
		if thinking_ok:
			office._coordinator_panel._thinking_panel.close(false)
		office._coordinator_panel._show_view(0)
		navigation_ok = navigation_ok \
				and office._coordinator_panel._tabs.current_tab == 0
	var controls_ok: bool = panel_ok and office._coordinator_panel._geo_non_remote != null \
			and office._coordinator_panel._recheck_days != null \
			and office._coordinator_panel._directives.get_child_count() >= 1 \
			and office._coordinator_panel._queue_grid.get_child_count() == 7 \
			and office._coordinator_panel._stop_search.disabled \
			and office._coordinator_panel._geo_score.editable \
			and office._coordinator_panel._mode_buttons.size() == 5 \
			and office._coordinator_panel._selected_mode() == "search" \
			and (office._coordinator_panel._mode_data_labels["harvest"] as Label).visible
	if panel_ok:
		# Selezione modalità cura dal selettore (ex toggle _maintenance): le
		# opzioni fini si sbloccano e il salvataggio propaga `mode`.
		var care: BaseButton = office._coordinator_panel._mode_buttons["care"]
		care.button_pressed = true
		office._coordinator_panel._geo_score.value = 72
		controls_ok = controls_ok and not office._coordinator_panel._stop_search.disabled
		office._coordinator_panel._save_settings()
	await get_tree().process_frame
	var save_ok := str(BackendBus.coordinator_state.get("maintenance", {}) \
			.get("mode", "")) == "care" \
			and int(BackendBus.coordinator_state.get("enrichment", {}) \
			.get("geocode_min_score", 0)) == 72
	# «Fino a quando» ([MODE-DEADLINE-UNREACHABLE-AND-ERASED]): la scadenza si
	# scegli dalla Console, e — soprattutto — salvare un'ALTRA impostazione non
	# la porta via. Il secondo salvataggio qui sotto non tocca il campo: se la
	# scadenza sparisse, sarebbe di nuovo il difetto del ticket.
	var deadline_ok := false
	if panel_ok:
		var panel: CoordinatorPanel = office._coordinator_panel
		panel._until_toggle.button_pressed = true
		panel._until_days.value = 2
		panel._until_hours.value = 0
		panel._save_settings()
		await get_tree().process_frame
		var armed: Dictionary = BackendBus.coordinator_state.get("maintenance", {})
		deadline_ok = int(armed.get("mode_until_sec", 0)) > 47 * 3600 \
				and armed.get("mode_until") != null \
				and panel._until_toggle.button_pressed
		panel._cv_score.value = 77
		panel._save_settings()
		await get_tree().process_frame
		var kept: Dictionary = BackendBus.coordinator_state.get("maintenance", {})
		deadline_ok = deadline_ok and kept.get("mode_until") != null \
				and int(kept.get("cv_min_score", 0)) == 77
		# E toglierla resta una scelta esplicita.
		panel._until_toggle.button_pressed = false
		panel._save_settings()
		await get_tree().process_frame
		deadline_ok = deadline_ok and BackendBus.coordinator_state \
				.get("maintenance", {}).get("mode_until") == null
	var before: int = BackendBus.coordinator_state.get("directives", []).size()
	BackendBus.add_team_directive("Test direttiva console", "order")
	await get_tree().process_frame
	var directive_ok: bool = BackendBus.coordinator_state.get("directives", []).size() \
			== before + 1
	var ok: bool = panel_ok and navigation_ok and chat_ok and thinking_ok \
			and controls_ok and save_ok and directive_ok and deadline_ok
	print("COORDINATOR-CONSOLE-TEST ", "PASS" if ok else "FAIL", " ",
			JSON.stringify({"panel": panel_ok, "controls": controls_ok,
				"navigation": navigation_ok, "chat": chat_ok,
				"thinking": thinking_ok, "save": save_ok,
				"directive": directive_ok, "deadline": deadline_ok}))
	get_tree().quit(0 if ok else 1)
## Regressione del cambio macchina (JHT_BACKEND_SWITCH_TEST=1). Riproduce la
## misura del 27/07 senza due VPS: box A con 694 righe `scored`, cambio di
## connessione, box B con 14 posizioni appena trovate. Le asserzioni dopo il
## cambio NON attendono alcun frame: se una pila conservasse il numero del box
## A, quel numero sarebbe già stato disegnato.
func _backend_switch_selftest() -> void:
	await get_tree().process_frame
	var failures: Array[String] = []
	var check := func(ok: bool, message: String) -> void:
		if not ok:
			failures.append(message)
	var shelf := OutputShelf.instance
	if shelf == null:
		print("BACKEND-SWITCH-TEST FAIL nessuno scaffale in scena")
		get_tree().quit(1)
		return
	var box_a: Array = []
	for i in 694:
		box_a.append({"id": i + 1, "status": "scored", "write_requested": 0})
	for i in 6:
		box_a.append({"id": 1000 + i, "status": "ready", "write_requested": 1,
				"critic_verdict": "PASS"})
	BackendBus.transitions = [{"position_id": 1, "ts": "2026-07-27T10:00:00Z",
			"to_state": "scored", "by_agent": "scorer-1"}]
	office._piles_synced = false  # prima pittura: è come essersi appena collegati
	BackendBus.publish_positions(box_a)
	var scorer: PaperPile = PaperPile.inbox["scorer"]
	check.call(scorer.count == 694 and int(scorer.debug_snapshot()["target"]) == 694,
			"box A: pila scorer %s" % JSON.stringify(scorer.debug_snapshot()))
	check.call(shelf._real == 6 and shelf._visual == 6,
			"box A: scaffale %d/%d" % [shelf._real, shelf._visual])

	# Cambio macchina. Da qui niente del box A può restare né sul bus né a
	# schermo, e non si concede un solo frame di tolleranza.
	BackendBus.set_backend(null)
	check.call(BackendBus.positions.is_empty(),
			"le posizioni del box precedente sono ancora sul bus")
	check.call(BackendBus.transitions.is_empty(),
			"le transizioni del box precedente sono ancora sul bus")
	var counts: Dictionary = BackendBus.pipeline_counts()
	var zeroed := true
	for value in counts.values():
		zeroed = zeroed and int(value) == 0
	check.call(zeroed, "pipeline_counts non azzerati: %s" % JSON.stringify(counts))
	for dept_id in office.PILE_PHASE:
		var pile: PaperPile = PaperPile.inbox[dept_id]
		check.call(pile.count == 0 and int(pile.debug_snapshot()["target"]) == 0,
				"pila %s non azzerata: %s" % [dept_id,
						JSON.stringify(pile.debug_snapshot())])
	check.call(shelf._real == 0 and shelf._visual == 0,
			"scaffale non azzerato: %d/%d" % [shelf._real, shelf._visual])

	# Box B: le sue 14 posizioni si agganciano di colpo, senza risalire un
	# foglio alla volta e senza passare dai numeri di prima.
	var box_b: Array = []
	for i in 14:
		box_b.append({"id": i + 1, "status": "new", "write_requested": 0})
	BackendBus.publish_positions(box_b)
	var scout: PaperPile = PaperPile.inbox["scout"]
	check.call(scout.count == 14 and int(scout.debug_snapshot()["target"]) == 14,
			"box B: pila scout %s" % JSON.stringify(scout.debug_snapshot()))
	check.call(scorer.count == 0,
			"box B: la pila scorer conserva %d fogli del box precedente" % scorer.count)
	var ok: bool = failures.is_empty()
	print("BACKEND-SWITCH-TEST ", "PASS " if ok else "FAIL ",
			JSON.stringify(failures))
	get_tree().quit(0 if ok else 1)
