class_name BackendAdapter
extends RefCounted
## Contratto fra il BackendBus e una sorgente di eventi del team.
## Un adapter NON parla con le scene: spinge gli eventi sul bus chiamando
## i suoi publish_* (vedi backend_bus.gd). Implementazioni:
##   MockBackend  — simulatore locale, per sviluppare senza VPS
##   VpsBackend   — SSH reale verso la VPS del team
##   LocalBackend — VpsBackend col trasporto SSH sostituito da comandi locali
##
## Il contratto è in due metà: i metodi OBBLIGATORI (start/stop e i blocchi
## qui sotto, che ogni adapter deve almeno accettare) e i metodi OPZIONALI in
## fondo al file, che il bus chiama dietro has_method(). Leggi l'avvertenza
## sopra quel blocco prima di toccarlo: dichiarare un opzionale con corpo
## `pass` spegne il fallback del bus e trasforma un buco in silenzio.

var bus: Node  # il BackendBus, iniettato da set_backend()

## true solo per i backend con dati VERI (VpsBackend): il badge
## SIMULAZIONE del gioco si spegne quando l'adapter live è CONNECTED.
var live := false


## Avvia la sorgente (connessioni, timer, polling). Deve portare il bus
## a CONNECTED via bus.publish_state() quando i dati iniziano a fluire.
func start(_config: Dictionary) -> void:
	pass


## Ferma tutto e libera le risorse. Il bus pubblica DISCONNECTED da sé.
func stop() -> void:
	pass


## ── Chat bidirezionale (opzionale: il mock può simulare) ─────────────

## Tieni d'occhio la conversazione con l'agente (nome del sistema reale,
## es. "capitano") e pubblica bus.agent_chat_updated a ogni giro.
func open_chat(_agent: String) -> void:
	pass

func close_chat() -> void:
	pass

## Invia il messaggio dell'utente all'agente reale. Esito su
## bus.user_chat_sent(agent, ok, error).
func send_chat(_agent: String, _text: String) -> void:
	pass

## Variante con contesto authored locale. Un adapter semplice può ignorare il
## contesto senza rompere la chat; quello VPS lo consegna fuori banda all'LLM.
func send_chat_with_context(agent: String, text: String, _context: String) -> void:
	send_chat(agent, text)


## ── Stream terminale agente (sola lettura) ──────────────────────────

## Osserva il contenuto della pane tmux dell'agente. A differenza della
## console di login, questo contratto non espone deliberatamente alcun metodo
## di input: gli adapter possono soltanto pubblicare snapshot di testo.
func open_terminal(_agent: String) -> void:
	pass

func close_terminal() -> void:
	pass


## ── Console del Coordinatore ────────────────────────────────────────

## Legge modalità operativa, enrichment policy, code di manutenzione e
## bacheca persistente del team.
func fetch_coordinator_state() -> void:
	pass

## Salva soltanto le chiavi validate dal backend nei due file canonici:
## capitano-maintenance.json ed enrichment-policy.json.
func save_coordinator_settings(_settings: Dictionary) -> void:
	pass

## CRUD minimo della bacheca permanente (add/archive). Il testo non passa
## mai come argomento shell: gli adapter reali lo trasportano in base64/stdin.
func add_team_directive(_body: String, _kind: String) -> void:
	pass

func archive_team_directive(_directive_id: int) -> void:
	pass


## ── Deroga a termine agli automatismi di spesa ───────────────────────

## Legge lo stato REALE del flag governato da shared/skills/burn_intent.py.
## Non esiste una variante "ricordati cosa ho chiesto": la deroga scade da
## sola e il Capitano può revocarla, quindi l'unica risposta onesta è quella
## che arriva dal container. Esito su bus.publish_burn_intent().
func fetch_burn_intent() -> void:
	pass

## Concede (`active`) o revoca la deroga. `hours` viene comunque clampato dal
## modulo Python in [0.25, 12]: non esiste la forma permanente, nemmeno
## chiedendola. Esito su bus.publish_burn_intent_action().
func set_burn_intent(_active: bool, _hours: float) -> void:
	pass


## ── Ticket utente→team (l'unica scrittura remota autorizzata) ────────

## Apre un ticket 'open' sulla posizione: la richiesta che il
## Coordinatore smista sulla VPS. Esito su bus.ticket_created.
func create_ticket(_position_id: int, _text: String, _attachment_path := "") -> void:
	pass


## ── Metodi OPZIONALI (il bus li chiama dietro has_method) ────────────
##
## I nove metodi qui sotto sono opzionali: un adapter minimo può non avere
## niente da rispondere e il gioco deve restare in piedi lo stesso. Prima non
## erano dichiarati affatto, e il bus — non trovandoli — diceva all'utente
## "backend non collegato". È FALSO: il backend è collegato eccome, è quella
## singola funzione che non implementa. Un adapter nuovo che ne dimenticava
## uno non falliva mai: no-op silenzioso e diagnosi sbagliata a schermo.
##
## ⚠️ TRABOCCHETTO — dichiararli rende has_method() SEMPRE vero, quindi per
## questi nove il ramo `else` del bus non scatta più. Un corpo `pass` sarebbe
## perciò PEGGIO di non dichiararli: silenzio totale, nemmeno il messaggio
## sbagliato. Per questo nessun default qui è `pass`: ognuno passa da
## _unsupported(), che segnala a chi sviluppa QUALE metodo manca (push_error)
## e, dove il bus ha un segnale d'esito, risponde a chi gioca con un
## fallimento esplicito e un messaggio vero e tradotto.
##
## Il ramo `else` del bus resta corretto per il caso che descrive davvero:
## nessun adapter installato (_backend == null).
##
## Chi implementa uno di questi metodi NON deve chiamare super(): sostituisce
## il default per intero.

## Registra il buco e restituisce il messaggio da mostrare a chi gioca.
func _unsupported(method: String) -> String:
	push_error("BackendAdapter: %s() non implementato da %s"
			% [method, _adapter_name()])
	return UIStrings.t("common.backend_unsupported")


func _adapter_name() -> String:
	var script := get_script() as Script
	if script and script.resource_path != "":
		return script.resource_path.get_file()
	return "BackendAdapter"


## ── Onboarding: osservazione del profilo candidato ───────────────────

## Rilegge candidate_profile.yml + ready.flag a ogni giro di poll finché il
## watch è aperto, pubblicando bus.publish_profile_status().
func open_profile_watch() -> void:
	_unsupported("open_profile_watch")

func close_profile_watch() -> void:
	_unsupported("close_profile_watch")

## Avvia l'agente assistente se non è già vivo. Idempotente.
func ensure_assistant() -> void:
	_unsupported("ensure_assistant")

## Carica un documento locale (CV…) nella drop-zone allegati del container.
func upload_document(_local_path: String, request_id := 0) -> void:
	var msg := _unsupported("upload_document")
	if bus:
		bus.publish_document_upload(request_id, false, "", msg)


## ── Profilo utente e orari (scrittura dal desktop) ───────────────────

func save_profile(_fields: Dictionary) -> void:
	var msg := _unsupported("save_profile")
	if bus:
		bus.profile_saved.emit(false, msg)

func save_working_hours(_wh: Dictionary) -> void:
	var msg := _unsupported("save_working_hours")
	if bus:
		bus.hours_saved.emit(false, msg)

func save_ui_language(locale: String) -> void:
	var msg := _unsupported("save_ui_language")
	if bus:
		bus.ui_language_saved.emit(locale, false, msg)


## ── Storico usage (finestre di monitoraggio risorse) ─────────────────

## Storico aggregato per bucket_sec sull'intervallo [from_ts, to_ts] (unix
## UTC). Esito su bus.publish_usage_history(); la query fa da correlazione.
func fetch_usage_history(from_ts: float, to_ts: float, bucket_sec: int) -> void:
	var msg := _unsupported("fetch_usage_history")
	if bus:
		bus.usage_history_updated.emit(
				{"from_ts": from_ts, "to_ts": to_ts, "bucket_sec": bucket_sec},
				{"ok": false, "error": msg})

## Come sopra ma per il singolo ruolo (scheda agente); agent = slug minuscolo.
func fetch_agent_history(agent: String, from_ts: float, to_ts: float,
		bucket_sec: int) -> void:
	var msg := _unsupported("fetch_agent_history")
	if bus:
		bus.agent_history_updated.emit(
				{"agent": agent, "from_ts": from_ts, "to_ts": to_ts,
				"bucket_sec": bucket_sec},
				{"ok": false, "error": msg})


## ── Documenti prodotti (anteprima CV in-game) ────────────────────────

## Bytes di un documento registrato in cv_path/cl_path: lettura pura, il path
## fa da chiave di correlazione. Esito su bus.publish_artifact().
func fetch_artifact(path: String, _kind: String) -> void:
	var msg := _unsupported("fetch_artifact")
	if bus:
		bus.artifact_fetched.emit(path, false, PackedByteArray(), msg)
