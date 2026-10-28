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
  /** The paperclip beside the composer (Assistant only): its label, and the word while a file is being attached. */
  attach: string;
  attaching: string;
  /** After a file went: `{name}` is the person's own file name. */
  attachSent: string;
  /** The file is in the folder but the Assistant was not told. */
  attachSavedNotSent: string;
  /** Why the paperclip is off, by the code the native side gives. */
  attachOff: Record<"attach_vps" | "attach_read_only" | "attach_platform" | "attach_not_connected", string>;
  /** Why a file was not attached, by closed code; `attach_failed` says any other. */
  attachErrors: Record<"attachment_type" | "attachment_type_mismatch" | "attachment_too_big" | "attachment_is_link" | "attachment_not_file" | "attachment_unreadable" | "attachments_folder_unsafe" | "attachments_folder_full" | "attachment_save_failed" | "attachment_not_shared" | "attach_busy" | "attach_failed", string>;
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
    attach: "Allega un file",
    attaching: "Allego…",
    attachSent: "Allegato: {name}. L'Assistente lo userà per il tuo profilo.",
    attachSavedNotSent: "{name} è nella cartella degli allegati, ma il messaggio all'Assistente non è partito. Scrivigli tu che hai allegato il file.",
    attachOff: {attach_vps: "Gli allegati funzionano con la squadra su questo computer. Questa squadra è su un server.", attach_read_only: "Vista in sola lettura: collega la squadra in scrittura per allegare file.", attach_platform: "Gli allegati non sono ancora disponibili su questo sistema.", attach_not_connected: "Collega la squadra per allegare file."},
    attachErrors: {attachment_type: "Questo tipo di file non è accettato. Usa PDF, Word (docx, doc), OpenDocument (odt), RTF, testo (txt, md), PNG o JPG.", attachment_type_mismatch: "Il contenuto non corrisponde al tipo del file. Scegli il documento originale.", attachment_too_big: "Il file supera i 10 MB.", attachment_is_link: "Questo è un collegamento o alias. Scegli il file vero.", attachment_not_file: "Scegli un file, non una cartella.", attachment_unreadable: "Non riesco a leggere il file.", attachments_folder_unsafe: "La cartella degli allegati della squadra non è sicura per scriverci: non ho copiato niente.", attachments_folder_full: "La cartella degli allegati ha troppi file. Togline qualcuno dalla cartella e riprova.", attachment_save_failed: "Non sono riuscito a copiare il file.", attachment_not_shared: "La squadra non vede la cartella degli allegati, quindi il file non è stato tenuto. Riavvia la squadra e riprova.", attach_busy: "Un altro allegato è ancora in corso.", attach_failed: "Non sono riuscito ad allegare il file."},
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
    attach: "Attach a file",
    attaching: "Attaching…",
    attachSent: "Attached: {name}. The Assistant will use it for your profile.",
    attachSavedNotSent: "{name} is in the attachments folder, but the message to the Assistant did not go. Tell it yourself that you attached the file.",
    attachOff: {attach_vps: "Attachments work with the team on this computer. This team runs on a server.", attach_read_only: "Read-only view: connect the team for writing to attach files.", attach_platform: "Attachments are not available on this system yet.", attach_not_connected: "Connect the team to attach files."},
    attachErrors: {attachment_type: "This file type is not accepted. Use PDF, Word (docx, doc), OpenDocument (odt), RTF, text (txt, md), PNG or JPG.", attachment_type_mismatch: "The content does not match the file type. Choose the original document.", attachment_too_big: "The file is over 10 MB.", attachment_is_link: "That is a shortcut or alias. Choose the file itself.", attachment_not_file: "Choose a file, not a folder.", attachment_unreadable: "The file could not be read.", attachments_folder_unsafe: "The team's attachments folder is not safe to write to, so nothing was copied.", attachments_folder_full: "The attachments folder has too many files. Remove some from the folder and try again.", attachment_save_failed: "The file could not be copied.", attachment_not_shared: "The team does not see the attachments folder, so the file was not kept. Restart the team and try again.", attach_busy: "Another attachment is still in progress.", attach_failed: "The file could not be attached."},
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
    attach: "Datei anhängen",
    attaching: "Wird angehängt…",
    attachSent: "Angehängt: {name}. Der Assistent nutzt sie für dein Profil.",
    attachSavedNotSent: "{name} liegt im Ordner für Anhänge, aber die Nachricht an den Assistenten ist nicht rausgegangen. Sag ihm selbst, dass du die Datei angehängt hast.",
    attachOff: {attach_vps: "Anhänge funktionieren mit dem Team auf diesem Computer. Dieses Team läuft auf einem Server.", attach_read_only: "Nur-Lese-Ansicht: Verbinde das Team zum Schreiben, um Dateien anzuhängen.", attach_platform: "Anhänge sind auf diesem System noch nicht verfügbar.", attach_not_connected: "Verbinde das Team, um Dateien anzuhängen."},
    attachErrors: {attachment_type: "Dieser Dateityp wird nicht akzeptiert. Nutze PDF, Word (docx, doc), OpenDocument (odt), RTF, Text (txt, md), PNG oder JPG.", attachment_type_mismatch: "Der Inhalt passt nicht zum Dateityp. Wähle das Originaldokument.", attachment_too_big: "Die Datei ist größer als 10 MB.", attachment_is_link: "Das ist eine Verknüpfung oder ein Alias. Wähle die Datei selbst.", attachment_not_file: "Wähle eine Datei, keinen Ordner.", attachment_unreadable: "Die Datei konnte nicht gelesen werden.", attachments_folder_unsafe: "Der Anhänge-Ordner des Teams ist nicht sicher beschreibbar, deshalb wurde nichts kopiert.", attachments_folder_full: "Der Anhänge-Ordner hat zu viele Dateien. Entferne einige aus dem Ordner und versuche es erneut.", attachment_save_failed: "Die Datei konnte nicht kopiert werden.", attachment_not_shared: "Das Team sieht den Anhänge-Ordner nicht, deshalb wurde die Datei nicht behalten. Starte das Team neu und versuche es erneut.", attach_busy: "Ein anderer Anhang läuft noch.", attach_failed: "Die Datei konnte nicht angehängt werden."},
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
    attach: "Joindre un fichier",
    attaching: "Ajout…",
    attachSent: "Joint : {name}. L'Assistant s'en servira pour ton profil.",
    attachSavedNotSent: "{name} est dans le dossier des pièces jointes, mais le message à l'Assistant n'est pas parti. Dis-lui toi-même que tu as joint le fichier.",
    attachOff: {attach_vps: "Les pièces jointes fonctionnent avec l'équipe de cet ordinateur. Cette équipe tourne sur un serveur.", attach_read_only: "Vue en lecture seule : connecte l'équipe en écriture pour joindre des fichiers.", attach_platform: "Les pièces jointes ne sont pas encore disponibles sur ce système.", attach_not_connected: "Connecte l'équipe pour joindre des fichiers."},
    attachErrors: {attachment_type: "Ce type de fichier n'est pas accepté. Utilise PDF, Word (docx, doc), OpenDocument (odt), RTF, texte (txt, md), PNG ou JPG.", attachment_type_mismatch: "Le contenu ne correspond pas au type du fichier. Choisis le document d'origine.", attachment_too_big: "Le fichier dépasse 10 Mo.", attachment_is_link: "C'est un raccourci ou un alias. Choisis le fichier lui-même.", attachment_not_file: "Choisis un fichier, pas un dossier.", attachment_unreadable: "Le fichier n'a pas pu être lu.", attachments_folder_unsafe: "Le dossier des pièces jointes de l'équipe n'est pas sûr pour y écrire : rien n'a été copié.", attachments_folder_full: "Le dossier des pièces jointes contient trop de fichiers. Supprimes-en dans le dossier et réessaie.", attachment_save_failed: "Le fichier n'a pas pu être copié.", attachment_not_shared: "L'équipe ne voit pas le dossier des pièces jointes, le fichier n'a donc pas été gardé. Redémarre l'équipe et réessaie.", attach_busy: "Une autre pièce jointe est encore en cours.", attach_failed: "Le fichier n'a pas pu être joint."},
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
    attach: "Adjuntar un archivo",
    attaching: "Adjuntando…",
    attachSent: "Adjuntado: {name}. El Asistente lo usará para tu perfil.",
    attachSavedNotSent: "{name} está en la carpeta de adjuntos, pero el mensaje al Asistente no salió. Dile tú que has adjuntado el archivo.",
    attachOff: {attach_vps: "Los adjuntos funcionan con el equipo de este ordenador. Este equipo está en un servidor.", attach_read_only: "Vista de solo lectura: conecta el equipo en escritura para adjuntar archivos.", attach_platform: "Los adjuntos aún no están disponibles en este sistema.", attach_not_connected: "Conecta el equipo para adjuntar archivos."},
    attachErrors: {attachment_type: "Este tipo de archivo no se acepta. Usa PDF, Word (docx, doc), OpenDocument (odt), RTF, texto (txt, md), PNG o JPG.", attachment_type_mismatch: "El contenido no corresponde al tipo del archivo. Elige el documento original.", attachment_too_big: "El archivo supera los 10 MB.", attachment_is_link: "Es un acceso directo o alias. Elige el archivo en sí.", attachment_not_file: "Elige un archivo, no una carpeta.", attachment_unreadable: "No se pudo leer el archivo.", attachments_folder_unsafe: "La carpeta de adjuntos del equipo no es segura para escribir: no se copió nada.", attachments_folder_full: "La carpeta de adjuntos tiene demasiados archivos. Quita algunos de la carpeta y vuelve a intentarlo.", attachment_save_failed: "No se pudo copiar el archivo.", attachment_not_shared: "El equipo no ve la carpeta de adjuntos, así que el archivo no se conservó. Reinicia el equipo y vuelve a intentarlo.", attach_busy: "Otro adjunto sigue en curso.", attach_failed: "No se pudo adjuntar el archivo."},
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
    attach: "Anexar um ficheiro",
    attaching: "A anexar…",
    attachSent: "Anexado: {name}. O Assistente vai usá-lo para o teu perfil.",
    attachSavedNotSent: "{name} está na pasta dos anexos, mas a mensagem ao Assistente não saiu. Diz-lhe tu que anexaste o ficheiro.",
    attachOff: {attach_vps: "Os anexos funcionam com a equipa deste computador. Esta equipa está num servidor.", attach_read_only: "Vista só de leitura: liga a equipa em escrita para anexar ficheiros.", attach_platform: "Os anexos ainda não estão disponíveis neste sistema.", attach_not_connected: "Liga a equipa para anexar ficheiros."},
    attachErrors: {attachment_type: "Este tipo de ficheiro não é aceite. Usa PDF, Word (docx, doc), OpenDocument (odt), RTF, texto (txt, md), PNG ou JPG.", attachment_type_mismatch: "O conteúdo não corresponde ao tipo do ficheiro. Escolhe o documento original.", attachment_too_big: "O ficheiro excede 10 MB.", attachment_is_link: "Isto é um atalho ou alias. Escolhe o ficheiro em si.", attachment_not_file: "Escolhe um ficheiro, não uma pasta.", attachment_unreadable: "Não foi possível ler o ficheiro.", attachments_folder_unsafe: "A pasta dos anexos da equipa não é segura para escrever: nada foi copiado.", attachments_folder_full: "A pasta dos anexos tem demasiados ficheiros. Tira alguns da pasta e tenta de novo.", attachment_save_failed: "Não foi possível copiar o ficheiro.", attachment_not_shared: "A equipa não vê a pasta dos anexos, por isso o ficheiro não foi guardado. Reinicia a equipa e tenta de novo.", attach_busy: "Outro anexo ainda está em curso.", attach_failed: "Não foi possível anexar o ficheiro."},
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
    attach: "Fájl csatolása",
    attaching: "Csatolás…",
    attachSent: "Csatolva: {name}. Az Asszisztens a profilodhoz használja.",
    attachSavedNotSent: "A(z) {name} a csatolmányok mappájában van, de az Asszisztensnek szóló üzenet nem ment el. Írd meg neki te, hogy csatoltad a fájlt.",
    attachOff: {attach_vps: "A csatolás az ezen a számítógépen futó csapattal működik. Ez a csapat egy szerveren fut.", attach_read_only: "Csak olvasható nézet: az írásos kapcsolat nélkül nem lehet fájlt csatolni.", attach_platform: "A csatolás ezen a rendszeren még nem érhető el.", attach_not_connected: "Csatlakoztasd a csapatot a fájl csatolásához."},
    attachErrors: {attachment_type: "Ez a fájltípus nem fogadható el. Használj PDF-et, Wordöt (docx, doc), OpenDocumentet (odt), RTF-et, szöveget (txt, md), PNG-t vagy JPG-t.", attachment_type_mismatch: "A tartalom nem egyezik a fájl típusával. Válaszd az eredeti dokumentumot.", attachment_too_big: "A fájl nagyobb 10 MB-nál.", attachment_is_link: "Ez egy parancsikon vagy alias. Válaszd magát a fájlt.", attachment_not_file: "Fájlt válassz, ne mappát.", attachment_unreadable: "A fájlt nem sikerült beolvasni.", attachments_folder_unsafe: "A csapat csatolmány-mappájába nem biztonságos írni, ezért semmi nem lett másolva.", attachments_folder_full: "A csatolmányok mappájában túl sok a fájl. Törölj párat a mappából, és próbáld újra.", attachment_save_failed: "A fájlt nem sikerült átmásolni.", attachment_not_shared: "A csapat nem látja a csatolmányok mappáját, ezért a fájl nem maradt meg. Indítsd újra a csapatot, és próbáld újra.", attach_busy: "Egy másik csatolás még folyamatban van.", attach_failed: "A fájlt nem sikerült csatolni."},
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
