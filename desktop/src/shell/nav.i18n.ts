import type { Locale } from "@/i18n/config";

/**
 * The names of the navbar's destinations that the web's dictionary (`nav_*`) does not have, and of the account
 * menu. The Mail one is the title of its page (pages/mail/mail.i18n.ts), the Settings one the title of its own
 * (pages/settings/settings.i18n.ts), the Help one that of pages/help/help.i18n.ts.
 */
export interface NavText {
  /** The Team destination of the view of a team on a VPS (the same word that view has always used for it). */
  team: string;
  office: string;
  budget: string;
  profile: string;
  mail: string;
  settings: string;
  help: string;
  /** The button that opens the account menu. */
  account: string;
  /** The accessible name of the account menu. */
  accountMenu: string;
  /** The accessible name of the «!» on a link whose setup is still pending. */
  setupPending: string;
}

export const NAV_TEXT: Record<Locale, NavText> = {
  it: { team: "Squadra", office: "Ufficio", budget: "Budget", profile: "Profilo", mail: "Posta", settings: "Impostazioni", help: "Guida", account: "Account", accountMenu: "Menu dell'account", setupPending: "configurazione in sospeso" },
  en: { team: "Team", office: "Office", budget: "Budget", profile: "Profile", mail: "Mail", settings: "Settings", help: "Help", account: "Account", accountMenu: "Account menu", setupPending: "setup pending" },
  de: { team: "Team", office: "Büro", budget: "Budget", profile: "Profil", mail: "E-Mail", settings: "Einstellungen", help: "Hilfe", account: "Konto", accountMenu: "Kontomenü", setupPending: "Einrichtung ausstehend" },
  fr: { team: "Équipe", office: "Bureau", budget: "Budget", profile: "Profil", mail: "Courrier", settings: "Paramètres", help: "Aide", account: "Compte", accountMenu: "Menu du compte", setupPending: "configuration en attente" },
  es: { team: "Equipo", office: "Oficina", budget: "Presupuesto", profile: "Perfil", mail: "Correo", settings: "Ajustes", help: "Ayuda", account: "Cuenta", accountMenu: "Menú de la cuenta", setupPending: "configuración pendiente" },
  pt: { team: "Equipa", office: "Escritório", budget: "Orçamento", profile: "Perfil", mail: "Correio", settings: "Configurações", help: "Ajuda", account: "Conta", accountMenu: "Menu da conta", setupPending: "configuração pendente" },
  hu: { team: "Csapat", office: "Iroda", budget: "Költségkeret", profile: "Profil", mail: "Levelezés", settings: "Beállítások", help: "Súgó", account: "Fiók", accountMenu: "Fiókmenü", setupPending: "beállítás függőben" },
};
