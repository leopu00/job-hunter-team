import type { Locale } from "@/i18n/config";
import type { AssistantOnboardingPath } from "./contract";
import { PROFILE_OVERVIEW_COPY } from "./AssistantOnboarding.i18n";

/**
 * Everything the Assistant onboarding says besides the last step's composer
 * (AssistantOnboarding.i18n.ts): the frame, the three paths and their twelve
 * steps. 7 languages; Italian is the source and its shape is the type. The
 * names of the app's sections are the ones its navigation shows in each
 * language (web/app/components/DashboardI18n.tsx). `{name}` is the Assistant's
 * name, `{step}` the number of the step.
 */
export interface GuideLines {
  eyebrow: string;
  title: string;
  message: string;
}

export interface AssistantGuideText {
  kicker: string;
  headline: string;
  progressAria: string;
  defaultName: string;
  identityAria: string; // {name}
  role: string;
  intro: string;
  dialogueAria: string; // {name}
  startTitle: string;
  startMessage: string;
  choicesAria: string;
  choices: Record<AssistantOnboardingPath, { title: string; hint: string }>;
  paths: Record<AssistantOnboardingPath, string>;
  stepOf: string; // {step}
  completionError: string;
  back: string;
  next: string;
  verified: string;
  opening: string;
  retry: string;
  toChat: string;
  guides: Record<AssistantOnboardingPath, readonly [GuideLines, GuideLines, GuideLines, GuideLines]>;
}

export const ASSISTANT_GUIDE_TEXT: Record<Locale, AssistantGuideText> = {
  it: {
    kicker: "Onboarding Assistente",
    headline: "Conosci l’app, poi continua in chat.",
    progressAria: "Avanzamento onboarding Assistente",
    defaultName: "Assistente",
    identityAria: "Presentazione {name}",
    role: "Guida dell’app",
    intro: "Ti accompagno tra le aree principali. Questa introduzione non legge lo stato del team e non mostra dati simulati.",
    dialogueAria: "Dialogo guidato con {name}",
    startTitle: "Da dove vuoi iniziare?",
    startMessage: "Posso mostrarti il percorso, spiegarti cosa serve oppure lasciarti esplorare. Scegli tu: potrai sempre tornare indietro.",
    choicesAria: "Scegli il percorso di onboarding",
    choices: {
      tour: { title: "Fammi fare il tour", hint: "Una panoramica guidata delle aree principali." },
      requirements: { title: "Che cosa serve per iniziare?", hint: "I prerequisiti, senza fingere controlli di stato." },
      explore: { title: "Preferisco esplorare", hint: "Quattro punti di riferimento, poi libertà completa." },
    },
    paths: { tour: "Tour guidato", requirements: "Cosa serve", explore: "Esplora" },
    stepOf: "Tappa {step} di 4",
    completionError: "Non riesco ad aprire la chat. Riprova: il percorso non è stato segnato come completato.",
    back: "Indietro",
    next: "Avanti",
    verified: "Chat verificata",
    opening: "Apro la chat…",
    retry: "Riprova e apri la chat",
    toChat: "Passa alla chat libera",
    guides: {
      tour: [
        { eyebrow: "Tappa 01 · orientamento", title: "Parti dalla Dashboard", message: "La Dashboard riunisce ciò che merita attenzione. Da lì puoi entrare nelle aree di lavoro senza perdere il filo." },
        { eyebrow: "Tappa 02 · opportunità", title: "Leggi, confronta, decidi", message: "Posizioni raccoglie le opportunità, Map le mette nello spazio e Swipe aiuta a fare una prima scelta rapida." },
        { eyebrow: "Tappa 03 · squadra", title: "Segui il lavoro del team", message: "Team e Agenti mostrano le persone e le attività. Messaggi è il punto in cui ritrovi le conversazioni disponibili." },
        { eyebrow: "Tappa 04 · Assistente", title: "Continua con parole tue", message: "La guida finisce qui. Nella chat libera puoi fare una domanda concreta all’Assistente, senza scegliere da un elenco." },
      ],
      requirements: [
        { eyebrow: "Tappa 01 · ambiente", title: "Una casa per il team", message: "Il team ha bisogno di una macchina configurata e raggiungibile. La relativa procedura di setup resta separata da questa guida." },
        { eyebrow: "Tappa 02 · provider", title: "Un modello collegato", message: "Gli agenti possono lavorare quando il provider previsto dalla tua installazione è configurato. Qui non fingiamo di verificarne lo stato." },
        { eyebrow: "Tappa 03 · profilo", title: "Indicazioni su ciò che cerchi", message: "Il Profilo aiuta la squadra a capire obiettivi e preferenze. Potrai correggere le informazioni anche in seguito." },
        { eyebrow: "Tappa 04 · conversazione", title: "Poi si parte da una domanda", message: "Quando la tua installazione è pronta, apri la chat e racconta all’Assistente da dove vuoi cominciare." },
      ],
      explore: [
        { eyebrow: "Tappa 01 · panoramica", title: "Guarda prima la Dashboard", message: "Puoi esplorare senza completare un tour. La Dashboard è un buon punto di partenza e ogni area resta raggiungibile dalla navigazione." },
        { eyebrow: "Tappa 02 · scoperta", title: "Apri Map, Posizioni e Swipe", message: "Queste viste raccontano le opportunità da angolazioni diverse. Esplorarle non conferma né modifica dati da questa guida." },
        { eyebrow: "Tappa 03 · persone", title: "Conosci Team e Agenti", message: "Qui trovi le superfici dedicate alla squadra. Puoi tornare all’Assistente in qualunque momento." },
        { eyebrow: "Tappa 04 · strumenti personali", title: "Completa il giro a modo tuo", message: PROFILE_OVERVIEW_COPY.it },
      ],
    },
  },
  en: {
    kicker: "Assistant onboarding",
    headline: "Get to know the app, then continue in the chat.",
    progressAria: "Assistant onboarding progress",
    defaultName: "Assistant",
    identityAria: "Introducing {name}",
    role: "The app's guide",
    intro: "I walk you through the main areas. This introduction does not read the team's state and shows no simulated data.",
    dialogueAria: "Guided dialogue with {name}",
    startTitle: "Where do you want to start?",
    startMessage: "I can show you the route, explain what you need, or let you explore. You choose: you can always go back.",
    choicesAria: "Choose the onboarding path",
    choices: {
      tour: { title: "Take me on the tour", hint: "A guided overview of the main areas." },
      requirements: { title: "What do I need to start?", hint: "The prerequisites, without pretending to check any state." },
      explore: { title: "I'd rather explore", hint: "Four landmarks, then complete freedom." },
    },
    paths: { tour: "Guided tour", requirements: "What you need", explore: "Explore" },
    stepOf: "Step {step} of 4",
    completionError: "I can't open the chat. Try again: the path was not marked as completed.",
    back: "Back",
    next: "Next",
    verified: "Chat verified",
    opening: "Opening the chat…",
    retry: "Retry and open the chat",
    toChat: "Go to the free chat",
    guides: {
      tour: [
        { eyebrow: "Step 01 · orientation", title: "Start from the Dashboard", message: "The Dashboard gathers what deserves attention. From there you can enter the work areas without losing the thread." },
        { eyebrow: "Step 02 · opportunities", title: "Read, compare, decide", message: "Positions collects the opportunities, Map puts them in space and Swipe helps you make a quick first choice." },
        { eyebrow: "Step 03 · team", title: "Follow the team's work", message: "Team and Agents show the people and the activity. Messages is where you find the available conversations again." },
        { eyebrow: "Step 04 · Assistant", title: "Go on in your own words", message: "The guide ends here. In the free chat you can ask the Assistant a concrete question, without picking from a list." },
      ],
      requirements: [
        { eyebrow: "Step 01 · environment", title: "A home for the team", message: "The team needs a configured, reachable machine. Its setup procedure stays separate from this guide." },
        { eyebrow: "Step 02 · provider", title: "A connected model", message: "The agents can work once the provider your installation expects is configured. Here we do not pretend to check its state." },
        { eyebrow: "Step 03 · profile", title: "Hints about what you look for", message: "The Profile helps the team understand your goals and preferences. You can correct the information later too." },
        { eyebrow: "Step 04 · conversation", title: "Then it starts with a question", message: "When your installation is ready, open the chat and tell the Assistant where you want to begin." },
      ],
      explore: [
        { eyebrow: "Step 01 · overview", title: "Look at the Dashboard first", message: "You can explore without finishing a tour. The Dashboard is a good starting point and every area stays reachable from the navigation." },
        { eyebrow: "Step 02 · discovery", title: "Open Map, Positions and Swipe", message: "These views show the opportunities from different angles. Exploring them does not confirm or change data from this guide." },
        { eyebrow: "Step 03 · people", title: "Meet Team and Agents", message: "Here you find the surfaces dedicated to the team. You can go back to the Assistant at any time." },
        { eyebrow: "Step 04 · personal tools", title: "Complete the round your way", message: PROFILE_OVERVIEW_COPY.en },
      ],
    },
  },
  de: {
    kicker: "Onboarding mit dem Assistenten",
    headline: "Lerne die App kennen, dann mach im Chat weiter.",
    progressAria: "Fortschritt des Assistenten-Onboardings",
    defaultName: "Assistent",
    identityAria: "Vorstellung von {name}",
    role: "Führer durch die App",
    intro: "Ich begleite dich durch die wichtigsten Bereiche. Diese Einführung liest den Zustand des Teams nicht und zeigt keine simulierten Daten.",
    dialogueAria: "Geführter Dialog mit {name}",
    startTitle: "Womit möchtest du anfangen?",
    startMessage: "Ich kann dir den Weg zeigen, erklären, was du brauchst, oder dich selbst erkunden lassen. Du entscheidest: Du kannst immer zurückgehen.",
    choicesAria: "Wähle den Onboarding-Pfad",
    choices: {
      tour: { title: "Zeig mir die Tour", hint: "Ein geführter Überblick über die wichtigsten Bereiche." },
      requirements: { title: "Was brauche ich zum Start?", hint: "Die Voraussetzungen, ohne Zustandsprüfungen vorzutäuschen." },
      explore: { title: "Ich erkunde lieber selbst", hint: "Vier Orientierungspunkte, dann volle Freiheit." },
    },
    paths: { tour: "Geführte Tour", requirements: "Was du brauchst", explore: "Erkunden" },
    stepOf: "Schritt {step} von 4",
    completionError: "Der Chat lässt sich nicht öffnen. Versuche es erneut: Der Pfad wurde nicht als abgeschlossen markiert.",
    back: "Zurück",
    next: "Weiter",
    verified: "Chat bestätigt",
    opening: "Chat wird geöffnet…",
    retry: "Erneut versuchen und Chat öffnen",
    toChat: "Zum freien Chat",
    guides: {
      tour: [
        { eyebrow: "Schritt 01 · Orientierung", title: "Starte beim Dashboard", message: "Das Dashboard bündelt, was Aufmerksamkeit verdient. Von dort kommst du in die Arbeitsbereiche, ohne den Faden zu verlieren." },
        { eyebrow: "Schritt 02 · Chancen", title: "Lesen, vergleichen, entscheiden", message: "Stellen sammelt die Chancen, Karte legt sie in den Raum und Swipe hilft bei einer schnellen ersten Auswahl." },
        { eyebrow: "Schritt 03 · Team", title: "Verfolge die Arbeit des Teams", message: "Team und Agenten zeigen die Personen und die Aktivitäten. Nachrichten ist der Ort, an dem du die verfügbaren Unterhaltungen wiederfindest." },
        { eyebrow: "Schritt 04 · Assistent", title: "Mach mit eigenen Worten weiter", message: "Hier endet die Anleitung. Im freien Chat kannst du dem Assistenten eine konkrete Frage stellen, ohne aus einer Liste zu wählen." },
      ],
      requirements: [
        { eyebrow: "Schritt 01 · Umgebung", title: "Ein Zuhause für das Team", message: "Das Team braucht einen eingerichteten, erreichbaren Rechner. Die zugehörige Einrichtung bleibt von dieser Anleitung getrennt." },
        { eyebrow: "Schritt 02 · Provider", title: "Ein angebundenes Modell", message: "Die Agenten können arbeiten, wenn der Provider, den deine Installation vorsieht, eingerichtet ist. Wir tun hier nicht so, als würden wir seinen Zustand prüfen." },
        { eyebrow: "Schritt 03 · Profil", title: "Hinweise zu dem, was du suchst", message: "Das Profil hilft dem Team, Ziele und Vorlieben zu verstehen. Du kannst die Angaben auch später noch korrigieren." },
        { eyebrow: "Schritt 04 · Unterhaltung", title: "Dann geht es mit einer Frage los", message: "Wenn deine Installation bereit ist, öffne den Chat und erzähle dem Assistenten, womit du anfangen möchtest." },
      ],
      explore: [
        { eyebrow: "Schritt 01 · Überblick", title: "Wirf zuerst einen Blick aufs Dashboard", message: "Du kannst erkunden, ohne eine Tour abzuschließen. Das Dashboard ist ein guter Startpunkt, und jeder Bereich bleibt über die Navigation erreichbar." },
        { eyebrow: "Schritt 02 · Entdecken", title: "Öffne Karte, Stellen und Swipe", message: "Diese Ansichten zeigen die Chancen aus verschiedenen Blickwinkeln. Sie zu erkunden bestätigt oder ändert von dieser Anleitung aus keine Daten." },
        { eyebrow: "Schritt 03 · Menschen", title: "Lerne Team und Agenten kennen", message: "Hier findest du die Bereiche, die dem Team gewidmet sind. Du kannst jederzeit zum Assistenten zurückkehren." },
        { eyebrow: "Schritt 04 · persönliche Werkzeuge", title: "Schließe die Runde auf deine Art ab", message: PROFILE_OVERVIEW_COPY.de },
      ],
    },
  },
  fr: {
    kicker: "Onboarding de l’Assistant",
    headline: "Découvre l’app, puis continue dans le chat.",
    progressAria: "Progression de l’onboarding de l’Assistant",
    defaultName: "Assistant",
    identityAria: "Présentation de {name}",
    role: "Guide de l’app",
    intro: "Je t’accompagne parmi les zones principales. Cette introduction ne lit pas l’état de l’équipe et n’affiche aucune donnée simulée.",
    dialogueAria: "Dialogue guidé avec {name}",
    startTitle: "Par où veux-tu commencer ?",
    startMessage: "Je peux te montrer le parcours, t’expliquer ce qu’il faut, ou te laisser explorer. À toi de choisir : tu pourras toujours revenir en arrière.",
    choicesAria: "Choisis le parcours d’onboarding",
    choices: {
      tour: { title: "Fais-moi faire la visite", hint: "Un aperçu guidé des zones principales." },
      requirements: { title: "Que faut-il pour commencer ?", hint: "Les prérequis, sans faire semblant de vérifier un état." },
      explore: { title: "Je préfère explorer", hint: "Quatre repères, puis une liberté complète." },
    },
    paths: { tour: "Visite guidée", requirements: "Ce qu’il faut", explore: "Explorer" },
    stepOf: "Étape {step} sur 4",
    completionError: "Impossible d’ouvrir le chat. Réessaie : le parcours n’a pas été marqué comme terminé.",
    back: "Retour",
    next: "Suivant",
    verified: "Chat vérifié",
    opening: "Ouverture du chat…",
    retry: "Réessayer et ouvrir le chat",
    toChat: "Passer au chat libre",
    guides: {
      tour: [
        { eyebrow: "Étape 01 · orientation", title: "Commence par le Tableau de bord", message: "Le Tableau de bord réunit ce qui mérite attention. De là, tu peux entrer dans les zones de travail sans perdre le fil." },
        { eyebrow: "Étape 02 · opportunités", title: "Lis, compare, décide", message: "Postes rassemble les opportunités, Carte les place dans l’espace et Swipe aide à faire un premier choix rapide." },
        { eyebrow: "Étape 03 · équipe", title: "Suis le travail de l’équipe", message: "Équipe et Agents montrent les personnes et les activités. Messages est l’endroit où tu retrouves les conversations disponibles." },
        { eyebrow: "Étape 04 · Assistant", title: "Continue avec tes mots", message: "Le guide s’arrête ici. Dans le chat libre, tu peux poser une question concrète à l’Assistant, sans choisir dans une liste." },
      ],
      requirements: [
        { eyebrow: "Étape 01 · environnement", title: "Un foyer pour l’équipe", message: "L’équipe a besoin d’une machine configurée et joignable. Sa procédure d’installation reste séparée de ce guide." },
        { eyebrow: "Étape 02 · fournisseur", title: "Un modèle connecté", message: "Les agents peuvent travailler quand le fournisseur prévu par ton installation est configuré. Ici, nous ne faisons pas semblant d’en vérifier l’état." },
        { eyebrow: "Étape 03 · profil", title: "Des indications sur ce que tu cherches", message: "Le Profil aide l’équipe à comprendre tes objectifs et tes préférences. Tu pourras corriger ces informations plus tard aussi." },
        { eyebrow: "Étape 04 · conversation", title: "Ensuite, on part d’une question", message: "Quand ton installation est prête, ouvre le chat et dis à l’Assistant par où tu veux commencer." },
      ],
      explore: [
        { eyebrow: "Étape 01 · vue d’ensemble", title: "Regarde d’abord le Tableau de bord", message: "Tu peux explorer sans terminer une visite. Le Tableau de bord est un bon point de départ et chaque zone reste accessible depuis la navigation." },
        { eyebrow: "Étape 02 · découverte", title: "Ouvre Carte, Postes et Swipe", message: "Ces vues racontent les opportunités sous des angles différents. Les explorer ne confirme ni ne modifie aucune donnée depuis ce guide." },
        { eyebrow: "Étape 03 · personnes", title: "Découvre Équipe et Agents", message: "Tu trouves ici les espaces dédiés à l’équipe. Tu peux revenir à l’Assistant à tout moment." },
        { eyebrow: "Étape 04 · outils personnels", title: "Termine le tour à ta façon", message: PROFILE_OVERVIEW_COPY.fr },
      ],
    },
  },
  es: {
    kicker: "Onboarding del Asistente",
    headline: "Conoce la app y sigue en el chat.",
    progressAria: "Progreso del onboarding del Asistente",
    defaultName: "Asistente",
    identityAria: "Presentación de {name}",
    role: "Guía de la app",
    intro: "Te acompaño por las áreas principales. Esta introducción no lee el estado del equipo y no muestra datos simulados.",
    dialogueAria: "Diálogo guiado con {name}",
    startTitle: "¿Por dónde quieres empezar?",
    startMessage: "Puedo mostrarte el recorrido, explicarte qué hace falta o dejarte explorar. Tú eliges: siempre podrás volver atrás.",
    choicesAria: "Elige el camino del onboarding",
    choices: {
      tour: { title: "Hazme el recorrido", hint: "Una visión guiada de las áreas principales." },
      requirements: { title: "¿Qué hace falta para empezar?", hint: "Los requisitos, sin fingir comprobaciones de estado." },
      explore: { title: "Prefiero explorar", hint: "Cuatro puntos de referencia y luego libertad completa." },
    },
    paths: { tour: "Recorrido guiado", requirements: "Qué hace falta", explore: "Explorar" },
    stepOf: "Paso {step} de 4",
    completionError: "No puedo abrir el chat. Inténtalo de nuevo: el camino no se ha marcado como completado.",
    back: "Atrás",
    next: "Siguiente",
    verified: "Chat verificado",
    opening: "Abriendo el chat…",
    retry: "Reintentar y abrir el chat",
    toChat: "Pasar al chat libre",
    guides: {
      tour: [
        { eyebrow: "Paso 01 · orientación", title: "Empieza por el Panel", message: "El Panel reúne lo que merece atención. Desde ahí puedes entrar en las áreas de trabajo sin perder el hilo." },
        { eyebrow: "Paso 02 · oportunidades", title: "Lee, compara, decide", message: "Posiciones reúne las oportunidades, Mapa las sitúa en el espacio y Swipe ayuda a hacer una primera elección rápida." },
        { eyebrow: "Paso 03 · equipo", title: "Sigue el trabajo del equipo", message: "Equipo y Agentes muestran a las personas y la actividad. Mensajes es donde vuelves a encontrar las conversaciones disponibles." },
        { eyebrow: "Paso 04 · Asistente", title: "Sigue con tus palabras", message: "La guía termina aquí. En el chat libre puedes hacerle una pregunta concreta al Asistente, sin elegir de una lista." },
      ],
      requirements: [
        { eyebrow: "Paso 01 · entorno", title: "Un hogar para el equipo", message: "El equipo necesita una máquina configurada y accesible. Su procedimiento de instalación queda aparte de esta guía." },
        { eyebrow: "Paso 02 · proveedor", title: "Un modelo conectado", message: "Los agentes pueden trabajar cuando el proveedor previsto por tu instalación está configurado. Aquí no fingimos comprobar su estado." },
        { eyebrow: "Paso 03 · perfil", title: "Indicaciones sobre lo que buscas", message: "Perfil ayuda al equipo a entender tus objetivos y preferencias. Podrás corregir la información más adelante." },
        { eyebrow: "Paso 04 · conversación", title: "Luego se empieza con una pregunta", message: "Cuando tu instalación esté lista, abre el chat y cuéntale al Asistente por dónde quieres empezar." },
      ],
      explore: [
        { eyebrow: "Paso 01 · panorámica", title: "Mira primero el Panel", message: "Puedes explorar sin completar un recorrido. El Panel es un buen punto de partida y cada área sigue al alcance desde la navegación." },
        { eyebrow: "Paso 02 · descubrimiento", title: "Abre Mapa, Posiciones y Swipe", message: "Estas vistas muestran las oportunidades desde ángulos distintos. Explorarlas no confirma ni modifica datos desde esta guía." },
        { eyebrow: "Paso 03 · personas", title: "Conoce Equipo y Agentes", message: "Aquí encuentras las superficies dedicadas al equipo. Puedes volver al Asistente en cualquier momento." },
        { eyebrow: "Paso 04 · herramientas personales", title: "Completa la vuelta a tu manera", message: PROFILE_OVERVIEW_COPY.es },
      ],
    },
  },
  pt: {
    kicker: "Onboarding do Assistente",
    headline: "Conhece a app e continua no chat.",
    progressAria: "Progresso do onboarding do Assistente",
    defaultName: "Assistente",
    identityAria: "Apresentação de {name}",
    role: "Guia da app",
    intro: "Acompanho-te pelas áreas principais. Esta introdução não lê o estado da equipa e não mostra dados simulados.",
    dialogueAria: "Diálogo guiado com {name}",
    startTitle: "Por onde queres começar?",
    startMessage: "Posso mostrar-te o percurso, explicar-te o que é preciso ou deixar-te explorar. Escolhes tu: podes sempre voltar atrás.",
    choicesAria: "Escolhe o percurso do onboarding",
    choices: {
      tour: { title: "Leva-me a fazer o tour", hint: "Uma visão geral guiada das áreas principais." },
      requirements: { title: "O que é preciso para começar?", hint: "Os pré-requisitos, sem fingir verificações de estado." },
      explore: { title: "Prefiro explorar", hint: "Quatro pontos de referência e depois liberdade total." },
    },
    paths: { tour: "Tour guiado", requirements: "O que é preciso", explore: "Explorar" },
    stepOf: "Passo {step} de 4",
    completionError: "Não consigo abrir o chat. Tenta de novo: o percurso não foi marcado como concluído.",
    back: "Voltar",
    next: "Seguinte",
    verified: "Chat verificado",
    opening: "A abrir o chat…",
    retry: "Tentar de novo e abrir o chat",
    toChat: "Passar ao chat livre",
    guides: {
      tour: [
        { eyebrow: "Passo 01 · orientação", title: "Começa pelo Painel", message: "O Painel reúne o que merece atenção. A partir dele podes entrar nas áreas de trabalho sem perder o fio." },
        { eyebrow: "Passo 02 · oportunidades", title: "Lê, compara, decide", message: "Vagas reúne as oportunidades, Mapa coloca-as no espaço e Swipe ajuda a fazer uma primeira escolha rápida." },
        { eyebrow: "Passo 03 · equipa", title: "Acompanha o trabalho da equipa", message: "Equipa e Agentes mostram as pessoas e as atividades. Mensagens é o sítio onde voltas a encontrar as conversas disponíveis." },
        { eyebrow: "Passo 04 · Assistente", title: "Continua com as tuas palavras", message: "O guia termina aqui. No chat livre podes fazer uma pergunta concreta ao Assistente, sem escolher de uma lista." },
      ],
      requirements: [
        { eyebrow: "Passo 01 · ambiente", title: "Uma casa para a equipa", message: "A equipa precisa de uma máquina configurada e acessível. O respetivo procedimento de instalação fica separado deste guia." },
        { eyebrow: "Passo 02 · fornecedor", title: "Um modelo ligado", message: "Os agentes podem trabalhar quando o fornecedor previsto pela tua instalação está configurado. Aqui não fingimos verificar o seu estado." },
        { eyebrow: "Passo 03 · perfil", title: "Indicações sobre o que procuras", message: "O Perfil ajuda a equipa a perceber os teus objetivos e preferências. Poderás corrigir a informação mais tarde." },
        { eyebrow: "Passo 04 · conversa", title: "Depois começa-se por uma pergunta", message: "Quando a tua instalação estiver pronta, abre o chat e conta ao Assistente por onde queres começar." },
      ],
      explore: [
        { eyebrow: "Passo 01 · panorama", title: "Vê primeiro o Painel", message: "Podes explorar sem concluir um tour. O Painel é um bom ponto de partida e cada área continua acessível pela navegação." },
        { eyebrow: "Passo 02 · descoberta", title: "Abre Mapa, Vagas e Swipe", message: "Estas vistas mostram as oportunidades de ângulos diferentes. Explorá-las não confirma nem altera dados a partir deste guia." },
        { eyebrow: "Passo 03 · pessoas", title: "Conhece Equipa e Agentes", message: "Aqui encontras as superfícies dedicadas à equipa. Podes voltar ao Assistente a qualquer momento." },
        { eyebrow: "Passo 04 · ferramentas pessoais", title: "Completa a volta à tua maneira", message: PROFILE_OVERVIEW_COPY.pt },
      ],
    },
  },
  hu: {
    kicker: "Az Asszisztens bevezetője",
    headline: "Ismerd meg az appot, aztán folytasd a csevegésben.",
    progressAria: "Az Asszisztens bevezetőjének előrehaladása",
    defaultName: "Asszisztens",
    identityAria: "{name} bemutatkozása",
    role: "Az app vezetője",
    intro: "Végigkísérlek a fő területeken. Ez a bevezető nem olvassa a csapat állapotát, és nem mutat szimulált adatokat.",
    dialogueAria: "Vezetett párbeszéd: {name}",
    startTitle: "Hol szeretnéd kezdeni?",
    startMessage: "Megmutathatom az utat, elmondhatom, mi kell hozzá, vagy hagyhatlak felfedezni. Te döntesz: mindig visszaléphetsz.",
    choicesAria: "Válaszd ki a bevezető útvonalát",
    choices: {
      tour: { title: "Vezess végig a körúton", hint: "Vezetett áttekintés a fő területekről." },
      requirements: { title: "Mi kell az induláshoz?", hint: "Az előfeltételek, állapotellenőrzés színlelése nélkül." },
      explore: { title: "Inkább felfedezem", hint: "Négy tájékozódási pont, aztán teljes szabadság." },
    },
    paths: { tour: "Vezetett körút", requirements: "Mi kell hozzá", explore: "Felfedezés" },
    stepOf: "{step}. lépés a 4-ből",
    completionError: "Nem tudom megnyitni a csevegést. Próbáld újra: az útvonalat nem jelöltem befejezettnek.",
    back: "Vissza",
    next: "Tovább",
    verified: "Csevegés ellenőrizve",
    opening: "Csevegés megnyitása…",
    retry: "Újra, és nyisd meg a csevegést",
    toChat: "Tovább a szabad csevegéshez",
    guides: {
      tour: [
        { eyebrow: "01. lépés · tájékozódás", title: "Kezdd az Irányítópulttal", message: "Az Irányítópult összegyűjti, amire érdemes figyelni. Onnan úgy léphetsz be a munkaterületekre, hogy nem veszíted el a fonalat." },
        { eyebrow: "02. lépés · lehetőségek", title: "Olvass, hasonlíts, dönts", message: "Az Állások gyűjti a lehetőségeket, a Map térben helyezi el őket, a Swipe pedig segít gyorsan meghozni az első döntést." },
        { eyebrow: "03. lépés · csapat", title: "Kövesd a csapat munkáját", message: "A Csapat és az Ügynökök megmutatják az embereket és a tevékenységeket. Az Üzenetek az a hely, ahol újra megtalálod az elérhető beszélgetéseket." },
        { eyebrow: "04. lépés · Asszisztens", title: "Folytasd a saját szavaiddal", message: "Az útmutató itt véget ér. A szabad csevegésben konkrét kérdést tehetsz fel az Asszisztensnek, anélkül hogy listából kellene választanod." },
      ],
      requirements: [
        { eyebrow: "01. lépés · környezet", title: "Otthon a csapatnak", message: "A csapatnak beállított és elérhető gépre van szüksége. A hozzá tartozó telepítési folyamat külön marad ettől az útmutatótól." },
        { eyebrow: "02. lépés · szolgáltató", title: "Egy összekapcsolt modell", message: "Az ügynökök akkor tudnak dolgozni, ha a telepítésed által előírt szolgáltató be van állítva. Itt nem tettetjük, hogy ellenőrizzük az állapotát." },
        { eyebrow: "03. lépés · profil", title: "Útmutatás ahhoz, amit keresel", message: "A Profil segít a csapatnak megérteni a céljaidat és az igényeidet. Az adatokat később is javíthatod." },
        { eyebrow: "04. lépés · beszélgetés", title: "Aztán egy kérdéssel indul a munka", message: "Amikor a telepítésed kész, nyisd meg a csevegést, és mondd el az Asszisztensnek, hol szeretnéd kezdeni." },
      ],
      explore: [
        { eyebrow: "01. lépés · áttekintés", title: "Előbb nézd meg az Irányítópultot", message: "Körút befejezése nélkül is felfedezhetsz. Az Irányítópult jó kiindulópont, és minden terület elérhető marad a navigációból." },
        { eyebrow: "02. lépés · felfedezés", title: "Nyisd meg a Map, az Állások és a Swipe nézetet", message: "Ezek a nézetek más-más szögből mutatják a lehetőségeket. Felfedezésükkel ebből az útmutatóból nem erősítesz meg és nem módosítasz adatot." },
        { eyebrow: "03. lépés · emberek", title: "Ismerd meg a Csapatot és az Ügynököket", message: "Itt találod a csapatnak szentelt felületeket. Bármikor visszatérhetsz az Asszisztenshez." },
        { eyebrow: "04. lépés · személyes eszközök", title: "Fejezd be a kört a saját módodon", message: PROFILE_OVERVIEW_COPY.hu },
      ],
    },
  },
};
