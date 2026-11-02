import type { Locale } from "@/i18n/config";

/** The words of the Settings page's own frame: the column of sections and the pieces that live between them. */
export interface SectionsText {
  /** The accessible name of the column of sections. */
  navAria: string;
  appearance: string;
  team: string;
  where: string;
  data: string;
  account: string;
  themeTitle: string;
  themeText: string;
  /** The link to the budget page, in the Team section. */
  budgetLink: string;
  budgetNote: string;
}

export const SECTIONS_TEXT: Record<Locale, SectionsText> = {
  it: {
    navAria: "Sezioni delle impostazioni",
    appearance: "Aspetto",
    team: "Squadra",
    where: "Dove gira",
    data: "Dati",
    account: "Account",
    themeTitle: "Tema",
    themeText: "I colori dell’app. Lo trovi anche nell’ingranaggio accanto a JHT, in alto.",
    budgetLink: "Vedi il budget",
    budgetNote: "Quanto ha speso la squadra e quanto resta nella settimana.",
  },
  en: {
    navAria: "Settings sections",
    appearance: "Appearance",
    team: "Team",
    where: "Where it runs",
    data: "Data",
    account: "Account",
    themeTitle: "Theme",
    themeText: "The app’s colours. You also find it in the gear next to JHT, at the top.",
    budgetLink: "See the budget",
    budgetNote: "What the team has spent and what is left this week.",
  },
  de: {
    navAria: "Bereiche der Einstellungen",
    appearance: "Darstellung",
    team: "Team",
    where: "Wo es läuft",
    data: "Daten",
    account: "Konto",
    themeTitle: "Design",
    themeText: "Die Farben der App. Du findest es auch im Zahnrad neben JHT oben.",
    budgetLink: "Budget ansehen",
    budgetNote: "Was das Team ausgegeben hat und was in dieser Woche übrig ist.",
  },
  fr: {
    navAria: "Sections des paramètres",
    appearance: "Apparence",
    team: "Équipe",
    where: "Où ça tourne",
    data: "Données",
    account: "Compte",
    themeTitle: "Thème",
    themeText: "Les couleurs de l’app. Vous le trouvez aussi dans l’engrenage à côté de JHT, en haut.",
    budgetLink: "Voir le budget",
    budgetNote: "Ce que l’équipe a dépensé et ce qui reste cette semaine.",
  },
  es: {
    navAria: "Secciones de los ajustes",
    appearance: "Apariencia",
    team: "Equipo",
    where: "Dónde funciona",
    data: "Datos",
    account: "Cuenta",
    themeTitle: "Tema",
    themeText: "Los colores de la app. También lo encuentras en el engranaje junto a JHT, arriba.",
    budgetLink: "Ver el presupuesto",
    budgetNote: "Lo que ha gastado el equipo y lo que queda esta semana.",
  },
  pt: {
    navAria: "Secções das configurações",
    appearance: "Aparência",
    team: "Equipa",
    where: "Onde corre",
    data: "Dados",
    account: "Conta",
    themeTitle: "Tema",
    themeText: "As cores do app. Também o encontra na engrenagem ao lado de JHT, no topo.",
    budgetLink: "Ver o orçamento",
    budgetNote: "O que a equipa gastou e o que sobra nesta semana.",
  },
  hu: {
    navAria: "A beállítások szakaszai",
    appearance: "Megjelenés",
    team: "Csapat",
    where: "Hol fut",
    data: "Adatok",
    account: "Fiók",
    themeTitle: "Téma",
    themeText: "Az app színei. Fent, a JHT melletti fogaskerékben is megtalálod.",
    budgetLink: "A költségkeret megtekintése",
    budgetNote: "Mennyit költött a csapat, és mennyi marad a héten.",
  },
};
