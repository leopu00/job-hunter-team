import type { Locale } from "@/i18n/config";
import type { TeamStatusField } from "../../lib/existing-team-status";

export interface FieldText {
  label: string;
  yes: string;
  no: string;
}

export interface ExistingTeamStatusText {
  title: string;
  intro: string;
  yes: string;
  no: string;
  refresh: string;
  refreshing: string;
  unknown: string;
  readAt: string; // {time}
  staleWhileReading: string; // {time}
  failed: string;
  failedAt: string; // {time}
  actionsAssistantOff: string;
  actionsReadOnly: string;
  fields: Record<TeamStatusField, FieldText>;
}

export const EXISTING_TEAM_STATUS_TEXT: Record<Locale, ExistingTeamStatusText> = {
  it: {
    title: "Squadra",
    intro: "Lo stato della squadra sulla VPS, letto adesso con un comando di sola lettura. Da qui non parte nessuna azione.",
    yes: "Sì",
    no: "No",
    refresh: "Aggiorna",
    refreshing: "Lettura in corso…",
    unknown: "Stato non ancora letto: nessun dato è mostrato finché la lettura non riesce.",
    readAt: "Letto alle {time}",
    staleWhileReading: "Valori della lettura delle {time}, aggiornamento in corso",
    failed: "Lettura non riuscita",
    failedAt: "Ultimo tentativo alle {time}. Nessun valore precedente viene mostrato come attuale.",
    actionsAssistantOff: "Le azioni sono disabilitate perché l’assistente non è attivo, e questa connessione è comunque in sola lettura.",
    actionsReadOnly: "L’assistente è attivo, ma questa connessione è in sola lettura: le azioni restano disabilitate.",
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
    intro: "The team’s state on the VPS, read just now with a read-only command. No action starts from here.",
    yes: "Yes",
    no: "No",
    refresh: "Refresh",
    refreshing: "Reading…",
    unknown: "State not read yet: nothing is shown until a read succeeds.",
    readAt: "Read at {time}",
    staleWhileReading: "Values from the read at {time}, updating",
    failed: "The read did not succeed",
    failedAt: "Last attempt at {time}. No earlier value is shown as current.",
    actionsAssistantOff: "Actions are disabled because the assistant is not running, and this connection is read only anyway.",
    actionsReadOnly: "The assistant is running, but this connection is read only: actions stay disabled.",
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
    intro: "Der Zustand des Teams auf dem VPS, soeben mit einem Lesebefehl gelesen. Von hier startet keine Aktion.",
    yes: "Ja",
    no: "Nein",
    refresh: "Aktualisieren",
    refreshing: "Wird gelesen …",
    unknown: "Zustand noch nicht gelesen: Es wird nichts angezeigt, bis ein Lesen gelingt.",
    readAt: "Gelesen um {time}",
    staleWhileReading: "Werte vom Lesen um {time}, Aktualisierung läuft",
    failed: "Lesen fehlgeschlagen",
    failedAt: "Letzter Versuch um {time}. Frühere Werte werden nicht als aktuell angezeigt.",
    actionsAssistantOff: "Aktionen sind deaktiviert, weil der Assistent nicht läuft; diese Verbindung ist ohnehin schreibgeschützt.",
    actionsReadOnly: "Der Assistent läuft, aber diese Verbindung ist schreibgeschützt: Aktionen bleiben deaktiviert.",
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
    intro: "L’état de l’équipe sur le VPS, lu à l’instant avec une commande en lecture seule. Aucune action ne part d’ici.",
    yes: "Oui",
    no: "Non",
    refresh: "Actualiser",
    refreshing: "Lecture en cours…",
    unknown: "État pas encore lu : rien n’est affiché tant qu’une lecture n’a pas réussi.",
    readAt: "Lu à {time}",
    staleWhileReading: "Valeurs de la lecture de {time}, mise à jour en cours",
    failed: "La lecture a échoué",
    failedAt: "Dernière tentative à {time}. Aucune valeur antérieure n’est présentée comme actuelle.",
    actionsAssistantOff: "Les actions sont désactivées parce que l’assistant n’est pas actif, et cette connexion est de toute façon en lecture seule.",
    actionsReadOnly: "L’assistant est actif, mais cette connexion est en lecture seule : les actions restent désactivées.",
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
    intro: "El estado del equipo en el VPS, leído ahora con un comando de solo lectura. Desde aquí no se inicia ninguna acción.",
    yes: "Sí",
    no: "No",
    refresh: "Actualizar",
    refreshing: "Leyendo…",
    unknown: "Estado aún sin leer: no se muestra nada hasta que una lectura tenga éxito.",
    readAt: "Leído a las {time}",
    staleWhileReading: "Valores de la lectura de las {time}, actualizando",
    failed: "La lectura no ha tenido éxito",
    failedAt: "Último intento a las {time}. Ningún valor anterior se muestra como actual.",
    actionsAssistantOff: "Las acciones están desactivadas porque el asistente no está activo, y esta conexión es de solo lectura de todos modos.",
    actionsReadOnly: "El asistente está activo, pero esta conexión es de solo lectura: las acciones siguen desactivadas.",
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
    intro: "O estado da equipa no VPS, lido agora com um comando só de leitura. Daqui não parte nenhuma ação.",
    yes: "Sim",
    no: "Não",
    refresh: "Atualizar",
    refreshing: "A ler…",
    unknown: "Estado ainda não lido: não se mostra nada até uma leitura ter êxito.",
    readAt: "Lido às {time}",
    staleWhileReading: "Valores da leitura das {time}, a atualizar",
    failed: "A leitura não teve êxito",
    failedAt: "Última tentativa às {time}. Nenhum valor anterior é mostrado como atual.",
    actionsAssistantOff: "As ações estão desativadas porque o assistente não está ativo, e esta ligação é só de leitura de qualquer forma.",
    actionsReadOnly: "O assistente está ativo, mas esta ligação é só de leitura: as ações continuam desativadas.",
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
    intro: "A csapat állapota a VPS-en, az imént csak olvasható paranccsal beolvasva. Innen nem indul semmilyen művelet.",
    yes: "Igen",
    no: "Nem",
    refresh: "Frissítés",
    refreshing: "Olvasás…",
    unknown: "Az állapot még nincs beolvasva: amíg egy olvasás nem sikerül, semmi sem látszik.",
    readAt: "Beolvasva: {time}",
    staleWhileReading: "A {time}-i olvasás értékei, frissítés folyamatban",
    failed: "Az olvasás nem sikerült",
    failedAt: "Utolsó kísérlet: {time}. Korábbi érték nem jelenik meg aktuálisként.",
    actionsAssistantOff: "A műveletek le vannak tiltva, mert az asszisztens nem fut, és ez a kapcsolat amúgy is csak olvasható.",
    actionsReadOnly: "Az asszisztens fut, de ez a kapcsolat csak olvasható: a műveletek le maradnak tiltva.",
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
