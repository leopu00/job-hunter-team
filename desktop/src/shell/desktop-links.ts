import type { Locale } from "@/i18n/config";

/**
 * The desktop's own pages, after the web's links: they have no web
 * counterpart, so NavLinks (a web file) does not list them. A module of its
 * own, not an export of Shell.tsx: a component file that also exports data
 * cannot be Fast Refreshed, and every edit of Shell.tsx reloaded the page.
 * The labels are in the seven languages; the Mail one is the title of its page
 * (pages/mail/mail.i18n.ts), the Settings one the title of its own
 * (pages/settings/settings.i18n.ts), and so is the Help one (pages/help/help.i18n.ts).
 */
const LABELS: Record<"/agents" | "/office" | "/mail" | "/settings" | "/help", Record<Locale, string>> = {
  "/agents": { it: "Agenti", en: "Agents", de: "Agenten", fr: "Agents", es: "Agentes", pt: "Agentes", hu: "Ügynökök" },
  "/office": { it: "Ufficio", en: "Office", de: "Büro", fr: "Bureau", es: "Oficina", pt: "Escritório", hu: "Iroda" },
  "/mail": { it: "Posta", en: "Mail", de: "E-Mail", fr: "Courrier", es: "Correo", pt: "Correio", hu: "Levelezés" },
  "/settings": { it: "Impostazioni", en: "Settings", de: "Einstellungen", fr: "Paramètres", es: "Ajustes", pt: "Configurações", hu: "Beállítások" },
  "/help": { it: "Guida", en: "Help", de: "Hilfe", fr: "Aide", es: "Ayuda", pt: "Ajuda", hu: "Súgó" },
};

export function desktopLinks(locale: Locale): { href: string; label: string }[] {
  return (Object.keys(LABELS) as (keyof typeof LABELS)[]).map((href) => ({ href, label: LABELS[href][locale] }));
}
