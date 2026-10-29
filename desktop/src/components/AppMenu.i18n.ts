import type { Locale } from "@/i18n/config";

export interface AppMenuText {
  /** The menu ESC opens (the window is never paused: the team keeps working). */
  title: string;
  resume: string;
  /** Full screen on and off; F11 does the same. */
  fullscreen: string;
}

export const APP_MENU_TEXT: Record<Locale, AppMenuText> = {
  it: { title: "Menu", resume: "Riprendi", fullscreen: "Schermo intero" },
  en: { title: "Menu", resume: "Resume", fullscreen: "Full screen" },
  hu: { title: "Menü", resume: "Folytatás", fullscreen: "Teljes képernyő" },
  es: { title: "Menú", resume: "Continuar", fullscreen: "Pantalla completa" },
  de: { title: "Menü", resume: "Weiter", fullscreen: "Vollbild" },
  fr: { title: "Menu", resume: "Reprendre", fullscreen: "Plein écran" },
  pt: { title: "Menu", resume: "Continuar", fullscreen: "Ecrã inteiro" },
};
