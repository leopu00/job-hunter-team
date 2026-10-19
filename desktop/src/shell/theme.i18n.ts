import type { Locale } from "@/i18n/config";
import type { Theme } from "./theme";

/**
 * The theme picker's words: the gear's accessible name, the menu's name and
 * heading, and the five themes' names. 7 languages; Italian is the source and
 * its shape is the type. `{name}` is the current theme's name.
 */
export interface ThemeText {
  trigger: string; // {name}
  menu: string;
  heading: string;
  names: Record<Theme, string>;
}

export const THEME_TEXT: Record<Locale, ThemeText> = {
  it: {
    trigger: "Tema: {name}. Cambia tema",
    menu: "Tema dell'app",
    heading: "Tema",
    names: { dark: "Scuro", light: "Chiaro", graphite: "Grafite", ocean: "Oceano", paper: "Carta" },
  },
  en: {
    trigger: "Theme: {name}. Change theme",
    menu: "App theme",
    heading: "Theme",
    names: { dark: "Dark", light: "Light", graphite: "Graphite", ocean: "Ocean", paper: "Paper" },
  },
  de: {
    trigger: "Design: {name}. Design ändern",
    menu: "App-Design",
    heading: "Design",
    names: { dark: "Dunkel", light: "Hell", graphite: "Graphit", ocean: "Ozean", paper: "Papier" },
  },
  fr: {
    trigger: "Thème : {name}. Changer de thème",
    menu: "Thème de l’app",
    heading: "Thème",
    names: { dark: "Sombre", light: "Clair", graphite: "Graphite", ocean: "Océan", paper: "Papier" },
  },
  es: {
    trigger: "Tema: {name}. Cambiar tema",
    menu: "Tema de la app",
    heading: "Tema",
    names: { dark: "Oscuro", light: "Claro", graphite: "Grafito", ocean: "Océano", paper: "Papel" },
  },
  pt: {
    trigger: "Tema: {name}. Mudar de tema",
    menu: "Tema da app",
    heading: "Tema",
    names: { dark: "Escuro", light: "Claro", graphite: "Grafite", ocean: "Oceano", paper: "Papel" },
  },
  hu: {
    trigger: "Téma: {name}. Téma váltása",
    menu: "Az app témája",
    heading: "Téma",
    names: { dark: "Sötét", light: "Világos", graphite: "Grafit", ocean: "Óceán", paper: "Papír" },
  },
};
