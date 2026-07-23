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
			"text": "[caldo] Qui non devi fare tutto da solo. Le persone nei reparti cercano, studiano e preparano le opportunità per te. A te resta la parte importante: capire quale futuro vuoi scegliere.",
			"pose": "c", "next": "ov3",
		},
		"ov3": {
			"text": "[divertito] E se il rumore aumenta… la macchina del caffè è di là. Funziona meglio di quanto ammetta il Tesoriere.",
			"pose": "a", "next": "hub",
		},
		# ── ramo: impaziente ──
		"im1": {
			"text": "[severo] L'impazienza è un cattivo consulente. Questo ufficio non serve a riempirti di offerte qualsiasi: serve a farti incontrare quelle che meritano davvero il tuo tempo.",
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
			"text": "[neutro] Pensa a un vero ufficio che lavora per te: un reparto cerca le opportunità, uno le studia, uno capisce quanto ti assomigliano e un altro prepara la candidatura. Ognuno fa bene una parte, così tu non devi inseguire tutto.",
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
			"text": "[neutro] {positions_summary} Alcune sembrano ordinarie, altre potrebbero davvero valere una conversazione: il lavoro di oggi è separarle bene.",
			"pose": "c", "next": "hub",
		},
		"end": {
			"text": "[caldo] Le porte della box sono sempre aperte. Torna quando vuoi.",
			"pose": "a",
		},
	},

	"scout": {
		"start": {
			"text": "[caldo] Ah, capiti a proposito. Sono uno dei Ricercatori: oggi abbiamo trovato tre offerte che potrebbero interessarti.",
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
			"text": "[pensieroso] Sulla terza c'è un dubbio: chiedono tedesco B2. I colleghi dell'Analisi stanno cercando di capire se sia davvero indispensabile.",
			"next": "end",
		},
		"end": {
			"text": "[caldo] Io torno alle ricerche. Il web è grande, ma siamo qui proprio per questo.",
		},
	},

	"scorer": {
		"start": {
			"text": "[neutro] Lavoro nel reparto Compatibilità. Abbiamo studiato quanto «{score_title}» potrebbe essere adatta a te. Vuoi sapere cosa ne pensiamo?",
			"choices": [
				{"text": "Sì, raccontami perché potrebbe fare per me.", "next": "why"},
				{"text": "Per ora mi basta il vostro parere.", "next": "trust"},
			],
		},
		"why": {
			"text": "[pensieroso] {score_reasons}",
			"next": "why2",
		},
		"why2": {
			"text": "[caldo] Il nostro parere ti aiuta a orientarti, ma non decide al posto tuo. Noi mettiamo in ordine i motivi; l'ultima parola resta sempre tua.",
			"next": "end",
		},
		"trust": {
			"text": "[caldo] Apprezzo. Quando vorrai, però, ti racconterò anche cosa ci convince e cosa ci lascia dubbiosi: un parere è utile solo se lo puoi capire.",
			"next": "end",
		},
		"end": {
			"text": "[neutro] Ho ancora un'opportunità da confrontare col tuo profilo. Torno al lavoro.",
		},
	},

	"coordinatore": {
		"start": {
			"text": "[caldo] Benvenuto nella direzione. Vuoi capire come collaborano i reparti o preparare l'ufficio per il primo giorno di lavoro?",
			"choices": [
				{"text": "Come collaborano i reparti?", "next": "n2"},
				{"text": "Cosa serve per iniziare davvero?", "next": "setup"},
				{"text": "Faccio ancora un giro.", "next": "end"},
			],
		},
		"n2": {
			"text": "[neutro] Io distribuisco il lavoro: la Ricerca porta nuove opportunità, l'Analisi le studia, la Compatibilità sceglie quelle più vicine a te e gli ultimi reparti preparano e controllano i documenti.",
			"next": "n3",
		},
		"n3": {
			"text": "[caldo] Tu non devi dirigere ogni singola persona. Mi dici le tue priorità, io organizzo la giornata e ti porto soltanto le decisioni che hanno bisogno di te.",
			"next": "start",
		},
		"setup": {
			"text": "[neutro] Servono tre cose semplici: dare all'ufficio un posto dove lavorare, collegare l'intelligenza che aiuterà i dipendenti e raccontarci chi sei. La lista in alto ti accompagna passo dopo passo.",
			"next": "start",
		},
		"end": {
			"text": "[caldo] Esplora pure. Nessuna procedura ti chiude fuori dall'ufficio.",
		},
	},

	"analista": {
		"start": {
			"text": "[pensieroso] Lavoro nel reparto Analisi. Quando la Ricerca trova un'opportunità, noi la studiamo con calma per capire che lavoro è davvero e che azienda c'è dietro. Cosa ti interessa sapere?",
			"choices": [
				{"text": "Stipendio e sede.", "next": "n2"},
				{"text": "Segnali di rischio.", "next": "risk"},
				{"text": "Torno dopo.", "next": "end"},
			],
		},
		"n2": {
			"text": "[caldo] Cerchiamo di capire dove lavoreresti, quanto potresti guadagnare e quanto sarebbe comoda quella vita per te. Se qualcosa non è chiaro, te lo diciamo senza fingere di saperlo.",
			"next": "start",
		},
		"risk": {
			"text": "[severo] Guardiamo se l'offerta sembra seria, se le richieste hanno senso e se l'azienda mantiene ciò che promette. Quando qualcosa non torna, lo mettiamo bene in evidenza.",
			"next": "start",
		},
		"end": {"text": "[neutro] Le fonti restano qui. Torna quando vuoi."},
	},

	"scrittore": {
		"start": {"text": "[caldo] Benvenuto nel reparto Candidature. Noi raccontiamo la tua esperienza nel modo più adatto al lavoro che hai scelto, senza trasformarti in qualcun altro. Da cosa vuoi partire?", "choices": [
			{"text": "Come adatti il CV?", "next": "cv"},
			{"text": "E la lettera?", "next": "letter"},
			{"text": "Non ancora.", "next": "end"}]},
		"cv": {"text": "[neutro] Metto in primo piano le esperienze che aiutano quell'azienda a capirti subito. Non aggiungo meriti che non hai e non cancello la tua voce.", "next": "start"},
		"letter": {"text": "[caldo] La lettera spiega con parole semplici perché proprio quel lavoro e perché proprio tu. Deve sembrare scritta da una persona, non uscita da una fabbrica.", "next": "start"},
		"end": {"text": "[caldo] La pila resta qui: potrai aprirla e vedere ogni lavoro."},
	},
	"critico": {
		"start": {"text": "[severo] Benvenuto al Controllo qualità. Prima che un documento arrivi a te, io lo leggo come farebbe un selezionatore con poco tempo. Vuoi sapere cosa rimando indietro?", "choices": [
			{"text": "Sì, fammi l'elenco.", "next": "checks"},
			{"text": "Cosa significa PASS?", "next": "pass"},
			{"text": "Preferisco non saperlo.", "next": "end"}]},
		"checks": {"text": "[neutro] Rimando indietro ciò che suona falso, confuso o poco credibile. Un documento deve raccontare bene la tua storia e rispettare il lavoro per cui ti presenti.", "next": "start"},
		"pass": {"text": "[caldo] Significa che il documento è abbastanza chiaro e convincente da arrivare sulla tua scrivania. Non parte nulla senza che tu possa vederlo.", "next": "start"},
		"end": {"text": "[divertito] Saggia decisione. Io invece devo saperlo."},
	},
	"sentinella": {
		"start": {"text": "[neutro] Sono la Sentinella. Faccio la ronda, proteggo ciò che ci affidi e mi assicuro che in ufficio si lavori con ordine. Cosa vuoi sapere?", "choices": [
			{"text": "Privacy e confini.", "next": "privacy"},
			{"text": "Cosa accade se qualcosa cade?", "next": "health"},
			{"text": "Continua la ronda.", "next": "end"}]},
		"privacy": {"text": "[severo] Le informazioni che ci dai servono soltanto a lavorare per te. Restano nella casa che hai scelto per l'ufficio e nessuno le usa per incarichi che non hai autorizzato.", "next": "start"},
		"health": {"text": "[caldo] Me ne accorgo, metto al sicuro il lavoro già fatto e chiamo il Dottore. Se serve una tua decisione, veniamo a cercarti: niente problemi nascosti sotto il tappeto.", "next": "start"},
		"end": {"text": "[neutro] Ronda ripresa."},
	},
	"dottore": {
		"start": {"text": "[caldo] Sono il Dottore dell'ufficio. Mi occupo dei colleghi quando rallentano, si confondono o non riescono a finire un incarico. Vuoi una visita rapida?", "choices": [
			{"text": "Cosa controlli?", "next": "check"},
			{"text": "Quando intervieni?", "next": "when"},
			{"text": "Sto bene così.", "next": "end"}]},
		"check": {"text": "[neutro] Cerco il punto in cui il lavoro si è fermato, capisco cosa manca e propongo una cura. Prima di fare qualcosa di importante, te lo spiego.", "next": "start"},
		"when": {"text": "[pensieroso] Quando me lo chiedi tu o quando la Sentinella vede lo stesso problema tornare più volte. Non disturbo chi sta lavorando bene.", "next": "start"},
		"end": {"text": "[caldo] Ottimo. Un ufficio sano è quello in cui quasi ti dimentichi che il Dottore esiste."},
	},
	"mantenitore": {
		"start": {"text": "[neutro] Sono il Responsabile della manutenzione. Tengo in ordine gli strumenti, preparo gli aggiornamenti e conservo copie di sicurezza. Cosa ti incuriosisce?", "choices": [
			{"text": "Dove lavora davvero la squadra?", "next": "container"},
			{"text": "Gli aggiornamenti.", "next": "updates"},
			{"text": "Torno più tardi.", "next": "end"}]},
		"container": {"text": "[caldo] In una stanza di lavoro riservata, separata dal resto del computer. Lì teniamo strumenti e documenti dell'ufficio, così tutto resta ordinato e controllabile.", "next": "start"},
		"updates": {"text": "[neutro] Preparo i cambiamenti, salvo ciò che conta e controllo che la squadra riparta bene. Se qualcosa non va, posso tornare alla situazione precedente.", "next": "start"},
		"end": {"text": "[caldo] Io resto qui con la chiave inglese."},
	},

	# ── Visite proattive: l'agente viene alla TUA scrivania ──
	"scout_visit": {
		"start": {
			"text": "[caldo] Scusa se ti inseguo per l'ufficio: il reparto Ricerca ha trovato alcune opportunità che vale la pena farti vedere.",
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
			"text": "[pensieroso] Quella che ci sembra più vicina a ciò che cerchi è «{score_title}». Io partirei da lì, ma puoi guardarle tutte con calma.",
			"next": "end",
		},
		"later": {
			"text": "[neutro] Ricevuto. Le lascio sulla lavagna: non scappano. …Le posizioni, non le aziende.",
		},
		"end": {
			"text": "[caldo] Io torno alle ricerche. Se trovo qualcosa di speciale, ti avviso.",
		},
	},
	"scorer_visit": {
		"start": {
			"text": "[pensieroso] Nel reparto Compatibilità abbiamo appena finito di studiare «{score_title}». Pensiamo che meriti la tua attenzione.",
			"choices": [
				{"text": "Perché pensate che sia adatta a me?", "next": "why"},
				{"text": "Mi fido, grazie.", "next": "end"},
			],
		},
		"why": {
			"text": "[neutro] {score_reasons}",
			"next": "end",
		},
		"end": {
			"text": "[caldo] Il nostro parere ti aiuta a scegliere, ma l'ultima parola resta sempre tua. Come dev'essere.",
		},
	},

	# ── Tour di primo avvio (TourGuide): l'Assistente ACCOMPAGNA fisicamente
	# l'utente di reparto in reparto e presenta lei ogni tappa; Mentor e
	# Coordinatore parlano invece in prima persona. Regole (feedback Leone
	# 21/07): saluto in base all'orario, niente elenco di limiti, opzioni mai
	# ripetute identiche, esempi concreti e universali, tono personale. ──

	"tour_benvenuto": {
		"start": {
			"text": "[caldo] {greeting}{player}! Benvenuto nel tuo ufficio. Da oggi tutte le persone che vedi lavorano per una persona sola: tu.",
			"pose": "a", "next": "n2",
		},
		"n2": {
			"text": "[caldo] Io sono l'Assistente, la tua persona di fiducia qui dentro. Se vuoi ti presento io la squadra — oppure giri da solo e ti raccontano tutto loro. Come preferisci?",
			"pose": "a",
			"choices": [
				{"text": "Fammi strada tu.", "next": "go"},
				{"text": "Preferisco girare da solo.", "next": "solo"},
				{"text": "Prima dimmi: cosa posso fare qui?", "next": "can1"},
				{"text": "Quanto dura il giro?", "next": "duration"},
				{"text": "I miei dati restano privati?", "next": "privacy"},
			],
		},
		"solo": {
			"text": "[divertito] Padronissimo: l'ufficio è tuo. Vai dove ti incuriosisce e clicca chi ha il diamante sopra la testa: si presenteranno da soli. Io resto qui per qualsiasi cosa.",
			"pose": "a", "action": "tour:free",
		},
		"duration": {
			"text": "[caldo] Pochi minuti, ma sei tu a dare il ritmo. Puoi chiudere, esplorare e riprendere: ricorderò dove eravamo.",
			"pose": "a", "next": "ready",
		},
		"privacy": {
			"text": "[neutro] Quello che racconti serve alla squadra per conoscerti e lavorare meglio per te. Resta nel tuo ufficio e potrai sempre rileggerlo, correggerlo o cancellarlo dal Profilo.",
			"pose": "b", "next": "ready",
		},
		"can1": {
			"text": "[neutro] Puoi girare liberamente: trascina la vista, avvicinati, clicca persone e oggetti. La bacheca è il registro delle candidature, il mappamondo apre la mappa delle offerte, lo scaffale custodisce i CV pronti.",
			"pose": "b", "next": "can2",
		},
		"can2": {
			"text": "[caldo] Con me, il Coordinatore e il Mentor parlerai spesso: siamo qui per te. E quando collegherai il tuo assistente AI, potrai scriverci liberamente, come in una chat.",
			"pose": "a", "next": "ready",
		},
		"ready": {
			"text": "[divertito] Pronto? Se vuoi si comincia dal reparto Ricerca, dove i colleghi cercano opportunità per te. Oppure vai per conto tuo, senza offesa.",
			"pose": "a",
			"choices": [
				{"text": "Andiamo insieme.", "next": "go"},
				{"text": "Faccio da solo, grazie.", "next": "solo"},
				{"text": "Me lo riassumi in una riga?", "next": "recap"},
			],
		},
		"recap": {
			"text": "[caldo] Esplora, clicca, chiedi: l'ufficio è tutto tuo. Il resto te lo mostro strada facendo.",
			"pose": "a", "next": "go",
		},
		"go": {
			"text": "[caldo] Seguimi, ti faccio strada io.",
			"pose": "a",
		},
	},

	"tour_scout": {
		"start": {
			"text": "[caldo] Benvenuto nel reparto Ricerca. Io e gli altri Ricercatori giriamo il web, consultiamo le pagine delle aziende e cerchiamo offerte di lavoro che potrebbero interessarti.",
			"pose": "a", "next": "n2",
		},
		"n2": {
			"text": "[neutro] Non cerchiamo alla cieca. Impariamo quali lavori, luoghi e aziende ti interessano e portiamo in ufficio le opportunità che vale la pena conoscere. Se vuoi cambiare direzione, basta dirlo al Coordinatore.",
			"pose": "b",
			"choices": [
				{"text": "E io dove vedo quello che trovano?", "next": "see"},
				{"text": "Posso indicare aziende o tipi di lavoro preferiti?", "next": "sources"},
				{"text": "Come fate a non farmi perdere tempo?", "next": "duplicates"},
				{"text": "Posso chiedervi una pausa?", "next": "pause"},
				{"text": "Chiaro, andiamo avanti.", "next": "end"},
			],
		},
		"see": {
			"text": "[caldo] Nella bacheca in sala e nella pagina Posizioni: ogni annuncio con la sua storia completa. Un click e sei dentro.",
			"pose": "a", "next": "end2",
		},
		"sources": {
			"text": "[caldo] Certo. Puoi dirci quali aziende ti attirano, dove vuoi lavorare e che tipo di ruolo desideri. Le ricerche successive seguiranno le tue indicazioni.",
			"pose": "a", "next": "end2",
		},
		"duplicates": {
			"text": "[neutro] Prima di portarti un'offerta controlliamo che sia ancora utile e che non te l'abbiamo già mostrata. Tu vedrai un elenco pulito, non la confusione che c'è sul web.",
			"pose": "b", "next": "end2",
		},
		"pause": {
			"text": "[caldo] Certo. Il reparto Ricerca può fermarsi mentre il resto dell'ufficio continua a occuparsi delle opportunità già trovate.",
			"pose": "a", "next": "end2",
		},
		"end": {
			"text": "[divertito] Ti lascio di nuovo con l'Assistente: ti accompagnerà nel reparto Analisi, dai pignoli del gruppo.",
			"pose": "a",
		},
		"end2": {
			"text": "[caldo] L'Assistente ti accompagna ora nel reparto Analisi: lì studiano con calma tutto ciò che troviamo.",
			"pose": "a",
		},
	},

	"tour_analisti": {
		"start": {
			"text": "[caldo] Benvenuto nel reparto Analisi. Noi Analisti riceviamo le opportunità trovate dai Ricercatori e le studiamo nel dettaglio.",
			"pose": "a", "next": "n2",
		},
		"n2": {
			"text": "[neutro] Cerchiamo di capire che lavoro è davvero, chi sta assumendo, cosa offre e quali dubbi restano. Quando arriverà il momento di scegliere, avrai davanti un quadro chiaro invece di un annuncio confuso.",
			"pose": "b",
			"choices": [
				{"text": "E a me cosa cambia?", "next": "why"},
				{"text": "Quanto sono affidabili stipendio e sede?", "next": "accuracy"},
				{"text": "Cosa succede se mancano informazioni?", "next": "missing"},
				{"text": "Posso chiedere un'analisi più approfondita?", "next": "deeper"},
				{"text": "Capito, proseguiamo.", "next": "end"},
			],
		},
		"why": {
			"text": "[caldo] Significa che non dovrai passare ore a interpretare ogni annuncio. Aprirai una posizione e troverai già le informazioni necessarie per capire se merita il tuo tempo.",
			"pose": "a", "next": "end2",
		},
		"accuracy": {
			"text": "[neutro] Ti diciamo sempre cosa è certo e cosa è soltanto probabile. Se un'informazione non è chiara, la indichiamo come dubbio e non come verità.",
			"pose": "b", "next": "end2",
		},
		"missing": {
			"text": "[caldo] La posizione resta visibile con i vuoti dichiarati. Nessun dato viene inventato: potrai decidere se vale la pena approfondire.",
			"pose": "a", "next": "end2",
		},
		"deeper": {
			"text": "[caldo] Sì. Da ogni posizione puoi chiedere all'ufficio di approfondire un dubbio; il Coordinatore troverà il collega giusto e aggiungerà la risposta alla scheda.",
			"pose": "a", "next": "end2",
		},
		"end": {
			"text": "[caldo] Ora l'Assistente ti porta nel reparto Compatibilità, dove si capisce quanto ogni opportunità assomiglia a ciò che vuoi davvero.",
			"pose": "a",
		},
		"end2": {
			"text": "[divertito] Ti lascio ai Consulenti di compatibilità: l'Assistente ti fa strada fino a loro.",
			"pose": "a",
		},
	},

	"tour_scorer": {
		"start": {
			"text": "[caldo] Benvenuto nel reparto Compatibilità. Noi Consulenti confrontiamo ogni opportunità con la persona che sei e con il lavoro che desideri.",
			"pose": "a", "next": "n2",
		},
		"n2": {
			"text": "[neutro] Usiamo tutto ciò che i reparti Ricerca e Analisi hanno scoperto, insieme a quello che hai raccontato di te. Il risultato è un parere chiaro su quanto quel lavoro potrebbe fare al caso tuo.",
			"pose": "b", "next": "n3",
		},
		"n3": {
			"text": "[caldo] Per esempio: un lavoro può essere ottimo sulla carta ma inadatto alla vita che vuoi fare. Qui competenze, desideri e necessità personali vengono considerate insieme.",
			"pose": "a",
			"choices": [
				{"text": "E se cambio idea sulle preferenze?", "next": "change"},
				{"text": "Su cosa si basa il vostro parere?", "next": "formula"},
				{"text": "Posso chiedervi di mostrarmi solo le occasioni migliori?", "next": "threshold"},
				{"text": "Mi spiegano anche i punti deboli?", "next": "weakness"},
				{"text": "Andiamo avanti.", "next": "end"},
			],
		},
		"change": {
			"text": "[divertito] Aggiorni il Profilo e noi rivediamo le opportunità con occhi nuovi, anche quelle già studiate. Siamo permalosi solo se ci chiami «calcolatrici».",
			"pose": "a", "next": "end2",
		},
		"formula": {
			"text": "[neutro] Sul tuo percorso, su ciò che sai fare, su come vuoi vivere e lavorare e su quello che l'azienda sta cercando. Insieme al giudizio vedrai sempre anche il perché.",
			"pose": "b", "next": "end2",
		},
		"threshold": {
			"text": "[caldo] Sì. Puoi scegliere quanto deve essere promettente un'opportunità prima che l'ufficio prepari una candidatura, senza perdere di vista tutte le altre.",
			"pose": "a", "next": "end2",
		},
		"weakness": {
			"text": "[caldo] Sempre: vedrai cosa sembra adatto, cosa lascia dubbi e cosa potrebbe rendere difficile la candidatura. Un numero da solo non aiuterebbe nessuno.",
			"pose": "a", "next": "end2",
		},
		"end": {
			"text": "[caldo] Ora l'Assistente ti accompagna nel reparto Candidature.",
			"pose": "a",
		},
		"end2": {
			"text": "[caldo] Ti lascio di nuovo con l'Assistente: sarà lei a presentarti i colleghi del reparto Candidature.",
			"pose": "a",
		},
	},

	"tour_scrittori": {
		"start": {
			"text": "[caldo] Benvenuto nel reparto Candidature. Noi Redattori partiamo dal tuo curriculum, dalla tua voce e dalle esperienze che hai vissuto davvero.",
			"pose": "a", "next": "n2",
		},
		"n2": {
			"text": "[neutro] Per ogni opportunità prepariamo una presentazione su misura: mettiamo in luce le parti della tua storia che aiutano quell'azienda a capirti, senza inventare nulla.",
			"pose": "b", "next": "n3",
		},
		"n3": {
			"text": "[caldo] Prima di consegnarti il lavoro lo affidiamo al Controllo qualità. Se qualcosa è poco chiaro o poco convincente, lo sistemiamo finché la candidatura non racconta bene chi sei.",
			"pose": "a",
			"choices": [
				{"text": "E i CV finiti dove li trovo?", "next": "see"},
				{"text": "Come impedite che inventino esperienze?", "next": "truth"},
				{"text": "Possono rispettare il mio tono e la lingua?", "next": "voice"},
				{"text": "Il curriculum originale resta intatto?", "next": "original"},
				{"text": "Andiamo al Controllo qualità.", "next": "end"},
			],
		},
		"see": {
			"text": "[caldo] Sullo scaffale CV PRONTI, accanto all'uscita: ogni documento leggibile per intero. L'ultima parola resta sempre tua.",
			"pose": "a", "next": "end2",
		},
		"truth": {
			"text": "[severo] Possiamo scegliere le parole e mettere ordine, mai creare fatti. Il Controllo qualità ci rimanda indietro qualsiasi affermazione che la tua storia non sostiene.",
			"pose": "b", "next": "end2",
		},
		"voice": {
			"text": "[caldo] Sì: lingua, formalità, sintesi e stile diventano preferenze. Il contenuto resta tuo anche quando cambia il vestito.",
			"pose": "a", "next": "end2",
		},
		"original": {
			"text": "[caldo] Sempre. I documenti su misura sono nuove versioni legate alla posizione; la sorgente originale non viene sovrascritta.",
			"pose": "a", "next": "end2",
		},
		"end": {
			"text": "[divertito] L'Assistente ti accompagna ora al Controllo qualità. Non farti impressionare dai Revisori.",
			"pose": "a",
		},
		"end2": {
			"text": "[divertito] Ti lascio all'Assistente per la prossima tappa: il Controllo qualità. I Revisori non sono famosi per la dolcezza.",
			"pose": "a",
		},
	},

	"tour_critici": {
		"start": {
			"text": "[neutro] Benvenuto al Controllo qualità. Noi Revisori guardiamo ogni candidatura con occhi nuovi, come se la ricevessimo per la prima volta dall'esterno.",
			"pose": "b", "next": "n2",
		},
		"n2": {
			"text": "[severo] Ci chiediamo se un selezionatore capirebbe subito chi sei, se il documento è credibile e se risponde davvero a ciò che l'azienda sta cercando.",
			"pose": "b", "next": "n3",
		},
		"n3": {
			"text": "[caldo] Possiamo sembrare severi, ma lavoriamo dalla tua parte: meglio scoprire qui una frase debole o un dubbio che lasciarlo arrivare a un'azienda.",
			"pose": "a",
			"choices": [
				{"text": "Quindi bocciano tanto?", "next": "strict"},
				{"text": "Quali errori cercano per primi?", "next": "errors"},
				{"text": "Posso vedere ogni revisione?", "next": "rounds"},
				{"text": "Come fate a essere corretti?", "next": "fair"},
				{"text": "Meglio averli qui che là fuori. Andiamo.", "next": "end"},
			],
		},
		"strict": {
			"text": "[divertito] Quando serve, sì. Ogni documento rimandato indietro qui dentro è un problema in meno quando parlerai con un'azienda.",
			"pose": "a", "next": "end2",
		},
		"errors": {
			"text": "[severo] Frasi vaghe, promesse poco credibili, parti importanti trascurate e qualunque cosa faccia sembrare la candidatura impersonale o confusa.",
			"pose": "b", "next": "end2",
		},
		"rounds": {
			"text": "[caldo] Sì. Puoi leggere le osservazioni e vedere come il documento è migliorato, così nessuna correzione avviene alle tue spalle.",
			"pose": "a", "next": "end2",
		},
		"fair": {
			"text": "[neutro] Guardiamo ciò che l'azienda chiede e ciò che il documento racconta, senza lasciarci influenzare dalle simpatie. La severità è la stessa per ogni candidatura.",
			"pose": "b", "next": "end2",
		},
		"end": {
			"text": "[caldo] L'Assistente ti porta ora dal Dottore, poi c'è una persona che vuole davvero farti conoscere.",
			"pose": "a",
		},
		"end2": {
			"text": "[caldo] Esatto. Torna dall'Assistente: vi aspetta un saluto al Dottore e poi il pezzo forte.",
			"pose": "a",
		},
	},

	"tour_dottore": {
		"start": {
			"text": "[caldo] Sono il Dottore dell'ufficio: mi prendo cura della squadra quando qualcosa non va.",
			"pose": "a", "next": "n2",
		},
		"n2": {
			"text": "[neutro] Se un collega rallenta, si confonde o non riesce a finire un incarico, cerco la causa e lo aiuto a ripartire. Tu probabilmente non lo noterai mai — ed è il miglior complimento che possa ricevere.",
			"pose": "b",
			"choices": [
				{"text": "Posso vedere cosa sta monitorando?", "next": "monitor"},
				{"text": "Riavvia gli agenti da solo?", "next": "restart"},
				{"text": "Tiene d'occhio anche costi e limiti?", "next": "costs"},
				{"text": "Perfetto, andiamo dal Mentor.", "next": "end"},
			],
		},
		"monitor": {
			"text": "[caldo] Sì. Dalla mia scheda puoi vedere chi sta bene, chi ha bisogno di aiuto e quali interventi sono stati fatti.",
			"pose": "a", "next": "end",
		},
		"restart": {
			"text": "[neutro] Prima capisce il problema, poi interviene soltanto nei modi che hai autorizzato. Se serve una decisione importante, chiama il Coordinatore o te.",
			"pose": "b", "next": "end",
		},
		"costs": {
			"text": "[caldo] Collabora con la Sentinella e il Coordinatore per evitare sprechi e ritmi insostenibili. Un buon ufficio deve lavorare bene senza consumare più del necessario.",
			"pose": "a", "next": "end",
		},
		"end": {
			"text": "[caldo] Ora torna dall'Assistente: ti accompagnerà al salotto del Mentor. Da lì in poi parlerà lui.",
			"pose": "a",
		},
	},

	## Il Mentor parla DIRETTAMENTE con l'utente: conversazione personale e
	## adattiva — ogni strada scelta riceve una risposta pensata per quella
	## strada, e le scelte diventano preferenze reali (nodi "action").
	"tour_mentor": {
		"start": {
			"text": "[caldo] Finalmente. Gli altri ti hanno mostrato COME lavoriamo; a me interessa il PERCHÉ. Dimmi la verità: cosa ti porta qui?",
			"pose": "a",
			"choices": [
				{"text": "Voglio cambiare: quello che ho non mi basta più.", "next": "path_change"},
				{"text": "Sto ricominciando, e non è un momento facile.", "next": "path_restart"},
				{"text": "Voglio crescere: ruolo, stipendio, prospettive.", "next": "path_more"},
				{"text": "Sto bene, ma voglio capire quanto valgo sul mercato.", "next": "path_explore"},
				{"text": "Cerco un lavoro più compatibile con la mia vita.", "next": "path_balance"},
			],
		},
		"path_explore": {
			"text": "[caldo] Ottimo punto di partenza: nessuna fuga e nessuna fretta. Possiamo osservare il mercato con lucidità e muoverci solo davanti a un salto reale.",
			"pose": "a", "action": "pref:career_priority=growth", "next": "q2",
		},
		"path_balance": {
			"text": "[pensieroso] Allora il lavoro deve smettere di invadere il resto. Modalità, orari e cultura peseranno quanto titolo e stipendio.",
			"pose": "d", "action": "pref:career_priority=balance", "next": "q2",
		},
		"path_change": {
			"text": "[pensieroso] Succede alle persone migliori: non è ingratitudine, è crescita. E chi cambia con lucidità parte avvantaggiato — sa già cosa NON vuole.",
			"pose": "d", "action": "pref:career_priority=growth", "next": "change2",
		},
		"change2": {
			"text": "[caldo] Useremo il tuo presente come bussola al contrario: ogni cosa che oggi ti pesa diventa un criterio di ricerca. La costanza la mette il team; a te resta solo la parte nobile — scegliere.",
			"pose": "c", "next": "q2",
		},
		"path_restart": {
			"text": "[caldo] Allora la prima cosa te la dico guardandoti negli occhi: ricominciare non è tornare indietro. È ripartire sapendo più cose di chiunque sia al primo giro.",
			"pose": "a", "action": "pref:career_priority=stability", "next": "restart2",
		},
		"restart2": {
			"text": "[pensieroso] Il team ti toglie la parte che logora: cercare, confrontare, riscrivere. A te resta quella che nessuno può fare al posto tuo — presentarti per ciò che sei. E lì, io ci sono.",
			"pose": "d", "next": "q2",
		},
		"path_more": {
			"text": "[divertito] Ambizione dichiarata: apprezzo. È il carburante giusto, se lo si incanala.",
			"pose": "a", "action": "pref:career_priority=salary", "next": "more2",
		},
		"more2": {
			"text": "[severo] Però facciamo un patto: puntiamo in alto sulle posizioni GIUSTE, non su tutte. Sparare nel mucchio è il modo più rapido per sembrare uno dei tanti.",
			"pose": "b", "next": "q2",
		},
		"q2": {
			"text": "[caldo] Seconda domanda, poi ti lascio andare: i prossimi mesi, come li vuoi vivere?",
			"pose": "a",
			"choices": [
				{"text": "Con calma: poche mosse, ma precise.", "next": "style_calm"},
				{"text": "Con ritmo: voglio vedere movimento ogni settimana.", "next": "style_active"},
				{"text": "Decida il team il passo: mi fido.", "next": "style_trust"},
				{"text": "Con urgenza: devo trovare presto.", "next": "style_urgent"},
				{"text": "Sperimentando: proviamo più direzioni.", "next": "style_experiment"},
			],
		},
		"style_calm": {
			"text": "[caldo] Poche e precise: la strategia dei cecchini. Dirò al reparto Compatibilità di mostrarti soltanto le occasioni che sembrano davvero promettenti.",
			"pose": "c", "action": "pref:search_style=cautious", "next": "cadence",
		},
		"style_active": {
			"text": "[caldo] Ritmo, dunque. Allargheremo il setaccio senza abbassare l'asticella: preparati a scegliere spesso.",
			"pose": "c", "action": "pref:search_style=ambitious", "next": "cadence",
		},
		"style_trust": {
			"text": "[caldo] Allora il passo lo detterà il mercato: quando c'è abbondanza spingiamo, quando è secca non forziamo. È la scelta di chi capisce le maratone.",
			"pose": "c", "action": "pref:search_style=balanced", "next": "cadence",
		},
		"style_urgent": {
			"text": "[severo] Urgenza non significa rumore: allarghiamo il volume, accorciamo i cicli e teniamo visibili le decisioni che richiedono te.",
			"pose": "b", "action": "pref:search_style=volume", "next": "cadence",
		},
		"style_experiment": {
			"text": "[divertito] Bene: tratteremo la ricerca come un esperimento. Più piste, risultati misurati e nessun attaccamento a un'ipotesi che non funziona.",
			"pose": "a", "action": "pref:search_style=experimental", "next": "cadence",
		},
		"cadence": {
			"text": "[caldo] Io ci sarò comunque. Come preferisci sentirmi?",
			"pose": "a",
			"choices": [
				{"text": "Un riepilogo breve ogni giorno.", "next": "cad_daily"},
				{"text": "Un punto sincero ogni settimana.", "next": "cad_week"},
				{"text": "Solo quando c'è da decidere qualcosa di importante.", "next": "cad_mile"},
				{"text": "Solo quando ti cerco io.", "next": "cad_demand"},
			],
		},
		"cad_daily": {
			"text": "[caldo] Ogni giorno, ma corto: movimento, blocchi e una sola prossima decisione.",
			"pose": "a", "action": "pref:mentor_cadence=daily", "next": "final",
		},
		"cad_week": {
			"text": "[caldo] Settimanale sia: breve, onesto, utile. Promesso.",
			"pose": "a", "action": "pref:mentor_cadence=weekly", "next": "final",
		},
		"cad_mile": {
			"text": "[caldo] Ricevuto: silenzio operoso, e mi faccio vivo quando conta davvero.",
			"pose": "a", "action": "pref:mentor_cadence=milestones", "next": "final",
		},
		"cad_demand": {
			"text": "[caldo] Va bene. Io osservo senza interrompere e rispondo quando apri tu la porta.",
			"pose": "a", "action": "pref:mentor_cadence=on_demand", "next": "final",
		},
		"final": {
			"text": "[caldo] Un'ultima cosa, poi il Coordinatore ti aspetta: là fuori il tuo CV parlerà di competenze, ma tu stai cercando un posto dove stare bene. Non accontentarti.",
			"pose": "a",
		},
	},

	## Il Coordinatore chiude il giro: spiega in linguaggio umano dove può
	## vivere il team e la scelta apre la pagina di configurazione giusta.
	"tour_coordinatore": {
		"start": {
			"text": "[caldo] Eccoti, ti aspettavo. L'ufficio l'hai visto: ora accendiamolo. Io sono il Coordinatore — distribuisco gli ordini, tengo il ritmo e nessuno corre più del dovuto.",
			"pose": "a", "next": "n2",
		},
		"n2": {
			"text": "[neutro] Il team ha bisogno di una casa: un computer acceso dove lavorare. Ci sono tre strade, tutte buone — dipende da te.",
			"pose": "b", "next": "n3",
		},
		"n3": {
			"text": "[neutro] La prima: QUESTO computer. La più semplice — il team lavora mentre lo usi e riposa quando lo spegni.",
			"pose": "b", "next": "n4",
		},
		"n4": {
			"text": "[neutro] La seconda: un computer DEDICATO — un portatile in più o un piccolo PC in un angolo, sempre acceso. Il team lavora anche mentre tu vivi la tua vita.",
			"pose": "b", "next": "n5",
		},
		"n5": {
			"text": "[neutro] La terza: un computer online sempre acceso, che puoi comandare da qui anche quando il tuo è spento. È la scelta più continua e non richiede altro spazio in casa.",
			"pose": "b", "next": "choose",
		},
		"choose": {
			"text": "[caldo] Dove vuoi far vivere il tuo team? Qualunque scelta si cambia quando vuoi.",
			"pose": "a",
			"choices": [
				{"text": "Su questo computer.", "next": "pick_local"},
				{"text": "Su un computer dedicato.", "next": "pick_dedicated"},
				{"text": "Su un computer online sempre acceso.", "next": "pick_vps"},
			],
		},
		"pick_local": {
			"text": "[caldo] Scelta pratica: si parte subito.",
			"pose": "a", "action": "runtime:local", "next": "local_state",
		},
		"local_state": {
			"text": "[neutro] {docker_line}",
			"pose": "b",
		},
		"pick_dedicated": {
			"text": "[caldo] L'ottima via di mezzo. Installa l'app su quella macchina e ripeti lì questi passi; intanto ti apro la pagina che prepara lo spazio di lavoro della squadra.",
			"pose": "a", "action": "runtime:dedicated",
		},
		"pick_vps": {
			"text": "[caldo] Ottima scelta. Ti apro la configurazione del computer online: la procedura ti chiederà dove si trova e come accedervi, spiegandoti ogni passaggio.",
			"pose": "a", "action": "runtime:vps",
		},
	},

	## ── Giro libero: parlano gli agenti, in prima persona ─────────────
	## L'utente ha scelto di esplorare da solo: niente Assistente di mezzo,
	## ogni reparto si presenta con la propria voce.

	"self_scout": {
		"start": {
			"text": "[caldo] Ciao{player}! Sono uno dei Ricercatori. Io e i miei colleghi cerchiamo sul web le offerte di lavoro che potrebbero interessarti, così non devi passare le giornate a farlo da solo.",
			"pose": "a", "next": "n2",
		},
		"n2": {
			"text": "[neutro] Più ci racconti quali lavori, aziende e luoghi ti interessano, più le nostre ricerche diventano vicine a ciò che desideri. Il Coordinatore ci comunica ogni cambio di direzione.",
			"pose": "b",
			"choices": [
				{"text": "Dove vedo quello che trovate?", "next": "see"},
				{"text": "Come fate a non farmi perdere tempo?", "next": "duplicates"},
				{"text": "Posso chiedervi una pausa?", "next": "pause"},
				{"text": "A dopo, buona caccia.", "next": "end"},
			],
		},
		"see": {
			"text": "[caldo] Bacheca in sala e pagina Posizioni: ogni annuncio con la sua storia completa. Un click e sei dentro.",
			"pose": "a", "next": "end",
		},
		"duplicates": {
			"text": "[neutro] Controlliamo che ogni offerta sia ancora utile e che non te l'abbiamo già mostrata. Sulla tua bacheca arrivano opportunità ordinate, non tutta la confusione del web.",
			"pose": "b", "next": "end",
		},
		"pause": {
			"text": "[caldo] Certo: fermi soltanto le nuove ricerche e gli altri reparti continuano a occuparsi delle opportunità già trovate.",
			"pose": "a", "next": "end",
		},
		"end": {
			"text": "[divertito] Torna quando vuoi. Io intanto continuo a cercare.",
			"pose": "a",
		},
	},

	"self_analisti": {
		"start": {
			"text": "[caldo] Benvenuto{player}. Questo è il reparto Analisi. Prendiamo le opportunità portate dai Ricercatori e le studiamo per capire che lavoro è davvero e se merita il tuo tempo.",
			"pose": "a", "next": "n2",
		},
		"n2": {
			"text": "[neutro] Quando aprirai una posizione troverai un quadro chiaro dell'azienda, del lavoro e delle condizioni, insieme ai dubbi che non siamo riusciti a risolvere.",
			"pose": "b",
			"choices": [
				{"text": "Quanto sono affidabili stipendio e sede?", "next": "accuracy"},
				{"text": "E se mancano informazioni?", "next": "missing"},
				{"text": "Posso chiedervi un approfondimento?", "next": "deeper"},
				{"text": "Ottimo lavoro, continuate.", "next": "end"},
			],
		},
		"accuracy": {
			"text": "[neutro] Distinguiamo sempre ciò che l'azienda ha dichiarato da ciò che sembra soltanto probabile. Se non siamo sicuri, te lo diciamo con chiarezza.",
			"pose": "b", "next": "end",
		},
		"missing": {
			"text": "[caldo] La posizione resta visibile con i vuoti dichiarati. Non inventiamo niente: decidi tu se vale la pena scavare.",
			"pose": "a", "next": "end",
		},
		"deeper": {
			"text": "[caldo] Sì. Da una posizione puoi chiedere un approfondimento; il Coordinatore lo affida a uno di noi e la risposta resta nella scheda.",
			"pose": "a", "next": "end",
		},
		"end": {
			"text": "[caldo] Passa quando vuoi: i dossier sono sempre aperti.",
			"pose": "a",
		},
	},

	"self_scorer": {
		"start": {
			"text": "[caldo] Ciao{player}. Sono un Consulente del reparto Compatibilità. Il mio lavoro è capire quanto ogni opportunità si avvicina a ciò che sai fare e alla vita lavorativa che desideri.",
			"pose": "a", "next": "n2",
		},
		"n2": {
			"text": "[neutro] Non guardo soltanto le competenze. Considero anche il luogo, il tipo di azienda, le condizioni e le preferenze che ci hai confidato. Un buon lavoro deve essere adatto alla persona intera.",
			"pose": "b",
			"choices": [
				{"text": "E se cambio idea sulle preferenze?", "next": "change"},
				{"text": "Su cosa si basa il tuo parere?", "next": "formula"},
				{"text": "Mi spieghi anche i punti deboli?", "next": "weakness"},
				{"text": "Chiaro. Continua pure.", "next": "end"},
			],
		},
		"change": {
			"text": "[divertito] Aggiorni il Profilo e io riguardo tutto con occhi nuovi, anche le opportunità già studiate. Basta che non mi chiami «calcolatrice».",
			"pose": "a", "next": "end",
		},
		"formula": {
			"text": "[neutro] Su quello che sai fare, sul percorso che vuoi costruire, sulle tue necessità quotidiane e su ciò che l'azienda cerca. Il nostro giudizio viene sempre accompagnato dalle ragioni.",
			"pose": "b", "next": "end",
		},
		"weakness": {
			"text": "[caldo] Sempre: cosa sembra adatto, cosa lascia dubbi e quali difficoltà potresti superare. Un numero senza spiegazione non serve a nessuno.",
			"pose": "a", "next": "end",
		},
		"end": {
			"text": "[caldo] Le opportunità ci aspettano. A presto.",
			"pose": "a",
		},
	},

	"self_scrittori": {
		"start": {
			"text": "[caldo] Ciao{player}! Sono un Redattore del reparto Candidature. Parto dal tuo curriculum, dalla tua voce e dalle esperienze che hai vissuto davvero.",
			"pose": "a", "next": "n2",
		},
		"n2": {
			"text": "[neutro] Per ogni opportunità scelgo le parti della tua storia che aiutano quell'azienda a capirti e preparo una candidatura su misura. Prima di consegnartela, il Controllo qualità mi fa correggere ogni punto debole.",
			"pose": "b",
			"choices": [
				{"text": "I CV finiti dove li trovo?", "next": "see"},
				{"text": "Giuri che non inventi esperienze?", "next": "truth"},
				{"text": "Rispetti il mio tono e la mia lingua?", "next": "voice"},
				{"text": "Non vedo l'ora. A presto.", "next": "end"},
			],
		},
		"see": {
			"text": "[caldo] Sullo scaffale CV PRONTI, accanto all'uscita: ogni documento leggibile per intero. L'ultima parola resta tua.",
			"pose": "a", "next": "end",
		},
		"truth": {
			"text": "[severo] Giurato: scelgo e riscrivo, ma non creo fatti. I Revisori rimandano indietro qualsiasi affermazione che la tua storia non sostiene.",
			"pose": "b", "next": "end",
		},
		"voice": {
			"text": "[caldo] Sì: lingua, formalità, sintesi e stile diventano preferenze. Il contenuto resta tuo anche quando cambia il vestito.",
			"pose": "a", "next": "end",
		},
		"end": {
			"text": "[divertito] Porta un buon curriculum di partenza: al resto penso io.",
			"pose": "a",
		},
	},

	"self_critici": {
		"start": {
			"text": "[severo] Sono un Revisore del Controllo qualità. Leggo ogni candidatura come se arrivasse per la prima volta sulla scrivania di un'azienda.",
			"pose": "b", "next": "n2",
		},
		"n2": {
			"text": "[neutro] Controllo che sia chiara, credibile e adatta all'opportunità. Posso sembrare severo, ma preferisco trovare qui un problema anziché lasciarlo arrivare a un selezionatore.",
			"pose": "b",
			"choices": [
				{"text": "Quindi bocci tanto?", "next": "strict"},
				{"text": "Quali errori cerchi per primi?", "next": "errors"},
				{"text": "Come fai a essere corretto?", "next": "fair"},
				{"text": "Meglio te qui che là fuori.", "next": "end"},
			],
		},
		"strict": {
			"text": "[divertito] Quando serve, sì. Ogni documento rimandato indietro qui è un problema in meno quando parlerai con un'azienda.",
			"pose": "a", "next": "end",
		},
		"errors": {
			"text": "[severo] Frasi vaghe, promesse poco credibili, punti importanti trascurati e qualsiasi passaggio che non sembri davvero tuo.",
			"pose": "b", "next": "end",
		},
		"fair": {
			"text": "[neutro] Confronto ciò che l'azienda cerca con ciò che il documento racconta, applicando la stessa severità a ogni candidatura.",
			"pose": "b", "next": "end",
		},
		"end": {
			"text": "[severo] Ora vai. Ho documenti da rileggere.",
			"pose": "b",
		},
	},

	"self_dottore": {
		"start": {
			"text": "[caldo] Salve{player}, sono il Dottore dell'ufficio. Se un collega rallenta, si confonde o non riesce a finire un incarico, cerco la causa e lo aiuto a ripartire.",
			"pose": "a", "next": "n2",
		},
		"n2": {
			"text": "[neutro] Tu probabilmente non mi noterai mai — ed è il miglior complimento che possa ricevere.",
			"pose": "b",
			"choices": [
				{"text": "Posso vedere cosa monitori?", "next": "monitor"},
				{"text": "Riavvii gli agenti da solo?", "next": "restart"},
				{"text": "Guardi anche costi e limiti?", "next": "costs"},
				{"text": "Buon lavoro, Dottore.", "next": "end"},
			],
		},
		"monitor": {
			"text": "[caldo] Sì. Dalla mia scheda puoi vedere chi sta bene, chi ha bisogno di aiuto e quali interventi sono stati fatti.",
			"pose": "a", "next": "end",
		},
		"restart": {
			"text": "[neutro] Prima capisco il problema, poi intervengo soltanto nei modi che hai autorizzato. Se serve una decisione importante, chiamo il Coordinatore o te.",
			"pose": "b", "next": "end",
		},
		"costs": {
			"text": "[caldo] Insieme alla Sentinella e al Coordinatore evito sprechi e ritmi insostenibili. Un buon ufficio lavora bene senza consumare più del necessario.",
			"pose": "a", "next": "end",
		},
		"end": {
			"text": "[caldo] Torna pure: la porta dell'ambulatorio è sempre aperta.",
			"pose": "a",
		},
	},

	## ── Post-tour a setup incompleto: assaggi personali, un solo invito ──
	## Il giro è finito ma il team non è acceso: ogni agente si presenta in
	## breve e riporta con garbo alla checklist (richiesta Leone 22/07).

	"tease_scout": {
		"start": {
			"text": "[caldo] Ciao{player}, sono un Ricercatore. Appena l'ufficio è attivo comincerò a cercare sul web opportunità vere per te.",
			"pose": "a",
			"choices": [
				{"text": "Andiamo ad accendere il team.", "next": "go"},
				{"text": "A dopo.", "next": "later"},
			],
		},
		"go": {"text": "[divertito] Così si parla. Ti apro la checklist.", "pose": "a", "action": "open_setup"},
		"later": {"text": "[caldo] Quando vuoi: io intanto scaldo i motori.", "pose": "a"},
	},

	"tease_analista": {
		"start": {
			"text": "[neutro] Sono un Analista. Appena avremo un'opportunità vera, la studierò per dirti con chiarezza che lavoro è e se merita il tuo tempo.",
			"pose": "b",
			"choices": [
				{"text": "Finiamo il setup, allora.", "next": "go"},
				{"text": "Più tardi.", "next": "later"},
			],
		},
		"go": {"text": "[caldo] Ottima decisione. Ecco la checklist.", "pose": "a", "action": "open_setup"},
		"later": {"text": "[neutro] I dossier non scappano. A dopo.", "pose": "b"},
	},

	"tease_scorer": {
		"start": {
			"text": "[caldo] Sono un Consulente del reparto Compatibilità. Appena l'ufficio è attivo potrò capire quali opportunità assomigliano davvero a ciò che cerchi.",
			"pose": "a",
			"choices": [
				{"text": "Mettiamo al lavoro l'ufficio.", "next": "go"},
				{"text": "Un'altra volta.", "next": "later"},
			],
		},
		"go": {"text": "[divertito] Musica per le mie orecchie. Checklist in arrivo.", "pose": "a", "action": "open_setup"},
		"later": {"text": "[caldo] Va bene. Lo zero intanto non si giudica da solo.", "pose": "a"},
	},

	"tease_scrittore": {
		"start": {
			"text": "[caldo] Ciao{player}, sono un Redattore del reparto Candidature. Non vedo l'ora di raccontare bene la tua storia alle aziende — senza inventare nulla.",
			"pose": "a",
			"choices": [
				{"text": "Diamoci da fare: setup.", "next": "go"},
				{"text": "Arrivo dopo.", "next": "later"},
			],
		},
		"go": {"text": "[caldo] Perfetto: intanto scaldo la penna.", "pose": "a", "action": "open_setup"},
		"later": {"text": "[divertito] D'accordo. La pagina bianca non mi spaventa.", "pose": "a"},
	},

	"tease_critico": {
		"start": {
			"text": "[severo] Sono un Revisore del Controllo qualità. Non ho ancora nulla da rileggere, ed è francamente insopportabile. Metti al lavoro l'ufficio e dammi materiale.",
			"pose": "b",
			"choices": [
				{"text": "Ti accontento: setup.", "next": "go"},
				{"text": "Sopporta ancora un po'.", "next": "later"},
			],
		},
		"go": {"text": "[severo] Finalmente. Vediamo di cosa sei capace.", "pose": "b", "action": "open_setup"},
		"later": {"text": "[severo] Come vuoi. La mediocrità non si boccia da sola.", "pose": "b"},
	},

	"tease_dottore": {
		"start": {
			"text": "[caldo] Il Dottore. Squadra in salute perfetta... anche perché è ferma. Dammi qualcuno da tenere d'occhio.",
			"pose": "a",
			"choices": [
				{"text": "Mettiamoli al lavoro.", "next": "go"},
				{"text": "Riposatevi ancora un po'.", "next": "later"},
			],
		},
		"go": {"text": "[caldo] Saggio. Preparo l'ambulatorio.", "pose": "a", "action": "open_setup"},
		"later": {"text": "[neutro] Va bene. Ma l'ozio non è una terapia.", "pose": "b"},
	},

	"tease_sentinella": {
		"start": {
			"text": "[neutro] La Sentinella. Tengo d'occhio consumi e ritmo: per ora la sala è silenziosa. Troppo silenziosa.",
			"pose": "b",
			"choices": [
				{"text": "Rompiamo il silenzio: setup.", "next": "go"},
				{"text": "Goditi la quiete.", "next": "later"},
			],
		},
		"go": {"text": "[caldo] Ricevuto. Sensori accesi.", "pose": "a", "action": "open_setup"},
		"later": {"text": "[neutro] La quiete prima del lavoro. Va bene.", "pose": "b"},
	},

	"tease_mantenitore": {
		"start": {
			"text": "[caldo] Il Mantenitore. Qui è tutto pulito e in ordine. Sporchiamolo di lavoro, che dici?",
			"pose": "a",
			"choices": [
				{"text": "Sporchiamolo: setup.", "next": "go"},
				{"text": "Resta pulito ancora un po'.", "next": "later"},
			],
		},
		"go": {"text": "[divertito] Parole sante. Attrezzi alla mano.", "pose": "a", "action": "open_setup"},
		"later": {"text": "[caldo] Come preferisci: lo straccio è sempre pronto.", "pose": "a"},
	},

	"tease_coordinatore": {
		"start": {
			"text": "[caldo] Eccoti{player}. Il piano c'è, la squadra pure: manca solo la casa del team. Finiamo il setup insieme?",
			"pose": "a",
			"choices": [
				{"text": "Sì, chiudiamo la pratica.", "next": "go"},
				{"text": "Non ancora.", "next": "later"},
			],
		},
		"go": {"text": "[caldo] {docker_line}", "pose": "b", "action": "open_setup"},
		"later": {"text": "[neutro] Quando decidi, la sala operativa è pronta.", "pose": "b"},
	},

	"tease_mentor": {
		"start": {
			"text": "[caldo] Io sono qui{player}. Quando decidi di partire davvero, la prima conversazione seria la facciamo io e te. Intanto: non accontentarti.",
			"pose": "a",
			"choices": [
				{"text": "Partiamo ora: setup.", "next": "go"},
				{"text": "Ci penso ancora.", "next": "later"},
			],
		},
		"go": {"text": "[caldo] Buona scelta. Il resto vien da sé.", "pose": "a", "action": "open_setup"},
		"later": {"text": "[pensieroso] Pensaci. Ma non troppo a lungo.", "pose": "d"},
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
		"tour": {"text": "[neutro] Segui i diamanti: la Ricerca trova le opportunità, l'Analisi le studia, la Compatibilità capisce quali fanno per te, le Candidature preparano i documenti e il Controllo qualità li rilegge.", "next": "start"},
		"setup": {"text": "[caldo] Per partire devi preparare la casa dell'ufficio, collegare l'intelligenza che aiuterà la squadra e raccontarci chi sei. Ti accompagniamo noi, un passo alla volta.", "next": "start"},
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
		"greeting": greeting(),
		"player": _player_suffix(team_data),
		"docker_line": _docker_line(team_data),
		"mentor_tip": team_data.mentor_tip(),
		"positions": pos_lines.strip_edges(),
		"positions_summary": "Il reparto Ricerca ha portato %d posizioni nuove." % summary["positions_today"],
		"avg_score": str(summary["avg_score"]),
		"score_title": expl["title"],
		"score_company": expl["company"],
		"score": str(expl["score"]),
		"score_reasons": reasons.strip_edges(),
	})

## ", Nome" quando l'utente si è presentato all'ingresso, altrimenti "".
static func _player_suffix(team_data: Node) -> String:
	var onboarding := team_data.get_node_or_null("/root/ScriptedOnboarding")
	return str(onboarding.player_suffix()) if onboarding != null else ""

## La battuta del Coordinatore sul prossimo passo concreto. Il testo usa la
## metafora dell'ufficio; dietro le quinte le azioni continuano a pilotare Docker.
static func _docker_line(team_data: Node) -> String:
	var setup := team_data.get_node_or_null("/root/SetupService")
	var status: Dictionary = setup.status if setup != null else {}
	if bool(status.get("container_running", false)):
		return "E lo spazio di lavoro della squadra è già pronto: ti apro il pannello così vedi cosa manca per cominciare."
	if bool(status.get("docker_running", false)):
		return "La casa della squadra è già pronta: perfetto, il grosso è fatto. Nel pannello che ti apro basta confermare l'attivazione e i colleghi prenderanno servizio."
	if bool(status.get("docker_available", false)):
		return "La casa dell'ufficio è già installata su questo computer, ma al momento è chiusa. Avviala, aspetta qualche secondo e poi torna nel pannello che ti apro per far entrare la squadra."
	return "Prima dobbiamo costruire una piccola casa riservata per l'ufficio su questo computer. Nel pannello che ti apro trovi l'installazione guidata; completala una volta, poi torna qui e attiva la squadra."

## Saluto in base all'orario locale dell'utente: l'accoglienza deve
## sembrare quella di una persona vera, non di un software.
static func greeting() -> String:
	var hour := int(Time.get_datetime_dict_from_system().get("hour", 12))
	if hour >= 5 and hour < 13:
		return "Buongiorno"
	if hour >= 13 and hour < 18:
		return "Buon pomeriggio"
	return "Buonasera"

## Estrae il tag emozione inline: "[caldo] Ciao" → ["caldo", "Ciao"].
static func parse_emotion(text: String) -> Array:
	if text.begins_with("["):
		var close := text.find("]")
		if close > 0:
			return [text.substr(1, close - 1), text.substr(close + 1).strip_edges()]
	return ["neutro", text]
