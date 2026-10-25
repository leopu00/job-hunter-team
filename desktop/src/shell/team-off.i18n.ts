import type { Locale } from "@/i18n/config";

/** The fixed warning of the app opened without the team (banner in the shell). */
export interface TeamOffCopy {
  title: string;
  note: string;
  wake: string;
  waking: string;
  woke: string;
  start: string;
}

export const TEAM_OFF_TEXT: Record<Locale, TeamOffCopy> = {
  it: {
    title: "La squadra è spenta",
    note: "Le pagine che parlano con gli agenti, come la chat e Agenti, funzionano solo con la squadra accesa. La preparazione non è finita: alla prossima apertura ti propone di riprenderla.",
    wake: "Riaccendi il runtime",
    waking: "Riaccendo il runtime…",
    woke: "Il runtime è acceso. La squadra resta spenta: nessun agente è partito.",
    start: "Avvia la squadra",
  },
  en: {
    title: "The team is off",
    note: "The pages that talk to the agents, like the chat and Agents, only work with the team running. The setup is not finished: the next time you open the app it offers to resume it.",
    wake: "Turn the runtime on",
    waking: "Turning the runtime on…",
    woke: "The runtime is on. The team stays off: no agent has started.",
    start: "Start the team",
  },
  de: {
    title: "Das Team ist aus",
    note: "Die Seiten, die mit den Agenten sprechen, etwa der Chat und Agenten, funktionieren nur bei laufendem Team. Die Einrichtung ist nicht abgeschlossen: Beim nächsten Öffnen der App wird angeboten, sie fortzusetzen.",
    wake: "Runtime einschalten",
    waking: "Runtime wird eingeschaltet…",
    woke: "Die Runtime läuft. Das Team bleibt aus: Es wurde kein Agent gestartet.",
    start: "Team starten",
  },
  es: {
    title: "El equipo está apagado",
    note: "Las páginas que hablan con los agentes, como el chat y Agentes, solo funcionan con el equipo en marcha. La preparación no ha terminado: la próxima vez que abras la app te propondrá retomarla.",
    wake: "Encender el runtime",
    waking: "Encendiendo el runtime…",
    woke: "El runtime está encendido. El equipo sigue apagado: no ha arrancado ningún agente.",
    start: "Iniciar el equipo",
  },
  fr: {
    title: "L’équipe est arrêtée",
    note: "Les pages qui parlent aux agents, comme le chat et Agents, ne fonctionnent qu’avec l’équipe en marche. La préparation n’est pas terminée : à la prochaine ouverture de l’app, elle te proposera de la reprendre.",
    wake: "Rallumer le runtime",
    waking: "Le runtime se rallume…",
    woke: "Le runtime est allumé. L’équipe reste arrêtée : aucun agent n’a démarré.",
    start: "Démarrer l’équipe",
  },
  hu: {
    title: "A csapat le van állítva",
    note: "Az ügynökökkel beszélő oldalak, például a csevegés és az Ügynökök, csak futó csapattal működnek. Az előkészítés nem fejeződött be: az alkalmazás következő megnyitásakor felkínálja a folytatást.",
    wake: "Futtatókörnyezet bekapcsolása",
    waking: "A futtatókörnyezet bekapcsol…",
    woke: "A futtatókörnyezet be van kapcsolva. A csapat le marad állítva: egyetlen ügynök sem indult el.",
    start: "Csapat indítása",
  },
  pt: {
    title: "A equipa está desligada",
    note: "As páginas que falam com os agentes, como o chat e Agentes, só funcionam com a equipa ligada. A preparação não terminou: na próxima vez que abrires a app, ela propõe retomá-la.",
    wake: "Ligar o runtime",
    waking: "A ligar o runtime…",
    woke: "O runtime está ligado. A equipa continua desligada: nenhum agente arrancou.",
    start: "Iniciar a equipa",
  },
};
