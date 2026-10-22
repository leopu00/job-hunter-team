import type { Locale } from "@/i18n/config";

/**
 * The «Settings» page: the app's language and the currency salaries are shown
 * in. Both are kept on this computer (cookies of the app's own window), and
 * the intro says so. 7 languages; Italian is the source and its shape is the
 * type.
 */
const it = {
  navLabel: "Impostazioni",
  title: "Impostazioni",
  intro: "La lingua dell’app e la valuta in cui vedi gli stipendi. Le scelte restano su questo computer e non cambiano nulla nella tua squadra.",
};

export type SettingsText = typeof it;

export const SETTINGS_TEXT: Record<Locale, SettingsText> = {
  it,
  en: {
    navLabel: "Settings",
    title: "Settings",
    intro: "The app’s language and the currency salaries are shown in. These choices stay on this computer and change nothing on your team.",
  },
  de: {
    navLabel: "Einstellungen",
    title: "Einstellungen",
    intro: "Sprache der App und Währung, in der Gehälter angezeigt werden. Diese Auswahl bleibt auf diesem Computer und ändert nichts an deinem Team.",
  },
  fr: {
    navLabel: "Paramètres",
    title: "Paramètres",
    intro: "La langue de l’app et la devise dans laquelle les salaires s’affichent. Ces choix restent sur cet ordinateur et ne changent rien à ton équipe.",
  },
  es: {
    navLabel: "Ajustes",
    title: "Ajustes",
    intro: "El idioma de la app y la moneda en la que se muestran los salarios. Estas opciones se quedan en este ordenador y no cambian nada en tu equipo.",
  },
  pt: {
    navLabel: "Configurações",
    title: "Configurações",
    intro: "O idioma da app e a moeda em que os salários são mostrados. Estas escolhas ficam neste computador e não mudam nada na tua equipa.",
  },
  hu: {
    navLabel: "Beállítások",
    title: "Beállítások",
    intro: "Az app nyelve és a fizetések megjelenítési pénzneme. Ezek a beállítások ezen a számítógépen maradnak, és semmit sem változtatnak a csapatodon.",
  },
};
