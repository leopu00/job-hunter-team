import type { Locale } from "@/i18n/config";

/** The tabs of one agent on the Team page: the chat, what is known of it, and its terminal (read only). */
export interface TeamTabsText {
  aria: string;
  chat: string;
  info: string;
  terminal: string;
}

export const TEAM_TABS_TEXT: Record<Locale, TeamTabsText> = {
  it: { aria: "Sezioni dell'agente", chat: "Chat", info: "Info", terminal: "Terminale" },
  en: { aria: "Sections of the agent", chat: "Chat", info: "Info", terminal: "Terminal" },
  de: { aria: "Bereiche des Agenten", chat: "Chat", info: "Info", terminal: "Terminal" },
  fr: { aria: "Sections de l'agent", chat: "Discussion", info: "Infos", terminal: "Terminal" },
  es: { aria: "Secciones del agente", chat: "Chat", info: "Info", terminal: "Terminal" },
  pt: { aria: "Secções do agente", chat: "Conversa", info: "Info", terminal: "Terminal" },
  hu: { aria: "Az ügynök szakaszai", chat: "Csevegés", info: "Infó", terminal: "Terminál" },
};
