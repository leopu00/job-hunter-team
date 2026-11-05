import type { Locale } from "@/i18n/config";
import type { Theme } from "./theme";

/**
 * The theme picker's words: the gear's accessible name, the menu's name and
 * heading, the two groups, the «follow the system» entry and the themes' names. 7 languages; Italian is the source and
 * its shape is the type. `{name}` is the current theme's name.
 */
export interface ThemeText {
  trigger: string; // {name}
  menu: string;
  heading: string;
  names: Record<Theme, string>;
  system: string; // the «follow the system» entry
  systemShort: string; // appended to the current theme's name when it comes from the system
  custom: string; // the name of the person's own palette
  groupDark: string;
  groupLight: string;
  groupMine: string; // the heading of the themes the person saved with a name
}

export const THEME_TEXT: Record<Locale, ThemeText> = {
  it: {
    trigger: "Tema: {name}. Cambia tema",
    menu: "Tema dell'app",
    heading: "Tema",
    names: { dark: "Scuro", light: "Chiaro", graphite: "Grafite", ocean: "Oceano", paper: "Carta", midnight: "Mezzanotte", forest: "Foresta", dusk: "Crepuscolo", contrast: "Alto contrasto", mist: "Grigio chiaro", contrastlight: "Alto contrasto chiaro", sage: "Salvia", lavender: "Lavanda" },
    system: "Segui il sistema",
    systemShort: "sistema",
    custom: "Personale",
    groupDark: "Scuri",
    groupLight: "Chiari",
    groupMine: "I tuoi temi",
  },
  en: {
    trigger: "Theme: {name}. Change theme",
    menu: "App theme",
    heading: "Theme",
    names: { dark: "Dark", light: "Light", graphite: "Graphite", ocean: "Ocean", paper: "Paper", midnight: "Midnight", forest: "Forest", dusk: "Dusk", contrast: "High contrast", mist: "Light grey", contrastlight: "High contrast light", sage: "Sage", lavender: "Lavender" },
    system: "Match system",
    systemShort: "system",
    custom: "Custom",
    groupDark: "Dark themes",
    groupLight: "Light themes",
    groupMine: "Your themes",
  },
  de: {
    trigger: "Design: {name}. Design ändern",
    menu: "App-Design",
    heading: "Design",
    names: { dark: "Dunkel", light: "Hell", graphite: "Graphit", ocean: "Ozean", paper: "Papier", midnight: "Mitternacht", forest: "Wald", dusk: "Dämmerung", contrast: "Hoher Kontrast", mist: "Hellgrau", contrastlight: "Hoher Kontrast hell", sage: "Salbei", lavender: "Lavendel" },
    system: "Wie im System",
    systemShort: "System",
    custom: "Benutzerdefiniert",
    groupDark: "Dunkle Designs",
    groupLight: "Helle Designs",
    groupMine: "Deine Designs",
  },
  fr: {
    trigger: "Thème : {name}. Changer de thème",
    menu: "Thème de l’app",
    heading: "Thème",
    names: { dark: "Sombre", light: "Clair", graphite: "Graphite", ocean: "Océan", paper: "Papier", midnight: "Minuit", forest: "Forêt", dusk: "Crépuscule", contrast: "Contraste élevé", mist: "Gris clair", contrastlight: "Contraste élevé clair", sage: "Sauge", lavender: "Lavande" },
    system: "Suivre le système",
    systemShort: "système",
    custom: "Personnalisé",
    groupDark: "Sombres",
    groupLight: "Clairs",
    groupMine: "Vos thèmes",
  },
  es: {
    trigger: "Tema: {name}. Cambiar tema",
    menu: "Tema de la app",
    heading: "Tema",
    names: { dark: "Oscuro", light: "Claro", graphite: "Grafito", ocean: "Océano", paper: "Papel", midnight: "Medianoche", forest: "Bosque", dusk: "Crepúsculo", contrast: "Alto contraste", mist: "Gris claro", contrastlight: "Alto contraste claro", sage: "Salvia", lavender: "Lavanda" },
    system: "Seguir el sistema",
    systemShort: "sistema",
    custom: "Personalizado",
    groupDark: "Oscuros",
    groupLight: "Claros",
    groupMine: "Tus temas",
  },
  pt: {
    trigger: "Tema: {name}. Mudar de tema",
    menu: "Tema da app",
    heading: "Tema",
    names: { dark: "Escuro", light: "Claro", graphite: "Grafite", ocean: "Oceano", paper: "Papel", midnight: "Meia-noite", forest: "Floresta", dusk: "Crepúsculo", contrast: "Alto contraste", mist: "Cinza claro", contrastlight: "Alto contraste claro", sage: "Sálvia", lavender: "Lavanda" },
    system: "Seguir o sistema",
    systemShort: "sistema",
    custom: "Personalizado",
    groupDark: "Escuros",
    groupLight: "Claros",
    groupMine: "Os seus temas",
  },
  hu: {
    trigger: "Téma: {name}. Téma váltása",
    menu: "Az app témája",
    heading: "Téma",
    names: { dark: "Sötét", light: "Világos", graphite: "Grafit", ocean: "Óceán", paper: "Papír", midnight: "Éjfél", forest: "Erdő", dusk: "Alkony", contrast: "Nagy kontrasztú", mist: "Világosszürke", contrastlight: "Nagy kontrasztú világos", sage: "Zsálya", lavender: "Levendula" },
    system: "Rendszer szerint",
    systemShort: "rendszer",
    custom: "Egyéni",
    groupDark: "Sötét",
    groupLight: "Világos",
    groupMine: "Saját témák",
  },
};
