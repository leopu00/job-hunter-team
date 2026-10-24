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
  providerTitle: "Provider",
  providerText: "Il provider (Claude, Codex o Kimi) con cui lavorano gli agenti della squadra di questo computer. Cambialo o accedi di nuovo: si riapre il passo «Provider» della configurazione e la squadra riparte con la tua scelta.",
  providerButton: "Configura il provider",
};

export type SettingsText = typeof it;

export const SETTINGS_TEXT: Record<Locale, SettingsText> = {
  it,
  en: {
    navLabel: "Settings",
    title: "Settings",
    intro: "The app’s language and the currency salaries are shown in. These choices stay on this computer and change nothing on your team.",
    providerTitle: "Provider",
    providerText: "The provider (Claude, Codex or Kimi) the agents of this computer's team work with. Change it or sign in again: the setup's «Provider» step opens again and the team restarts with your choice.",
    providerButton: "Set up the provider",
  },
  de: {
    navLabel: "Einstellungen",
    title: "Einstellungen",
    intro: "Sprache der App und Währung, in der Gehälter angezeigt werden. Diese Auswahl bleibt auf diesem Computer und ändert nichts an deinem Team.",
    providerTitle: "Anbieter",
    providerText: "Der Anbieter (Claude, Codex oder Kimi), mit dem die Agenten des Teams auf diesem Computer arbeiten. Ändere ihn oder melde dich neu an: Der Schritt «Anbieter» der Einrichtung öffnet sich erneut und das Team startet mit deiner Wahl neu.",
    providerButton: "Anbieter einrichten",
  },
  fr: {
    navLabel: "Paramètres",
    title: "Paramètres",
    intro: "La langue de l’app et la devise dans laquelle les salaires s’affichent. Ces choix restent sur cet ordinateur et ne changent rien à ton équipe.",
    providerTitle: "Fournisseur",
    providerText: "Le fournisseur (Claude, Codex ou Kimi) avec lequel travaillent les agents de l’équipe de cet ordinateur. Change-le ou reconnecte-toi : l’étape « Fournisseur » de la configuration se rouvre et l’équipe redémarre avec ton choix.",
    providerButton: "Configurer le fournisseur",
  },
  es: {
    navLabel: "Ajustes",
    title: "Ajustes",
    intro: "El idioma de la app y la moneda en la que se muestran los salarios. Estas opciones se quedan en este ordenador y no cambian nada en tu equipo.",
    providerTitle: "Proveedor",
    providerText: "El proveedor (Claude, Codex o Kimi) con el que trabajan los agentes del equipo de este ordenador. Cámbialo o vuelve a iniciar sesión: se abre de nuevo el paso «Proveedor» de la configuración y el equipo se reinicia con tu elección.",
    providerButton: "Configurar el proveedor",
  },
  pt: {
    navLabel: "Configurações",
    title: "Configurações",
    intro: "O idioma da app e a moeda em que os salários são mostrados. Estas escolhas ficam neste computador e não mudam nada na tua equipa.",
    providerTitle: "Fornecedor",
    providerText: "O fornecedor (Claude, Codex ou Kimi) com que trabalham os agentes da equipa deste computador. Muda-o ou volta a iniciar sessão: o passo «Fornecedor» da configuração abre-se de novo e a equipa arranca com a tua escolha.",
    providerButton: "Configurar o fornecedor",
  },
  hu: {
    navLabel: "Beállítások",
    title: "Beállítások",
    intro: "Az app nyelve és a fizetések megjelenítési pénzneme. Ezek a beállítások ezen a számítógépen maradnak, és semmit sem változtatnak a csapatodon.",
    providerTitle: "Szolgáltató",
    providerText: "A szolgáltató (Claude, Codex vagy Kimi), amellyel a számítógép csapatának ügynökei dolgoznak. Módosítsd, vagy jelentkezz be újra: a beállítás «Szolgáltató» lépése újra megnyílik, és a csapat az általad választottal indul újra.",
    providerButton: "Szolgáltató beállítása",
  },
};
