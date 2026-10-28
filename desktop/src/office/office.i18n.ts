import { locales, type Locale } from "@/i18n/config";
import { appLocale } from "../lib/app-locale";
import { pluralText, type PluralForms } from "../lib/plural";
import { DEPT_ORDER, type DeptId, type OfficeLayout } from "./contract";

/**
 * The words around the office scene: the panel a click opens, the tag under
 * the pointer, the keyboard list and the page's status line. 7 languages;
 * Italian is the source and its shape is the type. What is NOT here is the
 * game's own English: the departments' names and the taglines painted on
 * the floor (office/contract.ts); the panel and the tooltip say what a
 * department does in the person's language (departmentTaglines). The
 * agents' state tags say the agent_state catalog's word in the person's
 * language (office/status.ts, tagOf); only an old box's words without a
 * state (WORKING, WAITING, PAUSED) stay English.
 * `{count}`, `{error}`, `{name}`, `{notes}` are filled by `fill`.
 */
export interface OfficeText {
  // the panel
  detailsAria: string;
  close: string;
  cloudReadFailed: string; // {error}
  loading: string;
  departmentOf: string; // {name}
  // the department's name, by its id: painted on the floor sign and said by the panel's heading
  departmentNames: Record<DeptId, string>;
  // what each department does, by its id: the floor's sign stays in the game's English, the panel and the tooltip say it in the person's language
  departmentTaglines: Record<DeptId, string>;
  sectionNow: string;
  statusNotPublished: string;
  sectionInHand: string;
  noneInHand: string;
  sectionMoves: string;
  noMoves: string;
  positionGone: string;
  untitled: string;
  openAgentPage: string;
  phaseSub: string;
  phaseSubCount: PluralForms; // {count}
  noPhase: string;
  mostRecent: PluralForms; // {count}
  allPositions: string;
  incoming: string;
  onThePile: PluralForms; // {count}
  positionsOnThePile: string;
  departmentAgents: string;
  noDepartmentAgents: string;
  foundLast7: string;
  cvTitle: string;
  cvSub: string;
  kpiWritten: string;
  kpiPass: string;
  kpiNoVerdict: string;
  kpiAverage: string;
  averageNote: PluralForms; // {count}
  noCv: string;
  boardTitle: string;
  boardSub: string;
  noBoard: string;
  mapTitle: string;
  mapSub: string;
  noPlaces: string;
  located: PluralForms; // {count}
  openMap: string;
  detailPlace: string;
  detailFound: string;
  detailWritten: string;
  detailCritic: string;
  criticNotes: string; // {notes}
  openPosition: string;
  // the tag under the pointer
  tipNotPublished: string;
  tipPile: PluralForms; // {count}
  tipPileNoCount: string;
  tipIncoming: string; // {count}
  tipCvReady: PluralForms; // {count}
  tipCvWritten: string;
  tipBoard: string;
  tipMap: string;
  // the keyboard list
  keyboardAria: string;
  // the page's status line
  readFailed: string;
  notWired: string;
  noWebGl: string;
  teamOffEmpty: string;
  teamOffRecent: string;
  // the line above the scene: the agents that have no seat in the office
  notInOffice: string; // {names}
}

export const OFFICE_TEXT: Record<Locale, OfficeText> = {
  it: {
    detailsAria: "Dettagli dell'ufficio",
    close: "Chiudi",
    cloudReadFailed: "Non riesco a leggere il cloud: {error}",
    loading: "Caricamento…",
    departmentOf: "Reparto {name}",
    departmentNames: {
      scout: "Ricerca",
      analisti: "Analisi",
      scorer: "Compatibilità",
      scrittori: "Candidature",
      critici: "Controllo qualità",
    },
    departmentTaglines: {
      scout: "Trova le opportunità giuste per te.",
      analisti: "Trasforma gli annunci in decisioni chiare.",
      scorer: "Misura quanto ogni ruolo è adatto a te.",
      scrittori: "Adatta ogni candidatura a te e al ruolo.",
      critici: "Controlla ogni dettaglio prima che tu decida.",
    },
    sectionNow: "Ora",
    statusNotPublished: "Stato non pubblicato dal team.",
    sectionInHand: "In mano",
    noneInHand: "Nessuna posizione ferma dove l'ha lasciata.",
    sectionMoves: "Ultime mosse",
    noMoves: "Nessuna mossa registrata nel cloud.",
    positionGone: "posizione non più nel cloud",
    untitled: "(senza titolo)",
    openAgentPage: "Apri la pagina dell'agente",
    phaseSub: "Posizioni in questa fase",
    phaseSubCount: { one: "{count} posizione in questa fase", other: "{count} posizioni in questa fase" },
    noPhase: "Nessuna posizione in questa fase.",
    mostRecent: { one: "La più recente.", other: "Le {count} più recenti." },
    allPositions: "Tutte le posizioni",
    incoming: "In ingresso",
    onThePile: { one: "{count} posizione sulla pila", other: "{count} posizioni sulla pila" },
    positionsOnThePile: "Le posizioni sulla pila",
    departmentAgents: "Agenti del reparto",
    noDepartmentAgents: "Nessun agente del reparto nelle ultime 24 ore.",
    foundLast7: "Trovate negli ultimi 7 giorni",
    cvTitle: "CV prodotti",
    cvSub: "Scaffale d'uscita: le candidature scritte dal team",
    kpiWritten: "scritti",
    kpiPass: "pass",
    kpiNoVerdict: "senza verdetto",
    kpiAverage: "punteggio medio",
    averageNote: { one: "Punteggio medio di un solo CV con un punteggio.", other: "Punteggio medio dei {count} più recenti con un punteggio." },
    noCv: "Nessun CV scritto.",
    boardTitle: "Bacheca",
    boardSub: "Posizioni pronte, inviate e con risposta",
    noBoard: "Nessuna posizione pronta, inviata o con risposta.",
    mapTitle: "Mappa",
    mapSub: "Dove sono le posizioni",
    noPlaces: "Nessuna posizione con un luogo.",
    located: { one: "{count} posizione con un luogo:", other: "{count} posizioni con un luogo; i più frequenti:" },
    openMap: "Apri la mappa",
    detailPlace: "Luogo",
    detailFound: "Trovata",
    detailWritten: "Scritta",
    detailCritic: "Critico",
    criticNotes: "Note del critico: {notes}",
    openPosition: "Apri la posizione",
    tipNotPublished: "stato non pubblicato",
    tipPile: { one: "{count} posizione sulla pila", other: "{count} posizioni sulla pila" },
    tipPileNoCount: "posizioni sulla pila",
    tipIncoming: "in ingresso: {count}",
    tipCvReady: { one: "{count} pronto col PASS del critico", other: "{count} pronti col PASS del critico" },
    tipCvWritten: "le candidature scritte",
    tipBoard: "posizioni pronte, inviate, con risposta",
    tipMap: "dove sono le posizioni",
    keyboardAria: "Agenti e oggetti dell'ufficio",
    readFailed: "Non riesco a leggere il cloud: l'ufficio resta com'era.",
    notWired: "I dati dell'ufficio non sono ancora collegati: nessun agente in scena.",
    noWebGl: "La scena non parte: questa finestra non ha WebGL.",
    teamOffEmpty: "Il team è spento: l'ufficio è vuoto.",
    teamOffRecent: "Il team è spento: restano gli agenti che hanno lavorato nelle ultime 24 ore.",
    notInOffice: "Non nell'ufficio: {names}.",
  },
  en: {
    detailsAria: "Office details",
    close: "Close",
    cloudReadFailed: "I can't read the cloud: {error}",
    loading: "Loading…",
    departmentOf: "{name} department",
    departmentNames: {
      scout: "Research",
      analisti: "Analysis",
      scorer: "Compatibility",
      scrittori: "Applications",
      critici: "Quality check",
    },
    departmentTaglines: {
      scout: "Finds relevant opportunities for you.",
      analisti: "Turns listings into clear decisions.",
      scorer: "Gauges how well each role fits you.",
      scrittori: "Tailors each application to you and the role.",
      critici: "Reviews every detail before you decide.",
    },
    sectionNow: "Now",
    statusNotPublished: "Status not published by the team.",
    sectionInHand: "In hand",
    noneInHand: "No position left where it stopped.",
    sectionMoves: "Latest moves",
    noMoves: "No move recorded in the cloud.",
    positionGone: "position no longer in the cloud",
    untitled: "(untitled)",
    openAgentPage: "Open the agent's page",
    phaseSub: "Positions in this phase",
    phaseSubCount: { one: "{count} position in this phase", other: "{count} positions in this phase" },
    noPhase: "No position in this phase.",
    mostRecent: { one: "The most recent.", other: "The {count} most recent." },
    allPositions: "All positions",
    incoming: "Incoming",
    onThePile: { one: "{count} position on the pile", other: "{count} positions on the pile" },
    positionsOnThePile: "The positions on the pile",
    departmentAgents: "Department agents",
    noDepartmentAgents: "No agent of the department in the last 24 hours.",
    foundLast7: "Found in the last 7 days",
    cvTitle: "CVs produced",
    cvSub: "Output shelf: the applications the team wrote",
    kpiWritten: "written",
    kpiPass: "pass",
    kpiNoVerdict: "no verdict",
    kpiAverage: "average score",
    averageNote: { one: "Average score of a single CV with a score.", other: "Average score of the {count} most recent with a score." },
    noCv: "No CV written.",
    boardTitle: "Board",
    boardSub: "Positions ready, sent and answered",
    noBoard: "No position ready, sent or answered.",
    mapTitle: "Map",
    mapSub: "Where the positions are",
    noPlaces: "No position with a place.",
    located: { one: "{count} position with a place:", other: "{count} positions with a place; the most frequent:" },
    openMap: "Open the map",
    detailPlace: "Place",
    detailFound: "Found",
    detailWritten: "Written",
    detailCritic: "Critic",
    criticNotes: "Critic's notes: {notes}",
    openPosition: "Open the position",
    tipNotPublished: "status not published",
    tipPile: { one: "{count} position on the pile", other: "{count} positions on the pile" },
    tipPileNoCount: "positions on the pile",
    tipIncoming: "incoming: {count}",
    tipCvReady: { one: "{count} ready with the critic's PASS", other: "{count} ready with the critic's PASS" },
    tipCvWritten: "the applications written",
    tipBoard: "positions ready, sent, answered",
    tipMap: "where the positions are",
    keyboardAria: "Agents and objects of the office",
    readFailed: "I can't read the cloud: the office stays as it was.",
    notWired: "The office data is not connected yet: no agent on stage.",
    noWebGl: "The scene does not start: this window has no WebGL.",
    teamOffEmpty: "The team is off: the office is empty.",
    teamOffRecent: "The team is off: the agents who worked in the last 24 hours stay.",
    notInOffice: "Not in the office: {names}.",
  },
  de: {
    detailsAria: "Details des Büros",
    close: "Schließen",
    cloudReadFailed: "Die Cloud lässt sich nicht lesen: {error}",
    loading: "Wird geladen…",
    departmentOf: "Abteilung {name}",
    departmentNames: {
      scout: "Recherche",
      analisti: "Analyse",
      scorer: "Passung",
      scrittori: "Bewerbungen",
      critici: "Qualitätskontrolle",
    },
    departmentTaglines: {
      scout: "Findet passende Chancen für dich.",
      analisti: "Macht aus Stellenanzeigen klare Entscheidungen.",
      scorer: "Misst, wie gut jede Stelle zu dir passt.",
      scrittori: "Passt jede Bewerbung an dich und die Stelle an.",
      critici: "Prüft jedes Detail, bevor du entscheidest.",
    },
    sectionNow: "Jetzt",
    statusNotPublished: "Status vom Team nicht veröffentlicht.",
    sectionInHand: "In Arbeit",
    noneInHand: "Keine Stelle liegt dort, wo er sie gelassen hat.",
    sectionMoves: "Letzte Züge",
    noMoves: "Kein Zug in der Cloud aufgezeichnet.",
    positionGone: "Stelle nicht mehr in der Cloud",
    untitled: "(ohne Titel)",
    openAgentPage: "Seite des Agenten öffnen",
    phaseSub: "Stellen in dieser Phase",
    phaseSubCount: { one: "{count} Stelle in dieser Phase", other: "{count} Stellen in dieser Phase" },
    noPhase: "Keine Stelle in dieser Phase.",
    mostRecent: { one: "Die neueste.", other: "Die {count} neuesten." },
    allPositions: "Alle Stellen",
    incoming: "Eingang",
    onThePile: { one: "{count} Stelle auf dem Stapel", other: "{count} Stellen auf dem Stapel" },
    positionsOnThePile: "Die Stellen auf dem Stapel",
    departmentAgents: "Agenten der Abteilung",
    noDepartmentAgents: "Kein Agent der Abteilung in den letzten 24 Stunden.",
    foundLast7: "Gefunden in den letzten 7 Tagen",
    cvTitle: "Erstellte Lebensläufe",
    cvSub: "Ausgangsregal: die vom Team geschriebenen Bewerbungen",
    kpiWritten: "geschrieben",
    kpiPass: "pass",
    kpiNoVerdict: "ohne Urteil",
    kpiAverage: "Ø Punktzahl",
    averageNote: { one: "Durchschnittliche Punktzahl eines einzigen Lebenslaufs mit Punktzahl.", other: "Durchschnittliche Punktzahl der {count} neuesten mit Punktzahl." },
    noCv: "Kein Lebenslauf geschrieben.",
    boardTitle: "Pinnwand",
    boardSub: "Stellen bereit, gesendet und beantwortet",
    noBoard: "Keine Stelle bereit, gesendet oder beantwortet.",
    mapTitle: "Karte",
    mapSub: "Wo die Stellen sind",
    noPlaces: "Keine Stelle mit Ort.",
    located: { one: "{count} Stelle mit Ort:", other: "{count} Stellen mit Ort; die häufigsten:" },
    openMap: "Karte öffnen",
    detailPlace: "Ort",
    detailFound: "Gefunden",
    detailWritten: "Geschrieben",
    detailCritic: "Kritiker",
    criticNotes: "Notizen des Kritikers: {notes}",
    openPosition: "Stelle öffnen",
    tipNotPublished: "Status nicht veröffentlicht",
    tipPile: { one: "{count} Stelle auf dem Stapel", other: "{count} Stellen auf dem Stapel" },
    tipPileNoCount: "Stellen auf dem Stapel",
    tipIncoming: "Eingang: {count}",
    tipCvReady: { one: "{count} bereit mit dem PASS des Kritikers", other: "{count} bereit mit dem PASS des Kritikers" },
    tipCvWritten: "die geschriebenen Bewerbungen",
    tipBoard: "Stellen bereit, gesendet, beantwortet",
    tipMap: "wo die Stellen sind",
    keyboardAria: "Agenten und Objekte des Büros",
    readFailed: "Die Cloud lässt sich nicht lesen: Das Büro bleibt, wie es war.",
    notWired: "Die Daten des Büros sind noch nicht verbunden: kein Agent in der Szene.",
    noWebGl: "Die Szene startet nicht: Dieses Fenster hat kein WebGL.",
    teamOffEmpty: "Das Team ist aus: Das Büro ist leer.",
    teamOffRecent: "Das Team ist aus: Es bleiben die Agenten, die in den letzten 24 Stunden gearbeitet haben.",
    notInOffice: "Nicht im Büro: {names}.",
  },
  fr: {
    detailsAria: "Détails du bureau",
    close: "Fermer",
    cloudReadFailed: "Impossible de lire le cloud : {error}",
    loading: "Chargement…",
    departmentOf: "Service {name}",
    departmentNames: {
      scout: "Recherche",
      analisti: "Analyse",
      scorer: "Compatibilité",
      scrittori: "Candidatures",
      critici: "Contrôle qualité",
    },
    departmentTaglines: {
      scout: "Trouve les opportunités qui te correspondent.",
      analisti: "Transforme les annonces en décisions claires.",
      scorer: "Mesure à quel point chaque poste te correspond.",
      scrittori: "Adapte chaque candidature à ton profil et au poste.",
      critici: "Vérifie chaque détail avant que tu décides.",
    },
    sectionNow: "Maintenant",
    statusNotPublished: "Statut non publié par l’équipe.",
    sectionInHand: "En main",
    noneInHand: "Aucun poste laissé là où il s’est arrêté.",
    sectionMoves: "Derniers mouvements",
    noMoves: "Aucun mouvement enregistré dans le cloud.",
    positionGone: "poste qui n’est plus dans le cloud",
    untitled: "(sans titre)",
    openAgentPage: "Ouvrir la page de l’agent",
    phaseSub: "Postes dans cette phase",
    phaseSubCount: { one: "{count} poste dans cette phase", other: "{count} postes dans cette phase" },
    noPhase: "Aucun poste dans cette phase.",
    mostRecent: { one: "Le plus récent.", other: "Les {count} plus récents." },
    allPositions: "Tous les postes",
    incoming: "À l’entrée",
    onThePile: { one: "{count} poste sur la pile", other: "{count} postes sur la pile" },
    positionsOnThePile: "Les postes sur la pile",
    departmentAgents: "Agents du service",
    noDepartmentAgents: "Aucun agent du service ces dernières 24 heures.",
    foundLast7: "Trouvés ces 7 derniers jours",
    cvTitle: "CV produits",
    cvSub: "Étagère de sortie : les candidatures écrites par l’équipe",
    kpiWritten: "écrits",
    kpiPass: "pass",
    kpiNoVerdict: "sans verdict",
    kpiAverage: "score moyen",
    averageNote: { one: "Score moyen d’un seul CV avec un score.", other: "Score moyen des {count} plus récents avec un score." },
    noCv: "Aucun CV écrit.",
    boardTitle: "Tableau",
    boardSub: "Postes prêts, envoyés et avec réponse",
    noBoard: "Aucun poste prêt, envoyé ou avec réponse.",
    mapTitle: "Carte",
    mapSub: "Où sont les postes",
    noPlaces: "Aucun poste avec un lieu.",
    located: { one: "{count} poste avec un lieu :", other: "{count} postes avec un lieu ; les plus fréquents :" },
    openMap: "Ouvrir la carte",
    detailPlace: "Lieu",
    detailFound: "Trouvé",
    detailWritten: "Écrit",
    detailCritic: "Critique",
    criticNotes: "Notes du critique : {notes}",
    openPosition: "Ouvrir le poste",
    tipNotPublished: "statut non publié",
    tipPile: { one: "{count} poste sur la pile", other: "{count} postes sur la pile" },
    tipPileNoCount: "postes sur la pile",
    tipIncoming: "à l’entrée : {count}",
    tipCvReady: { one: "{count} prêt avec le PASS du critique", other: "{count} prêts avec le PASS du critique" },
    tipCvWritten: "les candidatures écrites",
    tipBoard: "postes prêts, envoyés, avec réponse",
    tipMap: "où sont les postes",
    keyboardAria: "Agents et objets du bureau",
    readFailed: "Impossible de lire le cloud : le bureau reste comme il était.",
    notWired: "Les données du bureau ne sont pas encore connectées : aucun agent en scène.",
    noWebGl: "La scène ne démarre pas : cette fenêtre n’a pas WebGL.",
    teamOffEmpty: "L’équipe est éteinte : le bureau est vide.",
    teamOffRecent: "L’équipe est éteinte : restent les agents qui ont travaillé ces dernières 24 heures.",
    notInOffice: "Pas dans le bureau : {names}.",
  },
  es: {
    detailsAria: "Detalles de la oficina",
    close: "Cerrar",
    cloudReadFailed: "No puedo leer la nube: {error}",
    loading: "Cargando…",
    departmentOf: "Departamento {name}",
    departmentNames: {
      scout: "Búsqueda",
      analisti: "Análisis",
      scorer: "Compatibilidad",
      scrittori: "Candidaturas",
      critici: "Control de calidad",
    },
    departmentTaglines: {
      scout: "Encuentra las oportunidades adecuadas para ti.",
      analisti: "Convierte las ofertas en decisiones claras.",
      scorer: "Mide cuánto encaja cada puesto contigo.",
      scrittori: "Adapta cada candidatura a ti y al puesto.",
      critici: "Revisa cada detalle antes de que decidas.",
    },
    sectionNow: "Ahora",
    statusNotPublished: "Estado no publicado por el equipo.",
    sectionInHand: "En mano",
    noneInHand: "Ninguna posición parada donde la dejó.",
    sectionMoves: "Últimos movimientos",
    noMoves: "Ningún movimiento registrado en la nube.",
    positionGone: "posición que ya no está en la nube",
    untitled: "(sin título)",
    openAgentPage: "Abrir la página del agente",
    phaseSub: "Posiciones en esta fase",
    phaseSubCount: { one: "{count} posición en esta fase", other: "{count} posiciones en esta fase" },
    noPhase: "Ninguna posición en esta fase.",
    mostRecent: { one: "La más reciente.", other: "Las {count} más recientes." },
    allPositions: "Todas las posiciones",
    incoming: "Entrada",
    onThePile: { one: "{count} posición en la pila", other: "{count} posiciones en la pila" },
    positionsOnThePile: "Las posiciones de la pila",
    departmentAgents: "Agentes del departamento",
    noDepartmentAgents: "Ningún agente del departamento en las últimas 24 horas.",
    foundLast7: "Encontradas en los últimos 7 días",
    cvTitle: "CV producidos",
    cvSub: "Estante de salida: las candidaturas escritas por el equipo",
    kpiWritten: "escritos",
    kpiPass: "pass",
    kpiNoVerdict: "sin veredicto",
    kpiAverage: "puntuación media",
    averageNote: { one: "Puntuación media de un solo CV con puntuación.", other: "Puntuación media de las {count} más recientes con puntuación." },
    noCv: "Ningún CV escrito.",
    boardTitle: "Tablón",
    boardSub: "Posiciones listas, enviadas y con respuesta",
    noBoard: "Ninguna posición lista, enviada o con respuesta.",
    mapTitle: "Mapa",
    mapSub: "Dónde están las posiciones",
    noPlaces: "Ninguna posición con un lugar.",
    located: { one: "{count} posición con un lugar:", other: "{count} posiciones con un lugar; los más frecuentes:" },
    openMap: "Abrir el mapa",
    detailPlace: "Lugar",
    detailFound: "Encontrada",
    detailWritten: "Escrita",
    detailCritic: "Crítico",
    criticNotes: "Notas del crítico: {notes}",
    openPosition: "Abrir la posición",
    tipNotPublished: "estado no publicado",
    tipPile: { one: "{count} posición en la pila", other: "{count} posiciones en la pila" },
    tipPileNoCount: "posiciones en la pila",
    tipIncoming: "entrada: {count}",
    tipCvReady: { one: "{count} listo con el PASS del crítico", other: "{count} listos con el PASS del crítico" },
    tipCvWritten: "las candidaturas escritas",
    tipBoard: "posiciones listas, enviadas, con respuesta",
    tipMap: "dónde están las posiciones",
    keyboardAria: "Agentes y objetos de la oficina",
    readFailed: "No puedo leer la nube: la oficina se queda como estaba.",
    notWired: "Los datos de la oficina todavía no están conectados: ningún agente en escena.",
    noWebGl: "La escena no arranca: esta ventana no tiene WebGL.",
    teamOffEmpty: "El equipo está apagado: la oficina está vacía.",
    teamOffRecent: "El equipo está apagado: quedan los agentes que han trabajado en las últimas 24 horas.",
    notInOffice: "Fuera de la oficina: {names}.",
  },
  pt: {
    detailsAria: "Detalhes do escritório",
    close: "Fechar",
    cloudReadFailed: "Não consigo ler a cloud: {error}",
    loading: "A carregar…",
    departmentOf: "Departamento {name}",
    departmentNames: {
      scout: "Pesquisa",
      analisti: "Análise",
      scorer: "Compatibilidade",
      scrittori: "Candidaturas",
      critici: "Controlo de qualidade",
    },
    departmentTaglines: {
      scout: "Encontra as oportunidades certas para ti.",
      analisti: "Transforma anúncios em decisões claras.",
      scorer: "Mede o quanto cada vaga combina contigo.",
      scrittori: "Adapta cada candidatura a ti e à vaga.",
      critici: "Revê cada detalhe antes de decidires.",
    },
    sectionNow: "Agora",
    statusNotPublished: "Estado não publicado pela equipa.",
    sectionInHand: "Em mãos",
    noneInHand: "Nenhuma posição parada onde a deixou.",
    sectionMoves: "Últimos movimentos",
    noMoves: "Nenhum movimento registado na cloud.",
    positionGone: "posição que já não está na cloud",
    untitled: "(sem título)",
    openAgentPage: "Abrir a página do agente",
    phaseSub: "Posições nesta fase",
    phaseSubCount: { one: "{count} posição nesta fase", other: "{count} posições nesta fase" },
    noPhase: "Nenhuma posição nesta fase.",
    mostRecent: { one: "A mais recente.", other: "As {count} mais recentes." },
    allPositions: "Todas as posições",
    incoming: "Entrada",
    onThePile: { one: "{count} posição na pilha", other: "{count} posições na pilha" },
    positionsOnThePile: "As posições da pilha",
    departmentAgents: "Agentes do departamento",
    noDepartmentAgents: "Nenhum agente do departamento nas últimas 24 horas.",
    foundLast7: "Encontradas nos últimos 7 dias",
    cvTitle: "CV produzidos",
    cvSub: "Prateleira de saída: as candidaturas escritas pela equipa",
    kpiWritten: "escritos",
    kpiPass: "pass",
    kpiNoVerdict: "sem veredicto",
    kpiAverage: "pontuação média",
    averageNote: { one: "Pontuação média de um só CV com pontuação.", other: "Pontuação média das {count} mais recentes com pontuação." },
    noCv: "Nenhum CV escrito.",
    boardTitle: "Mural",
    boardSub: "Posições prontas, enviadas e com resposta",
    noBoard: "Nenhuma posição pronta, enviada ou com resposta.",
    mapTitle: "Mapa",
    mapSub: "Onde estão as posições",
    noPlaces: "Nenhuma posição com um local.",
    located: { one: "{count} posição com um local:", other: "{count} posições com um local; os mais frequentes:" },
    openMap: "Abrir o mapa",
    detailPlace: "Local",
    detailFound: "Encontrada",
    detailWritten: "Escrita",
    detailCritic: "Crítico",
    criticNotes: "Notas do crítico: {notes}",
    openPosition: "Abrir a posição",
    tipNotPublished: "estado não publicado",
    tipPile: { one: "{count} posição na pilha", other: "{count} posições na pilha" },
    tipPileNoCount: "posições na pilha",
    tipIncoming: "entrada: {count}",
    tipCvReady: { one: "{count} pronto com o PASS do crítico", other: "{count} prontos com o PASS do crítico" },
    tipCvWritten: "as candidaturas escritas",
    tipBoard: "posições prontas, enviadas, com resposta",
    tipMap: "onde estão as posições",
    keyboardAria: "Agentes e objetos do escritório",
    readFailed: "Não consigo ler a cloud: o escritório fica como estava.",
    notWired: "Os dados do escritório ainda não estão ligados: nenhum agente em cena.",
    noWebGl: "A cena não arranca: esta janela não tem WebGL.",
    teamOffEmpty: "A equipa está desligada: o escritório está vazio.",
    teamOffRecent: "A equipa está desligada: ficam os agentes que trabalharam nas últimas 24 horas.",
    notInOffice: "Fora do escritório: {names}.",
  },
  hu: {
    detailsAria: "Az iroda részletei",
    close: "Bezárás",
    cloudReadFailed: "Nem tudom beolvasni a felhőt: {error}",
    loading: "Betöltés…",
    departmentOf: "{name} részleg",
    departmentNames: {
      scout: "Keresés",
      analisti: "Elemzés",
      scorer: "Illeszkedés",
      scrittori: "Jelentkezések",
      critici: "Minőségellenőrzés",
    },
    departmentTaglines: {
      scout: "Megtalálja a hozzád illő lehetőségeket.",
      analisti: "Az álláshirdetésekből világos döntéseket csinál.",
      scorer: "Felméri, mennyire illik hozzád egy-egy állás.",
      scrittori: "Minden jelentkezést hozzád és az álláshoz igazít.",
      critici: "Minden részletet átnéz, mielőtt döntesz.",
    },
    sectionNow: "Most",
    statusNotPublished: "A csapat nem tette közzé az állapotot.",
    sectionInHand: "Kézben",
    noneInHand: "Nincs ott megállt állás, ahol hagyta.",
    sectionMoves: "Utolsó lépések",
    noMoves: "Nincs lépés rögzítve a felhőben.",
    positionGone: "az állás már nincs a felhőben",
    untitled: "(cím nélkül)",
    openAgentPage: "Az ügynök oldalának megnyitása",
    phaseSub: "Állások ebben a fázisban",
    phaseSubCount: { one: "{count} állás ebben a fázisban", other: "{count} állás ebben a fázisban" },
    noPhase: "Nincs állás ebben a fázisban.",
    mostRecent: { one: "A legutóbbi.", other: "A legutóbbi {count}." },
    allPositions: "Minden állás",
    incoming: "Beérkező",
    onThePile: { one: "{count} állás a halomban", other: "{count} állás a halomban" },
    positionsOnThePile: "A halomban lévő állások",
    departmentAgents: "A részleg ügynökei",
    noDepartmentAgents: "A részlegnek nincs ügynöke az utolsó 24 órában.",
    foundLast7: "Az utolsó 7 napban talált",
    cvTitle: "Elkészült önéletrajzok",
    cvSub: "Kimeneti polc: a csapat által írt jelentkezések",
    kpiWritten: "megírva",
    kpiPass: "pass",
    kpiNoVerdict: "döntés nélkül",
    kpiAverage: "átlagos pontszám",
    averageNote: { one: "Egyetlen, pontszámmal rendelkező önéletrajz átlagos pontszáma.", other: "A legutóbbi {count}, pontszámmal rendelkező átlagos pontszáma." },
    noCv: "Nincs megírt önéletrajz.",
    boardTitle: "Hirdetőtábla",
    boardSub: "Kész, elküldött és megválaszolt állások",
    noBoard: "Nincs kész, elküldött vagy megválaszolt állás.",
    mapTitle: "Térkép",
    mapSub: "Hol vannak az állások",
    noPlaces: "Nincs helyszínnel rendelkező állás.",
    located: { one: "{count} helyszínnel rendelkező állás:", other: "{count} helyszínnel rendelkező állás; a leggyakoribbak:" },
    openMap: "A térkép megnyitása",
    detailPlace: "Hely",
    detailFound: "Megtalálva",
    detailWritten: "Megírva",
    detailCritic: "Kritikus",
    criticNotes: "A kritikus jegyzetei: {notes}",
    openPosition: "Az állás megnyitása",
    tipNotPublished: "az állapot nincs közzétéve",
    tipPile: { one: "{count} állás a halomban", other: "{count} állás a halomban" },
    tipPileNoCount: "állás a halomban",
    tipIncoming: "beérkező: {count}",
    tipCvReady: { one: "{count} kész a kritikus PASS-ával", other: "{count} kész a kritikus PASS-ával" },
    tipCvWritten: "a megírt jelentkezések",
    tipBoard: "kész, elküldött, megválaszolt állások",
    tipMap: "hol vannak az állások",
    keyboardAria: "Az iroda ügynökei és tárgyai",
    readFailed: "Nem tudom beolvasni a felhőt: az iroda marad, ahogy volt.",
    notWired: "Az iroda adatai még nincsenek összekötve: nincs ügynök a jelenetben.",
    noWebGl: "A jelenet nem indul: ennek az ablaknak nincs WebGL-je.",
    teamOffEmpty: "A csapat ki van kapcsolva: az iroda üres.",
    teamOffRecent: "A csapat ki van kapcsolva: az utolsó 24 órában dolgozó ügynökök maradnak.",
    notInOffice: "Nincs az irodában: {names}.",
  },
};

export { fill } from "../lib/text-slots";

/** The language a dictionary is picked for; one the app does not have gets the app's own. */
export function officeLocale(locale?: string): Locale {
  return (locales as readonly string[]).includes(locale ?? "") ? (locale as Locale) : appLocale();
}

/**
 * The layout with the departments' signs in the person's language: the name and the tagline painted on the
 * floor, the panel's heading and the handoff tables' tags ("RICERCA  →  ANALISI") all come from the layout.
 */
export function localizeLayout(layout: OfficeLayout, locale?: string): OfficeLayout {
  const t = officeText(locale);
  return {
    ...layout,
    departments: layout.departments.map((dept) => {
      const next = DEPT_ORDER[DEPT_ORDER.indexOf(dept.id) + 1];
      return {
        ...dept,
        name: t.departmentNames[dept.id] ?? dept.name,
        tagline: dept.tagline === undefined ? undefined : (t.departmentTaglines[dept.id] ?? dept.tagline),
        // the tag names the department and the one that takes its work, as the layout's own does
        handoff: dept.handoff && next
          ? { ...dept.handoff, label: `${t.departmentNames[dept.id].toUpperCase()}  →  ${t.departmentNames[next].toUpperCase()}` }
          : dept.handoff,
      };
    }),
  };
}

/** The sentence for a count, in its singular or plural form. */
export function ofCount(locale: string | undefined, count: number | string, forms: PluralForms): string {
  return pluralText(officeLocale(locale), count, forms);
}

/** The dictionary of a language; one the app does not have gets the app's own. */
export function officeText(locale?: string): OfficeText {
  return OFFICE_TEXT[officeLocale(locale)];
}
