import type { Locale } from "@/i18n/config";

/** The direct chat's status bar when nothing failed, and its button. Failures are told by the catalog. */
export type DirectChatStatusCopy = { connecting: string; ready: string; retry: string; retrying: string };

export const DIRECT_CHAT_STATUS_TEXT: Record<Locale, DirectChatStatusCopy> = {
  it: { connecting: "Connessione sicura al team…", ready: "Team collegato", retry: "Riprova", retrying: "Connessione…" },
  en: { connecting: "Secure connection to the team…", ready: "Team connected", retry: "Try again", retrying: "Connecting…" },
  de: { connecting: "Sichere Verbindung zum Team…", ready: "Team verbunden", retry: "Erneut versuchen", retrying: "Verbindung wird hergestellt…" },
  es: { connecting: "Conexión segura con el equipo…", ready: "Equipo conectado", retry: "Reintentar", retrying: "Conectando…" },
  fr: { connecting: "Connexion sécurisée à l’équipe…", ready: "Équipe connectée", retry: "Réessayer", retrying: "Connexion…" },
  hu: { connecting: "Biztonságos kapcsolat a csapattal…", ready: "A csapat csatlakoztatva", retry: "Újra", retrying: "Csatlakozás…" },
  pt: { connecting: "Ligação segura à equipa…", ready: "Equipa ligada", retry: "Tentar novamente", retrying: "A ligar…" },
};
