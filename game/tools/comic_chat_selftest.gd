extends Node
## Self-test headless della pagina di chat a fumetti (ui/comic_chat.gd +
## ui/comic_bubble.gd), montata dal suo guscio vero (ui/chat_panel.gd) sopra
## il MockBackend. Si accende con `JHT_COMIC_CHAT_TEST=1` sulla scena
## ufficio; l'esito è l'EXIT CODE del processo, non solo la riga stampata.
##
## Cosa tiene fermo, e perché nessuna di queste cose si vede da un diff:
##
##  1. le vignette esistono e sono NELL'ORDINE della storia. La storia arriva
##     completa a ogni giro e la pagina si ridisegna da zero: basta un
##     append al posto di un rebuild per vedere doppioni o messaggi al
##     contrario, e a schermo sembra solo "una chat strana";
##  2. agente e utente si distinguono SENZA leggere. La vignetta dell'agente
##     è bianca con l'inchiostro nero — sempre, in dark e in light, perché è
##     una richiesta esplicita dell'utente — e ha la coda verso il ritratto
##     (destra); quella dell'utente ha un fondo diverso e la coda a sinistra.
##     Se un giorno qualcuno "uniforma i colori al tema" il fumetto smette di
##     essere un fumetto e nessun altro test se ne accorge;
##  3. il giro utente→canale→risposta passa DAVVERO dal BackendBus, con un
##     ruolo operativo (lo scout), che fino al 2026-07-28 non poteva
##     rispondere. È il test della feature, non del disegno;
##  4. lo scroll all'indietro non viene strappato. Chi sta rileggendo una
##     conversazione di ieri non deve essere riportato in fondo da un
##     messaggio che arriva mentre legge — e questo è esattamente ciò che
##     fa il "vai in fondo a ogni render" scritto senza pensarci.
##
## Regola di stanza (pagata da due rossi solo-Windows di questa settimana,
## idle_pace e headless_exit): si parte da `call_deferred`, mai dentro
## `_init`, e tutto quello che il test crea vive sotto il NOSTRO nodo — mai
## notifiche propagate da `root`, dove abitano gli autoload (fra cui Game,
## che su WM_CLOSE_REQUEST avvia lo spegnimento vero del container).

## Ruolo operativo: è il caso nuovo, e con un coordinatore il test sarebbe
## passato anche prima della feature.
const AGENT_UID := "scout-1"
const AGENT_NAME := "Scout Lead"

const HISTORY := [
	{"role": "assistant", "text": "Ho aperto tre board: sei posizioni nuove.", "done": true},
	{"role": "user", "text": "Quante sono remote?", "done": true},
	{"role": "assistant", "text": "Quattro su sei, tutte EU.", "done": true},
	{"role": "user", "text": "Bene, continua così.", "done": true},
]

var _fails: Array[String] = []
var _panel: ChatPanel = null


func _ready() -> void:
	call_deferred("_run")


func _run() -> void:
	BackendBus.set_backend(MockBackend.new())
	if not await _wait_for(func() -> bool: return BackendBus.can_chat_with(AGENT_UID), 12.0):
		_finish("il roster del mock non ha mai esposto " + AGENT_UID)
		return

	_panel = ChatPanel.new(AGENT_UID, AGENT_NAME, [
		{"slug": AGENT_UID, "name": AGENT_NAME},
		{"slug": "coordinatore-1", "name": "Coordinatore"},
	])
	add_child(_panel)
	await _frames(3)

	_check_reply_capable_contract()
	await _check_bubbles()
	await _check_live_exchange()
	await _check_scroll_back()

	_panel.close(false)
	await _frames(2)
	_finish("")


# ── 1+2. vignette: quante, in che ordine, di che colore, con che coda ──

func _check_bubbles() -> void:
	BackendBus.publish_agent_chat(AGENT_UID, HISTORY.duplicate(true))
	await _frames(3)
	var snap: Dictionary = _panel._view.debug_snapshot()
	var bubbles: Array = snap["bubbles"]
	_check(bubbles.size() == HISTORY.size(),
			"vignette attese %d, trovate %d" % [HISTORY.size(), bubbles.size()])
	if bubbles.size() != HISTORY.size():
		return
	for i in HISTORY.size():
		var want: Dictionary = HISTORY[i]
		var got: Dictionary = bubbles[i]
		_check(str(got["text"]) == str(want["text"]),
				"vignetta %d fuori ordine: «%s» invece di «%s»"
						% [i, got["text"], want["text"]])
		_check(bool(got["mine"]) == (str(want["role"]) == "user"),
				"vignetta %d attribuita alla persona sbagliata" % i)

	var agent_bubble: Dictionary = bubbles[0]
	var user_bubble: Dictionary = bubbles[1]
	_check(str(agent_bubble["bg"]) == "ffffff",
			"la vignetta dell'agente non è bianca: " + str(agent_bubble["bg"]))
	_check(str(agent_bubble["fg"]) == "101014",
			"il testo dell'agente non è nero: " + str(agent_bubble["fg"]))
	_check(str(user_bubble["bg"]) != str(agent_bubble["bg"]),
			"utente e agente hanno lo stesso fondo: non si distinguono a colpo d'occhio")
	_check(int(agent_bubble["tail_dir"]) == 1,
			"la coda dell'agente non punta al suo ritratto (destra)")
	_check(int(user_bubble["tail_dir"]) == -1,
			"la coda dell'utente non punta a sinistra")
	_check(str(snap["portrait_slug"]) == "scout",
			"ritratto sbagliato per lo scout: " + str(snap["portrait_slug"]))
	# Gli uid del sistema vero non sono tutti "ruolo-numero": la sessione che
	# lo Scrittore apre al Critico è CRITICO-S1, la Sentinella ha un worker, e
	# il Coordinatore sulla VPS si chiama capitano. Nessuno di questi deve
	# restare senza faccia.
	for pair in [["critico-s1", "critico"], ["sentinella-worker", "sentinella"],
			["capitano", "coordinatore"], ["capitano-1", "coordinatore"],
			["scrittore-2", "scrittore"], ["dottore", "dottore"]]:
		var got := ComicChat.portrait_slug(str(pair[0]))
		_check(got == str(pair[1]),
				"ritratto di %s risolto in %s invece di %s" % [pair[0], got, pair[1]])
	_check(bool(snap["portrait_visible"]),
			"il ritratto non è a schermo: pagina larga %s px" % snap["width"])


# ── 3. il giro completo utente → canale → risposta, su un WORKER ──────

func _check_live_exchange() -> void:
	_check(BackendBus.chat_replies(AGENT_UID),
			"lo scout non risulta capace di rispondere in chat")
	# Il messaggio parte dalla BARRA, non da una chiamata al bus: è la strada
	# dell'utente, e comprende il gate che accende la scrittura libera solo
	# con provider collegato e container acceso.
	SetupService.status["container_running"] = true
	SetupService.status["provider_authenticated"] = true
	ScriptedOnboarding.set_provider_test_override(1)
	_panel._refresh_chat_mode()
	await _frames(2)
	_check(_panel._view.input.editable and not _panel._view.send_button.disabled,
			"la barra di input resta spenta con provider e agente disponibili")
	var question := "Come procede il giro delle board?"
	_panel._view.input.text = question
	_panel._view.submit()
	var echoed := await _wait_for(func() -> bool:
		return _last_bubble().get("text", "") == question, 6.0)
	_check(echoed, "il messaggio dell'utente non è comparso come vignetta")
	_check(bool(_last_bubble().get("mine", false)),
			"il messaggio dell'utente non è stato disegnato come suo")

	# Il mock risponde con un checkpoint e poi con la battuta finale: si
	# aspetta la CHIUSURA del turno, cioè lo spegnimento dell'attesa.
	var answered := await _wait_for(func() -> bool:
		var s: Dictionary = _panel._view.debug_snapshot()
		return not bool(s["waiting"]) and not bool(_last_bubble().get("mine", true)), 15.0)
	_check(answered, "nessuna risposta dell'agente entro il tempo previsto (attesa=%s ultima=%s)"
			% [_panel._view.debug_snapshot()["waiting"], JSON.stringify(_last_bubble())])
	_check(not str(_last_bubble().get("text", "")).is_empty(),
			"la risposta dell'agente è arrivata vuota")


# ── 4. rileggere indietro senza farsi strappare la pagina ────────────

func _check_scroll_back() -> void:
	var long_history: Array = []
	for i in 24:
		long_history.append({"role": "assistant" if i % 2 == 0 else "user",
			"text": "Riga %02d — testo abbastanza lungo da riempire la pagina e costringere la colonna a scorrere." % i,
			"done": true})
	BackendBus.publish_agent_chat(AGENT_UID, long_history)
	await _frames(4)
	var snap: Dictionary = _panel._view.debug_snapshot()
	_check(float(snap["scroll_max"]) > 0.0,
			"la conversazione lunga non produce scroll: la pagina non è misurabile")
	_check(bool(snap["pinned_to_bottom"]),
			"dopo una storia nuova la pagina non è in fondo")

	# L'utente torna su a rileggere.
	_panel._view._scroll.scroll_vertical = 0
	await _frames(2)
	snap = _panel._view.debug_snapshot()
	_check(not bool(snap["pinned_to_bottom"]),
			"scorrendo verso l'alto la pagina si crede ancora in fondo")
	_check(bool(snap["jump_visible"]),
			"mentre si rilegge indietro manca il ritorno all'ultimo messaggio")

	# Mentre legge, arriva un messaggio nuovo: NON deve saltare in fondo.
	var grown := long_history.duplicate(true)
	grown.append({"role": "assistant", "text": "Arrivata mentre rileggevi.", "done": true})
	BackendBus.publish_agent_chat(AGENT_UID, grown)
	await _frames(4)
	snap = _panel._view.debug_snapshot()
	_check(not bool(snap["pinned_to_bottom"]) and float(snap["scroll_at"]) < 1.0,
			"un messaggio nuovo ha strappato la pagina a chi stava rileggendo")

	# ...e il ritorno in fondo resta a un click di distanza.
	_panel._view._jump_btn.pressed.emit()
	await _frames(3)
	snap = _panel._view.debug_snapshot()
	_check(bool(snap["pinned_to_bottom"]) and not bool(snap["jump_visible"]),
			"il ritorno all'ultimo messaggio non riporta in fondo")


# ── Il contratto di chi risponde (l'altra metà della feature) ─────────

func _check_reply_capable_contract() -> void:
	for role in ["scout", "analista", "scorer", "scrittore", "critico",
			"coordinatore", "assistente", "mentor"]:
		_check(BackendBus.chat_replies(role + "-1"),
				"%s dovrebbe rispondere in chat e non risulta abilitato" % role)
	# Fuori per progetto: one-shot a slot (dottore/mantenitore) e agente
	# edge-triggered che parla solo col Capitano (sentinella).
	for role in ["sentinella", "dottore", "mantenitore"]:
		_check(not BackendBus.chat_replies(role + "-1"),
				"%s non deve promettere una risposta in chat" % role)


# ── Attrezzi ─────────────────────────────────────────────────────────

func _last_bubble() -> Dictionary:
	if _panel == null or _panel._view == null:
		return {}
	var bubbles: Array = _panel._view.debug_snapshot()["bubbles"]
	return bubbles[-1] if not bubbles.is_empty() else {}


func _frames(n: int) -> void:
	for _i in n:
		await get_tree().process_frame


## Aspetta una condizione entro un tetto di secondi. Il mock risponde con
## ritardi casuali (come il sistema vero): un'attesa a frame fissi sarebbe
## una scommessa, e in CI la si perde.
func _wait_for(cond: Callable, timeout: float) -> bool:
	var deadline := Time.get_ticks_msec() + int(timeout * 1000.0)
	while Time.get_ticks_msec() < deadline:
		if bool(cond.call()):
			return true
		await get_tree().process_frame
	return bool(cond.call())


func _check(condition: bool, message: String) -> void:
	if not condition:
		_fails.append(message)


func _finish(fatal: String) -> void:
	if not fatal.is_empty():
		_fails.append(fatal)
	var ok := _fails.is_empty()
	print("COMIC-CHAT-TEST ", "PASS" if ok else "FAIL", " ",
			JSON.stringify({"failures": _fails}))
	for failure in _fails:
		push_error("[comic-chat-test] " + failure)
	get_tree().quit(0 if ok else 1)
