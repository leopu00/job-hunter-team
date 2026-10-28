import type { Locale } from "@/i18n/config";

/** «Segnala un problema» in Help and Settings. Texts by the copy owner; the status lines
 *  (preparing, sending, sent, mail, saved, failed, cancel, preview) are the setup report's own. */
export type ReportProblemText = {
  reportTitle: string;
  reportIntro: string;
  reportFieldLabel: string;
  reportCategoryLabel: string;
  categoryInstall: string;
  categoryTeam: string;
  categoryAccount: string;
  categoryOther: string;
  reportShowPreview: string;
  reportSend: string;
};

export const REPORT_PROBLEM_TEXT: Record<Locale, ReportProblemText> = {
  it: {
    reportTitle: "Segnala un problema",
    reportIntro: "Ti mostriamo il testo, già oscurato, prima di inviarlo.",
    reportFieldLabel: "Cosa è successo?",
    reportCategoryLabel: "Categoria",
    categoryInstall: "Installazione",
    categoryTeam: "Squadra e agenti",
    categoryAccount: "Account e accesso",
    categoryOther: "Altro",
    reportShowPreview: "Mostra anteprima",
    reportSend: "Invia",
  },
  en: {
    reportTitle: "Report a problem",
    reportIntro: "We show you the text, already redacted, before it is sent.",
    reportFieldLabel: "What happened?",
    reportCategoryLabel: "Category",
    categoryInstall: "Installation",
    categoryTeam: "Team and agents",
    categoryAccount: "Account and sign-in",
    categoryOther: "Other",
    reportShowPreview: "Show preview",
    reportSend: "Send",
  },
  de: {
    reportTitle: "Problem melden",
    reportIntro: "Wir zeigen dir den Text, bereits bereinigt, bevor er gesendet wird.",
    reportFieldLabel: "Was ist passiert?",
    reportCategoryLabel: "Kategorie",
    categoryInstall: "Installation",
    categoryTeam: "Team und Agenten",
    categoryAccount: "Konto und Anmeldung",
    categoryOther: "Sonstiges",
    reportShowPreview: "Vorschau anzeigen",
    reportSend: "Senden",
  },
  es: {
    reportTitle: "Informar de un problema",
    reportIntro: "Te mostramos el texto, ya con los datos ocultos, antes de enviarlo.",
    reportFieldLabel: "¿Qué ha pasado?",
    reportCategoryLabel: "Categoría",
    categoryInstall: "Instalación",
    categoryTeam: "Equipo y agentes",
    categoryAccount: "Cuenta y acceso",
    categoryOther: "Otro",
    reportShowPreview: "Mostrar vista previa",
    reportSend: "Enviar",
  },
  fr: {
    reportTitle: "Signaler un problème",
    reportIntro: "Nous te montrons le texte, déjà expurgé, avant de l’envoyer.",
    reportFieldLabel: "Que s’est-il passé ?",
    reportCategoryLabel: "Catégorie",
    categoryInstall: "Installation",
    categoryTeam: "Équipe et agents",
    categoryAccount: "Compte et connexion",
    categoryOther: "Autre",
    reportShowPreview: "Afficher l’aperçu",
    reportSend: "Envoyer",
  },
  hu: {
    reportTitle: "Probléma jelentése",
    reportIntro: "Elküldés előtt megmutatjuk a már kitakart szöveget.",
    reportFieldLabel: "Mi történt?",
    reportCategoryLabel: "Kategória",
    categoryInstall: "Telepítés",
    categoryTeam: "Csapat és ügynökök",
    categoryAccount: "Fiók és belépés",
    categoryOther: "Egyéb",
    reportShowPreview: "Előnézet megjelenítése",
    reportSend: "Küldés",
  },
  pt: {
    reportTitle: "Reportar um problema",
    reportIntro: "Mostramos-te o texto, já ocultado, antes de o enviar.",
    reportFieldLabel: "O que aconteceu?",
    reportCategoryLabel: "Categoria",
    categoryInstall: "Instalação",
    categoryTeam: "Equipa e agentes",
    categoryAccount: "Conta e acesso",
    categoryOther: "Outro",
    reportShowPreview: "Mostrar pré-visualização",
    reportSend: "Enviar",
  },
};
