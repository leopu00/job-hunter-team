extends Node
## Autoload TourGuide: il tour guidato del primo avvio. L'Assistente
## ACCOMPAGNA fisicamente l'utente di tappa in tappa (feedback Leone 21/07):
## saluta, cammina, presenta lei i reparti; il Mentor e il Coordinatore
## parlano in prima persona e il finale apre la configurazione scelta.
## Qui vive solo lo STATO (persistito in user://tour.cfg) e la partitura
## delle tappe; la regia (camminate, camera, dialoghi) sta in office.gd.

signal changed
signal tour_finished

const SAVE_PATH := "user://tour.cfg"

## Ordine delle tappe: la guida, la pipeline nell'ordine dei documenti,
## il Dottore al volo, la chiacchierata col Mentor e il Coordinatore che
## chiude aprendo il setup. Gli slug combaciano con ruoli e reparti.
const TALK_STEPS := [
	"assistente", "scout", "analista", "scorer", "scrittore", "critico",
	"dottore", "mentor", "coordinatore",
]

## Tappe in cui l'Assistente invita fisicamente un collega ad alzarsi e a
## presentare il proprio lavoro. Mentor e Coordinatore restano invece nelle
## loro aree: sono incontri personali, non presentazioni di reparto.
const PRESENTED_STOPS := [
	"scout", "analista", "scorer", "scrittore", "critico", "dottore",
]

## Partitura per tappa: albero di dialogo, ritratto/nome di chi parla,
## battuta della guida all'arrivo e risposta dell'ospite (fumetti in scena).
## L'Assistente introduce la tappa in scena; il dialogo lungo appartiene al
## collega del reparto, con il suo nome e il suo ritratto.
## I fallback sono inglesi: a schermo arriva normalmente quello che restituisce
## scene_for(), tradotto nelle 7 lingue, ma un buco non deve contaminare i video.
const SCENES := {
	"assistente": {"tree": "tour_benvenuto", "portrait": "assistente",
		"name": "The Assistant"},
	"scout": {"tree": "tour_scout", "portrait": "scout",
		"name": "The Researcher",
		"greet": "This is Research. Meet one of our Researchers.",
		"reply": "Nice to meet you. I'll show you how we look for opportunities that suit you."},
	"analista": {"tree": "tour_analisti", "portrait": "analista",
		"name": "The Analyst",
		"greet": "This is Analysis. One of our Analysts will show you what happens here.",
		"reply": "Welcome. We turn cluttered listings into clear information."},
	"scorer": {"tree": "tour_scorer", "portrait": "scorer",
		"name": "The Consultant",
		"greet": "This is Compatibility. Meet one of our Consultants.",
		"reply": "Nice to meet you. Here, we work out which opportunities could truly fit you."},
	"scrittore": {"tree": "tour_scrittori", "portrait": "scrittore",
		"name": "The Writer",
		"greet": "This is Applications. I'll hand you over to one of our Writers.",
		"reply": "Welcome. I'll show you how we tailor each application."},
	"critico": {"tree": "tour_critici", "portrait": "critico",
		"name": "The Reviewer",
		"greet": "This is Quality Check. One of our Reviewers will tell you about their work.",
		"reply": "Nice to meet you. Our job is to catch weak applications before they reach you."},
	"dottore": {"tree": "tour_dottore", "portrait": "dottore",
		"name": "The Doctor",
		"greet": "Before our last two stops, meet the office Doctor.",
		"reply": "Welcome. I help the team keep working well."},
	"mentor": {"tree": "tour_mentor", "portrait": "mentor",
		"name": "The Mentor",
		"greet": "And now I'll leave you in very good hands. I'll be at my desk.",
		"reply": "Come in. I've been expecting you."},
	"coordinatore": {"tree": "tour_coordinatore", "portrait": "coordinatore",
		"name": "The Coordinator",
		"greet": "Final stop: the operations room.",
		"reply": "I've been expecting you."},
}

func requires_staged_colleague(slug: String) -> bool:
	return slug in PRESENTED_STOPS

## Giro libero: si parla direttamente con l'agente del reparto, in prima
## persona. Il ritratto è quello del ruolo quando esiste (per gli altri il
## riquadro si nasconde con eleganza — gap d'arte tracciato in gen-art/LOG.md).
const FREE_SCENES := {
	"scout": {"tree": "self_scout", "portrait": "scout", "name": "The Researcher"},
	"analista": {"tree": "self_analisti", "portrait": "analista",
		"name": "The Analyst"},
	"scorer": {"tree": "self_scorer", "portrait": "scorer", "name": "The Consultant"},
	"scrittore": {"tree": "self_scrittori", "portrait": "scrittore",
		"name": "The Writer"},
	"critico": {"tree": "self_critici", "portrait": "critico", "name": "The Reviewer"},
	"dottore": {"tree": "self_dottore", "portrait": "dottore", "name": "The Doctor"},
	"mentor": {"tree": "tour_mentor", "portrait": "mentor", "name": "The Mentor"},
	"coordinatore": {"tree": "tour_coordinatore", "portrait": "coordinatore",
		"name": "The Coordinator"},
}

var _index := 0
var _done := false
var _test_mode := false
## "guided" = l'Assistente accompagna tappa per tappa; "free" = l'utente
## gira da solo, in qualsiasi ordine, e parla DIRETTAMENTE con gli agenti
## (scelta fatta nel dialogo di benvenuto — richiesta Leone 22/07).
var _mode := "guided"
var _visited := {}

func _ready() -> void:
	if not WindowsInstanceGuard.normal_work_allowed():
		return
	if not await Game.windows_health_boot_allowed():
		return
	Game.mark_windows_health_normal_work("tour")
	# TEST-AUTO: JHT_TOUR_TEST=1 (selftest) e JHT_TOUR_PREVIEW=1 (shot)
	# partono sempre da zero e non toccano il salvataggio dell'utente.
	_test_mode = OS.get_environment("JHT_TOUR_TEST") == "1" \
			or OS.get_environment("JHT_TOUR_PREVIEW") == "1"
	if _test_mode:
		return
	TutorialHarness.reset_file_if_requested(_state_path())
	var cfg := ConfigFile.new()
	if cfg.load(_state_path()) == OK:
		_index = clampi(int(cfg.get_value("tour", "index", 0)), 0, TALK_STEPS.size())
		_done = bool(cfg.get_value("tour", "done", false))
		_mode = str(cfg.get_value("tour", "mode", "guided"))
		var saved: Variant = cfg.get_value("tour", "visited", [])
		if saved is Array:
			for slug in saved:
				_visited[str(slug)] = true
	# Migrazione O-14: fra 0.3.7 e questa versione l'interruzione salvava sia
	# `guided.dismissed=true` sia `tour.done=true`. Quella combinazione non può
	# essere un completamento reale (a tour finito il comando spariva): riapre
	# quindi il progresso esistente, senza azzerare indice, modalità o visite.
	if _done and ScriptedOnboarding.is_dismissed():
		_done = false
		_save()
		Log.info("tour", "interruzione O-14 migrata a tour riprendibile")

func active() -> bool:
	return not _done and not ScriptedOnboarding.is_dismissed()

## Il giro ha ancora progresso da completare, anche quando è in pausa.
func incomplete() -> bool:
	return not _done

## Materializza anche il passo zero quando il giro viene interrotto: i default
## saprebbero ricostruirlo, ma la prova su file deve contenere la verità.
func checkpoint() -> void:
	_save()

func mode() -> String:
	return _mode

## Giro libero scelto nel benvenuto: da qui in poi ogni tappa è cliccabile
## in qualsiasi ordine e parla l'agente, non l'Assistente.
func set_free_mode() -> void:
	if _mode == "free":
		return
	_mode = "free"
	Log.info("tour", "modalità giro libero scelta dall'utente")
	_save()
	changed.emit()

## Tappe ancora da visitare (dopo il benvenuto). In guidato è solo la
## corrente; in libero tutte quelle non ancora fatte.
func pending_stops() -> Array:
	if _done or _index == 0:
		return []
	if _mode != "free":
		var current := current_slug()
		return [] if current == "" or current == "assistente" else [current]
	var out: Array = []
	for slug in TALK_STEPS:
		if slug != "assistente" and not _visited.has(slug):
			out.append(slug)
	return out

func visited(slug: String) -> bool:
	if slug == "assistente":
		return _index >= 1
	if _mode == "free":
		return _visited.has(slug)
	return TALK_STEPS.find(slug) < _index

## La tappa può aprirsi adesso? (bersaglio corrente in guidato;
## qualsiasi pendente in giro libero, dopo il benvenuto)
func stop_open(slug: String) -> bool:
	if _done or _index == 0 or in_launch_phase():
		return false
	if _mode == "free":
		return slug != "assistente" and TALK_STEPS.has(slug) \
				and not _visited.has(slug)
	return slug == current_slug()

## Fase finale: gli incontri sono completi, resta la checklist di lancio.
func in_launch_phase() -> bool:
	if _done:
		return false
	if _mode == "free":
		return _index >= 1 and pending_stops().is_empty()
	return _index >= TALK_STEPS.size()

## Slug del bersaglio corrente ("" in fase di lancio, a tour concluso o
## in giro libero, dove non esiste un bersaglio unico).
func current_slug() -> String:
	if _done or in_launch_phase():
		return ""
	if _mode == "free":
		return "assistente" if _index == 0 else ""
	return TALK_STEPS[_index]

func step_index() -> int:
	return _index

## Quanti dei 5 reparti pipeline sono già stati visitati (per il tracker).
func depts_visited() -> int:
	if _mode == "free":
		var count := 0
		for slug in ["scout", "analista", "scorer", "scrittore", "critico"]:
			if _visited.has(slug):
				count += 1
		return count
	return clampi(_index - 1, 0, 5)

## Stato di una riga del tracker ("assistente" | "depts" | "dottore" |
## "mentor" | "coordinatore"): il tracker resta una vista pura.
func row_state(row: String) -> String:
	if _mode != "free":
		var idx := _index
		match row:
			"assistente": return _range_state(idx, 0, 0)
			"depts": return _range_state(idx, 1, 5)
			"dottore": return _range_state(idx, 6, 6)
			"mentor": return _range_state(idx, 7, 7)
			_: return _range_state(idx, 8, 8)
	if _index == 0:
		return "current" if row == "assistente" else "todo"
	match row:
		"assistente": return "done"
		"depts": return "done" if depts_visited() == 5 else "current"
		_: return "done" if _visited.has(row) else "current"

static func _range_state(idx: int, first: int, last: int) -> String:
	if idx > last:
		return "done"
	if idx >= first:
		return "current"
	return "todo"

## Partitura della tappa (o di uno slug esplicito). In giro libero parla
## l'agente in prima persona: albero self_*, ritratto e nome del ruolo.
##
## Il nome esce di qui già nella lingua dell'interfaccia: nelle costanti resta
## l'inglese di fallback (una const non può chiamare t()), è
## CharacterDefs.role_name a cercarlo nei dizionari. Così la targa del dialogo
## e la colonna delle chat dicono la stessa cosa nella stessa lingua.
func scene_for(slug: String) -> Dictionary:
	var scene: Dictionary = SCENES.get(slug, {})
	if _mode == "free" and FREE_SCENES.has(slug):
		scene = FREE_SCENES[slug]
	if scene.is_empty():
		return scene
	var localized := scene.duplicate(true)
	localized["name"] = CharacterDefs.role_name(slug)
	# Le battute in scena appartengono al tour, non alla targa del ruolo:
	# la const conserva l'inglese come ripiego se un dizionario è incompleto.
	for line in ["greet", "reply"]:
		if localized.has(line):
			var key := "tour.guide.%s.%s" % [slug, line]
			var translated := UIStrings.t(key)
			if translated != key:
				localized[line] = translated
	return localized

## Invito iniziale sopra l'Assistente: saluto legato all'orario reale
## (e al nome, se l'utente l'ha già lasciato all'ingresso).
func invite_line() -> String:
	return UIStrings.t("tour.invite") % [
		Dialogues.greeting(), ScriptedOnboarding.player_suffix()]

## Un dialogo-tappa si è concluso. In guidato avanza solo il bersaglio
## corrente; in libero qualsiasi tappa pendente. Accetta slug o uid
## backend ("scout-2" → "scout").
func notify_talked(slug_or_uid: String) -> void:
	if _done or in_launch_phase():
		return
	var slug := ScriptedOnboarding.normalize_agent(slug_or_uid)
	if _mode == "free" and _index >= 1:
		if slug == "assistente" or _visited.has(slug) \
				or TALK_STEPS.find(slug) < 0:
			return
		_visited[slug] = true
		_save()
		changed.emit()
		return
	if slug != current_slug():
		return
	_index += 1
	_save()
	changed.emit()

## In fase di lancio il tour si chiude quando la checklist è verde (o il
## team è già partito): la to-do list ha esaurito il suo compito. In giro
## libero basta il setup completo: le presentazioni non sono un obbligo.
func notify_setup_status(status: Dictionary) -> void:
	if _done:
		return
	if not (bool(status.get("ready", false)) \
			or bool(status.get("team_running", false))):
		return
	if in_launch_phase() or (_mode == "free" and _index >= 1):
		finish()

func finish() -> void:
	if _done:
		return
	_done = true
	_save()
	changed.emit()
	tour_finished.emit()

## Pausa del tour chiesta dall'utente. Passa da ScriptedOnboarding perché
## interrompere solo la regia non basta: le chat guidate resterebbero vive.
## Non chiude il progresso; `resume()` riapre questo stesso stato.
func skip() -> void:
	Log.info("tour", "tour interrotto dall'utente al passo %d" % _index)
	ScriptedOnboarding.dismiss()

func reset_for_test() -> void:
	_index = 0
	_done = false
	_mode = "guided"
	_visited = {}

func _save() -> void:
	if _test_mode:
		return
	var cfg := ConfigFile.new()
	cfg.set_value("tour", "index", _index)
	cfg.set_value("tour", "done", _done)
	cfg.set_value("tour", "mode", _mode)
	cfg.set_value("tour", "visited", _visited.keys())
	cfg.save(_state_path())


func _state_path() -> String:
	return TutorialHarness.TOUR_CFG if TutorialHarness.enabled() else SAVE_PATH
