import type { Locale } from "@/i18n/config";

/**
 * The first screen of the app: the language, in the seven the app has. Every text is in the language that is
 * highlighted, so the screen answers the choice as it is made. `{language}` is that language's own name.
 */
const it = {
  eyebrow: "Primo avvio",
  title: "Scegli la tua lingua",
  subtitle: "Puoi cambiarla in ogni momento nelle Impostazioni.",
  continueIn: "Continua in {language}",
  listAria: "Lingue disponibili",
  selected: "selezionata",
  keyboardHint: "Usa le frecce per scegliere e Invio per continuare.",
  notKept: "Non riesco a ricordare la scelta: te la chiederò di nuovo al prossimo avvio.",
};
export type LanguageScreenCopy = { [Key in keyof typeof it]: string };

export const LANGUAGE_SCREEN_TEXT: Record<Locale, LanguageScreenCopy> = {
  it,
  en: {
    eyebrow: "First start",
    title: "Choose your language",
    subtitle: "You can change it at any time in Settings.",
    continueIn: "Continue in {language}",
    listAria: "Available languages",
    selected: "selected",
    keyboardHint: "Use the arrow keys to choose and Enter to continue.",
    notKept: "I cannot remember the choice: I will ask you again the next time you start.",
  },
  de: {
    eyebrow: "Erster Start",
    title: "Wähle deine Sprache",
    subtitle: "Du kannst sie jederzeit in den Einstellungen ändern.",
    continueIn: "Weiter auf {language}",
    listAria: "Verfügbare Sprachen",
    selected: "ausgewählt",
    keyboardHint: "Wähle mit den Pfeiltasten und fahre mit Enter fort.",
    notKept: "Ich kann mir die Auswahl nicht merken: Beim nächsten Start frage ich dich erneut.",
  },
  es: {
    eyebrow: "Primer inicio",
    title: "Elige tu idioma",
    subtitle: "Puedes cambiarlo cuando quieras en Ajustes.",
    continueIn: "Continuar en {language}",
    listAria: "Idiomas disponibles",
    selected: "seleccionado",
    keyboardHint: "Usa las flechas para elegir y Intro para continuar.",
    notKept: "No consigo recordar la elección: te la preguntaré de nuevo en el próximo inicio.",
  },
  fr: {
    eyebrow: "Premier lancement",
    title: "Choisis ta langue",
    subtitle: "Tu peux la changer à tout moment dans les paramètres.",
    continueIn: "Continuer en {language}",
    listAria: "Langues disponibles",
    selected: "sélectionnée",
    keyboardHint: "Choisis avec les flèches, puis appuie sur Entrée pour continuer.",
    notKept: "Je n'arrive pas à retenir ton choix : je te le redemanderai au prochain lancement.",
  },
  hu: {
    eyebrow: "Első indítás",
    title: "Válassz nyelvet",
    subtitle: "Bármikor módosíthatod a Beállításokban.",
    continueIn: "Folytatás: {language}",
    listAria: "Elérhető nyelvek",
    selected: "kiválasztva",
    keyboardHint: "A nyilakkal választhatsz, az Enterrel folytathatod.",
    notKept: "Nem tudom megjegyezni a választást: a következő indításkor újra megkérdezlek.",
  },
  pt: {
    eyebrow: "Primeiro arranque",
    title: "Escolhe o teu idioma",
    subtitle: "Podes alterá-lo a qualquer momento nas Definições.",
    continueIn: "Continuar em {language}",
    listAria: "Idiomas disponíveis",
    selected: "selecionado",
    keyboardHint: "Usa as setas para escolher e Enter para continuar.",
    notKept: "Não consigo guardar a escolha: voltarei a perguntar-te no próximo arranque.",
  },
};
