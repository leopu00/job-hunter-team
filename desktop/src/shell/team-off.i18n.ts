import type { Locale } from "@/i18n/config";

/** The fixed warning of the app opened without the team (banner in the shell). */
export interface TeamOffCopy {
  title: string;
  note: string;
  wake: string;
  waking: string;
  woke: string;
  start: string;
  /** Said by a page that needs the container while the app is open without the team. */
  needsRuntime: string;
}

export const TEAM_OFF_TEXT: Record<Locale, TeamOffCopy> = {
  it: {
    title: "La squadra è spenta",
    note: "Le pagine che parlano con gli agenti, come la chat e Agenti, funzionano solo con la squadra accesa. La preparazione non è finita: alla prossima apertura ti propone di riprenderla.",
    wake: "Riaccendi il runtime",
    waking: "Riaccendo il runtime…",
    woke: "Il runtime è acceso. La squadra resta spenta: nessun agente è partito.",
    start: "Avvia la squadra",
    needsRuntime: "Questa pagina legge i dati dal container della squadra, che ora è spento. Riaccendi il runtime dalla barra in alto: la squadra resta spenta.",
  },
  en: {
    title: "The team is off",
    note: "The pages that talk to the agents, like the chat and Agents, only work with the team running. The setup is not finished: the next time you open the app it offers to resume it.",
    wake: "Turn the runtime on",
    waking: "Turning the runtime on…",
    woke: "The runtime is on. The team stays off: no agent has started.",
    start: "Start the team",
    needsRuntime: "This page reads its data from the team's container, which is off now. Turn the runtime on from the bar above: the team stays off.",
  },
  de: {
    title: "Das Team ist aus",
    note: "Die Seiten, die mit den Agenten sprechen, etwa der Chat und Agenten, funktionieren nur bei laufendem Team. Die Einrichtung ist nicht abgeschlossen: Beim nächsten Öffnen der App wird angeboten, sie fortzusetzen.",
    wake: "Runtime einschalten",
    waking: "Runtime wird eingeschaltet…",
    woke: "Die Runtime läuft. Das Team bleibt aus: Es wurde kein Agent gestartet.",
    start: "Team starten",
    needsRuntime: "Diese Seite liest ihre Daten aus dem Container des Teams, der gerade aus ist. Schalte die Runtime in der Leiste oben ein: Das Team bleibt aus.",
  },
  es: {
    title: "El equipo está apagado",
    note: "Las páginas que hablan con los agentes, como el chat y Agentes, solo funcionan con el equipo en marcha. La preparación no ha terminado: la próxima vez que abras la app te propondrá retomarla.",
    wake: "Encender el runtime",
    waking: "Encendiendo el runtime…",
    woke: "El runtime está encendido. El equipo sigue apagado: no ha arrancado ningún agente.",
    start: "Iniciar el equipo",
    needsRuntime: "Esta página lee sus datos del contenedor del equipo, que ahora está apagado. Enciende el runtime desde la barra de arriba: el equipo sigue apagado.",
  },
  fr: {
    title: "L’équipe est arrêtée",
    note: "Les pages qui parlent aux agents, comme le chat et Agents, ne fonctionnent qu’avec l’équipe en marche. La préparation n’est pas terminée : à la prochaine ouverture de l’app, elle te proposera de la reprendre.",
    wake: "Rallumer le runtime",
    waking: "Le runtime se rallume…",
    woke: "Le runtime est allumé. L’équipe reste arrêtée : aucun agent n’a démarré.",
    start: "Démarrer l’équipe",
    needsRuntime: "Cette page lit ses données dans le conteneur de l’équipe, qui est arrêté. Rallume le runtime depuis la barre du haut : l’équipe reste arrêtée.",
  },
  hu: {
    title: "A csapat le van állítva",
    note: "Az ügynökökkel beszélő oldalak, például a csevegés és az Ügynökök, csak futó csapattal működnek. Az előkészítés nem fejeződött be: az alkalmazás következő megnyitásakor felkínálja a folytatást.",
    wake: "Futtatókörnyezet bekapcsolása",
    waking: "A futtatókörnyezet bekapcsol…",
    woke: "A futtatókörnyezet be van kapcsolva. A csapat le marad állítva: egyetlen ügynök sem indult el.",
    start: "Csapat indítása",
    needsRuntime: "Ez az oldal a csapat tárolójából olvassa az adatait, amely most le van állítva. Kapcsold be a futtatókörnyezetet a fenti sávból: a csapat le marad állítva.",
  },
  pt: {
    title: "A equipa está desligada",
    note: "As páginas que falam com os agentes, como o chat e Agentes, só funcionam com a equipa ligada. A preparação não terminou: na próxima vez que abrires a app, ela propõe retomá-la.",
    wake: "Ligar o runtime",
    waking: "A ligar o runtime…",
    woke: "O runtime está ligado. A equipa continua desligada: nenhum agente arrancou.",
    start: "Iniciar a equipa",
    needsRuntime: "Esta página lê os dados do contentor da equipa, que está desligado. Liga o runtime na barra acima: a equipa continua desligada.",
  },
};
