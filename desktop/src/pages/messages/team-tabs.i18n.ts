import type { Locale } from "@/i18n/config";

/** The tabs of one agent on the Team page: the chat, what is known of it, and its terminal (read only). */
export interface TeamTabsText {
  aria: string;
  chat: string;
  info: string;
  terminal: string;
  /** The whole team, as a row of the list, with its own tabs. */
  squad: string;
  commands: string;
  lanes: string;
  log: string;
}

export const TEAM_TABS_TEXT: Record<Locale, TeamTabsText> = {
  it: { aria: "Sezioni dell'agente", chat: "Chat", info: "Info", terminal: "Terminale", squad: "Squadra", commands: "Comandi", lanes: "Corsie", log: "Registro" },
  en: { aria: "Sections of the agent", chat: "Chat", info: "Info", terminal: "Terminal", squad: "Team", commands: "Commands", lanes: "Lanes", log: "Log" },
  de: { aria: "Bereiche des Agenten", chat: "Chat", info: "Info", terminal: "Terminal", squad: "Team", commands: "Befehle", lanes: "Bahnen", log: "Protokoll" },
  fr: { aria: "Sections de l'agent", chat: "Discussion", info: "Infos", terminal: "Terminal", squad: "Équipe", commands: "Commandes", lanes: "Couloirs", log: "Journal" },
  es: { aria: "Secciones del agente", chat: "Chat", info: "Info", terminal: "Terminal", squad: "Equipo", commands: "Comandos", lanes: "Carriles", log: "Registro" },
  pt: { aria: "Secções do agente", chat: "Conversa", info: "Info", terminal: "Terminal", squad: "Equipa", commands: "Comandos", lanes: "Faixas", log: "Registo" },
  hu: { aria: "Az ügynök szakaszai", chat: "Csevegés", info: "Infó", terminal: "Terminál", squad: "Csapat", commands: "Parancsok", lanes: "Sávok", log: "Napló" },
};
