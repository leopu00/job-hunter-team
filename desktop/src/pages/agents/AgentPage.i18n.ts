import type { Locale } from "@/i18n/config";

/** The page of one agent (/agents/:name): the words that the Agents panel does not already have. */
export interface AgentPageText {
  back: string;
  reading: string;
  notFound: string; // {name}
  /** The team is not reachable: the reason comes from the error catalog. */
  lastWork: string;
  lastActive: string; // {time}
  lastMessage: string; // {who} {time}
  noMessage: string;
  you: string;
  neverActive: string;
  sessions: string;
  terminalTitle: string; // {name}
  terminalLog: string; // {name}
  watchOnly: string; // {name}
  writeTo: string; // {name}
  noChatYet: string; // {name}
}

const it: AgentPageText = {
  back: "Tutti gli agenti",
  reading: "Leggo l’agente…",
  notFound: "{name} non è nella squadra: controlla il nome o torna all’elenco.",
  lastWork: "Ultimo lavoro",
  lastActive: "Ultima attività {time}",
  lastMessage: "Ultimo messaggio: {who}, {time}",
  noMessage: "Nessun messaggio letto da quando hai aperto l’app: apri la chat per vederli.",
  you: "Tu",
  neverActive: "Nessuna attività registrata",
  sessions: "Sessioni precedenti",
  terminalTitle: "Terminale di {name} in diretta",
  terminalLog: "Terminale di {name}, in sola lettura",
  watchOnly: "Qui si guarda soltanto: per scrivere a {name} usa la chat, non il terminale.",
  writeTo: "Scrivi a {name}",
  noChatYet: "Con {name} non c’è una chat: si guarda e basta.",
};

const en: AgentPageText = {
  back: "All agents",
  reading: "Reading the agent…",
  notFound: "{name} is not in the team: check the name or go back to the list.",
  lastWork: "Last work",
  lastActive: "Last activity {time}",
  lastMessage: "Last message: {who}, {time}",
  noMessage: "No message read since you opened the app: open the chat to see them.",
  you: "You",
  neverActive: "No activity recorded",
  sessions: "Earlier sessions",
  terminalTitle: "{name}’s terminal, live",
  terminalLog: "{name}’s terminal, read only",
  watchOnly: "This is for watching only: to write to {name}, use the chat, not the terminal.",
  writeTo: "Write to {name}",
  noChatYet: "There is no chat with {name}: this is for watching.",
};

const de: AgentPageText = {
  back: "Alle Agenten",
  reading: "Agent wird gelesen …",
  notFound: "{name} gehört nicht zum Team: Prüfe den Namen oder gehe zurück zur Liste.",
  lastWork: "Letzte Arbeit",
  lastActive: "Letzte Aktivität {time}",
  lastMessage: "Letzte Nachricht: {who}, {time}",
  noMessage: "Seit dem Öffnen der App wurde keine Nachricht gelesen: Öffne den Chat, um sie zu sehen.",
  you: "Du",
  neverActive: "Keine Aktivität aufgezeichnet",
  sessions: "Frühere Sitzungen",
  terminalTitle: "Terminal von {name}, live",
  terminalLog: "Terminal von {name}, nur lesbar",
  watchOnly: "Hier kann man nur zusehen: Um {name} zu schreiben, nutze den Chat, nicht das Terminal.",
  writeTo: "{name} schreiben",
  noChatYet: "Mit {name} gibt es keinen Chat: Hier kann man nur zusehen.",
};

const es: AgentPageText = {
  back: "Todos los agentes",
  reading: "Leyendo el agente…",
  notFound: "{name} no está en el equipo: revisa el nombre o vuelve a la lista.",
  lastWork: "Último trabajo",
  lastActive: "Última actividad {time}",
  lastMessage: "Último mensaje: {who}, {time}",
  noMessage: "Ningún mensaje leído desde que abriste la app: abre el chat para verlos.",
  you: "Tú",
  neverActive: "Sin actividad registrada",
  sessions: "Sesiones anteriores",
  terminalTitle: "Terminal de {name} en directo",
  terminalLog: "Terminal de {name}, solo lectura",
  watchOnly: "Aquí solo se mira: para escribir a {name} usa el chat, no el terminal.",
  writeTo: "Escribir a {name}",
  noChatYet: "No hay chat con {name}: aquí solo se mira.",
};

const fr: AgentPageText = {
  back: "Tous les agents",
  reading: "Lecture de l’agent…",
  notFound: "{name} n’est pas dans l’équipe : vérifiez le nom ou revenez à la liste.",
  lastWork: "Dernier travail",
  lastActive: "Dernière activité {time}",
  lastMessage: "Dernier message : {who}, {time}",
  noMessage: "Aucun message lu depuis l’ouverture de l’app : ouvrez le chat pour les voir.",
  you: "Vous",
  neverActive: "Aucune activité enregistrée",
  sessions: "Sessions précédentes",
  terminalTitle: "Terminal de {name} en direct",
  terminalLog: "Terminal de {name}, en lecture seule",
  watchOnly: "Ici on regarde seulement : pour écrire à {name}, utilisez le chat, pas le terminal.",
  writeTo: "Écrire à {name}",
  noChatYet: "Il n’y a pas de chat avec {name} : ici on regarde seulement.",
};

const hu: AgentPageText = {
  back: "Összes ügynök",
  reading: "Az ügynök beolvasása…",
  notFound: "{name} nincs a csapatban: ellenőrizd a nevet, vagy térj vissza a listához.",
  lastWork: "Utolsó munka",
  lastActive: "Utolsó aktivitás: {time}",
  lastMessage: "Utolsó üzenet: {who}, {time}",
  noMessage: "Az alkalmazás megnyitása óta nem olvastál üzenetet: nyisd meg a csevegést.",
  you: "Te",
  neverActive: "Nincs rögzített aktivitás",
  sessions: "Korábbi munkamenetek",
  terminalTitle: "{name} terminálja élőben",
  terminalLog: "{name} terminálja, csak olvasható",
  watchOnly: "Itt csak nézni lehet: ha írni szeretnél neki ({name}), használd a csevegést, ne a terminált.",
  writeTo: "Írás neki: {name}",
  noChatYet: "Vele ({name}) nincs csevegés: itt csak nézni lehet.",
};

const pt: AgentPageText = {
  back: "Todos os agentes",
  reading: "A ler o agente…",
  notFound: "{name} não está na equipa: verifique o nome ou volte à lista.",
  lastWork: "Último trabalho",
  lastActive: "Última atividade {time}",
  lastMessage: "Última mensagem: {who}, {time}",
  noMessage: "Nenhuma mensagem lida desde que abriu a app: abra o chat para as ver.",
  you: "Você",
  neverActive: "Sem atividade registada",
  sessions: "Sessões anteriores",
  terminalTitle: "Terminal de {name} em direto",
  terminalLog: "Terminal de {name}, só de leitura",
  watchOnly: "Aqui só se observa: para escrever a {name}, use o chat, não o terminal.",
  writeTo: "Escrever a {name}",
  noChatYet: "Não há chat com {name}: aqui só se observa.",
};

export const AGENT_PAGE_TEXT: Record<Locale, AgentPageText> = { it, en, de, es, fr, hu, pt };
