extends Node
## Regia delle riprese per il video di presentazione (JHT_PROMO=…), pensata
## per la Movie Maker mode di Godot (`--write-movie out.png --fixed-fps 30`):
## rendering fotogramma per fotogramma, deterministico, niente cattura schermo.
##
## Gira sulla scena ufficio in showroom (JHT_NOVPS=1, nessun backend): tutto
## ciò che appare è scenografia. Ogni testo mostrato è INVENTATO e in INGLESE
## (il video di presentazione è in inglese): nessun nome di persona reale,
## nessuna azienda di candidature vere, nessun dato dell'utente.
##
##   JHT_PROMO=office  breve totale dell'ufficio, poi la camera SPINGE
##                     dentro il reparto Research fino a due scrivanie:
##                     agenti grandi e vignette leggibili anche a 720p.
##   JHT_PROMO=dept    campo STRETTO sul reparto Scrittori, lenta carrellata
##                     fra due scrivanie: la fabbrica dei CV vista da vicino.
##   JHT_PROMO=chat    pagina chat a fumetti sullo Scout lead: la
##                     conversazione si scrive da sola, vignetta per vignetta,
##                     con il momento "sta scrivendo…" (contratto partial).
##
## Clip della regia «Now Playable» (03/08) — il gioco in PIENO GIORNO e il
## giocatore che clicca (il puntatore è disegnato in post sui frame noti):
##   JHT_PROMO=open-day    Scena 1 — lo Scout si alza, va alla stampante
##                         (lampo PrinterFx), torna col foglio e si siede;
##                         camera che lo segue a mezza figura.
##   JHT_PROMO=click-chat  Scena 2 — fermo sullo Scout seduto: highlight di
##                         hover al frame noto, la pagina chat si apre e la
##                         conversazione si scrive (chip suggerito → il testo
##                         entra nell'input → SEND → attesa → risposta).
##   JHT_PROMO=work-pixels Scena 3 — l'Analista preleva dalla vaschetta
##                         degli Scout, porta il foglio alla scrivania e lo
##                         studia (vignetta di verifica); poi primo piano
##                         dello Scrittore alla macchina da scrivere, SENZA
##                         vignetta: il ticchettio è l'immagine.
##   JHT_PROMO=tailor-88   Scena 4 — tre stacchi: Scorer (88/100) →
##                         Scrittore (CV per quella posizione) → Critico che
##                         ritira dalla vaschetta e consegna allo scaffale.
##   JHT_PROMO=dusk-night  Scena 7b — notte fonda (JHT_HOUR=2), una sola
##                         scrivania nella pozza della lampada.
##   JHT_PROMO=agent-review  Un ciak QA/B-roll per il ruolo indicato da
##                         JHT_PROMO_AGENT: seduta, alzata, quattro direzioni,
##                         ritiro documento, lavoro reale e ritorno a sedere.
##
## V3 verticale (OK operatore 05/08) — tre clip orizzontali puliti, destinati
## al compositing e quindi SENZA copy o pannelli nel frame:
##   JHT_PROMO=team-welcome          tre agenti: passo breve, posa frontale,
##                                   poi idle vivo nell'ufficio.
##   JHT_PROMO=assistant-intro       l'Assistente fa un passo frontale e resta
##                                   calma, sul lato destro del quadro.
##   JHT_PROMO=assistant-walk-right  l'Assistente percorre una tratta NavGrid
##                                   continua verso destra, camera al seguito.
## I viaggi fisici riusano le tappe VERE della pipeline (stampante,
## pile_take/pile_drop, scaffale output) ma con PAUSE FISSE: il ciak deve
## essere ripetibile, non un lancio di dadi. Il HUD «JHT TEAM» (numeri
## aggregati) è VIETATO dalla regia e viene rimosso in ogni clip nuovo.
##
## Le targhe di stato sopra la testa ("AL LAVORO"…) non sono ancora
## localizzate: in una ripresa inglese stonerebbero, quindi la regia le
## spegne per la durata del ciak. Solo qui: il gioco vero non cambia.
##
## REGOLA D'ORO (feedback utente 30/07): «nel video si vede molto poco».
## La pianta intera vista da satellite non racconta niente: le persone sono
## alte pochi pixel e le vignette macchie bianche. Quindi il campo largo dura
## un attimo (giusto il senso del luogo) e la scena vive VICINA agli agenti:
## a zoom >= 2 una vignetta (font 14 world px) rende ~19 px sul montaggio
## 720p — leggibile su un telefono; a zoom 0.42 rendeva ~4 px: una macchia.

## Totale d'apertura: fit in LARGHEZZA (1920/3400), non in altezza — riempie
## il quadro senza bande nere ai lati; il centro y scende a 950 per tenere in
## campo i reparti, non il muro alto.
const OFFICE_WIDE_CENTER := Vector2(1700.0, 950.0)
const OFFICE_HOLD_SECONDS := 2.6
const OFFICE_PUSH_SECONDS := 3.6
const OFFICE_DRIFT_SECONDS := 6.8
## Meta della spinta: le DUE scrivanie occupate del Research (showroom:
## lead a desk 1, collega a desk 0 — sedute a ~(542,482) e ~(569,629),
## quasi in colonna: la stessa inquadratura regge il ritaglio verticale
## 9:16 del montaggio per cellulare). Il globo olografico (675..875,435..615)
## resta nel quadro a destra: è il landmark del reparto.
## Il centro y sta a ~520-530 e lo zoom sotto 2.05: la vignetta del collega
## in alto (bordo superiore a wy≈291) deve restare SOTTO il banner UI
## "SIMULATION — not real data" (schermo y 15..48) — al primo ciak, con
## centro 540..560 e zoom 2.1, il banner la copriva a metà (visto sui frame).
const OFFICE_CLOSE_CENTER := Vector2(660.0, 528.0)
const OFFICE_CLOSE_ZOOM := 1.95
const OFFICE_DRIFT_CENTER := Vector2(640.0, 520.0)
const OFFICE_DRIFT_ZOOM := 2.02

## [secondi, uid, testo] — broadcast ("all"): il fumetto non mostra
## destinatario (l'etichetta destinatario è ancora solo in italiano).
## SOLO agenti in campo: una vignetta fuori quadro è tempo sprecato. E UNA
## vignetta per agente: SpeechBubble tiene la prima per MIN_HOLD (60 s),
## una seconda finirebbe in coda senza mai apparire nel ciak.
const OFFICE_CHATTER := [
	[5.8, "scout-2", "Boards swept: 6 new roles, 4 remote in the EU."],
	[8.2, "scout-1", "Two look promising, sending them to Analysis."],
]

## Carrellata DENTRO la zona Scrittori (Rect2(320,1520,860,440)), stretta
## sulle due scrivanie occupate (sedute a ~(503,1666) e ~(523,1733), anche
## qui quasi in colonna per il ritaglio 9:16). Il bordo destro resta sotto
## x≈1420: la mensola "CV PRONTI" (etichetta non localizzata, da x≈1430)
## non entra mai in campo. Il centro y sta a ~1650 così la targa
## "APPLICATIONS" (wy≈1907) resta SOTTO il quadro: mezza targa tagliata al
## bordo è peggio di nessuna targa, e la pastiglia delle didascalie del
## montaggio vive proprio lì. Viewport del movie: 1920x1080, mezzo campo
## orizzontale = 960/zoom.
## NB (30/07, seconda tornata): il reparto è ora a "quadrante d'orologio"
## (sei scrivanie radiali attorno alla rosetta del tappeto). Le vecchie
## costanti (620,1640 z2.05→2.18) inquadravano il tappeto vuoto: ritarate
## empiricamente su una sonda statica — a z~1.8 entrano tutte e sei le
## scrivanie coi due Scrittori al lavoro, come nel girato approvato.
const DEPT_SECONDS := 9.0
const DEPT_FROM := Vector2(700.0, 1650.0)
const DEPT_TO := Vector2(715.0, 1660.0)
const DEPT_ZOOM_FROM := 1.80
const DEPT_ZOOM_TO := 1.92
const DEPT_CHATTER := [
	[1.6, "scrittore-1", "Cover letter drafted: one page, role-specific."],
	[4.4, "scrittore-2", "CV variant ready for the remote-first posting."],
]

const CHAT_AGENT := "scout-1"
## Passi della conversazione: [pausa_prima, role, testo, partial].
## `partial` è il checkpoint "sta scrivendo…": la vignetta successiva
## dello stesso agente lo sostituisce, come nel contratto del backend vero.
const CHAT_STEPS := [
	[0.7, "assistant", "Morning sweep done: 6 new roles, 4 of them remote (EU).", false],
	[1.5, "user", "Which one should I look at first?", false],
	[1.2, "assistant", "checking the scores…", true],
	[1.5, "assistant", "Platform Engineer at a fintech scale-up — 88/100 match. The tailored CV is already in review.", false],
	[1.7, "user", "Great. Prioritise remote roles this week, please.", false],
	[1.2, "assistant", "Done — remote-first from now on. I'll ping you when the review lands.", false],
]

## Insegne di passaggio fra reparti (HandoffStation): stesso doppiaggio
## delle targhe di tools/promo_dept_signs.gd, coerente reparto per reparto.
const HANDOFF_EN := {
	"scout": ["RESEARCH", "ANALYSIS"],
	"analisti": ["ANALYSIS", "COMPATIBILITY"],
	"scorer": ["COMPATIBILITY", "APPLICATIONS"],
	"scrittori": ["APPLICATIONS", "QUALITY CHECK"],
}

## ── Costanti dei clip «Now Playable» ─────────────────────────────────
## Ritmo di cammino: i viaggi forzati marciano a PIPELINE_SPEED (185 px/s),
## come i veri passaggi di pipeline — il lavoro si vede come lavoro.
## ZOOM: i primi ciak erano stati tarati (a loro insaputa) col profilo
## grafico «performance» persistito in graphics.cfg: mondo in SubViewport
## al 60% (1152 px utili). Le riprese si fanno ADESSO col profilo full
## (mode="full" in user://graphics.cfg, mai col profilo ridotto): stessa
## inquadratura = zoom vecchi × 1920/1152 (1.6667). L'equivalente della
## vecchia regola «zoom ≥ 1.9» è quindi «zoom ≥ 3.17»: vignette leggibili
## a 720p, mai campi larghi.

## Scena 1 — lo Scout lead siede a ~(542,482) (showroom, desk 1 Research);
## la camera lo insegue con mezzo busto d'aria sopra la testa.
const OPEN_TRACK_OFFSET := Vector2(0.0, -40.0)
const OPEN_ZOOM := 3.25
const OPEN_FORCE_AT := 0.8          # si alza quasi subito: la scena è sua
const OPEN_PRINTER_PAUSE := 1.6     # sosta fissa alla stampante (ciak ripetibile)

## Scena 2 — stesso quadro in cui la Scena 1 lo lascia seduto: la camera è
## FERMA (il puntatore in post ha bisogno di coordinate stabili). Il centro
## è la seduta VERA dello Scout lead (desk 1 Research, ~(569,629)) più
## l'aria sopra la testa, come la lascia la carrellata della Scena 1.
const CLICK_CAM_CENTER := Vector2(569.0, 589.0)
const CLICK_CAM_ZOOM := 3.25
const CLICK_HOVER_AT := 2.0         # highlight di hover (il puntatore arriva)
const CLICK_OPEN_AT := 2.6          # CLIC: la pagina chat si apre qui
const CLICK_REPLY := "Show me the best one first."
## Dopo l'apertura (tempi relativi al clic): la vignetta dell'agente, il
## chip cliccato che riempie l'input, SEND, l'attesa, la risposta.
const CLICK_BUBBLE1_AT := 0.5
const CLICK_TYPE_AT := 2.9          # il chip è stato cliccato: il testo entra
const CLICK_SEND_AT := 4.6          # clic su SEND → parte la bolla verde
const CLICK_WAIT_ON_AT := 4.9
const CLICK_REPLY2_AT := 6.4        # «On it — pulling the file now.»

## Scena 3 — l'Analista lead (showroom, seduto a ~(2395,315)) va alla
## vaschetta degli Scout e torna col foglio; al rientro, la vignetta.
## Offset POSITIVO: la sua scrivania sta contro il muro nord e con l'aria
## sopra la testa la vignetta di verifica finiva DIETRO il banner
## «SIMULATION» (visto sui frame del primo ciak) — qui la camera tiene
## l'aria SOTTO, così la vignetta respira fra banner e testa.
const WORK_TRACK_OFFSET := Vector2(0.0, 40.0)
const WORK_ZOOM := 3.25
const WORK_FORCE_AT := 0.8
const WORK_PILE_PAUSE := 1.0
const WORK_VERIFY_TEXT := "Posting verified: real company, salary confirmed."
## Quadro FISSO della vignetta di verifica (la seduta dell'Analista è a
## ~(2549,564), contro il muro nord): centro sotto la seduta quel tanto che
## fa respirare la vignetta fra banner SIMULATION e testa.
const WORK_SEAT_CENTER := Vector2(2549.0, 572.0)
## Quanto la vignetta resta in quadro prima dello stacco sulla macchina da
## scrivere (lo stacco è agganciato alla seduta, non a un orologio).
const WORK_B_HOLD := 3.4
## Parte B: primo piano dello Scrittore alla macchina da scrivere. La camera
## TAGLIA (teleport): lo stacco netto è il linguaggio del montaggio.
const WORK_B_CENTER := Vector2(500.0, 1670.0)
const WORK_B_ZOOM := 3.83

## Scena 4 — tre stacchi. A: Scorer lead (seduto a ~(1356,1158)).
const TAILOR_A_CENTER := Vector2(1370.0, 1120.0)
const TAILOR_A_ZOOM := 3.42
const TAILOR_A_BUBBLE_AT := 1.2
const TAILOR_A_TEXT := "Match with your profile: 88/100."
## B: lo Scrittore, stesso reparto della Scena 3b ma CON la vignetta: il
## centro sta più in alto di WORK_B_CENTER perché la vignetta non finisca
## dietro il banner SIMULATION (visto sui frame del primo ciak: «CV
## re■■■■■■» col banner sopra la parola).
const TAILOR_B_AT := 6.0
const TAILOR_B_CENTER := Vector2(500.0, 1655.0)
const TAILOR_B_ZOOM := 3.4
const TAILOR_B_BUBBLE_AT := 7.4
const TAILOR_B_TEXT := "CV rewritten for this exact posting."
## C: il Critico lead ritira dalla vaschetta Scrittori, rilegge alla
## scrivania (pausa corta: il ciak non aspetta una revisione vera) e porta
## la cartellina allo scaffale output. La vignetta parte alla consegna.
## L'inseguimento del Critico tiene l'aria SOPRA (offset negativo): alla
## consegna la vignetta del verdetto nasce sopra la sua testa e con l'aria
## sotto finirebbe dietro il banner SIMULATION.
const TAILOR_C_AT := 12.0
const TAILOR_C_TRACK_OFFSET := Vector2(0.0, -40.0)
const TAILOR_C_ZOOM := 3.17
const TAILOR_C_PILE_PAUSE := 0.9
const TAILOR_C_DESK_PAUSE := 2.4
const TAILOR_C_SHELF_PAUSE := 1.2
const TAILOR_C_TEXT := "Review, round two: pass."

## Scena 7b — notte: la scrivania dello Scout lead nella pozza della
## lampada (lo stesso personaggio dell'apertura: il cerchio si chiude).
const NIGHT_CENTER := Vector2(569.0, 580.0)
const NIGHT_ZOOM_FROM := 3.37
const NIGHT_ZOOM_TO := 3.50
const NIGHT_SECONDS := 9.0

## Quadrato di calibrazione nel corridoio libero fra Direzione e Scorer.
## Le quattro tratte sono intenzionalmente ortogonali: ogni ciak rende
## osservabili up/right/down/left senza sostituire il pathfinding vero.
const REVIEW_LOOP := [
	Vector2(1450.0, 780.0),
	Vector2(1450.0, 650.0),
	Vector2(1700.0, 650.0),
	Vector2(1700.0, 780.0),
	Vector2(1450.0, 780.0),
]
const REVIEW_ZOOM := 3.25
const REVIEW_HANDLE_SECONDS := 2.0
const REVIEW_TURN_HOLD := 0.45
const REVIEW_PICKUP_HOLD := 1.0
const REVIEW_WORK_HOLD := 2.6
const REVIEW_FINAL_HOLD := 2.0

## ── Clip V3 «Your AI job-search team» ───────────────────────────────
## Le durate sono intenzionalmente appena superiori al contratto regia:
## 9.5 s / 7.0 s / 8.5 s. Il writer Movie Maker taglia dal marker `start`,
## non dall'avvio del processo, cosi' il primo frame consegnato e' gia' vivo.
const V3_TEAM_WELCOME_SECONDS := 9.6
const V3_ASSISTANT_INTRO_SECONDS := 7.2
const V3_ASSISTANT_WALK_SECONDS := 8.6
const V3_STILL_HOLD := 900.0

## Corridoio centrale libero, gia' percorso dal loop QA delle quattro
## direzioni. Le tre colonne producono una composizione cortese ma non
## teatrale: un passo in avanti reale, poi la posa `down` frontale.
const V3_TEAM_STARTS := {
	"scout-1": Vector2(1450.0, 650.0),
	"analista-1": Vector2(1570.0, 650.0),
	"assistente": Vector2(1690.0, 650.0),
}
const V3_TEAM_STEP := Vector2(0.0, 130.0)
## Il cast cammina a y=650→780: tenere la camera a 960 lo spingeva contro il
## bordo alto del frame 16:9 e decapitava i tre volti. A y=650 l'intera figura
## resta nel terzo centrale, con scrivanie vive dietro e aria sopra la testa.
const V3_TEAM_CAMERA := Vector2(1570.0, 650.0)
const V3_TEAM_ZOOM := 1.82

## La reception e' dietro al quadro: l'Assistente viene preparata nella porta
## libera tra Scorer e reparti sud, fa un piccolo passo verso il pubblico e
## lascia libera la meta' sinistra per il pannello composto da VIDEO.
const V3_ASSISTANT_INTRO_FROM := Vector2(1790.0, 1390.0)
const V3_ASSISTANT_INTRO_TO := Vector2(1790.0, 1450.0)
const V3_ASSISTANT_INTRO_CAMERA := Vector2(1600.0, 1390.0)
const V3_ASSISTANT_INTRO_ZOOM := 2.8

## Fascia nord del reparto centrale: 1340 px diritti a 150 px/s. Il test
## controlla sia navigabilita' sia distanza >= 8.5 s; l'offset porta il corpo
## da sinistra-centro nel quadro mentre il tracking lo segue senza scatti.
const V3_ASSISTANT_WALK_FROM := Vector2(1260.0, 780.0)
const V3_ASSISTANT_WALK_TO := Vector2(2600.0, 780.0)
const V3_ASSISTANT_WALK_CAMERA_OFFSET := Vector2(170.0, -40.0)
const V3_ASSISTANT_WALK_ZOOM := 2.2

## I core non appartengono alla catena delle pile, ma il loro lavoro ha
## comunque una meta reale della ronda dichiarata in CharacterDefs.
const REVIEW_CORE_WORK := {
	"coordinatore": Vector2(1110.0, 778.0),
	"sentinella": Vector2(2690.0, 790.0),
	"assistente": Vector2(1790.0, 1390.0),
	"dottore": Vector2(1790.0, 1390.0),
	"mantenitore": Vector2(590.0, 1090.0),
	"mentor": Vector2(2920.0, 1320.0),
}

var _office: Node
var _track_cam: Camera2D
var _track_target: Node2D
var _track_offset := Vector2.ZERO
var _review_role := ""
var _review_frame_zero := 0
var _review_shutter: CanvasLayer
var _v3_active := false
## Inseguimento morbido: a 30 fps un lerp 0.08 tiene il soggetto centrato
## senza scatti quando cambia direzione (carrellata, non ping-pong).
const TRACK_LERP := 0.08


func _ready() -> void:
	_office = get_parent()
	var mode := OS.get_environment("JHT_PROMO")
	_v3_active = mode in ["team-welcome", "assistant-intro", "assistant-walk-right"]
	# Movie Maker registra dal bootstrap. Sul profilo live teniamo chiusa una
	# semplice tendina nera finche' il data-plane non e' pronto: nel raw non
	# entra mai un frame intermedio col warning, che resta comunque intatto e
	# scompare da solo soltanto quando i dati sono davvero live.
	if mode == "agent-review" and OS.get_environment("JHT_PROMO_REQUIRE_LIVE") == "1":
		_review_install_shutter()
	match mode:
		"office":
			_office_clip.call_deferred()
		"dept":
			_dept_clip.call_deferred()
		"chat":
			_chat_clip.call_deferred()
		"open-day":
			_open_day_clip.call_deferred()
		"click-chat":
			_click_chat_clip.call_deferred()
		"work-pixels":
			_work_pixels_clip.call_deferred()
		"tailor-88":
			_tailor_88_clip.call_deferred()
		"dusk-night":
			_dusk_night_clip.call_deferred()
		"agent-review":
			_agent_review_clip.call_deferred()
		"team-welcome":
			_team_welcome_clip.call_deferred()
		"assistant-intro":
			_assistant_intro_clip.call_deferred()
		"assistant-walk-right":
			_assistant_walk_right_clip.call_deferred()


func _process(_delta: float) -> void:
	if _v3_active:
		# SetupService puo' pubblicare il suo primo stato dopo _dress_promo_set:
		# l'handler normale riaccende allora i diamanti del tour showroom. Nel
		# V3 non sono UI del prodotto da comporre, quindi li si spegne a ogni
		# frame della sola regia e non nella scena Office generale.
		_v3_silence_quest_markers()
	if _track_cam and is_instance_valid(_track_target):
		var goal: Vector2 = _track_target.global_position + _track_offset
		_track_cam.position = _track_cam.position.lerp(goal, TRACK_LERP)


## Breve totale (il senso del luogo) → SPINTA dentro il Research fino a due
## scrivanie, poi lenta deriva da vicino mentre gli agenti parlano. Tre tempi
## su un'unica tween parallela coi delay: ogni PropertyTweener parte dal
## valore corrente quando scatta, quindi le tappe si incatenano da sole.
func _office_clip() -> void:
	await get_tree().process_frame
	_dress_set_english()
	_silence_state_tags()
	var world: Rect2 = FurnitureDefs.WORLD
	var vp := get_viewport().get_visible_rect().size
	var z := vp.x / world.size.x  # fit in larghezza: niente bande ai lati
	var cam := _mount_camera(OFFICE_WIDE_CENTER, z)
	var tw := create_tween().set_parallel(true) \
			.set_ease(Tween.EASE_IN_OUT).set_trans(Tween.TRANS_SINE)
	var close := Vector2(OFFICE_CLOSE_ZOOM, OFFICE_CLOSE_ZOOM)
	tw.tween_property(cam, "zoom", close, OFFICE_PUSH_SECONDS) \
			.set_delay(OFFICE_HOLD_SECONDS)
	tw.tween_property(cam, "position", OFFICE_CLOSE_CENTER, OFFICE_PUSH_SECONDS) \
			.set_delay(OFFICE_HOLD_SECONDS)
	var drift := Vector2(OFFICE_DRIFT_ZOOM, OFFICE_DRIFT_ZOOM)
	var after_push := OFFICE_HOLD_SECONDS + OFFICE_PUSH_SECONDS
	tw.tween_property(cam, "zoom", drift, OFFICE_DRIFT_SECONDS) \
			.set_delay(after_push)
	tw.tween_property(cam, "position", OFFICE_DRIFT_CENTER, OFFICE_DRIFT_SECONDS) \
			.set_delay(after_push)
	for line in OFFICE_CHATTER:
		_bubble_at(float(line[0]), str(line[1]), str(line[2]))


## Campo stretto sul reparto Scrittori: lenta carrellata fra due scrivanie
## con leggera spinta in avanti — il soggetto resta grande per tutto il ciak.
func _dept_clip() -> void:
	await get_tree().process_frame
	_dress_set_english()
	_silence_state_tags()
	var cam := _mount_camera(DEPT_FROM, DEPT_ZOOM_FROM)
	var tw := create_tween().set_parallel(true) \
			.set_ease(Tween.EASE_IN_OUT).set_trans(Tween.TRANS_SINE)
	tw.tween_property(cam, "position", DEPT_TO, DEPT_SECONDS)
	tw.tween_property(cam, "zoom",
			Vector2(DEPT_ZOOM_TO, DEPT_ZOOM_TO), DEPT_SECONDS)
	for line in DEPT_CHATTER:
		_bubble_at(float(line[0]), str(line[1]), str(line[2]))


## La pagina a fumetti che si scrive da sola: storia pubblicata dalla porta
## vera del bus (publish_agent_chat), una vignetta alla volta.
func _chat_clip() -> void:
	await get_tree().process_frame
	_dress_set_english()
	# Anche qui: le targhe di stato ("AL LAVORO") sono solo in italiano e
	# restano leggibili dietro la pagina chat semi-trasparente — via.
	_silence_state_tags()
	var display := AgentNames.display_name(CHAT_AGENT)
	# NIENTE colonna roster: con al più una voce ComicChat non la mostra.
	# In lista finirebbero "Il Coordinatore" (nome proprio del brand, uguale
	# in tutte le lingue: scelta, non bug) ma anche "Ricercatore 02" e
	# simili — etichette dei worker da CharacterDefs.DEPT_ROLES che NON
	# passano dai dizionari i18n: un utente inglese le vede in italiano.
	# Gap del prodotto, segnalato a parte; il ciak inquadra solo la pagina.
	var panel := ChatPanel.new(CHAT_AGENT, display, [])
	_office.add_child(panel)
	var history: Array = []
	for step in CHAT_STEPS:
		await get_tree().create_timer(float(step[0])).timeout
		if not history.is_empty() \
				and bool((history[-1] as Dictionary).get("partial", false)):
			history.pop_back()
		var msg := {"role": str(step[1]), "text": str(step[2]),
				"ts": Time.get_unix_time_from_system()}
		if bool(step[3]):
			msg["partial"] = true
		else:
			msg["done"] = true
		history.append(msg)
		BackendBus.publish_agent_chat(CHAT_AGENT, history.duplicate(true))


## ── Clip «Now Playable» ──────────────────────────────────────────────

## Scena 1 — pieno giorno (JHT_HOUR=10): lo Scout si alza, stampa, torna.
func _open_day_clip() -> void:
	await get_tree().process_frame
	_dress_promo_set()
	var scout := _find("scout-1")
	if scout == null:
		return
	_track_target = scout
	_track_offset = OPEN_TRACK_OFFSET
	_track_cam = _mount_camera(scout.global_position + OPEN_TRACK_OFFSET, OPEN_ZOOM)
	await get_tree().create_timer(OPEN_FORCE_AT).timeout
	# Anche qui: partenza solo da seduta stabile (vedi Scena 3 — un ciak ha
	# mostrato lo Scout congelato dal callback del tween di seduta).
	await _wait_desk_stable(scout)
	# Il viaggio VERO dello Scout (stampante → lettura alla scrivania), con
	# pause fisse: la pausa lunga al rientro lo tiene seduto fino a fine ciak
	# (ed è il quadro da cui riparte la Scena 2).
	var pr: Dictionary = scout._leg_to(
			DepartmentDefs.POIS["printer"]["spot"], "walk",
			OPEN_PRINTER_PAUSE, "idle")
	pr["fx_printer"] = true
	var read: Dictionary = scout._leg_to(scout._spot, "carry", 600.0, "work")
	read["desk_work"] = true
	_force_legs(scout, [pr, read])


## Scena 2 — il clic sull'agente: highlight al frame noto, poi la pagina
## chat si scrive da sola. Il puntatore è disegnato in post su questi tempi.
func _click_chat_clip() -> void:
	await get_tree().process_frame
	_dress_promo_set()
	var scout := _find("scout-1")
	if scout == null:
		return
	scout._pause = 900.0  # resta seduto: il quadro è fermo e cliccabile
	_mount_camera(CLICK_CAM_CENTER, CLICK_CAM_ZOOM)
	await get_tree().create_timer(CLICK_HOVER_AT).timeout
	scout.set_highlight(true)
	await get_tree().create_timer(CLICK_OPEN_AT - CLICK_HOVER_AT).timeout
	scout.set_highlight(false)
	var panel := ChatPanel.new("scout-1", AgentNames.display_name("scout-1"), [])
	_office.add_child(panel)
	await get_tree().process_frame
	# Niente riga di stato del provider né placeholder «choose one of the
	# replies»: nel ciak la pagina è già un canale vivo.
	panel._view.warn.text = ""
	panel._view.warn.visible = false
	panel._view.input.placeholder_text = ""
	var history: Array = []
	await get_tree().create_timer(CLICK_BUBBLE1_AT).timeout
	history.append({"role": "assistant",
			"text": "Sweep done: 6 new roles — 4 remote (EU).",
			"done": true, "ts": Time.get_unix_time_from_system(),
			"choices": [{"label": CLICK_REPLY, "value": CLICK_REPLY}]})
	BackendBus.publish_agent_chat("scout-1", history.duplicate(true))
	await get_tree().create_timer(CLICK_TYPE_AT - CLICK_BUBBLE1_AT).timeout
	# Il chip è stato cliccato (in post): il testo scorre dentro l'input,
	# un carattere per frame — si vede l'ordine che prende forma.
	for i in range(CLICK_REPLY.length()):
		panel._view.input.text = CLICK_REPLY.substr(0, i + 1)
		panel._view.input.caret_column = i + 1
		await get_tree().process_frame
	await get_tree().create_timer(
			CLICK_SEND_AT - CLICK_TYPE_AT - CLICK_REPLY.length() / 30.0).timeout
	# CLIC su SEND: parte la bolla verde, l'input si svuota.
	panel._view.input.text = ""
	history.append({"role": "user", "text": CLICK_REPLY,
			"done": true, "ts": Time.get_unix_time_from_system()})
	BackendBus.publish_agent_chat("scout-1", history.duplicate(true))
	await get_tree().create_timer(CLICK_WAIT_ON_AT - CLICK_SEND_AT).timeout
	BackendBus.chat_waiting_changed.emit("scout-1", true)
	await get_tree().create_timer(CLICK_REPLY2_AT - CLICK_WAIT_ON_AT).timeout
	BackendBus.chat_waiting_changed.emit("scout-1", false)
	history.append({"role": "assistant", "text": "On it — pulling the file now.",
			"done": true, "ts": Time.get_unix_time_from_system()})
	BackendBus.publish_agent_chat("scout-1", history.duplicate(true))


## Scena 3 — (A) l'Analista preleva dalla vaschetta e studia; (B) primo
## piano dello Scrittore che batte, senza vignette.
func _work_pixels_clip() -> void:
	await get_tree().process_frame
	_dress_promo_set()
	var analyst := _find("analista-1")
	if analyst == null:
		return
	_track_target = analyst
	_track_offset = WORK_TRACK_OFFSET
	_track_cam = _mount_camera(
			analyst.global_position + WORK_TRACK_OFFSET, WORK_ZOOM)
	await get_tree().create_timer(WORK_FORCE_AT).timeout
	# Si forza SOLO da una seduta stabile: lo showroom è casuale e se il via
	# cade durante una desk-pause (state TRIP con pausa lunga) la tratta
	# forzata resta congelata accanto alla scrivania — visto in un ciak:
	# 18 secondi di marcia sul posto e niente viaggio.
	await _wait_desk_stable(analyst)
	var pick: Dictionary = analyst._leg_to(
			DepartmentDefs.handoff_spot("scout", true), "walk",
			WORK_PILE_PAUSE, "idle")
	pick["pile_take"] = "scout"
	var study: Dictionary = analyst._leg_to(analyst._spot, "carry", 600.0, "work")
	study["desk_work"] = true
	_force_legs(analyst, [pick, study])
	# Si è alzata; il rientro in desk-pose è il segnale della seduta vera.
	while is_instance_valid(analyst) and analyst._desk_pose_active:
		await get_tree().process_frame
	while is_instance_valid(analyst) and not analyst._desk_pose_active:
		await get_tree().process_frame
	# Quadro FISSO per la vignetta: la scrivania sta contro il muro nord e
	# in inseguimento la vignetta finiva dietro il banner SIMULATION (o
	# sopra il bordo del quadro). La camera si posa su un centro calcolato
	# perché la vignetta respiri fra banner e testa.
	_track_target = null
	var tw := create_tween().set_ease(Tween.EASE_IN_OUT).set_trans(Tween.TRANS_SINE)
	tw.tween_property(_track_cam, "position", WORK_SEAT_CENTER, 0.5)
	await get_tree().create_timer(0.6).timeout
	BackendBus.publish_chat({"ts": Time.get_datetime_string_from_system(),
			"from": "analista-1", "to": "all", "text": WORK_VERIFY_TEXT})
	# Parte B agganciata al GESTO: lo stacco arriva dopo che la vignetta ha
	# avuto il suo tempo in quadro, mai a orologio assoluto (se la seduta
	# slitta, l'orologio taglierebbe la vignetta).
	await get_tree().create_timer(WORK_B_HOLD).timeout
	_cut_to_writer()


## Seduta stabile: desk-pose attiva (il tween di seduta ha già chiuso il
## suo callback). La pausa residua viene azzerata da _force_legs, in modo
## atomico con l'installazione delle tratte.
func _wait_desk_stable(agent: AgentNPC) -> void:
	while is_instance_valid(agent) and not agent._desk_pose_active:
		await get_tree().process_frame


func _cut_to_writer() -> void:
	_track_target = null
	if _track_cam:
		_track_cam.position = WORK_B_CENTER
		_track_cam.zoom = Vector2(WORK_B_ZOOM, WORK_B_ZOOM)
	var writer := _find("scrittore-1")
	if writer:
		writer._pause = 900.0
		_pulse_at(1.2, writer)
		_pulse_at(3.4, writer)
		_pulse_at(5.6, writer)


## Scena 4 — tre stacchi: l'88 nasce dallo Scorer, il CV dallo Scrittore,
## il PASS viaggia fino allo scaffale con il Critico.
func _tailor_88_clip() -> void:
	await get_tree().process_frame
	_dress_promo_set()
	var cam := _mount_camera(TAILOR_A_CENTER, TAILOR_A_ZOOM)
	var scorer := _find("scorer-1")
	if scorer:
		scorer._pause = 900.0
	_bubble_at(TAILOR_A_BUBBLE_AT, "scorer-1", TAILOR_A_TEXT)
	_pulse_at(2.0, scorer)
	_pulse_at(4.0, scorer)
	await get_tree().create_timer(TAILOR_B_AT).timeout
	cam.position = TAILOR_B_CENTER
	cam.zoom = Vector2(TAILOR_B_ZOOM, TAILOR_B_ZOOM)
	var writer := _find("scrittore-1")
	if writer:
		writer._pause = 900.0
	_bubble_at(TAILOR_B_BUBBLE_AT - TAILOR_B_AT, "scrittore-1", TAILOR_B_TEXT)
	_pulse_at(1.0, writer)
	await get_tree().create_timer(TAILOR_C_AT - TAILOR_B_AT).timeout
	var critic := _find("critico-1")
	if critic == null:
		return
	# Come per l'Analista: si forza solo da una seduta stabile (showroom
	# casuale: una desk-pause residua congelerebbe il viaggio del Critico).
	await _wait_desk_stable(critic)
	cam.zoom = Vector2(TAILOR_C_ZOOM, TAILOR_C_ZOOM)
	_track_target = critic
	_track_offset = TAILOR_C_TRACK_OFFSET
	_track_cam = cam
	cam.position = critic.global_position + TAILOR_C_TRACK_OFFSET
	var pick: Dictionary = critic._leg_to(
			DepartmentDefs.handoff_spot("scrittori", true), "walk",
			TAILOR_C_PILE_PAUSE, "idle")
	pick["pile_take"] = "scrittori"
	var review: Dictionary = critic._leg_to(critic._spot, "carry",
			TAILOR_C_DESK_PAUSE, "work")
	review["desk_work"] = true
	var shelf_spot: Vector2 = OutputShelf.RECT.get_center() + Vector2(0.0, 46.0)
	var deliver: Dictionary = critic._leg_to(shelf_spot, "carry",
			TAILOR_C_SHELF_PAUSE, "idle")
	var home: Dictionary = critic._leg_to(critic._spot, "walk", 600.0, "work")
	home["desk_work"] = true
	_force_legs(critic, [pick, review, deliver, home])
	# La vignetta del verdetto parte ALLA consegna: quando la cartellina
	# arriva allo scaffale, non a cronometro. Raggio largo (150): il punto
	# navigabile più vicino allo scaffale può stare a più di 60 px dal suo
	# centro, e col raggio stretto la vignetta non partiva mai (visto in un
	# ciak: consegna muta).
	while is_instance_valid(critic) \
			and critic.global_position.distance_to(shelf_spot) > 150.0:
		await get_tree().process_frame
	BackendBus.publish_chat({"ts": Time.get_datetime_string_from_system(),
			"from": "critico-1", "to": "all", "text": TAILOR_C_TEXT})


## Scena 7b — notte fonda: una scrivania sola, la pozza della lampada,
## un agente che batte. Lenta spinta in avanti, nessuna vignetta.
func _dusk_night_clip() -> void:
	await get_tree().process_frame
	_dress_promo_set()
	var scout := _find("scout-1")
	if scout:
		scout._pause = 900.0
	var cam := _mount_camera(NIGHT_CENTER, NIGHT_ZOOM_FROM)
	var tw := create_tween().set_ease(Tween.EASE_IN_OUT).set_trans(Tween.TRANS_SINE)
	tw.tween_property(cam, "zoom",
			Vector2(NIGHT_ZOOM_TO, NIGHT_ZOOM_TO), NIGHT_SECONDS)
	_pulse_at(2.5, scout)
	_pulse_at(5.5, scout)


## ── V3: tre take senza UI ───────────────────────────────────────────

## Il set showroom resta esplicitamente sintetico nel manifest di consegna,
## ma il movimento e' quello del prodotto: AgentNPC, NavGrid, rig e Camera2D
## sono gli stessi della scena normale. Nessun badge/demo/sidebar/dialogo
## entra nell'immagine: _dress_promo_set() li rimuove solo per JHT_PROMO.
func _team_welcome_clip() -> void:
	await get_tree().process_frame
	_v3_prepare_office()
	var cast: Array = []
	for ref in V3_TEAM_STARTS:
		var agent := _find(str(ref))
		if agent == null:
			push_error("promo V3 team-welcome: agente assente '%s'" % ref)
			get_tree().quit(10)
			return
		_v3_stage(agent, V3_TEAM_STARTS[ref])
		cast.append(agent)
	var cam := _mount_camera(V3_TEAM_CAMERA, V3_TEAM_ZOOM)
	for agent in cast:
		var from: Vector2 = agent.global_position
		_force_legs(agent, [agent._leg_to(from + V3_TEAM_STEP, "walk",
				V3_STILL_HOLD, "idle")])
	_v3_animate_background(cast)
	# Aspetta il primo tick fisico: il marker start cade gia' sul walk, mai su
	# una posa di bootstrap o una scrivania appena liberata.
	await get_tree().physics_frame
	_v3_marker("team-welcome", "start")
	await get_tree().create_timer(V3_TEAM_WELCOME_SECONDS).timeout
	_v3_marker("team-welcome", "end")
	_v3_pass_and_quit("team-welcome", cam)


func _assistant_intro_clip() -> void:
	await get_tree().process_frame
	_v3_prepare_office()
	var assistant := _find("assistente")
	if assistant == null:
		push_error("promo V3 assistant-intro: Assistente assente")
		get_tree().quit(11)
		return
	_v3_stage(assistant, V3_ASSISTANT_INTRO_FROM)
	var cam := _mount_camera(V3_ASSISTANT_INTRO_CAMERA, V3_ASSISTANT_INTRO_ZOOM)
	# Il solo gesto approvato usa cel esistenti: passo reale + arrivo frontale
	# + idle. Non inventa un gesto di mano e non modifica gli sprite.
	_force_legs(assistant, [assistant._leg_to(V3_ASSISTANT_INTRO_TO, "walk",
			V3_STILL_HOLD, "idle")])
	_v3_animate_background([assistant])
	await get_tree().physics_frame
	_v3_marker("assistant-intro", "start")
	await get_tree().create_timer(V3_ASSISTANT_INTRO_SECONDS).timeout
	_v3_marker("assistant-intro", "end")
	_v3_pass_and_quit("assistant-intro", cam)


func _assistant_walk_right_clip() -> void:
	await get_tree().process_frame
	_v3_prepare_office()
	var assistant := _find("assistente")
	if assistant == null:
		push_error("promo V3 assistant-walk-right: Assistente assente")
		get_tree().quit(12)
		return
	_v3_stage(assistant, V3_ASSISTANT_WALK_FROM)
	_track_target = assistant
	_track_offset = V3_ASSISTANT_WALK_CAMERA_OFFSET
	_track_cam = _mount_camera(assistant.global_position + _track_offset,
			V3_ASSISTANT_WALK_ZOOM)
	# La tratta eccede la durata consegnata: il taglio termina mentre l'agente
	# e' ancora in walk verso destra, mai sul ritorno o su un freeze finale.
	_force_legs(assistant, [assistant._leg_to(V3_ASSISTANT_WALK_TO, "walk",
			V3_STILL_HOLD, "idle")])
	_v3_animate_background([assistant])
	await get_tree().physics_frame
	_v3_marker("assistant-walk-right", "start")
	await get_tree().create_timer(V3_ASSISTANT_WALK_SECONDS).timeout
	_v3_marker("assistant-walk-right", "end")
	_v3_pass_and_quit("assistant-walk-right", _track_cam)


## Blocca i viaggi casuali: la vita sullo sfondo e' data da pulsazioni di
## lavoro reali (rig o composito desk), non da agenti che invadono il quadro
## in momenti non deterministici. Rimuove anche tutti gli overlay promo.
func _v3_prepare_office() -> void:
	_dress_promo_set()
	_v3_silence_quest_markers()
	for agent in _office.agents:
		agent._state_timer = 100000.0
		agent._bubble_timer = 100000.0


func _v3_silence_quest_markers() -> void:
	for agent in _office.agents:
		if agent.quest_marker != null:
			agent.set_story_marker(false)


## La preparazione avviene prima del marker start. L'agente resta un vero
## AgentNPC e riparte attraverso NavGrid, ma il ciak non registra il lungo
## trasferimento dalla sua scrivania al punto di partenza.
func _v3_stage(agent: AgentNPC, at: Vector2) -> void:
	agent._legs = []
	agent._leg = {}
	agent._path = PackedVector2Array()
	agent._pi = 0
	agent._pause = 0.0
	agent._forced_trip = true
	agent._pipeline_trip_active = false
	agent.velocity = Vector2.ZERO
	agent._set_desk_occupied(false)
	agent.global_position = at
	agent.state = AgentNPC.S.WORK
	agent._set_rig_motion("down", false, "idle")


## Tre micro-eventi visibili nel set: chi lavora sullo sfondo non parla e non
## apre UI. I timer diversi evitano un flash sincrono da demo.
func _v3_animate_background(foreground: Array) -> void:
	var seconds := [1.1, 4.2, 7.1]
	var refs := ["scorer-1", "scrittore-1", "critico-1"]
	for i in refs.size():
		var agent := _find(str(refs[i]))
		if agent != null and not foreground.has(agent):
			_pulse_at(float(seconds[i]), agent)


func _v3_marker(clip: String, event: String) -> void:
	var frame := Engine.get_process_frames()
	print("PROMO-V3-MARKER\t%s\t%s\t%d\t%.3f" % [
		clip, event, frame, float(frame) / 30.0])


func _v3_pass_and_quit(clip: String, cam: Camera2D) -> void:
	if cam == null or _office.find_child("GameSidebar", true, false) != null:
		push_error("promo V3 %s: superficie non pulita" % clip)
		get_tree().quit(13)
		return
	print("PROMO-V3 PASS %s" % clip)
	get_tree().quit(0)


## Ciak uniforme per la recensione degli undici fogli personaggio. Tutte le
## tappe usano AgentNPC._leg_to + NavGrid: il filmato controlla il gioco vero,
## non un'animazione dimostrativa separata.
func _agent_review_clip() -> void:
	await get_tree().process_frame
	if not await _review_wait_for_live_profile():
		return
	_dress_promo_set()
	_review_role = OS.get_environment("JHT_PROMO_AGENT").strip_edges()
	# Il prodotto espone CAPITANO all'utente; nella scena lo slug storico e'
	# coordinatore. Accettiamo entrambi, ma il sidecar usa il nome pubblico.
	if _review_role == "capitano":
		_review_role = "coordinatore"
	if not CharacterDefs.AGENTS.has(_review_role):
		push_error("promo agent-review: ruolo sconosciuto '%s'" % _review_role)
		get_tree().quit(2)
		return
	var agent := _review_subject(_review_role)
	if agent == null:
		push_error("promo agent-review: agente assente '%s'" % _review_role)
		get_tree().quit(3)
		return
	for other in _office.agents:
		other._state_timer = 100000.0
		other._pause = 100000.0 if other != agent else other._pause
	await _wait_desk_stable(agent)
	_track_target = agent
	_track_offset = Vector2(0.0, -38.0)
	_track_cam = _mount_camera(agent.global_position + _track_offset, REVIEW_ZOOM)
	if not await _review_wait_for_trigger():
		return
	if _review_shutter:
		_review_shutter.queue_free()
		_review_shutter = null
		await get_tree().process_frame
		await get_tree().process_frame
	_review_frame_zero = Engine.get_process_frames()
	_review_marker("initial_sit")
	await get_tree().create_timer(REVIEW_HANDLE_SECONDS).timeout

	var pickup := _review_pickup(agent)
	var work_target: Vector2 = agent._spot if agent.dept != "" \
			else REVIEW_CORE_WORK.get(agent.slug, agent._spot)
	var legs: Array = []
	var directions_qa := OS.get_environment("JHT_PROMO_DIRECTIONS") == "1"
	print("PROMO-SCENE\t%s\t%s\t%s" % [
			OS.get_environment("JHT_PROMO_SCENE_ID"), _review_role_label(),
			"directions-qa" if directions_qa else "organic-workcycle"])
	if directions_qa:
		for point in REVIEW_LOOP:
			legs.append(agent._leg_to(point, "walk", REVIEW_TURN_HOLD, "idle"))
	var take: Dictionary = agent._leg_to(pickup, "walk", REVIEW_PICKUP_HOLD, "idle")
	if pickup == DepartmentDefs.POIS["printer"]["spot"]:
		take["fx_printer"] = true
	elif agent.dept != "" and DepartmentDefs.FETCH_FROM.has(agent.dept):
		take["pile_take"] = DepartmentDefs.FETCH_FROM[agent.dept]
	legs.append(take)
	var work: Dictionary = agent._leg_to(work_target, "carry", REVIEW_WORK_HOLD, "work")
	if agent.dept != "":
		work["desk_work"] = true
	legs.append(work)
	_review_append_delivery(agent, legs)
	legs.append(agent._leg_to(agent._spot, "walk", 0.0, "work"))
	_force_legs(agent, legs)

	while is_instance_valid(agent) and agent._desk_pose_active:
		await get_tree().process_frame
	_review_marker("rise")
	if directions_qa:
		while is_instance_valid(agent) \
				and agent.global_position.distance_to(REVIEW_LOOP[0]) > 18.0:
			await get_tree().process_frame
		await _review_mark_directions(agent)
	while is_instance_valid(agent) and not _review_at_pickup(agent, pickup):
		await get_tree().process_frame
	_review_marker("document_pickup")
	while is_instance_valid(agent) and not _review_at_work(agent, work_target):
		await get_tree().process_frame
	_review_marker("work")
	while is_instance_valid(agent) and not _review_is_returning(agent):
		await get_tree().process_frame
	_review_marker("return")
	while is_instance_valid(agent) and (agent._forced_trip or not agent._desk_pose_active):
		await get_tree().process_frame
	_review_marker("sit")
	await get_tree().create_timer(REVIEW_FINAL_HOLD).timeout
	_review_marker("end")
	print("PROMO-AGENT-REVIEW PASS %s" % _review_role_label())
	get_tree().quit()


## In release footage the office may be visible only after a real recording
## profile is connected and has replaced every demo position. The normal
## product warning remains untouched while the connection is incomplete.
func _review_wait_for_live_profile() -> bool:
	if OS.get_environment("JHT_PROMO_REQUIRE_LIVE") != "1":
		return true
	var deadline := Time.get_ticks_msec() + 90000
	while Time.get_ticks_msec() < deadline:
		if BackendBus.is_live() and not BackendBus.positions_are_demo \
				and not BackendBus.positions.is_empty():
			await get_tree().process_frame
			await get_tree().process_frame
			return true
		await get_tree().create_timer(0.1).timeout
	push_error("promo agent-review: profilo live non pronto entro 90 secondi")
	get_tree().quit(4)
	return false


func _review_install_shutter() -> void:
	_review_shutter = CanvasLayer.new()
	_review_shutter.layer = 10000
	var black := ColorRect.new()
	black.color = Color.BLACK
	black.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	black.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_review_shutter.add_child(black)
	_office.add_child(_review_shutter)


## Il profilo REL-004 puo' tenere spenti i processi LLM per non consumare
## provider durante le riprese. In quel caso il data-plane resta davvero
## locale/live (jobs.db e posizioni), mentre il soggetto visuale approvato e'
## quello dello showroom. Usiamo prima un processo reale del ruolo quando
## esiste; altrimenti riusiamo il relativo asset sintetico, dichiarandolo nel
## sidecar stdout. Movimento, navigazione e interazioni restano gli stessi
## componenti runtime di AgentNPC.
func _review_subject(role: String) -> AgentNPC:
	for candidate in _office.agents:
		if candidate.slug == role and not candidate.uid.is_empty() \
				and not candidate.is_dissolving():
			print("PROMO-SUBJECT\t%s\tlive-roster" % _review_role_label())
			return candidate
	for candidate in _office.agents:
		if candidate.slug == role and not candidate.is_dissolving():
			print("PROMO-SUBJECT\t%s\tsynthetic-profile" % _review_role_label())
			return candidate
	for def in CharacterDefs.spawn_list():
		if str(def.get("slug", "")) != role or not bool(def.get("lead", false)):
			continue
		var subject := AgentNPC.new()
		_office.world.add_child(subject)
		subject.setup(def, _office.nav)
		subject.set_backend_status("working")
		_office.agents.append(subject)
		print("PROMO-SUBJECT\t%s\tsynthetic-profile" % _review_role_label())
		return subject
	return null


## La cattura esterna parte soltanto quando il frame e' gia' live e pulito.
## Il file READY non contiene dati: sincronizza recorder e regia. Se non e'
## richiesto un trigger, i selftest e i ciak Movie Maker storici partono subito.
func _review_wait_for_trigger() -> bool:
	var ready_path := OS.get_environment("JHT_PROMO_READY_FILE")
	var trigger_path := OS.get_environment("JHT_PROMO_TRIGGER_FILE")
	if ready_path != "":
		var ready := FileAccess.open(ready_path, FileAccess.WRITE)
		if ready == null:
			push_error("promo agent-review: impossibile scrivere READY")
			get_tree().quit(5)
			return false
		ready.store_string("READY\n")
		ready.close()
	if trigger_path == "":
		return true
	var deadline := Time.get_ticks_msec() + 90000
	while Time.get_ticks_msec() < deadline:
		if FileAccess.file_exists(trigger_path):
			return true
		await get_tree().create_timer(0.05).timeout
	push_error("promo agent-review: trigger cattura assente dopo 90 secondi")
	get_tree().quit(6)
	return false


func _review_pickup(agent: AgentNPC) -> Vector2:
	if agent.slug == "mentor":
		return Vector2(2550.0, 1260.0)  # il volume preso dalla libreria
	if agent.dept != "" and DepartmentDefs.FETCH_FROM.has(agent.dept):
		return DepartmentDefs.handoff_spot(DepartmentDefs.FETCH_FROM[agent.dept], true)
	return DepartmentDefs.POIS["printer"]["spot"]


func _review_at_pickup(agent: AgentNPC, target: Vector2) -> bool:
	# L'effetto (stampante/pile_take) viene applicato in _arrive_at_leg, subito
	# prima della pausa. Solo la vicinanza geometrica segnerebbe il marker uno
	# o due frame prima che il documento sia davvero stato ritirato.
	return agent.global_position.distance_to(target) < 22.0 and agent._pause > 0.0


func _review_append_delivery(agent: AgentNPC, legs: Array) -> void:
	if agent.dept == "":
		return
	if agent.dept == "critici":
		legs.append(agent._leg_to(OutputShelf.RECT.get_center() + Vector2(0.0, 46.0),
				"carry", 0.8, "idle"))
		return
	var drop: Dictionary = agent._leg_to(DepartmentDefs.handoff_spot(agent.dept),
			"carry", 0.8, "idle")
	drop["pile_drop"] = agent.dept
	legs.append(drop)


func _review_mark_directions(agent: AgentNPC) -> void:
	var seen := {}
	while is_instance_valid(agent) and seen.size() < 4:
		var direction := ""
		match str(agent.rig.facing):
			"up": direction = "up"
			"down": direction = "down"
			"side": direction = "left" if bool(agent.rig.flipped) else "right"
		if direction != "" and not seen.has(direction):
			seen[direction] = true
			_review_marker(direction)
		await get_tree().process_frame


func _review_at_work(agent: AgentNPC, target: Vector2) -> bool:
	if agent.dept != "":
		return agent._desk_pose_active
	return agent.global_position.distance_to(target) < 22.0 \
			and str(agent.rig.mode) == "work"


func _review_is_returning(agent: AgentNPC) -> bool:
	if agent.state != AgentNPC.S.TRIP or agent._leg.is_empty():
		return false
	# Per i ruoli di reparto anche la tappa di lavoro punta alla scrivania, ma
	# vi arriva in modalita' carry. Il ritorno finale e' la tratta walk: senza
	# questa distinzione i marker work/return cadrebbero nello stesso frame.
	return str(agent._leg.get("mode", "")) == "walk" \
			and (agent._leg.get("target", Vector2.INF) as Vector2).distance_to(agent._spot) < 2.0


func _review_marker(event: String) -> void:
	var frame := Engine.get_process_frames() - _review_frame_zero
	print("PROMO-MARKER\t%s\t%s\t%d\t%.3f" % [
			_review_role_label(), event, frame, float(frame) / 30.0])


func _review_role_label() -> String:
	return "capitano" if _review_role == "coordinatore" else _review_role


## ── Attrezzeria dei clip nuovi ───────────────────────────────────────

## Vestizione comune: insegne inglesi, targhe di stato spente e HUD
## «JHT TEAM» rimosso (numeri aggregati: vietati dalla regia §7). E il
## chiacchiericcio ambientale degli agenti viene AZZERATO: le battute di
## contorno dello showroom sono in italiano (visto in un ciak: «studio
## meglio questa opportunità…» gigante in quadro) e con l'hold lungo delle
## vignette scaccerebbero quelle di regia. Parlano solo le battute dirette.
func _dress_promo_set() -> void:
	_dress_set_english()
	# La targa della mensola output («CV PRONTI») non è localizzata: per il
	# ciak inglese la si copre con una targa gemella in inglese, contatore
	# vero incluso — il Critico della Scena 4 consegna proprio lì.
	if OutputShelf.instance:
		var dub := ShelfDub.new()
		dub.position = OutputShelf.instance.position
		OutputShelf.instance.get_parent().add_child(dub)


## Risolve un riferimento posizionale ("scout-1", "critico-1"…) nello
## showroom, con la stessa porta usata dalle vignette broadcast.
func _find(ref: String) -> AgentNPC:
	return _office._find_agent(ref)


## Avvia un viaggio con tappe e pause FISSE, marciando al passo vero della
## pipeline: il ciak è ripetibile e il lavoro si vede come lavoro.
func _force_legs(agent: AgentNPC, legs: Array) -> void:
	if agent.state != AgentNPC.S.WORK:
		# Se l'agente è già in giro per conto suo il viaggio forzato non
		# partirebbe pulito: il ciak si rifà, non si rattoppa.
		push_warning("promo: agente non alla scrivania, ciak da ripetere")
	agent._legs = legs
	agent._forced_trip = true
	agent._pipeline_trip_active = true
	# Una desk-pause residua (S.TRIP con _pause lunga) congelerebbe la prima
	# tratta: _start_next_leg non azzera la pausa, va ripulita qui.
	agent._pause = 0.0
	agent._start_next_leg()


## Lampo di lavoro a tempo fisso: il corpo (o il mobile, da seduti) pulsa.
func _pulse_at(when: float, agent: AgentNPC) -> void:
	if agent == null:
		return
	await get_tree().create_timer(when).timeout
	if is_instance_valid(agent):
		agent.react_to_work()


func _mount_camera(at: Vector2, zoom: float) -> Camera2D:
	var cam := Camera2D.new()
	cam.position = at
	cam.zoom = Vector2(zoom, zoom)
	_office._stage.add_child(cam)
	cam.make_current()
	return cam


func _bubble_at(when: float, uid: String, text: String) -> void:
	await get_tree().create_timer(when).timeout
	BackendBus.publish_chat({"ts": Time.get_datetime_string_from_system(),
			"from": uid, "to": "all", "text": text})


func _silence_state_tags() -> void:
	for agent in _office.agents:
		if agent.state_tag:
			agent.state_tag.queue_free()
			agent.state_tag = null
	# La barra dei comandi camera in basso ("drag or WASD…") sta proprio
	# dove il montaggio appoggia le didascalie: via per la durata del ciak.
	var hint_text: String = UIStrings.t("office.camera_hint")
	for layer in _office.get_children():
		if layer is CanvasLayer:
			for child in layer.get_children():
				if child is Label and child.text == hint_text:
					child.visible = false


## Doppia in inglese le scritte di scena non ancora localizzate (targhe
## reparto, insegne di passaggio) e spegne il CTA del setup: il ciak mostra
## un ufficio già configurato. Tutto avviene solo su questa run.
func _dress_set_english() -> void:
	_hide_simulation_badge()
	_hide_promo_hud()
	_prepare_promo_agents()
	var stage: Node = _office._stage
	for child in stage.get_children():
		if child is DepartmentDressing:
			var index := child.get_index()
			var signs: Node2D = load("res://tools/promo_dept_signs.gd").new()
			stage.add_child(signs)
			stage.move_child(signs, index)
			child.queue_free()
			break
	for child in _office.world.get_children():
		if child is HandoffStation and HANDOFF_EN.has(child.dept):
			var pair: Array = HANDOFF_EN[child.dept]
			child.dept = str(pair[0])
			child.destination = str(pair[1])
			child.queue_redraw()
	for child in _office.get_children():
		if child is GameSidebar and is_instance_valid(child._setup_cta):
			# queue_free, non visible=false: SetupService pubblica lo stato in
			# asincrono e _on_setup_status lo riaccenderebbe a metà ripresa
			# (il guard is_instance_valid lì dentro copre il nodo rimosso).
			child._setup_cta.queue_free()


## Il badge è obbligatorio nel prodotto quando i dati sono demo. Il set promo
## è invece una scenografia sintetica dichiarata dal suo manifest: lasciarlo
## nel frame lo farebbe sembrare un dato di prodotto, non un asset animatic.
## Non tocca mai la normale UI, perché questa funzione esiste solo per JHT_PROMO.
func _hide_simulation_badge() -> void:
	for badge in _office.find_children("*", "SimBadge", true, false):
		badge.queue_free()


## Tutte le scene promo, incluse office/dept/chat, devono avere la stessa
## superficie prodotto-only. Il vecchio cleanup viveva solo nei clip nuovi e
## lasciava HUD aggregato e sidebar nei tre ciak storici.
func _hide_promo_hud() -> void:
	if "_team_hud" in _office and is_instance_valid(_office._team_hud):
		_office._team_hud.queue_free()
	for child in _office.get_children():
		if child is GameSidebar:
			child.queue_free()
		if child is CanvasLayer:
			for root in child.get_children():
				if root is Control:
					for overlay in root.get_children():
						if overlay is TeamHud or overlay is BudgetNotice \
								or overlay is HeadlessNotice \
								or overlay is UpdateNotice:
							overlay.queue_free()


## Nessuna targhetta showroom o battuta ambientale può entrare in un frame
## promo. Tenerlo qui rende identici i clip storici e quelli aggiunti dopo.
func _prepare_promo_agents() -> void:
	_silence_state_tags()
	for agent in _office.agents:
		agent._chatter = []
		agent._bubble_timer = 100000.0
		if agent.quest_marker:
			agent.quest_marker.queue_free()
			agent.quest_marker = null


## Targa inglese sopra lo scaffale output: copre la targa «CV PRONTI»
## (non ancora localizzata) con la stessa grafica e il contatore VERO.
## Solo scenografia del ciak: il gioco vero non cambia.
class ShelfDub extends Node2D:
	func _ready() -> void:
		z_index = 60

	func _process(_delta: float) -> void:
		queue_redraw()  # il contatore può cambiare durante il ciak

	func _draw() -> void:
		var shelf := OutputShelf.instance
		if shelf == null:
			return
		var half := OutputShelf.RECT.size / 2.0
		var plate := Rect2(Vector2(-52, -half.y - 30), Vector2(104, 22))
		draw_rect(plate, Palette.PANEL)
		draw_rect(plate, Color(Palette.GREEN, 0.7), false, 1.2)
		draw_string(ThemeDB.fallback_font, Vector2(-45, -half.y - 14),
				"CV READY  %d" % shelf._real, HORIZONTAL_ALIGNMENT_LEFT, -1, 12,
				Palette.GREEN)
