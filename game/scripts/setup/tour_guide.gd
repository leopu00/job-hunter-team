extends Node
## Autoload TourGuide: il tour guidato del primo avvio. È la spina dorsale
## dell'onboarding gamificato: una sequenza di incontri (Assistente → i 5
## reparti della pipeline → Coordinatore → Mentor) seguita dalla checklist
## di lancio (container, provider, profilo). Lo stato vive qui e persiste
## in user://tour.cfg; la UI (TourTracker) e l'ufficio si limitano a
## osservarlo. Il tour parte da solo al primo ingresso in ufficio e si può
## saltare in ogni momento: guida, non sequestra.

signal changed
signal tour_finished

const SAVE_PATH := "user://tour.cfg"

## Ordine degli incontri: la guida, poi la pipeline nell'ordine in cui i
## documenti la attraversano, poi i due ruoli con cui si decide (attivazione
## e preferenze). Gli slug combaciano con Dialogues.TREES e con i reparti.
const TALK_STEPS := [
	"assistente", "scout", "analista", "scorer", "scrittore", "critico",
	"coordinatore", "mentor",
]

## Battuta-invito mostrata come fumetto sopra il bersaglio corrente.
const INVITES := {
	"assistente": "Vieni, ti faccio fare il giro dell'ufficio!",
	"scout": "Passa da me: ti mostro come trovo le posizioni.",
	"analista": "Qui si verificano gli annunci. Vieni a vedere.",
	"scorer": "Ti spiego come nasce uno score da 0 a 100.",
	"scrittore": "Vieni: qui il CV diventa una risposta precisa.",
	"critico": "Io sono l'ultimo controllo. Vieni a conoscermi.",
	"coordinatore": "Passa in sala operativa: prepariamo il lancio.",
	"mentor": "Il salotto è di là. Due parole sulle tue priorità?",
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

func invite_line() -> String:
	return str(INVITES.get(current_slug(), ""))

## Un dialogo si è concluso: avanza solo se era il bersaglio corrente.
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
