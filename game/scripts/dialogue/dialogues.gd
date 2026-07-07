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
			"text": "[neutro] Ritmo regolare: weekly al 64%, budget sotto la soglia. Nessun collo di bottiglia.",
			"next": "n2",
		},
		"n2": {
			"text": "[severo] Se il Tesoriere alza un sopracciglio, rallento io prima che se ne accorga qualcuno.",
			"next": "n3",
		},
		"n3": {
			"text": "[caldo] Tu pensa a scegliere le posizioni: al ritmo penso io.",
		},
	},

	"analista": {
		"start": {
			"text": "[pensieroso] Sto incrociando tre fonti su uno stipendio che l'annuncio non dichiara. Qualcuno, qui, è ottimista.",
			"next": "n2",
		},
		"n2": {
			"text": "[caldo] Quando un annuncio esagera, me ne accorgo. Quando mente, lo scrivo nella scheda.",
		},
	},

	"assistente": {
		"start": {
			"text": "[caldo] Tutto bene? Se cerchi un consiglio di carriera, il Mentor è nel salotto, vicino alla lampada.",
			"pose": "a", "next": "n2",
		},
		"n2": {
			"text": "[divertito] …e sì, il caffè della macchina è gratis. Budget del team permettendo.",
			"pose": "b",
		},
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
