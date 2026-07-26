extends Node
## Conversazioni di primo avvio che non consumano token e non richiedono un
## provider. Assistente, Coordinatore e Mentor raccolgono scelte utili,
## spiegano il prodotto e aprono le superfici native necessarie. Quando il
## provider è autenticato, la stessa chat abilita anche il testo libero verso
## l'agente reale.

signal conversation_changed(agent: String)
signal action_requested(action: String, payload: Dictionary)

const SAVE_PATH := "user://guided_onboarding.cfg"
const CONTEXT_JSON_PATH := "user://onboarding_context.json"
const CONTEXT_MARKDOWN_PATH := "user://onboarding_context.md"
const CONTEXT_SCHEMA_VERSION := 2
const AGENTS := ["assistente", "coordinatore", "mentor"]
const PROFILE_CONTEXT_FIELDS := ["name", "email", "target_role", "location",
		"experience_years", "seniority_target", "industry", "nationality",
		"skills_primary", "languages", "salary_min", "salary_max",
		"salary_currency"]

var _steps := {
	"assistente": "intro", "coordinatore": "intro", "mentor": "intro",
}
var _history := {}
var _draft := {}
var _preferences := {}
var _answers: Array = []
var _completed := {}
var _reconciled := {}
var _provider_choice := ""
var _provider_test_override := -1


func _ready() -> void:
	_load_state()
	for agent in AGENTS:
		_ensure_started(agent)
	# Gli step del Coordinatore sono riconciliati sullo STATO reale, non
	# innescati dagli eventi: chi arriva con provider o container già pronti
	# (reinstallazione, Claude Code installato prima del gioco) li trova
	# marcati come fatti invece di restare bloccato su un passo impossibile.
	SetupService.status_changed.connect(_reconcile_with_status)
	_reconcile_with_status(SetupService.status)


## Allinea il passo corrente ai prerequisiti già soddisfatti. Idempotente:
## ogni salto lo annuncia una volta sola e non torna mai indietro.
func _reconcile_with_status(s: Dictionary) -> void:
	if is_complete("coordinatore"):
		return
	var container := bool(s.get("container_running", false))
	var provider := bool(s.get("provider_authenticated", false))
	var step := str(_steps.get("coordinatore", "intro"))
	var moved := false
	if step == "runtime" and container:
		_steps["coordinatore"] = "provider"
		step = "provider"
		moved = true
		_announce_skip("runtime")
	if step in ["provider", "login"] and provider:
		_steps["coordinatore"] = "profile"
		moved = true
		_announce_skip("provider")
	if moved:
		_save_state()
		conversation_changed.emit("coordinatore")


func _announce_skip(what: String) -> void:
	if bool(_reconciled.get(what, false)):
		return
	_reconciled[what] = true
	match what:
		"runtime":
			_reply("coordinatore", _tr("Lo spazio di lavoro della squadra è già pronto su questo computer: salto il passaggio.",
					"The team’s workspace is already prepared on this computer: skipping that step."))
		"provider":
			_reply("coordinatore", _tr("Vedo che un servizio di intelligenza è già collegato su questo computer: tengo quello e andiamo avanti. Potrai cambiarlo quando vuoi da Provider.",
					"I can see an intelligence service is already connected on this computer: I’ll keep it and move on. You can change it any time from Provider."))


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


## Sincronizza nel contesto locale anche ciò che l'utente compila nel modulo
## nativo. I campi vuoti non cancellano dati già raccolti durante il dialogo.
func remember_profile_fields(fields: Dictionary) -> void:
	for key in PROFILE_CONTEXT_FIELDS:
		var value := str(fields.get(key, "")).strip_edges()
		if not value.is_empty():
			_draft[key] = value
	_save_state()


## Nome lasciato dall'utente all'ingresso (title screen): l'Assistente lo
## usa per chiamarlo per nome fin dal primo saluto (richiesta Leone 22/07).
func set_player_name(first: String, last: String) -> void:
	var clean_first := first.strip_edges()
	var clean_last := last.strip_edges()
	if clean_first.is_empty():
		return
	_draft["first_name"] = clean_first
	_draft["name"] = (clean_first + " " + clean_last).strip_edges()
	_save_state()


func player_first_name() -> String:
	var first := str(_draft.get("first_name", "")).strip_edges()
	if not first.is_empty():
		return first
	# fallback: la prima parola del nome completo (es. profilo importato)
	var full := str(_draft.get("name", "")).strip_edges()
	return full.get_slice(" ", 0) if not full.is_empty() else ""


## Nome e cognome come li ha scritti l'utente. Lo usa il ripulitore PII della
## segnalazione in-app: sapere come si chiama chi segnala è l'unico modo di
## toglierlo dai log, dove compare dentro path, nomi di file e messaggi.
func player_full_name() -> String:
	return str(_draft.get("name", "")).strip_edges()


## Suffisso pronto per i saluti: ", Leone" — o stringa vuota senza nome,
## così le battute restano naturali in entrambi i casi.
func player_suffix() -> String:
	var first := player_first_name()
	return ", " + first if not first.is_empty() else ""


## Risposte authored in forma strutturata. A differenza della cronologia chat,
## questa lista è stabile, categorizzata e pronta per essere trasformata in
## contesto iniziale quando viene collegato un provider.
func answers() -> Array:
	return _answers.duplicate(true)


func context_json_path() -> String:
	return ProjectSettings.globalize_path(CONTEXT_JSON_PATH)


func context_markdown_path() -> String:
	return ProjectSettings.globalize_path(CONTEXT_MARKDOWN_PATH)


func llm_context() -> Dictionary:
	return {
		"schema_version": CONTEXT_SCHEMA_VERSION,
		"updated_at": Time.get_datetime_string_from_system(false, true),
		"profile": _draft.duplicate(true),
		"preferences": _preferences.duplicate(true),
		"answers": _answers.duplicate(true),
		"onboarding_complete": _completed.duplicate(true),
		"provider_preference": _provider_choice,
	}


## Testo compatto, deliberatamente privo della cronologia dell'agente: si
## invia agli LLM solo ciò che l'utente ha dichiarato, non le battute authored.
func llm_context_text() -> String:
	var lines: Array[String] = [
		"# Contesto iniziale dichiarato dall'utente",
		"Usa questi dati come punto di partenza. Sono preferenze modificabili, non verità da inventare o vincoli assoluti.",
	]
	if not _draft.is_empty():
		lines.append("\n## Profilo")
		for key in _draft.keys():
			lines.append("- %s: %s" % [str(key), _display_value(_draft[key])])
	if not _preferences.is_empty():
		lines.append("\n## Preferenze e vincoli")
		for key in _preferences.keys():
			lines.append("- %s: %s" % [str(key), _display_value(_preferences[key])])
	if not _answers.is_empty():
		lines.append("\n## Risposte onboarding")
		for item in _answers:
			if item is Dictionary:
				lines.append("- [%s/%s] %s" % [str(item.get("agent", "")),
						str(item.get("topic", item.get("step", ""))),
						str(item.get("label", item.get("value", "")))])
	return "\n".join(lines)


func enrich_profile_fields(fields: Dictionary) -> Dictionary:
	var out := _draft.duplicate(true)
	out.merge(fields, true)
	for key in _preferences:
		out[key] = _preferences[key]
	return out


func preferences() -> Dictionary:
	return _preferences.duplicate(true)


## Preferenza raccolta fuori dalle chat guidate (es. dialoghi del tour):
## stessa pentola delle scelte scripted, stessa persistenza.
func set_preference(key: String, value: String) -> void:
	_preferences[key] = value
	_save_state()


## Anche le scelte fatte durante il tour fisico dei reparti entrano nella
## memoria strutturata. Non tutte sono preferenze operative, ma raccontano
## quali dubbi e risorse interessano di più all'utente.
func record_dialogue_choice(tree_id: String, node_id: String,
		choice_text: String, next_id: String) -> void:
	if not tree_id.begins_with("tour_"):
		return
	_record_answer(tree_id.trim_prefix("tour_"), node_id, next_id,
			{"label": choice_text})
	_save_state()


func live_text_available(value: String) -> bool:
	var agent := normalize_agent(value)
	return supports(agent) \
			and bool(SetupService.status.get("container_running", false)) \
			and provider_authenticated() \
			and BackendBus.can_chat_with(agent)


func provider_authenticated() -> bool:
	if _provider_test_override >= 0:
		return _provider_test_override == 1
	return bool(SetupService.status.get("provider_authenticated", false))

func set_provider_test_override(value: int) -> void:
	_provider_test_override = clampi(value, -1, 1)


## L'ufficio è ancora in modalità racconto? Vero finché il team non è davvero
## operativo. Un token sul disco non basta: senza container gli agenti reali
## non esistono e i marker/story devono restare, altrimenti l'utente clicca
## agenti muti (24/07).
func story_mode() -> bool:
	return not (provider_authenticated() \
			and bool(SetupService.status.get("container_running", false)))


func use_scripted_chat(value: String) -> bool:
	var agent := normalize_agent(value)
	# I dialoghi authored sono il gioco offline, non un secondo interlocutore
	# che si mescola con l'agente reale: si ritirano appena esiste un canale
	# vivo verso di lui. Il criterio è il canale, NON il token: legarli a
	# `provider_authenticated` lasciava senza interlocutore chi arriva con un
	# provider già configurato (token sul disco, container ancora spento) —
	# scriptato spento e live non ancora disponibile (24/07).
	return supports(agent) and not is_complete(agent) \
			and not live_text_available(agent)


func messages(value: String) -> Array:
	var agent := normalize_agent(value)
	_ensure_started(agent)
	return (_history.get(agent, []) as Array).duplicate(true)


func options(value: String) -> Array:
	var agent := normalize_agent(value)
	if not use_scripted_chat(agent) or is_complete(agent):
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
	_record_answer(agent, str(_steps.get(agent, "")), option_id, selected)
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
	_answers.clear()
	_completed.clear()
	_reconciled.clear()
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
			return _tr("Ciao, sono l’Assistente. Vorrei conoscerti un po’, così tutto l’ufficio saprà quali lavori cercare per te. Ti farò domande brevi e potrai correggere ogni risposta dalla pagina Profilo.",
					"Hi, I’m the Assistant. I’d like to get to know you so the whole office understands what work to seek for you. I’ll ask short questions and you can edit every answer later in Profile.")
		"coordinatore":
			return _tr("Benvenuto in ufficio. Io sono il Coordinatore: preparo la casa della squadra, collego gli strumenti di cui ha bisogno e faccio partire il lavoro. Ti accompagno io, un passo alla volta.",
					"Welcome to the office. I’m the Coordinator: I prepare the team’s workplace, connect the tools it needs and start the work. I’ll guide you one step at a time.")
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
			["design", "Design / UX / ricerca utente", "Design / UX / user research"],
			["business", "Sales / marketing / operations", "Sales / marketing / operations"],
			["security", "Cybersecurity / infrastruttura", "Cybersecurity / infrastructure"],
			["other", "Un altro ambito o più ruoli", "Another field or multiple roles"],
		])
		"specialty": return _assistant_specialty_options()
		"current_status": return _opts([
			["employed", "Lavoro già e cerco senza urgenza", "I’m employed and searching without urgency"],
			["active", "Lavoro già, ma voglio cambiare presto", "I’m employed but want to change soon"],
			["available", "Sono disponibile da subito", "I’m available immediately"],
			["graduate", "Studio o mi sono appena laureato/a", "I’m studying or recently graduated"],
			["freelance", "Sono freelance o consulente", "I’m a freelancer or consultant"],
			["returning", "Rientro dopo una pausa", "I’m returning after a break"],
		])
		"experience": return _opts([
			["entry", "Nessuna esperienza professionale", "No professional experience"],
			["junior", "Meno di 2 anni", "Under 2 years"],
			["mid", "Tra 2 e 5 anni", "Between 2 and 5 years"],
			["senior", "Tra 5 e 10 anni", "Between 5 and 10 years"],
			["lead", "Più di 10 anni / leadership", "Over 10 years / leadership"],
			["career", "Sto cambiando carriera", "I’m changing careers"],
		])
		"confidence": return _opts([
			["exact", "Voglio restare molto vicino alle mie competenze", "Stay very close to my current skills"],
			["adjacent", "Va bene un ruolo adiacente con qualcosa da imparare", "An adjacent role with some learning is fine"],
			["stretch", "Accetto ruoli sfidanti anche se non copro tutto", "Include stretch roles even if I lack some requirements"],
			["retrain", "Sono disposto/a a riqualificarmi seriamente", "I’m willing to retrain substantially"],
			["discover", "Non lo so ancora: aiutami a scoprirlo", "I’m unsure: help me discover it"],
		])
		"mode": return _opts([
			["remote", "Solo remoto", "Remote only"],
			["remote_first", "Preferisco remoto, ma valuto ibrido", "Remote-first, but I’ll consider hybrid"],
			["hybrid", "Preferisco ibrido", "I prefer hybrid"],
			["onsite", "Preferisco in presenza", "I prefer on-site"],
			["flexible", "Sono flessibile", "I’m flexible"],
		])
		"where": return _opts([
			["local", "Solo vicino a dove vivo", "Only near where I live"],
			["italy", "Tutta Italia", "Anywhere in Italy"],
			["eu", "Unione Europea / SEE", "European Union / EEA"],
			["europe", "Europa, anche fuori UE", "Europe, including outside the EU"],
			["worldwide", "Tutto il mondo", "Worldwide"],
			["remote_only", "Solo opportunità remote", "Remote opportunities only"],
		])
		"relocation": return _opts([
			["never", "Non voglio trasferirmi", "I don’t want to relocate"],
			["same_country", "Solo nella mia nazione", "Only within my country"],
			["eu", "Sì, all’interno dell’Europa", "Yes, within Europe"],
			["worldwide", "Sì, anche fuori Europa", "Yes, outside Europe too"],
			["sponsored", "Solo con visto e relocation pagati", "Only with visa sponsorship and paid relocation"],
			["depends", "Dipende dall’opportunità", "It depends on the opportunity"],
		])
		"contract": return _opts([
			["employee", "Solo assunzione da dipendente", "Permanent employee roles only"],
			["permanent", "Preferisco indeterminato, valuto altro", "Prefer permanent, consider others"],
			["contractor", "Preferisco contractor / partita IVA", "Prefer contractor / self-employed"],
			["freelance", "Cerco progetti freelance", "I’m looking for freelance projects"],
			["internship", "Valuto stage o apprendistato", "I’ll consider internships or apprenticeships"],
			["any", "Il tipo di contratto è secondario", "Contract type is secondary"],
		])
		"salary": return _opts([
			["hard_floor", "Ho una soglia minima non negoziabile", "I have a non-negotiable minimum"],
			["improve", "Voglio migliorare la retribuzione attuale", "I want to improve my current compensation"],
			["market", "Cerco una retribuzione in linea col mercato", "I want market-rate compensation"],
			["equity", "Valuto molto equity e bonus", "Equity and bonuses matter a lot"],
			["secondary", "Per ora stipendio secondario", "Compensation is secondary for now"],
			["unknown", "Non so ancora quale cifra chiedere", "I don’t know what to ask for yet"],
		])
		"company": return _opts([
			["startup", "Startup piccola e veloce", "Small, fast startup"],
			["scaleup", "Scale-up in crescita", "Growing scale-up"],
			["established", "Azienda strutturata", "Established company"],
			["enterprise", "Grande impresa / multinazionale", "Large enterprise / multinational"],
			["public", "Pubblico, ricerca o non-profit", "Public sector, research or non-profit"],
			["any", "Nessuna preferenza: conta il ruolo", "No preference: the role matters"],
		])
		"finish": return _opts([
			["complete_profile", "Completo ora i dati personali", "Complete personal data now"],
			["coordinator", "Passo al Coordinatore", "Continue with the Coordinator"],
			["mentor", "Prima definisco la strategia col Mentor", "Define strategy with the Mentor first"],
		])
	return []


func _assistant_specialty_options() -> Array:
	match str(_draft.get("target_role", "")):
		"Software Engineering": return _opts([
			["backend", "Backend / API / sistemi distribuiti", "Backend / APIs / distributed systems"],
			["frontend", "Frontend / mobile / UI engineering", "Frontend / mobile / UI engineering"],
			["fullstack", "Full-stack", "Full-stack"],
			["platform", "Platform / DevOps / cloud", "Platform / DevOps / cloud"],
			["embedded", "Embedded / robotics / hardware", "Embedded / robotics / hardware"],
			["open", "Più specializzazioni", "Multiple specializations"],
		])
		"Data / AI": return _opts([
			["data_science", "Data science / analytics", "Data science / analytics"],
			["ml", "Machine learning / applied AI", "Machine learning / applied AI"],
			["genai", "LLM / generative AI / agenti", "LLMs / generative AI / agents"],
			["data_engineering", "Data engineering / BI", "Data engineering / BI"],
			["research", "Ricerca AI", "AI research"],
			["open", "Sono aperto/a a più aree", "I’m open to multiple areas"],
		])
		"Product / Project Management": return _opts([
			["product", "Product management", "Product management"],
			["project", "Project / program management", "Project / program management"],
			["technical_pm", "Technical product management", "Technical product management"],
			["delivery", "Delivery / agile / operations", "Delivery / agile / operations"],
			["founder", "Product leadership / founder’s office", "Product leadership / founder’s office"],
		])
	return _opts([
		["specialist", "Voglio restare specialista", "I want to remain a specialist"],
		["generalist", "Preferisco un ruolo generalista", "I prefer a generalist role"],
		["leadership", "Cerco responsabilità di leadership", "I’m seeking leadership responsibility"],
		["individual", "Preferisco contribuire senza gestire persone", "I prefer an individual-contributor path"],
		["explore", "Voglio esplorare più direzioni", "I want to explore several directions"],
	])


func _choose_assistant(id: String) -> void:
	match str(_steps["assistente"]):
		"intro":
			if id == "profile":
				_reply("assistente", _tr("Perfetto. Ti apro la scheda personale: puoi compilarla con calma e le informazioni restano nel tuo ufficio.", "Perfect. I’ll open your personal profile: you can complete it at your own pace and the information stays in your office."))
				action_requested.emit("open_section", {"section": "profile"})
				_steps["assistente"] = "finish"
			elif id == "later":
				_reply("assistente", _tr("Va benissimo. Torna da me quando vuoi: nessuna scelta viene persa e il setup non blocca l’ufficio.", "That’s fine. Come back whenever you want: no choice is lost and setup never blocks the office."))
			else:
				_reply("assistente", _tr("Che famiglia di ruolo descrive meglio ciò che cerchi?", "Which role family best describes what you’re looking for?"))
				_steps["assistente"] = "role"
		"role":
			var roles := {"software": "Software Engineering", "data": "Data / AI",
					"product": "Product / Project Management", "design": "Design / UX",
					"business": "Business / Operations", "security": "Security / Infrastructure",
					"other": "Da definire / multidisciplinare"}
			_draft["target_role"] = roles.get(id, "Da definire")
			_reply("assistente", _tr("Ottimo. Dentro quest’area, quale direzione ti somiglia di più?", "Great. Within that area, which direction fits you best?"))
			_steps["assistente"] = "specialty"
		"specialty":
			_preferences["target_specialty"] = id
			_reply("assistente", _tr("Ora inquadriamo il livello: quanta esperienza professionale porti con te?", "Now let’s frame your level: how much professional experience do you bring?"))
			_steps["assistente"] = "experience"
		"experience":
			var exp := {"entry": ["0", "entry"], "junior": ["1", "junior"],
					"mid": ["3", "mid"], "senior": ["7", "senior"],
					"lead": ["12", "lead"], "career": ["0", "career-change"]}
			_draft["experience_years"] = exp[id][0]
			_draft["seniority_target"] = exp[id][1]
			_reply("assistente", _tr("E qual è la tua situazione adesso? Cambia molto il ritmo con cui il team deve cercare.", "What is your current situation? It changes the pace the team should use."))
			_steps["assistente"] = "current_status"
		"current_status":
			_preferences["current_status"] = id
			_reply("assistente", _tr("Quanto vuoi che esploriamo anche lavori per cui non sembri perfetto sulla carta?", "How much should we explore jobs for which you may not look perfect on paper?"))
			_steps["assistente"] = "confidence"
		"confidence":
			_preferences["skills_stretch"] = id
			_reply("assistente", _tr("Come preferisci lavorare nella quotidianità?", "How do you prefer to work day to day?"))
			_steps["assistente"] = "mode"
		"mode":
			_preferences["work_mode"] = id
			_reply("assistente", _tr("In quali luoghi vuoi che il reparto Ricerca cerchi per cominciare? Potrai cambiare idea quando vuoi.", "Where should the Research department look to begin with? You can change your mind at any time."))
			_steps["assistente"] = "where"
		"where":
			var places := {"local": "Vicino alla residenza", "italy": "Italia",
					"eu": "Unione Europea / SEE", "europe": "Europa",
					"worldwide": "Worldwide", "remote_only": "Remote"}
			_draft["location"] = places.get(id, "")
			_reply("assistente", _tr("Per una posizione davvero giusta, quanto sei disponibile a trasferirti?", "For the right position, how open are you to relocating?"))
			_steps["assistente"] = "relocation"
		"relocation":
			_preferences["relocation"] = id
			_preferences["requires_sponsorship"] = id == "sponsored"
			_reply("assistente", _tr("Quale rapporto di lavoro vuoi privilegiare?", "Which employment relationship should we prioritize?"))
			_steps["assistente"] = "contract"
		"contract":
			_preferences["contract_preference"] = id
			_reply("assistente", _tr("Che peso deve avere la retribuzione nella selezione? La cifra esatta potrai metterla nel Profilo.", "How much should compensation influence selection? You can enter the exact figure in Profile."))
			_steps["assistente"] = "salary"
		"salary":
			_preferences["compensation_strategy"] = id
			_reply("assistente", _tr("In quale tipo di organizzazione pensi di rendere meglio?", "In what kind of organization do you think you’ll perform best?"))
			_steps["assistente"] = "company"
		"company":
			_preferences["company_stage"] = id
			_reply("assistente", _assistant_finish_reply())
			_steps["assistente"] = "finish"
		"finish":
			if id == "complete_profile":
				action_requested.emit("open_section", {"section": "profile"})
			elif id == "mentor":
				action_requested.emit("open_scripted_chat", {"agent": "mentor"})
			else:
				action_requested.emit("open_scripted_chat", {"agent": "coordinatore"})
			_completed["assistente"] = true
			_reply("assistente", _tr("Adesso l’ufficio ti conosce già un po’ meglio. Quando avremo collegato la sua intelligenza, qui potrai anche scrivermi liberamente.", "The office already knows you a little better now. Once its intelligence is connected, you’ll also be able to write to me freely here."))


func _coordinator_options(step: String) -> Array:
	match step:
		"intro": return _opts([
			["local", "Il team lavorerà su questo computer", "The team will run on this computer"],
			["vps", "Il team lavorerà su un computer online sempre acceso", "The team will run on an always-on online computer"],
			["explain", "Spiegami la differenza", "Explain the difference"],
		])
		"runtime": return _opts([
			["start", "Prepara o controlla lo spazio di lavoro", "Prepare or check the workspace"],
			["repair", "Installa o ripara lo spazio di lavoro", "Install or repair the workspace"],
			["ready", "Lo spazio di lavoro è già pronto", "The workspace is already ready"],
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
		"autonomy": return _opts([
			["review_all", "Voglio approvare ogni candidatura", "I want to approve every application"],
			["review_cv", "Prepara tutto, ma fammi approvare i documenti", "Prepare everything, but let me approve documents"],
			["high_score", "Procedi da solo soltanto con le occasioni migliori", "Proceed alone only with the best opportunities"],
			["autonomous", "Automatizza il più possibile", "Automate as much as possible"],
			["observe", "Per ora osserva e non eseguire azioni esterne", "For now observe and take no external actions"],
		])
		"budget": return _opts([
			["minimal", "Risparmio massimo: fate soltanto l’essenziale", "Maximum savings: do only what is essential"],
			["careful", "Risparmioso: qualità dove conta", "Economical: quality where it matters"],
			["balanced", "Bilanciato", "Balanced"],
			["quality", "Privilegia la qualità", "Prioritize quality"],
			["unrestricted", "Nessun limite finché produce valore", "No limit while it creates value"],
		])
		"privacy": return _opts([
			["strict", "Minimizza sempre i dati condivisi", "Always minimize shared data"],
			["cv_only", "Usa solo ciò che compare nel CV", "Use only what appears in my CV"],
			["contextual", "Usa i miei dati quando sono pertinenti", "Use my data when relevant"],
			["ask_sensitive", "Chiedimi conferma per dati sensibili", "Ask before using sensitive data"],
			["standard", "Impostazioni standard", "Standard settings"],
		])
		"availability": return _opts([
			["office", "Solo in orario lavorativo", "Business hours only"],
			["evenings", "Soprattutto sera e weekend", "Mostly evenings and weekends"],
			["always", "Può lavorare 24/7", "It may work 24/7"],
			["manual", "Solo quando lo avvio io", "Only when I start it"],
			["custom", "Configuro orari personalizzati", "Configure custom hours"],
		])
		"channels": return _opts([
			["telegram", "Ricevi gli aggiornamenti su Telegram", "Receive updates on Telegram"],
			["email", "Fai controllare una casella per gli avvisi di lavoro", "Have a mailbox checked for job alerts"],
			["cloud", "Collega uno spazio online opzionale", "Connect an optional online space"],
			["skip_channels", "Per ora continuo senza canali opzionali", "Continue without optional channels for now"],
		])
		"team": return _opts([
			["start_team", "Attiva il team", "Activate the team"],
			["overview", "Mostrami la checklist", "Show me the checklist"],
			["mentor", "Prima parlo con il Mentor", "Talk to the Mentor first"],
			["review", "Rivediamo le mie impostazioni operative", "Review my operating settings"],
		])
	return []


func _choose_coordinator(id: String) -> void:
	match str(_steps["coordinatore"]):
		"intro":
			if id == "explain":
				_reply("coordinatore", _tr("Su questo computer è più semplice e la squadra riposa quando lo spegni. Un computer online resta acceso anche mentre sei lontano. In entrambi i casi le chiavi dell’ufficio restano nelle tue mani.", "This computer is simpler and the team rests when you turn it off. An online computer stays on while you are away. Either way, you keep the office keys."))
			else:
				_preferences["runtime_location"] = id
				if id == "vps":
					_reply("coordinatore", _tr("Ti apro la configurazione del computer online. La procedura ti chiederà dove si trova e come accedervi, spiegandoti ogni passaggio. Poi torniamo qui.", "I’ll open online-computer setup. It will ask where the computer is and how to access it, explaining each step. Then we’ll return here."))
					action_requested.emit("open_section", {"section": "vps"})
				else:
					_reply("coordinatore", _tr("Partiamo preparando uno spazio di lavoro riservato alla squadra su questo computer. Posso controllarlo o guidarti nell’installazione.", "Let’s prepare a private workspace for the team on this computer. I can check it or guide you through installation."))
				_steps["coordinatore"] = "runtime"
		"runtime":
			if id == "start":
				SetupService.start_container()
				_reply("coordinatore", _tr("Controllo avviato. Lo stato in alto si aggiornerà da solo; intanto scegliamo quale intelligenza assisterà la squadra.", "Check started. The status above updates itself; meanwhile, let’s choose which intelligence will assist the team."))
			elif id == "repair":
				SetupService.open_runtime_install()
				_reply("coordinatore", _tr("Ho aperto qui dentro l’installazione guidata. Segui i passaggi e poi torna da me.", "I opened guided installation in here. Follow the steps, then come back to me."))
			else:
				SetupService.refresh()
				_reply("coordinatore", _tr("Ricevuto. Scegli ora quale servizio assisterà la squadra nel suo lavoro.", "Got it. Now choose which service will assist the team in its work."))
			_steps["coordinatore"] = "provider"
		"provider":
			if id == "compare":
				_reply("coordinatore", _tr("Codex è la scelta più collaudata, Claude è apprezzato per la precisione e Kimi tende a essere più economico. Puoi usare il servizio a cui sei già abbonato e cambiare idea in seguito.", "Codex is the most proven choice, Claude is known for precision and Kimi tends to be less expensive. You can use a service you already subscribe to and change later."))
			else:
				_provider_choice = id
				if OS.get_environment("JHT_GUIDED_TEST") != "1":
					SetupService.select_provider(id)
				_reply("coordinatore", _tr("Scelta registrata. Il collegamento avverrà qui dentro; il browser si aprirà soltanto per confermare il tuo abbonamento.", "Choice recorded. The connection happens in here; the browser opens only to confirm your subscription."))
				_steps["coordinatore"] = "login"
		"login":
			if id == "different":
				_steps["coordinatore"] = "provider"
				_reply("coordinatore", _tr("Va bene, scegliamo di nuovo.", "Okay, let’s choose again."))
			elif id == "login":
				if not bool(SetupService.status.get("container_running", false)):
					_reply("coordinatore", _tr("Prima dobbiamo preparare lo spazio di lavoro della squadra. Ti apro la pagina giusta.", "First we need to prepare the team’s workspace. I’ll open the right page."))
					action_requested.emit("open_section", {"section": "docker"})
				elif _provider_choice != "":
					SetupService.open_provider_login(_provider_choice)
					_reply("coordinatore", _tr("Segui le istruzioni che compaiono qui dentro. Quando hai terminato, torna da me e chiedimi di controllare.", "Follow the instructions shown in here. When you are done, come back and ask me to check."))
			elif id == "check":
				SetupService.refresh()
				_reply("coordinatore", _tr("Verifica avviata. Ora completiamo il Profilo, così ogni reparto saprà per chi sta lavorando.", "Verification started. Now let’s complete Profile so every department knows whom it is working for."))
				_steps["coordinatore"] = "profile"
			else:
				_steps["coordinatore"] = "provider"
		"profile":
			if id == "open_profile":
				action_requested.emit("open_section", {"section": "profile"})
			_reply("coordinatore", _tr("Ora decidiamo quanta autonomia dare alla squadra. Le azioni esterne restano sempre tracciabili.", "Now let’s decide how much autonomy to give the team. External actions always remain traceable."))
			_steps["coordinatore"] = "autonomy"
		"autonomy":
			_preferences["approval_mode"] = id
			_reply("coordinatore", _tr("Quanto vuoi che l’ufficio risparmi? Più prudenza significa meno lavoro superfluo; più libertà significa più approfondimenti.", "How much should the office save? More caution means less unnecessary work; more freedom means more in-depth work."))
			_steps["coordinatore"] = "budget"
		"budget":
			_preferences["token_budget_style"] = id
			_reply("coordinatore", _tr("Quale regola sulla riservatezza devo far rispettare a tutti i colleghi?", "Which privacy rule should every colleague follow?"))
			_steps["coordinatore"] = "privacy"
		"privacy":
			_preferences["privacy_mode"] = id
			_reply("coordinatore", _tr("In quali orari vuoi che l’ufficio lavori e quando preferisci non essere disturbato?", "When should the office work, and when would you rather not be disturbed?"))
			_steps["coordinatore"] = "availability"
		"availability":
			_preferences["team_availability"] = id
			if id == "custom":
				action_requested.emit("open_section", {"section": "hours"})
			_reply("coordinatore", _coordinator_policy_reply())
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
					_reply("coordinatore", _tr("L’ufficio sta aprendo. Vedrai i colleghi raggiungere le loro scrivanie man mano che prendono servizio.", "The office is opening. You’ll see colleagues reach their desks as they begin work."))
				else:
					_reply("coordinatore", _tr("Manca ancora almeno un requisito. Apro la checklist, così vediamo esattamente quale.", "At least one requirement is still missing. I’ll open the checklist so we can see exactly which one."))
					action_requested.emit("open_section", {"section": "activation"})
			elif id == "overview":
				action_requested.emit("open_section", {"section": "activation"})
			elif id == "mentor":
				action_requested.emit("open_scripted_chat", {"agent": "mentor"})
			else:
				_steps["coordinatore"] = "autonomy"
				_reply("coordinatore", _tr("Ripartiamo dal livello di autonomia. Le nuove risposte sostituiranno le preferenze precedenti.", "Let’s restart from autonomy. New answers will replace the previous preferences."))


func _mentor_options(step: String) -> Array:
	match step:
		"intro": return _opts([
			["stability", "Priorità alla stabilità", "Prioritize stability"],
			["growth", "Priorità alla crescita", "Prioritize growth"],
			["salary", "Priorità alla retribuzione", "Prioritize compensation"],
			["balance", "Priorità all’equilibrio", "Prioritize balance"],
			["meaning", "Priorità all’impatto e al significato", "Prioritize impact and meaning"],
			["learning", "Priorità all’apprendimento", "Prioritize learning"],
			["reentry", "Priorità a rientrare nel mercato", "Prioritize re-entering the market"],
		])
		"motivation": return _opts([
			["escape", "Voglio uscire da una situazione che non mi fa stare bene", "I want to leave a situation that isn’t good for me"],
			["plateau", "Mi sento fermo/a e voglio crescere", "I feel stuck and want to grow"],
			["layoff", "Ho perso il lavoro o temo di perderlo", "I lost my job or fear losing it"],
			["curious", "Sto bene, ma voglio capire cosa offre il mercato", "I’m fine, but want to explore the market"],
			["life_change", "È cambiata la mia vita e il lavoro deve adattarsi", "My life changed and work must adapt"],
			["first_job", "Cerco il mio primo vero ingresso", "I’m looking for my first real opportunity"],
		])
		"style": return _opts([
			["cautious", "Poche opportunità, molto selezionate", "Few, highly selected opportunities"],
			["balanced", "Un equilibrio tra qualità e scoperta", "Balance quality and discovery"],
			["ambitious", "Mostrami anche opportunità sfidanti", "Include stretch opportunities"],
			["volume", "Voglio esplorare un volume ampio", "I want to explore a broad volume"],
			["experimental", "Proviamo strade diverse e impariamo dai risultati", "Try several paths and learn from results"],
		])
		"risk": return _opts([
			["very_low", "Evitiamo rischi: requisiti quasi perfetti", "Avoid risk: near-perfect requirements"],
			["low", "Qualche scommessa, ma motivata", "A few well-reasoned bets"],
			["medium", "Metà match solidi, metà opportunità ambiziose", "Half solid matches, half stretch opportunities"],
			["high", "Preferisco puntare in alto", "I prefer aiming high"],
			["adaptive", "Adatta il rischio ai risultati", "Adapt risk based on results"],
		])
		"pace": return _opts([
			["gentle", "Ritmo leggero, senza pressione", "A light pace, without pressure"],
			["steady", "Costante ogni settimana", "Steady every week"],
			["intensive", "Ricerca intensa per poche settimane", "Intensive search for a few weeks"],
			["urgent", "Massima urgenza", "Maximum urgency"],
			["adaptive", "Adatta il ritmo alle opportunità", "Adapt the pace to opportunities"],
		])
		"tone": return _opts([
			["gentle", "Empatico e incoraggiante", "Empathetic and encouraging"],
			["direct", "Diretto, senza giri di parole", "Direct and plain-spoken"],
			["analytical", "Analitico, con dati e motivazioni", "Analytical, with data and reasoning"],
			["challenging", "Sfidami quando mi sto limitando", "Challenge me when I’m limiting myself"],
			["brief", "Molto sintetico", "Very concise"],
		])
		"feedback": return _opts([
			["daily", "Un riepilogo breve ogni giorno", "A short daily summary"],
			["twice_week", "Due aggiornamenti alla settimana", "Two updates per week"],
			["weekly", "Un punto strategico settimanale", "A weekly strategy review"],
			["milestones", "Scrivimi solo per decisioni importanti", "Only message me for important decisions"],
			["on_demand", "Solo quando lo chiedo io", "Only when I ask"],
		])
		"dealbreakers": return _opts([
			["culture", "Ambiente tossico o valori incompatibili", "Toxic culture or incompatible values"],
			["hours", "Straordinari e reperibilità frequenti", "Frequent overtime and on-call work"],
			["commute", "Pendolarismo o presenza eccessiva", "Excessive commute or on-site requirements"],
			["instability", "Contratto o azienda troppo instabili", "Unstable contract or company"],
			["ethics", "Settori o prodotti che non condivido", "Industries or products I don’t support"],
			["none", "Nessun veto generale: valuto caso per caso", "No general veto: evaluate case by case"],
		])
		"finish": return _opts([
			["done", "Confermo queste preferenze", "Confirm these preferences"],
			["hours", "Configura gli orari del team", "Configure team working hours"],
			["restart", "Voglio ricominciare", "Start over"],
			["assistant", "Torno dall’Assistente", "Return to the Assistant"],
		])
	return []


func _choose_mentor(id: String) -> void:
	match str(_steps["mentor"]):
		"intro":
			_preferences["career_priority"] = id
			_reply("mentor", _tr("Capito. Qual è la ragione più vera per cui stai cercando adesso?", "Understood. What is the truest reason you’re searching now?"))
			_steps["mentor"] = "motivation"
		"motivation":
			_preferences["search_motivation"] = id
			_reply("mentor", _tr("Quanto vuoi che il team allarghi il campo oltre il match più ovvio?", "How far should the team look beyond the most obvious match?"))
			_steps["mentor"] = "style"
		"style":
			_preferences["search_style"] = id
			_reply("mentor", _tr("Quanta incertezza sei disposto/a ad accettare per una possibilità migliore?", "How much uncertainty will you accept for a better opportunity?"))
			_steps["mentor"] = "risk"
		"risk":
			_preferences["risk_tolerance"] = id
			_reply("mentor", _tr("Che ritmo vuoi sostenere senza bruciarti?", "What pace can you sustain without burning out?"))
			_steps["mentor"] = "pace"
		"pace":
			_preferences["search_pace"] = id
			_reply("mentor", _tr("Come vuoi che ti parli quando vedo un problema o un’occasione?", "How should I speak to you when I see a problem or opportunity?"))
			_steps["mentor"] = "tone"
		"tone":
			_preferences["feedback_tone"] = id
			_reply("mentor", _tr("Con quale frequenza vuoi un mio intervento?", "How often would you like me to step in?"))
			_steps["mentor"] = "feedback"
		"feedback":
			_preferences["mentor_cadence"] = id
			_reply("mentor", _tr("Ultima domanda sostanziale: quale segnale deve farmi scartare subito una posizione?", "One last substantial question: what should make me reject a position immediately?"))
			_steps["mentor"] = "dealbreakers"
		"dealbreakers":
			_preferences["primary_dealbreaker"] = id
			_reply("mentor", _mentor_finish_reply())
			_steps["mentor"] = "finish"
		"finish":
			if id == "hours":
				action_requested.emit("open_section", {"section": "hours"})
				_reply("mentor", _tr("Gli orari dicono alla squadra quando lavorare e quando lasciarti in pace. Torna qui dopo averli salvati.", "Working hours tell the team when to work and when to leave you in peace. Return here after saving them."))
			elif id == "restart":
				_history["mentor"] = []
				for key in ["career_priority", "search_motivation", "search_style",
						"risk_tolerance", "search_pace", "feedback_tone",
						"mentor_cadence", "primary_dealbreaker"]:
					_preferences.erase(key)
				_steps["mentor"] = "intro"
				_append("mentor", "assistant", _opening("mentor"))
			elif id == "assistant":
				action_requested.emit("open_scripted_chat", {"agent": "assistente"})
			else:
				_completed["mentor"] = true
				_reply("mentor", _tr("Ho preso nota. Quando l’ufficio sarà al lavoro, potremo continuare questa conversazione liberamente ogni volta che ne avrai bisogno.", "I’ve taken note. Once the office is working, we can continue this conversation freely whenever you need it."))


func _reply(agent: String, text: String) -> void:
	_append(agent, "assistant", text)


func _assistant_finish_reply() -> String:
	var mode := str(_preferences.get("work_mode", "flexible"))
	var stretch := str(_preferences.get("skills_stretch", "adjacent"))
	var status := str(_preferences.get("current_status", "employed"))
	var parts: Array[String] = []
	if mode in ["remote", "remote_first"] and str(_preferences.get("relocation", "")) == "never":
		parts.append(_tr("terrò il perimetro remoto molto rigido", "I’ll keep the remote boundary strict"))
	elif bool(_preferences.get("requires_sponsorship", false)):
		parts.append(_tr("filtrerò subito visto e relocation", "I’ll filter visa and relocation immediately"))
	if stretch in ["stretch", "retrain"]:
		parts.append(_tr("il reparto Compatibilità considererà anche lavori in cui puoi crescere", "the Compatibility department will also consider jobs you can grow into"))
	elif stretch == "exact":
		parts.append(_tr("il reparto Compatibilità resterà vicino a ciò che sai già fare bene", "the Compatibility department will stay close to what you already do well"))
	if status in ["available", "active"]:
		parts.append(_tr("la ricerca partirà con un ritmo sostenuto", "the search will start at a brisk pace"))
	elif status == "employed":
		parts.append(_tr("privilegeremo qualità e discrezione rispetto al volume", "we’ll favor quality and discretion over volume"))
	var tailored := "; ".join(parts)
	if tailored.is_empty():
		tailored = _tr("useremo queste preferenze per scegliere e spiegare ogni opportunità", "we’ll use these preferences to choose and explain every opportunity")
	return _tr("Ho preparato un profilo su misura: %s. Nella scheda personale puoi aggiungere nome, contatti, lingue, competenze e cifre esatte.", "I prepared a tailored profile: %s. In your personal profile you can add your name, contact details, languages, skills and exact figures.") % tailored


func _coordinator_policy_reply() -> String:
	var autonomy := str(_preferences.get("approval_mode", "review_all"))
	var budget := str(_preferences.get("token_budget_style", "balanced"))
	var privacy := str(_preferences.get("privacy_mode", "standard"))
	var summary := _tr("approvazione manuale", "manual approval")
	if autonomy == "review_cv": summary = _tr("preparazione automatica con approvazione dei documenti", "automatic preparation with document approval")
	elif autonomy == "high_score": summary = _tr("iniziativa riservata alle opportunità migliori", "initiative limited to the best opportunities")
	elif autonomy == "autonomous": summary = _tr("autonomia estesa e tracciata", "broad, traceable autonomy")
	elif autonomy == "observe": summary = _tr("sola osservazione, nessuna azione esterna", "observation only, no external actions")
	return _tr("Regole dell’ufficio registrate: %s; livello di risparmio %s; riservatezza %s. Ora scegliamo se collegare un modo opzionale per ricevere aggiornamenti.", "Office rules recorded: %s; savings level %s; privacy %s. Now let’s choose whether to connect an optional way to receive updates.") % [summary, budget, privacy]


func _mentor_finish_reply() -> String:
	var priority := str(_preferences.get("career_priority", "balance"))
	var style := str(_preferences.get("search_style", "balanced"))
	var risk := str(_preferences.get("risk_tolerance", "medium"))
	var pace := str(_preferences.get("search_pace", "steady"))
	return _tr("La tua bussola ora è chiara: priorità %s, ricerca %s, rischio %s e ritmo %s. Il veto principale resta %s. Non è una gabbia: se i risultati raccontano altro, te lo dirò.", "Your compass is now clear: %s priority, %s search, %s risk and %s pace. Your primary veto remains %s. It is not a cage: if results tell a different story, I’ll say so.") % [priority, style, risk, pace, str(_preferences.get("primary_dealbreaker", "none"))]


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


func _record_answer(agent: String, step: String, option_id: String,
		selected: Dictionary) -> void:
	var topic := "%s.%s" % [agent, step]
	# Se l'utente rivede una sezione teniamo il valore corrente nel contesto
	# LLM, evitando istruzioni contraddittorie. La cronologia chat conserva
	# comunque l'intero percorso umano.
	for i in range(_answers.size() - 1, -1, -1):
		var old: Variant = _answers[i]
		if old is Dictionary and str(old.get("topic", "")) == topic:
			_answers.remove_at(i)
	_answers.append({
		"agent": agent,
		"step": step,
		"topic": topic,
		"value": option_id,
		"label": str(selected.get("label", option_id)),
		"updated_at": Time.get_datetime_string_from_system(false, true),
	})


static func _display_value(value: Variant) -> String:
	if value is Array:
		var items: Array[String] = []
		for item in value:
			items.append(str(item))
		return ", ".join(items)
	if value is Dictionary:
		return JSON.stringify(value)
	return str(value)


static func _tr(it: String, en: String) -> String:
	return en if UIStrings.lang == "en" else it


func _save_state() -> void:
	# Anche il selftest del tour salva preferenze e nome: mai sporcare il
	# config reale della macchina di sviluppo.
	if OS.get_environment("JHT_GUIDED_TEST") == "1" \
			or OS.get_environment("JHT_TOUR_TEST") == "1":
		return
	var cfg := ConfigFile.new()
	cfg.set_value("guided", "steps", JSON.stringify(_steps))
	cfg.set_value("guided", "history", JSON.stringify(_history))
	cfg.set_value("guided", "draft", JSON.stringify(_draft))
	cfg.set_value("guided", "preferences", JSON.stringify(_preferences))
	cfg.set_value("guided", "answers", JSON.stringify(_answers))
	cfg.set_value("guided", "completed", JSON.stringify(_completed))
	cfg.set_value("guided", "reconciled", JSON.stringify(_reconciled))
	cfg.set_value("guided", "provider", _provider_choice)
	var err := cfg.save(SAVE_PATH)
	if err != OK:
		push_warning("Impossibile salvare onboarding: %s" % error_string(err))
	_export_context()


func _export_context() -> void:
	var json_file := FileAccess.open(CONTEXT_JSON_PATH, FileAccess.WRITE)
	if json_file:
		json_file.store_string(JSON.stringify(llm_context(), "  "))
		json_file.close()
	else:
		push_warning("Impossibile esportare " + CONTEXT_JSON_PATH)
	var md_file := FileAccess.open(CONTEXT_MARKDOWN_PATH, FileAccess.WRITE)
	if md_file:
		md_file.store_string(llm_context_text() + "\n")
		md_file.close()
	else:
		push_warning("Impossibile esportare " + CONTEXT_MARKDOWN_PATH)


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
	var loaded_answers: Variant = JSON.parse_string(str(cfg.get_value("guided", "answers", "[]")))
	_answers = loaded_answers if loaded_answers is Array else []
	_completed = _json_dict(str(cfg.get_value("guided", "completed", "{}")), {})
	_reconciled = _json_dict(str(cfg.get_value("guided", "reconciled", "{}")), {})
	_provider_choice = str(cfg.get_value("guided", "provider", ""))


static func _json_dict(raw: String, fallback: Dictionary) -> Dictionary:
	var parsed: Variant = JSON.parse_string(raw)
	return parsed if parsed is Dictionary else fallback
