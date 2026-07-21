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

## Partitura per tappa: albero di dialogo, ritratto/nome di chi parla,
## battuta della guida all'arrivo e risposta dell'ospite (fumetti in scena).
## I reparti li presenta l'Assistente: è lei il volto del tour (e i ruoli
## senza ritratto dipinto non lasciano mai il riquadro vuoto).
const SCENES := {
	"assistente": {"tree": "tour_benvenuto", "portrait": "assistente",
		"name": "L'Assistente"},
	"scout": {"tree": "tour_scout", "portrait": "assistente",
		"name": "L'Assistente",
		"greet": "Ciao ragazzi! Vi presento il capo.",
		"reply": "Benvenuto! Le board sono già calde."},
	"analista": {"tree": "tour_analisti", "portrait": "assistente",
		"name": "L'Assistente",
		"greet": "Permesso... porto un ospite di riguardo.",
		"reply": "Arrivi giusto: due dossier appena chiusi."},
	"scorer": {"tree": "tour_scorer", "portrait": "assistente",
		"name": "L'Assistente",
		"greet": "Ciao! Come vanno i numeri?",
		"reply": "Precisi come sempre. Benvenuto."},
	"scrittore": {"tree": "tour_scrittori", "portrait": "assistente",
		"name": "L'Assistente",
		"greet": "Salve, penne d'oro. C'è chi vi voleva conoscere.",
		"reply": "Un attimo... ecco. Benvenuto!"},
	"critico": {"tree": "tour_critici", "portrait": "assistente",
		"name": "L'Assistente",
		"greet": "Buongiorno anche a voi... loro non salutano.",
		"reply": "Refuso a riga tre. Di chi è questo CV?"},
	"dottore": {"tree": "tour_dottore", "portrait": "assistente",
		"name": "L'Assistente",
		"greet": "Dottore, un saluto veloce!",
		"reply": "Tutti i parametri in ordine. Benvenuto!"},
	"mentor": {"tree": "tour_mentor", "portrait": "mentor",
		"name": "Il Mentor",
		"greet": "E qui ti lascio in ottime mani. Io sono alla mia scrivania.",
		"reply": "Accomodati. Ti aspettavo."},
	"coordinatore": {"tree": "tour_coordinatore", "portrait": "coordinatore",
		"name": "Il Coordinatore",
		"greet": "Ultima tappa: la sala operativa.",
		"reply": "Vi stavo aspettando."},
}

var _index := 0
var _done := false
var _test_mode := false

func _ready() -> void:
	# TEST-AUTO: JHT_TOUR_TEST=1 (selftest) e JHT_TOUR_PREVIEW=1 (shot)
	# partono sempre da zero e non toccano il salvataggio dell'utente.
	_test_mode = OS.get_environment("JHT_TOUR_TEST") == "1" \
			or OS.get_environment("JHT_TOUR_PREVIEW") == "1"
	if _test_mode:
		return
	var cfg := ConfigFile.new()
	if cfg.load(SAVE_PATH) == OK:
		_index = clampi(int(cfg.get_value("tour", "index", 0)), 0, TALK_STEPS.size())
		_done = bool(cfg.get_value("tour", "done", false))

func active() -> bool:
	return not _done

## Fase finale: gli incontri sono completi, resta la checklist di lancio.
func in_launch_phase() -> bool:
	return not _done and _index >= TALK_STEPS.size()

## Slug del bersaglio corrente ("" in fase di lancio o a tour concluso).
func current_slug() -> String:
	if _done or _index >= TALK_STEPS.size():
		return ""
	return TALK_STEPS[_index]

func step_index() -> int:
	return _index

## Quanti dei 5 reparti pipeline sono già stati visitati (per il tracker).
func depts_visited() -> int:
	return clampi(_index - 1, 0, 5)

## Partitura della tappa corrente (o di uno slug esplicito).
func scene_for(slug: String) -> Dictionary:
	return SCENES.get(slug, {})

## Invito iniziale sopra l'Assistente: saluto legato all'orario reale.
func invite_line() -> String:
	return "%s! Vieni, ti presento il tuo nuovo team." % Dialogues.greeting()

## Un dialogo-tappa si è concluso: avanza solo se era il bersaglio corrente.
## Accetta sia slug che uid backend ("scout-2" → "scout").
func notify_talked(slug_or_uid: String) -> void:
	if _done or in_launch_phase():
		return
	if ScriptedOnboarding.normalize_agent(slug_or_uid) != current_slug():
		return
	_index += 1
	_save()
	changed.emit()

## In fase di lancio il tour si chiude quando la checklist è verde (o il
## team è già partito): la to-do list ha esaurito il suo compito.
func notify_setup_status(status: Dictionary) -> void:
	if _done or not in_launch_phase():
		return
	if bool(status.get("ready", false)) or bool(status.get("team_running", false)):
		finish()

func finish() -> void:
	if _done:
		return
	_done = true
	_save()
	changed.emit()
	tour_finished.emit()

func skip() -> void:
	Log.info("tour", "tour saltato dall'utente al passo %d" % _index)
	finish()

func reset_for_test() -> void:
	_index = 0
	_done = false

func _save() -> void:
	if _test_mode:
		return
	var cfg := ConfigFile.new()
	cfg.set_value("tour", "index", _index)
	cfg.set_value("tour", "done", _done)
	cfg.save(SAVE_PATH)
