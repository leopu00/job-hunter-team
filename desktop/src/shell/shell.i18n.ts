import type { Locale } from "@/i18n/config";

/** The words of the navbar's own buttons and of a page that could not be read. */
export interface ShellText {
  /** The accessible name of the navigation. */
  navAria: string;
  refresh: string;
  /** The button inside a page that could not read its data: another word than the navbar's `refresh`, so the two are not told apart only by where they are. */
  retry: string;
  /** The button that holds the links that do not fit the navbar. */
  more: string;
  signOut: string;
  signingOut: string;
  /** Read by a screen reader only: the sign-out did not go through. */
  signOutFailed: string;
  /** What «Sign out» does and does not remove: the person, not the data. True for a team on this computer and on a VPS alike. Shown as the button's tooltip. */
  signOutNote: string;
  /** What a page says when it could not be read; `refresh` is the label of the navbar's button. */
  pageReadFailed: (refresh: string) => string;
}

export const SHELL_TEXT: Record<Locale, ShellText> = {
  it: {
    navAria: "Navigazione app",
    refresh: "Aggiorna",
    retry: "Riprova",
    more: "Altro",
    signOut: "Esci",
    signingOut: "Uscita…",
    signOutFailed: "Disconnessione non riuscita. Il runtime resta bloccato su questo account.",
    signOutNote: "Esci da questo account. Il team collegato e i tuoi dati non vengono cancellati.",
    pageReadFailed: (refresh) => `Non riesco a leggere questa pagina. Controlla la connessione e premi «${refresh}».`,
  },
  en: {
    navAria: "App navigation",
    refresh: "Refresh",
    retry: "Try again",
    more: "More",
    signOut: "Sign out",
    signingOut: "Signing out…",
    signOutFailed: "Sign-out failed. The runtime stays locked to this account.",
    signOutNote: "Sign out of this account. The linked team and your data are not deleted.",
    pageReadFailed: (refresh) => `This page could not be read. Check the connection and press “${refresh}”.`,
  },
  de: {
    navAria: "App-Navigation",
    refresh: "Aktualisieren",
    retry: "Erneut versuchen",
    more: "Mehr",
    signOut: "Abmelden",
    signingOut: "Abmelden…",
    signOutFailed: "Abmeldung fehlgeschlagen. Die Laufzeit bleibt an dieses Konto gebunden.",
    signOutNote: "Von diesem Konto abmelden. Das verbundene Team und deine Daten werden nicht gelöscht.",
    pageReadFailed: (refresh) => `Diese Seite konnte nicht gelesen werden. Prüfe die Verbindung und drücke „${refresh}“.`,
  },
  hu: {
    navAria: "Alkalmazásnavigáció",
    refresh: "Frissítés",
    retry: "Próbáld újra",
    more: "Továbbiak",
    signOut: "Kilépés",
    signingOut: "Kilépés…",
    signOutFailed: "A kijelentkezés nem sikerült. A futtatókörnyezet ehhez a fiókhoz kötve marad.",
    signOutNote: "Kilépés ebből a fiókból. A csatolt csapat és az adataid nem törlődnek.",
    pageReadFailed: (refresh) => `Az oldal nem olvasható. Ellenőrizd a kapcsolatot, és nyomd meg a(z) „${refresh}” gombot.`,
  },
  es: {
    navAria: "Navegación de la app",
    refresh: "Actualizar",
    retry: "Reintentar",
    more: "Más",
    signOut: "Salir",
    signingOut: "Saliendo…",
    signOutFailed: "No se pudo cerrar la sesión. El entorno de ejecución sigue bloqueado en esta cuenta.",
    signOutNote: "Sal de esta cuenta. El equipo vinculado y tus datos no se borran.",
    pageReadFailed: (refresh) => `No se pudo leer esta página. Revisa la conexión y pulsa «${refresh}».`,
  },
  fr: {
    navAria: "Navigation de l’app",
    refresh: "Actualiser",
    retry: "Réessayer",
    more: "Plus",
    signOut: "Quitter",
    signingOut: "Déconnexion…",
    signOutFailed: "La déconnexion a échoué. L’environnement d’exécution reste verrouillé sur ce compte.",
    signOutNote: "Déconnecte-toi de ce compte. L’équipe liée et tes données ne sont pas supprimées.",
    pageReadFailed: (refresh) => `Cette page n’a pas pu être lue. Vérifie la connexion et appuie sur « ${refresh} ».`,
  },
  pt: {
    navAria: "Navegação da app",
    refresh: "Atualizar",
    retry: "Tentar novamente",
    more: "Mais",
    signOut: "Sair",
    signingOut: "A sair…",
    signOutFailed: "Não foi possível terminar a sessão. O ambiente de execução continua bloqueado nesta conta.",
    signOutNote: "Termina a sessão desta conta. A equipa ligada e os teus dados não são apagados.",
    pageReadFailed: (refresh) => `Não foi possível ler esta página. Verifica a ligação e prime «${refresh}».`,
  },
};
