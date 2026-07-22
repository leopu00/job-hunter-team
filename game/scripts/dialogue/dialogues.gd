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
			"text": "[neutro] Prima del provider le risposte restano in file locali. Quando collegherai l'AI, diventeranno il suo punto di partenza; potrai sempre correggerle dal profilo.",
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
			"text": "[divertito] Pronto? Se vuoi si comincia dagli Scout, i nostri cercatori. O vai per conto tuo, senza offesa.",
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
			"text": "[caldo] Ecco gli Scout. Battono i siti di annunci giorno e notte e portano a casa le posizioni: da oggi non dovrai più cercare nulla a mano.",
			"pose": "a", "next": "n2",
		},
		"n2": {
			"text": "[neutro] E ascoltano: se preferisci che insistano su un sito piuttosto che su un altro, basta dirlo al Coordinatore. È lui che dà gli ordini, e loro li eseguono alla lettera.",
			"pose": "b",
			"choices": [
				{"text": "E io dove vedo quello che trovano?", "next": "see"},
				{"text": "Posso indicare siti e aziende preferiti?", "next": "sources"},
				{"text": "Come evitano annunci duplicati o vecchi?", "next": "duplicates"},
				{"text": "Posso fermare la ricerca senza spegnere il team?", "next": "pause"},
				{"text": "Chiaro, andiamo avanti.", "next": "end"},
			],
		},
		"see": {
			"text": "[caldo] Nella bacheca in sala e nella pagina Posizioni: ogni annuncio con la sua storia completa. Un click e sei dentro.",
			"pose": "a", "next": "end2",
		},
		"sources": {
			"text": "[caldo] Sì. Il Coordinatore può dare priorità a fonti, aziende, paesi e famiglie di ruolo; gli Scout useranno quelle direttive nei cicli successivi.",
			"pose": "a", "next": "end2",
		},
		"duplicates": {
			"text": "[neutro] Confrontano URL, azienda, titolo e sede. Gli annunci scaduti vengono ricontrollati e quelli equivalenti non intasano la coda.",
			"pose": "b", "next": "end2",
		},
		"pause": {
			"text": "[caldo] Certo: puoi fermare solo lo scouting e lasciare che gli altri reparti smaltiscano ciò che è già in coda.",
			"pose": "a", "next": "end2",
		},
		"end": {
			"text": "[divertito] Di là ci sono gli Analisti. Ti piaceranno: sono i pignoli del gruppo.",
			"pose": "a",
		},
		"end2": {
			"text": "[caldo] Ora andiamo dagli Analisti: i pignoli del gruppo.",
			"pose": "a",
		},
	},

	"tour_analisti": {
		"start": {
			"text": "[caldo] Gli Analisti prendono ogni annuncio trovato dagli Scout e lo trasformano in un quadro completo.",
			"pose": "a", "next": "n2",
		},
		"n2": {
			"text": "[neutro] Riassumono la descrizione del ruolo, studiano l'azienda, trovano l'indirizzo esatto della sede e stimano lo stipendio quando l'annuncio non lo dichiara.",
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
			"text": "[caldo] Cambia che deciderai in un minuto invece che in un'ora: quando aprirai una posizione troverai già tutto — cosa fanno, dove stanno, quanto offrono.",
			"pose": "a", "next": "end2",
		},
		"accuracy": {
			"text": "[neutro] Separano sempre il dato dichiarato dalla stima. Quando una cifra è dedotta, vedrai l'incertezza invece di una falsa precisione.",
			"pose": "b", "next": "end2",
		},
		"missing": {
			"text": "[caldo] La posizione resta visibile con i vuoti dichiarati. Nessun dato viene inventato: potrai decidere se vale la pena approfondire.",
			"pose": "a", "next": "end2",
		},
		"deeper": {
			"text": "[caldo] Sì: da una posizione puoi aprire una richiesta al team. Il Coordinatore la assegna e conserva il risultato nella scheda.",
			"pose": "a", "next": "end2",
		},
		"end": {
			"text": "[caldo] Adesso ti presento chi dà i voti: gli Scorer.",
			"pose": "a",
		},
		"end2": {
			"text": "[divertito] Andiamo dagli Scorer: quelli che danno i voti a tutto.",
			"pose": "a",
		},
	},

	"tour_scorer": {
		"start": {
			"text": "[caldo] Gli Scorer cercano il match perfetto tra te e ogni posizione: un numero da 0 a 100, mai un'etichetta.",
			"pose": "a", "next": "n2",
		},
		"n2": {
			"text": "[neutro] Incrociano il lavoro di Scout e Analisti con il tuo profilo — che puoi aggiornare quando vuoi — e pesano ogni dettaglio sulle TUE preferenze.",
			"pose": "b", "next": "n3",
		},
		"n3": {
			"text": "[caldo] Un esempio: se hai chiesto solo lavoro da remoto, una sede a 800 chilometri pesa parecchio sul voto. Se la sede ti è indifferente, quello stesso dettaglio quasi non lo tocca.",
			"pose": "a",
			"choices": [
				{"text": "E se cambio idea sulle preferenze?", "next": "change"},
				{"text": "Da cosa nasce esattamente il voto?", "next": "formula"},
				{"text": "Posso decidere una soglia minima?", "next": "threshold"},
				{"text": "Mi spiegano anche i punti deboli?", "next": "weakness"},
				{"text": "Andiamo avanti.", "next": "end"},
			],
		},
		"change": {
			"text": "[divertito] Aggiorni il profilo e loro ricalibrano i pesi su tutto, anche sul già valutato. Sono permalosi solo se li chiami «calcolatrici».",
			"pose": "a", "next": "end2",
		},
		"formula": {
			"text": "[neutro] Competenze, seniority, modalità, sede, contratto, retribuzione e preferenze personali. Ogni voto conserva le ragioni, non solo il numero.",
			"pose": "b", "next": "end2",
		},
		"threshold": {
			"text": "[caldo] Sì. Puoi alzare o abbassare la soglia che manda una posizione agli Scrittori senza nascondere il resto dell'archivio.",
			"pose": "a", "next": "end2",
		},
		"weakness": {
			"text": "[caldo] Sempre: vedrai cosa combacia, cosa manca e quali lacune sono realisticamente colmabili. Un 70 senza spiegazione non ci serve.",
			"pose": "a", "next": "end2",
		},
		"end": {
			"text": "[caldo] E ora la parte che preferisco: gli Scrittori.",
			"pose": "a",
		},
		"end2": {
			"text": "[caldo] Vieni, ti presento gli Scrittori.",
			"pose": "a",
		},
	},

	"tour_scrittori": {
		"start": {
			"text": "[caldo] Gli Scrittori partono dal TUO curriculum: il tuo stile, i tuoi dati, le tue esperienze vere.",
			"pose": "a", "next": "n2",
		},
		"n2": {
			"text": "[neutro] Per ogni posizione scelgono le parti giuste della tua storia e cuciono un CV su misura per quell'annuncio. Mai una riga inventata.",
			"pose": "b", "next": "n3",
		},
		"n3": {
			"text": "[caldo] Poi consegnano tutto al Critico, che li tratta malissimo. Loro incassano, imparano dalla critica e riscrivono: quando il voto sale, la versione è davvero migliore. Esce solo la migliore possibile.",
			"pose": "a",
			"choices": [
				{"text": "E i CV finiti dove li trovo?", "next": "see"},
				{"text": "Come impedite che inventino esperienze?", "next": "truth"},
				{"text": "Possono rispettare il mio tono e la lingua?", "next": "voice"},
				{"text": "Il curriculum originale resta intatto?", "next": "original"},
				{"text": "Andiamo dal famoso Critico.", "next": "end"},
			],
		},
		"see": {
			"text": "[caldo] Sullo scaffale CV PRONTI, accanto all'uscita: ogni documento leggibile per intero. L'ultima parola resta sempre tua.",
			"pose": "a", "next": "end2",
		},
		"truth": {
			"text": "[severo] Gli Scrittori possono selezionare e riscrivere, mai creare fatti. Il Critico segnala anche affermazioni non sostenute dal tuo profilo.",
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
			"text": "[divertito] E ora... il Critico. Non farti impressionare.",
			"pose": "a",
		},
		"end2": {
			"text": "[divertito] Ora il Critico. Ti avverto: non è famoso per la dolcezza.",
			"pose": "a",
		},
	},

	"tour_critici": {
		"start": {
			"text": "[neutro] I Critici sono l'unico reparto che NON deve conoscerti. Non sanno chi sei, non vogliono saperlo e, se lo scoprono, lo dimenticano subito.",
			"pose": "b", "next": "n2",
		},
		"n2": {
			"text": "[severo] Leggono ogni candidatura come un selezionatore stanco o un filtro automatico: senza affetto, senza contesto, senza sconti. La tua esitazione non li tocca.",
			"pose": "b", "next": "n3",
		},
		"n3": {
			"text": "[caldo] Sembrano crudeli, ma sono il nostro muro di prova: se un CV sopravvive a loro, può sopravvivere ai filtri veri delle aziende.",
			"pose": "a",
			"choices": [
				{"text": "Quindi bocciano tanto?", "next": "strict"},
				{"text": "Quali errori cercano per primi?", "next": "errors"},
				{"text": "Posso vedere ogni revisione?", "next": "rounds"},
				{"text": "Come evitate giudizi arbitrari?", "next": "fair"},
				{"text": "Meglio averli qui che là fuori. Andiamo.", "next": "end"},
			],
		},
		"strict": {
			"text": "[divertito] Tantissimo, ed è un ottimo segno: ogni bocciatura qui dentro è un no che non riceverai là fuori.",
			"pose": "a", "next": "end2",
		},
		"errors": {
			"text": "[severo] Requisiti ignorati, frasi vaghe, risultati senza prove, parole chiave mancanti e promesse che il profilo non sostiene.",
			"pose": "b", "next": "end2",
		},
		"rounds": {
			"text": "[caldo] Sì. Ogni passaggio conserva voto, osservazioni e autore: puoi capire perché una versione ha superato la precedente.",
			"pose": "a", "next": "end2",
		},
		"fair": {
			"text": "[neutro] Valutano il documento contro annuncio e criteri espliciti, senza usare la conversazione personale col Mentor. Il loro isolamento è intenzionale.",
			"pose": "b", "next": "end2",
		},
		"end": {
			"text": "[caldo] Passiamo un attimo dal Dottore, poi c'è una persona che voglio davvero farti conoscere.",
			"pose": "a",
		},
		"end2": {
			"text": "[caldo] Esatto. Ora un saluto veloce al Dottore, e poi il pezzo forte.",
			"pose": "a",
		},
	},

	"tour_dottore": {
		"start": {
			"text": "[caldo] Lui è il Dottore: tiene tutta la squadra in salute.",
			"pose": "a", "next": "n2",
		},
		"n2": {
			"text": "[neutro] Controlla che ogni agente renda al massimo: se qualcuno rallenta o si inceppa, lo visita, capisce cosa succede e lo rimette in piedi. Tu probabilmente non lo noterai mai — ed è il suo miglior complimento.",
			"pose": "b",
			"choices": [
				{"text": "Posso vedere cosa sta monitorando?", "next": "monitor"},
				{"text": "Riavvia gli agenti da solo?", "next": "restart"},
				{"text": "Tiene d'occhio anche costi e limiti?", "next": "costs"},
				{"text": "Perfetto, andiamo dal Mentor.", "next": "end"},
			],
		},
		"monitor": {
			"text": "[caldo] Sì: dalla sua scheda trovi salute, processi, code e anomalie. Le azioni tecniche restano registrate.",
			"pose": "a", "next": "end",
		},
		"restart": {
			"text": "[neutro] Prima diagnostica; poi applica solo i recuperi autorizzati. Se il problema richiede una scelta, chiama il Coordinatore o te.",
			"pose": "b", "next": "end",
		},
		"costs": {
			"text": "[caldo] Collabora con Sentinella e Coordinatore: salute tecnica, consumo e ritmo sono viste insieme, così un agente sano non diventa comunque troppo costoso.",
			"pose": "a", "next": "end",
		},
		"end": {
			"text": "[caldo] E adesso vieni: il salotto del Mentor è di là. Da qui in poi parla lui.",
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
			"text": "[caldo] Poche e precise: la strategia dei cecchini. Dirò agli Scorer di essere severi — sopra il 70 vedrai solo occasioni vere.",
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
			"text": "[neutro] La terza: una VPS — un computer a noleggio in un datacenter, acceso 24 ore su 24, che comandi da qui. Niente hardware in casa, massima continuità.",
			"pose": "b", "next": "choose",
		},
		"choose": {
			"text": "[caldo] Dove vuoi far vivere il tuo team? Qualunque scelta si cambia quando vuoi.",
			"pose": "a",
			"choices": [
				{"text": "Su questo computer.", "next": "pick_local"},
				{"text": "Su un computer dedicato.", "next": "pick_dedicated"},
				{"text": "Su una VPS.", "next": "pick_vps"},
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
			"text": "[caldo] L'ottima via di mezzo. Installa l'app su quella macchina e ripeti lì questi passi; intanto ti apro la pagina del container, così vedi come funziona.",
			"pose": "a", "action": "runtime:dedicated",
		},
		"pick_vps": {
			"text": "[caldo] La scelta di chi fa sul serio. Ti apro la pagina VPS: servono l'indirizzo del server e una chiave d'accesso, il resto te lo spiega lei.",
			"pose": "a", "action": "runtime:vps",
		},
	},

	## ── Giro libero: parlano gli agenti, in prima persona ─────────────
	## L'utente ha scelto di esplorare da solo: niente Assistente di mezzo,
	## ogni reparto si presenta con la propria voce.

	"self_scout": {
		"start": {
			"text": "[caldo] Ciao{player}! Scout, piacere: io e i colleghi battiamo i siti di annunci giorno e notte. Da oggi la caccia alle posizioni la facciamo noi — tu non cerchi più niente a mano.",
			"pose": "a", "next": "n2",
		},
		"n2": {
			"text": "[neutro] E prendiamo ordini volentieri: se vuoi che insistiamo su un sito o su certe aziende, dillo al Coordinatore ed è fatta.",
			"pose": "b",
			"choices": [
				{"text": "Dove vedo quello che trovate?", "next": "see"},
				{"text": "Come evitate doppioni e annunci vecchi?", "next": "duplicates"},
				{"text": "Posso mettervi in pausa senza spegnere tutto?", "next": "pause"},
				{"text": "A dopo, buona caccia.", "next": "end"},
			],
		},
		"see": {
			"text": "[caldo] Bacheca in sala e pagina Posizioni: ogni annuncio con la sua storia completa. Un click e sei dentro.",
			"pose": "a", "next": "end",
		},
		"duplicates": {
			"text": "[neutro] Confrontiamo URL, azienda, titolo e sede; gli scaduti li ricontrolliamo. Niente doppioni a intasarti la coda.",
			"pose": "b", "next": "end",
		},
		"pause": {
			"text": "[caldo] Certo: fermi solo lo scouting e gli altri reparti smaltiscono quello che è già in coda.",
			"pose": "a", "next": "end",
		},
		"end": {
			"text": "[divertito] Torna quando vuoi: le board sono sempre calde.",
			"pose": "a",
		},
	},

	"self_analisti": {
		"start": {
			"text": "[caldo] Benvenuto{player}. Noi Analisti prendiamo ogni annuncio degli Scout e lo trasformiamo in un quadro completo: che ruolo è davvero, che azienda c'è dietro, dove sta la sede — indirizzo esatto — e quanto pagano, anche quando non lo scrivono.",
			"pose": "a", "next": "n2",
		},
		"n2": {
			"text": "[neutro] Così quando apri una posizione decidi in un minuto invece che in un'ora.",
			"pose": "b",
			"choices": [
				{"text": "Quanto sono affidabili stipendio e sede?", "next": "accuracy"},
				{"text": "E se mancano informazioni?", "next": "missing"},
				{"text": "Posso chiedervi un approfondimento?", "next": "deeper"},
				{"text": "Ottimo lavoro, continuate.", "next": "end"},
			],
		},
		"accuracy": {
			"text": "[neutro] Separiamo sempre il dato dichiarato dalla stima: quando una cifra è dedotta, vedrai l'incertezza, mai una falsa precisione.",
			"pose": "b", "next": "end",
		},
		"missing": {
			"text": "[caldo] La posizione resta visibile con i vuoti dichiarati. Non inventiamo niente: decidi tu se vale la pena scavare.",
			"pose": "a", "next": "end",
		},
		"deeper": {
			"text": "[caldo] Sì: da una posizione apri una richiesta al team, il Coordinatore la assegna e il risultato resta nella scheda.",
			"pose": "a", "next": "end",
		},
		"end": {
			"text": "[caldo] Passa quando vuoi: i dossier sono sempre aperti.",
			"pose": "a",
		},
	},

	"self_scorer": {
		"start": {
			"text": "[caldo] Ciao{player}, Scorer. Il mio mestiere è il match perfetto tra te e ogni posizione: un numero da 0 a 100, mai un'etichetta.",
			"pose": "a", "next": "n2",
		},
		"n2": {
			"text": "[neutro] Peso ogni dettaglio sulle TUE preferenze. Esempio: se vuoi solo remoto, una sede a 800 chilometri pesa parecchio sul voto; se la sede ti è indifferente, quasi non la conto.",
			"pose": "b",
			"choices": [
				{"text": "E se cambio idea sulle preferenze?", "next": "change"},
				{"text": "Da cosa nasce il voto, esattamente?", "next": "formula"},
				{"text": "Mi spieghi anche i punti deboli?", "next": "weakness"},
				{"text": "Chiaro. Continua pure.", "next": "end"},
			],
		},
		"change": {
			"text": "[divertito] Aggiorni il profilo e io ricalibro tutto, anche il già valutato. Basta che non mi chiami «calcolatrice».",
			"pose": "a", "next": "end",
		},
		"formula": {
			"text": "[neutro] Competenze, seniority, modalità, sede, contratto, retribuzione e preferenze personali. Ogni voto conserva le ragioni, non solo il numero.",
			"pose": "b", "next": "end",
		},
		"weakness": {
			"text": "[caldo] Sempre: cosa combacia, cosa manca e quali lacune puoi colmare davvero. Un 70 senza spiegazione non serve a nessuno.",
			"pose": "a", "next": "end",
		},
		"end": {
			"text": "[caldo] I numeri ti aspettano. A presto.",
			"pose": "a",
		},
	},

	"self_scrittori": {
		"start": {
			"text": "[caldo] Ciao{player}! Scrittore, molto piacere. Il mio punto di partenza sarà il TUO curriculum: il tuo stile, i tuoi dati, le tue esperienze vere.",
			"pose": "a", "next": "n2",
		},
		"n2": {
			"text": "[neutro] Per ogni posizione scelgo le parti giuste della tua storia e cucio un CV su misura. Poi lo consegno al Critico, che mi tratta malissimo: incasso, imparo e riscrivo finché il voto sale. Esce solo la versione migliore.",
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
			"text": "[severo] Giurato: seleziono e riscrivo, mai creo fatti. E il Critico segnala qualsiasi affermazione che il tuo profilo non sostiene.",
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
			"text": "[severo] Non presentarti: non voglio saperlo. Io leggo candidature come un selezionatore stanco o un filtro automatico — senza affetto, senza contesto, senza sconti.",
			"pose": "b", "next": "n2",
		},
		"n2": {
			"text": "[neutro] Ti sembrerò crudele. Bene: sono il muro di prova. Se un CV sopravvive a me, sopravvive ai filtri veri delle aziende.",
			"pose": "b",
			"choices": [
				{"text": "Quindi bocci tanto?", "next": "strict"},
				{"text": "Quali errori cerchi per primi?", "next": "errors"},
				{"text": "Come eviti giudizi arbitrari?", "next": "fair"},
				{"text": "Meglio te qui che là fuori.", "next": "end"},
			],
		},
		"strict": {
			"text": "[divertito] Tantissimo, ed è un ottimo segno: ogni mia bocciatura è un no che non riceverai là fuori.",
			"pose": "a", "next": "end",
		},
		"errors": {
			"text": "[severo] Requisiti ignorati, frasi vaghe, risultati senza prove, parole chiave mancanti e promesse che il profilo non sostiene.",
			"pose": "b", "next": "end",
		},
		"fair": {
			"text": "[neutro] Valuto il documento contro annuncio e criteri espliciti, senza sapere nulla di te. Il mio isolamento è intenzionale.",
			"pose": "b", "next": "end",
		},
		"end": {
			"text": "[severo] Ora vai. Ho refusi da trovare.",
			"pose": "b",
		},
	},

	"self_dottore": {
		"start": {
			"text": "[caldo] Salve{player}, il Dottore. Io tengo tutta la squadra in salute: se qualcuno rallenta o si inceppa, lo visito, capisco cosa succede e lo rimetto in piedi.",
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
			"text": "[caldo] Sì: dalla mia scheda trovi salute, processi, code e anomalie. Ogni azione tecnica resta registrata.",
			"pose": "a", "next": "end",
		},
		"restart": {
			"text": "[neutro] Prima diagnostico; poi applico solo i recuperi autorizzati. Se serve una scelta, chiamo il Coordinatore o te.",
			"pose": "b", "next": "end",
		},
		"costs": {
			"text": "[caldo] Con Sentinella e Coordinatore: salute tecnica, consumo e ritmo si guardano insieme, così un agente sano non diventa comunque troppo costoso.",
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
			"text": "[caldo] Ciao{player}, Scout. Le board mi chiamano: appena il team è acceso ti riempio la bacheca di posizioni vere.",
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
			"text": "[neutro] Analista. La lente è pronta: dammi un annuncio vero e ti dico azienda, sede esatta e stipendio. Serve solo il team acceso.",
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
			"text": "[caldo] Scorer. Senza il team acceso i miei numeri restano spenti — e io senza numeri non so stare.",
			"pose": "a",
			"choices": [
				{"text": "Accendiamoli, questi numeri.", "next": "go"},
				{"text": "Un'altra volta.", "next": "later"},
			],
		},
		"go": {"text": "[divertito] Musica per le mie orecchie. Checklist in arrivo.", "pose": "a", "action": "open_setup"},
		"later": {"text": "[caldo] Va bene. Lo zero intanto non si giudica da solo.", "pose": "a"},
	},

	"tease_scrittore": {
		"start": {
			"text": "[caldo] Ciao{player}, lo Scrittore. Non vedo l'ora di mettere le mani sul tuo curriculum — solo storie tue, mai inventate. Mi manca soltanto l'ufficio acceso.",
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
			"text": "[severo] Il Critico. Non ho niente da bocciare, ed è francamente insopportabile. Accendi il team e dammi materiale.",
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
		"greeting": greeting(),
		"player": _player_suffix(team_data),
		"docker_line": _docker_line(team_data),
		"mentor_tip": team_data.mentor_tip(),
		"positions": pos_lines.strip_edges(),
		"positions_summary": "Lo Scout ha portato %d posizioni nuove." % summary["positions_today"],
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

## La battuta del Coordinatore sul PROSSIMO passo concreto, calcolata sullo
## stato reale di Docker al momento del dialogo (richiesta Leone 22/07):
## niente istruzioni per installare ciò che c'è già.
static func _docker_line(team_data: Node) -> String:
	var setup := team_data.get_node_or_null("/root/SetupService")
	var status: Dictionary = setup.status if setup != null else {}
	if bool(status.get("container_running", false)):
		return "E il container del team è già acceso: ti apro il pannello così vedi la checklist — mancano solo provider e profilo."
	if bool(status.get("docker_running", false)):
		return "Docker è già acceso: perfetto, il grosso è fatto. Nel pannello che ti apro c'è un solo pulsante — ATTIVA CONTAINER — e la squadra prende servizio."
	if bool(status.get("docker_available", false)):
		return "Docker è già installato su questo computer, va solo avviato. Aprilo, aspetta che il motore sia in moto, poi nel pannello che ti apro premi ATTIVA CONTAINER."
	return "Una premessa importante: qui manca ancora Docker, il programma che fa da palazzo al nostro ufficio. Nel pannello che ti apro trovi INSTALLA / RIPARA RUNTIME: scaricalo, avvialo una volta, poi torna e premi ATTIVA CONTAINER."

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
