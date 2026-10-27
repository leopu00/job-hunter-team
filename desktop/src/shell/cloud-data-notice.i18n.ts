import type { Locale } from "@/i18n/config";

/**
 * The line a page that reads the cloud shows to someone who has not signed in (a local profile): the
 * data comes from the cloud, and the team's own work is in Messages and Agents. 7 languages; Italian is
 * the source and its shape is the type. The button is the shell's sign-out, which leads back to the
 * choice of how to start.
 */
export interface CloudDataNoticeText {
  notice: string;
  signIn: string;
}

export const CLOUD_DATA_NOTICE_TEXT: Record<Locale, CloudDataNoticeText> = {
  it: {
    notice: "Questi dati arrivano dal cloud: accedi per vederli. Il lavoro della squadra si vede in Messaggi e Agenti.",
    signIn: "Accedi con Google",
  },
  en: {
    notice: "This data comes from the cloud: sign in to see it. The team’s work shows in Messages and Agents.",
    signIn: "Sign in with Google",
  },
  de: {
    notice: "Diese Daten kommen aus der Cloud: Melde dich an, um sie zu sehen. Die Arbeit des Teams siehst du unter Nachrichten und Agenten.",
    signIn: "Mit Google anmelden",
  },
  hu: {
    notice: "Ezek az adatok a felhőből jönnek: jelentkezz be, hogy lásd őket. A csapat munkája az Üzenetek és az Ügynökök oldalon látszik.",
    signIn: "Bejelentkezés Google-lel",
  },
  es: {
    notice: "Estos datos vienen de la nube: inicia sesión para verlos. El trabajo del equipo se ve en Mensajes y Agentes.",
    signIn: "Iniciar sesión con Google",
  },
  fr: {
    notice: "Ces données viennent du cloud : connecte-toi pour les voir. Le travail de l’équipe se voit dans Messages et Agents.",
    signIn: "Se connecter avec Google",
  },
  pt: {
    notice: "Estes dados vêm da cloud: inicia sessão para os ver. O trabalho da equipa vê-se em Mensagens e Agentes.",
    signIn: "Iniciar sessão com o Google",
  },
};
