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
	TutorialHarness.reset_file_if_requested(_state_path())
	TutorialHarness.reset_file_if_requested(context_json_path())
	TutorialHarness.reset_file_if_requested(context_markdown_path())
	_load_state()
	for agent in AGENTS:
		_ensure_started(agent)
	# Gli step del Coordinatore sono riconciliati sullo STATO reale, non
	# innescati dagli eventi: chi arriva con provider o container già pronti
	# (reinstallazione, Claude Code installato prima del gioco) li trova
	# marcati come fatti invece di restare bloccato su un passo impossibile.
	if not TutorialHarness.enabled():
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
			_reply("coordinatore", UIStrings.t("onb.skip.runtime"))
		"provider":
			_reply("coordinatore", UIStrings.t("onb.skip.provider"))


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
	TutorialHarness.mark("NAME_SAVED", {"synthetic": true})


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
	var path := TutorialHarness.CONTEXT_JSON if TutorialHarness.enabled() else CONTEXT_JSON_PATH
	return ProjectSettings.globalize_path(path)


func context_markdown_path() -> String:
	var path := TutorialHarness.CONTEXT_MARKDOWN if TutorialHarness.enabled() else CONTEXT_MARKDOWN_PATH
	return ProjectSettings.globalize_path(path)


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
	if TutorialHarness.enabled():
		return false
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
			return UIStrings.t("onb.opening.assistente")
		"coordinatore":
			return UIStrings.t("onb.opening.coordinatore")
		_:
			return UIStrings.t("onb.opening.mentor")


func _assistant_options(step: String) -> Array:
	match step:
		"intro": return _opts([
			["start", UIStrings.t("onb.a.intro.start")],
			["profile", UIStrings.t("onb.a.intro.profile")],
			["later", UIStrings.t("onb.a.intro.later")],
		])
		"role": return _opts([
			["software", UIStrings.t("onb.a.role.software")],
			["data", UIStrings.t("onb.a.role.data")],
			["product", UIStrings.t("onb.a.role.product")],
			["design", UIStrings.t("onb.a.role.design")],
			["business", UIStrings.t("onb.a.role.business")],
			["security", UIStrings.t("onb.a.role.security")],
			["other", UIStrings.t("onb.a.role.other")],
		])
		"specialty": return _assistant_specialty_options()
		"current_status": return _opts([
			["employed", UIStrings.t("onb.a.status.employed")],
			["active", UIStrings.t("onb.a.status.active")],
			["available", UIStrings.t("onb.a.status.available")],
			["graduate", UIStrings.t("onb.a.status.graduate")],
			["freelance", UIStrings.t("onb.a.status.freelance")],
			["returning", UIStrings.t("onb.a.status.returning")],
		])
		"experience": return _opts([
			["entry", UIStrings.t("onb.a.exp.entry")],
			["junior", UIStrings.t("onb.a.exp.junior")],
			["mid", UIStrings.t("onb.a.exp.mid")],
			["senior", UIStrings.t("onb.a.exp.senior")],
			["lead", UIStrings.t("onb.a.exp.lead")],
			["career", UIStrings.t("onb.a.exp.career")],
		])
		"confidence": return _opts([
			["exact", UIStrings.t("onb.a.conf.exact")],
			["adjacent", UIStrings.t("onb.a.conf.adjacent")],
			["stretch", UIStrings.t("onb.a.conf.stretch")],
			["retrain", UIStrings.t("onb.a.conf.retrain")],
			["discover", UIStrings.t("onb.a.conf.discover")],
		])
		"mode": return _opts([
			["remote", UIStrings.t("onb.a.mode.remote")],
			["remote_first", UIStrings.t("onb.a.mode.remote_first")],
			["hybrid", UIStrings.t("onb.a.mode.hybrid")],
			["onsite", UIStrings.t("onb.a.mode.onsite")],
			["flexible", UIStrings.t("onb.a.mode.flexible")],
		])
		"where": return _opts([
			["local", UIStrings.t("onb.a.where.local")],
			["italy", UIStrings.t("onb.a.where.italy")],
			["eu", UIStrings.t("onb.a.where.eu")],
			["europe", UIStrings.t("onb.a.where.europe")],
			["worldwide", UIStrings.t("onb.a.where.worldwide")],
			["remote_only", UIStrings.t("onb.a.where.remote_only")],
		])
		"relocation": return _opts([
			["never", UIStrings.t("onb.a.reloc.never")],
			["same_country", UIStrings.t("onb.a.reloc.same_country")],
			["eu", UIStrings.t("onb.a.reloc.eu")],
			["worldwide", UIStrings.t("onb.a.reloc.worldwide")],
			["sponsored", UIStrings.t("onb.a.reloc.sponsored")],
			["depends", UIStrings.t("onb.a.reloc.depends")],
		])
		"contract": return _opts([
			["employee", UIStrings.t("onb.a.contract.employee")],
			["permanent", UIStrings.t("onb.a.contract.permanent")],
			["contractor", UIStrings.t("onb.a.contract.contractor")],
			["freelance", UIStrings.t("onb.a.contract.freelance")],
			["internship", UIStrings.t("onb.a.contract.internship")],
			["any", UIStrings.t("onb.a.contract.any")],
		])
		"salary": return _opts([
			["hard_floor", UIStrings.t("onb.a.salary.hard_floor")],
			["improve", UIStrings.t("onb.a.salary.improve")],
			["market", UIStrings.t("onb.a.salary.market")],
			["equity", UIStrings.t("onb.a.salary.equity")],
			["secondary", UIStrings.t("onb.a.salary.secondary")],
			["unknown", UIStrings.t("onb.a.salary.unknown")],
		])
		"company": return _opts([
			["startup", UIStrings.t("onb.a.company.startup")],
			["scaleup", UIStrings.t("onb.a.company.scaleup")],
			["established", UIStrings.t("onb.a.company.established")],
			["enterprise", UIStrings.t("onb.a.company.enterprise")],
			["public", UIStrings.t("onb.a.company.public")],
			["any", UIStrings.t("onb.a.company.any")],
		])
		"finish": return _opts([
			["complete_profile", UIStrings.t("onb.a.finish.complete_profile")],
			["coordinator", UIStrings.t("onb.a.finish.coordinator")],
			["mentor", UIStrings.t("onb.a.finish.mentor")],
		])
	return []


func _assistant_specialty_options() -> Array:
	match str(_draft.get("target_role", "")):
		"Software Engineering": return _opts([
			["backend", UIStrings.t("onb.a.spec.sw.backend")],
			["frontend", UIStrings.t("onb.a.spec.sw.frontend")],
			["fullstack", UIStrings.t("onb.a.spec.sw.fullstack")],
			["platform", UIStrings.t("onb.a.spec.sw.platform")],
			["embedded", UIStrings.t("onb.a.spec.sw.embedded")],
			["open", UIStrings.t("onb.a.spec.sw.open")],
		])
		"Data / AI": return _opts([
			["data_science", UIStrings.t("onb.a.spec.data.data_science")],
			["ml", UIStrings.t("onb.a.spec.data.ml")],
			["genai", UIStrings.t("onb.a.spec.data.genai")],
			["data_engineering", UIStrings.t("onb.a.spec.data.data_engineering")],
			["research", UIStrings.t("onb.a.spec.data.research")],
			["open", UIStrings.t("onb.a.spec.data.open")],
		])
		"Product / Project Management": return _opts([
			["product", UIStrings.t("onb.a.spec.pm.product")],
			["project", UIStrings.t("onb.a.spec.pm.project")],
			["technical_pm", UIStrings.t("onb.a.spec.pm.technical_pm")],
			["delivery", UIStrings.t("onb.a.spec.pm.delivery")],
			["founder", UIStrings.t("onb.a.spec.pm.founder")],
		])
	return _opts([
		["specialist", UIStrings.t("onb.a.spec.gen.specialist")],
		["generalist", UIStrings.t("onb.a.spec.gen.generalist")],
		["leadership", UIStrings.t("onb.a.spec.gen.leadership")],
		["individual", UIStrings.t("onb.a.spec.gen.individual")],
		["explore", UIStrings.t("onb.a.spec.gen.explore")],
	])


func _choose_assistant(id: String) -> void:
	match str(_steps["assistente"]):
		"intro":
			if id == "profile":
				_reply("assistente", UIStrings.t("onb.a.intro.reply_profile"))
				action_requested.emit("open_section", {"section": "profile"})
				_steps["assistente"] = "finish"
			elif id == "later":
				_reply("assistente", UIStrings.t("onb.a.intro.reply_later"))
			else:
				_reply("assistente", UIStrings.t("onb.a.intro.reply_start"))
				_steps["assistente"] = "role"
		"role":
			var roles := {"software": "Software Engineering", "data": "Data / AI",
					"product": "Product / Project Management", "design": "Design / UX",
					"business": "Business / Operations", "security": "Security / Infrastructure",
					"other": "Da definire / multidisciplinare"}
			_draft["target_role"] = roles.get(id, "Da definire")
			_reply("assistente", UIStrings.t("onb.a.role.reply"))
			_steps["assistente"] = "specialty"
		"specialty":
			_preferences["target_specialty"] = id
			_reply("assistente", UIStrings.t("onb.a.specialty.reply"))
			_steps["assistente"] = "experience"
		"experience":
			var exp := {"entry": ["0", "entry"], "junior": ["1", "junior"],
					"mid": ["3", "mid"], "senior": ["7", "senior"],
					"lead": ["12", "lead"], "career": ["0", "career-change"]}
			_draft["experience_years"] = exp[id][0]
			_draft["seniority_target"] = exp[id][1]
			_reply("assistente", UIStrings.t("onb.a.exp.reply"))
			_steps["assistente"] = "current_status"
		"current_status":
			_preferences["current_status"] = id
			_reply("assistente", UIStrings.t("onb.a.status.reply"))
			_steps["assistente"] = "confidence"
		"confidence":
			_preferences["skills_stretch"] = id
			_reply("assistente", UIStrings.t("onb.a.conf.reply"))
			_steps["assistente"] = "mode"
		"mode":
			_preferences["work_mode"] = id
			_reply("assistente", UIStrings.t("onb.a.mode.reply"))
			_steps["assistente"] = "where"
		"where":
			var places := {"local": "Vicino alla residenza", "italy": "Italia",
					"eu": "Unione Europea / SEE", "europe": "Europa",
					"worldwide": "Worldwide", "remote_only": "Remote"}
			_draft["location"] = places.get(id, "")
			_reply("assistente", UIStrings.t("onb.a.where.reply"))
			_steps["assistente"] = "relocation"
		"relocation":
			_preferences["relocation"] = id
			_preferences["requires_sponsorship"] = id == "sponsored"
			_reply("assistente", UIStrings.t("onb.a.reloc.reply"))
			_steps["assistente"] = "contract"
		"contract":
			_preferences["contract_preference"] = id
			_reply("assistente", UIStrings.t("onb.a.contract.reply"))
			_steps["assistente"] = "salary"
		"salary":
			_preferences["compensation_strategy"] = id
			_reply("assistente", UIStrings.t("onb.a.salary.reply"))
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
			_reply("assistente", UIStrings.t("onb.a.finish.reply"))


func _coordinator_options(step: String) -> Array:
	match step:
		"intro": return _opts([
			["local", UIStrings.t("onb.c.intro.local")],
			["vps", UIStrings.t("onb.c.intro.vps")],
			["explain", UIStrings.t("onb.c.intro.explain")],
		])
		"runtime": return _opts([
			["start", UIStrings.t("onb.c.runtime.start")],
			["repair", UIStrings.t("onb.c.runtime.repair")],
			["ready", UIStrings.t("onb.c.runtime.ready")],
		])
		"provider": return _opts([
			["codex", UIStrings.t("onb.c.provider.codex")],
			["claude", UIStrings.t("onb.c.provider.claude")],
			["kimi", UIStrings.t("onb.c.provider.kimi")],
			["compare", UIStrings.t("onb.c.provider.compare")],
		])
		"login": return _opts([
			["login", UIStrings.t("onb.c.login.login")],
			["different", UIStrings.t("onb.c.login.different")],
			["check", UIStrings.t("onb.c.login.check")],
		])
		"profile": return _opts([
			["open_profile", UIStrings.t("onb.c.profile.open_profile")],
			["already", UIStrings.t("onb.c.profile.already")],
		])
		"autonomy": return _opts([
			["review_all", UIStrings.t("onb.c.autonomy.review_all")],
			["review_cv", UIStrings.t("onb.c.autonomy.review_cv")],
			["high_score", UIStrings.t("onb.c.autonomy.high_score")],
			["autonomous", UIStrings.t("onb.c.autonomy.autonomous")],
			["observe", UIStrings.t("onb.c.autonomy.observe")],
		])
		"budget": return _opts([
			["minimal", UIStrings.t("onb.c.budget.minimal")],
			["careful", UIStrings.t("onb.c.budget.careful")],
			["balanced", UIStrings.t("onb.c.budget.balanced")],
			["quality", UIStrings.t("onb.c.budget.quality")],
			["unrestricted", UIStrings.t("onb.c.budget.unrestricted")],
		])
		"privacy": return _opts([
			["strict", UIStrings.t("onb.c.privacy.strict")],
			["cv_only", UIStrings.t("onb.c.privacy.cv_only")],
			["contextual", UIStrings.t("onb.c.privacy.contextual")],
			["ask_sensitive", UIStrings.t("onb.c.privacy.ask_sensitive")],
			["standard", UIStrings.t("onb.c.privacy.standard")],
		])
		"availability": return _opts([
			["office", UIStrings.t("onb.c.availability.office")],
			["evenings", UIStrings.t("onb.c.availability.evenings")],
			["always", UIStrings.t("onb.c.availability.always")],
			["manual", UIStrings.t("onb.c.availability.manual")],
			["custom", UIStrings.t("onb.c.availability.custom")],
		])
		"channels": return _opts([
			["telegram", UIStrings.t("onb.c.channels.telegram")],
			["email", UIStrings.t("onb.c.channels.email")],
			["cloud", UIStrings.t("onb.c.channels.cloud")],
			["skip_channels", UIStrings.t("onb.c.channels.skip_channels")],
		])
		"team": return _opts([
			["start_team", UIStrings.t("onb.c.team.start_team")],
			["overview", UIStrings.t("onb.c.team.overview")],
			["mentor", UIStrings.t("onb.c.team.mentor")],
			["review", UIStrings.t("onb.c.team.review")],
		])
	return []


func _choose_coordinator(id: String) -> void:
	match str(_steps["coordinatore"]):
		"intro":
			if id == "explain":
				_reply("coordinatore", UIStrings.t("onb.c.intro.reply_explain"))
			else:
				_preferences["runtime_location"] = id
				if id == "vps":
					_reply("coordinatore", UIStrings.t("onb.c.intro.reply_vps"))
					action_requested.emit("open_section", {"section": "vps"})
				else:
					_reply("coordinatore", UIStrings.t("onb.c.intro.reply_local"))
				_steps["coordinatore"] = "runtime"
		"runtime":
			if id == "start":
				SetupService.start_container()
				_reply("coordinatore", UIStrings.t("onb.c.runtime.reply_start"))
			elif id == "repair":
				SetupService.open_runtime_install()
				_reply("coordinatore", UIStrings.t("onb.c.runtime.reply_repair"))
			else:
				SetupService.refresh()
				_reply("coordinatore", UIStrings.t("onb.c.runtime.reply_ready"))
			_steps["coordinatore"] = "provider"
		"provider":
			if id == "compare":
				_reply("coordinatore", UIStrings.t("onb.c.provider.reply_compare"))
			else:
				_provider_choice = id
				if OS.get_environment("JHT_GUIDED_TEST") != "1":
					SetupService.select_provider(id)
				_reply("coordinatore", UIStrings.t("onb.c.provider.reply_chosen"))
				_steps["coordinatore"] = "login"
		"login":
			if id == "different":
				_steps["coordinatore"] = "provider"
				_reply("coordinatore", UIStrings.t("onb.c.login.reply_different"))
			elif id == "login":
				if not bool(SetupService.status.get("container_running", false)):
					_reply("coordinatore", UIStrings.t("onb.c.login.reply_no_container"))
					action_requested.emit("open_section", {"section": "docker"})
				elif _provider_choice != "":
					SetupService.open_provider_login(_provider_choice)
					_reply("coordinatore", UIStrings.t("onb.c.login.reply_opened"))
			elif id == "check":
				SetupService.refresh()
				_reply("coordinatore", UIStrings.t("onb.c.login.reply_check"))
				_steps["coordinatore"] = "profile"
			else:
				_steps["coordinatore"] = "provider"
		"profile":
			if id == "open_profile":
				action_requested.emit("open_section", {"section": "profile"})
			_reply("coordinatore", UIStrings.t("onb.c.profile.reply"))
			_steps["coordinatore"] = "autonomy"
		"autonomy":
			_preferences["approval_mode"] = id
			_reply("coordinatore", UIStrings.t("onb.c.autonomy.reply"))
			_steps["coordinatore"] = "budget"
		"budget":
			_preferences["token_budget_style"] = id
			_reply("coordinatore", UIStrings.t("onb.c.budget.reply"))
			_steps["coordinatore"] = "privacy"
		"privacy":
			_preferences["privacy_mode"] = id
			_reply("coordinatore", UIStrings.t("onb.c.privacy.reply"))
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
				_reply("coordinatore", UIStrings.t("onb.c.channels.reply_skip"))
			else:
				var sections := {"telegram": "telegram", "email": "email", "cloud": "account"}
				action_requested.emit("open_section", {"section": sections.get(id, "activation")})
				_reply("coordinatore", UIStrings.t("onb.c.channels.reply_open"))
		"team":
			if id == "start_team":
				if bool(SetupService.status.get("ready", false)):
					SetupService.start_team()
					_completed["coordinatore"] = true
					_reply("coordinatore", UIStrings.t("onb.c.team.reply_start"))
				else:
					_reply("coordinatore", UIStrings.t("onb.c.team.reply_missing"))
					action_requested.emit("open_section", {"section": "activation"})
			elif id == "overview":
				action_requested.emit("open_section", {"section": "activation"})
			elif id == "mentor":
				action_requested.emit("open_scripted_chat", {"agent": "mentor"})
			else:
				_steps["coordinatore"] = "autonomy"
				_reply("coordinatore", UIStrings.t("onb.c.team.reply_review"))


func _mentor_options(step: String) -> Array:
	match step:
		"intro": return _opts([
			["stability", UIStrings.t("onb.m.intro.stability")],
			["growth", UIStrings.t("onb.m.intro.growth")],
			["salary", UIStrings.t("onb.m.intro.salary")],
			["balance", UIStrings.t("onb.m.intro.balance")],
			["meaning", UIStrings.t("onb.m.intro.meaning")],
			["learning", UIStrings.t("onb.m.intro.learning")],
			["reentry", UIStrings.t("onb.m.intro.reentry")],
		])
		"motivation": return _opts([
			["escape", UIStrings.t("onb.m.motivation.escape")],
			["plateau", UIStrings.t("onb.m.motivation.plateau")],
			["layoff", UIStrings.t("onb.m.motivation.layoff")],
			["curious", UIStrings.t("onb.m.motivation.curious")],
			["life_change", UIStrings.t("onb.m.motivation.life_change")],
			["first_job", UIStrings.t("onb.m.motivation.first_job")],
		])
		"style": return _opts([
			["cautious", UIStrings.t("onb.m.style.cautious")],
			["balanced", UIStrings.t("onb.m.style.balanced")],
			["ambitious", UIStrings.t("onb.m.style.ambitious")],
			["volume", UIStrings.t("onb.m.style.volume")],
			["experimental", UIStrings.t("onb.m.style.experimental")],
		])
		"risk": return _opts([
			["very_low", UIStrings.t("onb.m.risk.very_low")],
			["low", UIStrings.t("onb.m.risk.low")],
			["medium", UIStrings.t("onb.m.risk.medium")],
			["high", UIStrings.t("onb.m.risk.high")],
			["adaptive", UIStrings.t("onb.m.risk.adaptive")],
		])
		"pace": return _opts([
			["gentle", UIStrings.t("onb.m.pace.gentle")],
			["steady", UIStrings.t("onb.m.pace.steady")],
			["intensive", UIStrings.t("onb.m.pace.intensive")],
			["urgent", UIStrings.t("onb.m.pace.urgent")],
			["adaptive", UIStrings.t("onb.m.pace.adaptive")],
		])
		"tone": return _opts([
			["gentle", UIStrings.t("onb.m.tone.gentle")],
			["direct", UIStrings.t("onb.m.tone.direct")],
			["analytical", UIStrings.t("onb.m.tone.analytical")],
			["challenging", UIStrings.t("onb.m.tone.challenging")],
			["brief", UIStrings.t("onb.m.tone.brief")],
		])
		"feedback": return _opts([
			["daily", UIStrings.t("onb.m.feedback.daily")],
			["twice_week", UIStrings.t("onb.m.feedback.twice_week")],
			["weekly", UIStrings.t("onb.m.feedback.weekly")],
			["milestones", UIStrings.t("onb.m.feedback.milestones")],
			["on_demand", UIStrings.t("onb.m.feedback.on_demand")],
		])
		"dealbreakers": return _opts([
			["culture", UIStrings.t("onb.m.dealbreakers.culture")],
			["hours", UIStrings.t("onb.m.dealbreakers.hours")],
			["commute", UIStrings.t("onb.m.dealbreakers.commute")],
			["instability", UIStrings.t("onb.m.dealbreakers.instability")],
			["ethics", UIStrings.t("onb.m.dealbreakers.ethics")],
			["none", UIStrings.t("onb.m.dealbreakers.none")],
		])
		"finish": return _opts([
			["done", UIStrings.t("onb.m.finish.done")],
			["hours", UIStrings.t("onb.m.finish.hours")],
			["restart", UIStrings.t("onb.m.finish.restart")],
			["assistant", UIStrings.t("onb.m.finish.assistant")],
		])
	return []


func _choose_mentor(id: String) -> void:
	match str(_steps["mentor"]):
		"intro":
			_preferences["career_priority"] = id
			_reply("mentor", UIStrings.t("onb.m.intro.reply"))
			_steps["mentor"] = "motivation"
		"motivation":
			_preferences["search_motivation"] = id
			_reply("mentor", UIStrings.t("onb.m.motivation.reply"))
			_steps["mentor"] = "style"
		"style":
			_preferences["search_style"] = id
			_reply("mentor", UIStrings.t("onb.m.style.reply"))
			_steps["mentor"] = "risk"
		"risk":
			_preferences["risk_tolerance"] = id
			_reply("mentor", UIStrings.t("onb.m.risk.reply"))
			_steps["mentor"] = "pace"
		"pace":
			_preferences["search_pace"] = id
			_reply("mentor", UIStrings.t("onb.m.pace.reply"))
			_steps["mentor"] = "tone"
		"tone":
			_preferences["feedback_tone"] = id
			_reply("mentor", UIStrings.t("onb.m.tone.reply"))
			_steps["mentor"] = "feedback"
		"feedback":
			_preferences["mentor_cadence"] = id
			_reply("mentor", UIStrings.t("onb.m.feedback.reply"))
			_steps["mentor"] = "dealbreakers"
		"dealbreakers":
			_preferences["primary_dealbreaker"] = id
			_reply("mentor", _mentor_finish_reply())
			_steps["mentor"] = "finish"
		"finish":
			if id == "hours":
				action_requested.emit("open_section", {"section": "hours"})
				_reply("mentor", UIStrings.t("onb.m.finish.reply_hours"))
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
				_reply("mentor", UIStrings.t("onb.m.finish.reply_done"))


func _reply(agent: String, text: String) -> void:
	_append(agent, "assistant", text)


func _assistant_finish_reply() -> String:
	var mode := str(_preferences.get("work_mode", "flexible"))
	var stretch := str(_preferences.get("skills_stretch", "adjacent"))
	var status := str(_preferences.get("current_status", "employed"))
	var parts: Array[String] = []
	if mode in ["remote", "remote_first"] and str(_preferences.get("relocation", "")) == "never":
		parts.append(UIStrings.t("onb.a.finish.part_remote"))
	elif bool(_preferences.get("requires_sponsorship", false)):
		parts.append(UIStrings.t("onb.a.finish.part_sponsor"))
	if stretch in ["stretch", "retrain"]:
		parts.append(UIStrings.t("onb.a.finish.part_stretch"))
	elif stretch == "exact":
		parts.append(UIStrings.t("onb.a.finish.part_exact"))
	if status in ["available", "active"]:
		parts.append(UIStrings.t("onb.a.finish.part_fast"))
	elif status == "employed":
		parts.append(UIStrings.t("onb.a.finish.part_quality"))
	var tailored := "; ".join(parts)
	if tailored.is_empty():
		tailored = UIStrings.t("onb.a.finish.part_default")
	return UIStrings.t("onb.a.finish.summary") % tailored


func _coordinator_policy_reply() -> String:
	var autonomy := str(_preferences.get("approval_mode", "review_all"))
	var budget := str(_preferences.get("token_budget_style", "balanced"))
	var privacy := str(_preferences.get("privacy_mode", "standard"))
	var summary := UIStrings.t("onb.c.policy.manual")
	if autonomy == "review_cv": summary = UIStrings.t("onb.c.policy.review_cv")
	elif autonomy == "high_score": summary = UIStrings.t("onb.c.policy.high_score")
	elif autonomy == "autonomous": summary = UIStrings.t("onb.c.policy.autonomous")
	elif autonomy == "observe": summary = UIStrings.t("onb.c.policy.observe")
	return UIStrings.t("onb.c.policy.summary") % [summary, budget, privacy]


func _mentor_finish_reply() -> String:
	var priority := str(_preferences.get("career_priority", "balance"))
	var style := str(_preferences.get("search_style", "balanced"))
	var risk := str(_preferences.get("risk_tolerance", "medium"))
	var pace := str(_preferences.get("search_pace", "steady"))
	return UIStrings.t("onb.m.finish.summary") % [priority, style, risk, pace,
			str(_preferences.get("primary_dealbreaker", "none"))]


func _append(agent: String, role: String, text: String) -> void:
	if not _history.has(agent):
		_history[agent] = []
	(_history[agent] as Array).append({
		"role": role, "text": text, "done": true,
		"ts": Time.get_unix_time_from_system(), "scripted": true,
	})


## Righe [id, etichetta]. L'etichetta arriva già tradotta dal dizionario nel
## punto in cui l'opzione è dichiarata: così il gate i18n, che cerca le chiamate
## a UIStrings nei sorgenti, vede anche le chiavi delle risposte guidate.
func _opts(rows: Array) -> Array:
	var out: Array = []
	for row in rows:
		out.append({"id": row[0], "label": str(row[1])})
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
	var err := cfg.save(_state_path())
	if err != OK:
		push_warning("Impossibile salvare onboarding: %s" % error_string(err))
	_export_context()


func _export_context() -> void:
	var json_path := TutorialHarness.CONTEXT_JSON if TutorialHarness.enabled() else CONTEXT_JSON_PATH
	var markdown_path := TutorialHarness.CONTEXT_MARKDOWN if TutorialHarness.enabled() else CONTEXT_MARKDOWN_PATH
	var json_file := FileAccess.open(json_path, FileAccess.WRITE)
	if json_file:
		json_file.store_string(JSON.stringify(llm_context(), "  "))
		json_file.close()
	else:
		push_warning("Impossibile esportare " + json_path)
	var md_file := FileAccess.open(markdown_path, FileAccess.WRITE)
	if md_file:
		md_file.store_string(llm_context_text() + "\n")
		md_file.close()
	else:
		push_warning("Impossibile esportare " + markdown_path)


func _load_state() -> void:
	if OS.get_environment("JHT_GUIDED_TEST") == "1":
		return
	var cfg := ConfigFile.new()
	if cfg.load(_state_path()) != OK:
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


func _state_path() -> String:
	return TutorialHarness.ONBOARDING_CFG if TutorialHarness.enabled() else SAVE_PATH


static func _json_dict(raw: String, fallback: Dictionary) -> Dictionary:
	var parsed: Variant = JSON.parse_string(raw)
	return parsed if parsed is Dictionary else fallback
