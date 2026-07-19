extends Node
## Conversazioni di primo avvio che non consumano token e non richiedono un
## provider. Assistente, Coordinatore e Mentor raccolgono scelte utili,
## spiegano il prodotto e aprono le superfici native necessarie. Quando il
## provider è autenticato, la stessa chat abilita anche il testo libero verso
## l'agente reale.

signal conversation_changed(agent: String)
signal action_requested(action: String, payload: Dictionary)

const SAVE_PATH := "user://guided_onboarding.cfg"
const AGENTS := ["assistente", "coordinatore", "mentor"]

var _steps := {
	"assistente": "intro", "coordinatore": "intro", "mentor": "intro",
}
var _history := {}
var _draft := {}
var _preferences := {}
var _completed := {}
var _provider_choice := ""


func _ready() -> void:
	_load_state()
	for agent in AGENTS:
		_ensure_started(agent)


static func normalize_agent(value: String) -> String:
	var slug := value.to_lower()
	var dash := slug.rfind("-")
	if dash > 0:
		var suffix := slug.substr(dash + 1)
		if suffix.is_valid_int() or suffix.begins_with("s"):
			slug = slug.substr(0, dash)
	if slug == "capitano":
		return "coordinatore"
	return slug


func supports(value: String) -> bool:
	return AGENTS.has(normalize_agent(value))


func is_complete(value: String) -> bool:
	return bool(_completed.get(normalize_agent(value), false))


func completed_count() -> int:
	var count := 0
	for agent in AGENTS:
		count += 1 if is_complete(agent) else 0
	return count


func profile_draft() -> Dictionary:
	return _draft.duplicate(true)


func enrich_profile_fields(fields: Dictionary) -> Dictionary:
	var out := _draft.duplicate(true)
	out.merge(fields, true)
	for key in ["work_mode", "runtime_location", "career_priority", "search_style",
			"mentor_cadence"]:
		if _preferences.has(key):
			out[key] = _preferences[key]
	return out


func preferences() -> Dictionary:
	return _preferences.duplicate(true)


func live_text_available(value: String) -> bool:
	var agent := normalize_agent(value)
	return supports(agent) \
			and bool(SetupService.status.get("container_running", false)) \
			and bool(SetupService.status.get("provider_authenticated", false)) \
			and BackendBus.can_chat_with(agent)


func use_scripted_chat(value: String) -> bool:
	var agent := normalize_agent(value)
	return supports(agent) and (not is_complete(agent) or not live_text_available(agent))


func messages(value: String) -> Array:
	var agent := normalize_agent(value)
	_ensure_started(agent)
	return (_history.get(agent, []) as Array).duplicate(true)


func options(value: String) -> Array:
	var agent := normalize_agent(value)
	if not supports(agent) or is_complete(agent):
		return []
	match agent:
		"assistente": return _assistant_options(str(_steps[agent]))
		"coordinatore": return _coordinator_options(str(_steps[agent]))
		"mentor": return _mentor_options(str(_steps[agent]))
	return []


func choose(value: String, option_id: String) -> void:
	var agent := normalize_agent(value)
	var available := options(agent)
	var selected := {}
	for option in available:
		if str(option.get("id", "")) == option_id:
			selected = option
			break
	if selected.is_empty():
		return
	_append(agent, "user", str(selected.get("label", option_id)))
	match agent:
		"assistente": _choose_assistant(option_id)
		"coordinatore": _choose_coordinator(option_id)
		"mentor": _choose_mentor(option_id)
	_save_state()
	conversation_changed.emit(agent)


func reset_for_test() -> void:
	_steps = {"assistente": "intro", "coordinatore": "intro", "mentor": "intro"}
	_history.clear()
	_draft.clear()
	_preferences.clear()
	_completed.clear()
	_provider_choice = ""
	for agent in AGENTS:
		_ensure_started(agent)
	_save_state()


func _ensure_started(agent: String) -> void:
	if not supports(agent) or _history.has(agent):
		return
	_history[agent] = []
	_append(agent, "assistant", _opening(agent))


func _opening(agent: String) -> String:
	match agent:
		"assistente":
			return _tr("Ciao, sono l’Assistente. Possiamo preparare il tuo profilo senza collegare ancora alcuna AI: ti farò domande brevi e potrai correggere tutto dalla pagina Profilo.",
					"Hi, I’m the Assistant. We can prepare your profile before connecting any AI: I’ll ask short questions and you can edit everything later on the Profile page.")
		"coordinatore":
			return _tr("Benvenuto in ufficio. Io sono il Coordinatore: ti accompagno nell’attivazione del runtime, nella scelta del provider e nell’avvio del team. L’ufficio resta esplorabile in ogni momento.",
					"Welcome to the office. I’m the Coordinator: I’ll guide runtime activation, provider selection and team startup. The office remains open throughout.")
		_:
			return _tr("Io sono il Mentor. Prima che il team parta voglio capire che tipo di ricerca vuoi: prudente, equilibrata o ambiziosa. Sono preferenze, non vincoli permanenti.",
					"I’m the Mentor. Before the team starts, I want to understand the kind of search you want: cautious, balanced or ambitious. These are preferences, not permanent constraints.")


func _assistant_options(step: String) -> Array:
	match step:
		"intro": return _opts([
			["start", "Iniziamo dal mio obiettivo", "Let’s start with my goal"],
			["profile", "Preferisco compilare il profilo completo", "I prefer the full profile form"],
			["later", "Prima voglio esplorare l’ufficio", "I want to explore the office first"],
		])
		"role": return _opts([
			["software", "Software / engineering", "Software / engineering"],
			["data", "Data / AI", "Data / AI"],
			["product", "Product / project management", "Product / project management"],
			["other", "Un altro ambito", "Another field"],
		])
		"experience": return _opts([
			["junior", "Sto iniziando o ho meno di 2 anni", "I’m starting out or have under 2 years"],
			["mid", "Ho tra 2 e 5 anni", "I have 2–5 years"],
			["senior", "Ho più di 5 anni", "I have over 5 years"],
			["career", "Sto cambiando carriera", "I’m changing careers"],
		])
		"mode": return _opts([
			["remote", "Preferisco remoto", "I prefer remote"],
			["hybrid", "Preferisco ibrido", "I prefer hybrid"],
			["onsite", "Preferisco in presenza", "I prefer on-site"],
			["flexible", "Sono flessibile", "I’m flexible"],
		])
		"where": return _opts([
			["italy", "Italia", "Italy"], ["europe", "Europa", "Europe"],
			["worldwide", "Tutto il mondo", "Worldwide"],
			["remote_only", "Solo opportunità remote", "Remote opportunities only"],
		])
		"finish": return _opts([
			["complete_profile", "Completo ora i dati personali", "Complete personal data now"],
			["coordinator", "Passo al Coordinatore", "Continue with the Coordinator"],
		])
	return []


func _choose_assistant(id: String) -> void:
	match str(_steps["assistente"]):
		"intro":
			if id == "profile":
				_reply("assistente", _tr("Perfetto. Apro il modulo nativo: non serve un LLM e i dati restano nel tuo runtime.", "Perfect. I’ll open the native form: no LLM is needed and the data stays in your runtime."))
				action_requested.emit("open_section", {"section": "profile"})
				_steps["assistente"] = "finish"
			elif id == "later":
				_reply("assistente", _tr("Va benissimo. Torna da me quando vuoi: nessuna scelta viene persa e il setup non blocca l’ufficio.", "That’s fine. Come back whenever you want: no choice is lost and setup never blocks the office."))
			else:
				_reply("assistente", _tr("Che famiglia di ruolo descrive meglio ciò che cerchi?", "Which role family best describes what you’re looking for?"))
				_steps["assistente"] = "role"
		"role":
			var roles := {"software": "Software Engineering", "data": "Data / AI",
					"product": "Product / Project Management", "other": "Da definire"}
			_draft["target_role"] = roles.get(id, "Da definire")
			_reply("assistente", _tr("Ottimo. Quanta esperienza vuoi far pesare nella ricerca?", "Great. How much experience should the search account for?"))
			_steps["assistente"] = "experience"
		"experience":
			var exp := {"junior": ["1", "junior"], "mid": ["3", "mid"],
					"senior": ["7", "senior"], "career": ["0", "career-change"]}
			_draft["experience_years"] = exp[id][0]
			_draft["seniority_target"] = exp[id][1]
			_reply("assistente", _tr("Come preferisci lavorare?", "How do you prefer to work?"))
			_steps["assistente"] = "mode"
		"mode":
			_preferences["work_mode"] = id
			_reply("assistente", _tr("Qual è il perimetro geografico iniziale? Potrai restringerlo con i filtri.", "What is the initial geographic scope? You can narrow it with filters later."))
			_steps["assistente"] = "where"
		"where":
			var places := {"italy": "Italia", "europe": "Europa",
					"worldwide": "Worldwide", "remote_only": "Remote"}
			_draft["location"] = places.get(id, "")
			_reply("assistente", _tr("Ho preparato una bozza. Mancano nome, email, lingue e competenze: li inseriamo nel modulo, senza usare token.", "I prepared a draft. Name, email, languages and skills still need the native form; no tokens are used."))
			_steps["assistente"] = "finish"
		"finish":
			if id == "complete_profile":
				action_requested.emit("open_section", {"section": "profile"})
			else:
				action_requested.emit("open_scripted_chat", {"agent": "coordinatore"})
			_completed["assistente"] = true
			_reply("assistente", _tr("La mia parte guidata è conclusa. Quando il provider sarà collegato, qui potrai anche scrivermi liberamente.", "My guided part is complete. Once the provider is connected, you can also write to me freely here."))


func _coordinator_options(step: String) -> Array:
	match step:
		"intro": return _opts([
			["local", "Il team lavorerà su questo computer", "The team will run on this computer"],
			["vps", "Il team lavorerà su una VPS", "The team will run on a VPS"],
			["explain", "Spiegami la differenza", "Explain the difference"],
		])
		"runtime": return _opts([
			["start", "Avvia o controlla il container", "Start or check the container"],
			["repair", "Installa o ripara il runtime", "Install or repair the runtime"],
			["ready", "Il container è già attivo", "The container is already running"],
		])
		"provider": return _opts([
			["codex", "Codex con ChatGPT", "Codex with ChatGPT"],
			["claude", "Claude Code", "Claude Code"],
			["kimi", "Kimi", "Kimi"],
			["compare", "Aiutami a scegliere", "Help me choose"],
		])
		"login": return _opts([
			["login", "Apri il login nell’app", "Open login inside the app"],
			["different", "Scelgo un altro provider", "Choose another provider"],
			["check", "Ho completato il login: ricontrolla", "I completed login: check again"],
		])
		"profile": return _opts([
			["open_profile", "Completa o verifica il profilo", "Complete or review the profile"],
			["already", "Il profilo è già completo", "The profile is already complete"],
		])
		"channels": return _opts([
			["telegram", "Configura i tre bot Telegram", "Configure the three Telegram bots"],
			["email", "Collega la casella dei job alert", "Connect the job-alert mailbox"],
			["cloud", "Collega l’account cloud opzionale", "Connect the optional cloud account"],
			["skip_channels", "Per ora continuo senza canali opzionali", "Continue without optional channels for now"],
		])
		"team": return _opts([
			["start_team", "Attiva il team", "Activate the team"],
			["overview", "Mostrami la checklist", "Show me the checklist"],
			["mentor", "Prima parlo con il Mentor", "Talk to the Mentor first"],
		])
	return []


func _choose_coordinator(id: String) -> void:
	match str(_steps["coordinatore"]):
		"intro":
			if id == "explain":
				_reply("coordinatore", _tr("Locale è più semplice e si spegne col computer. Una VPS resta attiva 24/7 e viene controllata via SSH. In entrambi i casi dati e credenziali restano sotto il tuo controllo.", "Local is simpler and stops with your computer. A VPS runs 24/7 and is controlled over SSH. In both cases, you retain control of data and credentials."))
			else:
				_preferences["runtime_location"] = id
				if id == "vps":
					_reply("coordinatore", _tr("Apriamo la configurazione VPS: servono IP e chiave SSH. Poi torniamo qui per il provider.", "Let’s open VPS setup: you need an IP and SSH key. Then we’ll return here for the provider."))
					action_requested.emit("open_section", {"section": "vps"})
				else:
					_reply("coordinatore", _tr("Partiamo dal container locale. Posso controllarlo o avviare l’installazione guidata.", "Let’s start with the local container. I can check it or launch guided installation."))
				_steps["coordinatore"] = "runtime"
		"runtime":
			if id == "start":
				SetupService.start_container()
				_reply("coordinatore", _tr("Controllo avviato. Lo stato in alto si aggiornerà automaticamente; intanto scegliamo il provider.", "Check started. The status above updates automatically; meanwhile, let’s choose a provider."))
			elif id == "repair":
				SetupService.open_runtime_install()
				_reply("coordinatore", _tr("Ho aperto l’installazione nella console interna. Nessun terminale esterno.", "I opened installation in the embedded console. No external terminal."))
			else:
				SetupService.refresh()
				_reply("coordinatore", _tr("Ricevuto. Scegli il provider che userà il team.", "Got it. Choose the provider the team will use."))
			_steps["coordinatore"] = "provider"
		"provider":
			if id == "compare":
				_reply("coordinatore", _tr("Codex è il percorso più collaudato; Claude privilegia precisione; Kimi punta al costo più basso. Serve un abbonamento dedicato, non una API key a consumo.", "Codex is the most proven route; Claude prioritizes precision; Kimi targets lower cost. Use a dedicated subscription, not pay-per-use API keys."))
			else:
				_provider_choice = id
				if OS.get_environment("JHT_GUIDED_TEST") != "1":
					SetupService.select_provider(id)
				_reply("coordinatore", _tr("Provider selezionato. Il login si aprirà nella console incorporata e il browser servirà solo per autorizzare l’abbonamento.", "Provider selected. Login opens in the embedded console; the browser is only used to authorize the subscription."))
				_steps["coordinatore"] = "login"
		"login":
			if id == "different":
				_steps["coordinatore"] = "provider"
				_reply("coordinatore", _tr("Va bene, scegliamo di nuovo.", "Okay, let’s choose again."))
			elif id == "login":
				if not bool(SetupService.status.get("container_running", false)):
					_reply("coordinatore", _tr("Prima deve essere attivo il container. Apro la pagina Docker.", "The container must be running first. I’ll open the Docker page."))
					action_requested.emit("open_section", {"section": "docker"})
				elif _provider_choice != "":
					SetupService.open_provider_login(_provider_choice)
					_reply("coordinatore", _tr("Segui le istruzioni nella console. Quando termina, torna qui e scegli Ricontrolla.", "Follow the console instructions. When it finishes, return here and choose Check again."))
			elif id == "check":
				SetupService.refresh()
				_reply("coordinatore", _tr("Verifica avviata. Ora completiamo il profilo: questa parte non richiede l’LLM.", "Verification started. Now let’s complete the profile; this part does not require the LLM."))
				_steps["coordinatore"] = "profile"
			else:
				_steps["coordinatore"] = "provider"
		"profile":
			if id == "open_profile":
				action_requested.emit("open_section", {"section": "profile"})
			_reply("coordinatore", _tr("Quando il profilo è completo possiamo partire. Prima vuoi collegare uno dei canali opzionali? Puoi configurarli uno alla volta e tornare qui.", "Once the profile is complete we can start. First, would you like to connect any optional channels? You can configure them one at a time and return here."))
			_steps["coordinatore"] = "channels"
		"channels":
			if id == "skip_channels":
				_steps["coordinatore"] = "team"
				_reply("coordinatore", _tr("Nessun problema: Telegram, email e cloud restano configurabili in qualsiasi momento.", "No problem: Telegram, email and cloud remain available at any time."))
			else:
				var sections := {"telegram": "telegram", "email": "email", "cloud": "account"}
				action_requested.emit("open_section", {"section": sections.get(id, "activation")})
				_reply("coordinatore", _tr("Ho aperto la configurazione. Quando hai finito, torna in questa conversazione: le altre opzioni resteranno qui.", "I opened the configuration. When you finish, return to this conversation; the other choices will remain here."))
		"team":
			if id == "start_team":
				if bool(SetupService.status.get("ready", false)):
					SetupService.start_team()
					_completed["coordinatore"] = true
					_reply("coordinatore", _tr("Team in attivazione. Vedrai gli agenti raggiungere le postazioni man mano che le sessioni partono.", "Team activation started. You’ll see agents reach their desks as sessions come online."))
				else:
					_reply("coordinatore", _tr("Manca ancora almeno un requisito. Apro la checklist, così vediamo esattamente quale.", "At least one requirement is still missing. I’ll open the checklist so we can see exactly which one."))
					action_requested.emit("open_section", {"section": "activation"})
			elif id == "overview":
				action_requested.emit("open_section", {"section": "activation"})
			else:
				action_requested.emit("open_scripted_chat", {"agent": "mentor"})


func _mentor_options(step: String) -> Array:
	match step:
		"intro": return _opts([
			["stability", "Priorità alla stabilità", "Prioritize stability"],
			["growth", "Priorità alla crescita", "Prioritize growth"],
			["salary", "Priorità alla retribuzione", "Prioritize compensation"],
			["balance", "Priorità all’equilibrio", "Prioritize balance"],
		])
		"style": return _opts([
			["cautious", "Poche opportunità, molto selezionate", "Few, highly selected opportunities"],
			["balanced", "Un equilibrio tra qualità e scoperta", "Balance quality and discovery"],
			["ambitious", "Mostrami anche opportunità sfidanti", "Include stretch opportunities"],
		])
		"feedback": return _opts([
			["daily", "Un riepilogo breve ogni giorno", "A short daily summary"],
			["weekly", "Un punto strategico settimanale", "A weekly strategy review"],
			["milestones", "Scrivimi solo per decisioni importanti", "Only message me for important decisions"],
		])
		"finish": return _opts([
			["done", "Confermo queste preferenze", "Confirm these preferences"],
			["hours", "Configura gli orari del team", "Configure team working hours"],
			["restart", "Voglio ricominciare", "Start over"],
		])
	return []


func _choose_mentor(id: String) -> void:
	match str(_steps["mentor"]):
		"intro":
			_preferences["career_priority"] = id
			_reply("mentor", _tr("Quanto vuoi che il team allarghi il campo oltre il match più ovvio?", "How far should the team look beyond the most obvious match?"))
			_steps["mentor"] = "style"
		"style":
			_preferences["search_style"] = id
			_reply("mentor", _tr("Con quale frequenza vuoi un mio intervento?", "How often would you like me to step in?"))
			_steps["mentor"] = "feedback"
		"feedback":
			_preferences["mentor_cadence"] = id
			_reply("mentor", _tr("Perfetto. Userò queste scelte come bussola, non come gabbia. Potrai cambiarle e, dopo il login del provider, spiegarmi liberamente sfumature e vincoli.", "Perfect. I’ll use these choices as a compass, not a cage. You can change them and, after provider login, explain nuances and constraints freely."))
			_steps["mentor"] = "finish"
		"finish":
			if id == "hours":
				action_requested.emit("open_section", {"section": "hours"})
				_reply("mentor", _tr("Gli orari definiscono quando il team può consumare budget. Torna qui dopo averli salvati.", "Working hours define when the team may consume budget. Return here after saving them."))
			elif id == "restart":
				_history["mentor"] = []
				_preferences.erase("career_priority")
				_preferences.erase("search_style")
				_preferences.erase("mentor_cadence")
				_steps["mentor"] = "intro"
				_append("mentor", "assistant", _opening("mentor"))
			else:
				_completed["mentor"] = true
				_reply("mentor", _tr("Preferenze salvate. Quando il team sarà online, questa conversazione diventerà una chat libera con me.", "Preferences saved. When the team is online, this conversation becomes a free chat with me."))


func _reply(agent: String, text: String) -> void:
	_append(agent, "assistant", text)


func _append(agent: String, role: String, text: String) -> void:
	if not _history.has(agent):
		_history[agent] = []
	(_history[agent] as Array).append({
		"role": role, "text": text, "done": true,
		"ts": Time.get_unix_time_from_system(), "scripted": true,
	})


func _opts(rows: Array) -> Array:
	var out: Array = []
	for row in rows:
		out.append({"id": row[0], "label": _tr(str(row[1]), str(row[2]))})
	return out


static func _tr(it: String, en: String) -> String:
	return en if UIStrings.lang == "en" else it


func _save_state() -> void:
	if OS.get_environment("JHT_GUIDED_TEST") == "1":
		return
	var cfg := ConfigFile.new()
	cfg.set_value("guided", "steps", JSON.stringify(_steps))
	cfg.set_value("guided", "history", JSON.stringify(_history))
	cfg.set_value("guided", "draft", JSON.stringify(_draft))
	cfg.set_value("guided", "preferences", JSON.stringify(_preferences))
	cfg.set_value("guided", "completed", JSON.stringify(_completed))
	cfg.set_value("guided", "provider", _provider_choice)
	cfg.save(SAVE_PATH)


func _load_state() -> void:
	if OS.get_environment("JHT_GUIDED_TEST") == "1":
		return
	var cfg := ConfigFile.new()
	if cfg.load(SAVE_PATH) != OK:
		return
	_steps = _json_dict(str(cfg.get_value("guided", "steps", "{}")), _steps)
	_history = _json_dict(str(cfg.get_value("guided", "history", "{}")), {})
	_draft = _json_dict(str(cfg.get_value("guided", "draft", "{}")), {})
	_preferences = _json_dict(str(cfg.get_value("guided", "preferences", "{}")), {})
	_completed = _json_dict(str(cfg.get_value("guided", "completed", "{}")), {})
	_provider_choice = str(cfg.get_value("guided", "provider", ""))


static func _json_dict(raw: String, fallback: Dictionary) -> Dictionary:
	var parsed: Variant = JSON.parse_string(raw)
	return parsed if parsed is Dictionary else fallback
