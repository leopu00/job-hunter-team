import type { Locale } from "@/i18n/config";

export interface ExistingTeamReadOnlyText {
  /** Why a control that would write is disabled, the assistant being off. */
  assistantOff: string;
  /** Same, the assistant being on: this connection never lets the app write. */
  connectionReadOnly: string;
  banner: string;
  /** The navigation entry of the page that tells the team's state. */
  team: string;
  /** The navigation entry of the page that shows the candidate profile. */
  profile: string;
  /** The navigation entry of the office (a desktop page, no web label). */
  office: string;
  /** The navigation entry of the agents' page (a desktop page, no web label). */
  agents: string;
  /** What a click on an agent of the office says: its moves are not in what the VPS reports. */
  officeAgentNoMoves: string;
  back: string;
  navAria: string;
  /** The list is sorted by the insertion date: the team's last action is not read. */
  sortLastAction: string;
}

export const EXISTING_TEAM_READONLY_TEXT: Record<Locale, ExistingTeamReadOnlyText> = {
  it: {
    assistantOff: "Solo lettura: assistente non attivo",
    connectionReadOnly: "Solo lettura: questa connessione non modifica i dati",
    banner: "Stai consultando gli annunci della squadra esistente in sola lettura. Le azioni che modificano i dati restano disabilitate; l’avvio dell’assistente è separato e chiede una conferma.",
    team: "Squadra",
    profile: "Profilo",
    office: "Ufficio",
    agents: "Agenti",
    officeAgentNoMoves: "Cosa ha fatto questo agente non si legge dalla VPS: qui si vede solo se la sua sessione è accesa.",
    back: "Torna alla configurazione",
    navAria: "Navigazione in sola lettura",
    sortLastAction: "L’ordinamento per ultima azione non è disponibile in sola lettura: gli annunci sono ordinati per data di inserimento.",
  },
  en: {
    assistantOff: "Read only: assistant not active",
    connectionReadOnly: "Read only: this connection does not change data",
    banner: "You are browsing the existing team's positions read only. Actions that change data stay disabled; starting the assistant is separate and asks for a confirmation.",
    team: "Team",
    profile: "Profile",
    office: "Office",
    agents: "Agents",
    officeAgentNoMoves: "What this agent has done cannot be read from the VPS: only whether its session is up shows here.",
    back: "Back to setup",
    navAria: "Read-only navigation",
    sortLastAction: "Sorting by last action is not available read only: the positions are sorted by the date they were found.",
  },
  de: {
    assistantOff: "Nur Lesen: Assistent nicht aktiv",
    connectionReadOnly: "Nur Lesen: Diese Verbindung ändert keine Daten",
    banner: "Du siehst die Stellen des vorhandenen Teams nur lesend. Aktionen, die Daten ändern, bleiben deaktiviert; das Starten des Assistenten ist davon getrennt und verlangt eine Bestätigung.",
    team: "Team",
    profile: "Profil",
    office: "Büro",
    agents: "Agenten",
    officeAgentNoMoves: "Was dieser Agent getan hat, lässt sich nicht von der VPS lesen: hier ist nur zu sehen, ob seine Sitzung läuft.",
    back: "Zurück zur Einrichtung",
    navAria: "Navigation im Lesemodus",
    sortLastAction: "Die Sortierung nach letzter Aktion ist im Lesemodus nicht verfügbar: Die Stellen sind nach Funddatum sortiert.",
  },
  fr: {
    assistantOff: "Lecture seule : assistant inactif",
    connectionReadOnly: "Lecture seule : cette connexion ne modifie pas les données",
    banner: "Vous consultez les offres de l’équipe existante en lecture seule. Les actions qui modifient les données restent désactivées ; le démarrage de l’assistant est distinct et demande une confirmation.",
    team: "Équipe",
    profile: "Profil",
    office: "Bureau",
    agents: "Agents",
    officeAgentNoMoves: "Ce que cet agent a fait ne se lit pas sur la VPS : on voit ici seulement si sa session est active.",
    back: "Retour à la configuration",
    navAria: "Navigation en lecture seule",
    sortLastAction: "Le tri par dernière action n’est pas disponible en lecture seule : les offres sont triées par date de découverte.",
  },
  es: {
    assistantOff: "Solo lectura: asistente no activo",
    connectionReadOnly: "Solo lectura: esta conexión no modifica los datos",
    banner: "Estás consultando las ofertas del equipo existente en solo lectura. Las acciones que modifican datos siguen desactivadas; el inicio del asistente es aparte y pide una confirmación.",
    team: "Equipo",
    profile: "Perfil",
    office: "Oficina",
    agents: "Agentes",
    officeAgentNoMoves: "Lo que ha hecho este agente no se puede leer desde la VPS: aquí solo se ve si su sesión está activa.",
    back: "Volver a la configuración",
    navAria: "Navegación de solo lectura",
    sortLastAction: "La ordenación por última acción no está disponible en solo lectura: las ofertas se ordenan por fecha de hallazgo.",
  },
  pt: {
    assistantOff: "Só leitura: assistente não ativo",
    connectionReadOnly: "Só leitura: esta ligação não altera os dados",
    banner: "Está a consultar as vagas da equipa existente só em leitura. As ações que alteram dados continuam desativadas; o arranque do assistente é separado e pede uma confirmação.",
    team: "Equipa",
    profile: "Perfil",
    office: "Escritório",
    agents: "Agentes",
    officeAgentNoMoves: "O que este agente fez não se lê a partir da VPS: aqui só se vê se a sessão dele está ativa.",
    back: "Voltar à configuração",
    navAria: "Navegação só de leitura",
    sortLastAction: "A ordenação por última ação não está disponível só em leitura: as vagas estão ordenadas pela data em que foram encontradas.",
  },
  hu: {
    assistantOff: "Csak olvasható: az asszisztens nem aktív",
    connectionReadOnly: "Csak olvasható: ez a kapcsolat nem módosítja az adatokat",
    banner: "A meglévő csapat pozícióit csak olvasható módban nézi. Az adatokat módosító műveletek le vannak tiltva; az asszisztens indítása külön dolog, és megerősítést kér.",
    team: "Csapat",
    profile: "Profil",
    office: "Iroda",
    agents: "Ügynökök",
    officeAgentNoMoves: "Azt, hogy mit csinált ez az ügynök, nem lehet kiolvasni a VPS-ről: itt csak az látszik, hogy fut-e a munkamenete.",
    back: "Vissza a beállításhoz",
    navAria: "Csak olvasható navigáció",
    sortLastAction: "Az utolsó művelet szerinti rendezés csak olvasható módban nem érhető el: a pozíciók a megtalálás dátuma szerint vannak rendezve.",
  },
};
