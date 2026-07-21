class_name Dialogues
## Alberi di dialogo scriptati (mock ma sensati per ruolo).
##
## Formato nodo: { "text": String, "pose": String?, "next": String? } oppure
## { "text", "choices": [{"text", "next"}] }. Il testo porta il TAG EMOZIONE
## inline in testa — "[caldo] Benvenuto…" — che il runner mappa
## sull'espressione del ritratto (pattern Night in the Woods / Yarn Spinner:
## pronto per un futuro output LLM). I segnaposto {mentor_tip},
## {positions}, {score_*} vengono risolti a runtime da TeamData.

const TREES := {
	"mentor": {
		"start": {
			"text": "[caldo] Benvenuto nel salotto. Qui il tempo scorre più lento, apposta. Come procede la tua ricerca?",
			"pose": "a",
			"choices": [
				{"text": "Mi sento sommerso.", "next": "ov1"},
				{"text": "Sono impaziente: voglio risultati.", "next": "im1"},
				{"text": "Come lavora il team, esattamente?", "next": "me1"},
			],
		},
		# ── ramo: sommerso ──
		"ov1": {
			"text": "[pensieroso] Capita a tutti. Una ricerca lavoro è una maratona corsa al buio: la fatica è normale. La fretta, no.",
			"pose": "d", "next": "ov2",
		},
		"ov2": {
			"text": "[caldo] Lascia il volume allo Scout e la precisione all'Analista. Tu tieni per te una sola cosa: la decisione.",
			"pose": "c", "next": "ov3",
		},
		"ov3": {
			"text": "[divertito] E se il rumore aumenta… la macchina del caffè è di là. Funziona meglio di quanto ammetta il Tesoriere.",
			"pose": "a", "next": "hub",
		},
		# ── ramo: impaziente ──
		"im1": {
			"text": "[severo] L'impazienza è un cattivo consulente. Lo Scorer non premia la fretta: premia la precisione.",
			"pose": "b", "next": "im2",
		},
		"im2": {
			"text": "[divertito] Detto ciò… ti capisco. Vuoi un trucco che accorcia i tempi senza tagliare gli angoli?",
			"pose": "a",
			"choices": [
				{"text": "Sentiamo.", "next": "im3"},
				{"text": "No, faccio a modo mio.", "next": "im4"},
			],
		},
		"im3": {
			"text": "[caldo] Guarda solo le posizioni sopra 70. Sotto quella soglia, il tempo che spendi vale più della probabilità che compri.",
			"pose": "c", "next": "hub",
		},
		"im4": {
			"text": "[sorpreso] No? Sei la prima persona che rifiuta una scorciatoia onesta. …Rispetto.",
			"pose": "a", "next": "hub",
		},
		# ── ramo: metodo ──
		"me1": {
			"text": "[neutro] Lo Scout raccoglie, l'Analista verifica, lo Scorer dà un numero da 0 a 100. Nessuna etichetta: il giudizio resta tuo.",
			"pose": "c", "next": "me2",
		},
		"me2": {
			"text": "[caldo] Io e l'Assistente, invece, ci occupiamo di te — non degli annunci. Noi prepariamo il tavolo, tu scegli le carte.",
			"pose": "a", "next": "hub",
		},
		# ── snodo comune ──
		"hub": {
			"text": "[caldo] C'è altro che posso fare per te?",
			"pose": "a",
			"choices": [
				{"text": "Un consiglio per i colloqui.", "next": "tip"},
				{"text": "Com'è la giornata del team?", "next": "day"},
				{"text": "Nulla, grazie.", "next": "end"},
			],
		},
		"tip": {
			"text": "[caldo] {mentor_tip}",
			"pose": "b", "next": "tip2",
		},
		"tip2": {
			"text": "[divertito] E ricorda: chi ti ascolta decide nei primi minuti. Il resto del colloquio serve a dargli ragione.",
			"pose": "a", "next": "hub",
		},
		"day": {
			"text": "[neutro] {positions_summary} Lo Scorer direbbe che è una giornata da {avg_score}.",
			"pose": "c", "next": "hub",
		},
		"end": {
			"text": "[caldo] Le porte della box sono sempre aperte. Torna quando vuoi.",
			"pose": "a",
		},
	},

	"scout": {
		"start": {
			"text": "[caldo] Ah, capiti a proposito. Il setaccio di oggi ha trattenuto 3 posizioni.",
			"pose": "a",
			"choices": [
				{"text": "Fammi vedere.", "next": "list"},
				{"text": "Dopo, grazie.", "next": "end"},
			],
		},
		"list": {
			"text": "[neutro] {positions}",
			"next": "note",
		},
		"note": {
			"text": "[pensieroso] Sulla terza c'è un nodo: chiedono tedesco B2. L'Analista sta verificando quanto sia negoziabile.",
			"next": "end",
		},
		"end": {
			"text": "[caldo] Io torno a caccia. Le board non si setacciano da sole.",
		},
	},

	"scorer": {
		"start": {
			"text": "[neutro] Ogni numero che scrivo ha una storia. Vuoi sapere perché «{score_title}» ha preso {score}?",
			"choices": [
				{"text": "Sì, spiegami lo score.", "next": "why"},
				{"text": "Mi fido del numero.", "next": "trust"},
			],
		},
		"why": {
			"text": "[pensieroso] {score_reasons}",
			"next": "why2",
		},
		"why2": {
			"text": "[caldo] Solo numeri da 0 a 100, mai etichette. Io peso i fatti: la scelta resta tua.",
			"next": "end",
		},
		"trust": {
			"text": "[caldo] Apprezzo. Ma fidati di più quando il numero sai come nasce: chiedimelo, quando vuoi.",
			"next": "end",
		},
		"end": {
			"text": "[neutro] Coda di valutazione: una posizione. Torno ai miei pesi.",
		},
	},

	"coordinatore": {
		"start": {
			"text": "[caldo] Benvenuto nella sala operativa. Vuoi capire il flusso o preparare l'attivazione del team?",
			"choices": [
				{"text": "Spiegami il flusso.", "next": "n2"},
				{"text": "Cosa serve per attivare il team?", "next": "setup"},
				{"text": "Faccio ancora un giro.", "next": "end"},
			],
		},
		"n2": {
			"text": "[severo] Se il Tesoriere alza un sopracciglio, rallento io prima che se ne accorga qualcuno.",
			"next": "n3",
		},
		"n3": {
			"text": "[caldo] Tu scegli le posizioni: al ritmo penso io. Puoi tornare a chiedermelo quando vuoi.",
			"next": "start",
		},
		"setup": {
			"text": "[neutro] Tre cose: container attivo, login al provider e profilo personale con l'Assistente. Il pulsante giallo in alto tiene il conto.",
			"next": "start",
		},
		"end": {
			"text": "[caldo] Esplora pure. Nessuna procedura ti chiude fuori dall'ufficio.",
		},
	},

	"analista": {
		"start": {
			"text": "[pensieroso] Io verifico ciò che un annuncio sostiene. Cosa vuoi osservare?",
			"choices": [
				{"text": "Stipendio e sede.", "next": "n2"},
				{"text": "Segnali di rischio.", "next": "risk"},
				{"text": "Torno dopo.", "next": "end"},
			],
		},
		"n2": {
			"text": "[caldo] Incrocio fonti, valuta, costo locale e modalità reale. Se manca una prova, la scheda lo dice chiaramente.",
			"next": "start",
		},
		"risk": {
			"text": "[severo] Titolo vago, requisiti contraddittori, salario opaco e dominio sospetto. Non invento certezze: espongo il dubbio.",
			"next": "start",
		},
		"end": {"text": "[neutro] Le fonti restano qui. Torna quando vuoi."},
	},

	"scrittore": {
		"start": {"text": "[caldo] Qui un CV generico diventa una risposta precisa. Da cosa vuoi partire?", "choices": [
			{"text": "Come adatti il CV?", "next": "cv"},
			{"text": "E la lettera?", "next": "letter"},
			{"text": "Non ancora.", "next": "end"}]},
		"cv": {"text": "[neutro] Porto in alto le prove rilevanti, uso le parole dell'annuncio senza copiarlo e non invento mai esperienza.", "next": "start"},
		"letter": {"text": "[caldo] Una pagina, una motivazione concreta e due connessioni verificabili tra persona e ruolo.", "next": "start"},
		"end": {"text": "[caldo] La pila resta qui: potrai aprirla e vedere ogni lavoro."},
	},
	"critico": {
		"start": {"text": "[severo] Io sono l'ultimo controllo prima dell'uscita. Vuoi sapere cosa boccio?", "choices": [
			{"text": "Sì, fammi l'elenco.", "next": "checks"},
			{"text": "Cosa significa PASS?", "next": "pass"},
			{"text": "Preferisco non saperlo.", "next": "end"}]},
		"checks": {"text": "[neutro] Invenzioni, tono artificiale, requisiti ignorati, refusi e risultati senza prova. Anche una frase bella può essere sbagliata.", "next": "start"},
		"pass": {"text": "[caldo] Significa pronto per la tua revisione, non spedito automaticamente. L'ultima parola resta tua.", "next": "start"},
		"end": {"text": "[divertito] Saggia decisione. Io invece devo saperlo."},
	},
	"sentinella": {
		"start": {"text": "[neutro] Sorveglio processi, code e limiti. Cosa vuoi controllare?", "choices": [
			{"text": "Privacy e confini.", "next": "privacy"},
			{"text": "Cosa accade se qualcosa cade?", "next": "health"},
			{"text": "Continua la ronda.", "next": "end"}]},
		"privacy": {"text": "[severo] Senza provider nessun testo libero parte. Con il provider, solo la chat scelta raggiunge il tuo runtime.", "next": "start"},
		"health": {"text": "[caldo] Segnalo il guasto, fermo il ritmo e lascio al Dottore una diagnosi leggibile. Niente fallimenti silenziosi.", "next": "start"},
		"end": {"text": "[neutro] Ronda ripresa."},
	},
	"dottore": {
		"start": {"text": "[caldo] Io curo il sistema, non il candidato. Vuoi una visita rapida?", "choices": [
			{"text": "Cosa controlli?", "next": "check"},
			{"text": "Quando intervieni?", "next": "when"},
			{"text": "Sto bene così.", "next": "end"}]},
		"check": {"text": "[neutro] Contesto, log, dipendenze e processi bloccati. Propongo una cura prima di modificare qualcosa.", "next": "start"},
		"when": {"text": "[pensieroso] Su richiesta o quando la Sentinella trova un sintomo ripetuto. Non disturbo un agente sano.", "next": "start"},
		"end": {"text": "[caldo] Ottimo. La prevenzione migliore è capire la macchina."},
	},
	"mantenitore": {
		"start": {"text": "[neutro] Tengo in ordine runtime, aggiornamenti e backup. Cosa ti incuriosisce?", "choices": [
			{"text": "Il container.", "next": "container"},
			{"text": "Gli aggiornamenti.", "next": "updates"},
			{"text": "Torno più tardi.", "next": "end"}]},
		"container": {"text": "[caldo] È il confine operativo del team: strumenti, skill e dati restano riproducibili e ispezionabili.", "next": "start"},
		"updates": {"text": "[neutro] Un riavvio ricostruisce le skill dichiarate dagli agenti. Nessun pezzo nascosto in un terminale esterno.", "next": "start"},
		"end": {"text": "[caldo] Io resto qui con la chiave inglese."},
	},

	# ── Visite proattive: l'agente viene alla TUA scrivania ──
	"scout_visit": {
		"start": {
			"text": "[caldo] Scusa se ti inseguo per l'ufficio: il setaccio di oggi è buono e non volevo tenermelo.",
			"choices": [
				{"text": "Dimmi tutto.", "next": "list"},
				{"text": "Ora no, torna dopo.", "next": "later"},
			],
		},
		"list": {
			"text": "[neutro] {positions}",
			"next": "best",
		},
		"best": {
			"text": "[pensieroso] La prima è la più solida: {score_title}, score {score}. Se fossi in te partirei da lì.",
			"next": "end",
		},
		"later": {
			"text": "[neutro] Ricevuto. Le lascio sulla lavagna: non scappano. …Le posizioni, non le aziende.",
		},
		"end": {
			"text": "[caldo] Buona caccia. Io torno alle board.",
		},
	},
	"scorer_visit": {
		"start": {
			"text": "[pensieroso] Ho appena chiuso una valutazione e c'è un numero che merita due parole: {score} su «{score_title}».",
			"choices": [
				{"text": "Perché proprio {score}?", "next": "why"},
				{"text": "Mi fido, grazie.", "next": "end"},
			],
		},
		"why": {
			"text": "[neutro] {score_reasons}",
			"next": "end",
		},
		"end": {
			"text": "[caldo] Il numero è mio, la decisione è tua. Come dev'essere.",
		},
	},

	## Accoglienza del tour di primo avvio (TourGuide): il giro completo —
	## cosa puoi fare, cosa non ancora, chi ascoltare e in che ordine.
	"assistente_tour": {
		"start": {
			"text": "[caldo] Eccoti! Benvenuto nel TUO ufficio: qui lavora il team che cercherà lavoro per te. Ogni persona che vedi ha un compito preciso. Ti faccio fare il giro?",
			"pose": "a",
			"choices": [
				{"text": "Guidami.", "next": "do1"},
				{"text": "Prima dimmi: cosa posso fare qui?", "next": "can1"},
				{"text": "E cosa NON posso ancora fare?", "next": "cant1"},
			],
		},
		"can1": {
			"text": "[neutro] Puoi muoverti liberamente: trascina col mouse o usa WASD, zoom con la rotella. Clicca una persona per parlarle, un reparto per aprirne il pannello.",
			"pose": "b", "next": "can2",
		},
		"can2": {
			"text": "[neutro] Anche gli oggetti parlano: la bacheca è il registro delle candidature, il mappamondo apre la mappa delle offerte, le pile di fogli sono le code di lavoro e lo scaffale contiene i CV pronti.",
			"pose": "b", "next": "can3",
		},
		"can3": {
			"text": "[caldo] E la linguetta ≡ in alto a sinistra apre tutte le pagine: profilo, posizioni, statistiche, impostazioni. Nessuna procedura ti chiude mai fuori dall'ufficio.",
			"pose": "a", "next": "hub",
		},
		"cant1": {
			"text": "[pensieroso] Finché non colleghi un provider AI, la chat libera resta spenta: parliamo per scelte guidate, sicure e gratuite. E il team non lavora finché la checklist di lancio non è tutta verde.",
			"pose": "c", "next": "cant2",
		},
		"cant2": {
			"text": "[caldo] Non è un limite: è una garanzia. Nessun token speso e nessun dato inviato finché non lo decidi tu.",
			"pose": "a", "next": "hub",
		},
		"hub": {
			"text": "[caldo] Vuoi sapere altro o partiamo col giro?",
			"pose": "a",
			"choices": [
				{"text": "Cosa posso fare qui?", "next": "can1"},
				{"text": "Cosa non posso ancora fare?", "next": "cant1"},
				{"text": "Partiamo col giro.", "next": "do1"},
			],
		},
		"do1": {
			"text": "[neutro] Il giro segue il viaggio di un annuncio: lo Scout lo trova, l'Analista lo verifica, lo Scorer gli dà un numero da 0 a 100, lo Scrittore prepara CV e lettera, il Critico li approva.",
			"pose": "b", "next": "do2",
		},
		"do2": {
			"text": "[caldo] Poi passiamo dal Coordinatore per preparare il lancio del team e dal Mentor per le tue priorità. La to-do list a sinistra tiene il conto per te.",
			"pose": "a", "next": "do3",
		},
		"do3": {
			"text": "[divertito] Segui il diamante che pulsa: si comincia dallo Scout. Se ti perdi, la camera ti accompagna lei dal prossimo ospite.",
			"pose": "a",
		},
	},

	"assistente": {
		"start": {
			"text": "[caldo] Sono la tua guida nell'ufficio. Da dove vuoi cominciare?",
			"pose": "a", "choices": [
				{"text": "Fammi fare il tour.", "next": "tour"},
				{"text": "Cosa serve per partire?", "next": "setup"},
				{"text": "Voglio solo esplorare.", "next": "end"},
			],
		},
		"tour": {"text": "[neutro] Segui i diamanti: Scout trova, Analista verifica, Scorer pesa, Scrittore prepara e Critico revisiona. I ruoli centrali tengono il sistema sano.", "next": "start"},
		"setup": {"text": "[caldo] Container, login al provider e profilo personale. Finché non colleghi il provider puoi parlare con noi solo tramite scelte sicure e ripetibili.", "next": "start"},
		"end": {"text": "[divertito] Perfetto. Il caffè è gratis e ogni conversazione può ricominciare."},
	},
}

## Risolve i segnaposto dinamici con i dati di TeamData (mock oggi, reali domani).
static func resolve_placeholders(text: String, team_data: Node) -> String:
	if text.find("{") == -1:
		return text
	var positions: Array = team_data.positions_today()
	var pos_lines := ""
	for p in positions:
		pos_lines += "  %d · %s — %s (%s)\n" % [p["score"], p["title"], p["company"], p["location"]]
	var expl: Dictionary = team_data.score_explanation()
	var reasons := ""
	for r in expl["reasons"]:
		reasons += "  · %s\n" % r
	var summary: Dictionary = team_data.summary()
	return text.format({
		"mentor_tip": team_data.mentor_tip(),
		"positions": pos_lines.strip_edges(),
		"positions_summary": "Lo Scout ha portato %d posizioni nuove." % summary["positions_today"],
		"avg_score": str(summary["avg_score"]),
		"score_title": expl["title"],
		"score_company": expl["company"],
		"score": str(expl["score"]),
		"score_reasons": reasons.strip_edges(),
	})

## Estrae il tag emozione inline: "[caldo] Ciao" → ["caldo", "Ciao"].
static func parse_emotion(text: String) -> Array:
	if text.begins_with("["):
		var close := text.find("]")
		if close > 0:
			return [text.substr(1, close - 1), text.substr(close + 1).strip_edges()]
	return ["neutro", text]
