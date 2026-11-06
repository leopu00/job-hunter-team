import type { Locale } from "@/i18n/config";

/** The words of the provider sign-in card (Settings → Team) and of the banner, in the seven languages of the app. `{provider}` is the product's name. */
export interface ProviderLoginText {
  loading: string;
  ready: string;
  probablyExpired: string;
  expired: string;
  missing: string;
  unreadable: string;
  signIn: string;
  /** Where the team runs on a server: the sign-in is redone there, not from this app. */
  onServer: string;
  signingIn: string;
  note: string;
  bannerTitle: string;
  bannerText: string;
  reconnect: string;
  retry: string;
  /** Names for the generic «the provider» when the team has none. */
  providerFallback: string;
  dialogLabel: string;
}

export const PROVIDER_NAMES = { claude: "Claude", codex: "ChatGPT (Codex)", kimi: "Kimi" } as const;

export const PROVIDER_LOGIN_TEXT: Record<Locale, ProviderLoginText> = {
  it: {
    loading: "Controllo l’accesso a {provider}…",
    ready: "L’accesso a {provider} è attivo.",
    probablyExpired: "L’accesso a {provider} è vecchio e potrebbe essere scaduto: accedi di nuovo per sicurezza. La squadra continua a lavorare.",
    expired: "L’accesso a {provider} è scaduto: gli agenti non riescono più a usare il modello.",
    missing: "Non c’è nessun accesso a {provider}.",
    unreadable: "Il file dell’accesso a {provider} non si legge: serve un nuovo accesso.",
    signIn: "Accedi di nuovo",
    onServer: "La squadra gira su un server: l’accesso si rifà lì, con «jht oauth-login» sul server.",
    signingIn: "Accesso in corso…",
    note: "Rifà solo l’accesso: non reinstalla niente e non riavvia la squadra.",
    bannerTitle: "Gli agenti non riescono a usare il modello.",
    bannerText: "L’accesso a {provider} è scaduto. Accedi di nuovo: la squadra non si riavvia.",
    reconnect: "Ricollega la chat",
    retry: "Riprova",
    providerFallback: "il provider",
    dialogLabel: "Accesso al provider",
  },
  en: {
    loading: "Checking the {provider} sign-in…",
    ready: "The {provider} sign-in is active.",
    probablyExpired: "The {provider} sign-in is old and may have expired: sign in again to be safe. The team keeps working.",
    expired: "The {provider} sign-in has expired: the agents can no longer use the model.",
    missing: "There is no {provider} sign-in.",
    unreadable: "The {provider} sign-in file cannot be read: a new sign-in is needed.",
    signIn: "Sign in again",
    onServer: "The team runs on a server: the sign-in is redone there, with «jht oauth-login» on the server.",
    signingIn: "Signing in…",
    note: "It only signs in again: nothing is reinstalled and the team is not restarted.",
    bannerTitle: "The agents cannot use the model.",
    bannerText: "The {provider} sign-in has expired. Sign in again: the team does not restart.",
    reconnect: "Reconnect the chat",
    retry: "Try again",
    providerFallback: "the provider",
    dialogLabel: "Provider sign-in",
  },
  de: {
    loading: "Die {provider}-Anmeldung wird geprüft …",
    ready: "Die {provider}-Anmeldung ist aktiv.",
    probablyExpired: "Die {provider}-Anmeldung ist alt und könnte abgelaufen sein: Melde dich zur Sicherheit erneut an. Das Team arbeitet weiter.",
    expired: "Die {provider}-Anmeldung ist abgelaufen: Die Agenten können das Modell nicht mehr nutzen.",
    missing: "Es gibt keine {provider}-Anmeldung.",
    unreadable: "Die Datei der {provider}-Anmeldung lässt sich nicht lesen: Eine neue Anmeldung ist nötig.",
    signIn: "Erneut anmelden",
    onServer: "Das Team läuft auf einem Server: Die Anmeldung wird dort wiederholt, mit «jht oauth-login» auf dem Server.",
    signingIn: "Anmeldung läuft …",
    note: "Es wird nur die Anmeldung wiederholt: nichts wird neu installiert und das Team nicht neu gestartet.",
    bannerTitle: "Die Agenten können das Modell nicht nutzen.",
    bannerText: "Die {provider}-Anmeldung ist abgelaufen. Melde dich erneut an: Das Team startet nicht neu.",
    reconnect: "Chat erneut verbinden",
    retry: "Erneut versuchen",
    providerFallback: "der Anbieter",
    dialogLabel: "Anbieter-Anmeldung",
  },
  es: {
    loading: "Comprobando el acceso a {provider}…",
    ready: "El acceso a {provider} está activo.",
    probablyExpired: "El acceso a {provider} es antiguo y podría haber caducado: inicia sesión de nuevo por seguridad. El equipo sigue trabajando.",
    expired: "El acceso a {provider} ha caducado: los agentes ya no pueden usar el modelo.",
    missing: "No hay ningún acceso a {provider}.",
    unreadable: "El archivo del acceso a {provider} no se puede leer: hace falta un acceso nuevo.",
    signIn: "Iniciar sesión de nuevo",
    onServer: "El equipo funciona en un servidor: el acceso se repite allí, con «jht oauth-login» en el servidor.",
    signingIn: "Iniciando sesión…",
    note: "Solo repite el acceso: no se reinstala nada y el equipo no se reinicia.",
    bannerTitle: "Los agentes no pueden usar el modelo.",
    bannerText: "El acceso a {provider} ha caducado. Inicia sesión de nuevo: el equipo no se reinicia.",
    reconnect: "Volver a conectar el chat",
    retry: "Reintentar",
    providerFallback: "el proveedor",
    dialogLabel: "Acceso al proveedor",
  },
  fr: {
    loading: "Vérification de l’accès à {provider}…",
    ready: "L’accès à {provider} est actif.",
    probablyExpired: "L’accès à {provider} est ancien et a peut-être expiré : reconnecte-toi par sécurité. L’équipe continue de travailler.",
    expired: "L’accès à {provider} a expiré : les agents ne peuvent plus utiliser le modèle.",
    missing: "Il n’y a aucun accès à {provider}.",
    unreadable: "Le fichier d’accès à {provider} est illisible : un nouvel accès est nécessaire.",
    signIn: "Se reconnecter",
    onServer: "L’équipe tourne sur un serveur : la connexion se refait là-bas, avec « jht oauth-login » sur le serveur.",
    signingIn: "Connexion en cours…",
    note: "Seule la connexion est refaite : rien n’est réinstallé et l’équipe n’est pas redémarrée.",
    bannerTitle: "Les agents ne peuvent pas utiliser le modèle.",
    bannerText: "L’accès à {provider} a expiré. Reconnecte-toi : l’équipe ne redémarre pas.",
    reconnect: "Reconnecter le chat",
    retry: "Réessayer",
    providerFallback: "le fournisseur",
    dialogLabel: "Connexion au fournisseur",
  },
  hu: {
    loading: "A(z) {provider} bejelentkezés ellenőrzése…",
    ready: "A(z) {provider} bejelentkezés aktív.",
    probablyExpired: "A(z) {provider} bejelentkezés régi, és lehet, hogy lejárt: a biztonság kedvéért jelentkezz be újra. A csapat tovább dolgozik.",
    expired: "A(z) {provider} bejelentkezés lejárt: az ügynökök már nem tudják használni a modellt.",
    missing: "Nincs {provider} bejelentkezés.",
    unreadable: "A(z) {provider} bejelentkezés fájlja nem olvasható: új bejelentkezés kell.",
    signIn: "Bejelentkezés újra",
    onServer: "A csapat szerveren fut: a bejelentkezést ott kell megismételni, a szerveren a «jht oauth-login» paranccsal.",
    signingIn: "Bejelentkezés folyamatban…",
    note: "Csak a bejelentkezést ismétli meg: semmit sem telepít újra, és a csapat nem indul újra.",
    bannerTitle: "Az ügynökök nem tudják használni a modellt.",
    bannerText: "A(z) {provider} bejelentkezés lejárt. Jelentkezz be újra: a csapat nem indul újra.",
    reconnect: "Csevegés újracsatlakoztatása",
    retry: "Újra",
    providerFallback: "a szolgáltató",
    dialogLabel: "Szolgáltatói bejelentkezés",
  },
  pt: {
    loading: "A verificar o acesso a {provider}…",
    ready: "O acesso a {provider} está ativo.",
    probablyExpired: "O acesso a {provider} é antigo e pode ter expirado: inicia sessão de novo por segurança. A equipa continua a trabalhar.",
    expired: "O acesso a {provider} expirou: os agentes já não conseguem usar o modelo.",
    missing: "Não há nenhum acesso a {provider}.",
    unreadable: "O ficheiro do acesso a {provider} não pode ser lido: é preciso um novo acesso.",
    signIn: "Iniciar sessão de novo",
    onServer: "A equipa corre num servidor: o acesso refaz-se lá, com «jht oauth-login» no servidor.",
    signingIn: "A iniciar sessão…",
    note: "Só repete o acesso: nada é reinstalado e a equipa não é reiniciada.",
    bannerTitle: "Os agentes não conseguem usar o modelo.",
    bannerText: "O acesso a {provider} expirou. Inicia sessão de novo: a equipa não reinicia.",
    reconnect: "Voltar a ligar o chat",
    retry: "Tentar de novo",
    providerFallback: "o fornecedor",
    dialogLabel: "Acesso ao fornecedor",
  },
};

/** The text with the product's name put in (the generic «provider» when the team names none). */
export function withProvider(text: string, provider: string): string {
  return text.replace(/\{provider\}/g, () => provider);
}
