import type { Lang } from "../components/landing/LandingI18n";

export type TutorialId = "game" | "web";

type TutorialStep = {
  title: string;
  body: string;
};

export type TutorialGuide = {
  intro: string;
  beforeYouBeginLabel: string;
  beforeYouBegin: string;
  steps: TutorialStep[];
  preferVideo: string;
  videoAvailable: string;
};

type TutorialPageCopy = {
  description: string;
  pathNavLabel: string;
};

// Le versioni sono trascritte da docs/guides/TUTORIALS.md e
// docs/guides/TUTORIALS-LOCALIZATIONS.md. Il testo è il tutorial: il video
// rimane sempre un'alternativa al termine di ciascun percorso.
export const TUTORIAL_GUIDES = {
  en: {
    game: {
      intro:
        "The game tutorial helps you explore the native office, understand how work moves through the team, and inspect a result before you decide what to do.",
      beforeYouBeginLabel: "Before you begin",
      beforeYouBegin:
        "Use the native desktop app. To follow every live step, complete Activate team first: the runtime must be running, a provider authenticated, your profile complete, and working hours set. The office remains explorable before activation, but live replies and positions need the active team. See Quickstart if you still need to activate it.",
      steps: [
        {
          title: "Meet the office",
          body: "Open the native office and select any colleague. Their card shows a name, current status, and responsibility. You have completed this step when you can open a card and return to the office without losing your place.",
        },
        {
          title: "Know who does what",
          body: "The office and conversations use these plural department names: coordinators keep priorities moving; support advisers help with the product and your profile; career advisers help with direction; researchers find opportunities; analysts verify them; match assessors explain fit; application writers prepare requested documents; and reviewers check that work before it reaches you. These names are the stable map from a visible department to its responsibility.",
        },
        {
          title: "Ask the researchers",
          body: "Open the chat with the researchers and ask what the current search is looking for. Send one clear question. Your message stays in that conversation and the reply returns there, so another thread cannot be mistaken for it. The step worked when the thread shows both your question and its reply.",
        },
        {
          title: "Follow verification",
          body: "Open a conversation with the analysts or inspect activity for a position that has moved on from discovery. Analysts check the role, organisation, and details before a position advances. The step worked when you can distinguish a found lead from a verified opportunity.",
        },
        {
          title: "Read the fit",
          body: "Open a conversation with the match assessors or a scored position. Match assessors compare the opportunity with your profile and explain the score. A score is a compatibility estimate, not a decision made for you. The step worked when you can identify the score and its explanation, then decide whether the opportunity deserves attention.",
        },
        {
          title: "See the whole pipeline",
          body: "Open Positions, select any result, and read its status. `new` means researchers found it and analysts verify it next; `checked` means analysts finished and match assessors score it next; `scored` means match assessors have finished, so you can decide or request documents. After your request, `writing` means application writers are preparing them, `review` means reviewers are checking them, and `ready` means the documents are ready for you. `applied` and `response` record your action and its outcome. The step worked when you can name the responsible department and the next event for the status you see.",
        },
        {
          title: "Inspect positions",
          body: "Open Positions and select a strong match. Its card and detail show the role, organisation, location, working model, score, and status. Where available, they also show prepared application documents. The step worked when you can open a result, understand why it is there, and return to the list.",
        },
        {
          title: "Decide what happens next",
          body: "Return to the office. Coordinators keep priorities moving, support advisers help you use the workspace and complete your profile, and career advisers help with goals and strategy. Explore, ask, then decide: you remain responsible for the final choice and for any application.",
        },
      ],
      preferVideo: "Prefer to watch instead?",
      videoAvailable:
        "When the video is available, you can watch it as an alternative.",
    },
    web: {
      intro:
        "The web tutorial helps you follow the work from any signed-in browser, inspect a position, give feedback, and keep conversations separate.",
      beforeYouBeginLabel: "Before you begin",
      beforeYouBegin:
        "Set up sync before signing in: in the native desktop app, open Settings, then Account, select Sign in with Google, then in the terminal that opens, open the link, enter the code and approve this device. Next select Sync now. The Cloud account row must say connected and the Device row must say paired. If the sign-in control is unavailable, start the team first; if the account still says local / guest mode after approval, repeat Sign in with Google. Then sign in to the web app with the same account. To practise every step, wait until at least one position has a score. An empty dashboard simply means the team has not yet produced a scored result.",
      steps: [
        {
          title: "Start from the dashboard",
          body: "Open Dashboard. It begins with the latest scored positions, so new results do not hide in an activity feed. On a small screen, use the navigation menu to reach the same pages. The step worked when you can see a scored result in the dashboard list and open it.",
        },
        {
          title: "Read one position",
          body: "Open a position from the dashboard or Positions. Its detail gives you the role, location, working model, score breakdown, and review or application status. Read the score with its explanation: it is a compatibility estimate, not an instruction to apply. The step worked when you can say what the position is, how it fits, and which stage it has reached.",
        },
        {
          title: "Give useful feedback in Swipe",
          body: "Open Swipe to review one position at a time. Use the decision buttons to record how interesting it is; dragging left or right only moves between cards. Choosing Not interested excludes that position from further work, and you can revise an earlier judgement. The step worked when the next card appears and the reviewed card retains your decision.",
        },
        {
          title: "Check team activity",
          body: "Open Team. Its activity view shows what is happening next and attributes the work to the relevant part of the team. Researchers find opportunities, analysts verify them, match assessors rank fit, application writers prepare requested documents, and reviewers check them. The step worked when you can connect an activity or status to its place in the pipeline.",
        },
        {
          title: "Keep conversations separate",
          body: "Open Messages and select a conversation. Support advisers answer questions about the product and your profile; career advisers focus on goals and career strategy; coordinators keep priorities moving. Each has its own thread. The step worked when changing conversation changes the thread rather than mixing replies together.",
        },
        {
          title: "Send one message and follow delivery",
          body: "Choose the support advisers, write a short question, and send it. The message appears in that thread immediately and keeps a visible delivery state; the reply returns to the same conversation. The step worked when you can see your message, its delivery progress, and the reply without leaving the thread.",
        },
        {
          title: "Finish with an informed decision",
          body: "Return to the position that matters most. Use its role, fit explanation, status, your Swipe feedback, and team context to decide what you want to do next. The web app helps you inspect and communicate; the final decision remains yours.",
        },
      ],
      preferVideo: "Prefer to watch instead?",
      videoAvailable:
        "When the video is available, you can watch it as an alternative.",
    },
  },
  it: {
    game: {
      intro:
        "Il tutorial di gioco ti aiuta a esplorare l'ufficio nativo, a capire come il lavoro attraversa il team e a controllare un risultato prima di decidere cosa fare.",
      beforeYouBeginLabel: "Prima di iniziare",
      beforeYouBegin:
        "Usa l'app desktop nativa. Per seguire tutti i passaggi dal vivo, completa prima Attiva il team: il runtime deve essere in esecuzione, un provider deve essere autenticato, il tuo profilo deve essere completo e gli orari di lavoro devono essere impostati. Puoi esplorare l'ufficio anche prima dell'attivazione, ma risposte e posizioni dal vivo richiedono un team attivo.",
      steps: [
        {
          title: "Conosci l'ufficio",
          body: "Apri l'ufficio nativo e seleziona un collega. La sua scheda mostra nome, stato corrente e responsabilità. Hai completato il passo quando riesci ad aprire una scheda e a tornare all'ufficio senza perdere il punto in cui eri.",
        },
        {
          title: "Capisci chi fa cosa",
          body: "I nomi dei reparti, sempre al plurale, che vedi in ufficio e nelle conversazioni sono: coordinatori per le priorità; consulenti di supporto per prodotto e profilo; consulenti di carriera per la direzione; ricercatori per le opportunità; analisti per la verifica; valutatori della compatibilità per spiegare l'affinità; redattori delle candidature per i documenti richiesti; revisori per controllarli prima che arrivino a te. Questi nomi sono la mappa stabile tra reparto visibile e responsabilità.",
        },
        {
          title: "Chiedi ai ricercatori",
          body: "Apri la chat con i ricercatori e chiedi che cosa sta cercando la ricerca corrente. Invia una domanda chiara. Il messaggio resta in quella conversazione e lì torna la risposta, quindi non può essere confuso con un altro thread. Il passo funziona quando il thread mostra sia la domanda sia la risposta.",
        },
        {
          title: "Segui la verifica",
          body: "Apri una conversazione con gli analisti oppure controlla l'attività di una posizione che ha superato la scoperta. Gli analisti controllano ruolo, organizzazione e dettagli prima che una posizione avanzi. Il passo funziona quando distingui un contatto trovato da un'opportunità verificata.",
        },
        {
          title: "Leggi la compatibilità",
          body: "Apri una conversazione con i valutatori della compatibilità oppure una posizione con punteggio. Confrontano l'opportunità con il tuo profilo e spiegano il punteggio. Il punteggio è una stima di compatibilità, non una decisione presa al posto tuo. Il passo funziona quando riconosci punteggio e spiegazione e puoi decidere se merita attenzione.",
        },
        {
          title: "Vedi l'intera pipeline",
          body: "Apri Posizioni, seleziona un risultato e leggi lo stato. `new` significa che i ricercatori l'hanno trovata e gli analisti la verificano dopo; `checked` significa che gli analisti hanno finito e i valutatori della compatibilità la valutano dopo; `scored` significa che hanno finito i valutatori, quindi puoi decidere o richiedere i documenti. Dopo la richiesta, `writing` significa che i redattori delle candidature li preparano, `review` che i revisori li controllano e `ready` che sono pronti per te. `applied` e `response` registrano la tua azione e il suo esito. Il passo funziona quando sai dire quale reparto è responsabile e qual è il prossimo evento per lo stato visibile.",
        },
        {
          title: "Esamina le posizioni",
          body: "Apri Posizioni e seleziona una buona corrispondenza. La scheda e il dettaglio mostrano ruolo, organizzazione, località, modalità di lavoro, punteggio e stato. Quando disponibili, mostrano anche i documenti di candidatura preparati. Il passo funziona quando apri un risultato, capisci perché è presente e torni alla lista.",
        },
        {
          title: "Decidi che cosa succede dopo",
          body: "Torna all'ufficio. I coordinatori mantengono le priorità in movimento, i consulenti di supporto ti aiutano a usare lo spazio di lavoro e a completare il profilo, mentre i consulenti di carriera aiutano con obiettivi e strategia. Esplora, chiedi, poi decidi: la scelta finale e ogni candidatura restano sotto la tua responsabilità.",
        },
      ],
      preferVideo: "Preferisci guardare il tutorial?",
      videoAvailable:
        "Quando il video sarà disponibile, potrai guardarlo come alternativa.",
    },
    web: {
      intro:
        "Il tutorial web ti aiuta a seguire il lavoro da qualunque browser autenticato, a esaminare una posizione, a lasciare un riscontro e a mantenere separate le conversazioni.",
      beforeYouBeginLabel: "Prima di iniziare",
      beforeYouBegin:
        "Configura la sincronizzazione prima di accedere: nell'app desktop nativa apri Impostazioni, poi Account, scegli Accedi con Google; nel terminale che si apre, apri il link, inserisci il codice e approva questo dispositivo, quindi scegli Sincronizza ora. La riga Account cloud deve indicare collegato e la riga Dispositivo deve indicare associato. Se il controllo di accesso non è disponibile, avvia prima il team; se dopo l'approvazione l'account indica ancora modalità locale / ospite, ripeti Accedi con Google. Poi accedi all'app web con lo stesso account. Per provare tutti i passaggi, aspetta che almeno una posizione abbia un punteggio. Una dashboard vuota significa semplicemente che il team non ha ancora prodotto un risultato valutato.",
      steps: [
        {
          title: "Parti dalla dashboard",
          body: "Apri Dashboard. Inizia dalle posizioni valutate più di recente, così i nuovi risultati non si perdono in un flusso di attività. Su uno schermo piccolo usa il menu di navigazione per arrivare alle stesse pagine. Il passo funziona quando vedi un risultato valutato nella lista della dashboard e lo apri.",
        },
        {
          title: "Leggi una posizione",
          body: "Apri una posizione dalla dashboard o da Posizioni. Il dettaglio mostra ruolo, località, modalità di lavoro, scomposizione del punteggio e stato della revisione o della candidatura. Leggi il punteggio con la sua spiegazione: è una stima di compatibilità, non un ordine di candidarti. Il passo funziona quando sai dire che cosa è la posizione, come corrisponde al tuo profilo e a quale fase è arrivata.",
        },
        {
          title: "Lascia un riscontro utile in Scorri",
          body: "Apri Scorri per valutare una posizione alla volta. Usa i pulsanti di decisione per registrare quanto ti interessa; trascinare a sinistra o a destra serve solo a passare tra le schede. Scegliere Non mi interessa esclude quella posizione dal lavoro successivo e puoi correggere una decisione precedente. Il passo funziona quando appare la scheda successiva e quella esaminata conserva la tua scelta.",
        },
        {
          title: "Controlla l'attività del team",
          body: "Apri Team. La vista attività mostra ciò che accade dopo e attribuisce il lavoro alla parte pertinente del team. I ricercatori trovano opportunità, gli analisti le verificano, i valutatori della compatibilità classificano l'affinità, i redattori delle candidature preparano i documenti richiesti e i revisori li controllano. Il passo funziona quando colleghi un'attività o uno stato al suo punto nella pipeline.",
        },
        {
          title: "Mantieni separate le conversazioni",
          body: "Apri Messaggi e seleziona una conversazione. I consulenti di supporto rispondono alle domande sul prodotto e sul profilo; i consulenti di carriera si occupano di obiettivi e strategia; i coordinatori mantengono le priorità in movimento. Ognuno ha il proprio thread. Il passo funziona quando cambiare conversazione cambia il thread, senza mescolare le risposte.",
        },
        {
          title: "Invia un messaggio e segui la consegna",
          body: "Scegli i consulenti di supporto, scrivi una domanda breve e inviala. Il messaggio compare subito in quel thread e mantiene uno stato di consegna visibile; la risposta torna nella stessa conversazione. Il passo funziona quando vedi messaggio, avanzamento della consegna e risposta senza lasciare il thread.",
        },
        {
          title: "Concludi con una decisione informata",
          body: "Torna alla posizione più importante. Usa ruolo, spiegazione della compatibilità, stato, il tuo riscontro in Scorri e il contesto del team per decidere che cosa fare dopo. L'app web ti aiuta a esaminare e comunicare; la decisione finale resta tua.",
        },
      ],
      preferVideo: "Preferisci guardare il tutorial?",
      videoAvailable:
        "Quando il video sarà disponibile, potrai guardarlo come alternativa.",
    },
  },
  es: {
    game: {
      intro:
        "El tutorial de juego te ayuda a explorar la oficina nativa, entender cómo el trabajo avanza por el equipo e inspeccionar un resultado antes de decidir qué hacer.",
      beforeYouBeginLabel: "Antes de empezar",
      beforeYouBegin:
        "Usa la aplicación de escritorio nativa. Para seguir todos los pasos en vivo, completa antes Activar equipo: el runtime debe estar en ejecución, debe haber un proveedor autenticado, tu perfil debe estar completo y el horario de trabajo debe estar definido. Puedes explorar la oficina antes de activarla, pero las respuestas y posiciones en vivo necesitan el equipo activo.",
      steps: [
        {
          title: "Conoce la oficina",
          body: "Abre la oficina nativa y selecciona a cualquier colega. Su tarjeta muestra un nombre, el estado actual y su responsabilidad. Has completado este paso cuando puedes abrir una tarjeta y volver a la oficina sin perder tu lugar.",
        },
        {
          title: "Entiende quién hace qué",
          body: "Los nombres de los departamentos, siempre en plural, que ves en la oficina y las conversaciones son: coordinadores para prioridades; asesores de asistencia para producto y perfil; asesores profesionales para dirección; investigadores para oportunidades; analistas para verificación; evaluadores de compatibilidad para explicar el encaje; redactores de candidaturas para los documentos solicitados; revisores para comprobarlos antes de que lleguen a ti. Estos nombres son el mapa estable entre un departamento visible y su responsabilidad.",
        },
        {
          title: "Pregunta a los investigadores",
          body: "Abre el chat con los investigadores y pregunta qué busca la búsqueda actual. Envía una pregunta clara. Tu mensaje permanece en esa conversación y la respuesta vuelve allí, por lo que no se confunde con otro hilo. El paso funciona cuando el hilo muestra tu pregunta y su respuesta.",
        },
        {
          title: "Sigue la verificación",
          body: "Abre una conversación con los analistas o consulta la actividad de una posición que haya avanzado desde el descubrimiento. Los analistas comprueban el puesto, la organización y los detalles antes de que la posición avance. El paso funciona cuando distingues una pista encontrada de una oportunidad verificada.",
        },
        {
          title: "Lee la compatibilidad",
          body: "Abre una conversación con los evaluadores de compatibilidad o una posición puntuada. Comparan la oportunidad con tu perfil y explican la puntuación. Una puntuación es una estimación de compatibilidad, no una decisión tomada por ti. El paso funciona cuando identificas la puntuación y su explicación y decides si merece atención.",
        },
        {
          title: "Ve toda la canalización",
          body: "Abre Posiciones, selecciona un resultado y lee su estado. `new` significa que los investigadores lo encontraron y los analistas lo verifican después; `checked` significa que los analistas terminaron y los evaluadores de compatibilidad lo puntúan después; `scored` significa que los evaluadores terminaron, así que puedes decidir o solicitar documentos. Tras tu solicitud, `writing` significa que los redactores de candidaturas los preparan, `review` que los revisores los comprueban y `ready` que están listos para ti. `applied` y `response` registran tu acción y su resultado. El paso funciona cuando puedes nombrar el departamento responsable y el siguiente evento del estado visible.",
        },
        {
          title: "Inspecciona posiciones",
          body: "Abre Posiciones y selecciona una buena coincidencia. La tarjeta y el detalle muestran puesto, organización, ubicación, modalidad de trabajo, puntuación y estado. Cuando están disponibles, también muestran los documentos de candidatura preparados. El paso funciona cuando puedes abrir un resultado, entender por qué está ahí y volver a la lista.",
        },
        {
          title: "Decide qué ocurre después",
          body: "Vuelve a la oficina. Los coordinadores mantienen las prioridades en marcha, los asesores de asistencia te ayudan a usar el espacio de trabajo y completar tu perfil, y los asesores profesionales ayudan con objetivos y estrategia. Explora, pregunta y luego decide: la elección final y cualquier candidatura siguen siendo tuyas.",
        },
      ],
      preferVideo: "¿Prefieres ver el tutorial?",
      videoAvailable:
        "Cuando el vídeo esté disponible, podrás verlo como alternativa.",
    },
    web: {
      intro:
        "El tutorial web te ayuda a seguir el trabajo desde cualquier navegador con la sesión iniciada, inspeccionar una posición, dar tu opinión y mantener separadas las conversaciones.",
      beforeYouBeginLabel: "Antes de empezar",
      beforeYouBegin:
        "Configura la sincronización antes de iniciar sesión: en la aplicación de escritorio nativa abre Ajustes y luego Cuenta, elige Entrar con Google; en el terminal que se abre, abre el enlace, introduce el código y aprueba este dispositivo, y después elige Sincronizar ahora. La fila Cuenta cloud debe indicar conectada y la fila Dispositivo, asociado. Si el control de acceso no está disponible, inicia primero el equipo; si tras aprobarlo la cuenta sigue indicando modo local / invitado, repite Entrar con Google. Después inicia sesión en la aplicación web con la misma cuenta. Para practicar todos los pasos, espera a que al menos una posición tenga una puntuación. Un panel vacío simplemente significa que el equipo aún no ha producido un resultado puntuado.",
      steps: [
        {
          title: "Empieza en el panel",
          body: "Abre Panel. Empieza con las posiciones puntuadas más recientes, para que los resultados nuevos no se oculten en un flujo de actividad. En una pantalla pequeña, usa el menú de navegación para llegar a las mismas páginas. El paso funciona cuando ves un resultado puntuado en la lista del panel y puedes abrirlo.",
        },
        {
          title: "Lee una posición",
          body: "Abre una posición desde el panel o Posiciones. El detalle muestra el puesto, la ubicación, la modalidad de trabajo, el desglose de la puntuación y el estado de revisión o candidatura. Lee la puntuación junto con su explicación: es una estimación de compatibilidad, no una orden de presentarte. El paso funciona cuando puedes explicar qué es la posición, cómo encaja contigo y a qué fase ha llegado.",
        },
        {
          title: "Da una opinión útil en Deslizar",
          body: "Abre Deslizar para revisar una posición cada vez. Usa los botones de decisión para registrar cuánto te interesa; arrastrar a izquierda o derecha solo cambia de tarjeta. Elegir No me interesa excluye esa posición del trabajo posterior y puedes revisar una decisión anterior. El paso funciona cuando aparece la siguiente tarjeta y la revisada conserva tu decisión.",
        },
        {
          title: "Consulta la actividad del equipo",
          body: "Abre Equipo. La vista de actividad muestra qué sucede después y atribuye el trabajo a la parte correspondiente del equipo. Los investigadores encuentran oportunidades, los analistas las verifican, los evaluadores de compatibilidad clasifican el encaje, los redactores de candidaturas preparan los documentos solicitados y los revisores los comprueban. El paso funciona cuando relacionas una actividad o un estado con su lugar en la canalización.",
        },
        {
          title: "Mantén las conversaciones separadas",
          body: "Abre Mensajes y selecciona una conversación. Los asesores de asistencia responden preguntas sobre el producto y tu perfil; los asesores profesionales se centran en objetivos y estrategia de carrera; los coordinadores mantienen las prioridades en marcha. Cada uno tiene su propio hilo. El paso funciona cuando al cambiar de conversación cambia el hilo sin mezclar respuestas.",
        },
        {
          title: "Envía un mensaje y sigue su entrega",
          body: "Elige a los asesores de asistencia, escribe una pregunta breve y envíala. El mensaje aparece inmediatamente en ese hilo y conserva un estado de entrega visible; la respuesta vuelve a la misma conversación. El paso funciona cuando ves el mensaje, el progreso de entrega y la respuesta sin salir del hilo.",
        },
        {
          title: "Termina con una decisión informada",
          body: "Vuelve a la posición que más te importa. Usa su puesto, explicación de compatibilidad, estado, tu opinión en Deslizar y el contexto del equipo para decidir qué quieres hacer después. La aplicación web te ayuda a inspeccionar y comunicarte; la decisión final es tuya.",
        },
      ],
      preferVideo: "¿Prefieres ver el tutorial?",
      videoAvailable:
        "Cuando el vídeo esté disponible, podrás verlo como alternativa.",
    },
  },
  fr: {
    game: {
      intro:
        "Le tutoriel de jeu vous aide à explorer le bureau natif, à comprendre comment le travail circule dans l'équipe et à examiner un résultat avant de décider de la suite.",
      beforeYouBeginLabel: "Avant de commencer",
      beforeYouBegin:
        "Utilisez l'application de bureau native. Pour suivre chaque étape en direct, terminez d'abord Activer l'équipe : le runtime doit être en cours d'exécution, un fournisseur doit être authentifié, votre profil doit être complet et les heures de travail doivent être définies. Vous pouvez explorer le bureau avant l'activation, mais les réponses et les positions en direct exigent une équipe active.",
      steps: [
        {
          title: "Découvrez le bureau",
          body: "Ouvrez le bureau natif et sélectionnez n'importe quel collègue. Sa fiche affiche un nom, son état actuel et sa responsabilité. Cette étape est terminée lorsque vous pouvez ouvrir une fiche puis revenir au bureau sans perdre votre place.",
        },
        {
          title: "Comprenez qui fait quoi",
          body: "Les noms de départements, toujours au pluriel, que vous voyez dans le bureau et les conversations sont : coordinateurs pour les priorités ; conseillers d'assistance pour le produit et votre profil ; conseillers de carrière pour la direction ; chercheurs pour les opportunités ; analystes pour la vérification ; évaluateurs de compatibilité pour expliquer l'adéquation ; rédacteurs de candidatures pour les documents demandés ; réviseurs pour les contrôler avant qu'ils ne vous arrivent. Ces noms sont la carte stable entre un département visible et sa responsabilité.",
        },
        {
          title: "Demandez aux chercheurs",
          body: "Ouvrez la conversation avec les chercheurs et demandez ce que recherche la prospection en cours. Envoyez une question claire. Votre message reste dans cette conversation et la réponse y revient, sans pouvoir être confondue avec un autre fil. L'étape fonctionne lorsque le fil affiche votre question et sa réponse.",
        },
        {
          title: "Suivez la vérification",
          body: "Ouvrez une conversation avec les analystes ou consultez l'activité d'une position qui a dépassé la découverte. Les analystes vérifient le poste, l'organisation et les détails avant qu'une position progresse. L'étape fonctionne lorsque vous distinguez une piste trouvée d'une opportunité vérifiée.",
        },
        {
          title: "Lisez la compatibilité",
          body: "Ouvrez une conversation avec les évaluateurs de compatibilité ou une position notée. Ils comparent l'opportunité à votre profil et expliquent la note. Une note est une estimation de compatibilité, pas une décision prise à votre place. L'étape fonctionne lorsque vous repérez la note et son explication, puis décidez si l'opportunité mérite votre attention.",
        },
        {
          title: "Voyez tout le pipeline",
          body: "Ouvrez Positions, sélectionnez un résultat et lisez son état. `new` signifie que les chercheurs l'ont trouvé et que les analystes le vérifient ensuite ; `checked` signifie que les analystes ont fini et que les évaluateurs de compatibilité le notent ensuite ; `scored` signifie que les évaluateurs ont fini : vous pouvez décider ou demander des documents. Après votre demande, `writing` signifie que les rédacteurs de candidatures les préparent, `review` que les réviseurs les contrôlent et `ready` qu'ils sont prêts pour vous. `applied` et `response` enregistrent votre action et son résultat. L'étape fonctionne lorsque vous pouvez nommer le département responsable et l'événement suivant pour l'état visible.",
        },
        {
          title: "Examinez les positions",
          body: "Ouvrez Positions et sélectionnez une bonne correspondance. Sa fiche et son détail affichent le poste, l'organisation, le lieu, le mode de travail, la note et l'état. Lorsqu'ils sont disponibles, les documents de candidature préparés apparaissent aussi. L'étape fonctionne lorsque vous pouvez ouvrir un résultat, comprendre pourquoi il est là et revenir à la liste.",
        },
        {
          title: "Décidez de la suite",
          body: "Revenez au bureau. Les coordinateurs font avancer les priorités, les conseillers d'assistance vous aident à utiliser l'espace de travail et à compléter votre profil, et les conseillers de carrière vous aident avec vos objectifs et votre stratégie. Explorez, demandez, puis décidez : le choix final et toute candidature restent de votre ressort.",
        },
      ],
      preferVideo: "Vous préférez regarder le tutoriel ?",
      videoAvailable:
        "Lorsque la vidéo sera disponible, vous pourrez la regarder comme alternative.",
    },
    web: {
      intro:
        "Le tutoriel web vous aide à suivre le travail depuis tout navigateur connecté, à examiner une position, à donner votre avis et à garder les conversations séparées.",
      beforeYouBeginLabel: "Avant de commencer",
      beforeYouBegin:
        "Configurez la synchronisation avant de vous connecter : dans l'application de bureau native, ouvrez Paramètres, puis Compte, choisissez Se connecter avec Google ; dans le terminal qui s'ouvre, ouvrez le lien, saisissez le code et approuvez cet appareil, puis choisissez Synchroniser maintenant. La ligne Compte cloud doit indiquer connecté et la ligne Appareil, associé. Si le contrôle de connexion est indisponible, démarrez d'abord l'équipe ; si le compte indique encore mode local / invité après l'approbation, recommencez Se connecter avec Google. Connectez-vous ensuite à l'application web avec le même compte. Pour pratiquer toutes les étapes, attendez qu'au moins une position ait une note. Un tableau de bord vide signifie simplement que l'équipe n'a pas encore produit de résultat noté.",
      steps: [
        {
          title: "Commencez par le tableau de bord",
          body: "Ouvrez Dashboard. Il commence par les positions les plus récemment notées, afin que les nouveaux résultats ne se cachent pas dans un flux d'activité. Sur petit écran, utilisez le menu de navigation pour atteindre les mêmes pages. L'étape fonctionne lorsque vous voyez un résultat noté dans la liste du tableau de bord et pouvez l'ouvrir.",
        },
        {
          title: "Lisez une position",
          body: "Ouvrez une position depuis le tableau de bord ou Positions. Son détail donne le poste, le lieu, le mode de travail, le détail de la note et l'état de la révision ou de la candidature. Lisez la note avec son explication : c'est une estimation de compatibilité, pas une instruction de postuler. L'étape fonctionne lorsque vous pouvez dire ce qu'est la position, comment elle vous correspond et à quelle étape elle est.",
        },
        {
          title: "Donnez un avis utile dans Swipe",
          body: "Ouvrez Swipe pour examiner une position à la fois. Utilisez les boutons de décision pour indiquer votre intérêt ; faire glisser à gauche ou à droite sert seulement à passer d'une carte à l'autre. Choisir Pas intéressé écarte cette position du travail ultérieur et vous pouvez réviser un jugement précédent. L'étape fonctionne lorsque la carte suivante apparaît et que la carte examinée conserve votre décision.",
        },
        {
          title: "Vérifiez l'activité de l'équipe",
          body: "Ouvrez Team. Sa vue d'activité montre ce qui se passe ensuite et attribue le travail à la partie concernée de l'équipe. Les chercheurs trouvent les opportunités, les analystes les vérifient, les évaluateurs de compatibilité classent l'adéquation, les rédacteurs de candidatures préparent les documents demandés et les réviseurs les contrôlent. L'étape fonctionne lorsque vous reliez une activité ou un état à sa place dans le pipeline.",
        },
        {
          title: "Gardez les conversations séparées",
          body: "Ouvrez Messages et sélectionnez une conversation. Les conseillers d'assistance répondent aux questions sur le produit et votre profil ; les conseillers de carrière se concentrent sur les objectifs et la stratégie de carrière ; les coordinateurs font avancer les priorités. Chacun possède son propre fil. L'étape fonctionne lorsque changer de conversation change le fil sans mélanger les réponses.",
        },
        {
          title: "Envoyez un message et suivez sa livraison",
          body: "Choisissez les conseillers d'assistance, écrivez une question courte et envoyez-la. Le message apparaît aussitôt dans ce fil et conserve un état de livraison visible ; la réponse revient dans la même conversation. L'étape fonctionne lorsque vous voyez le message, sa progression de livraison et la réponse sans quitter le fil.",
        },
        {
          title: "Terminez par une décision informée",
          body: "Revenez à la position qui compte le plus. Utilisez son poste, son explication de compatibilité, son état, votre avis dans Swipe et le contexte de l'équipe pour décider de la suite. L'app web vous aide à examiner et à communiquer ; la décision finale reste la vôtre.",
        },
      ],
      preferVideo: "Vous préférez regarder le tutoriel ?",
      videoAvailable:
        "Lorsque la vidéo sera disponible, vous pourrez la regarder comme alternative.",
    },
  },
  de: {
    game: {
      intro:
        "Das Spiel-Tutorial hilft dir, das native Büro zu erkunden, den Ablauf der Arbeit im Team zu verstehen und ein Ergebnis zu prüfen, bevor du entscheidest, was als Nächstes geschieht.",
      beforeYouBeginLabel: "Bevor du beginnst",
      beforeYouBegin:
        "Verwende die native Desktop-App. Um alle Schritte live zu verfolgen, schließe zuerst Team aktivieren ab: Die Runtime muss laufen, ein Anbieter muss angemeldet sein, dein Profil muss vollständig sein und die Arbeitszeiten müssen festgelegt sein. Du kannst das Büro vor der Aktivierung erkunden, aber LiveAntworten und Positionen brauchen ein aktives Team.",
      steps: [
        {
          title: "Lerne das Büro kennen",
          body: "Öffne das native Büro und wähle einen beliebigen Kollegen aus. Seine Karte zeigt einen Namen, den aktuellen Status und die Aufgabe. Dieser Schritt ist abgeschlossen, wenn du eine Karte öffnen und zum Büro zurückkehren kannst, ohne deinen Platz zu verlieren.",
        },
        {
          title: "Verstehe, wer was macht",
          body: "Die Abteilungsnamen, die du im Büro und in Gesprächen siehst, stehen immer im Plural: Koordinatoren für Prioritäten; Support-Berater für Produkt und Profil; Karriereberater für Orientierung; Rechercheure für Chancen; Analysten für die Prüfung; Passungsbewerter für die Erklärung der Passung; Bewerbungsautoren für angeforderte Unterlagen; Prüfer für die Kontrolle, bevor sie dich erreichen. Diese Namen sind die stabile Zuordnung zwischen sichtbarer Abteilung und Verantwortung.",
        },
        {
          title: "Frage die Rechercheure",
          body: "Öffne den Chat mit den Rechercheuren und frage, wonach die aktuelle Suche sucht. Sende eine klare Frage. Deine Nachricht bleibt in dieser Unterhaltung und die Antwort kehrt dorthin zurück; sie kann daher nicht mit einem anderen Thread verwechselt werden. Der Schritt hat funktioniert, wenn der Thread deine Frage und die Antwort zeigt.",
        },
        {
          title: "Verfolge die Prüfung",
          body: "Öffne eine Unterhaltung mit den Analysten oder prüfe die Aktivität für eine Position, die die Entdeckung hinter sich hat. Analysten prüfen Rolle, Organisation und Details, bevor eine Position weitergeht. Der Schritt hat funktioniert, wenn du einen gefundenen Hinweis von einer geprüften Chance unterscheiden kannst.",
        },
        {
          title: "Lies die Passung",
          body: "Öffne eine Unterhaltung mit den Passungsbewertern oder eine bewertete Position. Sie vergleichen die Chance mit deinem Profil und erklären die Bewertung. Eine Bewertung ist eine Schätzung der Passung, keine Entscheidung an deiner Stelle. Der Schritt hat funktioniert, wenn du Bewertung und Erklärung erkennst und entscheidest, ob die Chance deine Aufmerksamkeit verdient.",
        },
        {
          title: "Sieh die ganze Pipeline",
          body: "Öffne Positions, wähle ein Ergebnis und lies seinen Status. `new` bedeutet: Rechercheure haben es gefunden und Analysten prüfen es als Nächstes. `checked` bedeutet: Analysten sind fertig und Passungsbewerter bewerten es als Nächstes. `scored` bedeutet: Passungsbewerter sind fertig; du kannst entscheiden oder Unterlagen anfordern. Nach deiner Anforderung bedeutet `writing`, dass Bewerbungsautoren sie vorbereiten, `review`, dass Prüfer sie kontrollieren, und `ready`, dass sie für dich bereit sind. `applied` und `response` zeichnen deine Handlung und ihr Ergebnis auf. Der Schritt hat funktioniert, wenn du für den sichtbaren Status die zuständige Abteilung und das nächste Ereignis nennen kannst.",
        },
        {
          title: "Untersuche Positionen",
          body: "Öffne Positions und wähle eine gute Übereinstimmung. Karte und Detail zeigen Rolle, Organisation, Ort, Arbeitsmodell, Bewertung und Status. Falls vorhanden, zeigen sie auch vorbereitete Bewerbungsunterlagen. Der Schritt hat funktioniert, wenn du ein Ergebnis öffnen, verstehen kannst, warum es dort ist, und zur Liste zurückkehrst.",
        },
        {
          title: "Entscheide über den nächsten Schritt",
          body: "Kehre zum Büro zurück. Koordinatoren halten Prioritäten in Bewegung, Support-Berater helfen dir, den Arbeitsbereich zu nutzen und dein Profil zu vervollständigen, und Karriereberater helfen bei Zielen und Strategie. Erkunde, frage, dann entscheide: Die endgültige Wahl und jede Bewerbung bleiben deine Verantwortung.",
        },
      ],
      preferVideo: "Möchtest du das Tutorial lieber ansehen?",
      videoAvailable:
        "Sobald das Video verfügbar ist, kannst du es als Alternative ansehen.",
    },
    web: {
      intro:
        "Das Web-Tutorial hilft dir, die Arbeit von jedem angemeldeten Browser aus zu verfolgen, eine Position zu prüfen, Rückmeldung zu geben und Gespräche getrennt zu halten.",
      beforeYouBeginLabel: "Bevor du beginnst",
      beforeYouBegin:
        "Richte die Synchronisierung vor der Anmeldung ein: Öffne in der nativen Desktop-App Einstellungen, dann Account, wähle Mit Google anmelden; öffne im angezeigten Terminal den Link, gib den Code ein und bestätige dieses Gerät. Wähle dann Jetzt synchronisieren. Die Zeile Cloud-Konto muss verbunden und die Zeile Gerät zugeordnet anzeigen. Falls die Anmeldung nicht verfügbar ist, starte zuerst das Team; zeigt der Account nach der Bestätigung weiter lokaler Modus / Gast, wiederhole Mit Google anmelden. Melde dich dann mit demselben Konto in der Web-App an. Um jeden Schritt zu üben, warte, bis mindestens eine Position eine Bewertung hat. Ein leeres Dashboard bedeutet nur, dass das Team noch kein bewertetes Ergebnis erzeugt hat.",
      steps: [
        {
          title: "Starte im Dashboard",
          body: "Öffne Dashboard. Es beginnt mit den zuletzt bewerteten Positionen, damit neue Ergebnisse nicht in einem Aktivitätenstrom verschwinden. Auf einem kleinen Bildschirm verwendest du das Navigationsmenü, um dieselben Seiten zu erreichen. Der Schritt hat funktioniert, wenn du ein bewertetes Ergebnis in der Dashboard-Liste siehst und öffnen kannst.",
        },
        {
          title: "Lies eine Position",
          body: "Öffne eine Position im Dashboard oder unter Positions. Ihr Detail zeigt Rolle, Ort, Arbeitsmodell, Aufschlüsselung der Bewertung und Prüf- oder Bewerbungsstatus. Lies die Bewertung zusammen mit ihrer Erklärung: Sie ist eine Schätzung der Passung, keine Aufforderung, dich zu bewerben. Der Schritt hat funktioniert, wenn du sagen kannst, was die Position ist, wie sie zu dir passt und welche Phase sie erreicht hat.",
        },
        {
          title: "Gib nützliches Feedback in Swipe",
          body: "Öffne Swipe, um jeweils eine Position zu prüfen. Verwende die Entscheidungsschaltflächen, um dein Interesse festzuhalten; Ziehen nach links oder rechts wechselt nur zwischen Karten. Mit Nicht interessiert schließt du diese Position von weiterer Arbeit aus und kannst ein früheres Urteil ändern. Der Schritt hat funktioniert, wenn die nächste Karte erscheint und die geprüfte Karte deine Entscheidung behält.",
        },
        {
          title: "Prüfe die Teamaktivität",
          body: "Öffne Team. Die Aktivitätsansicht zeigt, was als Nächstes geschieht, und ordnet die Arbeit dem zuständigen Teil des Teams zu. Rechercheure finden Chancen, Analysten prüfen sie, Passungsbewerter ordnen die Passung ein, Bewerbungsautoren bereiten angeforderte Unterlagen vor und Prüfer kontrollieren sie. Der Schritt hat funktioniert, wenn du eine Aktivität oder einen Status mit ihrem Platz in der Pipeline verbinden kannst.",
        },
        {
          title: "Halte Gespräche getrennt",
          body: "Öffne Messages und wähle eine Unterhaltung. Support-Berater beantworten Fragen zum Produkt und deinem Profil; Karriereberater konzentrieren sich auf Ziele und Karriere-Strategie; Koordinatoren halten Prioritäten in Bewegung. Jeder hat einen eigenen Thread. Der Schritt hat funktioniert, wenn ein Wechsel der Unterhaltung den Thread wechselt, statt Antworten zu vermischen.",
        },
        {
          title: "Sende eine Nachricht und verfolge die Zustellung",
          body: "Wähle die SupportBerater, schreibe eine kurze Frage und sende sie. Die Nachricht erscheint sofort in diesem Thread und behält einen sichtbaren Zustellstatus; die Antwort kehrt in dieselbe Unterhaltung zurück. Der Schritt hat funktioniert, wenn du Nachricht, Zustellfortschritt und Antwort siehst, ohne den Thread zu verlassen.",
        },
        {
          title: "Schließe mit einer informierten Entscheidung ab",
          body: "Kehre zu der Position zurück, die dir am wichtigsten ist. Nutze Rolle, Passungserklärung, Status, dein Swipe-Feedback und den Teamkontext, um zu entscheiden, was du als Nächstes tun möchtest. Die Web-App hilft dir beim Prüfen und Kommunizieren; die endgültige Entscheidung bleibt bei dir.",
        },
      ],
      preferVideo: "Möchtest du das Tutorial lieber ansehen?",
      videoAvailable:
        "Sobald das Video verfügbar ist, kannst du es als Alternative ansehen.",
    },
  },
  pt: {
    game: {
      intro:
        "O tutorial de jogo ajuda-te a explorar o escritório nativo, a compreender como o trabalho avança pela equipa e a inspecionar um resultado antes de decidires o que fazer.",
      beforeYouBeginLabel: "Antes de começares",
      beforeYouBegin:
        "Usa a aplicação de ambiente de trabalho nativa. Para seguires todos os passos ao vivo, conclui primeiro Ativar equipa: o runtime tem de estar em execução, um fornecedor tem de estar autenticado, o teu perfil tem de estar completo e o horário de trabalho tem de estar definido. Podes explorar o escritório antes da ativação, mas as respostas e posições ao vivo exigem uma equipa ativa.",
      steps: [
        {
          title: "Conhece o escritório",
          body: "Abre o escritório nativo e seleciona qualquer colega. O cartão mostra um nome, o estado atual e a responsabilidade. Este passo está concluído quando consegues abrir um cartão e voltar ao escritório sem perderes o ponto onde estavas.",
        },
        {
          title: "Percebe quem faz o quê",
          body: "Os nomes dos departamentos que vês no escritório e nas conversas estão sempre no plural: coordenadores para prioridades; consultores de apoio para produto e perfil; consultores de carreira para direção; investigadores para oportunidades; analistas para verificação; avaliadores de compatibilidade para explicar a adequação; redatores de candidaturas para documentos solicitados; revisores para os conferir antes de chegarem até ti. Estes nomes são o mapa estável entre um departamento visível e a sua responsabilidade.",
        },
        {
          title: "Pergunta aos investigadores",
          body: "Abre a conversa com os investigadores e pergunta o que a pesquisa atual procura. Envia uma pergunta clara. A tua mensagem fica nessa conversa e a resposta regressa a ela, por isso não pode ser confundida com outro tópico. O passo resulta quando o tópico mostra a tua pergunta e a respetiva resposta.",
        },
        {
          title: "Acompanha a verificação",
          body: "Abre uma conversa com os analistas ou consulta a atividade de uma posição que tenha avançado desde a descoberta. Os analistas verificam a função, a organização e os detalhes antes de uma posição avançar. O passo resulta quando distingues uma pista encontrada de uma oportunidade verificada.",
        },
        {
          title: "Lê a compatibilidade",
          body: "Abre uma conversa com os avaliadores de compatibilidade ou uma posição com pontuação. Eles comparam a oportunidade com o teu perfil e explicam a pontuação. Uma pontuação é uma estimativa de compatibilidade, não uma decisão tomada por ti. O passo resulta quando identificas a pontuação e a explicação e decides se a oportunidade merece atenção.",
        },
        {
          title: "Vê todo o pipeline",
          body: "Abre Posições, seleciona um resultado e lê o estado. `new` significa que os investigadores o encontraram e os analistas o verificam a seguir; `checked` significa que os analistas terminaram e os avaliadores de compatibilidade o pontuam a seguir; `scored` significa que os avaliadores terminaram, pelo que podes decidir ou pedir documentos. Depois do teu pedido, `writing` significa que os redatores de candidaturas os preparam, `review` que os revisores os conferem e `ready` que estão prontos para ti. `applied` e `response` registam a tua ação e o respetivo resultado. O passo resulta quando consegues indicar o departamento responsável e o próximo evento do estado visível.",
        },
        {
          title: "Inspeciona posições",
          body: "Abre Posições e seleciona uma boa correspondência. O cartão e o detalhe mostram função, organização, localização, modelo de trabalho, pontuação e estado. Quando disponíveis, mostram também os documentos de candidatura preparados. O passo resulta quando consegues abrir um resultado, perceber porque está ali e regressar à lista.",
        },
        {
          title: "Decide o que acontece a seguir",
          body: "Volta ao escritório. Os coordenadores mantêm as prioridades em movimento, os consultores de apoio ajudam-te a usar o espaço de trabalho e a completar o perfil, e os consultores de carreira ajudam com objetivos e estratégia. Explora, pergunta e depois decide: a escolha final e qualquer candidatura continuam a ser da tua responsabilidade.",
        },
      ],
      preferVideo: "Preferes ver o tutorial?",
      videoAvailable:
        "Quando o vídeo estiver disponível, poderás vê-lo como alternativa.",
    },
    web: {
      intro:
        "O tutorial web ajuda-te a acompanhar o trabalho a partir de qualquer navegador com sessão iniciada, a inspecionar uma posição, a dar opinião e a manter as conversas separadas.",
      beforeYouBeginLabel: "Antes de começares",
      beforeYouBegin:
        "Configura a sincronização antes de iniciares sessão: na aplicação de ambiente de trabalho nativa abre Configurações, depois Conta, escolhe Entrar com o Google; no terminal que se abre, abre a ligação, introduz o código e aprova este dispositivo; depois escolhe Sincronizar agora. A linha Conta cloud deve indicar ligada e a linha Dispositivo, associado. Se o controlo de início de sessão não estiver disponível, inicia primeiro a equipa; se, depois da aprovação, a conta ainda indicar modo local / convidado, repete Entrar com o Google. Depois inicia sessão na aplicação web com a mesma conta. Para praticares todos os passos, espera que pelo menos uma posição tenha uma pontuação. Um dashboard vazio significa apenas que a equipa ainda não produziu um resultado pontuado.",
      steps: [
        {
          title: "Começa no painel",
          body: "Abre Dashboard. Começa pelas posições pontuadas mais recentemente, para que os novos resultados não se percam num fluxo de atividade. Num ecrã pequeno, usa o menu de navegação para chegares às mesmas páginas. O passo resulta quando vês um resultado pontuado na lista do painel e o consegues abrir.",
        },
        {
          title: "Lê uma posição",
          body: "Abre uma posição a partir do painel ou de Posições. O detalhe mostra a função, localização, modelo de trabalho, decomposição da pontuação e estado de revisão ou candidatura. Lê a pontuação com a explicação: é uma estimativa de compatibilidade, não uma instrução para te candidatares. O passo resulta quando consegues dizer o que é a posição, como ela se adequa a ti e a que fase chegou.",
        },
        {
          title: "Dá opinião útil em Deslizar",
          body: "Abre Deslizar para rever uma posição de cada vez. Usa os botões de decisão para registar o teu interesse; arrastar à esquerda ou à direita serve apenas para mudar de cartão. Escolher Não me interessa exclui essa posição do trabalho posterior e podes rever uma decisão anterior. O passo resulta quando aparece o cartão seguinte e o cartão revisto mantém a tua decisão.",
        },
        {
          title: "Verifica a atividade da equipa",
          body: "Abre Equipa. A vista de atividade mostra o que acontece a seguir e atribui o trabalho à parte relevante da equipa. Os investigadores encontram oportunidades, os analistas verificamnas, os avaliadores de compatibilidade classificam a adequação, os redatores de candidaturas preparam os documentos solicitados e os revisores conferemnos. O passo resulta quando ligas uma atividade ou um estado ao seu lugar no pipeline.",
        },
        {
          title: "Mantém as conversas separadas",
          body: "Abre Mensagens e seleciona uma conversa. Os consultores de apoio respondem a perguntas sobre o produto e o teu perfil; os consultores de carreira concentram-se em objetivos e estratégia de carreira; os coordenadores mantêm as prioridades em movimento. Cada um tem o seu próprio tópico. O passo resulta quando mudar de conversa muda o tópico em vez de misturar respostas.",
        },
        {
          title: "Envia uma mensagem e acompanha a entrega",
          body: "Escolhe os consultores de apoio, escreve uma pergunta curta e envia-a. A mensagem aparece logo nesse tópico e mantém um estado de entrega visível; a resposta regressa à mesma conversa. O passo resulta quando vês a mensagem, o progresso da entrega e a resposta sem sair do tópico.",
        },
        {
          title: "Termina com uma decisão informada",
          body: "Volta à posição que mais importa. Usa a função, a explicação de compatibilidade, o estado, a tua opinião em Deslizar e o contexto da equipa para decidir o que queres fazer a seguir. A aplicação web ajuda-te a inspecionar e comunicar; a decisão final é tua.",
        },
      ],
      preferVideo: "Preferes ver o tutorial?",
      videoAvailable:
        "Quando o vídeo estiver disponível, poderás vê-lo como alternativa.",
    },
  },
  hu: {
    game: {
      intro:
        "A játék oktatóanyaga segít felfedezni a natív irodát, megérteni, hogyan halad át a munka a csapaton, és ellenőrizni egy eredményt, mielőtt eldöntenéd, mi legyen a következő lépés.",
      beforeYouBeginLabel: "Mielőtt elkezded",
      beforeYouBegin:
        "Használd a natív asztali alkalmazást. Az összes élő lépés követéséhez előbb fejezd be a Csapat aktiválása lépést: a runtime-nak futnia kell, egy szolgáltatónak hitelesítve kell lennie, a profilodnak teljesnek kell lennie, és a munkaidőt be kell állítani. Aktiválás előtt is felfedezheted az irodát, de az élő válaszokhoz és pozíciókhoz aktív csapat szükséges.",
      steps: [
        {
          title: "Ismerd meg az irodát",
          body: "Nyisd meg a natív irodát, és válassz ki bármelyik kollégát. A kártyája megmutatja a nevét, aktuális állapotát és feladatát. A lépést akkor teljesítetted, amikor meg tudsz nyitni egy kártyát, majd anélkül térsz vissza az irodába, hogy elveszítenéd, hol tartottál.",
        },
        {
          title: "Értsd meg, ki mit csinál",
          body: "Az irodában és a beszélgetésekben látható részlegnevek mindig többes számban vannak: koordinátorok a prioritásokért; támogatási tanácsadók a termékért és a profilodért; karrier-tanácsadók az irányért; kutatók a lehetőségekért; elemzők az ellenőrzésért; illeszkedés-értékelők az egyezés magyarázatáért; pályázatírók a kért dokumentumokért; ellenőrök azok átnézéséért, mielőtt hozzád érnek. Ezek a nevek jelentik a stabil térképet a látható részleg és felelőssége között.",
        },
        {
          title: "Kérdezd meg a kutatókat",
          body: "Nyisd meg a kutatókkal folytatott csevegést, és kérdezd meg, mire irányul az aktuális keresés. Küldj egy világos kérdést. Az üzeneted ebben a beszélgetésben marad, és a válasz is ide érkezik, ezért nem keverhető össze másik beszélgetéssel. A lépés akkor sikerült, amikor a beszélgetésben látod a kérdésedet és a választ is.",
        },
        {
          title: "Kövesd az ellenőrzést",
          body: "Nyiss meg egy beszélgetést az elemzőkkel, vagy nézd meg egy olyan pozíció aktivitását, amely már túljutott a felfedezésen. Az elemzők a szerepet, a szervezetet és a részleteket ellenőrzik, mielőtt egy pozíció továbblép. A lépés akkor sikerült, amikor meg tudod különböztetni a megtalált nyomot az ellenőrzött lehetőségtől.",
        },
        {
          title: "Olvasd el az illeszkedést",
          body: "Nyiss meg egy beszélgetést az illeszkedés-értékelőkkel vagy egy pontozott pozíciót. Összevetik a lehetőséget a profiloddal, és elmagyarázzák a pontszámot. A pontszám az illeszkedés becslése, nem helyetted meghozott döntés. A lépés akkor sikerült, amikor felismered a pontszámot és a magyarázatát, majd eldöntöd, megérdemli-e a lehetőség a figyelmedet.",
        },
        {
          title: "Lásd az egész folyamatot",
          body: "Nyisd meg a Pozíciók nézetet, válassz egy eredményt, és olvasd el az állapotát. A `new` azt jelenti, hogy a kutatók megtalálták, az elemzők következnek; a `checked` azt, hogy az elemzők végeztek, az illeszkedés-értékelők pontoznak ezután; a `scored` azt, hogy az értékelők végeztek, így dönthetsz vagy kérhetsz dokumentumokat. A kérésed után a `writing` azt jelenti, hogy a pályázatírók készítik őket, a `review`, hogy az ellenőrök átnézik, a `ready`, hogy készen állnak neked. Az `applied` és a `response` a te lépésedet és annak eredményét rögzíti. A lépés akkor sikerült, amikor a látható állapothoz meg tudod nevezni a felelős részleget és a következő eseményt.",
        },
        {
          title: "Vizsgáld meg a pozíciókat",
          body: "Nyisd meg a Pozíciók nézetet, és válassz egy jó egyezést. A kártya és a részletek mutatják a szerepet, szervezetet, helyet, munkamódot, pontszámot és állapotot. Ha rendelkezésre állnak, az elkészített pályázati dokumentumok is megjelennek. A lépés akkor sikerült, amikor megnyitsz egy eredményt, megérted, miért van ott, és visszatérsz a listához.",
        },
        {
          title: "Döntsd el, mi történjen ezután",
          body: "Térj vissza az irodába. A koordinátorok mozgásban tartják a prioritásokat, a támogatási tanácsadók segítenek a munkaterület használatában és a profilod kitöltésében, a karrier-tanácsadók pedig a célokkal és a stratégiával segítenek. Fedezz fel, kérdezz, aztán dönts: a végső választás és minden pályázat a te felelősséged marad.",
        },
      ],
      preferVideo: "Inkább megnéznéd az oktatóvideót?",
      videoAvailable:
        "Amikor a videó elérhető lesz, alternatívaként megnézheted.",
    },
    web: {
      intro:
        "A webes oktatóanyag segít a munkát bármely bejelentkezett böngészőből követni, egy pozíciót megvizsgálni, visszajelzést adni és a beszélgetéseket elkülönítve tartani.",
      beforeYouBeginLabel: "Mielőtt elkezded",
      beforeYouBegin:
        "Bejelentkezés előtt állítsd be a szinkronizálást: a natív asztali alkalmazásban nyisd meg a Beállítások, majd a Fiók nézetet, válaszd a Belépés Google-lel lehetőséget; a megnyíló terminálban nyisd meg a linket, írd be a kódot és hagyd jóvá ezt az eszközt, majd válaszd a Szinkronizálás most lehetőséget. A Felhőfiók sorának csatlakoztatva, az Eszköz sorának társítva állapotot kell mutatnia. Ha a belépési vezérlő nem elérhető, előbb indítsd el a csapatot; ha a jóváhagyás után a fiók még mindig helyi / vendég módban van, ismételd meg a Belépés Google-lel lépést. Ezután ugyanazzal a fiókkal jelentkezz be a webalkalmazásba. Minden lépés gyakorlásához várd meg, amíg legalább egy pozíciónak lesz pontszáma. Az üres irányítópult egyszerűen azt jelenti, hogy a csapat még nem hozott létre pontozott eredményt.",
      steps: [
        {
          title: "Kezdd az irányítópulttal",
          body: "Nyisd meg a Dashboard nézetet. A legutóbb pontozott pozíciókkal kezdődik, így az új eredmények nem vesznek el egy aktivitási hírfolyamban. Kis képernyőn a navigációs menüvel éred el ugyanazokat az oldalakat. A lépés akkor sikerült, amikor látsz egy pontozott eredményt az irányítópult listájában, és meg tudod nyitni.",
        },
        {
          title: "Olvass el egy pozíciót",
          body: "Nyiss meg egy pozíciót az irányítópultról vagy a Pozíciók nézetből. A részletek megadják a szerepet, helyet, munkamódot, a pontszám bontását és az ellenőrzés vagy pályázat állapotát. Olvasd a pontszámot a magyarázatával együtt: az illeszkedés becslése, nem utasítás a pályázásra. A lépés akkor sikerült, amikor el tudod mondani, mi a pozíció, hogyan illik hozzád, és melyik szakaszba ért.",
        },
        {
          title: "Adj hasznos visszajelzést a Húzás nézetben",
          body: "Nyisd meg a Húzás nézetet, hogy egyszerre egy pozíciót vizsgálj meg. A döntési gombokkal rögzítsd, mennyire érdekel; a balra vagy jobbra húzás csak a kártyák közötti váltásra szolgál. A Nem érdekel választása kizárja a pozíciót a további munkából, és egy korábbi döntésedet is módosíthatod. A lépés akkor sikerült, amikor megjelenik a következő kártya, a vizsgált pedig megőrzi a döntésedet.",
        },
        {
          title: "Ellenőrizd a csapat aktivitását",
          body: "Nyisd meg a Csapat nézetet. Az aktivitási nézet megmutatja, mi történik ezután, és a munkát a csapat megfelelő részéhez rendeli. A kutatók lehetőségeket találnak, az elemzők ellenőrzik azokat, az illeszkedés-értékelők rangsorolják az egyezést, a pályázatírók elkészítik a kért dokumentumokat, az ellenőrök pedig átnézik őket. A lépés akkor sikerült, amikor egy aktivitást vagy állapotot össze tudsz kapcsolni a folyamatban elfoglalt helyével.",
        },
        {
          title: "Tartsd elkülönítve a beszélgetéseket",
          body: "Nyisd meg az Üzenetek nézetet, és válassz egy beszélgetést. A támogatási tanácsadók a termékkel és a profiloddal kapcsolatos kérdésekre válaszolnak; a karrier-tanácsadók a célokra és a karrierstratégiára összpontosítanak; a koordinátorok mozgásban tartják a prioritásokat. Mindegyiknek saját beszélgetési szála van. A lépés akkor sikerült, amikor a beszélgetés megváltoztatása a szálat is megváltoztatja anélkül, hogy összekeverné a válaszokat.",
        },
        {
          title: "Küldj üzenetet, és kövesd a kézbesítést",
          body: "Válaszd a támogatási tanácsadókat, írj rövid kérdést, és küldd el. Az üzenet azonnal megjelenik abban a szálban, és látható kézbesítési állapotot tart fenn; a válasz ugyanabba a beszélgetésbe érkezik vissza. A lépés akkor sikerült, amikor látod az üzenetet, a kézbesítés előrehaladását és a választ anélkül, hogy elhagynád a szálat.",
        },
        {
          title: "Tájékozott döntéssel fejezd be",
          body: "Térj vissza ahhoz a pozícióhoz, amely a legfontosabb neked. A szerep, az illeszkedés magyarázata, az állapot, a Húzás nézetben adott visszajelzésed és a csapat környezete alapján döntsd el, mit szeretnél tenni ezután. A webalkalmazás segít megvizsgálni és kommunikálni; a végső döntés a tiéd marad.",
        },
      ],
      preferVideo: "Inkább megnéznéd az oktatóvideót?",
      videoAvailable:
        "Amikor a videó elérhető lesz, alternatívaként megnézheted.",
    },
  },
} satisfies Record<Lang, Record<TutorialId, TutorialGuide>>;

export const TUTORIAL_PAGE_COPY = {
  it: {
    description:
      "Scegli il percorso che corrisponde all'interfaccia che usi. Ogni guida è completa da sola; il video è un'alternativa facoltativa, non un requisito.",
    pathNavLabel: "Percorsi dei tutorial",
  },
  en: {
    description:
      "Choose the path that matches the interface you use. Each guide is complete on its own; a video is an optional alternative, not a prerequisite.",
    pathNavLabel: "Tutorial paths",
  },
  es: {
    description:
      "Elige el recorrido que corresponda a la interfaz que utilizas. Cada guía es completa por sí misma; el vídeo es una alternativa opcional, no un requisito.",
    pathNavLabel: "Recorridos de los tutoriales",
  },
  fr: {
    description:
      "Choisissez le parcours correspondant à l'interface que vous utilisez. Chaque guide se suffit à lui-même ; la vidéo est une alternative facultative, pas un prérequis.",
    pathNavLabel: "Parcours des tutoriels",
  },
  de: {
    description:
      "Wähle den Weg, der zu der von dir verwendeten Oberfläche passt. Jede Anleitung ist für sich vollständig; das Video ist eine optionale Alternative, keine Voraussetzung.",
    pathNavLabel: "Tutorial-Pfade",
  },
  pt: {
    description:
      "Escolhe o percurso que corresponde à interface que usas. Cada guia é completo por si só; o vídeo é uma alternativa opcional, não um requisito.",
    pathNavLabel: "Percursos dos tutoriais",
  },
  hu: {
    description:
      "Válaszd azt az útvonalat, amelyik a használt felülethez illik. Mindegyik útmutató önmagában teljes; a videó opcionális alternatíva, nem előfeltétel.",
    pathNavLabel: "Oktatóanyag-útvonalak",
  },
} satisfies Record<Lang, TutorialPageCopy>;
