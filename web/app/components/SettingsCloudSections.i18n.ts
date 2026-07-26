// Dizionario di `SettingsCloudSections.tsx`.
//
// Le chiavi sono LOCALI a questo file: lo stesso nome può valere
// tutt'altro altrove (`empty` è "nessun backup" in una pagina e
// "nessun canale" in un'altra), quindi non vanno accorpate in un
// dizionario comune. `satisfies Dictionary` fa pretendere al
// compilatore tutte e sette le lingue: una voce a cui ne manca una
// non compila, invece di mostrare l'inglese all'utente sbagliato.
import type { Dictionary } from "@/lib/i18n-dict";

export const T = {
  account: {
    it: "Account",
    en: "Account",
    hu: "Fiók",
    es: "Cuenta",
    de: "Konto",
    fr: "Compte",
    pt: "Conta",
  },
  signed_in_with: {
    it: "Accesso con {provider}",
    en: "Signed in with {provider}",
    hu: "Bejelentkezve: {provider}",
    es: "Sesión iniciada con {provider}",
    de: "Angemeldet mit {provider}",
    fr: "Connecté avec {provider}",
    pt: "Sessão iniciada com {provider}",
  },
  logout: {
    it: "Esci",
    en: "Sign out",
    hu: "Kijelentkezés",
    es: "Cerrar sesión",
    de: "Abmelden",
    fr: "Se déconnecter",
    pt: "Sair",
  },
  language: {
    it: "Lingua",
    en: "Language",
    hu: "Nyelv",
    es: "Idioma",
    de: "Sprache",
    fr: "Langue",
    pt: "Idioma",
  },
  currency: {
    it: "Valuta stipendi",
    en: "Salary currency",
    hu: "Fizetés pénzneme",
    es: "Moneda de salarios",
    de: "Gehaltswährung",
    fr: "Devise des salaires",
    pt: "Moeda dos salários",
  },
  currency_hint: {
    it: "Le stime di stipendio in liste, swipe e dettaglio vengono convertite in questa valuta.",
    en: "Salary estimates in lists, swipe and detail are converted to this currency.",
    hu: "A listákban, a lapozóban és a részleteknél a fizetésbecslések erre a pénznemre lesznek átváltva.",
    es: "Las estimaciones salariales en listas, swipe y detalle se convierten a esta moneda.",
    de: "Gehaltsschätzungen in Listen, Swipe und Detail werden in diese Währung umgerechnet.",
    fr: "Les estimations de salaire dans les listes, le swipe et le détail sont converties dans cette devise.",
    pt: "As estimativas salariais em listas, swipe e detalhe são convertidas para esta moeda.",
  },
  connect_title: {
    it: "Collega il tuo team",
    en: "Connect your team",
    hu: "Kapcsold össze a csapatodat",
    es: "Conecta tu equipo",
    de: "Team verbinden",
    fr: "Connecter votre équipe",
    pt: "Liga a tua equipa",
  },
  connect_desc: {
    it: "Questo account non riceve ancora dati. Genera un token dispositivo e inseriscilo nell'app desktop: la dashboard si popolerà da sola.",
    en: "This account doesn't receive data yet. Generate a device token and enter it in the desktop app: the dashboard will fill up by itself.",
    hu: "Ez a fiók még nem kap adatokat. Generálj eszköztokent és add meg az asztali appban: a dashboard magától feltöltődik.",
    es: "Esta cuenta aún no recibe datos. Genera un token de dispositivo e introdúcelo en la app de escritorio: el dashboard se llenará solo.",
    de: "Dieses Konto empfängt noch keine Daten. Erzeuge ein Gerätetoken und gib es in der Desktop-App ein: Das Dashboard füllt sich von selbst.",
    fr: "Ce compte ne reçoit pas encore de données. Générez un token d'appareil et saisissez-le dans l'app desktop : le dashboard se remplira tout seul.",
    pt: "Esta conta ainda não recebe dados. Gera um token de dispositivo e insere-o na app desktop: o dashboard preenche-se sozinho.",
  },
  connect_guide: {
    it: "Guida rapida",
    en: "Quick guide",
    hu: "Gyors útmutató",
    es: "Guía rápida",
    de: "Kurzanleitung",
    fr: "Guide rapide",
    pt: "Guia rápido",
  },
  connect_tokens: {
    it: "Token dispositivi",
    en: "Device tokens",
    hu: "Eszköztokenek",
    es: "Tokens de dispositivo",
    de: "Gerätetokens",
    fr: "Tokens d'appareil",
    pt: "Tokens de dispositivo",
  },
} satisfies Dictionary;
