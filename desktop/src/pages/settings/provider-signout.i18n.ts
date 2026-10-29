import type { Locale } from "@/i18n/config";

/** The «Disconnect the account» part of the Settings «Provider» card. 7 languages; Italian is the source and its shape is the type. */
const it = {
  signedIn: "Accesso effettuato a {provider}.",
  signedOut: "Account disconnesso. Per riprendere, accedi di nuovo dal passo «Provider».",
  button: "Disconnetti l’account",
  confirmTitle: "Disconnettere l’account di {provider}?",
  confirmText:
    "La squadra si ferma e, per riprendere, dovrai accedere di nuovo dal passo «Provider» e riavviarla. Finché non accedi, l’Assistente non può rispondere. L’accesso presso {provider} non viene revocato: per toglierlo del tutto, fallo dal sito del provider.",
  confirmYes: "Sì, disconnetti",
  confirmNo: "Annulla",
  working: "Disconnetto…",
};

export type ProviderSignOutText = typeof it;

export const PROVIDER_SIGNOUT_TEXT: Record<Locale, ProviderSignOutText> = {
  it,
  en: {
    signedIn: "Signed in to {provider}.",
    signedOut: "Account disconnected. To start again, sign in from the «Provider» step.",
    button: "Disconnect the account",
    confirmTitle: "Disconnect the {provider} account?",
    confirmText:
      "The team stops and, to start again, you will have to sign in from the «Provider» step and start it again. Until you sign in, the Assistant cannot answer. The access at {provider} is not revoked: to remove it altogether, do it from the provider’s website.",
    confirmYes: "Yes, disconnect",
    confirmNo: "Cancel",
    working: "Disconnecting…",
  },
  de: {
    signedIn: "Bei {provider} angemeldet.",
    signedOut: "Konto getrennt. Um weiterzumachen, melde dich im Schritt «Anbieter» erneut an.",
    button: "Konto trennen",
    confirmTitle: "Das Konto von {provider} trennen?",
    confirmText:
      "Das Team hält an, und zum Weitermachen musst du dich im Schritt «Anbieter» erneut anmelden und es wieder starten. Bis dahin kann der Assistent nicht antworten. Der Zugang bei {provider} wird nicht widerrufen: Um ihn ganz zu entfernen, tu das auf der Website des Anbieters.",
    confirmYes: "Ja, trennen",
    confirmNo: "Abbrechen",
    working: "Wird getrennt…",
  },
  es: {
    signedIn: "Sesión iniciada en {provider}.",
    signedOut: "Cuenta desconectada. Para continuar, inicia sesión de nuevo desde el paso «Proveedor».",
    button: "Desconectar la cuenta",
    confirmTitle: "¿Desconectar la cuenta de {provider}?",
    confirmText:
      "El equipo se detiene y, para continuar, tendrás que iniciar sesión de nuevo desde el paso «Proveedor» y volver a ponerlo en marcha. Hasta entonces, el Asistente no puede responder. El acceso en {provider} no se revoca: para quitarlo del todo, hazlo desde el sitio web del proveedor.",
    confirmYes: "Sí, desconectar",
    confirmNo: "Cancelar",
    working: "Desconectando…",
  },
  fr: {
    signedIn: "Connecté à {provider}.",
    signedOut: "Compte déconnecté. Pour reprendre, reconnecte-toi depuis l’étape « Fournisseur ».",
    button: "Déconnecter le compte",
    confirmTitle: "Déconnecter le compte de {provider} ?",
    confirmText:
      "L’équipe s’arrête et, pour reprendre, tu devras te reconnecter depuis l’étape « Fournisseur » et la redémarrer. Tant que tu ne l’as pas fait, l’Assistant ne peut pas répondre. L’accès chez {provider} n’est pas révoqué : pour le retirer complètement, fais-le depuis le site du fournisseur.",
    confirmYes: "Oui, déconnecter",
    confirmNo: "Annuler",
    working: "Déconnexion…",
  },
  hu: {
    signedIn: "Bejelentkezve: {provider}.",
    signedOut: "A fiók leválasztva. A folytatáshoz jelentkezz be újra a «Szolgáltató» lépésben.",
    button: "A fiók leválasztása",
    confirmTitle: "Leválasztod a(z) {provider} fiókját?",
    confirmText:
      "A csapat leáll, és a folytatáshoz újra be kell jelentkezned a «Szolgáltató» lépésben, majd újra el kell indítanod. Addig az Asszisztens nem tud válaszolni. A(z) {provider} hozzáférése nem vonódik vissza: teljes eltávolításához használd a szolgáltató weboldalát.",
    confirmYes: "Igen, leválasztom",
    confirmNo: "Mégse",
    working: "Leválasztás…",
  },
  pt: {
    signedIn: "Sessão iniciada em {provider}.",
    signedOut: "Conta desligada. Para continuar, inicia sessão de novo no passo «Fornecedor».",
    button: "Desligar a conta",
    confirmTitle: "Desligar a conta de {provider}?",
    confirmText:
      "A equipa para e, para continuar, terás de iniciar sessão de novo no passo «Fornecedor» e voltar a arrancá-la. Até lá, o Assistente não pode responder. O acesso em {provider} não é revogado: para o retirar por completo, faz isso no site do fornecedor.",
    confirmYes: "Sim, desligar",
    confirmNo: "Cancelar",
    working: "A desligar…",
  },
};
