import type { Locale } from "@/i18n/config";

/** The words of the navbar's own buttons and of a page that could not be read. */
export interface ShellText {
  /** The accessible name of the navigation. */
  navAria: string;
  refresh: string;
  signOut: string;
  signingOut: string;
  /** Read by a screen reader only: the sign-out did not go through. */
  signOutFailed: string;
  /** What a page says when it could not be read; `refresh` is the label of the navbar's button. */
  pageReadFailed: (refresh: string) => string;
}

export const SHELL_TEXT: Record<Locale, ShellText> = {
  it: {
    navAria: "Navigazione app",
    refresh: "Aggiorna",
    signOut: "Esci",
    signingOut: "Uscita…",
    signOutFailed: "Disconnessione non riuscita. Il runtime resta bloccato su questo account.",
    pageReadFailed: (refresh) => `Non riesco a leggere questa pagina. Controlla la connessione e premi «${refresh}».`,
  },
  en: {
    navAria: "App navigation",
    refresh: "Refresh",
    signOut: "Sign out",
    signingOut: "Signing out…",
    signOutFailed: "Sign-out failed. The runtime stays locked to this account.",
    pageReadFailed: (refresh) => `This page could not be read. Check the connection and press “${refresh}”.`,
  },
  de: {
    navAria: "App-Navigation",
    refresh: "Aktualisieren",
    signOut: "Abmelden",
    signingOut: "Abmelden…",
    signOutFailed: "Abmeldung fehlgeschlagen. Die Laufzeit bleibt an dieses Konto gebunden.",
    pageReadFailed: (refresh) => `Diese Seite konnte nicht gelesen werden. Prüfe die Verbindung und drücke „${refresh}“.`,
  },
  hu: {
    navAria: "Alkalmazásnavigáció",
    refresh: "Frissítés",
    signOut: "Kilépés",
    signingOut: "Kilépés…",
    signOutFailed: "A kijelentkezés nem sikerült. A futtatókörnyezet ehhez a fiókhoz kötve marad.",
    pageReadFailed: (refresh) => `Az oldal nem olvasható. Ellenőrizd a kapcsolatot, és nyomd meg a(z) „${refresh}” gombot.`,
  },
  es: {
    navAria: "Navegación de la app",
    refresh: "Actualizar",
    signOut: "Salir",
    signingOut: "Saliendo…",
    signOutFailed: "No se pudo cerrar la sesión. El entorno de ejecución sigue bloqueado en esta cuenta.",
    pageReadFailed: (refresh) => `No se pudo leer esta página. Revisa la conexión y pulsa «${refresh}».`,
  },
  fr: {
    navAria: "Navigation de l’app",
    refresh: "Actualiser",
    signOut: "Quitter",
    signingOut: "Déconnexion…",
    signOutFailed: "La déconnexion a échoué. L’environnement d’exécution reste verrouillé sur ce compte.",
    pageReadFailed: (refresh) => `Cette page n’a pas pu être lue. Vérifie la connexion et appuie sur « ${refresh} ».`,
  },
  pt: {
    navAria: "Navegação da app",
    refresh: "Atualizar",
    signOut: "Sair",
    signingOut: "A sair…",
    signOutFailed: "Não foi possível terminar a sessão. O ambiente de execução continua bloqueado nesta conta.",
    pageReadFailed: (refresh) => `Não foi possível ler esta página. Verifica a ligação e prime «${refresh}».`,
  },
};
