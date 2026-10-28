import type { Locale } from "@/i18n/config";
import type { ConnectionStatusField, TeamStatusField } from "../../lib/existing-team-status";

export interface FieldText {
  label: string;
  yes: string;
  no: string;
}

export interface ExistingTeamStatusText {
  title: string;
  intro: string;
  /** The same, for the team connected in full: where its actions are, not that they are disabled. */
  introFullLink: string;
  /** One line on top, when the VPS says the container is stopped: no agent can be working. */
  summaryOff: string;
  yes: string;
  no: string;
  refresh: string;
  refreshing: string;
  unknown: string;
  readAt: string; // {time}
  staleWhileReading: string; // {time}
  failed: string;
  failedAt: string; // {time}
  actionsAssistantOff: string; // {time}: the connection's
  actionsFullLink: string; // the team connected in full: where its actions are
  actionsReadOnly: string; // {time}: the connection's
  /** Under the captain and assistant rows: their value is the connection's, not this refresh's. */
  atConnection: string; // {time}
  /** Same, for a value taken by the check that follows «Attiva assistente». */
  atAssistantStart: string; // {time}
  actionsAfterStart: string; // {time}
  /** The connection gave no value for the row. */
  noConnectionValue: string;
  fields: Record<TeamStatusField | ConnectionStatusField, FieldText>;
}

export const EXISTING_TEAM_STATUS_TEXT: Record<Locale, ExistingTeamStatusText> = {
  it: {
    title: "Squadra",
    intro: "Lo stato della squadra sulla VPS, letto adesso con un comando di sola lettura. Le azioni sui dati restano disabilitate; l’avvio dell’assistente è separato e chiede una conferma.",
    introFullLink: "Lo stato della squadra sulla VPS, letto adesso con un comando di sola lettura. Le azioni sulla squadra sono nella pagina Agenti e in quelle degli annunci.",
    summaryOff: "La squadra è spenta: il container non è acceso, quindi nessun agente lavora. Le righe qui sotto dicono cosa risulta sulla VPS.",
    yes: "Sì",
    no: "No",
    refresh: "Aggiorna",
    refreshing: "Lettura in corso…",
    unknown: "Stato non ancora letto: nessun dato è mostrato finché la lettura non riesce.",
    readAt: "Letto alle {time}",
    staleWhileReading: "Valori della lettura delle {time}, aggiornamento in corso",
    failed: "Lettura non riuscita",
    failedAt: "Ultimo tentativo alle {time}. Nessun valore precedente viene mostrato come attuale.",
    actionsAssistantOff: "Al collegamento delle {time} l’assistente non era attivo: le azioni sono disabilitate, e questa connessione è comunque in sola lettura.",
    actionsReadOnly: "Al collegamento delle {time} l’assistente era attivo, ma questa connessione è in sola lettura: le azioni restano disabilitate.",
    actionsFullLink: "Questa squadra è collegata in modo completo: le azioni sono nella pagina Agenti (avvio, arresto, chat) e in quelle degli annunci (giudizi); questa pagina mostra soltanto lo stato.",
    atConnection: "Valore del collegamento delle {time}, non riletto da questo aggiornamento.",
    noConnectionValue: "Il collegamento non ha dato un valore per questa riga; questo aggiornamento non lo legge.",
    atAssistantStart: "Valore della verifica dopo l’avvio dell’assistente, delle {time}, non riletto da questo aggiornamento.",
    actionsAfterStart: "L’assistente è stato avviato e verificato alle {time}, ma questa connessione è in sola lettura: le azioni restano disabilitate.",
    fields: {
      runtimeInstalled: { label: "Runtime installato", yes: "Il runtime della squadra è installato sulla VPS.", no: "Il runtime della squadra non risulta installato sulla VPS." },
      containerRunning: { label: "Container acceso", yes: "Il container della squadra è acceso.", no: "Il container della squadra è spento: la squadra non lavora." },
      providerConfigured: { label: "Provider configurato", yes: "Un provider di intelligenza artificiale è configurato.", no: "Nessun provider di intelligenza artificiale è configurato: gli agenti non possono lavorare." },
      providerAuthenticated: { label: "Provider con accesso valido", yes: "Il provider ha un accesso valido.", no: "Il provider non ha un accesso valido: gli agenti non possono usarlo." },
      captainRunning: { label: "Capitano attivo", yes: "Il capitano è attivo.", no: "Il capitano non è attivo." },
      assistantRunning: { label: "Assistente attivo", yes: "L’assistente è attivo.", no: "L’assistente non è attivo: la chat non è disponibile e le azioni che chiedono qualcosa alla squadra restano disabilitate." },
      profileReady: { label: "Profilo pronto", yes: "Il profilo del candidato è pronto.", no: "Il profilo del candidato non è ancora pronto." },
      assistantWelcomed: { label: "Assistente ha accolto l’utente", yes: "L’assistente ha già accolto l’utente.", no: "L’assistente non ha ancora accolto l’utente." },
    },
  },
  en: {
    title: "Team",
    intro: "The team’s state on the VPS, read just now with a read-only command. Viewing is read only: actions on data stay disabled; starting the assistant is separate and asks for a confirmation.",
    introFullLink: "The team’s state on the VPS, read just now with a read-only command. Actions on the team are on the Agents page and on the positions pages.",
    summaryOff: "The team is off: its container is stopped, so no agent is working. The rows below say what the VPS reports.",
    yes: "Yes",
    no: "No",
    refresh: "Refresh",
    refreshing: "Reading…",
    unknown: "State not read yet: nothing is shown until a read succeeds.",
    readAt: "Read at {time}",
    staleWhileReading: "Values from the read at {time}, updating",
    failed: "The read did not succeed",
    failedAt: "Last attempt at {time}. No earlier value is shown as current.",
    actionsAssistantOff: "At the connection at {time} the assistant was not running: actions are disabled, and this connection is read only anyway.",
    actionsReadOnly: "At the connection at {time} the assistant was running, but this connection is read only: actions stay disabled.",
    actionsFullLink: "This team is connected in full: its actions are on the Agents page (start, stop, chat) and on the positions pages (judgements); this page only shows the state.",
    atConnection: "Value from the connection at {time}, not read again by this refresh.",
    noConnectionValue: "The connection gave no value for this row; this refresh does not read it.",
    atAssistantStart: "Value from the check after the assistant was started, at {time}, not read again by this refresh.",
    actionsAfterStart: "The assistant was started and checked at {time}, but this connection is read only: actions stay disabled.",
    fields: {
      runtimeInstalled: { label: "Runtime installed", yes: "The team’s runtime is installed on the VPS.", no: "The team’s runtime is not installed on the VPS." },
      containerRunning: { label: "Container running", yes: "The team’s container is running.", no: "The team’s container is stopped: the team is not working." },
      providerConfigured: { label: "Provider configured", yes: "An AI provider is configured.", no: "No AI provider is configured: the agents cannot work." },
      providerAuthenticated: { label: "Provider signed in", yes: "The provider has valid access.", no: "The provider has no valid access: the agents cannot use it." },
      captainRunning: { label: "Captain running", yes: "The captain is running.", no: "The captain is not running." },
      assistantRunning: { label: "Assistant running", yes: "The assistant is running.", no: "The assistant is not running: chat is unavailable and the actions that ask the team for something stay disabled." },
      profileReady: { label: "Profile ready", yes: "The candidate’s profile is ready.", no: "The candidate’s profile is not ready yet." },
      assistantWelcomed: { label: "Assistant welcomed the user", yes: "The assistant has already welcomed the user.", no: "The assistant has not welcomed the user yet." },
    },
  },
  de: {
    title: "Team",
    intro: "Der Zustand des Teams auf dem VPS, soeben mit einem Lesebefehl gelesen. Die Ansicht ist nur lesend: Aktionen auf Daten bleiben deaktiviert; das Starten des Assistenten ist getrennt und verlangt eine Bestätigung.",
    introFullLink: "Der Zustand des Teams auf dem VPS, soeben mit einem Lesebefehl gelesen. Aktionen am Team findest du auf der Seite Agenten und bei den Stellen.",
    summaryOff: "Das Team ist aus: Der Container ist angehalten, daher arbeitet kein Agent. Die Zeilen darunter zeigen, was die VPS meldet.",
    yes: "Ja",
    no: "Nein",
    refresh: "Aktualisieren",
    refreshing: "Wird gelesen …",
    unknown: "Zustand noch nicht gelesen: Es wird nichts angezeigt, bis ein Lesen gelingt.",
    readAt: "Gelesen um {time}",
    staleWhileReading: "Werte vom Lesen um {time}, Aktualisierung läuft",
    failed: "Lesen fehlgeschlagen",
    failedAt: "Letzter Versuch um {time}. Frühere Werte werden nicht als aktuell angezeigt.",
    actionsAssistantOff: "Beim Verbinden um {time} lief der Assistent nicht: Aktionen sind deaktiviert; diese Verbindung ist ohnehin schreibgeschützt.",
    actionsReadOnly: "Beim Verbinden um {time} lief der Assistent, aber diese Verbindung ist schreibgeschützt: Aktionen bleiben deaktiviert.",
    actionsFullLink: "Dieses Team ist vollständig verbunden: Aktionen findest du auf der Seite Agenten (Starten, Stoppen, Chat) und bei den Stellen (Bewertungen); diese Seite zeigt nur den Status.",
    atConnection: "Wert vom Verbinden um {time}, von dieser Aktualisierung nicht neu gelesen.",
    noConnectionValue: "Die Verbindung hat für diese Zeile keinen Wert geliefert; diese Aktualisierung liest ihn nicht.",
    atAssistantStart: "Wert der Prüfung nach dem Start des Assistenten um {time}, von dieser Aktualisierung nicht neu gelesen.",
    actionsAfterStart: "Der Assistent wurde um {time} gestartet und geprüft, aber diese Verbindung ist schreibgeschützt: Aktionen bleiben deaktiviert.",
    fields: {
      runtimeInstalled: { label: "Runtime installiert", yes: "Die Runtime des Teams ist auf dem VPS installiert.", no: "Die Runtime des Teams ist auf dem VPS nicht installiert." },
      containerRunning: { label: "Container läuft", yes: "Der Container des Teams läuft.", no: "Der Container des Teams ist gestoppt: Das Team arbeitet nicht." },
      providerConfigured: { label: "Anbieter eingerichtet", yes: "Ein KI-Anbieter ist eingerichtet.", no: "Kein KI-Anbieter ist eingerichtet: Die Agenten können nicht arbeiten." },
      providerAuthenticated: { label: "Anbieter angemeldet", yes: "Der Anbieter hat einen gültigen Zugang.", no: "Der Anbieter hat keinen gültigen Zugang: Die Agenten können ihn nicht nutzen." },
      captainRunning: { label: "Kapitän aktiv", yes: "Der Kapitän ist aktiv.", no: "Der Kapitän ist nicht aktiv." },
      assistantRunning: { label: "Assistent aktiv", yes: "Der Assistent ist aktiv.", no: "Der Assistent ist nicht aktiv: Der Chat ist nicht verfügbar und Aktionen, die dem Team etwas auftragen, bleiben deaktiviert." },
      profileReady: { label: "Profil bereit", yes: "Das Profil der Bewerberin oder des Bewerbers ist bereit.", no: "Das Profil ist noch nicht bereit." },
      assistantWelcomed: { label: "Assistent hat begrüßt", yes: "Der Assistent hat die Person bereits begrüßt.", no: "Der Assistent hat die Person noch nicht begrüßt." },
    },
  },
  fr: {
    title: "Équipe",
    intro: "L’état de l’équipe sur le VPS, lu à l’instant avec une commande en lecture seule. La consultation est en lecture seule : les actions sur les données restent désactivées ; le démarrage de l’assistant est distinct et demande une confirmation.",
    introFullLink: "L’état de l’équipe sur le VPS, lu à l’instant avec une commande en lecture seule. Les actions sur l’équipe sont dans la page Agents et dans celles des offres.",
    summaryOff: "L’équipe est éteinte : son conteneur est arrêté, donc aucun agent ne travaille. Les lignes ci-dessous disent ce que la VPS rapporte.",
    yes: "Oui",
    no: "Non",
    refresh: "Actualiser",
    refreshing: "Lecture en cours…",
    unknown: "État pas encore lu : rien n’est affiché tant qu’une lecture n’a pas réussi.",
    readAt: "Lu à {time}",
    staleWhileReading: "Valeurs de la lecture de {time}, mise à jour en cours",
    failed: "La lecture a échoué",
    failedAt: "Dernière tentative à {time}. Aucune valeur antérieure n’est présentée comme actuelle.",
    actionsAssistantOff: "À la connexion de {time}, l’assistant n’était pas actif : les actions sont désactivées, et cette connexion est de toute façon en lecture seule.",
    actionsReadOnly: "À la connexion de {time}, l’assistant était actif, mais cette connexion est en lecture seule : les actions restent désactivées.",
    actionsFullLink: "Cette équipe est connectée en plein : les actions sont dans la page Agents (démarrage, arrêt, chat) et dans celles des offres (avis) ; cette page n’affiche que l’état.",
    atConnection: "Valeur de la connexion de {time}, non relue par cette mise à jour.",
    noConnectionValue: "La connexion n’a donné aucune valeur pour cette ligne ; cette mise à jour ne la lit pas.",
    atAssistantStart: "Valeur de la vérification après le démarrage de l’assistant, à {time}, non relue par cette mise à jour.",
    actionsAfterStart: "L’assistant a été démarré et vérifié à {time}, mais cette connexion est en lecture seule : les actions restent désactivées.",
    fields: {
      runtimeInstalled: { label: "Runtime installé", yes: "Le runtime de l’équipe est installé sur le VPS.", no: "Le runtime de l’équipe n’est pas installé sur le VPS." },
      containerRunning: { label: "Conteneur actif", yes: "Le conteneur de l’équipe est actif.", no: "Le conteneur de l’équipe est arrêté : l’équipe ne travaille pas." },
      providerConfigured: { label: "Fournisseur configuré", yes: "Un fournisseur d’IA est configuré.", no: "Aucun fournisseur d’IA n’est configuré : les agents ne peuvent pas travailler." },
      providerAuthenticated: { label: "Fournisseur connecté", yes: "Le fournisseur a un accès valide.", no: "Le fournisseur n’a pas d’accès valide : les agents ne peuvent pas l’utiliser." },
      captainRunning: { label: "Capitaine actif", yes: "Le capitaine est actif.", no: "Le capitaine n’est pas actif." },
      assistantRunning: { label: "Assistant actif", yes: "L’assistant est actif.", no: "L’assistant n’est pas actif : le chat est indisponible et les actions qui demandent quelque chose à l’équipe restent désactivées." },
      profileReady: { label: "Profil prêt", yes: "Le profil du candidat est prêt.", no: "Le profil du candidat n’est pas encore prêt." },
      assistantWelcomed: { label: "Assistant a accueilli l’utilisateur", yes: "L’assistant a déjà accueilli l’utilisateur.", no: "L’assistant n’a pas encore accueilli l’utilisateur." },
    },
  },
  es: {
    title: "Equipo",
    intro: "El estado del equipo en el VPS, leído ahora con un comando de solo lectura. La consulta es de solo lectura: las acciones sobre los datos siguen desactivadas; el inicio del asistente es aparte y pide una confirmación.",
    introFullLink: "El estado del equipo en el VPS, leído ahora con un comando de solo lectura. Las acciones sobre el equipo están en la página Agentes y en las de las ofertas.",
    summaryOff: "El equipo está apagado: su contenedor está detenido, así que ningún agente trabaja. Las filas de abajo dicen lo que informa la VPS.",
    yes: "Sí",
    no: "No",
    refresh: "Actualizar",
    refreshing: "Leyendo…",
    unknown: "Estado aún sin leer: no se muestra nada hasta que una lectura tenga éxito.",
    readAt: "Leído a las {time}",
    staleWhileReading: "Valores de la lectura de las {time}, actualizando",
    failed: "La lectura no ha tenido éxito",
    failedAt: "Último intento a las {time}. Ningún valor anterior se muestra como actual.",
    actionsAssistantOff: "En la conexión de las {time} el asistente no estaba activo: las acciones están desactivadas, y esta conexión es de solo lectura de todos modos.",
    actionsReadOnly: "En la conexión de las {time} el asistente estaba activo, pero esta conexión es de solo lectura: las acciones siguen desactivadas.",
    actionsFullLink: "Este equipo está conectado por completo: las acciones están en la página Agentes (arranque, parada, chat) y en las de las ofertas (valoraciones); esta página solo muestra el estado.",
    atConnection: "Valor de la conexión de las {time}, no releído por esta actualización.",
    noConnectionValue: "La conexión no dio ningún valor para esta fila; esta actualización no lo lee.",
    atAssistantStart: "Valor de la comprobación tras el arranque del asistente, a las {time}, no releído por esta actualización.",
    actionsAfterStart: "El asistente se arrancó y comprobó a las {time}, pero esta conexión es de solo lectura: las acciones siguen desactivadas.",
    fields: {
      runtimeInstalled: { label: "Runtime instalado", yes: "El runtime del equipo está instalado en el VPS.", no: "El runtime del equipo no está instalado en el VPS." },
      containerRunning: { label: "Contenedor en marcha", yes: "El contenedor del equipo está en marcha.", no: "El contenedor del equipo está parado: el equipo no trabaja." },
      providerConfigured: { label: "Proveedor configurado", yes: "Hay un proveedor de IA configurado.", no: "No hay ningún proveedor de IA configurado: los agentes no pueden trabajar." },
      providerAuthenticated: { label: "Proveedor con acceso", yes: "El proveedor tiene un acceso válido.", no: "El proveedor no tiene un acceso válido: los agentes no pueden usarlo." },
      captainRunning: { label: "Capitán activo", yes: "El capitán está activo.", no: "El capitán no está activo." },
      assistantRunning: { label: "Asistente activo", yes: "El asistente está activo.", no: "El asistente no está activo: el chat no está disponible y las acciones que piden algo al equipo siguen desactivadas." },
      profileReady: { label: "Perfil listo", yes: "El perfil del candidato está listo.", no: "El perfil del candidato aún no está listo." },
      assistantWelcomed: { label: "Asistente dio la bienvenida", yes: "El asistente ya ha dado la bienvenida al usuario.", no: "El asistente aún no ha dado la bienvenida al usuario." },
    },
  },
  pt: {
    title: "Equipa",
    intro: "O estado da equipa no VPS, lido agora com um comando só de leitura. A consulta é só de leitura: as ações sobre os dados continuam desativadas; o arranque do assistente é separado e pede uma confirmação.",
    introFullLink: "O estado da equipa no VPS, lido agora com um comando só de leitura. As ações sobre a equipa estão na página Agentes e nas das ofertas.",
    summaryOff: "A equipa está desligada: o contentor está parado, por isso nenhum agente trabalha. As linhas abaixo dizem o que a VPS reporta.",
    yes: "Sim",
    no: "Não",
    refresh: "Atualizar",
    refreshing: "A ler…",
    unknown: "Estado ainda não lido: não se mostra nada até uma leitura ter êxito.",
    readAt: "Lido às {time}",
    staleWhileReading: "Valores da leitura das {time}, a atualizar",
    failed: "A leitura não teve êxito",
    failedAt: "Última tentativa às {time}. Nenhum valor anterior é mostrado como atual.",
    actionsAssistantOff: "Na ligação das {time} o assistente não estava ativo: as ações estão desativadas, e esta ligação é só de leitura de qualquer forma.",
    actionsReadOnly: "Na ligação das {time} o assistente estava ativo, mas esta ligação é só de leitura: as ações continuam desativadas.",
    actionsFullLink: "Esta equipa está ligada por completo: as ações estão na página Agentes (arranque, paragem, chat) e nas das ofertas (avaliações); esta página só mostra o estado.",
    atConnection: "Valor da ligação das {time}, não relido por esta atualização.",
    noConnectionValue: "A ligação não deu nenhum valor para esta linha; esta atualização não o lê.",
    atAssistantStart: "Valor da verificação após o arranque do assistente, às {time}, não relido por esta atualização.",
    actionsAfterStart: "O assistente foi arrancado e verificado às {time}, mas esta ligação é só de leitura: as ações continuam desativadas.",
    fields: {
      runtimeInstalled: { label: "Runtime instalado", yes: "O runtime da equipa está instalado no VPS.", no: "O runtime da equipa não está instalado no VPS." },
      containerRunning: { label: "Contentor ligado", yes: "O contentor da equipa está ligado.", no: "O contentor da equipa está parado: a equipa não trabalha." },
      providerConfigured: { label: "Fornecedor configurado", yes: "Há um fornecedor de IA configurado.", no: "Nenhum fornecedor de IA está configurado: os agentes não podem trabalhar." },
      providerAuthenticated: { label: "Fornecedor com acesso", yes: "O fornecedor tem um acesso válido.", no: "O fornecedor não tem um acesso válido: os agentes não o podem usar." },
      captainRunning: { label: "Capitão ativo", yes: "O capitão está ativo.", no: "O capitão não está ativo." },
      assistantRunning: { label: "Assistente ativo", yes: "O assistente está ativo.", no: "O assistente não está ativo: o chat não está disponível e as ações que pedem algo à equipa continuam desativadas." },
      profileReady: { label: "Perfil pronto", yes: "O perfil do candidato está pronto.", no: "O perfil do candidato ainda não está pronto." },
      assistantWelcomed: { label: "Assistente deu as boas-vindas", yes: "O assistente já deu as boas-vindas ao utilizador.", no: "O assistente ainda não deu as boas-vindas ao utilizador." },
    },
  },
  hu: {
    title: "Csapat",
    intro: "A csapat állapota a VPS-en, az imént csak olvasható paranccsal beolvasva. A megtekintés csak olvasható: az adatokon végzett műveletek le vannak tiltva; az asszisztens indítása külön dolog, és megerősítést kér.",
    introFullLink: "A csapat állapota a VPS-en, az imént csak olvasható paranccsal beolvasva. A csapaton végzett műveletek az Ügynökök oldalon és az állások oldalain találhatók.",
    summaryOff: "A csapat ki van kapcsolva: a konténere leállt, ezért egy ügynök sem dolgozik. Az alábbi sorok azt mutatják, amit a VPS jelent.",
    yes: "Igen",
    no: "Nem",
    refresh: "Frissítés",
    refreshing: "Olvasás…",
    unknown: "Az állapot még nincs beolvasva: amíg egy olvasás nem sikerül, semmi sem látszik.",
    readAt: "Beolvasva: {time}",
    staleWhileReading: "A {time}-i olvasás értékei, frissítés folyamatban",
    failed: "Az olvasás nem sikerült",
    failedAt: "Utolsó kísérlet: {time}. Korábbi érték nem jelenik meg aktuálisként.",
    actionsAssistantOff: "A {time}-i kapcsolódáskor az asszisztens nem futott: a műveletek le vannak tiltva, és ez a kapcsolat amúgy is csak olvasható.",
    actionsReadOnly: "A {time}-i kapcsolódáskor az asszisztens futott, de ez a kapcsolat csak olvasható: a műveletek le maradnak tiltva.",
    actionsFullLink: "Ez a csapat teljes körűen csatlakoztatva van: a műveletek az Ügynökök oldalon (indítás, leállítás, csevegés) és az állások oldalain (értékelések) vannak; ez az oldal csak az állapotot mutatja.",
    atConnection: "A {time}-i kapcsolódás értéke, ez a frissítés nem olvasta újra.",
    noConnectionValue: "A kapcsolódás nem adott értéket ehhez a sorhoz; ez a frissítés nem olvassa.",
    atAssistantStart: "Az asszisztens indítása utáni ellenőrzés értéke, {time}, ez a frissítés nem olvasta újra.",
    actionsAfterStart: "Az asszisztenst {time}-kor elindítottuk és ellenőriztük, de ez a kapcsolat csak olvasható: a műveletek le maradnak tiltva.",
    fields: {
      runtimeInstalled: { label: "Futtatókörnyezet telepítve", yes: "A csapat futtatókörnyezete telepítve van a VPS-en.", no: "A csapat futtatókörnyezete nincs telepítve a VPS-en." },
      containerRunning: { label: "Konténer fut", yes: "A csapat konténere fut.", no: "A csapat konténere áll: a csapat nem dolgozik." },
      providerConfigured: { label: "Szolgáltató beállítva", yes: "Be van állítva egy MI-szolgáltató.", no: "Nincs beállítva MI-szolgáltató: az ügynökök nem tudnak dolgozni." },
      providerAuthenticated: { label: "Szolgáltató bejelentkezve", yes: "A szolgáltatónak érvényes hozzáférése van.", no: "A szolgáltatónak nincs érvényes hozzáférése: az ügynökök nem tudják használni." },
      captainRunning: { label: "Kapitány aktív", yes: "A kapitány aktív.", no: "A kapitány nem aktív." },
      assistantRunning: { label: "Asszisztens aktív", yes: "Az asszisztens aktív.", no: "Az asszisztens nem aktív: a csevegés nem érhető el, és a csapattól kérő műveletek le maradnak tiltva." },
      profileReady: { label: "Profil kész", yes: "A jelölt profilja kész.", no: "A jelölt profilja még nem kész." },
      assistantWelcomed: { label: "Az asszisztens üdvözölte a felhasználót", yes: "Az asszisztens már üdvözölte a felhasználót.", no: "Az asszisztens még nem üdvözölte a felhasználót." },
    },
  },
};
