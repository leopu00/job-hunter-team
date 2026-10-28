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
  /** The button of the chat in the Agents page: the same chat with the same agent, on the whole page. */
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
  /** The read-only view: history and answers are shown, writing needs the full connection. */
  readOnlyInvite: string;
  /** The button under the invitation: it leaves the read-only view, towards «Conferma e collega». */
  readOnlyConnect: string;
  /** The connection to the team is taking too long: said once, with the retry. */
  connectingSlow: string;
  sending: string;
  send: string;
  /** Over the composer: where the text goes. The chat, never the keys of the agent's terminal. */
  destination: string; // {name}
  /** Under a message of the person's: the agent's CLI took it (seen in its composer, then sent). */
  /** Under a message of the person's the team sent: «sent», never «taken», until the delivery proves it. */
  sent: string;
  /** Under a message of the person's that waits in the agent's mailbox: sent, not yet taken. */
  queued: string;
  /** While the agent works on a turn of the person's: a line with moving dots at the end of the chat. */
  working: string; // {name}
  /** Under a message of the person's that waited too long for its agent and was never typed. */
  queueExpired: string;
  /** What a system line with a closed code says, by code (the backend's English text is the fallback). */
  codes: Record<string, string>;
  keysHint: string;
  /** The label of each kind of message, on every message of the agent and on its questions. */
  kinds: Record<"urgent" | "blocked" | "question" | "completed" | "info", string>;
  answerSend: string;
  /** Under an answered question: the agent's tool picked the answer up (not yet that the agent acted on it). */
  answerSeen: string;
  /** Under an answered question the agent's tool has not picked up yet. */
  answerWaiting: string;
  /** A question nobody answered in time: its safe option was taken. */
  answerExpired: string;
  /** Under a message of the person's still in the agent's composer: pasted, Enter did not take it. */
  notSent: string;
  /** The button beside it: presses Enter once more, never pastes the text again. */
  sendEnterAgain: string;
  /** Under a message of the person's when nobody can say whether the agent took it. */
  takenUnknown: string;
  /** Beside «not known», why: by the team's closed code; a code outside the list says nothing. */
  takenReasons: Record<"menu" | "permission" | "login" | "busy" | "not_ours" | "empty_unseen" | "unreadable" | "unconfirmed", string>;
  /** Why an answer did not go, by the code the team gives; `answer_failed` for any other. */
  answerErrors: Record<"question_closed" | "invalid_choice" | "not_found" | "answer_failed", string>;
  /** The group of replies the agent suggests under a message: a click sends one. */
  suggestionsLabel: string;
  /** The separators between the days of the conversation. */
  today: string;
  yesterday: string;
  /** The item of the right-click menu on a message or a question. */
  replyAction: string;
  /** Over the composer, before the excerpt of the message the person replies to. */
  replyingTo: string;
  /** The same, when what is written is the answer to an open question. */
  replyingToQuestion: string;
  /** The × beside it: back to a normal message. */
  replyClear: string;
  /** Opens the quote put before a reply: `↩ <this>: "excerpt"`. The agent reads it. */
  quotePrefix: string;
  /** Under a question that takes words: puts it over the composer, where the words are written. */
  answerInWords: string;
  /** After an answer from the composer was refused: the words stay in the box. */
  answerTextKept: string;
  /** The round button that brings the conversation back to its latest line. */
  jumpToLatest: string;
  /** The same, with new lines that came while the person read above; `{count}` is their number. */
  jumpToNew: string;
  /** Said before sending, when the answer is not one the team would take. */
  answerInvalid: Record<"choice_unknown" | "single_choice_only" | "free_text_not_allowed" | "empty_answer" | "text_too_long", string>;
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
    readOnlyInvite: "Vista in sola lettura: vedi lo storico e le risposte. Per scrivere collega il team con «Conferma e collega».",
    readOnlyConnect: "Collega in scrittura",
    connectingSlow: "La connessione al team non risponde: la chat non può né mostrare lo storico né inviare. Riprova.",
    sending: "Invio…",
    send: "Invia",
    destination: "Destinazione: la chat di {name}. Il testo gli arriva come messaggio, non come tasti nel suo terminale.",
    sent: "Inviato",
    queued: "In coda",
    working: "{name} sta lavorando…",
    queueExpired: "Non inviato: l'agente è rimasto occupato troppo a lungo. Riscrivilo.",
    codes: { mail_not_taken: "L'agente non ha ancora preso il messaggio.", message_too_long: "Un messaggio dell'agente era troppo lungo per essere mostrato qui." },
    keysHint: "Invio manda · Ctrl+Invio va a capo",
    kinds: { urgent: "urgente", blocked: "bloccato", question: "domanda", completed: "completato", info: "comunicazione" },
    answerSend: "Rispondi",
    answerSeen: "Presa dallo strumento dell'agente",
    answerWaiting: "Inviata: lo strumento dell'agente non l'ha ancora presa",
    answerExpired: "Scaduta: è stata presa la risposta di riserva",
    notSent: "Incollato ma non inviato",
    sendEnterAgain: "Invia di nuovo (Invio)",
    takenUnknown: "Non so se è stato preso",
    takenReasons: { menu: "c'è un menu aperto", permission: "c'è una domanda di permesso", login: "c'è un accesso da fare", busy: "l'agente stava lavorando", not_ours: "nella casella c'è un altro testo", empty_unseen: "il testo non si è mai visto nella casella", unreadable: "lo schermo non si legge", unconfirmed: "il testo è uscito dalla casella, ma senza prova che l'abbia preso: guarda il suo terminale prima di riscrivere" },
    answerErrors: { question_closed: "A questa domanda è già stata data una risposta.", invalid_choice: "Questa scelta non è fra quelle della domanda.", not_found: "L'agente non ha più questa domanda.", answer_failed: "Risposta non inviata: riprova." },
    suggestionsLabel: "Risposte suggerite dall'agente",
    today: "oggi",
    yesterday: "ieri",
    replyAction: "↩ Rispondi",
    replyingTo: "rispondi a:",
    replyingToQuestion: "rispondi alla domanda:",
    replyClear: "Scrivi un messaggio normale",
    quotePrefix: "in risposta a",
    answerInWords: "Rispondi a parole",
    answerTextKept: "Il testo è ancora nella casella.",
    jumpToLatest: "Vai all'ultimo messaggio",
    jumpToNew: "{count} nuovi: vai all'ultimo",
    answerInvalid: { choice_unknown: "Questa scelta non è fra quelle della domanda.", single_choice_only: "Qui si sceglie una voce sola.", free_text_not_allowed: "Questa domanda non accetta risposte scritte: scegli una voce.", empty_answer: "Scegli una voce o scrivi la risposta.", text_too_long: "La risposta è troppo lunga: al massimo 1000 caratteri." },
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
    readOnlyInvite: "Read-only view: you can see the history and the replies. To write, connect the team with “Confirm and connect”.",
    readOnlyConnect: "Connect with write access",
    connectingSlow: "The connection to the team is not answering: the chat can neither show its history nor send. Try again.",
    sending: "Sending…",
    send: "Send",
    destination: "Goes to: the chat with {name}. The text reaches it as a message, not as keys in its terminal.",
    sent: "Sent",
    queued: "Queued",
    working: "{name} is working…",
    queueExpired: "Not sent: the agent stayed busy for too long. Write it again.",
    codes: { mail_not_taken: "The agent has not taken your message yet.", message_too_long: "A message from the agent was too long to be shown here." },
    keysHint: "Enter sends · Ctrl+Enter starts a new line",
    kinds: { urgent: "urgent", blocked: "blocked", question: "question", completed: "done", info: "update" },
    answerSend: "Answer",
    answerSeen: "Picked up by the agent's tool",
    answerWaiting: "Sent: the agent's tool has not picked it up yet",
    answerExpired: "Expired: the fallback answer was taken",
    notSent: "Pasted but not sent",
    sendEnterAgain: "Send again (Enter)",
    takenUnknown: "Not known whether it was taken",
    takenReasons: { menu: "a menu is open", permission: "a permission question is open", login: "a sign-in is waiting", busy: "the agent was working", not_ours: "another text is in its input box", empty_unseen: "the text never showed in its input box", unreadable: "the screen cannot be read", unconfirmed: "the text left its input box, but with no proof it was taken: look at its terminal before writing again" },
    answerErrors: { question_closed: "This question already has an answer.", invalid_choice: "This choice is not one of the question's.", not_found: "The agent no longer has this question.", answer_failed: "Answer not sent: try again." },
    suggestionsLabel: "Replies the agent suggests",
    today: "today",
    yesterday: "yesterday",
    replyAction: "↩ Reply",
    replyingTo: "reply to:",
    replyingToQuestion: "answer the question:",
    replyClear: "Write a normal message",
    quotePrefix: "in reply to",
    answerInWords: "Answer in words",
    answerTextKept: "The text is still in the box.",
    jumpToLatest: "Go to the latest message",
    jumpToNew: "{count} new: go to the latest",
    answerInvalid: { choice_unknown: "This choice is not one of the question's.", single_choice_only: "Only one choice here.", free_text_not_allowed: "This question takes no written answer: pick a choice.", empty_answer: "Pick a choice or write the answer.", text_too_long: "The answer is too long: 1000 characters at most." },
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
    readOnlyInvite: "Schreibgeschützte Ansicht: Du siehst Verlauf und Antworten. Zum Schreiben verbinde das Team mit „Bestätigen und verbinden“.",
    readOnlyConnect: "Mit Schreibzugriff verbinden",
    connectingSlow: "Die Verbindung zum Team antwortet nicht: Der Chat kann weder den Verlauf zeigen noch senden. Versuche es erneut.",
    sending: "Senden…",
    send: "Senden",
    destination: "Ziel: der Chat mit {name}. Der Text kommt als Nachricht an, nicht als Tasten in seinem Terminal.",
    sent: "Gesendet",
    queued: "In der Warteschlange",
    working: "{name} arbeitet…",
    queueExpired: "Nicht gesendet: der Agent war zu lange beschäftigt. Schreib es noch einmal.",
    codes: { mail_not_taken: "Der Agent hat deine Nachricht noch nicht abgeholt.", message_too_long: "Eine Nachricht des Agenten war zu lang, um hier angezeigt zu werden." },
    keysHint: "Enter sendet · Strg+Enter für eine neue Zeile",
    kinds: { urgent: "dringend", blocked: "blockiert", question: "Frage", completed: "erledigt", info: "Mitteilung" },
    answerSend: "Antworten",
    answerSeen: "Vom Werkzeug des Agenten abgeholt",
    answerWaiting: "Gesendet: das Werkzeug des Agenten hat sie noch nicht abgeholt",
    answerExpired: "Abgelaufen: die Ersatzantwort wurde genommen",
    notSent: "Eingefügt, aber nicht gesendet",
    sendEnterAgain: "Erneut senden (Enter)",
    takenUnknown: "Unklar, ob die Nachricht angenommen wurde",
    takenReasons: { menu: "ein Menü ist offen", permission: "eine Berechtigungsfrage ist offen", login: "eine Anmeldung steht aus", busy: "der Agent hat gerade gearbeitet", not_ours: "im Eingabefeld steht ein anderer Text", empty_unseen: "der Text war im Eingabefeld nie zu sehen", unreadable: "der Bildschirm ist nicht lesbar", unconfirmed: "der Text hat das Eingabefeld verlassen, aber ohne Beweis, dass er angenommen wurde: schau in sein Terminal, bevor du erneut schreibst" },
    answerErrors: { question_closed: "Diese Frage wurde schon beantwortet.", invalid_choice: "Diese Wahl gehört nicht zu den Antworten der Frage.", not_found: "Der Agent hat diese Frage nicht mehr.", answer_failed: "Antwort nicht gesendet: versuche es erneut." },
    suggestionsLabel: "Vom Agenten vorgeschlagene Antworten",
    today: "heute",
    yesterday: "gestern",
    replyAction: "↩ Antworten",
    replyingTo: "Antwort auf:",
    replyingToQuestion: "Antwort auf die Frage:",
    replyClear: "Normale Nachricht schreiben",
    quotePrefix: "als Antwort auf",
    answerInWords: "Schriftlich antworten",
    answerTextKept: "Der Text steht noch im Eingabefeld.",
    jumpToLatest: "Zur neuesten Nachricht",
    jumpToNew: "{count} neu: zur neuesten",
    answerInvalid: { choice_unknown: "Diese Auswahl gehört nicht zur Frage.", single_choice_only: "Hier gibt es nur eine Auswahl.", free_text_not_allowed: "Diese Frage erlaubt keine freie Antwort: wähle eine Option.", empty_answer: "Wähle eine Option oder schreibe die Antwort.", text_too_long: "Die Antwort ist zu lang: höchstens 1000 Zeichen." },
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
    readOnlyInvite: "Vue en lecture seule : tu vois l’historique et les réponses. Pour écrire, relie l’équipe avec « Confirmer et relier ».",
    readOnlyConnect: "Connecter en écriture",
    connectingSlow: "La connexion à l’équipe ne répond pas : le chat ne peut ni afficher l’historique ni envoyer. Réessaie.",
    sending: "Envoi…",
    send: "Envoyer",
    destination: "Destination : la discussion avec {name}. Le texte lui arrive comme un message, pas comme des touches dans son terminal.",
    sent: "Envoyé",
    queued: "En attente",
    working: "{name} travaille…",
    queueExpired: "Non envoyé : l'agent est resté occupé trop longtemps. Réécris-le.",
    codes: { mail_not_taken: "L'agent n'a pas encore pris ton message.", message_too_long: "Un message de l'agent était trop long pour être affiché ici." },
    keysHint: "Entrée envoie · Ctrl+Entrée pour aller à la ligne",
    kinds: { urgent: "urgent", blocked: "bloqué", question: "question", completed: "terminé", info: "info" },
    answerSend: "Répondre",
    answerSeen: "Prise par l'outil de l'agent",
    answerWaiting: "Envoyée : l'outil de l'agent ne l'a pas encore prise",
    answerExpired: "Expirée : la réponse de repli a été prise",
    notSent: "Collé mais non envoyé",
    sendEnterAgain: "Renvoyer (Entrée)",
    takenUnknown: "On ne sait pas s'il a été pris",
    takenReasons: { menu: "un menu est ouvert", permission: "une demande d'autorisation est ouverte", login: "une connexion est en attente", busy: "l'agent était en train de travailler", not_ours: "un autre texte est dans sa zone de saisie", empty_unseen: "le texte n'est jamais apparu dans sa zone de saisie", unreadable: "l'écran est illisible", unconfirmed: "le texte a quitté sa zone de saisie, mais sans preuve qu'il a été pris : regarde son terminal avant de réécrire" },
    answerErrors: { question_closed: "Cette question a déjà une réponse.", invalid_choice: "Ce choix ne fait pas partie de ceux de la question.", not_found: "L'agent n'a plus cette question.", answer_failed: "Réponse non envoyée : réessaie." },
    suggestionsLabel: "Réponses proposées par l'agent",
    today: "aujourd'hui",
    yesterday: "hier",
    replyAction: "↩ Répondre",
    replyingTo: "répondre à :",
    replyingToQuestion: "répondre à la question :",
    replyClear: "Écrire un message normal",
    quotePrefix: "en réponse à",
    answerInWords: "Répondre par écrit",
    answerTextKept: "Le texte est toujours dans la zone de saisie.",
    jumpToLatest: "Aller au dernier message",
    jumpToNew: "{count} nouveaux : aller au dernier",
    answerInvalid: { choice_unknown: "Ce choix ne fait pas partie de la question.", single_choice_only: "Un seul choix ici.", free_text_not_allowed: "Cette question n'accepte pas de réponse écrite : choisis une option.", empty_answer: "Choisis une option ou écris la réponse.", text_too_long: "La réponse est trop longue : 1000 caractères au maximum." },
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
    readOnlyInvite: "Vista de solo lectura: ves el historial y las respuestas. Para escribir, conecta el equipo con «Confirmar y conectar».",
    readOnlyConnect: "Conectar con escritura",
    connectingSlow: "La conexión con el equipo no responde: el chat no puede mostrar el historial ni enviar. Reinténtalo.",
    sending: "Enviando…",
    send: "Enviar",
    destination: "Destino: el chat con {name}. El texto le llega como mensaje, no como teclas en su terminal.",
    sent: "Enviado",
    queued: "En cola",
    working: "{name} está trabajando…",
    queueExpired: "No enviado: el agente estuvo ocupado demasiado tiempo. Vuelve a escribirlo.",
    codes: { mail_not_taken: "El agente aún no ha tomado tu mensaje.", message_too_long: "Un mensaje del agente era demasiado largo para mostrarse aquí." },
    keysHint: "Intro envía · Ctrl+Intro salta de línea",
    kinds: { urgent: "urgente", blocked: "bloqueado", question: "pregunta", completed: "hecho", info: "aviso" },
    answerSend: "Responder",
    answerSeen: "Recogida por la herramienta del agente",
    answerWaiting: "Enviada: la herramienta del agente aún no la ha recogido",
    answerExpired: "Caducada: se tomó la respuesta de reserva",
    notSent: "Pegado pero no enviado",
    sendEnterAgain: "Enviar de nuevo (Intro)",
    takenUnknown: "No se sabe si lo ha recibido",
    takenReasons: { menu: "hay un menú abierto", permission: "hay una pregunta de permiso abierta", login: "hay un inicio de sesión pendiente", busy: "el agente estaba trabajando", not_ours: "hay otro texto en su cuadro de entrada", empty_unseen: "el texto nunca apareció en su cuadro de entrada", unreadable: "la pantalla no se puede leer", unconfirmed: "el texto salió de su cuadro de entrada, pero sin prueba de que lo haya recibido: mira su terminal antes de volver a escribir" },
    answerErrors: { question_closed: "Esta pregunta ya tiene respuesta.", invalid_choice: "Esta opción no está entre las de la pregunta.", not_found: "El agente ya no tiene esta pregunta.", answer_failed: "Respuesta no enviada: inténtalo de nuevo." },
    suggestionsLabel: "Respuestas sugeridas por el agente",
    today: "hoy",
    yesterday: "ayer",
    replyAction: "↩ Responder",
    replyingTo: "responder a:",
    replyingToQuestion: "responder a la pregunta:",
    replyClear: "Escribir un mensaje normal",
    quotePrefix: "en respuesta a",
    answerInWords: "Responder por escrito",
    answerTextKept: "El texto sigue en el cuadro.",
    jumpToLatest: "Ir al último mensaje",
    jumpToNew: "{count} nuevos: ir al último",
    answerInvalid: { choice_unknown: "Esta opción no es de la pregunta.", single_choice_only: "Aquí solo se elige una opción.", free_text_not_allowed: "Esta pregunta no admite respuesta escrita: elige una opción.", empty_answer: "Elige una opción o escribe la respuesta.", text_too_long: "La respuesta es demasiado larga: 1000 caracteres como máximo." },
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
    readOnlyInvite: "Vista só de leitura: vês o histórico e as respostas. Para escrever, liga a equipa com «Confirmar e ligar».",
    readOnlyConnect: "Ligar com escrita",
    connectingSlow: "A ligação à equipa não responde: o chat não pode mostrar o histórico nem enviar. Tenta de novo.",
    sending: "A enviar…",
    send: "Enviar",
    destination: "Destino: o chat com {name}. O texto chega-lhe como mensagem, não como teclas no terminal.",
    sent: "Enviado",
    queued: "Em fila",
    working: "{name} está a trabalhar…",
    queueExpired: "Não enviado: o agente esteve ocupado demasiado tempo. Volta a escrevê-lo.",
    codes: { mail_not_taken: "O agente ainda não apanhou a tua mensagem.", message_too_long: "Uma mensagem do agente era demasiado longa para ser mostrada aqui." },
    keysHint: "Enter envia · Ctrl+Enter muda de linha",
    kinds: { urgent: "urgente", blocked: "bloqueado", question: "pergunta", completed: "concluído", info: "aviso" },
    answerSend: "Responder",
    answerSeen: "Recolhida pela ferramenta do agente",
    answerWaiting: "Enviada: a ferramenta do agente ainda não a recolheu",
    answerExpired: "Expirada: foi tomada a resposta de reserva",
    notSent: "Colado mas não enviado",
    sendEnterAgain: "Enviar de novo (Enter)",
    takenUnknown: "Não se sabe se foi recebido",
    takenReasons: { menu: "há um menu aberto", permission: "há um pedido de permissão aberto", login: "há um início de sessão pendente", busy: "o agente estava a trabalhar", not_ours: "há outro texto na sua caixa de escrita", empty_unseen: "o texto nunca apareceu na sua caixa de escrita", unreadable: "o ecrã não se consegue ler", unconfirmed: "o texto saiu da sua caixa de escrita, mas sem prova de que foi recebido: vê o seu terminal antes de voltar a escrever" },
    answerErrors: { question_closed: "Esta pergunta já tem resposta.", invalid_choice: "Esta escolha não é uma das da pergunta.", not_found: "O agente já não tem esta pergunta.", answer_failed: "Resposta não enviada: tenta de novo." },
    suggestionsLabel: "Respostas sugeridas pelo agente",
    today: "hoje",
    yesterday: "ontem",
    replyAction: "↩ Responder",
    replyingTo: "responder a:",
    replyingToQuestion: "responder à pergunta:",
    replyClear: "Escrever uma mensagem normal",
    quotePrefix: "em resposta a",
    answerInWords: "Responder por escrito",
    answerTextKept: "O texto continua na caixa.",
    jumpToLatest: "Ir para a última mensagem",
    jumpToNew: "{count} novas: ir para a última",
    answerInvalid: { choice_unknown: "Esta opção não é da pergunta.", single_choice_only: "Aqui escolhe-se só uma opção.", free_text_not_allowed: "Esta pergunta não aceita resposta escrita: escolhe uma opção.", empty_answer: "Escolhe uma opção ou escreve a resposta.", text_too_long: "A resposta é demasiado longa: no máximo 1000 caracteres." },
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
    readOnlyInvite: "Csak olvasható nézet: látod az előzményeket és a válaszokat. Íráshoz csatlakoztasd a csapatot a „Megerősítés és csatlakozás” gombbal.",
    readOnlyConnect: "Csatlakozás írási joggal",
    connectingSlow: "A csapathoz való kapcsolat nem válaszol: a csevegés sem az előzményeket nem tudja mutatni, sem küldeni. Próbáld újra.",
    sending: "Küldés…",
    send: "Küldés",
    destination: "Cél: a csevegés vele: {name}. A szöveg üzenetként érkezik, nem billentyűként a termináljában.",
    sent: "Elküldve",
    queued: "Sorban",
    working: "{name} dolgozik…",
    queueExpired: "Nem lett elküldve: az ügynök túl sokáig volt elfoglalt. Írd meg újra.",
    codes: { mail_not_taken: "Az ügynök még nem vette át az üzenetedet.", message_too_long: "Az ügynök egyik üzenete túl hosszú volt ahhoz, hogy itt megjelenjen." },
    keysHint: "Enter: küldés · Ctrl+Enter: új sor",
    kinds: { urgent: "sürgős", blocked: "elakadt", question: "kérdés", completed: "kész", info: "tájékoztatás" },
    answerSend: "Válasz",
    answerSeen: "Az ügynök eszköze átvette",
    answerWaiting: "Elküldve: az ügynök eszköze még nem vette át",
    answerExpired: "Lejárt: a tartalék válasz lett kiválasztva",
    notSent: "Beillesztve, de nincs elküldve",
    sendEnterAgain: "Küldés újra (Enter)",
    takenUnknown: "Nem tudni, hogy megkapta-e",
    takenReasons: { menu: "egy menü van nyitva", permission: "egy engedélykérés van nyitva", login: "bejelentkezésre vár", busy: "az ügynök éppen dolgozott", not_ours: "a beviteli mezőben más szöveg van", empty_unseen: "a szöveg sosem jelent meg a beviteli mezőben", unreadable: "a képernyő nem olvasható", unconfirmed: "a szöveg kikerült a beviteli mezőből, de nincs bizonyíték arra, hogy átvette: nézd meg a terminálját, mielőtt újra írsz" },
    answerErrors: { question_closed: "Erre a kérdésre már érkezett válasz.", invalid_choice: "Ez a választás nincs a kérdés lehetőségei között.", not_found: "Az ügynöknél már nincs meg ez a kérdés.", answer_failed: "A válasz nem ment el: próbáld újra." },
    suggestionsLabel: "Az ügynök által javasolt válaszok",
    today: "ma",
    yesterday: "tegnap",
    replyAction: "↩ Válasz",
    replyingTo: "válasz erre:",
    replyingToQuestion: "válasz a kérdésre:",
    replyClear: "Normál üzenet írása",
    quotePrefix: "válaszul erre",
    answerInWords: "Válasz saját szavakkal",
    answerTextKept: "A szöveg még a mezőben van.",
    jumpToLatest: "Ugrás a legutóbbi üzenethez",
    jumpToNew: "{count} új: ugrás a legutóbbihoz",
    answerInvalid: { choice_unknown: "Ez a választás nem tartozik a kérdéshez.", single_choice_only: "Itt csak egyet lehet választani.", free_text_not_allowed: "Erre a kérdésre nem lehet szöveges választ adni: válassz egy lehetőséget.", empty_answer: "Válassz egy lehetőséget, vagy írd meg a választ.", text_too_long: "A válasz túl hosszú: legfeljebb 1000 karakter." },
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
