import type { Locale } from "@/i18n/config";

/**
 * The direct chat's own words: the agent list, the status bar, the transcript
 * and the composer. 7 languages; Italian is the source and its shape is the
 * type. The role names are the ones the onboarding gives the same agents
 * (onboarding/onboarding.i18n.ts). `{name}` is the chosen agent's name.
 */
export interface DirectChatText {
  agents: Record<"capitano" | "assistente" | "mentor" | "scout" | "analista" | "scorer" | "scrittore" | "critico", string>;
  agentsHeading: string;
  agentsNavAria: string;
  agentSelect: string;
  title: string;
  conversationWith: string; // {name}
  messagesWith: string; // {name}
  connecting: string;
  connected: string;
  disconnected: string;
  unavailable: string;
  operationFailed: string;
  reconnecting: string;
  retry: string;
  loadingConversation: string;
  empty: string;
  you: string;
  system: string;
  writeTo: string; // {name}
  writeToPlaceholder: string; // {name}
  connectToWrite: string;
  sending: string;
  send: string;
}

export const DIRECT_CHAT_TEXT: Record<Locale, DirectChatText> = {
  it: {
    agents: { capitano: "Capitano", assistente: "Assistente", mentor: "Mentor", scout: "Scout", analista: "Analista", scorer: "Scorer", scrittore: "Scrittore", critico: "Critico" },
    agentsHeading: "Agenti",
    agentsNavAria: "Chat agenti",
    agentSelect: "Agente",
    title: "Chat diretta",
    conversationWith: "Conversazione con {name}",
    messagesWith: "Messaggi con {name}",
    connecting: "Connessione sicura al team…",
    connected: "Team collegato",
    disconnected: "Team non collegato.",
    unavailable: "Team non disponibile.",
    operationFailed: "Operazione non riuscita.",
    reconnecting: "Connessione…",
    retry: "Riprova",
    loadingConversation: "Carico la conversazione…",
    empty: "Nessun messaggio. Puoi iniziare tu.",
    you: "Tu",
    system: "Sistema",
    writeTo: "Scrivi a {name}",
    writeToPlaceholder: "Scrivi a {name}…",
    connectToWrite: "Collega il team per scrivere",
    sending: "Invio…",
    send: "Invia",
  },
  en: {
    agents: { capitano: "Captain", assistente: "Assistant", mentor: "Mentor", scout: "Scout", analista: "Analyst", scorer: "Scorer", scrittore: "Writer", critico: "Critic" },
    agentsHeading: "Agents",
    agentsNavAria: "Agent chats",
    agentSelect: "Agent",
    title: "Direct chat",
    conversationWith: "Conversation with {name}",
    messagesWith: "Messages with {name}",
    connecting: "Securely connecting to the team…",
    connected: "Team connected",
    disconnected: "Team not connected.",
    unavailable: "Team unavailable.",
    operationFailed: "Operation failed.",
    reconnecting: "Connecting…",
    retry: "Retry",
    loadingConversation: "Loading the conversation…",
    empty: "No messages yet. You can start.",
    you: "You",
    system: "System",
    writeTo: "Write to {name}",
    writeToPlaceholder: "Write to {name}…",
    connectToWrite: "Connect the team to write",
    sending: "Sending…",
    send: "Send",
  },
  de: {
    agents: { capitano: "Kapitän", assistente: "Assistent", mentor: "Mentor", scout: "Scout", analista: "Analyst", scorer: "Scorer", scrittore: "Schreiber", critico: "Kritiker" },
    agentsHeading: "Agenten",
    agentsNavAria: "Agenten-Chats",
    agentSelect: "Agent",
    title: "Direktchat",
    conversationWith: "Unterhaltung mit {name}",
    messagesWith: "Nachrichten mit {name}",
    connecting: "Sichere Verbindung zum Team…",
    connected: "Team verbunden",
    disconnected: "Team nicht verbunden.",
    unavailable: "Team nicht erreichbar.",
    operationFailed: "Vorgang fehlgeschlagen.",
    reconnecting: "Verbinde…",
    retry: "Erneut versuchen",
    loadingConversation: "Unterhaltung wird geladen…",
    empty: "Noch keine Nachrichten. Du kannst anfangen.",
    you: "Du",
    system: "System",
    writeTo: "Schreibe an {name}",
    writeToPlaceholder: "Schreibe an {name}…",
    connectToWrite: "Verbinde das Team, um zu schreiben",
    sending: "Senden…",
    send: "Senden",
  },
  fr: {
    agents: { capitano: "Capitaine", assistente: "Assistant", mentor: "Mentor", scout: "Scout", analista: "Analyste", scorer: "Scorer", scrittore: "Rédacteur", critico: "Critique" },
    agentsHeading: "Agents",
    agentsNavAria: "Discussions avec les agents",
    agentSelect: "Agent",
    title: "Discussion directe",
    conversationWith: "Conversation avec {name}",
    messagesWith: "Messages avec {name}",
    connecting: "Connexion sécurisée à l’équipe…",
    connected: "Équipe connectée",
    disconnected: "Équipe non connectée.",
    unavailable: "Équipe indisponible.",
    operationFailed: "L’opération a échoué.",
    reconnecting: "Connexion…",
    retry: "Réessayer",
    loadingConversation: "Chargement de la conversation…",
    empty: "Aucun message. Tu peux commencer.",
    you: "Toi",
    system: "Système",
    writeTo: "Écrire à {name}",
    writeToPlaceholder: "Écrire à {name}…",
    connectToWrite: "Connecte l’équipe pour écrire",
    sending: "Envoi…",
    send: "Envoyer",
  },
  es: {
    agents: { capitano: "Capitán", assistente: "Asistente", mentor: "Mentor", scout: "Scout", analista: "Analista", scorer: "Scorer", scrittore: "Redactor", critico: "Crítico" },
    agentsHeading: "Agentes",
    agentsNavAria: "Chats con agentes",
    agentSelect: "Agente",
    title: "Chat directo",
    conversationWith: "Conversación con {name}",
    messagesWith: "Mensajes con {name}",
    connecting: "Conexión segura con el equipo…",
    connected: "Equipo conectado",
    disconnected: "Equipo no conectado.",
    unavailable: "Equipo no disponible.",
    operationFailed: "La operación ha fallado.",
    reconnecting: "Conectando…",
    retry: "Reintentar",
    loadingConversation: "Cargando la conversación…",
    empty: "Ningún mensaje. Puedes empezar tú.",
    you: "Tú",
    system: "Sistema",
    writeTo: "Escribe a {name}",
    writeToPlaceholder: "Escribe a {name}…",
    connectToWrite: "Conecta el equipo para escribir",
    sending: "Enviando…",
    send: "Enviar",
  },
  pt: {
    agents: { capitano: "Capitão", assistente: "Assistente", mentor: "Mentor", scout: "Scout", analista: "Analista", scorer: "Scorer", scrittore: "Redator", critico: "Crítico" },
    agentsHeading: "Agentes",
    agentsNavAria: "Conversas com agentes",
    agentSelect: "Agente",
    title: "Conversa direta",
    conversationWith: "Conversa com {name}",
    messagesWith: "Mensagens com {name}",
    connecting: "Ligação segura à equipa…",
    connected: "Equipa ligada",
    disconnected: "Equipa não ligada.",
    unavailable: "Equipa indisponível.",
    operationFailed: "A operação falhou.",
    reconnecting: "A ligar…",
    retry: "Tentar de novo",
    loadingConversation: "A carregar a conversa…",
    empty: "Nenhuma mensagem. Podes começar tu.",
    you: "Tu",
    system: "Sistema",
    writeTo: "Escreve a {name}",
    writeToPlaceholder: "Escreve a {name}…",
    connectToWrite: "Liga a equipa para escrever",
    sending: "A enviar…",
    send: "Enviar",
  },
  hu: {
    agents: { capitano: "Kapitány", assistente: "Asszisztens", mentor: "Mentor", scout: "Felderítő", analista: "Elemző", scorer: "Pontozó", scrittore: "Író", critico: "Kritikus" },
    agentsHeading: "Ügynökök",
    agentsNavAria: "Ügynökök csevegései",
    agentSelect: "Ügynök",
    title: "Közvetlen csevegés",
    conversationWith: "Beszélgetés: {name}",
    messagesWith: "Üzenetek: {name}",
    connecting: "Biztonságos kapcsolódás a csapathoz…",
    connected: "Csapat csatlakoztatva",
    disconnected: "A csapat nincs csatlakoztatva.",
    unavailable: "A csapat nem érhető el.",
    operationFailed: "A művelet nem sikerült.",
    reconnecting: "Kapcsolódás…",
    retry: "Újra",
    loadingConversation: "Beszélgetés betöltése…",
    empty: "Még nincs üzenet. Kezdheted te.",
    you: "Te",
    system: "Rendszer",
    writeTo: "Írj neki: {name}",
    writeToPlaceholder: "Írj neki: {name}…",
    connectToWrite: "Csatlakoztasd a csapatot az íráshoz",
    sending: "Küldés…",
    send: "Küldés",
  },
};

export function directChatText(locale: Locale) {
  return DIRECT_CHAT_TEXT[locale];
}

/** Fills the `{name}` of a sentence. */
export function withName(sentence: string, name: string): string {
  return sentence.replace("{name}", name);
}

/** The speech-recognition language the dictation listens in, per interface language. */
export const DICTATION_LOCALE: Record<Locale, string> = {
  it: "it-IT",
  en: "en-US",
  de: "de-DE",
  fr: "fr-FR",
  es: "es-ES",
  pt: "pt-PT",
  hu: "hu-HU",
};
