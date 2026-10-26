import type { Locale } from "@/i18n/config";

/**
 * What a desktop page says while it loads and when it cannot: the dashboard,
 * the Agents page and the office. 7 languages; Italian is the source and its
 * shape is the type. The refresh word is the one the Squadra page uses for its
 * own «Aggiorna» button (existing-team-status.i18n.ts).
 */
export interface PageStatesText {
  loadingDashboard: string;
  loadingAgents: string;
  loadingOffice: string;
  dashboardFailed: string;
  agentsFailed: string;
  officeNoAssets: string;
  officeFailed: string;
  loadingSwipe: string;
  swipeFailed: string;
}

export const PAGE_STATES_TEXT: Record<Locale, PageStatesText> = {
  it: {
    loadingDashboard: "Caricamento dashboard",
    loadingAgents: "Caricamento agenti",
    loadingOffice: "Caricamento ufficio",
    dashboardFailed: "Non riesco a leggere la dashboard. Controlla la connessione e premi «Aggiorna».",
    agentsFailed: "Non riesco a leggere gli agenti. Controlla la connessione e premi «Aggiorna».",
    officeNoAssets: "L'arte dell'ufficio non è ancora nell'app.",
    officeFailed: "Non riesco a caricare l'ufficio. Premi «Aggiorna» o riapri la pagina.",
    loadingSwipe: "Caricamento del mazzo",
    swipeFailed: "Non riesco a leggere le posizioni da giudicare. Controlla la connessione e premi «Aggiorna».",
  },
  en: {
    loadingDashboard: "Loading dashboard",
    loadingAgents: "Loading agents",
    loadingOffice: "Loading office",
    dashboardFailed: "I can't read the dashboard. Check the connection and press «Refresh».",
    agentsFailed: "I can't read the agents. Check the connection and press «Refresh».",
    officeNoAssets: "The office artwork is not in the app yet.",
    officeFailed: "I can't load the office. Press «Refresh» or reopen the page.",
    loadingSwipe: "Loading the deck",
    swipeFailed: "I can't read the positions to judge. Check the connection and press «Refresh».",
  },
  de: {
    loadingDashboard: "Dashboard wird geladen",
    loadingAgents: "Agenten werden geladen",
    loadingOffice: "Büro wird geladen",
    dashboardFailed: "Das Dashboard lässt sich nicht lesen. Prüfe die Verbindung und drücke «Aktualisieren».",
    agentsFailed: "Die Agenten lassen sich nicht lesen. Prüfe die Verbindung und drücke «Aktualisieren».",
    officeNoAssets: "Die Grafiken des Büros sind noch nicht in der App.",
    officeFailed: "Das Büro lässt sich nicht laden. Drücke «Aktualisieren» oder öffne die Seite neu.",
    loadingSwipe: "Stapel wird geladen",
    swipeFailed: "Die zu bewertenden Stellen lassen sich nicht lesen. Prüfe die Verbindung und drücke «Aktualisieren».",
  },
  fr: {
    loadingDashboard: "Chargement du tableau de bord",
    loadingAgents: "Chargement des agents",
    loadingOffice: "Chargement du bureau",
    dashboardFailed: "Impossible de lire le tableau de bord. Vérifie la connexion et appuie sur «Actualiser».",
    agentsFailed: "Impossible de lire les agents. Vérifie la connexion et appuie sur «Actualiser».",
    officeNoAssets: "Les illustrations du bureau ne sont pas encore dans l’app.",
    officeFailed: "Impossible de charger le bureau. Appuie sur «Actualiser» ou rouvre la page.",
    loadingSwipe: "Chargement de la pile",
    swipeFailed: "Impossible de lire les postes à juger. Vérifie la connexion et appuie sur «Actualiser».",
  },
  es: {
    loadingDashboard: "Cargando el panel",
    loadingAgents: "Cargando los agentes",
    loadingOffice: "Cargando la oficina",
    dashboardFailed: "No puedo leer el panel. Comprueba la conexión y pulsa «Actualizar».",
    agentsFailed: "No puedo leer los agentes. Comprueba la conexión y pulsa «Actualizar».",
    officeNoAssets: "El arte de la oficina todavía no está en la app.",
    officeFailed: "No puedo cargar la oficina. Pulsa «Actualizar» o vuelve a abrir la página.",
    loadingSwipe: "Cargando el mazo",
    swipeFailed: "No puedo leer las posiciones por valorar. Comprueba la conexión y pulsa «Actualizar».",
  },
  pt: {
    loadingDashboard: "A carregar o painel",
    loadingAgents: "A carregar os agentes",
    loadingOffice: "A carregar o escritório",
    dashboardFailed: "Não consigo ler o painel. Verifica a ligação e carrega em «Atualizar».",
    agentsFailed: "Não consigo ler os agentes. Verifica a ligação e carrega em «Atualizar».",
    officeNoAssets: "A arte do escritório ainda não está na app.",
    officeFailed: "Não consigo carregar o escritório. Carrega em «Atualizar» ou volta a abrir a página.",
    loadingSwipe: "A carregar o baralho",
    swipeFailed: "Não consigo ler as vagas por avaliar. Verifica a ligação e carrega em «Atualizar».",
  },
  hu: {
    loadingDashboard: "Irányítópult betöltése",
    loadingAgents: "Ügynökök betöltése",
    loadingOffice: "Iroda betöltése",
    dashboardFailed: "Nem tudom beolvasni az irányítópultot. Ellenőrizd a kapcsolatot, és nyomd meg a «Frissítés» gombot.",
    agentsFailed: "Nem tudom beolvasni az ügynököket. Ellenőrizd a kapcsolatot, és nyomd meg a «Frissítés» gombot.",
    officeNoAssets: "Az iroda grafikái még nincsenek az appban.",
    officeFailed: "Nem tudom betölteni az irodát. Nyomd meg a «Frissítés» gombot, vagy nyisd meg újra az oldalt.",
    loadingSwipe: "A pakli betöltése",
    swipeFailed: "Nem tudom beolvasni az elbírálandó állásokat. Ellenőrizd a kapcsolatot, és nyomd meg a «Frissítés» gombot.",
  },
};
