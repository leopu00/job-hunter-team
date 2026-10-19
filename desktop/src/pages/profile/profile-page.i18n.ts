import type { Locale } from "@/i18n/config";

/**
 * The words of the desktop's Profile page that the web's profile view does not
 * carry: the LinkedIn login card and the note on contacts the desktop cannot
 * open. 7 languages; Italian is the source and its shape is the type.
 * `{list}` is the list of the sealed contacts.
 */
export interface ProfilePageText {
  linkedinAria: string;
  linkedinTitle: string;
  linkedinIntro: string;
  statusLabel: string;
  statusLoading: string;
  statusUnknown: string;
  statusLoggedIn: string;
  statusLoggedOut: string;
  opening: string;
  loginAgain: string;
  login: string;
  sealedContacts: string; // {list}
}

export const PROFILE_PAGE_TEXT: Record<Locale, ProfilePageText> = {
  it: {
    linkedinAria: "Accesso a LinkedIn",
    linkedinTitle: "Accesso a LinkedIn per le candidature",
    linkedinIntro: "L’accesso si fa nel browser protetto del team, in una finestra a parte. Gli agenti non vedono la password e non leggono i dati della sessione: la usano solo per candidarsi al posto tuo.",
    statusLabel: "Stato:",
    statusLoading: "verifica…",
    statusUnknown: "non disponibile",
    statusLoggedIn: "accesso fatto",
    statusLoggedOut: "accesso da fare",
    opening: "Apro lo schermo di accesso…",
    loginAgain: "Accedi di nuovo a LinkedIn",
    login: "Accedi a LinkedIn",
    sealedContacts: "Alcuni contatti ({list}) sono cifrati sul server e nella desktop non si aprono ancora.",
  },
  en: {
    linkedinAria: "LinkedIn login",
    linkedinTitle: "LinkedIn login for applications",
    linkedinIntro: "You log in inside the team’s protected browser, in a separate window. The agents do not see the password and do not read the session data: they use the session only to apply on your behalf.",
    statusLabel: "Status:",
    statusLoading: "checking…",
    statusUnknown: "unavailable",
    statusLoggedIn: "logged in",
    statusLoggedOut: "login needed",
    opening: "Opening the login screen…",
    loginAgain: "Log in to LinkedIn again",
    login: "Log in to LinkedIn",
    sealedContacts: "Some contacts ({list}) are encrypted on the server and cannot be opened in the desktop yet.",
  },
  de: {
    linkedinAria: "LinkedIn-Anmeldung",
    linkedinTitle: "LinkedIn-Anmeldung für die Bewerbungen",
    linkedinIntro: "Die Anmeldung erfolgt im geschützten Browser des Teams, in einem eigenen Fenster. Die Agenten sehen das Passwort nicht und lesen die Sitzungsdaten nicht: Sie nutzen die Sitzung nur, um sich in deinem Namen zu bewerben.",
    statusLabel: "Status:",
    statusLoading: "wird geprüft…",
    statusUnknown: "nicht verfügbar",
    statusLoggedIn: "angemeldet",
    statusLoggedOut: "Anmeldung nötig",
    opening: "Anmeldebildschirm wird geöffnet…",
    loginAgain: "Erneut bei LinkedIn anmelden",
    login: "Bei LinkedIn anmelden",
    sealedContacts: "Einige Kontakte ({list}) sind auf dem Server verschlüsselt und lassen sich in der Desktop-App noch nicht öffnen.",
  },
  fr: {
    linkedinAria: "Connexion à LinkedIn",
    linkedinTitle: "Connexion à LinkedIn pour les candidatures",
    linkedinIntro: "La connexion se fait dans le navigateur protégé de l’équipe, dans une fenêtre à part. Les agents ne voient pas le mot de passe et ne lisent pas les données de la session : ils l’utilisent seulement pour postuler à ta place.",
    statusLabel: "État :",
    statusLoading: "vérification…",
    statusUnknown: "indisponible",
    statusLoggedIn: "connecté",
    statusLoggedOut: "connexion à faire",
    opening: "Ouverture de l’écran de connexion…",
    loginAgain: "Se reconnecter à LinkedIn",
    login: "Se connecter à LinkedIn",
    sealedContacts: "Certains contacts ({list}) sont chiffrés sur le serveur et ne peuvent pas encore être ouverts dans l’app de bureau.",
  },
  es: {
    linkedinAria: "Acceso a LinkedIn",
    linkedinTitle: "Acceso a LinkedIn para las candidaturas",
    linkedinIntro: "El acceso se hace en el navegador protegido del equipo, en una ventana aparte. Los agentes no ven la contraseña ni leen los datos de la sesión: solo la usan para postularse en tu lugar.",
    statusLabel: "Estado:",
    statusLoading: "comprobando…",
    statusUnknown: "no disponible",
    statusLoggedIn: "acceso hecho",
    statusLoggedOut: "falta el acceso",
    opening: "Abriendo la pantalla de acceso…",
    loginAgain: "Acceder de nuevo a LinkedIn",
    login: "Acceder a LinkedIn",
    sealedContacts: "Algunos contactos ({list}) están cifrados en el servidor y todavía no se pueden abrir en la app de escritorio.",
  },
  pt: {
    linkedinAria: "Acesso ao LinkedIn",
    linkedinTitle: "Acesso ao LinkedIn para as candidaturas",
    linkedinIntro: "O acesso faz-se no navegador protegido da equipa, numa janela à parte. Os agentes não veem a palavra-passe nem leem os dados da sessão: usam-na apenas para se candidatarem por ti.",
    statusLabel: "Estado:",
    statusLoading: "a verificar…",
    statusUnknown: "indisponível",
    statusLoggedIn: "acesso feito",
    statusLoggedOut: "falta fazer o acesso",
    opening: "A abrir o ecrã de acesso…",
    loginAgain: "Entrar de novo no LinkedIn",
    login: "Entrar no LinkedIn",
    sealedContacts: "Alguns contactos ({list}) estão cifrados no servidor e ainda não se abrem na app de secretária.",
  },
  hu: {
    linkedinAria: "LinkedIn-bejelentkezés",
    linkedinTitle: "LinkedIn-bejelentkezés a jelentkezésekhez",
    linkedinIntro: "A bejelentkezés a csapat védett böngészőjében történik, külön ablakban. Az ügynökök nem látják a jelszót, és nem olvassák a munkamenet adatait: a munkamenetet csak arra használják, hogy a nevedben jelentkezzenek.",
    statusLabel: "Állapot:",
    statusLoading: "ellenőrzés…",
    statusUnknown: "nem elérhető",
    statusLoggedIn: "bejelentkezve",
    statusLoggedOut: "bejelentkezés szükséges",
    opening: "A bejelentkezési képernyő megnyitása…",
    loginAgain: "Jelentkezz be újra a LinkedInbe",
    login: "Jelentkezz be a LinkedInbe",
    sealedContacts: "Néhány kapcsolat ({list}) titkosítva van a szerveren, és az asztali appban még nem nyitható meg.",
  },
};
